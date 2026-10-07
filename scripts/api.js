/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { ForgeApp } from "./apps/forge-app.js";
import { RecipeEditorApp } from "./apps/recipe-editor-app.js";
import { getKnownRecipeIds } from "./crafting.js";
import { getCraftingActor } from "./helpers.js";
import { getAllRecipes, getRecipe, registerRecipes, unregisterRecipes } from "./recipes.js";
import { shareRecipe } from "./share.js";

/**
 * Open (or bring forward) a singleton app.
 * @param {typeof foundry.applications.api.ApplicationV2} AppClass
 * @returns {foundry.applications.api.ApplicationV2}
 */
function openApp(AppClass) {
  const existing = foundry.applications.instances.get(AppClass.DEFAULT_OPTIONS.id);
  if ( existing ) {
    existing.render({ force: true });
    existing.bringToFront();
    return existing;
  }
  const app = new AppClass();
  app.render({ force: true });
  return app;
}

/**
 * The public API, exposed as `GridCrafter` and as `game.modules.get("grid-crafter").api`.
 *
 * Packages ship recipes by calling `registerRecipes` from their own `ready` hook (or on the
 * `grid-crafter.ready` hook, which passes this object). Ingredients and results are item uuids,
 * usually from the package's own compendium:
 *
 *   GridCrafter.registerRecipes("my-module", [{
 *     id: "iron-sword",
 *     name: "Iron Sword",
 *     shaped: true,
 *     cells: [
 *       null, "Compendium.my-module.items.Item.ingot0000000000", null,
 *       null, "Compendium.my-module.items.Item.ingot0000000000", null,
 *       null, "Compendium.my-module.items.Item.stick0000000000", null
 *     ],
 *     result: "Compendium.my-module.items.Item.sword0000000000",
 *     quantity: 1,
 *     failLossChance: 25
 *   }]);
 */
export const api = {
  /** Open the crafting table. */
  forge: () => openApp(ForgeApp),

  /** Open the GM's recipe editor. */
  recipes: () => {
    if ( !game.user.isGM ) return ui.notifications.warn(game.i18n.localize("GRIDCRAFTER.Errors.GMOnly"));
    return openApp(RecipeEditorApp);
  },

  registerRecipes,
  unregisterRecipes,

  /** @returns {object[]} every recipe: the world's, then those registered by packages */
  getRecipes: () => foundry.utils.deepClone(getAllRecipes()),

  /**
   * @param {Actor} [actor]   defaults to the current user's crafting actor
   * @returns {string[]} ids of the recipes an actor knows
   */
  getKnownRecipes: (actor = getCraftingActor()) => getKnownRecipeIds(actor),

  /**
   * Show a recipe's pattern to everyone connected, without its result. GM only.
   * @param {string} id
   */
  shareRecipe: id => {
    if ( !game.user.isGM ) return ui.notifications.warn(game.i18n.localize("GRIDCRAFTER.Errors.GMOnly"));
    const recipe = getRecipe(id);
    if ( recipe ) shareRecipe(recipe);
  }
};
