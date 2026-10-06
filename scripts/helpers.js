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
