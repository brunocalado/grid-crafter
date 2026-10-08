/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { CELL_COUNT, MODULE_ID, TEMPLATE_PATH } from "../constants.js";
import {
  bindSearch, filterGroups, getCollapsed, getCraftingActor, getDropData, getQuantity, getTheme, groupByCategory,
  isTypeAllowed, itemDragData, itemOrigin, readCaret, recipeSearchText, refMatches, restoreCaret, setCollapsed, toItemRef
} from "../helpers.js";
import {
  CraftError, craft, dismantle, fillFromInventory, getKnownRecipeIds, getLearnedRecipeIds, hasRequiredItem, planDismantle
} from "../crafting.js";
import { dismantleGrid, getAllRecipes, isDiscoverable, recipeFace } from "../recipes.js";
import { BELLOWS_PERIOD, CraftFX, animate, runeGlyphs, wait } from "../effects.js";
import { playCue } from "../sound.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Drag payload for moving an item between cells of the grid. */
const CELL_DRAG = `${MODULE_ID}.cell`;

/** Where this browser remembers the book's "only what you can craft now" filter. */
const READY_ONLY_KEY = `${MODULE_ID}.forge.readyOnly`;

/** Where this browser remembers whether the table crafts or dismantles. */
const MODE_KEY = `${MODULE_ID}.forge.mode`;

/**
 * The crafting table: a 3x3 grid players fill with items, a result slot, and the recipe book of what
 * they already know how to make. Turned around, it dismantles: the item goes in the circle and its
 * parts come out onto the grid.
 */
export class ForgeApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-forge`,
    classes: [MODULE_ID, "gc-app", "gc-forge"],
    window: {
      title: "GRIDCRAFTER.Forge.Title",
      icon: "fa-solid fa-hammer-crash",
      resizable: false
    },
    position: { width: 900, height: "auto" },
    actions: {
      craft: ForgeApp.#onCraft,
      dismantle: ForgeApp.#onDismantle,
      fillRecipe: ForgeApp.#onFillRecipe,
      fillInput: ForgeApp.#onFillInput,
      clearCell: ForgeApp.#onClearCell,
      clearInput: ForgeApp.#onClearInput,
      setMode: ForgeApp.#onSetMode,
      toggleReady: ForgeApp.#onToggleReady
    }
  };

  static PARTS = {
    main: { template: `${TEMPLATE_PATH}/forge.hbs`, scrollable: [".gc-book-scroll"] }
  };

  /** @type {(import("../helpers.js").ItemRef|null)[]} */
  slots = Array(CELL_COUNT).fill(null);

  /** The forged item waiting in the result slot, on the crafting actor. */
  resultUuid = null;

  /** The item waiting in the circle to be broken: an ItemRef of the crafting actor's. */
  inputRef = null;

  /** A craft animation is running; input is ignored until it ends. */
  busy = false;

  fx = new CraftFX(getTheme());

  /** Arcane circle glyphs, generated once. */
  static #glyphs = runeGlyphs(24);

  /** Hook ids registered while open. */
  #hooks = [];

  /** The recipe book's search, as typed. */
  #query = "";

  /** Show only the recipes the inventory can make right now. */
  #readyOnly = (() => {
    try {
      return localStorage.getItem(READY_ONLY_KEY) === "true";
    } catch {
      return false;
    }
  })();

  /** Categories the user closed in the recipe book. */
  #collapsed = getCollapsed("forge");

  /** "craft" or "dismantle", as the user last chose it. */
  #mode = (() => {
    try {
      return (localStorage.getItem(MODE_KEY) === "dismantle") ? "dismantle" : "craft";
    } catch {
      return "craft";
    }
  })();

  /** Whether the crafting actor knows or could discover a dismantling recipe, as of the last render. */
  #canDismantle = false;

  /** The next render turns the table around: the arrow swings to the other side. */
  #turned = false;

  /**
   * The table dismantles only while the mode switch is offered: without a dismantling recipe in reach
   * it is the crafting table it always was.
   * @returns {boolean}
   */
  get #dismantling() {
    return this.#canDismantle && (this.#mode === "dismantle");
  }

  /** @override */
  async _prepareContext(options) {
    const actor = getCraftingActor();
    const theme = getTheme();
    // A player with no character still sees the public recipes; crafting is what needs the character.
    const known = new Set(getKnownRecipeIds(actor));
    const learned = new Set(getLearnedRecipeIds(actor));
    const all = getAllRecipes();
    this.#canDismantle = all.some(r => (r.kind === "dismantle") && (known.has(r.id) || isDiscoverable(r)));
    const dismantling = this.#dismantling;
    const requires = holder => (holder.requires
      ? { name: holder.requires.name, img: holder.requires.img, has: !!actor && hasRequiredItem(holder, actor) } : null);
    // The book lists the recipes of the table's mode. One row per variant, in the recipe's order: the
    // recipe moves as a whole, a row never jumps ahead of its siblings. A dismantling recipe is one row:
    // what an item nobody made breaks into, as a shapeless list since where parts land never matters.
    const book = all.filter(r => known.has(r.id) && ((r.kind === "dismantle") === dismantling)).map(r => {
      const grid = dismantling ? dismantleGrid(r, all) : null;
      const rows = dismantling ? [{
        index: 0,
        first: true,
        shaped: false,
        cells: grid.cells.filter(Boolean),
        ready: !!actor && (carried(r.input, actor) >= grid.units) && hasRequiredItem(r, actor),
        requires: requires(r)
      }] : r.variants.map((v, index) => ({
        index,
        first: index === 0,
        shaped: r.shaped,
        cells: r.shaped ? v.cells : v.cells.filter(Boolean),
        ready: !!(actor && fillFromInventory(v, actor) && hasRequiredItem(v, actor)),
        requires: requires(v)
      }));
      return {
        id: r.id,
        ...recipeFace(r),
        // How many of the item one dismantling breaks, when it is more than one.
        count: (dismantling && (grid.units > 1)) ? grid.units : null,
        categories: r.categories,
        search: recipeSearchText(r),
        // Any variant that can be made now: it sorts and filters the recipe.
        ready: rows.some(row => row.ready),
        // Known only because it is public. Learned recipes carry no marker: no marker means "yours".
        public: !learned.has(r.id),
        rows
      };
    });
    // Players don't care which package a recipe came from, so the book groups by category alone.
    // A recipe with several categories is listed in each.
    // Craftable recipes lead each group.
    const byCategory = groupByCategory(book);
    for ( const recipes of byCategory.values() ) recipes.sort((a, b) => b.ready - a.ready);
    // A book spanning one category or none stays a plain list, without headings.
    const groups = (byCategory.size > 1) ? [...byCategory].map(([category, recipes]) => ({
      key: category,
      label: category || game.i18n.localize("GRIDCRAFTER.Recipe.CategoryNone"),
      count: recipes.length,
      collapsed: this.#collapsed.has(category),
      recipes
    })) : null;
    const result = this.resultUuid ? foundry.utils.fromUuidSync(this.resultUuid) : null;
    const glyphs = ForgeApp.#glyphs.map((d, i) => ({ d, angle: (360 / ForgeApp.#glyphs.length) * i }));
    const isArcane = theme === "arcane";
    const icons = { craft: isArcane ? "fa-wand-sparkles" : "fa-hammer", dismantle: isArcane ? "fa-burst" : "fa-pickaxe" };
    // What the item in the circle breaks into, faint on the empty grid, when the actor knows how: its
    // receipt or the recipe's grid, planned exactly as the dismantle will. Short of units, the grid it
    // would break into once there are enough. A recipe it could only discover shows nothing: that
    // would give it away.
    const recipe = (dismantling && this.inputRef && actor)
      ? all.find(r => (r.kind === "dismantle") && known.has(r.id) && refMatches(r.input, this.inputRef)) : null;
    const doc = recipe ? foundry.utils.fromUuidSync(this.inputRef.uuid) : null;
    const ghost = doc ? (planDismantle(recipe, doc, actor, all)?.cells ?? dismantleGrid(recipe, all).cells) : null;
    return {
      theme,
      isArcane,
      icons,
      canDismantle: this.#canDismantle,
      dismantling,
      actor: actor ? { name: actor.name, img: actor.img } : null,
      // A GM can also craft for a selected token, so their message says so.
      noActorKey: game.user.isGM ? "GRIDCRAFTER.Errors.NoActorGM" : "GRIDCRAFTER.Errors.NoActor",
      slots: this.slots.map((s, index) => ({ index, item: s, ghost: (!s && ghost?.[index]) || null })),
      input: dismantling ? this.inputRef : null,
      book: [...byCategory.values()].flat(),
      groups,
      query: this.#query,
      readyOnly: this.#readyOnly,
      result: result ? { uuid: result.uuid, name: result.name, img: result.img, quantity: getQuantity(result) } : null,
      glyphs
    };
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const theme = getTheme();
    for ( const t of ["forge", "arcane"] ) this.element.classList.toggle(`gc-theme-${t}`, t === theme);
    this.fx.attach(this.element.querySelector(".gc-fx"), theme);
    if ( context.book.length ) this.#bindBook();

    for ( const cell of this.element.querySelectorAll(".gc-cell") ) {
      cell.addEventListener("dragover", this.#onDragOver.bind(this));
      cell.addEventListener("dragleave", ev => ev.currentTarget.classList.remove("gc-drop-target"));
      cell.addEventListener("drop", this.#onDropCell.bind(this));
      cell.addEventListener("dragstart", this.#onDragCell.bind(this));
      cell.addEventListener("contextmenu", ev => {
        ev.preventDefault();
        this.#setSlot(Number(ev.currentTarget.dataset.index), null);
      });
      cell.addEventListener("dblclick", ev => this.#openSheet(this.slots[Number(ev.currentTarget.dataset.index)]?.uuid));
    }
    // Dropping on the bench but outside a cell fills the first empty cell, which is friendlier than
    // demanding a precise drop.
    const bench = this.element.querySelector(".gc-bench");
    bench.addEventListener("dragover", ev => ev.preventDefault());
    bench.addEventListener("drop", this.#onDropBench.bind(this));
    // The forge's bellows animations (gc-bellows*: the hearth's swell, the glowing seams) would restart
    // from rest on every render, and the seams again after a craft's flare. Anchored at the start of
    // the document timeline, the clock performance.now() reads, they carry on where they were and
    // stay in step with the ember surge, however late the style is applied.
    bench.style.setProperty("--gc-bellows-period", `${BELLOWS_PERIOD}s`);
    const isBellows = anim => anim.animationName?.startsWith("gc-bellows");
    for ( const anim of bench.getAnimations({ subtree: true }).filter(isBellows) ) anim.startTime = 0;
    bench.addEventListener("animationstart", ev => {
      if ( !ev.animationName.startsWith("gc-bellows") ) return;
      for ( const anim of ev.target.getAnimations({ subtree: true }) ) {
        if ( anim.animationName === ev.animationName ) anim.startTime = 0;
      }
    });
    const result = this.element.querySelector(".gc-result-slot");
    if ( context.dismantling ) {
      result.addEventListener("dragover", this.#onDragOver.bind(this));
      result.addEventListener("dragleave", ev => ev.currentTarget.classList.remove("gc-drop-target"));
      result.addEventListener("drop", this.#onDropInput.bind(this));
      result.addEventListener("contextmenu", ev => {
        ev.preventDefault();
        this.#setInput(null);
      });
      result.addEventListener("dblclick", () => this.#openSheet(this.inputRef?.uuid));
    }
    else {
      result.addEventListener("dragstart", this.#onDragResult.bind(this));
      result.addEventListener("dblclick", () => this.#openSheet(this.resultUuid));
    }
    // The table was turned: the arrow swings round from where it pointed. Its new direction is already
    // in the markup, so this only animates the way there.
    if ( this.#turned ) {
      this.#turned = false;
      const arrow = this.element.querySelector(".gc-arrow");
      const [from, to] = context.dismantling ? [1, -1] : [-1, 1];
      arrow.animate([{ transform: `scaleX(${from})` }, { transform: `scaleX(${to})` }], { duration: 300, easing: "ease" });
    }
  }

  /**
   * Wire the book's search and folding categories, and reapply the filters. The forge re-renders on
   * every change to the crafting actor's items, and the search must survive each of those.
   */
  #bindBook() {
    const book = this.element.querySelector(".gc-book");
    bindSearch(book.querySelector("input[name=search]"), query => {
      this.#query = query;
      this.#filterBook();
    });
    for ( const group of book.querySelectorAll("details.gc-group") ) {
      group.addEventListener("toggle", () => {
        // While a search or the ready filter is on, groups are opened by the filter, not by the user.
        if ( this.#query.trim() || this.#readyOnly ) return;
        if ( group.open ) this.#collapsed.delete(group.dataset.group);
        else this.#collapsed.add(group.dataset.group);
        setCollapsed("forge", this.#collapsed);
      });
    }
    this.#filterBook();
  }

  #filterBook() {
    filterGroups(this.element.querySelector(".gc-book"),
      { query: this.#query, readyOnly: this.#readyOnly, collapsed: this.#collapsed });
  }

  /**
   * Show an item's sheet: the one on the grid, wherever it lives, or the forged one.
   * @param {string|undefined} uuid
   */
  async #openSheet(uuid) {
    if ( !uuid ) return;
    const item = await fromUuid(uuid);
    item?.sheet?.render({ force: true });
  }

  /** @override */
  _preSyncPartState(partId, newElement, priorElement, state) {
    super._preSyncPartState(partId, newElement, priorElement, state);
    state.caret = readCaret(priorElement);
  }

  /** @override */
  _syncPartState(partId, newElement, priorElement, state) {
    super._syncPartState(partId, newElement, priorElement, state);   // focuses the field first
    restoreCaret(newElement, state.caret);
  }

  /** @override */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    const relevant = doc => (doc.documentName === "Item") && (doc.parent === getCraftingActor());
    // The forged item can leave the actor by other means: dragged to the canvas, to another sheet, or
    // deleted. The slot then empties instead of pointing at nothing. Any item leaving the inventory also
    // changes which recipes the book can make now.
    this.#hooks.push(["deleteItem", Hooks.on("deleteItem", item => {
      const shown = [this.resultUuid, this.inputRef?.uuid].includes(item.uuid) || this.slots.some(s => s?.uuid === item.uuid);
      this.slots = this.slots.map(s => (s?.uuid === item.uuid ? null : s));
      if ( item.uuid === this.resultUuid ) this.resultUuid = null;
      if ( item.uuid === this.inputRef?.uuid ) this.inputRef = null;
      if ( (shown || relevant(item)) && !this.busy ) this.render();
    })]);
    this.#hooks.push(["updateItem", Hooks.on("updateItem", item => relevant(item) && !this.busy && this.render())]);
    this.#hooks.push(["createItem", Hooks.on("createItem", item => relevant(item) && !this.busy && this.render())]);
    // The recipe book lives in the crafting actor's flag; nothing else about the actor is on screen.
    // Compared by uuid because a GM's crafting actor may be a token's synthetic actor.
    this.#hooks.push(["updateActor", Hooks.on("updateActor", (actor, changes) =>
      (actor.uuid === getCraftingActor()?.uuid) && foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)
      && !this.busy && this.render())]);
    // Still needed: assigning the user a different character changes the crafting actor.
    this.#hooks.push(["updateUser", Hooks.on("updateUser", user => (user === game.user) && !this.busy && this.render())]);
    this.#hooks.push(["controlToken", Hooks.on("controlToken", () => game.user.isGM && !this.busy && this.render())]);
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    for ( const [name, id] of this.#hooks ) Hooks.off(name, id);
    this.#hooks = [];
    this.fx.stop();
  }

  /* -------------------------------------------- */
  /*  Grid editing                                */
  /* -------------------------------------------- */

  /**
   * @param {number} index
   * @param {import("../helpers.js").ItemRef|null} ref
   */
  #setSlot(index, ref) {
    if ( this.busy ) return;
    this.slots[index] = ref;
    this.render();
  }

  /** @param {DragEvent} event */
  #onDragOver(event) {
    event.preventDefault();
    event.currentTarget.classList.add("gc-drop-target");
  }

  /** @param {DragEvent} event */
  #onDragCell(event) {
    const index = Number(event.currentTarget.dataset.index);
    if ( !this.slots[index] ) return;
    event.dataTransfer.setData("text/plain", JSON.stringify({ type: CELL_DRAG, index }));
  }

  /** @param {DragEvent} event */
  #onDragResult(event) {
    if ( !this.resultUuid ) return;
    // The forged item already sits on the actor; dragging it from here is dragging it from the sheet,
    // so canvas-loot, other sheets and the chat all handle it as their own.
    event.dataTransfer.setData("text/plain", itemDragData(this.resultUuid));
  }

  /** @param {DragEvent} event */
  async #onDropCell(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.remove("gc-drop-target");
    await this.#handleDrop(getDropData(event), Number(event.currentTarget.dataset.index));
  }

  /** @param {DragEvent} event */
  async #onDropBench(event) {
    event.preventDefault();
    // Dismantling, the grid only shows what comes out: whatever is dropped on the bench is for the circle.
    if ( this.#dismantling ) return this.#onDropInput(event);
    const index = this.slots.findIndex(s => !s);
    if ( index < 0 ) return;
    await this.#handleDrop(getDropData(event), index);
  }

  /**
   * @param {object} data
   * @param {number} index
   */
  async #handleDrop(data, index) {
    if ( this.busy ) return;
    if ( this.#dismantling && (data.type !== CELL_DRAG) ) return this.#handleInputDrop(data);
    if ( data.type === CELL_DRAG ) {
      const from = Number(data.index);
      if ( from === index ) return;
      [this.slots[from], this.slots[index]] = [this.slots[index], this.slots[from]];
      return this.render();
    }
    if ( data.type !== "Item" ) return;
    let item;
    try {
      item = await Item.implementation.fromDropData(data);
    } catch {
      return;
    }
    const warn = key => ui.notifications.warn(game.i18n.localize(`GRIDCRAFTER.Errors.${key}`, { name: item.name }));
    if ( !isTypeAllowed(item.type) ) return warn("TypeNotAllowed");
    const origin = itemOrigin(item);
    if ( (origin === "actor") && (item.parent.uuid !== getCraftingActor()?.uuid) ) return warn("NotYourCharacter");
    if ( (origin === "actor") && !item.isOwner ) return warn("NotOwner");
    // Directory and compendium items are spent by nobody, so only a GM may put them on the grid.
    if ( (origin !== "actor") && !game.user.isGM ) return warn("NotFromInventory");
    // A stack fills as many cells as it has units; an item without a quantity fills one.
    if ( origin === "actor" ) {
      const used = this.slots.filter((s, i) => (i !== index) && (s?.uuid === item.uuid)).length;
      if ( used >= (getQuantity(item) ?? 1) ) return warn("NotEnough");
    }
    this.#setSlot(index, toItemRef(item));
  }

  /**
   * @param {import("../helpers.js").ItemRef|null} ref
   */
  #setInput(ref) {
    if ( this.busy ) return;
    this.inputRef = ref;
    // The grid shows what this item breaks into, not the parts of the last one.
    if ( ref ) this.slots = Array(CELL_COUNT).fill(null);
    this.render();
  }

  /** @param {DragEvent} event */
  async #onDropInput(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.remove("gc-drop-target");
    await this.#handleInputDrop(getDropData(event));
  }

  /**
   * Put a dropped item in the circle: an item of the crafting actor's, or a part already on the grid.
   * The same origin and owner checks as the grid, for a GM too: only the actor's own items can be broken.
   * No item-type check: what may be dismantled is for the recipes to say.
   * @param {object} data
   */
  async #handleInputDrop(data) {
    if ( this.busy ) return;
    let item;
    try {
      item = (data.type === CELL_DRAG) ? await fromUuid(this.slots[Number(data.index)]?.uuid ?? "")
        : (data.type === "Item") ? await Item.implementation.fromDropData(data) : null;
    } catch {
      return;
    }
    if ( !item ) return;
    const warn = key => ui.notifications.warn(game.i18n.localize(`GRIDCRAFTER.Errors.${key}`, { name: item.name }));
    const origin = itemOrigin(item);
    if ( origin !== "actor" ) return warn("NotFromInventory");
    if ( item.parent.uuid !== getCraftingActor()?.uuid ) return warn("NotYourCharacter");
    if ( !item.isOwner ) return warn("NotOwner");
    this.#setInput(toItemRef(item));
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** @this {ForgeApp} */
  static #onClearCell(event, target) {
    this.#setSlot(Number(target.closest(".gc-cell").dataset.index), null);
  }

  /** @this {ForgeApp} */
  static #onFillRecipe(event, target) {
    if ( this.busy ) return;
    const recipe = getAllRecipes().find(r => r.id === target.dataset.recipeId);
    const variant = recipe?.variants[Number(target.dataset.variant)];
    const actor = getCraftingActor();
    const filled = variant && actor ? fillFromInventory(variant, actor) : null;
    if ( !filled ) {
      return ui.notifications.warn(game.i18n.localize("GRIDCRAFTER.Errors.MissingIngredients", { name: recipe?.name ?? "" }));
    }
    this.slots = filled;
    this.render();
  }

  /**
   * Put the item a dismantling recipe breaks in the circle, from the actor's inventory.
   * @this {ForgeApp}
   */
  static #onFillInput(event, target) {
    if ( this.busy ) return;
    const recipe = getAllRecipes().find(r => r.id === target.dataset.recipeId);
    const actor = getCraftingActor();
    if ( !recipe || !actor ) return;
    const item = actor.items.find(i => ((getQuantity(i) ?? 1) > 0) && refMatches(recipe.input, toItemRef(i)));
    if ( !item ) return ui.notifications.warn(game.i18n.localize("GRIDCRAFTER.Errors.NotCarried", { name: recipe.input.name }));
    this.#setInput(toItemRef(item));
  }

  /** @this {ForgeApp} */
  static #onClearInput() {
    this.#setInput(null);
  }

  /**
   * Turn the table to crafting or to dismantling. Entering Dismantle clears the table; back to Craft,
   * the grid keeps what it holds, so the parts just broken off become ingredients. Only references
   * are dropped: nothing leaves the sheet.
   * @this {ForgeApp}
   */
  static #onSetMode(event, target) {
    if ( this.busy ) return;
    const mode = target.dataset.mode;
    if ( mode === this.#mode ) return;
    this.#mode = mode;
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // Storage is blocked: the mode lasts as long as the window.
    }
    if ( mode === "dismantle" ) this.slots = Array(CELL_COUNT).fill(null);
    this.inputRef = null;
    this.resultUuid = null;
    this.#turned = true;
    this.render();
  }

  /**
   * Show only what can be crafted now, or everything. Patched in place rather than re-rendered.
   * @this {ForgeApp}
   */
  static #onToggleReady(event, target) {
    this.#readyOnly = !this.#readyOnly;
    try {
      localStorage.setItem(READY_ONLY_KEY, String(this.#readyOnly));
    } catch {
      // Storage is blocked: the filter lasts as long as the window.
    }
    target.classList.toggle("gc-active", this.#readyOnly);
    target.setAttribute("aria-pressed", String(this.#readyOnly));
    this.#filterBook();
  }

  /** @this {ForgeApp} */
  static async #onCraft() {
    if ( this.busy ) return;
    if ( !this.slots.some(Boolean) ) {
      return ui.notifications.warn(game.i18n.localize("GRIDCRAFTER.Errors.EmptyGrid"));
    }
    this.busy = true;
    this.element.classList.add("gc-busy");
    try {
      const strike = this.#playStrike();
      // A refused craft puts the ingredients back under their own ids, but the deleteItem hook has
      // emptied their cells by then.
      const slots = [...this.slots];
      let outcome;
      try {
        outcome = await craft(this.slots);
      } catch(err) {
        await strike;
        if ( !(err instanceof CraftError) ) throw err;
        ui.notifications.warn(err.message);
        return;
      }
      await strike;
      switch ( outcome.state ) {
        case "success":
          await this.#playSuccess(outcome.item);
          this.slots = Array(CELL_COUNT).fill(null);
          this.resultUuid = outcome.item.uuid;
          break;
        case "refused":
          this.slots = slots;
          // falls through
        case "failure":
        case "incomplete":
        case "missing":
          await this.#playFailure(outcome.lost);
          if ( outcome.lost ) this.slots = Array(CELL_COUNT).fill(null);
          break;
      }
    } finally {
      this.busy = false;
      this.element?.classList.remove("gc-busy");
      if ( this.rendered ) this.render();
    }
  }

  /**
   * Break the item in the circle. The blows land on the circle; the parts fly out into the grid, where
   * they stay as the actor's own items, ready to craft with.
   * @this {ForgeApp}
   */
  static async #onDismantle() {
    if ( this.busy ) return;
    if ( !this.inputRef ) return ui.notifications.warn(game.i18n.localize("GRIDCRAFTER.Errors.EmptyCircle"));
    this.busy = true;
    this.element.classList.add("gc-busy");
    try {
      const circle = this.element.querySelector(".gc-result-slot");
      const strike = this.#playStrike(circle);
      const input = this.inputRef;
      let outcome;
      try {
        outcome = await dismantle(input);
      } catch(err) {
        await strike;
        if ( !(err instanceof CraftError) ) throw err;
        ui.notifications.warn(err.message);
        return;
      }
      await strike;
      if ( outcome.state === "success" ) {
        await this.#playBreak(outcome.parts);
        this.inputRef = null;
        // Each part on the cell it was drawn in, as the actor's real item.
        this.slots = fillFromInventory({ cells: outcome.parts }, getCraftingActor()) ?? Array(CELL_COUNT).fill(null);
      }
      else {
        // A refused dismantle puts the item back under its own id, but the deleteItem hook has emptied
        // the circle by then. Ready to try again, as long as it exists.
        if ( foundry.utils.fromUuidSync(input.uuid) ) this.inputRef = input;
        await this.#playFailure(false, circle);
      }
    } finally {
      this.busy = false;
      this.element?.classList.remove("gc-busy");
      if ( this.rendered ) this.render();
    }
  }

  /* -------------------------------------------- */
  /*  Animation                                   */
  /* -------------------------------------------- */

  /**
   * The hammer blows (or the surge of the circle): shake, flashes and sparks, timed with the sound.
   * @param {HTMLElement} [target]   where the blows land: the grid when crafting, the circle when dismantling
   */
  async #playStrike(target = this.element.querySelector(".gc-grid")) {
    playCue("craft");
    const { x, y } = this.fx.centerOf(target);
    const arcane = getTheme() === "arcane";
    this.element.classList.add("gc-charging");
    animate(this.element, [
      { transform: "translate(0, 0) rotate(0)" },
      { transform: "translate(-7px, 2px) rotate(-0.6deg)" },
      { transform: "translate(6px, -3px) rotate(0.5deg)" },
      { transform: "translate(-5px, 1px) rotate(-0.4deg)" },
      { transform: "translate(4px, 2px) rotate(0.3deg)" },
      { transform: "translate(-2px, -1px) rotate(-0.1deg)" },
      { transform: "translate(0, 0) rotate(0)" }
    ], { duration: 620, easing: "ease-out", fill: "none" });
    // Three blows, matching the three hits of the craft sound.
    for ( let i = 0; i < 3; i++ ) {
      this.fx.burst(x + ((i - 1) * 30), y + 20, arcane ? { kind: "spiral", count: 40 } : { kind: "sparks", count: 34, speed: 340 });
      await wait(220);
    }
    await wait(100);
    this.element.classList.remove("gc-charging");
  }

  /**
   * Ingredients fly into the heart of the grid, light gathers, and the result is born in its slot.
   * @param {Item} item
   */
  async #playSuccess(item) {
    const bench = this.element.querySelector(".gc-bench");
    const overlay = this.element.querySelector(".gc-overlay");
    const grid = this.element.querySelector(".gc-grid");
    const slot = this.element.querySelector(".gc-result-slot");
    const benchRect = bench.getBoundingClientRect();
    const gridCenter = this.fx.centerOf(grid);
    const slotCenter = this.fx.centerOf(slot);

    // Lift each icon out of its cell into a free-flying copy, so the cell can empty under it.
    const flights = [];
    for ( const img of grid.querySelectorAll(".gc-cell img") ) {
      const r = img.getBoundingClientRect();
      const flyer = img.cloneNode();
      flyer.className = "gc-flyer";
      Object.assign(flyer.style, { left: `${r.left - benchRect.left}px`, top: `${r.top - benchRect.top}px`,
        width: `${r.width}px`, height: `${r.height}px` });
      overlay.append(flyer);
      img.style.visibility = "hidden";
      const dx = gridCenter.x - ((r.left - benchRect.left) + (r.width / 2));
      const dy = gridCenter.y - ((r.top - benchRect.top) + (r.height / 2));
      const delay = flights.length * 60;
      flights.push(animate(flyer, [
        { transform: "translate(0, 0) scale(1) rotate(0)", opacity: 1 },
        { transform: `translate(${dx * 0.15}px, ${(dy * 0.15) - 18}px) scale(1.12) rotate(-8deg)`, opacity: 1, offset: 0.25 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.15) rotate(200deg)`, opacity: 0 }
      ], { duration: 760, delay, easing: "cubic-bezier(.55,0,.75,.35)" }));
      this.#trailFollow(flyer, 760 + delay);
    }
    await Promise.all(flights);
    overlay.querySelectorAll(".gc-flyer").forEach(f => f.remove());

    // The gathered light flares, then travels to the result slot.
    playCue("success");
    this.#flash(overlay, gridCenter, "gc-flash-core");
    this.fx.burst(gridCenter.x, gridCenter.y, { count: 90, speed: 320 });
    if ( getTheme() === "forge" ) this.fx.burst(gridCenter.x, gridCenter.y, { kind: "sparks", count: 50, speed: 420 });
    await wait(180);
    await this.#beam(overlay, gridCenter, slotCenter);

    // Birth of the item: a ring, rays, a burst, and the icon rising out of the light.
    this.#flash(overlay, slotCenter, "gc-flash-ring");
    this.#flash(overlay, slotCenter, "gc-flash-rays", 2200);
    this.fx.burst(slotCenter.x, slotCenter.y, { count: 120, speed: 300 });
    this.fx.burst(slotCenter.x, slotCenter.y, { kind: getTheme() === "forge" ? "sparks" : "spiral", count: 60, speed: 380 });
    const born = document.createElement("img");
    born.src = item.img;
    born.className = "gc-born";
    const r = slot.getBoundingClientRect();
    Object.assign(born.style, { left: `${r.left - benchRect.left}px`, top: `${r.top - benchRect.top}px`,
      width: `${r.width}px`, height: `${r.height}px` });
    overlay.append(born);
    await animate(born, [
      { transform: "scale(0) rotate(-30deg)", opacity: 0 },
      { transform: "scale(1.35) rotate(6deg)", opacity: 1, offset: 0.55 },
      { transform: "scale(1) rotate(0)", opacity: 1 }
    ], { duration: 900, easing: "cubic-bezier(.2,.9,.3,1.2)" });
    await wait(500);
    born.remove();
  }

  /**
   * The craft turned around: the item in the circle shudders, flares and bursts, then each part flies
   * out of it along a short arc into its cell, which lights as the part lands.
   * @param {(import("../helpers.js").ItemRef|null)[]} parts   the nine cells the dismantle gave
   */
  async #playBreak(parts) {
    const overlay = this.element.querySelector(".gc-overlay");
    const circle = this.element.querySelector(".gc-result-slot");
    const icon = circle.querySelector("img");
    const cells = this.element.querySelectorAll(".gc-grid .gc-cell");
    const from = this.fx.centerOf(circle);
    const arcane = getTheme() === "arcane";

    await animate(icon, [
      { transform: "translate(0, 0) rotate(0)" }, { transform: "translate(-5px, 1px) rotate(-4deg)" },
      { transform: "translate(5px, -2px) rotate(4deg)" }, { transform: "translate(-4px, 1px) rotate(-3deg)" },
      { transform: "translate(3px, 0) rotate(2deg)" }, { transform: "translate(0, 0) rotate(0)" }
    ], { duration: 420, easing: "ease-out", fill: "none" });
    this.#flash(overlay, from, "gc-flash-core");
    this.fx.burst(from.x, from.y, arcane ? { kind: "spiral", count: 70 } : { kind: "sparks", count: 60, speed: 420 });
    animate(icon, [{ transform: "scale(1)", opacity: 1 }, { transform: "scale(1.3)", opacity: 0 }], { duration: 220, easing: "ease-in" });

    // The craft's flight reversed: born small at the circle's heart, rising, and settling into the cell.
    const flights = [];
    parts.forEach((part, index) => {
      if ( !part ) return;
      const cell = cells[index];
      const to = this.fx.centerOf(cell);
      const size = cell.getBoundingClientRect().width * 0.78;
      const flyer = document.createElement("img");
      flyer.src = part.img;
      flyer.className = "gc-flyer";
      Object.assign(flyer.style, { left: `${to.x - (size / 2)}px`, top: `${to.y - (size / 2)}px`, width: `${size}px`, height: `${size}px` });
      overlay.append(flyer);
      const dx = from.x - to.x;
      const dy = from.y - to.y;
      const delay = flights.length * 60;
      const first = !flights.length;
      flights.push(animate(flyer, [
        { transform: `translate(${dx}px, ${dy}px) scale(0.15) rotate(-200deg)`, opacity: 0 },
        { transform: `translate(${dx * 0.15}px, ${(dy * 0.15) - 18}px) scale(1.12) rotate(8deg)`, opacity: 1, offset: 0.75 },
        { transform: "translate(0, 0) scale(1) rotate(0)", opacity: 1 }
      ], { duration: 760, delay, easing: "cubic-bezier(.25,.65,.45,1)" }).then(() => {
        if ( first ) playCue("success");
        cell.classList.add("gc-landed");
        this.fx.burst(to.x, to.y, { count: 24, speed: 160 });
      }));
      this.#trailFollow(flyer, 760 + delay);
    });
    await Promise.all(flights);
    // The flyers stay where they landed until the render puts the real items under them.
    await wait(450);
  }

  /**
   * Keep emitting trail particles behind a moving element until it lands.
   * @param {HTMLElement} el
   * @param {number} duration
   */
  #trailFollow(el, duration) {
    const end = performance.now() + duration;
    const step = () => {
      if ( !el.isConnected || (performance.now() > end) ) return;
      const { x, y } = this.fx.centerOf(el);
      this.fx.trail(x, y);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /**
   * A short-lived glow element centred on a point.
   * @param {HTMLElement} overlay
   * @param {{x: number, y: number}} at
   * @param {string} cls
   * @param {number} [duration=900]
   */
  #flash(overlay, at, cls, duration = 900) {
    const el = document.createElement("div");
    el.className = `gc-flash ${cls}`;
    Object.assign(el.style, { left: `${at.x}px`, top: `${at.y}px` });
    overlay.append(el);
    setTimeout(() => el.remove(), duration);
  }

  /**
   * A streak of light from one point to another.
   * @param {HTMLElement} overlay
   * @param {{x: number, y: number}} from
   * @param {{x: number, y: number}} to
   */
  async #beam(overlay, from, to) {
    const el = document.createElement("div");
    el.className = "gc-beam";
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    Object.assign(el.style, { left: `${from.x}px`, top: `${from.y}px`, width: `${len}px`,
      transform: `rotate(${angle}rad)` });
    overlay.append(el);
    const orb = document.createElement("div");
    orb.className = "gc-orb";
    Object.assign(orb.style, { left: `${from.x}px`, top: `${from.y}px` });
    overlay.append(orb);
    this.#trailFollow(orb, 420);
    animate(el, [{ clipPath: "inset(0 100% 0 0)", opacity: 1 }, { clipPath: "inset(0 0 0 0)", opacity: 1, offset: 0.6 },
      { clipPath: "inset(0 0 0 100%)", opacity: 0.2 }], { duration: 640, easing: "ease-in" }).then(() => el.remove());
    await animate(orb, [{ transform: "translate(-50%, -50%) scale(0.6)" },
      { transform: `translate(calc(-50% + ${to.x - from.x}px), calc(-50% + ${to.y - from.y}px)) scale(1.4)` }],
    { duration: 420, easing: "cubic-bezier(.6,0,.4,1)" });
    orb.remove();
  }

  /**
   * The materials refuse to combine: the grid flares red and shudders; lost materials crumble to ash.
   * A refused dismantle does the same to the circle, and nothing crumbles.
   * @param {boolean} lost
   * @param {HTMLElement} [target]
   */
  async #playFailure(lost, target = this.element.querySelector(".gc-grid")) {
    playCue("failure");
    const { x, y } = this.fx.centerOf(target);
    target.classList.add("gc-failed");
    this.fx.burst(x, y, { kind: "smoke", count: 26 });
    await animate(target, [
      { transform: "translateX(0)" }, { transform: "translateX(-10px)" }, { transform: "translateX(9px)" },
      { transform: "translateX(-6px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" }
    ], { duration: 480, easing: "ease-out", fill: "none" });
    if ( lost ) {
      const crumbles = [];
      for ( const img of target.querySelectorAll(".gc-cell img") ) {
        const c = this.fx.centerOf(img);
        this.fx.burst(c.x, c.y, { kind: "smoke", count: 6 });
        img.classList.add("gc-ash");
        crumbles.push(animate(img, [
          { opacity: 1, transform: "scale(1)" },
          { opacity: 0, transform: "scale(0.6) translateY(8px)" }
        ], { duration: 700, easing: "ease-in" }));
      }
      await Promise.all(crumbles);
    }
    await wait(400);
    target.classList.remove("gc-failed");
  }
}

/**
 * How many units of an item the actor carries, across every copy of it.
 * @param {import("../helpers.js").ItemRef} ref
 * @param {Actor} actor
 * @returns {number}
 */
function carried(ref, actor) {
  return actor.items.reduce((n, i) => n + (refMatches(ref, toItemRef(i)) ? Math.max(getQuantity(i) ?? 1, 0) : 0), 0);
}
