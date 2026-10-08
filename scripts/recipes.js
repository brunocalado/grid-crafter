/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import {
  CATEGORY_MAX, CELL_COUNT, GRID_SIZE, MODULE_ID, SETTING_DISCOVERY, SETTING_HIDDEN_RECIPES, SETTING_RECIPE_EDITS,
  SETTING_RECIPES, VARIANT_MAX
} from "./constants.js";
import { refMatches, toItemRef } from "./helpers.js";

/**
 * One way to make a recipe.
 * @typedef {object} Variant
 * @property {string} id   unique within its recipe; what a dismantling recipe's favorite points at
 * @property {(import("./helpers.js").ItemRef|null)[]} cells   nine cells, row by row
 * @property {import("./helpers.js").ItemRef|null} requires   an item the crafter must carry, of any type;
 *   never placed on the grid and never spent
 */

/**
 * A crafting recipe makes one item from a grid; a dismantling recipe (`kind: "dismantle"`) breaks one
 * item into parts. Anything but "dismantle" is a crafting recipe. The fields after `kind` belong to
 * one kind or the other.
 * @typedef {object} Recipe
 * @property {string} id
 * @property {"craft"|"dismantle"} kind
 * @property {string} name
 * @property {string[]} categories        groups it is listed under in the books; empty when none
 * @property {boolean} public            every character knows it
 * @property {boolean|null} discoverable  whether an actor that doesn't know it can make it; null
 *   inherits the world setting
 * @property {string} [source]            "world", or the id of the package that registered it
 * @property {boolean} [edited]          a package recipe the GM changed; Restore brings back the package's
 *
 * @property {boolean} shaped              craft: false when only which items, not where, matters; for every variant
 * @property {Variant[]} variants         craft: 1 to VARIANT_MAX, in the order they were added. Knowing the
 *   recipe is knowing all of them
 * @property {import("./helpers.js").ItemRef} result   craft
 * @property {number} quantity            craft: how many results one craft makes
 * @property {number|null} failLossChance  craft: percent; null inherits the world default
 *
 * @property {import("./helpers.js").ItemRef} input   dismantle: the item that is broken
 * @property {number} inputQuantity       dismantle: how many units of it one dismantling spends, 1 to 10
 * @property {import("./helpers.js").ItemRef|null} requires   dismantle: an item the actor must carry,
 *   never spent
 * @property {(import("./helpers.js").ItemRef|null)[]} outputs   dismantle: nine cells, one unit of a part
 *   per filled cell; where a part sits never matters
 * @property {{recipe: string, variant: string}|null} favorite   dismantle: the way of making the item that
 *   an item with no receipt breaks into, read live; null, or a link that no longer resolves, breaks into
 *   `outputs`
 * @property {boolean} refund   dismantle: an item with a receipt breaks into what the receipt says
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

/** @returns {Variant} an empty grid with no required item */
export function blankVariant() {
  return { id: foundry.utils.randomID(), cells: Array(CELL_COUNT).fill(null), requires: null };
}

/** @returns {Recipe} an empty crafting recipe ready for the editor */
export function blankRecipe() {
  return {
    id: foundry.utils.randomID(),
    kind: "craft",
    name: "",
    categories: [],
    shaped: true,
    public: false,
    variants: [blankVariant()],
    result: null,
    quantity: 1,
    failLossChance: null,
    discoverable: null
  };
}

/** @returns {Recipe} an empty dismantling recipe ready for the editor */
export function blankDismantle() {
  return {
    id: foundry.utils.randomID(),
    kind: "dismantle",
    name: "",
    categories: [],
    public: false,
    discoverable: null,
    input: null,
    inputQuantity: 1,
    requires: null,
    outputs: Array(CELL_COUNT).fill(null),
    favorite: null,
    refund: false
  };
}

/**
 * The item a recipe is shown by in every book and card: what it makes, or what it breaks.
 * @param {Recipe} recipe
 * @returns {{name: string, img: string|undefined}}
 */
export function recipeFace(recipe) {
  const item = (recipe.kind === "dismantle") ? recipe.input : recipe.result;
  return { name: recipe.name || item?.name || "", img: item?.img };
}

/**
 * Every way of making an item: each variant of each crafting recipe whose result it is, in list order.
 * @param {import("./helpers.js").ItemRef} item
 * @param {Recipe[]} recipes
 * @returns {{recipe: Recipe, variant: Variant, index: number}[]}
 */
export function waysToMake(item, recipes) {
  return recipes.filter(r => (r.kind !== "dismantle") && refMatches(r.result, item))
    .flatMap(r => r.variants.map((variant, index) => ({ recipe: r, variant, index })));
}

/**
 * What an item with no receipt breaks into, and how many units one dismantle takes: the favorite way of
 * making it, read live, or the recipe's own parts when there is none or it no longer resolves.
 * @param {Recipe} recipe   a dismantling recipe
 * @param {Recipe[]} recipes
 * @returns {{cells: (import("./helpers.js").ItemRef|null)[], units: number,
 *   way: {recipe: Recipe, variant: Variant, index: number}|null}}
 */
export function dismantleGrid(recipe, recipes) {
  const f = recipe.favorite;
  const way = f && waysToMake(recipe.input, recipes).find(w => (w.recipe.id === f.recipe) && (w.variant.id === f.variant));
  return way ? { cells: way.variant.cells, units: way.recipe.quantity, way }
    : { cells: recipe.outputs, units: recipe.inputQuantity, way: null };
}

/**
 * Can an actor that doesn't know the recipe use it: lay out its ingredients, or break its item?
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
 * Read one variant a package handed us.
 * @param {object} data   `{ id, cells, requires }`, cells as a flat list of nine uuids or three rows of three
 * @param {number} index   its place in the package's own list
 * @param {Set<string>} taken   ids already given in this recipe; the new one is added
 * @returns {Variant|string}   the variant, or why it can't be used
 */
function variantFromData(data, index, taken) {
  const flat = Array.isArray(data?.cells?.[0]) ? data.cells.flat() : data?.cells;
  if ( !Array.isArray(flat) || (flat.length !== CELL_COUNT) ) return `it needs ${CELL_COUNT} cells`;
  const cells = flat.map(uuid => (uuid ? refFromUuid(uuid) : null));
  const missing = flat.filter((uuid, i) => uuid && !cells[i]);
  const requires = data.requires ? refFromUuid(data.requires) : null;
  if ( data.requires && !requires ) missing.push(data.requires);
  if ( missing.length ) return `unresolved items ${missing.join(", ")}`;
  if ( !cells.some(Boolean) ) return "no ingredient";
  // Without an id of its own, its place in the package's list: the same on every load, so a favorite
  // that points at it survives a reload.
  let id = ((typeof data.id === "string") && data.id && !taken.has(data.id)) ? data.id : `v${index}`;
  while ( taken.has(id) ) id = `${id}_`;
  taken.add(id);
  return { id, cells, requires };
}

/**
 * Read a dismantling recipe a package handed us.
 * @param {object} data   `{ input, inputQuantity, requires, outputs, favorite, refund }`: outputs as 1 to 9
 *   uuids, one per unit; favorite as `{ recipe, variant }` ids
 * @param {string} id
 * @param {string} packageId
 * @returns {Recipe|string}   the recipe, or why it can't be used
 */
function dismantleFromData(data, id, packageId) {
  const input = refFromUuid(data.input);
  if ( !input ) return `unresolved input ${data.input}`;
  const list = data.outputs;
  if ( !Array.isArray(list) || !list.length || (list.length > CELL_COUNT) ) return `it needs 1 to ${CELL_COUNT} outputs`;
  const outputs = list.map(uuid => refFromUuid(uuid));
  const missing = list.filter((uuid, i) => !outputs[i]);
  const requires = data.requires ? refFromUuid(data.requires) : null;
  if ( data.requires && !requires ) missing.push(data.requires);
  if ( missing.length ) return `unresolved items ${missing.join(", ")}`;
  const recipe = {
    id,
    kind: "dismantle",
    name: String(data.name ?? input.name),
    categories: normalizeCategories(data.categories),
    public: data.public === true,
    discoverable: (typeof data.discoverable === "boolean") ? data.discoverable : null,
    input,
    inputQuantity: Math.clamp(Math.floor(Number(data.inputQuantity) || 1), 1, 10),
    requires,
    outputs: [...outputs, ...Array(CELL_COUNT - outputs.length).fill(null)],
    // Never checked here: the recipe it names may register later.
    favorite: ((typeof data.favorite?.recipe === "string") && (typeof data.favorite?.variant === "string"))
      ? { recipe: data.favorite.recipe, variant: data.favorite.variant } : null,
    refund: data.refund === true,
    source: packageId
  };
  // Read now, not once for the call: recipes registered earlier in the same call count too.
  const other = findInputTaken(recipe, getAllRecipes());
  if ( other ) return `${input.name} already has a dismantling recipe, "${other.name}" (${other.id})`;
  return recipe;
}

/**
 * Register recipes on behalf of another package. A crafting recipe brings `variants: [{ cells, requires }]`,
 * or `cells` and `requires` at the top level as a recipe with one variant. Empty cells are null. A
 * dismantling recipe (`kind: "dismantle"`) brings `input`, `inputQuantity`, `requires`, `outputs`,
 * `favorite` and `refund` instead; the fields of the other kind are ignored.
 *
 * One grid makes one recipe: a variant whose grid a recipe already present makes is dropped. One item
 * has one dismantling recipe: a second one for it is skipped. The world's recipes are there before any
 * package registers, so they always keep their grids and items; between packages, the first to register
 * keeps them.
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
    const skip = (reason, ...details) => console.warn(`${MODULE_ID} | Recipe ${label} skipped: ${reason}.`, ...details);
    if ( !data?.id ) {
      skip("it needs an id");
      continue;
    }
    if ( ![undefined, "craft", "dismantle"].includes(data.kind) ) {
      skip(`unknown kind "${data.kind}"`);
      continue;
    }
    if ( data.kind === "dismantle" ) {
      const recipe = dismantleFromData(data, label, packageId);
      if ( typeof recipe === "string" ) skip(recipe);
      else {
        registered.set(label, recipe);
        count++;
      }
      continue;
    }
    const many = data.variants !== undefined;
    // Which grid did the author mean?
    if ( many && ((data.cells != null) || (data.requires != null)) ) {
      skip("it has both variants and cells or requires; give one or the other");
      continue;
    }
    const entries = many ? data.variants : [{ cells: data.cells, requires: data.requires }];
    if ( !Array.isArray(entries) || !entries.length || (entries.length > VARIANT_MAX) ) {
      skip(`it needs 1 to ${VARIANT_MAX} variants`);
      continue;
    }
    const result = refFromUuid(data.result);
    if ( !result ) {
      skip("unresolved result", data.result);
      continue;
    }
    const shaped = data.shaped !== false;
    // Read now, not once for the call: recipes registered earlier in this loop count too.
    const others = getAllRecipes();
    const variants = [];
    const taken = new Set();
    entries.forEach((entry, i) => {
      // A shorthand recipe has nothing left once its one grid goes, so it is skipped by name.
      const drop = reason => (many ? console.warn(`${MODULE_ID} | Recipe ${label}, variants[${i}], dropped: ${reason}.`)
        : skip(reason));
      const variant = variantFromData(entry, i, taken);
      if ( typeof variant === "string" ) return drop(variant);
      const other = findOverlap({ id: label, shaped, variants: [variant] }, others)?.other;
      if ( other ) return drop(`its grid already belongs to "${other.name || other.result.name}" (${other.id})`);
      variants.push(variant);
    });
    if ( !variants.length ) {
      if ( many ) skip("none of its variants can be used");
      continue;
    }
    const chance = Number(data.failLossChance);
    registered.set(label, {
      id: label,
      kind: "craft",
      name: String(data.name ?? result.name),
      categories: normalizeCategories(data.categories),
      shaped,
      public: data.public === true,
      variants,
      result,
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
 * Does a grid satisfy one variant? A shaped variant matches anywhere in the grid, exactly as drawn.
 * @param {boolean} shaped
 * @param {Variant} variant
 * @param {(object|null)[]} cells
 * @returns {boolean}
 */
function variantMatches(shaped, variant, cells) {
  if ( !shaped ) return sameItems(variant.cells.filter(Boolean), cells.filter(Boolean));
  const grid = crop(cells);
  const pattern = crop(variant.cells);
  if ( !grid.length || !pattern.length ) return false;
  return samePattern(pattern, grid);
}

/**
 * The recipe a grid makes, and which of its variants the grid satisfies. One grid makes one recipe at
 * most (see findOverlap), but several variants of it may fit, each with its own required item.
 * @param {(object|null)[]} cells
 * @param {Recipe[]} recipes   the crafting recipes the crafter may make
 * @returns {{recipe: Recipe, matches: number[]}|null}   matches: indexes in the recipe's variants
 */
export function findRecipe(cells, recipes) {
  for ( const recipe of recipes ) {
    if ( !recipe.result ) continue;
    const matches = recipe.variants.flatMap((v, i) => (variantMatches(recipe.shaped, v, cells) ? [i] : []));
    if ( matches.length ) return { recipe, matches };
  }
  return null;
}

/**
 * The recipe a failed grid was closest to: right items, wrong shape, in any variant. It decides what
 * a failure costs.
 * @param {(object|null)[]} cells
 * @param {Recipe[]} recipes   the crafting recipes the crafter may make
 * @returns {Recipe|null}
 */
export function findNearRecipe(cells, recipes) {
  const items = cells.filter(Boolean);
  return recipes.find(r => r.variants.some(v => sameItems(v.cells.filter(Boolean), items))) ?? null;
}

/**
 * Could one grid satisfy both variants? Shaped against shaped: the same cropped pattern. Anything against
 * a shapeless variant: the same items, because a shapeless variant takes any layout, the shaped one's
 * included. The required item never counts: a crafter may carry both.
 * @param {Variant} a
 * @param {boolean} aShaped
 * @param {Variant} b
 * @param {boolean} bShaped
 * @returns {boolean}
 */
function variantsOverlap(a, aShaped, b, bShaped) {
  if ( aShaped && bShaped ) return samePattern(crop(a.cells), crop(b.cells));
  return sameItems(a.cells.filter(Boolean), b.cells.filter(Boolean));
}

/**
 * The first other crafting recipe whose grid one of `recipe`'s variants could also fill. Such a grid would
 * have two answers, so it is refused. Hidden recipes count: hiding changes nothing in play.
 * @param {Recipe} recipe
 * @param {Recipe[]} recipes
 * @returns {{variant: number, other: Recipe}|null}   variant: the index in `recipe`'s variants
 */
export function findOverlap(recipe, recipes) {
  for ( const other of recipes ) {
    if ( (other.id === recipe.id) || (other.kind === "dismantle") ) continue;
    const variant = recipe.variants.findIndex(v => other.variants.some(o => variantsOverlap(v, recipe.shaped, o, other.shaped)));
    if ( variant >= 0 ) return { variant, other };
  }
  return null;
}

/**
 * Another dismantling recipe that breaks the same item. Such an item would have two answers, so it is
 * refused. Hidden ones count: hiding changes nothing in play.
 * @param {Recipe} recipe   a dismantling recipe
 * @param {Recipe[]} recipes
 * @returns {Recipe|null}
 */
export function findInputTaken(recipe, recipes) {
  return recipes.find(r => (r.kind === "dismantle") && (r.id !== recipe.id) && refMatches(recipe.input, r.input)) ?? null;
}
