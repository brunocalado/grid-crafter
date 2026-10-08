# Grid Crafter

**Lay the materials out on a 3×3 grid, strike, and forge something new — in any system.**

![Forging an item on the crafting table](docs/forging.gif)

![The crafting table, forge theme](docs/forge-table.webp)

[![Buy Me a Coffee](https://img.shields.io/badge/Buy_Me_a_Coffee-Donate-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/mestredigital) [![More Modules](https://img.shields.io/badge/Foundry%20VTT-More%20Modules-red?style=for-the-badge&logo=gamepad)](https://mestredigital.online/pages/projetos-en)

Crafting the way Minecraft taught everyone to do it: two iron ingots over a stick make a sword.
Put the right items in the right places, hit **Craft**, and watch the materials melt into
something new — with sparks, light and the ring of the anvil.

## ⚒️ Why?

The fighter wants a new sword. The player says *"I use the two iron ingots and the wood I found."*

And then the table stops. Is that even a recipe? The GM checks their notes, the player deletes the
ingots from the sheet by hand (or forgets to), someone creates the sword item, someone else asks
where the wood went. The moment that should feel like an achievement turns into bookkeeping.

**Grid Crafter turns it into a moment.** The GM sets up the recipes once. The players drag items
from their own sheets onto a crafting grid and try their luck. Get it right, and the ingots and
the wood leave the sheet, the sword appears on it, and the whole table sees it happen in chat.
Get it wrong, and the materials refuse to come together — and, if the GM wants, they might be
lost in the attempt.

## ✨ Key Features

* 🔲 **A real crafting grid.** Drag items from your character's sheet onto a 3×3 grid, move them
  between cells, and press **Craft**. Double-click any item to open its sheet. The GM can also use
  items straight from the Items directory or a compendium.
* 🔥 **A spectacle, not a dialog.** The table shakes with three hammer blows, the materials fly
  into the heart of the grid, a flash of light travels into the result slot, and the new item
  bursts out of it. Failures flare red, shudder and smoke.
* 🌌 **Two looks for your table.** **Forge** — fire, sparks, riveted iron and the ring of the
  anvil. **Arcane** — runes, a turning magic circle and blue light. The GM picks one for everyone.

  ![The crafting table, arcane theme](docs/arcane-table.webp)

* 📐 **Shaped and shapeless recipes.** A shaped recipe cares where each item sits — and still
  works anywhere on the grid, or mirrored. A shapeless recipe only cares which items are there.
* 🎒 **Uses the real inventory.** Crafting spends one unit per grid cell from the character's own
  sheet, and the new item lands right on that sheet, stacking with any copies already there.
  Systems with slots or weight limits are respected: the materials make room for what they become,
  and if the result still doesn't fit, nothing is spent.
* 📖 **A recipe book for every character.** The first time a character forges something, its
  recipe is written into that character's recipe book, or when the GM teaches it. Next time, one
  click lays the recipe out on the grid from their inventory. Recipes are grouped by category,
  and the book can be searched by name or ingredient, or narrowed to what the character can craft
  right now. A recipe the GM makes public is in every character's book.
* 🧪 **Discovery by experiment.** A character can make a recipe they don't know by laying out
  its ingredients, and learns it by doing so. The GM can turn this off for the whole world or for
  single recipes, and then only recipes a character already knows can be crafted.
* 👁️ **Share a recipe with the table.** From the GM's Recipe Book, **Share** shows a
  recipe to the players you choose: its pattern lights up cell by cell, then what it makes appears.
  Each of them can **Learn** it into their own character's recipe book.
* 🎲 **Failure can cost something.** Set a chance for a failed attempt to destroy the materials —
  for the whole world, or per recipe. Leave it at 0 and failure is free.
* 💬 **Every attempt reported in chat.** Success shows what was spent and what was made; failure
  shows what was tried; a result the character had no room for shows that nothing was spent.
  Items the GM took from the Items directory or a compendium are tagged, so the table can tell a
  free craft from a paid one.

  ![A craft report in chat](docs/chat-report.webp)

* 🗺️ **Straight to the map.** With [Canvas Loot](https://github.com/brunocalado/canvas-loot), drag
  the item you just forged from the crafting table onto the map, and it lands on the ground.
* 🔊 **Sounds you can swap.** Every theme comes with its own sounds for crafting, success, failure
  and shared recipes. The GM can replace any of them and set their base volume; each player hears
  them on their own Interface volume.
* 🧩 **Works with any system.** Choose which item types count as crafting materials (nobody forges
  a hammer out of a class), and tell the module where your system keeps an item's quantity.
* 🔌 **Recipe packs from other modules.** Module and system developers can ship ready-made recipe
  books through the [API](docs/API.md). The GM can change any recipe from a pack, and restore the
  pack's version later.

## 🛠️ How to Use

### For the GM — write the recipes

1. Open the **Items** directory and click **Recipes** at the top (or run `GridCrafter.recipes()`
   in a macro).
2. Click **New Recipe**. Drag the ingredients from the Items directory or a compendium onto the
   grid, and the item it makes onto the circle on the right.
3. Choose **Shaped** or **Shapeless**, how many items one craft **Makes**, and whether a failure
   uses the world's chance to lose materials or a chance of its own. Switch on **Public** if every
   character should know the recipe, and set **Discovery** if this recipe should not follow the
   world setting. Hover the **?** icons for a quick explanation.
4. Optionally, give it one or more **Categories** to group it with similar recipes. A recipe
   with two categories shows up in both groups of the character's book.
5. **Save.**

![The GM's Recipe Book](docs/recipe-book.webp)

The Recipe Book lists this world's recipes first, then one group for each module or system that
ships recipes, each split by its first category. Search finds a recipe by its name, what it makes,
its categories or an ingredient. A recipe you don't need to see can be moved to the **Hidden** group
at the bottom of the list; this changes nothing in play. **Duplicate** copies a recipe as a new
world recipe.

A recipe from a module or system can be edited in place, like your own. It then stops following
that package's updates, and **Restore** brings back the package's version.

To teach a recipe in play — the old smith shows the apprentice how it's done — open it, click
**Share** and choose who sees it (the owners of the tokens you have selected start chosen).
They watch the pattern light up, cell by cell, and the result appear; **Learn** writes it into
their character's recipe book, with a whispered message in chat.

![A shared recipe, as the players see it](docs/share-recipe.webp)

**Teach** opens the list of characters, or of the tokens you have selected. Switch on who should
learn the recipe and press **Teach**; those who learned get a whispered message in chat.
**Forget** lists only those who learned it: switch on who should forget it and press **Forget**.
To teach or forget several recipes at once, click **Select recipes** next to the search, pick the
recipes (or whole groups), and press **Teach** or **Forget**.

### For the GM — set it up once

All settings are in **Game Settings → Configure Settings → Grid Crafter**:

* **Recipes** — opens the Recipe Book.
* **Craftable Item Types** — which kinds of items can go on the grid. With none selected, every
  type is allowed.
* **Crafting Sounds** — the base volume and the sound for crafting, success, failure and shared
  recipes. Leave a sound empty to use the theme's own.
* **Visual Theme** — Forge or Arcane, for everyone at the table.
* **Quantity Path** — where your system keeps an item's quantity, such as `system.quantity`.
  Items without a number there are used up whole.
* **Failure: Chance to Lose Materials** — the world-wide default; each recipe can override it.
* **Discover Recipes by Experiment** — whether characters can make a recipe they don't know by
  laying out its ingredients, and learn it. On by default; each recipe can override it.

### For the players — forge something

1. Make sure your user has a character assigned (**User Configuration → Character**). Crafting
   uses that character's inventory, and the forged item goes to their sheet. A GM without a
   character crafts for the token they have selected.
2. Open the Items directory and click **Forge** (or run `GridCrafter.forge()` in a macro).
3. Drag items from your character sheet onto the grid and arrange them. Only your character's
   items can be used. Right-click a cell, or use its small ✕, to empty it.
4. Press **Craft**.

Already know the recipe? Click it in your **Recipe Book** on the left, and the grid fills itself
from your inventory. A greyed-out recipe means you're missing something. Type in the search box
to find a recipe by name or ingredient, or click the button next to it to show only the recipes
you can craft now.

## 🔌 For Developers

Ship recipes with your module or system so they're ready the moment the GM enables it:

```js
Hooks.once("grid-crafter.ready", api => {
  api.registerRecipes("my-module", [
    {
      id: "iron-sword",
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

Other packages can also stop a craft or react to it through [two hooks](docs/API.md#hooks).

👉 **[Read the full API documentation](docs/API.md)**

## 🚀 Installation

Requires Foundry VTT v14. Install via the Foundry VTT Module browser or use this manifest link:

```
https://github.com/brunocalado/grid-crafter/releases/latest/download/module.json
```

Optional: install [Canvas Loot](https://github.com/brunocalado/canvas-loot) too, so forged items
can be dragged straight onto the map.

## 🌍 Translations

Want to translate this module? It's easy:
1. Download the `lang/en.json` file.
2. Translate the values in the JSON file.
3. Open an issue on [GitHub](https://github.com/brunocalado/grid-crafter/issues).
4. Attach your translated file and tell us the `lang` and `name` it should use. For example:
   ```json
   "lang": "pt-BR",
   "name": "Portuguese (Brasil)"
   ```

## ⚖️ Credits

* **Code License:** GNU GPLv3.

* **Sounds:** mixed from [Kenney](https://kenney.nl)'s RPG Audio, Impact Sounds, Interface Sounds,
  Sci-fi Sounds and Digital Audio packs, released under
  [CC0](https://creativecommons.org/publicdomain/zero/1.0/). See `assets/sounds/CREDITS.md`.
