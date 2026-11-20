/**
 * Ground tufts (ART_UX 1.2 / 1.8, visual quality pass): one instanced mesh of small grass and herb clumps on a
 * jittered 1.25 m lattice around the player, so the near ground the phone camera looks down on is never a flat
 * fill. Density and colour come from the region (foliage tokens, a few flower clumps in the accent colours);
 * paths, scorch, steep slopes, water and snow stay bare. One draw call, about 6 triangles per clump, refilled when
 * the player crosses a 3 m cell and hidden in flight. Visual only: no colliders, no simulation state.
 * Radius, density and instance cap come from the tier caps (render.caps.tuftRadius, tuftDensity, tuftInstances; low
 * smaller and sparser than high). The instance buffers are sized for the tier (resized on a tier change only) and a
 * refill uploads only the instances it wrote.
 * @module world/tufts
 */

import { BufferGeometry, BufferAttribute, InstancedMesh, InstancedBufferAttribute, Color } from 'three';
import { PALETTE } from '../core/palette.js';
import { hash2 } from '../core/rng.js';
import { REGIONS, FLAG, R_FROSTSPINE } from './gen/layout.js';

const CELL = 1.25;
/** Hard limits whatever the caps say. */
const MAX_RADIUS = 40;
const MAX = 2400;
const STEP = 3;
/** Fallbacks when the caps carry no tuft rows (the high row of render/logic/tiers). */
const DEF_RADIUS = 30;
const DEF_DENSITY = 1;
const DEF_INSTANCES = 1700;

/**
 * Tuft settings from the tier caps, clamped. Pure.
 * @param {any} caps @param {{ radius:number, density:number, instances:number }} out
 * @returns {{ radius:number, density:number, instances:number }}
 */
export function tuftSettings(caps, out) {
  const r = caps && typeof caps.tuftRadius === 'number' ? caps.tuftRadius : DEF_RADIUS;
  const d = caps && typeof caps.tuftDensity === 'number' ? caps.tuftDensity : DEF_DENSITY;
  const n = caps && typeof caps.tuftInstances === 'number' ? caps.tuftInstances : DEF_INSTANCES;
  out.radius = Math.max(0, Math.min(MAX_RADIUS, r));
  out.density = Math.max(0, Math.min(1, d));
  out.instances = Math.max(0, Math.min(MAX, Math.floor(n)));
  return out;
}
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
export function createTufts(ctx, grid, seed, clear) {
  const bareMask = new Uint8Array((Math.ceil(MAX_RADIUS / CELL) * 2 + 1) ** 2);
  const flowerD = new Color(PALETTE.paper);
  const foliage = REGIONS.map((r) => new Color(PALETTE.biome[r.biome].foliage));
  const ground = REGIONS.map((r) => new Color(PALETTE.biome[r.biome].ground));
  const flowerA = new Color(PALETTE.biome.meadows.accent);
  const flowerB = new Color(PALETTE.flora.brambleFlower);
  const flowerC = new Color(PALETTE.flora.redLeaf);
  const mat = ctx.render.materials.toon({ vertexColors: true, instanced: true, wind: true, doubleSide: true });
  const set = tuftSettings(ctx.render.caps, { radius: 0, density: 0, instances: 0 });
  const cap0 = Math.max(1, set.instances);
  const mesh = new InstancedMesh(clumpGeometry(), mat, cap0);
  mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(cap0 * 3), 3);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.name = 'world.tufts';
  // clumps right under the lens would fill the screen with giant blades: they shrink toward the root within ~3 m of
  // the camera (negative uNearHide, down to 55%) instead of leaving a bare band
  if (mat.uniforms.uNearHide) mat.uniforms.uNearHide.value = -3;
  ctx.render.layers.props.add(mesh);
  const tmp = new Color();
  let lastI = -1e9;
  let lastJ = -1e9;
  let dirty = true;

  /** @param {number} px @param {number} pz */
  function refill(px, pz) {
    tuftSettings(ctx.render.caps, set);
    const cap = Math.max(1, set.instances);
    if (mesh.instanceMatrix.count !== cap) {
      // tier change (not a frame path): new buffers; dispose releases the old GPU buffers (WebGLObjects)
      mesh.dispose();
      mesh.instanceMatrix = new InstancedBufferAttribute(new Float32Array(cap * 16), 16);
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    }
    const max = set.instances;
    const dmul = set.density;
    const e = mesh.instanceMatrix.array;
    const ca = mesh.instanceColor.array;
    const ci = Math.floor(px / CELL);
    const cj = Math.floor(pz / CELL);
    const rc = set.radius / CELL;
    const r2 = rc * rc;
    const span = Math.ceil(rc);
    let n = 0;
    let nn = 0;
    // bare discs near the player, rasterised once per refill into a mask over the tuft lattice
    const side = span * 2 + 1;
    if (clear) {
      bareMask.fill(0, 0, side * side);
      for (let k = 0; k < clear.n; k++) {
        const ex = px - clear.x[k];
        const ez = pz - clear.z[k];
        const cr = clear.r[k];
        const rr = set.radius + cr + 2;
        if (ex * ex + ez * ez >= rr * rr) continue;
        nn++;
        const i0 = Math.max(-span, Math.floor((clear.x[k] - cr) / CELL) - ci);
        const i1 = Math.min(span, Math.floor((clear.x[k] + cr) / CELL) - ci);
        const j0 = Math.max(-span, Math.floor((clear.z[k] - cr) / CELL) - cj);
        const j1 = Math.min(span, Math.floor((clear.z[k] + cr) / CELL) - cj);
        for (let dj = j0; dj <= j1; dj++) {
          for (let di = i0; di <= i1; di++) {
            const qx = (ci + di + 0.5) * CELL - clear.x[k];
            const qz = (cj + dj + 0.5) * CELL - clear.z[k];
            if (qx * qx + qz * qz < cr * cr) bareMask[(dj + span) * side + di + span] = 1;
          }
        }
      }
    }
    for (let dj = -span; dj <= span && n < max; dj++) {
      for (let di = -span; di <= span && n < max; di++) {
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
        let dens = (DENSITY[ri] || 0.3) * dmul;
        const fl = grid.flagsAt(x, z);
        if ((fl & (FLAG.PATH | FLAG.SCORCH | FLAG.WATER)) !== 0) continue;
        if ((fl & FLAG.SETTLEMENT) !== 0) dens *= 0.45;
        const field = (fl & FLAG.FIELD) !== 0;
        if (field) dens = dens * 1.25 + 0.1;
        // paving, floors and lanes stay bare (settlement plazas, building footprints, POI pads)
        if (nn > 0 && bareMask[(dj + span) * side + di + span] === 1) continue;
        if (ri === R_FROSTSPINE && y > 470) continue;
        if (u0 > dens) continue;
        if (grid.slopeAt(x, z) > 0.42) continue;
        // colour: the region's foliage pulled a little toward its ground, value jitter; a few flower clumps
        const v = ((h >>> 26) & 63) / 63;
        tmp.copy(foliage[ri]).lerp(ground[ri], 0.18 + 0.25 * v).multiplyScalar(0.92 + 0.22 * v);
        const fsel = (h >>> 4) & 63;
        if (field && fsel < 30) tmp.copy(ri === 2 || ri === 1 ? (fsel < 18 ? flowerB : flowerD) : fsel < 14 ? flowerA : fsel < 22 ? flowerC : flowerD);
        else if (ri === 0 && fsel < 7) tmp.copy(fsel < 4 ? flowerA : flowerC);
        else if (ri === 2 && fsel < 4) tmp.copy(flowerB);
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
    if (n === 0) return;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, n * 16);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.clearUpdateRanges();
    mesh.instanceColor.addUpdateRange(0, n * 3);
    mesh.instanceColor.needsUpdate = true;
  }

  return {
    /**
     * @param {number} px player x @param {number} py player y @param {number} pz player z
     * @param {number} camY camera height @param {boolean} force
     */
    update(px, py, pz, camY, force) {
      const alt = Math.min(py, camY) - grid.heightAt(px, pz);
      tuftSettings(ctx.render.caps, set);
      mesh.visible = alt < 28 && set.instances > 0 && set.radius > 0;
      if (!mesh.visible) return;
      const i = Math.floor(px / STEP);
      const j = Math.floor(pz / STEP);
      if (!force && !dirty && i === lastI && j === lastJ) return;
      lastI = i;
      lastJ = j;
      dirty = false;
      refill(px, pz);
    },
    /** The ground or the tier caps changed (crater, quality change): rebuild on the next update. */
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
      mesh.dispose();
    },
  };
}
