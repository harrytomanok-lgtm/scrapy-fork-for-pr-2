/**
 * Ora shards (the exploration pass: flying with a purpose). A fixed, seeded set per content region, placed where only
 * a flyer goes: the region's peaks (the highest is its viewpoint, which reveals the region's points of interest),
 * high in the open air, above settlement roofs and landmarks (the Saltglass Arches, the Tide Beacon), and on the
 * islets and sea stacks off the shore. Placement reads only the height and region queries, so the browser (4 m grid)
 * and the Node tools (8 m grid) place the same set. Pure.
 * @module rpg/data/shards
 */

import { BALANCE } from '../../core/balance.js';

/** Content regions with shards, and how many of each kind. */
export const SHARD_REGIONS = Object.freeze(['meadows', 'coast', 'thornwood', 'rustdune', 'frostspine', 'spire']);
export const SHARDS_PER_REGION = Object.freeze({ peaks: 3, sky: 2, roofs: 2, islets: 1 });
/** Collect reach (m), and the larger reach while flying or boosting past (the pickup flies to the player). */
export const SHARD_REACH = 3;
export const SHARD_REACH_FLY = 9;
/** XP of one shard, and the viewpoint radius (m) and its reveal. */
export const SHARD_XP = 25;

/** Rewards at shard counts (the last one is "all of them", filled in from the placed total). */
export function shardRewards(total) {
  const out = [
    { at: 5, kind: 'tp', amount: 1 },
    { at: 10, kind: 'shells', amount: 300 },
    { at: 15, kind: 'tp', amount: 1 },
    { at: 25, kind: 'shells', amount: 600 },
    { at: 35, kind: 'tp', amount: 1 },
  ];
  if (total > 35) out.push({ at: total, kind: 'title', amount: 1000, title: 'skyreader' });
  return out;
}

/** A small integer hash (deterministic placement without the sim rng). @param {number} a @param {number} b */
function hash(a, b) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Place every shard.
 * @param {(x:number, z:number) => number} heightAt @param {(x:number, z:number) => string} regionAt
 * @param {any[]} regions RegionDefs in their fixed order (defs 'region') @param {any[]} landmarks LandmarkDefs
 * @returns {Array<{ id:string, x:number, y:number, z:number, regionId:string, kind:'peak'|'sky'|'roof'|'islet', view:boolean }>}
 */
export function placeShards(heightAt, regionAt, regions, landmarks) {
  const out = [];
  const N = SHARDS_PER_REGION;
  regions.forEach((reg, ri) => {
    if (SHARD_REGIONS.indexOf(reg.id) < 0) return;
    const span = reg.radius ? reg.radius : 1150;
    const cand = [];
    const shore = [];
    for (let gx = -span; gx <= span; gx += 48) {
      for (let gz = -span; gz <= span; gz += 48) {
        const x = reg.cx + gx;
        const z = reg.cz + gz;
        if (regionAt(x, z) !== reg.id) continue;
        const h = heightAt(x, z);
        cand.push({ x, z, h });
        if (h > 0.6 && h < 6 && (heightAt(x + 40, z) < 0 || heightAt(x - 40, z) < 0 || heightAt(x, z + 40) < 0 || heightAt(x, z - 40) < 0)) shore.push({ x, z, h });
      }
    }
    const list = [];
    const far = (x, z, d) => list.every((s) => (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z) >= d * d);
    const push = (kind, x, y, z) => list.push({ id: 'shard_' + reg.id + '_' + (list.length + 1), x: Math.round(x), y: Math.round(y * 10) / 10, z: Math.round(z),
      regionId: reg.id, kind, view: false });
    // Peaks: the highest points, 300 m apart; the first is the viewpoint.
    cand.sort((a, b) => b.h - a.h || a.x - b.x || a.z - b.z);
    for (const c of cand) {
      if (list.length >= N.peaks) break;
      if (far(c.x, c.z, 300)) push('peak', c.x, c.h + 3, c.z);
    }
    if (list.length) list[0].view = true;
    // High in the open air: seeded spots well inside the region, 90-150 m above the ground.
    for (let k = 0, tries = 0; k < N.sky && tries < 40; tries++) {
      const x = reg.cx + (hash(ri, tries * 2 + 1) * 2 - 1) * span * 0.7;
      const z = reg.cz + (hash(ri, tries * 2 + 2) * 2 - 1) * span * 0.7;
      if (regionAt(x, z) !== reg.id || !far(x, z, 250)) continue;
      push('sky', x, Math.max(0, heightAt(x, z)) + 90 + hash(tries, ri) * 60, z);
      k++;
    }
    // Above roofs and landmarks of the region.
    let roofs = 0;
    for (const l of landmarks) {
      if (roofs >= N.roofs || l.tag === 'P1' || regionAt(l.x, l.z) !== reg.id) continue;
      if (l.type !== 'settlement' && l.type !== 'landmark' && l.type !== 'spire') continue;
      if (!far(l.x, l.z, 120)) continue;
      push('roof', l.x + 8, Math.max(0, heightAt(l.x, l.z)) + (l.type === 'spire' ? 60 : 16), l.z + 6);
      roofs++;
    }
    // Islets and sea stacks off the shore.
    shore.sort((a, b) => (Math.hypot(b.x - reg.cx, b.z - reg.cz) - Math.hypot(a.x - reg.cx, a.z - reg.cz)) || a.x - b.x);
    for (let k = 0, i = 0; k < N.islets && i < shore.length; i++) {
      const s = shore[i];
      if (!far(s.x, s.z, 250)) continue;
      push('islet', s.x, s.h + 2.5, s.z);
      k++;
    }
    for (const s of list) out.push(s);
  });
  return out;
}

/** Discovery XP of a viewpoint (a landmark's). */
export const VIEWPOINT_XP = BALANCE.xp.discovery.landmark;
