/**
 * The ui package (ARCHITECTURE 4.13, 8.9): replaces the stand-in `ctx.ui` with the HUD, every P0 screen of
 * ART_UX 7.2, onboarding prompts and hints, and the settings wired to `save.setSetting`.
 * Frame system `ui.hud` (phase ui). Implements events `ui:screen` (and `settings:changed` through save.setSetting).
 * @module ui/index
 */

import { BALANCE } from '../core/balance.js';
import { UI_STRINGS } from './strings.js';
import { UI_CSS } from './styles.js';
import { createKit } from './kit.js';
import { createManager } from './manager.js';
import { createHud } from './hud.js';
import { registerBootScreens } from './screens/boot.js';
import { registerMenuScreens } from './screens/menu.js';
import { registerOtherScreens, applyStoredShadows } from './screens/other.js';
import { createPerfLog } from './logic/perfLog.js';

const OWNER = 'ui';
/** Screens that cover the HUD completely. */
const BLOCKING = Object.freeze(['title', 'loading', 'newgame', 'ending', 'fatal', 'death',
  // Full-panel menus hide the HUD too, so nothing shows through their backdrop.
  'pause', 'character', 'techniques', 'inventory', 'quests', 'map', 'settings', 'controls', 'savecode', 'shop', 'credits']);
const HUD_MENUS = Object.freeze({ map: 'map', menuQuests: 'quests', menuInventory: 'inventory', menuTechniques: 'techniques', menuCharacter: 'character' });

/**
 * Build the ui service and its wiring.
 * @param {any} ctx
 */
export function createUi(ctx) {
  const dom = ctx.dom;
  // The stand-in's stylesheet shares the `ui-` prefix; blank it so only this package's identity applies.
  dom.addStyle('standin-ui', '');
  dom.addStyle('ui', UI_CSS);
  const kit = createKit(ctx);
  const mgr = createManager(ctx, kit);
  /** @type {((v:boolean) => void)|null} */
  let confirmResolve = null;
  let deathAt = -1;
  /** @type {string|null} */
  let deathBoss = null;
  let loadingT = 0;
  /** A ring race is running (race:start .. race:end): the map's Ringstone travel says why it waits. */
  let racing = false;

  // Presented frame intervals during play, for the device report in Settings.
  const perfLog = createPerfLog();
  const ui = {
    perfLog,
    /** True while a ring race runs (the map explains a refused Ringstone travel with it). */
    get racing() {
      return racing;
    },
    /** @param {string} screenId @param {any} [params] */
    open(screenId, params) {
      if (screenId === 'hud') {
        mgr.closeAll();
        return;
      }
      mgr.open(screenId, params);
      syncGlyphs();
    },
    /** @param {string} [screenId] */
    close(screenId) {
      mgr.close(screenId);
    },
    closeAll() {
      mgr.closeAll();
    },
    top() {
      return mgr.top();
    },
    /** @param {string} screenId */
    isOpen(screenId) {
      return mgr.isOpen(screenId);
    },
    /** @param {string} key @param {any} [args] @param {'info'|'good'|'warn'} [kind='info'] */
    toast(key, args, kind = 'info') {
      ctx.bus.emit('ui:toast', { key, args: args || null, kind });
    },
    /** @param {string} kind @param {string} key @param {any} [args] */
    banner(kind, key, args) {
      ctx.bus.emit('ui:banner', { kind, key, args: args || null });
    },
    /** @param {string} key @param {any} [args] @returns {Promise<boolean>} */
    confirm(key, args) {
      if (confirmResolve) {
        const r = confirmResolve;
        confirmResolve = null;
        r(false);
      }
      return new Promise((resolve) => {
        confirmResolve = resolve;
        mgr.open('confirm', { key, args: args || null });
      });
    },
    /** @param {boolean} visible */
    setHudVisible(visible) {
      hud.setVisible(visible);
    },
    /** @param {boolean} on */
    letterbox(on) {
      hud.letterbox(on);
    },
    /** @param {number} alpha @param {number} seconds @returns {Promise<void>} */
    fade(alpha, seconds) {
      return hud.fade(alpha, seconds);
    },
    /** @param {string} id @param {Function} factory */
    registerScreen(id, factory) {
      mgr.registerScreen(id, factory);
    },
    /** Internal: focus the top screen's preferred element again (dialogue choices after typing). */
    refocus() {
      mgr.refocus();
    },
    /** Internal: take the pending confirm resolver. */
    confirmResolve() {
      const r = confirmResolve;
      confirmResolve = null;
      return r;
    },
    /** Internal: a screen that hides the HUD is open. */
    isBlocking() {
      for (const id of mgr.stack) if (BLOCKING.indexOf(id) >= 0) return true;
      return false;
    },
    /** Diagnostics for scenarios: HUD piece rectangles, the HUD mode, focus graph of the top screen. */
    debug() {
      return { mode: hud.mode, pieces: hud.pieces(), keepOut: hud.keepOut(), centre: hud.centre(), held: hud.held(), focus: mgr.focusReport(), stack: mgr.stack.slice() };
    },
    dispose() {
      mgr.closeAll();
      for (const s of mgr.screens.values()) s.el.remove();
      mgr.screens.clear();
      hud.dispose();
      offPress();
    },
  };

  const hud = createHud(ctx, kit, ui);
  registerBootScreens(ctx, kit, ui, mgr.registerScreen);
  registerMenuScreens(ctx, kit, ui, mgr, mgr.registerScreen);
  registerOtherScreens(ctx, kit, ui, mgr.registerScreen);

  function syncGlyphs() {
    const touch = ctx.input.device === 'touch';
    dom.root.classList.toggle('ui-kbd', !touch);
    const list = dom.root.querySelectorAll('[data-glyph]');
    for (let i = 0; i < list.length; i++) {
      const n = /** @type {HTMLElement} */ (list[i]);
      n.textContent = touch ? '' : ctx.input.glyph(n.dataset.glyph || '').label || '';
    }
  }

  const offPress = ctx.input.onPress((action) => {
    if (mgr.press(action)) return;
    // HUD level.
    const p = ctx.player;
    if (!p || !p.alive || (ctx.cam && ctx.cam.busy)) return;
    if (action === 'pause') ui.open('pause', {});
    else if (HUD_MENUS[action]) ui.open(HUD_MENUS[action], {});
  });

  const system = {
    id: 'ui.hud',
    phase: 'ui',
    /** @param {any} c @param {number} dt */
    frame(c, dt) {
      mgr.tick();
      if (deathAt >= 0 && c.time.now >= deathAt && !mgr.isOpen('death')) {
        deathAt = -1;
        ui.open('death', { bossId: deathBoss });
      }
      const top = mgr.top();
      if (top === 'hud' && c.session && c.session.running) perfLog.push(dt);
      if (top === 'dialogue') {
        const s = /** @type {any} */ (mgr.screens.get('dialogue'));
        if (s) s.tick(dt > 0 ? dt : 0);
      } else if (top === 'loading') {
        loadingT += dt;
        const s = /** @type {any} */ (mgr.screens.get('loading'));
        if (s) s.tick(loadingT);
      }
      hud.frame(c, dt);
    },
  };

  const on = {
    /** @param {any} p game:boot */
    boot(p) {
      if (!mgr.isOpen('loading') && p.progress < 1) ui.open('loading', {});
      const s = /** @type {any} */ (mgr.screens.get('loading'));
      if (s && s.update) s.update(p.phase, p.progress);
    },
    ready() {
      mgr.close('loading');
    },
    /** @param {any} p player:died */
    died(p) {
      deathBoss = p.bossId || null;
      deathAt = ctx.time.now + BALANCE.death.slowSeconds;
    },
    respawned() {
      deathAt = -1;
      if (mgr.isOpen('death')) mgr.close('death');
    },
    dlgStart() {
      ui.open('dialogue', {});
    },
    raceStart() {
      racing = true;
    },
    raceEnd() {
      racing = false;
    },
    /** @param {any} p dialogue:line */
    dlgLine(p) {
      if (!mgr.isOpen('dialogue')) ui.open('dialogue', {});
      const s = /** @type {any} */ (mgr.screens.get('dialogue'));
      if (s) s.line(p);
    },
    dlgEnd() {
      if (mgr.isOpen('dialogue')) mgr.close('dialogue');
    },
    lang() {
      kit.refresh();
      mgr.lang();
      hud.on.lang();
      syncGlyphs();
    },
    device() {
      hud.on.device();
      syncGlyphs();
    },
    /** @param {any} p settings:changed */
    settings(p) {
      if (p.key === 'reducedMotion') dom.root.classList.toggle('ui-reduced', !!p.value);
      if (p.key === 'photosensitive') dom.root.classList.toggle('ui-photo', !!p.value);
      if (p.key === 'textScale' || p.key === 'leftHanded') hud.markLayout();
    },
    loaded() {
      hud.on.loaded();
      if (ctx.save.memoryOnly && !ctx.flags.test) ui.toast('core.save.memoryOnly', null, 'warn');
    },
    ended() {
      deathAt = -1;
      racing = false;
      hud.on.ended();
      for (const id of ['dialogue', 'death', 'pause', 'shop', ...Object.values(HUD_MENUS)]) if (mgr.isOpen(id)) mgr.close(id);
    },
    /** @param {any} p ui:screen */
    screen(p) {
      if (!p.open && mgr.top() === 'hud') hud.on.badge();
    },
  };

  /** @param {any} b bus */
  function wire(b) {
    b.on('game:boot', on.boot, OWNER);
    b.on('game:ready', on.ready, OWNER);
    b.on('game:loaded', on.loaded, OWNER);
    b.on('game:ended', on.ended, OWNER);
    b.on('ui:toast', hud.on.toast, OWNER);
    b.on('ui:banner', hud.on.banner, OWNER);
    b.on('ui:screen', on.screen, OWNER);
    b.on('rpg:levelUp', hud.on.levelUp, OWNER);
    b.on('rpg:techLearned', hud.on.techLearned, OWNER);
    b.on('shrine:claimed', hud.on.badge, OWNER);
    b.on('rpg:resonance', hud.on.resonance, OWNER);
    b.on('quest:started', hud.on.questStarted, OWNER);
    b.on('quest:completed', hud.on.questDone, OWNER);
    b.on('quest:step', hud.on.questStep, OWNER);
    b.on('combat:combo', hud.on.combo, OWNER);
    b.on('rpg:xp', hud.on.xp, OWNER);
    b.on('rpg:shells', hud.on.shells, OWNER);
    b.on('pickup:collected', hud.on.pickup, OWNER);
    b.on('rpg:formUnlocked', hud.on.formUnlocked, OWNER);
    b.on('boss:phase', hud.on.bossPhase, OWNER);
    b.on('fx:impact', hud.on.impact, OWNER);
    b.on('quest:progress', hud.on.questChanged, OWNER);
    b.on('quest:tracked', hud.on.questChanged, OWNER);
    b.on('world:regionEnter', hud.on.region, OWNER);
    b.on('world:poiDiscovered', hud.on.discovered, OWNER);
    b.on('actor:damaged', hud.on.damaged, OWNER);
    b.on('actor:staggered', hud.on.staggered, OWNER);
    b.on('combat:perfect', hud.on.perfect, OWNER);
    b.on('combat:burnout', hud.on.burnout, OWNER);
    b.on('combat:telegraph', hud.on.telegraph, OWNER);
    b.on('ringstone:activated', hud.on.ringstone, OWNER);
    b.on('save:written', hud.on.saved, OWNER);
    b.on('interact:focus', hud.on.focus, OWNER);
    b.on('tutorial:prompt', hud.on.tutorial, OWNER);
    b.on('boss:start', hud.on.bossStart, OWNER);
    b.on('cine:start', hud.on.cineStart, OWNER);
    b.on('cine:end', hud.on.cineEnd, OWNER);
    b.on('player:died', on.died, OWNER);
    b.on('player:respawned', on.respawned, OWNER);
    b.on('race:start', on.raceStart, OWNER);
    b.on('race:end', on.raceEnd, OWNER);
    b.on('dialogue:start', on.dlgStart, OWNER);
    b.on('dialogue:line', on.dlgLine, OWNER);
    b.on('dialogue:end', on.dlgEnd, OWNER);
    b.on('lang:changed', on.lang, OWNER);
    b.on('input:device', on.device, OWNER);
    b.on('settings:changed', on.settings, OWNER);
  }

  return { ui, system, wire, syncGlyphs, settingsInit() {
    const s = ctx.save && ctx.save.settings;
    if (s && s.reducedMotion) dom.root.classList.add('ui-reduced');
    if (s && s.photosensitive) dom.root.classList.add('ui-photo');
    // The renderer exists once the game has booted; the stored shadow choice applies then.
    ctx.onBoot(() => applyStoredShadows(ctx));
    syncGlyphs();
  } };
}

export const pkg = {
  id: 'ui',
  /** @param {any} ctx */
  install(ctx) {
    ctx.i18n.addStrings(UI_STRINGS);
    const u = createUi(ctx);
    ctx.provide('ui', u.ui, 'ui');
    ctx.systems.add(u.system);
    u.wire(ctx.bus);
    u.settingsInit();
    ctx.debug.register('ui', () => u.ui.debug());
  },
};
