/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, SETTING_ALLOWED_TYPES, TEMPLATE_PATH } from "../constants.js";
import { getTheme } from "../helpers.js";

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
    }
  };

  static PARTS = {
    main: { template: `${TEMPLATE_PATH}/item-types-config.hbs` }
  };

  /** @override */
  async _prepareContext(options) {
    const allowed = game.settings.get(MODULE_ID, SETTING_ALLOWED_TYPES);
    const types = game.documentTypes.Item.filter(t => t !== CONST.BASE_DOCUMENT_TYPE);
    // Systems can keep legacy types without a label; show those by their id.
    const choices = types.map(type => {
      const key = CONFIG.Item.typeLabels?.[type];
      return { type, label: (key && game.i18n.has(key)) ? game.i18n.localize(key) : type, checked: allowed.includes(type) };
    });
    return { types: game.i18n.sortObjects(choices, "label") };
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
    await game.settings.set(MODULE_ID, SETTING_ALLOWED_TYPES, types);
  }
}
