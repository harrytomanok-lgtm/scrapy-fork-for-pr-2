/**
 * Settlement definitions (ARCHITECTURE 5.13, ART_UX 1.10, GDD 3.3): the nine settlements of IDS.settlement, laid out
 * around their landmark (dx, dz in metres; +x east, +z south; yaw 0 faces south). The Ringstone stands at the
 * centre: every layout keeps a 16 m plaza clear around it. Pure data: Node tests load it.
 * @module env/data/settlements
 */

import { PALETTE } from '../../core/palette.js';

/** Footprint radius (m) of each building kind, used for colliders, the spot clearance test and terracing. */
export const FOOTPRINT = Object.freeze({
  house_s: 3, house_m: 4, house_l: 5.5, windmill: 3.6, well: 1.6, kiteTower: 4, stall: 0.5, jetty: 0, mast: 0.6,
  cloister: 0, tent: 2.2, kitePole: 0.3, lantern: 0.2, beacon: 4.2,
});

/** @param {number} dx @param {number} dz @returns {number} yaw facing the settlement centre */
function faceCentre(dx, dz) {
  return Math.round(Math.atan2(-dx, -dz) * 100) / 100;
}

/**
 * @param {string} kind @param {number} dx @param {number} dz @param {number} [yaw] (default: facing the centre)
 * @returns {{ kind:any, dx:number, dz:number, yaw:number }}
 */
function b(kind, dx, dz, yaw) {
  return { kind, dx, dz, yaw: yaw === undefined ? faceCentre(dx, dz) : yaw };
}

/** @param {string} id @param {number} dx @param {number} dz @param {number} [yaw] */
function s(id, dx, dz, yaw) {
  return { id, dx, dz, yaw: yaw === undefined ? faceCentre(dx, dz) : yaw };
}

const P = PALETTE;

export const SETTLEMENTS = Object.freeze([
  {
    id: 'sparkstead', style: 'village', banner: [P.biome.meadows.accent, P.structure.terracotta],
    buildings: [
      b('well', 20, -21, 0), b('windmill', -58, 34, 0.6), b('house_m', 12, 28, 3.1), b('stall', 25.5, 4, -1.6),
      b('kitePole', 14, -44, 0), b('kitePole', -20, 42, 0), b('kitePole', 62, -28, 0),
      b('house_s', -30, -26), b('house_l', 42, 30), b('house_m', -34, 25), b('house_s', -30, 13), b('house_m', 37, -13),
      b('house_l', -6, -41), b('house_m', -53, -6),
      b('lantern', 13, -6), b('lantern', -13, 4), b('lantern', -4, -15), b('lantern', 12, 11), b('lantern', 19, 21),
      b('lantern', -24, -17), b('lantern', 29, -6), b('lantern', -41, 15), b('lantern', -50, 26),
    ],
    spots: [
      s('ringstone', 0, 0, 0), s('stall', 25.5, 4, -1.6), s('forge', -22, 12, 1.2), s('well', 16, -18, 2.4), s('a', 6, 14, 3.1),
      s('b', -10, -8, 1), s('c', 30, -30, 4),
    ],
  },
  {
    id: 'haven_aster', style: 'town', banner: [P.structure.kites[2], P.paper],
    buildings: [
      // market row on the east side of the plaza (three awnings), the 60 m kite tower to the north-west
      b('stall', 30, -7, -1.57), b('stall', 30, 0, -1.57), b('stall', 30, 7, -1.57),
      b('kiteTower', -38, -40), b('well', -18, 20, 0),
      // inner ring
      b('house_l', 0, -50), b('house_m', 36, -38), b('house_l', 56, 8), b('house_m', 40, 42), b('house_l', 2, 52),
      b('house_m', -40, 34), b('house_l', -54, -4),
      // outer ring
      b('house_s', -18, -86), b('house_m', 46, -78), b('house_s', 88, -22), b('house_m', 82, 40), b('house_s', 38, 86),
      b('house_m', -30, 84), b('house_s', -84, 42), b('house_m', -88, -30),
      b('kitePole', 20, -26, 0), b('kitePole', -26, 6, 0), b('kitePole', 66, -48, 0), b('kitePole', -64, 64, 0),
      b('jetty', 140, 0, 1.57),
      b('lantern', 15, -8), b('lantern', -15, -8), b('lantern', 15, 9), b('lantern', -15, 9), b('lantern', 0, -18),
      b('lantern', 24, -14), b('lantern', 24, 14), b('lantern', -30, -22), b('lantern', 26, 30), b('lantern', -36, 16),
      b('lantern', 62, -10), b('lantern', -12, 38),
    ],
    spots: [
      s('ringstone', 0, 0, 0), s('stall', 30, 0, -1.57), s('a', -10, 14), s('b', 12, -16), s('c', -20, -12), s('market', 22, 4, 1.57),
      s('tower', -30, -32),
    ],
  },
  {
    id: 'copperwatch', style: 'outpost', banner: [P.structure.copper, P.biome.rustdune.accent],
    buildings: [
      b('house_m', 0, -30), b('house_s', 28, -12), b('house_m', 24, 22), b('house_s', -24, 22), b('house_m', -30, -10),
      b('mast', 8, -16, 0), b('kitePole', -14, -24, 0), b('stall', -16, 6, 1.57),
      b('lantern', 11, 8), b('lantern', -9, -11), b('lantern', 14, -6), b('lantern', -6, 14),
    ],
    spots: [s('ringstone', 0, 0, 0), s('a', 8, 10), s('b', -10, -4), s('c', 14, -2), s('stall', -16, 6, 1.57)],
  },
  {
    id: 'ridgerest', style: 'mountain', banner: [P.structure.kites[2], P.snow],
    buildings: [
      b('house_m', 0, -34), b('house_l', 32, -14), b('house_s', 30, 20), b('house_m', -2, 36), b('house_l', -32, 14),
      b('house_s', -28, -20), b('stall', 16, 8, -1.57), b('kitePole', -16, -32, 0), b('well', -12, 22, 0),
      b('lantern', 12, -8), b('lantern', -12, -6), b('lantern', 8, 14), b('lantern', -14, 8), b('lantern', 18, -22),
    ],
    spots: [s('ringstone', 0, 0, 0), s('a', 16, 8, -1.57), s('stall', 16, 8, -1.57), s('b', -8, 12), s('c', 6, -14)],
  },
  {
    id: 'still_wind', style: 'monastery', banner: [P.paper, P.structure.ringstone],
    buildings: [
      b('cloister', 0, 0, 0), b('house_s', 0, -40), b('house_s', 38, 14), b('house_s', -36, 18), b('kitePole', 26, -30, 0),
      b('kitePole', -28, -28, 0), b('lantern', 10, -10), b('lantern', -10, 10), b('lantern', 10, 10), b('lantern', -10, -10),
    ],
    spots: [s('ringstone', 0, 0, 0), s('a', 6, 12), s('b', -12, 4), s('c', 12, -4)],
  },
  {
    id: 'talias_camp', style: 'camp', banner: [P.biome.thornwood.accent, P.ember],
    buildings: [
      b('tent', -14, -10), b('tent', 12, -14), b('kitePole', -20, 8, 0), b('stall', 14, 8, -2.2),
      b('lantern', -7, 12), b('lantern', 18, -4),
    ],
    spots: [s('ringstone', 0, 0, 0), s('a', 14, 8, -2.2), s('stall', 14, 8, -2.2), s('b', -8, -4), s('c', 6, -8), s('fire', 0, -12)],
  },
  {
    id: 'tide_beacon', style: 'beacon', banner: [P.structure.kites[1], P.paper],
    buildings: [
      b('beacon', -4, 22, 0), b('house_s', 14, 26), b('kitePole', -16, 14, 0), b('kitePole', 8, 36, 0), b('stall', -14, -6, 1.57),
      b('jetty', 0, 60, 0), b('lantern', 8, 12), b('lantern', -10, 8), b('lantern', 6, -10),
    ],
    spots: [s('ringstone', 0, 0, 0), s('a', -14, -6, 1.57), s('stall', -14, -6, 1.57), s('b', 10, 6), s('c', -4, -12)],
  },
  {
    id: 'selas_ledge', style: 'ledge', banner: [P.ember, P.structure.curtain],
    buildings: [
      b('house_s', -26, -22), b('tent', 24, -20), b('kitePole', 30, 10, 0), b('kitePole', -32, 14, 0),
      b('lantern', -12, -12), b('lantern', 14, -10), b('lantern', 0, 18),
    ],
    spots: [s('ringstone', 0, 0, 0), s('a', 8, -12), s('b', -10, 6), s('c', 14, 8), s('train', 0, 30, 3.14)],
  },
  {
    id: 'spire_approach', style: 'outpost', banner: [P.structure.ringstone, P.paper],
    buildings: [
      b('tent', -16, -12), b('tent', 16, -14), b('house_s', 22, 14), b('kitePole', -18, 14, 0), b('mast', 0, -22, 0),
      b('lantern', 9, 9), b('lantern', -10, 6), b('lantern', 0, -12),
    ],
    spots: [s('ringstone', 0, 0, 0), s('a', -8, 10), s('b', 10, -4), s('c', -12, -2)],
  },
]);

/** Spot ids every settlement must have (4.2); shops add 'stall'. */
export const REQUIRED_SPOTS = Object.freeze(['ringstone', 'a', 'b', 'c']);

/**
 * Validate a layout: spots clear of building footprints (stalls: their counter only), the Ringstone plaza
 * (16 m) clear of buildings other than lanterns and kite poles (the cloister ring is outside it).
 * @param {any} def @returns {string[]} problems
 */
export function layoutProblems(def) {
  const out = [];
  for (const id of REQUIRED_SPOTS) if (!def.spots.some((p) => p.id === id)) out.push(def.id + ': missing spot ' + id);
  for (const bl of def.buildings) {
    const r = FOOTPRINT[bl.kind];
    if (r === undefined) {
      out.push(def.id + ': unknown building kind ' + bl.kind);
      continue;
    }
    const d0 = Math.hypot(bl.dx, bl.dz);
    if (bl.kind !== 'lantern' && bl.kind !== 'kitePole' && bl.kind !== 'cloister' && d0 - r < 14) out.push(def.id + ': ' + bl.kind + ' inside the plaza');
    for (const sp of def.spots) {
      if (bl.kind === 'stall' || bl.kind === 'cloister' || bl.kind === 'jetty') continue;
      const d = Math.hypot(bl.dx - sp.dx, bl.dz - sp.dz);
      if (d < r + 1.2) out.push(def.id + ': spot ' + sp.id + ' inside ' + bl.kind);
    }
  }
  for (let i = 0; i < def.buildings.length; i++) {
    for (let j = i + 1; j < def.buildings.length; j++) {
      const a = def.buildings[i];
      const c = def.buildings[j];
      if (a.kind === 'cloister' || c.kind === 'cloister' || a.kind === 'jetty' || c.kind === 'jetty') continue;
      const d = Math.hypot(a.dx - c.dx, a.dz - c.dz);
      const need = FOOTPRINT[a.kind] + FOOTPRINT[c.kind] + (a.kind === 'stall' || c.kind === 'stall' ? 2.5 : 1);
      if (d < need) out.push(def.id + ': ' + a.kind + ' overlaps ' + c.kind + ' at ' + c.dx + ',' + c.dz);
    }
  }
  return out;
}
