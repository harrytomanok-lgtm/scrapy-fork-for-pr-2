/**
 * Stand-in content (ARCHITECTURE 3.8, 8.0): a minimal valid definition for EVERY id of IDS in every defs kind,
 * plus the playable subset used by the smoke test (techniques strike_string, breaker, ora_bolt, flicker_step,
 * guard, nova_ring; form ember; enemies ember_wisp, tusk_boar, choir_acolyte; items sunfruit, training_wraps;
 * quest mq1 with two steps; npc sela; the Ringstone of Sparkstead, which is built by the stand-in quests).
 * Numbers come from BALANCE (no number of the GDD is typed twice). Stand-in enemies and bosses use techniques
 * with a white telegraph; stand-in groups have one member; every actorSpec id is an alias of a generic
 * humanoid or creature spec; the hero specs carry `forms: { ember, tempest, zenith }`; stand-in quests other
 * than mq1 have one `script` step. Regions and landmarks are the world stand-in's GDD tables.
 * Owning packages re-register their ids with the real definitions (re-registering replaces).
 * This module provides no service slot.
 * @module standins/content
 */

import { BALANCE } from '../core/balance.js';
import { IDS } from '../core/ids.js';
import { PALETTE } from '../core/palette.js';
import { REGIONS, LANDMARKS } from './world.js';
import { CONTENT_STRINGS } from './strings.js';

const T = BALANCE.tech;
const NONE = Object.freeze({ kind: 'none' });

/**
 * A complete TechniqueDef (5.1) with stand-in defaults.
 * @param {string} id @param {object} o overrides
 * @returns {object}
 */
function tech(id, o) {
  return Object.assign({
    id, user: 'player', slot: 'core', branch: 'fist', icon: id, rating: 'melee',
    cost: { ora: 0, surge: 0 }, cooldown: 0, charge: null,
    timeline: { windup: 0.08, active: 0.1, recover: 0.2, cancelFrom: 0.1 },
    anim: { windup: 'attack1', active: 'attack1', recover: 'idle' },
    telegraph: null,
    move: { lock: 'slow', turn: true, air: true, ground: true },
    motion: null, hits: [], projectiles: [], beam: null, chain: null, crater: null,
    invulnerable: false, script: null,
    fx: { color: 'ora', hit: 'hit_light' }, sfx: { hit: 'hit_light' },
    ranks: [{}], unlock: { start: true },
  }, o);
}

/** @param {object} o @returns {object} a HitDef with defaults */
function hit(o) {
  return Object.assign({ t: 0, shape: 'sphere', f: 1.1, u: 0.9, radius: 1.5, power: 1, poise: 0, knock: NONE, feel: 'lightHit', maxTargets: 4 }, o);
}

/** @param {object} o @returns {object} a ProjectileDef with defaults */
function shot(o) {
  return Object.assign({
    t: 0, count: 1, spreadDeg: 0, speed: 60, radius: 0.35, life: 1.5, homing: 3, gravity: 0, pierce: 0,
    power: 0.2, poise: 1, knock: NONE, feel: 'boltHit', fxId: 'bolt', socket: 'handR',
  }, o);
}

/** Player techniques of IDS (5.1), numbers from BALANCE.tech. */
function playerTechniques() {
  const ss = T.strike_string;
  const chain = ss.hits.map((h, i) => ({
    timeline: { windup: 0.05, active: 0.08, recover: ss.hitSeconds - 0.13, cancelFrom: 0.04 },
    anim: { windup: 'attack' + (i + 1), active: 'attack' + (i + 1), recover: 'idle' },
    hits: [hit({ power: h.power, poise: h.poise, knock: h.knock || NONE, feel: i === ss.hits.length - 1 ? 'finisher' : 'lightHit' })],
    motion: { kind: 'toTarget', t: 0, seconds: ss.lunge.dist / ss.lunge.speed, dist: ss.lunge.dist },
  }));
  const br = T.breaker;
  const bolt = T.ora_bolt;
  const fb = T.flare_barrage;
  const dl = T.dawn_lance;
  const nova = T.nova_ring;
  const rf = T.ringfall;
  const fl = T.flicker_step;
  const mh = T.meteor_heel;
  return [
    tech('strike_string', {
      timeline: chain[0].timeline, anim: chain[0].anim, hits: chain[0].hits, motion: chain[0].motion, chain,
      ranks: ss.ranks.map(() => ({})),
    }),
    tech('breaker', {
      cooldown: br.cooldown,
      charge: { min: br.charge.min, max: br.charge.max, maxMult: br.charge.maxMult, oraPerSec: 0, moveSlow: 0.3 },
      timeline: { windup: 0.12, active: 0.1, recover: 0.3, cancelFrom: 0.2 },
      anim: { windup: 'heavy_charge', active: 'heavy', recover: 'idle' },
      hits: [hit({ radius: 1.7, power: br.power, poise: br.poise, knock: { kind: 'launch', up: br.launch.up }, feel: 'heavyHit' })],
      fx: { color: 'ora', hit: 'hit_heavy' }, sfx: { hit: 'hit_heavy' },
      ranks: br.ranks.map(() => ({})),
    }),
    tech('meteor_heel', {
      cost: { ora: mh.ora, surge: 0 }, cooldown: mh.cooldown,
      timeline: { windup: 0.15, active: 0.1, recover: 0.35, cancelFrom: 0.25 },
      anim: { windup: 'heavy_charge', active: 'heavy_air', recover: 'land' },
      hits: [hit({ radius: 2, power: mh.power, poise: mh.poise, knock: mh.knock, feel: 'heavyHit' })],
      crater: { radius: mh.crater.radius, depth: 1, at: 'impact' },
      fx: { color: 'ora', hit: 'hit_heavy' }, sfx: { hit: 'hit_heavy' },
      ranks: mh.ranks.map(() => ({})), unlock: { level: mh.unlockLevel },
    }),
    tech('pursuit', {
      cost: { ora: T.pursuit.ora, surge: 0 },
      timeline: { windup: 0, active: 0.15, recover: 0.1, cancelFrom: 0 },
      anim: { windup: 'flicker', active: 'flicker', recover: 'idle' },
      motion: { kind: 'behindTarget', t: 0, seconds: 0.15, dist: 25 },
      fx: { color: 'ora', active: 'flicker_in' }, sfx: { active: 'flicker_in' },
    }),
    tech('ora_bolt', {
      branch: 'flare', rating: 'ora', cost: { ora: bolt.ora, surge: 0 }, cooldown: bolt.cooldown,
      timeline: { windup: 0.04, active: 0.04, recover: 0.12, cancelFrom: 0.04 },
      anim: { windup: 'cast', active: 'cast', recover: 'idle' },
      move: { lock: 'none', turn: true, air: true, ground: true },
      projectiles: [shot({ speed: 70, life: bolt.falloff.endRange / 70, power: bolt.power, poise: bolt.poise })],
      fx: { color: 'ora', active: 'muzzle', hit: 'bolt_hit' }, sfx: { active: 'bolt_fire', hit: 'bolt_hit' },
      ranks: bolt.ranks.map(() => ({})),
    }),
    tech('flare_barrage', {
      slot: 'slot', branch: 'flare', rating: 'ora', cost: { ora: fb.oraPerBolt, surge: 0 }, cooldown: fb.cooldown,
      timeline: { windup: 0.1, active: fb.seconds, recover: 0.2, cancelFrom: 0.1 },
      anim: { windup: 'cast', active: 'cast_loop', recover: 'idle' },
      move: { lock: 'slow', turn: true, air: true, ground: true },
      projectiles: [shot({ every: 1 / fb.boltsPerSec, until: fb.seconds, spreadDeg: 8, power: fb.power, poise: fb.poise })],
      fx: { color: 'ora', active: 'muzzle', hit: 'bolt_hit' }, sfx: { active: 'bolt_fire', hit: 'bolt_hit' },
      ranks: fb.ranks.map(() => ({})), unlock: { level: fb.unlockLevel },
    }),
    tech('dawn_lance', {
      slot: 'slot', branch: 'flare', icon: 'beam', rating: 'ora', cost: { ora: dl.ora, surge: 0 }, cooldown: dl.cooldown,
      charge: { min: dl.charge.min, max: dl.charge.max, maxMult: dl.charge.maxMult, oraPerSec: dl.charge.oraPerSec, moveSlow: 0.2 },
      timeline: { windup: 0.15, active: dl.beam.seconds, recover: 0.4, cancelFrom: 0.2 },
      anim: { windup: 'beam_charge', active: 'beam_loop', recover: 'beam_end' },
      beam: { range: dl.beam.range, radius: dl.beam.radius, tick: dl.beam.tick, power: dl.beam.power, poise: dl.beam.poise, knock: dl.beam.knock, feel: 'beamTick' },
      fx: { color: 'ora', windup: 'beam_charge', hit: 'beam_hit' }, sfx: { windup: 'beam_charge', loop: 'beam_loop', end: 'beam_end' },
      ranks: dl.ranks.map(() => ({})), unlock: { quest: dl.unlockQuest },
    }),
    tech('nova_ring', {
      slot: 'slot', branch: 'flare', rating: 'ora', cost: { ora: nova.ora, surge: 0 }, cooldown: nova.cooldown,
      timeline: { windup: 0.25, active: 0.1, recover: 0.35, cancelFrom: 0.2 },
      anim: { windup: 'burst', active: 'burst', recover: 'idle' },
      move: { lock: 'root', turn: false, air: true, ground: true },
      hits: [hit({ shape: 'ring', f: 0, u: 0.5, radius: nova.radius, power: nova.power, poise: nova.poise, knock: nova.knock, feel: 'burst', maxTargets: 16 })],
      fx: { color: 'ora', active: 'nova', hit: 'hit_heavy' }, sfx: { active: 'nova', hit: 'hit_heavy' },
      ranks: nova.ranks.map(() => ({})), unlock: { quest: nova.unlockQuest },
    }),
    tech('ringfall', {
      slot: 'ultimate', branch: 'flare', rating: 'ora', cost: { ora: 0, surge: rf.surge }, cooldown: rf.cooldown,
      timeline: { windup: 0.8, active: 0.15, recover: 0.6, cancelFrom: -1 },
      anim: { windup: 'ult_rise', active: 'ult_dive', recover: 'land' },
      move: { lock: 'root', turn: false, air: true, ground: true },
      hits: [hit({ shape: 'ring', f: 0, u: 0.5, radius: rf.radius, power: rf.powerCentre, poise: rf.poise, knock: rf.knock, feel: 'ultimate', maxTargets: 32 })],
      crater: { radius: rf.crater.radius, depth: rf.crater.depth, at: 'self' }, invulnerable: true,
      fx: { color: 'ora', windup: 'ult_rise', active: 'ult_impact', hit: 'hit_finisher' }, sfx: { windup: 'ult_rise', active: 'ult_impact' },
      ranks: rf.ranks.map(() => ({})), unlock: { quest: rf.unlockQuest },
    }),
    tech('guard', {
      branch: 'spirit', timeline: { windup: 0, active: 0, recover: 0, cancelFrom: 0 },
      anim: { windup: 'guard', active: 'guard', recover: 'idle' }, move: { lock: 'slow', turn: true, air: true, ground: true },
      fx: { color: 'ora', active: 'guard_shell', hit: 'guard_block' }, sfx: { active: 'guard_on', hit: 'guard_block' },
    }),
    tech('flicker_step', {
      branch: 'spirit', cost: { ora: fl.ora, surge: 0 }, cooldown: fl.cooldown,
      timeline: { windup: 0, active: 0.12, recover: 0.08, cancelFrom: 0 },
      anim: { windup: 'flicker', active: 'flicker', recover: 'idle' },
      move: { lock: 'none', turn: false, air: true, ground: true },
      motion: { kind: 'lunge', t: 0, seconds: 0.12, dist: fl.dist }, invulnerable: true,
      fx: { color: 'ora', active: 'flicker_out' }, sfx: { active: 'flicker_out' },
      ranks: fl.ranks.map(() => ({})),
    }),
    tech('boost', {
      branch: 'spirit', timeline: { windup: 0, active: 0, recover: 0, cancelFrom: 0 },
      anim: { windup: 'fly_boost', active: 'fly_boost', recover: 'fly_cruise' }, move: { lock: 'none', turn: true, air: true, ground: false },
      fx: { color: 'ora', active: 'boost_trail' }, sfx: { active: 'boost_start' },
    }),
    tech('gather', {
      branch: 'spirit', timeline: { windup: 0, active: 0, recover: 0, cancelFrom: 0 },
      anim: { windup: 'gather', active: 'gather', recover: 'idle' }, move: { lock: 'slow', turn: false, air: true, ground: true },
      fx: { color: 'ora', active: 'aura' }, sfx: { loop: 'gather_loop', end: 'gather_full' },
      ranks: T.gather.ranks.map(() => ({})), unlock: { quest: T.gather.unlockQuest },
    }),
  ];
}

/** Ranged enemy techniques (projectiles); the others are one melee hit. */
const RANGED = Object.freeze(['wisp_spit', 'caster_volley', 'caster_tether', 'golem_boulder', 'harrier_gust']);
/** Enemy techniques with a dash at the start of `active`. */
const CHARGES = Object.freeze({ boar_charge: 16, acolyte_rush: 8, wisp_dive: 10, harrier_dive: 12, vanguard_lance: 10 });

/** Enemy techniques of IDS: white telegraph, power from BALANCE.enemyTech. */
function enemyTechniques() {
  const out = [];
  for (const id of IDS.technique) {
    const b = BALANCE.enemyTech[id];
    if (!b) continue;
    const power = typeof b.power === 'number' ? b.power : Array.isArray(b.powers) ? b.powers[0] : typeof b.tickPower === 'number' ? b.tickPower * 4 : 0.5;
    const ranged = RANGED.indexOf(id) >= 0;
    const dash = CHARGES[id] || 0;
    const big = typeof b.radius === 'number';
    out.push(tech(id, {
      user: 'enemy', slot: 'enemy', branch: undefined, icon: 'enemy', rating: ranged ? 'ora' : 'melee',
      timeline: { windup: b.windup, active: dash ? 0.4 : 0.1, recover: 0.5, cancelFrom: -1 },
      anim: { windup: ranged ? 'ranged' : dash ? 'charge_windup' : 'bite', active: ranged ? 'ranged' : dash ? 'charge' : 'bite', recover: 'idle' },
      telegraph: { kind: 'white', shape: big ? 'circle' : 'self', radius: big ? b.radius : 0, atTarget: false },
      move: { lock: 'root', turn: true, air: true, ground: true },
      motion: dash ? { kind: 'charge', t: b.windup, seconds: 0.35, dist: dash } : null,
      hits: ranged ? [] : [hit({ t: dash ? 0.3 : 0, shape: big ? 'ring' : 'sphere', f: big ? 0 : 1.2, radius: big ? b.radius : 1.6, power,
        poise: 10, knock: b.knock || NONE, feel: power >= 1.3 ? 'heavyHit' : 'lightHit', maxTargets: 2 })],
      projectiles: ranged ? [shot({ count: typeof b.count === 'number' ? b.count : 1, spreadDeg: 10, speed: 30, life: 1.6, homing: 1.5, power, poise: 4, socket: 'head' })] : [],
      fx: { color: PALETTE.hostile, windup: 'tele_white', hit: 'hit_light' }, sfx: { windup: 'tele_white', hit: 'hit_light' },
      ranks: [{}], unlock: {},
      ai: { minRange: 0, maxRange: ranged ? 24 : dash ? dash : 2.6, weight: 1, cooldown: 2 },
    }));
  }
  return out;
}

/** Forms of IDS (5.2) from BALANCE.forms. */
function forms() {
  const r = BALANCE.formRules;
  return IDS.form.map((id) => {
    const f = BALANCE.forms[id];
    return {
      id, order: f.order, cost: f.cost, drain: f.drain, hpDrainPct: f.hpDrainPct,
      mult: { dmg: f.mult.dmg, def: f.mult.def, speed: f.mult.speed, res: f.mult.res, surge: f.mult.surge },
      flickerCostMult: f.mods.flickerCostMult, color: PALETTE[id], coreColor: PALETTE.oraCore, auraStyle: id, formKey: id,
      transform: { seconds: r.transformSeconds, shortSeconds: r.shortSeconds, shockRadius: r.shockRadius },
      musicShift: 0, unlock: f.scripted ? { scripted: true } : { quest: f.unlockQuest },
    };
  });
}

/** Items of IDS (5.5): gear from BALANCE.gear, consumables from BALANCE.consumables. */
function items() {
  const cap = BALANCE.economy.carryCap;
  return IDS.item.map((id) => {
    const g = BALANCE.gear[id];
    if (g) {
      const d = { id, type: 'gear', slot: g.slot, rarity: g.rarity, drops: true, icon: g.slot };
      if (g.stats) d.stats = Object.assign({}, g.stats);
      if (g.mods) d.mods = Object.assign({}, g.mods);
      return d;
    }
    const c = BALANCE.consumables[id];
    if (c) {
      return { id, type: 'consumable', effect: Object.assign({}, c.effect), cap, basePrice: c.price.base, pricePerLevel: c.price.perLevel,
        drops: true, icon: id === 'sunfruit' ? 'fruit' : 'draught' };
    }
    return { id, type: 'quest', cap: 99, drops: false, icon: 'core' };
  });
}

/** Shop stock (stand-in): consumables plus a few items of the shop's band. */
const STOCK = Object.freeze({
  dov_stall: ['sunfruit', 'ora_draught', 'apprentice_garb', 'meadow_garb', 'sunfruit_charm'],
  aster_market: ['sunfruit', 'ora_draught', 'racers_wraps', 'tidewoven_garb', 'wind_charm'],
  talia_herbs: ['sunfruit', 'ora_draught'],
  yael_outpost: ['sunfruit', 'ora_draught', 'saltglass_wraps', 'dunewalker_garb', 'tide_charm'],
  ridgerest_provisions: ['sunfruit', 'ora_draught', 'stormcaller_wraps', 'frostweave_garb', 'frost_charm'],
});

/** NPC homes and shops (stand-in placement; sela stands in Sparkstead so the smoke start can reach her). */
const NPCS = Object.freeze({
  sela: ['sparkstead', 'a', null, 300], kerrin: ['sparkstead', 'b', null, 260], dov: ['sparkstead', 'stall', 'dov_stall', 420],
  mira: ['sparkstead', 'c', null, 330], ilan: ['haven_aster', 'a', null, 240], rina: ['haven_aster', 'b', null, 340],
  gal: ['haven_aster', 'c', null, 380], eli: ['haven_aster', 'stall', 'aster_market', 280], bren: ['copperwatch', 'a', null, 200],
  talia: ['talias_camp', 'a', 'talia_herbs', 350], yael: ['tide_beacon', 'a', 'yael_outpost', 360], oren: ['ridgerest', 'a', 'ridgerest_provisions', 230],
  noa: ['still_wind', 'a', null, 320],
});

/** Generic actor specs (5.11); every actorSpec id is an alias of one of these. */
function actorSpecs() {
  const P = PALETTE;
  const human = (id, palette, o) => Object.assign({
    id, rig: 'humanoid', scale: 1, build: { height: 1.8, shoulder: 0.44, bulk: 0.55, head: 1 }, palette, emissive: {},
    parts: [], radius: 0.4, outline: true, face: true,
  }, o);
  const hero = { coat: 0x2f6f8f, coatLining: P.biome.meadows.accent, skin: 0xd9a27a, hair: 0x2b1d14, legs: 0x3a3344, wraps: P.paper, sash: P.ember };
  const heroForms = { ember: { palette: { sash: P.ember } }, tempest: { palette: { sash: P.tempest } }, zenith: { palette: { sash: P.zenith } } };
  const villager = { coat: P.structure.terracotta, skin: 0xc98f6b, hair: 0x3b2a1e, legs: 0x5a4a3a, sash: P.biome.meadows.accent };
  const choir = { robe: 0x8a8590, under: 0x2b2730, veil: P.ink, glass: P.hostile, iron: 0x4a4650 };
  const out = [];
  for (const id of IDS.actorSpec) {
    if (id === 'hero_a' || id === 'hero_b') {
      out.push(human(id, Object.assign({}, hero, id === 'hero_b' ? { hair: 0x6b3b22, coat: 0x3d5f7a } : {}), { forms: heroForms }));
    } else if (id.startsWith('npc_')) {
      out.push(human(id, Object.assign({}, villager, id === 'npc_sela' ? { coat: P.ora } : id === 'npc_kerrin' ? { coat: P.kerrin } : {})));
    } else if (id === 'tusk_boar' || id === 'bramble_boar' || id === 'bramblehorn' || id === 'scuttlecrab' || id === 'gorrumaw') {
      const big = id === 'bramblehorn' || id === 'gorrumaw';
      out.push({ id, rig: 'quadruped', scale: big ? 2.2 : 1, build: { height: 1.2, shoulder: 0.6, bulk: 0.8, head: 1 },
        palette: { body: id === 'scuttlecrab' ? P.structure.terracotta : 0x8a5a3c, legs: 0x4a3326, tusk: P.paper }, emissive: {},
        parts: [], radius: 0.7, outline: true, face: false });
    } else if (id === 'ember_wisp') {
      out.push({ id, rig: 'blob', scale: 0.8, build: { height: 1, shoulder: 0.5, bulk: 1, head: 1 },
        palette: { body: P.ember, core: P.oraCore }, emissive: { body: 1.2 }, parts: [], radius: 0.45, outline: true, face: false });
    } else if (id === 'frost_harrier' || id === 'iskra') {
      out.push({ id, rig: 'flyer', scale: id === 'iskra' ? 2.5 : 1, build: { height: 1.2, shoulder: 0.5, bulk: 0.5, head: 1 },
        palette: { body: P.snow, wing: P.tempest, beak: P.structure.lantern }, emissive: {}, parts: [], radius: 0.6, outline: true, face: false });
    } else {
      const scale = id === 'rust_golem' ? 1.6 : id === 'vorrhal' ? 1.5 : id === 'durn' ? 1.15 : id === 'choir_vanguard' ? 1.1 : 1;
      out.push(human(id, Object.assign({}, choir, id === 'rust_golem' ? { robe: P.structure.copper, under: 0x6b4a3a } : {}),
        { scale, face: false, emissive: { glass: 1.5 }, radius: 0.45 }));
    }
  }
  return out;
}

/** Settlements of IDS (5.13): a few buildings and the spots the stand-ins use. */
function settlements() {
  const spots = [
    { id: 'ringstone', dx: 0, dz: 0, yaw: 0 }, { id: 'stall', dx: 26, dz: 4, yaw: -1.6 }, { id: 'forge', dx: -22, dz: 12, yaw: 1.2 },
    { id: 'well', dx: 16, dz: -18, yaw: 2.4 }, { id: 'a', dx: 6, dz: 14, yaw: 3.1 }, { id: 'b', dx: -10, dz: -8, yaw: 1 }, { id: 'c', dx: 30, dz: -30, yaw: 4 },
  ];
  const STYLE = { sparkstead: 'village', haven_aster: 'town', copperwatch: 'outpost', ridgerest: 'mountain', still_wind: 'monastery',
    talias_camp: 'camp', tide_beacon: 'beacon', selas_ledge: 'ledge', spire_approach: 'outpost' };
  return IDS.settlement.map((id) => {
    const small = id === 'talias_camp' || id === 'tide_beacon' || id === 'selas_ledge' || id === 'spire_approach';
    const buildings = id === 'sparkstead'
      ? [{ kind: 'well', dx: 20, dz: -20, yaw: 0 }, { kind: 'windmill', dx: -60, dz: 30, yaw: 0.6 }, { kind: 'house_m', dx: 10, dz: 25, yaw: 3.1 },
        { kind: 'stall', dx: 28, dz: 4, yaw: 1.6 }, { kind: 'kitePole', dx: 0, dz: -45, yaw: 0 }, { kind: 'house_s', dx: -30, dz: -25, yaw: 0.8 },
        { kind: 'house_l', dx: 40, dz: 30, yaw: 2.2 }]
      : small
        ? [{ kind: 'tent', dx: 12, dz: 10, yaw: 0.4 }, { kind: 'lantern', dx: -6, dz: 8, yaw: 0 }]
        : [{ kind: 'house_m', dx: 25, dz: 20, yaw: 2.5 }, { kind: 'house_s', dx: -25, dz: 18, yaw: 0.6 }, { kind: 'well', dx: 14, dz: -16, yaw: 0 },
          { kind: 'stall', dx: 28, dz: 4, yaw: 1.6 }];
    return { id, style: STYLE[id], buildings, spots: spots.map((s) => Object.assign({}, s)), banner: [PALETTE.biome.meadows.accent, PALETTE.structure.terracotta] };
  });
}

/** Regions an enemy appears in (stand-in table). */
const ENEMY_REGIONS = Object.freeze({
  ember_wisp: ['meadows', 'coast'], tusk_boar: ['meadows'], bramble_boar: ['thornwood'], choir_acolyte: ['meadows', 'thornwood', 'rustdune', 'frostspine'],
  choir_caster: ['thornwood', 'rustdune', 'frostspine'], scuttlecrab: ['coast'], rust_golem: ['rustdune'], frost_harrier: ['frostspine'], choir_vanguard: ['frostspine'],
});
/** Enemy techniques per enemy (stand-in). The first one is the one the stand-in brain uses. */
const ENEMY_TECHS = Object.freeze({
  ember_wisp: ['wisp_spit', 'wisp_dive'], tusk_boar: ['boar_gore', 'boar_charge'], bramble_boar: ['boar_gore', 'boar_charge'],
  choir_acolyte: ['acolyte_string', 'acolyte_rush'], choir_caster: ['caster_volley', 'caster_tether'], scuttlecrab: ['crab_pinch', 'crab_slam'],
  rust_golem: ['golem_hammer', 'golem_stomp', 'golem_boulder'], frost_harrier: ['harrier_gust', 'harrier_dive'],
  choir_vanguard: ['vanguard_string', 'vanguard_lance', 'vanguard_smash'],
  durn: ['acolyte_string', 'acolyte_rush'], bramblehorn: ['boar_gore', 'boar_charge'], gorrumaw: ['crab_pinch', 'golem_stomp'],
  iskra: ['harrier_gust', 'harrier_dive'], vorrhal: ['vanguard_string', 'vanguard_smash'],
});

/** Enemies of IDS (5.3), the five boss enemies with tier and brain 'boss'. */
function enemies() {
  return IDS.enemy.map((id) => {
    const e = BALANCE.enemies[id];
    const techs = ENEMY_TECHS[id].slice();
    if (e) {
      const d = {
        id, specId: id, tier: e.tier, movement: e.movement, levels: e.levels.slice(),
        mult: { hp: e.mult.hp, atk: e.mult.atk, def: e.mult.def, xp: e.mult.xp, shells: e.mult.shells }, poise: e.poise,
        brain: e.brain, params: { sight: 45, leash: 80, preferRange: [1.5, 3], strafe: 0, guardChance: e.guardChance || 0, fleeHp: 0, jumpAtFlyer: false },
        techs, lootTable: e.tier, regions: ENEMY_REGIONS[id].slice(), tags: id.startsWith('choir') ? ['choir'] : ['beast'],
        oraColor: PALETTE.hostile,
      };
      if (e.frontGuard) d.frontGuard = Object.assign({}, e.frontGuard);
      if (e.variantOf) d.variantOf = e.variantOf;
      return d;
    }
    const b = BALANCE.bosses[id];
    return {
      id, specId: id, tier: 'boss', movement: id === 'iskra' ? 'fly' : 'ground', levels: [b.level, b.level],
      mult: { hp: 1, atk: 1.2, def: 1.2, xp: BALANCE.bossRules.xpMult, shells: 0 }, poise: b.poise,
      brain: 'boss', params: { sight: 120, leash: b.arena.radius + BALANCE.bossRules.resetExtra },
      techs, lootTable: 'boss', regions: [], tags: ['boss'], oraColor: PALETTE.hostile,
    };
  });
}

/** Bosses of IDS (5.4) from BALANCE.bosses. */
function bosses() {
  return IDS.boss.map((id) => {
    const b = BALANCE.bosses[id];
    const techs = ENEMY_TECHS[id];
    const d = {
      id, enemyId: id, level: b.level, hpMult: b.hpMult, poise: b.poise,
      arena: { landmarkId: b.arena.landmarkId, radius: b.arena.radius, retry: { dx: 0, dz: Math.round(b.arena.radius * 0.8) } },
      phases: b.phases.map((hpBelow, i) => ({ hpBelow, techs: techs.map((t, j) => ({ id: t, weight: j === 0 ? 3 : 2 })),
        speedMult: i > 0 ? 1.15 : 1, onEnter: i > 0 ? [{ op: 'banner', kind: 'boss', key: 'boss.' + id + '.name' }] : [] })),
      intro: { seconds: BALANCE.bossRules.introSeconds, lineKey: null },
      rewards: { shells: BALANCE.loot.boss.shells.perIndex * b.index },
    };
    if (typeof b.hpPerSiphonStanding === 'number') d.hpPerSiphonStanding = b.hpPerSiphonStanding;
    if (b.fleeAtZero) d.fleeAtZero = true;
    return d;
  });
}

/** Groups of IDS (5.9): one member each. */
const GROUP_ENEMY = Object.freeze({
  mq2_raid: 'choir_acolyte', durn_adds: 'choir_acolyte', mq4_wave: 'scuttlecrab', mq7_gate: 'choir_vanguard', vorrhal_adds: 'choir_vanguard',
  siphon_wave_1: 'choir_acolyte', siphon_wave_2: 'choir_caster', camp_choir_small: 'choir_acolyte', camp_choir_large: 'choir_caster', camp_beasts: 'tusk_boar',
});

/** Quests of IDS (5.6): mq1 has two steps (talk to Sela, defeat a Tusk Boar); the others one script step. */
function quests() {
  const Q = BALANCE.quests;
  const rewards = (id) => {
    const r = Q[id];
    const out = [];
    if (r.xp) out.push({ op: 'giveXp', amount: r.xp });
    if (r.shells) out.push({ op: 'giveShells', amount: r.shells });
    if (r.tp) out.push({ op: 'giveTp', amount: r.tp });
    return out;
  };
  const GIVER = { mq1: 'sela', mq2: 'dov', mq3: 'kerrin', mq4: 'eli', mq5: 'bren', mq6: 'noa', mq7: 'sela', sq1: 'ilan', sq2: 'rina', sq3: 'gal', sq4: 'bren' };
  return IDS.quest.map((id, i) => {
    const main = id.startsWith('mq');
    if (id === 'mq1') {
      return {
        id, kind: 'main', order: 1, giver: 'sela', prereq: {}, autoStart: true,
        steps: [
          { id: 's1', type: 'talk', npc: 'sela', dialogue: 'mq1_sela', marker: { npc: 'sela' } },
          { id: 's2', type: 'kill', enemy: 'tusk_boar', count: 1, marker: { landmark: 'sparkstead' } },
        ],
        rewards: rewards(id).concat([{ op: 'giveItem', item: 'sunfruit', count: 2 }, { op: 'startQuest', quest: 'mq2' }]),
      };
    }
    const prev = main ? 'mq' + (Number(id.slice(2)) - 1) : 'mq1';
    return {
      id, kind: main ? 'main' : 'side', order: i + 1, giver: GIVER[id], prereq: { quests: [prev] }, autoStart: main,
      steps: [{ id: 's1', type: 'script', script: 'standin_story' }],
      rewards: rewards(id),
    };
  });
}

/** Objects of IDS (5.7). */
function objects() {
  const lm = (id) => LANDMARKS.find((l) => l.id === id);
  const out = [];
  for (const id of IDS.object) {
    if (id === 'training_post') {
      out.push({ id, prop: 'trainingPost', x: -1645, z: 1852, hpMult: 0.5, targetTag: 'post', quest: 'mq1' });
    } else if (id.startsWith('siphon_')) {
      const l = lm(id);
      out.push({ id, prop: 'siphon', x: l.x, z: l.z, hpMult: BALANCE.siphon.hpMult, targetTag: id, promptKey: 'standin.prompt.use' });
    } else if (id === 'saltglass_pillar') {
      const l = lm('saltglass_arches');
      out.push({ id, prop: 'saltPillar', x: l.x + 30, z: l.z - 20, hpMult: 1, targetTag: id });
    } else {
      const m = /^(lost_bell|bell|fallen_blade|tether)_(\d)$/.exec(id);
      const n = m ? Number(m[2]) : 1;
      const kind = m ? m[1] : 'bell';
      const base = kind === 'fallen_blade' ? lm('bramble_hollow') : kind === 'tether' ? lm('wellspring_spire') : lm('haven_aster');
      const r = kind === 'tether' ? 300 : kind === 'lost_bell' ? 400 : 120;
      const a = n * 1.3 + (kind === 'lost_bell' ? 0.5 : 0);
      out.push({ id, prop: kind === 'fallen_blade' ? 'fallenBlade' : kind === 'tether' ? 'lightPillar' : 'bell',
        x: Math.round(base.x + Math.cos(a) * r), z: Math.round(base.z + Math.sin(a) * r), promptKey: 'standin.prompt.use' });
    }
  }
  return out;
}

/** Dialogues: Sela's MQ1 lines and one idle greeting per NPC. */
function dialogues() {
  const out = [{
    id: 'mq1_sela', start: 'n1',
    nodes: {
      n1: { speaker: 'sela', text: 'mq1.l01', next: 'n2' },
      n2: { speaker: 'sela', text: 'mq1.l02', next: 'n3' },
      n3: { speaker: 'sela', text: 'mq1.l03', next: null },
    },
  }];
  for (const id of IDS.npc) out.push({ id: id + '_idle', start: 'n1', nodes: { n1: { speaker: id, text: 'standin.idle.greet', next: null } } });
  return out;
}

/**
 * Build every stand-in definition, keyed by defs kind.
 * Pure: usable from Node tests.
 * @returns {Record<string, object[]>}
 */
export function standinDefs() {
  return {
    technique: playerTechniques().concat(enemyTechniques()),
    form: forms(),
    item: items(),
    shop: IDS.shop.map((id) => ({ id, level: BALANCE.shops[id].level, priceMult: BALANCE.shops[id].priceMult, stock: STOCK[id].slice() })),
    lootTable: IDS.lootTable.map((id) => Object.assign({ id }, JSON.parse(JSON.stringify(BALANCE.loot[id])))),
    npc: IDS.npc.map((id) => {
      const [settlement, spot, shop, voicePitch] = NPCS[id];
      const d = { id, specId: 'npc_' + id, home: { settlement, spot }, idleDialogue: id + '_idle', voicePitch };
      if (shop) d.shop = shop;
      return d;
    }),
    dialogue: dialogues(),
    quest: quests(),
    object: objects(),
    course: [{
      id: 'windmill_run', start: { x: -1200, z: 1250 },
      gates: [{ x: -1160, z: 1210, alt: 20 }, { x: -1080, z: 1150, alt: 35 }, { x: -1000, z: 1120, alt: 30 }, { x: -930, z: 1180, alt: 25 },
        { x: -960, z: 1270, alt: 40 }, { x: -1060, z: 1320, alt: 30 }, { x: -1160, z: 1300, alt: 20 }],
      medals: Object.assign({}, BALANCE.world.race.windmill_run), goldReward: 'ember_charm',
    }],
    actorSpec: actorSpecs(),
    enemy: enemies(),
    boss: bosses(),
    group: IDS.group.map((id) => ({ id, members: [{ enemy: GROUP_ENEMY[id], count: 1 }] })),
    spawnTable: IDS.spawnTable.map((id) => ({
      id, density: 5, night: 1.2,
      entries: Object.keys(ENEMY_REGIONS).filter((e) => ENEMY_REGIONS[e].indexOf(id) >= 0).map((e) => ({ enemy: e, weight: 1, group: [1, 3] })),
      camps: [{ tier: 1, group: id === 'meadows' ? 'camp_beasts' : 'camp_choir_small' }, { tier: 2, group: 'camp_choir_large' }],
    })),
    region: REGIONS.slice(),
    landmark: LANDMARKS.slice(),
    settlement: settlements(),
    music: IDS.music.map((id, i) => ({ id, bpm: [84, 72, 66, 132, 144][i], mode: id === 'warm' ? 'major' : 'minor' })),
  };
}

/**
 * Register every stand-in definition and the stand-in content strings.
 * @param {any} ctx
 */
export function install(ctx) {
  const all = standinDefs();
  for (const kind of Object.keys(all)) ctx.defs.register(kind, all[kind]);
  ctx.i18n.addStrings(CONTENT_STRINGS);
}
