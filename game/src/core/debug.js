/**
 * The debug and test API `window.__GAME__` (ARCHITECTURE section 6) and `ctx.debug` (4.16).
 * Every method calls service APIs only (read from `ctx` at call time), so it works with stand-ins and with the
 * final packages. Also: the 500-event recorder (test mode), the debug overlay (`debug=1`, `fps=1`) in the
 * frame phase `debug`, and package commands added with `ctx.debug.register(name, fn)`.
 * @module core/debug
 */

import { TAG } from './ents.js';
import { runBench } from './bench.js';

/** Events kept by the recorder. */
export const EVENT_RING = 500;
/** Overlay text refresh interval in seconds of frame time. */
const OVERLAY_PERIOD = 0.25;

/**
 * Copy an event payload into a plain object of plain values (the recorder never retains pooled payloads).
 * @param {any} p
 * @returns {object}
 */
export function copyPayload(p) {
  /** @type {Record<string, any>} */
  const out = {};
  if (!p || typeof p !== 'object') return out;
  for (const k of Object.keys(p)) {
    const v = p[k];
    if (v === null || typeof v !== 'object') out[k] = v;
    else {
      try {
        out[k] = JSON.parse(JSON.stringify(v));
      } catch (e) {
        out[k] = String(v);
      }
    }
  }
  return out;
}

/**
 * @typedef {object} Debug
 * @property {(name:string, fn:Function) => void} register   adds `__GAME__.cmd[name]`
 * @property {Record<string, Function>} cmd
 * @property {object} api                                    the `__GAME__` object
 * @property {(tick:number, type:string, payload:any) => void} recordEvent   recorder internal (also used by tests)
 * @property {() => void} markReady                          resolve `__GAME__.ready`
 * @property {(err:unknown) => void} failReady               reject `__GAME__.ready` (boot failed)
 */

/**
 * Create `ctx.debug` and the `__GAME__` object, install the event recorder (test mode) and the overlay
 * system (`debug=1` or `fps=1`). The caller exposes `api` as `window.__GAME__`.
 * @param {any} ctx
 * @param {{ version?:string }} [opts]
 * @returns {Debug}
 */
export function createDebug(ctx, opts = {}) {
  /** @type {Record<string, Function>} */
  const cmd = Object.create(null);
  let ready = false;
  /** @type {(v?:any) => void} */
  let resolveReady = () => {};
  /** @type {(e:any) => void} */
  let rejectReady = () => {};
  const readyPromise = new Promise((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });
  // A failed boot rejects `ready`; an unobserved rejection must not count as a second error.
  readyPromise.catch(() => {});

  /** Ring buffer of recorded events. */
  const ring = new Array(EVENT_RING);
  let ringStart = 0;
  let ringCount = 0;
  let godMode = false;

  function recordEvent(tick, type, payload) {
    const entry = { tick, type, payload: copyPayload(payload) };
    if (ringCount < EVENT_RING) ring[(ringStart + ringCount++) % EVENT_RING] = entry;
    else {
      ring[ringStart] = entry;
      ringStart = (ringStart + 1) % EVENT_RING;
    }
  }

  if (ctx.flags && ctx.flags.test) {
    ctx.installAs('core.debug', () => ctx.bus.onAny((type, payload) => recordEvent(ctx.time.tick, type, payload)));
  }

  function player() {
    const e = ctx.player;
    return e && e.alive ? e : null;
  }

  function playerIdOr0() {
    const e = player();
    return e ? e.id : 0;
  }

  /** @param {number} x @param {number} z @returns {number} */
  function ground(x, z) {
    const w = ctx.world;
    return w ? w.heightAt(x, z) : 0;
  }

  /** @param {number} x @param {number} z @param {{ y?:number, alt?:number, fly?:boolean, yaw?:number }} [o] */
  function teleport(x, z, o = {}) {
    const e = player();
    if (!e) return;
    const alt = typeof o.alt === 'number' ? o.alt : 0;
    const y = typeof o.y === 'number' ? o.y : ground(x, z) + alt;
    const fly = typeof o.fly === 'boolean' ? o.fly : alt > 0;
    ctx.move.teleport(e, x, y, z, typeof o.yaw === 'number' ? o.yaw : e.yaw);
    ctx.move.setMode(e, fly ? 'fly' : 'ground');
    ctx.world.flushBuilds();
  }

  /** @param {any} e */
  function actorRow(e) {
    const s = e.stats;
    const c = e.combat;
    return {
      id: e.id, kind: e.kind, defId: e.defId, x: e.pos.x, y: e.pos.y, z: e.pos.z,
      hp: s ? s.hp : 0, hpMax: s ? s.hpMax : 0, state: c ? c.state : 'idle', level: e.level, questTag: e.questTag,
    };
  }

  const ACTOR_KINDS = ['player', 'enemy', 'boss', 'npc'];

  const api = {
    version: opts.version || '0.0.0',
    flags: ctx.flags,
    ready: readyPromise,
    isReady: () => ready,
    errors: ctx.log.errors,
    ctx,

    // time
    step(n = 1) {
      if (ctx.time.isPaused('menu')) {
        ctx.log.error('debug', `step(${n}) called while a menu pause is active (top screen: ${ctx.ui ? ctx.ui.top() : '?'})`);
      }
      ctx.loop.stepSim(n);
      ctx.loop.renderNow();
    },
    render() {
      ctx.loop.renderNow();
    },
    screenshotReady() {
      ctx.loop.renderNow();
      return new Promise((res) => {
        if (typeof requestAnimationFrame !== 'function') {
          res(undefined);
          return;
        }
        requestAnimationFrame(() => requestAnimationFrame(() => res(undefined)));
      });
    },
    tick: () => ctx.time.tick,
    simTime: () => ctx.time.now,
    pause() {
      ctx.time.pause('debug');
    },
    resume() {
      ctx.time.resume('debug');
    },
    setTimeScale(s) {
      ctx.time.setBaseScale(s);
    },

    // world and environment
    heightAt: (x, z) => ctx.world.heightAt(x, z),
    regionAt: (x, z) => ctx.world.regionAt(x, z),
    teleport,
    goto(id, o = {}) {
      const lm = ctx.world.landmark(id);
      const p = lm || ctx.world.pois().find((q) => q.id === id) || null;
      if (!p) {
        ctx.log.warn('debug', 'goto: unknown landmark', id);
        return;
      }
      teleport(p.x, p.z, { alt: o.alt });
    },
    setHour(h) {
      ctx.env.setHour(h);
    },
    crater(x, z, radius, depth) {
      ctx.world.crater(x, z, radius, typeof depth === 'number' ? depth : radius * 0.25, playerIdOr0());
    },
    landmarks() {
      const out = [];
      for (const d of ctx.defs.all('landmark')) {
        const lm = ctx.world.landmark(d.id);
        if (lm) out.push({ id: lm.id, x: lm.x, y: typeof lm.y === 'number' ? lm.y : ground(lm.x, lm.z), z: lm.z });
      }
      return out;
    },
    pois: (type) => ctx.world.pois(type),

    // player
    player() {
      const e = player();
      if (!e) return null;
      const s = e.stats;
      const c = e.combat;
      const rpg = ctx.rpg;
      return {
        id: e.id, x: e.pos.x, y: e.pos.y, z: e.pos.z, yaw: e.yaw,
        hp: s ? s.hp : 0, hpMax: s ? s.hpMax : 0, ora: s ? s.ora : 0, oraMax: s ? s.oraMax : 0,
        surge: c ? c.surge : 0, level: rpg.level, xp: rpg.xp, resonance: rpg.resonance(),
        formId: c ? c.formId : null, mode: e.move ? e.move.mode : 'ground', state: c ? c.state : 'idle',
        targetId: ctx.combat.target(), shells: rpg.shells,
      };
    },
    grantXp(n) {
      ctx.rpg.grantXp(n, 'debug');
    },
    setLevel(l) {
      ctx.rpg.setLevel(l);
    },
    allocate(stat, n = 1) {
      return ctx.rpg.allocate(stat, n);
    },
    heal() {
      const e = player();
      if (!e || !e.stats) return;
      ctx.combat.heal(e, e.stats.hpMax);
      ctx.combat.addOra(e, e.stats.oraMax);
    },
    god(on) {
      godMode = !!on;
      const e = player();
      if (!e) return;
      if (godMode) e.tags |= TAG.INVULNERABLE;
      else e.tags &= ~TAG.INVULNERABLE;
    },
    setOra(n) {
      const e = player();
      if (e && e.stats) ctx.combat.addOra(e, n - e.stats.ora);
    },
    setSurge(n) {
      const e = player();
      if (e && e.combat) ctx.combat.addSurge(e, n - e.combat.surge);
    },
    give(itemId, count = 1, level) {
      return ctx.rpg.addItem(itemId, count, typeof level === 'number' ? { level } : {});
    },
    equip(itemId) {
      const items = ctx.rpg.items();
      let row = items.find((r) => r.itemId === itemId && !r.equipped) || items.find((r) => r.itemId === itemId);
      const uid = row ? row.uid : ctx.rpg.addItem(itemId, 1, {});
      return uid ? ctx.rpg.equip(uid) : false;
    },
    shells(n) {
      ctx.rpg.addShells(n, 'debug');
    },
    unlockTech(techId) {
      ctx.rpg.unlockTech(techId);
    },
    setSlot(index, techId) {
      return ctx.rpg.setSlot(index, techId);
    },
    unlockForm(formId) {
      ctx.rpg.unlockForm(formId);
    },
    setForm(formId) {
      const e = player();
      return e ? ctx.combat.setForm(e, formId, { instant: true, free: true }) : false;
    },
    unlockAll() {
      for (const t of ctx.defs.all('technique')) if (t.user === 'player' && !ctx.rpg.hasTech(t.id)) ctx.rpg.unlockTech(t.id);
      for (const f of ctx.defs.all('form')) ctx.rpg.unlockForm(f.id);
      ctx.store.set('player.canFly', true);
      const e = player();
      if (e) ctx.move.setCanFly(e, true);
    },

    // actors
    spawn(enemyId, o = {}) {
      const e = player();
      const yaw = e ? e.yaw : 0;
      const dist = typeof o.dist === 'number' ? o.dist : 8;
      const x = typeof o.x === 'number' ? o.x : (e ? e.pos.x : 0) + Math.sin(yaw) * dist;
      const z = typeof o.z === 'number' ? o.z : (e ? e.pos.z : 0) + Math.cos(yaw) * dist;
      const y = ground(x, z) + (typeof o.alt === 'number' ? o.alt : 0);
      /** @type {Record<string, any>} */
      const so = { aggro: !!o.aggro, passive: !!o.passive };
      if (typeof o.level === 'number') so.level = o.level;
      const ent = ctx.ai.spawn(enemyId, x, y, z, so);
      return ent ? ent.id : 0;
    },
    startBoss(bossId) {
      const ent = ctx.ai.startBoss(bossId, {});
      return ent ? ent.id : 0;
    },
    kill(entId) {
      const e = ctx.ents.get(entId);
      if (e && e.alive) ctx.combat.kill(e, playerIdOr0());
    },
    killAll() {
      const ids = [];
      for (const kind of ['enemy', 'boss']) for (const e of ctx.ents.list(kind)) if (e.alive) ids.push(e.id);
      for (const id of ids) api.kill(id);
    },
    actors() {
      const out = [];
      for (const kind of ACTOR_KINDS) for (const e of ctx.ents.list(kind)) if (e.alive) out.push(actorRow(e));
      out.sort((a, b) => a.id - b.id);
      return out;
    },
    damage(entId, amount, o = {}) {
      const e = ctx.ents.get(entId);
      const hpMax = e && e.stats ? e.stats.hpMax : 0;
      const hp = amount > 1 ? amount : amount * hpMax;
      return ctx.combat.damage({
        sourceId: typeof o.sourceId === 'number' ? o.sourceId : playerIdOr0(),
        targetId: entId, power: hp, kind: o.kind || 'true', unblockable: true, canCrit: false,
      });
    },
    ai(on) {
      ctx.ai.setEnabled(!!on);
    },
    ambient(on) {
      ctx.ai.setAmbient(!!on);
    },

    // input and actions
    press(action, ticks = 1) {
      ctx.input.inject.press(action, ticks);
    },
    hold(action, on) {
      ctx.input.inject.hold(action, on);
    },
    move(x, y) {
      ctx.input.inject.move(x, y);
    },
    look(dx, dy) {
      ctx.input.inject.look(dx, dy);
    },
    clearInput() {
      ctx.input.inject.clear();
    },
    use(techId, o = {}) {
      const e = player();
      return e ? ctx.combat.useTechnique(e, techId, o) : false;
    },
    lock(entId) {
      ctx.combat.setTarget(entId || 0);
    },
    setCamera(o = {}) {
      const cam = ctx.cam;
      cam.setOrbit(typeof o.yaw === 'number' ? o.yaw : cam.yaw, typeof o.pitch === 'number' ? o.pitch : cam.pitch, o.dist);
    },

    // quests, ui, save
    startQuest: (id) => ctx.quests.start(id),
    completeStep(id) {
      ctx.quests.completeStep(id);
    },
    questState: (id) => ctx.quests.state(id),
    setFlag(k, v) {
      ctx.rpg.setFlag(k, v);
    },
    open(screenId, params) {
      ctx.ui.open(screenId, params);
    },
    closeAll() {
      ctx.ui.closeAll();
    },
    top: () => ctx.ui.top(),
    setLang(lang) {
      ctx.save.setSetting('lang', lang);
      if (ctx.i18n.lang !== lang) ctx.i18n.setLang(lang);
    },
    setDevice(device) {
      ctx.input.setDevice(device);
    },
    setTier(tier) {
      ctx.render.setTier(tier);
    },
    save: () => ctx.save.write('debug'),
    load: (slot) => ctx.session.start({ slot, newGame: false }),
    state: () => ctx.store.snapshot(),
    exportCode: () => ctx.save.exportCode(),
    importCode: (text) => ctx.save.importCode(text),

    // diagnostics
    stats() {
      const r = ctx.render ? ctx.render.stats() : {};
      const ls = ctx.loop.stats;
      const a = ctx.audio;
      return {
        fps: ls.fps, frameMs: ls.frameMs, simMs: ls.simMs,
        drawCalls: r.drawCalls || 0, triangles: r.triangles || 0, geometries: r.geometries || 0, textures: r.textures || 0,
        programs: r.programs || 0, scale: typeof r.scale === 'number' ? r.scale : 1, tier: r.tier || 'low', particles: r.particles || 0,
        actors: ctx.ents.count('player') + ctx.ents.count('enemy') + ctx.ents.count('boss') + ctx.ents.count('npc'),
        projectiles: ctx.ents.count('projectile'),
        voices: a ? a.voices() : 0, audioNodes: a ? a.nodes() : 0,
      };
    },
    bench: (o) => runBench(ctx, api, o),
    events(types) {
      const out = [];
      for (let i = 0; i < ringCount; i++) {
        const ev = ring[(ringStart + i) % EVENT_RING];
        if (!types || types.indexOf(ev.type) >= 0) out.push(ev);
      }
      return out;
    },
    cmd,
  };

  // God mode survives respawns and journey restarts.
  ctx.bus.on('player:spawned', () => {
    if (godMode) api.god(true);
  }, 'core.debug');

  installOverlay(ctx);

  return {
    api,
    cmd,
    recordEvent,
    register(name, fn) {
      if (typeof fn !== 'function') throw new TypeError(`debug.register('${name}'): not a function`);
      if (cmd[name] && ctx.log) ctx.log.warn('debug', 'command replaced:', name);
      cmd[name] = fn;
    },
    markReady() {
      ready = true;
      resolveReady();
    },
    failReady(err) {
      rejectReady(err);
    },
  };
}

/**
 * The overlay of `debug=1` (frame stats, tick, tier, player position) and `fps=1` (FPS only), refreshed at 4 Hz
 * by the frame system `core.debugOverlay` in the phase `debug`.
 * @param {any} ctx
 */
function installOverlay(ctx) {
  const f = ctx.flags || {};
  if (!(f.debug || f.fps) || !ctx.dom) return;
  const node = ctx.dom.el('div', 'k-debug', ctx.dom.layer('overlay'));
  let acc = OVERLAY_PERIOD;
  ctx.systems.add({
    id: 'core.debugOverlay',
    phase: 'debug',
    owner: 'core.debug',
    /** @param {any} c @param {number} dt */
    frame(c, dt) {
      acc += dt;
      if (acc < OVERLAY_PERIOD) return;
      acc = 0;
      const ls = c.loop.stats;
      let text = `fps ${ls.fps.toFixed(0)}`;
      if (f.debug) {
        const r = c.render ? c.render.stats() : null;
        const p = c.player;
        text += `  frame ${ls.frameMs.toFixed(1)} ms  sim ${ls.simMs.toFixed(2)} ms  tick ${c.time.tick}`;
        if (r) text += `\ndraws ${r.drawCalls}  tris ${r.triangles}  programs ${r.programs}  tier ${r.tier}  scale ${r.scale}`;
        if (p) text += `\npos ${p.pos.x.toFixed(1)} ${p.pos.y.toFixed(1)} ${p.pos.z.toFixed(1)}  ${p.move ? p.move.mode : ''}`;
      }
      node.textContent = text;
    },
  });
}
