/**
 * Region and placement queries over a grid (ARCHITECTURE 4.1): regionAt, regionLevel, surfaceAt, edgeFactor and
 * findSpot. Pure; the service adds the collider test to findSpot through `blocked`.
 * @module world/gen/queries
 */

import { regionLevel as bandLevel } from '../../core/formulas.js';
import { REGIONS, LANDMARKS, R_FROSTSPINE, R_COAST, R_RUSTDUNE, R_SPIRE, R_STORMWELL, FLAG } from './layout.js';

export const EDGE_START = 3300;
export const EDGE_HARD = 3450;

/**
 * @param {ReturnType<import('./grid.js').createGrid>} grid
 * @param {(x:number, y:number, z:number, clearance:number) => boolean} [blocked] true when a SOLID collider is there
 */
export function createQueries(grid, blocked) {
  const spark = LANDMARKS.find((l) => l.id === 'sparkstead');

  /** @param {number} x @param {number} z @returns {string} */
  function regionAt(x, z) {
    return REGIONS[grid.regionIndexAt(x, z)].id;
  }

  /** Enemy level: the band interpolated from the Sparkstead side to the far side (GDD 3.2). */
  function regionLevel(x, z) {
    const r = REGIONS[grid.regionIndexAt(x, z)];
    const d = Math.sqrt((x - spark.x) * (x - spark.x) + (z - spark.z) * (z - spark.z));
    const dc = Math.sqrt((r.cx - spark.x) * (r.cx - spark.x) + (r.cz - spark.z) * (r.cz - spark.z));
    return bandLevel(r.levels, 0.5 + (d - dc) / 1200);
  }

  /** @param {number} x @param {number} z @returns {number} */
  function edgeFactor(x, z) {
    const r = Math.sqrt(x * x + z * z);
    const t = (r - EDGE_START) / (EDGE_HARD - EDGE_START);
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }

  /** @param {number} x @param {number} z @returns {'grass'|'stone'|'snow'|'sand'|'water'} */
  function surfaceAt(x, z) {
    const h = grid.heightAt(x, z);
    if (h < 0) return 'water';
    const ri = grid.regionIndexAt(x, z);
    if ((grid.flagsAt(x, z) & FLAG.SCORCH) !== 0) return 'stone';
    if (ri === R_FROSTSPINE && h > 500) return 'snow';
    if (grid.slopeAt(x, z) > 0.5) return 'stone';
    if (h < 2.6 || ri === R_COAST || ri === R_RUSTDUNE) return 'sand';
    if (ri === R_SPIRE || ri === R_STORMWELL) return 'stone';
    return 'grass';
  }

  /**
   * Nearest dry, walkable, collider-free spot within `radius` (rings of 4 m).
   * @param {number} x @param {number} z @param {number} radius @param {{x:number,y:number,z:number}} out
   * @param {{ maxSlope?:number, clearance?:number }} [opts] @returns {boolean}
   */
  function findSpot(x, z, radius, out, opts) {
    const maxSlope = opts && opts.maxSlope !== undefined ? opts.maxSlope : 0.5;
    const clearance = opts && opts.clearance !== undefined ? opts.clearance : 1.5;
    const ring = 4;
    for (let rr = 0; rr <= radius; rr += ring) {
      const count = rr === 0 ? 1 : Math.max(6, Math.floor((Math.PI * 2 * rr) / ring));
      for (let k = 0; k < count; k++) {
        const a = (k / count) * Math.PI * 2;
        const px = x + Math.cos(a) * rr;
        const pz = z + Math.sin(a) * rr;
        const h = grid.heightAt(px, pz);
        if (h < 0.5 || edgeFactor(px, pz) > 0) continue;
        if (grid.slopeAt(px, pz) > maxSlope) continue;
        if (blocked && blocked(px, h + 1, pz, clearance)) continue;
        out.x = px;
        out.y = h;
        out.z = pz;
        return true;
      }
    }
    out.x = x;
    out.y = grid.heightAt(x, z);
    out.z = z;
    return false;
  }

  return { regionAt, regionLevel, edgeFactor, surfaceAt, findSpot, heightAt: grid.heightAt, slopeAt: grid.slopeAt };
}
