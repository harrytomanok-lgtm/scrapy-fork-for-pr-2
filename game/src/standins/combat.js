/**
 * Stand-in `ctx.combat` (ARCHITECTURE 4.9, 8.0): a generic technique runner driven by technique data (5.1):
 * windup / active / recover timelines, chains (Strike String), hold-to-charge (Breaker, Dawn Lance), timed hit
 * shapes (sphere, cone, ring) resolved with `spatial`, projectiles (entities of kind `projectile`, swept with
 * `spatial.querySegment` against the terrain), beams, motions (lunge, toTarget, behindTarget, charge), craters,
 * telegraphs; Guard (with the perfect window), Flicker Step, Gather, Forms (`setForm` with cost, drain, timing
 * and Burnout); `damage` with the real formula (`formulas.damage`), crits, poise and Break, knock, Surge,
 * death events in the documented order; Ora regen and boost cost; targeting with soft target = nearest hostile.
 * Systems: `standin.combat.player` (intent, order 10) and `standin.combat.run` (combat).
 * Replaced by the combat package.
 * @module standins/combat
 */

import { BALANCE } from '../core/balance.js';
import * as F from '../core/formulas.js';
import { TAG, KIND_MASK } from '../core/ents.js';
import { PALETTE } from '../core/palette.js';

const OWNER = 'standin:combat';
const CB = BALANCE.combat;
const SURGE = BALANCE.surge;
const GUARD = BALANCE.tech.guard;
const FLICK = BALANCE.tech.flicker_step;
const BOOST = BALANCE.tech.boost;
const FORM_RULES = BALANCE.formRules;
const BREAKER_HOLD = BALANCE.tech.breaker.holdSeconds;
const MAX_HITS = 8;
const MAX_SHOTS = 4;
const OUT_MAX = 64;
const BUSY = Object.freeze(['windup', 'active', 'recover']);
const BLOCKED_STATES = Object.freeze(['dead', 'stagger', 'down', 'transform', 'scripted']);

/**
 * @typedef {object} Rec  Private runtime of one combatant.
 * @property {any} ent @property {any} def @property {number} step @property {number} phaseT @property {number} techT
 * @property {Uint8Array} hitDone @property {Float64Array} hitNext @property {Uint8Array} shotDone @property {Float64Array} shotNext
 * @property {number} beamNext @property {boolean} motionDone @property {boolean} queued @property {boolean} charging
 * @property {number} chargeT @property {number} chargeMult @property {number} chargeEmitT @property {number} dirX @property {number} dirZ
 * @property {boolean} enabled @property {number} guardStart @property {number} gatherLock @property {number} poiseIdle
 * @property {boolean} broken @property {number} surgeIdle @property {number} lastSurge @property {boolean} boostBlocked
 * @property {boolean} perfectUsed @property {string[]} cdKeys
 */

/**
 * Create the stand-in combat service.
 * @param {any} ctx
 */
function createCombat(ctx) {
  /** @type {Map<number, Rec>} */
  const recs = new Map();
  /** @type {Map<string, Function>} */
  const scripts = new Map();
  /** @type {any[]} */
  const OUT = [];
  /** Projectile data pool. @type {any[]} */
  const shotPool = [];
  const seenForms = new Set();
  let hardTarget = 0;
  let softTarget = 0;
  let inCombat = false;
  let threat = 0;

  // Reused event payloads (7.2 rule 1; listeners never retain them).
  const pDamaged = { targetId: 0, sourceId: 0, amount: 0, crit: false, blocked: false, perfect: false, techId: null, kind: 'melee', x: 0, y: 0, z: 0, hpAfter: 0 };
  const pHit = { attackerId: 0, targetId: 0, techId: null, class: 'lightHit', amount: 0, x: 0, y: 0, z: 0, dirX: 0, dirZ: 0, blocked: false, perfect: false, crit: false };
  const pStag = { entId: 0, seconds: 0, broken: false };
  const pDied = { entId: 0, sourceId: 0, kind: 'enemy', defId: '', level: 1, questTag: null, x: 0, y: 0, z: 0 };
  const pPDied = { x: 0, y: 0, z: 0, bossId: null };
  const pHealed = { entId: 0, amount: 0 };
  const pStart = { entId: 0, techId: '', targetId: 0 };
  const pPhase = { entId: 0, techId: '', phase: 'windup' };
  const pEnd = { entId: 0, techId: '', cancelled: false };
  const pTele = { entId: 0, kind: 'white', seconds: 0, shape: 'self', radius: 0, x: 0, y: 0, z: 0, dirX: 0, dirZ: 1 };
  const pCharge = { entId: 0, techId: '', level: 0 };
  const pGather = { entId: 0, on: false };
  const pGuard = { entId: 0, on: false };
  const pPerfect = { entId: 0, kind: 'guard', attackerId: 0 };
  const pFlicker = { entId: 0, fromX: 0, fromY: 0, fromZ: 0, toX: 0, toY: 0, toZ: 0 };
  const pForm = { entId: 0, formId: null, prevFormId: null, first: false };
  const pBurn = { entId: 0 };
  const pLock = { entId: 0, targetId: 0 };
  const pSurge = { value: 0, full: false };
  const pState = { inCombat: false, threat: 0 };
  const pShotOn = { entId: 0, fxId: 'bolt', ownerId: 0, color: 0 };
  const pShotOff = { entId: 0, fxId: 'bolt', hit: false, x: 0, y: 0, z: 0 };
  const REQ = { sourceId: 0, targetId: 0, techId: null, power: 0, kind: 'melee', rating: undefined, poise: 0, knock: null, dirX: 0, dirZ: 0,
    x: undefined, y: undefined, z: undefined, unblockable: false, canCrit: true, feel: 'lightHit' };
  const RES = { applied: false, amount: 0, crit: false, blocked: false, perfect: false, killed: false, staggered: false };
  const REGEN = { inCombat: false, inSiphonZone: false, boosting: false, inForm: false, burnout: false };
  const DEFAULT_OPTS = Object.freeze({});

  const isPlayer = (e) => e !== null && e === ctx.player;
  const hostileFilter = (e) => e.alive && e.team === 2 && (e.tags & TAG.NO_LOCK) === 0 && e.combat !== null && e.combat.state !== 'dead';

  /** @param {any} ent @returns {Rec} */
  function recOf(ent) {
    let r = recs.get(ent.id);
    if (r && r.ent === ent) return r;
    r = {
      ent, def: null, step: 0, phaseT: 0, techT: 0,
      hitDone: new Uint8Array(MAX_HITS), hitNext: new Float64Array(MAX_HITS), shotDone: new Uint8Array(MAX_SHOTS), shotNext: new Float64Array(MAX_SHOTS),
      beamNext: 0, motionDone: false, queued: false, charging: false, chargeT: 0, chargeMult: 1, chargeEmitT: 0, dirX: 0, dirZ: 1,
      enabled: true, guardStart: -10, gatherLock: 0, poiseIdle: 0, broken: false, surgeIdle: 0, lastSurge: 0, boostBlocked: false,
      perfectUsed: false, cdKeys: [],
    };
    recs.set(ent.id, r);
    return r;
  }

  /** Can an attacker of `team` (entity `att`) hit `t`? */
  function canHit(att, team, t) {
    if (!t || t === att || !t.alive || !t.stats || !t.combat || t.combat.state === 'dead') return false;
    if (team === 1) return t.team === 2 || (t.kind === 'object' && t.team !== 1);
    if (team === 2) return t.team === 1;
    return false;
  }

  /** @param {any} def @param {number} step @returns {any} the chain step or the def */
  function stepOf(def, step) {
    return def.chain && def.chain[step] ? def.chain[step] : def;
  }

  /** @param {any} ent @param {string|undefined} clip */
  function anim(ent, clip) {
    if (clip && ctx.actors) ctx.actors.play(ent, clip);
  }

  /** Aim direction toward the target (or forward) into r.dirX / r.dirZ. */
  function aim(ent, r, targetId, dirX, dirZ) {
    const t = targetId ? ctx.ents.get(targetId) : null;
    let dx = 0;
    let dz = 0;
    if (typeof dirX === 'number' && typeof dirZ === 'number' && (dirX !== 0 || dirZ !== 0)) {
      dx = dirX; dz = dirZ;
    } else if (t && t.alive) {
      dx = t.pos.x - ent.pos.x; dz = t.pos.z - ent.pos.z;
    }
    const l = Math.sqrt(dx * dx + dz * dz);
    if (l < 1e-4) {
      r.dirX = Math.sin(ent.yaw); r.dirZ = Math.cos(ent.yaw);
    } else {
      r.dirX = dx / l; r.dirZ = dz / l;
    }
  }

  /** Reset the per-activation hit and shot bookkeeping for the current step. */
  function armStep(r) {
    const s = stepOf(r.def, r.step);
    const hits = s.hits || r.def.hits;
    r.hitDone.fill(0);
    for (let i = 0; i < hits.length && i < MAX_HITS; i++) r.hitNext[i] = hits[i].t;
    const shots = r.def.projectiles;
    r.shotDone.fill(0);
    for (let i = 0; i < shots.length && i < MAX_SHOTS; i++) r.shotNext[i] = shots[i].t;
    r.beamNext = 0;
    r.motionDone = false;
    r.phaseT = 0;
    r.techT = 0;
    r.queued = false;
  }

  function emitPhase(ent, techId, phase) {
    pPhase.entId = ent.id; pPhase.techId = techId; pPhase.phase = phase;
    ctx.bus.emit('combat:techPhase', pPhase);
  }

  /** End the running technique. */
  function endTech(ent, cancelled) {
    const c = ent.combat;
    const r = recOf(ent);
    const id = c.techId;
    c.state = c.state === 'dead' ? 'dead' : 'idle';
    c.techId = null;
    c.techT = 0;
    c.charge = 0;
    r.def = null;
    r.charging = false;
    r.queued = false;
    if (id) {
      pEnd.entId = ent.id; pEnd.techId = id; pEnd.cancelled = cancelled;
      ctx.bus.emit('combat:techEnd', pEnd);
    }
  }

  function setGuard(ent, on) {
    const c = ent.combat;
    if (c.guarding === on) return;
    c.guarding = on;
    if (on) {
      c.state = 'guard';
      recOf(ent).guardStart = ctx.time.now;
      anim(ent, 'guard');
    } else if (c.state === 'guard') {
      c.state = 'idle';
    }
    pGuard.entId = ent.id; pGuard.on = on;
    ctx.bus.emit('combat:guard', pGuard);
  }

  function setGather(ent, on) {
    const c = ent.combat;
    if (c.gathering === on) return;
    c.gathering = on;
    if (on) {
      c.state = 'gather';
      anim(ent, 'gather');
    } else if (c.state === 'gather') {
      c.state = 'idle';
    }
    pGather.entId = ent.id; pGather.on = on;
    ctx.bus.emit('combat:gather', pGather);
  }

  /** Stop guard, gather or a cancelable technique so a new action can start. @returns {boolean} free */
  function free(ent) {
    const c = ent.combat;
    if (BLOCKED_STATES.indexOf(c.state) >= 0) return false;
    if (c.state === 'guard') setGuard(ent, false);
    if (c.state === 'gather') setGather(ent, false);
    if (BUSY.indexOf(c.state) >= 0) {
      const r = recOf(ent);
      const tl = stepOf(r.def, r.step).timeline;
      if (c.state === 'recover' && tl.cancelFrom >= 0 && r.phaseT >= tl.cancelFrom) endTech(ent, true);
      else return false;
    }
    return true;
  }

  function costMult(ent, techId) {
    return techId === 'flicker_step' && isPlayer(ent) ? F.mod(ctx.rpg.mods(), 'flickerCostMult') : 1;
  }

  /** Is a technique usable now (state aside)? */
  function usable(ent, def) {
    const c = ent.combat;
    const r = recOf(ent);
    if (!r.enabled) return false;
    if ((c.cooldowns[def.id] || 0) > 0) return false;
    if (ent.stats.ora + 1e-6 < def.cost.ora * costMult(ent, def.id)) return false;
    if (c.surge + 1e-6 < def.cost.surge) return false;
    if (isPlayer(ent) && def.user === 'player' && ctx.rpg && !ctx.rpg.hasTech(def.id)) return false;
    const mode = ent.move ? ent.move.mode : 'ground';
    if (mode === 'fly' && def.move && def.move.air === false) return false;
    if (mode !== 'fly' && def.move && def.move.ground === false) return false;
    return true;
  }

  /** Telegraph from technique data. */
  function telegraphFrom(ent, r, def, seconds) {
    const tg = def.telegraph;
    if (!tg) return;
    const t = tg.atTarget && ent.combat.targetId ? ctx.ents.get(ent.combat.targetId) : null;
    const diff = F.difficultyRow(ctx.rpg ? ctx.rpg.difficulty : 'warrior');
    combat.telegraph(ent, tg.kind, seconds * (ent.team === 2 ? diff.telegraph : 1), {
      shape: tg.shape, radius: tg.radius || 0, x: t ? t.pos.x : ent.pos.x, y: t ? t.pos.y : ent.pos.y, z: t ? t.pos.z : ent.pos.z, dirX: r.dirX, dirZ: r.dirZ,
    });
  }

  /** Start technique `def` (state already checked and freed). */
  function start(ent, def, opts) {
    const c = ent.combat;
    const r = recOf(ent);
    const o = opts || DEFAULT_OPTS;
    const st = ent.stats;
    const ora = def.cost.ora * costMult(ent, def.id);
    if (ora > 0) combat.addOra(ent, -ora);
    if (def.cost.surge > 0) combat.addSurge(ent, -def.cost.surge);
    c.cooldowns[def.id] = F.cooldown(def.cooldown, st.cdr || 0);
    let targetId = typeof o.targetId === 'number' ? o.targetId : 0;
    if (!targetId && isPlayer(ent)) targetId = hardTarget || softTarget;
    const tEnt = targetId ? ctx.ents.get(targetId) : null;
    if (!tEnt || !tEnt.alive) targetId = 0;
    c.targetId = targetId;
    r.def = def;
    r.step = 0;
    armStep(r);
    aim(ent, r, targetId, o.dirX, o.dirZ);
    if (def.move && def.move.turn && ctx.move) ctx.move.face(ent, Math.atan2(r.dirX, r.dirZ), true);
    r.charging = !!(o.hold && def.charge);
    r.chargeT = 0;
    r.chargeEmitT = 0;
    r.chargeMult = def.charge && typeof o.charge === 'number' ? 1 + (def.charge.maxMult - 1) * Math.max(0, Math.min(1, o.charge)) : 1;
    r.perfectUsed = false;
    c.state = 'windup';
    c.techId = def.id;
    c.techT = 0;
    c.charge = 0;
    c.comboIndex = 0;
    if (ent.team === 2 && targetId && ctx.player && targetId === ctx.player.id) c.inCombatT = CB.inCombatSeconds;
    const tl = def.timeline;
    if (def.move && def.move.lock !== 'none' && ctx.move) {
      ctx.move.lock(ent, tl.windup + tl.active + tl.recover, { slow: def.move.lock === 'root' ? 0 : 0.4, noTurn: !def.move.turn });
    }
    pStart.entId = ent.id; pStart.techId = def.id; pStart.targetId = targetId;
    ctx.bus.emit('combat:techStart', pStart);
    emitPhase(ent, def.id, 'windup');
    telegraphFrom(ent, r, def, tl.windup);
    anim(ent, def.anim && def.anim.windup);
    return true;
  }

  /** Next chain step. */
  function nextStep(ent, r) {
    const c = ent.combat;
    r.step++;
    armStep(r);
    c.comboIndex = r.step;
    aim(ent, r, c.targetId, undefined, undefined);
    if (ctx.move) ctx.move.face(ent, Math.atan2(r.dirX, r.dirZ), true);
    c.state = 'windup';
    emitPhase(ent, r.def.id, 'windup');
    anim(ent, stepOf(r.def, r.step).anim.windup);
  }

  /** Run a motion. */
  function motion(ent, r, m) {
    const mv = ctx.move;
    if (!mv) return;
    const t = ent.combat.targetId ? ctx.ents.get(ent.combat.targetId) : null;
    const dist = typeof m.dist === 'number' ? m.dist : 6;
    let x = ent.pos.x + r.dirX * dist;
    let z = ent.pos.z + r.dirZ * dist;
    if (m.kind === 'toTarget' || m.kind === 'behindTarget') {
      if (!t || !t.alive) return;
      const dx = t.pos.x - ent.pos.x;
      const dz = t.pos.z - ent.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const reach = (t.radius || 0.5) + ent.radius + 0.6;
      if (m.kind === 'toTarget' && (d <= reach || d > dist + reach)) return;
      if (m.kind === 'behindTarget' && d > dist) return;
      const k = m.kind === 'toTarget' ? (d - reach) / d : (d + reach) / d;
      x = ent.pos.x + dx * k;
      z = ent.pos.z + dz * k;
    }
    const y = ent.move && ent.move.mode === 'fly' ? ent.pos.y : ctx.world ? ctx.world.groundAt(x, ent.pos.y + 2, z) : ent.pos.y;
    if (ent.combat.techId === 'flicker_step') {
      pFlicker.entId = ent.id; pFlicker.fromX = ent.pos.x; pFlicker.fromY = ent.pos.y; pFlicker.fromZ = ent.pos.z;
      pFlicker.toX = x; pFlicker.toY = y; pFlicker.toZ = z;
      ctx.bus.emit('combat:flicker', pFlicker);
    }
    mv.dashTo(ent, x, y, z, Math.max(1 / 60, m.seconds || 0.1));
  }

  /** Fill REQ from a hit-like block and deal damage to `t`. */
  function strike(ent, r, t, h, techId, x, y, z) {
    REQ.sourceId = ent.id; REQ.targetId = t.id; REQ.techId = techId;
    REQ.power = h.power * r.chargeMult; REQ.kind = r.def && r.def.rating === 'ora' ? 'ora' : 'melee'; REQ.rating = undefined;
    REQ.poise = h.poise || 0; REQ.knock = h.knock || null; REQ.unblockable = !!h.unblockable; REQ.canCrit = true; REQ.feel = h.feel || 'lightHit';
    let dx = t.pos.x - (h.shape === 'ring' ? ent.pos.x : x);
    let dz = t.pos.z - (h.shape === 'ring' ? ent.pos.z : z);
    const l = Math.sqrt(dx * dx + dz * dz);
    if (l > 1e-4) { dx /= l; dz /= l; } else { dx = r.dirX; dz = r.dirZ; }
    REQ.dirX = dx; REQ.dirZ = dz;
    REQ.x = t.pos.x; REQ.y = t.pos.y + t.height * 0.6; REQ.z = t.pos.z;
    combat.damage(REQ, RES);
  }

  /** Resolve one HitDef. */
  function fireHit(ent, r, h) {
    const ring = h.shape === 'ring';
    const fx = r.dirX;
    const fz = r.dirZ;
    const cx = ring ? ent.pos.x : ent.pos.x + fx * h.f;
    const cy = ent.pos.y + h.u;
    const cz = ring ? ent.pos.z : ent.pos.z + fz * h.f;
    const mask = ent.team === 1 ? KIND_MASK.HOSTILE_TARGETS : KIND_MASK.player;
    const n = ctx.spatial.querySphere(cx, cy, cz, h.radius, OUT, mask);
    const max = h.maxTargets || OUT_MAX;
    let done = 0;
    const cosHalf = h.shape === 'cone' && h.angle ? Math.cos((h.angle * Math.PI) / 360) : -2;
    for (let i = 0; i < n && done < max; i++) {
      const t = OUT[i];
      if (!canHit(ent, ent.team, t)) continue;
      if (cosHalf > -2) {
        const dx = t.pos.x - ent.pos.x;
        const dz = t.pos.z - ent.pos.z;
        const l = Math.sqrt(dx * dx + dz * dz) || 1;
        if ((dx * fx + dz * fz) / l < cosHalf) continue;
      }
      strike(ent, r, t, h, r.def.id, cx, cy, cz);
      done++;
    }
    for (let i = 0; i < n; i++) OUT[i] = null;
    if (ring && ctx.vfx) ctx.vfx.shockwave(ent.pos.x, ent.pos.y, ent.pos.z, { radius: h.radius, seconds: 0.3, color: ent.team === 1 ? PALETTE.ora : PALETTE.hostile });
  }

  /** Spawn the projectiles of one ProjectileDef. */
  function fireShot(ent, r, p) {
    const def = r.def;
    const count = p.count || 1;
    const t = ent.combat.targetId ? ctx.ents.get(ent.combat.targetId) : null;
    const ox = ent.pos.x + r.dirX * 0.6;
    const oy = ent.pos.y + Math.max(0.8, ent.height * 0.65);
    const oz = ent.pos.z + r.dirZ * 0.6;
    let vy = 0;
    if (t && t.alive) {
      const dx = t.pos.x - ox;
      const dz = t.pos.z - oz;
      const dh = Math.sqrt(dx * dx + dz * dz) || 1;
      vy = (t.pos.y + t.height * 0.5 - oy) / dh;
    }
    const baseYaw = Math.atan2(r.dirX, r.dirZ);
    let color = PALETTE.ora;
    if (ent.team === 2) {
      const ed = ctx.defs.find('enemy', ent.defId);
      color = ed && typeof ed.oraColor === 'number' ? ed.oraColor : PALETTE.hostile;
    } else if (def.fx && typeof def.fx.color === 'number') {
      color = def.fx.color;
    }
    for (let k = 0; k < count; k++) {
      const off = count > 1 ? ((k / (count - 1)) - 0.5) * (p.spreadDeg || 0) : 0;
      const jitter = count === 1 && p.spreadDeg ? (ctx.rng.sim.next() - 0.5) * p.spreadDeg : 0;
      const yaw = baseYaw + ((off + jitter) * Math.PI) / 180;
      const e = ctx.ents.create('projectile');
      if (!e) return;
      const sp = p.speed;
      const hl = Math.sqrt(1 + vy * vy);
      e.team = ent.team;
      e.defId = def.id;
      e.radius = p.radius;
      e.height = p.radius * 2;
      e.yaw = yaw;
      e.pos.set(ox, oy, oz);
      e.prev.set(ox, oy, oz);
      e.vel.set((Math.sin(yaw) * sp) / hl, (vy * sp) / hl, (Math.cos(yaw) * sp) / hl);
      const d = shotPool.length ? shotPool.pop() : { ownerId: 0, team: 0, techId: '', fxId: '', power: 0, poise: 0, knock: null, feel: '', rating: 'ora',
        life: 0, homing: 0, gravity: 0, pierce: 0, targetId: 0, dist: 0, lastHit: 0, chargeMult: 1, aoe: null, standinShot: true };
      d.ownerId = ent.id; d.team = ent.team; d.techId = def.id; d.fxId = p.fxId; d.power = p.power; d.poise = p.poise; d.knock = p.knock;
      d.feel = p.feel; d.rating = def.rating; d.life = p.life; d.homing = p.homing || 0; d.gravity = p.gravity || 0; d.pierce = p.pierce || 0;
      d.targetId = t && t.alive ? t.id : 0; d.dist = 0; d.lastHit = 0; d.chargeMult = r.chargeMult; d.aoe = p.aoe || null;
      e.data = d;
      pShotOn.entId = e.id; pShotOn.fxId = p.fxId; pShotOn.ownerId = ent.id; pShotOn.color = color;
      ctx.bus.emit('projectile:spawned', pShotOn);
    }
  }

  /** Beam tick: a capsule sweep along the aim direction. */
  function fireBeam(ent, r, b) {
    const ax = ent.pos.x;
    const ay = ent.pos.y + ent.height * 0.65;
    const az = ent.pos.z;
    const bx = ax + r.dirX * b.range;
    const bz = az + r.dirZ * b.range;
    const mask = ent.team === 1 ? KIND_MASK.HOSTILE_TARGETS : KIND_MASK.player;
    const n = ctx.spatial.querySegment(ax, ay, az, bx, ay, bz, b.radius, OUT, mask);
    for (let i = 0; i < n; i++) {
      const t = OUT[i];
      if (canHit(ent, ent.team, t)) strike(ent, r, t, b, r.def.id, ax, ay, az);
    }
    for (let i = 0; i < n; i++) OUT[i] = null;
  }

  /** Advance the technique of one entity. */
  function runTech(ent, r, dt) {
    const c = ent.combat;
    const def = r.def;
    if (!def) {
      endTech(ent, true);
      return;
    }
    const s = stepOf(def, r.step);
    const tl = s.timeline;
    if (c.state === 'windup') {
      if (r.charging) {
        r.chargeT += dt;
        const ch = def.charge;
        c.charge = Math.min(1, r.chargeT / Math.max(1e-3, ch.max));
        if (ch.oraPerSec > 0) combat.addOra(ent, -ch.oraPerSec * dt);
        r.chargeEmitT -= dt;
        if (r.chargeEmitT <= 0) {
          r.chargeEmitT = 0.1;
          pCharge.entId = ent.id; pCharge.techId = def.id; pCharge.level = c.charge;
          ctx.bus.emit('combat:charge', pCharge);
        }
        if (r.chargeT >= ch.max || (ch.oraPerSec > 0 && ent.stats.ora <= 0)) {
          r.charging = false;
          r.chargeMult = F.chargeMult(r.chargeT, ch.min, ch.max, ch.maxMult);
        }
        return;
      }
      r.phaseT += dt;
      r.techT += dt;
    } else {
      r.phaseT += dt;
      r.techT += dt;
    }
    c.techT = r.techT;
    const m = s.motion !== undefined ? s.motion : def.motion;
    if (m && !r.motionDone && r.techT >= m.t) {
      r.motionDone = true;
      motion(ent, r, m);
    }
    if (c.state === 'windup' && r.phaseT >= tl.windup) {
      r.phaseT -= tl.windup;
      c.state = 'active';
      emitPhase(ent, def.id, 'active');
      anim(ent, s.anim && s.anim.active);
      if (def.invulnerable) c.invulnT = Math.max(c.invulnT, tl.active + (def.id === 'flicker_step' ? FLICK.invulnerable - tl.active : 0));
      if (def.crater && ctx.world) {
        const t = c.targetId ? ctx.ents.get(c.targetId) : null;
        const at = def.crater.at === 'impact' && t ? t.pos : ent.pos;
        ctx.world.crater(at.x, at.z, def.crater.radius, def.crater.depth, ent.id);
      }
    }
    if (c.state === 'active') {
      const hits = s.hits || def.hits;
      for (let i = 0; i < hits.length && i < MAX_HITS; i++) {
        const h = hits[i];
        if (h.every) {
          const until = typeof h.until === 'number' ? h.until : tl.active;
          while (r.hitNext[i] <= r.phaseT && r.hitNext[i] <= until) {
            fireHit(ent, r, h);
            r.hitNext[i] += h.every;
          }
        } else if (!r.hitDone[i] && r.phaseT >= h.t) {
          r.hitDone[i] = 1;
          fireHit(ent, r, h);
        }
        if (!ent.alive || c.state !== 'active') return;
      }
      const shots = def.projectiles;
      for (let i = 0; i < shots.length && i < MAX_SHOTS; i++) {
        const p = shots[i];
        if (p.every) {
          const until = typeof p.until === 'number' ? p.until : tl.active;
          while (r.shotNext[i] <= r.phaseT && r.shotNext[i] <= until) {
            if (i > 0 || r.shotNext[i] > p.t) {
              if (def.cost.ora > 0 && isPlayer(ent)) {
                if (ent.stats.ora < def.cost.ora) { r.shotNext[i] = Infinity; break; }
                combat.addOra(ent, -def.cost.ora);
              }
            }
            aim(ent, r, c.targetId, undefined, undefined);
            fireShot(ent, r, p);
            r.shotNext[i] += p.every;
          }
        } else if (!r.shotDone[i] && r.phaseT >= p.t) {
          r.shotDone[i] = 1;
          fireShot(ent, r, p);
        }
      }
      if (def.beam) {
        r.beamNext -= dt;
        if (r.beamNext <= 0) {
          r.beamNext += def.beam.tick;
          fireBeam(ent, r, def.beam);
        }
      }
      if (r.phaseT >= tl.active) {
        r.phaseT -= tl.active;
        c.state = 'recover';
        emitPhase(ent, def.id, 'recover');
        anim(ent, s.anim && s.anim.recover);
      }
    }
    if (c.state === 'recover') {
      const chain = def.chain;
      if (r.queued && chain && r.step + 1 < chain.length && tl.cancelFrom >= 0 && r.phaseT >= tl.cancelFrom) {
        nextStep(ent, r);
        return;
      }
      if (r.phaseT >= tl.recover) {
        const again = r.queued && chain && def.id === 'strike_string';
        endTech(ent, false);
        if (again) combat.useTechnique(ent, 'strike_string', DEFAULT_OPTS);
      }
    }
  }

  /** Move projectiles and resolve their hits. */
  function runShots(dt) {
    const list = ctx.ents.list('projectile');
    const world = ctx.world;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const d = e.data;
      if (!e.alive || !d || !d.standinShot) continue;
      d.life -= dt;
      if (d.homing > 0 && d.targetId) {
        const t = ctx.ents.get(d.targetId);
        if (t && t.alive) {
          const tx = t.pos.x - e.pos.x;
          const ty = t.pos.y + t.height * 0.5 - e.pos.y;
          const tz = t.pos.z - e.pos.z;
          const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
          const sp = e.vel.length();
          const k = Math.min(1, d.homing * dt);
          e.vel.x += ((tx / tl) * sp - e.vel.x) * k;
          e.vel.y += ((ty / tl) * sp - e.vel.y) * k;
          e.vel.z += ((tz / tl) * sp - e.vel.z) * k;
          const nl = e.vel.length() || 1;
          e.vel.multiplyScalar(sp / nl);
        }
      }
      if (d.gravity) e.vel.y -= d.gravity * dt;
      const ax = e.pos.x;
      const ay = e.pos.y;
      const az = e.pos.z;
      const bx = ax + e.vel.x * dt;
      const by = ay + e.vel.y * dt;
      const bz = az + e.vel.z * dt;
      const owner = ctx.ents.get(d.ownerId);
      const mask = d.team === 1 ? KIND_MASK.HOSTILE_TARGETS : KIND_MASK.player;
      const n = ctx.spatial.querySegment(ax, ay, az, bx, by, bz, e.radius, OUT, mask);
      let best = null;
      let bestD = Infinity;
      for (let k = 0; k < n; k++) {
        const t = OUT[k];
        if (t.id === d.ownerId || t.id === d.lastHit || !canHit(owner || e, d.team, t)) continue;
        const dd = (t.pos.x - ax) * (t.pos.x - ax) + (t.pos.z - az) * (t.pos.z - az);
        if (dd < bestD) { bestD = dd; best = t; }
      }
      for (let k = 0; k < n; k++) OUT[k] = null;
      const seg = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay) + (bz - az) * (bz - az));
      d.dist += seg;
      if (best) {
        REQ.sourceId = d.ownerId; REQ.targetId = best.id; REQ.techId = d.techId;
        REQ.power = d.power * d.chargeMult * (d.techId === 'ora_bolt' ? F.boltFalloff(d.dist) : 1);
        REQ.kind = d.rating === 'ora' ? 'ora' : 'melee'; REQ.rating = undefined; REQ.poise = d.poise; REQ.knock = d.knock;
        const sl = seg || 1;
        REQ.dirX = (bx - ax) / sl; REQ.dirZ = (bz - az) / sl; REQ.unblockable = false; REQ.canCrit = true; REQ.feel = d.feel;
        REQ.x = best.pos.x; REQ.y = best.pos.y + best.height * 0.5; REQ.z = best.pos.z;
        combat.damage(REQ, RES);
        if (d.pierce > 0) {
          d.pierce--;
          d.lastHit = best.id;
        } else {
          removeShot(e, true, best.pos.x, best.pos.y + best.height * 0.5, best.pos.z);
          continue;
        }
      }
      e.pos.set(bx, by, bz);
      if (world && by <= world.heightAt(bx, bz)) {
        removeShot(e, false, bx, world.heightAt(bx, bz), bz);
        continue;
      }
      if (d.life <= 0) removeShot(e, false, bx, by, bz);
    }
  }

  function removeShot(e, hitEnt, x, y, z) {
    const d = e.data;
    pShotOff.entId = e.id; pShotOff.fxId = d ? d.fxId : 'bolt'; pShotOff.hit = hitEnt; pShotOff.x = x; pShotOff.y = y; pShotOff.z = z;
    ctx.bus.emit('projectile:removed', pShotOff);
    ctx.ents.destroy(e.id);
    if (d && d.standinShot) {
      d.knock = null;
      d.aoe = null;
      shotPool.push(d);
    }
    e.data = null;
  }

  /** Per-entity timers, regen, drains. */
  function upkeep(ent, r, dt) {
    const c = ent.combat;
    const st = ent.stats;
    if (c.invulnT > 0) c.invulnT = Math.max(0, c.invulnT - dt);
    if (c.inCombatT > 0) c.inCombatT = Math.max(0, c.inCombatT - dt);
    if (r.gatherLock > 0) r.gatherLock -= dt;
    const keys = r.cdKeys;
    const cds = c.cooldowns;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (cds[k] > 0) cds[k] = Math.max(0, cds[k] - dt);
    }
    if (c.state === 'stagger' || c.state === 'transform') {
      c.staggerT -= dt;
      if (c.staggerT <= 0) {
        c.staggerT = 0;
        c.state = 'idle';
        if (r.broken) {
          r.broken = false;
          st.poise = st.poiseMax;
        }
      }
    }
    if (st.poiseMax > 0 && !r.broken && st.poise < st.poiseMax) {
      r.poiseIdle += dt;
      if (r.poiseIdle >= CB.poise.refillSeconds) st.poise = st.poiseMax;
    }
    if (!isPlayer(ent)) return;
    const mods = ctx.rpg.mods();
    const base = ctx.rpg.base();
    if (c.burnoutT > 0) c.burnoutT = Math.max(0, c.burnoutT - dt);
    const noRegen = c.burnoutT > FORM_RULES.burnout.lockoutSeconds - FORM_RULES.burnout.noRegenSeconds;
    const boost = ent.move ? ent.move.boost : 0;
    REGEN.inCombat = inCombat; REGEN.boosting = boost > 0; REGEN.inForm = c.formId !== null; REGEN.burnout = noRegen;
    const regen = F.oraRegen(base.spr, mods, REGEN);
    if (regen > 0 && st.ora < st.oraMax) combat.addOra(ent, regen * dt);
    if (boost > 0) {
      const cost = (boost === 2 ? BOOST.sonicOraPerSec : BOOST.oraPerSec) * (1 + F.mod(mods, 'boostCostPct')) * dt;
      combat.addOra(ent, -cost);
      if (st.ora <= cost && !r.boostBlocked) {
        r.boostBlocked = true;
        ctx.move.setBoostAllowed(ent, false);
      }
    }
    if (r.boostBlocked && st.ora >= BOOST.reenableOra && c.burnoutT <= 0) {
      r.boostBlocked = false;
      ctx.move.setBoostAllowed(ent, true);
    }
    if (c.gathering) combat.addOra(ent, F.gatherRate(base.spr, mods) * dt);
    if (c.formId !== null && c.state !== 'transform') {
      const f = ctx.defs.find('form', c.formId);
      if (f) {
        combat.addOra(ent, -f.drain * dt);
        if (f.hpDrainPct > 0) st.hp = Math.max(1, st.hp - st.hpMax * f.hpDrainPct * dt);
        if (st.ora <= 0) {
          combat.setForm(ent, null, { instant: true });
          c.burnoutT = FORM_RULES.burnout.lockoutSeconds;
          pBurn.entId = ent.id;
          ctx.bus.emit('combat:burnout', pBurn);
        } else if (st.hp < st.hpMax * FORM_RULES.endBelowHpPct) {
          combat.setForm(ent, null, { instant: true });
        }
      }
    }
    r.surgeIdle += dt;
    if (r.surgeIdle > SURGE.decay.afterSeconds && c.surge > 0) {
      c.surge = Math.max(0, c.surge - SURGE.decay.perSec * dt);
      surgeEvent(ent, r);
    }
  }

  function surgeEvent(ent, r) {
    const c = ent.combat;
    if (!isPlayer(ent)) return;
    const full = c.surge >= SURGE.max;
    if (Math.abs(c.surge - r.lastSurge) >= 1 || (full && r.lastSurge < SURGE.max) || (c.surge === 0 && r.lastSurge !== 0)) {
      r.lastSurge = c.surge;
      pSurge.value = c.surge; pSurge.full = full;
      ctx.bus.emit('combat:surge', pSurge);
    }
  }

  /** Combat state and threat for the player. */
  function updateCombatState() {
    const p = ctx.player;
    let engaged = 0;
    if (p && p.alive) {
      const list = ctx.ents.all();
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.team === 2 && e.alive && e.combat !== null && e.combat.targetId === p.id && e.combat.inCombatT > 0) engaged++;
      }
    }
    const on = !!(p && p.alive && p.combat !== null && (p.combat.inCombatT > 0 || engaged > 0));
    const th = on ? Math.min(1, Math.max(engaged, 1) / 4) : 0;
    if (on !== inCombat || Math.abs(th - threat) >= 0.25) {
      inCombat = on;
      threat = th;
      pState.inCombat = on; pState.threat = th;
      ctx.bus.emit('combat:state', pState);
    }
  }

  /** Hard target validity and the soft target. */
  function updateTargets() {
    const p = ctx.player;
    if (!p || !p.alive) {
      softTarget = 0;
      return;
    }
    if (hardTarget) {
      const t = ctx.ents.get(hardTarget);
      const far = t ? (t.pos.x - p.pos.x) * (t.pos.x - p.pos.x) + (t.pos.z - p.pos.z) * (t.pos.z - p.pos.z) > CB.hardLock.breakRange * CB.hardLock.breakRange : true;
      if (!t || !t.alive || far || (t.combat && t.combat.state === 'dead')) combat.setTarget(0);
    }
    const n = ctx.spatial.nearest(p.pos.x, p.pos.y + 1, p.pos.z, CB.softLock.oraRange, KIND_MASK.enemy | KIND_MASK.boss, hostileFilter);
    softTarget = n ? n.id : 0;
  }

  /** @param {any} ent @param {number} seconds @param {boolean} broken */
  function staggerEnt(ent, seconds, broken) {
    const c = ent.combat;
    if (!c || c.state === 'dead') return;
    if (BUSY.indexOf(c.state) >= 0) endTech(ent, true);
    if (c.guarding) setGuard(ent, false);
    if (c.gathering) setGather(ent, false);
    c.state = 'stagger';
    c.staggerT = Math.max(c.staggerT, seconds);
    recOf(ent).broken = broken;
    anim(ent, 'stagger');
    pStag.entId = ent.id; pStag.seconds = seconds; pStag.broken = broken;
    ctx.bus.emit('actor:staggered', pStag);
  }

  /** Apply a Knock to a target. */
  function knock(t, src, k, dirX, dirZ, amount) {
    if (!k || k.kind === 'none' || !t.move || !ctx.move || (t.tags & TAG.BOSS) !== 0) return;
    const sp = typeof k.speed === 'number' ? k.speed : 8;
    let vx = dirX * sp;
    let vy = 2;
    let vz = dirZ * sp;
    let hurtle = false;
    if (k.kind === 'launch') {
      vx = dirX * 2; vz = dirZ * 2; vy = typeof k.up === 'number' ? k.up : CB.knock.launchUp;
    } else if (k.kind === 'smash') {
      hurtle = sp >= CB.hurtle.minSpeed; vy = 3;
    } else if (k.kind === 'spike') {
      vx = dirX * 2; vz = dirZ * 2; vy = -sp; hurtle = true;
    } else if (k.kind === 'radial' && src) {
      const dx = t.pos.x - src.pos.x;
      const dz = t.pos.z - src.pos.z;
      const l = Math.sqrt(dx * dx + dz * dz) || 1;
      vx = (dx / l) * sp; vz = (dz / l) * sp; vy = 4;
    }
    if (isPlayer(t)) {
      vx *= 0.4; vz *= 0.4; vy = Math.min(vy, 3); hurtle = false;
    }
    ctx.move.knock(t, vx, vy, vz, { hurtle, stun: 0.35, sourceId: src ? src.id : 0, slamDamage: hurtle ? amount * CB.slam.damageFraction : 0 });
  }

  const combat = {
    /** @param {any} ent */
    initActor(ent) {
      if (!ent || !ent.stats) return;
      const cds = {};
      const keys = [];
      const techs = ctx.defs.all('technique');
      const ed = ent.kind === 'enemy' || ent.kind === 'boss' ? ctx.defs.find('enemy', ent.defId) : null;
      for (const t of techs) {
        if (ent.kind === 'player' ? t.user === 'player' : ed ? ed.techs.indexOf(t.id) >= 0 : false) {
          cds[t.id] = 0;
          keys.push(t.id);
        }
      }
      const surge = ent.kind === 'player' && ctx.store.state && ctx.store.state.player ? Number(ctx.store.state.player.surge) || 0 : 0;
      ent.combat = {
        state: 'idle', techId: null, techT: 0, targetId: 0, formId: null, surge: Math.max(0, Math.min(SURGE.max, surge)),
        guarding: false, gathering: false, invulnT: 0, staggerT: 0, burnoutT: 0, comboIndex: 0, inCombatT: 0, charge: 0, cooldowns: cds,
      };
      recs.delete(ent.id);
      const r = recOf(ent);
      r.cdKeys = keys;
      r.lastSurge = ent.combat.surge;
    },

    /** @param {any} ent @param {string} action @param {{ dirX?:number, dirZ?:number, targetId?:number }} [opts] */
    act(ent, action, opts) {
      if (!ent || !ent.combat || !ent.alive) return false;
      const c = ent.combat;
      const r = recOf(ent);
      if (!r.enabled) return false;
      const o = opts || DEFAULT_OPTS;
      switch (action) {
        case 'attack':
          if (c.techId === 'strike_string' && BUSY.indexOf(c.state) >= 0) {
            r.queued = true;
            return true;
          }
          return combat.useTechnique(ent, 'strike_string', o);
        case 'heavyStart':
          return useWith(ent, 'breaker', o, true);
        case 'heavyRelease':
        case 'techRelease':
          if (r.charging && r.def) {
            const ch = r.def.charge;
            r.charging = false;
            r.chargeMult = F.chargeMult(r.chargeT, ch.min, ch.max, ch.maxMult);
            return true;
          }
          return false;
        case 'bolt':
          return combat.useTechnique(ent, 'ora_bolt', o);
        case 'guardOn':
          if (!free(ent)) return false;
          setGuard(ent, true);
          return true;
        case 'guardOff':
          if (!c.guarding) return false;
          setGuard(ent, false);
          return true;
        case 'flicker': {
          const def = ctx.defs.find('technique', 'flicker_step');
          if (!def || !usable(ent, def) || BLOCKED_STATES.indexOf(c.state) >= 0) return false;
          if (BUSY.indexOf(c.state) >= 0) endTech(ent, true);
          if (c.guarding) setGuard(ent, false);
          if (c.gathering) setGather(ent, false);
          return start(ent, def, o);
        }
        case 'gatherOn':
          if (isPlayer(ent) && !ctx.rpg.hasTech('gather')) return false;
          if (r.gatherLock > 0 || !free(ent)) return false;
          setGather(ent, true);
          return true;
        case 'gatherOff':
          if (!c.gathering) return false;
          setGather(ent, false);
          return true;
        case 'tech1':
        case 'tech2':
        case 'ultimate': {
          if (!isPlayer(ent) || !ctx.rpg) return false;
          const sl = ctx.rpg.slots();
          const id = action === 'ultimate' ? sl.ultimate : sl.slots[action === 'tech1' ? 0 : 1];
          return id ? useWith(ent, id, o, true) : false;
        }
        case 'form': {
          if (c.formId) return combat.setForm(ent, null, {});
          const sel = ctx.rpg ? ctx.rpg.selectedForm || ctx.rpg.forms()[0] || null : null;
          return sel ? combat.setForm(ent, sel, {}) : false;
        }
        case 'revert':
          return c.formId ? combat.setForm(ent, null, {}) : false;
        default:
          return false;
      }
    },

    /** @param {any} ent @param {string} techId @param {{ targetId?:number, charge?:number, dirX?:number, dirZ?:number, force?:boolean, hold?:boolean }} [opts] */
    useTechnique(ent, techId, opts) {
      if (!ent || !ent.combat || !ent.stats || !ent.alive) return false;
      const def = ctx.defs.find('technique', techId);
      if (!def) return false;
      const o = opts || DEFAULT_OPTS;
      if (!o.force && (!usable(ent, def) || !free(ent))) return false;
      if (o.force) {
        if (ent.combat.state === 'dead') return false;
        if (BUSY.indexOf(ent.combat.state) >= 0) endTech(ent, true);
        if (ent.combat.guarding) setGuard(ent, false);
        if (ent.combat.gathering) setGather(ent, false);
      }
      return start(ent, def, o);
    },

    /** @param {any} ent @param {string} techId */
    canUse(ent, techId) {
      if (!ent || !ent.combat || !ent.alive) return false;
      const def = ctx.defs.find('technique', techId);
      if (!def || !usable(ent, def)) return false;
      const c = ent.combat;
      if (BLOCKED_STATES.indexOf(c.state) >= 0) return false;
      if (BUSY.indexOf(c.state) >= 0) {
        const r = recOf(ent);
        const tl = stepOf(r.def, r.step).timeline;
        return c.state === 'recover' && tl.cancelFrom >= 0 && r.phaseT >= tl.cancelFrom;
      }
      return true;
    },

    /** @param {any} ent @param {string} techId @returns {number} */
    cooldown(ent, techId) {
      return ent && ent.combat ? ent.combat.cooldowns[techId] || 0 : 0;
    },

    /** @param {any} ent */
    cancel(ent) {
      if (!ent || !ent.combat) return;
      if (BUSY.indexOf(ent.combat.state) >= 0) endTech(ent, true);
      if (ent.combat.guarding) setGuard(ent, false);
      if (ent.combat.gathering) setGather(ent, false);
    },

    /**
     * The only way HP is reduced.
     * @param {any} req DamageRequest @param {any} [out] DamageResult
     */
    damage(req, out) {
      const res = out || { applied: false, amount: 0, crit: false, blocked: false, perfect: false, killed: false, staggered: false };
      res.applied = false; res.amount = 0; res.crit = false; res.blocked = false; res.perfect = false; res.killed = false; res.staggered = false;
      const t = ctx.ents.get(req.targetId);
      if (!t || !t.alive || !t.stats || !t.combat || t.combat.state === 'dead') return res;
      if ((t.tags & TAG.INVULNERABLE) !== 0) return res;
      const src = req.sourceId ? ctx.ents.get(req.sourceId) : null;
      const tc = t.combat;
      const tr = recOf(t);
      const kind = req.kind || 'melee';
      if (tc.invulnT > 0) {
        if (isPlayer(t) && src && src.team === 2 && !tr.perfectUsed && (tc.techId === 'flicker_step' || tc.state === 'idle')) {
          tr.perfectUsed = true;
          pPerfect.entId = t.id; pPerfect.kind = 'flicker'; pPerfect.attackerId = src.id;
          ctx.bus.emit('combat:perfect', pPerfect);
          combat.addSurge(t, FLICK.perfect.surge);
          ctx.time.slowMo(FLICK.perfect.slowScale, FLICK.perfect.slowSeconds);
        }
        return res;
      }
      let dirX = typeof req.dirX === 'number' ? req.dirX : 0;
      let dirZ = typeof req.dirZ === 'number' ? req.dirZ : 0;
      if (dirX === 0 && dirZ === 0 && src) {
        const dx = t.pos.x - src.pos.x;
        const dz = t.pos.z - src.pos.z;
        const l = Math.sqrt(dx * dx + dz * dz) || 1;
        dirX = dx / l; dirZ = dz / l;
      }
      const tPlayer = isPlayer(t);
      const sPlayer = isPlayer(src);
      const mods = ctx.rpg ? ctx.rpg.mods() : null;
      // guard
      let blocked = false;
      let perfect = false;
      if (tc.guarding && !req.unblockable && kind !== 'true') {
        const fx = Math.sin(t.yaw);
        const fz = Math.cos(t.yaw);
        if (-(fx * dirX + fz * dirZ) >= Math.cos((GUARD.arcDeg * Math.PI) / 360)) {
          blocked = true;
          const diff = F.difficultyRow(ctx.rpg ? ctx.rpg.difficulty : 'warrior');
          perfect = ctx.time.now - tr.guardStart <= GUARD.perfect.window * diff.perfectWindow;
        }
      }
      let amount;
      let crit = false;
      if (kind === 'true') {
        amount = Math.max(1, Math.round(req.power));
      } else {
        const ss = src ? src.stats : null;
        const rating = typeof req.rating === 'number' ? req.rating : ss ? (kind === 'ora' ? ss.oraRating : ss.meleeRating) : 20;
        let dmgMult = ss ? ss.dmgMult : 1;
        if (sPlayer && mods) dmgMult *= 1 + F.mod(mods, kind === 'ora' ? 'oraPct' : 'meleePct');
        if (tr.broken) dmgMult *= CB.poise.brokenDamageMult;
        if (tPlayer && tc.gathering && mods) dmgMult *= F.mod(mods, 'gatherDmgTakenMult');
        const cc = ss && req.canCrit !== false ? ss.critChance : 0;
        crit = cc > 0 && ctx.rng.sim.next() < cc;
        const roll = ctx.rng.sim.range(BALANCE.damage.roll[0], BALANCE.damage.roll[1]);
        const diffMult = src && src.team === 2 && tPlayer ? F.difficultyRow(ctx.rpg ? ctx.rpg.difficulty : 'warrior').enemyDmg : 1;
        let power = req.power;
        const ed = t.kind === 'enemy' ? ctx.defs.find('enemy', t.defId) : null;
        if (ed && ed.frontGuard && src) {
          const fx = Math.sin(t.yaw);
          const fz = Math.cos(t.yaw);
          if (-(fx * dirX + fz * dirZ) >= Math.cos((ed.frontGuard.angleDeg * Math.PI) / 360)) power *= ed.frontGuard.damageMult;
        }
        amount = F.damage(power, rating, t.stats.defense, dmgMult, t.stats.defMult, crit ? BALANCE.derived.crit.mult : 1, roll, diffMult);
      }
      if (blocked) {
        amount = perfect ? 0 : Math.max(1, Math.round(amount * GUARD.blockedMult));
        combat.addOra(t, -GUARD.oraPerBlock);
      }
      const st = t.stats;
      st.hp = Math.max(0, st.hp - amount);
      tc.inCombatT = CB.inCombatSeconds;
      if (src && src.combat) src.combat.inCombatT = CB.inCombatSeconds;
      if (tc.gathering && amount > 0) {
        setGather(t, false);
        tr.gatherLock = BALANCE.tech.gather.interruptLockout;
      }
      if (sPlayer && amount > 0 && !blocked) {
        combat.addSurge(src, (kind === 'ora' ? SURGE.oraHit : SURGE.meleeHit) * (1 + F.mod(mods, 'surgePct')));
      }
      if (tPlayer && amount > 0 && st.hpMax > 0) {
        combat.addSurge(t, ((amount / st.hpMax) / SURGE.hpLoss.perPct) * SURGE.hpLoss.gain);
      }
      let broken = false;
      const poiseDmg = (req.poise || 0) * (sPlayer ? 1 + F.mod(mods, 'poisePct') : 1);
      if (st.poiseMax > 0 && poiseDmg > 0 && !blocked && !tr.broken) {
        st.poise = Math.max(0, st.poise - poiseDmg);
        tr.poiseIdle = 0;
        if (st.poise <= 0) broken = true;
      }
      const killed = st.hp <= 0;
      if (!killed && !blocked && req.knock) knock(t, src, req.knock, dirX, dirZ, amount);
      res.applied = true; res.amount = amount; res.crit = crit; res.blocked = blocked; res.perfect = perfect; res.killed = killed;
      res.staggered = broken && !killed;
      pDamaged.targetId = t.id; pDamaged.sourceId = req.sourceId || 0; pDamaged.amount = amount; pDamaged.crit = crit; pDamaged.blocked = blocked;
      pDamaged.perfect = perfect; pDamaged.techId = req.techId || null; pDamaged.kind = kind;
      pDamaged.x = typeof req.x === 'number' ? req.x : t.pos.x; pDamaged.y = typeof req.y === 'number' ? req.y : t.pos.y + t.height * 0.6;
      pDamaged.z = typeof req.z === 'number' ? req.z : t.pos.z; pDamaged.hpAfter = st.hp;
      ctx.bus.emit('actor:damaged', pDamaged);
      pHit.attackerId = req.sourceId || 0; pHit.targetId = t.id; pHit.techId = req.techId || null;
      pHit.class = req.feel || (amount >= st.hpMax * 0.15 ? 'heavyHit' : 'lightHit'); pHit.amount = amount;
      pHit.x = pDamaged.x; pHit.y = pDamaged.y; pHit.z = pDamaged.z; pHit.dirX = dirX; pHit.dirZ = dirZ;
      pHit.blocked = blocked; pHit.perfect = perfect; pHit.crit = crit;
      ctx.bus.emit('combat:hit', pHit);
      if (perfect) {
        pPerfect.entId = t.id; pPerfect.kind = 'guard'; pPerfect.attackerId = src ? src.id : 0;
        ctx.bus.emit('combat:perfect', pPerfect);
        combat.addSurge(t, GUARD.perfect.surge);
        if (src && src.combat) staggerEnt(src, GUARD.perfect.attackerStagger * (tPlayer ? F.mod(mods, 'perfectStaggerMult') : 1), false);
      }
      if (broken && !killed && !tPlayer) {
        staggerEnt(t, (t.tags & TAG.BOSS) !== 0 ? CB.poise.bossBreakStagger : CB.poise.breakStagger, true);
      }
      if (killed) combat.kill(t, req.sourceId || 0);
      return res;
    },

    /** @param {any} ent @param {number} amount */
    heal(ent, amount) {
      if (!ent || !ent.stats) return;
      const st = ent.stats;
      const before = st.hp;
      st.hp = Math.max(0, Math.min(st.hpMax, st.hp + Math.max(0, amount || 0)));
      if (st.hp > before) {
        pHealed.entId = ent.id; pHealed.amount = st.hp - before;
        ctx.bus.emit('actor:healed', pHealed);
      }
    },

    /** @param {any} ent @param {number} amount */
    addOra(ent, amount) {
      if (!ent || !ent.stats) return;
      const st = ent.stats;
      st.ora = Math.max(0, Math.min(st.oraMax, st.ora + (amount || 0)));
    },

    /** @param {any} ent @param {number} amount */
    addSurge(ent, amount) {
      if (!ent || !ent.combat) return;
      const c = ent.combat;
      c.surge = Math.max(0, Math.min(SURGE.max, c.surge + (amount || 0)));
      const r = recOf(ent);
      if (amount > 0) r.surgeIdle = 0;
      surgeEvent(ent, r);
    },

    /** @param {any} ent @param {number} seconds */
    setInvulnerable(ent, seconds) {
      if (ent && ent.combat) ent.combat.invulnT = Math.max(0, seconds);
    },

    /** @param {any} ent @param {number} seconds */
    stagger(ent, seconds) {
      if (ent && ent.combat) staggerEnt(ent, seconds, false);
    },

    /** @param {any} ent @param {number} [sourceId=0] */
    kill(ent, sourceId = 0) {
      if (!ent || !ent.combat || ent.combat.state === 'dead') return;
      const c = ent.combat;
      if (BUSY.indexOf(c.state) >= 0) endTech(ent, true);
      if (c.guarding) setGuard(ent, false);
      if (c.gathering) setGather(ent, false);
      if (c.formId) combat.setForm(ent, null, { instant: true });
      if (ent.stats) ent.stats.hp = 0;
      c.state = 'dead';
      c.staggerT = 0;
      ent.alive = false;
      if (ent.intent) { ent.intent.mx = 0; ent.intent.mz = 0; ent.intent.up = 0; }
      anim(ent, 'death');
      if (hardTarget === ent.id) combat.setTarget(0);
      pDied.entId = ent.id; pDied.sourceId = sourceId; pDied.kind = ent.kind; pDied.defId = ent.defId; pDied.level = ent.level;
      pDied.questTag = ent.questTag; pDied.x = ent.pos.x; pDied.y = ent.pos.y; pDied.z = ent.pos.z;
      ctx.bus.emit('actor:died', pDied);
      if (isPlayer(ent)) {
        const boss = ctx.ai ? ctx.ai.boss : null;
        pPDied.x = ent.pos.x; pPDied.y = ent.pos.y; pPDied.z = ent.pos.z; pPDied.bossId = boss ? boss.defId : null;
        ctx.bus.emit('player:died', pPDied);
        updateCombatState();
      }
    },

    /** @param {any} ent @param {number} [hpFraction=1] */
    revive(ent, hpFraction = 1) {
      if (!ent || !ent.combat || !ent.stats) return;
      const c = ent.combat;
      ent.alive = true;
      c.state = 'idle';
      c.techId = null;
      c.staggerT = 0;
      c.inCombatT = 0;
      c.invulnT = BALANCE.death.respawnInvulnerable;
      recOf(ent).def = null;
      ent.stats.hp = 0;
      combat.heal(ent, Math.max(1, Math.round(ent.stats.hpMax * hpFraction)));
      combat.addOra(ent, ent.stats.oraMax);
      anim(ent, 'getup');
    },

    /** @param {any} ent @param {string|null} formId @param {{ instant?:boolean, free?:boolean, scripted?:boolean }} [opts] */
    setForm(ent, formId, opts) {
      if (!ent || !ent.combat) return false;
      const o = opts || DEFAULT_OPTS;
      const c = ent.combat;
      const prev = c.formId;
      if (formId === prev) return false;
      if (formId) {
        const f = ctx.defs.find('form', formId);
        if (!f) return false;
        if (!o.free && !o.scripted) {
          if (c.state === 'dead' || c.burnoutT > 0) return false;
          if (isPlayer(ent) && ctx.rpg && ctx.rpg.forms().indexOf(formId) < 0) return false;
          if (f.unlock && f.unlock.scripted) return false;
          if (ent.stats.ora < f.cost) return false;
          if (!free(ent)) return false;
          combat.addOra(ent, -f.cost);
        }
        if (!o.instant) {
          if (BUSY.indexOf(c.state) >= 0) endTech(ent, true);
          const short = ctx.save && ctx.save.settings && ctx.save.settings.shortTransform;
          c.state = 'transform';
          c.staggerT = short ? f.transform.shortSeconds : f.transform.seconds;
          c.invulnT = Math.max(c.invulnT, c.staggerT);
          anim(ent, 'transform');
          if (ctx.vfx) ctx.vfx.shockwave(ent.pos.x, ent.pos.y, ent.pos.z, { radius: f.transform.shockRadius, color: f.color, seconds: 0.4 });
        }
      }
      c.formId = formId || null;
      const first = !!formId && !seenForms.has(formId);
      if (formId) seenForms.add(formId);
      pForm.entId = ent.id; pForm.formId = c.formId; pForm.prevFormId = prev; pForm.first = first;
      ctx.bus.emit('combat:form', pForm);
      return true;
    },

    /** @param {any} ent @param {'white'|'red'|'violet'} kind @param {number} seconds @param {object} [opts] */
    telegraph(ent, kind, seconds, opts) {
      if (!ent) return;
      const o = /** @type {any} */ (opts || DEFAULT_OPTS);
      pTele.entId = ent.id; pTele.kind = kind; pTele.seconds = seconds; pTele.shape = o.shape || 'self'; pTele.radius = o.radius || 0;
      pTele.x = typeof o.x === 'number' ? o.x : ent.pos.x; pTele.y = typeof o.y === 'number' ? o.y : ent.pos.y; pTele.z = typeof o.z === 'number' ? o.z : ent.pos.z;
      pTele.dirX = typeof o.dirX === 'number' ? o.dirX : Math.sin(ent.yaw); pTele.dirZ = typeof o.dirZ === 'number' ? o.dirZ : Math.cos(ent.yaw);
      ctx.bus.emit('combat:telegraph', pTele);
    },

    /** @returns {number} hard-lock target id or 0 */
    target() {
      return hardTarget;
    },

    /** @returns {number} soft target id or 0 */
    softTarget() {
      return softTarget;
    },

    /** @param {number} entId 0 releases */
    setTarget(entId) {
      let id = entId || 0;
      if (id) {
        const t = ctx.ents.get(id);
        if (!t || !t.alive || (t.tags & TAG.NO_LOCK) !== 0 || !t.combat) id = 0;
      }
      if (id === hardTarget) return;
      hardTarget = id;
      pLock.entId = ctx.player ? ctx.player.id : 0; pLock.targetId = id;
      ctx.bus.emit('combat:lock', pLock);
    },

    /** @param {number} dir +1 | -1 */
    cycleTarget(dir) {
      const p = ctx.player;
      if (!p) return;
      const range2 = CB.hardLock.breakRange * CB.hardLock.breakRange;
      const cur = hardTarget || softTarget;
      let best = null;
      let wrap = null;
      for (const kind of ['enemy', 'boss']) {
        const list = ctx.ents.list(kind);
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          if (!hostileFilter(e)) continue;
          const dx = e.pos.x - p.pos.x;
          const dz = e.pos.z - p.pos.z;
          if (dx * dx + dz * dz > range2) continue;
          if (dir >= 0) {
            if (e.id > cur && (!best || e.id < best.id)) best = e;
            if (!wrap || e.id < wrap.id) wrap = e;
          } else {
            if (e.id < cur && (!best || e.id > best.id)) best = e;
            if (!wrap || e.id > wrap.id) wrap = e;
          }
        }
      }
      const pick = best || wrap;
      if (pick) combat.setTarget(pick.id);
    },

    /** @param {number} cssX @param {number} cssY @returns {number} */
    pickAtScreen(cssX, cssY) {
      const render = ctx.render;
      if (!render || !render.project) return 0;
      const pt = { x: 0, y: 0, visible: false, depth: 0 };
      let best = 0;
      let bestD = 60 * 60;
      for (const kind of ['enemy', 'boss']) {
        for (const e of ctx.ents.list(kind)) {
          if (!hostileFilter(e)) continue;
          render.project(e.pos.x, e.pos.y + e.height * 0.5, e.pos.z, pt);
          if (!pt.visible) continue;
          const d = (pt.x - cssX) * (pt.x - cssX) + (pt.y - cssY) * (pt.y - cssY);
          if (d < bestD) { bestD = d; best = e.id; }
        }
      }
      if (best) combat.setTarget(best);
      return best;
    },

    get inCombat() {
      return inCombat;
    },

    get threat() {
      return threat;
    },

    /** @param {string} id @param {Function} fn */
    registerScript(id, fn) {
      if (typeof fn === 'function') scripts.set(id, fn);
    },

    /** @param {any} ent @param {boolean} enabled */
    setEnabled(ent, enabled) {
      if (!ent || !ent.combat) return;
      const r = recOf(ent);
      r.enabled = !!enabled;
      if (!enabled) combat.cancel(ent);
    },

    /** Remove the stand-in projectiles and private state. */
    dispose() {
      const list = ctx.ents.list('projectile');
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.alive && e.data && e.data.standinShot) removeShot(e, false, e.pos.x, e.pos.y, e.pos.z);
      }
      reset();
    },
  };

  /** Variant of useTechnique that holds charge-capable techniques. */
  function useWith(ent, techId, o, hold) {
    const def = ctx.defs.find('technique', techId);
    if (!def) return false;
    if (!usable(ent, def) || !free(ent)) return false;
    HOLD.targetId = o.targetId; HOLD.dirX = o.dirX; HOLD.dirZ = o.dirZ; HOLD.hold = hold && !!def.charge;
    return start(ent, def, HOLD);
  }
  const HOLD = { targetId: undefined, dirX: undefined, dirZ: undefined, hold: false };

  /** Run the registered script of a technique each tick it runs. */
  function runScript(ent, r) {
    const def = r.def;
    if (!def || !def.script) return;
    const fn = scripts.get(def.script);
    if (fn) fn(ctx, ent, def, ent.combat);
  }

  function reset() {
    recs.clear();
    hardTarget = 0;
    softTarget = 0;
    inCombat = false;
    threat = 0;
    seenForms.clear();
  }

  const runSystem = {
    id: 'standin.combat.run',
    phase: 'combat',
    owner: OWNER,
    /** @param {any} c @param {number} dt */
    step(c, dt) {
      const list = c.ents.all();
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.combat === null || e.stats === null || e.combat.state === 'dead' || !e.alive) continue;
        const r = recOf(e);
        upkeep(e, r, dt);
        if (BUSY.indexOf(e.combat.state) >= 0) {
          runScript(e, r);
          runTech(e, r, dt);
        }
      }
      runShots(dt);
      updateTargets();
      updateCombatState();
    },
  };

  /** Player driver: input actions -> combat.act (4.9 rules). */
  const AO = { dirX: 0, dirZ: 0, targetId: undefined };
  let breakerHeld = false;
  const playerSystem = {
    id: 'standin.combat.player',
    phase: 'intent',
    order: 10,
    owner: OWNER,
    /** @param {any} c */
    step(c) {
      const p = c.player;
      if (!p || !p.alive || !p.combat) return;
      const inp = c.input;
      AO.dirX = 0; AO.dirZ = 0; AO.targetId = undefined;
      if (inp.pressed('lock')) combat.setTarget(hardTarget ? 0 : softTarget);
      if (inp.pressed('lockNext')) combat.cycleTarget(1);
      if (inp.pressed('lockPrev')) combat.cycleTarget(-1);
      if (inp.pressed('attack')) combat.act(p, 'attack', AO);
      if (inp.down('attack') && !breakerHeld && inp.heldTime('attack') >= BREAKER_HOLD && p.combat.techId !== 'breaker') {
        breakerHeld = true;
        if (p.combat.techId === 'strike_string') endTech(p, true);
        combat.act(p, 'heavyStart', AO);
      }
      if (breakerHeld && !inp.down('attack')) {
        breakerHeld = false;
        combat.act(p, 'heavyRelease', AO);
      }
      if (inp.pressed('bolt') || (inp.down('bolt') && p.combat.state === 'idle')) combat.act(p, 'bolt', AO);
      if (inp.pressed('guard')) combat.act(p, 'guardOn', AO);
      if (inp.released('guard')) combat.act(p, 'guardOff', AO);
      if (inp.pressed('dash')) {
        const it = p.intent;
        let dx = it ? it.mx : 0;
        let dz = it ? it.mz : 0;
        if (dx * dx + dz * dz < 0.01) { dx = -Math.sin(p.yaw); dz = -Math.cos(p.yaw); }
        AO.dirX = dx; AO.dirZ = dz;
        combat.act(p, 'flicker', AO);
        AO.dirX = 0; AO.dirZ = 0;
      }
      if (inp.pressed('gather')) combat.act(p, 'gatherOn', AO);
      if (inp.released('gather')) combat.act(p, 'gatherOff', AO);
      if (inp.pressed('tech1')) combat.act(p, 'tech1', AO);
      if (inp.pressed('tech2')) combat.act(p, 'tech2', AO);
      if (inp.released('tech1') || inp.released('tech2')) combat.act(p, 'techRelease', AO);
      if (inp.pressed('ultimate')) combat.act(p, 'ultimate', AO);
      if (inp.pressed('form')) combat.act(p, 'form', AO);
    },
  };

  const on = {
    /** actor:slam: slam damage, Surge, props and crater. @param {any} e */
    slam(e) {
      const t = ctx.ents.get(e.entId);
      if (t && t.alive && e.damage > 0) {
        REQ.sourceId = e.sourceId; REQ.targetId = e.entId; REQ.techId = null; REQ.power = e.damage; REQ.kind = 'true'; REQ.rating = undefined;
        REQ.poise = 0; REQ.knock = null; REQ.dirX = 0; REQ.dirZ = 0; REQ.unblockable = true; REQ.canCrit = false; REQ.feel = 'wallSlam';
        REQ.x = e.x; REQ.y = e.y; REQ.z = e.z;
        combat.damage(REQ, RES);
      }
      const src = e.sourceId ? ctx.ents.get(e.sourceId) : null;
      if (src && isPlayer(src)) combat.addSurge(src, SURGE.wallSlam);
      const w = ctx.world;
      if (w) {
        const radius = Math.min(CB.crater.deformRadius, Math.max(1.5, e.speed / 8));
        w.damageProps(e.x, e.y, e.z, radius, e.damage, e.sourceId);
        w.crater(e.x, e.z, radius, radius * CB.crater.maxDepthFraction * 0.5, e.sourceId);
      }
    },
    /** @param {any} e */
    removed(e) {
      recs.delete(e.entId);
      if (hardTarget === e.entId) combat.setTarget(0);
      if (softTarget === e.entId) softTarget = 0;
    },
    ended() {
      reset();
      breakerHeld = false;
    },
  };

  return { combat, runSystem, playerSystem, on };
}

/**
 * Install the stand-in combat service under the owner 'standin:combat'.
 * @param {any} ctx
 */
export function install(ctx) {
  const { combat, runSystem, playerSystem, on } = createCombat(ctx);
  ctx.provide('combat', combat, OWNER);
  ctx.systems.add(playerSystem);
  ctx.systems.add(runSystem);
  ctx.bus.on('actor:slam', on.slam, OWNER);
  ctx.bus.on('actor:removed', on.removed, OWNER);
  ctx.bus.on('game:ended', on.ended, OWNER);
}
