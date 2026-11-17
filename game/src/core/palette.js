/**
 * Colour tokens (ARCHITECTURE 5.12, ART_UX 1.2-1.4 and 1.10). Every colour in the game comes from here.
 * Colours are numeric hex (display-referred sRGB). Pure module.
 * @module core/palette
 */

/** @param {object} o @returns {object} */
function deepFreeze(o) {
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  }
  return Object.freeze(o);
}

/**
 * @typedef {{ ground:number, shade:number, cliff:number, foliage:number, accent:number, fog:number }} BiomePalette
 *   ART_UX 1.3 columns: ground, groundShade (shade), cliff, foliage, accent, fogDay (fog).
 */
/**
 * @typedef {{ key:'dawn'|'day'|'golden'|'dusk'|'night', hour:number, sun:number, intensity:number, ambSky:number,
 *             ambGround:number, fogTint:number|null, shadowTint:number }} DayKey
 *   fogTint null = use the region's fogDay colour (the Day key). At night `sun` is the moon colour.
 */

export const PALETTE = deepFreeze({
  ink: 0x1b1626,
  paper: 0xf3ebdd,
  hostile: 0x7b3cff,
  ora: 0x7ff2e0,
  oraCore: 0xffffff,
  ember: 0xffb070,
  tempest: 0x8fa8ff,
  zenith: 0xf4f1ff,
  kerrin: 0x6cff9a,
  telegraph: { white: 0xffffff, red: 0xff3b3b, violet: 0xb06cff },
  rarity: { common: 0xf3ebdd, fine: 0x7fd18b, rare: 0x5fb6ff },
  ocean: { deep: 0x1c4e6e, shallow: 0x3fa3a8, foam: 0xf4f1e6 },
  path: 0xc2a178,
  snow: 0xf4f7fa,
  scorch: 0x2e2530,
  scorchRim: 0xff9a4a,
  corruption: 0x3a3344,
  /** @type {Record<string, BiomePalette>} keyed by region id */
  biome: {
    meadows: { ground: 0x9dbf5a, shade: 0x4e7a4a, cliff: 0xc9a77c, foliage: 0x6fa347, accent: 0xe8c547, fog: 0xbfd8e6 },
    coast: { ground: 0xe9dcc0, shade: 0xb79e86, cliff: 0xd9c3a5, foliage: 0x8fa78c, accent: 0x5fd3d0, fog: 0xcfe8ea },
    thornwood: { ground: 0x4f7a5f, shade: 0x26453e, cliff: 0x6d7466, foliage: 0x2f6b57, accent: 0xc77dd8, fog: 0x9fb7b0 },
    rustdune: { ground: 0xd9925a, shade: 0x9a5a3c, cliff: 0xb5533a, foliage: 0x8c8a4c, accent: 0x4fc3b0, fog: 0xf0cfa8 },
    frostspine: { ground: 0xeef3f7, shade: 0x9bb3ce, cliff: 0x7d8aa3, foliage: 0x4c6e78, accent: 0x7fd1ff, fog: 0xdce7f2 },
    stormwell: { ground: 0x56616b, shade: 0x2c3540, cliff: 0x3f4852, foliage: 0x3e6e5e, accent: 0x8cff9e, fog: 0x7f8e96 },
    spire: { ground: 0xd8d2ec, shade: 0x8e86b8, cliff: 0xb9b0dd, foliage: 0x7fbfae, accent: 0xffffff, fog: 0xd5cff0 },
  },
  /** Secondary flora colours named in ART_UX 1.3 and 1.9. */
  flora: { redLeaf: 0xc8553a, brambleFlower: 0xc77dd8 },
  /** @type {DayKey[]} the five keys of ART_UX 1.4, in day order */
  day: [
    { key: 'dawn', hour: 5.5, sun: 0xffb38a, intensity: 0.8, ambSky: 0x8fa6d8, ambGround: 0x6b5a6e, fogTint: 0xf2c7b5, shadowTint: 0x5a4a7a },
    { key: 'day', hour: 12, sun: 0xfff4de, intensity: 1.25, ambSky: 0xa8d4f2, ambGround: 0x8a9a6a, fogTint: null, shadowTint: 0x4a5a8a },
    { key: 'golden', hour: 17.5, sun: 0xffc56b, intensity: 1.0, ambSky: 0xe8b98f, ambGround: 0x7a6a50, fogTint: 0xf5cfa0, shadowTint: 0x6a4a7a },
    { key: 'dusk', hour: 19.5, sun: 0xff7e6b, intensity: 0.45, ambSky: 0x5c5a9a, ambGround: 0x3a3550, fogTint: 0x9a7fa8, shadowTint: 0x3a2f5a },
    { key: 'night', hour: 0, sun: 0xafc4ff, intensity: 0.35, ambSky: 0x1e2a4e, ambGround: 0x141a2a, fogTint: 0x2a3558, shadowTint: 0x1a1f3a },
  ],
  /** Sky gradient and painted cloud tones (ART_UX 1.6). */
  sky: { zenith: 0x4f8fd6, horizon: 0xcde6f2, cloud: [0xffffff, 0xe4e9f2, 0xb8c2da] },
  structure: {
    clay: 0xede3d0, terracotta: 0xb4644a, copper: 0x5e9e8a, curtain: 0x1f5c63, lantern: 0xffb65c, ringstone: 0x7fe3d4,
    kites: [0xe8c547, 0xc8463a, 0x3f7fbf],
  },
  /** Blob shadow colour (ART_UX 1.5) and explosion smoke (ART_UX 3.2). */
  blob: 0x1a1f3a,
  smoke: 0x3a3346,
});
