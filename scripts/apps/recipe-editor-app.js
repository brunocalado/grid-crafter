/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { CATEGORY_MAX, MODULE_ID, SETTING_FAIL_LOSS_CHANCE, TEMPLATE_PATH } from "../constants.js";
import {
  bindSearch, filterGroups, getCollapsed, getDropData, getTheme, groupByCategory, isTypeAllowed, itemOrigin, readCaret,
  recipeSearchText, restoreCaret, setCollapsed, toItemRef
} from "../helpers.js";
import {
  blankRecipe, deleteRecipe, getAllRecipes, getHiddenIds, getRecipe, getWorldRecipes, isDiscoverable, restoreRecipe,
  saveRecipe, setRecipeHidden
} from "../recipes.js";
import { ShareRecipeApp } from "./share-recipe-app.js";
import { ForgetRecipeApp, TeachRecipeApp } from "./teach-recipe-app.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * What the GM calls a recipe's source: the world, or the title of the package that registered it.
 * @param {string} source
 * @returns {string}
 */
function sourceLabel(source) {
  if ( source === "world" ) return game.i18n.localize("GRIDCRAFTER.Editor.WorldRecipes");
  return game.modules.get(source)?.title ?? ((game.system.id === source) ? game.system.title : source);
}

/** The list key of the Recipe Book's Hidden group. */
const HIDDEN_GROUP = "::hidden";

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
    // Wide enough for Failure, Discovery and Makes side by side with a usable loss slider.
    position: { width: 1120, height: "auto" },
    actions: {
      newRecipe: RecipeEditorApp.#onNew,
      selectRecipe: RecipeEditorApp.#onSelect,
      saveRecipe: RecipeEditorApp.#onSave,
      deleteRecipe: RecipeEditorApp.#onDelete,
      restoreRecipe: RecipeEditorApp.#onRestore,
      hideRecipe: RecipeEditorApp.#onHide,
      duplicateRecipe: RecipeEditorApp.#onDuplicate,
      shareRecipe: RecipeEditorApp.#onShare,
      teachRecipe: RecipeEditorApp.#onTeach,
      forgetRecipe: RecipeEditorApp.#onForget,
      toggleSelect: RecipeEditorApp.#onToggleSelect,
      setCategory: RecipeEditorApp.#onSetCategory,
      clearCell: RecipeEditorApp.#onClearCell,
      clearResult: RecipeEditorApp.#onClearResult
    }
  };

  static PARTS = {
    main: { template: `${TEMPLATE_PATH}/recipe-editor.hbs`, scrollable: [".gc-recipe-scroll"] }
  };

  /** The recipe being edited: a copy, saved only on demand. */
  draft = null;

  /** Unsaved edits on the draft. */
  dirty = false;

  /** The recipe list's search, as typed. */
  #query = "";

  /** Keys of the list groups the user closed. */
  #collapsed = getCollapsed("editor");

  /** Recipe ids picked while selection mode is on; null while it is off. */
  #selected = null;

  /** @override */
  async _prepareContext(options) {
    const all = getAllRecipes();
    const hiddenIds = getHiddenIds();
    const [hidden, shown] = all.reduce((parts, r) => {
      parts[hiddenIds.has(r.id) ? 0 : 1].push(r);
      return parts;
    }, [[], []]);
    const saved = this.draft ? all.find(r => r.id === this.draft.id) : undefined;
    // With no unsaved edits the draft is the saved recipe, whoever saved it: an API call, another GM.
    // Saving a stale copy would quietly undo their change.
    if ( this.draft && !this.dirty ) {
      if ( saved ) this.draft = foundry.utils.deepClone(saved);
      // Deleted or unregistered elsewhere. A blank new recipe has no source yet and stays.
      else if ( this.draft.source ) this.draft = null;
    }
    if ( !this.draft ) {
      const first = shown[0] ?? all[0];
      this.draft = first ? foundry.utils.deepClone(first) : blankRecipe();
    }
    const draft = this.draft;
    const isNew = !all.some(r => r.id === draft.id);
    const selected = this.#selected;
    // A recipe another package unregistered meanwhile can't be taught.
    if ( selected ) for ( const id of selected ) if ( !all.some(r => r.id === id) ) selected.delete(id);
    // While selecting, a lit row means "selected" and nothing else: the draft's row is lit only if picked.
    const toEntry = r => ({ id: r.id, name: r.name || r.result?.name || "—", img: r.result?.img,
      active: selected ? selected.has(r.id) : r.id === draft.id, search: recipeSearchText(r), public: r.public,
      edited: !!r.edited });
    const groups = Object.entries(Object.groupBy(shown, r => r.source)).map(([source, recipes]) => {
      const group = {
        key: source,
        label: sourceLabel(source),
        count: recipes.length,
        collapsed: this.#collapsed.has(source)
      };
      // A source that never uses categories stays one flat list, with no "Other" heading.
      if ( !recipes.some(r => r.category) ) {
        group.recipes = recipes.map(toEntry);
        return group;
      }
      group.categories = [...groupByCategory(recipes)].map(([category, list]) => {
        const key = `${source}::${category}`;
        return { key, label: category || game.i18n.localize("GRIDCRAFTER.Recipe.CategoryNone"), count: list.length,
          collapsed: this.#collapsed.has(key), recipes: list.map(toEntry) };
      });
      return group;
    });
    // One flat group, last, whatever the sources: a hidden row names where it comes from in its tooltip.
    // Package ids can't contain ":", so the key never clashes with a source.
    if ( hidden.length ) groups.push({
      key: HIDDEN_GROUP,
      label: game.i18n.localize("GRIDCRAFTER.Editor.Hidden"),
      count: hidden.length,
      collapsed: this.#collapsed.has(HIDDEN_GROUP),
      hiddenGroup: true,
      recipes: hidden.map(r => ({ ...toEntry(r), origin: sourceLabel(r.source) }))
    });
    return {
      theme: getTheme(),
      groups,
      query: this.#query,
      draft,
      isNew,
      hidden: hiddenIds.has(draft.id),
      // A blank recipe has no source until it is saved into the world.
      isPackage: !!draft.source && (draft.source !== "world"),
      // As saved, so Restore is offered only for an edit that still exists.
      edited: !!all.find(r => r.id === draft.id)?.edited,
      isPublic: draft.public,
      dirty: this.dirty,
      selecting: !!selected,
      picked: selected?.size ?? 0,
      cells: draft.cells.map((item, index) => ({ index, item })),
      inherit: draft.failLossChance === null,
      lossChance: draft.failLossChance ?? game.settings.get(MODULE_ID, SETTING_FAIL_LOSS_CHANCE),
      discoverInherit: draft.discoverable === null,
      discoverable: isDiscoverable(draft),
      shapeHelp: `<p><strong>${game.i18n.localize("GRIDCRAFTER.Recipe.Shaped")}</strong><br>`
        + `${game.i18n.localize("GRIDCRAFTER.Editor.ShapedHint")}</p>`
        + `<p><strong>${game.i18n.localize("GRIDCRAFTER.Recipe.Shapeless")}</strong><br>`
        + `${game.i18n.localize("GRIDCRAFTER.Editor.ShapelessHint")}</p>`,
      publicHelp: `<p><strong>${game.i18n.localize("GRIDCRAFTER.Recipe.Public")}</strong><br>`
        + `${game.i18n.localize("GRIDCRAFTER.Editor.PublicHint")}</p>`,
      discoveryHelp: `<p><strong>${game.i18n.localize("GRIDCRAFTER.Recipe.Discovery")}</strong><br>`
        + `${game.i18n.localize("GRIDCRAFTER.Editor.DiscoveryHint")}</p>`,
      quantityHelp: `<p><strong>${game.i18n.localize("GRIDCRAFTER.Recipe.Quantity")}</strong><br>`
        + `${game.i18n.localize("GRIDCRAFTER.Editor.QuantityHint")}</p>`
    };
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const theme = getTheme();
    for ( const t of ["forge", "arcane"] ) this.element.classList.toggle(`gc-theme-${t}`, t === theme);
    this.#bindRecipeList();
    for ( const el of this.element.querySelectorAll("[data-drop]") ) {
      el.addEventListener("dblclick", ev => {
        const { drop, index } = ev.currentTarget.dataset;
        const ref = (drop === "result") ? this.draft.result : this.draft.cells[Number(index)];
        if ( ref ) fromUuid(ref.uuid).then(item => item?.sheet?.render({ force: true }));
      });
    }
    // Typing only updates the draft. Re-rendering on every change would replace the Save button under
    // the cursor while a click on it is in progress, and the click would be lost.
    for ( const input of this.element.querySelectorAll(".gc-recipe-fields [name]") ) {
      input.addEventListener("input", this.#onFieldInput.bind(this));
    }
    for ( const el of this.element.querySelectorAll("[data-drop]") ) {
      el.addEventListener("dragover", ev => {
        ev.preventDefault();
        ev.currentTarget.classList.add("gc-drop-target");
      });
      el.addEventListener("dragleave", ev => ev.currentTarget.classList.remove("gc-drop-target"));
      el.addEventListener("drop", this.#onDrop.bind(this));
    }
  }

  /** @override */
  _preSyncPartState(partId, newElement, priorElement, state) {
    super._preSyncPartState(partId, newElement, priorElement, state);
    state.caret = readCaret(priorElement);
  }

  /** @override */
  _syncPartState(partId, newElement, priorElement, state) {
    super._syncPartState(partId, newElement, priorElement, state);   // focuses the field first
    restoreCaret(newElement, state.caret);
  }

  /**
   * Wire the search and the folding groups, and reapply the search a re-render would otherwise drop.
   */
  #bindRecipeList() {
    const list = this.element.querySelector(".gc-recipe-list");
    const apply = () => {
      filterGroups(list, { query: this.#query, collapsed: this.#collapsed });
      // Whether a group is fully picked depends on what the search shows.
      if ( this.#selected ) this.#paintSelection();
    };
    bindSearch(list.querySelector("input[name=search]"), query => {
      this.#query = query;
      apply();
    });
    for ( const group of list.querySelectorAll("details.gc-group") ) {
      group.addEventListener("toggle", () => {
        // While searching, groups are opened by the filter, not by the user.
        if ( this.#query.trim() ) return;
        if ( group.open ) this.#collapsed.delete(group.dataset.group);
        else this.#collapsed.add(group.dataset.group);
        setCollapsed("editor", this.#collapsed);
      });
      // While selecting, a head picks its group as far as the search shows it; only the chevron folds.
      group.querySelector(":scope > summary").addEventListener("click", ev => {
        if ( !this.#selected || ev.target.closest(".gc-chevron") ) return;
        ev.preventDefault();
        const ids = [...group.querySelectorAll("li:not([hidden]) [data-recipe-id]")].map(b => b.dataset.recipeId);
        const all = ids.every(id => this.#selected.has(id));
        for ( const id of ids ) {
          if ( all ) this.#selected.delete(id);
          else this.#selected.add(id);
        }
        this.#paintSelection();
      });
    }
    apply();
  }

  /**
   * Show the selection on the rows, the group heads and the footer. Patched, never rendered: a render
   * under the cursor eats the click.
   */
  #paintSelection() {
    const selected = this.#selected;
    const isPicked = li => selected.has(li.querySelector("[data-recipe-id]").dataset.recipeId);
    for ( const entry of this.element.querySelectorAll(".gc-recipe-entry") ) {
      entry.classList.toggle("gc-active", selected.has(entry.dataset.recipeId));
    }
    for ( const group of this.element.querySelectorAll("details.gc-group") ) {
      const entries = [...group.querySelectorAll("li[data-search]")];
      const picked = entries.filter(isPicked).length;
      const visible = entries.filter(li => !li.hidden);
      // Its own element: filterGroups rewrites .gc-group-count on every search.
      const counter = group.querySelector(":scope > summary .gc-group-picked");
      counter.hidden = !picked;
      counter.textContent = `${picked}/${entries.length}`;
      group.classList.toggle("gc-all-picked", visible.length > 0 && visible.every(isPicked));
    }
    for ( const count of this.element.querySelectorAll(".gc-picked-count") ) {
      count.textContent = String(selected.size);
      count.closest("button").disabled = !selected.size;
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
      case "public":
        draft.public = input.checked;
        break;
      case "discoverInherit":
        draft.discoverable = input.checked ? null : isDiscoverable(draft);
        return this.#markDirty(true);
      case "discoverable":
        draft.discoverable = input.checked;
        this.element.querySelector(".gc-discovery-value").textContent =
          game.i18n.localize(input.checked ? "GRIDCRAFTER.Recipe.Yes" : "GRIDCRAFTER.Recipe.No");
        break;
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
    if ( this.#selected ) {
      const id = target.dataset.recipeId;
      if ( !this.#selected.delete(id) ) this.#selected.add(id);
      return this.#paintSelection();
    }
    if ( target.dataset.recipeId === this.draft?.id ) return;
    if ( !(await this.#confirmDiscard()) ) return;
    const recipe = getAllRecipes().find(r => r.id === target.dataset.recipeId);
    if ( !recipe ) return;
    // A recipe picked through a search must not vanish into a closed group once the search is cleared.
    this.#reveal(getHiddenIds().has(recipe.id) ? [HIDDEN_GROUP] : this.#groupKeys(recipe));
    this.draft = foundry.utils.deepClone(recipe);
    this.dirty = false;
    this.render();
  }

  /**
   * The keys of the groups a visible recipe sits in: its source, and its category within it.
   * @param {Recipe} recipe
   * @returns {string[]}
   */
  #groupKeys(recipe) {
    return [recipe.source, `${recipe.source}::${recipe.category}`];
  }

  /**
   * Reopen the groups a row sits in, so it doesn't land in a closed one.
   * @param {string[]} keys
   */
  #reveal(keys) {
    if ( !keys.some(k => this.#collapsed.has(k)) ) return;
    for ( const k of keys ) this.#collapsed.delete(k);
    setCollapsed("editor", this.#collapsed);
  }

  /**
   * Move the recipe to the Hidden group or back to its own. List organisation only, so it neither
   * waits for Save nor touches unsaved edits; the setting's change renders.
   * @this {RecipeEditorApp}
   */
  static async #onHide() {
    // Grouped as saved: the draft may hold an unsaved category.
    const recipe = getRecipe(this.draft.id);
    if ( !recipe ) return;
    const hide = !getHiddenIds().has(recipe.id);
    this.#reveal(hide ? [HIDDEN_GROUP] : this.#groupKeys(recipe));
    await setRecipeHidden(recipe.id, hide);
  }

  /** @this {RecipeEditorApp} */
  static async #onSave() {
    const draft = this.draft;
    if ( !draft.result ) return ui.notifications.warn(game.i18n.localize("GRIDCRAFTER.Errors.NoResult"));
    if ( !draft.cells.some(Boolean) ) return ui.notifications.warn(game.i18n.localize("GRIDCRAFTER.Errors.NoIngredients"));
    draft.name = draft.name.trim() || draft.result.name;
    await saveRecipe(draft);
    // Read back, so a package recipe's draft carries `edited` and the footer offers Restore.
    this.draft = foundry.utils.deepClone(getRecipe(draft.id));
    this.dirty = false;
    this.render();
  }

  /**
   * Delete a world recipe, or discard a new one. A package recipe has no Delete: the package registers
   * it again on every load.
   * @this {RecipeEditorApp}
   */
  static async #onDelete() {
    const draft = this.draft;
    if ( getWorldRecipes().some(r => r.id === draft.id) ) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "GRIDCRAFTER.Editor.Delete" },
        content: `<p>${game.i18n.localize("GRIDCRAFTER.Editor.DeleteConfirm", { name: foundry.utils.escapeHTML(draft.name) })}</p>`
      });
      if ( !ok ) return;
      await deleteRecipe(draft.id);
    }
    this.draft = null;
    this.dirty = false;
    this.render();
  }

  /**
   * Bring back the version of a package recipe its package ships. The confirmation covers unsaved
   * edits too.
   * @this {RecipeEditorApp}
   */
  static async #onRestore() {
    // Named as saved: the draft may hold an unsaved name.
    const saved = getRecipe(this.draft.id);
    // Its package unregistered it meanwhile: the render drops the draft, or hides Restore if it is dirty.
    if ( !saved ) return this.render();
    const { id, name, source } = saved;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "GRIDCRAFTER.Editor.Restore" },
      content: `<p>${game.i18n.localize("GRIDCRAFTER.Editor.RestoreConfirm", {
        name: foundry.utils.escapeHTML(name), source: foundry.utils.escapeHTML(sourceLabel(source)) })}</p>`
    });
    if ( !ok ) return;
    await restoreRecipe(id);
    this.draft = foundry.utils.deepClone(getRecipe(id));
    this.dirty = false;
    this.render();
  }

  /**
   * Start a world recipe from the draft, unsaved edits included. It owes nothing to the original,
   * so it outlives a package that is disabled.
   * @this {RecipeEditorApp}
   */
  static #onDuplicate() {
    this.draft = { ...foundry.utils.deepClone(this.draft), id: foundry.utils.randomID(), source: "world" };
    delete this.draft.edited;
    this.dirty = true;
    this.render();
  }

  /**
   * Only the saved recipe is shared: every client reads it by id, and Learn will teach that one. One
   * Share window at a time, like Teach.
   * @this {RecipeEditorApp}
   */
  static async #onShare() {
    if ( this.dirty ) return ui.notifications.warn(game.i18n.localize("GRIDCRAFTER.Errors.SaveBeforeSharing"));
    if ( !game.users.some(u => u.active && !u.isGM) ) {
      return ui.notifications.warn(game.i18n.localize("GRIDCRAFTER.Errors.NoPlayersOnline"));
    }
    await foundry.applications.instances.get(`${MODULE_ID}-share`)?.close();
    new ShareRecipeApp(this.draft.id).render({ force: true });
  }

  /**
   * The recipes Teach and Forget act on: the selection while selecting, otherwise the draft.
   * @returns {string[]}
   */
  get #targets() {
    return this.#selected ? [...this.#selected] : [this.draft.id];
  }

  /**
   * One Teach window at a time: opening it for other recipes replaces it, unapplied toggles and all.
   * @this {RecipeEditorApp}
   */
  static async #onTeach() {
    await foundry.applications.instances.get(`${MODULE_ID}-teach`)?.close();
    new TeachRecipeApp(this.#targets).render({ force: true });
  }

  /**
   * One Forget window at a time, like Teach.
   * @this {RecipeEditorApp}
   */
  static async #onForget() {
    await foundry.applications.instances.get(`${MODULE_ID}-forget`)?.close();
    new ForgetRecipeApp(this.#targets).render({ force: true });
  }

  /**
   * Turn selection mode on or off. The draft stays as it is, unsaved edits and all, and is back when
   * the mode ends.
   * @this {RecipeEditorApp}
   */
  static async #onToggleSelect() {
    // The panes behind the list fade while selecting. The render replaces them, so they are animated
    // from the opacity the old ones had to the one the new ones take.
    const panes = () => this.element.querySelectorAll(".gc-recipe-detail > :not(.gc-editor-controls)");
    const from = getComputedStyle(panes()[0]).opacity;
    if ( this.#selected ) this.#selected = null;
    else {
      this.#selected = new Set();
      if ( getAllRecipes().some(r => r.id === this.draft.id) ) this.#selected.add(this.draft.id);
    }
    await this.render();
    for ( const pane of panes() ) {
      pane.animate({ opacity: [from, getComputedStyle(pane).opacity] }, { duration: 150, easing: "ease-out" });
    }
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
