/**
 * Structure kit (ART_UX 1.10): a merge builder that bakes transformed primitives into one palette-indexed toon
 * geometry (position, normal, vertex colour for baked shading, paletteIndex), plus the palette slots shared by
 * every settlement and prop. One settlement = one geometry = one draw call.
 * @module env/kit
 */

import {
  BufferGeometry, Float32BufferAttribute, Matrix4, Matrix3, Vector3, Color, CylinderGeometry, ConeGeometry, BoxGeometry,
  TorusGeometry, SphereGeometry, CircleGeometry, OctahedronGeometry, Quaternion, Euler,
} from 'three';
import { PALETTE } from '../core/palette.js';

/** Palette slots of the structure material (toon uPalette, 16 entries). */
export const SLOT = Object.freeze({
  CLAY: 0, TERRA: 1, COPPER: 2, CURTAIN: 3, WOOD: 4, WOOD_LIGHT: 5, STONE: 6, LANTERN: 7, CLOTH: 8, SNOW: 9, IRON: 10,
  WINDOW: 11, GLOW: 12, PATH: 13, INK: 14, ACCENT: 15,
});

/** Base colours of the slots (hex, palette tokens only). WINDOW and GLOW are rewritten at run time. */
export const SLOT_HEX = Object.freeze([
  PALETTE.structure.clay, PALETTE.structure.terracotta, PALETTE.structure.copper, PALETTE.structure.curtain,
  PALETTE.biome.rustdune.shade, PALETTE.path, PALETTE.biome.frostspine.cliff, PALETTE.structure.lantern, PALETTE.paper,
  PALETTE.snow, PALETTE.corruption, PALETTE.ink, PALETTE.structure.ringstone, PALETTE.biome.meadows.cliff, PALETTE.ink,
  PALETTE.biome.meadows.accent,
]);

const WHITE = new Color(1, 1, 1);

/**
 * A merge builder. `add(geo, matrix, slot, tint?, shade?)` bakes a primitive (the primitive is disposed).
 * shade: 0..1 strength of the baked vertical gradient (darker at the bottom of each primitive, like ambient occlusion).
 */
export function createBuilder() {
  /** @type {number[]} */
  const P = [];
  /** @type {number[]} */
  const N = [];
  /** @type {number[]} */
  const C = [];
  /** @type {number[]} */
  const S = [];
  const nm = new Matrix3();
  const v = new Vector3();
  const tint = new Color();
  let tris = 0;
  return {
    /**
     * @param {any} geo three geometry (consumed) @param {Matrix4} m @param {number} slot
     * @param {Color|number} [tintIn] multiplied into the slot colour (vertex colour) @param {number} [shade]
     */
    add(geo, m, slot, tintIn, shade) {
      const g = geo.index ? geo.toNonIndexed() : geo;
      if (g !== geo) geo.dispose();
      if (!g.attributes.normal) g.computeVertexNormals();
      const p = g.attributes.position.array;
      const n = g.attributes.normal.array;
      if (tintIn === undefined) tint.copy(WHITE);
      else if (typeof tintIn === 'number') tint.setHex(tintIn);
      else tint.copy(tintIn);
      g.computeBoundingBox();
      const y0 = g.boundingBox.min.y;
      const y1 = g.boundingBox.max.y;
      const sh = shade || 0;
      nm.getNormalMatrix(m);
      for (let i = 0; i < p.length; i += 3) {
        v.set(p[i], p[i + 1], p[i + 2]);
        const k = y1 > y0 ? (p[i + 1] - y0) / (y1 - y0) : 1;
        const ao = 1 - sh * (1 - k) * (1 - k);
        v.applyMatrix4(m);
        P.push(v.x, v.y, v.z);
        v.set(n[i], n[i + 1], n[i + 2]).applyMatrix3(nm).normalize();
        N.push(v.x, v.y, v.z);
        C.push(tint.r * ao, tint.g * ao, tint.b * ao);
        S.push(slot);
      }
      tris += p.length / 9;
      g.dispose();
    },
    /**
     * Raw triangle with per-vertex positions (flat normal).
     * @param {number[]} a @param {number[]} b @param {number[]} c @param {number} slot @param {Color|number} [tintIn]
     */
    tri(a, b, c, slot, tintIn) {
      if (tintIn === undefined) tint.copy(WHITE);
      else if (typeof tintIn === 'number') tint.setHex(tintIn);
      else tint.copy(tintIn);
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];
      const wx = c[0] - a[0];
      const wy = c[1] - a[1];
      const wz = c[2] - a[2];
      v.set(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx).normalize();
      for (const q of [a, b, c]) {
        P.push(q[0], q[1], q[2]);
        N.push(v.x, v.y, v.z);
        C.push(tint.r, tint.g, tint.b);
        S.push(slot);
      }
      tris++;
    },
    get triangles() {
      return tris;
    },
    get empty() {
      return P.length === 0;
    },
    /** @returns {BufferGeometry} */
    build() {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(P, 3));
      geo.setAttribute('normal', new Float32BufferAttribute(N, 3));
      geo.setAttribute('color', new Float32BufferAttribute(C, 3));
      geo.setAttribute('paletteIndex', new Float32BufferAttribute(S, 1));
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      return geo;
    },
  };
}

// ---------------------------------------------------------------- transforms
const M = new Matrix4();
const Q = new Quaternion();
const E = new Euler();
const T = new Vector3();
const SC = new Vector3();

/**
 * Matrix from position, yaw / pitch / roll and scale (shared scratch: use it before the next call).
 * @param {number} x @param {number} y @param {number} z @param {number} [yaw] @param {number} [pitch] @param {number} [roll]
 * @param {number} [sx] @param {number} [sy] @param {number} [sz]
 * @returns {Matrix4}
 */
export function mat(x, y, z, yaw = 0, pitch = 0, roll = 0, sx = 1, sy = 1, sz = 1) {
  E.set(pitch, yaw, roll, 'YXZ');
  Q.setFromEuler(E);
  T.set(x, y, z);
  SC.set(sx, sy, sz);
  return M.compose(T, Q, SC);
}

/**
 * Local frame helper: a parent transform (x, y, z, yaw) applied to local offsets.
 * @param {number} x @param {number} y @param {number} z @param {number} yaw
 */
export function frame(x, y, z, yaw) {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const P = new Matrix4();
  const L = new Matrix4();
  return {
    x, y, z, yaw,
    /** world x of a local point @param {number} lx @param {number} lz */
    wx(lx, lz) {
      return x + lx * c + lz * s;
    },
    /** @param {number} lx @param {number} lz */
    wz(lx, lz) {
      return z - lx * s + lz * c;
    },
    /**
     * Local matrix composed with the frame.
     * @param {number} lx @param {number} ly @param {number} lz @param {number} [lyaw] @param {number} [pitch] @param {number} [roll]
     * @param {number} [sx] @param {number} [sy] @param {number} [sz]
     */
    m(lx, ly, lz, lyaw = 0, pitch = 0, roll = 0, sx = 1, sy = 1, sz = 1) {
      P.makeRotationY(yaw).setPosition(x, y, z);
      L.copy(mat(lx, ly, lz, lyaw, pitch, roll, sx, sy, sz));
      return M.multiplyMatrices(P, L);
    },
  };
}

// ---------------------------------------------------------------- primitives (fresh geometries, consumed by add)
export const prim = {
  /** @param {number} rTop @param {number} rBot @param {number} h @param {number} seg @param {boolean} [open] base at y 0 */
  drum(rTop, rBot, h, seg, open) {
    const g = new CylinderGeometry(rTop, rBot, h, seg, 1, !!open);
    g.translate(0, h / 2, 0);
    return g;
  },
  /** @param {number} r @param {number} h @param {number} seg @param {boolean} [open] base at y 0 */
  cone(r, h, seg, open) {
    const g = new ConeGeometry(r, h, seg, 1, !!open);
    g.translate(0, h / 2, 0);
    return g;
  },
  /** @param {number} w @param {number} h @param {number} d base at y 0 */
  box(w, h, d) {
    const g = new BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    return g;
  },
  /** centred box @param {number} w @param {number} h @param {number} d */
  cbox(w, h, d) {
    return new BoxGeometry(w, h, d);
  },
  /** @param {number} r @param {number} tube @param {number} rs @param {number} ts ring in the XY plane */
  ring(r, tube, rs, ts) {
    return new TorusGeometry(r, tube, rs, ts);
  },
  /** @param {number} r @param {number} ws @param {number} hs */
  ball(r, ws, hs) {
    return new SphereGeometry(r, ws, hs);
  },
  /** disc facing +z @param {number} r @param {number} seg */
  disc(r, seg) {
    return new CircleGeometry(r, seg);
  },
  /** @param {number} r */
  gem(r) {
    return new OctahedronGeometry(r, 0);
  },
};

/** Shared, never mutated colour scratch for tints. */
export const TINT = new Color();
