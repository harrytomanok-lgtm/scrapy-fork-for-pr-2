/**
 * Authored world data of GDD 3.2-3.4 (RegionDef, LandmarkDef of ARCHITECTURE 5.8) and the fixed worldgen
 * constants. Pure module: no three, no DOM.
 * @module world/gen/layout
 */

import { PALETTE } from '../../core/palette.js';

/** @param {any} o @returns {any} */
function deepFreeze(o) {
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  }
  return Object.freeze(o);
}

/** Regions of GDD 3.2 in a fixed order (the region layer stores the index). */
export const REGIONS = deepFreeze([
  { id: 'meadows', cx: -1300, cz: 1400, levels: [1, 6], biome: 'meadows', height: { base: 26, amp: 48, ridge: 0.12, terrace: 0 }, chestTable: 'chest_t1', musicKey: 'warm', content: true },
  { id: 'coast', cx: 700, cz: 2400, levels: [5, 10], biome: 'coast', height: { base: 4, amp: 10, ridge: 0.1, terrace: 0.3 }, chestTable: 'chest_t1', musicKey: 'warm', content: true },
  { id: 'thornwood', cx: -2200, cz: -400, levels: [8, 14], biome: 'thornwood', height: { base: 50, amp: 90, ridge: 0.35, terrace: 0 }, chestTable: 'chest_t2', musicKey: 'cold', content: true },
  { id: 'rustdune', cx: 2000, cz: 700, levels: [13, 20], biome: 'rustdune', height: { base: 34, amp: 40, ridge: 0.1, terrace: 0.6 }, chestTable: 'chest_t2', musicKey: 'warm', content: true },
  { id: 'frostspine', cx: -400, cz: -2300, levels: [19, 26], biome: 'frostspine', height: { base: 160, amp: 520, ridge: 0.8, terrace: 0 }, snowLine: 520, chestTable: 'chest_t3', musicKey: 'cold', content: true },
  { id: 'stormwell', cx: 2000, cz: -1700, levels: [24, 32], biome: 'stormwell', height: { base: 2, amp: 16, ridge: 0.25, terrace: 0 }, chestTable: 'chest_t3', musicKey: 'cold', content: false },
  { id: 'spire', cx: 0, cz: 0, radius: 450, levels: [24, 28], biome: 'spire', height: { base: 140, amp: 18, ridge: 0, terrace: 0.4 }, chestTable: 'chest_t3', musicKey: 'cold', content: true },
]);

/** Region index by id. */
export const REGION_INDEX = Object.freeze(Object.fromEntries(REGIONS.map((r, i) => [r.id, i])));
export const R_MEADOWS = 0;
export const R_COAST = 1;
export const R_THORNWOOD = 2;
export const R_RUSTDUNE = 3;
export const R_FROSTSPINE = 4;
export const R_STORMWELL = 5;
export const R_SPIRE = 6;
export const NR = REGIONS.length;

/** Authored landmarks of GDD 3.3 (P0 rows); y is resolved after the bake. */
export const LANDMARKS = deepFreeze([
  { id: 'sparkstead', x: -1430, z: 1580, type: 'settlement', stamp: { kind: 'flatten', radius: 110, falloff: 60 }, beacon: PALETTE.structure.ringstone, tag: 'P0' },
  { id: 'selas_ledge', x: -1650, z: 1860, type: 'training', stamp: { kind: 'plateau', radius: 60, height: 40, falloff: 50 }, tag: 'P0' },
  { id: 'haven_aster', x: -360, z: 1150, type: 'settlement', stamp: { kind: 'flatten', radius: 160, falloff: 70 }, beacon: PALETTE.structure.ringstone, tag: 'P0' },
  { id: 'windmill_run', x: -1200, z: 1250, type: 'landmark', stamp: null, tag: 'P0' },
  { id: 'saltglass_arches', x: 1150, z: 2800, type: 'landmark', stamp: { kind: 'arch', radius: 40 }, beacon: PALETTE.structure.ringstone, tag: 'P0' },
  { id: 'tide_beacon', x: 150, z: 2950, type: 'settlement', stamp: { kind: 'flatten', radius: 40, falloff: 40 }, beacon: PALETTE.structure.ringstone, tag: 'P0' },
  { id: 'talias_camp', x: -1800, z: 150, type: 'settlement', stamp: { kind: 'flatten', radius: 40, falloff: 40 }, beacon: PALETTE.structure.ringstone, tag: 'P0' },
  { id: 'bramble_hollow', x: -2580, z: -860, type: 'arena', stamp: { kind: 'basin', radius: 90, height: 25, falloff: 50 }, tag: 'P0' },
  { id: 'copperwatch', x: 1580, z: 430, type: 'settlement', stamp: { kind: 'flatten', radius: 80, falloff: 50 }, beacon: PALETTE.structure.ringstone, tag: 'P0' },
  { id: 'burrow_pit', x: 2300, z: 140, type: 'arena', stamp: { kind: 'basin', radius: 110, height: 35, falloff: 50 }, tag: 'P0' },
  { id: 'ridgerest', x: -860, z: -2000, type: 'settlement', stamp: { kind: 'flatten', radius: 90, falloff: 70 }, beacon: PALETTE.structure.ringstone, tag: 'P0' },
  { id: 'still_wind', x: -300, z: -2500, type: 'settlement', stamp: { kind: 'flatten', radius: 70, falloff: 70 }, beacon: PALETTE.structure.ringstone, tag: 'P0' },
  { id: 'paleglass_summit', x: 100, z: -2750, type: 'arena', stamp: { kind: 'flatten', radius: 100, falloff: 80 }, tag: 'P0' },
  { id: 'stormwell_eye', x: 2100, z: -1800, type: 'landmark', stamp: { kind: 'basin', radius: 120, height: 30, falloff: 60 }, tag: 'P0' },
  { id: 'spire_approach', x: 0, z: 520, type: 'settlement', stamp: { kind: 'flatten', radius: 40, falloff: 40 }, beacon: PALETTE.structure.ringstone, tag: 'P0' },
  { id: 'dim_court', x: 0, z: 300, type: 'arena', stamp: { kind: 'flatten', radius: 120, falloff: 60 }, tag: 'P0' },
  { id: 'wellspring_spire', x: 0, z: 0, type: 'spire', stamp: { kind: 'spire', radius: 60 }, tag: 'P0' },
  { id: 'shattered_crown', x: 0, z: 0, type: 'landmark', stamp: null, tag: 'P0' },
  { id: 'siphon_1', x: -1000, z: 720, type: 'siphon', stamp: { kind: 'flatten', radius: 50, falloff: 40 }, beacon: PALETTE.hostile, tag: 'P0' },
  { id: 'siphon_2', x: -2150, z: -215, type: 'siphon', stamp: { kind: 'flatten', radius: 30, falloff: 40 }, beacon: PALETTE.hostile, tag: 'P0' },
  { id: 'siphon_3', x: 860, z: 2300, type: 'siphon', stamp: { kind: 'flatten', radius: 30, falloff: 40 }, beacon: PALETTE.hostile, tag: 'P0' },
  { id: 'siphon_4', x: 1860, z: 1150, type: 'siphon', stamp: { kind: 'flatten', radius: 30, falloff: 40 }, beacon: PALETTE.hostile, tag: 'P0' },
  { id: 'siphon_5', x: -1400, z: -2300, type: 'siphon', stamp: { kind: 'flatten', radius: 30, falloff: 40 }, beacon: PALETTE.hostile, tag: 'P0' },
]);

/** Ora Shrines of GDD 3.4 (P0). */
export const SHRINES = deepFreeze([[-1900, 1100], [-700, 1750], [300, 2450], [1500, 2400], [-2600, 100], [-1900, -900], [2450, 600], [1500, 1200], [-1300, -1900], [400, -2350]]);
/** Landmarks with a Ringstone (GDD 3.4). */
export const RINGSTONE_AT = deepFreeze(['sparkstead', 'haven_aster', 'saltglass_arches', 'tide_beacon', 'talias_camp', 'copperwatch', 'ridgerest', 'still_wind', 'spire_approach']);
/** Regions with seeded camps and free-standing chests (GDD 3.4). */
export const CAMP_REGIONS = deepFreeze(['meadows', 'coast', 'thornwood', 'rustdune', 'frostspine']);

/** Path network between landmarks (baked into the tint and flags layers). */
export const PATHS = deepFreeze([
  ['sparkstead', 'selas_ledge'], ['sparkstead', 'windmill_run'], ['windmill_run', 'haven_aster'], ['haven_aster', 'spire_approach'],
  ['haven_aster', 'tide_beacon'], ['tide_beacon', 'saltglass_arches'], ['windmill_run', 'siphon_1'], ['siphon_1', 'talias_camp'],
  ['talias_camp', 'siphon_2'], ['haven_aster', 'copperwatch'], ['copperwatch', 'siphon_4'], ['talias_camp', 'ridgerest'],
  ['ridgerest', 'still_wind'], ['still_wind', 'paleglass_summit'], ['ridgerest', 'siphon_5'], ['spire_approach', 'dim_court'],
]);

/** Fixed worldgen constants (GDD 3.1). */
export const GEN = Object.freeze({
  seaFloor: -34,
  coastRadius: 3260,
  coastWarp: 240,
  shelf: 420,
  regionBlend: 170,
  regionWarp: 300,
  spireRadius: 450,
  /** Tint, region, flags and canopy layers are baked at this cell size. */
  layerCell: 8,
});

/** Bits of the flags layer (ARCHITECTURE 4.1). */
export const FLAG = Object.freeze({ PATH: 1, SETTLEMENT: 2, NO_SPAWN: 4, WATER: 8, SCORCH: 16 });
