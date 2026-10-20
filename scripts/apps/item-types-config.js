/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, SETTING_ALLOWED_TYPES, TEMPLATE_PATH } from "../constants.js";
import { getAllowedTypes, getTheme, getTypeSuggestions, sourceLabel } from "../helpers.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Which item types may go on a crafting grid. Systems have many types and only a few make sense as
 * materials: nobody forges a hammer out of a class.
 */
export class ItemTypesConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-item-types`,
    tag: "form",
    classes: [MODULE_ID, "gc-app", "gc-item-types"],
    window: {
      title: "GRIDCRAFTER.Settings.ItemTypes.Name",
      icon: "fa-solid fa-filter"
    },
    position: { width: 380, height: "auto" },
    form: {
      handler: ItemTypesConfig.#onSubmit,
      closeOnSubmit: true
    },
    actions: {
      restore: ItemTypesConfig.#onRestore
    }
  };

  static PARTS = {
    main: { template: `${TEMPLATE_PATH}/item-types-config.hbs` }
  };

  /** @override */
  async _prepareContext(options) {
    // What the forge enforces, so suggested types show checked before the GM ever saves.
    const allowed = getAllowedTypes();
    const suggestions = getTypeSuggestions();
    const saved = !!game.settings.get(MODULE_ID, SETTING_ALLOWED_TYPES, { document: true }).id;
    const list = game.i18n.getListFormatter();
    const types = game.documentTypes.Item.filter(t => t !== CONST.BASE_DOCUMENT_TYPE);
    // Systems can keep legacy types without a label; show those by their id.
    const choices = types.map(type => {
      const key = CONFIG.Item.typeLabels?.[type];
      // The marker shows the suggestion and the toggle the decision, so a type the GM turned off keeps it.
      const sources = suggestions.get(type);
      return {
        type,
        label: (key && game.i18n.has(key)) ? game.i18n.localize(key) : type,
        checked: allowed.includes(type),
        suggestedBy: sources ? game.i18n.localize("GRIDCRAFTER.Settings.ItemTypes.SuggestedBy",
          { sources: list.format(sources.map(sourceLabel)) }) : ""
      };
    });
    return { types: game.i18n.sortObjects(choices, "label"), canRestore: saved && (suggestions.size > 0) };
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const theme = getTheme();
    for ( const t of ["forge", "arcane"] ) this.element.classList.toggle(`gc-theme-${t}`, t === theme);
  }

  /**
   * @this {ItemTypesConfig}
   * @param {SubmitEvent} event
   * @param {HTMLFormElement} form
   * @param {FormDataExtended} formData
   */
  static async #onSubmit(event, form, formData) {
    const types = [...form.querySelectorAll("input[name='types']:checked")].map(i => i.value);
    // Saving exactly the suggestions keeps following them, so a press of Save without changes
    // doesn't freeze out what a package suggests later. Only a different choice is stored.
    const suggested = new Set(getTypeSuggestions().keys());
    if ( (types.length === suggested.size) && types.every(t => suggested.has(t)) ) {
      const doc = game.settings.get(MODULE_ID, SETTING_ALLOWED_TYPES, { document: true });
      if ( doc.id ) await doc.delete();
      return;
    }
    await game.settings.set(MODULE_ID, SETTING_ALLOWED_TYPES, types);
  }

  /**
   * Forget the GM's saved choice so the suggestions apply again. The window stays open to show them.
   * @this {ItemTypesConfig}
   */
  static async #onRestore() {
    await game.settings.get(MODULE_ID, SETTING_ALLOWED_TYPES, { document: true }).delete();
    this.render();
  }
}
