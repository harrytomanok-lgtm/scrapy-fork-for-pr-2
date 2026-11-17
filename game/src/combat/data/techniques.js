/**
 * Player techniques (ARCHITECTURE 5.1, GDD 5.3-5.4). Every number of the GDD comes from BALANCE.tech; the
 * values written here are the ones the GDD leaves to the implementation (timeline splits, hit-shape offsets,
 * projectile speeds, motion timings). Pure data: Node tests load it.
 *
 * Extensions of the 5.1 schema used by the engine (all optional):
 * - `chainSteps` (number): chain steps in use at rank 1 (Strike String has six authored steps, five in use);
 * - HitDef `edgePower`: power at the edge of the shape (Ringfall falloff, 16 at the centre to 8 at 22 m);
 * - HitDef `burn: { power, every, seconds }`: a burn applied to each target hit (Nova Ring rank 3; seconds 0 = off);
 * - HitDef `juggle: true`: on an airborne target the hit keeps it hanging (string hits);
 * - ProjectileDef `count: 0`: disabled until a rank mod sets it (Flare Barrage rank 2 final bolt).
 * @module combat/data/techniques
 */

import { BALANCE } from '../../core/balance.js';

const T = BALANCE.tech;
const NONE = Object.freeze({ kind: 'none' });

/**
 * A complete TechniqueDef with defaults.
 * @param {string} id @param {object} o
 * @returns {object}
 */
function tech(id, o) {
  return Object.assign({
    id, user: 'player', slot: 'core', branch: 'fist', icon: id, rating: 'melee',
    cost: { ora: 0, surge: 0 }, cooldown: 0, charge: null,
    timeline: { windup: 0.06, active: 0.06, recover: 0.2, cancelFrom: 0.1 },
    anim: { windup: 'attack1', active: 'attack1', recover: 'idle' },
    telegraph: null,
    move: { lock: 'slow', turn: true, air: true, ground: true },
    motion: null, hits: [], projectiles: [], beam: null, chain: null, crater: null,
    invulnerable: false, script: null,
    fx: { color: 'ora', hit: 'hit_light' }, sfx: { hit: 'hit_light' },
    ranks: [{}], unlock: { start: true },
  }, o);
}

/** @param {object} o @returns {object} HitDef */
function hit(o) {
  return Object.assign({ t: 0, shape: 'sphere', f: 1.3, u: 0.9, radius: 1.6, power: 1, poise: 0, knock: NONE, feel: 'lightHit', maxTargets: 4 }, o);
}

/** @param {object} o @returns {object} ProjectileDef */
function shot(o) {
  return Object.assign({
    t: 0, count: 1, spreadDeg: 0, speed: 75, radius: 0.35, life: 1.2, homing: 4, gravity: 0, pierce: 0,
    power: 0.2, poise: 1, knock: NONE, feel: 'boltHit', fxId: 'bolt', socket: 'handR',
  }, o);
}

/** Strike String: five authored hits plus the rank 2 spin kick; each 0.28 s; hit 1 lunges. */
function strikeString() {
  const ss = T.strike_string;
  const all = ss.hits.concat([ss.ranks[1].extraHit]);
  const last = all.length - 1;
  const chain = all.map((h, i) => {
    const step = ss.hitSeconds;
    // Windup is short so the press lands at once; recover is the cancel window for the next press.
    const tl = { windup: 0.07, active: 0.05, recover: step - 0.12, cancelFrom: i + 1 >= ss.cancelFromHit ? 0 : -1 };
    const finisher = i >= ss.hits.length - 1;
    const clip = 'attack' + (i + 1);
    return {
      timeline: tl,
      anim: { windup: clip, active: clip, recover: 'idle' },
      hits: [hit({
        f: i === last ? 0.4 : 1.3, radius: i === last ? 2.6 : finisher ? 1.9 : 1.6, shape: i === last ? 'ring' : 'sphere',
        power: h.power, poise: h.poise, knock: h.knock || NONE, juggle: true,
        feel: finisher ? 'finisher' : i >= 2 ? 'heavyHit' : 'lightHit', maxTargets: i === last ? 8 : 3,
      })],
      motion: i === 0
        ? { kind: 'toTarget', t: 0, seconds: ss.lunge.dist / ss.lunge.speed, dist: ss.lunge.dist, speed: ss.lunge.speed }
        : { kind: 'toTarget', t: 0, seconds: 0.08, dist: 3.5, speed: 30 },
    };
  });
  return tech('strike_string', {
    timeline: chain[0].timeline, anim: chain[0].anim, hits: chain[0].hits, motion: chain[0].motion, chain,
    chainSteps: ss.hits.length,
    fx: { color: 'ora', hit: 'hit_light' }, sfx: { active: 'whoosh', hit: 'hit_light' },
    ranks: [{}, { mods: { chainSteps: all.length } }, { mods: { powerMult: ss.ranks[2].powerMult } }],
  });
}

/** @returns {object[]} the P0 player techniques */
export function playerTechniques() {
  const br = T.breaker;
  const mh = T.meteor_heel;
  const bolt = T.ora_bolt;
  const fb = T.flare_barrage;
  const dl = T.dawn_lance;
  const nova = T.nova_ring;
  const rf = T.ringfall;
  const fl = T.flicker_step;
  const boltSpeed = 75;
  return [
    strikeString(),
    tech('breaker', {
      cooldown: br.cooldown,
      charge: { min: br.charge.min, max: br.charge.max, maxMult: br.charge.maxMult, oraPerSec: 0, moveSlow: 0.3 },
      timeline: { windup: 0.1, active: 0.08, recover: 0.34, cancelFrom: 0.14 },
      anim: { windup: 'heavy_charge', active: 'heavy', recover: 'idle' },
      motion: { kind: 'toTarget', t: 0, seconds: 0.1, dist: 4, speed: 30 },
      hits: [hit({ f: 1.4, radius: 2.0, power: br.power, poise: br.poise, knock: { kind: 'launch', up: br.launch.up }, feel: 'heavyHit', maxTargets: 3 })],
      fx: { color: 'ora', windup: 'beam_charge', hit: 'hit_heavy' }, sfx: { windup: 'beam_charge', active: 'whoosh', hit: 'hit_heavy' },
      ranks: [{}, { mods: { 'hits.0.unblockable': 1, 'hits.0.poise': br.poise * br.ranks[1].poiseMult } }],
    }),
    tech('meteor_heel', {
      cost: { ora: mh.ora, surge: 0 }, cooldown: mh.cooldown,
      timeline: { windup: 0.14, active: 0.08, recover: 0.4, cancelFrom: 0.25 },
      anim: { windup: 'heavy_charge', active: 'heavy_air', recover: 'land' },
      move: { lock: 'root', turn: true, air: true, ground: false },
      motion: { kind: 'dive', t: 0.06, seconds: 0.14, dist: 40 },
      hits: [hit({ f: 0.6, u: 0, radius: 2.8, power: mh.power, poise: mh.poise, knock: mh.knock, feel: 'heavyHit', maxTargets: 4 })],
      crater: { radius: mh.crater.radius, depth: 1.6, at: 'impact' },
      fx: { color: 'ora', active: 'slam', hit: 'hit_heavy' }, sfx: { active: 'whoosh', hit: 'hit_heavy' },
      ranks: [{}, { mods: { powerMult: mh.ranks[1].powerMult, 'crater.radius': mh.ranks[1].craterRadius } }],
      unlock: { level: mh.unlockLevel },
    }),
    tech('pursuit', {
      cost: { ora: T.pursuit.ora, surge: 0 },
      timeline: { windup: 0, active: 0.14, recover: 0.06, cancelFrom: 0 },
      anim: { windup: 'flicker', active: 'flicker', recover: 'fly_hover' },
      move: { lock: 'none', turn: true, air: true, ground: true },
      motion: { kind: 'toTarget', t: 0, seconds: 0.12, dist: 60 },
      fx: { color: 'ora', active: 'flicker_in' }, sfx: { active: 'flicker_in' },
    }),
    tech('ora_bolt', {
      branch: 'flare', rating: 'ora', cost: { ora: bolt.ora, surge: 0 }, cooldown: bolt.cooldown,
      timeline: { windup: 0.03, active: 0.03, recover: 0.1, cancelFrom: 0 },
      anim: { windup: 'cast', active: 'cast', recover: 'idle' },
      move: { lock: 'none', turn: true, air: true, ground: true },
      projectiles: [shot({ speed: boltSpeed, life: bolt.falloff.endRange / boltSpeed + 0.1, power: bolt.power, poise: bolt.poise, spreadDeg: 7 })],
      fx: { color: 'ora', active: 'muzzle', hit: 'bolt_hit' }, sfx: { active: 'bolt_fire', hit: 'bolt_hit' },
      ranks: [{}, { mods: { 'projectiles.0.count': bolt.ranks[1].count, powerMult: bolt.ranks[1].powerMult } }, { mods: { 'projectiles.0.pierce': bolt.ranks[2].pierce } }],
    }),
    tech('flare_barrage', {
      slot: 'slot', branch: 'flare', icon: 'barrage', rating: 'ora', cost: { ora: fb.oraPerBolt, surge: 0 }, cooldown: fb.cooldown,
      timeline: { windup: 0.12, active: fb.seconds, recover: 0.25, cancelFrom: 0.1 },
      anim: { windup: 'cast', active: 'cast_loop', recover: 'idle' },
      move: { lock: 'slow', turn: true, air: true, ground: true },
      projectiles: [
        shot({ every: 1 / fb.boltsPerSec, until: fb.seconds - 0.01, spreadDeg: 12, speed: 70, life: 1.3, homing: 5, power: fb.power, poise: fb.poise }),
        shot({ t: fb.seconds - 0.02, count: 0, speed: 60, radius: 0.8, life: 1.6, homing: 6, power: fb.ranks[1].finalBolt.power, poise: 12,
          knock: fb.ranks[1].finalBolt.knock, feel: 'heavyHit' }),
      ],
      fx: { color: 'ora', active: 'muzzle', hit: 'bolt_hit' }, sfx: { active: 'bolt_fire', hit: 'bolt_hit' },
      ranks: [{}, { mods: { 'projectiles.1.count': 1 } }], unlock: { level: fb.unlockLevel },
    }),
    tech('dawn_lance', {
      slot: 'slot', branch: 'flare', icon: 'beam', rating: 'ora', cost: { ora: dl.ora, surge: 0 }, cooldown: dl.cooldown,
      charge: { min: dl.charge.min, max: dl.charge.max, maxMult: dl.charge.maxMult, oraPerSec: dl.charge.oraPerSec, moveSlow: 0.2 },
      timeline: { windup: 0.15, active: dl.beam.seconds, recover: 0.4, cancelFrom: 0.2 },
      anim: { windup: 'beam_charge', active: 'beam_loop', recover: 'beam_end' },
      move: { lock: 'slow', turn: true, air: true, ground: true },
      beam: { range: dl.beam.range, radius: dl.beam.radius, tick: dl.beam.tick, power: dl.beam.power, poise: dl.beam.poise, knock: dl.beam.knock, feel: 'beamTick' },
      fx: { color: 'ora', windup: 'beam_charge', hit: 'beam_hit' }, sfx: { windup: 'beam_charge', loop: 'beam_loop', end: 'beam_end' },
      ranks: [{}, { mods: { 'beam.radius': dl.ranks[1].beamRadius } }, { mods: { powerMult: dl.ranks[2].powerMult } }],
      unlock: { quest: dl.unlockQuest },
    }),
    tech('nova_ring', {
      slot: 'slot', branch: 'flare', icon: 'nova', rating: 'ora', cost: { ora: nova.ora, surge: 0 }, cooldown: nova.cooldown,
      timeline: { windup: 0.28, active: 0.1, recover: 0.36, cancelFrom: 0.2 },
      anim: { windup: 'burst', active: 'burst', recover: 'idle' },
      move: { lock: 'root', turn: false, air: true, ground: true },
      hits: [hit({ shape: 'ring', f: 0, u: 0.6, radius: nova.radius, power: nova.power, poise: nova.poise, knock: nova.knock, feel: 'burst', maxTargets: 16,
        burn: { power: nova.ranks[2].burn.power, every: nova.ranks[2].burn.every, seconds: 0 } })],
      fx: { color: 'ora', windup: 'beam_charge', active: 'nova', hit: 'hit_heavy' }, sfx: { windup: 'beam_charge', active: 'nova', hit: 'hit_heavy' },
      ranks: [{}, { mods: { 'hits.0.radius': nova.ranks[1].radius } }, { mods: { 'hits.0.burn.seconds': nova.ranks[2].burn.seconds } }],
      unlock: { quest: nova.unlockQuest },
    }),
    tech('ringfall', {
      slot: 'ultimate', branch: 'flare', icon: 'ultimate', rating: 'ora', cost: { ora: 0, surge: rf.surge }, cooldown: rf.cooldown,
      timeline: { windup: 1.05, active: 0.42, recover: 0.75, cancelFrom: -1 },
      anim: { windup: 'ult_rise', active: 'ult_dive', recover: 'land' },
      move: { lock: 'root', turn: false, air: true, ground: true },
      motion: { kind: 'rise', t: 0, seconds: 0.55, dist: 11 },
      hits: [hit({ t: 0.26, shape: 'ring', f: 0, u: 0.6, radius: rf.radius, power: rf.powerCentre, edgePower: rf.powerEdge, poise: rf.poise, knock: rf.knock,
        feel: 'heavyHit', maxTargets: 32, unblockable: true })],
      crater: { radius: rf.crater.radius, depth: rf.crater.depth, at: 'self' }, invulnerable: true, script: 'ringfall',
      fx: { color: 'ora', windup: 'ult_rise', active: 'ult_impact', hit: 'hit_finisher' }, sfx: { windup: 'ult_rise', active: 'ult_impact', hit: 'hit_finisher' },
      ranks: [{}, { mods: { powerMult: rf.ranks[1].powerMult } }], unlock: { quest: rf.unlockQuest },
    }),
    tech('guard', {
      branch: 'spirit', icon: 'guard', timeline: { windup: 0, active: 0, recover: 0, cancelFrom: 0 },
      anim: { windup: 'guard', active: 'guard', recover: 'idle' }, move: { lock: 'slow', turn: true, air: true, ground: true },
      fx: { color: 'ora', active: 'guard_shell', hit: 'guard_block' }, sfx: { active: 'guard_on', hit: 'guard_block' },
    }),
    tech('flicker_step', {
      branch: 'spirit', icon: 'flicker', cost: { ora: fl.ora, surge: 0 }, cooldown: fl.cooldown,
      timeline: { windup: 0, active: 0.12, recover: 0.08, cancelFrom: 0 },
      anim: { windup: 'flicker', active: 'flicker', recover: 'idle' },
      move: { lock: 'none', turn: false, air: true, ground: true },
      motion: { kind: 'lunge', t: 0, seconds: 0.12, dist: fl.dist }, invulnerable: true,
      fx: { color: 'ora', active: 'flicker_out' }, sfx: { active: 'flicker_out' },
      ranks: [{}, { mods: { 'cost.ora': fl.ranks[1].ora } }],
    }),
    tech('boost', {
      branch: 'spirit', icon: 'boost', timeline: { windup: 0, active: 0, recover: 0, cancelFrom: 0 },
      anim: { windup: 'fly_boost', active: 'fly_boost', recover: 'fly_cruise' }, move: { lock: 'none', turn: true, air: true, ground: false },
      fx: { color: 'ora', active: 'boost_trail' }, sfx: { active: 'boost_start' },
    }),
    tech('gather', {
      branch: 'spirit', icon: 'gather', timeline: { windup: 0, active: 0, recover: 0, cancelFrom: 0 },
      anim: { windup: 'gather', active: 'gather', recover: 'idle' }, move: { lock: 'slow', turn: false, air: true, ground: true },
      fx: { color: 'ora', active: 'aura' }, sfx: { loop: 'gather_loop', end: 'gather_full' },
      ranks: [{}, {}], unlock: { quest: T.gather.unlockQuest },
    }),
  ];
}

/** Ids of the techniques this package owns (the P0 player techniques of IDS). */
export const PLAYER_TECH_IDS = Object.freeze(['strike_string', 'breaker', 'meteor_heel', 'pursuit', 'ora_bolt', 'flare_barrage', 'dawn_lance',
  'nova_ring', 'ringfall', 'guard', 'flicker_step', 'boost', 'gather']);
