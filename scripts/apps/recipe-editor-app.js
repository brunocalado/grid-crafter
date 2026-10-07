/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { CATEGORY_MAX, MODULE_ID, SETTING_FAIL_LOSS_CHANCE, TEMPLATE_PATH } from "../constants.js";
import { getDropData, getTheme, isTypeAllowed, itemOrigin, toItemRef } from "../helpers.js";
import { blankRecipe, getAllRecipes, getWorldRecipes, setWorldRecipes } from "../recipes.js";
import { shareRecipe } from "../share.js";
import { TeachRecipeApp } from "./teach-recipe-app.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The GM's recipe book: build a recipe by dropping items on a grid and a result slot.
 */
export class RecipeEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-recipe-editor`,
    classes: [MODULE_ID, "gc-app", "gc-editor"],
    window: {
      title: "GRIDCRAFTER.Editor.Title",
      icon: "fa-solid fa-scroll-old",
      resizable: false
    },
    position: { width: 900, height: "auto" },
    actions: {
      newRecipe: RecipeEditorApp.#onNew,
      selectRecipe: RecipeEditorApp.#onSelect,
      saveRecipe: RecipeEditorApp.#onSave,
      deleteRecipe: RecipeEditorApp.#onDelete,
      copyRecipe: RecipeEditorApp.#onCopy,
      shareRecipe: RecipeEditorApp.#onShare,
      teachRecipe: RecipeEditorApp.#onTeach,
      setCategory: RecipeEditorApp.#onSetCategory,
      clearCell: RecipeEditorApp.#onClearCell,
      clearResult: RecipeEditorApp.#onClearResult
    }
  };

  static PARTS = {
    main: { template: `${TEMPLATE_PATH}/recipe-editor.hbs` }
  };

  /** The recipe being edited: a copy, saved only on demand. */
  draft = null;

  /** Unsaved edits on the draft. */
  dirty = false;

  /** @override */
  async _prepareContext(options) {
    const all = getAllRecipes();
    if ( !this.draft ) this.draft = all[0] ? foundry.utils.deepClone(all[0]) : blankRecipe();
    const draft = this.draft;
    const readOnly = !!draft.source && (draft.source !== "world");
    const isNew = !all.some(r => r.id === draft.id);
    const groups = Object.entries(Object.groupBy(all, r => r.source)).map(([source, recipes]) => ({
      label: (source === "world") ? game.i18n.localize("GRIDCRAFTER.Editor.WorldRecipes")
        : (game.modules.get(source)?.title ?? ((game.system.id === source) ? game.system.title : source)),
      recipes: recipes.map(r => ({ id: r.id, name: r.name || r.result?.name || "—", img: r.result?.img,
        active: r.id === draft.id }))
    }));
    return {
      theme: getTheme(),
      groups,
      draft,
      readOnly,
      isNew,
      dirty: this.dirty,
      cells: draft.cells.map((item, index) => ({ index, item })),
      inherit: draft.failLossChance === null,
      lossChance: draft.failLossChance ?? game.settings.get(MODULE_ID, SETTING_FAIL_LOSS_CHANCE),
      shapeHelp: `<p><strong>${game.i18n.localize("GRIDCRAFTER.Recipe.Shaped")}</strong><br>`
        + `${game.i18n.localize("GRIDCRAFTER.Editor.ShapedHint")}</p>`
        + `<p><strong>${game.i18n.localize("GRIDCRAFTER.Recipe.Shapeless")}</strong><br>`
        + `${game.i18n.localize("GRIDCRAFTER.Editor.ShapelessHint")}</p>`,
      quantityHelp: `<p><strong>${game.i18n.localize("GRIDCRAFTER.Recipe.Quantity")}</strong><br>`
        + `${game.i18n.localize("GRIDCRAFTER.Editor.QuantityHint")}</p>`
    };
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const theme = getTheme();
    for ( const t of ["forge", "arcane"] ) this.element.classList.toggle(`gc-theme-${t}`, t === theme);
    for ( const el of this.element.querySelectorAll("[data-drop]") ) {
      el.addEventListener("dblclick", ev => {
        const { drop, index } = ev.currentTarget.dataset;
        const ref = (drop === "result") ? this.draft.result : this.draft.cells[Number(index)];
        if ( ref ) fromUuid(ref.uuid).then(item => item?.sheet?.render({ force: true }));
      });
    }
    if ( context.readOnly ) return;
    for ( const el of this.element.querySelectorAll("[data-drop]") ) {
      el.addEventListener("dragover", ev => {
        ev.preventDefault();
        ev.currentTarget.classList.add("gc-drop-target");
      });
      el.addEventListener("dragleave", ev => ev.currentTarget.classList.remove("gc-drop-target"));
      el.addEventListener("drop", this.#onDrop.bind(this));
    }
    // Typing only updates the draft. Re-rendering on every change would replace the Save button under
    // the cursor while a click on it is in progress, and the click would be lost.
    for ( const input of this.element.querySelectorAll(".gc-recipe-fields [name]") ) {
      input.addEventListener("input", this.#onFieldInput.bind(this));
    }
  }

  /** @param {Event} event */
  #onFieldInput(event) {
    const input = event.currentTarget;
    const draft = this.draft;
    switch ( input.name ) {
      case "name":
        draft.name = input.value;
        break;
      case "quantity":
        draft.quantity = Math.clamp(Math.round(Number(input.value) || 1), 1, 10);
        this.element.querySelector(".gc-quantity-value").textContent = String(draft.quantity);
        break;
      case "failLossChance":
        draft.failLossChance = Math.clamp(Math.round(Number(input.value) || 0), 0, 100);
        this.element.querySelector(".gc-loss-value").textContent = `${draft.failLossChance}%`;
        break;
      case "shaped":
        draft.shaped = input.value === "shaped";
        return this.#markDirty(true);
      case "inherit":
        draft.failLossChance = input.checked ? null : game.settings.get(MODULE_ID, SETTING_FAIL_LOSS_CHANCE);
        return this.#markDirty(true);
    }
    this.#markDirty(false);
  }

  /**
   * @param {boolean} render   whether the change alters what the form shows
   */
  #markDirty(render) {
    this.dirty = true;
    if ( render ) this.render();
    else this.element.querySelector(".gc-save")?.classList.add("gc-dirty");
  }

  /** @param {DragEvent} event */
  async #onDrop(event) {
    event.preventDefault();
    const target = event.currentTarget;
    target.classList.remove("gc-drop-target");
    const data = getDropData(event);
    if ( data.type !== "Item" ) return;
    let item;
    try {
      item = await Item.implementation.fromDropData(data);
    } catch {
      return;
    }
    if ( target.dataset.drop === "result" ) {
      // The result is copied onto the crafter's sheet, so it must outlive any one actor: an item from a
      // sheet is replaced by the world or compendium item it came from.
      let source = item;
      if ( itemOrigin(item) === "actor" ) {
        const stats = item._stats ?? {};
        source = await fromUuid(stats.compendiumSource ?? stats.duplicateSource ?? "");
        if ( !source || (itemOrigin(source) === "actor") ) {
          return ui.notifications.warn(game.i18n.localize("GRIDCRAFTER.Errors.ResultFromActor"));
        }
      }
      this.draft.result = toItemRef(source);
      if ( !this.draft.name ) this.draft.name = source.name;
    }
    else {
      if ( !isTypeAllowed(item.type) ) {
        return ui.notifications.warn(game.i18n.localize("GRIDCRAFTER.Errors.TypeNotAllowed", { name: item.name }));
      }
      this.draft.cells[Number(target.dataset.index)] = toItemRef(item);
    }
    this.dirty = true;
    this.render();
  }

  /**
   * Ask before throwing away unsaved edits.
   * @returns {Promise<boolean>}
   */
  async #confirmDiscard() {
    if ( !this.dirty ) return true;
    return foundry.applications.api.DialogV2.confirm({
      window: { title: "GRIDCRAFTER.Editor.Unsaved" },
      content: `<p>${game.i18n.localize("GRIDCRAFTER.Editor.DiscardChanges")}</p>`
    });
  }

  /** @this {RecipeEditorApp} */
  static async #onNew() {
    if ( !(await this.#confirmDiscard()) ) return;
    this.draft = blankRecipe();
    this.dirty = false;
    this.render();
  }

  /** @this {RecipeEditorApp} */
  static async #onSelect(event, target) {
    if ( target.dataset.recipeId === this.draft?.id ) return;
    if ( !(await this.#confirmDiscard()) ) return;
    const recipe = getAllRecipes().find(r => r.id === target.dataset.recipeId);
    if ( !recipe ) return;
    this.draft = foundry.utils.deepClone(recipe);
    this.dirty = false;
    this.render();
  }

  /** @this {RecipeEditorApp} */
  static async #onSave() {
    const draft = this.draft;
    if ( !draft.result ) return ui.notifications.warn(game.i18n.localize("GRIDCRAFTER.Errors.NoResult"));
    if ( !draft.cells.some(Boolean) ) return ui.notifications.warn(game.i18n.localize("GRIDCRAFTER.Errors.NoIngredients"));
    draft.name = draft.name.trim() || draft.result.name;
    const recipes = getWorldRecipes();
    const index = recipes.findIndex(r => r.id === draft.id);
    const saved = { ...foundry.utils.deepClone(draft), source: "world" };
    if ( index >= 0 ) recipes[index] = saved;
    else recipes.push(saved);
    await setWorldRecipes(recipes);
    this.dirty = false;
    this.render();
  }

  /** @this {RecipeEditorApp} */
  static async #onDelete() {
    const draft = this.draft;
    const recipes = getWorldRecipes();
    if ( recipes.some(r => r.id === draft.id) ) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "GRIDCRAFTER.Editor.Delete" },
        content: `<p>${game.i18n.localize("GRIDCRAFTER.Editor.DeleteConfirm", { name: foundry.utils.escapeHTML(draft.name) })}</p>`
      });
      if ( !ok ) return;
      await setWorldRecipes(recipes.filter(r => r.id !== draft.id));
    }
    this.draft = null;
    this.dirty = false;
    this.render();
  }

  /**
   * Copy a recipe another package registered into the world, where it can be edited.
   * @this {RecipeEditorApp}
   */
  static #onCopy() {
    this.draft = { ...foundry.utils.deepClone(this.draft), id: foundry.utils.randomID(), source: "world" };
    this.dirty = true;
    this.render();
  }

  /** @this {RecipeEditorApp} */
  static #onShare() {
    if ( !this.draft.cells.some(Boolean) ) {
      return ui.notifications.warn(game.i18n.localize("GRIDCRAFTER.Errors.NoIngredients"));
    }
    shareRecipe(this.draft);
  }

  /**
   * One Teach window at a time: opening it for another recipe replaces it, unapplied toggles and all.
   * @this {RecipeEditorApp}
   */
  static async #onTeach() {
    await foundry.applications.instances.get(`${MODULE_ID}-teach`)?.close();
    new TeachRecipeApp(this.draft.id).render({ force: true });
  }

  /**
   * Ask for the draft's category. Like every other field it waits for Save.
   * @this {RecipeEditorApp}
   */
  static async #onSetCategory() {
    const options = [...new Set(getAllRecipes().map(r => r.category).filter(Boolean))];
    const content = await foundry.applications.handlebars.renderTemplate(`${TEMPLATE_PATH}/category-dialog.hbs`,
      { value: this.draft.category, max: CATEGORY_MAX, options });
    const data = await foundry.applications.api.DialogV2.input({
      window: { title: "GRIDCRAFTER.Recipe.Category" },
      classes: [MODULE_ID, "gc-app", "gc-category-dialog", `gc-theme-${getTheme()}`],
      content,
      ok: { class: "gc-button" }
    });
    if ( !data ) return;
    let value = String(data.category ?? "").trim().slice(0, CATEGORY_MAX);
    // "armas" typed where "Armas" exists joins the existing category rather than starting a twin.
    value = options.find(o => o.localeCompare(value, undefined, { sensitivity: "base" }) === 0) ?? value;
    if ( value === (this.draft.category ?? "") ) return;
    this.draft.category = value;
    this.#markDirty(true);
  }

  /** @this {RecipeEditorApp} */
  static #onClearCell(event, target) {
    this.draft.cells[Number(target.closest("[data-index]").dataset.index)] = null;
    this.dirty = true;
    this.render();
  }

  /** @this {RecipeEditorApp} */
  static #onClearResult() {
    this.draft.result = null;
    this.dirty = true;
    this.render();
  }
}
