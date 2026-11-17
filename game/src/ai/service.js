/**
 * The `ctx.ai` service (ARCHITECTURE 4.10, 8.7): spawning with real stats, the brains and their steering, the
 * attack-token director, region ambient spawning, camps, despawn and settlement safety, body removal, the
 * ground-hazard pool of the scripted moves, and the boss controller (arena, intro shot and name card, phases by HP,
 * adds and summons, flee, reset on leaving, the pending-boss restart on re-entry and on retry).
 *
 * Systems: `ai.brains` (intent, order 20) and `ai.spawner` (post). Entities are held by id across ticks.
 * @module ai/service
 */

import { BALANCE } from '../core/balance.js';
import * as F from '../core/formulas.js';
import { TAG, KIND_MASK } from '../core/ents.js';
import { IDS } from '../core/ids.js';
import { PALETTE } from '../core/palette.js';
import { createDirector } from './logic/director.js';
import { createBrain, createSense, techEntries, think, started } from './logic/brain.js';
import { pickEntry, enemyLevel, campAvailable, phaseFor, createPendingBoss } from './logic/spawning.js';
import { registerAiScripts } from './scripts.js';

const BODY_SECONDS = 1.5;
const MAX_BODIES = 128;
const THINK_EVERY = 6;
const RING_MIN = 90;
const RING_MAX = 160;
const DESPAWN = 260;
const DENSITY_RANGE = 300;
const CAMP_NEAR = 200;
const SPAWN_EVERY = 30;
const MAX_HAZARDS = 64;
const ORIGIN = { manual: 0, ambient: 1, camp: 2, add: 3, boss: 4 };
const HOVER_RULE = { height: BALANCE.combat.hover.height, seconds: BALANCE.combat.hover.seconds };

/**
 * Create the ai service.
 * @param {any} ctx
 */
export function createAi(ctx) {
  /** Ids of the enemies and bosses this service spawned. @type {Set<number>} */
  const spawned = new Set();
  /** @type {Map<string, Function>} */
  const customBrains = new Map();
  const director = createDirector();
  const sense = createSense();
  const bodyId = new Int32Array(MAX_BODIES);
  const bodyAt = new Float64Array(MAX_BODIES);
  let bodyCount = 0;
  let enabled = true;
  let ambient = !(ctx.flags && ctx.flags.test);
  /** @type {any[]} */
  const OUT = [];
  /** @type {any[]} */
  const OUT2 = [];
  const SPOT = { x: 0, y: 0, z: 0 };
  const USE = { targetId: 0 };
  const ACT = { targetId: 0 };
  const pSpawned = { entId: 0, kind: 'enemy', defId: '' };
  const pRemoved = { entId: 0, kind: 'enemy', defId: '' };
  const pPhase = { bossId: '', entId: 0, phase: 0 };
  const pBossStart = { bossId: '', entId: 0 };
  const pBossEnd = { bossId: '', defeated: false };
  const pCamp = { campId: '', regionId: '', day: 0 };
  const pBanner = { kind: 'boss', key: '', args: null };
  const TELE = { shape: 'circle', radius: 0, x: 0, y: 0, z: 0, dirX: 0, dirZ: 1 };
  const SHOCK = { radius: 4, seconds: 0.35, color: PALETTE.telegraph.red, ground: true, sphere: false };
  const REQ = { sourceId: 0, targetId: 0, techId: null, power: 1, kind: 'melee', poise: 20, knock: { kind: 'launch', up: 9 },
    dirX: 0, dirZ: 1, x: 0, y: 0, z: 0, unblockable: true, canCrit: false, feel: 'heavyHit' };

  // Settlements (centre and radius) for safety, filled on the first spawner run of a session.
  /** @type {Array<{ x:number, z:number, r:number }>} */
  let settlements = [];
  /** Camps of world.pois('camp'). @type {Array<any>} */
  let camps = [];
  /** @type {Map<string, any>} */
  const campById = new Map();
  let sessionReady = false;
  let spawnCooldown = 0;

  // Boss controller.
  const pending = createPendingBoss();
  let bossId = 0;
  /** @type {any} */
  let bossDef = null;
  let bossPhase = 0;
  let bossEnded = false;
  let addsCalled = false;
  let phaseDirty = false;
  let fleeT = 0;
  /** @type {number[]} */
  const addIds = [];

  // Hazard pool (scripted moves).
  const hzX = new Float64Array(MAX_HAZARDS);
  const hzY = new Float64Array(MAX_HAZARDS);
  const hzZ = new Float64Array(MAX_HAZARDS);
  const hzR = new Float64Array(MAX_HAZARDS);
  const hzT = new Float64Array(MAX_HAZARDS);
  const hzP = new Float64Array(MAX_HAZARDS);
  const hzOwner = new Int32Array(MAX_HAZARDS);
  let hzN = 0;

  /** The current entity of the brain api adapter. @type {any} */
  let cur = null;
  const api = {
    rand: () => ctx.rng.sim.next(),
    /** @param {string} id */
    ready: (id) => !!cur && ctx.combat.canUse(cur, id),
    /** @param {'melee'|'ranged'} kind */
    request: (kind) => !!cur && director.request(cur.id, kind, ctx.time.now),
    release: () => {
      if (cur) director.release(cur.id, ctx.time.now, false);
    },
  };

  // ------------------------------------------------------------------ helpers

  /** @param {any} ent */
  function emitRemoved(ent) {
    pRemoved.entId = ent.id; pRemoved.kind = ent.kind; pRemoved.defId = ent.defId;
    ctx.bus.emit('actor:removed', pRemoved);
  }

  /** @param {any} ent */
  function zeroIntent(ent) {
    const it = ent.intent;
    if (!it) return;
    it.mx = 0; it.mz = 0; it.up = 0; it.sprint = false; it.jump = false; it.flyToggle = false; it.faceYaw = null;
  }

  function difficultyId() {
    return ctx.rpg ? ctx.rpg.difficulty : 'warrior';
  }

  function activeCap() {
    const tier = ctx.render && ctx.render.tier === 'high' ? 'high' : 'low';
    return BALANCE.combat.activeCap[tier];
  }

  /** @param {number} x @param {number} z @param {number} margin */
  function inSettlement(x, z, margin) {
    for (let i = 0; i < settlements.length; i++) {
      const s = settlements[i];
      const dx = x - s.x;
      const dz = z - s.z;
      const r = s.r + margin;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  /** Regions whose Siphon is silenced (GDD 8.3: the Choir leave their camps). */
  function silencedRegions(out) {
    out.length = 0;
    const w = ctx.store.state.world;
    const list = w && w.siphons ? w.siphons : [];
    for (let i = 0; i < list.length; i++) {
      const lm = ctx.world ? ctx.world.landmark(list[i]) : null;
      if (!lm) continue;
      const r = ctx.world.regionAt(lm.x, lm.z);
      if (out.indexOf(r) < 0) out.push(r);
    }
    return out;
  }
  const SILENCED = [];

  /** @param {string} enemyId */
  function isChoir(enemyId) {
    const d = ctx.defs.find('enemy', enemyId);
    return !!d && d.tags.indexOf('choir') >= 0;
  }

  function prepareSession() {
    sessionReady = true;
    settlements = [];
    for (const id of IDS.settlement) {
      const s = ctx.env && ctx.env.settlement ? ctx.env.settlement(id) : null;
      if (s) settlements.push({ x: s.x, z: s.z, r: s.radius || 60 });
      else {
        const lm = ctx.world ? ctx.world.landmark(id) : null;
        if (lm) settlements.push({ x: lm.x, z: lm.z, r: lm.stamp && lm.stamp.radius ? lm.stamp.radius : 60 });
      }
    }
    camps = [];
    campById.clear();
    const pois = ctx.world && ctx.world.pois ? ctx.world.pois('camp') : [];
    for (const p of pois) {
      const c = { id: p.id, x: p.x, y: p.y, z: p.z, regionId: p.regionId, tier: (p.data && p.data.tier) || 1, level: (p.data && p.data.level) || 1,
        populated: false, alive: 0, members: [] };
      camps.push(c);
      campById.set(c.id, c);
    }
  }

  // ------------------------------------------------------------------ spawning

  /**
   * @param {string} enemyId @param {number} x @param {number} y @param {number} z @param {any} o
   * @param {{ hpMult?:number, poise?:number }|undefined} statOpts @param {number} origin
   */
  function spawnInternal(enemyId, x, y, z, o, statOpts, origin) {
    const def = ctx.defs.find('enemy', enemyId);
    if (!def) {
      ctx.log.warn('ai', 'spawn: unknown enemy', enemyId);
      return null;
    }
    const world = ctx.world;
    const band = def.levels || [1, 1];
    let level = typeof o.level === 'number' ? o.level : enemyLevel(world ? world.regionLevel(x, z) : band[0], band);
    level = Math.max(1, Math.round(level));
    const ent = ctx.ents.create(def.tier === 'boss' ? 'boss' : 'enemy');
    if (!ent) return null;
    const flyer = def.movement === 'fly' || def.movement === 'hover';
    const params = def.params || {};
    const ground = world ? world.heightAt(x, z) : 0;
    const hover = typeof params.hover === 'number' ? params.hover : 4;
    const yy = flyer ? Math.max(y, Math.max(ground, 0) + hover) : Math.max(y, ground);
    ent.team = o.hostile === false ? 0 : 2;
    ent.defId = enemyId;
    ent.level = level;
    ent.questTag = o.questTag || null;
    ent.nameKey = (def.tier === 'boss' ? 'boss.' : 'enemy.') + enemyId + '.name';
    ent.tags = (flyer ? TAG.FLYER : TAG.GROUNDED_ONLY) | (def.tier === 'boss' ? TAG.BOSS : 0) | (def.tier === 'elite' ? TAG.ELITE : 0) | (o.questTag ? TAG.QUEST : 0);
    ent.pos.set(x, yy, z);
    ent.prev.set(x, yy, z);
    const p = ctx.player;
    ent.yaw = p ? Math.atan2(p.pos.x - x, p.pos.z - z) : 0;
    ent.stats = F.enemyStats(def, level, difficultyId(), statOpts);
    if (typeof o.hpMult === 'number' && !statOpts) {
      ent.stats.hp = Math.max(1, Math.round(ent.stats.hp * o.hpMult));
      ent.stats.hpMax = ent.stats.hp;
    }
    ctx.actors.create(ent, def.specId, {});
    ctx.move.initActor(ent, { canFly: flyer, mode: flyer ? 'fly' : 'ground' });
    ctx.combat.initActor(ent);
    const techs = techEntries(def.techs, (id) => ctx.defs.find('technique', id));
    const b = createBrain(def.brain, params, techs, { x, y: yy, z }, {
      passive: !!o.passive, aggro: !!o.aggro, leash: typeof o.leash === 'number' ? o.leash : undefined, flyer, seed: ent.id, hover: HOVER_RULE,
    });
    b.origin = origin;
    b.campId = o.campId || null;
    const factory = customBrains.get(def.brain);
    if (factory) b.custom = factory(ctx, ent, params);
    if (b.aggro && p && p.alive && ent.team === 2 && !b.passive) b.targetId = p.id;
    ent.brain = b;
    spawned.add(ent.id);
    pSpawned.entId = ent.id; pSpawned.kind = ent.kind; pSpawned.defId = enemyId;
    ctx.bus.emit('actor:spawned', pSpawned);
    return ent;
  }

  /**
   * Spawn a group around (x, z).
   * @param {any} g GroupDef @param {number} x @param {number} z @param {any} o @param {number} origin
   * @param {(enemyId:string) => boolean} [allow] @param {number[]} [out]
   */
  function spawnGroupAt(g, x, z, o, origin, allow, out) {
    const res = out || [];
    const radius = typeof o.radius === 'number' ? o.radius : 8;
    let total = 0;
    for (const m of g.members) if (!allow || allow(m.enemy)) total += m.count;
    let i = 0;
    for (const m of g.members) {
      if (allow && !allow(m.enemy)) continue;
      const def = ctx.defs.find('enemy', m.enemy);
      for (let k = 0; k < m.count; k++) {
        const a = (i / Math.max(1, total)) * Math.PI * 2 + 0.4;
        let px = x + Math.sin(a) * radius;
        let pz = z + Math.cos(a) * radius;
        if (ctx.world && ctx.world.findSpot && ctx.world.findSpot(px, pz, 6, SPOT, {})) { px = SPOT.x; pz = SPOT.z; }
        const so = { aggro: !!o.aggro, questTag: o.questTag, campId: o.campId };
        if (typeof o.level === 'number') so.level = def ? enemyLevel(o.level + (m.levelOffset || 0), o.clamp ? def.levels : [1, 99]) : o.level;
        const e = spawnInternal(m.enemy, px, ctx.world ? ctx.world.heightAt(px, pz) : 0, pz, so, undefined, origin);
        if (e) res.push(e.id);
        i++;
      }
    }
    return res;
  }

  /** Remove one entity this service spawned. @param {number} entId */
  function despawn(entId) {
    const e = ctx.ents.get(entId);
    spawned.delete(entId);
    director.release(entId, ctx.time.now, true);
    if (!e) return;
    const b = e.brain;
    if (b && b.aiBrain) {
      if (b.beam && b.beam.end) b.beam.end(0.1);
      b.beam = null;
      if (b.campId) {
        const c = campById.get(b.campId);
        if (c && c.populated && e.alive) c.alive = Math.max(0, c.alive - 1);
      }
    }
    if (bossId === entId) bossId = 0;
    ctx.ents.destroy(entId);
    emitRemoved(e);
  }

  // ------------------------------------------------------------------ brains

  /** Fill the sense snapshot for `ent` and run its brain. */
  function thinkOne(c, ent, b) {
    const p = c.player;
    const now = c.time.now;
    // Target bookkeeping.
    let t = b.targetId ? c.ents.get(b.targetId) : null;
    if (t && (!t.alive || (t.combat && t.combat.state === 'dead'))) { t = null; b.targetId = 0; }
    if (b.ignoreT > 1e8 && p && p.alive && c.world && p.pos.y - c.world.groundAt(p.pos.x, p.pos.y, p.pos.z) < 3) b.ignoreT = 0;
    if (!t && !b.passive && ent.team === 2 && b.ignoreT <= 0 && b.state !== 'return' && p && p.alive && p.combat && p.combat.state !== 'dead') {
      const dx = p.pos.x - ent.pos.x;
      const dy = p.pos.y - ent.pos.y;
      const dz = p.pos.z - ent.pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (b.aggro || (d2 <= b.sight * b.sight && (!c.world || c.world.lineOfSight(ent.pos.x, ent.pos.y + ent.height * 0.8, ent.pos.z, p.pos.x, p.pos.y + 1.5, p.pos.z)))) {
        t = p;
        b.targetId = p.id;
      }
    }
    if (t && t === p && !b.aggro && ent.kind !== 'boss') {
      const dx = t.pos.x - ent.pos.x;
      const dz = t.pos.z - ent.pos.z;
      const far = b.sight * 2.5;
      if (dx * dx + dz * dz > far * far) { t = null; b.targetId = 0; }
    }
    const s = sense;
    s.now = now;
    s.dt = THINK_EVERY * (1 / 60);
    s.x = ent.pos.x; s.y = ent.pos.y; s.z = ent.pos.z;
    const gy = c.world ? c.world.groundAt(ent.pos.x, ent.pos.y, ent.pos.z) : 0;
    s.alt = ent.pos.y - Math.max(gy, c.world ? c.world.seaLevel || 0 : 0);
    s.hpFrac = ent.stats ? ent.stats.hp / Math.max(1, ent.stats.hpMax) : 1;
    const cs = ent.combat.state;
    s.busy = cs !== 'idle' && cs !== 'guard';
    s.flyer = (ent.tags & TAG.FLYER) !== 0;
    s.groundOnly = !s.flyer;
    s.hasTarget = !!t;
    if (t) {
      s.tx = t.pos.x; s.ty = t.pos.y; s.tz = t.pos.z;
      const dx = t.pos.x - ent.pos.x;
      const dz = t.pos.z - ent.pos.z;
      s.dist = Math.sqrt(dx * dx + dz * dz);
      s.dy = t.pos.y - ent.pos.y;
      const tg = c.world ? c.world.groundAt(t.pos.x, t.pos.y, t.pos.z) : 0;
      s.tAir = t.pos.y - tg > 3;
      const tc = t.combat;
      s.tThreat = !!tc && (tc.state === 'windup' || tc.state === 'active') && (tc.targetId === ent.id || s.dist < 4);
    } else {
      s.tx = ent.pos.x; s.ty = ent.pos.y; s.tz = ent.pos.z; s.dist = 0; s.dy = 0; s.tAir = false; s.tThreat = false;
    }
    const hx = b.homeX - ent.pos.x;
    const hz = b.homeZ - ent.pos.z;
    s.homeDist = Math.sqrt(hx * hx + hz * hz);
    s.homeDx = s.homeDist > 1e-3 ? hx / s.homeDist : 0;
    s.homeDz = s.homeDist > 1e-3 ? hz / s.homeDist : 0;
    // Allies and separation.
    let near = 0;
    let far = 0;
    let ax = 0;
    let az = 0;
    let sx = 0;
    let sz = 0;
    const n = c.spatial.query(ent.pos.x, ent.pos.z, 60, OUT, KIND_MASK.enemy | KIND_MASK.boss);
    for (let i = 0; i < n; i++) {
      const o = OUT[i];
      OUT[i] = null;
      if (o === ent || !o.alive || o.team !== ent.team) continue;
      const dx = o.pos.x - ent.pos.x;
      const dz = o.pos.z - ent.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 144) near++;
      far++;
      ax += o.pos.x; az += o.pos.z;
      const minD = ent.radius + o.radius + 1.6;
      if (d2 < minD * minD && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const k = (minD - d) / minD;
        sx -= (dx / d) * k * 0.8;
        sz -= (dz / d) * k * 0.8;
      }
    }
    s.allies = near;
    if (far > 0) {
      const cx = ax / far - ent.pos.x;
      const cz = az / far - ent.pos.z;
      s.allyDist = Math.sqrt(cx * cx + cz * cz);
      s.allyDx = s.allyDist > 1e-3 ? cx / s.allyDist : 0;
      s.allyDz = s.allyDist > 1e-3 ? cz / s.allyDist : 0;
    } else {
      s.allyDist = 0; s.allyDx = 0; s.allyDz = 0;
    }
    s.sepX = sx; s.sepZ = sz;
    s.inSettlement = (b.origin === ORIGIN.ambient || b.origin === ORIGIN.camp) && !ent.questTag && inSettlement(ent.pos.x, ent.pos.z, 0);
    const wasGuard = b.guard;
    cur = ent;
    think(b, s, api);
    cur = null;
    if (b.drop) b.targetId = 0;
    if (b.heal && ent.stats && ent.stats.hp < ent.stats.hpMax) c.combat.heal(ent, ent.stats.hpMax - ent.stats.hp);
    if (b.alertAllies && t) alertPack(c, ent, t.id);
    if (b.act && b.targetId) {
      USE.targetId = b.targetId;
      if (c.combat.useTechnique(ent, b.act, USE)) started(b);
    }
    if (b.guard !== wasGuard) {
      ACT.targetId = b.targetId;
      c.combat.act(ent, b.guard ? 'guardOn' : 'guardOff', ACT);
    }
    if (b.boltDodge > 0 && !s.busy && t) dodgeBolts(c, ent, b);
  }

  /** Allies within 25 m that are idle notice the same target (packs). */
  function alertPack(c, ent, targetId) {
    const n = c.spatial.query(ent.pos.x, ent.pos.z, 25, OUT2, KIND_MASK.enemy);
    for (let i = 0; i < n; i++) {
      const o = OUT2[i];
      OUT2[i] = null;
      const ob = o.brain;
      if (o === ent || !o.alive || o.team !== ent.team || !ob || !ob.aiBrain || ob.passive || ob.targetId || ob.ignoreT > 0) continue;
      ob.targetId = targetId;
    }
  }

  /** Choir Vanguard: flicker away from a share of the player's bolts (GDD 7.2). */
  function dodgeBolts(c, ent, b) {
    const n = c.spatial.query(ent.pos.x, ent.pos.z, 8, OUT2, KIND_MASK.projectile);
    let found = null;
    for (let i = 0; i < n; i++) {
      const o = OUT2[i];
      OUT2[i] = null;
      if (!found && o.alive && o.team === 1 && o.id > b.dodgeShot) found = o;
    }
    if (found) {
      const o = found;
      b.dodgeShot = o.id;
      if (c.rng.sim.next() >= b.boltDodge) return;
      // Sideways relative to the bolt's travel.
      const vl = Math.sqrt(o.vel.x * o.vel.x + o.vel.z * o.vel.z) || 1;
      const side = c.rng.sim.next() < 0.5 ? -1 : 1;
      const px = (-o.vel.z / vl) * side * 7;
      const pz = (o.vel.x / vl) * side * 7;
      if (c.vfx) c.vfx.burst('flicker_out', ent.pos.x, ent.pos.y + 1, ent.pos.z, BURST_FLICK);
      c.move.dashTo(ent, ent.pos.x + px, ent.pos.y, ent.pos.z + pz, 0.12);
    }
  }
  const BURST_FLICK = { dirX: 0, dirY: 1, dirZ: 0, color: PALETTE.hostile, scale: 1 };

  /** Write the brain outputs into ent.intent (every tick). */
  function applyIntent(c, ent, b) {
    const it = ent.intent;
    it.mx = b.mx;
    it.mz = b.mz;
    it.sprint = false;
    it.jump = false;
    const t = b.face && b.targetId ? c.ents.get(b.targetId) : null;
    it.faceYaw = t && t.alive ? Math.atan2(t.pos.x - ent.pos.x, t.pos.z - ent.pos.z) : null;
    const m = ent.move;
    if ((ent.tags & TAG.FLYER) !== 0 && m) {
      const st = ent.combat ? ent.combat.state : 'idle';
      it.flyToggle = m.mode !== 'fly' && m.mode !== 'hurtle' && m.mode !== 'scripted' && st !== 'stagger' && st !== 'down' && st !== 'dead';
      let up = b.wantY === b.wantY ? (b.wantY - ent.pos.y) / 2.5 : 0;
      up = Math.max(-1, Math.min(1, up));
      const alt = ent.pos.y - m.groundY;
      if (alt < 3 && up < -0.4) up = -0.4;
      it.up = up;
    } else {
      it.up = 0;
      it.flyToggle = false;
    }
  }

  const brainSystem = {
    id: 'ai.brains',
    phase: 'intent',
    order: 20,
    /** @param {any} c @param {number} dt */
    step(c, dt) {
      director.setAttackers(F.difficultyRow(difficultyId()).attackers);
      const tick = c.time.tick;
      runList(c, c.ents.list('enemy'), dt, tick);
      runList(c, c.ents.list('boss'), dt, tick);
    },
  };

  /** @param {any} c @param {any[]} list @param {number} dt @param {number} tick */
  function runList(c, list, dt, tick) {
    for (let i = 0; i < list.length; i++) {
      const ent = list[i];
      const b = ent.brain;
      if (!ent.alive || !b || !b.aiBrain || !ent.intent) continue;
      if (b.beam && (!ent.combat || ent.combat.state !== 'active')) {
        if (b.beam.end) b.beam.end(0.2);
        b.beam = null;
      }
      if (!enabled || (ent.tags & TAG.SCRIPTED) !== 0 || !ent.combat || ent.combat.state === 'dead' || b.introT > 0) {
        if (b.introT > 0) b.introT -= dt;
        zeroIntent(ent);
        if (director.holds(ent.id)) director.release(ent.id, c.time.now, true);
        // Flyers hold their altitude while frozen.
        if ((ent.tags & TAG.FLYER) !== 0 && ent.move && ent.move.mode === 'fly' && b.wantY === b.wantY) {
          ent.intent.up = Math.max(-0.4, Math.min(1, (b.wantY - ent.pos.y) / 2.5));
        }
        if (b.introT > 0 && c.player) ent.intent.faceYaw = Math.atan2(c.player.pos.x - ent.pos.x, c.player.pos.z - ent.pos.z);
        continue;
      }
      if (b.custom) {
        if ((tick + ent.id) % THINK_EVERY === 0) b.custom.think(THINK_EVERY / 60);
        continue;
      }
      if (b.state === 'bossFlee') {
        fleeIntent(c, ent);
        continue;
      }
      if ((tick + ent.id) % THINK_EVERY === 0) thinkOne(c, ent, b);
      applyIntent(c, ent, b);
    }
  }

  /** Durn running from the player after his defeat. */
  function fleeIntent(c, ent) {
    const it = ent.intent;
    const p = c.player;
    let dx = p ? ent.pos.x - p.pos.x : 1;
    let dz = p ? ent.pos.z - p.pos.z : 0;
    const l = Math.sqrt(dx * dx + dz * dz) || 1;
    dx /= l; dz /= l;
    it.mx = dx; it.mz = dz; it.up = 0; it.sprint = true; it.faceYaw = null; it.flyToggle = false;
  }

  // ------------------------------------------------------------------ hazards

  const hz = {
    rand: () => ctx.rng.sim.next(),
    /** @param {any} owner @param {number} x @param {number} z @param {number} radius @param {number} delay @param {number} power */
    circle(owner, x, z, radius, delay, power) {
      if (hzN >= MAX_HAZARDS) return;
      const y = ctx.world ? ctx.world.groundAt(x, (owner ? owner.pos.y : 0) + 40, z) : 0;
      hzX[hzN] = x; hzY[hzN] = y; hzZ[hzN] = z; hzR[hzN] = radius; hzT[hzN] = delay; hzP[hzN] = power; hzOwner[hzN] = owner ? owner.id : 0;
      hzN++;
      if (owner) {
        TELE.shape = 'circle'; TELE.radius = radius; TELE.x = x; TELE.y = y; TELE.z = z; TELE.dirX = 0; TELE.dirZ = 1;
        ctx.combat.telegraph(owner, 'red', delay, TELE);
      }
    },
    /** A line of circles. */
    line(owner, x, z, dirX, dirZ, length, delay, power) {
      if (owner) {
        TELE.shape = 'line'; TELE.radius = length; TELE.x = x; TELE.y = ctx.world ? ctx.world.groundAt(x, owner.pos.y + 40, z) : 0; TELE.z = z;
        TELE.dirX = dirX; TELE.dirZ = dirZ;
        ctx.combat.telegraph(owner, 'red', delay, TELE);
      }
      const step = 3.2;
      const n = Math.min(12, Math.ceil(length / step));
      for (let i = 0; i < n && hzN < MAX_HAZARDS; i++) {
        const px = x + dirX * (i * step);
        const pz = z + dirZ * (i * step);
        hzX[hzN] = px; hzZ[hzN] = pz; hzY[hzN] = ctx.world ? ctx.world.groundAt(px, (owner ? owner.pos.y : 0) + 40, pz) : 0;
        hzR[hzN] = 2.2; hzT[hzN] = delay + i * 0.04; hzP[hzN] = power; hzOwner[hzN] = owner ? owner.id : 0;
        hzN++;
      }
    },
  };

  /** @param {any} c @param {number} dt */
  function runHazards(c, dt) {
    let w = 0;
    const p = c.player;
    for (let i = 0; i < hzN; i++) {
      hzT[i] -= dt;
      if (hzT[i] > 0) {
        if (w !== i) {
          hzX[w] = hzX[i]; hzY[w] = hzY[i]; hzZ[w] = hzZ[i]; hzR[w] = hzR[i]; hzT[w] = hzT[i]; hzP[w] = hzP[i]; hzOwner[w] = hzOwner[i];
        }
        w++;
        continue;
      }
      const owner = c.ents.get(hzOwner[i]);
      if (c.vfx) {
        SHOCK.radius = hzR[i]; SHOCK.seconds = 0.3 + hzR[i] * 0.02;
        c.vfx.shockwave(hzX[i], hzY[i] + 0.1, hzZ[i], SHOCK);
      }
      if (!owner || !owner.alive || !p || !p.alive) continue;
      const dx = p.pos.x - hzX[i];
      const dz = p.pos.z - hzZ[i];
      const dy = p.pos.y - hzY[i];
      const r = hzR[i] + (p.radius || 0.4);
      if (dx * dx + dz * dz > r * r || dy > 6 || dy < -3) continue;
      const l = Math.sqrt(dx * dx + dz * dz) || 1;
      REQ.sourceId = owner.id; REQ.targetId = p.id; REQ.power = hzP[i];
      REQ.dirX = dx / l; REQ.dirZ = dz / l; REQ.x = p.pos.x; REQ.y = p.pos.y + 1; REQ.z = p.pos.z;
      c.combat.damage(REQ);
    }
    hzN = w;
  }

  // ------------------------------------------------------------------ ambient spawning and camps

  /** @param {any} c */
  function populate(c) {
    const p = c.player;
    if (!p || !p.alive || !c.world) return;
    if (!sessionReady) prepareSession();
    const px = p.pos.x;
    const pz = p.pos.z;
    let alive = 0;
    let ambNear = 0;
    // Despawn far, unengaged ambient and camp enemies; count the rest.
    const list = c.ents.list('enemy');
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const b = e.brain;
      if (!e.alive || !b || !b.aiBrain || !spawned.has(e.id)) continue;
      const dx = e.pos.x - px;
      const dz = e.pos.z - pz;
      const d2 = dx * dx + dz * dz;
      if ((b.origin === ORIGIN.ambient || b.origin === ORIGIN.camp) && !e.questTag && b.targetId === 0 && d2 > DESPAWN * DESPAWN) {
        despawnLater.push(e.id);
        continue;
      }
      if (e.combat && e.combat.state === 'dead') continue;
      alive++;
      if (b.origin === ORIGIN.ambient && d2 < DENSITY_RANGE * DENSITY_RANGE) ambNear++;
    }
    for (let i = 0; i < despawnLater.length; i++) {
      const e = c.ents.get(despawnLater[i]);
      const campId = e && e.brain ? e.brain.campId : null;
      despawn(despawnLater[i]);
      if (campId) {
        const cp = campById.get(campId);
        if (cp && cp.alive === 0) cp.populated = false;
      }
    }
    despawnLater.length = 0;
    if (!ambient) return;
    const cap = activeCap();
    silencedRegions(SILENCED);
    // Camps near the player.
    const day = c.env ? c.env.day : 0;
    const store = c.store.state.world;
    for (let i = 0; i < camps.length; i++) {
      const cp = camps[i];
      if (cp.populated || alive >= cap) continue;
      const dx = cp.x - px;
      const dz = cp.z - pz;
      if (dx * dx + dz * dz > CAMP_NEAR * CAMP_NEAR) continue;
      if (!campAvailable(store.camps ? store.camps[cp.id] : undefined, day)) continue;
      const table = c.defs.find('spawnTable', cp.regionId);
      if (!table) continue;
      let gid = table.camps.length ? table.camps[0].group : null;
      for (const ce of table.camps) if (ce.tier === cp.tier) gid = ce.group;
      const g = gid ? c.defs.find('group', gid) : null;
      if (!g) continue;
      const silenced = SILENCED.indexOf(cp.regionId) >= 0;
      cp.members.length = 0;
      spawnGroupAt(g, cp.x, cp.z, { level: cp.level, campId: cp.id, radius: 6, clamp: true }, ORIGIN.camp, silenced ? notChoir : undefined, cp.members);
      cp.alive = cp.members.length;
      cp.populated = cp.alive > 0;
      alive += cp.alive;
    }
    // Ambient groups in a ring around the player.
    if (spawnCooldown > 0) {
      spawnCooldown -= SPAWN_EVERY / 60;
      return;
    }
    const region = c.world.regionAt(px, pz);
    const table = c.defs.find('spawnTable', region);
    if (!table || inSettlement(px, pz, 0)) return;
    const night = !!(c.env && c.env.isNight);
    const want = Math.round(table.density * (night ? table.night || 1 : 1));
    if (ambNear >= want || alive >= cap) return;
    const rng = c.rng.sim;
    for (let attempt = 0; attempt < 4; attempt++) {
      const a = rng.next() * Math.PI * 2;
      const d = RING_MIN + rng.next() * (RING_MAX - RING_MIN);
      const x = px + Math.sin(a) * d;
      const z = pz + Math.cos(a) * d;
      if (!c.world.findSpot(x, z, 12, SPOT, {})) continue;
      if (inSettlement(SPOT.x, SPOT.z, 40)) continue;
      const r2 = c.world.regionAt(SPOT.x, SPOT.z);
      const t2 = c.defs.find('spawnTable', r2);
      if (!t2) continue;
      const level = c.world.regionLevel(SPOT.x, SPOT.z);
      const silenced = SILENCED.indexOf(r2) >= 0;
      const idx = pickEntry(t2.entries, bandOf, level, rng.next(), silenced ? notChoir : undefined);
      if (idx < 0) continue;
      const entry = t2.entries[idx];
      const def = c.defs.find('enemy', entry.enemy);
      if (!def) continue;
      const count = Math.min(cap - alive, Math.min(want - ambNear + 1, entry.group[0] + Math.floor(rng.next() * (entry.group[1] - entry.group[0] + 1))));
      const lv = enemyLevel(level, def.levels);
      for (let k = 0; k < count; k++) {
        const ga = (k / Math.max(1, count)) * Math.PI * 2;
        const gx = SPOT.x + Math.sin(ga) * (count > 1 ? 4 : 0);
        const gz = SPOT.z + Math.cos(ga) * (count > 1 ? 4 : 0);
        AMB.level = lv;
        spawnInternal(entry.enemy, gx, c.world.heightAt(gx, gz), gz, AMB, undefined, ORIGIN.ambient);
      }
      spawnCooldown = 1.5;
      break;
    }
  }
  const AMB = { level: 1 };
  /** @type {number[]} */
  const despawnLater = [];
  /** @param {string} id */
  const notChoir = (id) => !isChoir(id);
  /** @param {string} id */
  const bandOf = (id) => {
    const d = ctx.defs.find('enemy', id);
    return d ? d.levels : null;
  };

  // ------------------------------------------------------------------ bosses

  function bossEnt() {
    const e = bossId ? ctx.ents.get(bossId) : null;
    return e && e.alive ? e : null;
  }

  /** Spawn the boss of `bd` at its arena. */
  function spawnBoss(bd, skipIntro) {
    const lm = ctx.world ? ctx.world.landmark(bd.arena.landmarkId) : null;
    let x = lm ? lm.x : 0;
    let z = lm ? lm.z : 0;
    if (ctx.world && ctx.world.findSpot && ctx.world.findSpot(x, z, 25, SPOT, {})) { x = SPOT.x; z = SPOT.z; }
    let hpMult = bd.hpMult;
    if (typeof bd.hpPerSiphonStanding === 'number' && ctx.quests && ctx.quests.siphonsSilenced) {
      hpMult *= 1 + bd.hpPerSiphonStanding * Math.max(0, 5 - ctx.quests.siphonsSilenced());
    }
    const ent = spawnInternal(bd.enemyId, x, ctx.world ? ctx.world.heightAt(x, z) : 0, z,
      { level: bd.level, aggro: true, leash: bd.arena.radius + BALANCE.bossRules.resetExtra + 40 }, { hpMult, poise: bd.poise }, ORIGIN.boss);
    if (!ent) return null;
    ent.tags |= TAG.BOSS;
    const b = ent.brain;
    b.kind = 'boss';
    applyPhase(ent, bd, 0);
    bossId = ent.id;
    bossDef = bd;
    bossPhase = 0;
    bossEnded = false;
    addsCalled = false;
    fleeT = 0;
    phaseDirty = false;
    pending.start(bd.id);
    pBossStart.bossId = bd.id; pBossStart.entId = ent.id;
    ctx.bus.emit('boss:start', pBossStart);
    if (!skipIntro) intro(ent, bd);
    else b.introT = 0.6;
    return ent;
  }

  /** The 3 s intro shot with the name card (GDD 7.3). */
  function intro(ent, bd) {
    const seconds = bd.intro && bd.intro.seconds ? bd.intro.seconds : BALANCE.bossRules.introSeconds;
    ent.brain.introT = seconds;
    pBanner.kind = 'boss'; pBanner.key = 'boss.' + bd.id + '.title'; pBanner.args = null;
    ctx.bus.emit('ui:banner', pBanner);
    if (bd.intro && bd.intro.lineKey) ctx.bus.emit('ui:toast', { key: bd.intro.lineKey, args: null, kind: 'info' });
    if (ctx.actors) ctx.actors.play(ent, 'roar', null);
    const cam = ctx.cam;
    if (!cam || typeof cam.play !== 'function') return;
    const yaw = ent.yaw;
    const big = Math.max(1, ent.height / 1.8);
    const shots = [
      { seconds: seconds * 0.6, orbit: { entId: ent.id, dist: 7 * big, height: 1.2 * big, yawFrom: yaw + 0.7, yawTo: yaw + 0.25 },
        lookAt: { entId: ent.id, socket: 'head' }, fov: 42, ease: 'inOut' },
      { seconds: seconds * 0.4, orbit: { entId: ent.id, dist: 10 * big, height: 2.4 * big, yawFrom: yaw + 0.25, yawTo: yaw + 0.05 },
        lookAt: { entId: ent.id, socket: 'chest' }, fov: 50, ease: 'out' },
    ];
    try {
      const pr = cam.play('boss.intro.' + bd.id, shots, { skippable: true, freeze: false });
      if (pr && pr.catch) pr.catch(() => {});
    } catch (e) {
      ctx.log.warn('ai', 'boss intro shot failed', String(e));
    }
  }

  /** Apply the phase's techniques and multipliers. */
  function applyPhase(ent, bd, phase) {
    const b = ent.brain;
    const ph = bd.phases[phase];
    if (!ph || !b) return;
    for (let i = 0; i < b.techs.length; i++) {
      let w = 0;
      for (const t of ph.techs) if (t.id === b.techs[i].id) w = t.weight;
      b.weights[i] = w;
    }
    if (ent.stats) {
      ent.stats.speedMult = typeof ph.speedMult === 'number' ? ph.speedMult : 1;
      ent.stats.defMult = typeof ph.defMult === 'number' ? ph.defMult : 1;
    }
  }

  /** Phase changes, adds and flee after boss damage (deferred to the post phase). */
  function processBoss(c) {
    const ent = bossEnt();
    if (!ent || !bossDef || !ent.stats) return;
    const bd = bossDef;
    const frac = ent.stats.hp / Math.max(1, ent.stats.hpMax);
    const next = phaseFor(bd.phases, frac, bossPhase);
    while (bossPhase < next && ent.stats.hp > 0) {
      bossPhase++;
      applyPhase(ent, bd, bossPhase);
      pPhase.bossId = bd.id; pPhase.entId = ent.id; pPhase.phase = bossPhase;
      c.bus.emit('boss:phase', pPhase);
      // A short roar between phases.
      ent.brain.introT = 1.0;
      if (c.combat.cancel) c.combat.cancel(ent);
      if (c.actors) c.actors.play(ent, 'roar', null);
      if (c.cam && c.cam.shake) c.cam.shake(0.45);
      if (c.vfx) {
        SHOCK.radius = 14; SHOCK.seconds = 0.6;
        c.vfx.shockwave(ent.pos.x, ent.pos.y + 0.2, ent.pos.z, SHOCK);
      }
      const ph = bd.phases[bossPhase];
      if (ph.summon) callAdds(c, ent, ph.summon);
      if (ph.onEnter && ph.onEnter.length && c.quests && c.quests.runActions) c.quests.runActions(ph.onEnter);
    }
    if (bd.adds && !addsCalled && frac < bd.adds.hpBelow && ent.stats.hp > 0) {
      addsCalled = true;
      callAdds(c, ent, bd.adds.group);
    }
    if (bd.fleeAtZero && !bossEnded && ent.stats.hp > 0 && frac <= 0.06) {
      // Durn yields and runs: the fight is won; he is gone a moment later.
      ent.tags |= TAG.INVULNERABLE;
      ent.brain.state = 'bossFlee';
      c.combat.cancel(ent);
      fleeT = 2.5;
      endBoss(true);
    }
  }

  /** @param {any} c @param {any} ent @param {string} groupId */
  function callAdds(c, ent, groupId) {
    const g = c.defs.find('group', groupId);
    if (!g) return;
    const before = addIds.length;
    spawnGroupAt(g, ent.pos.x, ent.pos.z, { level: bossDef ? bossDef.level : ent.level, aggro: true, radius: 10 }, ORIGIN.add, undefined, addIds);
    for (let i = before; i < addIds.length; i++) {
      const a = c.ents.get(addIds[i]);
      if (a && a.brain) a.brain.leash = 400;
    }
  }

  /** @param {boolean} defeated */
  function endBoss(defeated) {
    if (bossEnded) return;
    bossEnded = true;
    pBossEnd.bossId = bossDef ? bossDef.id : pending.pending || '';
    pBossEnd.defeated = defeated;
    if (defeated) pending.defeat();
    ctx.bus.emit('boss:end', pBossEnd);
  }

  function clearAdds(kill) {
    for (let i = 0; i < addIds.length; i++) {
      const e = ctx.ents.get(addIds[i]);
      if (!e || !e.alive) continue;
      if (kill && e.combat && e.combat.state !== 'dead') ctx.combat.kill(e, 0);
      else despawn(e.id);
    }
    addIds.length = 0;
  }

  /** Arena rules: reset on leaving, restart on re-entry. */
  function arenaRules(c) {
    const p = c.player;
    if (!p) return;
    const alive = p.alive && !!p.combat && p.combat.state !== 'dead';
    const ent = bossEnt();
    if (ent && bossDef && !bossEnded) {
      const lm = c.world ? c.world.landmark(bossDef.arena.landmarkId) : null;
      if (lm) {
        const dx = p.pos.x - lm.x;
        const dz = p.pos.z - lm.z;
        const r = bossDef.arena.radius + BALANCE.bossRules.resetExtra;
        if (dx * dx + dz * dz > r * r) ai.resetBoss();
      }
      return;
    }
    if (!ent && pending.pending && !pending.spawned) {
      const bd = c.defs.find('boss', pending.pending);
      const lm = bd && c.world ? c.world.landmark(bd.arena.landmarkId) : null;
      if (!lm) return;
      const dx = p.pos.x - lm.x;
      const dz = p.pos.z - lm.z;
      const inArena = dx * dx + dz * dz <= bd.arena.radius * bd.arena.radius;
      const id = pending.restart(inArena, alive, false);
      if (id) ai.startBoss(id, { skipIntro: true });
    }
  }

  // ------------------------------------------------------------------ the service

  const ai = {
    /** @param {string} enemyId @param {number} x @param {number} y @param {number} z @param {any} [opts] */
    spawn(enemyId, x, y, z, opts) {
      return spawnInternal(enemyId, x, y, z, opts || {}, undefined, ORIGIN.manual);
    },

    /** @param {string} groupId @param {number} x @param {number} z @param {{ level?:number, questTag?:string, radius?:number, aggro?:boolean }} [opts] */
    spawnGroup(groupId, x, z, opts) {
      const g = ctx.defs.find('group', groupId);
      if (!g) {
        ctx.log.warn('ai', 'spawnGroup: unknown group', groupId);
        return [];
      }
      return spawnGroupAt(g, x, z, opts || {}, ORIGIN.manual, undefined, []);
    },

    /** @param {number} entId */
    despawn(entId) {
      despawn(entId);
    },

    /** @param {string} id @param {{ skipIntro?:boolean }} [opts] */
    startBoss(id, opts) {
      const bd = ctx.defs.find('boss', id);
      if (!bd) {
        ctx.log.warn('ai', 'startBoss: unknown boss', id);
        return null;
      }
      const old = bossEnt();
      if (old) despawn(old.id);
      clearAdds(false);
      return spawnBoss(bd, !!(opts && opts.skipIntro));
    },

    resetBoss() {
      const e = bossEnt();
      const was = !!e && !bossEnded;
      if (e) despawn(e.id);
      clearAdds(false);
      bossId = 0;
      pending.reset();
      hzN = 0;
      if (was) endBoss(false);
    },

    get boss() {
      return bossEnt();
    },

    /** @param {boolean} on */
    setEnabled(on) {
      enabled = !!on;
      if (!enabled) {
        for (const kind of ['enemy', 'boss']) for (const e of ctx.ents.list(kind)) zeroIntent(e);
        director.reset();
      }
    },

    /** @param {boolean} on */
    setAmbient(on) {
      ambient = !!on;
    },

    get ambient() {
      return ambient;
    },

    /** @param {number} entId @param {number} targetId */
    aggro(entId, targetId) {
      const e = ctx.ents.get(entId);
      if (!e || !e.brain || !e.brain.aiBrain) return;
      e.brain.aggro = true;
      e.brain.passive = false;
      e.brain.ignoreT = 0;
      e.brain.targetId = targetId || (ctx.player ? ctx.player.id : 0);
    },

    /** @param {number} x @param {number} z @param {number} radius */
    clear(x, z, radius) {
      const ids = [];
      for (const e of ctx.ents.list('enemy')) {
        if (!e.alive || e.questTag || !spawned.has(e.id)) continue;
        if ((e.pos.x - x) * (e.pos.x - x) + (e.pos.z - z) * (e.pos.z - z) <= radius * radius) ids.push(e.id);
      }
      for (const id of ids) despawn(id);
    },

    /** @returns {{ alive:number, engaged:number }} */
    population() {
      let alive = 0;
      let engaged = 0;
      for (const kind of ['enemy', 'boss']) {
        for (const e of ctx.ents.list(kind)) {
          if (!e.alive || (e.combat && e.combat.state === 'dead')) continue;
          alive++;
          if (e.brain && e.brain.targetId) engaged++;
        }
      }
      return { alive, engaged };
    },

    /** @param {number} entId */
    debugState(entId) {
      const e = ctx.ents.get(entId);
      if (!e || !e.brain || !e.brain.aiBrain) return null;
      return { brain: e.brain.kind, state: e.brain.state, targetId: e.brain.targetId, hasToken: director.holds(e.id) !== 0 };
    },

    /** @param {string} id @param {Function} factory */
    registerBrain(id, factory) {
      if (typeof factory === 'function') customBrains.set(id, factory);
    },

    /** Token holders now (tests and the debug overlay). */
    tokens() {
      return { melee: director.count('melee'), ranged: director.count('ranged'), limits: { melee: director.limits.melee, ranged: director.limits.ranged } };
    },

    /** Camp states (tests): id, region, populated, alive members. */
    camps() {
      if (!sessionReady && ctx.world) prepareSession();
      return camps.map((c) => ({ id: c.id, regionId: c.regionId, x: c.x, z: c.z, tier: c.tier, populated: c.populated, alive: c.alive }));
    },

    dispose() {
      for (const id of Array.from(spawned)) despawn(id);
      reset();
    },
  };

  function reset() {
    spawned.clear();
    bodyCount = 0;
    bossId = 0;
    bossDef = null;
    bossPhase = 0;
    bossEnded = false;
    addIds.length = 0;
    hzN = 0;
    pending.end();
    director.reset();
    sessionReady = false;
    camps = [];
    campById.clear();
    settlements = [];
    spawnCooldown = 0;
  }

  const spawnerSystem = {
    id: 'ai.spawner',
    phase: 'post',
    /** @param {any} c @param {number} dt */
    step(c, dt) {
      runHazards(c, dt);
      if (phaseDirty) {
        phaseDirty = false;
        processBoss(c);
      }
      if (fleeT > 0) {
        fleeT -= dt;
        const e = bossEnt();
        if (fleeT <= 0 && e) {
          e.tags &= ~TAG.INVULNERABLE;
          c.combat.kill(e, c.player ? c.player.id : 0);
        }
      }
      const tick = c.time.tick;
      if (tick % 10 === 0) arenaRules(c);
      if (tick % SPAWN_EVERY === 0) populate(c);
      bodies(c);
    },
  };

  /** Remove bodies 1.5 s after death (only the enemies and bosses this service spawned). */
  function bodies(c) {
    const now = c.time.now;
    let w = 0;
    for (let i = 0; i < bodyCount; i++) {
      if (bodyAt[i] <= now) {
        if (spawned.has(bodyId[i])) despawn(bodyId[i]);
      } else {
        bodyId[w] = bodyId[i];
        bodyAt[w] = bodyAt[i];
        w++;
      }
    }
    bodyCount = w;
  }

  const on = {
    /** @param {any} e actor:died */
    died(e) {
      if ((e.kind !== 'enemy' && e.kind !== 'boss') || !spawned.has(e.entId)) return;
      director.release(e.entId, ctx.time.now, true);
      if (bodyCount < MAX_BODIES) {
        bodyId[bodyCount] = e.entId;
        bodyAt[bodyCount] = ctx.time.now + BODY_SECONDS;
        bodyCount++;
      }
      const ent = ctx.ents.get(e.entId);
      const b = ent ? ent.brain : null;
      if (b && b.aiBrain && b.campId) {
        const cp = campById.get(b.campId);
        b.campId = null;
        if (cp && cp.populated) {
          cp.alive = Math.max(0, cp.alive - 1);
          if (cp.alive === 0) {
            const day = ctx.env ? ctx.env.day : 0;
            const w = ctx.store.state.world;
            if (!w.camps) w.camps = {};
            w.camps[cp.id] = day;
            ctx.store.set('world.camps', w.camps);
            cp.populated = false;
            pCamp.campId = cp.id; pCamp.regionId = cp.regionId; pCamp.day = day;
            ctx.bus.post('camp:cleared', pCamp);
          }
        }
      }
      if (bossId && bossId === e.entId) {
        endBoss(true);
        fleeT = 0;
        clearAdds(true);
      }
    },
    /** @param {any} e actor:damaged */
    damaged(e) {
      if (bossId && e.targetId === bossId) phaseDirty = true;
      const t = ctx.ents.get(e.targetId);
      const b = t ? t.brain : null;
      if (!b || !b.aiBrain || b.passive || b.targetId || b.ignoreT > 1e8) return;
      const p = ctx.player;
      if (p && e.sourceId === p.id) {
        b.targetId = p.id;
        b.ignoreT = 0;
      }
    },
    /** @param {any} e player:respawned */
    respawned(e) {
      for (const kind of ['enemy', 'boss']) {
        for (const ent of ctx.ents.list(kind)) {
          const b = ent.brain;
          if (!ent.alive || !b || !b.aiBrain) continue;
          b.targetId = 0;
          b.aggro = false;
          b.ignoreT = 2;
          b.state = 'return';
          b.stateT = 0;
          if (ent.stats) ctx.combat.heal(ent, ent.stats.hpMax);
        }
      }
      director.reset();
      if (pending.pending && !bossEnt()) {
        const p = ctx.player;
        const id = pending.restart(false, !!p && p.alive, !!e.retry);
        if (id) ai.startBoss(id, { skipIntro: true });
      } else if (bossEnt() && !e.retry) {
        ai.resetBoss();
      }
    },
    playerDied() {
      if (bossEnt()) ai.resetBoss();
    },
    ended() {
      for (const id of Array.from(spawned)) {
        const ent = ctx.ents.get(id);
        if (ent && ent.brain && ent.brain.beam && ent.brain.beam.end) ent.brain.beam.end(0);
      }
      reset();
    },
  };

  registerAiScripts(ctx, hz);

  return { ai, brainSystem, spawnerSystem, on };
}
