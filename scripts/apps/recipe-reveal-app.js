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
import { getRecipe, recipeFace } from "../recipes.js";
import { playCue } from "../sound.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * A recipe the GM shared: its pattern revealed cell by cell, then what it makes. A dismantling recipe
 * is shown the same way round as the table: the item in the circle first, then the parts it breaks
 * into. A player with a character can learn it from here.
 *
 * The reveal plays once, on the first render. A later render (a theme change, another variant) skips it
 * and shows the board as it ended; Learn still patches the DOM, so its own animation isn't cut short by
 * a render.
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
      learn: RecipeRevealApp.#onLearn,
      selectVariant: RecipeRevealApp.#onSelectVariant
    }
  };

  static PARTS = {
    main: { template: `${TEMPLATE_PATH}/recipe-reveal.hbs` }
  };

  fx = new CraftFX(getTheme());

  /** Index of the variant the board shows. */
  variant = 0;

  /** The next render shows another variant: its items fade in. */
  #switched = false;

  /** @override */
  async _prepareContext(options) {
    const theme = getTheme();
    const recipe = getRecipe(this.recipeId);
    const dismantling = recipe.kind === "dismantle";
    // The GM may have removed a variant since.
    if ( !dismantling ) this.variant = Math.min(this.variant, recipe.variants.length - 1);
    const variant = dismantling ? null : recipe.variants[this.variant];
    const quantity = dismantling ? recipe.inputQuantity : recipe.quantity;
    const actor = getCraftingActor();
    // A GM sees a preview, and a player without a character has nowhere to write it: neither gets a
    // button or a label.
    const learner = !game.user.isGM && !!actor;
    // A public recipe not learned yet still offers Learn: learning keeps it if it stops being public.
    const known = learner && getLearnedRecipeIds(actor).includes(recipe.id);
    return {
      isArcane: theme === "arcane",
      dismantling,
      name: recipeFace(recipe).name,
      // Where a part lands never matters: a dismantling recipe's parts are a ring, with no note saying so.
      shaped: !dismantling && recipe.shaped,
      cells: dismantling ? recipe.outputs.filter(Boolean) : recipe.shaped ? variant.cells : variant.cells.filter(Boolean),
      // The circle holds what the recipe makes, or what it breaks.
      result: dismantling ? recipe.input : recipe.result,
      requires: dismantling ? recipe.requires : variant.requires,
      // A recipe with one variant shows no dots.
      variants: (recipe.variants?.length > 1) ? recipe.variants.map((v, index) => ({ index, active: index === this.variant,
        label: game.i18n.localize("GRIDCRAFTER.Editor.Variant", { n: index + 1 }) })) : null,
      quantity,
      many: quantity > 1,
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
    // The reveal plays once. A later render (a theme change) shows the board as it ended; the root
    // element survives renders, so the class stays.
    if ( !options.isFirstRender ) this.element.classList.add("gc-revealed");
    if ( this.#switched ) {
      this.#switched = false;
      const items = this.element.querySelectorAll(".gc-reveal-cell > img, .gc-reveal-requires");
      items.forEach((el, i) => el.animate([{ opacity: 0, transform: "translateY(3px)" }, { opacity: 1, transform: "none" }],
        { duration: 180, delay: i * 30, easing: "ease-out", fill: "backwards" }));
    }
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
   * the recipe makes, born in its circle; then the way to learn it. A dismantling recipe runs the
   * other way: the item and its tool first, then the arrow, then the parts.
   */
  async #reveal() {
    // Taken now, not as the sequence reaches them: the root element survives a re-render, so a later
    // query would animate the new, already finished board. These stay with the old one, unseen.
    const el = this.element;
    const dismantling = getRecipe(this.recipeId)?.kind === "dismantle";
    const cells = el.querySelectorAll(".gc-reveal-cell");
    const arrow = el.querySelector(".gc-arrow");
    const slot = el.querySelector(".gc-reveal-result");
    const requires = el.querySelector(".gc-reveal-requires");
    const outro = [el.querySelector(".gc-variants"), el.querySelector(".gc-reveal-controls")].filter(Boolean);
    const lightCells = async () => {
      for ( const cell of cells ) {
        cell.classList.add("gc-lit");
        if ( cell.querySelector("img") ) {
          const { x, y } = this.fx.centerOf(cell);
          this.fx.burst(x, y, { count: 24, speed: 160 });
          await wait(140);
        }
      }
    };
    const showArrow = () => animate(arrow, [{ opacity: 0 }, { opacity: 1 }], { duration: 350, easing: "ease-out" });
    const showItem = async () => {
      const { x, y } = this.fx.centerOf(slot);
      this.fx.burst(x, y, { kind: getTheme() === "arcane" ? "spiral" : "sparks", count: 60, speed: 320 });
      await animate(slot.querySelector("img"), [
        { transform: "scale(0) rotate(-30deg)", opacity: 0 },
        { transform: "scale(1.35) rotate(6deg)", opacity: 1, offset: 0.55 },
        { transform: "scale(1) rotate(0)", opacity: 1 }
      ], { duration: 900, easing: "cubic-bezier(.2,.9,.3,1.2)" });
      if ( requires ) await animate(requires, [{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }],
        { duration: 350, easing: "ease-out" });
    };
    await wait(350);
    if ( dismantling ) {
      await showItem();
      await wait(150);
      await showArrow();
      await lightCells();
    }
    else {
      await lightCells();
      await wait(150);
      await showArrow();
      await showItem();
    }
    await Promise.all(outro.map(node => animate(node, [{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: "ease-out" })));
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    this.fx.stop();
  }

  /**
   * Show another way to make the recipe. The board re-renders finished, without the reveal.
   * @this {RecipeRevealApp}
   */
  static #onSelectVariant(event, target) {
    const index = Number(target.dataset.index);
    if ( index === this.variant ) return;
    this.variant = index;
    this.#switched = true;
    this.render();
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
