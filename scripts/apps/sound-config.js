/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, SETTING_SOUND_VOLUME, SOUND_CUES, TEMPLATE_PATH } from "../constants.js";
import { getTheme } from "../helpers.js";
import { defaultCueSource, playOnInterface } from "../sound.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const CUE_LABELS = {
  craft: "GRIDCRAFTER.Settings.SoundCraft.Name",
  success: "GRIDCRAFTER.Settings.SoundSuccess.Name",
  failure: "GRIDCRAFTER.Settings.SoundFailure.Name",
  share: "GRIDCRAFTER.Settings.SoundShare.Name"
};

/**
 * Every sound option in one place, for the GM: the base volume of the cues and the file for each.
 */
export class SoundConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-sounds`,
    tag: "form",
    classes: [MODULE_ID, "gc-app", "gc-sound-config"],
    window: {
      title: "GRIDCRAFTER.Settings.Sounds.Name",
      icon: "fa-solid fa-volume-high"
    },
    position: { width: 540, height: "auto" },
    form: {
      handler: SoundConfig.#onSubmit,
      closeOnSubmit: true
    },
    actions: {
      browse: SoundConfig.#onBrowse,
      preview: SoundConfig.#onPreview,
      reset: SoundConfig.#onReset
    }
  };

  static PARTS = {
    main: { template: `${TEMPLATE_PATH}/sound-config.hbs` }
  };

  /** @override */
  async _prepareContext(options) {
    return {
      volume: Math.round(game.settings.get(MODULE_ID, SETTING_SOUND_VOLUME) * 100),
      cues: Object.entries(SOUND_CUES).map(([cue, key]) => ({
        cue,
        key,
        label: CUE_LABELS[cue],
        value: game.settings.get(MODULE_ID, key),
        placeholder: defaultCueSource(cue)
      }))
    };
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const theme = getTheme();
    for ( const t of ["forge", "arcane"] ) this.element.classList.toggle(`gc-theme-${t}`, t === theme);
    const volume = this.element.querySelector("input[name='volume']");
    volume.addEventListener("input", () => {
      this.element.querySelector(".gc-volume-value").textContent = `${volume.value}%`;
    });
  }

  /**
   * @param {HTMLElement} target   a button inside a sound row
   * @returns {HTMLInputElement}
   */
  static #pathInput(target) {
    return target.closest(".gc-sound-row").querySelector("input[type='text']");
  }

  /** @this {SoundConfig} */
  static #onBrowse(event, target) {
    const input = SoundConfig.#pathInput(target);
    // Resolve the active implementation: host environments may substitute their own picker.
    const FilePickerClass = foundry.applications.apps.FilePicker.implementation
      ?? foundry.applications.apps.FilePicker;
    const picker = new FilePickerClass({
      type: "audio",
      current: input.value || input.placeholder,
      callback: path => input.value = path
    });
    picker.render({ force: true });
  }

  /**
   * Play the row's file, or the theme's own sound when it is empty, at the volume being set.
   * @this {SoundConfig}
   */
  static #onPreview(event, target) {
    const input = SoundConfig.#pathInput(target);
    const volume = Number(this.element.querySelector("input[name='volume']").value) / 100;
    playOnInterface(input.value || input.placeholder, volume);
  }

  /** @this {SoundConfig} */
  static #onReset(event, target) {
    SoundConfig.#pathInput(target).value = "";
  }

  /**
   * @this {SoundConfig}
   * @param {SubmitEvent} event
   * @param {HTMLFormElement} form
   * @param {FormDataExtended} formData
   */
  static async #onSubmit(event, form, formData) {
    const data = formData.object;
    await game.settings.set(MODULE_ID, SETTING_SOUND_VOLUME, Math.clamp(Number(data.volume) || 0, 0, 100) / 100);
    for ( const key of Object.values(SOUND_CUES) ) {
      await game.settings.set(MODULE_ID, key, String(data[key] ?? "").trim());
    }
  }
}
