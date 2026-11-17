/**
 * The boot sequence (ARCHITECTURE 3.1, steps 2-7) and the foundation's fallback loading layer.
 * Step 1 (flags, error traps, #app, base CSS, loading layer) is in src/main.js.
 * @module game/boot
 */

import { createContext } from '../core/context.js';
import { createStore } from '../core/store.js';
import { createSave } from '../core/save.js';
import { createDefs } from '../core/defs.js';
import { createI18n } from '../core/i18n.js';
import { STRINGS } from '../core/strings.js';
import { createFx } from '../core/fx.js';
import { createDebug } from '../core/debug.js';
import { setTextScale } from '../core/theme.js';
import { createSession } from './session.js';
import { installStandins, installPackages, installGlue } from './game.js';

/** Circumference of the loading ring (r = 42). */
const RING = 2 * Math.PI * 42;

/** Boot progress per phase: [start, end] of the overall 0..1 bar. */
const PHASES = Object.freeze({
  boot: [0, 0.05], content: [0.05, 0.1], render: [0.1, 0.15], world: [0.15, 0.8], hooks: [0.8, 0.9], compile: [0.9, 0.98], ready: [1, 1],
});

/**
 * @typedef {object} LoadingLayer
 * @property {(phase:string, progress:number) => void} update  progress 0..1 of the whole boot
 * @property {(t:(key:string) => string) => void} setTranslator  switch to the i18n service once it exists
 * @property {() => void} hide
 */

/**
 * The fallback loading layer: an ink background with a ring that fills and one line of text.
 * @param {import('../core/dom.js').Dom} dom
 * @param {'he'|'en'} lang  language used until i18n exists
 * @returns {LoadingLayer}
 */
export function createLoadingLayer(dom, lang) {
  const table = /** @type {Record<string, string>} */ (/** @type {any} */ (STRINGS)[lang] || STRINGS.he);
  /** @type {(key:string) => string} */
  let t = (key) => table[key] || '';
  const NS = 'http://www.w3.org/2000/svg';
  const layer = dom.layer('overlay');
  const node = dom.el('div', 'k-loading', layer);
  node.setAttribute('role', 'status');
  const title = dom.el('div', 'k-loading-title', node, t('core.game.title'));
  const svg = dom.doc.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'k-loading-ring');
  svg.setAttribute('viewBox', '0 0 96 96');
  const circle = (cls) => {
    const c = dom.doc.createElementNS(NS, 'circle');
    c.setAttribute('class', cls);
    c.setAttribute('cx', '48');
    c.setAttribute('cy', '48');
    c.setAttribute('r', '42');
    svg.appendChild(c);
    return c;
  };
  circle('k-loading-track');
  const fill = circle('k-loading-fill');
  fill.setAttribute('transform', 'rotate(-90 48 48)');
  fill.setAttribute('stroke-dasharray', String(RING));
  fill.setAttribute('stroke-dashoffset', String(RING));
  node.appendChild(svg);
  const text = dom.el('div', 'k-loading-text', node);
  let phase = 'boot';
  let progress = 0;

  function paint() {
    const label = t('core.loading.' + phase) || t('core.loading.boot');
    text.textContent = label + ' ' + t('core.loading.progress').replace('{pct}', String(Math.round(progress * 100)));
    fill.setAttribute('stroke-dashoffset', String(RING * (1 - progress)));
  }
  paint();

  return {
    update(p, value) {
      phase = p;
      progress = Math.max(progress, Math.min(1, Math.max(0, value)));
      paint();
    },
    setTranslator(fn) {
      t = fn;
      title.textContent = t('core.game.title');
      paint();
    },
    hide() {
      node.remove();
    },
  };
}

/**
 * Emit `game:boot` with the overall progress of `phase` at `local` (0..1 within the phase).
 * @param {any} ctx @param {keyof typeof PHASES} phase @param {number} local
 */
function progress(ctx, phase, local) {
  const [a, b] = PHASES[phase];
  ctx.bus.emit('game:boot', { phase, progress: a + (b - a) * Math.min(1, Math.max(0, local)) });
}

/**
 * Run boot steps 2-7.
 * @param {{ flags:any, log:import('../core/log.js').Log, dom:import('../core/dom.js').Dom,
 *           errors:import('../core/errors.js').ErrorService, loading:LoadingLayer, version:string }} env
 * @returns {Promise<any>} the context, once `game:ready` was emitted
 */
export async function boot(env) {
  const { flags, log, dom, errors, loading } = env;

  // (2) context, settings, language
  const store = createStore();
  const ctx = createContext({ flags, log, dom, store });
  errors.attach(ctx);
  ctx.bus.on('game:boot', (p) => loading.update(p.phase, p.progress), 'core.boot');
  ctx.defs = createDefs({ strict: ctx.dev, log });
  ctx.i18n = createI18n({ lang: flags.lang || 'he', bus: ctx.bus, getRoot: () => ctx.dom.root, log });
  ctx.i18n.addStrings(STRINGS);
  ctx.save = createSave({
    store,
    storage: dom.safeStorage,
    memoryOnly: !!flags.nosave,
    autosave: !flags.test,
    bus: ctx.bus,
    log,
    getPlayer: () => ctx.player,
    ringstonePos: (id) => {
      const p = ctx.world ? ctx.world.pois('ringstone').find((q) => q.id === id) : null;
      return p ? { x: p.x, y: p.y, z: p.z } : null;
    },
    regionAt: (x, z) => (ctx.world ? ctx.world.regionAt(x, z) : ''),
  });
  ctx.fx = createFx(ctx);
  const debug = createDebug(ctx, { version: env.version });
  ctx.debug = debug;
  if (typeof window !== 'undefined') /** @type {any} */ (window).__GAME__ = debug.api;
  ctx.session = createSession(ctx);
  ctx.i18n.setLang(flags.lang || ctx.save.settings.lang);
  setTextScale(dom, ctx.save.settings.textScale);
  loading.setTranslator((key) => (ctx.i18n.has(key) ? ctx.i18n.t(key) : ''));
  installGlue(ctx, { hideLoading: () => loading.hide() });
  progress(ctx, 'boot', 1);

  try {
    // (3) stand-ins, then the discovered packages; no slot changes after this
    installStandins(ctx);
    const ids = installPackages(ctx);
    log.info('boot', 'packages:', ids.length ? ids.join(', ') : '(none, stand-ins only)');
    progress(ctx, 'content', 1);

    // (4) renderer, world bake, boot hooks, program warm-up
    if (typeof window !== 'undefined' && typeof /** @type {any} */ (window).WebGL2RenderingContext === 'undefined') {
      throw new Error(ctx.i18n.t('core.fatal.webgl'));
    }
    progress(ctx, 'render', 0);
    await ctx.render.init();
    const canvas = ctx.three.renderer && ctx.three.renderer.domElement;
    if (canvas) errors.watchContext(canvas);
    progress(ctx, 'world', 0);
    await ctx.world.bake((p) => progress(ctx, 'world', p));
    progress(ctx, 'hooks', 0);
    await ctx.runBootHooks();
    progress(ctx, 'compile', 0);
    await ctx.render.compile();

    // (5) cross-references
    const v = ctx.defs.validate();
    if (v && !v.ok) log.warn('defs', `${v.errors.length} dangling reference(s):`, v.errors.slice(0, 20).join('; '));

    // (6) title, or a fresh journey in test mode
    if (flags.test) {
      if (!ctx.session.start({ slot: 1, newGame: true })) throw new Error('boot: the test journey could not start');
    } else if (!flags.bench) {
      ctx.ui.open('title');
    }

    // (7) ready
    progress(ctx, 'ready', 1);
    ctx.bus.emit('game:ready', {});
    ctx.loop.renderNow();
    loading.hide();
    debug.markReady();
    ctx.loop.start();
    if (flags.bench) debug.api.bench();
  } catch (err) {
    debug.failReady(err);
    throw err;
  }
  return ctx;
}
