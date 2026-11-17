/**
 * The id catalog (ARCHITECTURE 3.8). Every id that one package's data or code may
 * reference across a package boundary is listed here exactly once.
 * Pure module: no three, no DOM.
 * @module core/ids
 */

/** @param {object} o @returns {object} */
function deepFreeze(o) {
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  }
  return Object.freeze(o);
}

/**
 * Standard clip ids every creature spec implements (the clips marked * in ARCHITECTURE 4.5,
 * plus the creature and boss clips).
 * @type {ReadonlyArray<string>}
 */
export const CREATURE_CLIPS = deepFreeze([
  'idle', 'walk', 'run', 'fall', 'fly_hover', 'fly_cruise', 'hurtle', 'stagger', 'down', 'getup', 'death',
  'bite', 'charge_windup', 'charge', 'slam', 'ranged', 'roar',
]);

/**
 * The complete id catalog, keyed by kind.
 * Defs kinds: enemy, boss, group, spawnTable, technique, form, item, shop, lootTable, npc, quest, object,
 * course, actorSpec, region, landmark, settlement, music. Catalog-only kinds (no defs registry):
 * prop (env prop kinds, 4.2), clip (standard clip ids, 4.5), vfx (ART_UX 3.2), sfx (ART_UX 9.2),
 * feel (ART_UX 4), modKey (the closed rpg.mods() key set, 4.11).
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const IDS = deepFreeze({
  enemy: ['ember_wisp', 'tusk_boar', 'bramble_boar', 'choir_acolyte', 'choir_caster', 'scuttlecrab', 'rust_golem', 'frost_harrier', 'choir_vanguard',
    'durn', 'bramblehorn', 'gorrumaw', 'iskra', 'vorrhal'],
  boss: ['durn', 'bramblehorn', 'gorrumaw', 'iskra', 'vorrhal'],
  group: ['mq2_raid', 'durn_adds', 'mq4_wave', 'mq7_gate', 'vorrhal_adds', 'siphon_wave_1', 'siphon_wave_2', 'camp_choir_small', 'camp_choir_large', 'camp_beasts'],
  spawnTable: ['meadows', 'coast', 'thornwood', 'rustdune', 'frostspine'],
  technique: ['strike_string', 'breaker', 'meteor_heel', 'pursuit', 'ora_bolt', 'flare_barrage', 'dawn_lance', 'nova_ring', 'ringfall', 'guard', 'flicker_step', 'boost', 'gather',
    'wisp_spit', 'wisp_dive', 'boar_gore', 'boar_charge', 'acolyte_string', 'acolyte_rush', 'caster_volley', 'caster_tether', 'crab_pinch', 'crab_slam',
    'golem_hammer', 'golem_stomp', 'golem_boulder', 'harrier_dive', 'harrier_gust', 'vanguard_string', 'vanguard_lance', 'vanguard_smash'],
  form: ['ember', 'tempest', 'zenith'],
  item: ['training_wraps', 'racers_wraps', 'bramble_wraps', 'saltglass_wraps', 'copper_knuckles', 'stormcaller_wraps', 'apprentice_garb', 'meadow_garb', 'tidewoven_garb',
    'dunewalker_garb', 'frostweave_garb', 'lantern_mantle', 'sunfruit_charm', 'wind_charm', 'ember_charm', 'tide_charm', 'golem_core_charm', 'frost_charm',
    'stillwind_charm', 'wyrmhide_charm', 'sunfruit', 'ora_draught', 'rust_core'],
  shop: ['dov_stall', 'aster_market', 'talia_herbs', 'yael_outpost', 'ridgerest_provisions'],
  lootTable: ['grunt', 'heavy', 'elite', 'boss', 'chest_t1', 'chest_t2', 'chest_t3'],
  npc: ['sela', 'kerrin', 'dov', 'mira', 'ilan', 'rina', 'gal', 'eli', 'bren', 'talia', 'yael', 'oren', 'noa'],
  quest: ['mq1', 'mq2', 'mq3', 'mq4', 'mq5', 'mq6', 'mq7', 'sq1', 'sq2', 'sq3', 'sq4'],
  object: ['training_post', 'siphon_1', 'siphon_2', 'siphon_3', 'siphon_4', 'siphon_5', 'saltglass_pillar', 'bell_1', 'bell_2', 'bell_3',
    'lost_bell_1', 'lost_bell_2', 'lost_bell_3', 'fallen_blade_1', 'fallen_blade_2', 'fallen_blade_3', 'tether_1', 'tether_2', 'tether_3', 'tether_4', 'tether_5'],
  course: ['windmill_run'],
  actorSpec: ['hero_a', 'hero_b', 'npc_sela', 'npc_kerrin', 'npc_dov', 'npc_mira', 'npc_bren', 'npc_yael', 'npc_noa', 'npc_talia', 'npc_eli', 'npc_oren', 'npc_ilan', 'npc_rina', 'npc_gal',
    'npc_villager_1', 'npc_villager_2', 'npc_villager_3', 'npc_villager_4', 'npc_villager_5', 'npc_villager_6',
    'ember_wisp', 'tusk_boar', 'bramble_boar', 'choir_acolyte', 'choir_caster', 'scuttlecrab', 'rust_golem', 'frost_harrier', 'choir_vanguard',
    'durn', 'bramblehorn', 'gorrumaw', 'iskra', 'vorrhal'],
  region: ['meadows', 'coast', 'thornwood', 'rustdune', 'frostspine', 'stormwell', 'spire'],
  landmark: ['sparkstead', 'selas_ledge', 'haven_aster', 'windmill_run', 'saltglass_arches', 'tide_beacon', 'talias_camp', 'bramble_hollow', 'copperwatch', 'burrow_pit',
    'ridgerest', 'still_wind', 'paleglass_summit', 'stormwell_eye', 'spire_approach', 'dim_court', 'wellspring_spire', 'shattered_crown',
    'siphon_1', 'siphon_2', 'siphon_3', 'siphon_4', 'siphon_5'],
  settlement: ['sparkstead', 'haven_aster', 'copperwatch', 'ridgerest', 'still_wind', 'talias_camp', 'tide_beacon', 'selas_ledge', 'spire_approach'],
  music: ['warm', 'cold', 'corrupted', 'combat', 'boss'],
  prop: ['ringstone', 'shrine', 'chest', 'siphon', 'ringGate', 'trainingPost', 'bell', 'fallenBlade', 'saltPillar', 'crate', 'lightPillar', 'campfire', 'tent', 'signpost'],
  clip: ['idle', 'walk', 'run', 'sprint', 'jump', 'fall', 'land', 'fly_hover', 'fly_cruise', 'fly_boost', 'swim', 'hurtle', 'stagger', 'down', 'getup', 'death',
    'guard', 'gather', 'transform', 'flicker', 'attack1', 'attack2', 'attack3', 'attack4', 'attack5', 'attack6', 'heavy_charge', 'heavy', 'heavy_air',
    'cast', 'cast_loop', 'beam_charge', 'beam_loop', 'beam_end', 'burst', 'ult_rise', 'ult_dive', 'talk', 'interact', 'victory', 'taunt',
    'bite', 'charge_windup', 'charge', 'slam', 'ranged', 'roar'],
  vfx: ['aura', 'bolt', 'bolt_hit', 'muzzle', 'beam_charge', 'beam_hit', 'nova', 'ult_rise', 'ult_sigil', 'ult_dive', 'ult_impact',
    'flicker_out', 'flicker_in', 'boost_trail', 'sonic_ring', 'hit_light', 'hit_heavy', 'hit_finisher', 'guard_shell', 'guard_block', 'perfect',
    'transform_in', 'transform_burst', 'explosion_s', 'explosion_m', 'explosion_l', 'hurtle_trail', 'slam', 'crater', 'tele_white', 'tele_red', 'tele_violet',
    'tether', 'tether_thread', 'death_choir', 'death_beast', 'xp_orb', 'level_up', 'pickup', 'pillar', 'siphon_idle', 'siphon_core', 'siphon_break',
    'spray', 'step_dust', 'land_ring'],
  sfx: ['step_grass', 'step_stone', 'step_snow', 'step_water', 'jump', 'land', 'land_heavy', 'takeoff', 'wind_loop', 'flicker_out', 'flicker_in',
    'boost_start', 'sonic_boom', 'whoosh', 'hit_light', 'hit_heavy', 'hit_finisher', 'gather_loop', 'gather_full', 'bolt_fire', 'bolt_hit',
    'beam_charge', 'beam_loop', 'beam_end', 'nova', 'explosion_s', 'explosion_m', 'explosion_l', 'rock_break', 'crater', 'ult_rise', 'ult_impact',
    'guard_on', 'guard_block', 'perfect', 'transform_rise', 'transform_burst', 'burnout', 'tele_white', 'tele_red', 'tele_violet',
    'enemy_growl', 'enemy_death', 'boss_roar', 'player_hurt', 'player_death', 'heal', 'xp_orb', 'pickup_item', 'shells',
    'level_up', 'quest_start', 'quest_step', 'quest_complete', 'discover', 'ringstone', 'shrine', 'chest_open', 'ring_gate', 'race_start', 'race_end',
    'siphon_loop', 'siphon_core', 'siphon_break', 'ui_move', 'ui_confirm', 'ui_back', 'ui_error', 'ui_open', 'ui_close', 'dialogue_tick'],
  feel: ['lightHit', 'heavyHit', 'finisher', 'boltHit', 'beamTick', 'burst', 'ultimate', 'hurtLight', 'hurtHeavy', 'perfectGuard', 'perfectFlicker',
    'flicker', 'boostStart', 'sonicBoom', 'wallSlam', 'transform', 'bossDeath', 'levelUp', 'landHeavy', 'craterBig'],
  modKey: ['meleePct', 'oraPct', 'poisePct', 'surgePct', 'gatherPct', 'oraRegenPct', 'boostCostPct', 'boostSpeedPct', 'healPct', 'resPct', 'critAdd', 'hpPct',
    'oraPoolPct', 'flickerCostMult', 'secondBreath', 'perfectStaggerMult', 'gatherDmgTakenMult', 'siphonRegenMult'],
});

/**
 * True when `id` is listed in `IDS[kind]`.
 * @param {string} kind
 * @param {string} id
 * @returns {boolean}
 */
export function isId(kind, id) {
  const list = IDS[kind];
  return !!list && list.indexOf(id) >= 0;
}
