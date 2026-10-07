# Grid Crafter API

Ship a ready-made recipe book with your module or system. The recipes you register appear on
every crafting table, in the GM's Recipe Book (marked with your package's name) and in each
character's recipe book once it crafts them, with no setup from the GM.

The API is available as `GridCrafter` and as `game.modules.get("grid-crafter").api`.

- [Quick start](#quick-start)
- [When to register](#when-to-register)
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

## Recipe format

| Field | Required | Description |
|---|---|---|
| `id` | yes | Your id for the recipe, unique within your package. Grid Crafter stores it as `"<packageId>.<id>"`. **Keep it stable**: players' recipe books remember recipes by this id. |
| `cells` | yes | The 3×3 grid: either a flat list of 9 entries (row by row) or 3 rows of 3. Each entry is an item uuid or `null` for an empty cell. At least one cell must hold an item. |
| `result` | yes | The uuid of the item the recipe makes: a world item or a compendium item. A copy of it goes to the crafter's character sheet. |
| `name` | no | Name shown in the recipe books. Defaults to the result item's name. |
| `category` | no | A short group name for the recipe, at most 24 characters; longer text is cut. Default none. |
| `shaped` | no | `true` (default): items must keep their positions. `false`: only which items, not where. |
| `quantity` | no | How many of the result one craft makes, 1 to 10. Default `1`. |
| `failLossChance` | no | Percent chance (0–100) that a failed attempt destroys the materials. Leave it out to use the GM's world setting. |

### Shaped recipes

A shaped pattern matches **wherever it sits on the grid** and also **mirrored left to right**. Only
the cells that hold something count, so this sword:

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

### Failure

A failed craft counts against your recipe when the grid holds **your recipe's items in the wrong
shape**. Then your `failLossChance` applies. Any other failure uses the GM's world setting.

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
GM would allow (materials, loot, consumables), not classes or features.

---

## Reference

### `registerRecipes(packageId, recipes)` → `number`

Registers recipes for your package and returns how many were accepted.

- `packageId` *(string)*: your module's or system's id. It labels the recipes in the GM's
  Recipe Book and prefixes their ids.
- `recipes` *(object[])*: recipes in the [format above](#recipe-format).

A recipe that is missing its `id`, doesn't have 9 cells, or names an item that can't be found is
skipped with a warning in the console; the rest are registered. Registering an `id` you already
registered replaces that recipe.

### `unregisterRecipes(packageId)`

Removes every recipe your package registered, on this client.

### `getRecipes()` → `object[]`

Every recipe on this client: the world's recipes first, then registered ones. Each has `id`,
`name`, `category` (`""` when none), `shaped`, `cells` (9 entries, each `{ uuid, name, img, type, sources }` or `null`),
`result`, `quantity`, `failLossChance` (`null` when it follows the world setting) and `source`
(`"world"` or the package id). The objects are copies; changing them changes nothing.

### `getKnownRecipes(target)` → `string[]`

Ids of the recipes an actor knows: what its recipe book shows. `target` is the actor, one of its
tokens, or the uuid of either. Defaults to the current user's crafting actor — their assigned
character, or for a GM the first selected token.

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

Shows a recipe's pattern to players online, without what it makes or its name, as the editor's
**Share Recipe** button does. The GM who calls it sees the same window.

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

### `forge()`

Opens the crafting table for the current user.

### `recipes()` *(GM only)*

Opens the GM's Recipe Book.

---

## What the GM can do with your recipes

Your recipes show in the GM's Recipe Book under your package's title, **read-only**: the GM can
see them and share them with the players, but not change them. **Copy to World** makes an
editable copy that belongs to the world; your original stays as it is.

Because your recipes are registered fresh each session, updating your module updates them
everywhere. A world copy the GM made doesn't change with you.

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
