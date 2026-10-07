/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID } from "./constants.js";
import { getRecipe } from "./recipes.js";
import { RecipeRevealApp } from "./apps/recipe-reveal-app.js";

const REVEAL_QUERY = `${MODULE_ID}.reveal`;

/** Called on init: the handler must exist before any query arrives, and before this client sends one. */
export function registerRevealQuery() {
  // Runs on the recipient's client. Players may query each other too (QUERY_USER is a player permission),
  // so only a GM, as the server reports the sender, may open a window on someone's screen.
  CONFIG.queries[REVEAL_QUERY] = async (data, { user }) => {
    if ( !user?.isGM || (typeof data?.id !== "string") ) return false;
    // A package recipe the GM's client registered may be missing here.
    if ( !getRecipe(data.id)?.result ) return false;
    new RecipeRevealApp({ recipeId: data.id }).render({ force: true });
    return true;   // answer at once; the GM doesn't wait for the window
  };
}

/**
 * Reveal a saved recipe to the chosen players, and to this GM as a preview. Only the id travels: each
 * client reads the recipe from its own world setting or package registration, so what is shown is
 * always the recipe as saved.
 * @param {import("./recipes.js").Recipe} recipe
 * @param {string[]} userIds
 */
export async function shareRecipe(recipe, userIds) {
  const users = userIds.map(id => game.users.get(id)).filter(u => u?.active && !u.isGM);
  new RecipeRevealApp({ recipeId: recipe.id }).render({ force: true });
  const answers = await Promise.allSettled(users.map(u => u.query(REVEAL_QUERY, { id: recipe.id }, { timeout: 10 * 1000 })));
  const missed = users.filter((u, i) => (answers[i].status !== "fulfilled") || (answers[i].value !== true));
  if ( missed.length ) ui.notifications.warn(game.i18n.localize("GRIDCRAFTER.Errors.ShareMissed",
    { names: game.i18n.getListFormatter().format(missed.map(u => u.name)) }));
}
