/**
 * Pure day logic (ART_UX 1.4-1.6, ARCHITECTURE 4.2): the clock, day phases, the five lighting keys interpolated in
 * linear space, sky key colours, the sun and moon paths, and the night, lantern and fog-density curves.
 * No three, no DOM: Node tests load this module. Colours are returned as linear-space floats in [r, g, b] arrays.
 * @module env/logic/day
 */

import { PALETTE } from '../../core/palette.js';

/** Real seconds per game hour at clock scale 1 (one game day per 24 real minutes). */
export const SECONDS_PER_HOUR = 60;

/** Fog density (ART_UX 1.5): base and dawn peak. */
export const FOG_DENSITY = 0.00018;
export const FOG_DENSITY_DAWN = 0.00028;

/**
 * Day phase of an hour.
 * @param {number} h 0..24 @returns {'dawn'|'day'|'golden'|'dusk'|'night'}
 */
export function phaseOf(h) {
  if (h >= 5 && h < 8) return 'dawn';
  if (h >= 8 && h < 16.5) return 'day';
  if (h >= 16.5 && h < 19) return 'golden';
  if (h >= 19 && h < 21) return 'dusk';
  return 'night';
}

/** @param {number} c 0..1 sRGB channel @returns {number} linear */
export function srgbToLinear(c) {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

/** @param {number} hex @returns {number[]} linear rgb */
export function hexToLinear(hex) {
  return [srgbToLinear(((hex >> 16) & 255) / 255), srgbToLinear(((hex >> 8) & 255) / 255), srgbToLinear((hex & 255) / 255)];
}

/** @param {number[]} a @param {number[]} b @param {number} t @returns {number[]} */
function mixArr(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** @param {number[]} a @param {number} k @returns {number[]} */
function scaleArr(a, k) {
  return [a[0] * k, a[1] * k, a[2] * k];
}

const KEY_BY_NAME = Object.fromEntries(PALETTE.day.map((k) => [k.key, k]));

/**
 * Zenith colour of the sky dome per key (ART_UX 1.6 gives the Day zenith; the other keys are derived from the
 * palette: the key's ambient sky pulled toward the day zenith, darker at night).
 */
const ZENITH = {
  dawn: mixArr(hexToLinear(KEY_BY_NAME.dawn.ambSky), hexToLinear(PALETTE.sky.zenith), 0.45),
  day: hexToLinear(PALETTE.sky.zenith),
  golden: mixArr(hexToLinear(PALETTE.sky.zenith), hexToLinear(KEY_BY_NAME.golden.ambSky), 0.3),
  dusk: mixArr(hexToLinear(KEY_BY_NAME.dusk.ambSky), hexToLinear(KEY_BY_NAME.night.ambSky), 0.45),
  night: scaleArr(hexToLinear(KEY_BY_NAME.night.ambSky), 0.5),
};

/**
 * @typedef {{ key:string, hour:number, sun:number[], intensity:number, ambSky:number[], ambGround:number[],
 *             fog:number[]|null, shadow:number[], zenith:number[] }} LinearKey
 */

/** The five keys in hour order (night first at 0) with the night key repeated at 24. @type {LinearKey[]} */
export const KEYS = (() => {
  const list = PALETTE.day.map((k) => ({
    key: k.key, hour: k.hour, sun: hexToLinear(k.sun), intensity: k.intensity, ambSky: hexToLinear(k.ambSky),
    ambGround: hexToLinear(k.ambGround), fog: k.fogTint === null ? null : hexToLinear(k.fogTint), shadow: hexToLinear(k.shadowTint),
    zenith: ZENITH[k.key],
  }));
  list.sort((a, b) => a.hour - b.hour);
  list.push(Object.assign({}, list[0], { hour: 24 }));
  return list;
})();

/**
 * The key segment containing hour h.
 * @param {number} h 0..24 @param {{ i:number, t:number }} out @returns {{ i:number, t:number }}
 */
export function keySegment(h, out) {
  const hh = h < 0 ? 0 : h > 24 ? 24 : h;
  let i = 0;
  while (i < KEYS.length - 2 && hh >= KEYS[i + 1].hour) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = (hh - a.hour) / (b.hour - a.hour);
  out.i = i;
  out.t = t < 0 ? 0 : t > 1 ? 1 : t;
  return out;
}

/**
 * @typedef {{ sun:number[], intensity:number, ambSky:number[], ambGround:number[], fog:number[], shadow:number[], zenith:number[] }} DaySample
 */

/** @returns {DaySample} a preallocated sample object */
export function createSample() {
  return { sun: [0, 0, 0], intensity: 0, ambSky: [0, 0, 0], ambGround: [0, 0, 0], fog: [0, 0, 0], shadow: [0, 0, 0], zenith: [0, 0, 0] };
}

const SEG = { i: 0, t: 0 };

/** @param {number[]} out @param {number[]} a @param {number[]} b @param {number} t */
function lerp3(out, a, b, t) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

/**
 * Interpolate the five keys at hour h, in linear space, without allocating.
 * @param {number} h 0..24
 * @param {number[]} regionFog linear rgb of the region's fogDay (used where a key's fog tint is null: the Day key)
 * @param {DaySample} out
 * @returns {DaySample}
 */
export function sampleDay(h, regionFog, out) {
  keySegment(h, SEG);
  const a = KEYS[SEG.i];
  const b = KEYS[SEG.i + 1];
  const t = SEG.t;
  lerp3(out.sun, a.sun, b.sun, t);
  out.intensity = a.intensity + (b.intensity - a.intensity) * t;
  lerp3(out.ambSky, a.ambSky, b.ambSky, t);
  lerp3(out.ambGround, a.ambGround, b.ambGround, t);
  lerp3(out.shadow, a.shadow, b.shadow, t);
  lerp3(out.zenith, a.zenith, b.zenith, t);
  lerp3(out.fog, a.fog || regionFog, b.fog || regionFog, t);
  return out;
}

/** @param {number} x @param {number} a @param {number} b @returns {number} smoothstep */
function smooth(x, a, b) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Night weight 0..1: 1 from 21:00 to 04:00, ramps over dusk and dawn. Drives the moon as the light, stars and the Seam.
 * @param {number} h @returns {number}
 */
export function nightFactor(h) {
  if (h >= 12) return smooth(h, 19.2, 21);
  return 1 - smooth(h, 4, 5.8);
}

/**
 * Lantern weight 0..1: village lanterns light at dusk (18:30-19:30) and go out after dawn (06:00-07:00).
 * @param {number} h @returns {number}
 */
export function lanternFactor(h) {
  if (h >= 12) return smooth(h, 18.5, 19.5);
  return 1 - smooth(h, 6, 7);
}

/**
 * Fog density by hour: 0.00018, rising to 0.00028 around dawn (05:30).
 * @param {number} h @returns {number}
 */
export function fogDensity(h) {
  const d = Math.abs(h - 5.5);
  return FOG_DENSITY + (FOG_DENSITY_DAWN - FOG_DENSITY) * Math.max(0, 1 - d / 1.6);
}

/**
 * True sun direction (unit, toward the sun): rises in the east (+x) at 06:00, culminates in the south (+z) at noon at
 * about 58 degrees, sets in the west at 18:00. Below the horizon at night.
 * @param {number} h @param {{x:number,y:number,z:number}} out
 */
export function sunDirection(h, out) {
  const a = ((h - 6) / 12) * Math.PI;
  const x = Math.cos(a);
  const y = Math.sin(a) * 0.86;
  const z = 0.42;
  const l = Math.sqrt(x * x + y * y + z * z);
  out.x = x / l;
  out.y = y / l;
  out.z = z / l;
  return out;
}

/**
 * Moon direction (unit): opposite phase to the sun, culminating at midnight in the north-east sky.
 * @param {number} h @param {{x:number,y:number,z:number}} out
 */
export function moonDirection(h, out) {
  const a = ((h - 18) / 12) * Math.PI;
  const x = Math.cos(a) * 0.8;
  const y = Math.sin(a) * 0.9;
  const z = -0.38;
  const l = Math.sqrt(x * x + y * y + z * z);
  out.x = x / l;
  out.y = y / l;
  out.z = z / l;
  return out;
}

/**
 * Light direction (render.globals.uSunDir): the sun by day, the moon by night, blended across the night ramp, and
 * held at least 9 degrees above the horizon so the toon bands stay readable.
 * @param {number} h @param {{x:number,y:number,z:number}} sun scratch @param {{x:number,y:number,z:number}} moon scratch
 * @param {{x:number,y:number,z:number}} out
 */
export function lightDirection(h, sun, moon, out) {
  sunDirection(h, sun);
  moonDirection(h, moon);
  const n = nightFactor(h);
  let x = sun.x + (moon.x - sun.x) * n;
  let y = Math.max(sun.y, 0.16) + (Math.max(moon.y, 0.35) - Math.max(sun.y, 0.16)) * n;
  let z = sun.z + (moon.z - sun.z) * n;
  if (y < 0.16) y = 0.16;
  const l = Math.sqrt(x * x + y * y + z * z) || 1;
  out.x = x / l;
  out.y = y / l;
  out.z = z / l;
  return out;
}

/**
 * Advance the clock by dt sim seconds at a clock scale (1 = one day per 24 real minutes).
 * @param {{ hour:number, day:number }} s mutated
 * @param {number} dt @param {number} scale
 * @returns {boolean} true when the day rolled over
 */
export function advanceClock(s, dt, scale) {
  if (!(scale > 0) || !(dt > 0)) return false;
  let h = s.hour + (dt * scale) / SECONDS_PER_HOUR;
  let rolled = false;
  while (h >= 24) {
    h -= 24;
    s.day += 1;
    rolled = true;
  }
  s.hour = h;
  return rolled;
}

/** @param {number} h @returns {number} hour wrapped into [0, 24) */
export function wrapHour(h) {
  const n = Number(h);
  if (!Number.isFinite(n)) return 0;
  return ((n % 24) + 24) % 24;
}
