/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID } from "./constants.js";
import { registerSettings } from "./settings.js";
import { api } from "./api.js";
import { registerRevealQuery } from "./share.js";
import { registerReceiptHooks } from "./receipts.js";

Hooks.once("init", () => {
  registerSettings();
  registerRevealQuery();
  registerReceiptHooks();
  game.modules.get(MODULE_ID).api = api;
  globalThis.GridCrafter = api;
});

Hooks.once("ready", () => {
  Hooks.callAll(`${MODULE_ID}.ready`, api);
});

/**
 * Forge and recipe buttons at the top of the Items directory.
 * @param {foundry.applications.sidebar.tabs.ItemDirectory} app
 * @param {HTMLElement} html
 */
Hooks.on("renderItemDirectory", (app, html) => {
  // A partial re-render can leave the header in place, buttons included.
  const header = html.querySelector(".directory-header");
  if ( !header || header.querySelector(`.${MODULE_ID}.gc-directory-buttons`) ) return;
  const row = document.createElement("div");
  row.className = `${MODULE_ID} gc-directory-buttons`;
  const button = (action, icon, label, onClick) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.gcAction = action;
    b.innerHTML = `<i class="${icon}" inert></i> <span>${game.i18n.localize(label)}</span>`;
    b.addEventListener("click", onClick);
    row.append(b);
  };
  button("forge", "fa-solid fa-hammer-crash", "GRIDCRAFTER.Forge.Open", () => api.forge());
  if ( game.user.isGM ) button("recipes", "fa-solid fa-scroll-old", "GRIDCRAFTER.Editor.Open", () => api.recipes());
  header.querySelector(".header-actions")?.after(row);
});
