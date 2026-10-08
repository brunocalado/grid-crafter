/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import {
  MODULE_ID, SETTING_ALLOWED_TYPES, SETTING_DISCOVERY, SETTING_FAIL_LOSS_CHANCE, SETTING_HIDDEN_RECIPES, SETTING_QUANTITY_PATH,
  SETTING_RECIPE_EDITS, SETTING_RECIPES,
  SETTING_SOUND_CRAFT, SETTING_SOUND_FAILURE, SETTING_SOUND_SHARE, SETTING_SOUND_SUCCESS, SETTING_SOUND_VOLUME,
  SETTING_THEME
} from "./constants.js";
import { ItemTypesConfig } from "./apps/item-types-config.js";
import { RecipeEditorApp } from "./apps/recipe-editor-app.js";
import { SoundConfig } from "./apps/sound-config.js";

/**
 * Where each system keeps an item's quantity, used as the setting's default. Taken from the presets
 * Canvas Loot ships for the same systems. An empty path means the system has no quantity: items
 * are used up whole. Systems not listed default to the common `system.quantity`.
 */
const QUANTITY_PRESETS = {
  "alienrpg": "system.attributes.quantity.value",
  "band-of-blades": "",
  "blades-in-the-dark": "",
  "cairn2e": "system.value",
  "crucible": "system.quantity",
  "daggerheart": "system.quantity",
  "dnd5e": "system.quantity",
  "draw-steel": "system.quantity",
  "dungeonworld": "system.quantity",
  "household": "system.quantity",
  "icrpgme": "",
  "pbta": "system.quantity",
  "pf2e": "system.quantity",
  "scum-and-villainy": "",
  "sf2e": "system.quantity",
  "swade": "system.quantity",
  "tormenta20": "system.qtd",
  "twodsix": "system.quantity",
  "vagabond": "system.quantity",
  "wod5e": "system.quantity",
  "worldbuilding": "system.quantity"
};

export function registerSettings() {
  game.settings.registerMenu(MODULE_ID, "recipeEditor", {
    name: "GRIDCRAFTER.Settings.RecipeEditor.Name",
    label: "GRIDCRAFTER.Settings.RecipeEditor.Label",
    hint: "GRIDCRAFTER.Settings.RecipeEditor.Hint",
    icon: "fa-solid fa-scroll-old",
    type: RecipeEditorApp,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "itemTypes", {
    name: "GRIDCRAFTER.Settings.ItemTypes.Name",
    label: "GRIDCRAFTER.Settings.ItemTypes.Label",
    hint: "GRIDCRAFTER.Settings.ItemTypes.Hint",
    icon: "fa-solid fa-filter",
    type: ItemTypesConfig,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "sounds", {
    name: "GRIDCRAFTER.Settings.Sounds.Name",
    label: "GRIDCRAFTER.Settings.Sounds.Label",
    hint: "GRIDCRAFTER.Settings.Sounds.Hint",
    icon: "fa-solid fa-volume-high",
    type: SoundConfig,
    restricted: true
  });

  // Players' forges list public recipes and match the GM's edits, so they follow a change at once.
  // Not every module app: a revealed recipe's window shows the recipe as it was shared, and a recipe
  // edit has no reason to touch it (a render would only skip it to its finished board).
  const rerenderRecipeViews = () => {
    for ( const id of [`${MODULE_ID}-forge`, `${MODULE_ID}-recipe-editor`, `${MODULE_ID}-teach`, `${MODULE_ID}-forget`] ) {
      foundry.applications.instances.get(id)?.render();
    }
  };

  game.settings.register(MODULE_ID, SETTING_RECIPES, {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: rerenderRecipeViews
  });

  // The GM's version of a package recipe, keyed by its id. It replaces the package's version until
  // the GM restores it. Edits of a package that is not active are never looked up.
  game.settings.register(MODULE_ID, SETTING_RECIPE_EDITS, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: rerenderRecipeViews
  });

  // Ids the GM moved to the Recipe Book's Hidden group. Only the editor shows it.
  game.settings.register(MODULE_ID, SETTING_HIDDEN_RECIPES, {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: () => foundry.applications.instances.get(`${MODULE_ID}-recipe-editor`)?.render()
  });

  game.settings.register(MODULE_ID, SETTING_ALLOWED_TYPES, {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  game.settings.register(MODULE_ID, SETTING_THEME, {
    name: "GRIDCRAFTER.Settings.Theme.Name",
    hint: "GRIDCRAFTER.Settings.Theme.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      forge: "GRIDCRAFTER.Theme.forge",
      arcane: "GRIDCRAFTER.Theme.arcane"
    },
    default: "forge",
    onChange: () => {
      for ( const app of foundry.applications.instances.values() ) {
        if ( app.options.classes.includes(MODULE_ID) ) app.render();
      }
    }
  });

  game.settings.register(MODULE_ID, SETTING_QUANTITY_PATH, {
    name: "GRIDCRAFTER.Settings.QuantityPath.Name",
    hint: "GRIDCRAFTER.Settings.QuantityPath.Hint",
    scope: "world",
    config: true,
    type: String,
    default: QUANTITY_PRESETS[game.system.id] ?? "system.quantity"
  });

  game.settings.register(MODULE_ID, SETTING_FAIL_LOSS_CHANCE, {
    name: "GRIDCRAFTER.Settings.FailLossChance.Name",
    hint: "GRIDCRAFTER.Settings.FailLossChance.Hint",
    scope: "world",
    config: true,
    type: new foundry.data.fields.NumberField({ min: 0, max: 100, step: 5, integer: true, nullable: false, initial: 0 }),
    default: 0
  });

  game.settings.register(MODULE_ID, SETTING_DISCOVERY, {
    name: "GRIDCRAFTER.Settings.Discovery.Name",
    hint: "GRIDCRAFTER.Settings.Discovery.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  // The base loudness of the cues for the whole table. Each user still scales it with their own
  // Interface volume, since the cues play on that channel.
  game.settings.register(MODULE_ID, SETTING_SOUND_VOLUME, {
    scope: "world",
    config: false,
    type: new foundry.data.fields.NumberField({ min: 0, max: 1, step: 0.05, nullable: false, initial: 0.8 }),
    default: 0.8
  });

  // An empty path means "the active theme's own sound", so a GM who never touches these gets sounds
  // that follow the theme, and one who sets a file keeps it whichever theme is active.
  for ( const key of [SETTING_SOUND_CRAFT, SETTING_SOUND_SUCCESS, SETTING_SOUND_FAILURE, SETTING_SOUND_SHARE] ) {
    game.settings.register(MODULE_ID, key, {
      scope: "world",
      config: false,
      type: String,
      default: ""
    });
  }
}
