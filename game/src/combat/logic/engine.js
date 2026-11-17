/**
 * The combat engine (ARCHITECTURE 4.9, 5.1, 5.2; GDD 5-6): the `ctx.combat` service and its two sim systems.
 * Technique timelines run from data (windup, active, recover, chains, hold-to-charge, motions, timed hit shapes,
 * projectiles, beams, scripts, cancels, cooldowns, costs, rank mods); `damage` is the only way HP falls (guard,
 * perfect guard, invulnerability, poise and Break, crits, knock classes, juggles, burns, Second Breath, kill and
 * death events in the documented order); Forms (transform sequence, drains, Burnout, scripted Zenith); Surge;
 * soft and hard lock; slam handling; telegraphs; inCombat and threat; boost cost and regen rules.
 *
 * Pure logic: no three, no window. Every service is read from `ctx` at call time, so Node tests run the whole
 * engine against a fake context. Step paths allocate nothing (pooled payloads, scratch objects, typed arrays).
 * @module combat/logic/engine
 */

import { BALANCE } from '../../core/balance.js';
import * as F from '../../core/formulas.js';
import { PALETTE } from '../../core/palette.js';
import { resolveRank } from './rank.js';
import {
  TAG, KIND_MASK, frontal, isPerfectGuard, isPerfectFlicker, hitAmount, surgeForHit, surgeForHpLoss, surgeDecay,
  knockVelocity, softScore, relAngle, sweepCapsuleT, nearCollider, falloffPower,
} from './rules.js';

const CB = BALANCE.combat;
const SURGE = BALANCE.surge;
const GUARD = BALANCE.tech.guard;
const FLICK = BALANCE.tech.flicker_step;
const BOOST = BALANCE.tech.boost;
const GATHER = BALANCE.tech.gather;
const FORM_RULES = BALANCE.formRules;
const STRING = BALANCE.tech.strike_string;
const BREAKER = BALANCE.tech.breaker;
const PURSUIT = BALANCE.tech.pursuit;
const MAX_HITS = 8;
const MAX_SHOTS = 4;
const OUT_MAX = 64;
/** Seconds after the last string hit during which Breaker still counts the string (smash rule). */
const STRING_GRACE = 0.7;
/** Seconds an air-string hit or a Pursuit arrival keeps the player hanging with the juggled target. */
const AIR_HANG_SECONDS = 0.9;
/** Seconds between two hits that keep the combo counter running. */
const COMBO_WINDOW = 2.0;
/** Ticks between line-of-sight checks of the hard lock. */
const LOS_EVERY = 6;
/** Seconds the player is staggered by a red or violet attack (GDD 6.4). */
const RED_STAGGER = 0.6;
/** Radius around the player in which hostiles count for threat. */
const THREAT_RANGE = 60;

/** @param {string} s */
const isBusy = (s) => s === 'windup' || s === 'active' || s === 'recover';
/** @param {string} s */
const isBlocked = (s) => s === 'dead' || s === 'stagger' || s === 'down' || s === 'transform' || s === 'scripted';

/**
 * @typedef {object} Rec  Private runtime of one combatant (the engine's side of ent.combat).
 */

/**
 * Create the combat engine.
 * @param {any} ctx
 * @returns {{ combat:any, runSystem:any, playerSystem:any, on:any, recList:any[], recOf:(ent:any)=>any, reset:()=>void }}
 */
export function createCombatEngine(ctx) {
  /** @type {Map<number, any>} */
  const recs = new Map();
  /** Live recs in creation order (for the visual system); entries are removed on actor:removed and reset. */
  /** @type {any[]} */
  const recList = [];
  /** @type {Map<string, Function>} */
  const scripts = new Map();
  /** @type {any[]} */
  const OUT = [];
  /** @type {any[]} */
  const OUT2 = [];
  /** @type {any[]} */
  const COLS = [];
  /** Projectile data pool. @type {any[]} */
  const shotPool = [];
  /** Resolved (rank-applied) player technique defs: techId -> { base, rank, def }. */
  /** @type {Map<string, any>} */
  const resolved = new Map();
  /** Rank-1 resolutions of non-player chain techniques, keyed by the base def. @type {Map<any, any>} */
  const chained = new Map();
  /** Forms transformed into this session (the first time plays the long sequence). */
  const seenForms = new Set();
  const st = { hardTarget: 0, softMelee: 0, softOra: 0, inCombat: false, threat: 0, tick: 0, losLost: 0, comboCount: 0, comboT: 0 };

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
  const pCombo = { count: 0 };
  const pShotOn = { entId: 0, fxId: 'bolt', ownerId: 0, color: 0 };
  const pShotOff = { entId: 0, fxId: 'bolt', hit: false, x: 0, y: 0, z: 0 };
  /** Internal damage request (fields beyond DamageRequest: staggerPlayer, juggle, burn, slamFraction). */
  const REQ = {
    sourceId: 0, targetId: 0, techId: null, power: 0, kind: 'melee', rating: undefined, poise: 0, knock: null, dirX: 0, dirZ: 0,
    x: undefined, y: undefined, z: undefined, unblockable: false, canCrit: true, feel: 'lightHit',
    staggerPlayer: false, juggle: false, burn: null, rx: 0, rz: 0,
  };
  const RES = { applied: false, amount: 0, crit: false, blocked: false, perfect: false, killed: false, staggered: false };
  const HIT = { power: 0, rating: 0, defense: 0, dmgMult: 1, defMult: 1, crit: false, roll: 1, difficultyMult: 1, kind: 'melee', blocked: false, perfect: false };
  const KV = { vx: 0, vy: 0, vz: 0, hurtle: false, gravityScale: 1, stun: 0.3 };
  const WHO = { boss: false, player: false };
  const KNOCK_OPTS = { hurtle: false, stun: 0.3, gravityScale: 1, sourceId: 0, slamDamage: 0 };
  const LOCK_OPTS = { slow: 0, noTurn: false };
  const SMASH = { kind: 'smash', speed: BREAKER.smash.speed };
  const JUGGLE = { kind: 'launch', up: 3.2 };
  const SHOCK = { radius: 8, seconds: 0.35, color: PALETTE.ora, ground: true, sphere: false };
  const BURST = { dirX: 0, dirY: 1, dirZ: 0, color: PALETTE.ora, scale: 1, count: undefined };
  const SWEEP = { hit: false, t: 1, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, kind: null, colliderId: 0, propKey: 0 };
  const REGEN = { inCombat: false, inSiphonZone: false, boosting: false, inForm: false, burnout: false };
  const PLAY_HOLD = { speed: 1, loop: false, layer: 'full', blend: 0.06, hold: true };
  const PLAY_ONCE = { speed: 1, loop: false, layer: 'full', blend: 0.06, hold: false };
  const DEFAULT_OPTS = Object.freeze({});
  const HOLD = { targetId: undefined, dirX: undefined, dirZ: undefined, hold: false, charge: undefined, force: false };

  const isPlayer = (e) => e !== null && e !== undefined && e === ctx.player;
  /** @param {any} e */
  function hostileOk(e) {
    return e.alive && e.team === 2 && (e.tags & TAG.NO_LOCK) === 0 && e.combat !== null && e.combat.state !== 'dead';
  }
  const hostileFilter = hostileOk;

  function difficulty() {
    return F.difficultyRow(ctx.rpg ? ctx.rpg.difficulty : 'warrior');
  }
  function mods() {
    return ctx.rpg ? ctx.rpg.mods() : null;
  }

  /** @param {any} ent @returns {any} */
  function recOf(ent) {
    let r = recs.get(ent.id);
    if (r && r.ent === ent) return r;
    if (r) removeRec(ent.id);
    r = {
      ent, id: ent.id, def: null, step: 0, phaseT: 0, prevPhaseT: 0, techT: 0, windupExtra: 0, entered: false,
      hitDone: new Uint8Array(MAX_HITS), hitNext: new Float64Array(MAX_HITS), shotDone: new Uint8Array(MAX_SHOTS), shotNext: new Float64Array(MAX_SHOTS),
      beamNext: 0, beamOn: false, beamAX: 0, beamAY: 0, beamAZ: 0, beamBX: 0, beamBY: 0, beamBZ: 0, beamRadius: 0, beamColor: PALETTE.ora,
      motionDone: false, queued: false, charging: false, chargeT: 0, chargeMult: 1, chargeEmitT: 0, dirX: 0, dirZ: 1,
      enabled: true, guardStart: -10, gatherLock: 0, gatherT: 0, poiseIdle: 0, broken: false, surgeIdle: 0, lastSurge: 0, boostBlocked: false,
      perfectUsed: false, flickerStart: -10, flickX: 0, flickY: 0, flickZ: 0, cdKeys: [], stringHits: 0, stringT: 0, pursuitId: 0, pursuitT: 0, pursuitBonus: 0,
      juggleT: 0, burnT: 0, burnNext: 0, burnEvery: 0.5, burnPower: 0, burnSrc: 0, craterDone: false, formScripted: false, transformT: 0,
      transformLong: false, secondBreathT: 0, slamFraction: 0, scrX: 0, scrY: 0, scrZ: 0, scrFlag: 0, lastHitBy: 0,
    };
    recs.set(ent.id, r);
    recList.push(r);
    return r;
  }

  /** @param {number} id */
  function removeRec(id) {
    const r = recs.get(id);
    if (!r) return;
    recs.delete(id);
    const i = recList.indexOf(r);
    if (i >= 0) recList.splice(i, 1);
  }

  /** Effective (rank-applied) definition of a technique for `ent`. @returns {any} */
  function defOf(ent, techId) {
    const base = ctx.defs.find('technique', techId);
    if (!base) return null;
    if (!isPlayer(ent) || base.user !== 'player') {
      if (!base.chain) return base;
      // Chains need chainSteps: resolve once per base object.
      let d = chained.get(base);
      if (!d) {
        d = resolveRank(base, 1);
        chained.set(base, d);
      }
      return d;
    }
    const rank = ctx.rpg ? Math.max(1, ctx.rpg.rank(techId) || 1) : 1;
    let e = resolved.get(techId);
    if (e && e.base === base && e.rank === rank) return e.def;
    e = { base, rank, def: resolveRank(base, rank) };
    resolved.set(techId, e);
    return e.def;
  }

  /** Can an attacker of `team` (entity `att`) hit `t`? */
  function canHit(att, team, t) {
    if (!t || t === att || !t.alive || !t.stats || !t.combat || t.combat.state === 'dead') return false;
    if (team === 1) return t.team === 2 || (t.kind === 'object' && t.team !== 1);
    if (team === 2) return t.team === 1;
    return false;
  }

  /** @param {any} def @param {number} step */
  function stepOf(def, step) {
    return def.chain && def.chain[step] ? def.chain[step] : def;
  }

  /** @param {any} ent @param {string|undefined} clip @param {boolean} [hold] */
  function anim(ent, clip, hold) {
    const a = ctx.actors;
    if (clip && a) a.play(ent, clip, hold ? PLAY_HOLD : PLAY_ONCE);
  }

  /** @param {any} ent @returns {boolean} */
  function airborne(ent) {
    const m = ent.move;
    if (!m) return false;
    return m.mode === 'fly' || ((m.mode === 'air' || m.mode === 'hurtle') && !m.grounded);
  }

  /** Ora colour of an entity (the Form colour while transformed). */
  function oraColor(ent) {
    if (ent.team === 2) {
      const ed = ctx.defs.find('enemy', ent.defId);
      return ed && typeof ed.oraColor === 'number' ? ed.oraColor : PALETTE.hostile;
    }
    const fid = ent.combat ? ent.combat.formId : null;
    if (fid) {
      const f = ctx.defs.find('form', fid);
      if (f) return f.color;
    }
    return PALETTE.ora;
  }

  /** Aim direction toward the target (or the given direction, or forward) into r.dirX / r.dirZ. */
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
    r.beamOn = false;
    r.motionDone = false;
    r.phaseT = 0;
    r.prevPhaseT = 0;
    r.techT = 0;
    r.windupExtra = 0;
    r.queued = false;
    r.craterDone = false;
    r.entered = true;
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
    if (isBusy(c.state)) c.state = 'idle';
    c.techId = null;
    c.techT = 0;
    c.charge = 0;
    r.def = null;
    r.charging = false;
    r.queued = false;
    r.beamOn = false;
    if (cancelled || !isPlayer(ent)) releaseLock(ent);
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
      anim(ent, 'guard', true);
    } else if (c.state === 'guard') {
      c.state = 'idle';
      anim(ent, 'idle', false);
    }
    if (!on) releaseLock(ent);
    pGuard.entId = ent.id; pGuard.on = on;
    ctx.bus.emit('combat:guard', pGuard);
  }

  function setGather(ent, on) {
    const c = ent.combat;
    if (c.gathering === on) return;
    c.gathering = on;
    const r = recOf(ent);
    if (on) {
      c.state = 'gather';
      r.gatherT = 0;
      anim(ent, 'gather', true);
    } else if (c.state === 'gather') {
      c.state = 'idle';
      anim(ent, 'idle', false);
    }
    if (!on) releaseLock(ent);
    pGather.entId = ent.id; pGather.on = on;
    ctx.bus.emit('combat:gather', pGather);
  }

  /** Clear a movement lock set for a hold (guard, gather). */
  function releaseLock(ent) {
    if (!ent.move || !ctx.move) return;
    LOCK_OPTS.slow = 1;
    ctx.move.lock(ent, 0, LOCK_OPTS);
  }

  /** May the running technique be cancelled into another action now? */
  function cancellable(ent, r) {
    const c = ent.combat;
    if (!r.def) return true;
    const tl = stepOf(r.def, r.step).timeline;
    return c.state === 'recover' && tl.cancelFrom >= 0 && r.phaseT >= tl.cancelFrom;
  }

  /** Stop guard, gather or a cancellable technique so a new action can start. @returns {boolean} free */
  function free(ent) {
    const c = ent.combat;
    if (isBlocked(c.state)) return false;
    if (c.state === 'guard') setGuard(ent, false);
    if (c.state === 'gather') setGather(ent, false);
    if (isBusy(c.state)) {
      const r = recOf(ent);
      if (cancellable(ent, r)) endTech(ent, true);
      else return false;
    }
    return true;
  }

  function costMult(ent, techId) {
    return techId === 'flicker_step' && isPlayer(ent) ? F.mod(mods(), 'flickerCostMult') : 1;
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
    const fly = airborne(ent);
    if (fly && def.move && def.move.air === false) return false;
    if (!fly && def.move && def.move.ground === false) return false;
    return true;
  }

  /** Telegraph from technique data. */
  function telegraphFrom(ent, r, def, seconds) {
    const tg = def.telegraph;
    if (!tg) return;
    const t = tg.atTarget && ent.combat.targetId ? ctx.ents.get(ent.combat.targetId) : null;
    TELE_OPTS.shape = tg.shape; TELE_OPTS.radius = tg.radius || 0;
    TELE_OPTS.x = t ? t.pos.x : ent.pos.x; TELE_OPTS.y = t ? t.pos.y : ent.pos.y; TELE_OPTS.z = t ? t.pos.z : ent.pos.z;
    TELE_OPTS.dirX = r.dirX; TELE_OPTS.dirZ = r.dirZ;
    combat.telegraph(ent, tg.kind, seconds, TELE_OPTS);
  }
  const TELE_OPTS = { shape: 'self', radius: 0, x: 0, y: 0, z: 0, dirX: 0, dirZ: 1 };

  /** The soft target for a technique rating. */
  function softFor(rating) {
    return rating === 'ora' ? st.softOra || st.softMelee : st.softMelee || st.softOra;
  }

  /** Start technique `def` (state already checked and freed). */
  function start(ent, def, opts) {
    const c = ent.combat;
    const r = recOf(ent);
    const o = opts || DEFAULT_OPTS;
    const stt = ent.stats;
    const ora = def.cost.ora * costMult(ent, def.id);
    if (ora > 0) combat.addOra(ent, -ora);
    if (def.cost.surge > 0) combat.addSurge(ent, -def.cost.surge);
    c.cooldowns[def.id] = F.cooldown(def.cooldown, stt.cdr || 0);
    let targetId = typeof o.targetId === 'number' ? o.targetId : 0;
    if (!targetId && isPlayer(ent)) targetId = st.hardTarget || softFor(def.rating);
    const tEnt = targetId ? ctx.ents.get(targetId) : null;
    if (!tEnt || !tEnt.alive) targetId = 0;
    // Melee techniques only chase a soft target within melee range.
    if (targetId && isPlayer(ent) && def.rating === 'melee' && targetId !== st.hardTarget && tEnt) {
      const dx = tEnt.pos.x - ent.pos.x;
      const dz = tEnt.pos.z - ent.pos.z;
      if (dx * dx + dz * dz > CB.softLock.meleeRange * CB.softLock.meleeRange) targetId = 0;
    }
    c.targetId = targetId;
    if (def.id !== 'strike_string') r.stringT = Math.min(r.stringT, STRING_GRACE);
    r.def = def;
    r.step = 0;
    armStep(r);
    aim(ent, r, targetId, o.dirX, o.dirZ);
    if (def.move && def.move.turn && ctx.move && def.id !== 'flicker_step') ctx.move.face(ent, Math.atan2(r.dirX, r.dirZ), true);
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
    if (def.id === 'flicker_step') {
      r.flickerStart = ctx.time.now;
      r.flickX = ent.pos.x; r.flickY = ent.pos.y; r.flickZ = ent.pos.z;
    }
    if (ent.team === 2 && targetId && ctx.player && targetId === ctx.player.id) c.inCombatT = CB.inCombatSeconds;
    const tl = def.timeline;
    lockFor(ent, def, tl.windup + tl.active + tl.recover + (r.charging ? def.charge.max : 0));
    pStart.entId = ent.id; pStart.techId = def.id; pStart.targetId = targetId;
    ctx.bus.emit('combat:techStart', pStart);
    emitPhase(ent, def.id, 'windup');
    const diff = ent.team === 2 ? difficulty().telegraph : 1;
    telegraphFrom(ent, r, def, tl.windup * diff);
    anim(ent, def.anim && def.anim.windup, !!r.charging);
    if (def.invulnerable && def.id === 'flicker_step') c.invulnT = Math.max(c.invulnT, FLICK.invulnerable);
    return true;
  }

  /** Movement lock of a technique. */
  function lockFor(ent, def, seconds) {
    if (!def.move || def.move.lock === 'none' || !ctx.move) return;
    LOCK_OPTS.slow = def.move.lock === 'root' ? 0 : def.charge && def.charge.moveSlow ? def.charge.moveSlow : 0.4;
    LOCK_OPTS.noTurn = !def.move.turn;
    ctx.move.lock(ent, seconds, LOCK_OPTS);
    LOCK_OPTS.noTurn = false;
  }

  /** Next chain step. */
  function nextStep(ent, r) {
    const c = ent.combat;
    r.step++;
    armStep(r);
    c.comboIndex = r.step;
    if (isPlayer(ent) && !st.hardTarget) {
      // Re-acquire: the soft target may have changed during the string.
      const s = softFor('melee');
      if (s) c.targetId = s;
    }
    const t = c.targetId ? ctx.ents.get(c.targetId) : null;
    if (!t || !t.alive) c.targetId = 0;
    aim(ent, r, c.targetId, undefined, undefined);
    if (ctx.move) ctx.move.face(ent, Math.atan2(r.dirX, r.dirZ), true);
    c.state = 'windup';
    const s = stepOf(r.def, r.step);
    lockFor(ent, r.def, s.timeline.windup + s.timeline.active + s.timeline.recover);
    emitPhase(ent, r.def.id, 'windup');
    anim(ent, s.anim.windup, false);
  }

  /** Run a motion. */
  function motion(ent, r, m) {
    const mv = ctx.move;
    if (!mv) return;
    const c = ent.combat;
    const t = c.targetId ? ctx.ents.get(c.targetId) : null;
    const dist = typeof m.dist === 'number' ? m.dist : 6;
    let x = ent.pos.x + r.dirX * dist;
    let z = ent.pos.z + r.dirZ * dist;
    let y = NaN;
    let seconds = m.seconds || 0.1;
    if (m.kind === 'toTarget' || m.kind === 'behindTarget' || m.kind === 'leap') {
      if (!t || !t.alive) return;
      const dx = t.pos.x - ent.pos.x;
      const dz = t.pos.z - ent.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const reach = (t.radius || 0.5) + ent.radius + 0.5;
      if (m.kind === 'toTarget') {
        if (d <= reach + 0.05 || d > dist + reach) {
          if (airborne(t) && isPlayer(ent) && Math.abs(t.pos.y - ent.pos.y) > 1.5 && d <= dist + reach) {
            // Close the vertical gap to an airborne target (air string).
          } else return;
        }
        const k = d > 1e-4 ? Math.max(0, d - reach) / d : 0;
        x = ent.pos.x + dx * k;
        z = ent.pos.z + dz * k;
        if (airborne(t) && (airborne(ent) || r.def.id === 'pursuit')) y = t.pos.y + (t.height - ent.height) * 0.5;
        if (typeof m.speed === 'number' && m.speed > 0) seconds = Math.max(1 / 60, Math.sqrt((x - ent.pos.x) * (x - ent.pos.x) + (z - ent.pos.z) * (z - ent.pos.z)) / m.speed);
      } else if (m.kind === 'behindTarget') {
        if (d > dist) return;
        const k = d > 1e-4 ? (d + reach) / d : 0;
        x = ent.pos.x + dx * k;
        z = ent.pos.z + dz * k;
      } else {
        x = t.pos.x - (d > 1e-4 ? (dx / d) * reach : 0);
        z = t.pos.z - (d > 1e-4 ? (dz / d) * reach : 0);
      }
    } else if (m.kind === 'rise') {
      x = ent.pos.x; z = ent.pos.z; y = ent.pos.y + dist;
    } else if (m.kind === 'dive') {
      if (t && t.alive) {
        const dx = t.pos.x - ent.pos.x;
        const dz = t.pos.z - ent.pos.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d <= dist) {
          const k = d > 1.2 ? (d - 1.0) / d : 0;
          x = ent.pos.x + dx * k; z = ent.pos.z + dz * k;
          y = Math.max(t.pos.y + 0.2, groundAt(x, t.pos.y + 2, z));
        } else {
          x = ent.pos.x + r.dirX * 2; z = ent.pos.z + r.dirZ * 2;
        }
      } else {
        x = ent.pos.x + r.dirX * 2; z = ent.pos.z + r.dirZ * 2;
      }
      if (!(y === y)) y = groundAt(x, ent.pos.y, z);
    }
    if (!(y === y)) y = airborne(ent) ? ent.pos.y : groundAt(x, ent.pos.y + 2, z);
    if (c.techId === 'flicker_step') {
      pFlicker.entId = ent.id; pFlicker.fromX = ent.pos.x; pFlicker.fromY = ent.pos.y; pFlicker.fromZ = ent.pos.z;
      pFlicker.toX = x; pFlicker.toY = y; pFlicker.toZ = z;
      ctx.bus.emit('combat:flicker', pFlicker);
    }
    // A lunge that arrives after the windup holds the windup until arrival.
    const tl = stepOf(r.def, r.step).timeline;
    if (c.state === 'windup' && m.kind === 'toTarget' && m.t + seconds > tl.windup) r.windupExtra = Math.min(0.4, m.t + seconds - tl.windup);
    mv.dashTo(ent, x, y, z, Math.max(1 / 60, seconds));
    // Pursuit and air lunges arrive beside a juggled target: hang there so the air string can follow (GDD 6.2).
    if (isPlayer(ent) && typeof mv.hang === 'function') {
      if (m.kind === 'toTarget' && t && t.alive && y === y && airborne(t) && (r.def.id === 'pursuit' || airborne(ent))) {
        mv.hang(ent, seconds + AIR_HANG_SECONDS, STRING.juggle.gravityScale, NaN);
      } else if (m.kind === 'dive') {
        mv.hang(ent, 0, 1, NaN); // Meteor Heel: the dive ends the air hang
      }
    }
  }

  function groundAt(x, y, z) {
    const w = ctx.world;
    return w ? w.groundAt(x, y, z) : 0;
  }

  /** Fill REQ from a hit-like block and deal damage to `t`. */
  function strike(ent, r, t, h, techId, cx, cy, cz, ring, power) {
    const def = r.def;
    REQ.sourceId = ent.id; REQ.targetId = t.id; REQ.techId = techId;
    REQ.power = power * r.chargeMult; REQ.kind = def && def.rating === 'ora' ? 'ora' : 'melee'; REQ.rating = undefined;
    REQ.poise = h.poise || 0; REQ.knock = h.knock || null;
    const tg = def ? def.telegraph : null;
    const red = !!tg && (tg.kind === 'red' || tg.kind === 'violet');
    REQ.unblockable = !!h.unblockable || red; REQ.staggerPlayer = red; REQ.canCrit = true; REQ.feel = h.feel || 'lightHit';
    REQ.juggle = !!h.juggle; REQ.burn = h.burn && h.burn.seconds > 0 ? h.burn : null;
    let dx = t.pos.x - (ring ? ent.pos.x : cx);
    let dz = t.pos.z - (ring ? ent.pos.z : cz);
    const l = Math.sqrt(dx * dx + dz * dz);
    if (l > 1e-4) { dx /= l; dz /= l; } else { dx = r.dirX; dz = r.dirZ; }
    REQ.rx = dx; REQ.rz = dz;
    if (ring) { REQ.dirX = dx; REQ.dirZ = dz; } else { REQ.dirX = r.dirX; REQ.dirZ = r.dirZ; }
    // Breaker after 3+ string hits is a smash.
    if (techId === 'breaker' && r.stringHits >= BREAKER.smash.afterHits && REQ.knock && REQ.knock.kind === 'launch') REQ.knock = SMASH;
    REQ.x = t.pos.x - REQ.dirX * (t.radius || 0.5); REQ.y = t.pos.y + t.height * 0.6; REQ.z = t.pos.z - REQ.dirZ * (t.radius || 0.5);
    combat.damage(REQ, RES);
    REQ.staggerPlayer = false; REQ.juggle = false; REQ.burn = null;
    return RES.applied;
  }

  /** Resolve one HitDef. */
  function fireHit(ent, r, h) {
    const def = r.def;
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
    const edge = typeof h.edgePower === 'number';
    for (let i = 0; i < n && done < max; i++) {
      const t = OUT[i];
      if (!canHit(ent, ent.team, t)) continue;
      const dx = t.pos.x - ent.pos.x;
      const dz = t.pos.z - ent.pos.z;
      if (cosHalf > -2) {
        const l = Math.sqrt(dx * dx + dz * dz) || 1;
        if ((dx * fx + dz * fz) / l < cosHalf) continue;
      }
      const power = edge ? falloffPower(h.power, h.edgePower, Math.sqrt(dx * dx + dz * dz), h.radius) : h.power;
      if (strike(ent, r, t, h, def.id, cx, cy, cz, ring, power)) done++;
      // A perfect guard can stagger the attacker mid-hit: its technique is over.
      if (!ent.alive || r.def !== def) break;
    }
    for (let i = 0; i < n; i++) OUT[i] = null;
    if (ent.team === 2) perfectDodge(ent, h, cx, cy, cz, ring);
    if (ring && ctx.vfx && h.radius >= 4) {
      SHOCK.radius = h.radius; SHOCK.seconds = 0.32 + h.radius * 0.012; SHOCK.color = oraColor(ent); SHOCK.sphere = false; SHOCK.ground = true;
      ctx.vfx.shockwave(ent.pos.x, groundAt(ent.pos.x, ent.pos.y + 1, ent.pos.z), ent.pos.z, SHOCK);
    }
    if (def.id === 'strike_string' && isPlayer(ent) && done > 0) {
      r.stringHits++;
      r.stringT = 0;
    }
    if (!r.craterDone && def.crater && r.def === def) makeCrater(ent, r);
  }

  /**
   * Perfect Flicker by distance: an enemy hit fired within the window of the player's Flicker, at the spot the
   * player stood when the Flicker started, counts as avoided by the Flicker (GDD 5.4).
   */
  function perfectDodge(att, h, cx, cy, cz, ring) {
    const p = ctx.player;
    if (!p || !p.alive || !p.combat) return;
    const pr = recOf(p);
    if (pr.perfectUsed || p.combat.techId !== 'flicker_step') return;
    if (!isPerfectFlicker(ctx.time.now - pr.flickerStart, difficulty().perfectWindow)) return;
    const dx = pr.flickX - cx;
    const dz = pr.flickZ - cz;
    const dy = Math.abs(pr.flickY + p.height * 0.5 - cy);
    const reach = h.radius + p.radius + 0.4;
    if (dx * dx + dz * dz > reach * reach || dy > reach + p.height * 0.5) return;
    void ring;
    // Reuse the damage path's perfect branch: the player is invulnerable during the Flicker.
    REQ.sourceId = att.id; REQ.targetId = p.id; REQ.techId = null; REQ.power = 0; REQ.kind = 'melee'; REQ.rating = undefined;
    REQ.poise = 0; REQ.knock = null; REQ.dirX = 0; REQ.dirZ = 0; REQ.unblockable = false; REQ.canCrit = false; REQ.feel = 'lightHit';
    REQ.x = undefined; REQ.y = undefined; REQ.z = undefined;
    combat.damage(REQ, RES);
  }

  /** The technique crater (at the first hit of `active`, or at the start of `active` without hits). */
  function makeCrater(ent, r) {
    r.craterDone = true;
    const cr = r.def.crater;
    const w = ctx.world;
    if (!w || !cr) return;
    const c = ent.combat;
    const t = cr.at === 'impact' && c.targetId ? ctx.ents.get(c.targetId) : null;
    let x = ent.pos.x;
    let z = ent.pos.z;
    if (t && t.alive) {
      const dx = t.pos.x - ent.pos.x;
      const dz = t.pos.z - ent.pos.z;
      if (dx * dx + dz * dz < 16) { x = t.pos.x; z = t.pos.z; }
    } else if (cr.at === 'impact') {
      x = ent.pos.x + r.dirX * 1.2; z = ent.pos.z + r.dirZ * 1.2;
    }
    w.crater(x, z, cr.radius, cr.depth, ent.id);
    const y = groundAt(x, ent.pos.y + 2, z);
    w.damageProps(x, y, z, cr.radius * 0.6, 9999, ent.id);
  }

  /** Spawn the projectiles of one ProjectileDef. */
  function fireShot(ent, r, p) {
    const def = r.def;
    const count = typeof p.count === 'number' ? p.count : 1;
    if (count <= 0) return;
    const t = ent.combat.targetId ? ctx.ents.get(ent.combat.targetId) : null;
    const ox = ent.pos.x + r.dirX * 0.7;
    const oy = ent.pos.y + Math.max(0.8, ent.height * 0.7);
    const oz = ent.pos.z + r.dirZ * 0.7;
    let vy = 0;
    if (t && t.alive) {
      const dx = t.pos.x - ox;
      const dz = t.pos.z - oz;
      const dh = Math.sqrt(dx * dx + dz * dz) || 1;
      vy = (t.pos.y + t.height * 0.5 - oy) / dh;
    } else if (isPlayer(ent) && ctx.cam && typeof ctx.cam.pitch === 'number' && airborne(ent)) {
      vy = Math.tan(Math.max(-0.9, Math.min(0.9, ctx.cam.pitch)));
    }
    const baseYaw = Math.atan2(r.dirX, r.dirZ);
    let color = oraColor(ent);
    if (ent.team !== 2 && def.fx && typeof def.fx.color === 'number') color = def.fx.color;
    const rng = ctx.rng.sim;
    for (let k = 0; k < count; k++) {
      const off = count > 1 ? ((k / (count - 1)) - 0.5) * (p.spreadDeg || 0) : 0;
      const jitter = count === 1 && p.spreadDeg ? (rng.next() - 0.5) * p.spreadDeg * (p.every ? 1 : 0.15) : 0;
      const yaw = baseYaw + ((off + jitter) * Math.PI) / 180;
      const e = ctx.ents.create('projectile');
      if (!e) return;
      const sp = p.speed;
      const vyj = vy + (p.every ? (rng.next() - 0.5) * 0.12 : 0);
      const hl = Math.sqrt(1 + vyj * vyj);
      e.team = ent.team;
      e.defId = def.id;
      e.radius = p.radius;
      e.height = p.radius * 2;
      e.yaw = yaw;
      e.pos.set(ox, oy, oz);
      e.prev.set(ox, oy, oz);
      e.vel.set((Math.sin(yaw) * sp) / hl, (vyj * sp) / hl, (Math.cos(yaw) * sp) / hl);
      const d = shotPool.length ? shotPool.pop() : {
        ownerId: 0, team: 0, techId: '', fxId: '', power: 0, poise: 0, knock: null, feel: '', rating: 'ora',
        life: 0, homing: 0, gravity: 0, pierce: 0, targetId: 0, dist: 0, lastHit: 0, chargeMult: 1, aoe: null, combatShot: true, speed: 0,
      };
      d.ownerId = ent.id; d.team = ent.team; d.techId = def.id; d.fxId = p.fxId; d.power = p.power; d.poise = p.poise; d.knock = p.knock;
      d.feel = p.feel; d.rating = def.rating; d.life = p.life; d.homing = p.homing || 0; d.gravity = p.gravity || 0; d.pierce = p.pierce || 0;
      d.targetId = t && t.alive ? t.id : 0; d.dist = 0; d.lastHit = 0; d.chargeMult = r.chargeMult; d.aoe = p.aoe || null; d.speed = sp;
      e.data = d;
      pShotOn.entId = e.id; pShotOn.fxId = p.fxId; pShotOn.ownerId = ent.id; pShotOn.color = color;
      ctx.bus.emit('projectile:spawned', pShotOn);
    }
  }

  /** Beam tick: a capsule sweep along the aim direction, clipped by the world (entity hits win, 4.9). */
  function fireBeam(ent, r, b, damage) {
    const techId = r.def.id;
    const ax = ent.pos.x + r.dirX * 0.6;
    const ay = ent.pos.y + ent.height * 0.62;
    const az = ent.pos.z + r.dirZ * 0.6;
    let vy = 0;
    const t = ent.combat.targetId ? ctx.ents.get(ent.combat.targetId) : null;
    if (t && t.alive) {
      const dx = t.pos.x - ax;
      const dz = t.pos.z - az;
      const dh = Math.sqrt(dx * dx + dz * dz) || 1;
      vy = Math.max(-1.5, Math.min(1.5, (t.pos.y + t.height * 0.5 - ay) / dh));
    }
    const hl = Math.sqrt(1 + vy * vy);
    let bx = ax + (r.dirX * b.range) / hl;
    let by = ay + (vy * b.range) / hl;
    let bz = az + (r.dirZ * b.range) / hl;
    let tWorld = 2;
    const w = ctx.world;
    if (w && w.sweepSphere(ax, ay, az, bx, by, bz, Math.min(0.4, b.radius), SWEEP)) {
      tWorld = SWEEP.t;
    }
    const mask = ent.team === 1 ? KIND_MASK.HOSTILE_TARGETS : KIND_MASK.player;
    const n = ctx.spatial.querySegment(ax, ay, az, bx, by, bz, b.radius, OUT, mask);
    let hits = 0;
    for (let i = 0; i < n; i++) {
      const e = OUT[i];
      if (!canHit(ent, ent.team, e)) continue;
      const te = sweepCapsuleT(ax, ay, az, bx, by, bz, b.radius, e.pos.x, e.pos.y, e.pos.z, e.radius, e.height);
      const tt = te < 0 ? 0 : te;
      if (tWorld <= 1 && tt > tWorld + 0.05 && !insideHitCollider(e)) continue;
      if (damage) {
        strike(ent, r, e, b, techId, ax, ay, az, false, b.power);
        hits++;
      }
      if (!ent.alive || r.def === null) break;
    }
    for (let i = 0; i < n; i++) OUT[i] = null;
    if (tWorld <= 1) {
      bx = ax + (bx - ax) * tWorld;
      by = ay + (by - ay) * tWorld;
      bz = az + (bz - az) * tWorld;
      if (damage && w && SWEEP.kind === 'collider') w.damageProps(bx, by, bz, b.radius + 0.5, b.power * 40, ent.id);
    }
    r.beamOn = true;
    r.beamAX = ax; r.beamAY = ay; r.beamAZ = az; r.beamBX = bx; r.beamBY = by; r.beamBZ = bz;
    r.beamRadius = b.radius; r.beamColor = oraColor(ent);
    return hits;
  }

  /** The nearest hittable entity standing inside the collider the last sweep hit, near (x, y, z). */
  function entityInCollider(att, team, mask, x, y, z) {
    const n = ctx.spatial.querySphere(x, y, z, 6, OUT2, mask);
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const t = OUT2[i];
      if (!canHit(att, team, t) || t.id === att.id) continue;
      const d = (t.pos.x - x) * (t.pos.x - x) + (t.pos.z - z) * (t.pos.z - z);
      if (d < bestD && insideHitCollider(t)) { bestD = d; best = t; }
    }
    for (let i = 0; i < n; i++) OUT2[i] = null;
    return best;
  }

  /** Is `e` standing in the collider the last sweep hit? (entity-inside-collider precedence) */
  function insideHitCollider(e) {
    const w = ctx.world;
    if (!w || SWEEP.kind !== 'collider' || !SWEEP.colliderId || !w.queryColliders) return false;
    const n = w.queryColliders(e.pos.x, e.pos.z, e.radius + 4, COLS);
    let inside = false;
    for (let i = 0; i < n; i++) {
      const c = COLS[i];
      if (c.id === SWEEP.colliderId && nearCollider(c, e.pos.x, e.pos.y + e.height * 0.5, e.pos.z, e.radius + 0.3)) inside = true;
      COLS[i] = null;
    }
    COLS.length = 0;
    return inside;
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
    r.entered = false;
    if (c.state === 'windup' && r.charging) {
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
      if (r.chargeT >= ch.max || (ch.oraPerSec > 0 && ent.stats.ora <= 0)) releaseCharge(ent, r);
      if (r.charging) {
        // Keep facing the target while charging.
        const t = c.targetId ? ctx.ents.get(c.targetId) : null;
        if (t && t.alive && def.move && def.move.turn) {
          aim(ent, r, c.targetId, undefined, undefined);
          if (ctx.move) ctx.move.face(ent, Math.atan2(r.dirX, r.dirZ), false);
        }
        return;
      }
    }
    r.prevPhaseT = r.phaseT;
    r.phaseT += dt;
    r.techT += dt;
    c.techT = r.techT;
    const m = s.motion !== undefined ? s.motion : def.motion;
    if (m && !r.motionDone && r.techT >= m.t) {
      r.motionDone = true;
      motion(ent, r, m);
    }
    if (c.state === 'windup' && r.phaseT >= tl.windup + r.windupExtra) {
      r.phaseT -= tl.windup + r.windupExtra;
      r.prevPhaseT = 0;
      c.state = 'active';
      r.entered = true;
      emitPhase(ent, def.id, 'active');
      anim(ent, s.anim && s.anim.active, def.beam !== null || tl.active > 0.5);
      if (def.invulnerable) c.invulnT = Math.max(c.invulnT, def.id === 'flicker_step' ? FLICK.invulnerable - r.techT : tl.active + 0.1);
      const hits0 = s.hits || def.hits;
      if (def.crater && hits0.length === 0) makeCrater(ent, r);
      // Re-aim at the target when the hits start (it may have moved during the windup).
      if (c.targetId && def.move && def.move.turn) aim(ent, r, c.targetId, undefined, undefined);
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
            // The first volley is paid by the technique cost; every further one pays the cost again.
            if (r.shotNext[i] > p.t + 1e-6 && def.cost.ora > 0 && isPlayer(ent)) {
              if (ent.stats.ora + 1e-6 < def.cost.ora) { r.shotNext[i] = Infinity; break; }
              combat.addOra(ent, -def.cost.ora);
            }
            if (c.targetId) aim(ent, r, c.targetId, undefined, undefined);
            fireShot(ent, r, p);
            r.shotNext[i] += p.every;
          }
        } else if (!r.shotDone[i] && r.phaseT >= p.t) {
          r.shotDone[i] = 1;
          fireShot(ent, r, p);
        }
      }
      if (def.beam) {
        if (c.targetId) aim(ent, r, c.targetId, undefined, undefined);
        r.beamNext -= dt;
        let tick = false;
        while (r.def === def && r.beamNext <= 1e-9 && r.phaseT <= tl.active + 1e-6) {
          r.beamNext += def.beam.tick;
          fireBeam(ent, r, def.beam, true);
          tick = true;
        }
        if (r.def !== def || c.state !== 'active') return;
        if (!tick) fireBeam(ent, r, def.beam, false);
      }
      if (r.phaseT >= tl.active) {
        r.phaseT -= tl.active;
        c.state = 'recover';
        r.beamOn = false;
        emitPhase(ent, def.id, 'recover');
        anim(ent, s.anim && s.anim.recover, false);
      }
    }
    if (c.state === 'recover') {
      const chain = def.chain;
      if (r.queued && chain && r.step + 1 < def.chainSteps && r.phaseT >= Math.max(0, tl.cancelFrom)) {
        nextStep(ent, r);
        return;
      }
      if (r.phaseT >= tl.recover) endTech(ent, false);
    }
  }

  /** Release a hold-to-charge technique. */
  function releaseCharge(ent, r) {
    const ch = r.def.charge;
    r.charging = false;
    r.chargeMult = F.chargeMult(r.chargeT, ch.min, ch.max, ch.maxMult);
    ent.combat.charge = Math.min(1, r.chargeT / Math.max(1e-3, ch.max));
    pCharge.entId = ent.id; pCharge.techId = r.def.id; pCharge.level = ent.combat.charge;
    ctx.bus.emit('combat:charge', pCharge);
    const tl = r.def.timeline;
    lockFor(ent, r.def, tl.windup + tl.active + tl.recover);
    anim(ent, r.def.anim && r.def.anim.windup, false);
  }

  /** Move projectiles and resolve their hits. */
  function runShots(dt) {
    const list = ctx.ents.list('projectile');
    const world = ctx.world;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const d = e.data;
      if (!e.alive || !d || !d.combatShot) continue;
      d.life -= dt;
      if (d.homing > 0 && d.targetId) {
        const t = ctx.ents.get(d.targetId);
        if (t && t.alive) {
          const tx = t.pos.x - e.pos.x;
          const ty = t.pos.y + t.height * 0.5 - e.pos.y;
          const tz = t.pos.z - e.pos.z;
          const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
          const sp = d.speed;
          const k = Math.min(1, d.homing * dt);
          e.vel.x += ((tx / tl) * sp - e.vel.x) * k;
          e.vel.y += ((ty / tl) * sp - e.vel.y) * k;
          e.vel.z += ((tz / tl) * sp - e.vel.z) * k;
          const nl = Math.sqrt(e.vel.x * e.vel.x + e.vel.y * e.vel.y + e.vel.z * e.vel.z) || 1;
          e.vel.x *= sp / nl; e.vel.y *= sp / nl; e.vel.z *= sp / nl;
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
      let bestT = 2;
      for (let k = 0; k < n; k++) {
        const t = OUT[k];
        if (t.id === d.ownerId || t.id === d.lastHit || !canHit(owner || e, d.team, t)) continue;
        let tt = sweepCapsuleT(ax, ay, az, bx, by, bz, e.radius, t.pos.x, t.pos.y, t.pos.z, t.radius, t.height);
        if (tt < 0) tt = 1;
        if (tt < bestT) { bestT = tt; best = t; }
      }
      for (let k = 0; k < n; k++) OUT[k] = null;
      let tWorld = 2;
      if (world && world.sweepSphere(ax, ay, az, bx, by, bz, e.radius, SWEEP)) tWorld = SWEEP.t;
      if (best && tWorld <= 1 && bestT > tWorld + 0.05 && !insideHitCollider(best)) best = null;
      if (!best && tWorld <= 1 && SWEEP.kind === 'collider') {
        // A damageable entity standing inside the collider the shot touched takes the hit (Siphons, posts).
        best = entityInCollider(owner || e, d.team, mask, ax + (bx - ax) * tWorld, ay + (by - ay) * tWorld, az + (bz - az) * tWorld);
        if (best) bestT = tWorld;
      }
      const seg = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay) + (bz - az) * (bz - az));
      if (best) {
        d.dist += seg * bestT;
        REQ.sourceId = d.ownerId; REQ.targetId = best.id; REQ.techId = d.techId;
        REQ.power = d.power * d.chargeMult * (d.techId === 'ora_bolt' ? F.boltFalloff(d.dist) : 1);
        REQ.kind = d.rating === 'ora' ? 'ora' : 'melee'; REQ.rating = undefined; REQ.poise = d.poise; REQ.knock = d.knock;
        const sl = Math.sqrt(e.vel.x * e.vel.x + e.vel.z * e.vel.z) || 1;
        REQ.dirX = e.vel.x / sl; REQ.dirZ = e.vel.z / sl; REQ.rx = REQ.dirX; REQ.rz = REQ.dirZ;
        REQ.unblockable = false; REQ.canCrit = true; REQ.feel = d.feel;
        const hx = ax + (bx - ax) * bestT;
        const hy = ay + (by - ay) * bestT;
        const hz = az + (bz - az) * bestT;
        REQ.x = hx; REQ.y = hy; REQ.z = hz;
        combat.damage(REQ, RES);
        if (d.aoe) aoe(d, hx, hy, hz, best.id);
        if (d.pierce > 0) {
          d.pierce--;
          d.lastHit = best.id;
        } else {
          removeShot(e, true, hx, hy, hz);
          continue;
        }
      } else {
        d.dist += seg;
      }
      if (tWorld <= 1) {
        const hx = ax + (bx - ax) * tWorld;
        const hy = ay + (by - ay) * tWorld;
        const hz = az + (bz - az) * tWorld;
        if (world && SWEEP.kind === 'collider') world.damageProps(hx, hy, hz, e.radius + 0.6, d.power * 40, d.ownerId);
        if (d.aoe) aoe(d, hx, hy, hz, 0);
        removeShot(e, false, hx, hy, hz);
        continue;
      }
      e.pos.set(bx, by, bz);
      if (world && !world.sweepSphere && by <= world.heightAt(bx, bz)) {
        removeShot(e, false, bx, world.heightAt(bx, bz), bz);
        continue;
      }
      if (d.life <= 0) removeShot(e, false, bx, by, bz);
    }
  }

  /** Projectile area damage. */
  function aoe(d, x, y, z, skipId) {
    const mask = d.team === 1 ? KIND_MASK.HOSTILE_TARGETS : KIND_MASK.player;
    const owner = ctx.ents.get(d.ownerId);
    const n = ctx.spatial.querySphere(x, y, z, d.aoe.radius, OUT, mask);
    for (let i = 0; i < n; i++) {
      const t = OUT[i];
      if (t.id === skipId || !canHit(owner, d.team, t)) continue;
      REQ.sourceId = d.ownerId; REQ.targetId = t.id; REQ.techId = d.techId; REQ.power = d.aoe.power * d.chargeMult;
      REQ.kind = d.rating === 'ora' ? 'ora' : 'melee'; REQ.rating = undefined; REQ.poise = d.poise; REQ.knock = null;
      REQ.dirX = 0; REQ.dirZ = 0; REQ.unblockable = false; REQ.canCrit = false; REQ.feel = 'boltHit';
      REQ.x = t.pos.x; REQ.y = t.pos.y + t.height * 0.5; REQ.z = t.pos.z;
      combat.damage(REQ, RES);
    }
    for (let i = 0; i < n; i++) OUT[i] = null;
  }

  function removeShot(e, hitEnt, x, y, z) {
    const d = e.data;
    pShotOff.entId = e.id; pShotOff.fxId = d ? d.fxId : 'bolt'; pShotOff.hit = hitEnt; pShotOff.x = x; pShotOff.y = y; pShotOff.z = z;
    ctx.bus.emit('projectile:removed', pShotOff);
    ctx.ents.destroy(e.id);
    if (d && d.combatShot) {
      d.knock = null;
      d.aoe = null;
      shotPool.push(d);
    }
    e.data = null;
  }

  /** Per-entity timers, poise refill, burns, regen, drains. */
  function upkeep(ent, r, dt) {
    const c = ent.combat;
    const stt = ent.stats;
    if (c.invulnT > 0) c.invulnT = Math.max(0, c.invulnT - dt);
    if (c.inCombatT > 0) c.inCombatT = Math.max(0, c.inCombatT - dt);
    if (r.gatherLock > 0) r.gatherLock -= dt;
    if (r.pursuitT > 0) r.pursuitT -= dt;
    if (r.juggleT > 0) r.juggleT -= dt;
    if (r.secondBreathT > 0) r.secondBreathT -= dt;
    r.stringT += dt;
    if (r.stringHits > 0 && r.stringT > STRING_GRACE && c.techId !== 'strike_string') r.stringHits = 0;
    const keys = r.cdKeys;
    const cds = c.cooldowns;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (cds[k] > 0) cds[k] = Math.max(0, cds[k] - dt);
    }
    if (c.state === 'stagger') {
      c.staggerT -= dt;
      if (c.staggerT <= 0) {
        c.staggerT = 0;
        c.state = 'idle';
        if (r.broken) {
          r.broken = false;
          stt.poise = stt.poiseMax;
        }
        anim(ent, 'idle', false);
      }
    } else if (c.state === 'transform') {
      runTransform(ent, r, dt);
    }
    if (stt.poiseMax > 0 && !r.broken && stt.poise < stt.poiseMax) {
      r.poiseIdle += dt;
      if (r.poiseIdle >= CB.poise.refillSeconds) stt.poise = stt.poiseMax;
    }
    if (r.burnT > 0) runBurn(ent, r, dt);
    if (!isPlayer(ent)) return;
    const md = mods();
    const base = ctx.rpg ? ctx.rpg.base() : null;
    const spr = base ? base.spr : 0;
    if (c.burnoutT > 0) c.burnoutT = Math.max(0, c.burnoutT - dt);
    const noRegen = c.burnoutT > FORM_RULES.burnout.lockoutSeconds - FORM_RULES.burnout.noRegenSeconds;
    const boost = ent.move ? ent.move.boost : 0;
    const rp = ctx.rpg;
    REGEN.inSiphonZone = !!(rp && rp.inSiphonZone === true);
    REGEN.inCombat = st.inCombat; REGEN.boosting = boost > 0; REGEN.inForm = c.formId !== null; REGEN.burnout = noRegen;
    const regen = F.oraRegen(spr, md, REGEN);
    if (regen > 0 && stt.ora < stt.oraMax) combat.addOra(ent, regen * dt);
    if (boost > 0) {
      const cost = (boost === 2 ? BOOST.sonicOraPerSec : BOOST.oraPerSec) * (1 + F.mod(md, 'boostCostPct')) * dt;
      combat.addOra(ent, -cost);
      if (stt.ora <= cost && !r.boostBlocked && ctx.move) {
        r.boostBlocked = true;
        ctx.move.setBoostAllowed(ent, false);
      }
    }
    if (!r.boostBlocked && c.burnoutT > 0 && ctx.move) {
      r.boostBlocked = true;
      ctx.move.setBoostAllowed(ent, false);
    }
    if (r.boostBlocked && stt.ora >= BOOST.reenableOra && c.burnoutT <= 0 && ctx.move) {
      r.boostBlocked = false;
      ctx.move.setBoostAllowed(ent, true);
    }
    if (c.gathering) {
      r.gatherT += dt;
      combat.addOra(ent, F.gatherRate(spr, md) * dt);
      if (ctx.move) {
        LOCK_OPTS.slow = Math.min(1, GATHER.moveCap / Math.max(1, stt.runSpeed || 7));
        ctx.move.lock(ent, 0.05, LOCK_OPTS);
      }
    } else if (c.guarding && ctx.move) {
      LOCK_OPTS.slow = 0.35;
      ctx.move.lock(ent, 0.05, LOCK_OPTS);
    }
    if (c.formId !== null && c.state !== 'transform' && !r.formScripted) {
      const f = ctx.defs.find('form', c.formId);
      if (f) {
        combat.addOra(ent, -f.drain * dt);
        if (f.hpDrainPct > 0) stt.hp = Math.max(1, stt.hp - stt.hpMax * f.hpDrainPct * dt);
        if (stt.ora <= 0) {
          combat.setForm(ent, null, FORM_INSTANT);
          c.burnoutT = FORM_RULES.burnout.lockoutSeconds;
          pBurn.entId = ent.id;
          ctx.bus.emit('combat:burnout', pBurn);
        } else if (stt.hp < stt.hpMax * FORM_RULES.endBelowHpPct) {
          combat.setForm(ent, null, FORM_INSTANT);
        }
      }
    }
    r.surgeIdle = st.inCombat ? 0 : r.surgeIdle + dt;
    if (!st.inCombat && c.surge > 0) {
      const s = surgeDecay(c.surge, r.surgeIdle, dt);
      if (s !== c.surge) {
        c.surge = s;
        surgeEvent(ent, r);
      }
    }
  }
  const FORM_INSTANT = Object.freeze({ instant: true });

  /** Burn status (Nova Ring rank 3). */
  function runBurn(ent, r, dt) {
    r.burnT -= dt;
    r.burnNext -= dt;
    if (r.burnNext <= 0) {
      r.burnNext += r.burnEvery;
      const src = ctx.ents.get(r.burnSrc);
      REQ.sourceId = src && src.alive ? src.id : 0; REQ.targetId = ent.id; REQ.techId = 'nova_ring'; REQ.power = r.burnPower;
      REQ.kind = 'ora'; REQ.rating = src && src.stats ? src.stats.oraRating : 20; REQ.poise = 0; REQ.knock = null; REQ.dirX = 0; REQ.dirZ = 0;
      REQ.unblockable = true; REQ.canCrit = false; REQ.feel = 'boltHit'; REQ.x = undefined; REQ.y = undefined; REQ.z = undefined;
      combat.damage(REQ, RES);
      REQ.rating = undefined;
    }
    if (r.burnT <= 0) r.burnT = 0;
  }

  /** The transform sequence: invulnerable, then the shockwave that pushes enemies back. */
  function runTransform(ent, r, dt) {
    const c = ent.combat;
    r.transformT -= dt;
    if (r.transformT > 0) return;
    r.transformT = 0;
    c.state = 'idle';
    const f = c.formId ? ctx.defs.find('form', c.formId) : null;
    const radius = f ? f.transform.shockRadius : FORM_RULES.shockRadius;
    const color = f ? f.color : PALETTE.ora;
    if (ctx.vfx) {
      SHOCK.radius = radius * 1.4; SHOCK.seconds = 0.45; SHOCK.color = color; SHOCK.sphere = true; SHOCK.ground = false;
      ctx.vfx.shockwave(ent.pos.x, ent.pos.y + ent.height * 0.5, ent.pos.z, SHOCK);
      SHOCK.sphere = false; SHOCK.ground = true; SHOCK.radius = radius;
      ctx.vfx.shockwave(ent.pos.x, groundAt(ent.pos.x, ent.pos.y + 1, ent.pos.z), ent.pos.z, SHOCK);
      BURST.color = color; BURST.scale = 1.4; BURST.dirX = 0; BURST.dirY = 1; BURST.dirZ = 0;
      ctx.vfx.burst('transform_burst', ent.pos.x, ent.pos.y + ent.height * 0.5, ent.pos.z, BURST);
    }
    anim(ent, 'idle', false);
    // Push every hostile within the shock radius outward (no damage).
    const n = ctx.spatial.querySphere(ent.pos.x, ent.pos.y + 1, ent.pos.z, radius, OUT, KIND_MASK.enemy | KIND_MASK.boss);
    for (let i = 0; i < n; i++) {
      const t = OUT[i];
      if (!canHit(ent, ent.team, t) || !t.move || !ctx.move) continue;
      let dx = t.pos.x - ent.pos.x;
      let dz = t.pos.z - ent.pos.z;
      const l = Math.sqrt(dx * dx + dz * dz) || 1;
      dx /= l; dz /= l;
      WHO.boss = (t.tags & TAG.BOSS) !== 0; WHO.player = false;
      PUSH.speed = 12;
      knockVelocity(PUSH, dx, dz, dx, dz, WHO, KV);
      KNOCK_OPTS.hurtle = false; KNOCK_OPTS.stun = 0.6; KNOCK_OPTS.gravityScale = 1; KNOCK_OPTS.sourceId = ent.id; KNOCK_OPTS.slamDamage = 0;
      ctx.move.knock(t, KV.vx, KV.vy, KV.vz, KNOCK_OPTS);
    }
    for (let i = 0; i < n; i++) OUT[i] = null;
  }
  const PUSH = { kind: 'push', speed: 12 };

  function surgeEvent(ent, r) {
    const c = ent.combat;
    if (!isPlayer(ent)) return;
    const full = c.surge >= SURGE.max;
    if (Math.abs(c.surge - r.lastSurge) >= 1 || (full && r.lastSurge < SURGE.max) || (c.surge === 0 && r.lastSurge !== 0)) {
      r.lastSurge = c.surge;
      pSurge.value = c.surge; pSurge.full = full;
      ctx.bus.emit('combat:surge', pSurge);
    }
    if (ctx.store && ctx.store.state && ctx.store.state.player) ctx.store.state.player.surge = c.surge;
  }

  /** Combat state and threat for the player. */
  function updateCombatState() {
    const p = ctx.player;
    let engaged = 0;
    let boss = false;
    if (p && p.alive) {
      const list = ctx.ents.all();
      const r2 = THREAT_RANGE * THREAT_RANGE;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.team !== 2 || !e.alive || e.combat === null || e.kind === 'projectile') continue;
        const c = e.combat;
        if (c.inCombatT <= 0) continue;
        const dx = e.pos.x - p.pos.x;
        const dz = e.pos.z - p.pos.z;
        if (c.targetId === p.id || dx * dx + dz * dz <= r2) {
          engaged++;
          if ((e.tags & TAG.BOSS) !== 0) boss = true;
        }
      }
    }
    const on = !!(p && p.alive && p.combat !== null && (p.combat.inCombatT > 0 || engaged > 0));
    let th = 0;
    if (on) {
      const hp = p.stats && p.stats.hpMax > 0 ? p.stats.hp / p.stats.hpMax : 1;
      th = Math.min(1, Math.max(engaged, 1) / 5 + (boss ? 0.5 : 0) + (hp < 0.35 ? 0.25 : 0));
      th = Math.round(th * 4) / 4;
    }
    if (on !== st.inCombat || Math.abs(th - st.threat) >= 0.25) {
      st.inCombat = on;
      st.threat = th;
      pState.inCombat = on; pState.threat = th;
      ctx.bus.emit('combat:state', pState);
    }
  }

  /** Hard target validity (range and line of sight) and the soft targets. */
  function updateTargets() {
    const p = ctx.player;
    if (!p || !p.alive) {
      st.softMelee = 0;
      st.softOra = 0;
      return;
    }
    if (st.hardTarget) {
      const t = ctx.ents.get(st.hardTarget);
      const far = t ? (t.pos.x - p.pos.x) * (t.pos.x - p.pos.x) + (t.pos.z - p.pos.z) * (t.pos.z - p.pos.z) > CB.hardLock.breakRange * CB.hardLock.breakRange : true;
      if (!t || !t.alive || far || (t.combat && t.combat.state === 'dead')) combat.setTarget(0);
      else if (st.tick % LOS_EVERY === 0) {
        const w = ctx.world;
        const los = !w || !w.lineOfSight || w.lineOfSight(p.pos.x, p.pos.y + p.height * 0.8, p.pos.z, t.pos.x, t.pos.y + t.height * 0.6, t.pos.z);
        if (los) st.losLost = 0;
        else {
          st.losLost += LOS_EVERY / 60;
          if (st.losLost >= CB.hardLock.losSeconds) combat.setTarget(0);
        }
      }
    }
    // Aim: the stick direction while moving, else the facing.
    let ax = Math.sin(p.yaw);
    let az = Math.cos(p.yaw);
    const it = p.intent;
    if (it && it.mx * it.mx + it.mz * it.mz > 0.04) {
      const l = Math.sqrt(it.mx * it.mx + it.mz * it.mz);
      ax = it.mx / l; az = it.mz / l;
    }
    const n = ctx.spatial.query(p.pos.x, p.pos.z, CB.softLock.oraRange, OUT, KIND_MASK.enemy | KIND_MASK.boss);
    let bestM = null;
    let bestMS = Infinity;
    let bestO = null;
    let bestOS = Infinity;
    for (let i = 0; i < n; i++) {
      const e = OUT[i];
      if (!hostileOk(e)) continue;
      const dx = e.pos.x - p.pos.x;
      const dz = e.pos.z - p.pos.z;
      const dy = Math.abs(e.pos.y - p.pos.y);
      const sm = dy < CB.softLock.meleeRange ? softScore(dx, dz, ax, az, CB.softLock.meleeRange, CB.softLock.coneDeg) : -1;
      if (sm >= 0 && sm < bestMS) { bestMS = sm; bestM = e; }
      const so = softScore(dx, dz, ax, az, CB.softLock.oraRange, CB.softLock.coneDeg);
      if (so >= 0 && so < bestOS) { bestOS = so; bestO = e; }
    }
    for (let i = 0; i < n; i++) OUT[i] = null;
    st.softMelee = bestM ? bestM.id : 0;
    st.softOra = bestO ? bestO.id : 0;
  }

  /** @param {any} ent @param {number} seconds @param {boolean} broken */
  function staggerEnt(ent, seconds, broken) {
    const c = ent.combat;
    if (!c || c.state === 'dead') return;
    if (isBusy(c.state)) endTech(ent, true);
    if (c.guarding) setGuard(ent, false);
    if (c.gathering) setGather(ent, false);
    if (c.state === 'transform') return;
    c.state = 'stagger';
    c.staggerT = Math.max(c.staggerT, seconds);
    recOf(ent).broken = broken || recOf(ent).broken;
    anim(ent, 'stagger', true);
    if (ctx.move && ent.move) {
      LOCK_OPTS.slow = 0;
      ctx.move.lock(ent, seconds, LOCK_OPTS);
    }
    pStag.entId = ent.id; pStag.seconds = seconds; pStag.broken = broken;
    ctx.bus.emit('actor:staggered', pStag);
  }

  /** Apply a knock to a target. @returns {boolean} hurtle */
  function knock(t, src, k, dirX, dirZ, rx, rz, amount, juggle) {
    if (!t.move || !ctx.move) return false;
    const tr = recOf(t);
    WHO.boss = (t.tags & TAG.BOSS) !== 0;
    WHO.player = isPlayer(t);
    let kk = k;
    // Juggle: a light hit on an airborne target keeps it hanging (GDD 5.4, max 4 s).
    if (juggle && !WHO.boss && !WHO.player && airborne(t) && tr.juggleT > 0 && (!kk || kk.kind === 'none' || kk.kind === 'push')) kk = JUGGLE;
    if (!kk || kk.kind === 'none') return false;
    if (!knockVelocity(kk, dirX, dirZ, rx, rz, WHO, KV)) return false;
    if (kk === JUGGLE) {
      KV.vx = dirX * 1.2; KV.vz = dirZ * 1.2; KV.stun = 0.6;
    }
    if (kk.kind === 'launch' && kk !== JUGGLE && !WHO.boss && !WHO.player) tr.juggleT = STRING.juggle.maxSeconds;
    if (tr.juggleT <= 0 && KV.gravityScale < 1) KV.gravityScale = 1;
    KNOCK_OPTS.hurtle = KV.hurtle; KNOCK_OPTS.stun = KV.stun; KNOCK_OPTS.gravityScale = KV.gravityScale;
    KNOCK_OPTS.sourceId = src ? src.id : 0; KNOCK_OPTS.slamDamage = KV.hurtle ? amount * CB.slam.damageFraction : 0;
    ctx.move.knock(t, KV.vx, KV.vy, KV.vz, KNOCK_OPTS);
    if (!WHO.player && (kk.kind === 'launch' || kk.kind === 'smash') && kk !== JUGGLE && src && isPlayer(src)) {
      const sr = recOf(src);
      sr.pursuitId = t.id;
      sr.pursuitT = PURSUIT.window;
    }
    if (KV.hurtle && !WHO.player) anim(t, 'hurtle', true);
    return KV.hurtle;
  }

  const combat = {
    /** @param {any} ent */
    initActor(ent) {
      if (!ent || !ent.stats) return;
      /** @type {Record<string, number>} */
      const cds = {};
      const keys = [];
      const techs = ctx.defs.all('technique');
      const ed = ent.kind === 'enemy' || ent.kind === 'boss' ? ctx.defs.find('enemy', ent.defId) || ctx.defs.find('boss', ent.defId) : null;
      for (const t of techs) {
        const mine = ent.kind === 'player' ? t.user === 'player' : ed && Array.isArray(ed.techs) ? ed.techs.indexOf(t.id) >= 0 : t.user === 'enemy';
        if (mine) {
          cds[t.id] = 0;
          keys.push(t.id);
        }
      }
      const surge = ent.kind === 'player' && ctx.store && ctx.store.state && ctx.store.state.player ? Number(ctx.store.state.player.surge) || 0 : 0;
      ent.combat = {
        state: 'idle', techId: null, techT: 0, targetId: 0, formId: null, surge: Math.max(0, Math.min(SURGE.max, surge)),
        guarding: false, gathering: false, invulnT: 0, staggerT: 0, burnoutT: 0, comboIndex: 0, inCombatT: 0, charge: 0, cooldowns: cds,
      };
      removeRec(ent.id);
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
        case 'attack': {
          if (c.techId === 'strike_string' && isBusy(c.state)) {
            if (r.step + 1 < (r.def ? r.def.chainSteps : 0)) {
              r.queued = true;
              return true;
            }
            if (!cancellable(ent, r)) return false;
          }
          // A new string restarts the hit count unless it follows the previous one closely.
          if (c.techId !== 'strike_string' && r.stringT > STRING_GRACE) r.stringHits = 0;
          return combat.useTechnique(ent, 'strike_string', o);
        }
        case 'heavyStart': {
          const air = airborne(ent);
          let id = air ? 'meteor_heel' : 'breaker';
          const mh = air ? defOf(ent, 'meteor_heel') : null;
          if (air && (!mh || !usable(ent, mh))) id = 'breaker';
          if (c.techId === 'strike_string' && isBusy(c.state) && !isBlocked(c.state)) endTech(ent, true);
          return useWith(ent, id, o, true);
        }
        case 'heavyRelease':
        case 'techRelease':
          if (r.charging && r.def) {
            releaseCharge(ent, r);
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
          if (isBlocked(c.state)) return false;
          // Pursuit: Dash within the window after a launch or smash appears beside the flying target.
          if (r.pursuitT > 0 && isPlayer(ent)) {
            const pt = ctx.ents.get(r.pursuitId);
            const pd = defOf(ent, 'pursuit');
            if (pt && pt.alive && pd && usable(ent, pd) && (airborne(pt) || (pt.move && pt.move.mode === 'hurtle'))) {
              if (isBusy(c.state)) endTech(ent, true);
              if (c.guarding) setGuard(ent, false);
              if (c.gathering) setGather(ent, false);
              r.pursuitT = 0;
              HOLD.targetId = pt.id; HOLD.dirX = undefined; HOLD.dirZ = undefined; HOLD.hold = false; HOLD.charge = undefined;
              start(ent, pd, HOLD);
              r.pursuitBonus = PURSUIT.nextHitBonus;
              return true;
            }
          }
          const def = defOf(ent, 'flicker_step');
          if (!def || !usable(ent, def)) return false;
          if (isBusy(c.state)) endTech(ent, true);
          if (c.guarding) setGuard(ent, false);
          if (c.gathering) setGather(ent, false);
          return start(ent, def, o);
        }
        case 'gatherOn':
          if (isPlayer(ent) && ctx.rpg && !ctx.rpg.hasTech('gather')) return false;
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
          if (c.formId) return combat.setForm(ent, null, DEFAULT_OPTS);
          const sel = ctx.rpg ? ctx.rpg.selectedForm || ctx.rpg.forms()[0] || null : null;
          return sel ? combat.setForm(ent, sel, DEFAULT_OPTS) : false;
        }
        case 'revert':
          return c.formId ? combat.setForm(ent, null, DEFAULT_OPTS) : false;
        default:
          return false;
      }
    },

    /** @param {any} ent @param {string} techId @param {{ targetId?:number, charge?:number, dirX?:number, dirZ?:number, force?:boolean, hold?:boolean }} [opts] */
    useTechnique(ent, techId, opts) {
      if (!ent || !ent.combat || !ent.stats || !ent.alive) return false;
      const def = defOf(ent, techId);
      if (!def) return false;
      const o = opts || DEFAULT_OPTS;
      if (!o.force && (!usable(ent, def) || !free(ent))) return false;
      if (o.force) {
        if (ent.combat.state === 'dead') return false;
        if (isBusy(ent.combat.state)) endTech(ent, true);
        if (ent.combat.guarding) setGuard(ent, false);
        if (ent.combat.gathering) setGather(ent, false);
      }
      return start(ent, def, o);
    },

    /** @param {any} ent @param {string} techId */
    canUse(ent, techId) {
      if (!ent || !ent.combat || !ent.alive) return false;
      const def = defOf(ent, techId);
      if (!def || !usable(ent, def)) return false;
      const c = ent.combat;
      if (isBlocked(c.state)) return false;
      if (isBusy(c.state)) return cancellable(ent, recOf(ent));
      return true;
    },

    /** @param {any} ent @param {string} techId @returns {number} */
    cooldown(ent, techId) {
      return ent && ent.combat ? ent.combat.cooldowns[techId] || 0 : 0;
    },

    /** @param {any} ent */
    cancel(ent) {
      if (!ent || !ent.combat) return;
      if (isBusy(ent.combat.state)) endTech(ent, true);
      if (ent.combat.guarding) setGuard(ent, false);
      if (ent.combat.gathering) setGather(ent, false);
    },

    /**
     * The only way HP is reduced (4.9). Order of events: actor:damaged, combat:hit, then actor:staggered,
     * actor:died, player:died.
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
      const tPlayer = isPlayer(t);
      const sPlayer = isPlayer(src);
      if (tc.invulnT > 0 && kind !== 'true') {
        // Perfect Flicker: an attack avoided within the window of the Flicker's start.
        if (tPlayer && src && src.team === 2 && !tr.perfectUsed && isPerfectFlicker(ctx.time.now - tr.flickerStart, difficulty().perfectWindow)) {
          tr.perfectUsed = true;
          pPerfect.entId = t.id; pPerfect.kind = 'flicker'; pPerfect.attackerId = src.id;
          ctx.bus.emit('combat:perfect', pPerfect);
          combat.addSurge(t, FLICK.perfect.surge);
          if (st.hardTarget && ctx.move) {
            const ht = ctx.ents.get(st.hardTarget);
            if (ht && ht.alive) {
              const dx = ht.pos.x - t.pos.x;
              const dz = ht.pos.z - t.pos.z;
              const l = Math.sqrt(dx * dx + dz * dz) || 1;
              const k = (l + (ht.radius || 0.6) + t.radius + 0.8) / l;
              const x = t.pos.x + dx * k;
              const z = t.pos.z + dz * k;
              ctx.move.dashTo(t, x, airborne(t) ? t.pos.y : groundAt(x, t.pos.y + 2, z), z, 0.08);
              ctx.move.face(t, Math.atan2(-dx, -dz), true);
            }
          }
        }
        return res;
      }
      if (tc.invulnT > 0 && kind === 'true' && !req.unblockable) return res;
      let dirX = typeof req.dirX === 'number' ? req.dirX : 0;
      let dirZ = typeof req.dirZ === 'number' ? req.dirZ : 0;
      if (dirX === 0 && dirZ === 0 && src) {
        const dx = t.pos.x - src.pos.x;
        const dz = t.pos.z - src.pos.z;
        const l = Math.sqrt(dx * dx + dz * dz) || 1;
        dirX = dx / l; dirZ = dz / l;
      }
      const md = mods();
      const diff = difficulty();
      // Guard
      let blocked = false;
      let perfect = false;
      if (tc.guarding && !req.unblockable && kind !== 'true' && frontal(t.yaw, dirX, dirZ)) {
        blocked = true;
        perfect = isPerfectGuard(ctx.time.now - tr.guardStart, diff.perfectWindow);
      }
      // Amount
      let crit = false;
      let power = req.power;
      HIT.kind = kind; HIT.blocked = blocked; HIT.perfect = perfect;
      if (kind !== 'true') {
        const ss = src ? src.stats : null;
        HIT.rating = typeof req.rating === 'number' ? req.rating : ss ? (kind === 'ora' ? ss.oraRating : ss.meleeRating) : 20;
        let dmgMult = ss ? ss.dmgMult : 1;
        if (sPlayer && md) dmgMult *= 1 + F.mod(md, kind === 'ora' ? 'oraPct' : 'meleePct');
        if (tr.broken) dmgMult *= CB.poise.brokenDamageMult;
        if (tPlayer && tc.gathering) dmgMult *= F.mod(md, 'gatherDmgTakenMult');
        HIT.dmgMult = dmgMult;
        const cc = ss && req.canCrit !== false ? ss.critChance : 0;
        crit = cc > 0 && ctx.rng.sim.next() < cc;
        HIT.roll = ctx.rng.sim.range(BALANCE.damage.roll[0], BALANCE.damage.roll[1]);
        HIT.difficultyMult = src && src.team === 2 && tPlayer ? diff.enemyDmg : 1;
        if (sPlayer && src) {
          const sr = recOf(src);
          if (sr.pursuitBonus > 0 && req.techId !== 'pursuit') {
            power += sr.pursuitBonus;
            sr.pursuitBonus = 0;
          }
        }
        const ed = t.kind === 'enemy' ? ctx.defs.find('enemy', t.defId) : null;
        if (ed && ed.frontGuard && src && !req.unblockable && frontal(t.yaw, dirX, dirZ, ed.frontGuard.angleDeg)) power *= ed.frontGuard.damageMult;
        HIT.defense = t.stats.defense;
        HIT.defMult = t.stats.defMult;
      } else {
        HIT.rating = 0; HIT.defense = 0; HIT.dmgMult = 1; HIT.defMult = 1; HIT.roll = 1; HIT.difficultyMult = 1;
      }
      HIT.power = power; HIT.crit = crit;
      let amount = hitAmount(HIT);
      const stt = t.stats;
      // Guard cost and guard break.
      let guardBroken = false;
      if (blocked && !perfect) {
        if (stt.ora < GUARD.oraPerBlock) guardBroken = true;
        combat.addOra(t, -GUARD.oraPerBlock);
      }
      // Second Breath: once per 5 minutes a lethal hit leaves 1 HP and 2 s of invulnerability.
      let secondBreath = false;
      if (tPlayer && amount >= stt.hp && md && F.mod(md, 'secondBreath') > 0 && tr.secondBreathT <= 0) {
        amount = Math.max(0, stt.hp - 1);
        secondBreath = true;
      }
      stt.hp = Math.max(0, stt.hp - amount);
      tc.inCombatT = CB.inCombatSeconds;
      if (src && src.combat) src.combat.inCombatT = CB.inCombatSeconds;
      tr.lastHitBy = src ? src.id : 0;
      if (tc.gathering && amount > 0) {
        setGather(t, false);
        tr.gatherLock = GATHER.interruptLockout;
      }
      if (sPlayer && amount > 0 && !blocked) combat.addSurge(src, surgeForHit(kind, F.mod(md, 'surgePct')));
      if (tPlayer && amount > 0) combat.addSurge(t, surgeForHpLoss(amount, stt.hpMax));
      // Poise
      let broken = false;
      const poiseDmg = (req.poise || 0) * (sPlayer ? 1 + F.mod(md, 'poisePct') : 1);
      if (stt.poiseMax > 0 && poiseDmg > 0 && !blocked && !tr.broken) {
        stt.poise = Math.max(0, stt.poise - poiseDmg);
        tr.poiseIdle = 0;
        if (stt.poise <= 0) broken = true;
      }
      const killed = stt.hp <= 0;
      let hurtle = false;
      if (!killed && !blocked && t.move) {
        hurtle = knock(t, src, req.knock, dirX, dirZ, typeof req.rx === 'number' && (req.rx || req.rz) ? req.rx : dirX,
          typeof req.rz === 'number' && (req.rx || req.rz) ? req.rz : dirZ, amount, !!req.juggle && sPlayer);
        // Air string: the attacker hangs with the juggled target while the string goes on (GDD 6.2).
        if (sPlayer && src.move && ctx.move && typeof ctx.move.hang === 'function' && tr.juggleT > 0 && airborne(t) && airborne(src)) {
          ctx.move.hang(src, AIR_HANG_SECONDS, STRING.juggle.gravityScale, t.vel.y);
        }
      } else if (killed && !blocked && t.move && ctx.move && req.knock && req.knock.kind !== 'none' && (t.tags & TAG.BOSS) === 0 && !tPlayer) {
        // Kills still fly: the body takes the knock without a slam.
        WHO.boss = false; WHO.player = false;
        if (knockVelocity(req.knock, dirX, dirZ, req.rx || dirX, req.rz || dirZ, WHO, KV)) {
          KNOCK_OPTS.hurtle = false; KNOCK_OPTS.stun = 1; KNOCK_OPTS.gravityScale = 1; KNOCK_OPTS.sourceId = src ? src.id : 0; KNOCK_OPTS.slamDamage = 0;
          ctx.move.knock(t, KV.vx * 0.6, Math.max(2, KV.vy * 0.6), KV.vz * 0.6, KNOCK_OPTS);
        }
      }
      if (req.burn && !killed && sPlayer) {
        tr.burnT = req.burn.seconds; tr.burnEvery = req.burn.every; tr.burnNext = req.burn.every; tr.burnPower = req.burn.power; tr.burnSrc = src.id;
      }
      res.applied = true; res.amount = amount; res.crit = crit; res.blocked = blocked; res.perfect = perfect; res.killed = killed;
      res.staggered = (broken || guardBroken) && !killed;
      pDamaged.targetId = t.id; pDamaged.sourceId = req.sourceId || 0; pDamaged.amount = amount; pDamaged.crit = crit; pDamaged.blocked = blocked;
      pDamaged.perfect = perfect; pDamaged.techId = req.techId || null; pDamaged.kind = kind;
      pDamaged.x = typeof req.x === 'number' ? req.x : t.pos.x; pDamaged.y = typeof req.y === 'number' ? req.y : t.pos.y + t.height * 0.6;
      pDamaged.z = typeof req.z === 'number' ? req.z : t.pos.z; pDamaged.hpAfter = stt.hp;
      ctx.bus.emit('actor:damaged', pDamaged);
      pHit.attackerId = req.sourceId || 0; pHit.targetId = t.id; pHit.techId = req.techId || null;
      let cls = req.feel || (amount >= stt.hpMax * 0.15 ? 'heavyHit' : 'lightHit');
      if (blocked && cls !== 'boltHit' && cls !== 'beamTick') cls = 'lightHit';
      if (killed && sPlayer && cls === 'lightHit') cls = 'heavyHit';
      pHit.class = cls; pHit.amount = amount;
      pHit.x = pDamaged.x; pHit.y = pDamaged.y; pHit.z = pDamaged.z; pHit.dirX = dirX; pHit.dirZ = dirZ;
      pHit.blocked = blocked; pHit.perfect = perfect; pHit.crit = crit;
      ctx.bus.emit('combat:hit', pHit);
      hitFeel(t, src, cls, dirX, dirZ, amount, blocked, killed, hurtle);
      if (sPlayer && amount > 0) {
        st.comboCount = st.comboT > 0 ? st.comboCount + 1 : 1;
        st.comboT = COMBO_WINDOW;
        pCombo.count = st.comboCount;
        ctx.bus.emit('combat:combo', pCombo);
      }
      if (perfect) {
        pPerfect.entId = t.id; pPerfect.kind = 'guard'; pPerfect.attackerId = src ? src.id : 0;
        ctx.bus.emit('combat:perfect', pPerfect);
        combat.addSurge(t, GUARD.perfect.surge);
        if (src && src.combat) staggerEnt(src, GUARD.perfect.attackerStagger * (tPlayer ? F.mod(md, 'perfectStaggerMult') : 1), false);
      }
      if (secondBreath) {
        tr.secondBreathT = BALANCE.passives.second_breath.cooldown;
        tc.invulnT = Math.max(tc.invulnT, BALANCE.passives.second_breath.invulnerable);
      }
      if (!killed) {
        if (guardBroken) staggerEnt(t, GUARD.breakStagger, false);
        else if (broken && !tPlayer) staggerEnt(t, (t.tags & TAG.BOSS) !== 0 ? CB.poise.bossBreakStagger : CB.poise.breakStagger, true);
        else if (tPlayer && req.staggerPlayer && !blocked) staggerEnt(t, RED_STAGGER, false);
        else if (!tPlayer && stt.poiseMax <= 0 && !blocked && !hurtle && amount > 0 && ctx.actors) anim(t, 'stagger', false);
      }
      if (killed) combat.kill(t, req.sourceId || 0);
      return res;
    },

    /** @param {any} ent @param {number} amount */
    heal(ent, amount) {
      if (!ent || !ent.stats) return;
      const s = ent.stats;
      const before = s.hp;
      s.hp = Math.max(0, Math.min(s.hpMax, s.hp + Math.max(0, amount || 0)));
      if (s.hp > before) {
        pHealed.entId = ent.id; pHealed.amount = s.hp - before;
        ctx.bus.emit('actor:healed', pHealed);
      }
    },

    /** @param {any} ent @param {number} amount */
    addOra(ent, amount) {
      if (!ent || !ent.stats) return;
      const s = ent.stats;
      s.ora = Math.max(0, Math.min(s.oraMax, s.ora + (amount || 0)));
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
      if (isBusy(c.state)) endTech(ent, true);
      if (c.guarding) setGuard(ent, false);
      if (c.gathering) setGather(ent, false);
      if (c.formId) combat.setForm(ent, null, FORM_INSTANT);
      const r = recOf(ent);
      r.burnT = 0;
      r.beamOn = false;
      if (ent.stats) ent.stats.hp = 0;
      c.state = 'dead';
      c.staggerT = 0;
      ent.alive = false;
      if (ent.intent) { ent.intent.mx = 0; ent.intent.mz = 0; ent.intent.up = 0; }
      anim(ent, 'death', true);
      if (st.hardTarget === ent.id) combat.setTarget(0);
      if (st.softMelee === ent.id) st.softMelee = 0;
      if (st.softOra === ent.id) st.softOra = 0;
      pDied.entId = ent.id; pDied.sourceId = sourceId; pDied.kind = ent.kind; pDied.defId = ent.defId; pDied.level = ent.level;
      pDied.questTag = ent.questTag; pDied.x = ent.pos.x; pDied.y = ent.pos.y; pDied.z = ent.pos.z;
      ctx.bus.emit('actor:died', pDied);
      if (isPlayer(ent)) {
        const boss = ctx.ai ? ctx.ai.boss : null;
        pPDied.x = ent.pos.x; pPDied.y = ent.pos.y; pPDied.z = ent.pos.z; pPDied.bossId = boss ? boss.defId : null;
        ctx.time.slowMo(0.3, BALANCE.death.slowSeconds);
        ctx.bus.emit('player:died', pPDied);
        updateCombatState();
      }
    },

    /** @param {any} ent @param {number} [hpFraction=1] */
    revive(ent, hpFraction = 1) {
      if (!ent || !ent.combat || !ent.stats) return;
      const c = ent.combat;
      const r = recOf(ent);
      ent.alive = true;
      c.state = 'idle';
      c.techId = null;
      c.staggerT = 0;
      c.inCombatT = 0;
      c.guarding = false;
      c.gathering = false;
      c.invulnT = BALANCE.death.respawnInvulnerable;
      r.def = null;
      r.broken = false;
      r.burnT = 0;
      ent.stats.hp = 0;
      combat.heal(ent, Math.max(1, Math.round(ent.stats.hpMax * hpFraction)));
      combat.addOra(ent, ent.stats.oraMax);
      if (r.boostBlocked && ctx.move) {
        r.boostBlocked = false;
        ctx.move.setBoostAllowed(ent, true);
      }
      anim(ent, 'getup', false);
    },

    /** @param {any} ent @param {string|null} formId @param {{ instant?:boolean, free?:boolean, scripted?:boolean }} [opts] */
    setForm(ent, formId, opts) {
      if (!ent || !ent.combat) return false;
      const o = opts || DEFAULT_OPTS;
      const c = ent.combat;
      const r = recOf(ent);
      const prev = c.formId;
      if ((formId || null) === prev) return false;
      let f = null;
      if (formId) {
        f = ctx.defs.find('form', formId);
        if (!f) return false;
        if (!o.free && !o.scripted) {
          if (c.state === 'dead' || c.burnoutT > 0) return false;
          if (isPlayer(ent) && ctx.rpg && ctx.rpg.forms().indexOf(formId) < 0) return false;
          if (f.unlock && f.unlock.scripted) {
            // Free use of Zenith after the ending (P1): only from the free-use level.
            const lvl = ctx.rpg ? ctx.rpg.level : 0;
            if (!(lvl >= BALANCE.forms.zenith.freeUseLevel && ctx.store && ctx.store.state && ctx.store.state.quests &&
              ctx.store.state.quests.done && ctx.store.state.quests.done.indexOf && ctx.store.state.quests.done.indexOf('mq7') >= 0)) return false;
          }
          if (ent.stats.ora < f.cost) return false;
          if (!prev && !free(ent)) return false;
          combat.addOra(ent, -f.cost);
        }
        r.formScripted = !!o.scripted;
        if (!o.instant) {
          if (isBusy(c.state)) endTech(ent, true);
          if (c.guarding) setGuard(ent, false);
          if (c.gathering) setGather(ent, false);
          const first = !seenForms.has(formId);
          const short = !first || !!(ctx.save && ctx.save.settings && ctx.save.settings.shortTransform);
          c.state = 'transform';
          r.transformT = short ? f.transform.shortSeconds : f.transform.seconds;
          r.transformLong = !short;
          c.invulnT = Math.max(c.invulnT, r.transformT + 0.1);
          anim(ent, 'transform', true);
          if (ctx.move) {
            LOCK_OPTS.slow = 0;
            ctx.move.lock(ent, r.transformT, LOCK_OPTS);
          }
          if (ctx.vfx) {
            BURST.color = f.color; BURST.scale = 1.2; BURST.dirX = 0; BURST.dirY = 1; BURST.dirZ = 0;
            ctx.vfx.burst('transform_in', ent.pos.x, ent.pos.y + ent.height * 0.5, ent.pos.z, BURST);
          }
          if (!short && isPlayer(ent) && ctx.cam && ctx.cam.play && !ctx.cam.busy) transformShot(ent, r.transformT);
        }
      } else {
        r.formScripted = false;
        if (prev && ctx.vfx) {
          const pf = ctx.defs.find('form', prev);
          SHOCK.radius = 4; SHOCK.seconds = 0.3; SHOCK.color = pf ? pf.color : PALETTE.ora; SHOCK.sphere = true; SHOCK.ground = false;
          ctx.vfx.shockwave(ent.pos.x, ent.pos.y + ent.height * 0.5, ent.pos.z, SHOCK);
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

    target() {
      return st.hardTarget;
    },

    softTarget() {
      return st.softMelee || st.softOra;
    },

    /** @param {number} entId 0 releases */
    setTarget(entId) {
      let id = entId || 0;
      if (id) {
        const t = ctx.ents.get(id);
        if (!t || !t.alive || (t.tags & TAG.NO_LOCK) !== 0 || !t.combat || t.combat.state === 'dead') id = 0;
      }
      if (id === st.hardTarget) return;
      st.hardTarget = id;
      st.losLost = 0;
      pLock.entId = ctx.player ? ctx.player.id : 0; pLock.targetId = id;
      ctx.bus.emit('combat:lock', pLock);
    },

    /** Switch the hard target to the next hostile clockwise (+1) or counter-clockwise (-1) around the player. */
    cycleTarget(dir) {
      const p = ctx.player;
      if (!p) return;
      const range = CB.hardLock.breakRange;
      const cur = st.hardTarget || st.softMelee || st.softOra;
      const ce = cur ? ctx.ents.get(cur) : null;
      const yaw = p.yaw;
      const a0 = ce && ce.alive ? relAngle(ce.pos.x - p.pos.x, ce.pos.z - p.pos.z, yaw) : 0;
      const n = ctx.spatial.query(p.pos.x, p.pos.z, range, OUT, KIND_MASK.enemy | KIND_MASK.boss);
      let best = null;
      let bestD = Infinity;
      let wrap = null;
      let wrapA = 0;
      for (let i = 0; i < n; i++) {
        const e = OUT[i];
        if (!hostileFilter(e) || e.id === cur) continue;
        const a = relAngle(e.pos.x - p.pos.x, e.pos.z - p.pos.z, yaw);
        const d = (a - a0) * (dir >= 0 ? 1 : -1);
        if (d > 1e-4 && d < bestD) { bestD = d; best = e; }
        const wa = a * (dir >= 0 ? 1 : -1);
        if (!wrap || wa < wrapA) { wrap = e; wrapA = wa; }
      }
      for (let i = 0; i < n; i++) OUT[i] = null;
      const pick = best || wrap;
      if (pick) combat.setTarget(pick.id);
    },

    /** Tap-to-lock (touch): the hostile whose projected body is nearest the tap, within a radius scaled by its size. */
    pickAtScreen(cssX, cssY) {
      const render = ctx.render;
      if (!render || !render.project) return 0;
      const pt = PICK;
      const p = ctx.player;
      let best = 0;
      let bestD = Infinity;
      const kinds = PICK_KINDS;
      for (let k = 0; k < kinds.length; k++) {
        const list = ctx.ents.list(kinds[k]);
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          if (!hostileFilter(e)) continue;
          render.project(e.pos.x, e.pos.y + e.height * 0.5, e.pos.z, pt);
          if (!pt.visible) continue;
          const d = Math.sqrt((pt.x - cssX) * (pt.x - cssX) + (pt.y - cssY) * (pt.y - cssY));
          // Tolerance: 56 css px plus the body size seen from the player distance.
          const dist = p ? Math.max(2, Math.sqrt((e.pos.x - p.pos.x) ** 2 + (e.pos.z - p.pos.z) ** 2)) : 20;
          const tol = 56 + Math.min(120, (e.height * 400) / dist);
          if (d <= tol && d / tol < bestD) { bestD = d / tol; best = e.id; }
        }
      }
      if (best) combat.setTarget(best);
      return best;
    },

    get inCombat() {
      return st.inCombat;
    },

    get threat() {
      return st.threat;
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

    /** Remove the engine's projectiles and private state. */
    dispose() {
      const list = ctx.ents.list('projectile');
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        if (e.alive && e.data && e.data.combatShot) removeShot(e, false, e.pos.x, e.pos.y, e.pos.z);
      }
      reset();
    },
  };
  const PICK = { x: 0, y: 0, visible: false, depth: 0 };
  const PICK_KINDS = Object.freeze(['enemy', 'boss']);

  /** The long transform's camera: a slow orbit around the player. */
  function transformShot(ent, seconds) {
    const yaw = ent.yaw;
    const shots = [
      { seconds: seconds * 0.55, orbit: { entId: ent.id, dist: 4.2, height: 1.4, yawFrom: yaw + 2.6, yawTo: yaw + 3.2 }, lookAt: { entId: ent.id, socket: 'chest' }, fov: 50, ease: 'inOut' },
      { seconds: seconds * 0.45, orbit: { entId: ent.id, dist: 6.5, height: 2.0, yawFrom: yaw + 3.2, yawTo: yaw + 3.5 }, lookAt: { entId: ent.id, socket: 'chest' }, fov: 62, ease: 'out' },
    ];
    try {
      const pr = ctx.cam.play('combat.transform', shots, { skippable: true, freeze: false });
      if (pr && pr.catch) pr.catch(() => {});
    } catch (e) {
      if (ctx.log) ctx.log.warn('combat', 'transform shot failed', String(e));
    }
  }

  /** Variant of useTechnique that holds charge-capable techniques. */
  function useWith(ent, techId, o, hold) {
    const def = defOf(ent, techId);
    if (!def) return false;
    if (!usable(ent, def) || !free(ent)) return false;
    HOLD.targetId = o.targetId; HOLD.dirX = o.dirX; HOLD.dirZ = o.dirZ; HOLD.hold = hold && !!def.charge; HOLD.charge = undefined;
    return start(ent, def, HOLD);
  }

  /** Run the registered script of a technique each tick it runs. */
  function runScript(ent, r) {
    const def = r.def;
    if (!def || !def.script) return;
    const fn = scripts.get(def.script);
    if (fn) fn(ctx, ent, def, ent.combat, r);
  }

  function reset() {
    recs.clear();
    recList.length = 0;
    resolved.clear();
    chained.clear();
    st.hardTarget = 0;
    st.softMelee = 0;
    st.softOra = 0;
    st.inCombat = false;
    st.threat = 0;
    st.losLost = 0;
    st.comboCount = 0;
    st.comboT = 0;
    seenForms.clear();
  }

  /** The visual feel of one hit that is not automatic through events (actor flash, flinch, camera punch). */
  function hitFeel(t, src, cls, dirX, dirZ, amount, blocked, killed, hurtle) {
    const a = ctx.actors;
    if (a && amount > 0) {
      if (a.flash) a.flash(t, blocked ? 0.04 : 0.07);
      if (!hurtle && !killed && a.flinch && (t.tags & TAG.BOSS) === 0) a.flinch(t, dirX, dirZ, cls === 'lightHit' || cls === 'boltHit' ? 0.4 : 0.9);
    }
    if (isPlayer(src) && ctx.cam && ctx.cam.punch && (cls === 'heavyHit' || cls === 'finisher' || cls === 'burst')) {
      ctx.cam.punch(dirX, 0, dirZ, cls === 'heavyHit' ? 0.08 : 0.14);
    }
    // Light string hits shove grounded grunts a little so contact reads as physical.
    if (!blocked && !killed && !hurtle && t.move && ctx.move && !isPlayer(t) && (t.tags & TAG.BOSS) === 0 && cls === 'lightHit' && !airborne(t)) {
      ctx.move.impulse(t, dirX * 1.6, 0, dirZ * 1.6);
    }
  }

  const runSystem = {
    id: 'combat.run',
    phase: 'combat',
    /** @param {any} c @param {number} dt */
    step(c, dt) {
      st.tick++;
      if (st.comboT > 0) st.comboT -= dt;
      const list = c.ents.all();
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.combat === null || e.stats === null || e.combat.state === 'dead' || !e.alive || e.kind === 'projectile') continue;
        const r = recOf(e);
        upkeep(e, r, dt);
        if (isBusy(e.combat.state)) {
          runScript(e, r);
          if (isBusy(e.combat.state)) runTech(e, r, dt);
        }
      }
      runShots(dt);
      updateTargets();
      updateCombatState();
    },
  };

  const on = {
    /** actor:slam: slam damage, Surge, props and crater. @param {any} e */
    slam(e) {
      const t = ctx.ents.get(e.entId);
      if (t && t.alive && e.damage > 0) {
        REQ.sourceId = e.sourceId; REQ.targetId = e.entId; REQ.techId = null; REQ.power = e.damage; REQ.kind = 'true'; REQ.rating = undefined;
        REQ.poise = 0; REQ.knock = null; REQ.dirX = 0; REQ.dirZ = 0; REQ.unblockable = true; REQ.canCrit = false; REQ.feel = 'wallSlam';
        REQ.x = e.x; REQ.y = e.y; REQ.z = e.z; REQ.rx = 0; REQ.rz = 0;
        combat.damage(REQ, RES);
      }
      const src = e.sourceId ? ctx.ents.get(e.sourceId) : null;
      if (src && isPlayer(src)) combat.addSurge(src, CB.slam.surge);
      const w = ctx.world;
      if (w) {
        const radius = Math.min(CB.crater.deformRadius - 0.5, Math.max(1.5, e.speed / 9));
        w.damageProps(e.x, e.y, e.z, radius + 1, Math.max(1, e.damage), e.sourceId);
        w.crater(e.x, e.z, radius, radius * CB.crater.maxDepthFraction * 0.5, e.sourceId);
      }
      if (ctx.vfx) {
        BURST.color = PALETTE.ora; BURST.scale = Math.min(2, 0.6 + e.speed / 30); BURST.dirX = 0; BURST.dirY = 1; BURST.dirZ = 0;
        ctx.vfx.burst('explosion_s', e.x, e.y + 0.3, e.z, BURST);
      }
    },
    /** @param {any} e */
    removed(e) {
      removeRec(e.entId);
      if (st.hardTarget === e.entId) combat.setTarget(0);
      if (st.softMelee === e.entId) st.softMelee = 0;
      if (st.softOra === e.entId) st.softOra = 0;
    },
    ended() {
      reset();
    },
  };

  return { combat, runSystem, on, recList, recOf, reset, defOf, state: st, airborne };
}
