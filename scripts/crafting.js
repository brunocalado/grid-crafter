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
import { findNearRecipe, findRecipe, getAllRecipes } from "./recipes.js";

/**
 * @typedef {object} CraftOutcome
 * @property {boolean} success
 * @property {import("./recipes.js").Recipe|null} recipe
 * @property {Item|null} item       the forged item on the actor, on success
 * @property {boolean} lost         on failure: whether the ingredients were destroyed anyway
 * @property {boolean} refused      the recipe matched but the actor could not take the result; nothing was spent
 * @property {boolean} incomplete   the materials were spent, the result is missing and they could not be put back
 */

/**
 * An error whose message is meant for the user, not the console.
 */
export class CraftError extends Error {}

/**
 * What the actor learned: its own flag. Teaching, forgetting and Learn work on this.
 * @param {Actor|null} actor
 * @returns {string[]}
 */
export function getLearnedRecipeIds(actor) {
  return actor?.getFlag(MODULE_ID, FLAG_KNOWN_RECIPES) ?? [];
}

/**
 * What the actor's recipe book shows: what it learned, plus every public recipe. Public knowledge is
 * never written to the actor, so making a recipe private again takes it back from everyone who
 * didn't learn it.
 * @param {Actor|null} actor
 * @returns {string[]}
 */
export function getKnownRecipeIds(actor) {
  const ids = new Set(getLearnedRecipeIds(actor));
  for ( const r of getAllRecipes() ) if ( r.public ) ids.add(r.id);
  return [...ids];
}

/**
 * Try to craft what the grid holds, for the current user's crafting actor.
 * @param {(import("./helpers.js").ItemRef|null)[]} slots   the nine grid cells
 * @returns {Promise<CraftOutcome>}
 */
export async function craft(slots) {
  const actor = getCraftingActor();
  if ( !actor ) {
    throw new CraftError(game.i18n.localize(game.user.isGM ? "GRIDCRAFTER.Errors.NoActorGM" : "GRIDCRAFTER.Errors.NoActor"));
  }
  if ( !slots.some(Boolean) ) throw new CraftError(game.i18n.localize("GRIDCRAFTER.Errors.EmptyGrid"));

  // Re-read every ingredient: the grid holds snapshots, and an item may have been used or deleted since.
  const docs = await Promise.all(slots.map(s => (s ? fromUuid(s.uuid) : null)));
  const gone = slots.find((s, i) => s && !docs[i]);
  if ( gone ) throw new CraftError(game.i18n.localize("GRIDCRAFTER.Errors.ItemGone", { name: gone.name }));
  const cells = docs.map(d => (d ? toItemRef(d) : null));

  // Only the crafting actor's own items are spent. Items from the directory or a compendium are free,
  // so only a GM may use them: the chat report lists their origin so the table can see it.
  const usage = new Map();
  for ( const doc of docs ) {
    if ( !doc ) continue;
    const origin = itemOrigin(doc);
    if ( (origin === "actor") && (doc.parent.uuid !== actor.uuid) ) {
      throw new CraftError(game.i18n.localize("GRIDCRAFTER.Errors.NotYourCharacter", { name: doc.name }));
    }
    if ( (origin === "actor") && !doc.isOwner ) {
      throw new CraftError(game.i18n.localize("GRIDCRAFTER.Errors.NotOwner", { name: doc.name }));
    }
    if ( (origin !== "actor") && !game.user.isGM ) {
      throw new CraftError(game.i18n.localize("GRIDCRAFTER.Errors.NotFromInventory", { name: doc.name }));
    }
    if ( origin !== "actor" ) continue;
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
    const { item, missing } = await forge(actor, usage, source, recipe.quantity);
    if ( !item ) {
      const incomplete = missing.length > 0;
      await report({ actor, state: incomplete ? "incomplete" : "refused", recipe, item: source, quantity: recipe.quantity,
        used: incomplete ? used.filter(d => missing.includes(d.id)) : used });
      return { success: false, recipe, item: null, lost: false, refused: !incomplete, incomplete };
    }
    await learnRecipes(actor, [recipe.id]);
    await report({ actor, state: "success", recipe, used, item, quantity: recipe.quantity });
    return { success: true, recipe, item, lost: false, refused: false, incomplete: false };
  }

  const near = findNearRecipe(cells);
  const chance = near?.failLossChance ?? game.settings.get(MODULE_ID, SETTING_FAIL_LOSS_CHANCE);
  const lost = (chance > 0) && usage.size && ((Math.random() * 100) < chance);
  if ( lost ) await foundry.documents.modifyBatch(consumeOperations(actor, usage));
  await report({ actor, state: "failure", used, lost: !!lost, chance });
  return { success: false, recipe: null, item: null, lost: !!lost, refused: false, incomplete: false };
}

/**
 * Spend the ingredients, then give the actor the result. If the actor does not take all of it, put
 * the ingredients back.
 *
 * Spending comes first so a system that limits inventory (slots, weight) measures the result against
 * the room the ingredients leave behind. It has to be separate writes: a modifyBatch is not atomic,
 * and core runs every operation's pre-workflow against the state before the batch, then silently
 * drops an operation a system emptied in _preCreateOperation while sending the rest.
 * @param {Actor} actor
 * @param {Map<string, {doc: Item, count: number}>} usage
 * @param {Item} source      the recipe's result as it exists in the world or a compendium
 * @param {number} quantity
 * @returns {Promise<{item: Item|null, missing?: string[]}>}  the item that received the result, or null
 *   when the actor refused it; then the ids of the ingredients that could not be put back
 */
async function forge(actor, usage, source, quantity) {
  // Copied before spending: after an update the document's source already holds the new quantity.
  const before = [...usage.values()].map(({ doc }) => doc.toObject());
  const operations = consumeOperations(actor, usage);
  if ( operations.length ) await foundry.documents.modifyBatch(operations);

  let item = null;
  try {
    item = await deliver(actor, usage, source, quantity);
  } catch(err) {
    console.error(`${MODULE_ID} | Could not give ${source.name} to ${actor.name}.`, err);
  }
  if ( item ) return { item };

  try {
    await restore(actor, before);
  } catch(err) {
    console.error(`${MODULE_ID} | Could not put the ingredients back on ${actor.name}.`, err);
  }
  // A system may refuse the restoring create too, without an error.
  const missing = before.filter(data => {
    const doc = actor.items.get(data._id);
    return !doc || (getQuantity(doc) !== getQuantity(data));
  }).map(data => data._id);
  return { item: null, missing };
}

/**
 * Add the result to the actor: onto a stack of it the actor already carries, or as new items.
 * A system may refuse the write or trim it (fewer copies, a smaller quantity); anything short of the
 * whole result is undone and counts as a refusal.
 * @param {Actor} actor
 * @param {Map<string, {doc: Item, count: number}>} usage
 * @param {Item} source
 * @param {number} quantity
 * @returns {Promise<Item|null>}
 */
async function deliver(actor, usage, source, quantity) {
  const path = game.settings.get(MODULE_ID, SETTING_QUANTITY_PATH);
  const sourceRef = toItemRef(source);

  // Stack onto a copy of the same item the actor already carries, when the system counts quantities.
  const stack = actor.items.find(i => !usage.has(i.uuid) && (getQuantity(i) !== null)
    && sourceRef.sources.some(s => toItemRef(i).sources.includes(s)));
  if ( stack ) {
    const was = getQuantity(stack);
    await actor.updateEmbeddedDocuments("Item", [{ _id: stack.id, [path]: was + quantity }]);
    if ( getQuantity(stack) === was + quantity ) return stack;
    if ( getQuantity(stack) !== was ) await actor.updateEmbeddedDocuments("Item", [{ _id: stack.id, [path]: was }]);
    return null;
  }

  const data = source.toObject();
  for ( const key of ["_id", "folder", "sort", "ownership"] ) delete data[key];
  // Record where the copy came from, as Foundry does for an import or a clone, so the next craft can
  // stack onto it and recipes that use it as an ingredient recognise it.
  if ( source.pack ) foundry.utils.setProperty(data, "_stats.compendiumSource", source.uuid);
  else foundry.utils.setProperty(data, "_stats.duplicateSource", source.uuid);
  const counted = getQuantity(source) !== null;
  let batch;
  if ( counted ) {
    foundry.utils.setProperty(data, path, quantity);
    batch = [data];
  }
  else batch = Array.from({ length: quantity }, () => foundry.utils.deepClone(data));
  // createEmbeddedDocuments returns [] when the system empties the batch, and only what was kept when it
  // trims it.
  const created = await actor.createEmbeddedDocuments("Item", batch);
  if ( (created.length === batch.length) && (!counted || (getQuantity(created[0]) === quantity)) ) return created[0];
  if ( created.length ) await actor.deleteEmbeddedDocuments("Item", created.map(i => i.id));
  return null;
}

/**
 * Put spent ingredients back as they were before the craft: deleted ones recreated with their own ids,
 * so the grid's references stay valid, and decremented ones returned to their old quantity.
 * @param {Actor} actor
 * @param {object[]} before   the ingredients' source data, copied before spending
 */
async function restore(actor, before) {
  const path = game.settings.get(MODULE_ID, SETTING_QUANTITY_PATH);
  const data = before.filter(d => !actor.items.has(d._id));
  const updates = before.filter(d => actor.items.has(d._id))
    .map(d => ({ _id: d._id, [path]: getQuantity(d) }));
  const operations = [];
  if ( data.length ) operations.push({ action: "create", documentName: "Item", parent: actor, data, keepId: true });
  if ( updates.length ) operations.push({ action: "update", documentName: "Item", parent: actor, updates });
  if ( operations.length ) await foundry.documents.modifyBatch(operations);
}

/**
 * Batch operations that spend one unit per grid slot of each of the actor's items.
 * @param {Actor} actor
 * @param {Map<string, {doc: Item, count: number}>} usage
 * @returns {object[]}
 */
function consumeOperations(actor, usage) {
  const path = game.settings.get(MODULE_ID, SETTING_QUANTITY_PATH);
  const updates = [];
  const ids = [];
  for ( const { doc, count } of usage.values() ) {
    const quantity = getQuantity(doc);
    if ( (quantity !== null) && (quantity > count) ) updates.push({ _id: doc.id, [path]: quantity - count });
    else ids.push(doc.id);
  }
  const operations = [];
  if ( updates.length ) operations.push({ action: "update", documentName: "Item", parent: actor, updates });
  if ( ids.length ) operations.push({ action: "delete", documentName: "Item", parent: actor, ids });
  return operations;
}

/**
 * Add recipes to what an actor learned, in one write. Writes to one actor must never run in
 * parallel: each would read the same old array, and the last write would drop the others' recipes.
 * The caller must own the actor.
 * @param {Actor} actor
 * @param {string[]} recipeIds
 * @returns {Promise<string[]>} the ids it had not learned before
 */
export async function learnRecipes(actor, recipeIds) {
  const learned = getLearnedRecipeIds(actor);
  const added = recipeIds.filter(id => !learned.includes(id));
  if ( added.length ) await actor.setFlag(MODULE_ID, FLAG_KNOWN_RECIPES, [...learned, ...added]);
  return added;
}

/**
 * Tell the learners' owners, and the GMs, that recipes were taught or learned. Nobody else sees it.
 * The speaker is the user by name: ChatMessage.getSpeaker() with no actor falls back to a GM's
 * controlled token, which is exactly the list being taught.
 * @param {import("./recipes.js").Recipe[]} recipes
 * @param {Actor[]} learners
 */
export async function reportTaught(recipes, learners) {
  const names = game.i18n.getListFormatter().format(learners.map(a => a.name));
  const content = await foundry.applications.handlebars.renderTemplate(`${TEMPLATE_PATH}/teach-card.hbs`, {
    theme: getTheme(),
    title: (recipes.length === 1) ? game.i18n.localize("GRIDCRAFTER.Chat.Taught", { names })
      : game.i18n.localize("GRIDCRAFTER.Chat.TaughtMany", { names, count: recipes.length }),
    recipes: recipes.map(r => ({ name: r.name || r.result?.name, img: r.result?.img }))
  });
  await ChatMessage.implementation.create({
    speaker: { alias: game.user.name },
    // GMs pass every permission test, so they are always included.
    whisper: game.users.filter(u => learners.some(a => a.testUserPermission(u, "OWNER"))).map(u => u.id),
    content
  });
}

/**
 * Remove recipes from what an actor learned, in one write, for the same reason as learnRecipes.
 * The caller must own the actor.
 * @param {Actor} actor
 * @param {string[]} recipeIds
 * @returns {Promise<string[]>} the ids removed
 */
export async function forgetRecipes(actor, recipeIds) {
  const learned = getLearnedRecipeIds(actor);
  const removed = learned.filter(id => recipeIds.includes(id));
  if ( removed.length ) await actor.setFlag(MODULE_ID, FLAG_KNOWN_RECIPES, learned.filter(id => !recipeIds.includes(id)));
  return removed;
}

/**
 * Post the craft report to chat, once the craft has settled.
 * @param {object} data
 * @param {"success"|"failure"|"refused"|"incomplete"} data.state
 */
async function report({ actor, state, recipe, used, item, quantity, lost, chance }) {
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
    state,
    success: state === "success",
    spent: (state === "success") || (state === "incomplete"),
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
