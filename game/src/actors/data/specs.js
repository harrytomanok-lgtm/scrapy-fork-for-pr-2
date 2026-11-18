/**
 * Actor specs (ARCHITECTURE 5.11; ART_UX 2.1-2.6): every id of IDS.actorSpec, built from primitive parts by small
 * generators (a person, a villager, beasts) so proportions stay consistent: adults about 6.5 heads tall, large
 * hands and feet, broad shoulders, geometric faces (almond eyes with a glint, brow boxes, a mouth box on the jaw).
 * Part positions are bone-local metres for the spec's build (before `scale`). Colours are the ART_UX values;
 * shared ones come from the core palette. Pure data (no three).
 * @module actors/data/specs
 */

import { PALETTE } from '../../core/palette.js';

/** Character colours named in ART_UX section 2 (display-referred hex). */
export const CHAR = Object.freeze({
  coat: 0x1f4e5f, lining: PALETTE.biome.coast.ground, sash: 0x8e2c3a, stripe: 0xefe3c8, trousers: 0x3b3346, sand: 0xc9ae84, bronze: 0xb08a4a,
  skin: 0xe0b48c, hair: 0x1c1a24, amber: 0xd8a23a,
  emberCore: 0xfff1dc, tempestRibbon: 0xe8f0ff,
  selaSash: PALETTE.structure.curtain, silver: 0xd8d6dc, kerrinHair: 0x6b2a2a, kerrinJacket: 0x3f5566, kerrinSash: PALETTE.biome.meadows.accent,
  dovApron: PALETTE.structure.terracotta, leather: 0x6b4a3a, redCloth: 0xc8463a, oilskin: 0x5f8a8f, brass: 0xc9a24a, sunHood: PALETTE.biome.rustdune.ground,
  copper: 0xb87333, cowl: PALETTE.biome.frostspine.shade, bell: 0xe8c860,
  wisp: 0xff9a4a, boarHide: 0x8a6a4e, brambleHide: 0x3e5a46, robe: 0x8a8590, under: 0x2b2730, iron: 0x4a4650, saltPlate: PALETTE.biome.coast.ground,
  rust: PALETTE.biome.rustdune.cliff, verdigris: PALETTE.structure.copper, harrier: PALETTE.biome.frostspine.shade, plate: 0x9a96a0,
  durnCape: 0x5a2a3a, bark: 0x3e3a32, moss: 0x5a7a3a, paleSkin: 0xe0c8b0, iskraArmour: 0xdce7f2, ice: PALETTE.biome.frostspine.accent,
  charcoal: 0x2a2630, deadGrey: 0x6e6a72,
});

const PI = Math.PI;
const GLASS = PALETTE.hostile;

/**
 * @param {string} bone @param {string} shape @param {number[]} size @param {number[]|null} pos @param {number[]|null} rot @param {string} slot
 * @param {object} [extra] seg, glossy, lod1, normalUp (0..1: normals bent up and forward, the toon face trick)
 */
function P(bone, shape, size, pos, rot, slot, extra) {
  const p = { bone, shape, size, slot };
  if (pos) p.pos = pos;
  if (rot) p.rot = rot;
  return extra ? Object.assign(p, extra) : p;
}

/** @param {number} s side (+1 left, -1 right) @returns {string} */
const side = (s) => (s > 0 ? 'L' : 'R');

// ------------------------------------------------------------------------------------------------ person
/**
 * A humanoid body. Sizes follow the canonical rig scaled by build (k vertical, w lateral, b bulk).
 * @param {any} o
 *  build, detail ('hero'|'lite'), face, slots { top, abdomen, legs, shin, boots, skin, hair, eye, upper, fore, hand },
 *  boots 'tall'|'short', skirt { slot, len, r } (robe hem cone), hair style, hairLen, noNeck
 * @returns {any[]}
 */
export function person(o) {
  const bd = o.build;
  const k = bd.height / 1.8;
  const w = bd.shoulder / 0.44;
  const b = 0.7 + bd.bulk * 0.55;
  const hk = bd.head || 1;
  const hero = o.detail === 'hero';
  const S = o.slots;
  const limb = 5;
  const out = [];
  // head and face
  // hero detail: the face normals lean up so the face from the front shades like the arms (lead note: a dark patch)
  out.push(P('head', 'sphere', [0.22 * k * hk, 0.25 * k * hk, 0.235 * k * hk], [0, 0.12 * k, 0.005 * k], null, S.skin, hero ? { seg: 8, normalUp: 0.6 } : { seg: 8 }));
  if (!o.noNeck) out.push(hero ? P('neck', 'capsule', [0.05 * k * b, 0.07 * k], [0, 0.03 * k, 0], null, S.skin, { seg: 5 }) : P('neck', 'cylinder', [0.05 * k * b, 0.12 * k], [0, 0.03 * k, 0], null, S.skin, { seg: limb }));
  if (o.face) {
    for (const s of [1, -1]) {
      out.push(P('head', 'sphere', [0.06 * k * hk, 0.044 * k * hk, 0.026 * k], [s * 0.047 * k, 0.11 * k, 0.108 * k], [0, s * 0.42, s * -0.12], S.eye, { seg: S.lid ? 4 : 5 }));
      if (S.iris) out.push(P('head', 'sphere', [0.03 * k, 0.037 * k, 0.012 * k], [s * 0.043 * k, 0.108 * k, 0.12 * k], [0, s * 0.42, 0], S.iris, { seg: S.lid ? 4 : 5 }));
      // an ink upper lid line over a light eye, so the eye shape reads at play distance
      if (S.lid) out.push(P('head', 'box', [0.064 * k * hk, 0.011 * k, 0.012 * k], [s * 0.047 * k, 0.129 * k, 0.116 * k], [0, s * 0.42, s * -0.14], S.lid));
      out.push(P('head', 'box', [0.016 * k, 0.016 * k, 0.008 * k], [s * 0.038 * k, 0.12 * k, 0.126 * k], [0, s * 0.42, 0], 'glint'));
      // hero brows: thicker and a little proud of the fringe so they read at medium distance
      out.push(P('brow' + side(s), 'box', hero ? [0.07 * k, 0.025 * k, 0.022 * k] : [0.064 * k, 0.019 * k, 0.018 * k], [s * 0.003 * k, (hero ? -0.003 : 0.002) * k, (hero ? 0.008 : 0.002) * k], [0, s * 0.35, s * 0.1], S.hair));
    }
    out.push(P('head', 'box', [0.02 * k, 0.044 * k, 0.026 * k], [0, 0.083 * k, 0.118 * k], [0.28, 0, 0], S.skin));
    out.push(P('jaw', 'box', [0.042 * k, 0.011 * k, 0.012 * k], [0, -0.003 * k, 0.044 * k], null, 'ink'));
  }
  // torso
  out.push(P('chest', 'lathe', [0.13 * w * b, 0.165 * w * b, 0.15 * w * b, 0.3 * k, 0.66], [0, 0.08 * k, 0], null, S.top, { seg: hero ? 7 : 6 }));
  out.push(hero ? P('spine', 'lathe', [0.125 * w * b, 0.12 * w * b, 0.13 * w * b, 0.2 * k, 0.7], [0, 0.09 * k, 0], null, S.abdomen || S.top, { seg: 7 })
    : P('spine', 'cylinder', [0.125 * w * b, 0.22 * k, 0.135 * w * b], [0, 0.09 * k, 0], [0, 0, 0], S.abdomen || S.top, { seg: 6 }));
  out.push(P('hips', 'sphere', [0.29 * w * b, 0.2 * k, 0.2 * w * b], [0, 0, 0], null, S.legs, { seg: hero ? 8 : 6 }));
  // arms
  for (const s of [1, -1]) {
    const L = side(s);
    out.push(P('arm' + L, 'capsule', [0.05 * k * b, 0.19 * k], [0, -0.14 * k, 0], null, S.upper || S.top, { seg: limb }));
    out.push(P('fore' + L, hero ? 'capsule' : 'cylinder', hero ? [0.053 * k * b, 0.17 * k] : [0.046 * k * b, 0.24 * k, 0.04 * k * b], [0, -0.13 * k, 0], null, S.fore || S.upper || S.top, { seg: limb }));
    out.push(P('hand' + L, 'sphere', [0.09 * k, 0.1 * k, 0.078 * k], [0, -0.045 * k, 0.005 * k], null, S.hand || S.skin, { seg: hero ? 6 : 5 }));
  }
  // legs
  for (const s of [1, -1]) {
    const L = side(s);
    out.push(hero ? P('thigh' + L, 'lathe', [0.078 * k * b, 0.088 * k * b, 0.07 * k * b, 0.44 * k], [0, -0.2 * k, 0], null, S.legs, { seg: limb })
      : P('thigh' + L, 'cylinder', [0.064 * k * b, 0.44 * k, 0.085 * k * b], [0, -0.2 * k, 0], null, S.legs, { seg: limb }));
    if (o.boots === 'tall') {
      if (hero) out.push(P('shin' + L, 'lathe', [0.075 * k * b, 0.085 * k * b, 0.068 * k * b, 0.13 * k], [0, -0.05 * k, 0], null, S.shin || S.legs, { seg: 5 }));
      out.push(P('shin' + L, 'cylinder', hero ? [0.072 * k * b, 0.33 * k, 0.084 * k * b] : [0.066 * k * b, 0.33 * k, 0.074 * k * b], [0, -0.24 * k, 0.003 * k], null, S.boots, { seg: limb }));
    } else {
      out.push(P('shin' + L, 'cylinder', [0.05 * k * b, 0.4 * k, 0.065 * k * b], [0, -0.2 * k, 0], null, S.shin || S.legs, { seg: limb }));
    }
    if (hero) out.push(P('foot' + L, 'capsule', [0.066 * k, 0.16 * k, 0.72], [0, -0.035 * k, 0.055 * k], [PI / 2, 0, 0], S.boots, { seg: 5 }));
    else out.push(P('foot' + L, 'box', [0.11 * k, 0.08 * k, 0.24 * k], [0, -0.04 * k, 0.05 * k], null, S.boots || S.legs));
  }
  if (o.skirt) {
    const sk = o.skirt;
    out.push(P('hips', 'cone', [sk.r * w * b, sk.len * k], [0, 0.12 * k - sk.len * k * 0.5, 0], null, sk.slot, { seg: hero ? 10 : 8 }));
  }
  if (o.hair) out.push(...hair(o.hair, k, hk, S.hair, o));
  return out;
}

/**
 * Hair: a cap set back on the head so the face shows, plus swept tufts (never an upward crown).
 * @param {string} style 'tail'|'knot'|'short'|'braid'|'bob'|'crop' @param {number} k @param {number} hk @param {string} slot @param {any} o
 */
function hair(style, k, hk, slot, o) {
  const out = [];
  const t = o.detail === 'hero';
  const q = k * hk;
  out.push(P('head', 'sphere', [0.245 * q, 0.25 * q, 0.25 * q], [0, 0.165 * k, -0.05 * k], [0.32, 0, 0], slot, { seg: 8 }));
  // bangs swept to the left, hanging over the forehead
  const bangs = t ? [[0.05, -0.5, 0.12, 0.3], [-0.02, -0.6, 0.13, 0.1], [-0.08, -0.35, 0.11, -0.15]] : [[0.04, -0.55, 0.11, 0.25], [-0.045, -0.55, 0.11, -0.1]];
  if (style !== 'knot' && style !== 'crop') {
    for (const [x, rx, len, rz] of bangs) out.push(P('head', 'tuft', [0.075 * q, len * q, 0.03 * q, 0.35], [x * q, 0.255 * q, 0.06 * q], [rx, 0, rz], slot, { seg: 4 }));
  }
  if (style === 'tail') {
    const len = (o.hairLen || 0.3) * k;
    for (const s of o.sideLock ? [1] : [1, -1]) out.push(P('head', 'tuft', [0.06 * q, 0.15 * q, 0.03 * q, 0.2], [s * 0.112 * q, 0.19 * q, 0.03 * q], [-0.2, 0, s * 0.12], slot, { seg: 4 }));
    out.push(P('tail1', 'tuft', [0.085 * k, len, 0.065 * k, -0.12], [0, 0, -0.005 * k], [0.12, 0, 0], slot, { seg: 5 }));
    out.push(P('tail1', 'torus', [0.03 * k, 0.011 * k], [0, -0.035 * k, -0.01 * k], null, o.ringSlot || slot, { seg: 5 }));
    if (o.sideLock) out.push(P('head', 'tuft', [0.06 * q, 0.26 * q, 0.035 * q, 0.15], [-0.11 * q, 0.15 * q, 0.04 * q], [-0.1, 0, -0.08], slot, { seg: 4 }));
  } else if (style === 'knot') {
    out.push(P('head', 'sphere', [0.11 * q, 0.1 * q, 0.11 * q], [0, 0.275 * q, -0.06 * q], null, slot, { seg: 6 }));
    out.push(P('head', 'torus', [0.04 * q, 0.012 * q], [0, 0.235 * q, -0.06 * q], [0.4, 0, 0], o.ringSlot || slot, { seg: 6 }));
  } else if (style === 'short') {
    for (const [x, z, rz] of [[0.09, -0.06, 0.9], [-0.1, -0.03, -1.1], [0.02, -0.12, 0.2]]) out.push(P('head', 'tuft', [0.08 * q, 0.12 * q, 0.035 * q, 0.3], [x * q, 0.24 * q, z * q], [0.3, 0, rz], slot, { seg: 4 }));
  } else if (style === 'braid') {
    out.push(P('tail1', 'capsule', [0.032 * k, (o.hairLen || 0.32) * k], [0, -(o.hairLen || 0.32) * k * 0.5, -0.01 * k], null, slot, { seg: 5 }));
  } else if (style === 'bob') {
    for (const s of [1, -1]) out.push(P('head', 'tuft', [0.09 * q, 0.2 * q, 0.05 * q, 0.1], [s * 0.1 * q, 0.2 * q, -0.01 * q], [0, 0, s * 0.15], slot, { seg: 4 }));
  }
  return out;
}

/** Builds of the person generator. */
const BUILD = {
  hero_a: { height: 1.78, shoulder: 0.47, bulk: 0.55, head: 1 },
  hero_b: { height: 1.74, shoulder: 0.42, bulk: 0.45, head: 1 },
};

// ------------------------------------------------------------------------------------------------ hero
/** @param {'a'|'b'} v */
function hero(v) {
  const build = BUILD['hero_' + v];
  const k = build.height / 1.8;
  const w = build.shoulder / 0.44;
  const b = 0.7 + build.bulk * 0.55;
  const parts = person({
    build, detail: 'hero', face: true, boots: 'tall', hair: 'tail', hairLen: v === 'a' ? 0.24 : 0.4, sideLock: v === 'b', ringSlot: 'bronze',
    slots: { top: 'coat', legs: 'trousers', shin: 'trousers', boots: 'boots', skin: 'skin', hair: 'hair', eye: 'sclera', iris: 'eye', lid: 'ink', upper: 'skin', fore: 'wraps', hand: 'skin' },
  });
  // a sand cuff on each (now leather) boot top: outfit detail that reads at play distance
  for (const s of [1, -1]) {
    const L = side(s);
    parts.push(P('shin' + L, 'cylinder', [0.085 * k * b, 0.055 * k, 0.088 * k * b], [0, -0.085 * k, 0.003 * k], null, 'wraps', { seg: 7 }));
  }
  // high collar, front lining, belt and ring
  parts.push(P('chest', 'cylinder', [0.085 * w, 0.1 * k, 0.098 * w], [0, 0.245 * k, -0.008 * k], [-0.08, 0, 0], 'coat', { seg: 7 }));
  parts.push(P('chest', 'box', [0.05 * w, 0.27 * k, 0.012], [0.035 * w, 0.06 * k, 0.108 * w * b], [0.08, 0, 0.1], 'coatLining'));
  parts.push(P('spine', 'torus', [0.128 * w * b, 0.022 * k], [0, 0.0, 0], [0, 0, 0], 'sash', { seg: 6 }));
  parts.push(P('spine', 'torus', [0.028 * k, 0.009 * k], [0.07 * w, 0.0, 0.1 * w * b], [PI / 2, 0, 0.2], 'bronze', { seg: 5 }));
  // shoulder edges of the sleeveless coat
  for (const s of [1, -1]) parts.push(P('shoulder' + side(s), 'sphere', [0.16 * w * b, 0.1 * k, 0.165 * w * b], [s * 0.11 * w, 0.005 * k, 0], null, 'coat', { seg: 6 }));
  // coat hem: two front panels and a back split into two flaps
  for (const s of [1, -1]) {
    parts.push(P('hips', 'box', [0.15 * w, 0.3 * k, 0.022], [s * 0.085 * w, -0.13 * k, 0.1 * w * b], [-0.12, 0, s * 0.12], 'coat'));
    parts.push(P('hips', 'box', [0.152 * w, 0.032 * k, 0.026], [s * (0.085 * w + 0.016 * k), -0.265 * k, 0.1 * w * b + 0.017 * k], [-0.12, 0, s * 0.12], 'coatLining'));
    parts.push(P('hips', 'box', [0.15 * w, 0.34 * k, 0.022], [s * 0.088 * w, -0.14 * k, -0.105 * w * b], [0.16, 0, s * 0.14], 'coat'));
  }
  // the sash: across the chest from the left shoulder, a knot, then the long trailing tail on three spring bones
  parts.push(P('chest', 'box', [0.065, 0.44 * k, 0.014], [0.005, 0.06 * k, 0.118 * w * b], [0, 0, -0.62], 'sash'));
  parts.push(P('chest', 'box', [0.018, 0.44 * k, 0.016], [0.005, 0.06 * k, 0.121 * w * b], [0, 0, -0.62], 'sashStripe'));
  parts.push(P('chest', 'box', [0.065, 0.44 * k, 0.014], [0.005, 0.06 * k, -0.116 * w * b], [0, 0, -0.62], 'sash'));
  parts.push(P('sash1', 'sphere', [0.08, 0.07, 0.06], [0, -0.01, 0], null, 'sash', { seg: 6 }));
  const segLen = 0.17 * k;
  for (const bone of ['sash1', 'sash2', 'sash3']) {
    const last = bone === 'sash3';
    const len = last ? segLen * 1.25 : segLen * 1.04;
    parts.push(P(bone, 'box', [last ? 0.07 : 0.078, len, 0.013], [0, -len * 0.5, 0], null, 'sash'));
    parts.push(P(bone, 'box', [0.02, len, 0.015], [0.012, -len * 0.5, -0.002], null, 'sashStripe'));
  }
  const seam = (thick) => {
    const t = thick ? 2.2 : 1.4;
    const out = [];
    for (const s of [1, -1]) {
      const L = side(s);
      out.push(P('chest', 'box', [0.011 * t, 0.16 * k, 0.008], [s * 0.035 * w, 0.13 * k, 0.11 * w * b], [0, 0, s * 0.45], 'seam'));
      out.push(P('arm' + L, 'box', [0.01 * t, 0.2 * k, 0.01 * t], [s * 0.042 * k * b, -0.14 * k, 0.018 * k], [0, 0, 0], 'seam'));
      out.push(P('fore' + L, 'box', [0.01 * t, 0.17 * k, 0.01 * t], [s * 0.04 * k * b, -0.13 * k, 0.02 * k], [0, 0, 0], 'seam'));
    }
    return out;
  };
  const tailLen = (v === 'a' ? 0.24 : 0.4) * k;
  const hairTips = [P('tail1', 'tuft', [0.075 * k, 0.1 * k, 0.05 * k, -0.1], [0, -tailLen * 0.8, -0.012 * k], [0.12, 0, 0], 'ora', { seg: 4 })];
  for (const [x, rz] of [[0.05, 0.3], [-0.08, -0.15]]) {
    hairTips.push(P('head', 'blade', [0.05 * k, 0.07 * k, 0.014 * k], [(x + rz * 0.12) * k, 0.15 * k, 0.124 * k], [-0.4, 0, PI + rz], 'ora'));
  }
  // Tempest mantle: four wide ribbons flaring from the shoulders like a wind-torn cape, plus two swept wind-vanes
  // at the temples (ART_UX 2.3). Wide enough to change the silhouette at phone size.
  const mantle = [];
  for (const s of [1, -1]) {
    mantle.push(P('extra1', 'box', [0.13, 0.78 * k, 0.014], [s * 0.1, -0.32 * k, -0.06], [0.5, 0, s * 0.38], 'ora'));
    mantle.push(P('extra1', 'box', [0.1, 0.66 * k, 0.014], [s * 0.25, -0.24 * k, -0.03], [0.36, 0, s * 0.85], 'ora'));
    mantle.push(P('head', 'blade', [0.08, 0.36 * k, 0.016], [s * 0.12 * k, 0.2 * k, -0.04], [-1.15, s * 0.15, s * -0.55], 'ora'));
  }
  // Zenith: six crystal blades fanned upward behind the shoulders like wings (a V, never a collar), longest inside.
  const blades = [];
  for (const [a, len] of [[0.34, 0.66], [0.78, 0.56], [1.2, 0.44]]) {
    for (const s of [1, -1]) {
      const ang = a * s;
      const L = len * k;
      const r0 = 0.2 + L * 0.5;
      blades.push(P('extra1', 'blade', [0.13, L, 0.03], [Math.sin(ang) * r0, Math.cos(ang) * r0 - 0.05, -0.24], [-0.3, 0, -ang], 'ora', { glossy: true }));
    }
  }
  return {
    id: 'hero_' + v, rig: 'humanoid', scale: 1, build,
    palette: {
      coat: CHAR.coat, coatLining: CHAR.lining, sash: CHAR.sash, sashStripe: CHAR.stripe, trousers: CHAR.trousers, boots: CHAR.leather, wraps: CHAR.sand,
      bronze: CHAR.bronze, skin: CHAR.skin, hair: CHAR.hair, eye: CHAR.amber, ink: PALETTE.ink, glint: PALETTE.oraCore, seam: PALETTE.ora, ora: PALETTE.ora,
      // light eyes with an ink lid and a deep amber iris (base form; the Forms recolour 'eye'), readable at play distance
      sclera: PALETTE.paper,
    },
    emissive: { glint: 0.6, eye: 0.15 },
    parts,
    chains: [{ bones: ['sash1', 'sash2', 'sash3'], stiffness: 38, damping: 6.5 }, { bones: ['tail1'], stiffness: 55, damping: 7 }],
    forms: {
      // Emissive values stay low enough that the low tier (no bloom, colours clamp at 1) keeps the Form hue
      // instead of clipping to cream; the vfx lantern sprites carry the brightness.
      ember: {
        palette: { seam: PALETTE.ember, ora: PALETTE.scorchRim, sash: PALETTE.scorchRim, sashStripe: CHAR.emberCore, eye: PALETTE.ember },
        emissive: { seam: 1.7, ora: 1.1, sash: 0.75, sashStripe: 1.2, eye: 1.2, glint: 0.8 },
        partsAdd: [...seam(true), ...hairTips, P('sash3', 'blade', [0.1, 0.5 * k, 0.012], [0, -0.42 * k, 0], [PI, 0, 0], 'sash'),
          P('sash2', 'box', [0.11, 0.2 * k, 0.012], [0, -0.1 * k, 0], null, 'sash')],
      },
      tempest: {
        palette: { seam: PALETTE.tempest, ora: PALETTE.tempest, sashStripe: CHAR.tempestRibbon, eye: PALETTE.tempest },
        emissive: { seam: 1.7, ora: 0.75, sashStripe: 1.0, eye: 1.1, glint: 0.8 },
        partsAdd: [...seam(true), ...hairTips, ...mantle],
      },
      zenith: {
        palette: { seam: PALETTE.zenith, ora: PALETTE.zenith, sash: PALETTE.zenith, sashStripe: PALETTE.ora },
        emissive: { seam: 1.7, ora: 0.8, sash: 0.5, sashStripe: 1.1, glint: 1.2 },
        partsAdd: [...seam(false), ...hairTips, ...blades],
      },
    },
    radius: 0.42, outline: true, face: true,
  };
}

// ------------------------------------------------------------------------------------------------ named NPCs
const NPC_SLOTS = { top: 'top', legs: 'legs', boots: 'boots', skin: 'skin', hair: 'hair', eye: 'ink', hand: 'skin' };

/** @param {string} id @param {any} build @param {Record<string,number>} palette @param {any} opts @param {any[]} extra */
function npc(id, build, palette, opts, extra) {
  const parts = person(Object.assign({ build, detail: 'lite', face: true }, opts, { slots: Object.assign({}, NPC_SLOTS, opts.slots || {}) }));
  return {
    id, rig: 'humanoid', scale: 1, build,
    palette: Object.assign({ ink: PALETTE.ink, glint: PALETTE.oraCore }, palette), emissive: Object.assign({ glint: 0.3 }, opts.emissive || {}),
    parts: parts.concat(extra), radius: 0.4 * (build.shoulder / 0.44), outline: true, face: true,
  };
}

/** Wrap tunic with a wide sash and a ring brooch (villagers). */
function tunicExtras(k, w, b, sashSlot, broochSlot) {
  return [
    P('spine', 'torus', [0.13 * w * b, 0.035 * k], [0, -0.02 * k, 0], null, sashSlot, { seg: 6 }),
    P('chest', 'torus', [0.022 * k, 0.008 * k], [0.06 * w, 0.14 * k, 0.1 * w * b], [PI / 2, 0, 0], broochSlot, { seg: 5 }),
    P('chest', 'box', [0.06 * w, 0.28 * k, 0.012], [-0.03 * w, 0.06 * k, 0.1 * w * b], [0.08, 0, -0.18], sashSlot),
  ];
}

/** Six villager builds and looks plus the six named villagers' props. */
const SKINS = [0xe0b48c, 0xc98f6b, 0x9a6a4a, 0xf0c8a8];
const HAIRS = [0x1c1a24, 0x4a3020, 0x6b2a2a, 0x9a9590];
const OUTFITS = [
  [PALETTE.structure.terracotta, PALETTE.biome.meadows.accent, 0x4a4038], [0x3f7f8f, PALETTE.paper, 0x3b3346], [0x7a8a4a, 0xc8463a, 0x4a3a2e],
  [0xa86a8a, PALETTE.structure.lantern, 0x3a3344], [0xc9ae84, PALETTE.structure.curtain, 0x5a4a3a], [0x5e6e9a, PALETTE.biome.rustdune.ground, 0x2e2a36],
];
const BUILDS = [{ shoulder: 0.42, bulk: 0.35 }, { shoulder: 0.45, bulk: 0.55 }, { shoulder: 0.5, bulk: 0.85 }];
const HAIR_STYLES = ['short', 'bob', 'braid', 'knot'];
const HEADWEAR = ['none', 'cap', 'scarf', 'straw'];

/**
 * The villager generator: 3 builds x 2 heights x 4 skins x 6 outfits x 4 hair shapes x 4 headwear, picked by index.
 * @param {string} id @param {number} i @param {any[]} [prop] extra parts (named villagers)
 */
export function villager(id, i, prop) {
  const bs = BUILDS[i % 3];
  const build = { height: i % 2 ? 1.66 : 1.8, shoulder: bs.shoulder, bulk: bs.bulk, head: 1 };
  const k = build.height / 1.8;
  const w = build.shoulder / 0.44;
  const b = 0.7 + build.bulk * 0.55;
  const of = OUTFITS[(i * 5 + 1) % 6];
  const style = HAIR_STYLES[(i + 1) % 4];
  const hw = HEADWEAR[(i * 3) % 4];
  const extra = tunicExtras(k, w, b, 'sash', 'brooch');
  if (hw === 'cap') extra.push(P('head', 'sphere', [0.26 * k, 0.15 * k, 0.26 * k], [0, 0.22 * k, -0.02 * k], [0.2, 0, 0], 'hat', { seg: 6 }));
  else if (hw === 'scarf') extra.push(P('head', 'sphere', [0.265 * k, 0.24 * k, 0.27 * k], [0, 0.16 * k, -0.05 * k], [0.3, 0, 0], 'hat', { seg: 6 }));
  else if (hw === 'straw') {
    extra.push(P('head', 'cylinder', [0.24 * k, 0.02 * k], [0, 0.23 * k, 0], [-0.08, 0, 0], 'hat', { seg: 8 }));
    extra.push(P('head', 'cylinder', [0.12 * k, 0.09 * k, 0.1 * k], [0, 0.27 * k, -0.01 * k], [-0.08, 0, 0], 'hat', { seg: 6 }));
  }
  return npc(id, build, {
    top: of[0], sash: of[1], legs: of[2], boots: 0x4a3a2e, skin: SKINS[(i * 3 + 2) % 4], hair: HAIRS[(i * 7 + 1) % 4], brooch: CHAR.bronze,
    hat: [0xd8c08a, 0x7a5a4a, 0xc8463a, 0x3f5566][i % 4], prop: [0x9a7a4a, 0xd9c7a0, 0x6b4a3a, 0xe9dcc0, 0x8a6a4e, PALETTE.structure.kites[i % 3]][i % 6],
  }, { hair: hw === 'none' || hw === 'straw' ? style : 'crop', hairLen: 0.3, boots: 'short', skirt: i % 2 ? { slot: 'top', len: 0.5, r: 0.2 } : null }, extra.concat(prop || []));
}

function namedNpcs() {
  const out = [];
  // Sela: lean, straight-backed, silver high knot, long sand wrap coat, teal sash, ring-head staff, faint teal seams on the hands
  {
    const build = { height: 1.72, shoulder: 0.4, bulk: 0.3, head: 1 };
    const k = build.height / 1.8;
    out.push(npc('npc_sela', build, { top: CHAR.sand, legs: 0x6a5a48, boots: 0x4a3a2e, skin: 0xd8ac88, hair: CHAR.silver, sash: CHAR.selaSash, staff: 0x7a5a3a, seam: PALETTE.ora },
      { hair: 'knot', skirt: { slot: 'top', len: 0.72, r: 0.2 }, boots: 'short', emissive: { seam: 1.2 } }, [
        ...tunicExtras(k, 0.9, 0.86, 'sash', 'staff'),
        P('handR', 'cylinder', [0.018, 1.55 * k], [0, -0.1 * k, 0.04], [0, 0, 0], 'staff', { seg: 5 }),
        P('handR', 'torus', [0.075, 0.014], [0, 0.72 * k, 0.04], [PI / 2, 0, 0], 'staff', { seg: 8 }),
        P('handL', 'box', [0.06, 0.008, 0.06], [0, -0.04, 0.035], null, 'seam'),
        P('handR', 'box', [0.06, 0.008, 0.06], [0, -0.04, 0.035], null, 'seam'),
      ]));
  }
  // Kerrin: stockier, short dark-red hair swept to one side, cropped slate jacket, yellow sash and a sash ring
  {
    const build = { height: 1.76, shoulder: 0.5, bulk: 0.78, head: 1 };
    const k = build.height / 1.8;
    out.push(npc('npc_kerrin', build, { top: CHAR.kerrinJacket, under: 0x2e2a36, legs: 0x3a3344, boots: 0x4a3a2e, skin: 0xd09a74, hair: CHAR.kerrinHair, sash: CHAR.kerrinSash, ring: CHAR.bronze },
      { hair: 'short', boots: 'tall', slots: { abdomen: 'under', upper: 'top', fore: 'skin' } }, [
        P('spine', 'torus', [0.15, 0.03 * k], [0, -0.02 * k, 0], null, 'sash', { seg: 6 }),
        P('hips', 'box', [0.07, 0.32 * k, 0.014], [0.12, -0.14 * k, 0.06], [0, 0, 0.12], 'sash'),
        P('handR', 'torus', [0.035, 0.008], [0, -0.1, 0.02], null, 'ring', { seg: 6 }),
        P('chest', 'cylinder', [0.09, 0.07 * k, 0.1], [0, 0.24 * k, 0], null, 'top', { seg: 6 }),
      ]));
  }
  // Dov: round merchant, wide-brim hat, apron, a huge ladle on his back
  {
    const build = { height: 1.7, shoulder: 0.5, bulk: 1.0, head: 1 };
    const k = build.height / 1.8;
    out.push(npc('npc_dov', build, { top: 0xd9c7a0, legs: 0x5a4a3a, boots: 0x3a2e26, skin: 0xc98f6b, hair: 0x3a2a1e, apron: CHAR.dovApron, hat: 0x6b4a3a, ladle: 0x9a9590 },
      { hair: 'crop', boots: 'short' }, [
        P('spine', 'sphere', [0.36, 0.3, 0.32], [0, 0.04 * k, 0.02], null, 'top', { seg: 8 }),
        P('spine', 'box', [0.26, 0.5 * k, 0.02], [0, -0.1 * k, 0.17], [-0.08, 0, 0], 'apron'),
        P('head', 'cylinder', [0.27 * k, 0.018 * k], [0, 0.22 * k, 0], [-0.06, 0, 0], 'hat', { seg: 10 }),
        P('head', 'cylinder', [0.125 * k, 0.11 * k, 0.11 * k], [0, 0.28 * k, -0.01], [-0.06, 0, 0], 'hat', { seg: 6 }),
        P('extra1', 'cylinder', [0.02, 0.9 * k], [0.08, -0.25, -0.03], [0, 0, 0.35], 'ladle', { seg: 5 }),
        P('extra1', 'sphere', [0.2, 0.12, 0.2], [0.24, -0.66, -0.03], [0, 0, 0.35], 'ladle', { seg: 6 }),
      ]));
  }
  // Mira: smith, rolled sleeves, leather apron, hammer at the belt, hair wrapped in a red cloth
  {
    const build = { height: 1.74, shoulder: 0.47, bulk: 0.7, head: 1 };
    const k = build.height / 1.8;
    out.push(npc('npc_mira', build, { top: 0x8a7a68, legs: 0x4a3a2e, boots: 0x2e2620, skin: 0xb98060, hair: CHAR.redCloth, apron: CHAR.leather, iron: 0x5a5660 },
      { hair: 'crop', boots: 'short', slots: { fore: 'skin' } }, [
        P('head', 'sphere', [0.25, 0.2, 0.26], [0, 0.2 * k, -0.04], [0.25, 0, 0], 'hair', { seg: 6 }),
        P('head', 'sphere', [0.09, 0.09, 0.09], [0, 0.24 * k, -0.15], null, 'hair', { seg: 5 }),
        P('chest', 'box', [0.28, 0.36 * k, 0.02], [0, 0.0, 0.115], [-0.05, 0, 0], 'apron'),
        P('spine', 'box', [0.3, 0.42 * k, 0.02], [0, -0.16 * k, 0.13], [-0.1, 0, 0], 'apron'),
        P('hips', 'cylinder', [0.016, 0.3 * k], [-0.17, -0.05, 0.05], [0, 0, 0.1], 'apron', { seg: 5 }),
        P('hips', 'box', [0.1, 0.06, 0.06], [-0.19, 0.1, 0.05], null, 'iron'),
      ]));
  }
  // Bren: broad and weathered, grey braid under a knitted cap, oilskin coat with rolled sleeves, brass lens ring, folded kite on the back
  {
    const build = { height: 1.82, shoulder: 0.52, bulk: 0.8, head: 1 };
    const k = build.height / 1.8;
    out.push(npc('npc_bren', build, { top: CHAR.oilskin, legs: 0x3e3a44, boots: 0x2e2a26, skin: 0xc08a68, hair: 0x9a9590, cap: 0x8a4a3a, brass: CHAR.brass, kite: PALETTE.structure.kites[0] },
      { hair: 'braid', hairLen: 0.34, boots: 'tall', slots: { fore: 'skin' }, skirt: { slot: 'top', len: 0.5, r: 0.19 } }, [
        P('head', 'sphere', [0.25, 0.17, 0.26], [0, 0.21 * k, -0.02], [0.15, 0, 0], 'cap', { seg: 6 }),
        P('chest', 'torus', [0.045, 0.01], [0, 0.04 * k, 0.13], [PI / 2, 0, 0], 'brass', { seg: 8 }),
        P('extra1', 'box', [0.44, 0.5, 0.04], [0, -0.18, -0.05], [0, 0, PI / 4], 'kite'),
      ]));
  }
  // Yael: outpost trader, sun hood, copper goggles pushed up, satchel
  {
    const build = { height: 1.68, shoulder: 0.42, bulk: 0.5, head: 1 };
    const k = build.height / 1.8;
    out.push(npc('npc_yael', build, { top: 0xd8c8a8, legs: 0x6a5040, boots: 0x4a3a2e, skin: 0xa8704e, hair: 0x2a1e18, hood: CHAR.sunHood, copper: CHAR.copper, satchel: 0x7a5a3a },
      { hair: 'crop', boots: 'tall' }, [
        P('head', 'sphere', [0.29 * k, 0.29 * k, 0.3 * k], [0, 0.15 * k, -0.045], [0.15, 0, 0], 'hood', { seg: 8 }),
        P('chest', 'cone', [0.25, 0.22 * k], [0, 0.2 * k, -0.02], null, 'hood', { seg: 8 }),
        P('head', 'cylinder', [0.034, 0.03], [0.045, 0.24 * k, 0.09], [-1.2, 0, 0], 'copper', { seg: 6 }),
        P('head', 'cylinder', [0.034, 0.03], [-0.045, 0.24 * k, 0.09], [-1.2, 0, 0], 'copper', { seg: 6 }),
        P('hips', 'box', [0.2, 0.16, 0.08], [0.2, 0.0, 0.02], [0, 0, 0.1], 'satchel'),
        P('chest', 'box', [0.04, 0.6 * k, 0.012], [0, 0.03, 0.11], [0, 0, 0.6], 'satchel'),
      ]));
  }
  // Abbess Noa: tall, grey cowl, a string of small wind bells across the chest
  {
    const build = { height: 1.9, shoulder: 0.42, bulk: 0.4, head: 1 };
    const k = build.height / 1.8;
    const bells = [];
    for (let i = 0; i < 5; i++) bells.push(P('chest', 'sphere', [0.04, 0.045, 0.04], [0.13 - i * 0.065, 0.16 * k - i * 0.04, 0.115], null, 'bell', { seg: 5 }));
    out.push(npc('npc_noa', build, { top: CHAR.cowl, legs: 0x6e7a8a, boots: 0x3e3a44, skin: 0xe8c4a4, hair: 0xb8b4bc, bell: CHAR.bell, cord: 0x3e3a44 },
      { hair: 'crop', boots: 'short', skirt: { slot: 'top', len: 0.85, r: 0.22 } }, [
        P('head', 'sphere', [0.3 * k, 0.31 * k, 0.31 * k], [0, 0.14 * k, -0.05], [0.12, 0, 0], 'top', { seg: 8 }),
        P('chest', 'cone', [0.27, 0.3 * k], [0, 0.17 * k, -0.01], null, 'top', { seg: 8 }),
        P('chest', 'box', [0.01, 0.34, 0.01], [0, 0.08 * k, 0.113], [0, 0, 1.0], 'cord'),
        ...bells,
      ]));
  }
  // Talia, Eli, Oren, Ilan, Rina, Gal: villager generator plus one prop each
  const props = {
    npc_talia: [P('foreL', 'cylinder', [0.13, 0.12, 0.15], [0.12, -0.12, 0.08], null, 'prop', { seg: 8 }), P('foreL', 'torus', [0.1, 0.012], [0.12, -0.02, 0.08], [0, 0, PI / 2], 'prop', { seg: 6 })],
    npc_eli: [P('handL', 'box', [0.16, 0.22, 0.04], [0, -0.06, 0.08], [-0.6, 0, 0], 'prop')],
    npc_oren: [P('extra1', 'box', [0.36, 0.62, 0.06], [0, -0.2, -0.08], null, 'prop'), P('extra1', 'box', [0.3, 0.26, 0.2], [0, -0.1, -0.2], null, 'hat')],
    npc_ilan: [P('shoulderR', 'sphere', [0.34, 0.26, 0.24], [-0.08, 0.12, -0.04], [0, 0, 0.3], 'prop', { seg: 6 })],
    npc_rina: [P('handR', 'cylinder', [0.018, 1.6], [0, -0.05, 0.05], null, 'prop', { seg: 5 }), P('handR', 'torus', [0.1, 0.016], [0.1, 0.74, 0.05], [PI / 2, 0, 0], 'prop', { seg: 8 })],
    npc_gal: [P('extra1', 'box', [0.5, 0.6, 0.03], [0, -0.12, -0.05], [0, 0, PI / 4], 'prop'), P('extra1', 'box', [0.012, 0.75, 0.01], [0, -0.12, -0.07], null, 'hat')],
  };
  let i = 6;
  for (const id of ['npc_talia', 'npc_eli', 'npc_oren', 'npc_ilan', 'npc_rina', 'npc_gal']) out.push(villager(id, i++, props[id]));
  for (let v = 1; v <= 6; v++) out.push(villager('npc_villager_' + v, v - 1));
  return out;
}

// ------------------------------------------------------------------------------------------------ enemies
/** Choir humanoid base: hooded robe, dark veil instead of a face. */
function choir(id, build, scale, palette, opts, extra) {
  const k = build.height / 1.8;
  const w = build.shoulder / 0.44;
  const parts = person({
    build, detail: 'lite', face: false, boots: 'short', noNeck: true, skirt: opts.skirt === false ? null : { slot: 'robe', len: opts.skirtLen || 0.82, r: 0.2 },
    slots: { top: 'robe', legs: 'under', boots: 'under', skin: 'veil', hair: 'robe', eye: 'veil', upper: 'robe', fore: 'under', hand: 'under' },
  });
  parts.push(P('head', 'cone', [0.17 * k, 0.36 * k], [0, 0.17 * k, -0.035 * k], [-0.15, 0, 0], 'robe', { seg: 8 }));
  parts.push(P('chest', 'cone', [0.25 * w, 0.24 * k], [0, 0.2 * k, -0.01], null, 'robe', { seg: 8 }));
  for (const s of [1, -1]) parts.push(P('head', 'box', [0.04 * k, 0.012 * k, 0.01], [s * 0.04 * k, 0.12 * k, 0.112 * k], [0, s * 0.4, s * -0.2], 'glass'));
  return {
    id, rig: opts.rig || 'humanoid', scale, build, palette: Object.assign({ robe: CHAR.robe, under: CHAR.under, veil: PALETTE.ink, glass: GLASS, iron: CHAR.iron }, palette),
    emissive: { glass: 1.6 }, parts: parts.concat(extra), radius: opts.radius || 0.45, outline: true, face: false, hover: !!opts.hover,
  };
}

function acolyte() {
  const build = { height: 1.8, shoulder: 0.46, bulk: 0.55, head: 1 };
  return choir('choir_acolyte', build, 1, {}, {}, [
    P('chest', 'capsule', [0.04, 0.09], [0, 0.04, 0.125], null, 'glass', { glossy: true, seg: 6 }),
    P('handR', 'cylinder', [0.022, 0.62], [0, -0.04, 0.22], [PI / 2, 0, 0], 'iron', { seg: 5 }),
    P('handR', 'box', [0.06, 0.06, 0.12], [0, -0.04, 0.52], null, 'iron'),
  ]);
}

function caster() {
  const build = { height: 2.0, shoulder: 0.4, bulk: 0.3, head: 1 };
  const strips = [];
  for (const [x, z, rx, rz] of [[0.08, 0.1, -0.08, 0.06], [-0.08, 0.1, -0.08, -0.06], [0.09, -0.1, 0.1, 0.08], [-0.09, -0.1, 0.1, -0.08]]) {
    strips.push(P('hips', 'box', [0.12, 0.95, 0.016], [x, -0.42, z], [rx, 0, rz], 'robe'));
  }
  return choir('choir_caster', build, 1, {}, { skirt: false, hover: true, radius: 0.42 }, [
    ...strips,
    P('handL', 'capsule', [0.035, 0.08], [0.1, -0.02, 0.1], [0.5, 0, 0.4], 'glass', { glossy: true, seg: 5 }),
    P('handR', 'capsule', [0.035, 0.08], [-0.1, -0.02, 0.1], [0.5, 0, -0.4], 'glass', { glossy: true, seg: 5 }),
    P('chest', 'capsule', [0.035, 0.07], [0, 0.05, 0.11], null, 'glass', { seg: 5 }),
  ]);
}

function vanguard() {
  const build = { height: 1.85, shoulder: 0.52, bulk: 0.75, head: 1 };
  const k = build.height / 1.8;
  const extra = [
    P('chest', 'box', [0.36, 0.3, 0.27], [0, 0.07, 0.01], null, 'plate'),
    P('spine', 'box', [0.3, 0.16, 0.24], [0, 0.06, 0], null, 'plate'),
    P('head', 'sphere', [0.25, 0.22, 0.27], [0, 0.17, -0.01], null, 'plate', { seg: 6 }),
    P('handR', 'cylinder', [0.022, 1.7], [0, -0.05, 0.12], [PI / 2, 0, 0], 'iron', { seg: 5 }),
    P('handR', 'blade', [0.12, 0.55, 0.03], [0, -0.05, 1.18], [PI / 2, 0, 0], 'glass', { glossy: true }),
    P('sash1', 'box', [0.2, 0.2 * k, 0.02], [-0.05, -0.1 * k, 0], null, 'cape'),
    P('sash2', 'box', [0.19, 0.19 * k, 0.02], [-0.05, -0.1 * k, 0], null, 'cape'),
    P('sash3', 'box', [0.17, 0.2 * k, 0.02], [-0.05, -0.1 * k, 0], null, 'cape'),
  ];
  for (const s of [1, -1]) {
    extra.push(P('shoulder' + side(s), 'sphere', [0.22, 0.14, 0.22], [s * 0.15, 0.03, 0], [0, 0, s * -0.3], 'plate', { seg: 6 }));
    extra.push(P('fore' + side(s), 'cylinder', [0.06, 0.16, 0.055], [0, -0.14, 0], null, 'plate', { seg: 5 }));
    extra.push(P('shin' + side(s), 'cylinder', [0.065, 0.2, 0.07], [0, -0.16, 0.01], null, 'plate', { seg: 5 }));
  }
  for (const x of [-0.08, 0, 0.08]) extra.push(P('extra1', 'capsule', [0.03, 0.14], [x, -0.04, -0.04], [0.1, 0, x * 2], 'glass', { glossy: true, seg: 5 }));
  return choir('choir_vanguard', build, 1, { plate: CHAR.plate, cape: CHAR.under }, { skirtLen: 0.5, radius: 0.5 }, extra);
}

function durn() {
  const build = { height: 1.8, shoulder: 0.5, bulk: 0.7, head: 1 };
  const k = 1;
  const extra = [
    P('sash1', 'box', [0.34, 0.22, 0.02], [-0.12, -0.1, 0], null, 'cape'),
    P('sash2', 'box', [0.32, 0.2, 0.02], [-0.12, -0.1, 0], null, 'cape'),
    P('sash3', 'box', [0.28, 0.22, 0.02], [-0.12, -0.11, 0], null, 'cape'),
    P('shoulderL', 'sphere', [0.24, 0.13, 0.24], [0.13, 0.03, 0], [0, 0, -0.3], 'cape', { seg: 8 }),
    P('chest', 'capsule', [0.042, 0.09], [0.06, 0.04, 0.13], null, 'glass', { glossy: true, seg: 6 }),
    P('chest', 'capsule', [0.042, 0.09], [-0.06, 0.04, 0.13], null, 'glass', { glossy: true, seg: 6 }),
    P('handR', 'cylinder', [0.03, 0.75], [0, -0.04, 0.3], [PI / 2, 0, 0], 'iron', { seg: 6 }),
    P('handR', 'sphere', [0.2, 0.2, 0.24], [0, -0.04, 0.7], null, 'iron', { seg: 8 }),
    P('spine', 'torus', [0.15, 0.025 * k], [0, 0, 0], null, 'iron', { seg: 8 }),
  ];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    extra.push(P('handR', 'box', [0.03, 0.22, 0.2], [Math.sin(a) * 0.1, -0.04 + Math.cos(a) * 0.1, 0.7], [0, 0, -a], 'iron'));
  }
  return choir('durn', build, 1.25, { cape: CHAR.durnCape }, { radius: 0.6 }, extra);
}

function iskra() {
  const build = { height: 1.8, shoulder: 0.45, bulk: 0.5, head: 1 };
  const parts = person({
    build, detail: 'hero', face: true, boots: 'tall', hair: 'bob',
    slots: { top: 'armour', legs: 'under', shin: 'under', boots: 'armour', skin: 'skin', hair: 'hair', eye: 'glass', upper: 'under', fore: 'armour', hand: 'armour' },
  });
  for (let i = 0; i < 5; i++) {
    const a = 0.3 + i * 0.3;
    for (const s of [1, -1]) parts.push(P('extra1', 'blade', [0.09, 0.62 - i * 0.05, 0.02], [s * Math.sin(a) * 0.3, Math.cos(a) * 0.3 - 0.05, -0.1], [0.3, 0, -s * a], 'ice', { glossy: true }));
  }
  for (const s of [1, -1]) {
    parts.push(P('hand' + side(s), 'cylinder', [0.02, 0.12], [0, -0.06, 0.02], [PI / 2, 0, 0], 'armour', { seg: 5 }));
    parts.push(P('hand' + side(s), 'blade', [0.06, 0.8, 0.018], [0, -0.06, 0.48], [PI / 2, 0, 0], 'ice', { glossy: true }));
    parts.push(P('shoulder' + side(s), 'sphere', [0.18, 0.12, 0.2], [s * 0.12, 0.02, 0], [0, 0, s * -0.3], 'armour', { seg: 6 }));
  }
  parts.push(P('neck', 'sphere', [0.07, 0.07, 0.05], [0, 0.03, 0.05], null, 'glass', { seg: 6, glossy: true }));
  parts.push(P('chest', 'cylinder', [0.09, 0.1, 0.1], [0, 0.24, -0.01], null, 'armour', { seg: 8 }));
  return {
    id: 'iskra', rig: 'humanoid', scale: 1, build,
    palette: { armour: CHAR.iskraArmour, under: 0x5a6478, skin: 0xf0d8c8, hair: 0xe8eef6, ice: CHAR.ice, glass: GLASS, ink: PALETTE.ink, glint: PALETTE.oraCore },
    emissive: { glass: 1.6, ice: 0.45, glint: 0.4 }, parts, radius: 0.45, outline: true, face: true,
  };
}

function vorrhal() {
  const build = { height: 2.4, shoulder: 0.46, bulk: 0.25, head: 0.95 };
  const k = build.height / 1.8;
  const parts = person({
    build, detail: 'hero', face: true, boots: 'short', hair: 'crop', noNeck: false, skirt: { slot: 'robe', len: 1.12, r: 0.44 },
    slots: { top: 'robe', legs: 'robe', boots: 'robe', skin: 'skin', hair: 'robe', eye: 'ink', upper: 'robe', fore: 'robe', hand: 'skin' },
  });
  parts.push(P('head', 'sphere', [0.27 * k, 0.29 * k, 0.28 * k], [0, 0.14 * k, -0.05 * k], [0.15, 0, 0], 'robe', { seg: 8 }));
  for (let i = 0; i < 7; i++) {
    const a = -0.9 + i * 0.3;
    parts.push(P('chest', 'cylinder', [0.02 * k, 0.16 * k], [Math.sin(a) * 0.12 * k, 0.2 * k, 0.03 + Math.cos(a) * 0.1 * k], [0.5 * Math.cos(a), 0, -a * 0.4], 'glass', { seg: 5, glossy: true }));
  }
  for (const s of [1, -1]) {
    parts.push(P('chest', 'box', [0.01, 0.22 * k, 0.008], [s * 0.06 * k, 0.05 * k, 0.1 * k], [0, 0, s * 0.3], 'seam'));
    parts.push(P('arm' + side(s), 'box', [0.01, 0.22 * k, 0.01], [s * 0.035 * k, -0.14 * k, 0.025 * k], null, 'seam'));
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2;
    parts.push(P('hips', 'box', [0.06, 0.06, 0.06], [Math.sin(a) * 0.3 * k, -0.62 * k + (i % 3) * 0.12, Math.cos(a) * 0.3 * k], [a, a, 0], 'motes'));
  }
  return {
    id: 'vorrhal', rig: 'humanoid', scale: 1, build,
    palette: { robe: CHAR.charcoal, skin: 0xb8b0b4, seam: CHAR.deadGrey, glass: GLASS, motes: CHAR.deadGrey, ink: PALETTE.ink, glint: PALETTE.oraCore },
    emissive: { glass: 1.2, glint: 0.2 }, parts, radius: 0.55, outline: true, face: true, hover: true,
  };
}

function golem() {
  const build = { height: 1.8, shoulder: 0.6, bulk: 1, head: 1 };
  const parts = [
    P('chest', 'box', [0.66, 0.42, 0.44], [0, 0.1, 0], null, 'rust'), P('chest', 'box', [0.68, 0.03, 0.46], [0, -0.12, 0], null, 'seam'),
    P('chest', 'sphere', [0.16, 0.16, 0.1], [0, 0.1, 0.22], null, 'glass', { seg: 8, glossy: true }),
    P('spine', 'box', [0.48, 0.24, 0.36], [0, 0.07, 0], null, 'rust'), P('hips', 'box', [0.52, 0.2, 0.36], [0, 0, 0], null, 'rust'),
    P('hips', 'box', [0.54, 0.03, 0.38], [0, 0.11, 0], null, 'seam'),
    P('head', 'box', [0.22, 0.2, 0.24], [0, 0.08, 0.03], null, 'rust'),
    P('head', 'box', [0.16, 0.035, 0.02], [0, 0.1, 0.155], null, 'glass'),
  ];
  for (const s of [1, -1]) {
    const L = side(s);
    parts.push(P('shoulder' + L, 'box', [0.3, 0.26, 0.32], [s * 0.18, 0.02, 0], null, 'rust'));
    parts.push(P('arm' + L, 'box', [0.16, 0.3, 0.17], [0, -0.15, 0], null, 'rust'));
    parts.push(P('fore' + L, 'box', [0.3, 0.36, 0.3], [0, -0.2, 0.02], null, 'rust'));
    parts.push(P('fore' + L, 'box', [0.32, 0.03, 0.32], [0, -0.06, 0.02], null, 'seam'));
    parts.push(P('hand' + L, 'box', [0.24, 0.16, 0.26], [0, -0.12, 0.02], null, 'iron'));
    parts.push(P('thigh' + L, 'box', [0.2, 0.38, 0.22], [0, -0.2, 0], null, 'rust'));
    parts.push(P('shin' + L, 'box', [0.22, 0.34, 0.24], [0, -0.2, 0], null, 'rust'));
    parts.push(P('shin' + L, 'box', [0.235, 0.03, 0.255], [0, -0.02, 0], null, 'seam'));
    parts.push(P('foot' + L, 'box', [0.24, 0.1, 0.34], [0, -0.03, 0.06], null, 'iron'));
  }
  return {
    id: 'rust_golem', rig: 'giant', scale: 1.45, build, palette: { rust: CHAR.rust, seam: CHAR.verdigris, iron: 0x5a4a44, glass: GLASS },
    emissive: { glass: 1.8, seam: 0.25 }, parts, radius: 0.8, outline: true, face: false,
  };
}

/** Boar family: barrel body, huge shoulders, two forward tusks, crystal ridge. */
function boar(id, hide, thorns) {
  const parts = [
    P('spine', 'lathe', [0.24, 0.29, 0.27, 0.62, 0.95], [0, 0.02, 0], [PI / 2, 0, 0], 'hide', { seg: 6 }),
    P('chest', 'sphere', [0.58, 0.56, 0.5], [0, 0.04, 0.02], null, 'hide', { seg: 8 }),
    P('hips', 'sphere', [0.46, 0.44, 0.4], [0, 0.0, 0.02], null, 'hide', { seg: 7 }),
    P('head', 'sphere', [0.3, 0.28, 0.36], [0, -0.02, 0.08], null, 'hide', { seg: 7 }),
    P('head', 'cylinder', [0.085, 0.12, 0.075], [0, -0.07, 0.27], [PI / 2, 0, 0], 'snout', { seg: 5 }),
    P('jaw', 'box', [0.16, 0.05, 0.14], [0, -0.0, 0.06], null, 'snout'),
    P('tail1', 'tuft', [0.05, 0.18, 0.03, 0.1], [0, 0, 0], [-1.1, 0, 0], 'hide', { seg: 4 }),
  ];
  for (const s of [1, -1]) {
    const L = side(s);
    parts.push(P('head', 'cone', [0.03, 0.24], [s * 0.09, -0.08, 0.3], [-1.05, 0, s * -0.2], 'tusk', { seg: 5 }));
    parts.push(P('head', 'sphere', [0.045, 0.04, 0.03], [s * 0.1, 0.05, 0.2], null, 'glass', { seg: 4 }));
    parts.push(P('head', 'cone', [0.06, 0.12], [s * 0.12, 0.15, 0.0], [-0.4, 0, s * -0.5], 'hide', { seg: 4 }));
    for (const fb of ['F', 'B']) {
      parts.push(P('leg' + fb + L, 'capsule', [0.075, 0.2], [0, -0.16, 0], null, 'hide', { seg: 5 }));
      parts.push(P('foot' + fb + L, 'cylinder', [0.05, 0.28, 0.06], [0, -0.17, 0], null, 'dark', { seg: 5 }));
      parts.push(P('foot' + fb + L, 'cylinder', [0.065, 0.06, 0.055], [0, -0.33, 0.01], null, 'snout', { seg: 5 }));
    }
  }
  for (let i = 0; i < 3; i++) parts.push(P('spine', 'cone', [0.05, 0.16 - i * 0.03], [0, 0.32 - i * 0.03, 0.14 - i * 0.16], [-0.3, 0, 0], 'glass', { seg: 4, glossy: true }));
  if (thorns) {
    for (const [b, x, y, z, rz] of [['chest', 0.18, 0.24, 0.0, -0.6], ['chest', -0.18, 0.24, 0.0, 0.6], ['spine', 0.15, 0.24, -0.1, -0.6], ['spine', -0.15, 0.24, -0.1, 0.6], ['hips', 0.12, 0.2, -0.05, -0.5], ['hips', -0.12, 0.2, -0.05, 0.5]]) {
      parts.push(P(b, 'cone', [0.035, 0.18], [x, y, z], [-0.3, 0, rz], 'thorn', { seg: 3 }));
    }
  }
  return {
    id, rig: 'quadruped', scale: 1, build: { height: 1.2, shoulder: 0.4, bulk: 0.8, head: 1 },
    palette: { hide, dark: thorns ? 0x2a3a30 : 0x5a4434, snout: 0x3a2e2a, tusk: PALETTE.paper, glass: GLASS, thorn: 0x6a5a3a },
    emissive: { glass: 1.4 }, parts, radius: 0.65, outline: true, face: false,
  };
}

function crab() {
  const parts = [
    P('spine', 'sphere', [0.95, 0.3, 0.8], [0, 0.0, -0.05], null, 'shell', { seg: 9 }),
    P('spine', 'box', [0.5, 0.06, 0.34], [0, 0.14, 0.05], [0.1, 0, 0], 'plate'),
    P('spine', 'box', [0.4, 0.06, 0.28], [0, 0.13, -0.25], [-0.15, 0, 0], 'plate'),
    P('chest', 'sphere', [0.5, 0.22, 0.3], [0, -0.02, -0.05], null, 'under', { seg: 6 }),
  ];
  for (const s of [1, -1]) {
    const L = side(s);
    parts.push(P('head', 'capsule', [0.02, 0.14], [s * 0.07, 0.0, -0.02], null, 'under', { seg: 4 }));
    parts.push(P('head', 'sphere', [0.06, 0.06, 0.06], [s * 0.07, 0.09, -0.02], null, 'glass', { seg: 4 }));
    parts.push(P('claw' + L, 'capsule', [0.06, 0.22], [s * 0.05, 0.0, 0.08], [PI / 2, 0, 0], 'shell', { seg: 5 }));
    parts.push(P('claw' + L, 'sphere', [0.3, 0.24, 0.36], [s * 0.06, 0.05, 0.32], null, 'shell', { seg: 8 }));
    parts.push(P('claw' + L, 'cone', [0.07, 0.26], [s * 0.04, 0.0, 0.58], [PI / 2, 0, 0], 'plate', { seg: 5 }));
    parts.push(P('claw' + L, 'sphere', [0.07, 0.07, 0.07], [s * 0.1, 0.17, 0.3], null, 'glass', { seg: 5 }));
    for (const fb of ['F', 'B']) {
      parts.push(P('leg' + fb + L, 'capsule', [0.04, 0.3], [s * 0.15, -0.08, 0], [0, 0, s * 1.0], 'under', { seg: 4 }));
      parts.push(P('foot' + fb + L, 'cone', [0.04, 0.42], [s * 0.3, -0.2, 0], [0, 0, s * 0.45 + PI], 'under', { seg: 4 }));
    }
  }
  for (const [x, z] of [[0.25, 0.1], [-0.22, -0.2], [0.05, -0.32], [-0.3, 0.15]]) parts.push(P('spine', 'sphere', [0.08, 0.08, 0.08], [x, 0.12, z], null, 'glass', { seg: 5, glossy: true }));
  return {
    id: 'scuttlecrab', rig: 'quadruped', scale: 1, build: { height: 0.9, shoulder: 0.5, bulk: 0.8, head: 1 },
    palette: { shell: CHAR.saltPlate, plate: 0xcfc2a6, under: 0x9a8a78, glass: GLASS }, emissive: { glass: 1.4 }, parts, radius: 0.7, outline: true, face: false,
  };
}

function harrier() {
  const parts = [
    P('hips', 'sphere', [0.34, 0.32, 0.6], [0, 0.0, 0.04], null, 'body', { seg: 8 }),
    P('chest', 'sphere', [0.3, 0.3, 0.32], [0, 0.0, 0.04], null, 'body', { seg: 8 }),
    P('head', 'sphere', [0.2, 0.19, 0.24], [0, 0.0, 0.02], null, 'body', { seg: 8 }),
    P('jaw', 'cone', [0.05, 0.16], [0, -0.01, 0.06], [PI / 2, 0, 0], 'beak', { seg: 5 }),
    P('jaw', 'cone', [0.025, 0.06], [0, -0.01, 0.15], [PI / 2, 0, 0], 'glass', { seg: 4 }),
    P('head', 'tuft', [0.08, 0.2, 0.02, -0.2], [0, 0.06, -0.08], [1.3, 0, 0], 'dark', { seg: 4 }),
  ];
  for (const s of [1, -1]) {
    const L = side(s);
    parts.push(P('head', 'sphere', [0.045, 0.035, 0.03], [s * 0.075, 0.03, 0.08], [0, s * 0.5, 0], 'glass', { seg: 5 }));
    for (let i = 0; i < 3; i++) parts.push(P('wing' + L, 'blade', [0.14, 0.62 - i * 0.12, 0.02], [s * (0.22 + i * 0.05), 0, -0.08 - i * 0.1], [PI / 2, 0, s * (-PI / 2) + s * (0.25 + i * 0.25)], i ? 'dark' : 'body'));
    for (let i = 0; i < 3; i++) parts.push(P('wing' + L + '2', 'blade', [0.12, 0.6 - i * 0.12, 0.02], [s * (0.26 + i * 0.04), 0, -0.1 - i * 0.12], [PI / 2, 0, s * (-PI / 2) + s * (0.45 + i * 0.3)], i ? 'dark' : 'body'));
    parts.push(P('leg' + L, 'cylinder', [0.018, 0.3], [0, -0.15, 0], null, 'beak', { seg: 4 }));
    parts.push(P('leg' + L, 'cone', [0.05, 0.1], [0, -0.3, 0.04], [PI / 2, 0, 0], 'beak', { seg: 4 }));
  }
  parts.push(P('tail1', 'blade', [0.16, 0.36, 0.02], [0, 0, -0.12], [PI / 2 + 0.3, 0, PI], 'dark'));
  parts.push(P('tail2', 'blade', [0.12, 0.3, 0.02], [0.06, 0, -0.1], [PI / 2 + 0.3, 0, PI - 0.4], 'body'));
  parts.push(P('tail2', 'blade', [0.12, 0.3, 0.02], [-0.06, 0, -0.1], [PI / 2 + 0.3, 0, PI + 0.4], 'body'));
  return {
    id: 'frost_harrier', rig: 'flyer', scale: 1.3, build: { height: 1.2, shoulder: 0.3, bulk: 0.5, head: 1 },
    palette: { body: CHAR.harrier, dark: 0x6e86a6, beak: 0x4a5266, glass: GLASS }, emissive: { glass: 1.5 }, parts, radius: 0.6, outline: true, face: false,
  };
}

function wisp() {
  const parts = [
    P('hips', 'sphere', [0.46, 0.5, 0.46], [0, 0, 0], null, 'body', { seg: 10 }),
    P('hips', 'cone', [0.2, 0.42], [0, 0.17, -0.17], [-0.85, 0, 0], 'body', { seg: 8 }),
    P('chest', 'sphere', [0.2, 0.2, 0.12], [0, -0.03, 0.2], null, 'core', { seg: 8, glossy: true }),
    P('head', 'sphere', [0.15, 0.1, 0.06], [0, 0.06, 0.05], null, 'eye', { seg: 6 }),
    P('head', 'sphere', [0.07, 0.07, 0.04], [0, 0.06, 0.07], null, 'pupil', { seg: 5 }),
  ];
  for (const [b1, b2] of [['tailA1', 'tailA2'], ['tailB1', 'tailB2'], ['tailC1', 'tailC2']]) {
    parts.push(P(b1, 'cone', [0.09, 0.28], [0, 0, -0.12], [-PI / 2, 0, 0], 'body', { seg: 5 }));
    parts.push(P(b2, 'cone', [0.06, 0.26], [0, 0, -0.12], [-PI / 2, 0, 0], 'tip', { seg: 5 }));
  }
  return {
    id: 'ember_wisp', rig: 'blob', scale: 0.9, build: { height: 1, shoulder: 0.5, bulk: 1, head: 1 },
    palette: { body: CHAR.wisp, tip: PALETTE.ember, core: GLASS, eye: PALETTE.oraCore, pupil: PALETTE.ink }, emissive: { body: 0.9, tip: 1.4, core: 1.8, eye: 0.6 },
    parts, radius: 0.45, outline: true, face: false,
  };
}

function bramblehorn() {
  const parts = [
    P('spine', 'lathe', [0.3, 0.36, 0.33, 0.7, 0.95], [0, 0.04, 0], [PI / 2, 0, 0], 'bark', { seg: 10 }),
    P('chest', 'sphere', [0.72, 0.7, 0.62], [0, 0.06, 0.02], null, 'bark', { seg: 10 }),
    P('hips', 'sphere', [0.56, 0.54, 0.5], [0, 0.0, 0.0], null, 'bark', { seg: 10 }),
    P('spine', 'sphere', [0.5, 0.2, 0.8], [0, 0.3, -0.05], null, 'moss', { seg: 8 }),
    P('chest', 'sphere', [0.5, 0.2, 0.42], [0, 0.32, 0], null, 'moss', { seg: 8 }),
    P('neck', 'capsule', [0.15, 0.2], [0, 0.0, 0.05], [1.2, 0, 0], 'bark', { seg: 8 }),
    P('head', 'sphere', [0.34, 0.32, 0.46], [0, -0.02, 0.1], null, 'bark', { seg: 10 }),
    P('head', 'cylinder', [0.1, 0.14, 0.09], [0, -0.08, 0.34], [PI / 2, 0, 0], 'dark', { seg: 8 }),
    P('jaw', 'box', [0.2, 0.06, 0.18], [0, 0, 0.08], null, 'dark'),
    P('tail1', 'tuft', [0.08, 0.3, 0.05, 0.1], [0, 0, 0], [-1.0, 0, 0], 'moss', { seg: 5 }),
  ];
  for (const s of [1, -1]) {
    const L = side(s);
    parts.push(P('head', 'cone', [0.035, 0.26], [s * 0.1, -0.1, 0.34], [-1.05, 0, s * -0.2], 'tusk', { seg: 5 }));
    parts.push(P('head', 'sphere', [0.06, 0.05, 0.04], [s * 0.12, 0.06, 0.22], null, 'glass', { seg: 6 }));
    // antlers: main beam sweeping out and up, tines, violet glass wraps
    parts.push(P('extra2', 'cylinder', [0.04, 0.6, 0.025], [s * 0.26, -0.02, 0], [0, 0, s * -1.05], 'bark', { seg: 6 }));
    parts.push(P('extra2', 'cylinder', [0.03, 0.5, 0.015], [s * 0.62, 0.22, -0.05], [-0.3, 0, s * -0.55], 'bark', { seg: 5 }));
    for (const [x, y, z, rz] of [[0.36, 0.18, 0.04, -0.2], [0.55, 0.36, -0.02, -0.1], [0.72, 0.36, -0.1, -0.7], [0.48, 0.05, 0.1, -1.3]]) {
      parts.push(P('extra2', 'cone', [0.026, 0.3], [s * x, y, z], [0.3, 0, s * rz], 'thorn', { seg: 4 }));
    }
    parts.push(P('extra2', 'torus', [0.05, 0.016], [s * 0.4, 0.09, 0], [0, 0, s * -1.05 + PI / 2], 'glass', { seg: 6, glossy: true }));
    parts.push(P('extra2', 'torus', [0.04, 0.014], [s * 0.66, 0.3, -0.06], [0, 0, s * -0.55 + PI / 2], 'glass', { seg: 6, glossy: true }));
    for (const fb of ['F', 'B']) {
      parts.push(P('leg' + fb + L, 'capsule', [0.1, 0.22], [0, -0.16, 0], null, 'bark', { seg: 8 }));
      parts.push(P('foot' + fb + L, 'cylinder', [0.065, 0.3, 0.075], [0, -0.17, 0], null, 'dark', { seg: 6 }));
      parts.push(P('foot' + fb + L, 'cylinder', [0.085, 0.07, 0.075], [0, -0.33, 0.01], null, 'dark', { seg: 6 }));
    }
    for (let i = 0; i < 3; i++) parts.push(P(i < 2 ? 'spine' : 'hips', 'box', [0.014, 0.05, 0.3], [s * 0.34, 0.06 - i * 0.07, 0.15 - i * 0.12], [0, 0, s * 0.2], 'glass'));
    parts.push(P('chest', 'box', [0.014, 0.05, 0.28], [s * 0.35, 0.0, 0.05], [0, 0, s * 0.25], 'glass'));
  }
  return {
    id: 'bramblehorn', rig: 'quadruped', scale: 3.4, build: { height: 1.2, shoulder: 0.42, bulk: 0.9, head: 1 },
    palette: { bark: CHAR.bark, moss: CHAR.moss, dark: 0x26221e, tusk: PALETTE.paper, glass: GLASS, thorn: 0x5a5040 },
    emissive: { glass: 1.6 }, parts, radius: 2.0, outline: true, face: false,
  };
}

function gorrumaw() {
  const parts = [
    P('spine', 'lathe', [0.3, 0.36, 0.32, 0.7, 0.9], [0, 0.0, 0], [PI / 2, 0, 0], 'skin', { seg: 10 }),
    P('chest', 'sphere', [0.7, 0.62, 0.6], [0, 0.0, 0.0], null, 'skin', { seg: 10 }),
    P('hips', 'sphere', [0.6, 0.56, 0.56], [0, 0.0, 0.0], null, 'skin', { seg: 10 }),
    P('head', 'sphere', [0.46, 0.38, 0.44], [0, -0.04, 0.12], null, 'plate', { seg: 10 }),
    P('jaw', 'sphere', [0.36, 0.14, 0.3], [0, -0.04, 0.06], null, 'skin', { seg: 8 }),
    P('tail1', 'cone', [0.14, 0.4], [0, -0.04, -0.12], [-1.4, 0, 0], 'plate', { seg: 6 }),
    P('tail2', 'cone', [0.1, 0.3], [0, -0.02, -0.1], [-1.4, 0, 0], 'plate', { seg: 6 }),
  ];
  for (let i = 0; i < 6; i++) {
    const z = 0.5 - i * 0.24;
    const bone = i < 2 ? 'chest' : i < 4 ? 'spine' : 'hips';
    const lz = bone === 'chest' ? z - 0.3 : bone === 'spine' ? z + 0.1 : z + 0.5;
    parts.push(P(bone, 'sphere', [0.84 - Math.abs(i - 2.5) * 0.06, 0.36, 0.34], [0, 0.18 + (i % 2) * 0.03, lz], [0.25, 0, 0], i % 2 ? 'plate' : 'plateDark', { seg: 8 }));
  }
  for (let i = 0; i < 7; i++) {
    const a = -1.2 + i * 0.4;
    parts.push(P('head', 'cone', [0.03, 0.12], [Math.sin(a) * 0.14, -0.13, 0.28 + Math.cos(a) * 0.04], [PI, 0, 0], 'glass', { seg: 4, glossy: true }));
  }
  for (const s of [1, -1]) {
    const L = side(s);
    parts.push(P('head', 'sphere', [0.05, 0.04, 0.03], [s * 0.15, 0.06, 0.3], null, 'glass', { seg: 5 }));
    parts.push(P('claw' + L, 'box', [0.26, 0.12, 0.3], [s * 0.04, -0.22, 0.15], [0.3, 0, 0], 'plateDark'));
    for (const fb of ['F', 'B']) {
      parts.push(P('leg' + fb + L, 'capsule', [0.12, 0.2], [s * 0.04, -0.14, 0], null, 'plate', { seg: 8 }));
      parts.push(P('foot' + fb + L, 'cylinder', [0.1, 0.3, 0.11], [0, -0.17, 0], null, 'skin', { seg: 6 }));
      parts.push(P('foot' + fb + L, 'box', [0.2, 0.08, 0.26], [0, -0.32, 0.06], null, 'plateDark'));
    }
  }
  return {
    id: 'gorrumaw', rig: 'quadruped', scale: 3.8, build: { height: 1.2, shoulder: 0.45, bulk: 1, head: 1 },
    palette: { plate: CHAR.rust, plateDark: 0x8a3e2c, skin: CHAR.paleSkin, glass: GLASS }, emissive: { glass: 1.6 }, parts, radius: 2.4, outline: true, face: false,
  };
}

/** Every actor spec, in IDS.actorSpec order. */
export function buildSpecs() {
  return [
    hero('a'), hero('b'), ...namedNpcs(),
    wisp(), boar('tusk_boar', CHAR.boarHide, false), boar('bramble_boar', CHAR.brambleHide, true), acolyte(), caster(), crab(), golem(), harrier(), vanguard(),
    durn(), bramblehorn(), gorrumaw(), iskra(), vorrhal(),
  ];
}

/** Triangle budgets (ART_UX 2.1) by spec id. */
export function budgetOf(id) {
  if (id === 'hero_a' || id === 'hero_b') return 1800;
  if (id.startsWith('npc_')) return 900;
  if (id === 'durn' || id === 'bramblehorn' || id === 'gorrumaw' || id === 'iskra' || id === 'vorrhal') return 3500;
  if (id === 'rust_golem' || id === 'choir_vanguard') return 1200;
  return 700;
}
