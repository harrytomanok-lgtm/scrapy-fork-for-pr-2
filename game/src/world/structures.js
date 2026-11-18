/**
 * The Wellspring Spire (a 900 m hexagonal crystal pillar with a slow inner pulse, root shards and a ringed
 * foot) and the Shattered Crown (a ring of 16 large and 6 small floating crystal-rock shards around the top of the
 * Spire, each slowly turning about its own axis), with their colliders (GDD 3.3, ART_UX 1.10). Each is one merged
 * mesh with baked vertex colours: two draw calls.
 * @module world/structures
 */

import { BufferGeometry, BufferAttribute, Mesh, Color, Vector3 } from 'three';
import { PALETTE } from '../core/palette.js';
import { hash2 } from '../core/rng.js';
import { COLLIDER } from './gen/colliders.js';
import { crownShards } from './gen/pois.js';

/** Flat-shaded triangle soup. */
function soup() {
  const pos = [];
  const col = [];
  const c = new Color();
  return {
    tri(a, b, d, c0, c1, c2) {
      pos.push(a[0], a[1], a[2], b[0], b[1], b[2], d[0], d[1], d[2]);
      for (const h of [c0, c1 === undefined ? c0 : c1, c2 === undefined ? c0 : c2]) {
        c.set(h);
        col.push(c.r, c.g, c.b);
      }
    },
    /** @returns {number} triangles so far */
    count() {
      return pos.length / 9;
    },
    geometry() {
      const g = new BufferGeometry();
      const p = new Float32Array(pos);
      const n = new Float32Array(p.length);
      const e1 = new Vector3();
      const e2 = new Vector3();
      for (let i = 0; i < p.length; i += 9) {
        e1.set(p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2]);
        e2.set(p[i + 6] - p[i], p[i + 7] - p[i + 1], p[i + 8] - p[i + 2]);
        e1.cross(e2).normalize();
        for (let k = 0; k < 3; k++) {
          n[i + k * 3] = e1.x; n[i + k * 3 + 1] = e1.y; n[i + k * 3 + 2] = e1.z;
        }
      }
      g.setAttribute('position', new BufferAttribute(p, 3));
      g.setAttribute('normal', new BufferAttribute(n, 3));
      g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
      g.computeBoundingSphere();
      return g;
    },
  };
}

/** Hexagonal frustum from (cx, y0, cz) r0 to y1 r1, twisted by `tw`; apex when r1 = 0. */
function hexCol(S, cx, cz, y0, r0, y1, r1, tw, cBot, cTop, tx, tz) {
  const ox = tx || 0;
  const oz = tz || 0;
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2;
    const a1 = ((i + 1) / 6) * Math.PI * 2;
    const b0 = [cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0];
    const b1 = [cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0];
    if (r1 <= 0) {
      S.tri(b0, [cx + ox, y1, cz + oz], b1, cBot, cTop, cBot);
      continue;
    }
    const t0 = [cx + ox + Math.cos(a0 + tw) * r1, y1, cz + oz + Math.sin(a0 + tw) * r1];
    const t1 = [cx + ox + Math.cos(a1 + tw) * r1, y1, cz + oz + Math.sin(a1 + tw) * r1];
    S.tri(b0, t0, b1, cBot, cTop, cBot);
    S.tri(b1, t0, t1, cBot, cTop, cTop);
  }
}

/**
 * @param {any} ctx
 * @param {ReturnType<import('./gen/grid.js').createGrid>} grid
 * @param {ReturnType<import('./gen/colliders.js').createColliders>} colliders
 * @param {number} seed
 */
export function createStructures(ctx, grid, colliders, seed) {
  const sp = PALETTE.biome.spire;
  const k = (hex, m) => new Color(hex).multiplyScalar(m).getHex();
  const baseY = grid.heightAt(0, 0) - 6;

  // ---- the Spire
  const S = soup();
  const segs = [[0, 60], [140, 56], [330, 52], [560, 47], [780, 42], [900, 30]];
  for (let i = 0; i < segs.length - 1; i++) {
    const [y0, r0] = segs[i];
    const [y1, r1] = segs[i + 1];
    const band = i % 2 === 0 ? 1 : 0.93;
    hexCol(S, 0, 0, baseY + y0, r0, baseY + y1, r1, 0.03, k(sp.shade, 1.05 * band), k(sp.ground, band));
  }
  hexCol(S, 0, 0, baseY + 900, 30, baseY + 985, 0, 0, sp.ground, sp.accent);
  // Root shards leaning out of the plateau.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.2;
    const d = 72 + (i % 3) * 14;
    const h = 40 + ((hash2(i, 5, seed) >>> 0) % 70);
    const cx = Math.cos(a) * d;
    const cz = Math.sin(a) * d;
    const gy = grid.heightAt(cx, cz) - 4;
    hexCol(S, cx, cz, gy, 9 + (i % 4) * 2, gy + h, 0, 0, sp.cliff, sp.accent, Math.cos(a) * h * 0.25, Math.sin(a) * h * 0.25);
  }
  // A ring terrace at the foot.
  for (let i = 0; i < 24; i++) {
    const a0 = (i / 24) * Math.PI * 2;
    const a1 = ((i + 1) / 24) * Math.PI * 2;
    const ri = 64;
    const ro = 92;
    const y = baseY + 7;
    const p = (a, r, yy) => [Math.cos(a) * r, yy, Math.sin(a) * r];
    S.tri(p(a0, ri, y), p(a1, ri, y), p(a0, ro, y), k(sp.shade, 1.2));
    S.tri(p(a1, ri, y), p(a1, ro, y), p(a0, ro, y), k(sp.shade, 1.2));
    S.tri(p(a0, ro, y), p(a1, ro, y), p(a0, ro, y - 8), k(sp.shade, 0.9));
    S.tri(p(a1, ro, y), p(a1, ro, y - 8), p(a0, ro, y - 8), k(sp.shade, 0.9));
  }
  const spireMat = ctx.render.materials.toon({ vertexColors: true, emissive: PALETTE.ora, emissiveIntensity: 0.1, fogScale: 0.45, glossy: true });
  const spire = new Mesh(S.geometry(), spireMat);
  spire.matrixAutoUpdate = false;
  spire.frustumCulled = false;
  ctx.render.layers.world.add(spire);
  colliders.add({ shape: 'capsule', x: 0, y: baseY, z: 0, r: 60, h: 990, flags: COLLIDER.SOLID });

  // ---- the Crown: a ring around the top of the Spire, each shard a rock body (dark underside, cliff flank) with
  // two crystal points; the shards turn slowly about their own vertical axes (gameplay positions stay fixed)
  const C = soup();
  const shards = crownShards(seed, baseY);
  const shardTri = [];
  for (let i = 0; i < shards.length; i++) {
    const s = shards[i];
    const r = s.r;
    const tilt = s.tilt * r;
    const t0 = C.count();
    hexCol(C, s.x, s.z, s.y - r * 1.6, 0.0001, s.y - r * 0.2, r * 0.8, s.yaw, k(sp.shade, 0.55), k(sp.shade, 0.85));
    hexCol(C, s.x, s.z, s.y - r * 0.2, r * 0.8, s.y + r * 0.25, r, s.yaw + 0.25, k(sp.shade, 0.85), k(sp.cliff, 0.9));
    hexCol(C, s.x, s.z, s.y + r * 0.25, r, s.y + r * 0.35, r * 0.82, s.yaw + 0.3, k(sp.cliff, 0.9), sp.cliff);
    hexCol(C, s.x + r * 0.15, s.z, s.y + r * 0.3, r * 0.5, s.y + r * (1.0 + (i % 3) * 0.3), 0, s.yaw, sp.cliff, sp.ground, tilt, -tilt * 0.5);
    hexCol(C, s.x - r * 0.35, s.z + r * 0.2, s.y + r * 0.3, r * 0.3, s.y + r * 0.75, 0, s.yaw + 0.5, sp.cliff, sp.accent, -tilt * 0.6, tilt * 0.3);
    shardTri.push(t0, C.count());
    colliders.add({ shape: 'sphere', x: s.x, y: s.y, z: s.z, r: r * 0.95, flags: COLLIDER.SOLID });
  }
  const crownMat = ctx.render.materials.toon({ vertexColors: true, emissive: PALETTE.biome.spire.ground, emissiveIntensity: 0.06, fogScale: 2.2 });
  const crownGeo = C.geometry();
  const crown = new Mesh(crownGeo, crownMat);
  crown.matrixAutoUpdate = false;
  crown.frustumCulled = false;
  ctx.render.layers.world.add(crown);
  // spin data: rest positions and normals relative to each shard centre, and the shard of every vertex
  const cPos = crownGeo.attributes.position.array;
  const cNor = crownGeo.attributes.normal.array;
  const restP = new Float32Array(cPos.length);
  const restN = new Float32Array(cNor.length);
  const vShard = new Uint8Array(cPos.length / 3);
  for (let i = 0; i < shards.length; i++) {
    const s = shards[i];
    for (let v = shardTri[i * 2] * 3; v < shardTri[i * 2 + 1] * 3; v++) {
      vShard[v] = i;
      restP[v * 3] = cPos[v * 3] - s.x; restP[v * 3 + 1] = cPos[v * 3 + 1] - s.y; restP[v * 3 + 2] = cPos[v * 3 + 2] - s.z;
      restN[v * 3] = cNor[v * 3]; restN[v * 3 + 1] = cNor[v * 3 + 1]; restN[v * 3 + 2] = cNor[v * 3 + 2];
    }
  }
  const spinC = new Float32Array(shards.length);
  const spinS = new Float32Array(shards.length);
  const bob = new Float32Array(shards.length);
  let lastSpin = -1;

  return {
    /** Slow inner pulse of the Spire. @param {number} t seconds */
    update(t) {
      spireMat.uniforms.uEmissiveIntensity.value = 0.08 + 0.06 * (0.5 + 0.5 * Math.sin(t * 0.7));
      // the Crown turns: each shard spins slowly about its own axis and bobs (rewritten at about 8 Hz)
      if (lastSpin >= 0 && Math.abs(t - lastSpin) < 0.12) return;
      lastSpin = t;
      for (let i = 0; i < shards.length; i++) {
        const w = (i % 2 === 0 ? 0.05 : -0.04) * (i >= 16 ? 2 : 1);
        const a = t * w + i * 1.7;
        spinC[i] = Math.cos(a);
        spinS[i] = Math.sin(a);
        bob[i] = Math.sin(t * 0.21 + i * 2.3) * (i >= 16 ? 2.5 : 1.5);
      }
      for (let v = 0; v < vShard.length; v++) {
        const i = vShard[v];
        const s = shards[i];
        const c = spinC[i];
        const sn = spinS[i];
        const px = restP[v * 3];
        const pz = restP[v * 3 + 2];
        cPos[v * 3] = s.x + px * c - pz * sn;
        cPos[v * 3 + 1] = s.y + restP[v * 3 + 1] + bob[i];
        cPos[v * 3 + 2] = s.z + px * sn + pz * c;
        const nx = restN[v * 3];
        const nz = restN[v * 3 + 2];
        cNor[v * 3] = nx * c - nz * sn;
        cNor[v * 3 + 2] = nx * sn + nz * c;
      }
      crownGeo.attributes.position.needsUpdate = true;
      crownGeo.attributes.normal.needsUpdate = true;
    },
    dispose() {
      for (const m of [spire, crown]) {
        if (m.parent) m.parent.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      }
    },
  };
}
