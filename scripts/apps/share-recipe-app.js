/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, TEMPLATE_PATH } from "../constants.js";
import { getTheme } from "../helpers.js";
import { getRecipe } from "../recipes.js";
import { shareRecipe } from "../share.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Which players online see a recipe the GM shares. With tokens selected, their owners start chosen;
 * with none, everyone does.
 */
export class ShareRecipeApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-share`,
    classes: [MODULE_ID, "gc-app", "gc-share"],
    window: {
      title: "GRIDCRAFTER.Share.Title",
      icon: "fa-solid fa-eye",
      resizable: false
    },
    position: { width: 380, height: "auto" },
    actions: {
      share: ShareRecipeApp.#onShare
    }
  };

  static PARTS = {
    main: { template: `${TEMPLATE_PATH}/share-recipe.hbs` }
  };

  /** @param {string} recipeId */
  constructor(recipeId, options = {}) {
    super(options);
    this.recipeId = recipeId;
  }

  /** Every listed user id → whether they receive the reveal. Kept across re-renders. */
  #chosen = new Map();

  #hooks = [];

  /** @override */
  get title() {
    return game.i18n.localize("GRIDCRAFTER.Share.Title", { name: getRecipe(this.recipeId)?.name ?? "" });
  }

  /** @override */
  async _prepareContext(options) {
    const players = game.users.filter(u => u.active && !u.isGM);
    // A player who left drops out of the choice, so Share never reaches someone the GM can't see.
    for ( const id of this.#chosen.keys() ) if ( !players.some(u => u.id === id) ) this.#chosen.delete(id);
    const tokens = canvas.tokens?.controlled.map(t => t.actor).filter(Boolean) ?? [];
    for ( const user of players ) {
      if ( this.#chosen.has(user.id) ) continue;
      this.#chosen.set(user.id, !tokens.length || tokens.some(a => a.testUserPermission(user, "OWNER")));
    }
    const rows = players.map(user => ({
      id: user.id,
      name: user.name,
      img: user.character?.img ?? user.avatar,
      character: user.character?.name ?? "—",
      checked: this.#chosen.get(user.id)
    })).sort((a, b) => a.name.localeCompare(b.name));
    return {
      theme: getTheme(),
      rows,
      any: rows.some(r => r.checked)
    };
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const theme = getTheme();
    for ( const t of ["forge", "arcane"] ) this.element.classList.toggle(`gc-theme-${t}`, t === theme);
    // Toggling only records the choice. A re-render would replace the toggle under the cursor.
    for ( const input of this.element.querySelectorAll(".gc-toggle[data-user-id]") ) {
      input.addEventListener("change", () => {
        this.#chosen.set(input.dataset.userId, input.checked);
        this.element.querySelector(".gc-send").disabled = ![...this.#chosen.values()].some(Boolean);
      });
    }
  }

  /** @override */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    // The list follows who is online. A burst of connections is one render.
    const refresh = foundry.utils.debounce(() => this.render(), 50);
    this.#hooks.push(["userConnected", Hooks.on("userConnected", refresh)]);
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    for ( const [name, id] of this.#hooks ) Hooks.off(name, id);
    this.#hooks = [];
  }

  /** @this {ShareRecipeApp} */
  static async #onShare() {
    const recipe = getRecipe(this.recipeId);
    if ( !recipe ) return ui.notifications.warn(game.i18n.localize("GRIDCRAFTER.Errors.UnknownRecipe", { id: this.recipeId }));
    const userIds = [...this.#chosen].filter(([, on]) => on).map(([id]) => id);
    // Not awaited: a client that never answers would hold this window open until its query times out.
    shareRecipe(recipe, userIds);
    await this.close();
  }
}
