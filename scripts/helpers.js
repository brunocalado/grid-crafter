/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, SETTING_ALLOWED_TYPES, SETTING_QUANTITY_PATH, SETTING_THEME } from "./constants.js";

/**
 * A plain, storable description of an Item: what recipes keep and what the grids hold.
 * @typedef {object} ItemRef
 * @property {string} uuid
 * @property {string} name
 * @property {string} img
 * @property {string} type
 * @property {string[]} sources   uuids this item is known by: itself and where it was copied from
 */

/**
 * Describe an Item (or a compendium index entry) as an ItemRef.
 * @param {Item|object} item
 * @returns {ItemRef}
 */
export function toItemRef(item) {
  // A copy keeps where it came from in _stats: compendiumSource for a compendium import, duplicateSource
  // for a clone of a world item. Matching on these lets "the Iron Ingot on my sheet" count as the Iron
  // Ingot the recipe was built from, even after a rename.
  const stats = item._stats ?? {};
  const sources = [item.uuid, stats.compendiumSource, stats.duplicateSource].filter(s => typeof s === "string" && s);
  return { uuid: item.uuid, name: item.name, img: item.img, type: item.type, sources: [...new Set(sources)] };
}

/**
 * Does a candidate item satisfy a recipe ingredient? By shared source first, by name and type otherwise,
 * so recipes still work in worlds where items were created by hand instead of copied.
 * @param {ItemRef} ingredient
 * @param {ItemRef} candidate
 * @returns {boolean}
 */
export function refMatches(ingredient, candidate) {
  if ( !ingredient || !candidate ) return false;
  if ( ingredient.sources.some(s => candidate.sources.includes(s)) ) return true;
  return (ingredient.type === candidate.type)
    && (ingredient.name.trim().toLowerCase() === candidate.name.trim().toLowerCase());
}

/**
 * The numeric quantity of an item at the configured path, or null when the item has none.
 * @param {Item} item
 * @returns {number|null}
 */
export function getQuantity(item) {
  const path = game.settings.get(MODULE_ID, SETTING_QUANTITY_PATH);
  if ( !path ) return null;
  const value = foundry.utils.getProperty(item, path);
  return Number.isFinite(value) ? value : null;
}

/**
 * Item types players may place on the forge grid. An empty list allows every type.
 * @param {string} type
 * @returns {boolean}
 */
export function isTypeAllowed(type) {
  const allowed = game.settings.get(MODULE_ID, SETTING_ALLOWED_TYPES);
  return !allowed.length || allowed.includes(type);
}

/** @returns {string} the active visual theme id */
export function getTheme() {
  return game.settings.get(MODULE_ID, SETTING_THEME);
}

/**
 * A yes/no question in the module's themed chrome rather than Foundry's default dialog.
 * @param {object} options
 * @param {string} options.title    Window title, a localization key
 * @param {string} options.content  HTML body
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, content }) {
  return foundry.applications.api.DialogV2.confirm({
    window: { title },
    classes: [MODULE_ID, "gc-app", "gc-dialog", `gc-theme-${getTheme()}`],
    content,
    yes: { class: "gc-button" },
    no: { class: "gc-button" }
  });
}

/**
 * The actor a craft is for: the user's linked character. A GM without one crafts for the actor of the
 * token they control, so recipes can be tested without assigning a character.
 * @returns {Actor|null}
 */
export function getCraftingActor() {
  const actor = game.user.character;
  if ( actor ) return actor;
  if ( game.user.isGM ) return canvas.tokens?.controlled[0]?.actor ?? null;
  return null;
}

/**
 * The actor behind what an API caller passed. A token gives its own actor: the world actor if it
 * is linked, its synthetic actor if not, so an unlinked token learns on its own.
 * @param {Actor|TokenDocument|Token|string} target   a document, a placeable, or the uuid of an
 *   actor or token
 * @returns {Actor|null}
 */
export function toActor(target) {
  // Compendium uuids resolve to index entries, not documents, and fall through to null.
  if ( typeof target === "string" ) target = foundry.utils.fromUuidSync(target, { strict: false });
  if ( target instanceof foundry.documents.Actor ) return target;
  if ( (target instanceof foundry.documents.TokenDocument)
    || (target instanceof foundry.canvas.placeables.Token) ) return target.actor;
  return null;
}

/**
 * Where an item lives, as a short tag for the chat report.
 * @param {Item} item
 * @returns {"actor"|"world"|"compendium"}
 */
export function itemOrigin(item) {
  if ( item.pack ) return "compendium";
  if ( item.parent?.documentName === "Actor" ) return "actor";
  return "world";
}

/**
 * Item drag data as Foundry's sheets and the canvas understand it.
 * @param {string} uuid
 * @returns {string}
 */
export function itemDragData(uuid) {
  return JSON.stringify({ type: "Item", uuid });
}

/**
 * Read a drop event's JSON payload.
 * @param {DragEvent} event
 * @returns {object}
 */
export function getDropData(event) {
  return foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
}

/**
 * Text folded for search: lower case, accents dropped, so "espada" finds "Espáda".
 * @param {string} text
 * @returns {string}
 */
export function searchKey(text) {
  return String(text ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Everything a recipe search looks through: its name, what it makes, its category, the item it requires,
 * its ingredients.
 * @param {object} recipe
 * @returns {string}
 */
export function recipeSearchText(recipe) {
  return searchKey([recipe.name, recipe.result?.name, recipe.category, recipe.requires?.name, ...recipe.cells.map(c => c?.name)]
    .filter(Boolean).join(" "));
}

/**
 * Recipes by category, in order of first appearance, uncategorised last.
 * @param {object[]} recipes
 * @returns {Map<string, object[]>}
 */
export function groupByCategory(recipes) {
  const groups = Map.groupBy(recipes, r => r.category);
  const other = groups.get("");
  groups.delete("");
  if ( other ) groups.set("", other);
  return groups;
}

/**
 * Wire a recipe list's search box. Typing never re-renders: a re-render under the cursor eats
 * input. Escape clears the search instead of closing the window.
 * @param {HTMLInputElement} input
 * @param {(query: string) => void} onQuery
 */
export function bindSearch(input, onQuery) {
  input.addEventListener("input", () => onQuery(input.value));
  input.addEventListener("keydown", ev => {
    if ( ev.key !== "Escape" ) return;
    ev.preventDefault();
    ev.stopPropagation();
    input.value = "";
    onQuery("");
  });
}

/**
 * The caret of the focused text field, for putting back after a re-render. Core restores which
 * field has focus, but not where in it the user was typing.
 * @param {HTMLElement} root
 * @returns {[number, number]|null}
 */
export function readCaret(root) {
  const field = root.querySelector("input:focus");
  return (typeof field?.selectionStart === "number") ? [field.selectionStart, field.selectionEnd] : null;
}

/**
 * @param {HTMLElement} root
 * @param {[number, number]|null} caret
 */
export function restoreCaret(root, caret) {
  const field = root.querySelector("input:focus");
  if ( caret && field ) field.setSelectionRange(...caret);
}

/**
 * Show only the entries that match, and open every group that holds one. With no query and no
 * filter, groups go back to the open state the user left them in.
 * @param {HTMLElement} root
 * @param {{query?: string, readyOnly?: boolean, collapsed: Set<string>}} filter
 */
export function filterGroups(root, { query = "", readyOnly = false, collapsed }) {
  const key = searchKey(query.trim());
  const filtering = !!key || readyOnly;
  const entries = [...root.querySelectorAll("li[data-search]")];
  for ( const li of entries ) {
    li.hidden = (!!key && !li.dataset.search.includes(key)) || (readyOnly && !("ready" in li.dataset));
  }
  for ( const group of root.querySelectorAll("details.gc-group") ) {
    const count = group.querySelectorAll("li[data-search]:not([hidden])").length;
    group.hidden = !count;
    group.open = filtering || !collapsed.has(group.dataset.group);
    const counter = group.querySelector(":scope > summary .gc-group-count");
    if ( counter ) counter.textContent = String(count);
  }
  // With no entries at all the list shows its own empty text instead.
  const noMatch = root.querySelector(".gc-no-match");
  if ( noMatch ) noMatch.hidden = !entries.length || entries.some(li => !li.hidden);
}

/**
 * The groups a user closed in one of the recipe lists. Kept per browser: it is a convenience, and
 * storage may be missing or blocked, in which case every group starts open.
 * @param {"editor"|"forge"} list
 * @returns {Set<string>}
 */
export function getCollapsed(list) {
  try {
    const stored = JSON.parse(localStorage.getItem(`${MODULE_ID}.collapsed`));
    return new Set(Array.isArray(stored?.[list]) ? stored[list] : []);
  } catch {
    return new Set();
  }
}

/**
 * @param {"editor"|"forge"} list
 * @param {Set<string>} collapsed
 */
export function setCollapsed(list, collapsed) {
  try {
    let stored = JSON.parse(localStorage.getItem(`${MODULE_ID}.collapsed`));
    if ( (typeof stored !== "object") || !stored ) stored = {};
    stored[list] = [...collapsed];
    localStorage.setItem(`${MODULE_ID}.collapsed`, JSON.stringify(stored));
  } catch {
    // Storage is blocked: the state lasts as long as the window.
  }
}
