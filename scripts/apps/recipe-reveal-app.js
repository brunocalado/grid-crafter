/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, TEMPLATE_PATH } from "../constants.js";
import { getTheme } from "../helpers.js";
import { CraftFX, runeGlyphs, wait } from "../effects.js";
import { playCue } from "../sound.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The pattern of a recipe the GM shared, revealed cell by cell. It never names what the recipe makes.
 */
export class RecipeRevealApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} options
   * @param {boolean} options.shaped
   * @param {({name: string, img: string}|null)[]} options.cells
   */
  constructor({ shaped, cells, ...options }) {
    super(options);
    this.shaped = shaped;
    this.cells = cells;
  }

  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "gc-app", "gc-reveal"],
    window: {
      title: "GRIDCRAFTER.Reveal.Title",
      icon: "fa-solid fa-eye",
      resizable: false
    },
    position: { width: 420, height: "auto" }
  };

  static PARTS = {
    main: { template: `${TEMPLATE_PATH}/recipe-reveal.hbs` }
  };

  fx = new CraftFX(getTheme());

  /** @override */
  async _prepareContext(options) {
    const theme = getTheme();
    return {
      isArcane: theme === "arcane",
      shaped: this.shaped,
      cells: this.shaped ? this.cells : this.cells.filter(Boolean),
      names: [...new Set(this.cells.filter(Boolean).map(c => c.name))],
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

  /** Ingredients light up one after another, each with its own small burst. */
  async #reveal() {
    const cells = [...this.element.querySelectorAll(".gc-reveal-cell")];
    await wait(350);
    for ( const cell of cells ) {
      cell.classList.add("gc-lit");
      if ( cell.querySelector("img") ) {
        const { x, y } = this.fx.centerOf(cell);
        this.fx.burst(x, y, { count: 24, speed: 160 });
        await wait(140);
      }
    }
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    this.fx.stop();
  }
}
