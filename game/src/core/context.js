/**
 * The context object passed to everything (ARCHITECTURE 3.3) and the foundation's core systems (3.4).
 *
 * `createContext` builds the runtime services this module owns (time, loop, bus, ents, spatial, rng,
 * systems, input) and registers the core systems `core.prev`, `core.input`, `core.spatial`,
 * `core.cleanup` and `core.inputPoll`. The other final foundation services (store, save, defs, i18n,
 * fx, debug, session) are passed in or assigned once by boot before any package installs.
 * Replaceable slots start as null and are filled with `ctx.provide`.
 * @module core/context
 */

import { SERVICE_SLOTS } from './constants.js';
import { createTime } from './time.js';
import { createLoop } from './loop.js';
import { createBus } from './events.js';
import { createEnts } from './ents.js';
import { createSpatial } from './spatial.js';
import { createRng } from './rng.js';
import { createSystems } from './systems.js';
import { createInput, installDefaultSources } from './input.js';

/**
 * @typedef {object} Ctx
 * @property {object} flags     URL flags (2.6).
 * @property {any} log          log.info / warn / error(tag, ...args).
 * @property {import('./time.js').Time} time
 * @property {import('./loop.js').Loop} loop
 * @property {import('./events.js').Bus} bus
 * @property {any} store
 * @property {any} save
 * @property {any} defs
 * @property {import('./ents.js').Ents} ents
 * @property {import('./spatial.js').Spatial} spatial
 * @property {import('./rng.js').RngService} rng
 * @property {import('./systems.js').Systems} systems
 * @property {any} i18n
 * @property {import('./input.js').Input} input
 * @property {any} fx
 * @property {any} debug
 * @property {any} dom
 * @property {any} session
 * @property {import('./ents.js').Entity|null} player   Set by session.
 * @property {{ renderer:any, scene:any, camera:any }} three  Filled by render.init().
 * @property {any} world @property {any} env @property {any} render @property {any} vfx @property {any} actors
 * @property {any} move @property {any} cam @property {any} combat @property {any} ai @property {any} rpg
 * @property {any} quests @property {any} ui @property {any} audio
 * @property {string|null} owner  Owner id used as the default by `systems.add` and `bus.on` (set by {@link Ctx.installAs}).
 * @property {Record<string, string>} providers  Slot -> owner id of the current implementation.
 * @property {boolean} dev        Dev or test build: unknown events throw, extra checks run.
 * @property {(slot:string, impl:object, ownerId:string) => void} provide
 *   Replace a service: disposes the previous impl (`impl.dispose?.()`), then removes the systems and bus listeners
 *   owned by `'standin:<slot>'`. Throws for an unknown slot.
 * @property {(fn:(ctx:Ctx)=>(void|Promise<void>)) => void} onBoot  Async hook run after the world bake (3.1 step 4).
 * @property {() => Promise<void>} runBootHooks  Boot internal: await every onBoot hook in registration order.
 * @property {<T>(owner:string, fn:()=>T) => T} installAs
 *   Run `fn` with `ctx.owner = owner`, so systems and listeners it registers default to that owner (boot uses it
 *   around each `pkg.install(ctx)` and each stand-in install).
 */

/**
 * @typedef {object} ContextOptions
 * @property {object} [flags]   Parsed URL flags; `seed`, `worldseed`, `test` and `autoplay` are read here.
 * @property {any} [log] @property {any} [dom] @property {any} [store] @property {any} [save] @property {any} [defs]
 * @property {any} [i18n] @property {any} [fx] @property {any} [debug] @property {any} [session]
 * @property {import('./loop.js').LoopOptions} [loop]  Driver overrides for the loop (tests).
 */

/**
 * True in dev builds (`__DEV__` defined by the bundler) and in test mode.
 * @param {any} flags @returns {boolean}
 */
export function isDev(flags) {
  // @ts-ignore __DEV__ is defined by tools/build.mjs
  const devBuild = typeof __DEV__ !== 'undefined' && !!__DEV__;
  return devBuild || !!(flags && flags.test);
}

/** @param {unknown} v @returns {number|undefined} */
function finite(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Create the context with the runtime services and the core systems.
 * @param {ContextOptions} [opts]
 * @returns {Ctx}
 */
export function createContext(opts = {}) {
  const flags = opts.flags || {};
  /** @type {Array<(ctx:Ctx)=>(void|Promise<void>)>} */
  const bootHooks = [];

  const ctx = /** @type {Ctx} */ (/** @type {unknown} */ ({
    flags,
    log: opts.log || null,
    time: null, loop: null, bus: null,
    store: opts.store || null,
    save: opts.save || null,
    defs: opts.defs || null,
    ents: null, spatial: null, rng: null, systems: null,
    i18n: opts.i18n || null,
    input: null,
    fx: opts.fx || null,
    debug: opts.debug || null,
    dom: opts.dom || null,
    session: opts.session || null,
    player: null,
    three: { renderer: null, scene: null, camera: null },
    world: null, env: null, render: null, vfx: null, actors: null, move: null, cam: null,
    combat: null, ai: null, rpg: null, quests: null, ui: null, audio: null,
    owner: null,
    providers: {},
    dev: isDev(flags),
  }));

  ctx.provide = (slot, impl, ownerId) => {
    if (!SERVICE_SLOTS.includes(slot)) throw new Error(`ctx.provide: unknown service slot '${slot}'`);
    const c = /** @type {any} */ (ctx);
    const prev = c[slot];
    if (prev) {
      if (typeof prev.dispose === 'function') {
        try {
          prev.dispose();
        } catch (err) {
          if (ctx.log) ctx.log.error('ctx', `dispose of '${slot}' threw:`, err);
        }
      }
      const standin = 'standin:' + slot;
      ctx.systems.removeOwner(standin);
      ctx.bus.offOwner(standin);
    }
    c[slot] = impl;
    ctx.providers[slot] = ownerId;
  };

  ctx.onBoot = (fn) => {
    bootHooks.push(fn);
  };

  ctx.runBootHooks = async () => {
    for (const fn of bootHooks) await fn(ctx);
  };

  ctx.installAs = (owner, fn) => {
    const before = ctx.owner;
    ctx.owner = owner;
    try {
      return fn();
    } finally {
      ctx.owner = before;
    }
  };

  ctx.time = createTime(ctx);
  ctx.bus = createBus({ strict: ctx.dev, ctx });
  ctx.systems = createSystems(ctx);
  ctx.loop = createLoop(ctx, opts.loop);
  ctx.ents = createEnts(ctx);
  ctx.spatial = createSpatial(ctx);
  ctx.rng = createRng({ seed: finite(/** @type {any} */ (flags).seed), worldSeed: finite(/** @type {any} */ (flags).worldseed) });
  ctx.input = createInput(ctx);
  if (typeof window !== 'undefined') installDefaultSources(ctx.input);

  ctx.installAs('core', () => addCoreSystems(ctx));
  return ctx;
}

/**
 * Register the foundation systems of 3.4.
 * @param {Ctx} ctx
 */
function addCoreSystems(ctx) {
  ctx.systems.add({
    id: 'core.prev', phase: 'input', order: -100,
    /** @param {Ctx} c */
    step(c) { c.ents.copyPrev(); },
  });
  ctx.systems.add({
    id: 'core.input', phase: 'input', order: 0,
    /** @param {Ctx} c */
    step(c) { c.input.sample(); },
  });
  ctx.systems.add({
    id: 'core.spatial', phase: 'post', order: -100,
    /** @param {Ctx} c */
    step(c) { c.spatial.rehash(); },
  });
  ctx.systems.add({
    id: 'core.cleanup', phase: 'cleanup', order: 1000,
    /** @param {Ctx} c */
    step(c) {
      c.ents.flush();
      c.bus.flush();
      c.input.endTick();
    },
  });
  ctx.systems.add({
    id: 'core.inputPoll', phase: 'pre', order: -100,
    /** @param {Ctx} c @param {number} dt */
    frame(c, dt) { c.input.poll(dt); },
  });
}
