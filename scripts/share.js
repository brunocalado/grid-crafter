/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { CELL_COUNT, SOCKET_EVENT } from "./constants.js";
import { RecipeRevealApp } from "./apps/recipe-reveal-app.js";

/**
 * Show a recipe's ingredients and their places to everyone connected. The result and the recipe's name
 * are left out on purpose: the GM describes what it makes, and the players have to remember the pattern.
 * @param {import("./recipes.js").Recipe} recipe
 */
export function shareRecipe(recipe) {
  const payload = {
    type: "share",
    shaped: recipe.shaped,
    cells: recipe.cells.map(c => (c ? { name: c.name, img: c.img } : null))
  };
  game.socket.emit(SOCKET_EVENT, payload);
  onSocketMessage(payload);
}

/**
 * Socket payloads arrive from other clients, so they are checked before anything reaches the DOM.
 * @param {object} data
 */
export function onSocketMessage(data) {
  if ( data?.type !== "share" ) return;
  if ( !Array.isArray(data.cells) || (data.cells.length !== CELL_COUNT) ) return;
  const cells = data.cells.map(c => ((c && (typeof c.img === "string") && (typeof c.name === "string"))
    ? { name: c.name, img: c.img } : null));
  new RecipeRevealApp({ shaped: data.shaped !== false, cells }).render({ force: true });
}
