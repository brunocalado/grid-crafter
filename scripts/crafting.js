/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import {
  FLAG_KNOWN_RECIPES, FLAG_RECEIPTS, MODULE_ID, SETTING_FAIL_LOSS_CHANCE, SETTING_QUANTITY_PATH, TEMPLATE_PATH
} from "./constants.js";
import { getCraftingActor, getQuantity, getTheme, itemOrigin, refMatches, toItemRef } from "./helpers.js";
import { addReceipt, getReceipts } from "./receipts.js";
import { findNearRecipe, findRecipe, getAllRecipes, isDiscoverable, recipeFace } from "./recipes.js";

/**
 * @typedef {object} CraftOutcome
 * @property {"success"|"failure"|"refused"|"incomplete"|"missing"} state
 *   success: the result reached the actor; failure: no recipe matched; refused: the actor's sheet
 *   would not take the result, nothing spent; incomplete: spent, but the result never arrived and the
 *   materials could not be put back; missing: the grid fits the recipe, but the actor lacks the item
 *   every fitting variant requires, nothing spent
 * @property {import("./recipes.js").Recipe|null} recipe
 * @property {number|null} variant  the index of the recipe's variant the grid made; null when no recipe matched
 * @property {Item|null} item       the forged item on the actor, on success only
 * @property {boolean} lost         failure only: the materials were destroyed
 */

/**
 * @typedef {object} DismantleOutcome
 * @property {"success"|"refused"|"incomplete"|"missing"} state
 *   success: every part reached the actor; refused: the actor's sheet would not take all of them, nothing
 *   spent; incomplete: spent, but the parts never arrived and the item could not be put back; missing:
 *   the actor lacks the item the recipe requires, nothing spent
 * @property {import("./recipes.js").Recipe} recipe
 * @property {Item[]|null} items   on success only: the items that received each part, in the order of the
 *   recipe's distinct parts
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
 * Does the actor carry the item a variant, or a dismantling recipe, requires? Any type counts, a feature
 * as much as a tool.
 * @param {{requires: import("./helpers.js").ItemRef|null}} holder
 * @param {Actor} actor
 * @returns {boolean}
 */
export function hasRequiredItem(holder, actor) {
  return !holder.requires
    || actor.items.some(i => ((getQuantity(i) ?? 1) > 0) && refMatches(holder.requires, toItemRef(i)));
}

/** @returns {CraftError} the refusal for a user with no actor to craft or dismantle for */
function noActorError() {
  return new CraftError(game.i18n.localize(game.user.isGM ? "GRIDCRAFTER.Errors.NoActorGM" : "GRIDCRAFTER.Errors.NoActor"));
}

/**
 * Try to craft what the grid holds, for the current user's crafting actor.
 * @param {(import("./helpers.js").ItemRef|null)[]} slots   the nine grid cells
 * @returns {Promise<CraftOutcome>}
 */
export async function craft(slots) {
  const actor = getCraftingActor();
  if ( !actor ) throw noActorError();
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

  // A recipe the actor doesn't know is out of reach unless it can be discovered: the grid then fails
  // like any wrong layout, so it gives away nothing.
  const known = new Set(getKnownRecipeIds(actor));
  const usable = getAllRecipes().filter(r => (r.kind !== "dismantle") && (known.has(r.id) || isDiscoverable(r)));
  const found = findRecipe(cells, usable);
  const recipe = found?.recipe ?? null;
  // Several variants may fit one grid with different tools: take one the actor can make.
  const variant = found ? (found.matches.find(i => hasRequiredItem(recipe.variants[i], actor)) ?? found.matches[0]) : null;
  const used = docs.filter(Boolean);
  const source = recipe ? await fromUuid(recipe.result.uuid) : null;
  if ( recipe && !source ) throw new CraftError(game.i18n.localize("GRIDCRAFTER.Errors.ResultGone", { name: recipe.result.name }));
  // Refs now: the spend below may delete the documents they describe.
  const ingredients = used.map(toItemRef);
  // Refused before anything is spent or learned, and before preCraft: only a craft that can really
  // happen is offered for veto. Saying what is missing gives the recipe away, and that is meant: the
  // character has found it and lacks the means.
  if ( recipe && !hasRequiredItem(recipe.variants[variant], actor) ) {
    return settle(actor, { state: "missing", recipe, variant, item: null, lost: false },
      { ingredients, used, item: source, quantity: recipe.quantity });
  }
  // Another package may veto the craft. Fired before any write, so a veto costs nothing. The listener
  // explains itself through veto.reason and the table shows it, so the player always gets exactly one
  // message, never silence and never two.
  const veto = { reason: "" };
  if ( Hooks.call(`${MODULE_ID}.preCraft`, actor, recipe ? foundry.utils.deepClone(recipe) : null, used, veto, variant) === false ) {
    const reason = (typeof veto.reason === "string") && veto.reason.trim();
    throw new CraftError(reason || game.i18n.localize("GRIDCRAFTER.Errors.Vetoed"));
  }
  if ( recipe ) {
    // From the variant, not the grid: its refs point at world or compendium items that outlive the spend.
    const receipt = { parts: foundry.utils.deepClone(recipe.variants[variant].cells.filter(Boolean)),
      per: recipe.quantity, count: recipe.quantity };
    const { items, missing } = await forge(actor, usage, [{ source, quantity: recipe.quantity, receipt }]);
    const item = items?.[0];
    if ( !item ) {
      const incomplete = missing.length > 0;
      // The card shows the result that did not arrive, and on an incomplete craft only what stayed spent.
      return settle(actor, { state: incomplete ? "incomplete" : "refused", recipe, variant, item: null, lost: false }, {
        ingredients, item: source, quantity: recipe.quantity,
        used: incomplete ? used.filter(d => missing.includes(d.id)) : used
      });
    }
    await learnRecipes(actor, [recipe.id]);
    return settle(actor, { state: "success", recipe, variant, item, lost: false }, { ingredients, used, quantity: recipe.quantity });
  }

  const near = findNearRecipe(cells, usable);
  const chance = near?.failLossChance ?? game.settings.get(MODULE_ID, SETTING_FAIL_LOSS_CHANCE);
  const lost = (chance > 0) && usage.size && ((Math.random() * 100) < chance);
  if ( lost ) await foundry.documents.modifyBatch(consumeOperations(actor, usage));
  return settle(actor, { state: "failure", recipe: null, variant: null, item: null, lost: !!lost }, { ingredients, used, chance });
}

/**
 * Post the craft report, tell other packages, and hand the outcome back to the table. One place for
 * all three, so the chat card and the hook can never disagree about what happened.
 * @param {Actor} actor
 * @param {CraftOutcome} outcome
 * @param {object} card
 * @param {import("./helpers.js").ItemRef[]} card.ingredients   for the hook, as plain refs: spent ones
 *   no longer exist as documents
 * @param {Item} [card.item]   overrides the outcome's item on the card only
 * @returns {Promise<CraftOutcome>}
 */
async function settle(actor, outcome, { ingredients, ...card }) {
  await report({ actor, ...outcome, ...card });
  Hooks.callAll(`${MODULE_ID}.craft`, actor, {
    ...outcome,
    recipe: outcome.recipe ? foundry.utils.deepClone(outcome.recipe) : null,
    ingredients
  });
  return outcome;
}

/**
 * Break the item in the table's circle into the parts its dismantling recipe names, for the current
 * user's crafting actor. Anything that spends nothing and posts no card is thrown as a CraftError.
 * @param {import("./helpers.js").ItemRef} ref
 * @returns {Promise<DismantleOutcome>}
 */
export async function dismantle(ref) {
  const actor = getCraftingActor();
  if ( !actor ) throw noActorError();
  const doc = await fromUuid(ref.uuid);
  if ( !doc ) throw new CraftError(game.i18n.localize("GRIDCRAFTER.Errors.ItemGone", { name: ref.name }));
  // Only the crafting actor's own items, for a GM too: breaking a directory or compendium item would
  // make parts out of nothing.
  const origin = itemOrigin(doc);
  if ( origin !== "actor" ) throw new CraftError(game.i18n.localize("GRIDCRAFTER.Errors.NotFromInventory", { name: doc.name }));
  if ( doc.parent.uuid !== actor.uuid ) {
    throw new CraftError(game.i18n.localize("GRIDCRAFTER.Errors.NotYourCharacter", { name: doc.name }));
  }
  if ( !doc.isOwner ) throw new CraftError(game.i18n.localize("GRIDCRAFTER.Errors.NotOwner", { name: doc.name }));

  // An item no recipe the actor may use covers is refused for free: no loss, no card, so trying an
  // item gives nothing away.
  const item = toItemRef(doc);
  const known = new Set(getKnownRecipeIds(actor));
  const recipe = getAllRecipes().find(r => (r.kind === "dismantle") && (known.has(r.id) || isDiscoverable(r))
    && refMatches(r.input, item));
  if ( !recipe ) throw new CraftError(game.i18n.localize("GRIDCRAFTER.Errors.CannotDismantle", { name: doc.name }));

  // The units come from the item in the circle first, then from other copies on the sheet: a system
  // without quantities keeps one document per copy.
  const usage = new Map();
  let need = recipe.inputQuantity;
  for ( const candidate of [doc, ...actor.items.filter(i => (i.id !== doc.id) && refMatches(recipe.input, toItemRef(i)))] ) {
    const count = Math.min(getQuantity(candidate) ?? 1, need);
    if ( count <= 0 ) continue;
    usage.set(candidate.uuid, { doc: candidate, count });
    need -= count;
    if ( !need ) break;
  }
  if ( need > 0 ) throw new CraftError(game.i18n.localize("GRIDCRAFTER.Errors.NotEnough", { name: doc.name }));

  // One output per distinct part: two cells of Iron are one output of two units.
  const parts = [];
  for ( const cell of recipe.outputs ) {
    if ( !cell ) continue;
    const same = parts.find(p => p.ref.uuid === cell.uuid);
    if ( same ) same.quantity++;
    else parts.push({ ref: cell, quantity: 1 });
  }
  const sources = await Promise.all(parts.map(p => fromUuid(p.ref.uuid)));
  const gone = parts.find((p, i) => !sources[i]);
  if ( gone ) throw new CraftError(game.i18n.localize("GRIDCRAFTER.Errors.ResultGone", { name: gone.ref.name }));

  // Refs now: the spend below may delete the documents they describe.
  const spent = [...usage.values()].map(({ doc, count }) => ({ id: doc.id, name: doc.name, img: doc.img, count }));
  const card = { item, spent };
  // As with crafting, refused before anything is spent and before preDismantle, and saying what is
  // missing gives the recipe away on purpose.
  if ( !hasRequiredItem(recipe, actor) ) return settleDismantle(actor, { state: "missing", recipe, items: null }, card);
  const veto = { reason: "" };
  if ( Hooks.call(`${MODULE_ID}.preDismantle`, actor, foundry.utils.deepClone(recipe), doc, veto) === false ) {
    const reason = (typeof veto.reason === "string") && veto.reason.trim();
    throw new CraftError(reason || game.i18n.localize("GRIDCRAFTER.Errors.Vetoed"));
  }

  const { items, missing } = await forge(actor, usage, parts.map((p, i) => ({ source: sources[i], quantity: p.quantity })));
  if ( !items ) {
    const incomplete = missing.length > 0;
    // On an incomplete dismantle the card lists only what stayed spent.
    return settleDismantle(actor, { state: incomplete ? "incomplete" : "refused", recipe, items: null },
      { item, spent: incomplete ? spent.filter(s => missing.includes(s.id)) : spent });
  }
  await learnRecipes(actor, [recipe.id]);
  return settleDismantle(actor, { state: "success", recipe, items }, {
    ...card, received: items.map((it, i) => ({ name: it.name, img: it.img, count: parts[i].quantity }))
  });
}

/**
 * Post the dismantle report, then tell other packages. Its own hook: a listener that rewards crafting
 * must not reward breaking things.
 * @param {Actor} actor
 * @param {DismantleOutcome} outcome
 * @param {object} card
 * @param {import("./helpers.js").ItemRef} card.item   the item in the circle, as a plain ref: spent, it
 *   no longer exists as a document
 * @param {{name: string, img: string, count: number}[]} card.spent
 * @param {{name: string, img: string, count: number}[]} [card.received]
 * @returns {Promise<DismantleOutcome>}
 */
async function settleDismantle(actor, outcome, { item, spent, received }) {
  const { state, recipe } = outcome;
  const requires = recipe.requires;
  const content = await foundry.applications.handlebars.renderTemplate(`${TEMPLATE_PATH}/dismantle-card.hbs`, {
    theme: getTheme(),
    state,
    success: state === "success",
    spent: (state === "success") || (state === "incomplete"),
    actorName: actor.name,
    itemName: item.name,
    inputs: spent,
    received,
    required: (requires && ["success", "missing"].includes(state)) ? {
      img: requires.img,
      label: game.i18n.localize(`GRIDCRAFTER.Chat.${(state === "missing") ? "Requires" : "MadeWith"}`, { name: requires.name })
    } : null
  });
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content
  });
  Hooks.callAll(`${MODULE_ID}.dismantle`, actor, { ...outcome, recipe: foundry.utils.deepClone(recipe), item });
  return outcome;
}

/**
 * Spend the ingredients, then give the actor what they make. If the actor does not take all of it,
 * put the ingredients back.
 *
 * Spending comes first so a system that limits inventory (slots, weight) measures the outputs against
 * the room the ingredients leave behind. That is also why nothing is checked beforehand with a dryRun:
 * it would run the system's checks against the inventory before the spend, and refuse a sword that
 * fits once its ingots are gone. It has to be separate writes: a modifyBatch is not atomic,
 * and core runs every operation's pre-workflow against the state before the batch, then silently
 * drops an operation a system emptied in _preCreateOperation while sending the rest.
 * @param {Actor} actor
 * @param {Map<string, {doc: Item, count: number}>} usage
 * @param {{source: Item, quantity: number, receipt?: import("./receipts.js").Receipt}[]} outputs   each as
 *   it exists in the world or a compendium, with what was spent on it when it was crafted
 * @returns {Promise<{items: Item[]|null, missing?: string[]}>}  the items that received each output, or
 *   null when the actor refused them; then the ids of the ingredients that could not be put back
 */
async function forge(actor, usage, outputs) {
  // Copied before spending: after an update the document's source already holds the new quantity.
  const before = [...usage.values()].map(({ doc }) => doc.toObject());
  const operations = consumeOperations(actor, usage);
  if ( operations.length ) await foundry.documents.modifyBatch(operations);

  let items = null;
  try {
    items = await deliver(actor, usage, outputs);
  } catch(err) {
    console.error(`${MODULE_ID} | Could not give ${outputs.map(o => o.source.name).join(", ")} to ${actor.name}.`, err);
  }
  if ( items ) return { items };

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
  return { items: null, missing };
}

/**
 * Give the actor every output at once: onto stacks of it the actor already carries, where the system
 * counts quantities, and as new items otherwise. A system may refuse or trim either write (fewer copies,
 * a smaller quantity); anything short of all of it is undone and counts as a refusal.
 * @param {Actor} actor
 * @param {Map<string, {doc: Item, count: number}>} usage   spent items, never stacked onto: putting them
 *   back would undo the output
 * @param {{source: Item, quantity: number, receipt?: import("./receipts.js").Receipt}[]} outputs
 * @returns {Promise<Item[]|null>}   the items that received each output, in order; null when refused
 */
async function deliver(actor, usage, outputs) {
  const path = game.settings.get(MODULE_ID, SETTING_QUANTITY_PATH);
  const key = `flags.${MODULE_ID}.${FLAG_RECEIPTS}`;
  /**
   * `receipts` is what the stack is written with, null when no output brought one; `before` is the raw
   * flag, for the rollback.
   * @type {Map<string, {doc: Item, was: number, add: number, receipts: object[]|null, before: object[]}>}
   */
  const stacks = new Map();
  const batch = [];
  const plan = outputs.map(({ source, quantity, receipt }) => {
    const sourceRef = toItemRef(source);
    // Stack onto a copy of the same item the actor already carries, when the system counts quantities.
    const stack = actor.items.find(i => !usage.has(i.uuid) && (getQuantity(i) !== null)
      && sourceRef.sources.some(s => toItemRef(i).sources.includes(s)));
    if ( stack ) {
      const entry = stacks.get(stack.id) ?? { doc: stack, was: getQuantity(stack), add: 0, receipts: null,
        before: stack.getFlag(MODULE_ID, FLAG_RECEIPTS) ?? [] };
      entry.add += quantity;
      if ( receipt ) entry.receipts = addReceipt(entry.receipts ?? getReceipts(stack), receipt);
      stacks.set(stack.id, entry);
      return { stack };
    }
    const data = source.toObject();
    for ( const key of ["_id", "folder", "sort", "ownership"] ) delete data[key];
    // Record where the copy came from, as Foundry does for an import or a clone, so the next craft can
    // stack onto it and recipes that use it as an ingredient recognise it.
    if ( source.pack ) foundry.utils.setProperty(data, "_stats.compendiumSource", source.uuid);
    else foundry.utils.setProperty(data, "_stats.duplicateSource", source.uuid);
    const counted = getQuantity(source) !== null;
    // A world item used as the source may carry receipts of its own; a copy carries only what it cost.
    // Where the system counts no quantities, each copy is its own document and covers itself.
    foundry.utils.setProperty(data, key, receipt ? [counted ? receipt : { ...receipt, count: 1 }] : []);
    const index = batch.length;
    if ( counted ) {
      foundry.utils.setProperty(data, path, quantity);
      batch.push(data);
    }
    else batch.push(...Array.from({ length: quantity }, () => foundry.utils.deepClone(data)));
    return { index, counted, quantity };
  });

  let created = [];
  let delivered = false;
  try {
    if ( stacks.size ) {
      // One write per stack for both, so the trim in preUpdateItem measures the receipts against the new quantity.
      await actor.updateEmbeddedDocuments("Item", [...stacks.values()].map(s => ({
        _id: s.doc.id, [path]: s.was + s.add, ...(s.receipts ? { [key]: s.receipts } : {})
      })));
      if ( ![...stacks.values()].every(s => getQuantity(s.doc) === s.was + s.add) ) return null;
    }
    if ( batch.length ) {
      // createEmbeddedDocuments returns [] when the system empties the batch, and only what was kept when
      // it trims it. What is kept need not be the first ones (cairn2e drops whatever doesn't fit), so
      // what came back pairs with what was sent only once all of it came back.
      created = await actor.createEmbeddedDocuments("Item", batch);
      if ( created.length !== batch.length ) return null;
      if ( !plan.every(p => p.stack || !p.counted || (getQuantity(created[p.index]) === p.quantity)) ) return null;
    }
    delivered = true;
    return plan.map(p => p.stack ?? created[p.index]);
  } finally {
    if ( !delivered ) {
      if ( created.length ) await actor.deleteEmbeddedDocuments("Item", created.map(i => i.id));
      // The flag goes back as an empty list, never a deletion key, when the stack had none.
      const back = [...stacks.values()].filter(s => s.receipts || (getQuantity(s.doc) !== s.was))
        .map(s => ({ _id: s.doc.id, [path]: s.was, ...(s.receipts ? { [key]: s.before } : {}) }));
      if ( back.length ) await actor.updateEmbeddedDocuments("Item", back);
    }
  }
}

/**
 * Put spent ingredients back as they were before the craft: deleted ones recreated with their own ids,
 * so the grid's references stay valid, and decremented ones returned to their old quantity and their
 * receipts, which the spend trimmed.
 * @param {Actor} actor
 * @param {object[]} before   the ingredients' source data, copied before spending
 */
async function restore(actor, before) {
  const path = game.settings.get(MODULE_ID, SETTING_QUANTITY_PATH);
  const key = `flags.${MODULE_ID}.${FLAG_RECEIPTS}`;
  const data = before.filter(d => !actor.items.has(d._id));
  const updates = before.filter(d => actor.items.has(d._id))
    .map(d => ({ _id: d._id, [path]: getQuantity(d), [key]: foundry.utils.getProperty(d, key) ?? [] }));
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
    recipes: recipes.map(recipeFace)
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
 * @param {"success"|"failure"|"refused"|"incomplete"|"missing"} data.state
 */
async function report({ actor, state, recipe, variant, used, item, quantity, lost, chance }) {
  const requires = recipe?.variants[variant].requires;
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
    // On a success it is a quiet note; on "missing" it is the reason for the card.
    required: (requires && ["success", "missing"].includes(state)) ? {
      img: requires.img,
      label: game.i18n.localize(`GRIDCRAFTER.Chat.${(state === "missing") ? "Requires" : "MadeWith"}`,
        { name: requires.name })
    } : null,
    lost,
    chance
  });
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content
  });
}

/**
 * Items on the actor that satisfy each cell of a variant, for filling the grid from the recipe book.
 * The same stack may fill several cells while its quantity lasts.
 * @param {import("./recipes.js").Variant} variant
 * @param {Actor} actor
 * @returns {(import("./helpers.js").ItemRef|null)[]|null}   null when the actor lacks something
 */
export function fillFromInventory(variant, actor) {
  const left = new Map(actor.items.map(i => [i.id, getQuantity(i) ?? 1]));
  const refs = new Map(actor.items.map(i => [i.id, toItemRef(i)]));
  const out = [];
  for ( const ing of variant.cells ) {
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
