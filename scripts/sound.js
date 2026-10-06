/*!
 * Grid Crafter
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, SETTING_SOUND_VOLUME, SOUND_CUES, SOUND_PATH } from "./constants.js";
import { getTheme } from "./helpers.js";

/**
 * The sound the active theme ships for a cue, used whenever the GM has not chosen a file.
 * @param {"craft"|"success"|"failure"|"share"} cue
 * @returns {string}
 */
export function defaultCueSource(cue) {
  return `${SOUND_PATH}/${getTheme()}-${cue}.ogg`;
}

/**
 * Play a file on the Interface channel, so each user's Interface volume scales it.
 * @param {string} src
 * @param {number} volume   base volume, 0 to 1
 */
export function playOnInterface(src, volume) {
  if ( !volume ) return;
  foundry.audio.AudioHelper.play({ src, volume, channel: "interface", autoplay: true }, false);
}

/**
 * Play one of the module's sound cues on this client only.
 * @param {"craft"|"success"|"failure"|"share"} cue
 */
export function playCue(cue) {
  const src = game.settings.get(MODULE_ID, SOUND_CUES[cue]) || defaultCueSource(cue);
  playOnInterface(src, game.settings.get(MODULE_ID, SETTING_SOUND_VOLUME));
}
