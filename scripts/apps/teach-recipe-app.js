/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, TEMPLATE_PATH } from "../constants.js";
import { forgetRecipes, getLearnedRecipeIds, learnRecipes, reportTaught } from "../crafting.js";
import { getTheme } from "../helpers.js";
import { getRecipe } from "../recipes.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Teach one or more recipes to the actors the GM switches on. Lists the selected tokens' actors, or
 * with nothing selected the users' assigned characters: the actors that actually forge. It only ever
 * adds: forgetting is ForgetRecipeApp, so a toggle never means both.
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

  /** "teach" adds what an actor is missing; "forget" removes what it learned. */
  static MODE = "teach";

  /** @param {string[]} recipeIds */
  constructor(recipeIds, options = {}) {
    super(options);
    this.recipeIds = recipeIds;
  }

  /** Uuids of the actors switched on and not applied yet. Every toggle starts off. */
  pending = new Set();

  /** The actors on screen, by uuid, as of the last render. Apply writes to these and no others. */
  #listed = new Map();

  #hooks = [];

  get #forgetting() {
    return this.constructor.MODE === "forget";
  }

  /** @param {string} key   a string under this mode's own section of lang/ */
  #localize(key, data) {
    return game.i18n.localize(`GRIDCRAFTER.${this.#forgetting ? "Forget" : "Teach"}.${key}`, data);
  }

  /** @override */
  get title() {
    if ( this.recipeIds.length > 1 ) return this.#localize("TitleMany", { count: this.recipeIds.length });
    return this.#localize("Title", { name: getRecipe(this.recipeIds[0])?.name ?? "" });
  }

  /** @override */
  async _prepareContext(options) {
    const forgetting = this.#forgetting;
    const tokens = canvas.tokens?.controlled.map(t => t.actor).filter(Boolean) ?? [];
    const fromTokens = tokens.length > 0;
    const actors = fromTokens ? tokens : game.users.map(u => u.character).filter(Boolean);
    const n = this.recipeIds.length;
    const rows = [];
    this.#listed.clear();
    // One row per actor: two linked tokens of Thorin, or two users sharing a character, are one row.
    for ( const actor of new Map(actors.map(a => [a.uuid, a])).values() ) {
      // Real learning only: a public recipe the actor never learned counts as missing, and teaching
      // it is what keeps it once the recipe stops being public.
      const learned = getLearnedRecipeIds(actor);
      const k = this.recipeIds.filter(id => learned.includes(id)).length;
      // Forget lists only who has something to forget. Teach lists everyone, and who already learned
      // every recipe shows on and locked.
      if ( forgetting && !k ) continue;
      const done = !forgetting && (k === n);
      this.#listed.set(actor.uuid, actor);
      if ( done ) this.pending.delete(actor.uuid);
      rows.push({
        uuid: actor.uuid,
        name: actor.name,
        img: actor.img,
        // Non-GM owners, so the GM can tell whose character it is. An NPC token usually has none.
        players: game.users.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER")).map(u => u.name).join(", "),
        checked: done || this.pending.has(actor.uuid),
        disabled: done,
        count: ((n > 1) && (k > 0) && (forgetting || (k < n))) ? `${k}/${n}` : ""
      });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    // A row that is gone takes its toggle with it, so Apply never writes to something the GM can't see.
    for ( const uuid of this.pending ) if ( !this.#listed.has(uuid) ) this.pending.delete(uuid);
    return {
      theme: getTheme(),
      fromTokens,
      rows,
      empty: this.#localize("Empty"),
      apply: {
        label: this.#localize("Apply"),
        icon: forgetting ? "fa-eraser" : "fa-graduation-cap",
        danger: forgetting
      },
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
        if ( input.checked ) this.pending.add(input.dataset.uuid);
        else this.pending.delete(input.dataset.uuid);
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
    // A player may forge a recipe while the window is open. In Forget, an actor that wasn't listed
    // because it had learned nothing may have just learned one.
    this.#hooks.push(["updateActor", Hooks.on("updateActor", (actor, changes) => {
      if ( this.#listed.has(actor.uuid) || foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`) ) refresh();
    })]);
    // A character was assigned or unassigned.
    this.#hooks.push(["updateUser", Hooks.on("updateUser", refresh)]);
    // A deleted actor takes its row with it. An unlinked token's actor goes with its token, and a
    // controlled token leaving the canvas is already caught by controlToken.
    this.#hooks.push(["deleteActor", Hooks.on("deleteActor", actor => this.#listed.has(actor.uuid) && refresh())]);
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
   * Write every change and close. Teaching whispers one message for those who learned; forgetting
   * posts nothing.
   * @this {TeachRecipeApp}
   */
  static async #onApply() {
    // Something deleted since the last render is skipped: writing to it would throw and stop the rest.
    const actors = [...this.pending].map(uuid => this.#listed.get(uuid))
      .filter(actor => foundry.utils.fromUuidSync(actor.uuid, { strict: false }));
    // One write per actor with every recipe in it, and separate writes per actor, not one batch: a
    // synthetic actor's flag lives on its token's ActorDelta, a different document type and parent
    // from a world actor's.
    if ( this.#forgetting ) {
      // A recipe deleted since the window opened is still forgotten.
      await Promise.all(actors.map(actor => forgetRecipes(actor, this.recipeIds)));
    }
    else {
      const recipes = this.recipeIds.map(id => getRecipe(id)).filter(Boolean);
      if ( !recipes.length ) {
        return ui.notifications.warn(game.i18n.localize("GRIDCRAFTER.Errors.UnknownRecipe", { id: this.recipeIds[0] }));
      }
      const ids = recipes.map(r => r.id);
      const added = await Promise.all(actors.map(actor => learnRecipes(actor, ids)));
      const learners = actors.filter((a, i) => added[i].length);
      const taught = recipes.filter(r => added.some(list => list.includes(r.id)));
      if ( learners.length ) await reportTaught(taught, learners);
    }
    this.pending.clear();
    await this.close();
  }
}

/**
 * Make the actors the GM switches on forget one or more recipes. Lists only the actors that learned
 * at least one of them.
 */
export class ForgetRecipeApp extends TeachRecipeApp {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-forget`,
    classes: ["gc-forget"],
    window: { title: "GRIDCRAFTER.Forget.Title", icon: "fa-solid fa-eraser" }
  };

  static MODE = "forget";
}
