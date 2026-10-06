/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import {
  FLAG_KNOWN_RECIPES, MODULE_ID, SETTING_FAIL_LOSS_CHANCE, SETTING_QUANTITY_PATH, TEMPLATE_PATH
} from "./constants.js";
import { getCraftingActor, getQuantity, getTheme, itemOrigin, refMatches, toItemRef } from "./helpers.js";
import { findNearRecipe, findRecipe } from "./recipes.js";

/**
 * @typedef {object} CraftOutcome
 * @property {boolean} success
 * @property {import("./recipes.js").Recipe|null} recipe
 * @property {Item|null} item       the forged item on the actor, on success
 * @property {boolean} lost         on failure: whether the ingredients were destroyed anyway
 */

/**
 * An error whose message is meant for the user, not the console.
 */
export class CraftError extends Error {}

/** @returns {string[]} ids of the recipes the current user has crafted */
export function getKnownRecipeIds(user = game.user) {
  return user.getFlag(MODULE_ID, FLAG_KNOWN_RECIPES) ?? [];
}

/**
 * Try to craft what the grid holds, for the current user's crafting actor.
 * @param {(import("./helpers.js").ItemRef|null)[]} slots   the nine grid cells
 * @returns {Promise<CraftOutcome>}
 */
export async function craft(slots) {
  const actor = getCraftingActor();
  if ( !actor ) throw new CraftError(game.i18n.localize("GRIDCRAFTER.Errors.NoActor"));
  if ( !slots.some(Boolean) ) throw new CraftError(game.i18n.localize("GRIDCRAFTER.Errors.EmptyGrid"));

  // Re-read every ingredient: the grid holds snapshots, and an item may have been used or deleted since.
  const docs = await Promise.all(slots.map(s => (s ? fromUuid(s.uuid) : null)));
  const gone = slots.find((s, i) => s && !docs[i]);
  if ( gone ) throw new CraftError(game.i18n.localize("GRIDCRAFTER.Errors.ItemGone", { name: gone.name }));
  const cells = docs.map(d => (d ? toItemRef(d) : null));

  // Only items on an actor this user owns are spent. Directory and compendium items are free by design:
  // the chat report lists their origin so the table can see it.
  const usage = new Map();
  for ( const doc of docs ) {
    if ( !doc || (itemOrigin(doc) !== "actor") || !doc.isOwner ) continue;
    const entry = usage.get(doc.uuid) ?? { doc, count: 0 };
    entry.count++;
    usage.set(doc.uuid, entry);
  }
  for ( const { doc, count } of usage.values() ) {
    if ( count > (getQuantity(doc) ?? 1) ) {
      throw new CraftError(game.i18n.localize("GRIDCRAFTER.Errors.NotEnough", { name: doc.name }));
    }
  }

  const recipe = findRecipe(cells);
  const used = docs.filter(Boolean);
  if ( recipe ) {
    const source = await fromUuid(recipe.result.uuid);
    if ( !source ) throw new CraftError(game.i18n.localize("GRIDCRAFTER.Errors.ResultGone", { name: recipe.result.name }));
    const item = await forge(actor, usage, source, recipe.quantity);
    await learnRecipe(recipe.id);
    await report({ actor, success: true, recipe, used, item, quantity: recipe.quantity });
    return { success: true, recipe, item, lost: false };
  }

  const near = findNearRecipe(cells);
  const chance = near?.failLossChance ?? game.settings.get(MODULE_ID, SETTING_FAIL_LOSS_CHANCE);
  const lost = (chance > 0) && usage.size && ((Math.random() * 100) < chance);
  if ( lost ) await foundry.documents.modifyBatch(consumeOperations(usage));
  await report({ actor, success: false, used, lost: !!lost, chance });
  return { success: false, recipe: null, item: null, lost: !!lost };
}

/**
 * Spend the ingredients and give the actor the result, in one batch: either both happen or neither does.
 * @param {Actor} actor
 * @param {Map<string, {doc: Item, count: number}>} usage
 * @param {Item} source      the recipe's result as it exists in the world or a compendium
 * @param {number} quantity
 * @returns {Promise<Item>}  the item on the actor that received the result
 */
async function forge(actor, usage, source, quantity) {
  const path = game.settings.get(MODULE_ID, SETTING_QUANTITY_PATH);
  const operations = consumeOperations(usage);
  const sourceRef = toItemRef(source);

  // Stack onto a copy of the same item the actor already carries, when the system counts quantities.
  const stack = actor.items.find(i => !usage.has(i.uuid) && (getQuantity(i) !== null)
    && sourceRef.sources.some(s => toItemRef(i).sources.includes(s)));
  if ( stack ) {
    operations.push({ action: "update", documentName: "Item", parent: actor,
      updates: [{ _id: stack.id, [path]: getQuantity(stack) + quantity }] });
    await foundry.documents.modifyBatch(operations);
    return stack;
  }

  const data = source.toObject();
  for ( const key of ["_id", "folder", "sort", "ownership"] ) delete data[key];
  // Record where the copy came from, as Foundry does for an import or a clone, so the next craft can
  // stack onto it and recipes that use it as an ingredient recognise it.
  if ( source.pack ) foundry.utils.setProperty(data, "_stats.compendiumSource", source.uuid);
  else foundry.utils.setProperty(data, "_stats.duplicateSource", source.uuid);
  let created;
  if ( getQuantity(source) !== null ) {
    foundry.utils.setProperty(data, path, quantity);
    created = [data];
  }
  else created = Array.from({ length: quantity }, () => foundry.utils.deepClone(data));
  operations.push({ action: "create", documentName: "Item", parent: actor, data: created });
  const results = await foundry.documents.modifyBatch(operations);
  return results.at(-1)[0];
}

/**
 * Batch operations that spend one unit per grid slot of each owned item.
 * @param {Map<string, {doc: Item, count: number}>} usage
 * @returns {object[]}
 */
function consumeOperations(usage) {
  const path = game.settings.get(MODULE_ID, SETTING_QUANTITY_PATH);
  const byActor = new Map();
  for ( const { doc, count } of usage.values() ) {
    const ops = byActor.get(doc.parent) ?? { updates: [], ids: [] };
    const quantity = getQuantity(doc);
    if ( (quantity !== null) && (quantity > count) ) ops.updates.push({ _id: doc.id, [path]: quantity - count });
    else ops.ids.push(doc.id);
    byActor.set(doc.parent, ops);
  }
  const operations = [];
  for ( const [parent, { updates, ids }] of byActor ) {
    if ( updates.length ) operations.push({ action: "update", documentName: "Item", parent, updates });
    if ( ids.length ) operations.push({ action: "delete", documentName: "Item", parent, ids });
  }
  return operations;
}

/**
 * Remember that the current user knows a recipe. Players may update their own User document.
 * @param {string} recipeId
 */
async function learnRecipe(recipeId) {
  const known = getKnownRecipeIds();
  if ( known.includes(recipeId) ) return;
  await game.user.setFlag(MODULE_ID, FLAG_KNOWN_RECIPES, [...known, recipeId]);
}

/**
 * Post the craft report to chat.
 * @param {object} data
 */
async function report({ actor, success, recipe, used, item, quantity, lost, chance }) {
  // Group repeated items so "Iron Ingot x3" reads as one line.
  const groups = [];
  for ( const doc of used ) {
    const ref = toItemRef(doc);
    const origin = itemOrigin(doc);
    const same = groups.find(g => (g.uuid === doc.uuid));
    if ( same ) same.count++;
    else groups.push({ uuid: doc.uuid, name: ref.name, img: ref.img, origin, count: 1,
      originLabel: game.i18n.localize(`GRIDCRAFTER.Origin.${origin}`) });
  }
  const content = await foundry.applications.handlebars.renderTemplate(`${TEMPLATE_PATH}/chat-card.hbs`, {
    theme: getTheme(),
    success,
    actorName: actor.name,
    recipeName: recipe?.name,
    groups,
    result: item ? { name: item.name, img: item.img, quantity } : null,
    lost,
    chance
  });
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content
  });
}

/**
 * Items on the actor that satisfy each cell of a recipe, for filling the grid from the recipe book.
 * The same stack may fill several cells while its quantity lasts.
 * @param {import("./recipes.js").Recipe} recipe
 * @param {Actor} actor
 * @returns {(import("./helpers.js").ItemRef|null)[]|null}   null when the actor lacks something
 */
export function fillFromInventory(recipe, actor) {
  const left = new Map(actor.items.map(i => [i.id, getQuantity(i) ?? 1]));
  const refs = new Map(actor.items.map(i => [i.id, toItemRef(i)]));
  const out = [];
  for ( const ing of recipe.cells ) {
    if ( !ing ) {
      out.push(null);
      continue;
    }
    const item = actor.items.find(i => (left.get(i.id) > 0) && refMatches(ing, refs.get(i.id)));
    if ( !item ) return null;
    left.set(item.id, left.get(item.id) - 1);
    out.push(refs.get(item.id));
  }
  return out;
}
