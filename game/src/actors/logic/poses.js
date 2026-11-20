/**
 * Pose library (ARCHITECTURE 8.4): named key poses per rig family, authored as sparse Euler rotations per bone
 * (radians, order XYZ) plus `_off` (hips offset, metres for the canonical build) and `_scl` (hips scale, for
 * squash and stretch). Poses compile into flat Float32Arrays: [bones x 3 rotations][3 offset][3 scale].
 * Conventions (model faces +Z, left is +X): a limb hanging down swings forward with -x; knees bend with +x;
 * elbows bend with -x; the chest leans forward with +x and turns toward its left with +y; armL lifts sideways
 * with +z and armR with -z. Mirroring swaps L and R and negates y and z. Pure data (no three).
 * @module actors/logic/poses
 */

import { boneNames } from './rigs.js';

/** Extra floats after the bone rotations: offset xyz, scale xyz. */
export const POSE_EXTRA = 6;

/** @param {string} rig @returns {string} pose and clip family of a rig */
export function family(rig) {
  return rig === 'giant' ? 'humanoid' : rig === 'quadruped' || rig === 'flyer' || rig === 'blob' ? rig : 'humanoid';
}

/** @param {Record<string, number[]>} p @returns {Record<string, number[]>} the left-right mirror of a pose */
export function mirror(p) {
  /** @type {Record<string, number[]>} */
  const out = {};
  for (const k of Object.keys(p)) {
    const v = p[k];
    let name = k;
    if (/L(\d?)$/.test(k) && k !== '_scl') name = k.replace(/L(\d?)$/, 'R$1');
    else if (/R(\d?)$/.test(k)) name = k.replace(/R(\d?)$/, 'L$1');
    if (k === '_scl') out[k] = v.slice();
    else if (k === '_off') out[k] = [-(v[0] || 0), v[1] || 0, v[2] || 0];
    else out[name] = [v[0] || 0, -(v[1] || 0), -(v[2] || 0)];
  }
  return out;
}

/** @param {...Record<string, number[]>} ps @returns {Record<string, number[]>} later poses override earlier bones */
function mix(...ps) {
  return Object.assign({}, ...ps);
}

// ---------------------------------------------------------------- humanoid (and giant)
const LEGS_READY = {
  thighL: [-0.38, 0, 0.12], shinL: [0.48, 0, 0], footL: [-0.1, 0, 0], thighR: [0.22, 0, -0.14], shinR: [0.36, 0, 0], footR: [-0.1, 0, 0],
  hips: [0, -0.25, 0], _off: [0, -0.07, 0],
};
const IDLE = {
  hips: [0, -0.18, 0.05], _off: [0.014, -0.012, 0], spine: [0.02, 0.06, -0.03], chest: [-0.02, 0.1, -0.02], head: [0.05, 0.05, 0.03],
  thighL: [-0.16, 0.18, 0.12], shinL: [0.26, 0, 0], footL: [-0.08, 0.25, -0.06], thighR: [0.04, -0.06, -0.08], shinR: [0.04, 0, 0], footR: [0, -0.12, 0.03],
  armL: [0.08, 0.1, 0.2], foreL: [-0.35, 0, 0], handL: [-0.1, 0, 0.05], armR: [0.02, -0.1, -0.24], foreR: [-0.45, 0, 0], handR: [-0.15, 0, 0],
};
const READY = mix(LEGS_READY, {
  spine: [0.05, 0, 0], chest: [0.1, 0.2, 0], head: [0, 0.05, 0],
  armL: [-0.95, 0, 0.3], foreL: [-1.55, 0, 0], armR: [-0.55, 0, -0.35], foreR: [-1.95, 0, 0],
});
const WALK_C = {
  thighL: [-0.45, 0, 0.02], shinL: [0.1, 0, 0], footL: [-0.2, 0, 0], thighR: [0.32, 0, -0.02], shinR: [0.28, 0, 0], footR: [0.28, 0, 0],
  armL: [0.35, 0, 0.1], foreL: [-0.18, 0, 0], armR: [-0.38, 0, -0.1], foreR: [-0.5, 0, 0],
  spine: [0.04, 0, 0], chest: [0.04, 0.1, 0], head: [0, -0.08, 0], hips: [0, -0.08, 0], _off: [0, -0.03, 0],
};
const WALK_P = {
  thighL: [0.02, 0, 0.02], shinL: [0.06, 0, 0], footL: [0, 0, 0], thighR: [-0.28, 0, -0.02], shinR: [0.65, 0, 0], footR: [0.2, 0, 0],
  armL: [0.05, 0, 0.1], foreL: [-0.2, 0, 0], armR: [-0.05, 0, -0.1], foreR: [-0.3, 0, 0],
  spine: [0.04, 0, 0], chest: [0.04, 0, 0], _off: [0, 0.015, 0],
};
const RUN_C = {
  thighL: [-1.0, 0, 0.04], shinL: [0.35, 0, 0], footL: [-0.2, 0, 0], thighR: [0.62, 0, -0.04], shinR: [1.05, 0, 0], footR: [0.5, 0, 0],
  armL: [0.7, 0, 0.2], foreL: [-1.05, 0, 0], armR: [-0.95, 0, -0.12], foreR: [-1.55, 0, 0], handR: [-0.2, 0, 0],
  spine: [0.16, 0.08, 0], chest: [0.18, 0.22, 0], neck: [-0.06, 0, 0], head: [-0.16, -0.18, 0], hips: [0.08, -0.18, 0], _off: [0, -0.07, 0],
};
const RUN_P = {
  thighL: [-0.1, 0, 0.04], shinL: [0.5, 0, 0], footL: [0.1, 0, 0], thighR: [-0.62, 0, -0.04], shinR: [1.9, 0, 0], footR: [0.5, 0, 0],
  armL: [0.12, 0, 0.2], foreL: [-1.35, 0, 0], armR: [-0.18, 0, -0.18], foreR: [-1.4, 0, 0],
  spine: [0.16, 0, 0], chest: [0.18, 0, 0], neck: [-0.06, 0, 0], head: [-0.16, 0, 0], hips: [0.08, 0, 0], _off: [0, 0.07, 0],
};
const SPRINT_C = {
  thighL: [-1.2, 0, 0.04], shinL: [0.45, 0, 0], footL: [-0.15, 0, 0], thighR: [0.72, 0, -0.04], shinR: [1.25, 0, 0], footR: [0.6, 0, 0],
  armL: [1.0, 0, 0.16], foreL: [-0.95, 0, 0], armR: [-1.25, 0, -0.1], foreR: [-1.7, 0, 0], handR: [-0.25, 0, 0],
  spine: [0.26, 0.1, 0], chest: [0.28, 0.26, 0], neck: [-0.12, 0, 0], head: [-0.3, -0.2, 0], hips: [0.12, -0.2, 0], _off: [0, -0.1, 0],
};
const SPRINT_P = {
  thighL: [-0.12, 0, 0.04], shinL: [0.6, 0, 0], thighR: [-0.78, 0, -0.04], shinR: [2.05, 0, 0], footR: [0.55, 0, 0],
  armL: [0.2, 0, 0.16], foreL: [-1.4, 0, 0], armR: [-0.25, 0, -0.16], foreR: [-1.45, 0, 0],
  spine: [0.26, 0, 0], chest: [0.28, 0, 0], neck: [-0.12, 0, 0], head: [-0.3, 0, 0], hips: [0.12, 0, 0], _off: [0, 0.06, 0],
};
const FLY_HOVER = {
  hips: [0.12, 0, 0], thighL: [-0.4, 0, 0.06], shinL: [0.75, 0, 0], footL: [0.55, 0, 0], thighR: [-0.08, 0, -0.06], shinR: [0.35, 0, 0], footR: [0.6, 0, 0],
  armL: [0.15, 0, 0.42], foreL: [-0.4, 0, 0], armR: [0.15, 0, -0.42], foreR: [-0.4, 0, 0], chest: [-0.02, 0, 0], head: [-0.1, 0, 0],
};
const FLY_CRUISE = {
  hips: [1.2, 0, 0], spine: [-0.08, 0, 0], chest: [-0.1, 0, 0], neck: [-0.4, 0, 0], head: [-0.5, 0, 0],
  thighL: [0.0, 0, 0.06], shinL: [0.45, 0, 0], footL: [0.7, 0, 0], thighR: [0.15, 0, -0.06], shinR: [0.7, 0, 0], footR: [0.7, 0, 0],
  armL: [0.75, 0, 0.32], foreL: [-0.35, 0, 0], armR: [0.7, 0, -0.32], foreR: [-0.4, 0, 0], _off: [0, 0.1, 0],
};
const FLY_BOOST = {
  hips: [1.42, 0, 0], spine: [-0.05, 0, 0], chest: [-0.08, 0, 0], neck: [-0.45, 0, 0], head: [-0.75, 0, 0],
  thighL: [0.02, 0, 0.05], shinL: [0.12, 0, 0], footL: [0.85, 0, 0], thighR: [0.1, 0, -0.05], shinR: [0.2, 0, 0], footR: [0.85, 0, 0],
  armL: [0.12, 0, 0.24], foreL: [-0.05, 0, 0], armR: [0.12, 0, -0.24], foreR: [-0.05, 0, 0], _off: [0, 0.12, 0],
};
const SWIM_A = {
  hips: [1.15, 0, 0], neck: [-0.5, 0, 0], head: [-0.6, 0, 0], armL: [-2.8, 0, 0.25], foreL: [-0.2, 0, 0], armR: [0.5, 0, -0.25], foreR: [-0.4, 0, 0],
  thighL: [-0.25, 0, 0.05], shinL: [0.35, 0, 0], thighR: [0.2, 0, -0.05], shinR: [0.2, 0, 0], footL: [0.7, 0, 0], footR: [0.7, 0, 0], _off: [0, -0.6, 0],
};
const FALL = {
  thighL: [-0.55, 0, 0.18], shinL: [0.95, 0, 0], thighR: [-0.12, 0, -0.12], shinR: [0.55, 0, 0], footL: [0.3, 0, 0], footR: [0.4, 0, 0],
  armL: [-0.35, 0, 1.15], foreL: [-0.55, 0, 0], armR: [-0.25, 0, -1.05], foreR: [-0.45, 0, 0], chest: [0.06, 0, 0], head: [0.12, 0, 0],
};
const DOWN = {
  hips: [-1.45, 0, 0.05], _off: [0, -0.8, -0.2], thighL: [-0.25, 0, 0.18], shinL: [0.35, 0, 0], thighR: [0.08, 0, -0.22], shinR: [0.15, 0, 0],
  armL: [0.25, 0, 1.25], foreL: [-0.3, 0, 0], armR: [-0.15, 0, -0.95], foreR: [-0.6, 0, 0], head: [0.15, 0.5, 0], chest: [0, 0.1, 0],
};
const KNEEL = {
  _off: [0, -0.42, 0], hips: [0.15, 0, 0], thighL: [-1.55, 0, 0.12], shinL: [1.55, 0, 0], footL: [-0.1, 0, 0], thighR: [-0.1, 0, -0.1], shinR: [2.2, 0, 0], footR: [0.6, 0, 0],
  chest: [0.35, 0, 0], head: [0.2, 0, 0], armL: [-0.5, 0, 0.2], foreL: [-0.9, 0, 0], armR: [-0.2, 0, -0.25], foreR: [-0.4, 0, 0],
};
const GUARD = mix(LEGS_READY, {
  _off: [0, -0.1, 0], spine: [0.1, 0, 0], chest: [0.18, 0.05, 0], head: [0.15, 0, 0],
  armL: [-1.25, 0, -0.2], foreL: [-1.65, 0.2, 0], armR: [-1.15, 0, 0.25], foreR: [-1.75, -0.2, 0],
});
const GATHER = {
  _off: [0, -0.24, 0], hips: [-0.05, 0, 0], thighL: [-0.55, 0, 0.5], shinL: [0.95, 0, 0], footL: [-0.35, 0, -0.35], thighR: [-0.55, 0, -0.5], shinR: [0.95, 0, 0], footR: [-0.35, 0, 0.35],
  armL: [0.4, 0, 0.55], foreL: [-1.75, 0.3, 0], handL: [0, 0, -0.2], armR: [0.4, 0, -0.55], foreR: [-1.75, -0.3, 0], handR: [0, 0, 0.2],
  spine: [-0.06, 0, 0], chest: [-0.2, 0, 0], neck: [-0.1, 0, 0], head: [-0.2, 0, 0], shoulderL: [0, 0, 0.12], shoulderR: [0, 0, -0.12],
};
const CURL = {
  _off: [0, -0.22, 0], spine: [0.3, 0, 0], chest: [0.45, 0, 0], head: [0.35, 0, 0], thighL: [-0.85, 0, 0.15], shinL: [1.1, 0, 0], thighR: [-0.85, 0, -0.15], shinR: [1.1, 0, 0],
  armL: [-1.1, 0, -0.45], foreL: [-1.9, 0, 0], armR: [-1.1, 0, 0.45], foreR: [-1.9, 0, 0], footL: [-0.3, 0, 0], footR: [-0.3, 0, 0],
};
const BURST = {
  _off: [0, 0.04, 0], spine: [-0.15, 0, 0], chest: [-0.35, 0, 0], head: [-0.45, 0, 0], thighL: [-0.15, 0, 0.32], shinL: [0.2, 0, 0], thighR: [-0.15, 0, -0.32], shinR: [0.2, 0, 0],
  armL: [-0.45, 0, 1.45], foreL: [-0.1, 0, 0], armR: [-0.45, 0, -1.45], foreR: [-0.1, 0, 0], footL: [0.3, 0, 0], footR: [0.3, 0, 0],
};

/** @type {Record<string, Record<string, number[]>>} */
const HUMANOID = {
  rest: {},
  idle: IDLE,
  idle_b: mix(IDLE, {
    spine: [0.0, 0.05, -0.02], chest: [-0.05, 0.08, -0.02], head: [0.02, 0.04, 0.03], shoulderL: [0, 0, 0.06], shoulderR: [0, 0, -0.06],
    armL: [0.06, 0.1, 0.24], armR: [0.0, -0.1, -0.28], foreL: [-0.32, 0, 0], foreR: [-0.42, 0, 0], _off: [0.012, -0.004, 0],
  }),
  idle_c: mix(IDLE, {
    hips: [0, -0.16, 0.03], _off: [0.006, -0.01, 0], spine: [0.03, 0.08, -0.01], chest: [0.0, 0.14, -0.01], head: [0.05, 0.22, 0.02],
    armR: [0.05, -0.08, -0.2], foreR: [-0.55, 0, 0], handR: [-0.25, 0, 0],
  }),
  ready: READY,
  walk_c: WALK_C, walk_p: WALK_P, walk_c2: mirror(WALK_C), walk_p2: mirror(WALK_P),
  run_c: RUN_C, run_p: RUN_P, run_c2: mirror(RUN_C), run_p2: mirror(RUN_P),
  sprint_c: SPRINT_C, sprint_p: SPRINT_P, sprint_c2: mirror(SPRINT_C), sprint_p2: mirror(SPRINT_P),
  jump: {
    thighL: [-1.0, 0, 0.1], shinL: [1.35, 0, 0], footL: [0.35, 0, 0], thighR: [-0.45, 0, -0.08], shinR: [1.1, 0, 0], footR: [0.5, 0, 0],
    armL: [-1.5, 0, 0.4], foreL: [-0.55, 0, 0], armR: [-1.25, 0, -0.45], foreR: [-0.7, 0, 0], spine: [-0.05, 0, 0], chest: [-0.12, 0, 0], head: [-0.15, 0, 0],
  },
  fall: FALL,
  fall_b: mix(FALL, { armL: [-0.5, 0, 1.25], armR: [-0.1, 0, -1.2], thighL: [-0.45, 0, 0.2], thighR: [-0.25, 0, -0.1] }),
  land: {
    _off: [0, -0.28, 0], thighL: [-1.05, 0, 0.18], shinL: [1.65, 0, 0], footL: [-0.55, 0, 0], thighR: [-0.6, 0, -0.18], shinR: [1.45, 0, 0], footR: [-0.75, 0, 0],
    spine: [0.2, 0, 0], chest: [0.35, 0, 0], head: [-0.35, 0, 0], armL: [-0.45, 0, 0.55], foreL: [-0.6, 0, 0], armR: [0.45, 0, -0.65], foreR: [-0.3, 0, 0],
  },
  fly_hover: FLY_HOVER,
  fly_hover_b: mix(FLY_HOVER, { thighL: [-0.3, 0, 0.06], shinL: [0.6, 0, 0], thighR: [-0.16, 0, -0.06], shinR: [0.5, 0, 0], armL: [0.1, 0, 0.5], armR: [0.1, 0, -0.5], _off: [0, 0.03, 0] }),
  fly_cruise: FLY_CRUISE,
  fly_cruise_b: mix(FLY_CRUISE, { thighL: [0.12, 0, 0.06], shinL: [0.7, 0, 0], thighR: [0.02, 0, -0.06], shinR: [0.45, 0, 0], armL: [0.8, 0, 0.38], armR: [0.65, 0, -0.28] }),
  fly_boost: FLY_BOOST,
  fly_boost_b: mix(FLY_BOOST, { thighL: [0.08, 0, 0.05], thighR: [0.04, 0, -0.05], head: [-0.72, 0.04, 0] }),
  swim_a: SWIM_A, swim_b: mirror(SWIM_A),
  hurtle: {
    thighL: [-1.65, 0, 0.1], shinL: [2.1, 0, 0], thighR: [-1.55, 0, -0.1], shinR: [2.1, 0, 0], spine: [0.4, 0, 0], chest: [0.6, 0, 0], head: [0.5, 0, 0],
    armL: [-1.0, 0, 0.3], foreL: [-1.7, 0, 0], armR: [-1.0, 0, -0.3], foreR: [-1.7, 0, 0], _off: [0, 0.1, 0],
  },
  stagger: {
    spine: [-0.2, 0, 0], chest: [-0.45, 0.25, 0.05], head: [-0.35, -0.2, 0], armL: [0.35, 0, 0.85], foreL: [-0.6, 0, 0], armR: [0.25, 0, -0.95], foreR: [-0.3, 0, 0],
    thighL: [-0.45, 0, 0.1], shinL: [0.55, 0, 0], thighR: [0.4, 0, -0.1], shinR: [0.2, 0, 0], footL: [-0.2, 0, 0], _off: [0, -0.06, -0.1],
  },
  down: DOWN,
  kneel: KNEEL,
  ko: mix(DOWN, { head: [0.3, 0.9, 0], armL: [0.1, 0, 1.45], armR: [0.05, 0, -1.4], foreL: [-0.1, 0, 0] }),
  guard: GUARD,
  guard_b: mix(GUARD, { _off: [0, -0.12, 0], chest: [0.22, 0.05, 0] }),
  gather: GATHER,
  gather_b: mix(GATHER, { chest: [-0.28, 0, 0], head: [-0.3, 0, 0], armL: [0.5, 0, 0.68], armR: [0.5, 0, -0.68], shoulderL: [0, 0, 0.2], shoulderR: [0, 0, -0.2], _off: [0, -0.27, 0] }),
  curl: CURL,
  burst: BURST,
  // Ember: fists driven down and out, chest thrown up, head back (the body lights like a lantern)
  burst_ember: mix(BURST, { armL: [0.15, 0, 0.75], foreL: [-0.35, 0, 0], armR: [0.15, 0, -0.75], foreR: [-0.35, 0, 0], chest: [-0.4, 0, 0], head: [-0.5, 0, 0],
    thighL: [-0.35, 0, 0.42], shinL: [0.55, 0, 0], thighR: [-0.35, 0, -0.42], shinR: [0.55, 0, 0], _off: [0, -0.1, 0], shoulderL: [0, 0, 0.15], shoulderR: [0, 0, -0.15] }),
  // Tempest: one arm sweeps out wide and the body twists into the wind, weight on the toes
  burst_tempest: mix(BURST, { hips: [0, 0.35, 0], chest: [-0.2, -0.55, 0.1], head: [-0.25, 0.45, 0], armL: [-0.3, 0, 1.55], foreL: [-0.2, 0, 0],
    armR: [0.6, 0, -0.5], foreR: [-1.2, 0, 0], thighL: [-0.4, 0, 0.2], shinL: [0.45, 0, 0], thighR: [0.25, 0, -0.25], shinR: [0.35, 0, 0], footR: [0.6, 0, 0], _off: [0, 0.02, 0] }),
  // Zenith: rising on the toes, arms raised in a wide V with open palms, head lifted, calm
  burst_zenith: mix(BURST, { armL: [-0.3, 0, 2.35], foreL: [-0.15, 0, 0], handL: [0.4, 0, 0], armR: [-0.3, 0, -2.35], foreR: [-0.15, 0, 0], handR: [0.4, 0, 0],
    chest: [-0.15, 0, 0], head: [-0.35, 0, 0], thighL: [-0.05, 0, 0.1], thighR: [-0.05, 0, -0.1], shinL: [0.05, 0, 0], shinR: [0.05, 0, 0], footL: [0.5, 0, 0], footR: [0.5, 0, 0], _off: [0, 0.07, 0] }),
  flicker: {
    _off: [0, -0.22, 0], hips: [0.35, 0, 0], spine: [0.2, 0, 0], chest: [0.35, 0, 0], head: [-0.6, 0, 0],
    armL: [1.1, 0, 0.3], foreL: [-0.1, 0, 0], armR: [1.1, 0, -0.3], foreR: [-0.1, 0, 0], thighL: [-1.05, 0, 0.1], shinL: [1.3, 0, 0], thighR: [0.45, 0, -0.1], shinR: [0.75, 0, 0],
  },
  // Strike String
  jab_wind: mix(READY, { chest: [0.1, 0.4, 0], armL: [-0.7, 0, 0.35], foreL: [-1.9, 0, 0], _off: [0, -0.09, -0.02] }),
  jab_hit: mix(READY, { chest: [0.12, -0.5, 0], head: [0, 0.3, 0], armL: [-1.55, 0, 0.02], foreL: [-0.05, 0, 0], thighL: [-0.55, 0, 0.12], shinL: [0.55, 0, 0], _off: [0, -0.1, 0.06] }),
  cross_wind: mix(READY, { chest: [0.1, -0.35, 0], armR: [-0.3, 0, -0.4], foreR: [-2.1, 0, 0] }),
  cross_hit: mix(READY, {
    hips: [0, 0.2, 0], chest: [0.15, 0.6, 0], head: [0, -0.4, 0], armR: [-1.55, 0, -0.02], foreR: [-0.05, 0, 0], armL: [-0.6, 0, 0.45], foreL: [-1.9, 0, 0],
    thighR: [0.45, 0, -0.12], shinR: [0.15, 0, 0], footR: [0.4, 0, 0], _off: [0, -0.1, 0.08],
  }),
  hook_wind: mix(READY, { hips: [0, 0.15, 0], chest: [0.12, 0.7, 0], head: [0, -0.3, 0], armL: [-0.2, 0.3, 1.25], foreL: [-1.7, 0, 0], _off: [0, -0.12, -0.02] }),
  hook_hit: mix(READY, { hips: [0, -0.45, 0], spine: [0.12, -0.2, 0], chest: [0.18, -0.85, 0.05], head: [0, 0.6, 0], armL: [0, -0.55, 1.35], foreL: [-1.6, 0, 0],
    armR: [-0.4, 0, -0.5], foreR: [-2.0, 0, 0], thighL: [-0.6, 0, 0.14], shinL: [0.65, 0, 0], thighR: [0.35, 0, -0.16], shinR: [0.45, 0, 0], footR: [0.5, 0, 0], _off: [0, -0.14, 0.07] }),
  kick_wind: mix(READY, { thighR: [-1.2, 0, -0.35], shinR: [1.9, 0, 0], chest: [-0.1, 0.35, 0.1], armL: [-0.6, 0, 0.7], armR: [0.2, 0, -0.6] }),
  kick_hit: {
    hips: [0, 0.6, 0.3], spine: [-0.1, 0, 0], chest: [-0.2, 0.45, -0.25], head: [0.1, -0.6, 0.2],
    thighR: [-1.45, 0, -0.75], shinR: [0.12, 0, 0], footR: [0.7, 0, 0], thighL: [-0.12, 0, 0.12], shinL: [0.22, 0, 0], footL: [0, 0, 0],
    armL: [-0.5, 0, 0.95], foreL: [-0.9, 0, 0], armR: [0.45, 0, -0.85], foreR: [-0.5, 0, 0], _off: [0, -0.02, 0],
  },
  upper_wind: mix(READY, { _off: [0, -0.2, 0], chest: [0.35, 0.3, 0], armR: [0.3, 0, -0.2], foreR: [-1.7, 0, 0], thighL: [-0.7, 0, 0.12], shinL: [0.95, 0, 0], thighR: [0.2, 0, -0.14], shinR: [0.8, 0, 0] }),
  upper_hit: {
    _off: [0, 0.12, 0.05], spine: [-0.12, 0, 0], chest: [-0.28, 0.35, 0], head: [-0.25, -0.2, 0],
    armR: [-2.7, 0, -0.12], foreR: [-0.55, 0, 0], armL: [0.3, 0, 0.5], foreL: [-1.6, 0, 0],
    thighL: [-0.65, 0, 0.1], shinL: [0.65, 0, 0], thighR: [0.3, 0, -0.1], shinR: [0.25, 0, 0], footR: [0.6, 0, 0],
  },
  palm_wind: mix(READY, { _off: [0, -0.2, -0.04], hips: [0, 1.1, 0], chest: [0.2, 0.6, 0], head: [0, -1.2, 0], armL: [-0.6, 0, 0.9], foreL: [-1.6, 0, 0], armR: [0.3, 0, -0.9], foreR: [-1.4, 0, 0],
    thighL: [-0.75, 0, 0.1], shinL: [1.1, 0, 0], thighR: [-0.5, 0, -0.1], shinR: [1.2, 0, 0] }),
  palm_hit: {
    _off: [0, -0.04, 0.06], hips: [0, -0.95, 0.4], spine: [-0.1, 0, 0.2], chest: [-0.15, 0.15, 0.25], head: [0, 0.65, -0.3],
    thighR: [-1.55, 0, -0.35], shinR: [0.15, 0, 0], footR: [0.8, 0, 0], thighL: [-0.1, 0, 0.18], shinL: [0.3, 0, 0], footL: [0.1, 0, 0],
    armL: [-0.4, 0, 1.3], foreL: [-0.5, 0, 0], armR: [0.4, 0, -1.2], foreR: [-0.6, 0, 0],
  },
  heavy_charge: {
    _off: [0, -0.22, -0.05], hips: [0, -0.4, 0], spine: [0.15, 0, 0], chest: [0.2, 1.0, 0], head: [0, -0.8, 0],
    armR: [0.95, 0, -0.45], foreR: [-1.7, 0, 0], armL: [-1.35, 0, 0.35], foreL: [-0.25, 0, 0],
    thighL: [-0.95, 0, 0.2], shinL: [1.05, 0, 0], thighR: [0.55, 0, -0.2], shinR: [0.75, 0, 0], footR: [0.2, 0, 0],
  },
  heavy_hit: {
    _off: [0, -0.24, 0.2], hips: [0.05, 0.35, 0], spine: [0.2, 0, 0], chest: [0.3, -0.65, 0], neck: [0.05, 0, 0], head: [-0.2, 0.45, 0],
    armR: [-1.62, 0, -0.04], foreR: [0, 0, 0], handR: [0.1, 0, 0], armL: [0.9, 0, 0.35], foreL: [-1.7, 0, 0], shoulderR: [0, 0.25, 0],
    thighL: [-1.25, 0, 0.18], shinL: [1.15, 0, 0], footL: [0.1, 0, 0], thighR: [0.95, 0, -0.15], shinR: [0.05, 0, 0], footR: [0.6, 0, 0],
  },
  axe_wind: {
    spine: [-0.2, 0, 0], chest: [-0.4, 0, 0], head: [-0.2, 0, 0], armL: [-2.9, 0, 0.2], foreL: [-0.8, 0, 0], armR: [-2.9, 0, -0.2], foreR: [-0.8, 0, 0],
    thighL: [-1.2, 0, 0.1], shinL: [1.6, 0, 0], thighR: [-0.4, 0, -0.1], shinR: [1.4, 0, 0],
  },
  axe_hit: {
    spine: [0.35, 0, 0], chest: [0.65, 0, 0], head: [0.1, 0, 0], armL: [-0.65, 0, 0.12], foreL: [-0.3, 0, 0], armR: [-0.65, 0, -0.12], foreR: [-0.3, 0, 0],
    thighL: [-1.0, 0, 0.15], shinL: [1.4, 0, 0], thighR: [-0.3, 0, -0.15], shinR: [1.6, 0, 0], _off: [0, -0.15, 0],
  },
  cast_wind: mix(READY, { chest: [0.05, 0.55, 0], armR: [0.3, 0, -0.45], foreR: [-2.1, 0, 0], armL: [-0.9, 0, 0.3], foreL: [-1.3, 0, 0] }),
  cast_hit: mix(READY, {
    chest: [0.12, -0.4, 0], head: [0, 0.25, 0], armR: [-1.55, 0, -0.08], foreR: [-0.05, 0, 0], handR: [-0.5, 0, 0],
    armL: [0.55, 0, 0.35], foreL: [-0.9, 0, 0], _off: [0, -0.09, 0.05],
  }),
  // Dawn Lance: one outstretched palm inside the sash ring, the other arm swept back for balance (GDD 5.4)
  beam_charge: {
    _off: [0, -0.13, 0], hips: [0, 0.35, 0], spine: [0.05, 0, 0], chest: [0.08, 0.35, 0], head: [0, -0.55, 0],
    armR: [-1.5, 0, -0.04], foreR: [-0.15, 0, 0], handR: [-0.9, 0, 0], armL: [0.9, 0, 0.4], foreL: [-0.35, 0, 0],
    thighR: [-0.65, 0, -0.15], shinR: [0.75, 0, 0], thighL: [0.4, 0, 0.22], shinL: [0.45, 0, 0], footL: [-0.2, 0, 0],
  },
  beam_charge_b: {
    _off: [0, -0.15, 0], hips: [0, 0.35, 0], spine: [0.05, 0, 0], chest: [0.1, 0.38, 0], head: [0.02, -0.57, 0],
    armR: [-1.55, 0, -0.06], foreR: [-0.08, 0, 0], handR: [-0.95, 0, 0], armL: [1.0, 0, 0.45], foreL: [-0.3, 0, 0],
    thighR: [-0.68, 0, -0.15], shinR: [0.8, 0, 0], thighL: [0.42, 0, 0.22], shinL: [0.48, 0, 0], footL: [-0.2, 0, 0],
  },
  beam_loop: {
    _off: [0, -0.15, -0.03], hips: [0, 0.35, 0], spine: [-0.04, 0, 0], chest: [-0.06, 0.4, 0], head: [0.05, -0.6, 0],
    armR: [-1.55, 0, -0.04], foreR: [0, 0, 0], handR: [-1.1, 0, 0], armL: [1.15, 0, 0.5], foreL: [-0.2, 0, 0],
    thighR: [-0.6, 0, -0.15], shinR: [0.7, 0, 0], thighL: [0.5, 0, 0.22], shinL: [0.4, 0, 0], footL: [-0.25, 0, 0],
  },
  beam_end: mix(READY, { armR: [-0.9, 0, -0.3], foreR: [-0.9, 0, 0], chest: [0.05, 0.2, 0] }),
  ult_rise: {
    spine: [-0.15, 0, 0], chest: [-0.3, 0, 0], head: [-0.5, 0, 0], armL: [-2.85, 0, 0.45], foreL: [-0.15, 0, 0], armR: [-2.85, 0, -0.45], foreR: [-0.15, 0, 0],
    thighL: [-0.25, 0, 0.08], shinL: [0.55, 0, 0], thighR: [0.1, 0, -0.08], shinR: [0.85, 0, 0], footL: [0.7, 0, 0], footR: [0.7, 0, 0],
  },
  ult_dive: {
    hips: [2.1, 0, 0], head: [-0.7, 0, 0], neck: [-0.3, 0, 0], armR: [-2.9, 0, -0.05], foreR: [0, 0, 0], armL: [0.7, 0, 0.45], foreL: [-0.2, 0, 0],
    thighL: [0.05, 0, 0.05], shinL: [0.2, 0, 0], thighR: [0.15, 0, -0.05], shinR: [0.4, 0, 0], footL: [0.8, 0, 0], footR: [0.8, 0, 0],
  },
  talk_a: { head: [0.06, 0.1, 0.05], chest: [0.02, 0.05, 0], armR: [-0.55, 0.3, -0.3], foreR: [-1.1, 0, 0], armL: [0.05, 0, 0.12], foreL: [-0.3, 0, 0], thighL: [-0.08, 0, 0.08], thighR: [0.05, 0, -0.08] },
  talk_b: { head: [-0.04, -0.05, -0.03], chest: [0.0, -0.05, 0], armR: [-0.75, 0.5, -0.45], foreR: [-0.85, 0, 0], armL: [0.05, 0, 0.15], foreL: [-0.4, 0, 0], thighL: [-0.08, 0, 0.08], thighR: [0.05, 0, -0.08] },
  interact: {
    _off: [0, -0.12, 0], spine: [0.25, 0, 0], chest: [0.35, 0, 0], head: [0.3, 0, 0], armR: [-1.0, 0, -0.1], foreR: [-0.35, 0, 0], armL: [-0.2, 0, 0.2], foreL: [-0.6, 0, 0],
    thighL: [-0.5, 0, 0.08], shinL: [0.7, 0, 0], thighR: [0.1, 0, -0.08], shinR: [0.5, 0, 0],
  },
  victory: {
    chest: [-0.15, 0.25, 0], head: [-0.25, -0.15, 0], armR: [-2.95, 0, -0.25], foreR: [-0.35, 0, 0], armL: [0.3, 0, 0.35], foreL: [-1.9, 0, 0],
    thighL: [-0.12, 0, 0.16], thighR: [0.12, 0, -0.16], shinR: [0.1, 0, 0], _off: [0, 0.01, 0],
  },
  taunt: mix(LEGS_READY, { chest: [-0.12, -0.35, 0], head: [-0.1, 0.25, 0.12], armL: [-1.25, 0, 0.3], foreL: [-0.9, 0, 0], handL: [-0.7, 0, 0], armR: [0.1, 0, -0.2], foreR: [-1.8, 0, 0] }),
  lunge: mix(LEGS_READY, { _off: [0, -0.12, 0.18], chest: [0.6, 0, 0], head: [-0.3, 0, 0], armL: [-1.45, 0, 0.1], foreL: [-0.2, 0, 0], armR: [-1.45, 0, -0.1], foreR: [-0.2, 0, 0], thighL: [-0.95, 0, 0.12], shinL: [0.8, 0, 0] }),
  shoulder_wind: {
    _off: [0, -0.26, 0], spine: [0.35, 0, 0], chest: [0.5, 0.45, 0], head: [-0.4, -0.3, 0], armR: [0.35, 0, -0.25], foreR: [-1.6, 0, 0], armL: [-0.65, 0, 0.6], foreL: [-1.2, 0, 0],
    thighL: [-0.85, 0, 0.15], shinL: [1.15, 0, 0], thighR: [0.6, 0, -0.15], shinR: [0.95, 0, 0],
  },
  shoulder_hit: {
    _off: [0, -0.18, 0.12], spine: [0.4, 0, 0], chest: [0.45, 0.6, 0], head: [-0.45, -0.4, 0], armR: [0.25, 0, -0.35], foreR: [-1.6, 0, 0], armL: [-0.4, 0, 0.75], foreL: [-1.0, 0, 0],
    thighL: [-1.1, 0, 0.1], shinL: [0.6, 0, 0], thighR: [0.75, 0, -0.1], shinR: [0.4, 0, 0], footR: [0.5, 0, 0],
  },
  roar: {
    _off: [0, -0.12, 0], spine: [-0.2, 0, 0], chest: [-0.35, 0, 0], head: [-0.5, 0, 0], armL: [0.25, 0, 0.95], foreL: [-1.15, 0, 0], armR: [0.25, 0, -0.95], foreR: [-1.15, 0, 0],
    thighL: [-0.3, 0, 0.3], shinL: [0.55, 0, 0], thighR: [-0.3, 0, -0.3], shinR: [0.55, 0, 0],
  },
  // enemy wind-ups: each attack's own coiled pose, held with a tremble (the pose is part of the telegraph)
  axe_wind2: {
    _off: [0, -0.06, -0.04], spine: [-0.28, 0, 0], chest: [-0.5, 0, 0], head: [-0.1, 0, 0], armL: [-3.0, 0, 0.3], foreL: [-1.0, 0, 0], armR: [-3.0, 0, -0.3], foreR: [-1.0, 0, 0],
    thighL: [-1.25, 0, 0.12], shinL: [1.5, 0, 0], thighR: [-0.25, 0, -0.12], shinR: [1.2, 0, 0], footR: [0.3, 0, 0],
  },
  shoulder_wind2: {
    _off: [0, -0.3, -0.04], spine: [0.4, 0, 0], chest: [0.55, 0.55, 0], head: [-0.5, -0.4, 0], armR: [0.45, 0, -0.3], foreR: [-1.7, 0, 0], armL: [-0.75, 0, 0.7], foreL: [-1.25, 0, 0],
    thighL: [-0.95, 0, 0.18], shinL: [1.25, 0, 0], thighR: [0.65, 0, -0.18], shinR: [1.05, 0, 0],
  },
  cast_wind2: mix(READY, { chest: [0.0, 0.7, 0], head: [0, -0.35, 0], armR: [0.5, 0, -0.55], foreR: [-2.2, 0, 0], handR: [-0.6, 0, 0], armL: [-1.1, 0, 0.45], foreL: [-1.1, 0, 0], _off: [0, -0.12, -0.04] }),
  lunge_wind: mix(LEGS_READY, { _off: [0, -0.2, -0.06], spine: [0.2, 0, 0], chest: [0.3, 0.3, 0], head: [-0.35, -0.2, 0], armL: [0.6, 0, 0.5], foreL: [-1.6, 0, 0], armR: [0.6, 0, -0.5], foreR: [-1.6, 0, 0], thighL: [-0.9, 0, 0.14], shinL: [1.2, 0, 0], thighR: [0.4, 0, -0.14], shinR: [0.9, 0, 0] }),
  // personalities at rest: the Choir hunch and sway; the golem's heavy breath; a duellist's guard; a floating caster
  idle_choir: {
    _off: [0, -0.04, 0], hips: [0.05, 0.1, 0], spine: [0.18, 0, 0], chest: [0.16, -0.08, 0.04], neck: [0.1, 0, 0], head: [0.15, 0.15, 0.25],
    armL: [-0.15, 0, 0.18], foreL: [-0.6, 0, 0], armR: [-0.35, 0, -0.22], foreR: [-0.9, 0, 0], thighL: [-0.15, 0, 0.12], shinL: [0.25, 0, 0], thighR: [0.08, 0, -0.1], shinR: [0.15, 0, 0],
  },
  idle_choir_b: {
    _off: [0, -0.05, 0], hips: [0.05, 0.02, 0], spine: [0.2, 0, 0], chest: [0.12, 0.08, -0.03], neck: [0.12, 0, 0], head: [0.1, -0.12, -0.2],
    armL: [-0.1, 0, 0.2], foreL: [-0.5, 0, 0], armR: [-0.5, 0, -0.18], foreR: [-1.1, 0, 0], thighL: [-0.15, 0, 0.12], shinL: [0.25, 0, 0], thighR: [0.08, 0, -0.1], shinR: [0.15, 0, 0],
  },
  idle_golem: {
    _off: [0, -0.08, 0], spine: [0.25, 0, 0], chest: [0.15, 0, 0], head: [0.1, 0, 0], shoulderL: [0, 0, -0.08], shoulderR: [0, 0, 0.08],
    armL: [-0.25, 0, 0.32], foreL: [-0.55, 0, 0], armR: [-0.25, 0, -0.32], foreR: [-0.55, 0, 0], thighL: [-0.2, 0, 0.2], shinL: [0.3, 0, 0], thighR: [-0.2, 0, -0.2], shinR: [0.3, 0, 0],
  },
  idle_golem_b: {
    _off: [0, -0.06, 0], spine: [0.18, 0, 0], chest: [0.05, 0, 0], head: [0.0, 0, 0], shoulderL: [0, 0, 0.1], shoulderR: [0, 0, -0.1],
    armL: [-0.2, 0, 0.4], foreL: [-0.45, 0, 0], armR: [-0.2, 0, -0.4], foreR: [-0.45, 0, 0], thighL: [-0.2, 0, 0.2], shinL: [0.3, 0, 0], thighR: [-0.2, 0, -0.2], shinR: [0.3, 0, 0],
  },
  idle_duel: mix(READY, { hips: [0, -0.5, 0], chest: [0.08, 0.45, 0], head: [0.05, 0.1, 0], armR: [-0.7, 0, -0.3], foreR: [-1.3, 0, 0], armL: [-0.2, 0, 0.45], foreL: [-1.2, 0, 0], _off: [0, -0.1, 0] }),
  idle_duel_b: mix(READY, { hips: [0, -0.45, 0], chest: [0.12, 0.35, 0], head: [0.08, 0.0, 0], armR: [-0.8, 0, -0.25], foreR: [-1.2, 0, 0], armL: [-0.25, 0, 0.5], foreL: [-1.3, 0, 0], _off: [0, -0.13, 0.01] }),
  idle_float: {
    spine: [0.1, 0, 0], chest: [0.12, 0, 0], head: [0.3, 0, 0], armL: [-0.35, 0, 0.55], foreL: [-0.5, 0, 0], armR: [-0.35, 0, -0.55], foreR: [-0.5, 0, 0],
    thighL: [-0.25, 0, 0.05], shinL: [0.6, 0, 0], thighR: [-0.1, 0, -0.05], shinR: [0.5, 0, 0], footL: [0.6, 0, 0], footR: [0.6, 0, 0],
  },
  idle_float_b: {
    spine: [0.05, 0, 0], chest: [0.02, 0, 0], head: [0.15, 0.1, 0], armL: [-0.45, 0, 0.7], foreL: [-0.6, 0, 0], armR: [-0.45, 0, -0.7], foreR: [-0.6, 0, 0],
    thighL: [-0.2, 0, 0.05], shinL: [0.55, 0, 0], thighR: [-0.12, 0, -0.05], shinR: [0.45, 0, 0], footL: [0.6, 0, 0], footR: [0.6, 0, 0], _off: [0, 0.03, 0],
  },
  idle_boss: mix(LEGS_READY, { chest: [-0.12, 0.15, 0], head: [-0.12, -0.1, 0], armR: [-0.2, 0, -0.3], foreR: [-0.6, 0, 0], armL: [0.2, 0, 0.6], foreL: [-1.6, 0, 0], handL: [0, 0, 0.4], _off: [0, -0.04, 0] }),
  idle_boss_b: mix(LEGS_READY, { chest: [-0.16, 0.1, 0], head: [-0.15, 0.1, 0], armR: [-0.25, 0, -0.32], foreR: [-0.7, 0, 0], armL: [0.2, 0, 0.62], foreL: [-1.6, 0, 0], handL: [0, 0, 0.4], _off: [0, -0.03, 0] }),
  // boss intros: Durn raises the mace, Iskra crosses then throws her sabres wide, Vorrhal opens his arms and lifts
  roar_durn: mix(LEGS_READY, { _off: [0, -0.12, 0], chest: [-0.3, 0.3, 0], head: [-0.35, -0.2, 0], armR: [-2.9, 0, -0.35], foreR: [-0.5, 0, 0], armL: [0.3, 0, 0.9], foreL: [-1.0, 0, 0], thighL: [-0.5, 0, 0.3], shinL: [0.7, 0, 0] }),
  cross_iskra: mix(LEGS_READY, { _off: [0, -0.2, 0], chest: [0.3, 0, 0], head: [0.2, 0, 0], armL: [-1.3, 0, -0.5], foreL: [-1.0, 0, 0], armR: [-1.3, 0, 0.5], foreR: [-1.0, 0, 0] }),
  roar_iskra: mix(LEGS_READY, { _off: [0, -0.08, 0], chest: [-0.3, 0, 0], head: [-0.3, 0, 0], armL: [-0.4, 0, 1.35], foreL: [-0.15, 0, 0], armR: [-0.4, 0, -1.35], foreR: [-0.15, 0, 0], thighL: [-0.35, 0, 0.35], thighR: [-0.35, 0, -0.35], shinL: [0.5, 0, 0], shinR: [0.5, 0, 0] }),
  roar_vorrhal: { _off: [0, 0.12, 0], spine: [-0.15, 0, 0], chest: [-0.3, 0, 0], head: [-0.6, 0, 0], armL: [-0.6, 0, 1.6], foreL: [-0.3, 0, 0], armR: [-0.6, 0, -1.6], foreR: [-0.3, 0, 0], footL: [0.7, 0, 0], footR: [0.7, 0, 0], shinL: [0.3, 0, 0], shinR: [0.3, 0, 0] },
};

// ---------------------------------------------------------------- quadruped
const Q_WALK = {
  legFL: [-0.45, 0, 0], footFL: [0.2, 0, 0], legBR: [-0.35, 0, 0], footBR: [0.25, 0, 0], legFR: [0.4, 0, 0], footFR: [0.35, 0, 0], legBL: [0.4, 0, 0], footBL: [0.15, 0, 0],
  head: [0.05, 0.06, 0], spine: [0, 0.03, 0], _off: [0, -0.01, 0],
};
const Q_GALLOP = {
  legFL: [-0.85, 0, 0], legFR: [-0.65, 0, 0], footFL: [0.2, 0, 0], legBL: [0.7, 0, 0], legBR: [0.55, 0, 0], footBL: [0.3, 0, 0], footBR: [0.3, 0, 0],
  spine: [0.12, 0, 0], chest: [0.06, 0, 0], head: [0.2, 0, 0], tail1: [-0.4, 0, 0], _off: [0, 0.04, 0],
};
const Q_GATHER = {
  legFL: [0.55, 0, 0], legFR: [0.45, 0, 0], footFL: [0.6, 0, 0], footFR: [0.6, 0, 0], legBL: [-0.65, 0, 0], legBR: [-0.55, 0, 0], footBL: [0.2, 0, 0], footBR: [0.2, 0, 0],
  spine: [-0.15, 0, 0], head: [0.1, 0, 0], tail1: [-0.6, 0, 0], _off: [0, -0.06, 0],
};
const Q_DOWN = {
  hips: [0, 0, 1.35], _off: [0.1, -0.4, 0], legFL: [-0.3, 0, -0.3], legFR: [0.2, 0, 0.35], legBL: [0.35, 0, -0.3], legBR: [-0.2, 0, 0.35], head: [0.2, 0.3, 0.2], jaw: [0.25, 0, 0],
};
/** @type {Record<string, Record<string, number[]>>} */
const QUADRUPED = {
  rest: {},
  idle: { head: [0.12, 0.05, 0], neck: [0.05, 0, 0], tail1: [0.3, 0, 0.1], _off: [0, -0.005, 0] },
  idle_b: { head: [0.06, -0.08, 0], neck: [0.0, 0, 0], tail1: [0.25, 0, -0.15], spine: [-0.02, 0, 0], _off: [0, 0.01, 0], jaw: [0.08, 0, 0] },
  walk_c: Q_WALK, walk_c2: mirror(Q_WALK),
  walk_p: { legFL: [0, 0, 0], legBR: [0.1, 0, 0], legFR: [-0.15, 0, 0], footFR: [0.9, 0, 0], legBL: [-0.2, 0, 0], footBL: [0.8, 0, 0], head: [0.1, 0, 0], _off: [0, 0.03, 0] },
  run_c: Q_GALLOP, run_p: Q_GATHER,
  fall: { legFL: [-0.6, 0, 0.1], legFR: [-0.5, 0, -0.1], legBL: [0.5, 0, 0.1], legBR: [0.6, 0, -0.1], footFL: [0.6, 0, 0], footFR: [0.6, 0, 0], head: [-0.25, 0, 0], tail1: [-0.6, 0, 0] },
  hurtle: { legFL: [-1.4, 0, 0], legFR: [-1.4, 0, 0], legBL: [1.3, 0, 0], legBR: [1.3, 0, 0], footFL: [1.5, 0, 0], footFR: [1.5, 0, 0], spine: [0.4, 0, 0], head: [0.8, 0, 0] },
  stagger: { hips: [0, 0, -0.25], spine: [0, 0.2, 0.1], head: [-0.4, 0.5, 0.3], jaw: [0.35, 0, 0], legFL: [0.3, 0, 0.25], legBR: [-0.3, 0, -0.2], _off: [0, -0.05, 0] },
  down: Q_DOWN,
  ko: mix(Q_DOWN, { head: [0.35, 0.5, 0.3], jaw: [0.4, 0, 0], legFL: [-0.6, 0, -0.5] }),
  rise: { legFL: [-0.9, 0, 0.1], legFR: [0.2, 0, 0], footFL: [0.9, 0, 0], legBL: [0.6, 0, 0], legBR: [0.7, 0, 0], footBL: [-0.3, 0, 0], footBR: [-0.3, 0, 0], _off: [0, -0.25, 0], head: [-0.3, 0, 0] },
  bite_wind: { neck: [-0.35, 0, 0], head: [-0.45, 0, 0], jaw: [0.55, 0, 0], spine: [-0.1, 0, 0], legFL: [0.2, 0, 0], legFR: [0.2, 0, 0], _off: [0, 0.02, -0.08] },
  bite_hit: { neck: [0.35, 0, 0], head: [0.4, 0.1, 0], jaw: [0, 0, 0], spine: [0.12, 0, 0], legFL: [-0.5, 0, 0], legBL: [0.3, 0, 0], legBR: [0.3, 0, 0], _off: [0, -0.04, 0.18] },
  scrape: { neck: [0.4, 0, 0], head: [0.45, 0, 0], legFR: [-0.5, 0, 0], footFR: [0.4, 0, 0], legBL: [-0.3, 0, 0], legBR: [-0.3, 0, 0], spine: [0.1, 0, 0], _off: [0, -0.1, -0.04], tail1: [-0.3, 0, 0] },
  scrape_b: { neck: [0.4, 0, 0], head: [0.45, 0, 0], legFR: [0.55, 0, 0], footFR: [0.2, 0, 0], legBL: [-0.3, 0, 0], legBR: [-0.3, 0, 0], spine: [0.1, 0, 0], _off: [0, -0.1, -0.04], tail1: [-0.2, 0, 0] },
  charge: mix(Q_GALLOP, { neck: [0.4, 0, 0], head: [0.35, 0, 0] }),
  rear: { hips: [-0.65, 0, 0], legFL: [-1.0, 0, 0.1], footFL: [1.0, 0, 0], legFR: [-0.8, 0, -0.1], footFR: [1.1, 0, 0], legBL: [0.6, 0, 0], legBR: [0.6, 0, 0], head: [0.3, 0, 0], neck: [0.3, 0, 0], jaw: [0.4, 0, 0], clawL: [-1.2, 0, 0.3], clawR: [-1.2, 0, -0.3] },
  stomp: { hips: [0.12, 0, 0], legFL: [-0.35, 0, 0.15], legFR: [-0.35, 0, -0.15], legBL: [0.2, 0, 0], legBR: [0.2, 0, 0], head: [0.5, 0, 0], neck: [0.35, 0, 0], _off: [0, -0.12, 0.05], clawL: [0.4, 0, 0], clawR: [0.4, 0, 0] },
  spit: { neck: [-0.3, 0, 0], head: [-0.25, 0, 0], jaw: [0.6, 0, 0], legFL: [-0.2, 0, 0], legFR: [-0.2, 0, 0], _off: [0, 0.03, 0], spine: [-0.08, 0, 0] },
  roar: { neck: [-0.55, 0, 0], head: [-0.5, 0, 0], jaw: [0.75, 0, 0], spine: [-0.15, 0, 0], legFL: [-0.25, 0, 0.12], legFR: [-0.25, 0, -0.12], tail1: [-0.7, 0, 0], clawL: [-0.6, 0, 0.5], clawR: [-0.6, 0, -0.5] },
  guard: { clawL: [-0.8, 0.6, 0], clawR: [-0.8, -0.6, 0], head: [0.3, 0, 0], _off: [0, -0.1, 0], legFL: [0.2, 0, 0.2], legFR: [0.2, 0, -0.2] },
  // a snort and head toss, a paw at the ground
  idle_c: { head: [-0.25, 0.25, 0.15], neck: [-0.12, 0, 0], jaw: [0.25, 0, 0], tail1: [0.2, 0, 0.25], legFR: [-0.35, 0, 0], footFR: [0.5, 0, 0], _off: [0, 0.01, 0] },
  bite_wind2: { neck: [-0.45, 0, 0], head: [-0.55, 0, 0], jaw: [0.7, 0, 0], spine: [-0.15, 0, 0], legFL: [0.3, 0, 0], legFR: [0.3, 0, 0], legBL: [-0.2, 0, 0], legBR: [-0.2, 0, 0], _off: [0, -0.04, -0.12] },
  rear2: { hips: [-0.8, 0, 0], legFL: [-1.2, 0, 0.15], footFL: [1.2, 0, 0], legFR: [-1.0, 0, -0.15], footFR: [1.25, 0, 0], legBL: [0.7, 0, 0], legBR: [0.7, 0, 0], head: [0.15, 0, 0], neck: [0.2, 0, 0], jaw: [0.6, 0, 0], clawL: [-1.4, 0, 0.45], clawR: [-1.4, 0, -0.45] },
  spit_wind: { neck: [-0.5, 0, 0], head: [-0.4, 0, 0], jaw: [0.2, 0, 0], spine: [-0.12, 0, 0], legFL: [0.15, 0, 0], legFR: [0.15, 0, 0], _off: [0, 0.04, -0.05] },
  idle_crab: { clawL: [-0.35, 0.25, 0], clawR: [-0.2, -0.35, 0], head: [0.1, 0, 0], _off: [0, -0.01, 0] },
  idle_crab_b: { clawL: [-0.15, 0.4, 0], clawR: [-0.4, -0.2, 0], head: [0.0, 0, 0], _off: [0, 0.01, 0], spine: [0, 0.05, 0] },
};

// ---------------------------------------------------------------- flyer
const FLAP_UP = { wingL: [0, 0.05, 0.85], wingL2: [0, 0, -0.35], wingR: [0, -0.05, -0.85], wingR2: [0, 0, 0.35], tail1: [-0.1, 0, 0], hips: [0.1, 0, 0], _off: [0, -0.02, 0] };
const FLAP_DOWN = { wingL: [0, -0.1, -0.55], wingL2: [0, 0, 0.3], wingR: [0, 0.1, 0.55], wingR2: [0, 0, -0.3], tail1: [0.1, 0, 0], hips: [0.1, 0, 0], _off: [0, 0.03, 0] };
const GLIDE = { wingL: [0, -0.1, 0.12], wingL2: [0, 0, -0.08], wingR: [0, 0.1, -0.12], wingR2: [0, 0, 0.08], hips: [0.25, 0, 0], head: [-0.2, 0, 0], legL: [1.1, 0, 0], legR: [1.1, 0, 0] };
const FOLD = { wingL: [0.2, 1.2, -0.25], wingL2: [0, -0.5, 0.3], wingR: [0.2, -1.2, 0.25], wingR2: [0, 0.5, -0.3], hips: [0.1, 0, 0], neck: [-0.2, 0, 0], legL: [0.6, 0, 0], legR: [0.6, 0, 0] };
/** @type {Record<string, Record<string, number[]>>} */
const FLYER = {
  rest: {},
  idle: FLAP_UP, idle_b: FLAP_DOWN,
  perch: mix(FOLD, { hips: [-0.15, 0, 0], neck: [0.1, 0, 0], head: [0.15, 0, 0], legL: [0, 0, 0], legR: [0, 0, 0] }),
  glide: GLIDE, glide_b: mix(GLIDE, { wingL: [0, -0.12, 0.22], wingR: [0, 0.12, -0.22], hips: [0.22, 0, 0.06] }),
  dive: mix(FOLD, { hips: [1.1, 0, 0], head: [-0.6, 0, 0], neck: [-0.4, 0, 0], legL: [1.3, 0, 0], legR: [1.3, 0, 0], tail1: [-0.2, 0, 0] }),
  fold: FOLD,
  peck_wind: mix(FLAP_UP, { neck: [-0.5, 0, 0], head: [-0.4, 0, 0], jaw: [0.5, 0, 0] }),
  peck_hit: mix(FLAP_DOWN, { neck: [0.6, 0, 0], head: [0.5, 0, 0], jaw: [0, 0, 0], hips: [0.5, 0, 0], _off: [0, -0.05, 0.15] }),
  beat_wind: { wingL: [0, 0.25, 1.2], wingL2: [0, 0, -0.2], wingR: [0, -0.25, -1.2], wingR2: [0, 0, 0.2], hips: [-0.35, 0, 0], head: [0.2, 0, 0], legL: [-0.8, 0, 0], legR: [-0.8, 0, 0] },
  beat_hit: { wingL: [0, -0.35, -0.9], wingL2: [0, 0, 0.5], wingR: [0, 0.35, 0.9], wingR2: [0, 0, -0.5], hips: [0.3, 0, 0], head: [0.35, 0, 0], _off: [0, -0.1, 0] },
  flick: { wingL: [0, 0.7, 0.4], wingR: [0, -0.3, -0.6], hips: [0.1, 0.3, 0], head: [0, -0.3, 0] },
  shriek: { wingL: [0, -0.3, 1.0], wingL2: [0, 0, 0.3], wingR: [0, 0.3, -1.0], wingR2: [0, 0, -0.3], neck: [-0.55, 0, 0], head: [-0.4, 0, 0], jaw: [0.7, 0, 0], hips: [-0.2, 0, 0] },
  stagger: { wingL: [0.4, 0, -0.3], wingR: [-0.3, 0, 0.7], hips: [-0.3, 0.3, 0.4], head: [-0.4, 0.5, 0], jaw: [0.4, 0, 0] },
  down: { hips: [0, 0, 1.4], _off: [0, -0.45, 0], wingL: [0, 0, -0.4], wingR: [0, 0, 0.2], neck: [0.3, 0.4, 0], head: [0.2, 0.3, 0], legL: [0.6, 0, 0.3] },
  tumble: { wingL: [0.6, 0.4, 0.3], wingR: [0.6, -0.4, -0.3], hips: [0.7, 0, 0.4], head: [0.4, 0, 0] },
  peck_wind2: mix(FLAP_UP, { neck: [-0.7, 0, 0], head: [-0.5, 0, 0], jaw: [0.6, 0, 0], hips: [-0.2, 0, 0], _off: [0, 0.04, -0.06] }),
  beat_wind2: { wingL: [0, 0.35, 1.35], wingL2: [0, 0, -0.35], wingR: [0, -0.35, -1.35], wingR2: [0, 0, 0.35], hips: [-0.45, 0, 0], head: [0.25, 0, 0], legL: [-0.9, 0, 0], legR: [-0.9, 0, 0], _off: [0, 0.05, 0] },
};

// ---------------------------------------------------------------- blob
/** @type {Record<string, Record<string, number[]>>} */
const BLOB = {
  rest: {},
  idle: { hips: [0.05, 0, 0], head: [0.05, 0, 0], _scl: [1, 1, 1] },
  idle_b: { hips: [-0.04, 0, 0], head: [-0.05, 0, 0], _off: [0, 0.05, 0], _scl: [0.95, 1.08, 0.95] },
  drift: { hips: [0.35, 0, 0], head: [-0.25, 0, 0], _scl: [0.92, 1.06, 1.08], tailA1: [0.2, 0, 0], tailB1: [0.2, 0.2, 0], tailC1: [0.2, -0.2, 0] },
  squash: { hips: [0.15, 0, 0], _off: [0, -0.12, 0], _scl: [1.22, 0.74, 1.22] },
  stretch: { hips: [0.5, 0, 0], _off: [0, 0.06, 0.12], _scl: [0.82, 1.28, 0.82] },
  lunge: { hips: [0.7, 0, 0], _off: [0, -0.05, 0.3], _scl: [0.86, 1.1, 1.25], head: [-0.4, 0, 0] },
  swell: { _scl: [1.28, 1.28, 1.28], _off: [0, 0.08, 0], head: [-0.2, 0, 0], tailA1: [-0.5, 0, 0], tailB1: [-0.4, 0.5, 0], tailC1: [-0.4, -0.5, 0] },
  pulse: { _scl: [1.12, 1.12, 1.12], head: [-0.1, 0, 0] },
  tilt: { hips: [-0.4, 0.3, 0.5], _scl: [1.05, 0.92, 1.05], head: [0.3, 0, 0] },
  flat: { _off: [0, -0.4, 0], _scl: [1.4, 0.45, 1.4], hips: [0.1, 0, 0] },
  gone: { _off: [0, -0.2, 0], _scl: [0.25, 0.25, 0.25] },
};

/** @type {Record<string, Record<string, Record<string, number[]>>>} */
export const POSES = { humanoid: HUMANOID, quadruped: QUADRUPED, flyer: FLYER, blob: BLOB };

/** @param {string} fam @returns {number} floats per pose */
export function poseSize(fam) {
  return boneNames(fam).length * 3 + POSE_EXTRA;
}

/**
 * Compile a sparse pose for a rig family into a flat array (unknown bones are reported, not thrown).
 * @param {string} fam @param {Record<string, number[]>} pose @param {string[]} [problems]
 * @returns {Float32Array}
 */
export function compilePose(fam, pose, problems) {
  const names = boneNames(fam);
  const nb = names.length;
  const out = new Float32Array(nb * 3 + POSE_EXTRA);
  out[nb * 3 + 3] = 1; out[nb * 3 + 4] = 1; out[nb * 3 + 5] = 1;
  for (const k of Object.keys(pose)) {
    const v = pose[k];
    if (k === '_off') {
      for (let j = 0; j < 3; j++) out[nb * 3 + j] = v[j] || 0;
    } else if (k === '_scl') {
      for (let j = 0; j < 3; j++) out[nb * 3 + 3 + j] = typeof v[j] === 'number' ? v[j] : 1;
    } else {
      const b = names.indexOf(k);
      if (b < 0) {
        if (problems) problems.push(fam + ': unknown bone ' + k);
        continue;
      }
      for (let j = 0; j < 3; j++) out[b * 3 + j] = v[j] || 0;
    }
  }
  return out;
}

/** @type {Map<string, Map<string, Float32Array>>} */
const compiled = new Map();

/**
 * Compiled pose by family and id (cached); null when the pose does not exist.
 * @param {string} fam @param {string} id @returns {Float32Array|null}
 */
export function pose(fam, id) {
  let m = compiled.get(fam);
  if (!m) {
    m = new Map();
    compiled.set(fam, m);
  }
  let p = m.get(id);
  if (p === undefined) {
    const src = POSES[fam] && POSES[fam][id];
    p = src ? compilePose(fam, src) : null;
    m.set(id, /** @type {any} */ (p));
  }
  return p || null;
}

/**
 * out = a + (b - a) * w (all floats; scale and offset included). out may alias a.
 * @param {Float32Array} a @param {Float32Array} b @param {number} w @param {Float32Array} out @param {Uint8Array|null} [mask] per-bone 0/1
 */
export function blendPose(a, b, w, out, mask) {
  const n = out.length;
  if (!mask) {
    for (let i = 0; i < n; i++) out[i] = a[i] + (b[i] - a[i]) * w;
    return out;
  }
  const nb = mask.length;
  for (let i = 0; i < nb; i++) {
    if (!mask[i]) {
      out[i * 3] = a[i * 3]; out[i * 3 + 1] = a[i * 3 + 1]; out[i * 3 + 2] = a[i * 3 + 2];
      continue;
    }
    for (let j = 0; j < 3; j++) out[i * 3 + j] = a[i * 3 + j] + (b[i * 3 + j] - a[i * 3 + j]) * w;
  }
  for (let i = nb * 3; i < n; i++) out[i] = a[i];
  return out;
}

/** @param {number} t 0..1 @param {string|undefined} ease @returns {number} */
export function ease(t, ease) {
  switch (ease) {
    case 'in': return t * t * t;
    case 'out': { const u = 1 - t; return 1 - u * u * u; }
    case 'inOut': return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'back': { const c = 1.9; const u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; }
    default: return t;
  }
}
