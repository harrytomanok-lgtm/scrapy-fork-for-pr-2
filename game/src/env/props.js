/**
 * Gameplay prop visuals (ARCHITECTURE 4.2, ART_UX 1.10): every prop kind with its states, its collider, a glow
 * billboard for `setGlow`, and light pillars visible from anywhere (unfogged, widened with distance). Geometry is
 * built once per kind (palette-indexed toon); each prop owns one material whose palette and per-slot emissive carry
 * its state, so a state change never creates a program. The logic lives in rpg; env only draws.
 * @module env/props
 */

import { Mesh, Group, Color, Vector3, Float32BufferAttribute, BufferGeometry } from 'three';
import { PALETTE } from '../core/palette.js';
import { createBuilder, mat, prim } from './kit.js';
import { PROP_KINDS } from './data/props.js';

/** Prop palette slots. */
export const PS = Object.freeze({
  STONE: 0, CARVE: 1, WOOD: 2, WOOD_LIGHT: 3, COPPER: 4, IRON: 5, CLOTH: 6, LACQUER: 7, GOLD: 8, VIOLET: 9, CORE: 10,
  SALT: 11, STRAW: 12, DARK: 13, FLAME: 14, TEAL: 15,
});
const BASE_HEX = [
  PALETTE.biome.frostspine.cliff, PALETTE.biome.spire.shade, PALETTE.biome.rustdune.shade, PALETTE.path, PALETTE.structure.copper,
  PALETTE.corruption, PALETTE.paper, PALETTE.structure.kites[1], PALETTE.biome.meadows.accent, PALETTE.hostile, PALETTE.hostile,
  PALETTE.biome.coast.ground, PALETTE.biome.meadows.accent, PALETTE.ink, PALETTE.structure.lantern, PALETTE.ora,
];

const SOLID = 1;
const PILLAR_H = 520;

// ---------------------------------------------------------------- geometry per kind (built once)
/** @type {Record<string, any>} */
const GEO = {};

/** @param {(B:any)=>void} fn @returns {any} */
function build(fn) {
  const B = createBuilder();
  fn(B);
  return B.build();
}

const KIND_GEO = {
  ringstone() {
    return {
      body: build((B) => {
        B.add(prim.drum(1.5, 1.8, 0.5, 8), mat(0, -0.2, 0), PS.STONE, 0xb0b0b0, 0.3);
        B.add(prim.box(1.4, 3.6, 0.75), mat(0, 0.2, 0, 0, 0, 0, 1, 1, 1), PS.STONE, undefined, 0.25);
        B.add(prim.cone(0.8, 0.7, 4), mat(0, 3.75, 0, Math.PI / 4, 0, 0, 1.25, 1, 0.65), PS.STONE);
        // carved ring on both faces
        B.add(prim.ring(0.48, 0.085, 3, 14), mat(0, 2.5, 0.39), PS.CARVE);
        B.add(prim.ring(0.48, 0.085, 3, 14), mat(0, 2.5, -0.39), PS.CARVE);
        B.add(prim.disc(0.22, 8), mat(0, 2.5, 0.38), PS.CARVE);
        B.add(prim.disc(0.22, 8), mat(0, 2.5, -0.38, Math.PI), PS.CARVE);
        for (let i = 0; i < 3; i++) B.add(prim.gem(0.45), mat(Math.cos(i * 2.1) * 1.9, 0.05, Math.sin(i * 2.1) * 1.9, i, 0, 0, 1, 0.6, 1), PS.STONE, 0x9a9a9a);
      }),
      glowY: 2.5, pillarY: 4.2,
    };
  },
  shrine() {
    return {
      body: build((B) => {
        B.add(prim.drum(2.6, 2.8, 0.45, 14), mat(0, -0.15, 0), PS.STONE, undefined, 0.3);
        B.add(prim.drum(2.0, 2.0, 0.1, 14), mat(0, 0.3, 0), PS.TEAL);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          B.add(prim.box(0.4, 0.5, 0.4), mat(Math.sin(a) * 2.4, 0.2, Math.cos(a) * 2.4, a), PS.STONE, 0xc8c8c8);
        }
      }),
      part: build((B) => {
        B.add(prim.ring(2.0, 0.28, 4, 20), mat(0, 0, 0), PS.STONE);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          B.add(prim.gem(0.22), mat(Math.cos(a) * 2.0, Math.sin(a) * 2.0, 0.22), PS.TEAL);
        }
        B.add(prim.gem(0.55), mat(0, 0, 0, 0, 0, 0, 1, 1.5, 1), PS.CORE);
      }),
      partY: 2.6, glowY: 2.6, pillarY: 0,
    };
  },
  chest() {
    return {
      body: build((B) => {
        // drum lying on its side: lower half box + brass bands, on little feet
        B.add(prim.box(1.5, 0.55, 0.95), mat(0, 0.12, 0), PS.LACQUER, undefined, 0.3);
        for (const x of [-0.55, 0.55]) B.add(prim.box(0.12, 0.58, 1.0), mat(x, 0.11, 0), PS.GOLD);
        for (const x of [-0.6, 0.6]) for (const z of [-0.36, 0.36]) B.add(prim.box(0.18, 0.14, 0.18), mat(x, 0, z), PS.DARK);
      }),
      part: build((B) => {
        // the lid: a half drum hinged at the back edge (local origin = hinge)
        const g = prim.drum(0.48, 0.48, 1.5, 10);
        B.add(g, mat(0, 0, 0.48, 0, 0, Math.PI / 2), PS.LACQUER, undefined, 0);
        for (const x of [-0.55, 0.55]) B.add(prim.drum(0.5, 0.5, 0.12, 10), mat(x, 0, 0.48, 0, 0, Math.PI / 2), PS.GOLD);
        B.add(prim.ring(0.16, 0.035, 3, 8), mat(0, -0.1, 0.99), PS.GOLD);
        B.add(prim.box(0.24, 0.28, 0.08), mat(0, -0.3, 0.98), PS.IRON);
      }),
      partPos: [0, 0.67, -0.48], glowY: 0.9, pillarY: 0,
    };
  },
  siphon() {
    return {
      body: build((B) => {
        // a 40 m black-iron thorn with buttress roots, wrapped in violet glass tubes; the core housing at 6 m
        B.add(prim.cone(3.2, 40, 7), mat(0, 0, 0), PS.IRON, undefined, 0.3);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + 0.3;
          B.add(prim.cone(1.3, 9, 5), mat(Math.sin(a) * 3.2, -0.5, Math.cos(a) * 3.2, a, 0.55, 0), PS.IRON, undefined, 0.3);
        }
        for (let i = 0; i < 3; i++) {
          for (let k = 0; k < 9; k++) {
            const y = 9 + k * 3.2;
            const r = 3.2 * (1 - y / 40) + 0.25;
            const a = (i / 3) * Math.PI * 2 + k * 0.55;
            B.add(prim.drum(0.22, 0.22, 3.6, 5), mat(Math.sin(a) * r, y, Math.cos(a) * r, a, 0, 0.5), PS.VIOLET);
          }
        }
        B.add(prim.drum(2.9, 3.4, 1.0, 9), mat(0, 4.0, 0), PS.IRON);
        B.add(prim.drum(2.5, 2.9, 1.0, 9), mat(0, 7.6, 0), PS.IRON);
        B.add(prim.gem(1.35), mat(0, 6.1, 0, 0, 0, 0, 1, 1.4, 1), PS.CORE);
      }),
      part: build((B) => {
        // three petals of the shutter around the core (local origin = core centre); opened by rotation
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2;
          B.add(prim.drum(0.4, 1.05, 2.8, 4), mat(Math.sin(a) * 1.75, -1.4, Math.cos(a) * 1.75, a, 0, 0, 1, 1, 0.45), PS.IRON);
          B.add(prim.box(0.18, 2.4, 0.1), mat(Math.sin(a) * 2.25, -1.2, Math.cos(a) * 2.25, a), PS.VIOLET);
        }
      }),
      partY: 6.1, glowY: 6.1, pillarY: 40, ground: 16,
    };
  },
  ringGate() {
    // unlit additive torus of light; vertex colours shade the tube
    return {
      light: build((B) => {
        B.add(prim.ring(4.5, 0.32, 6, 40), mat(0, 0, 0), 0, 0x9a9a9a);
        B.add(prim.ring(4.5, 0.12, 4, 40), mat(0, 0, 0), 0, 0xffffff);
        B.add(prim.ring(4.95, 0.05, 3, 40), mat(0, 0, 0), 0, 0x606060);
      }),
      glowY: 0, pillarY: 0,
    };
  },
  trainingPost() {
    return {
      body: build((B) => {
        B.add(prim.drum(0.32, 0.38, 2.1, 7), mat(0, -0.1, 0), PS.WOOD, undefined, 0.3);
        B.add(prim.drum(0.42, 0.42, 0.8, 7), mat(0, 0.9, 0), PS.STRAW);
        for (const y of [0.95, 1.35, 1.65]) B.add(prim.drum(0.44, 0.44, 0.06, 7), mat(0, y, 0), PS.DARK);
        B.add(prim.cbox(1.7, 0.16, 0.16), mat(0, 1.45, 0, 0, 0, 0.12), PS.WOOD);
        B.add(prim.cbox(1.2, 0.16, 0.16), mat(0, 0.75, 0, 0.5, 0, -0.1), PS.WOOD);
        B.add(prim.drum(0.36, 0.3, 0.4, 7), mat(0, 2.0, 0), PS.STRAW);
        B.add(prim.drum(0.55, 0.6, 0.18, 7), mat(0, -0.08, 0), PS.WOOD_LIGHT);
      }),
      alt: build((B) => {
        B.add(prim.drum(0.32, 0.38, 0.75, 7), mat(0, -0.1, 0), PS.WOOD, undefined, 0.3);
        B.add(prim.cone(0.34, 0.35, 5), mat(0, 0.6, 0), PS.WOOD_LIGHT);
        B.add(prim.drum(0.36, 0.36, 1.4, 7), mat(0.9, 0.3, 0.3, 0.4, 0, Math.PI / 2 - 0.1), PS.STRAW);
        B.add(prim.cbox(1.7, 0.16, 0.16), mat(-0.6, 0.1, 0.8, 1.2), PS.WOOD);
        B.add(prim.drum(0.55, 0.6, 0.18, 7), mat(0, -0.08, 0), PS.WOOD_LIGHT);
      }),
      glowY: 1.2, pillarY: 0,
    };
  },
  bell() {
    return {
      body: build((B) => {
        for (const x of [-1.1, 1.1]) B.add(prim.box(0.22, 3.2, 0.22), mat(x, -0.1, 0), PS.WOOD, undefined, 0.3);
        B.add(prim.cbox(2.8, 0.22, 0.3), mat(0, 3.05, 0), PS.WOOD);
        B.add(prim.cone(1.8, 0.7, 4), mat(0, 3.15, 0, Math.PI / 4, 0, 0, 1, 1, 0.5), PS.COPPER);
        B.add(prim.drum(0.9, 1.0, 0.35, 8), mat(0, -0.2, 0), PS.STONE);
      }),
      part: build((B) => {
        // bell hanging from the beam (local origin = hinge)
        B.add(prim.drum(0.03, 0.03, 0.4, 3, true), mat(0, -0.4, 0), PS.IRON);
        B.add(prim.cone(0.62, 1.05, 10, true), mat(0, -1.45, 0), PS.COPPER);
        B.add(prim.drum(0.6, 0.66, 0.12, 10, true), mat(0, -1.48, 0), PS.GOLD);
        B.add(prim.ball(0.14, 6, 4), mat(0, -1.4, 0), PS.IRON);
        B.add(prim.drum(0.28, 0.4, 0.22, 8), mat(0, -0.62, 0), PS.COPPER);
      }),
      partPos: [0, 2.95, 0], glowY: 1.9, pillarY: 0,
    };
  },
  fallenBlade() {
    return {
      body: build((B) => {
        // a giant blade driven into the ground at an angle, its hilt wrapped, a rune channel along the fuller
        const tilt = 0.32;
        B.add(prim.box(0.55, 4.2, 0.14), mat(0, -0.9, 0, 0, 0, tilt), PS.SALT, 0xdfe6ee, 0.4);
        B.add(prim.box(0.12, 3.6, 0.16), mat(0, -0.6, 0, 0, 0, tilt), PS.CORE);
        const hx = -Math.sin(tilt) * 3.3;
        const hy = Math.cos(tilt) * 3.3 - 0.9;
        B.add(prim.cbox(1.7, 0.26, 0.3), mat(hx, hy, 0, 0, 0, tilt), PS.GOLD);
        B.add(prim.drum(0.12, 0.12, 1.1, 6), mat(hx - Math.sin(tilt) * 0.1, hy + 0.1, 0, 0, 0, tilt), PS.CLOTH, 0x7a5a3a);
        B.add(prim.gem(0.22), mat(hx - Math.sin(tilt) * 1.3, hy + Math.cos(tilt) * 1.3, 0), PS.TEAL);
        for (let i = 0; i < 4; i++) B.add(prim.gem(0.5), mat(Math.cos(i * 1.7) * 0.9, 0.05, Math.sin(i * 1.7) * 0.9, i, 0, 0, 1, 0.55, 1), PS.STONE, 0x8a8a8a);
      }),
      glowY: 1.6, pillarY: 0,
    };
  },
  saltPillar() {
    return {
      body: build((B) => {
        B.add(prim.drum(0.95, 1.25, 5.6, 6), mat(0, -0.3, 0), PS.SALT, undefined, 0.3);
        B.add(prim.cone(0.95, 1.2, 6), mat(0, 5.3, 0), PS.SALT);
        B.add(prim.drum(0.5, 0.65, 3.2, 6), mat(1.15, -0.2, 0.3, 0.3, 0, -0.25), PS.SALT, 0xe6e6e6);
        B.add(prim.cone(0.5, 0.7, 6), mat(1.15 + Math.sin(0.25) * 3.0, 2.9, 0.3, 0.3, 0, -0.25), PS.SALT, 0xe6e6e6);
        B.add(prim.drum(0.4, 0.5, 2.2, 6), mat(-0.95, -0.2, -0.5, 0.8, 0.2, 0.2), PS.SALT, 0xd0d0d0);
        for (let i = 0; i < 3; i++) B.add(prim.box(0.1, 3.5, 0.06), mat(Math.sin(i * 2.1) * 1.08, 0.8, Math.cos(i * 2.1) * 1.08, i * 2.1), PS.TEAL);
      }),
      alt: build((B) => {
        B.add(prim.drum(1.1, 1.3, 1.6, 6), mat(0, -0.3, 0), PS.SALT, undefined, 0.3);
        for (let i = 0; i < 6; i++) {
          const a = i * 1.05;
          B.add(prim.gem(0.55 - i * 0.04), mat(Math.cos(a) * 2.2, 0.1, Math.sin(a) * 2.2, a, 0, 0, 1, 1.4, 1), PS.SALT, 0xdadada);
        }
      }),
      glowY: 3, pillarY: 0,
    };
  },
  crate() {
    return {
      body: build((B) => {
        B.add(prim.box(1.2, 1.2, 1.2), mat(0, 0, 0), PS.WOOD_LIGHT, undefined, 0.35);
        for (const y of [0.08, 1.04]) B.add(prim.box(1.26, 0.12, 1.26), mat(0, y, 0), PS.WOOD);
        for (const x of [-0.56, 0.56]) for (const z of [-0.56, 0.56]) B.add(prim.box(0.14, 1.22, 0.14), mat(x, 0, z), PS.WOOD);
        B.add(prim.cbox(0.1, 1.5, 0.04), mat(0, 0.6, 0.61, 0, 0, 0.78), PS.WOOD);
        B.add(prim.cbox(0.04, 1.5, 0.1), mat(0.61, 0.6, 0, 0, 0.78, 0), PS.WOOD);
      }),
      alt: build((B) => {
        for (let i = 0; i < 6; i++) {
          const a = i * 1.1;
          B.add(prim.cbox(1.1, 0.08, 0.22), mat(Math.cos(a) * 0.5, 0.06 + (i % 3) * 0.07, Math.sin(a) * 0.5, a * 1.7, 0, 0.1 * (i % 2)), PS.WOOD_LIGHT);
        }
        B.add(prim.box(1.0, 0.12, 1.0), mat(0, 0, 0, 0.3), PS.WOOD);
      }),
      glowY: 0.7, pillarY: 0,
    };
  },
  lightPillar() {
    return { glowY: 0, pillarY: 0 };
  },
  campfire() {
    return {
      body: build((B) => {
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          B.add(prim.gem(0.28), mat(Math.sin(a) * 0.8, 0.08, Math.cos(a) * 0.8, a, 0, 0, 1, 0.7, 1), PS.STONE, 0x9a9a9a);
        }
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + 0.4;
          B.add(prim.cbox(0.16, 0.16, 1.2), mat(Math.sin(a) * 0.25, 0.25, Math.cos(a) * 0.25, a, -0.55), PS.WOOD);
        }
        B.add(prim.disc(0.6, 8), mat(0, 0.05, 0, 0, -Math.PI / 2), PS.DARK);
      }),
      flame: build((B) => {
        B.add(prim.cone(0.45, 1.1, 6, true), mat(0, 0.1, 0), 0, 0xffffff);
        B.add(prim.cone(0.28, 1.5, 5, true), mat(0.08, 0.1, 0.05, 0.6), 0, 0xffd08a);
        B.add(prim.cone(0.2, 0.8, 5, true), mat(-0.2, 0.1, -0.1, 1.1), 0, 0xc06030);
      }),
      glowY: 0.8, pillarY: 0,
    };
  },
  tent() {
    return {
      body: build((B) => {
        B.add(prim.drum(1.7, 1.85, 0.8, 8, true), mat(0, -0.1, 0), PS.CLOTH, undefined, 0.25);
        B.add(prim.cone(1.85, 1.7, 8), mat(0, 0.65, 0), PS.LACQUER, undefined, 0.1);
        B.add(prim.drum(0.04, 0.04, 0.6, 4, true), mat(0, 2.3, 0), PS.WOOD);
        B.add(prim.box(0.9, 1.1, 0.08), mat(0, -0.05, 1.8, 0, -0.06), PS.DARK);
      }),
      glowY: 1.2, pillarY: 0,
    };
  },
  signpost() {
    return {
      body: build((B) => {
        B.add(prim.box(0.18, 2.4, 0.18), mat(0, -0.2, 0), PS.WOOD, undefined, 0.3);
        B.add(prim.cone(0.3, 0.3, 4), mat(0, 2.2, 0, Math.PI / 4), PS.COPPER);
        B.add(prim.cbox(1.3, 0.3, 0.06), mat(0.5, 1.8, 0.1), PS.WOOD_LIGHT);
        B.add(prim.cbox(1.1, 0.28, 0.06), mat(-0.4, 1.35, -0.1, 0.4), PS.WOOD_LIGHT);
        B.tri([1.15, 1.95, 0.14], [1.15, 1.65, 0.14], [1.4, 1.8, 0.14], PS.WOOD_LIGHT);
        B.add(prim.drum(0.4, 0.45, 0.2, 6), mat(0, -0.1, 0), PS.STONE);
      }),
      glowY: 1.6, pillarY: 0,
    };
  },
};

/** @param {string} kind */
function geoFor(kind) {
  if (!GEO[kind]) GEO[kind] = KIND_GEO[kind]();
  return GEO[kind];
}

/** Pillar: open cylinder (outer haze plus bright core), vertex colours fade to black at the top. */
function pillarGeometry() {
  return build((B) => {
    B.add(prim.drum(1, 1, 1, 10, true), mat(0, 0, 0), 0, 0x8a8a8a);
    B.add(prim.drum(0.35, 0.35, 1, 6, true), mat(0, 0, 0), 0, 0xffffff);
  });
}
/** @param {BufferGeometry} g fade the colour attribute with height (y 0..1). */
function fadeUp(g) {
  const p = g.attributes.position.array;
  const c = g.attributes.color.array;
  for (let i = 0; i < p.length; i += 3) {
    const k = Math.pow(1 - p[i + 1], 1.6);
    c[i] *= k;
    c[i + 1] *= k;
    c[i + 2] *= k;
  }
  g.attributes.color.needsUpdate = true;
}

/** Glow billboard: a fan disc, white centre to black rim (additive). */
function glowGeometry() {
  const seg = 16;
  const pos = [];
  const col = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    pos.push(0, 0, 0, Math.cos(a0), Math.sin(a0), 0, Math.cos(a1), Math.sin(a1), 0);
    col.push(1, 1, 1, 0, 0, 0, 0, 0, 0);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

/**
 * @param {any} ctx
 */
export function createProps(ctx) {
  /** @type {any[]} live handles */
  const live = [];
  let nextId = 1;
  /** @type {any} */
  let pillarGeo = null;
  /** @type {any} */
  let glowGeo = null;
  const camPos = new Vector3();
  let time = 0;

  function sharedPillar() {
    if (!pillarGeo) {
      pillarGeo = pillarGeometry();
      fadeUp(pillarGeo);
    }
    return pillarGeo;
  }
  function sharedGlow() {
    if (!glowGeo) glowGeo = glowGeometry();
    return glowGeo;
  }

  /**
   * Ground disc of dead grey earth (siphon): conformed to the terrain at spawn.
   * @param {number} x @param {number} y @param {number} z @param {number} r
   */
  function deadGround(x, y, z, r) {
    const w = ctx.world;
    const B = createBuilder();
    const seg = 20;
    const rings = [0, r * 0.45, r * 0.8, r];
    const tints = [0x8a8a8a, 0xa0a0a0, 0xc0c0c0];
    /** @param {number} rr @param {number} a */
    const pt = (rr, a) => {
      const px = Math.sin(a) * rr;
      const pz = Math.cos(a) * rr;
      const h = w ? w.heightAt(x + px, z + pz) : y;
      return [px, h - y + 0.1, pz];
    };
    for (let k = 0; k < rings.length - 1; k++) {
      for (let i = 0; i < seg; i++) {
        const j = (k * 7 + i * 3) % 5 === 0 ? 0.08 : 0;
        const a0 = (i / seg) * Math.PI * 2 + j;
        const a1 = ((i + 1) / seg) * Math.PI * 2 + j;
        if (k === 0) B.tri(pt(0, 0), pt(rings[1], a0), pt(rings[1], a1), PS.IRON, tints[0]);
        else {
          B.tri(pt(rings[k], a0), pt(rings[k + 1], a0), pt(rings[k + 1], a1), PS.IRON, tints[k]);
          B.tri(pt(rings[k], a0), pt(rings[k + 1], a1), pt(rings[k], a1), PS.IRON, tints[k]);
        }
      }
    }
    return B.build();
  }

  /**
   * @param {string} kind @param {number} x @param {number} y @param {number} z
   * @param {{ yaw?:number, scale?:number, state?:string, color?:number }} [opts]
   */
  function spawn(kind, x, y, z, opts) {
    const o = opts || {};
    const known = PROP_KINDS[kind];
    if (!known) ctx.log.warn('env', 'spawnProp: unknown kind', kind);
    const def = known || PROP_KINDS.signpost;
    const k = known ? kind : 'signpost';
    const render = ctx.render;
    const G = geoFor(k);
    const sc = typeof o.scale === 'number' && o.scale > 0 ? o.scale : 1;
    const yaw = typeof o.yaw === 'number' ? o.yaw : 0;
    const object = new Group();
    object.name = 'env.prop.' + k;
    object.position.set(x, y, z);
    object.rotation.y = yaw;
    object.scale.setScalar(sc);
    const color = typeof o.color === 'number' ? o.color : def.color;

    // toon material with this prop's palette
    let mat0 = null;
    if (G.body || G.part || G.alt) {
      mat0 = render.materials.toon({ palette: true, vertexColors: true });
      const pal = mat0.uniforms.uPalette.value;
      for (let i = 0; i < 16; i++) pal[i].setHex(BASE_HEX[i]);
    }
    /** @type {any} */
    let body = null;
    /** @type {any} */
    let alt = null;
    /** @type {any} */
    let part = null;
    if (G.body) {
      body = new Mesh(G.body, mat0);
      object.add(body);
    }
    if (G.alt) {
      alt = new Mesh(G.alt, mat0);
      alt.visible = false;
      object.add(alt);
    }
    if (G.part) {
      part = new Mesh(G.part, mat0);
      if (G.partPos) part.position.set(G.partPos[0], G.partPos[1], G.partPos[2]);
      else part.position.y = G.partY || 0;
      object.add(part);
    }
    /** @type {any} */
    let light = null;
    let lightMat = null;
    if (G.light || G.flame) {
      lightMat = render.materials.unlit({ color: color, additive: true });
      light = new Mesh(G.light || G.flame, lightMat);
      object.add(light);
    }
    // pillar (lightPillar always; ringstone when active; siphon while standing)
    /** @type {any} */
    let pillar = null;
    let pillarMat = null;
    let pillarBase = 0;
    if (k === 'lightPillar' || k === 'ringstone' || k === 'siphon') {
      pillarMat = render.materials.unlit({ color: k === 'siphon' ? PALETTE.hostile : color, additive: true, fog: false });
      pillar = new Mesh(sharedPillar(), pillarMat);
      pillar.frustumCulled = false;
      pillarBase = k === 'lightPillar' ? 0.8 : k === 'siphon' ? 1.6 : 0.45;
      pillar.position.y = G.pillarY || 0;
      pillar.scale.set(pillarBase, PILLAR_H, pillarBase);
      object.add(pillar);
    }
    /** @type {any} */
    let ground = null;
    let groundMat = null;
    if (G.ground) {
      groundMat = render.materials.toon({ palette: true, vertexColors: true, transparent: true });
      const gp = groundMat.uniforms.uPalette.value;
      for (let i = 0; i < 16; i++) gp[i].setHex(BASE_HEX[i]);
      gp[PS.IRON].setHex(PALETTE.corruption);
      ground = new Mesh(deadGround(x, y, z, G.ground / sc), groundMat);
      ground.rotation.y = -yaw;
      object.add(ground);
    }
    // glow billboard (lazily shown)
    const glowMat = render.materials.unlit({ color: def.glow, additive: true });
    const glow = new Mesh(sharedGlow(), glowMat);
    glow.visible = false;
    glow.frustumCulled = false;
    render.layers.props.add(object);
    render.layers.vfx.add(glow);
    object.updateMatrixWorld(true);

    // collider
    let colliderId = 0;
    function addCollider() {
      const w = ctx.world;
      const c = def.collider;
      if (!c || !w || colliderId) return;
      colliderId = w.addCollider({
        shape: c.shape, x, y, z, r: (c.r || 0) * sc, h: (c.h || 0) * sc, hx: (c.hx || 0) * sc, hz: (c.hz || 0) * sc, yaw, flags: SOLID, propKey: 0,
      });
    }
    function removeCollider() {
      const w = ctx.world;
      if (colliderId && w) w.removeCollider(colliderId);
      colliderId = 0;
    }
    addCollider();

    const states = def.states;
    let current = typeof o.state === 'string' && states.indexOf(o.state) >= 0 ? o.state : states[0];
    let glowK = 0;
    let visible = true;
    let anim = 0; // state transition clock (seconds since the last state change)
    let swing = 0;
    const lightCol = new Color(color);

    const handle = {
      id: nextId++,
      kind,
      object,
      /** @param {string} st */
      setState(st) {
        if (states.indexOf(st) < 0) return;
        if (st === current) return;
        current = st;
        anim = 0;
        if (k === 'bell' && st === 'used') swing = 1;
        applyState();
      },
      /** @param {number} v 0..1 */
      setGlow(v) {
        const n = Number(v);
        glowK = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
        glow.visible = visible && glowK > 0.01;
      },
      /** @param {boolean} b */
      setVisible(b) {
        visible = !!b;
        object.visible = visible;
        glow.visible = visible && glowK > 0.01;
      },
      dispose() {
        if (object.parent) object.parent.remove(object);
        if (glow.parent) glow.parent.remove(glow);
        if (mat0) mat0.dispose();
        if (lightMat) lightMat.dispose();
        if (pillarMat) pillarMat.dispose();
        if (groundMat) groundMat.dispose();
        if (ground) ground.geometry.dispose();
        glowMat.dispose();
        removeCollider();
        const i = live.indexOf(handle);
        if (i >= 0) live.splice(i, 1);
      },
      /** @returns {string} current state (diagnostics) */
      get state() {
        return current;
      },
      /** per-frame animation @param {number} dt */
      tick(dt) {
        anim += dt;
        animate(dt);
      },
    };

    /** Palette, emissive and part poses for the current state. */
    function applyState() {
      const pal = mat0 ? mat0.uniforms.uPalette.value : null;
      const em = mat0 ? mat0.uniforms.uEmissive.value : null;
      if (body) body.visible = true;
      if (alt) alt.visible = false;
      switch (k) {
        case 'ringstone': {
          const on = current === 'active';
          pal[PS.CARVE].setHex(on ? PALETTE.structure.ringstone : PALETTE.biome.spire.shade);
          em[PS.CARVE] = on ? 1.3 : 0;
          if (pillar) pillar.visible = on;
          break;
        }
        case 'shrine': {
          const ready = current === 'ready';
          pal[PS.CORE].setHex(ready ? PALETTE.ora : PALETTE.biome.spire.shade);
          em[PS.CORE] = ready ? 1.4 : 0.05;
          em[PS.TEAL] = ready ? 0.9 : 0;
          pal[PS.TEAL].setHex(ready ? PALETTE.ora : PALETTE.biome.frostspine.shade);
          break;
        }
        case 'chest': {
          const locked = current === 'locked';
          pal[PS.IRON].setHex(locked ? PALETTE.biome.meadows.accent : PALETTE.structure.kites[1]);
          em[PS.GOLD] = current === 'open' ? 0.35 : 0;
          break;
        }
        case 'siphon': {
          const dead = current === 'destroyed';
          const open = current === 'open';
          em[PS.VIOLET] = dead ? 0 : open ? 1.2 : 0.55;
          em[PS.CORE] = dead ? 0 : open ? 2.0 : 0.25;
          pal[PS.VIOLET].setHex(dead ? PALETTE.biome.stormwell.cliff : PALETTE.hostile);
          pal[PS.CORE].setHex(dead ? PALETTE.ink : open ? PALETTE.telegraph.violet : PALETTE.hostile);
          if (pillarMat) pillarMat.uniforms.uColor.value.setHex(dead ? PALETTE.ora : PALETTE.hostile);
          if (body) body.rotation.set(dead ? 0.05 : 0, 0, dead ? -0.06 : 0);
          if (body) body.position.y = dead ? -1.2 : 0;
          if (ground) ground.visible = true;
          if (groundMat) groundMat.uniforms.uGhost.value = 1;
          break;
        }
        case 'ringGate': {
          lightCol.setHex(current === 'passed' ? PALETTE.biome.meadows.accent : color);
          break;
        }
        case 'trainingPost':
        case 'saltPillar':
        case 'crate': {
          const broken = current === 'broken';
          body.visible = !broken;
          alt.visible = broken;
          if (broken) removeCollider();
          else addCollider();
          const used = current === 'used';
          em[PS.TEAL] = used ? 1.2 : k === 'saltPillar' ? 0.3 : 0;
          if (k === 'crate') pal[PS.WOOD_LIGHT].setHex(used ? PALETTE.biome.meadows.cliff : PALETTE.path);
          break;
        }
        case 'bell': {
          em[PS.GOLD] = current === 'used' ? 1.0 : 0;
          em[PS.COPPER] = current === 'used' ? 0.25 : 0;
          break;
        }
        case 'fallenBlade': {
          const used = current === 'used';
          pal[PS.CORE].setHex(used ? PALETTE.ora : PALETTE.biome.spire.shade);
          em[PS.CORE] = used ? 1.5 : 0.1;
          em[PS.TEAL] = used ? 1.2 : 0.2;
          break;
        }
        case 'lightPillar': {
          if (pillar) pillar.visible = current === 'on';
          break;
        }
        case 'campfire':
          break;
        default:
          break;
      }
      if (lightMat) lightMat.uniforms.uColor.value.copy(lightCol);
    }

    /** @param {number} dt */
    function animate(dt) {
      const t = time;
      switch (k) {
        case 'shrine': {
          const ready = current === 'ready';
          part.rotation.y += dt * (ready ? 0.6 : 0.12);
          part.position.y = G.partY + Math.sin(t * 1.3 + handle.id) * (ready ? 0.18 : 0.05);
          break;
        }
        case 'chest': {
          const target = current === 'open' ? -1.9 : 0;
          const r = part.rotation.x;
          part.rotation.x = r + (target - r) * Math.min(1, dt * (current === 'open' ? 14 : 6));
          break;
        }
        case 'siphon': {
          const open = current === 'open';
          const dead = current === 'destroyed';
          const target = dead ? 0.95 : open ? 0.85 : 0;
          const prev = part.userData.v || 0;
          const v = prev + (target - prev) * Math.min(1, dt * 3);
          part.userData.v = v;
          // the three petals splay outward and drop as the shutter opens
          part.scale.set(1 + v * 0.55, 1 - v * 0.25, 1 + v * 0.55);
          part.rotation.y += dt * (open ? 0.7 : dead ? 0 : 0.12);
          if (dead) {
            const f = Math.max(0, 1 - anim / 5);
            if (pillar) {
              pillar.visible = f > 0.01;
              pillarMat.uniforms.uOpacity.value = f;
            }
            if (groundMat) {
              const g = Math.max(0, 1 - anim / 8);
              groundMat.uniforms.uGhost.value = g;
              ground.visible = g > 0.01;
            }
          } else if (pillarMat) {
            pillarMat.uniforms.uOpacity.value = open ? 1 : 0.75 + 0.1 * Math.sin(t * 2.2);
          }
          break;
        }
        case 'ringGate': {
          const pulse = current === 'next' ? 0.75 + 0.45 * Math.sin(t * 6) : current === 'passed' ? Math.max(0.35, 1.4 - anim) : 0.45;
          lightMat.uniforms.uOpacity.value = pulse;
          light.rotation.z += dt * (current === 'next' ? 0.8 : 0.2);
          break;
        }
        case 'bell': {
          swing = Math.max(0, swing - dt * 0.35);
          part.rotation.z = Math.sin(t * 5.2) * 0.42 * swing;
          break;
        }
        case 'campfire': {
          const f = 0.85 + 0.15 * Math.sin(t * 13 + handle.id) + 0.1 * Math.sin(t * 29.3);
          light.scale.set(1, f, 1);
          light.rotation.y += dt * 0.8;
          lightMat.uniforms.uOpacity.value = 0.8 + 0.2 * Math.sin(t * 17.7);
          break;
        }
        default:
          break;
      }
      // pillar: wider with distance so it reads from across the island
      if (pillar && pillar.visible) {
        const p = object.position;
        const dx = p.x - camPos.x;
        const dz = p.z - camPos.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        const wide = pillarBase * Math.max(1, d / 220) / sc;
        pillar.scale.set(wide, PILLAR_H / sc, wide);
        if (k === 'lightPillar' && pillarMat) pillarMat.uniforms.uOpacity.value = 0.55 + 0.1 * Math.sin(t * 1.7 + handle.id);
      }
      if (glow.visible) {
        const p = object.position;
        glow.position.set(p.x, p.y + (G.glowY || 1) * sc, p.z);
        const s = (1.2 + glowK * 2.2) * sc * (k === 'siphon' ? 3 : 1);
        glow.scale.set(s, s, s);
        glowMat.uniforms.uOpacity.value = glowK * (0.75 + 0.1 * Math.sin(t * 3 + handle.id));
        const cam = ctx.three && ctx.three.camera;
        if (cam) glow.quaternion.copy(cam.quaternion);
      }
    }

    if (current === 'active' || current === 'open' || current === 'used' || current === 'passed') anim = 10;
    applyState();
    // settle the transition poses for the initial state (no animation on spawn)
    if (part && k === 'chest' && current === 'open') part.rotation.x = -1.9;
    if (k === 'siphon') part.userData.v = current === 'destroyed' ? 0.95 : current === 'open' ? 0.85 : 0;
    if (k === 'siphon' && current === 'destroyed') anim = 10;
    animate(0);
    live.push(handle);
    return handle;
  }

  return {
    spawn,
    /** @param {number} dt @param {any} cam @param {any} wind */
    frame(dt, cam, wind) {
      time += dt;
      if (cam) camPos.copy(cam.position);
      for (let i = 0; i < live.length; i++) live[i].tick(dt);
    },
    /** Build the shared geometries before render.compile. */
    warm() {
      for (const kk of Object.keys(KIND_GEO)) geoFor(kk);
      sharedPillar();
      sharedGlow();
    },
    count() {
      return live.length;
    },
    dispose() {
      for (let i = live.length - 1; i >= 0; i--) live[i].dispose();
    },
  };
}
