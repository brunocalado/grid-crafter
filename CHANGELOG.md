# 0.0.3

- [Added] Dismantling recipes: break one item into the parts the recipe names, at the same table with a switch on the book. If the sheet has no room for every part, nothing is spent.
- [Added] An item made at the table remembers what was spent on it. With Refund on, dismantling it gives exactly that back.
- [Added] A recipe can have up to four variants, each with its own grid, so the stone axe and the iron axe are one recipe to learn.
- [Added] A recipe can require an item the character must carry. It never goes on the grid and is never spent.
- [Added] Public recipes, known by every character without being taught.
- [Added] The GM decides which recipes can be discovered by experiment, with a world setting and a choice per recipe.
- [Added] Teach and Forget recipes from the Recipe Book, one or several at once.
- [Added] Categories, groups and search in the Recipe Book and in the forge's book. The forge's book lists what you can craft first and can show only that.
- [Added] The GM can edit package recipes, restore them, duplicate any recipe and hide recipes at the bottom of the Recipe Book.
- [Added] A shared recipe shows what it makes, and players can learn it from there.
- [Added] preCraft and craft hooks so other modules can stop a craft or react to it, and API functions to teach, forget, categorize and read receipts.
- [Changed] Known recipes belong to the character, not the player. Recipes learned in 0.0.2 are not carried over.
- [Changed] Sharing a recipe goes only to the players the GM picks.
- [Changed] A shaped recipe matches only as drawn, never mirrored, and one grid makes at most one recipe.
- [Changed] A new look for the forge: a sooty hollow with a bellows pulse and smoke. Confirmations, scrollbars and category chips follow the module's themes.
- [Fixed] The GM gets told to select a token when the forge has no character.
- [Fixed] The forge no longer re-renders on every HP change, which moved the search caret.

# 0.0.2

- [Fixed] In systems that limit inventory (slots, weight), crafting with a full inventory spent the materials and gave nothing. Now the materials make room for the result, and if it still doesn't fit, nothing is spent and the chat says so.
- [Changed] Only items from your own character can go on the grid. Items from the Items directory or a compendium are for the GM only.
- [Added] If a craft is interrupted after the materials were spent, the chat card lists what was lost so the GM can fix it.

# 0.0.1

- [Added] First release.
