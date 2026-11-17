/**
 * A small fake game context for the combat engine's Node tests: entities, spatial queries, bus, time, rng, defs
 * (the real combat data plus two test enemy techniques), rpg, move, world, input and no-op visual services.
 * The engine and driver run against it exactly as in the game.
 */
import { createCombatEngine } from '../../src/combat/logic/engine.js';
import { createPlayerDriver } from '../../src/combat/logic/driver.js';
import { registerScripts } from '../../src/combat/logic/scripts.js';
import { playerTechniques } from '../../src/combat/data/techniques.js';
import { formDefs, techNodeDefs } from '../../src/combat/data/forms.js';
import { sweepCapsuleT } from '../../src/combat/logic/rules.js';
import * as F from '../../src/core/formulas.js';

const KIND_BIT = { player: 1, enemy: 2, boss: 4, npc: 8, projectile: 16, pickup: 32, object: 64 };

function vec(x = 0, y = 0, z = 0) {
  return {
    x, y, z,
    set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; },
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; },
  };
}

/** A deterministic rng stream (mulberry32). */
export function stream(seed) {
  let s = seed >>> 0;
  const r = {
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    range(a, b) { return a + (b - a) * r.next(); },
    reseed(v) { s = v >>> 0; },
  };
  return r;
}

const TEST_TECHS = [
  {
    id: 'test_slash', user: 'enemy', slot: 'enemy', icon: 'enemy', rating: 'melee', cost: { ora: 0, surge: 0 }, cooldown: 1, charge: null,
    timeline: { windup: 0.5, active: 0.1, recover: 0.4, cancelFrom: -1 }, anim: { windup: 'bite', active: 'bite', recover: 'idle' },
    telegraph: { kind: 'white', shape: 'self', radius: 0 }, move: { lock: 'root', turn: true, air: true, ground: true }, motion: null,
    hits: [{ t: 0, shape: 'sphere', f: 1.2, u: 0.9, radius: 1.8, power: 1, poise: 10, knock: { kind: 'none' }, feel: 'lightHit', maxTargets: 2 }],
    projectiles: [], beam: null, chain: null, crater: null, invulnerable: false, script: null, fx: { color: 0xff0000 }, sfx: {}, ranks: [{}], unlock: {},
  },
  {
    id: 'test_red', user: 'enemy', slot: 'enemy', icon: 'enemy', rating: 'melee', cost: { ora: 0, surge: 0 }, cooldown: 1, charge: null,
    timeline: { windup: 0.5, active: 0.1, recover: 0.4, cancelFrom: -1 }, anim: { windup: 'bite', active: 'bite', recover: 'idle' },
    telegraph: { kind: 'red', shape: 'self', radius: 0 }, move: { lock: 'root', turn: true, air: true, ground: true }, motion: null,
    hits: [{ t: 0, shape: 'sphere', f: 1.2, u: 0.9, radius: 1.8, power: 1, poise: 10, knock: { kind: 'none' }, feel: 'heavyHit', maxTargets: 2 }],
    projectiles: [], beam: null, chain: null, crater: null, invulnerable: false, script: null, fx: { color: 0xff0000 }, sfx: {}, ranks: [{}], unlock: {},
  },
];

/**
 * Build a fake context with the combat engine installed and a player at the origin.
 * @param {{ ranks?:Record<string, number>, difficulty?:string, colliders?:any[] }} [opts]
 */
export function makeCtx(opts = {}) {
  const events = [];
  const listeners = new Map();
  const byId = new Map();
  const all = [];
  const lists = {};
  let nextId = 1;
  const pending = [];

  const ents = {
    create(kind, init = {}) {
      const e = {
        id: nextId++, kind, defId: init.defId || kind, alive: true, team: init.team ?? (kind === 'player' ? 1 : kind === 'enemy' || kind === 'boss' ? 2 : 0),
        pos: vec(), prev: vec(), vel: vec(), yaw: init.yaw || 0, radius: init.radius ?? 0.5, height: init.height ?? 1.8, level: init.level || 1,
        intent: { mx: 0, mz: 0, up: 0, jump: false, sprint: false, flyToggle: false, faceYaw: null },
        move: init.noMove ? null : { mode: 'ground', grounded: true, groundY: 0, boost: 0, canFly: true, boostAllowed: true, speedMult: 1, lockT: 0, noTurnT: 0, gravityScale: 1, hurtleDamage: 0, hurtleSourceId: 0, airT: 0, speed: 0 },
        stats: null, combat: null, brain: null, visual: null, data: null, questTag: init.questTag || null, tags: init.tags || 0, nameKey: null,
      };
      if (init.pos) e.pos.set(init.pos.x, init.pos.y, init.pos.z);
      byId.set(e.id, e);
      all.push(e);
      (lists[kind] = lists[kind] || []).push(e);
      return e;
    },
    destroy(id) {
      const e = byId.get(id);
      if (!e) return false;
      e.alive = false;
      pending.push(e);
      return true;
    },
    get(id) { return byId.get(id) || null; },
    list(kind) { return lists[kind] || []; },
    all() { return all; },
    count(kind) { return (lists[kind] || []).length; },
    flush() {
      for (const e of pending) {
        byId.delete(e.id);
        all.splice(all.indexOf(e), 1);
        lists[e.kind].splice(lists[e.kind].indexOf(e), 1);
      }
      pending.length = 0;
    },
  };

  const center = (e) => e.pos.y + e.height * 0.5;
  const spatial = {
    query(x, z, r, out, mask) {
      let n = 0;
      for (const e of all) {
        if (!e.alive || !(KIND_BIT[e.kind] & mask)) continue;
        if (Math.hypot(e.pos.x - x, e.pos.z - z) <= r + e.radius) out[n++] = e;
      }
      out.length = n;
      return n;
    },
    querySphere(x, y, z, r, out, mask) {
      let n = 0;
      for (const e of all) {
        if (!e.alive || !(KIND_BIT[e.kind] & mask)) continue;
        const dy = Math.max(0, Math.abs(y - center(e)) - e.height * 0.5);
        if (Math.hypot(e.pos.x - x, dy, e.pos.z - z) <= r + e.radius) out[n++] = e;
      }
      out.length = n;
      return n;
    },
    querySegment(ax, ay, az, bx, by, bz, r, out, mask) {
      let n = 0;
      for (const e of all) {
        if (!e.alive || !(KIND_BIT[e.kind] & mask)) continue;
        if (sweepCapsuleT(ax, ay, az, bx, by, bz, r, e.pos.x, e.pos.y, e.pos.z, e.radius, e.height) >= 0) out[n++] = e;
      }
      out.length = n;
      return n;
    },
    nearest() { return null; },
  };

  const bus = {
    emit(type, payload) {
      events.push({ type, p: { ...payload } });
      const l = listeners.get(type);
      if (l) for (const fn of l) fn(payload);
    },
    post(type, payload) { bus.emit(type, payload); },
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
      return () => {};
    },
  };

  const time = {
    now: 0, real: 0, tick: 0, scale: 1, slow: [], stops: [],
    hitStop(ms) { time.stops.push(ms); },
    slowMo(scale, seconds) { time.slow.push([scale, seconds]); },
  };

  const defs = (() => {
    const kinds = {};
    const d = {
      register(kind, list) {
        kinds[kind] = kinds[kind] || new Map();
        for (const x of list) kinds[kind].set(x.id, x);
      },
      find(kind, id) { return (kinds[kind] && kinds[kind].get(id)) || null; },
      all(kind) { return kinds[kind] ? [...kinds[kind].values()] : []; },
    };
    return d;
  })();
  defs.register('technique', playerTechniques().concat(TEST_TECHS));
  defs.register('form', formDefs());
  defs.register('techNode', techNodeDefs());
  defs.register('enemy', [{ id: 'grunt', techs: ['test_slash', 'test_red'] }, { id: 'guarder', techs: ['test_slash'], frontGuard: { angleDeg: 120, damageMult: 0.25 } }]);

  const ranks = opts.ranks || {};
  const mods = F.createMods();
  const rpg = {
    difficulty: opts.difficulty || 'warrior', level: 10, selectedForm: 'ember', formsList: ['ember', 'tempest'],
    noTechs: new Set(),
    mods() { return mods; },
    base() { return { vit: 5, mgt: 5, spr: 5, swf: 5 }; },
    rank(id) { return ranks[id] || 1; },
    hasTech(id) { return !rpg.noTechs.has(id); },
    slots() { return { slots: [rpg.slot0 || 'dawn_lance', rpg.slot1 || 'nova_ring'], ultimate: 'ringfall' }; },
    forms() { return rpg.formsList; },
    selectForm(id) { rpg.selectedForm = id; },
  };

  const colliders = opts.colliders || [];
  const world = {
    craters: [], props: [],
    groundAt() { return 0; },
    heightAt() { return 0; },
    sweepSphere(ax, ay, az, bx, by, bz, radius, out) {
      out.hit = false; out.t = 1; out.kind = null; out.colliderId = 0;
      let best = 2;
      for (const c of colliders) {
        // sphere collider: first t where the swept sphere touches it
        const dx = bx - ax; const dy = by - ay; const dz = bz - az;
        const fx = ax - c.x; const fy = ay - c.y; const fz = az - c.z;
        const R = c.r + radius;
        const A = dx * dx + dy * dy + dz * dz; const B = 2 * (fx * dx + fy * dy + fz * dz); const C = fx * fx + fy * fy + fz * fz - R * R;
        const disc = B * B - 4 * A * C;
        if (A < 1e-9 || disc < 0) continue;
        const t = (-B - Math.sqrt(disc)) / (2 * A);
        if (t >= 0 && t <= 1 && t < best) { best = t; out.colliderId = c.id; }
      }
      if (best <= 1) {
        out.hit = true; out.t = best; out.kind = 'collider';
        out.x = ax + (bx - ax) * best; out.y = ay + (by - ay) * best; out.z = az + (bz - az) * best;
        return true;
      }
      return false;
    },
    queryColliders(x, z, r, out) {
      let n = 0;
      for (const c of colliders) if (Math.hypot(c.x - x, c.z - z) <= c.r + r) out[n++] = c;
      out.length = n;
      return n;
    },
    lineOfSight() { return true; },
    crater(x, z, radius, depth, sourceId) { world.craters.push({ x, z, radius, depth, sourceId }); },
    damageProps(x, y, z, radius, damage) { world.props.push({ x, y, z, radius, damage }); return 0; },
  };

  const move = {
    knocks: [], boostAllowed: [],
    knock(ent, vx, vy, vz, o) { move.knocks.push({ id: ent.id, vx, vy, vz, ...o }); ent.vel.set(vx, vy, vz); if (vy > 0) { ent.move.mode = o.hurtle ? 'hurtle' : 'air'; ent.move.grounded = false; } },
    impulse(ent, vx, vy, vz) { ent.vel.x += vx; ent.vel.y += vy; ent.vel.z += vz; },
    dashTo(ent, x, y, z) { ent.pos.set(x, y, z); },
    lock() {},
    face(ent, yaw) { ent.yaw = yaw; },
    setBoostAllowed(ent, on) { ent.move.boostAllowed = on; move.boostAllowed.push(on); },
  };

  const input = {
    downSet: new Set(), pressedSet: new Set(), releasedSet: new Set(), held: {},
    down(a) { return input.downSet.has(a); },
    pressed(a) { return input.pressedSet.has(a); },
    released(a) { return input.releasedSet.has(a); },
    heldTime(a) { return input.held[a] || 0; },
    press(a) { input.pressedSet.add(a); input.downSet.add(a); input.held[a] = 0; },
    hold(a) { input.downSet.add(a); input.held[a] = input.held[a] || 0; },
    release(a) { input.downSet.delete(a); input.releasedSet.add(a); input.held[a] = 0; },
    endTick(dt) { input.pressedSet.clear(); input.releasedSet.clear(); for (const a of input.downSet) input.held[a] = (input.held[a] || 0) + dt; },
  };

  const noop = () => {};
  const ctx = {
    player: null, ents, spatial, bus, time, defs, rpg, world, move, input,
    rng: { sim: stream(12345), fx: stream(7) },
    store: { state: { player: { surge: 0 }, quests: { done: [] } } },
    actors: { play: noop, flash: noop, rimGlow: noop, socket: (e, n, out) => out.set(e.pos.x, e.pos.y + 1, e.pos.z) },
    vfx: { burst: noop, shockwave: noop, attach: () => 1, detach: noop, beam: () => ({ set: noop, end: noop }), aura: () => ({ set: noop, dispose: noop }) },
    cam: { busy: false, shake: noop, punch: noop, fovKick: noop, play: () => Promise.resolve({ skipped: false }) },
    fx: { impact: noop, flash: noop },
    log: { warn: noop },
    events,
  };
  const engine = createCombatEngine(ctx);
  registerScripts(engine.combat);
  ctx.combat = engine.combat;
  const driver = createPlayerDriver(ctx, engine);
  bus.on('actor:slam', engine.on.slam);

  const DT = 1 / 60;
  /** Run n sim ticks: driver, combat, simple kinematics, cleanup. */
  function step(n = 1) {
    for (let i = 0; i < n; i++) {
      time.tick++;
      driver.step(ctx, DT);
      engine.runSystem.step(ctx, DT);
      time.now += DT;
      time.real += DT;
      input.endTick(DT);
      ents.flush();
    }
  }

  /** Create the player with level-10-like stats. */
  function addPlayer(stats = {}) {
    const p = ents.create('player', { team: 1 });
    p.stats = { hp: 500, hpMax: 500, ora: 150, oraMax: 150, meleeRating: 60, oraRating: 60, defense: 10, critChance: 0, poise: 0, poiseMax: 0, resonance: 1,
      runSpeed: 7, flySpeed: 20, boostSpeed: 40, cdr: 0, dmgMult: 1, defMult: 1, speedMult: 1, ...stats };
    ctx.player = p;
    engine.combat.initActor(p);
    return p;
  }

  /** Create an enemy at (x, z) facing the player. */
  function addEnemy(x, z, stats = {}, init = {}) {
    const e = ents.create(init.kind || 'enemy', { defId: init.defId || 'grunt', team: 2, tags: init.tags || 0, ...init });
    e.pos.set(x, init.y || 0, z);
    e.yaw = Math.atan2(-x, -z);
    e.stats = { hp: 1000, hpMax: 1000, ora: 100, oraMax: 100, meleeRating: 40, oraRating: 40, defense: 10, critChance: 0, poise: 30, poiseMax: 30, resonance: 1,
      runSpeed: 7, flySpeed: 16, boostSpeed: 0, cdr: 0, dmgMult: 1, defMult: 1, speedMult: 1, ...stats };
    engine.combat.initActor(e);
    return e;
  }

  const of = (type) => events.filter((e) => e.type === type).map((e) => e.p);
  return { ctx, engine, combat: engine.combat, step, addPlayer, addEnemy, events, of, input, time, world, move, rpg, mods, DT };
}
