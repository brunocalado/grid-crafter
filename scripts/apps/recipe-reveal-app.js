/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, TEMPLATE_PATH } from "../constants.js";
import { getCraftingActor, getTheme } from "../helpers.js";
import { getLearnedRecipeIds, learnRecipes, reportTaught } from "../crafting.js";
import { CraftFX, animate, runeGlyphs, wait } from "../effects.js";
import { getRecipe } from "../recipes.js";
import { playCue } from "../sound.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * A recipe the GM shared: its pattern revealed cell by cell, then what it makes. A player with a
 * character can learn it from here.
 *
 * Never re-rendered after the first render: a render would put the lit cells back to dark, so Learn
 * patches the DOM instead.
 */
export class RecipeRevealApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} options
   * @param {string} options.recipeId
   */
  constructor({ recipeId, ...options }) {
    super(options);
    this.recipeId = recipeId;
  }

  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "gc-app", "gc-reveal"],
    window: {
      title: "GRIDCRAFTER.Reveal.Title",
      icon: "fa-solid fa-eye",
      resizable: false
    },
    position: { width: 600, height: "auto" },
    actions: {
      learn: RecipeRevealApp.#onLearn
    }
  };

  static PARTS = {
    main: { template: `${TEMPLATE_PATH}/recipe-reveal.hbs` }
  };

  fx = new CraftFX(getTheme());

  /** @override */
  async _prepareContext(options) {
    const theme = getTheme();
    const recipe = getRecipe(this.recipeId);
    const actor = getCraftingActor();
    // A GM sees a preview, and a player without a character has nowhere to write it: neither gets a
    // button or a label.
    const learner = !game.user.isGM && !!actor;
    // A public recipe not learned yet still offers Learn: learning keeps it if it stops being public.
    const known = learner && getLearnedRecipeIds(actor).includes(recipe.id);
    return {
      isArcane: theme === "arcane",
      name: recipe.name || recipe.result.name,
      shaped: recipe.shaped,
      cells: recipe.shaped ? recipe.cells : recipe.cells.filter(Boolean),
      result: recipe.result,
      quantity: recipe.quantity,
      many: recipe.quantity > 1,
      canLearn: learner && !known,
      known,
      controls: learner,
      glyphs: runeGlyphs(24).map((d, i) => ({ d, angle: 15 * i }))
    };
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const theme = getTheme();
    for ( const t of ["forge", "arcane"] ) this.element.classList.toggle(`gc-theme-${t}`, t === theme);
    this.fx.attach(this.element.querySelector(".gc-fx"), theme);
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    playCue("share");
    // Not awaited: the window must finish opening while the cells light up.
    this.#reveal();
  }

  /**
   * Ingredients light up one after another, each with its own small burst; then the arrow, then what
   * the recipe makes, born in its circle; then the way to learn it.
   */
  async #reveal() {
    const el = this.element;
    await wait(350);
    for ( const cell of el.querySelectorAll(".gc-reveal-cell") ) {
      cell.classList.add("gc-lit");
      if ( cell.querySelector("img") ) {
        const { x, y } = this.fx.centerOf(cell);
        this.fx.burst(x, y, { count: 24, speed: 160 });
        await wait(140);
      }
    }
    await wait(150);
    await animate(el.querySelector(".gc-arrow"), [{ opacity: 0 }, { opacity: 1 }], { duration: 350, easing: "ease-out" });
    const slot = el.querySelector(".gc-reveal-result");
    const { x, y } = this.fx.centerOf(slot);
    this.fx.burst(x, y, { kind: getTheme() === "arcane" ? "spiral" : "sparks", count: 60, speed: 320 });
    await animate(slot.querySelector("img"), [
      { transform: "scale(0) rotate(-30deg)", opacity: 0 },
      { transform: "scale(1.35) rotate(6deg)", opacity: 1, offset: 0.55 },
      { transform: "scale(1) rotate(0)", opacity: 1 }
    ], { duration: 900, easing: "cubic-bezier(.2,.9,.3,1.2)" });
    const controls = el.querySelector(".gc-reveal-controls");
    if ( controls ) await animate(controls, [{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: "ease-out" });
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    this.fx.stop();
  }

  /**
   * Write the recipe into the viewer's own recipe book, and swap the button for the line saying so.
   * @this {RecipeRevealApp}
   */
  static async #onLearn(event, button) {
    const actor = getCraftingActor();
    const recipe = getRecipe(this.recipeId);
    if ( !actor || !recipe ) return;
    button.disabled = true;
    if ( (await learnRecipes(actor, [recipe.id])).length ) await reportTaught([recipe], [actor]);
    if ( !this.rendered ) return;
    await animate(button, [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.9)" }],
      { duration: 200, easing: "ease-in" });
    button.remove();
    const known = this.element.querySelector(".gc-reveal-known");
    known.hidden = false;
    animate(known, [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }],
      { duration: 350, easing: "ease-out" });
    const { x, y } = this.fx.centerOf(this.element.querySelector(".gc-reveal-result"));
    this.fx.burst(x, y, { count: 50, speed: 260 });
  }
}
