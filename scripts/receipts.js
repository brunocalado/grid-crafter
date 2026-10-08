/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { FLAG_RECEIPTS, MODULE_ID, SETTING_QUANTITY_PATH } from "./constants.js";
import { getQuantity } from "./helpers.js";

/**
 * What one craft spent, written on what it made. A stack keeps several, oldest first, so crafted and
 * bought copies share one line on the sheet: units a system merges in sit under no receipt.
 * @typedef {object} Receipt
 * @property {import("./helpers.js").ItemRef[]} parts   one per unit spent, as the variant names them:
 *   world or compendium refs, which outlive the spend
 * @property {number} per     units one craft made; one dismantle of this receipt breaks that many
 * @property {number} count   units of the stack it still covers
 */

/**
 * @param {Item|object} item
 * @returns {number} units in a stack: its quantity, or 1 where the system counts none
 */
export function unitsOf(item) {
  return getQuantity(item) ?? 1;
}

/**
 * Never more units covered than the stack holds. The oldest units leave first, so the oldest receipts
 * give way.
 * @param {Receipt[]} receipts
 * @param {number} units
 * @returns {Receipt[]}   a new list; the entries that change are copies
 */
export function trimReceipts(receipts, units) {
  let excess = receipts.reduce((sum, r) => sum + r.count, 0) - Math.max(units, 0);
  const kept = [];
  for ( const r of receipts ) {
    const drop = Math.min(Math.max(excess, 0), r.count);
    excess -= drop;
    if ( drop === r.count ) continue;
    kept.push(drop ? { ...r, count: r.count - drop } : r);
  }
  return kept;
}

/**
 * @param {Item} item
 * @returns {Receipt[]} the item's receipts, oldest first, trimmed to what it holds now
 */
export function getReceipts(item) {
  return trimReceipts(item.getFlag(MODULE_ID, FLAG_RECEIPTS) ?? [], unitsOf(item));
}

/**
 * Same parts and same batch: one receipt can absorb the other.
 * @param {Receipt} receipt
 * @returns {string}
 */
export function receiptKey(receipt) {
  return `${receipt.per}|${receipt.parts.map(p => p.uuid).sort().join(",")}`;
}

/**
 * A craft onto a stack: it joins the newest receipt when they have the same key, and goes last otherwise.
 * @param {Receipt[]} receipts
 * @param {Receipt} receipt
 * @returns {Receipt[]}   a new list
 */
export function addReceipt(receipts, receipt) {
  const last = receipts.at(-1);
  if ( last && (receiptKey(last) === receiptKey(receipt)) ) {
    return [...receipts.slice(0, -1), { ...last, count: last.count + receipt.count }];
  }
  return [...receipts, receipt];
}

/**
 * A stack that shrinks gives up the receipts of its oldest units in the same write. Trimming on read
 * alone is not enough: units burnt, then units merged in by the system, would be covered again.
 * Core cleans the changes again after preUpdate, so the flag written here travels with the update.
 */
export function registerReceiptHooks() {
  Hooks.on("preUpdateItem", (item, changes) => {
    const path = game.settings.get(MODULE_ID, SETTING_QUANTITY_PATH);
    const key = `flags.${MODULE_ID}.${FLAG_RECEIPTS}`;
    const quantity = path ? foundry.utils.getProperty(changes, path) : undefined;
    const written = foundry.utils.getProperty(changes, key);
    if ( (quantity === undefined) && (written === undefined) ) return;
    const receipts = written ?? item.getFlag(MODULE_ID, FLAG_RECEIPTS);
    if ( !Array.isArray(receipts) || !receipts.length ) return;
    const trimmed = trimReceipts(receipts, Number.isFinite(quantity) ? quantity : unitsOf(item));
    if ( (trimmed.length !== receipts.length) || trimmed.some((r, i) => r.count !== receipts[i].count) ) {
      foundry.utils.setProperty(changes, key, trimmed);
    }
  });
}
