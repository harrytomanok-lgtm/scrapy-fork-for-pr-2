/**
 * Service installation and the foundation's game glue (ARCHITECTURE 2.3, 3.1 step 3).
 *
 * STAND-IN MODULE SHAPE (agreed contract for src/standins/*.js): every stand-in module exports
 *
 *     export function install(ctx) { ... }
 *
 * which provides its slot(s) with `ctx.provide(slot, impl, 'standin:<slot>')` and registers its systems and bus
 * listeners while `ctx.owner` is `'standin:<module name>'` (boot wraps each call in `ctx.installAs`), so that
 * `ctx.provide` from the owning package removes them. `content.js` provides no slot: it registers a stand-in
 * definition for every id of IDS (3.8) and the playable stand-in content. The stand-ins are installed in the
 * order of STANDINS (content first), then the discovered packages in the order of the generated registry.
 * @module game/game
 */

import { SERVICE_SLOTS, SIM_DT } from '../core/constants.js';
import { setTextScale } from '../core/theme.js';
import { PACKAGES } from './registry.gen.js';
import * as content from '../standins/content.js';
import * as render from '../standins/render.js';
import * as vfx from '../standins/vfx.js';
import * as world from '../standins/world.js';
import * as env from '../standins/env.js';
import * as audio from '../standins/audio.js';
import * as actors from '../standins/actors.js';
import * as move from '../standins/move.js';
import * as cam from '../standins/cam.js';
import * as combat from '../standins/combat.js';
import * as ai from '../standins/ai.js';
import * as rpg from '../standins/rpg.js';
import * as quests from '../standins/quests.js';
import * as ui from '../standins/ui.js';

/** @typedef {{ install:(ctx:any) => void }} StandinModule */
/** @typedef {{ id:string, install:(ctx:any) => void }} PackageManifest */

/** Stand-in modules in install order: [name, module]. The owner of each is 'standin:<name>'. */
export const STANDINS = Object.freeze([
  ['content', content], ['render', render], ['vfx', vfx], ['world', world], ['env', env], ['audio', audio],
  ['actors', actors], ['move', move], ['cam', cam], ['combat', combat], ['ai', ai], ['rpg', rpg],
  ['quests', quests], ['ui', ui],
]);

/**
 * Throw when a replaceable slot is empty (a stand-in or a package failed to provide it).
 * @param {any} ctx @param {string} when
 */
function assertSlots(ctx, when) {
  const missing = SERVICE_SLOTS.filter((s) => !ctx[s]);
  if (missing.length) throw new Error(`boot: no service for slot(s) ${missing.join(', ')} ${when}`);
}

/**
 * Install every stand-in (2.3), each under the owner 'standin:<name>'.
 * @param {any} ctx
 * @param {ReadonlyArray<[string, StandinModule]>} [list=STANDINS]
 */
export function installStandins(ctx, list = STANDINS) {
  for (const [name, mod] of list) {
    if (!mod || typeof mod.install !== 'function') throw new Error(`boot: src/standins/${name}.js must export install(ctx)`);
    ctx.installAs('standin:' + name, () => mod.install(ctx));
  }
  assertSlots(ctx, 'after the stand-ins');
}

/**
 * Install the discovered feature packages in registry order, each under its package id.
 * @param {any} ctx
 * @param {ReadonlyArray<PackageManifest>} [packages=PACKAGES]
 * @returns {string[]} the installed package ids
 */
export function installPackages(ctx, packages = PACKAGES) {
  const ids = [];
  for (const pkg of packages) {
    if (!pkg || typeof pkg.id !== 'string' || typeof pkg.install !== 'function') {
      throw new Error('boot: a package index.js must export pkg = { id, install(ctx) }');
    }
    ctx.installAs(pkg.id, () => pkg.install(ctx));
    ids.push(pkg.id);
  }
  assertSlots(ctx, 'after the packages');
  return ids;
}

/**
 * The foundation's runtime glue, installed once before any package:
 * - system `core.save` (cleanup phase, after `core.cleanup`): `save.tick` for play time and autosave;
 * - `settings:changed`: language and text size;
 * - page visibility: pause reason 'hidden' while the page is hidden (not in test mode);
 * - `ui:screen { id:'loading', open:true }`: hide the foundation's fallback loading layer.
 * @param {any} ctx
 * @param {{ hideLoading:() => void }} hooks
 */
export function installGlue(ctx, hooks) {
  ctx.installAs('core', () => {
    ctx.systems.add({
      id: 'core.save',
      phase: 'cleanup',
      order: 1100,
      /** @param {any} c */
      step(c) {
        c.save.tick(SIM_DT);
      },
    });
    ctx.bus.on('settings:changed', (p) => {
      if (p.key === 'lang' && ctx.i18n.lang !== p.value) ctx.i18n.setLang(p.value);
      else if (p.key === 'textScale' && ctx.dom) setTextScale(ctx.dom, p.value);
    });
    ctx.bus.on('ui:screen', (p) => {
      if (p.id === 'loading' && p.open) hooks.hideLoading();
    });
  });
  if (!ctx.flags.test && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') ctx.time.pause('hidden');
      else ctx.time.resume('hidden');
    });
  }
}
