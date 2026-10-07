/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { CATEGORY_MAX, CELL_COUNT, GRID_SIZE, MODULE_ID, SETTING_PUBLIC_RECIPES, SETTING_RECIPES } from "./constants.js";
import { refMatches, toItemRef } from "./helpers.js";

/**
 * @typedef {object} Recipe
 * @property {string} id
 * @property {string} name
 * @property {string} category            "" when the recipe has none
 * @property {boolean} shaped              false: only which items, not where, matters
 * @property {(import("./helpers.js").ItemRef|null)[]} cells   nine cells, row by row
 * @property {import("./helpers.js").ItemRef} result
 * @property {number} quantity            how many results one craft makes
 * @property {number|null} failLossChance  percent; null inherits the world default
 * @property {string} [source]            "world", or the id of the package that registered it
 * @property {boolean} [public]           a package recipe's default; the GM's choice overrides it
 */

/** Recipes other packages registered through the API, keyed by id. They live in memory only. */
const registered = new Map();

/** @returns {Recipe[]} the recipes the GM made in this world */
export function getWorldRecipes() {
  return game.settings.get(MODULE_ID, SETTING_RECIPES).map(r => ({ category: "", ...r, source: "world" }));
}

/** @returns {Recipe[]} world recipes first, then registered ones */
export function getAllRecipes() {
  return [...getWorldRecipes(), ...registered.values()];
}

/**
 * @param {string} id
 * @returns {Recipe|undefined}
 */
export function getRecipe(id) {
  return getAllRecipes().find(r => r.id === id);
}

/**
 * Save the world's recipe list. GM only: the setting is world-scoped.
 * @param {Recipe[]} recipes
 */
export async function setWorldRecipes(recipes) {
  const stored = recipes.map(({ source, ...r }) => r);
  await game.settings.set(MODULE_ID, SETTING_RECIPES, stored);
}

/**
 * Is the recipe known by every character? The GM's choice wins over a package's default.
 * @param {Recipe} recipe
 * @returns {boolean}
 */
export function isRecipePublic(recipe) {
  return game.settings.get(MODULE_ID, SETTING_PUBLIC_RECIPES)[recipe.id] ?? recipe.public ?? false;
}

/**
 * Make a recipe public or private. GM only: the setting is world-scoped.
 * @param {string} id
 * @param {boolean} value
 */
export async function setRecipePublic(id, value) {
  const choices = { ...game.settings.get(MODULE_ID, SETTING_PUBLIC_RECIPES), [id]: !!value };
  await game.settings.set(MODULE_ID, SETTING_PUBLIC_RECIPES, choices);
}

/** @returns {Recipe} an empty recipe ready for the editor */
export function blankRecipe() {
  return {
    id: foundry.utils.randomID(),
    name: "",
    category: "",
    shaped: true,
    cells: Array(CELL_COUNT).fill(null),
    result: null,
    quantity: 1,
    failLossChance: null
  };
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
    if ( missing.length || !result || !cells.some(Boolean) ) {
      console.warn(`${MODULE_ID} | Recipe ${label} skipped: unresolved items.`, missing, data.result);
      continue;
    }
    const chance = Number(data.failLossChance);
    registered.set(label, {
      id: label,
      name: String(data.name ?? result.name),
      category: String(data.category ?? "").trim().slice(0, CATEGORY_MAX),
      shaped: data.shaped !== false,
      public: data.public === true,
      cells,
      result,
      quantity: Math.clamp(Math.floor(Number(data.quantity) || 1), 1, 10),
      failLossChance: Number.isFinite(chance) ? Math.clamp(chance, 0, 100) : null,
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
 * Does a grid satisfy a recipe? Shaped recipes match anywhere in the grid and mirrored left to right.
 * @param {Recipe} recipe
 * @param {(object|null)[]} cells
 * @returns {boolean}
 */
export function recipeMatches(recipe, cells) {
  if ( !recipe.shaped ) return sameItems(recipe.cells.filter(Boolean), cells.filter(Boolean));
  const grid = crop(cells);
  const pattern = crop(recipe.cells);
  if ( !grid.length || !pattern.length ) return false;
  return samePattern(pattern, grid) || samePattern(pattern.map(row => [...row].reverse()), grid);
}

/**
 * The first recipe a grid satisfies.
 * @param {(object|null)[]} cells
 * @returns {Recipe|null}
 */
export function findRecipe(cells) {
  return getAllRecipes().find(r => r.result && recipeMatches(r, cells)) ?? null;
}

/**
 * The recipe a failed grid was closest to: right items, wrong shape. It decides what a failure costs.
 * @param {(object|null)[]} cells
 * @returns {Recipe|null}
 */
export function findNearRecipe(cells) {
  const items = cells.filter(Boolean);
  return getAllRecipes().find(r => sameItems(r.cells.filter(Boolean), items)) ?? null;
}
