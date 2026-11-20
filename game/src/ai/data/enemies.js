/**
 * Enemy, boss, group and spawn-table data (ARCHITECTURE 5.3, 5.4, 5.9; GDD 3.2, 7.2, 7.3). Multipliers, poise,
 * levels and boss numbers come from BALANCE; the brain parameters (sight, spacing, strafing) are the tuning
 * values of this package.
 *
 * Extensions used by the ai package (optional fields):
 * - EnemyDef.params: `engage` (orbit radius while waiting for a token), `prefer` [min, max] (ranged band),
 *   `hover` (cruise altitude for flyers), `fleeHp` (flee below this HP fraction when no ally is near),
 *   `boltDodge` (chance to flicker away from a player bolt);
 * - BossDef.phases[i].summon: a group id spawned around the boss when the phase starts;
 * - BossDef.adds: { hpBelow, group } adds called once at an HP fraction (Durn at 50%).
 * Pure data: Node tests load it.
 * @module ai/data/enemies
 */

import { BALANCE } from '../../core/balance.js';
import { PALETTE } from '../../core/palette.js';

const E = BALANCE.enemies;
const B = BALANCE.bosses;

/** Techniques per enemy (GDD 7.2). Ground-only enemies also carry the rock throw against flyers (GDD 6.6). */
const TECHS = {
  ember_wisp: ['wisp_spit', 'wisp_dive'],
  tusk_boar: ['boar_gore', 'boar_charge', 'enemy_rock'],
  bramble_boar: ['boar_gore', 'boar_charge', 'boar_charge_red', 'enemy_rock'],
  choir_acolyte: ['acolyte_string', 'acolyte_rush', 'enemy_rock'],
  choir_caster: ['caster_volley', 'caster_tether'],
  scuttlecrab: ['crab_pinch', 'crab_slam', 'enemy_rock'],
  rust_golem: ['golem_hammer', 'golem_stomp', 'golem_boulder'],
  frost_harrier: ['harrier_dive', 'harrier_gust'],
  choir_vanguard: ['vanguard_string', 'vanguard_lance', 'vanguard_smash'],
};

/** Regions per enemy (GDD 7.2). */
const REGIONS = {
  ember_wisp: ['meadows', 'coast', 'thornwood'], tusk_boar: ['meadows'], bramble_boar: ['thornwood'],
  choir_acolyte: ['meadows', 'thornwood', 'rustdune', 'frostspine'], choir_caster: ['coast', 'thornwood', 'rustdune'],
  scuttlecrab: ['coast'], rust_golem: ['rustdune'], frost_harrier: ['frostspine'], choir_vanguard: ['frostspine', 'spire'],
};

/** Brain parameters per enemy (tuning). */
const PARAMS = {
  ember_wisp: { sight: 40, leash: 80, engage: 9, prefer: [5, 11], strafe: 0.6, guardChance: 0, fleeHp: 0, hover: 2.5, jumpAtFlyer: false },
  tusk_boar: { sight: 32, leash: 70, engage: 12, prefer: [8, 16], strafe: 0.3, guardChance: 0, fleeHp: 0, jumpAtFlyer: false, runSpeed: 8 },
  bramble_boar: { sight: 36, leash: 75, engage: 12, prefer: [8, 16], strafe: 0.3, guardChance: 0, fleeHp: 0, jumpAtFlyer: false, runSpeed: 8.5 },
  choir_acolyte: { sight: 45, leash: 80, engage: 6, prefer: [1.5, 3], strafe: 0.5, guardChance: E.choir_acolyte.guardChance, fleeHp: 0.18, jumpAtFlyer: true },
  choir_caster: { sight: 50, leash: 85, engage: 22, prefer: [E.choir_caster.keepRange - 7, E.choir_caster.keepRange + 5], strafe: 0.8, guardChance: 0, fleeHp: 0.2, hover: 3.5, jumpAtFlyer: false },
  scuttlecrab: { sight: 28, leash: 60, engage: 5, prefer: [1.5, 3], strafe: 0.6, guardChance: 0, fleeHp: 0, jumpAtFlyer: false, runSpeed: 5.5 },
  rust_golem: { sight: 40, leash: 70, engage: 8, prefer: [2, 4], strafe: 0.2, guardChance: 0, fleeHp: 0, jumpAtFlyer: false, runSpeed: 5 },
  frost_harrier: { sight: 60, leash: 110, engage: 16, prefer: [12, 26], strafe: 1, guardChance: 0, fleeHp: 0, hover: 16, jumpAtFlyer: false, flySpeed: 18 },
  choir_vanguard: { sight: 60, leash: 110, engage: 8, prefer: [2, 5], strafe: 0.7, guardChance: 0.2, fleeHp: 0, hover: 2, jumpAtFlyer: false, boltDodge: E.choir_vanguard.boltDodge, flySpeed: 18 },
};

/** The nine enemies of GDD 7.2. */
function roster() {
  return Object.keys(TECHS).map((id) => {
    const e = E[id];
    const d = {
      id, specId: id, tier: e.tier, movement: e.movement, levels: e.levels.slice(),
      mult: { hp: e.mult.hp, atk: e.mult.atk, def: e.mult.def, xp: e.mult.xp, shells: e.mult.shells }, poise: e.poise,
      brain: e.brain, params: Object.assign({}, PARAMS[id]), techs: TECHS[id].slice(), lootTable: e.tier,
      regions: REGIONS[id].slice(), tags: id.startsWith('choir') ? ['choir'] : ['beast'],
      oraColor: id.startsWith('choir') ? PALETTE.hostile : id === 'frost_harrier' ? PALETTE.tempest : PALETTE.ember,
    };
    if (e.frontGuard) d.frontGuard = Object.assign({}, e.frontGuard);
    if (e.variantOf) d.variantOf = e.variantOf;
    return d;
  });
}

/**
 * Camp elites (the experience pass): one member of every camp is an elite, its leader (the member with the most HP).
 * Larger and ringed in the rare-loot colour, tougher, with one extra move, and a better reward (rpg: XP and the
 * elite loot table). Multipliers apply to the base enemy at its level.
 */
export const ELITE = Object.freeze({ hp: 2.4, dmg: 1.2, poise: 1.6, scale: 1.25, xp: 3, color: PALETTE.rarity.rare });
/** The elite's extra move per enemy. */
export const ELITE_MOVE = Object.freeze({
  tusk_boar: 'elite_quake', bramble_boar: 'elite_quake', choir_acolyte: 'elite_quake', scuttlecrab: 'elite_quake', rust_golem: 'elite_quake',
  choir_vanguard: 'elite_quake', ember_wisp: 'elite_fan', choir_caster: 'elite_fan', frost_harrier: 'elite_fan',
});

/** Phase technique tables of the five bosses (GDD 7.3). */
const BOSS_PHASES = {
  durn: [
    { techs: [{ id: 'durn_string', weight: 3 }, { id: 'durn_charge', weight: 2 }] },
  ],
  bramblehorn: [
    { techs: [{ id: 'bh_horn_charge', weight: 3 }, { id: 'bh_antler_sweep', weight: 2 }] },
    { techs: [{ id: 'bh_root_lines', weight: 3 }, { id: 'bh_wall_leap', weight: 2 }, { id: 'bh_horn_charge', weight: 2 }, { id: 'bh_antler_sweep', weight: 1 }], speedMult: 1.15 },
  ],
  gorrumaw: [
    { techs: [{ id: 'gm_roll', weight: 3 }, { id: 'gm_quake', weight: 2 }] },
    { techs: [{ id: 'gm_berserk', weight: 3 }, { id: 'gm_rock_rain', weight: 2 }, { id: 'gm_quake', weight: 1 }], speedMult: 1.2, defMult: B.gorrumaw.armourDefMult },
  ],
  iskra: [
    { techs: [{ id: 'ik_blade_string', weight: 3 }, { id: 'ik_flicker_slash', weight: 2 }, { id: 'ik_ice_spears', weight: 2 }] },
    { techs: [{ id: 'ik_shatterdive', weight: 2 }, { id: 'ik_blade_string', weight: 2 }, { id: 'ik_ice_spears', weight: 2 }, { id: 'ik_flicker_slash', weight: 1 }], speedMult: 1.15,
      fog: { snow: 1 } },
  ],
  vorrhal: [
    { techs: [{ id: 'vh_tether', weight: 2 }, { id: 'vh_void_bolts', weight: 3 }, { id: 'vh_glass_strike', weight: 2 }] },
    { techs: [{ id: 'vh_spire_crystals', weight: 3 }, { id: 'vh_void_bolts', weight: 2 }, { id: 'vh_tether', weight: 1 }], speedMult: 1.1, summon: 'vorrhal_adds' },
    { techs: [{ id: 'vh_void_bolts', weight: 2 }, { id: 'vh_spire_crystals', weight: 2 }], onEnter: [{ op: 'script', script: 'finale_tethers' }] },
  ],
};

/** Movement and spec scale of the boss enemies. */
const BOSS_MOVE = { durn: 'ground', bramblehorn: 'ground', gorrumaw: 'ground', iskra: 'fly', vorrhal: 'ground' };
const BOSS_PARAMS = {
  durn: { engage: 7, runSpeed: 7.5 }, bramblehorn: { engage: 12, runSpeed: 9 }, gorrumaw: { engage: 12, runSpeed: 7 },
  iskra: { engage: 10, hover: 6, flySpeed: 20 }, vorrhal: { engage: 14, runSpeed: 7 },
};

/** The five boss enemies (tier and brain 'boss'). */
function bossEnemies() {
  return Object.keys(BOSS_PHASES).map((id) => {
    const b = B[id];
    const all = [];
    for (const ph of BOSS_PHASES[id]) for (const t of ph.techs) if (all.indexOf(t.id) < 0) all.push(t.id);
    const d = {
      id, specId: id, tier: 'boss', movement: BOSS_MOVE[id], levels: [b.level, b.level],
      mult: { hp: b.hpMult, atk: 0.75, def: 1.2, xp: BALANCE.bossRules.xpMult, shells: 0 }, poise: b.poise,
      brain: 'boss', params: Object.assign({ sight: b.arena.radius + 40, leash: b.arena.radius + BALANCE.bossRules.resetExtra, strafe: 0.5, guardChance: 0, fleeHp: 0 }, BOSS_PARAMS[id]),
      techs: all, lootTable: 'boss', regions: [], tags: ['boss'], oraColor: PALETTE.hostile,
    };
    // Gorrumaw's armoured ball: frontal armour like the crab (GDD 7.3).
    if (id === 'gorrumaw') d.frontGuard = { angleDeg: 120, damageMult: 0.35 };
    return d;
  });
}

/** Boss definitions (5.4). */
export function bosses() {
  return Object.keys(BOSS_PHASES).map((id) => {
    const b = B[id];
    const d = {
      id, enemyId: id, level: b.level, hpMult: b.hpMult, poise: b.poise,
      arena: { landmarkId: b.arena.landmarkId, radius: b.arena.radius, retry: { dx: 0, dz: Math.round(b.arena.radius * 0.6) } },
      phases: BOSS_PHASES[id].map((ph, i) => {
        const p = { hpBelow: b.phases[i], techs: ph.techs.map((t) => ({ id: t.id, weight: t.weight })) };
        if (ph.speedMult) p.speedMult = ph.speedMult;
        if (ph.defMult) p.defMult = ph.defMult;
        if (ph.summon) p.summon = ph.summon;
        if (ph.fog) p.fog = Object.assign({}, ph.fog);
        const onEnter = [];
        if (i > 0) onEnter.push({ op: 'banner', kind: 'boss', key: 'boss.' + id + '.phase' + (i + 1) });
        if (ph.onEnter) for (const a of ph.onEnter) onEnter.push(Object.assign({}, a));
        if (onEnter.length) p.onEnter = onEnter;
        return p;
      }),
      intro: { seconds: BALANCE.bossRules.introSeconds, lineKey: 'boss.' + id + '.intro' },
      rewards: { shells: BALANCE.loot.boss.shells.perIndex * b.index },
    };
    if (typeof b.hpPerSiphonStanding === 'number') d.hpPerSiphonStanding = b.hpPerSiphonStanding;
    if (b.fleeAtZero) d.fleeAtZero = true;
    if (typeof b.addsAt === 'number') d.adds = { hpBelow: b.addsAt, group: 'durn_adds' };
    return d;
  });
}

/** Every enemy def (nine enemies and five boss enemies). */
export function enemies() {
  return roster().concat(bossEnemies());
}

/** Groups (5.9). Quest group sizes match the quest kill counts (MQ2 4, MQ4 8, MQ7 3). */
export const GROUPS = [
  { id: 'mq2_raid', members: [{ enemy: 'choir_acolyte', count: 3 }, { enemy: 'choir_caster', count: 1 }] },
  { id: 'durn_adds', members: [{ enemy: 'choir_acolyte', count: 2 }] },
  { id: 'mq4_wave', members: [{ enemy: 'choir_acolyte', count: 5 }, { enemy: 'choir_caster', count: 3 }] },
  { id: 'mq7_gate', members: [{ enemy: 'choir_vanguard', count: 3 }] },
  { id: 'vorrhal_adds', members: [{ enemy: 'choir_vanguard', count: 2 }] },
  { id: 'siphon_wave_1', members: [{ enemy: 'choir_acolyte', count: 3 }, { enemy: 'choir_caster', count: 1 }] },
  { id: 'siphon_wave_2', members: [{ enemy: 'choir_acolyte', count: 2 }, { enemy: 'choir_caster', count: 2 }] },
  { id: 'camp_choir_small', members: [{ enemy: 'choir_acolyte', count: 2 }, { enemy: 'choir_caster', count: 1 }] },
  { id: 'camp_choir_large', members: [{ enemy: 'choir_acolyte', count: 4 }, { enemy: 'choir_caster', count: 2 }] },
  { id: 'camp_beasts', members: [{ enemy: 'tusk_boar', count: 3 }, { enemy: 'ember_wisp', count: 1 }] },
  // Region camp groups (additions: the beasts of each region band).
  { id: 'camp_coast', members: [{ enemy: 'scuttlecrab', count: 2 }, { enemy: 'choir_caster', count: 1 }] },
  { id: 'camp_thornwood', members: [{ enemy: 'bramble_boar', count: 2 }, { enemy: 'choir_acolyte', count: 2 }] },
  { id: 'camp_rustdune', members: [{ enemy: 'rust_golem', count: 1 }, { enemy: 'choir_acolyte', count: 3 }] },
  { id: 'camp_frostspine', members: [{ enemy: 'frost_harrier', count: 2 }, { enemy: 'choir_acolyte', count: 2 }] },
];

/** Spawn tables per region (GDD 3.2). density = target hostiles within 300 m. */
export const SPAWN_TABLES = [
  { id: 'meadows', density: 5, night: 1.3,
    entries: [{ enemy: 'ember_wisp', weight: 4, group: [3, 4] }, { enemy: 'tusk_boar', weight: 3, group: [2, 3] }, { enemy: 'choir_acolyte', weight: 2, group: [3, 4], minLevel: 2 }],
    camps: [{ tier: 1, group: 'camp_beasts' }, { tier: 2, group: 'camp_choir_small' }, { tier: 3, group: 'camp_choir_large' }] },
  { id: 'coast', density: 5, night: 1.3,
    entries: [{ enemy: 'scuttlecrab', weight: 3, group: [1, 2] }, { enemy: 'choir_caster', weight: 2, group: [1, 2] }, { enemy: 'ember_wisp', weight: 3, group: [2, 4] }],
    camps: [{ tier: 1, group: 'camp_coast' }, { tier: 2, group: 'camp_choir_small' }, { tier: 3, group: 'camp_choir_large' }] },
  { id: 'thornwood', density: 6, night: 1.3,
    entries: [{ enemy: 'bramble_boar', weight: 3, group: [1, 2] }, { enemy: 'choir_acolyte', weight: 3, group: [2, 3] }, { enemy: 'choir_caster', weight: 2, group: [1, 2] },
      { enemy: 'ember_wisp', weight: 2, group: [2, 3], maxLevel: 10 }],
    camps: [{ tier: 1, group: 'camp_thornwood' }, { tier: 2, group: 'camp_choir_small' }, { tier: 3, group: 'camp_choir_large' }] },
  { id: 'rustdune', density: 5, night: 1.2,
    entries: [{ enemy: 'rust_golem', weight: 2, group: [1, 1] }, { enemy: 'choir_caster', weight: 3, group: [1, 2] }, { enemy: 'choir_acolyte', weight: 3, group: [2, 3] }],
    camps: [{ tier: 1, group: 'camp_rustdune' }, { tier: 2, group: 'camp_choir_small' }, { tier: 3, group: 'camp_choir_large' }] },
  { id: 'frostspine', density: 5, night: 1.2,
    entries: [{ enemy: 'frost_harrier', weight: 3, group: [2, 3] }, { enemy: 'choir_vanguard', weight: 1, group: [1, 1], minLevel: 22 }, { enemy: 'choir_acolyte', weight: 3, group: [2, 3] }],
    camps: [{ tier: 1, group: 'camp_frostspine' }, { tier: 2, group: 'camp_choir_small' }, { tier: 3, group: 'camp_choir_large' }] },
];
