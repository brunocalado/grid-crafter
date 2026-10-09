# Grid Crafter API

Ship a ready-made recipe book with your module or system. The recipes you register appear on
every crafting table, in the GM's Recipe Book (marked with your package's name) and in each
character's recipe book once it crafts them, with no setup from the GM.

The API is available as `GridCrafter` and as `game.modules.get("grid-crafter").api`.

- [Quick start](#quick-start)
- [When to register](#when-to-register)
- [Hooks](#hooks)
- [Recipe format](#recipe-format)
- [How items are matched](#how-items-are-matched)
- [Reference](#reference)
- [What the GM can do with your recipes](#what-the-gm-can-do-with-your-recipes)
- [Full example: a module with its own compendium](#full-example-a-module-with-its-own-compendium)

---

## Quick start

```js
Hooks.once("ready", () => {
  if ( !game.modules.get("grid-crafter")?.active ) return;

  GridCrafter.registerRecipes("my-module", [
    {
      id: "iron-sword",
      name: "Iron Sword",
      shaped: true,
      cells: [
        [null, "Compendium.my-module.materials.Item.ironIngot000001", null],
        [null, "Compendium.my-module.materials.Item.ironIngot000001", null],
        [null, "Compendium.my-module.materials.Item.woodenStick00001", null]
      ],
      result: "Compendium.my-module.gear.Item.ironSword0000001"
    }
  ]);
});
```

That's all. A player who puts two iron ingots over a stick, anywhere on the 3×3 grid, forges an
Iron Sword.

---

## When to register

Register from a **`ready`** hook. By then compendium indexes are loaded, which the API needs to
turn your uuids into names and icons.

Registered recipes live **in memory only**: they are not saved in the world. Your `ready` hook
runs on every client each time the world loads, so every player and the GM register the same
recipes. Don't register only on the GM's client.

Grid Crafter also fires a hook once its own `ready` work is done, and passes the API:

```js
// At the top level of your script (or in "init"), so the listener exists before the hook fires.
Hooks.once("grid-crafter.ready", api => {
  api.registerRecipes("my-module", MY_RECIPES);
});
```

Either way works. The hook only fires when Grid Crafter is active, so you don't need to check.

---

## Hooks

Four hooks let your module, system or macro act on crafting and dismantling: stop one before it
happens, or react once it has settled. Grid Crafter knows nothing about XP, downtime or skill
checks; these hooks are where you add them. A dismantle fires only the dismantling hooks and a craft
only the crafting ones, so a listener that rewards crafting never rewards breaking things.

| Hook | Args | Notes |
|---|---|---|
| `grid-crafter.preCraft` | `actor`, `recipe` (a copy, or `null` when the layout matches no recipe the actor can make), `items` (`Item[]` on the grid, one entry per filled cell), `veto` (`{ reason }`), `variant` (the index in `recipe.variants` of the variant the craft uses, or `null`) | Return `false` to cancel, and set `veto.reason` to tell the player why. Synchronous: an awaited roll inside it does not delay the craft. |
| `grid-crafter.craft` | `actor`, `result` `{ state, recipe, variant, item, lost, ingredients }` | `state` is `"success"`, `"failure"`, `"refused"`, `"incomplete"` or `"missing"`. `variant` is the index in `recipe.variants` of the variant the grid made, `null` on a failure. `item` is the forged Item on success, else `null`. `ingredients` are `{ uuid, name, img, type, sources }`, one per filled cell. Not fired for a vetoed craft. |
| `grid-crafter.preDismantle` | `actor`, `recipe` (a copy of the [dismantling recipe](#dismantling-recipes)), `item` (the `Item` in the table's circle), `veto` (`{ reason }`), `salvage` (`{ receipt, parts }`, what comes back) | Return `false` to cancel, and set `veto.reason` to tell the player why, as with `preCraft`. Change `salvage.parts` to change what the character receives. |
| `grid-crafter.dismantle` | `actor`, `result` `{ state, recipe, item, items, parts, receipt }` | `state` is `"success"`, `"refused"`, `"incomplete"` or `"missing"`. `item` is the item that was in the circle, as `{ uuid, name, img, type, sources }`. `items` is, on success only, the Items that received each part, one per distinct part in the order they were given; `null` otherwise. `parts` is the nine cells of the table's grid, one unit of a part per filled cell, as `{ uuid, name, img, type, sources }` or `null`. `receipt` is the [receipt](#receipts) that was broken, or `null` when the item broke into the recipe's grid. Not fired for a vetoed dismantle. |

**`grid-crafter.preCraft`** fires after Grid Crafter has checked the grid and found the recipe (or
not), and before anything is written: no item spent, no loss rolled, nothing learned, no chat card.
When a listener returns `false`, the craft stops there and the grid stays as the player left it.
A craft where the character carries the required item of none of the [variants](#variants) that
fit the grid never reaches `preCraft`: it settles as `"missing"` first.

The player who pressed Craft sees one warning: the text you put in `veto.reason`, or, when you leave
it empty, that another module or the game system stopped the craft without giving a reason. Set the
reason instead of calling `ui.notifications`
yourself, or the player gets two messages for one event:

```js
Hooks.on("grid-crafter.preCraft", (actor, recipe, items, veto) => {
  if ( !recipe ) return;                       // a layout that matches nothing: let it fail
  if ( actor.system.downtime > 0 ) return;
  veto.reason = `${actor.name} has no downtime left to forge ${recipe.name}.`;
  return false;
});
```

Set `veto.reason` only in the listener that returns `false`. Every listener gets the same `veto`
object, and a reason left behind by one that let the craft through would be shown if a later one
stops it.

**`grid-crafter.craft`** fires once per craft, after the chat card is posted, whatever the outcome.
`result.state` says which one, the same outcome the chat card shows:

| `state` | What happened |
|---|---|
| `"success"` | The result reached the character. `item` is the forged Item. |
| `"failure"` | The grid matched no recipe the character can make. `lost` is `true` when the materials were destroyed anyway. |
| `"refused"` | The recipe matched, but the character's sheet would not take the result. Nothing was spent. |
| `"incomplete"` | The materials were spent, the result never arrived, and they could not be put back. |
| `"missing"` | The grid fits the recipe, but the character doesn't carry the item `requires` names for any variant that fits. Nothing was spent and nothing was learned. |

A craft stopped by `preCraft` fires nothing here. The ingredients are passed as plain data,
because the spent ones no longer exist.

```js
Hooks.on("grid-crafter.craft", (actor, result) => {
  if ( result.state === "success" ) actor.update({ "system.xp": actor.system.xp + 10 });
});
```

**`grid-crafter.preDismantle`** fires once Grid Crafter has found the dismantling recipe, checked
that the character carries enough of the item and the required item, and before anything is
written. A character who lacks the required item never reaches it: the dismantle settles as
`"missing"` first. An item that no recipe the character may use covers never reaches it either:
the table refuses it as soon as it is dropped in the circle, telling the player it "can't be
dismantled", and nothing is spent, posted or fired. A vetoed dismantle with no `veto.reason` tells
the player that another module or the game system stopped it.

```js
Hooks.on("grid-crafter.preDismantle", (actor, recipe, item, veto) => {
  if ( !item.system.magic ) return;
  veto.reason = `${item.name} resists being taken apart.`;
  return false;
});
```

Its fifth argument, `salvage`, is what the dismantle is about to give. `salvage.receipt` is a copy of
the [receipt](#receipts) being broken, or `null` when the item breaks into the recipe's grid.
`salvage.parts` is one entry per distinct part, `{ uuid, name, img, quantity }`. Change the
quantities, remove entries or add your own, and the character receives exactly what the list holds
when the last listener returns. Grid Crafter knows nothing about skill checks or how fair a full
refund is at your table; this is where you decide.

```js
// Half the parts, rounded down
Hooks.on("grid-crafter.preDismantle", (actor, recipe, item, veto, salvage) => {
  for ( const p of salvage.parts ) p.quantity = Math.floor(p.quantity / 2);
});

// What the table didn't make gives nothing back
Hooks.on("grid-crafter.preDismantle", (actor, recipe, item, veto, salvage) => {
  if ( !salvage.receipt ) salvage.parts.length = 0;
});
```

The list is checked after the hook, before anything is written. An entry without a string `uuid` or
a whole `quantity` above 0 is dropped. A `uuid` that doesn't resolve to an item refuses the
dismantle, and nothing is spent. An empty list is allowed: the item is spent and nothing comes back.
A listener changes what comes back, never what is spent, and it can't pick another receipt.

**`grid-crafter.dismantle`** fires once per dismantle, after the chat card is posted:

| `state` | What happened |
|---|---|
| `"success"` | Every part reached the character. `items` are the Items that received them. |
| `"refused"` | The character's sheet would not take all the parts. Nothing was spent. |
| `"incomplete"` | The item was spent, the parts never arrived, and it could not be put back. |
| `"missing"` | The character doesn't carry the item the recipe `requires`. Nothing was spent and nothing was learned. |

All four hooks fire **only on the client of the user who pressed Craft or Dismantle**, not on the
GM's or anyone else's. That user owns the actor (Grid Crafter refuses items they don't own), so a
listener can update the actor directly.

---

## Recipe format

A recipe is a crafting recipe, which makes one item from a grid, unless it says
`kind: "dismantle"`: a [dismantling recipe](#dismantling-recipes) breaks one item into parts. The
table below is the crafting recipe.

| Field | Required | Description |
|---|---|---|
| `id` | yes | Your id for the recipe, unique within your package. Grid Crafter stores it as `"<packageId>.<id>"`. **Keep it stable**: players' recipe books remember recipes by this id. |
| `kind` | no | `"craft"` (default) or `"dismantle"`. Any other value skips the recipe. |
| `cells` | yes, or `variants` | The 3×3 grid: either a flat list of 9 entries (row by row) or 3 rows of 3. Each entry is an item uuid or `null` for an empty cell. At least one cell must hold an item. With `requires`, the shorthand for a recipe with one variant. |
| `variants` | yes, or `cells` | 1 to 4 ways to make the recipe, each `{ cells, requires }` with the meaning of those two fields. See [Variants](#variants). Give either `variants` or `cells` and `requires`, never both. |
| `result` | yes | The uuid of the item the recipe makes: a world item or a compendium item. A copy of it goes to the crafter's character sheet. |
| `name` | no | Name shown in the recipe books, at most 40 characters (longer text is cut). Defaults to the result item's name. |
| `categories` | no | A list of group names, each at most 24 characters (longer text is cut). The recipe books list the recipe under each one. A name no recipe uses yet starts a new category; one that matches an existing category apart from case or accents takes that category's spelling. Default none. |
| `shaped` | no | `true` (default): items must keep their positions. `false`: only which items, not where. Holds for every variant. |
| `quantity` | no | How many of the result one craft makes, 1 to 10. Default `1`. |
| `failLossChance` | no | Percent chance (0–100) that a failed attempt destroys the materials. Leave it out to use the GM's world setting. |
| `public` | no | `true`: every character knows the recipe until the GM makes it private. Default `false`. |
| `discoverable` | no | Whether a character who doesn't know the recipe can make it by laying out its ingredients. `true` or `false` overrides the GM's world setting; leave it out to follow that setting. |
| `requires` | no | The uuid of one item the character must carry to make the recipe: a tool, a feature, a proficiency, any type. It is never placed on the grid and never spent. A copy on the sheet counts, matched by its source or by name and type. Without it the craft is refused with a chat card. An unresolvable uuid drops the variant it belongs to. |

### Shaped recipes

A shaped pattern matches **wherever it sits on the grid**, exactly as drawn: it is never mirrored.
Only the cells that hold something count, so this sword:

```js
cells: [
  [null, INGOT, null],
  [null, INGOT, null],
  [null, STICK, null]
]
```

is also crafted with the column against the left or right edge. A 2×2 pattern can sit in any of
the four corners.

### Shapeless recipes

```js
{
  id: "healing-draught",
  shaped: false,
  cells: [HERB, HERB, WATER, null, null, null, null, null, null],
  result: DRAUGHT,
  quantity: 2
}
```

For a shapeless recipe, the positions in `cells` don't matter. Two herbs and a flask of water
anywhere on the grid make two draughts.

### Variants

An item can often be made more than one way. An axe forged from iron and an axe knapped from stone
are the same axe, and only the iron one needs Smithing Tools. Give them as two variants of one
recipe instead of two recipes:

```js
{
  id: "axe",
  result: AXE,
  variants: [
    {
      cells: [
        [IRON, IRON, null],
        [null, STICK, null],
        [null, STICK, null]
      ],
      requires: SMITHING_TOOLS
    },
    {
      cells: [
        [STONE, STONE, null],
        [null, LEATHER_STRIP, null],
        [null, STICK, null]
      ]
    }
  ]
}
```

A recipe has 1 to 4 variants. Each brings its own `cells` and its own `requires`; everything else
(the name, the result, `quantity`, `categories`, `shaped`, `failLossChance`, `public`,
`discoverable`) belongs to the recipe and holds for every variant.

Knowing the recipe is knowing all its variants. Forging any of them, being taught or Learn adds the
whole recipe to a character's book, and the book shows each variant as a row under the recipe's
name. When the grid fits more than one variant, the craft uses the first one whose required item
the character carries, and settles as `"missing"` when the character carries none of them.

`cells` and `requires` at the top level are a recipe with one variant. `getRecipes()` always
returns `variants`.

A variant may carry an `id`, a string unique within its recipe. Without one it gets `v0`, `v1` and
so on, by its place in the list you register, so the same variant has the same id on every load.
A [dismantling recipe's `favorite`](#dismantling-recipes) points at a variant by this id.

### One grid, one recipe

A layout on the grid makes one recipe at most, whatever the results. Two variants of different
recipes overlap when one grid could fill both:

- both are shaped and have the same pattern, wherever it sits (a mirrored pattern is a different
  one);
- either is shapeless and they hold the same items, because a shapeless variant takes any layout.

The required item never counts: a character may carry both tools. Hidden recipes count too.

`registerRecipes` drops a variant whose grid a recipe already present makes, with a warning in the
console naming that recipe. The world's recipes are there before any package registers, so they
always keep their grids; between packages, the first to register keeps it. The GM's Recipe Book
refuses to save a recipe whose grid another one already makes.

Variants of the same recipe may overlap each other, for instance the same layout with two
different tools.

### Quantity

Each grid cell spends one unit of the item placed in it. With `quantity`:

- if the result item has a quantity (at the path the GM set, `system.quantity` by default), the
  character receives one stack of that size, added to a stack they already carry when there is
  one;
- otherwise, the character receives that many separate copies.

### Inventory limits

Grid Crafter spends the ingredients first, then gives the character the result. If the actor
doesn't take all of it, the ingredients are put back, nothing is spent, and the chat reports that
the result didn't fit. So a system that limits inventory needs no hook for Grid Crafter: refusing
the write is enough.

- Refuse or trim the **create** in your Item's `_preCreateOperation` (or `_preCreate`), or the
  **update** of a stack in `_preUpdate`. Fewer copies or a smaller quantity than the recipe makes
  counts as a refusal too, and whatever was added is removed again.
- Because the ingredients are already gone when the result arrives, the room they occupied is free:
  three ingots in a full pack can become a sword.
- Deleted ingredients come back with their own ids, so your create workflow runs for them again.

Dismantling works the same way. The item is spent first, then every part is given at once: one
update for the stacks the character already carries and one create for the rest. If the sheet
refuses or trims any of it, everything that arrived is removed again and the item comes back with
its own id. A full inventory never loses the item, and breaking a sword makes room for its parts.

### Failure

A failed craft counts against your recipe when the grid holds **the items of one of your recipe's
variants in the wrong shape**. Then your `failLossChance` applies. Any other failure uses the GM's world setting, and so
does a layout of a recipe the character doesn't know and can't discover: that fails like any wrong
layout and gives nothing away.

### Dismantling recipes

A dismantling recipe breaks one item into the parts it names. The character puts the item in the
crafting table's circle, presses **Dismantle**, and the parts land on the grid as items on their
sheet. It has no variants, no shape, no quantity made and no chance of loss.

| Field | Required | Description |
|---|---|---|
| `id` | yes | As for a crafting recipe. |
| `kind` | yes | `"dismantle"`. |
| `input` | yes | The uuid of the item that is broken. The character's copy is matched as [ingredients are](#how-items-are-matched). |
| `outputs` | yes | 1 to 9 item uuids, one per unit of a part: repeat a uuid for more than one. The table lays them out in this order, left to right and top to bottom, though where a part lands never matters. |
| `inputQuantity` | no | How many units of `input` one dismantling spends, 1 to 10. Default `1`. |
| `requires` | no | As for a crafting recipe: an item the character must carry, never spent. Without it the dismantle is refused with a chat card. |
| `refund` | no | `true`: an item made at the table breaks back into exactly what was spent on it, as its [receipt](#receipts) says. Default `false`. |
| `favorite` | no | `{ recipe, variant }`: a crafting recipe's full id, as `getRecipes()` lists it (`"my-module.axe"`), and the id of one of its [variants](#variants). An item with no receipt breaks into that variant's cells, and one dismantle spends as many units as that recipe's `quantity`. Read live, so a change to the variant changes the dismantle. Never checked when registered: the recipe it names may register later. |
| `name` | no | Defaults to the input item's name. At most 40 characters, as for a crafting recipe. |
| `categories`, `public`, `discoverable` | no | As for a crafting recipe. |

The fields of a crafting recipe (`cells`, `variants`, `result`, `shaped`, `quantity`,
`failLossChance`) are ignored on a dismantling recipe.

```js
{
  id: "salvage-iron-sword",
  kind: "dismantle",
  input: SWORD,
  outputs: [INGOT, INGOT, STICK],
  requires: SMITHING_TOOLS
}
```

What an item breaks into, in order:

1. With `refund`, an item that carries a receipt breaks into exactly what that receipt says.
2. Otherwise, with a `favorite` that still resolves, it breaks into that way of making it.
3. Otherwise, into `outputs`.

`outputs` stays required even with a `favorite`: it is what the item breaks into if that crafting
recipe or variant is ever removed. The GM's Recipe Book saves the favorite's cells into `outputs`
each time, so the copy is current.

Breaking the sword spends it and gives two ingots and a stick. Each distinct part is given once:
where the part has a quantity the character receives one stack (added to a stack they carry), and
otherwise that many separate copies.

The units come from the item in the circle first, then from other copies of it the character
carries, so a system without quantities can spend `inputQuantity` copies. Only the crafting
character's own items can be dismantled, for a GM too: an item from the Items directory or a
compendium would make parts out of nothing.

A character knows a dismantling recipe as it knows a crafting one: by learning it, because it is
public, or by discovering it. Dismantling an item whose recipe the character doesn't know but can
discover teaches it.

### One item, one dismantling recipe

An item has one dismantling recipe at most. Two dismantling recipes clash when their `input` items
match each other as [items are matched](#how-items-are-matched). Hidden recipes count.

`registerRecipes` skips a dismantling recipe whose item already has one, with a warning in the
console naming the recipe that keeps it. As with grids, the world's recipes are there before any
package registers; between packages, the first to register keeps the item. The GM's Recipe Book
refuses to save a second dismantling recipe for an item.

### Receipts

An item made at the table carries what was spent on it, so a dismantling recipe with `refund` can
give back exactly that, whichever variant made it. Without receipts, an axe made from stone and
broken by a recipe written from the iron variant would give iron.

The receipts sit on the item, oldest first, under the flag `flags.grid-crafter.receipts`:

| Field | Description |
|---|---|
| `parts` | What one craft spent, one `{ uuid, name, img, type, sources }` per unit, as the variant names them (world or compendium items, which outlive the spend). |
| `per` | How many units one craft made. One dismantle of this receipt breaks that many. |
| `count` | How many units of the stack the receipt still covers. |

Crafting onto a stack the character already carries adds a receipt to it; the same variant twice in
a row makes one receipt with a larger `count`. On a system without quantities each copy is its own
item and carries `[{ ..., count: 1 }]`.

A stack can hold crafted and bought units on one line. Systems merge items into a stack on their
own: dnd5e merges a consumable dropped onto a sheet that has one from the same source, with the same name,
in the same container, and
Daggerheart merges an item moved from another actor (measured on dnd5e 6.0.5 and Daggerheart
2.10.10). That is safe: a merge raises the quantity and adds no receipt, so the new units are
covered by none. Coverage never exceeds the stack's quantity. When a stack shrinks, the oldest
receipts give way first, in the same write, so units used up and then bought again are not covered
again.

A dismantle with `refund` breaks the oldest receipt of the item in the circle whose units reach its
`per`, taking those units from the item in the circle and then from other copies with a receipt for
the same parts. A receipt covering fewer units than `per` is left alone, and those units break as if
bought. Units under no receipt break into the `favorite` or `outputs`.

Copying an item between actors copies its receipts too (dnd5e copies an item dropped from another
actor's sheet; the system has already duplicated the item itself). Read, set and clear receipts with
[`getReceipts`](#getreceiptsitem--object), [`setReceipts`](#setreceiptsitem-receipts--promise) and
[`clearReceipts`](#clearreceiptsitem--promise), for a shop, a trade or anything else that knows
which units changed hands.

---

## How items are matched

A player crafts with the items on their own character's sheet, which are copies, not your
compendium documents. Players can't put items from the Items directory or a compendium on the
grid; only the GM can. An item on the grid counts as an ingredient when:

1. it **comes from** the ingredient: Foundry records the source of an item copied from a
   compendium (`_stats.compendiumSource`) or duplicated from a world item
   (`_stats.duplicateSource`), and Grid Crafter compares those; or
2. failing that, it has the **same name and item type**.

So recipes keep working for items a GM created by hand, as long as the name and type match. Point
your recipes at the same compendium items you hand out to players, and matching is exact.

The GM's **Craftable Item Types** setting still applies: an item whose type the GM has not
allowed can't be dragged onto the grid, even when your recipe uses it. Pick ingredient types a
GM would allow (materials, loot, consumables), not classes or features. The setting doesn't apply
to an item put in the circle to be dismantled, nor to the parts it gives.

---

## Reference

### `registerRecipes(packageId, recipes)` → `number`

Registers recipes for your package and returns how many were accepted.

- `packageId` *(string)*: your module's or system's id. It labels the recipes in the GM's
  Recipe Book and prefixes their ids.
- `recipes` *(object[])*: recipes in the [format above](#recipe-format).

Each problem is reported with a warning in the console, and the rest are registered:

- A recipe is skipped when it has no `id`, gives both `variants` and `cells` or `requires`, has no
  variant or more than 4, or its `result` can't be found.
- A variant is dropped when it doesn't have 9 cells, holds no item, names an item that can't be
  found in `cells` or `requires`, or its grid already belongs to another recipe (see
  [One grid, one recipe](#one-grid-one-recipe)). A recipe left with no variant is skipped.
- A recipe given with `cells` has one variant, so any of those problems skips it.
- A recipe with a `kind` other than `"craft"` or `"dismantle"` is skipped.
- A dismantling recipe is skipped when its `input` can't be found, it has no output or more than 9,
  an output or its `requires` can't be found, or its item already has a dismantling recipe (see
  [One item, one dismantling recipe](#one-item-one-dismantling-recipe)).

Registering an `id` you already registered replaces that recipe.

### `unregisterRecipes(packageId)`

Removes every recipe your package registered, on this client.

### `getRecipes()` → `object[]`

Every recipe on this client: the world's recipes first, then registered ones. Tell the two shapes
apart by `kind`: `"dismantle"` for a dismantling recipe, `"craft"` for a crafting one.

A crafting recipe has `id`, `kind`,
`name`, `categories` (a list, empty when none), `shaped`, `variants` (1 to 4, each with its `id`, `cells`, 9
entries that are `{ uuid, name, img, type, sources }` or `null`, and `requires`, the required item
as the same object or `null`), `result`, `quantity`, `failLossChance` (`null` when it follows the
world setting), `source`
(`"world"` or the package id), `public` (whether every character knows it) and `discoverable`
(`null` when it follows the world setting).

A dismantling recipe has `id`, `kind`, `name`, `categories`, `input` (the item it breaks, as
`{ uuid, name, img, type, sources }`), `inputQuantity`, `requires` (the same object or `null`),
`outputs` (9 entries, a part as that object or `null`), `favorite` (`{ recipe, variant }` or `null`),
`refund`, `source`, `public` and `discoverable`.

A package recipe the GM edited carries `edited: true`, and its fields are the GM's version. The
objects are copies; changing them changes nothing.

### `getKnownRecipes(target)` → `string[]`

Ids of the recipes an actor knows: what its recipe book shows. That is the recipes it learned
(by crafting them, being taught, or Learn) plus every public recipe. `target` is the actor, one of
its tokens, or the uuid of either. Defaults to the current user's crafting actor — a player's
assigned character, or for a GM the first selected token, then their own character.

### `setRecipePublic(id, value)` → `Promise<boolean>` *(GM only)*

Makes a recipe public, so every character knows it, or private again. Nothing is written to the
actors: a character who learned the recipe keeps it either way, and one who only knew it because
it was public loses it from its recipe book when it turns private.

- `id` *(string)*: the recipe's id, as `getRecipes()` lists it. An unknown id is refused with a
  warning.
- `value` *(boolean, optional)*: `true` (default) for public, `false` for private.

On a package recipe this is an edit like any other: the recipe is marked edited, stops following
the package's updates, and Restore in the Recipe Book brings back the package's `public` with the
rest of it. Resolves `true` once it is saved, `false` when the call was refused.

### `isRecipePublic(id)` → `boolean`

Whether every character knows the recipe right now. `false` for an unknown id.

### `getCategories()` → `string[]`

Every category some recipe uses, world and package recipes alike, alphabetically. Use it to file
your recipes under a category the GM already has instead of starting a twin.

### `setRecipeCategories(id, categories)` → `Promise<boolean>` *(GM only)*

Replaces the categories a recipe is listed under.

- `id` *(string)*: the recipe's id, as `getRecipes()` lists it. An unknown id is refused with a
  warning.
- `categories` *(string[])*: the new list, tidied like the [recipe field](#recipe-format). A name
  not in use yet starts a new category; `[]` leaves the recipe uncategorised. Anything but a list
  of strings is refused with a warning.

On a package recipe this is an edit like any other, as with `setRecipePublic`. Resolves `true`
once it is saved, `false` when the call was refused.

### `teachRecipe(target, id)` → `Promise<boolean>`

Adds a recipe to an actor's recipe book, as if it had forged it once.

- `target` *(Actor | TokenDocument | Token | string)*: the actor, one of its tokens, or the uuid
  of either. An unlinked token learns for itself, not for the actor it was made from.
- `id` *(string)*: the recipe's id, as `getRecipes()` lists it.

Resolves `true` when the recipe was added, `false` when the actor already knew it. Only someone
who owns the actor can teach it: the GM can teach anyone, and a player can teach their own
character, for instance from a macro on a scroll item.

```js
// Teach every selected token
for ( const token of canvas.tokens.controlled ) await GridCrafter.teachRecipe(token, "iron-sword");
```

### `forgetRecipe(target, id)` → `Promise<boolean>`

Removes a recipe from an actor's recipe book. Takes the same `target` as `teachRecipe`, and works
for a recipe that no longer exists.

Resolves `true` when the recipe was removed, `false` when the actor didn't know it. Only someone
who owns the actor can make it forget.

### `shareRecipe(id, userIds)` → `Promise` *(GM only)*

Shows a recipe to players online — its name, its pattern and what it makes — as the editor's
**Share** button does. A player with a character can **Learn** it from that window, which
adds it to their character's recipe book. The GM who calls it sees the same window, without Learn.

- `id` *(string)*: the recipe's id, as `getRecipes()` lists it. An unknown id is refused with a
  warning.
- `userIds` *(string[], optional)*: the users to show it to. Defaults to every player online. GMs
  and users who aren't connected are skipped; nothing is delivered to them later.

Only the id is sent, and each player's client looks the recipe up itself, so a recipe your package
registers must be registered on every client, not only the GM's. The promise settles once every
player has answered; a player whose client couldn't show the recipe is named in a warning to the GM.

```js
// Show it to the owners of the selected tokens
const owners = game.users.filter(u => !u.isGM
  && canvas.tokens.controlled.some(t => t.actor?.testUserPermission(u, "OWNER")));
await GridCrafter.shareRecipe("smithing-pack.iron-sword", owners.map(u => u.id));
```

### `getReceipts(item)` → `object[]`

The [receipts](#receipts) of an item, oldest first, trimmed to the units it holds. `item` is an
`Item` or its uuid. The objects are copies; changing them changes nothing.

```js
const torch = game.user.character.items.getName("Torch");
console.log(GridCrafter.getReceipts(torch));
// [{ parts: [{ uuid: "Compendium.dnd5e.items.Item.0NoBBP3MMkvJlwZY", name: "Candle", ... }, ...], per: 1, count: 1 }]
```

### `setReceipts(item, receipts)` → `Promise`

Replaces an item's receipts.

- `item` *(Item | string)*: the item or its uuid.
- `receipts` *(object[])*: oldest first, each `{ parts, per, count }`: `parts` 1 to 9 item uuids,
  one per unit; `per` a whole number from 1 to 10; `count` a whole number, 0 or more.

The receipts are written trimmed to the units the item holds, the oldest giving way first. Anything
else throws an error naming the bad entry, and nothing is written. Only someone who owns the item
can change it.

```js
// One torch on this stack was made from a tinderbox and a candle
await GridCrafter.setReceipts(torch, [{
  parts: ["Compendium.dnd5e.items.Item.1FSubnBpSTDmVaYV", "Compendium.dnd5e.items.Item.0NoBBP3MMkvJlwZY"],
  per: 1,
  count: 1
}]);
```

### `clearReceipts(item)` → `Promise`

Removes every receipt from an item, which then breaks as if it had been bought. `item` is an `Item`
or its uuid.

### `forge()`

Opens the crafting table for the current user.

### `recipes()` *(GM only)*

Opens the GM's Recipe Book.

---

## What the GM can do with your recipes

Your recipes show in the GM's Recipe Book under your package's title, crafting recipes under its
**Craft** tab and dismantling recipes under **Dismantle**. The GM can edit any of them
in place, `public`, `discoverable` and `categories` included, and the recipe keeps its id, so characters who
learned it keep it.

Because your recipes are registered fresh each session, updating your module updates them
everywhere, except the ones the GM edited: an edited recipe stays as the GM left it and stops
following your updates until the GM **restores** it, which brings back exactly the version your
package registers.

**Duplicate** makes a world recipe from one of yours. It belongs to the world and owes nothing to
your package.

The GM can also move any of your recipes to the Recipe Book's **Hidden** group, out of the way at
the bottom of the list. That only affects the GM's list: the recipe still works in play, and
`getRecipes()` still lists it. Restoring an edited recipe brings it back to its group.

When your package is disabled, its recipes leave the world, the GM's edits of them included. The
edits come back with your package; world duplicates never left.

---

## Full example: a module with its own compendium

A module `smithing-pack` ships two compendiums, `smithing-pack.materials` and
`smithing-pack.gear`.

```js
// scripts/main.js of smithing-pack
const MAT = "Compendium.smithing-pack.materials.Item";
const GEAR = "Compendium.smithing-pack.gear.Item";

const INGOT = `${MAT}.ironIngot000001`;
const STICK = `${MAT}.woodenStick00001`;
const LEATHER = `${MAT}.leatherStrip0001`;

const RECIPES = [
  {
    id: "iron-sword",
    name: "Iron Sword",
    cells: [
      [null, INGOT, null],
      [null, INGOT, null],
      [null, STICK, null]
    ],
    result: `${GEAR}.ironSword0000001`,
    failLossChance: 25
  },
  {
    id: "iron-arrowheads",
    name: "Iron Arrowheads",
    shaped: false,
    cells: [INGOT, STICK, null, null, null, null, null, null, null],
    result: `${GEAR}.arrows0000000001`,
    quantity: 10
  },
  {
    id: "hilt-wrap",
    cells: [
      [LEATHER, LEATHER, null],
      [null, null, null],
      [null, null, null]
    ],
    result: `${GEAR}.hiltWrap00000001`
  }
];

Hooks.once("grid-crafter.ready", api => {
  const count = api.registerRecipes("smithing-pack", RECIPES);
  console.log(`smithing-pack | ${count} recipes ready for Grid Crafter`);
});
```

Add Grid Crafter to your `module.json` so Foundry offers to install it:

```json
"relationships": {
  "recommends": [
    {
      "id": "grid-crafter",
      "type": "module",
      "manifest": "https://github.com/brunocalado/grid-crafter/releases/latest/download/module.json",
      "reason": "Lets players forge the gear in this pack on a crafting grid."
    }
  ]
}
```

Use `requires` instead of `recommends` if your module makes no sense without it.
