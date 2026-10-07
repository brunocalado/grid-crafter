/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, TEMPLATE_PATH } from "../constants.js";
import { forgetRecipe, getLearnedRecipeIds, learnRecipe, reportTaught } from "../crafting.js";
import { getTheme } from "../helpers.js";
import { getRecipe } from "../recipes.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Who knows one recipe, for the GM to change. Lists the selected tokens' actors, or with nothing
 * selected the users' assigned characters: the actors that actually forge.
 */
export class TeachRecipeApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-teach`,
    classes: [MODULE_ID, "gc-app", "gc-teach"],
    window: {
      title: "GRIDCRAFTER.Teach.Title",
      icon: "fa-solid fa-graduation-cap",
      resizable: false
    },
    position: { width: 380, height: "auto" },
    actions: {
      apply: TeachRecipeApp.#onApply,
      showCharacters: TeachRecipeApp.#onShowCharacters
    }
  };

  static PARTS = {
    main: { template: `${TEMPLATE_PATH}/teach-recipe.hbs` }
  };

  /** @param {string} recipeId */
  constructor(recipeId, options = {}) {
    super(options);
    this.recipeId = recipeId;
  }

  /** Toggles flipped and not applied yet: actor uuid → whether it should know the recipe. */
  pending = new Map();

  /** The actors on screen, by uuid, as of the last render. Apply writes to these and no others. */
  #listed = new Map();

  #hooks = [];

  /** @override */
  get title() {
    return game.i18n.localize("GRIDCRAFTER.Teach.Title", { name: getRecipe(this.recipeId)?.name ?? "" });
  }

  /** @override */
  async _prepareContext(options) {
    const tokens = canvas.tokens?.controlled.map(t => t.actor).filter(Boolean) ?? [];
    const fromTokens = tokens.length > 0;
    const actors = fromTokens ? tokens : game.users.map(u => u.character).filter(Boolean);
    // One row per actor: two linked tokens of Thorin, or two users sharing a character, are one row.
    this.#listed = new Map(actors.map(a => [a.uuid, a]));
    // A change to a row that is gone is dropped, so Apply never writes to something the GM can't see.
    for ( const uuid of this.pending.keys() ) if ( !this.#listed.has(uuid) ) this.pending.delete(uuid);
    const rows = [...this.#listed.values()].map(actor => ({
      uuid: actor.uuid,
      name: actor.name,
      img: actor.img,
      // Non-GM owners, so the GM can tell whose character it is. An NPC token usually has none.
      players: game.users.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER")).map(u => u.name).join(", "),
      // Real learning only: a public recipe the actor never learned shows off, and teaching it is
      // what keeps it once the recipe stops being public.
      checked: this.pending.get(actor.uuid) ?? getLearnedRecipeIds(actor).includes(this.recipeId)
    })).sort((a, b) => a.name.localeCompare(b.name));
    return {
      theme: getTheme(),
      fromTokens,
      rows,
      dirty: this.pending.size > 0
    };
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const theme = getTheme();
    for ( const t of ["forge", "arcane"] ) this.element.classList.toggle(`gc-theme-${t}`, t === theme);
    // Toggling only records the change. A re-render would replace the toggle under the cursor.
    for ( const input of this.element.querySelectorAll(".gc-toggle[data-uuid]") ) {
      input.addEventListener("change", () => {
        const { uuid } = input.dataset;
        const knows = getLearnedRecipeIds(this.#listed.get(uuid)).includes(this.recipeId);
        if ( input.checked === knows ) this.pending.delete(uuid);
        else this.pending.set(uuid, input.checked);
        this.element.querySelector(".gc-apply").disabled = this.pending.size === 0;
      });
    }
  }

  /** @override */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    // Releasing five tokens fires controlToken five times; one render covers them all.
    const refresh = foundry.utils.debounce(() => this.render(), 50);
    // The list follows the canvas selection.
    this.#hooks.push(["controlToken", Hooks.on("controlToken", refresh)]);
    // A player may forge the recipe while the window is open.
    this.#hooks.push(["updateActor", Hooks.on("updateActor", actor => this.#listed.has(actor.uuid) && refresh())]);
    // A character was assigned or unassigned.
    this.#hooks.push(["updateUser", Hooks.on("updateUser", refresh)]);
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    for ( const [name, id] of this.#hooks ) Hooks.off(name, id);
    this.#hooks = [];
  }

  /** @this {TeachRecipeApp} */
  static #onShowCharacters() {
    canvas.tokens?.releaseAll();   // the controlToken hook re-renders with the characters
  }

  /**
   * Write every change, whisper one message for those who learned, and close.
   * @this {TeachRecipeApp}
   */
  static async #onApply() {
    const recipe = getRecipe(this.recipeId);
    if ( !recipe ) return ui.notifications.warn(game.i18n.localize("GRIDCRAFTER.Errors.UnknownRecipe", { id: this.recipeId }));
    const changes = [...this.pending].map(([uuid, knows]) => ({ actor: this.#listed.get(uuid), knows }));
    // Separate writes, not one batch: a synthetic actor's flag lives on its token's ActorDelta, a
    // different document type and parent from a world actor's.
    const done = await Promise.all(changes.map(({ actor, knows }) =>
      (knows ? learnRecipe(actor, recipe.id) : forgetRecipe(actor, recipe.id))));
    const learners = changes.filter((c, i) => c.knows && done[i]).map(c => c.actor);
    if ( learners.length ) await reportTaught(recipe, learners);
    this.pending.clear();
    await this.close();
  }
}
