/**
 * The part of the stand-in content still needed once every feature package is installed (tools/gen-registry.mjs
 * installs this module instead of content.js in that case).
 *
 * Audit of content.js against the definitions the packages register (world, env, actors, combat, ai, rpg):
 * every id of every defs kind is redefined by its owning package, except
 * - `music` (5 ids of IDS.music): no package registers music definitions. Nothing reads them at runtime
 *   (region.musicKey is checked against the IDS catalog), but section 3.8 promises a definition for every id
 *   of IDS, so they are kept here;
 * - dialogue `mq1_sela`: only the stand-in quest mq1 refers to it, and the rpg package replaces mq1, so it is dropped.
 * No package reads a stand-in-only field. Of the stand-in strings (strings.js), every key no package provides
 * (`ui.pause.points|xp|hp|ora|add`, `ui.dialogue.next`, `ui.toast.item|shells`, `standin.prompt.*`,
 * `standin.idle.greet`) is used only by the stand-in ui, quests and content modules, so none is needed.
 * @module standins/residual
 */

import { IDS } from '../core/ids.js';

/** Tempo of each music id, in IDS.music order. */
const BPM = Object.freeze([84, 72, 66, 132, 144]);

/**
 * The stand-in music definitions (one per id of IDS.music).
 * Pure: usable from Node tests.
 * @returns {object[]}
 */
export function musicDefs() {
  return IDS.music.map((id, i) => ({ id, bpm: BPM[i], mode: id === 'warm' ? 'major' : 'minor' }));
}

/**
 * Register the definitions no package provides.
 * @param {any} ctx
 */
export function install(ctx) {
  ctx.defs.register('music', musicDefs());
}
