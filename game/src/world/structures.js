/**
 * The Wellspring Spire (a 900 m hexagonal crystal pillar with a slow inner pulse, root shards and a ringed
 * foot) and the Shattered Crown (about 40 floating crystal-rock shards), with their colliders (GDD 3.3,
 * ART_UX 1.10). Each is one merged mesh with baked vertex colours: two draw calls.
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

  // ---- the Crown
  const C = soup();
  const shards = crownShards(seed);
  for (let i = 0; i < shards.length; i++) {
    const s = shards[i];
    const r = s.r;
    const tilt = s.tilt * r;
    // Rock underside (inverted cone), crystal top (short hex column with an apex).
    hexCol(C, s.x, s.z, s.y - r * 1.4, 0.0001, s.y, r, s.yaw, k(sp.cliff, 0.78), sp.cliff);
    hexCol(C, s.x, s.z, s.y, r, s.y + r * 0.35, r * 0.82, 0.1, sp.cliff, sp.ground);
    hexCol(C, s.x, s.z, s.y + r * 0.35, r * 0.82, s.y + r * (1.1 + (i % 3) * 0.4), 0, 0, sp.ground, sp.accent, tilt, -tilt * 0.5);
    colliders.add({ shape: 'sphere', x: s.x, y: s.y, z: s.z, r: r * 0.95, flags: COLLIDER.SOLID });
  }
  const crownMat = ctx.render.materials.toon({ vertexColors: true, emissive: PALETTE.biome.spire.ground, emissiveIntensity: 0.16, fogScale: 0.55, glossy: true });
  const crown = new Mesh(C.geometry(), crownMat);
  crown.matrixAutoUpdate = false;
  crown.frustumCulled = false;
  ctx.render.layers.world.add(crown);

  return {
    /** Slow inner pulse of the Spire. @param {number} t seconds */
    update(t) {
      spireMat.uniforms.uEmissiveIntensity.value = 0.08 + 0.06 * (0.5 + 0.5 * Math.sin(t * 0.7));
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
