/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

export const MODULE_ID = "grid-crafter";

export const TEMPLATE_PATH = `modules/${MODULE_ID}/templates`;
export const SOUND_PATH = `modules/${MODULE_ID}/assets/sounds`;

// World settings
export const SETTING_RECIPES = "recipes";
export const SETTING_RECIPE_EDITS = "recipeEdits";
export const SETTING_HIDDEN_RECIPES = "hiddenRecipes";
export const SETTING_ALLOWED_TYPES = "allowedTypes";
export const SETTING_QUANTITY_PATH = "quantityPath";
export const SETTING_FAIL_LOSS_CHANCE = "failLossChance";
export const SETTING_THEME = "theme";
export const SETTING_SOUND_VOLUME = "soundVolume";
export const SETTING_SOUND_CRAFT = "soundCraft";
export const SETTING_SOUND_SUCCESS = "soundSuccess";
export const SETTING_SOUND_FAILURE = "soundFailure";
export const SETTING_SOUND_SHARE = "soundShare";

// User flags
export const FLAG_KNOWN_RECIPES = "knownRecipes";

export const CATEGORY_MAX = 24;

export const GRID_SIZE = 3;
export const CELL_COUNT = GRID_SIZE * GRID_SIZE;

export const THEMES = ["forge", "arcane"];
export const SOUND_CUES = {
  craft: SETTING_SOUND_CRAFT,
  success: SETTING_SOUND_SUCCESS,
  failure: SETTING_SOUND_FAILURE,
  share: SETTING_SOUND_SHARE
};
