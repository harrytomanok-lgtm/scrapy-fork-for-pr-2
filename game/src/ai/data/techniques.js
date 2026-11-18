/**
 * Enemy and boss techniques (ARCHITECTURE 5.1; GDD 6.5, 7.2, 7.3). Every attack has a telegraph: white
 * (blockable), red (unblockable: Flicker Step) or violet (grab or Ora drain). Powers and enemy windups come from
 * BALANCE.enemyTech; the boss numbers (not in BALANCE) are written here inside the 0.8-2.0 s boss windup band.
 *
 * Extension of the 5.1 `ai` block used by the ai brains (all optional):
 * - `token`: 'melee' | 'ranged', the attack token the move needs (GDD 6.7);
 * - `vsAir`: the move can reach a target hovering out of reach (ground-versus-flyer rule, GDD 6.6);
 * - `airOnly`: only used against an airborne target (the rock throw);
 * - `alone`: only used when no ally is near (the wisp dive).
 * Pure data: Node tests load it.
 * @module ai/data/techniques
 */

import { BALANCE } from '../../core/balance.js';
import { PALETTE } from '../../core/palette.js';

const ET = BALANCE.enemyTech;
const NONE = Object.freeze({ kind: 'none' });

const FX = {
  white: { color: PALETTE.hostile, windup: 'tele_white', hit: 'hit_light' },
  red: { color: PALETTE.hostile, windup: 'tele_red', hit: 'hit_heavy' },
  violet: { color: PALETTE.hostile, windup: 'tele_violet', hit: 'hit_light' },
};
const SFX = {
  white: { windup: 'tele_white', active: 'whoosh', hit: 'hit_light' },
  red: { windup: 'tele_red', active: 'whoosh', hit: 'hit_heavy' },
  violet: { windup: 'tele_violet', hit: 'hit_light' },
};

/**
 * A complete enemy TechniqueDef with defaults.
 * @param {string} id @param {'white'|'red'|'violet'} kind @param {object} o
 */
function etech(id, kind, o) {
  const d = Object.assign({
    id, user: 'enemy', slot: 'enemy', icon: 'enemy', rating: 'melee',
    cost: { ora: 0, surge: 0 }, cooldown: 2, charge: null,
    timeline: { windup: 0.6, active: 0.12, recover: 0.5, cancelFrom: -1 },
    anim: { windup: 'charge_windup', active: 'bite', recover: 'idle' },
    telegraph: { kind, shape: 'self', radius: 0, atTarget: false },
    move: { lock: 'root', turn: true, air: true, ground: true },
    motion: null, hits: [], projectiles: [], beam: null, chain: null, crater: null,
    invulnerable: false, script: null,
    fx: FX[kind], sfx: SFX[kind],
    ranks: [{}], unlock: {},
  }, o);
  d.ai = Object.assign({ minRange: 0, maxRange: 2.8, weight: 1, cooldown: 2, token: 'melee', vsAir: false }, o.ai || {});
  return d;
}

/** @param {object} o @returns {object} HitDef */
function hit(o) {
  return Object.assign({ t: 0, shape: 'sphere', f: 1.3, u: 0.9, radius: 1.7, power: 1, poise: 8, knock: NONE, feel: 'lightHit', maxTargets: 2 }, o);
}

/** @param {object} o @returns {object} ProjectileDef */
function shot(o) {
  return Object.assign({
    t: 0, count: 1, spreadDeg: 0, speed: 26, radius: 0.45, life: 2.2, homing: 1.2, gravity: 0, pierce: 0,
    power: 0.6, poise: 4, knock: NONE, feel: 'lightHit', fxId: 'bolt', socket: 'head',
  }, o);
}

/** Feel class of an enemy hit by power. @param {number} p */
const feel = (p) => (p >= 1.3 ? 'heavyHit' : 'lightHit');

/** Timed hits of a string. @param {number[]} powers @param {number} every @param {object} [extra] */
function stringHits(powers, every, extra) {
  return powers.map((p, i) => hit(Object.assign({ t: i * every, power: p, poise: i === powers.length - 1 ? 14 : 6,
    knock: i === powers.length - 1 ? { kind: 'push', speed: 8 } : NONE, feel: i === powers.length - 1 ? 'heavyHit' : 'lightHit' }, extra || {})));
}

/** The nine enemies' techniques (GDD 7.2) plus the ground rock throw against flyers. */
export function enemyTechniques() {
  return [
    // Ember Wisp
    etech('wisp_spit', 'white', {
      rating: 'ora', cooldown: 2.8, timeline: { windup: ET.wisp_spit.windup, active: 0.1, recover: 0.6, cancelFrom: -1 },
      anim: { windup: 'ranged', active: 'ranged', recover: 'idle' }, move: { lock: 'slow', turn: true, air: true, ground: true },
      projectiles: [shot({ speed: 17, radius: 0.55, life: 3.2, homing: 0.9, power: ET.wisp_spit.power, socket: 'chest' })],
      ai: { minRange: 3, maxRange: 26, weight: 3, cooldown: 2.8, token: 'ranged', vsAir: true },
    }),
    etech('wisp_dive', 'red', {
      cooldown: 6, timeline: { windup: ET.wisp_dive.windup, active: 0.5, recover: 0.3, cancelFrom: -1 },
      anim: { windup: 'charge_windup', active: 'charge', recover: 'idle' },
      telegraph: { kind: 'red', shape: 'line', radius: 20, atTarget: false },
      motion: { kind: 'dive', t: ET.wisp_dive.windup, seconds: 0.35, dist: 24 },
      hits: [hit({ t: 0.35, shape: 'ring', f: 0, radius: 2.8, power: ET.wisp_dive.power, poise: 16, knock: { kind: 'radial', speed: 12 }, feel: 'heavyHit', maxTargets: 4 })],
      script: 'ai_self_destruct',
      ai: { minRange: 3, maxRange: 20, weight: 4, cooldown: 6, token: 'melee', vsAir: true, alone: true },
    }),
    // Tusk Boar (and the Bramble Boar)
    etech('boar_gore', 'white', {
      cooldown: 1.6, timeline: { windup: ET.boar_gore.windup, active: 0.12, recover: 0.5, cancelFrom: -1 },
      anim: { windup: 'charge_windup', active: 'bite', recover: 'idle' },
      motion: { kind: 'toTarget', t: ET.boar_gore.windup - 0.12, seconds: 0.12, dist: 3, speed: 24 },
      hits: [hit({ power: ET.boar_gore.power, poise: 10, knock: { kind: 'push', speed: 7 }, feel: feel(ET.boar_gore.power) })],
      ai: { minRange: 0, maxRange: 3.2, weight: 2, cooldown: 1.6 },
    }),
    etech('boar_charge', 'white', {
      cooldown: 4, timeline: { windup: ET.boar_charge.windup, active: 0.75, recover: 0.7, cancelFrom: -1 },
      anim: { windup: 'charge_windup', active: 'charge', recover: 'idle' },
      telegraph: { kind: 'white', shape: 'line', radius: ET.boar_charge.dist, atTarget: false },
      motion: { kind: 'charge', t: ET.boar_charge.windup, seconds: 0.7, dist: ET.boar_charge.dist },
      hits: [hit({ t: 0, every: 0.1, until: 0.7, f: 1.0, radius: 1.9, power: ET.boar_charge.power, poise: 18, knock: ET.boar_charge.knock, feel: 'heavyHit', maxTargets: 1 })],
      ai: { minRange: 6, maxRange: ET.boar_charge.dist - 2, weight: 4, cooldown: 4 },
    }),
    etech('boar_charge_red', 'red', {
      cooldown: 7, timeline: { windup: 0.7, active: 0.75, recover: 0.9, cancelFrom: -1 },
      anim: { windup: 'charge_windup', active: 'charge', recover: 'idle' },
      telegraph: { kind: 'red', shape: 'line', radius: ET.boar_charge.dist, atTarget: false },
      motion: { kind: 'charge', t: 0.7, seconds: 0.7, dist: ET.boar_charge.dist },
      hits: [hit({ t: 0, every: 0.1, until: 0.7, f: 1.0, radius: 1.9, power: ET.boar_charge.power, poise: 20, knock: ET.boar_charge.knock, feel: 'heavyHit', maxTargets: 1 })],
      ai: { minRange: 4, maxRange: ET.boar_charge.dist - 2, weight: 2, cooldown: 7 },
    }),
    // Choir Acolyte
    etech('acolyte_string', 'white', {
      cooldown: 2, timeline: { windup: ET.acolyte_string.windup, active: 0.75, recover: 0.55, cancelFrom: -1 },
      anim: { windup: 'charge_windup', active: 'slam', recover: 'idle' },
      motion: { kind: 'toTarget', t: ET.acolyte_string.windup - 0.1, seconds: 0.12, dist: 3.5, speed: 26 },
      hits: stringHits(ET.acolyte_string.powers, 0.3),
      ai: { minRange: 0, maxRange: 3.6, weight: 3, cooldown: 2 },
    }),
    etech('acolyte_rush', 'red', {
      cooldown: 5, timeline: { windup: ET.acolyte_rush.windup, active: 0.4, recover: 0.7, cancelFrom: -1 },
      anim: { windup: 'charge_windup', active: 'charge', recover: 'idle' },
      telegraph: { kind: 'red', shape: 'line', radius: 9, atTarget: false },
      motion: { kind: 'charge', t: ET.acolyte_rush.windup, seconds: 0.32, dist: 9 },
      hits: [hit({ t: 0, every: 0.1, until: 0.32, f: 0.9, radius: 1.8, power: ET.acolyte_rush.power, poise: 18, knock: { kind: 'push', speed: 12 }, feel: 'heavyHit', maxTargets: 1 })],
      ai: { minRange: 3, maxRange: 9, weight: 2, cooldown: 5 },
    }),
    // Choir Caster
    etech('caster_volley', 'white', {
      rating: 'ora', cooldown: 2.4, timeline: { windup: ET.caster_volley.windup, active: 0.5, recover: 0.5, cancelFrom: -1 },
      anim: { windup: 'cast', active: 'ranged', recover: 'idle' }, move: { lock: 'slow', turn: true, air: true, ground: true },
      projectiles: [shot({ every: 0.2, until: 0.42, speed: 30, homing: 1.4, power: ET.caster_volley.power, socket: 'handR' })],
      ai: { minRange: 6, maxRange: 34, weight: 3, cooldown: 2.4, token: 'ranged', vsAir: true },
    }),
    etech('caster_tether', 'violet', {
      rating: 'ora', cooldown: 8, timeline: { windup: ET.caster_tether.windup, active: ET.caster_tether.seconds, recover: 0.5, cancelFrom: -1 },
      anim: { windup: 'cast', active: 'cast_loop', recover: 'idle' }, move: { lock: 'root', turn: true, air: true, ground: true },
      telegraph: { kind: 'violet', shape: 'line', radius: 30, atTarget: false },
      script: 'ai_tether',
      ai: { minRange: 5, maxRange: 28, weight: 1, cooldown: 8, token: 'ranged', vsAir: true, drain: ET.caster_tether.drainPerSec },
    }),
    // Scuttlecrab
    etech('crab_pinch', 'white', {
      cooldown: 1.6, timeline: { windup: ET.crab_pinch.windup, active: 0.12, recover: 0.45, cancelFrom: -1 },
      anim: { windup: 'charge_windup', active: 'bite', recover: 'idle' },
      hits: [hit({ power: ET.crab_pinch.power, poise: 10, knock: { kind: 'push', speed: 6 }, feel: feel(ET.crab_pinch.power) })],
      ai: { minRange: 0, maxRange: 3, weight: 3, cooldown: 1.6 },
    }),
    etech('crab_slam', 'red', {
      cooldown: 5, timeline: { windup: ET.crab_slam.windup, active: 0.12, recover: 0.8, cancelFrom: -1 },
      anim: { windup: 'charge_windup', active: 'slam', recover: 'idle' },
      telegraph: { kind: 'red', shape: 'circle', radius: ET.crab_slam.radius, atTarget: false },
      hits: [hit({ shape: 'ring', f: 0, radius: ET.crab_slam.radius, power: ET.crab_slam.power, poise: 20, knock: { kind: 'radial', speed: 14 }, feel: 'heavyHit', maxTargets: 4 })],
      ai: { minRange: 0, maxRange: ET.crab_slam.radius - 0.5, weight: 2, cooldown: 5 },
    }),
    // Rust Golem
    etech('golem_hammer', 'white', {
      cooldown: 2.4, timeline: { windup: ET.golem_hammer.windup, active: 0.65, recover: 0.7, cancelFrom: -1 },
      anim: { windup: 'charge_windup', active: 'slam', recover: 'idle' },
      motion: { kind: 'toTarget', t: ET.golem_hammer.windup - 0.15, seconds: 0.15, dist: 3, speed: 18 },
      hits: stringHits(ET.golem_hammer.powers, 0.5, { radius: 2.4, f: 1.8, u: 1.2 }),
      ai: { minRange: 0, maxRange: 4.2, weight: 3, cooldown: 2.4 },
    }),
    etech('golem_stomp', 'red', {
      cooldown: 6, timeline: { windup: ET.golem_stomp.windup, active: 0.15, recover: 0.9, cancelFrom: -1 },
      anim: { windup: 'charge_windup', active: 'slam', recover: 'idle' },
      telegraph: { kind: 'red', shape: 'circle', radius: ET.golem_stomp.radius, atTarget: false },
      // Jumpable: the shockwave hugs the ground (u 0.3, short radius in height).
      hits: [hit({ shape: 'ring', f: 0, u: 0.3, radius: ET.golem_stomp.radius, power: ET.golem_stomp.power, poise: 24, knock: { kind: 'launch', up: 10 }, feel: 'heavyHit', maxTargets: 4 })],
      ai: { minRange: 0, maxRange: ET.golem_stomp.radius - 1.5, weight: 2, cooldown: 6 },
    }),
    etech('golem_boulder', 'white', {
      rating: 'melee', cooldown: 3.5, timeline: { windup: ET.golem_boulder.windup, active: 0.15, recover: 0.7, cancelFrom: -1 },
      anim: { windup: 'charge_windup', active: 'ranged', recover: 'idle' },
      projectiles: [shot({ speed: 30, radius: 1.0, life: 2.4, homing: 0.7, power: ET.golem_boulder.power, poise: 14, knock: { kind: 'push', speed: 10 }, feel: 'heavyHit', socket: 'handR' })],
      ai: { minRange: 5, maxRange: 45, weight: 3, cooldown: 3.5, token: 'ranged', vsAir: true, airOnly: true },
    }),
    // Frost Harrier
    etech('harrier_dive', 'red', {
      cooldown: 5, timeline: { windup: ET.harrier_dive.windup, active: 0.6, recover: 0.6, cancelFrom: -1 },
      anim: { windup: 'charge_windup', active: 'charge', recover: 'idle' },
      telegraph: { kind: 'red', shape: 'line', radius: 30, atTarget: false },
      motion: { kind: 'dive', t: ET.harrier_dive.windup, seconds: 0.45, dist: 45 },
      hits: [hit({ t: 0.42, shape: 'ring', f: 0, radius: 2.6, power: ET.harrier_dive.power, poise: 18, knock: { kind: 'smash', speed: 22 }, feel: 'heavyHit', maxTargets: 2 })],
      ai: { minRange: 6, maxRange: 42, weight: 3, cooldown: 5, token: 'melee', vsAir: true },
    }),
    etech('harrier_gust', 'white', {
      rating: 'ora', cooldown: 2.6, timeline: { windup: ET.harrier_gust.windup, active: 0.15, recover: 0.5, cancelFrom: -1 },
      anim: { windup: 'ranged', active: 'ranged', recover: 'idle' }, move: { lock: 'slow', turn: true, air: true, ground: true },
      projectiles: [shot({ speed: 34, radius: 1.1, life: 1.6, homing: 0.6, power: ET.harrier_gust.power, knock: { kind: 'push', speed: 9 } })],
      ai: { minRange: 6, maxRange: 32, weight: 2, cooldown: 2.6, token: 'ranged', vsAir: true },
    }),
    // Choir Vanguard (duelist)
    etech('vanguard_string', 'white', {
      cooldown: 2.2, timeline: { windup: ET.vanguard_string.windup, active: 0.95, recover: 0.5, cancelFrom: -1 },
      anim: { windup: 'charge_windup', active: 'slam', recover: 'idle' },
      motion: { kind: 'toTarget', t: ET.vanguard_string.windup - 0.1, seconds: 0.12, dist: 5, speed: 34 },
      hits: stringHits(ET.vanguard_string.powers, 0.28),
      ai: { minRange: 0, maxRange: 5, weight: 3, cooldown: 2.2, vsAir: true },
    }),
    etech('vanguard_lance', 'white', {
      rating: 'ora', cooldown: 7, timeline: { windup: ET.vanguard_lance.chargeSeconds, active: 1.0, recover: 0.6, cancelFrom: -1 },
      anim: { windup: 'beam_charge', active: 'beam_loop', recover: 'beam_end' },
      telegraph: { kind: 'white', shape: 'line', radius: 40, atTarget: false },
      beam: { range: 40, radius: 0.9, tick: ET.vanguard_lance.tick, power: ET.vanguard_lance.tickPower, poise: 2, knock: NONE, feel: 'beamTick' },
      fx: { color: PALETTE.hostile, windup: 'beam_charge', hit: 'beam_hit' },
      sfx: { windup: 'beam_charge', loop: 'beam_loop', end: 'beam_end' },
      ai: { minRange: 8, maxRange: 36, weight: 2, cooldown: 7, token: 'ranged', vsAir: true },
    }),
    etech('vanguard_smash', 'red', {
      cooldown: 6, timeline: { windup: ET.vanguard_smash.windup, active: 0.15, recover: 0.8, cancelFrom: -1 },
      anim: { windup: 'charge_windup', active: 'slam', recover: 'idle' },
      telegraph: { kind: 'red', shape: 'circle', radius: 3.5, atTarget: false },
      motion: { kind: 'toTarget', t: ET.vanguard_smash.windup - 0.15, seconds: 0.15, dist: 6, speed: 30 },
      hits: [hit({ shape: 'ring', f: 0, radius: 3.5, power: ET.vanguard_smash.power, poise: 24, knock: { kind: 'smash', speed: 26 }, feel: 'heavyHit', maxTargets: 2 })],
      ai: { minRange: 0, maxRange: 6, weight: 2, cooldown: 6, vsAir: true },
    }),
    // Ground-only enemies against a flyer (GDD 6.6): a thrown rock.
    etech('enemy_rock', 'white', {
      cooldown: 3, timeline: { windup: 0.8, active: 0.12, recover: 0.6, cancelFrom: -1 },
      anim: { windup: 'charge_windup', active: 'ranged', recover: 'idle' },
      projectiles: [shot({ speed: 28, radius: 0.6, life: 2.2, homing: 0.8, power: 0.7, poise: 6, socket: 'handR' })],
      ai: { minRange: 3, maxRange: 40, weight: 3, cooldown: 3, token: 'ranged', vsAir: true, airOnly: true },
    }),
  ];
}

/** Boss techniques (GDD 7.3). Boss windups lie in 0.8-2.0 s. */
export function bossTechniques() {
  const BB = BALANCE.bosses;
  return [
    // Captain Durn
    etech('durn_string', 'white', {
      cooldown: 1.8, timeline: { windup: 0.8, active: 1.0, recover: 0.6, cancelFrom: -1 },
      anim: { windup: 'charge_windup', active: 'slam', recover: 'idle' },
      motion: { kind: 'toTarget', t: 0.7, seconds: 0.14, dist: 5, speed: 30 },
      hits: stringHits([0.6, 0.6, 0.7, 1.0], 0.28, { radius: 2 }),
      ai: { minRange: 0, maxRange: 4.5, weight: 3, cooldown: 1.8 },
    }),
    etech('durn_charge', 'red', {
      cooldown: 5, timeline: { windup: 1.0, active: 0.45, recover: 0.9, cancelFrom: -1 },
      anim: { windup: 'charge_windup', active: 'charge', recover: 'idle' },
      telegraph: { kind: 'red', shape: 'line', radius: 14, atTarget: false },
      motion: { kind: 'charge', t: 1.0, seconds: 0.4, dist: 14 },
      hits: [hit({ t: 0, every: 0.1, until: 0.4, f: 1, radius: 2, power: 1.4, poise: 20, knock: { kind: 'smash', speed: 24 }, feel: 'heavyHit', maxTargets: 1 })],
      ai: { minRange: 3, maxRange: 13, weight: 2, cooldown: 5 },
    }),
    // Bramblehorn
    etech('bh_horn_charge', 'white', {
      cooldown: 3.5, timeline: { windup: 1.1, active: 1.0, recover: 1.0, cancelFrom: -1 },
      anim: { windup: 'charge_windup', active: 'charge', recover: 'idle' },
      telegraph: { kind: 'white', shape: 'line', radius: 30, atTarget: false },
      motion: { kind: 'charge', t: 1.1, seconds: 0.95, dist: 30 },
      hits: [hit({ t: 0, every: 0.1, until: 0.95, f: 1.6, radius: 3, power: 1.3, poise: 24, knock: { kind: 'smash', speed: 28 }, feel: 'heavyHit', maxTargets: 1 })],
      script: 'ai_furrow',
      ai: { minRange: 6, maxRange: 30, weight: 3, cooldown: 3.5 },
    }),
    etech('bh_antler_sweep', 'white', {
      cooldown: 2.2, timeline: { windup: 0.9, active: 0.2, recover: 0.7, cancelFrom: -1 },
      anim: { windup: 'charge_windup', active: 'slam', recover: 'idle' },
      telegraph: { kind: 'white', shape: 'cone', radius: 6, atTarget: false },
      hits: [hit({ shape: 'cone', angle: 200, f: 0, radius: 6.5, power: 1.1, poise: 16, knock: { kind: 'push', speed: 12 }, feel: 'heavyHit', maxTargets: 2 })],
      ai: { minRange: 0, maxRange: 6, weight: 3, cooldown: 2.2 },
    }),
    etech('bh_root_lines', 'red', {
      cooldown: 6, timeline: { windup: 1.2, active: 0.8, recover: 0.6, cancelFrom: -1 },
      anim: { windup: 'roar', active: 'slam', recover: 'idle' },
      telegraph: { kind: 'red', shape: 'cone', radius: 30, atTarget: false },
      script: 'ai_root_lines',
      ai: { minRange: 4, maxRange: 32, weight: 3, cooldown: 6, power: 1.4 },
    }),
    etech('bh_wall_leap', 'red', {
      cooldown: 8, timeline: { windup: 1.4, active: 0.2, recover: 1.1, cancelFrom: -1 },
      anim: { windup: 'charge_windup', active: 'slam', recover: 'getup' },
      telegraph: { kind: 'red', shape: 'circle', radius: BB.bramblehorn.craterRadius, atTarget: true },
      motion: { kind: 'leap', t: 0.5, seconds: 0.9, dist: 60 },
      hits: [hit({ shape: 'ring', f: 0, radius: BB.bramblehorn.craterRadius, power: 1.6, poise: 30, knock: { kind: 'launch', up: 12 }, feel: 'heavyHit', maxTargets: 2 })],
      crater: { radius: BB.bramblehorn.craterRadius, depth: 2, at: 'self' },
      ai: { minRange: 10, maxRange: 55, weight: 2, cooldown: 8 },
    }),
    // Gorrumaw
    etech('gm_roll', 'white', {
      cooldown: 3.5, timeline: { windup: 1.0, active: 1.2, recover: 0.9, cancelFrom: -1 },
      anim: { windup: 'charge_windup', active: 'hurtle', recover: 'getup' },
      telegraph: { kind: 'white', shape: 'line', radius: 34, atTarget: false },
      motion: { kind: 'charge', t: 1.0, seconds: 1.1, dist: 34 },
      hits: [hit({ t: 0, every: 0.1, until: 1.1, f: 1.2, radius: 3.2, power: 1.0, poise: 22, knock: { kind: 'smash', speed: 26 }, feel: 'heavyHit', maxTargets: 1 })],
      ai: { minRange: 8, maxRange: 34, weight: 3, cooldown: 3.5 },
    }),
    etech('gm_quake', 'red', {
      cooldown: 5, timeline: { windup: 1.4, active: 0.2, recover: 1.0, cancelFrom: -1 },
      anim: { windup: 'roar', active: 'slam', recover: 'idle' },
      telegraph: { kind: 'red', shape: 'circle', radius: 11, atTarget: false },
      hits: [hit({ shape: 'ring', f: 0, u: 0.4, radius: 11, power: 1.3, poise: 26, knock: { kind: 'launch', up: 12 }, feel: 'heavyHit', maxTargets: 2 })],
      ai: { minRange: 0, maxRange: 9, weight: 3, cooldown: 5 },
    }),
    etech('gm_berserk', 'white', {
      cooldown: 2, timeline: { windup: 0.8, active: 1.25, recover: 0.6, cancelFrom: -1 },
      anim: { windup: 'charge_windup', active: 'slam', recover: 'idle' },
      motion: { kind: 'toTarget', t: 0.7, seconds: 0.15, dist: 7, speed: 30 },
      hits: stringHits([0.7, 0.7, 0.8, 1.1], 0.32, { radius: 3, f: 2 }),
      ai: { minRange: 0, maxRange: 6.5, weight: 3, cooldown: 2 },
    }),
    etech('gm_rock_rain', 'red', {
      cooldown: 7, timeline: { windup: 1.0, active: 1.6, recover: 0.6, cancelFrom: -1 },
      anim: { windup: 'roar', active: 'roar', recover: 'idle' },
      telegraph: { kind: 'red', shape: 'self', radius: 0, atTarget: false },
      script: 'ai_rain',
      ai: { minRange: 0, maxRange: 60, weight: 2, cooldown: 7, power: 1.1, count: 7, radius: 4 },
    }),
    // Iskra Pale-Wing
    etech('ik_blade_string', 'white', {
      cooldown: 1.8, timeline: { windup: 0.8, active: 0.8, recover: 0.5, cancelFrom: -1 },
      anim: { windup: 'charge_windup', active: 'slam', recover: 'idle' },
      motion: { kind: 'toTarget', t: 0.65, seconds: 0.15, dist: 9, speed: 40 },
      hits: stringHits([0.8, 0.8, 1.1], 0.28, { radius: 2.2 }),
      ai: { minRange: 0, maxRange: 8, weight: 3, cooldown: 1.8, vsAir: true },
    }),
    etech('ik_flicker_slash', 'white', {
      cooldown: 4, timeline: { windup: 0.9, active: 0.2, recover: 0.5, cancelFrom: -1 },
      anim: { windup: 'charge_windup', active: 'slam', recover: 'idle' },
      motion: { kind: 'behindTarget', t: 0.75, seconds: 0.08, dist: 30 },
      hits: [hit({ t: 0.05, radius: 2.4, power: 1.1, poise: 16, knock: { kind: 'push', speed: 12 }, feel: 'heavyHit', maxTargets: 1 })],
      fx: { color: PALETTE.hostile, windup: 'tele_white', active: 'flicker_out', hit: 'hit_heavy' },
      ai: { minRange: 4, maxRange: 28, weight: 2, cooldown: 4, vsAir: true },
    }),
    etech('ik_ice_spears', 'red', {
      cooldown: 6, timeline: { windup: 1.0, active: 1.2, recover: 0.6, cancelFrom: -1 },
      anim: { windup: 'roar', active: 'ranged', recover: 'idle' },
      telegraph: { kind: 'red', shape: 'self', radius: 0, atTarget: false },
      script: 'ai_spears',
      ai: { minRange: 0, maxRange: 60, weight: 3, cooldown: 6, vsAir: true, power: 1.4 },
    }),
    etech('ik_shatterdive', 'red', {
      cooldown: 10, timeline: { windup: 2.0, active: 0.6, recover: 1.2, cancelFrom: -1 },
      anim: { windup: 'fly_cruise', active: 'charge', recover: 'getup' },
      telegraph: { kind: 'red', shape: 'circle', radius: BB.iskra.craterRadius, atTarget: true },
      motion: { kind: 'dive', t: 2.0, seconds: 0.45, dist: 400 },
      hits: [hit({ t: 0.45, shape: 'ring', f: 0, radius: BB.iskra.craterRadius, power: 2.0, poise: 40, knock: { kind: 'launch', up: 14 }, feel: 'heavyHit', maxTargets: 2 })],
      crater: { radius: BB.iskra.craterRadius, depth: 3, at: 'self' },
      script: 'ai_shatterdive',
      ai: { minRange: 0, maxRange: 80, weight: 2, cooldown: 10, vsAir: true, rise: Math.min(60, BB.iskra.diveHeight) },
    }),
    // Vorrhal the Dimmed
    etech('vh_tether', 'violet', {
      rating: 'ora', cooldown: 7, timeline: { windup: 1.0, active: 2.5, recover: 0.6, cancelFrom: -1 },
      anim: { windup: 'cast', active: 'cast_loop', recover: 'idle' },
      telegraph: { kind: 'violet', shape: 'line', radius: 40, atTarget: false },
      script: 'ai_tether',
      ai: { minRange: 4, maxRange: 38, weight: 2, cooldown: 7, vsAir: true, drain: 20 },
    }),
    etech('vh_void_bolts', 'white', {
      rating: 'ora', cooldown: 2.5, timeline: { windup: 0.9, active: 0.8, recover: 0.5, cancelFrom: -1 },
      anim: { windup: 'cast', active: 'ranged', recover: 'idle' },
      projectiles: [shot({ every: 0.16, until: 0.66, speed: 34, radius: 0.5, homing: 1.6, power: 0.5, socket: 'handR' })],
      ai: { minRange: 4, maxRange: 45, weight: 3, cooldown: 2.5, vsAir: true },
    }),
    etech('vh_glass_strike', 'white', {
      cooldown: 2, timeline: { windup: 0.9, active: 0.7, recover: 0.6, cancelFrom: -1 },
      anim: { windup: 'charge_windup', active: 'slam', recover: 'idle' },
      motion: { kind: 'toTarget', t: 0.75, seconds: 0.15, dist: 8, speed: 40 },
      hits: stringHits([0.8, 0.8, 1.1], 0.3, { radius: 2.4 }),
      ai: { minRange: 0, maxRange: 7, weight: 3, cooldown: 2, vsAir: true },
    }),
    etech('vh_spire_crystals', 'red', {
      cooldown: 6, timeline: { windup: 1.2, active: 1.8, recover: 0.6, cancelFrom: -1 },
      anim: { windup: 'cast', active: 'cast_loop', recover: 'idle' },
      telegraph: { kind: 'red', shape: 'self', radius: 0, atTarget: false },
      script: 'ai_rain',
      ai: { minRange: 0, maxRange: 80, weight: 3, cooldown: 6, vsAir: true, power: 1.3, count: 8, radius: 5 },
    }),
  ];
}

/** Every technique ai owns. */
export function aiTechniques() {
  return enemyTechniques().concat(bossTechniques());
}
