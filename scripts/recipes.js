/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import {
  CATEGORY_MAX, CELL_COUNT, GRID_SIZE, MODULE_ID, SETTING_DISCOVERY, SETTING_HIDDEN_RECIPES, SETTING_RECIPE_EDITS,
  SETTING_RECIPES
} from "./constants.js";
import { refMatches, toItemRef } from "./helpers.js";

/**
 * @typedef {object} Recipe
 * @property {string} id
 * @property {string} name
 * @property {string[]} categories        groups it is listed under in the books; empty when none
 * @property {boolean} shaped              false: only which items, not where, matters
 * @property {(import("./helpers.js").ItemRef|null)[]} cells   nine cells, row by row
 * @property {import("./helpers.js").ItemRef} result
 * @property {import("./helpers.js").ItemRef|null} requires   an item the crafter must carry, of any type;
 *   never placed on the grid and never spent
 * @property {number} quantity            how many results one craft makes
 * @property {number|null} failLossChance  percent; null inherits the world default
 * @property {boolean} public            every character knows it
 * @property {boolean|null} discoverable  whether an actor that doesn't know it can make it; null
 *   inherits the world setting
 * @property {string} [source]            "world", or the id of the package that registered it
 * @property {boolean} [edited]          a package recipe the GM changed; Restore brings back the package's
 */

/** Recipes other packages registered through the API, keyed by id. They live in memory only. */
const registered = new Map();

/** @returns {Recipe[]} the recipes the GM made in this world */
export function getWorldRecipes() {
  return game.settings.get(MODULE_ID, SETTING_RECIPES)
    .map(r => ({ categories: [], public: false, discoverable: null, ...r, source: "world" }));
}

/**
 * World recipes first, then registered ones. A package recipe the GM edited is replaced by that edit,
 * under the same id, so the books that learned it and the players it was shared with keep it.
 * @returns {Recipe[]}
 */
export function getAllRecipes() {
  const edits = game.settings.get(MODULE_ID, SETTING_RECIPE_EDITS);
  const fromPackages = [...registered.values()].map(r => (edits[r.id]
    ? { categories: [], ...edits[r.id], id: r.id, source: r.source, edited: true } : r));
  return [...getWorldRecipes(), ...fromPackages];
}

/**
 * @param {string} id
 * @returns {Recipe|undefined}
 */
export function getRecipe(id) {
  return getAllRecipes().find(r => r.id === id);
}

/**
 * Save a recipe where it belongs: a package recipe as the GM's edit of it, anything else in the
 * world list. GM only: both settings are world-scoped.
 * @param {Recipe} recipe
 */
export async function saveRecipe(recipe) {
  const { source, edited, ...data } = foundry.utils.deepClone(recipe);
  if ( registered.has(data.id) ) {
    const edits = { ...game.settings.get(MODULE_ID, SETTING_RECIPE_EDITS), [data.id]: data };
    return game.settings.set(MODULE_ID, SETTING_RECIPE_EDITS, edits);
  }
  const recipes = [...game.settings.get(MODULE_ID, SETTING_RECIPES)];
  // In place when it already exists, so the list keeps the GM's order.
  const index = recipes.findIndex(r => r.id === data.id);
  if ( index >= 0 ) recipes[index] = data;
  else recipes.push(data);
  return game.settings.set(MODULE_ID, SETTING_RECIPES, recipes);
}

/**
 * GM only.
 * @param {string} id   a world recipe's id
 */
export async function deleteRecipe(id) {
  const recipes = game.settings.get(MODULE_ID, SETTING_RECIPES).filter(r => r.id !== id);
  await setRecipeHidden(id, false);
  return game.settings.set(MODULE_ID, SETTING_RECIPES, recipes);
}

/**
 * Throw away the GM's edit of a package recipe: the package's own version is back, and the package
 * ships it visible. GM only.
 * @param {string} id
 */
export async function restoreRecipe(id) {
  const edits = { ...game.settings.get(MODULE_ID, SETTING_RECIPE_EDITS) };
  delete edits[id];
  await setRecipeHidden(id, false);
  return game.settings.set(MODULE_ID, SETTING_RECIPE_EDITS, edits);
}

/** @returns {Set<string>} ids of the recipes the GM moved out of the way in the Recipe Book */
export function getHiddenIds() {
  return new Set(game.settings.get(MODULE_ID, SETTING_HIDDEN_RECIPES));
}

/**
 * Move a recipe to, or out of, the Recipe Book's Hidden group. Changes nothing in play. GM only.
 * @param {string} id
 * @param {boolean} hidden
 */
export async function setRecipeHidden(id, hidden) {
  const ids = getHiddenIds();
  if ( ids.has(id) === hidden ) return;
  if ( hidden ) ids.add(id);
  else ids.delete(id);
  return game.settings.set(MODULE_ID, SETTING_HIDDEN_RECIPES, [...ids]);
}

/**
 * Category names as a recipe keeps them: trimmed, cut to length, no blanks, no repeats. A name that
 * differs only in case or accents from one already in use anywhere takes that one's spelling, so
 * "armas" joins "Armas" rather than starting a twin.
 * @param {unknown} value   anything; only a list of strings yields names
 * @returns {string[]}
 */
export function normalizeCategories(value) {
  if ( !Array.isArray(value) ) return [];
  const known = getCategories();
  const names = [];
  for ( const raw of value ) {
    if ( typeof raw !== "string" ) continue;
    const name = raw.trim().slice(0, CATEGORY_MAX);
    if ( !name ) continue;
    const spelled = known.find(k => k.localeCompare(name, undefined, { sensitivity: "base" }) === 0) ?? name;
    if ( !names.some(n => n.localeCompare(spelled, undefined, { sensitivity: "base" }) === 0) ) names.push(spelled);
  }
  return names;
}

/** @returns {string[]} every category some recipe uses, alphabetically */
export function getCategories() {
  const names = new Set(getAllRecipes().flatMap(r => r.categories));
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** @returns {Recipe} an empty recipe ready for the editor */
export function blankRecipe() {
  return {
    id: foundry.utils.randomID(),
    name: "",
    categories: [],
    shaped: true,
    public: false,
    cells: Array(CELL_COUNT).fill(null),
    result: null,
    requires: null,
    quantity: 1,
    failLossChance: null,
    discoverable: null
  };
}

/**
 * Can an actor that doesn't know the recipe make it by laying out its ingredients?
 * @param {Recipe} recipe
 * @returns {boolean}
 */
export function isDiscoverable(recipe) {
  return recipe.discoverable ?? game.settings.get(MODULE_ID, SETTING_DISCOVERY);
}

/* -------------------------------------------- */
/*  Registration from other packages            */
/* -------------------------------------------- */

/**
 * Resolve a uuid a package handed us into an ItemRef. Compendium entries resolve from the pack index
 * without loading the document, which is all a recipe needs.
 * @param {string} uuid
 * @returns {import("./helpers.js").ItemRef|null}
 */
function refFromUuid(uuid) {
  if ( typeof uuid !== "string" ) return null;
  const entry = foundry.utils.fromUuidSync(uuid, { strict: false });
  if ( !entry ) return null;
  const ref = toItemRef(entry);
  ref.uuid ??= uuid;
  if ( !ref.sources.includes(uuid) ) ref.sources.unshift(uuid);
  return ref;
}

/**
 * Register recipes on behalf of another package. Accepts the cells as a flat list of nine uuids or as
 * three rows of three; empty cells are null.
 * @param {string} packageId
 * @param {object[]} recipes
 * @returns {number} how many recipes were registered
 */
export function registerRecipes(packageId, recipes) {
  if ( (typeof packageId !== "string") || !packageId ) throw new Error(`${MODULE_ID} | registerRecipes needs a package id.`);
  if ( !Array.isArray(recipes) ) throw new Error(`${MODULE_ID} | registerRecipes needs an array of recipes.`);
  let count = 0;
  for ( const data of recipes ) {
    const label = `${packageId}.${data?.id ?? "?"}`;
    const flat = Array.isArray(data?.cells?.[0]) ? data.cells.flat() : data?.cells;
    if ( !data?.id || !Array.isArray(flat) || (flat.length !== CELL_COUNT) ) {
      console.warn(`${MODULE_ID} | Recipe ${label} skipped: it needs an id and ${CELL_COUNT} cells.`);
      continue;
    }
    const cells = flat.map(uuid => (uuid ? refFromUuid(uuid) : null));
    const missing = flat.filter((uuid, i) => uuid && !cells[i]);
    const result = refFromUuid(data.result);
    const requires = data.requires ? refFromUuid(data.requires) : null;
    if ( missing.length || !result || !cells.some(Boolean) || (data.requires && !requires) ) {
      console.warn(`${MODULE_ID} | Recipe ${label} skipped: unresolved items.`, missing, data.result, data.requires);
      continue;
    }
    const chance = Number(data.failLossChance);
    registered.set(label, {
      id: label,
      name: String(data.name ?? result.name),
      categories: normalizeCategories(data.categories),
      shaped: data.shaped !== false,
      public: data.public === true,
      cells,
      result,
      requires,
      quantity: Math.clamp(Math.floor(Number(data.quantity) || 1), 1, 10),
      failLossChance: Number.isFinite(chance) ? Math.clamp(chance, 0, 100) : null,
      discoverable: (typeof data.discoverable === "boolean") ? data.discoverable : null,
      source: packageId
    });
    count++;
  }
  return count;
}

/**
 * Remove every recipe a package registered.
 * @param {string} packageId
 */
export function unregisterRecipes(packageId) {
  for ( const [id, recipe] of registered ) {
    if ( recipe.source === packageId ) registered.delete(id);
  }
}

/* -------------------------------------------- */
/*  Matching                                    */
/* -------------------------------------------- */

/**
 * Crop a 3x3 grid to the rows and columns that hold something, so a shape matches wherever it sits.
 * @param {(object|null)[]} cells
 * @returns {(object|null)[][]}   rows of the bounding box; empty when the grid is empty
 */
function crop(cells) {
  const rows = [];
  const cols = [];
  cells.forEach((c, i) => {
    if ( !c ) return;
    rows.push(Math.floor(i / GRID_SIZE));
    cols.push(i % GRID_SIZE);
  });
  if ( !rows.length ) return [];
  const [r0, r1, c0, c1] = [Math.min(...rows), Math.max(...rows), Math.min(...cols), Math.max(...cols)];
  const out = [];
  for ( let r = r0; r <= r1; r++ ) out.push(cells.slice((r * GRID_SIZE) + c0, (r * GRID_SIZE) + c1 + 1));
  return out;
}

/**
 * @param {(object|null)[][]} pattern
 * @param {(object|null)[][]} grid
 * @returns {boolean}
 */
function samePattern(pattern, grid) {
  if ( (pattern.length !== grid.length) || (pattern[0].length !== grid[0].length) ) return false;
  return pattern.every((row, r) => row.every((ing, c) => {
    const cand = grid[r][c];
    return (!ing && !cand) || refMatches(ing, cand);
  }));
}

/**
 * Do the items match, ignoring where they sit? Each ingredient must claim a distinct grid item; a small
 * backtracking search, since nine items is the most it ever sees.
 * @param {object[]} ingredients
 * @param {object[]} items
 * @returns {boolean}
 */
function sameItems(ingredients, items) {
  if ( ingredients.length !== items.length ) return false;
  const used = new Array(items.length).fill(false);
  const assign = i => {
    if ( i === ingredients.length ) return true;
    for ( let j = 0; j < items.length; j++ ) {
      if ( used[j] || !refMatches(ingredients[i], items[j]) ) continue;
      used[j] = true;
      if ( assign(i + 1) ) return true;
      used[j] = false;
    }
    return false;
  };
  return assign(0);
}

/**
 * Does a grid satisfy a recipe? Shaped recipes match anywhere in the grid, exactly as drawn.
 * @param {Recipe} recipe
 * @param {(object|null)[]} cells
 * @returns {boolean}
 */
export function recipeMatches(recipe, cells) {
  if ( !recipe.shaped ) return sameItems(recipe.cells.filter(Boolean), cells.filter(Boolean));
  const grid = crop(cells);
  const pattern = crop(recipe.cells);
  if ( !grid.length || !pattern.length ) return false;
  return samePattern(pattern, grid);
}

/**
 * The first recipe a grid satisfies.
 * @param {(object|null)[]} cells
 * @param {Recipe[]} recipes   the ones the crafter may make
 * @returns {Recipe|null}
 */
export function findRecipe(cells, recipes) {
  return recipes.find(r => r.result && recipeMatches(r, cells)) ?? null;
}

/**
 * The recipe a failed grid was closest to: right items, wrong shape. It decides what a failure costs.
 * @param {(object|null)[]} cells
 * @param {Recipe[]} recipes   the ones the crafter may make
 * @returns {Recipe|null}
 */
export function findNearRecipe(cells, recipes) {
  const items = cells.filter(Boolean);
  return recipes.find(r => sameItems(r.cells.filter(Boolean), items)) ?? null;
}
