/**
 * Quality tiers (ARCHITECTURE 7.1) and the tier choice rule. Pure module: no three, no DOM.
 * @module render/logic/tiers
 */

/**
 * @typedef {object} TierCaps
 * @property {'low'|'high'} tier
 * @property {number} targetFps
 * @property {number} maxDpr
 * @property {{ min:number, max:number, step:number, interval:number, resize:boolean }} dynRes
 * @property {number} drawCalls @property {number} triangles
 * @property {ReadonlyArray<number>} lodRanges
 * @property {number} chunkBuilds @property {number} treeRadius @property {number} rockRadius
 * @property {number} tuftRadius   ground tufts (world/tufts): radius around the player in metres (one draw call)
 * @property {number} tuftDensity  ground tufts: multiplier on the per-region clump density (0..1)
 * @property {number} tuftInstances ground tufts: instance cap
 * @property {number} treeInstances @property {number} rockInstances @property {number} programs @property {boolean} antialias
 * @property {number} sfxVariants @property {number} vegetationDrawCalls @property {'blob'|'map1024'|'map2048'} shadows
 * @property {number} shadowSize   shadow map texels per side (0: blob shadows only)
 * @property {number} shadowHalf   half the side of the shadow box around the player (metres)
 * @property {boolean} calibrate   start-up calibration of the pixel ratio (render/logic/calib)
 * @property {boolean} bloom @property {'nearest6'|'range100'} outlines @property {number} outlineNearest
 * @property {number} outlineCharRange @property {number} outlinePropRange
 * @property {number} cloudLayers @property {boolean} waterWaves @property {number} particles @property {number} pointLights
 * @property {number} activeEnemies @property {number} animatedActors @property {number} projectiles @property {number} audioVoices
 * @property {'delay'|'convolver'} reverb @property {number} farPlane @property {number} afterimages
 */

/**
 * The rows of the 7.1 table, with the render polish changes: the low tier may render up to device pixel ratio 2
 * (maxDpr; the start-up calibration finds the ratio the device holds, from 1.0, and dynamic resolution keeps it, never
 * below 0.6) and has a 1024 shadow map over a 40 m box (shed first when the device struggles). Frozen. The table's 'grass radius' row (low 0) is replaced by the tuft rows: the lead
 * kept the ground tufts on the low tier (one draw call), smaller and sparser than on high.
 */
/** @type @type {Readonly<{low:TierCaps, high:TierCaps}>} */
export const TIERS = Object.freeze({
  low: Object.freeze({
    tier: 'low', targetFps: 30, maxDpr: 2, dynRes: Object.freeze({ min: 0.6, max: 1, step: 0.1, interval: 3, resize: true }),
    drawCalls: 120, triangles: 250000, lodRanges: Object.freeze([256, 512, 1152]), chunkBuilds: 1,
    treeRadius: 400, rockRadius: 300, tuftRadius: 22, tuftDensity: 0.75, tuftInstances: 800, treeInstances: 1200, rockInstances: 600, programs: 30, antialias: true,
    sfxVariants: 2, vegetationDrawCalls: 12, shadows: 'map1024', shadowSize: 1024, shadowHalf: 20, calibrate: true, bloom: false, outlines: 'nearest6', outlineNearest: 6,
    outlineCharRange: 120, outlinePropRange: 0, cloudLayers: 1, waterWaves: false,
    particles: 800, pointLights: 0, activeEnemies: 12, animatedActors: 8, projectiles: 96, audioVoices: 24, reverb: 'delay', farPlane: 9000,
    afterimages: 1,
  }),
  high: Object.freeze({
    tier: 'high', targetFps: 60, maxDpr: 2, dynRes: Object.freeze({ min: 0.8, max: 1, step: 0.05, interval: 0.5, resize: false }),
    drawCalls: 350, triangles: 1200000, lodRanges: Object.freeze([512, 1024, 1792]), chunkBuilds: 3,
    treeRadius: 900, rockRadius: 700, tuftRadius: 30, tuftDensity: 1, tuftInstances: 1700, treeInstances: 4000, rockInstances: 2000, programs: 32, antialias: true,
    sfxVariants: 3, vegetationDrawCalls: 30, shadows: 'map2048', shadowSize: 2048, shadowHalf: 45, calibrate: false, bloom: true, outlines: 'range100', outlineNearest: 64,
    outlineCharRange: 100, outlinePropRange: 40, cloudLayers: 2, waterWaves: true,
    particles: 3500, pointLights: 2, activeEnemies: 24, animatedActors: 20, projectiles: 256, audioVoices: 32, reverb: 'convolver', farPlane: 9000,
    afterimages: 3,
  }),
});

/** Every key a tier row must carry (used by the tier table test). */
export const TIER_KEYS = Object.freeze(Object.keys(TIERS.low));

/**
 * The tier choice of 7.1: `?quality` > saved setting > auto (touch devices low, desktops high).
 * A software rasteriser is treated like a phone.
 * @param {{ flag?:string|null, setting?:string|null, coarse?:boolean, software?:boolean }} info
 * @returns {'low'|'high'}
 */
export function chooseTier(info) {
  const f = info.flag;
  if (f === 'low' || f === 'high') return f;
  const s = info.setting;
  if (s === 'low' || s === 'high') return s;
  if (info.coarse || info.software) return 'low';
  return 'high';
}
