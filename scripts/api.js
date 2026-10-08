/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { ForgeApp } from "./apps/forge-app.js";
import { RecipeEditorApp } from "./apps/recipe-editor-app.js";
import { forgetRecipes, getKnownRecipeIds, learnRecipes } from "./crafting.js";
import { getCraftingActor, toActor } from "./helpers.js";
import {
  getAllRecipes, getCategories, getRecipe, normalizeCategories, registerRecipes, saveRecipe, unregisterRecipes
} from "./recipes.js";
import { shareRecipe } from "./share.js";

/**
 * Warn the caller and refuse.
 * @returns {false}
 */
function warn(key, data) {
  ui.notifications.warn(game.i18n.localize(`GRIDCRAFTER.Errors.${key}`, data));
  return false;
}

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
 *     categories: ["Smithing", "Weapons"],
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
  getRecipes: () => getAllRecipes().map(r => foundry.utils.deepClone(r)),

  /**
   * Make a recipe public (every character knows it) or private again. GM only. On a package recipe
   * this is an edit like any other: the recipe stops following the package until the GM restores
   * it. Characters who learned it keep it either way.
   * @param {string} id
   * @param {boolean} [value=true]
   * @returns {Promise<boolean>} false when the call was refused (with a warning)
   */
  setRecipePublic: async (id, value = true) => {
    if ( !game.user.isGM ) return warn("GMOnly");
    const recipe = getRecipe(id);
    if ( !recipe ) return warn("UnknownRecipe", { id });
    await saveRecipe({ ...recipe, public: !!value });
    return true;
  },

  /**
   * @param {string} id
   * @returns {boolean} whether every character knows the recipe; false for an unknown id
   */
  isRecipePublic: id => !!getRecipe(id)?.public,

  /** @returns {string[]} every category some recipe uses, alphabetically */
  getCategories,

  /**
   * Replace the categories a recipe is listed under. A name not in use yet starts a new category;
   * an empty list leaves the recipe uncategorised. GM only. On a package recipe this is an edit like
   * any other, as with setRecipePublic.
   * @param {string} id
   * @param {string[]} categories
   * @returns {Promise<boolean>} false when the call was refused (with a warning)
   */
  setRecipeCategories: async (id, categories) => {
    if ( !game.user.isGM ) return warn("GMOnly");
    const recipe = getRecipe(id);
    if ( !recipe ) return warn("UnknownRecipe", { id });
    if ( !Array.isArray(categories) || !categories.every(c => typeof c === "string") ) return warn("CategoriesNotList");
    await saveRecipe({ ...recipe, categories: normalizeCategories(categories) });
    return true;
  },

  /**
   * @param {Actor|TokenDocument|Token|string} [target]   defaults to the current user's crafting actor
   * @returns {string[]} ids of the recipes an actor knows: those it learned, plus every public one
   */
  getKnownRecipes: (target = getCraftingActor()) => getKnownRecipeIds(toActor(target)),

  /**
   * Add a recipe to an actor's book without forging it. The caller must own the actor; a GM owns
   * every actor, and a player can teach their own character, from a macro for instance.
   * @param {Actor|TokenDocument|Token|string} target
   * @param {string} id
   * @returns {Promise<boolean>} true when the actor learned it; false when it already knew it or
   *   the call was refused (with a warning)
   */
  teachRecipe: async (target, id) => {
    const actor = toActor(target);
    if ( !actor ) return warn("NotAnActor");
    if ( !actor.isOwner ) return warn("NotOwner", { name: actor.name });
    if ( !getRecipe(id) ) return warn("UnknownRecipe", { id });
    return (await learnRecipes(actor, [id])).length > 0;
  },

  /**
   * Remove a recipe from an actor's book. The caller must own the actor.
   * @param {Actor|TokenDocument|Token|string} target
   * @param {string} id
   * @returns {Promise<boolean>} true when the actor forgot it; false when it didn't know it or the
   *   call was refused (with a warning)
   */
  forgetRecipe: async (target, id) => {
    const actor = toActor(target);
    if ( !actor ) return warn("NotAnActor");
    if ( !actor.isOwner ) return warn("NotOwner", { name: actor.name });
    return (await forgetRecipes(actor, [id])).length > 0;
  },

  /**
   * Show a recipe's pattern to players online, without its result, and to the calling GM. GM only.
   * @param {string} id
   * @param {string[]} [userIds]   defaults to every player online
   * @returns {Promise<false|undefined>} false when the call was refused (with a warning); otherwise settles
   *   once every chosen player answered, and a player who didn't is named in a warning
   */
  shareRecipe: async (id, userIds) => {
    if ( !game.user.isGM ) return warn("GMOnly");
    const recipe = getRecipe(id);
    if ( !recipe ) return warn("UnknownRecipe", { id });
    if ( (userIds !== undefined) && !(Array.isArray(userIds) && userIds.every(u => typeof u === "string")) ) {
      return warn("UserIdsNotList");
    }
    return shareRecipe(recipe, userIds ?? game.users.filter(u => u.active && !u.isGM).map(u => u.id));
  }
};
