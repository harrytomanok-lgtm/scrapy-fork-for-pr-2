/**
 * Clip definitions (ARCHITECTURE 5.11 `clip`) and sampling: each clip is a list of timed key poses from the pose
 * library with easing. Locomotion cycles are normalised loops sampled by phase; technique clips are snappy
 * one-shots with anticipation, an overshooting strike (`back` ease) and a held impact pose. Pure (no three).
 * @module actors/logic/clips
 */

import { pose, poseSize, blendPose, ease, family } from './poses.js';

/** Standard clips every humanoid implements (4.5). */
export const HUMANOID_CLIPS = Object.freeze(['idle', 'walk', 'run', 'sprint', 'jump', 'fall', 'land', 'fly_hover', 'fly_cruise', 'fly_boost', 'swim',
  'hurtle', 'stagger', 'down', 'getup', 'death', 'guard', 'gather', 'transform', 'flicker', 'attack1', 'attack2', 'attack3', 'attack4', 'attack5',
  'attack6', 'heavy_charge', 'heavy', 'heavy_air', 'cast', 'cast_loop', 'beam_charge', 'beam_loop', 'beam_end', 'burst', 'ult_rise', 'ult_dive',
  'talk', 'interact', 'victory', 'taunt', 'bite', 'charge_windup', 'charge', 'slam', 'ranged', 'roar']);

/** Standard clips every creature implements (the starred ids of 4.5). */
export const CREATURE_CLIPS = Object.freeze(['idle', 'walk', 'run', 'fall', 'fly_hover', 'fly_cruise', 'hurtle', 'stagger', 'down', 'getup', 'death',
  'bite', 'charge_windup', 'charge', 'slam', 'ranged', 'roar']);

/**
 * @param {string} fam @param {string} id @param {number} seconds @param {boolean} loop @param {Array<[number, string, string?]>} keys
 * @param {'full'|'upper'} [layer]
 */
function C(fam, id, seconds, loop, keys, layer = 'full') {
  return {
    id: fam + '.' + id, rig: fam, seconds, loop, layer,
    keys: keys.map((k) => (k[2] ? { t: k[0], pose: k[1], ease: k[2] } : { t: k[0], pose: k[1] })),
  };
}

/** @param {string} f @param {string} id @param {number} s @param {string} wind @param {string} hit @param {number} [hold] */
function strike(f, id, s, wind, hit, hold = 0.45) {
  const a = s * 0.18;
  const b = s * 0.32;
  return C(f, id, s, false, [[0, 'ready'], [a, wind, 'out'], [b, hit, 'back'], [b + (s - b) * hold, hit], [s, 'ready', 'inOut']]);
}

const H = 'humanoid';
const HUMANOID_DEFS = [
  C(H, 'idle', 2.4, true, [[0, 'idle'], [1.2, 'idle_b', 'inOut'], [2.4, 'idle', 'inOut']]),
  C(H, 'walk', 1, true, [[0, 'walk_c'], [0.25, 'walk_p'], [0.5, 'walk_c2'], [0.75, 'walk_p2'], [1, 'walk_c']]),
  C(H, 'run', 0.7, true, [[0, 'run_c'], [0.175, 'run_p'], [0.35, 'run_c2'], [0.525, 'run_p2'], [0.7, 'run_c']]),
  C(H, 'sprint', 0.56, true, [[0, 'sprint_c'], [0.14, 'sprint_p'], [0.28, 'sprint_c2'], [0.42, 'sprint_p2'], [0.56, 'sprint_c']]),
  C(H, 'jump', 0.3, false, [[0, 'land'], [0.07, 'jump', 'out'], [0.3, 'jump']]),
  C(H, 'fall', 0.9, true, [[0, 'fall'], [0.45, 'fall_b', 'inOut'], [0.9, 'fall', 'inOut']]),
  C(H, 'land', 0.32, false, [[0, 'land'], [0.08, 'land'], [0.32, 'idle', 'inOut']]),
  C(H, 'fly_hover', 1.6, true, [[0, 'fly_hover'], [0.8, 'fly_hover_b', 'inOut'], [1.6, 'fly_hover', 'inOut']]),
  C(H, 'fly_cruise', 2, true, [[0, 'fly_cruise'], [1, 'fly_cruise_b', 'inOut'], [2, 'fly_cruise', 'inOut']]),
  C(H, 'fly_boost', 0.4, true, [[0, 'fly_boost'], [0.2, 'fly_boost_b', 'inOut'], [0.4, 'fly_boost', 'inOut']]),
  C(H, 'swim', 1.2, true, [[0, 'swim_a'], [0.6, 'swim_b', 'inOut'], [1.2, 'swim_a', 'inOut']]),
  C(H, 'hurtle', 0.5, true, [[0, 'hurtle'], [0.5, 'hurtle']]),
  C(H, 'stagger', 0.45, false, [[0, 'ready'], [0.06, 'stagger', 'out'], [0.3, 'stagger'], [0.45, 'ready', 'inOut']]),
  C(H, 'down', 0.5, false, [[0, 'stagger'], [0.28, 'down', 'in'], [0.36, 'down', 'out'], [0.5, 'down']]),
  C(H, 'getup', 0.65, false, [[0, 'down'], [0.28, 'kneel', 'inOut'], [0.65, 'ready', 'inOut']]),
  C(H, 'death', 1, false, [[0, 'stagger'], [0.22, 'kneel', 'inOut'], [0.62, 'ko', 'in'], [1, 'ko', 'out']]),
  C(H, 'guard', 1.2, true, [[0, 'guard'], [0.6, 'guard_b', 'inOut'], [1.2, 'guard', 'inOut']]),
  C(H, 'gather', 1, true, [[0, 'gather'], [0.5, 'gather_b', 'inOut'], [1, 'gather', 'inOut']]),
  C(H, 'transform', 0.9, false, [[0, 'ready'], [0.15, 'curl', 'out'], [0.45, 'curl'], [0.53, 'burst', 'back'], [0.9, 'burst']]),
  C(H, 'flicker', 0.25, false, [[0, 'ready'], [0.04, 'flicker', 'out'], [0.18, 'flicker'], [0.25, 'ready', 'inOut']]),
  strike(H, 'attack1', 0.28, 'jab_wind', 'jab_hit'),
  strike(H, 'attack2', 0.3, 'cross_wind', 'cross_hit'),
  strike(H, 'attack3', 0.32, 'hook_wind', 'hook_hit'),
  strike(H, 'attack4', 0.4, 'kick_wind', 'kick_hit'),
  strike(H, 'attack5', 0.42, 'upper_wind', 'upper_hit', 0.55),
  strike(H, 'attack6', 0.5, 'palm_wind', 'palm_hit', 0.55),
  C(H, 'heavy_charge', 0.6, true, [[0, 'heavy_charge'], [0.3, 'heavy_charge'], [0.6, 'heavy_charge']]),
  C(H, 'heavy', 0.45, false, [[0, 'heavy_charge'], [0.07, 'heavy_hit', 'back'], [0.28, 'heavy_hit'], [0.45, 'ready', 'inOut']]),
  C(H, 'heavy_air', 0.45, false, [[0, 'jump'], [0.12, 'axe_wind', 'out'], [0.2, 'axe_hit', 'back'], [0.45, 'axe_hit']]),
  strike(H, 'cast', 0.3, 'cast_wind', 'cast_hit'),
  C(H, 'cast_loop', 0.24, true, [[0, 'cast_hit'], [0.12, 'cast_wind', 'inOut'], [0.24, 'cast_hit', 'back']], 'upper'),
  C(H, 'beam_charge', 0.5, true, [[0, 'beam_charge'], [0.25, 'beam_charge_b', 'inOut'], [0.5, 'beam_charge', 'inOut']]),
  C(H, 'beam_loop', 0.3, true, [[0, 'beam_loop'], [0.3, 'beam_loop']]),
  C(H, 'beam_end', 0.35, false, [[0, 'beam_loop'], [0.12, 'beam_end', 'out'], [0.35, 'ready', 'inOut']]),
  C(H, 'burst', 0.55, false, [[0, 'curl'], [0.12, 'curl'], [0.18, 'burst', 'back'], [0.4, 'burst'], [0.55, 'ready', 'inOut']]),
  C(H, 'ult_rise', 0.8, false, [[0, 'curl'], [0.3, 'ult_rise', 'out'], [0.8, 'ult_rise']]),
  C(H, 'ult_dive', 0.6, false, [[0, 'ult_rise'], [0.15, 'ult_dive', 'in'], [0.6, 'ult_dive']]),
  C(H, 'talk', 1.2, true, [[0, 'talk_a'], [0.6, 'talk_b', 'inOut'], [1.2, 'talk_a', 'inOut']], 'upper'),
  C(H, 'interact', 0.6, false, [[0, 'idle'], [0.2, 'interact', 'out'], [0.4, 'interact'], [0.6, 'idle', 'inOut']]),
  C(H, 'victory', 1, false, [[0, 'ready'], [0.2, 'victory', 'back'], [1, 'victory']]),
  C(H, 'taunt', 1, false, [[0, 'ready'], [0.2, 'taunt', 'out'], [0.45, 'taunt'], [0.6, 'ready', 'inOut'], [0.75, 'taunt', 'out'], [1, 'ready', 'inOut']]),
  strike(H, 'bite', 0.4, 'shoulder_wind', 'lunge'),
  C(H, 'charge_windup', 0.6, true, [[0, 'shoulder_wind'], [0.6, 'shoulder_wind']]),
  C(H, 'charge', 0.5, true, [[0, 'shoulder_hit'], [0.5, 'shoulder_hit']]),
  C(H, 'slam', 0.6, false, [[0, 'ready'], [0.2, 'axe_wind', 'out'], [0.27, 'axe_hit', 'back'], [0.45, 'axe_hit'], [0.6, 'ready', 'inOut']]),
  strike(H, 'ranged', 0.35, 'cast_wind', 'cast_hit'),
  C(H, 'roar', 0.9, false, [[0, 'ready'], [0.2, 'roar', 'back'], [0.75, 'roar'], [0.9, 'ready', 'inOut']]),
];

const Q = 'quadruped';
const QUAD_DEFS = [
  C(Q, 'idle', 2, true, [[0, 'idle'], [1, 'idle_b', 'inOut'], [2, 'idle', 'inOut']]),
  C(Q, 'walk', 0.9, true, [[0, 'walk_c'], [0.225, 'walk_p'], [0.45, 'walk_c2'], [0.675, 'walk_p'], [0.9, 'walk_c']]),
  C(Q, 'run', 0.5, true, [[0, 'run_c'], [0.25, 'run_p', 'inOut'], [0.5, 'run_c', 'inOut']]),
  C(Q, 'fall', 0.6, true, [[0, 'fall'], [0.6, 'fall']]),
  C(Q, 'fly_hover', 0.6, true, [[0, 'fall'], [0.6, 'fall']]),
  C(Q, 'fly_cruise', 0.6, true, [[0, 'fall'], [0.6, 'fall']]),
  C(Q, 'hurtle', 0.5, true, [[0, 'hurtle'], [0.5, 'hurtle']]),
  C(Q, 'stagger', 0.5, false, [[0, 'idle'], [0.07, 'stagger', 'out'], [0.35, 'stagger'], [0.5, 'idle', 'inOut']]),
  C(Q, 'down', 0.5, false, [[0, 'stagger'], [0.3, 'down', 'in'], [0.5, 'down']]),
  C(Q, 'getup', 0.6, false, [[0, 'down'], [0.3, 'rise', 'inOut'], [0.6, 'idle', 'inOut']]),
  C(Q, 'death', 1, false, [[0, 'stagger'], [0.35, 'down', 'in'], [1, 'ko', 'out']]),
  C(Q, 'bite', 0.45, false, [[0, 'idle'], [0.12, 'bite_wind', 'out'], [0.2, 'bite_hit', 'back'], [0.32, 'bite_hit'], [0.45, 'idle', 'inOut']]),
  C(Q, 'attack1', 0.45, false, [[0, 'idle'], [0.12, 'bite_wind', 'out'], [0.2, 'bite_hit', 'back'], [0.32, 'bite_hit'], [0.45, 'idle', 'inOut']]),
  C(Q, 'charge_windup', 0.5, true, [[0, 'scrape'], [0.25, 'scrape_b', 'inOut'], [0.5, 'scrape', 'inOut']]),
  C(Q, 'charge', 0.4, true, [[0, 'charge'], [0.2, 'run_p', 'inOut'], [0.4, 'charge', 'inOut']]),
  C(Q, 'slam', 0.8, false, [[0, 'idle'], [0.3, 'rear', 'out'], [0.4, 'stomp', 'in'], [0.6, 'stomp'], [0.8, 'idle', 'inOut']]),
  C(Q, 'ranged', 0.5, false, [[0, 'idle'], [0.15, 'bite_wind', 'out'], [0.22, 'spit', 'back'], [0.36, 'spit'], [0.5, 'idle', 'inOut']]),
  C(Q, 'roar', 1, false, [[0, 'idle'], [0.2, 'roar', 'back'], [0.8, 'roar'], [1, 'idle', 'inOut']]),
  C(Q, 'guard', 1, true, [[0, 'guard'], [1, 'guard']]),
];

const F = 'flyer';
const FLYER_DEFS = [
  C(F, 'idle', 0.5, true, [[0, 'idle'], [0.25, 'idle_b', 'inOut'], [0.5, 'idle', 'inOut']]),
  C(F, 'walk', 0.6, true, [[0, 'perch'], [0.3, 'idle', 'inOut'], [0.6, 'perch', 'inOut']]),
  C(F, 'run', 1.4, true, [[0, 'glide'], [0.7, 'glide_b', 'inOut'], [1.4, 'glide', 'inOut']]),
  C(F, 'fall', 1.4, true, [[0, 'glide'], [0.7, 'glide_b', 'inOut'], [1.4, 'glide', 'inOut']]),
  C(F, 'fly_hover', 0.45, true, [[0, 'idle'], [0.22, 'idle_b', 'inOut'], [0.45, 'idle', 'inOut']]),
  C(F, 'fly_cruise', 1.6, true, [[0, 'glide'], [0.5, 'glide_b', 'inOut'], [0.8, 'idle', 'inOut'], [1.0, 'idle_b', 'inOut'], [1.2, 'glide', 'inOut'], [1.6, 'glide']]),
  C(F, 'fly_boost', 0.4, true, [[0, 'dive'], [0.4, 'dive']]),
  C(F, 'hurtle', 0.5, true, [[0, 'tumble'], [0.5, 'tumble']]),
  C(F, 'stagger', 0.45, false, [[0, 'idle'], [0.06, 'stagger', 'out'], [0.3, 'stagger'], [0.45, 'idle', 'inOut']]),
  C(F, 'down', 0.5, false, [[0, 'stagger'], [0.3, 'down', 'in'], [0.5, 'down']]),
  C(F, 'getup', 0.6, false, [[0, 'down'], [0.3, 'perch', 'inOut'], [0.6, 'idle', 'inOut']]),
  C(F, 'death', 0.9, false, [[0, 'stagger'], [0.3, 'tumble', 'in'], [0.9, 'down', 'out']]),
  C(F, 'bite', 0.4, false, [[0, 'idle'], [0.1, 'peck_wind', 'out'], [0.17, 'peck_hit', 'back'], [0.28, 'peck_hit'], [0.4, 'idle', 'inOut']]),
  C(F, 'attack1', 0.4, false, [[0, 'idle'], [0.1, 'peck_wind', 'out'], [0.17, 'peck_hit', 'back'], [0.28, 'peck_hit'], [0.4, 'idle', 'inOut']]),
  C(F, 'charge_windup', 0.6, true, [[0, 'fold'], [0.6, 'fold']]),
  C(F, 'charge', 0.4, true, [[0, 'dive'], [0.4, 'dive']]),
  C(F, 'slam', 0.7, false, [[0, 'idle'], [0.25, 'beat_wind', 'out'], [0.33, 'beat_hit', 'back'], [0.5, 'beat_hit'], [0.7, 'idle', 'inOut']]),
  C(F, 'ranged', 0.45, false, [[0, 'idle'], [0.12, 'beat_wind', 'out'], [0.2, 'flick', 'back'], [0.32, 'flick'], [0.45, 'idle', 'inOut']]),
  C(F, 'roar', 0.9, false, [[0, 'idle'], [0.2, 'shriek', 'back'], [0.75, 'shriek'], [0.9, 'idle', 'inOut']]),
];

const B = 'blob';
const BLOB_DEFS = [
  C(B, 'idle', 1.6, true, [[0, 'idle'], [0.8, 'idle_b', 'inOut'], [1.6, 'idle', 'inOut']]),
  C(B, 'walk', 1.2, true, [[0, 'drift'], [0.6, 'idle_b', 'inOut'], [1.2, 'drift', 'inOut']]),
  C(B, 'run', 0.8, true, [[0, 'drift'], [0.4, 'stretch', 'inOut'], [0.8, 'drift', 'inOut']]),
  C(B, 'fall', 0.8, true, [[0, 'idle_b'], [0.8, 'idle_b']]),
  C(B, 'fly_hover', 1.6, true, [[0, 'idle'], [0.8, 'idle_b', 'inOut'], [1.6, 'idle', 'inOut']]),
  C(B, 'fly_cruise', 1.2, true, [[0, 'drift'], [0.6, 'stretch', 'inOut'], [1.2, 'drift', 'inOut']]),
  C(B, 'hurtle', 0.4, true, [[0, 'tilt'], [0.4, 'tilt']]),
  C(B, 'stagger', 0.45, false, [[0, 'idle'], [0.06, 'tilt', 'out'], [0.3, 'tilt'], [0.45, 'idle', 'inOut']]),
  C(B, 'down', 0.5, false, [[0, 'tilt'], [0.3, 'flat', 'in'], [0.5, 'flat']]),
  C(B, 'getup', 0.5, false, [[0, 'flat'], [0.25, 'stretch', 'out'], [0.5, 'idle', 'inOut']]),
  C(B, 'death', 0.8, false, [[0, 'swell'], [0.3, 'flat', 'in'], [0.8, 'gone', 'in']]),
  C(B, 'bite', 0.45, false, [[0, 'idle'], [0.15, 'squash', 'out'], [0.22, 'lunge', 'back'], [0.32, 'lunge'], [0.45, 'idle', 'inOut']]),
  C(B, 'attack1', 0.45, false, [[0, 'idle'], [0.15, 'squash', 'out'], [0.22, 'lunge', 'back'], [0.32, 'lunge'], [0.45, 'idle', 'inOut']]),
  C(B, 'charge_windup', 0.4, true, [[0, 'squash'], [0.2, 'pulse', 'inOut'], [0.4, 'squash', 'inOut']]),
  C(B, 'charge', 0.4, true, [[0, 'stretch'], [0.4, 'stretch']]),
  C(B, 'slam', 0.7, false, [[0, 'idle'], [0.25, 'swell', 'out'], [0.32, 'squash', 'back'], [0.5, 'squash'], [0.7, 'idle', 'inOut']]),
  C(B, 'ranged', 0.45, false, [[0, 'idle'], [0.15, 'squash', 'out'], [0.22, 'pulse', 'back'], [0.33, 'pulse'], [0.45, 'idle', 'inOut']]),
  C(B, 'roar', 0.8, false, [[0, 'idle'], [0.2, 'swell', 'back'], [0.65, 'swell'], [0.8, 'idle', 'inOut']]),
];

/** Every clip definition, registered as defs kind `clip`. */
export const CLIP_DEFS = Object.freeze([...HUMANOID_DEFS, ...QUAD_DEFS, ...FLYER_DEFS, ...BLOB_DEFS]);

/**
 * @typedef {{ id:string, fam:string, seconds:number, loop:boolean, upper:boolean, times:Float32Array, poses:Float32Array[], eases:Array<string|undefined> }} Clip
 */

/** @type {Map<string, Clip|null>} */
const cache = new Map();

/** @param {any} def @returns {Clip} */
export function compileClip(def) {
  const fam = def.rig;
  const n = def.keys.length;
  const times = new Float32Array(n);
  const poses = [];
  const eases = [];
  for (let i = 0; i < n; i++) {
    const k = def.keys[i];
    times[i] = k.t;
    const p = pose(fam, k.pose);
    if (!p) throw new Error('clip ' + def.id + ': unknown pose ' + k.pose);
    poses.push(p);
    eases.push(k.ease);
  }
  return { id: def.id, fam, seconds: def.seconds, loop: !!def.loop, upper: def.layer === 'upper', times, poses, eases };
}

/** @param {string} id full clip def id ('humanoid.attack1') @returns {Clip|null} */
export function clipById(id) {
  let c = cache.get(id);
  if (c === undefined) {
    let def = null;
    for (const d of CLIP_DEFS) if (d.id === id) def = d;
    c = def ? compileClip(def) : null;
    cache.set(id, c);
  }
  return c;
}

/**
 * The clip of a rig for a standard id, with the 4.5 fallback (attack1, then idle) when it is missing.
 * @param {string} rig @param {string} clipId @param {Record<string,string>|null} [overrides] spec.clips
 * @returns {{ clip:Clip|null, fallback:boolean }}
 */
export function resolveClip(rig, clipId, overrides) {
  const fam = family(rig);
  const o = overrides && overrides[clipId] ? clipById(overrides[clipId]) : null;
  if (o) return { clip: o, fallback: false };
  const c = clipById(fam + '.' + clipId);
  if (c) return { clip: c, fallback: false };
  return { clip: clipById(fam + '.attack1') || clipById(fam + '.idle'), fallback: true };
}

/**
 * Sample a clip at `t` seconds into `out` (looping clips wrap; one-shots clamp).
 * @param {Clip} clip @param {number} t @param {Float32Array} out
 */
export function sampleClip(clip, t, out) {
  const T = clip.times;
  const n = T.length;
  let u = t;
  if (clip.loop && clip.seconds > 0) {
    u = t % clip.seconds;
    if (u < 0) u += clip.seconds;
  }
  if (u <= T[0] || n === 1) return blendPose(clip.poses[0], clip.poses[0], 0, out);
  if (u >= T[n - 1]) return blendPose(clip.poses[n - 1], clip.poses[n - 1], 0, out);
  let i = 0;
  while (i < n - 2 && u >= T[i + 1]) i++;
  const span = T[i + 1] - T[i];
  const w = span > 0 ? ease((u - T[i]) / span, clip.eases[i + 1]) : 1;
  return blendPose(clip.poses[i], clip.poses[i + 1], w, out);
}

/** @param {string} rig @returns {number} floats per pose of a rig */
export function rigPoseSize(rig) {
  return poseSize(family(rig));
}
