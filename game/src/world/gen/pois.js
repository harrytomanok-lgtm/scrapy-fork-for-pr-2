/**
 * Points of interest (GDD 3.4, ARCHITECTURE 5.8): the authored lists plus seeded camps, chests and crown chests.
 * Seeded placement is a greedy cover so that every land sample of the six content regions on a 250 m lattice lies
 * within 500 m of a landmark or POI (the 500 m rule), within the GDD counts and spacing. Pure.
 * @module world/gen/pois
 */

import { createStream, hashString } from '../../core/rng.js';
import { WORLD_HALF } from '../../core/constants.js';
import { REGIONS, REGION_INDEX, LANDMARKS, SHRINES, RINGSTONE_AT, CAMP_REGIONS } from './layout.js';

/** The 500 m rule. */
export const COVER_RADIUS = 500;
/** Lattice spacing of the rule. */
export const COVER_STEP = 250;

/**
 * @typedef {{ id:string, type:string, x:number, y:number, z:number, regionId:string, data:any }} Poi
 * @typedef {object} PoiQuery
 * @property {(x:number, z:number) => number} heightAt
 * @property {(x:number, z:number) => string} regionAt
 * @property {(x:number, z:number) => number} regionLevel
 * @property {(x:number, z:number, radius:number, out:{x:number,y:number,z:number}, opts?:any) => boolean} findSpot
 */

/**
 * Land points of the 250 m lattice in content regions (the rule's samples).
 * @param {PoiQuery} q @returns {Array<{x:number, z:number, regionId:string}>}
 */
export function coverSamples(q) {
  const out = [];
  for (let z = -WORLD_HALF + COVER_STEP / 2; z < WORLD_HALF; z += COVER_STEP) {
    for (let x = -WORLD_HALF + COVER_STEP / 2; x < WORLD_HALF; x += COVER_STEP) {
      if (q.heightAt(x, z) <= 0) continue;
      const regionId = q.regionAt(x, z);
      const r = REGIONS[REGION_INDEX[regionId]];
      if (!r.content) continue;
      out.push({ x, z, regionId });
    }
  }
  return out;
}

/**
 * Crown shard layout around the Spire (GDD 3.3): about 40 floating rocks at 500-900 m, 300-700 m out.
 * @param {number} seed @returns {Array<{x:number,y:number,z:number,r:number,yaw:number,tilt:number}>}
 */
export function crownShards(seed) {
  const rng = createStream((seed ^ hashString('world.crown')) >>> 0);
  const out = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2 + rng.range(-0.06, 0.06);
    const d = 300 + ((i * 7) % 10) * 40 + rng.range(-20, 20);
    out.push({ x: Math.cos(a) * d, y: rng.range(500, 900), z: Math.sin(a) * d, r: rng.range(14, 32), yaw: rng.range(0, Math.PI * 2), tilt: rng.range(-0.3, 0.3) });
  }
  return out;
}

/**
 * Build every POI. Deterministic for a seed and a grid.
 * @param {PoiQuery} q @param {number} seed @returns {Poi[]}
 */
export function placePois(q, seed) {
  /** @type {Poi[]} */
  const all = [];
  const lm = Object.create(null);
  for (const l of LANDMARKS) lm[l.id] = l;
  const add = (id, type, x, y, z, data) => {
    all.push({ id, type, x, y, z, regionId: q.regionAt(x, z), data });
  };
  for (const id of RINGSTONE_AT) add('ringstone_' + id, 'ringstone', lm[id].x, q.heightAt(lm[id].x, lm[id].z), lm[id].z, { landmarkId: id });
  SHRINES.forEach(([x, z], i) => add('shrine_' + String(i + 1).padStart(2, '0'), 'shrine', x, Math.max(0, q.heightAt(x, z)), z, {}));
  for (let i = 1; i <= 5; i++) {
    const l = lm['siphon_' + i];
    add(l.id, 'siphon', l.x, q.heightAt(l.x, l.z), l.z, { landmarkId: l.id });
  }
  const wr = lm.windmill_run;
  add('race_windmill_run', 'race', wr.x, q.heightAt(wr.x, wr.z), wr.z, { courseId: 'windmill_run' });

  // ---- coverage state
  const samples = coverSamples(q);
  const covered = new Uint8Array(samples.length);
  const R2 = COVER_RADIUS * COVER_RADIUS;
  const cover = (x, z) => {
    for (let i = 0; i < samples.length; i++) {
      const dx = samples[i].x - x;
      const dz = samples[i].z - z;
      if (dx * dx + dz * dz <= R2) covered[i] = 1;
    }
  };
  const gain = (x, z) => {
    let g = 0;
    for (let i = 0; i < samples.length; i++) {
      if (covered[i]) continue;
      const dx = samples[i].x - x;
      const dz = samples[i].z - z;
      if (dx * dx + dz * dz <= R2) g++;
    }
    return g;
  };
  for (const l of LANDMARKS) if (l.tag === 'P0') cover(l.x, l.z);
  for (const p of all) cover(p.x, p.z);

  const settlements = LANDMARKS.filter((l) => l.type === 'settlement');
  const spot = { x: 0, y: 0, z: 0 };
  const rng = createStream((seed ^ hashString('world.pois')) >>> 0);

  /**
   * Greedy placement of `count` POIs in a region.
   * @param {string} regionId @param {number} count @param {(x:number,z:number)=>boolean} ok extra rule
   * @param {{maxSlope:number}} opts @param {(x:number,z:number,h:number)=>number} bonus
   * @returns {Array<{x:number,y:number,z:number}>}
   */
  function greedy(regionId, count, ok, opts, bonus) {
    const r = REGIONS[REGION_INDEX[regionId]];
    /** @type {Array<{x:number,y:number,z:number}>} */
    const cands = [];
    const step = 110;
    for (let z = r.cz - 1900; z <= r.cz + 1900; z += step) {
      for (let x = r.cx - 1900; x <= r.cx + 1900; x += step) {
        const jx = x + rng.range(-35, 35);
        const jz = z + rng.range(-35, 35);
        if (q.regionAt(jx, jz) !== regionId || q.heightAt(jx, jz) < 2) continue;
        if (!q.findSpot(jx, jz, 40, spot, opts)) continue;
        if (q.regionAt(spot.x, spot.z) !== regionId) continue;
        cands.push({ x: spot.x, y: spot.y, z: spot.z });
      }
    }
    const placed = [];
    for (let n = 0; n < count; n++) {
      let best = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < cands.length; i++) {
        const c = cands[i];
        if (!ok(c.x, c.z)) continue;
        let near = false;
        for (const p of placed) if ((p.x - c.x) * (p.x - c.x) + (p.z - c.z) * (p.z - c.z) < 300 * 300) near = true;
        if (near) continue;
        const s = gain(c.x, c.z) * 100 + bonus(c.x, c.z, c.y) + rng.next() * 3;
        if (s > bestScore) {
          bestScore = s;
          best = i;
        }
      }
      if (best < 0) break;
      const c = cands[best];
      placed.push(c);
      cover(c.x, c.z);
    }
    return placed;
  }

  for (const regionId of CAMP_REGIONS) {
    const r = REGIONS[REGION_INDEX[regionId]];
    const camps = greedy(
      regionId, 5,
      (x, z) => settlements.every((s) => (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z) >= 250 * 250),
      { maxSlope: 0.35 },
      () => 0,
    );
    camps.forEach((c, i) => {
      const n = i + 1;
      add(`camp_${regionId}_${n}`, 'camp', c.x, c.y, c.z, { tier: n <= 3 ? 1 : n === 4 ? 2 : 3, level: q.regionLevel(c.x, c.z) });
    });
    // Chests prefer high ground: peaks, sea stacks and ledges.
    const chests = greedy(regionId, 4, () => true, { maxSlope: 0.6 }, (x, z, h) => Math.min(60, h * 0.15));
    chests.forEach((c, i) => add(`chest_${regionId}_${i + 1}`, 'chest', c.x, c.y, c.z, { table: r.chestTable }));
  }
  const shards = crownShards(seed);
  for (let n = 1; n <= 6; n++) {
    const s = shards[(n * 7 + 3) % shards.length];
    add(`crownChest_spire_${n}`, 'crownChest', s.x, s.y + s.r * 0.55, s.z, { table: 'chest_t3' });
  }
  return all;
}

/**
 * Lattice samples left uncovered by the 500 m rule (for tests and diagnostics).
 * @param {PoiQuery} q @param {Poi[]} pois @returns {Array<{x:number,z:number,regionId:string}>}
 */
export function uncovered(q, pois) {
  const pts = [];
  for (const l of LANDMARKS) if (l.tag === 'P0') pts.push(l.x, l.z);
  for (const p of pois) pts.push(p.x, p.z);
  const R2 = COVER_RADIUS * COVER_RADIUS;
  return coverSamples(q).filter((s) => {
    for (let i = 0; i < pts.length; i += 2) if ((pts[i] - s.x) * (pts[i] - s.x) + (pts[i + 1] - s.z) * (pts[i + 1] - s.z) <= R2) return false;
    return true;
  });
}
