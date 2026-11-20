/**
 * Rigs (ARCHITECTURE 5.11, 8.4): bone names, parents and rest offsets for the five rig kinds. Every rig is built
 * from a canonical layout (humanoid: 1.8 m tall, 0.44 m shoulders) scaled by the spec's `build`; rest rotations
 * are identity, so a bone's bind position is the sum of its ancestors' offsets. Pure data and math (no three).
 * Conventions: the model faces +Z, its left is +X; limbs hang along -Y in the rest pose.
 * @module actors/logic/rigs
 */

/** Humanoid bones, fixed names and order (5.11, at most 28). The giant rig uses the same skeleton. */
export const HUMANOID_BONES = Object.freeze([
  'root', 'hips', 'spine', 'chest', 'neck', 'head', 'browL', 'browR', 'jaw',
  'shoulderL', 'armL', 'foreL', 'handL', 'shoulderR', 'armR', 'foreR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR', 'tail1', 'sash1', 'sash2', 'sash3', 'extra1',
  'eyes', 'tail2', 'tail3', 'hemL', 'hemR',
]);

/** [name, parent, x, y, z] canonical rest offsets (metres for a 1.8 m, 0.44 m-shoulder humanoid). */
const HUMANOID_LAYOUT = [
  ['root', null, 0, 0, 0], ['hips', 'root', 0, 0.92, 0], ['spine', 'hips', 0, 0.1, 0], ['chest', 'spine', 0, 0.2, 0],
  ['neck', 'chest', 0, 0.24, 0], ['head', 'neck', 0, 0.08, 0],
  ['browL', 'head', 0.045, 0.165, 0.105], ['browR', 'head', -0.045, 0.165, 0.105], ['jaw', 'head', 0, 0.055, 0.06],
  ['shoulderL', 'chest', 0.05, 0.19, 0], ['armL', 'shoulderL', 0.15, 0, 0], ['foreL', 'armL', 0, -0.29, 0], ['handL', 'foreL', 0, -0.26, 0],
  ['shoulderR', 'chest', -0.05, 0.19, 0], ['armR', 'shoulderR', -0.15, 0, 0], ['foreR', 'armR', 0, -0.29, 0], ['handR', 'foreR', 0, -0.26, 0],
  ['thighL', 'hips', 0.1, -0.04, 0], ['shinL', 'thighL', 0, -0.4, 0], ['footL', 'shinL', 0, -0.4, 0],
  ['thighR', 'hips', -0.1, -0.04, 0], ['shinR', 'thighR', 0, -0.4, 0], ['footR', 'shinR', 0, -0.4, 0],
  ['tail1', 'head', 0, 0.045, -0.115], ['sash1', 'chest', 0.13, 0.17, -0.11], ['sash2', 'sash1', 0, -0.17, 0], ['sash3', 'sash2', 0, -0.17, 0],
  ['extra1', 'chest', 0, 0.12, -0.15],
  // eyes: the eye shapes of a face (scaled flat for a blink); a three-bone hair tail tied at the nape; the two
  // flaps of a split back hem (coats, capes, robe strips)
  ['eyes', 'head', 0, 0.11, 0.1], ['tail2', 'tail1', 0, -0.13, -0.01], ['tail3', 'tail2', 0, -0.13, 0],
  ['hemL', 'hips', 0.08, -0.06, -0.12], ['hemR', 'hips', -0.08, -0.06, -0.12],
];

/** Quadruped (boars, crab, Bramblehorn, Gorrumaw): canonical 1.2 m at the back, body along +Z. */
const QUAD_LAYOUT = [
  ['root', null, 0, 0, 0], ['hips', 'root', 0, 0.78, -0.42], ['spine', 'hips', 0, 0.04, 0.36], ['chest', 'spine', 0, 0.04, 0.4],
  ['neck', 'chest', 0, 0.08, 0.2], ['head', 'neck', 0, 0.02, 0.2], ['jaw', 'head', 0, -0.1, 0.12],
  ['legFL', 'chest', 0.2, -0.14, 0.04], ['footFL', 'legFL', 0, -0.34, 0], ['legFR', 'chest', -0.2, -0.14, 0.04], ['footFR', 'legFR', 0, -0.34, 0],
  ['legBL', 'hips', 0.2, -0.08, -0.02], ['footBL', 'legBL', 0, -0.36, 0], ['legBR', 'hips', -0.2, -0.08, -0.02], ['footBR', 'legBR', 0, -0.36, 0],
  ['tail1', 'hips', 0, 0.06, -0.24], ['tail2', 'tail1', 0, 0, -0.2], ['clawL', 'chest', 0.3, -0.05, 0.3], ['clawR', 'chest', -0.3, -0.05, 0.3],
  ['extra1', 'chest', 0, 0.3, -0.1], ['extra2', 'head', 0, 0.2, 0],
  ['earL', 'head', 0.12, 0.15, -0.02], ['earR', 'head', -0.12, 0.15, -0.02], ['tail3', 'tail2', 0, 0, -0.18],
];

/** Flyer (Frost Harrier): canonical body 1.2 m above the feet, wings along +-X. */
const FLYER_LAYOUT = [
  ['root', null, 0, 0, 0], ['hips', 'root', 0, 0.55, 0], ['chest', 'hips', 0, 0.08, 0.18], ['neck', 'chest', 0, 0.1, 0.16],
  ['head', 'neck', 0, 0.08, 0.1], ['jaw', 'head', 0, 0, 0.12],
  ['wingL', 'chest', 0.14, 0.06, 0], ['wingL2', 'wingL', 0.5, 0, 0], ['wingR', 'chest', -0.14, 0.06, 0], ['wingR2', 'wingR', -0.5, 0, 0],
  ['tail1', 'hips', 0, 0, -0.22], ['tail2', 'tail1', 0, 0, -0.22], ['legL', 'hips', 0.08, -0.06, 0.02], ['legR', 'hips', -0.08, -0.06, 0.02],
  ['extra1', 'chest', 0, 0.1, -0.05],
];

/** Blob (Ember Wisp): a floating body with three trailing tails. */
const BLOB_LAYOUT = [
  ['root', null, 0, 0, 0], ['hips', 'root', 0, 0.55, 0], ['chest', 'hips', 0, 0, 0], ['head', 'hips', 0, 0.06, 0.18],
  ['tailA1', 'hips', 0, 0.02, -0.2], ['tailA2', 'tailA1', 0, 0, -0.24],
  ['tailB1', 'hips', 0.12, -0.04, -0.16], ['tailB2', 'tailB1', 0, 0, -0.22],
  ['tailC1', 'hips', -0.12, -0.04, -0.16], ['tailC2', 'tailC1', 0, 0, -0.22],
];

/** @type {Record<string, any[]>} */
const LAYOUTS = { humanoid: HUMANOID_LAYOUT, giant: HUMANOID_LAYOUT, quadruped: QUAD_LAYOUT, flyer: FLYER_LAYOUT, blob: BLOB_LAYOUT };

/** Canonical size of each rig: [height, shoulder] for the build ratios. */
const CANON = { humanoid: [1.8, 0.44], giant: [1.8, 0.44], quadruped: [1.2, 0.4], flyer: [1.2, 0.3], blob: [1, 0.5] };

export const RIG_KINDS = Object.freeze(['humanoid', 'quadruped', 'flyer', 'blob', 'giant']);
/** Bones per rig (5.11 said 28; the spring chains and the blink added a few, the bone texture has room). */
export const MAX_BONES = 34;

/** Spring chains per rig (bone names), used when a spec has no `chains`. */
export const DEFAULT_CHAINS = Object.freeze({
  humanoid: [
    { bones: ['sash1', 'sash2', 'sash3'], kind: 'cloth', stiffness: 38, damping: 6 },
    { bones: ['tail1', 'tail2', 'tail3'], kind: 'hair', stiffness: 60, damping: 7 },
    { bones: ['hemL'], kind: 'hem', stiffness: 70, damping: 8 }, { bones: ['hemR'], kind: 'hem', stiffness: 74, damping: 8 },
  ],
  giant: [],
  quadruped: [
    { bones: ['tail1', 'tail2', 'tail3'], kind: 'tail', stiffness: 55, damping: 6 },
    { bones: ['earL'], kind: 'ear', stiffness: 120, damping: 9 }, { bones: ['earR'], kind: 'ear', stiffness: 125, damping: 9 },
  ],
  flyer: [{ bones: ['tail1', 'tail2'], kind: 'tail', stiffness: 60, damping: 7 }],
  blob: [
    { bones: ['tailA1', 'tailA2'], kind: 'ribbon', stiffness: 25, damping: 4 }, { bones: ['tailB1', 'tailB2'], kind: 'ribbon', stiffness: 28, damping: 4 },
    { bones: ['tailC1', 'tailC2'], kind: 'ribbon', stiffness: 31, damping: 4 },
  ],
});

/** @param {string} rig @returns {string[]} bone names of a rig */
export function boneNames(rig) {
  const L = LAYOUTS[rig] || HUMANOID_LAYOUT;
  return L.map((b) => b[0]);
}

/** @param {string} rig @returns {boolean} */
export function isRig(rig) {
  return Object.prototype.hasOwnProperty.call(LAYOUTS, rig);
}

/**
 * Scale factors of a build relative to its rig's canonical layout.
 * @param {string} rig @param {{ height?:number, shoulder?:number }} [build]
 * @returns {{ sx:number, sy:number }}
 */
export function buildScale(rig, build) {
  const c = CANON[rig] || CANON.humanoid;
  const b = build || {};
  const sy = (typeof b.height === 'number' && b.height > 0 ? b.height : c[0]) / c[0];
  const sx = (typeof b.shoulder === 'number' && b.shoulder > 0 ? b.shoulder : c[1]) / c[1];
  return { sx, sy };
}

/**
 * Skeleton of a rig for a build (unscaled by spec.scale).
 * @param {string} rig @param {{ height?:number, shoulder?:number }} [build] @param {number} [scale]
 * @returns {{ names:string[], parent:Int8Array, rest:Float32Array, world:Float32Array }} rest = local offsets, world = bind positions
 */
export function skeleton(rig, build, scale = 1) {
  const L = LAYOUTS[rig] || HUMANOID_LAYOUT;
  const { sx, sy } = buildScale(rig, build);
  const n = L.length;
  const names = L.map((b) => b[0]);
  const parent = new Int8Array(n);
  const rest = new Float32Array(n * 3);
  const world = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const b = L[i];
    const p = b[1] === null ? -1 : names.indexOf(b[1]);
    parent[i] = p;
    rest[i * 3] = b[2] * sx * scale;
    rest[i * 3 + 1] = b[3] * sy * scale;
    rest[i * 3 + 2] = b[4] * sy * scale;
    for (let k = 0; k < 3; k++) world[i * 3 + k] = rest[i * 3 + k] + (p >= 0 ? world[p * 3 + k] : 0);
  }
  return { names, parent, rest, world };
}

/**
 * Canonical bone length helpers for part generators (unscaled metres of a build).
 * @param {string} rig @param {object} build @param {string} name @returns {number[]} [x, y, z] bind position
 */
export function bindPos(rig, build, name) {
  const s = skeleton(rig, build, 1);
  const i = s.names.indexOf(name);
  return i < 0 ? [0, 0, 0] : [s.world[i * 3], s.world[i * 3 + 1], s.world[i * 3 + 2]];
}

/** Bones driven by the 'upper' layer, per rig. */
export const UPPER = Object.freeze({
  humanoid: ['spine', 'chest', 'neck', 'head', 'shoulderL', 'armL', 'foreL', 'handL', 'shoulderR', 'armR', 'foreR', 'handR'],
  giant: ['spine', 'chest', 'neck', 'head', 'shoulderL', 'armL', 'foreL', 'handL', 'shoulderR', 'armR', 'foreR', 'handR'],
  quadruped: ['neck', 'head', 'jaw', 'clawL', 'clawR'],
  flyer: ['neck', 'head', 'jaw', 'wingL', 'wingL2', 'wingR', 'wingR2'],
  blob: ['head'],
});

/** Socket -> bone name per rig (4.5 sockets). 'feet' is the root. */
export const SOCKETS = Object.freeze({
  humanoid: { handR: 'handR', handL: 'handL', chest: 'chest', head: 'head', feet: 'root', back: 'extra1' },
  giant: { handR: 'handR', handL: 'handL', chest: 'chest', head: 'head', feet: 'root', back: 'extra1' },
  quadruped: { handR: 'jaw', handL: 'jaw', chest: 'chest', head: 'head', feet: 'root', back: 'extra1' },
  flyer: { handR: 'jaw', handL: 'jaw', chest: 'chest', head: 'head', feet: 'root', back: 'extra1' },
  blob: { handR: 'head', handL: 'head', chest: 'chest', head: 'head', feet: 'root', back: 'tailA1' },
});

/** Socket offsets in the bone's local frame (unscaled metres), applied after the bone transform. */
export const SOCKET_OFFSET = Object.freeze({
  humanoid: { handR: [0, -0.06, 0.02], handL: [0, -0.06, 0.02], chest: [0, 0.08, 0.08], head: [0, 0.14, 0], feet: [0, 0, 0], back: [0, 0, -0.04] },
  quadruped: { handR: [0, 0, 0.12], handL: [0, 0, 0.12], chest: [0, 0, 0], head: [0, 0.05, 0.1], feet: [0, 0, 0], back: [0, 0, 0] },
  flyer: { handR: [0, 0, 0.08], handL: [0, 0, 0.08], chest: [0, 0, 0], head: [0, 0, 0], feet: [0, 0, 0], back: [0, 0, 0] },
  blob: { handR: [0, 0, 0.05], handL: [0, 0, 0.05], chest: [0, 0, 0], head: [0, 0, 0], feet: [0, 0, 0], back: [0, 0, 0] },
});
