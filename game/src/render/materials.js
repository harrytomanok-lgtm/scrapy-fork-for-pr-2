/**
 * The toon material family (ARCHITECTURE 4.3, ART_UX 1.7): toon, toonSkinned, unlit (normal and additive) and the
 * outline hull material. Every call returns a new ShaderMaterial; all instances of a family share one shader source,
 * so three caches one program per geometry kind. Options are uniforms or render state only.
 *
 * Program economy: three keys programs on an "opaque" flag (transparent false and NormalBlending). Every material
 * here uses an equivalent CustomBlending (src alpha, one minus src alpha) instead, so toggling `transparent` at run
 * time (ghosting) never links a new program.
 * @module render/materials
 */

import {
  ShaderMaterial, Color, Vector4, AdditiveBlending, CustomBlending, SrcAlphaFactor, OneMinusSrcAlphaFactor, OneFactor,
  DoubleSide, FrontSide, BackSide, AddEquation,
} from 'three';
import { PALETTE } from '../core/palette.js';
import { TOON_VERT, TOON_FRAG, UNLIT_VERT, UNLIT_FRAG, OUTLINE_VERT, OUTLINE_FRAG } from './glsl.js';

/** Default attribute values so meshes without colour or palette attributes still draw. */
const DEFAULT_ATTRS = Object.freeze({ color: [1, 1, 1], uv: [0, 0], uv1: [0, 0], paletteIndex: [0] });

/**
 * Apply the program-neutral normal blend to a material.
 * @param {any} m
 */
export function normalBlend(m) {
  m.blending = CustomBlending;
  m.blendEquation = AddEquation;
  m.blendSrc = SrcAlphaFactor;
  m.blendDst = OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = OneFactor;
  m.blendDstAlpha = OneMinusSrcAlphaFactor;
}

/**
 * @typedef {{ color?:number, vertexColors?:boolean, palette?:boolean, glossy?:boolean, emissive?:number, emissiveIntensity?:number,
 *             wind?:boolean, instanced?:boolean, transparent?:boolean, doubleSide?:boolean, fogScale?:number }} ToonOpts
 */

/**
 * @param {Record<string, {value:any}>} globals   render.globals
 * @param {Record<string, {value:any}>} internal  gfx-private shared uniforms (point lights, viewport, ink)
 */
export function createMaterials(globals, internal) {
  /** @param {object} own @returns {object} */
  function withGlobals(own) {
    return Object.assign(own, {
      uTime: globals.uTime, uWind: globals.uWind, uSunDir: globals.uSunDir, uSunColor: globals.uSunColor,
      uAmbSky: globals.uAmbSky, uAmbGround: globals.uAmbGround, uShadowTint: globals.uShadowTint,
      uFogColor: globals.uFogColor, uFogDensity: globals.uFogDensity, uFogHeight: globals.uFogHeight,
      uGlobalRim: globals.uRimColor, uCamPos: globals.uCamPos,
    });
  }

  /**
   * @param {ToonOpts} [opts]
   * @returns {ShaderMaterial}
   */
  function toon(opts) {
    const o = opts || {};
    const palette = [];
    for (let i = 0; i < 16; i++) palette.push(new Color(PALETTE.paper));
    const hasEm = typeof o.emissive === 'number';
    const mat = new ShaderMaterial({
      uniforms: withGlobals({
        uColor: { value: new Color(typeof o.color === 'number' ? o.color : PALETTE.paper) },
        uVertexColors: { value: o.vertexColors ? 1 : 0 },
        uUsePalette: { value: o.palette ? 1 : 0 },
        uPalette: { value: palette },
        uEmissive: { value: new Float32Array(16) },
        uEmissiveColor: { value: new Color(hasEm ? o.emissive : 0x000000) },
        uEmissiveIntensity: { value: hasEm ? (typeof o.emissiveIntensity === 'number' ? o.emissiveIntensity : 1) : 0 },
        uGlossy: { value: o.glossy ? 1 : 0 },
        uWindOn: { value: o.wind ? 1 : 0 },
        uNearHide: { value: 0 },
        uRimColor: { value: new Color(PALETTE.ora) },
        uRimStrength: { value: 0 },
        uCharRim: { value: 0 },
        uDissolve: { value: 0 },
        uFlash: { value: 0 },
        uGhost: { value: 1 },
        uFogScale: { value: typeof o.fogScale === 'number' ? o.fogScale : 1 },
        uPointPos0: internal.uPointPos0, uPointPos1: internal.uPointPos1,
        uPointCol0: internal.uPointCol0, uPointCol1: internal.uPointCol1,
      }),
      vertexShader: TOON_VERT,
      fragmentShader: TOON_FRAG,
      vertexColors: true,
      transparent: !!o.transparent,
      side: o.doubleSide ? DoubleSide : FrontSide,
    });
    normalBlend(mat);
    mat.defaultAttributeValues = DEFAULT_ATTRS;
    mat.name = 'gfx.toon';
    return mat;
  }

  /**
   * @param {{ color?:number, additive?:boolean, map?:any, depthWrite?:boolean, transparent?:boolean, fog?:boolean }} [opts]
   * @returns {ShaderMaterial}
   */
  function unlit(opts) {
    const o = opts || {};
    const transparent = !!(o.transparent || o.additive);
    const mat = new ShaderMaterial({
      uniforms: withGlobals({
        uColor: { value: new Color(typeof o.color === 'number' ? o.color : 0xffffff) },
        uOpacity: { value: 1 },
        uUseMap: { value: o.map ? 1 : 0 },
        uMap: { value: o.map || null },
        uFogOn: { value: o.fog === false ? 0 : 1 },
        uAdditive: { value: o.additive ? 1 : 0 },
      }),
      vertexShader: UNLIT_VERT,
      fragmentShader: UNLIT_FRAG,
      vertexColors: true,
      transparent,
      depthWrite: typeof o.depthWrite === 'boolean' ? o.depthWrite : !transparent,
    });
    if (o.additive) mat.blending = AdditiveBlending;
    else normalBlend(mat);
    mat.defaultAttributeValues = DEFAULT_ATTRS;
    mat.name = 'gfx.unlit';
    return mat;
  }

  /**
   * Hull material for an outlined mesh: shares the target's palette, wind, ghost and dissolve uniforms.
   * @param {any} target  the outlined mesh's material (any; non-toon materials get defaults)
   * @param {number} widthPx
   * @param {number|undefined} color  explicit outline colour (otherwise base x 0.25 toward ink)
   * @returns {ShaderMaterial}
   */
  function outline(target, widthPx, color) {
    const tu = (target && target.uniforms) || {};
    /** @param {string} k @param {any} v */
    const pick = (k, v) => (tu[k] ? tu[k] : { value: v });
    const palette = [];
    for (let i = 0; i < 16; i++) palette.push(new Color(PALETTE.paper));
    const col = new Vector4(0, 0, 0, 0);
    if (typeof color === 'number') {
      const c = new Color(color);
      col.set(c.r, c.g, c.b, 1);
    }
    const mat = new ShaderMaterial({
      uniforms: withGlobals({
        uColor: pick('uColor', new Color(PALETTE.paper)),
        uVertexColors: pick('uVertexColors', 0),
        uUsePalette: pick('uUsePalette', 0),
        uPalette: pick('uPalette', palette),
        uWindOn: pick('uWindOn', 0),
        uGhost: pick('uGhost', 1),
        uDissolve: pick('uDissolve', 0),
        uWidthPx: { value: widthPx > 0 ? widthPx : 2 },
        uViewport: internal.uViewport,
        uInk: internal.uInk,
        uOutlineColor: { value: col },
      }),
      vertexShader: OUTLINE_VERT,
      fragmentShader: OUTLINE_FRAG,
      vertexColors: true,
      side: BackSide,
    });
    normalBlend(mat);
    mat.defaultAttributeValues = DEFAULT_ATTRS;
    mat.name = 'gfx.outline';
    return mat;
  }

  return { toon, toonSkinned: toon, unlit, outline };
}
