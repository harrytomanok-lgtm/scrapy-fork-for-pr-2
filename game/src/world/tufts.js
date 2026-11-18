/**
 * Ground tufts (ART_UX 1.2 / 1.8, visual quality pass): one instanced mesh of small grass and herb clumps on a
 * jittered 1.25 m lattice around the player, so the near ground the phone camera looks down on is never a flat
 * fill. Density and colour come from the region (foliage tokens, a few flower clumps in the accent colours);
 * paths, scorch, steep slopes, water and snow stay bare. One draw call, about 6 triangles per clump, refilled when
 * the player crosses a 3 m cell and hidden in flight. Visual only: no colliders, no simulation state.
 * @module world/tufts
 */

import { BufferGeometry, BufferAttribute, InstancedMesh, InstancedBufferAttribute, Color } from 'three';
import { PALETTE } from '../core/palette.js';
import { hash2 } from '../core/rng.js';
import { REGIONS, FLAG, R_FROSTSPINE } from './gen/layout.js';

const CELL = 1.25;
const RADIUS = 30;
const SPAN = Math.ceil(RADIUS / CELL);
const MAX = 1700;
const STEP = 3;
/** Clumps per cell by region index (meadows, coast, thornwood, rustdune, frostspine, stormwell, spire). */
const DENSITY = [0.8, 0.22, 0.62, 0.16, 0.3, 0.45, 0.32];

/** A clump of five leaning blades with upward normals (shaded like the ground), dark at the root, light at the tip. */
function clumpGeometry() {
  const pos = [];
  const col = [];
  const blades = 5;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + (i % 2) * 0.4;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const r0 = 0.05;
    const lean = 0.12 + (i % 3) * 0.05;
    const h = 0.32 + ((i * 7) % 5) * 0.06;
    const w = 0.055;
    // root edge across the blade direction, tip leaning outward
    const bx = ca * r0;
    const bz = sa * r0;
    pos.push(bx - sa * w, 0, bz + ca * w, bx + sa * w, 0, bz - ca * w, ca * (r0 + lean), h, sa * (r0 + lean));
    col.push(0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 1.12, 1.12, 1.12);
  }
  const g = new BufferGeometry();
  const n = pos.length / 3;
  const nrm = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) nrm[i * 3 + 1] = 1;
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(nrm, 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.computeBoundingSphere();
  return g;
}

/**
 * @param {any} ctx
 * @param {ReturnType<import('./gen/grid.js').createGrid>} grid
 * @param {number} seed
 */
export function createTufts(ctx, grid, seed) {
  const foliage = REGIONS.map((r) => new Color(PALETTE.biome[r.biome].foliage));
  const ground = REGIONS.map((r) => new Color(PALETTE.biome[r.biome].ground));
  const flowerA = new Color(PALETTE.biome.meadows.accent);
  const flowerB = new Color(PALETTE.flora.brambleFlower);
  const flowerC = new Color(PALETTE.flora.redLeaf);
  const mat = ctx.render.materials.toon({ vertexColors: true, instanced: true, wind: true, doubleSide: true });
  const mesh = new InstancedMesh(clumpGeometry(), mat, MAX);
  mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.name = 'world.tufts';
  // clumps right under the lens would fill the screen with giant blades: hide those within ~2.5 m of the camera
  if (mat.uniforms.uNearHide) mat.uniforms.uNearHide.value = 2.8;
  ctx.render.layers.props.add(mesh);
  const tmp = new Color();
  let lastI = -1e9;
  let lastJ = -1e9;
  let dirty = true;

  /** @param {number} px @param {number} pz */
  function refill(px, pz) {
    const e = mesh.instanceMatrix.array;
    const ca = mesh.instanceColor.array;
    const ci = Math.floor(px / CELL);
    const cj = Math.floor(pz / CELL);
    const r2 = (RADIUS / CELL) * (RADIUS / CELL);
    let n = 0;
    for (let dj = -SPAN; dj <= SPAN && n < MAX; dj++) {
      for (let di = -SPAN; di <= SPAN && n < MAX; di++) {
        if (di * di + dj * dj > r2) continue;
        const i = ci + di;
        const j = cj + dj;
        const h = hash2(i, j, seed ^ 0x51f7);
        const u0 = (h & 1023) / 1023;
        const x = (i + 0.15 + 0.7 * (((h >>> 10) & 255) / 255)) * CELL;
        const z = (j + 0.15 + 0.7 * (((h >>> 18) & 255) / 255)) * CELL;
        const y = grid.heightAt(x, z);
        if (y < 1.2) continue;
        const ri = grid.regionIndexAt(x, z);
        let dens = DENSITY[ri] || 0.3;
        const fl = grid.flagsAt(x, z);
        if ((fl & (FLAG.PATH | FLAG.SCORCH | FLAG.WATER)) !== 0) continue;
        if ((fl & FLAG.SETTLEMENT) !== 0) dens *= 0.45;
        if (ri === R_FROSTSPINE && y > 470) continue;
        if (u0 > dens) continue;
        if (grid.slopeAt(x, z) > 0.42) continue;
        // colour: the region's foliage pulled a little toward its ground, value jitter; a few flower clumps
        const v = ((h >>> 26) & 63) / 63;
        tmp.copy(foliage[ri]).lerp(ground[ri], 0.18 + 0.25 * v).multiplyScalar(0.92 + 0.22 * v);
        const fsel = (h >>> 4) & 63;
        if (ri === 0 && fsel < 4) tmp.copy(fsel < 2 ? flowerA : flowerC);
        else if (ri === 2 && fsel < 3) tmp.copy(flowerB);
        const s = 0.6 + 0.55 * (((h >>> 12) & 63) / 63);
        const yaw = ((h >>> 6) & 255) * 0.0245;
        const c = Math.cos(yaw) * s;
        const sn = Math.sin(yaw) * s;
        const o = n * 16;
        e[o] = c; e[o + 1] = 0; e[o + 2] = -sn; e[o + 3] = 0;
        e[o + 4] = 0; e[o + 5] = s; e[o + 6] = 0; e[o + 7] = 0;
        e[o + 8] = sn; e[o + 9] = 0; e[o + 10] = c; e[o + 11] = 0;
        e[o + 12] = x; e[o + 13] = y - 0.03; e[o + 14] = z; e[o + 15] = 1;
        ca[n * 3] = tmp.r; ca[n * 3 + 1] = tmp.g; ca[n * 3 + 2] = tmp.b;
        n++;
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }

  return {
    /**
     * @param {number} px player x @param {number} py player y @param {number} pz player z
     * @param {number} camY camera height @param {boolean} force
     */
    update(px, py, pz, camY, force) {
      const alt = Math.min(py, camY) - grid.heightAt(px, pz);
      mesh.visible = alt < 28;
      if (!mesh.visible) return;
      const i = Math.floor(px / STEP);
      const j = Math.floor(pz / STEP);
      if (!force && !dirty && i === lastI && j === lastJ) return;
      lastI = i;
      lastJ = j;
      dirty = false;
      refill(px, pz);
    },
    /** The ground changed (crater): rebuild on the next update. */
    invalidate() {
      dirty = true;
    },
    /** @returns {number} */
    count() {
      return mesh.visible ? mesh.count : 0;
    },
    dispose() {
      if (mesh.parent) mesh.parent.remove(mesh);
      mesh.geometry.dispose();
      mat.dispose();
    },
  };
}
