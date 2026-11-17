/**
 * Stand-in `ctx.render` (ARCHITECTURE 4.3, 8.0): renderer, scene, camera, layers, shared lighting globals,
 * a three-band toon shader family (static, skinned and instanced geometry with palette support), an unlit
 * material, the tier table of 7.1 with a fixed scale, `project`, `screenRay` and `stats`. Blob shadows are a
 * simple instanced disc batch; outlines, point lights and the screen-space effects are no-ops.
 * Replaced by the gfx package.
 * @module standins/render
 */

import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, ShaderMaterial, Color, Vector3, Matrix4,
  AdditiveBlending, NormalBlending, DoubleSide, FrontSide, InstancedMesh, CircleGeometry,
} from 'three';
import { PALETTE } from '../core/palette.js';
import { TMP } from '../core/math.js';

const OWNER = 'standin:render';

/** Quality tier rows of ARCHITECTURE 7.1. */
export const TIERS = Object.freeze({
  low: Object.freeze({
    tier: 'low', targetFps: 30, maxDpr: 1, dynRes: Object.freeze({ min: 0.6, max: 1, step: 0.1, interval: 3, resize: true }),
    drawCalls: 120, triangles: 250000, lodRanges: Object.freeze([256, 512, 1152]), chunkBuilds: 1,
    treeRadius: 400, rockRadius: 300, grassRadius: 0, treeInstances: 1200, rockInstances: 600, programs: 24, antialias: true,
    sfxVariants: 2, vegetationDrawCalls: 12, shadows: 'blob', bloom: false, outlines: 'nearest6', cloudLayers: 1, waterWaves: false,
    particles: 800, pointLights: 0, activeEnemies: 12, animatedActors: 8, projectiles: 96, audioVoices: 24, reverb: 'delay', farPlane: 9000,
  }),
  high: Object.freeze({
    tier: 'high', targetFps: 60, maxDpr: 2, dynRes: Object.freeze({ min: 0.8, max: 1, step: 0.05, interval: 0.5, resize: false }),
    drawCalls: 350, triangles: 1200000, lodRanges: Object.freeze([512, 1024, 1792]), chunkBuilds: 3,
    treeRadius: 900, rockRadius: 700, grassRadius: 70, treeInstances: 4000, rockInstances: 2000, programs: 32, antialias: true,
    sfxVariants: 3, vegetationDrawCalls: 30, shadows: 'map2048', bloom: true, outlines: 'range100', cloudLayers: 2, waterWaves: true,
    particles: 3500, pointLights: 2, activeEnemies: 24, animatedActors: 20, projectiles: 256, audioVoices: 32, reverb: 'convolver', farPlane: 9000,
  }),
});

/** Uniform declarations of the shared globals (the `common` GLSL chunk). */
const GLSL_COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform vec3 uShadowTint;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFogHeight;
uniform vec3 uRimColor;
uniform vec3 uCamPos;
uniform vec3 uWind;
`;

/**
 * The three-band toon lighting function (ART_UX 1.7), reading the global rim colour from `rimName`.
 * @param {string} rimName @returns {string}
 */
function lightingChunk(rimName) {
  return /* glsl */ `
vec3 toonLight(vec3 base, vec3 n, vec3 viewDir) {
  float ndl = dot(n, uSunDir);
  float lit = smoothstep(0.43, 0.47, ndl);
  float mid = smoothstep(-0.07, -0.03, ndl);
  vec3 amb = mix(uAmbGround, uAmbSky, n.y * 0.5 + 0.5);
  vec3 shadowC = base * (uShadowTint + amb * 0.45);
  vec3 midC = mix(base * 0.82 * uSunColor, shadowC, 0.1);
  vec3 litC = base * uSunColor;
  vec3 c = mix(shadowC, mix(midC, litC, lit), mid);
  c = max(c, base * 0.22);
  float rim = smoothstep(0.62, 0.72, 1.0 - max(dot(n, viewDir), 0.0)) * max(0.0, ndl + 0.4) * (1.0 - n.y * n.y);
  return c + rim * ${rimName} * 0.35;
}
`;
}

/** Exponential-squared height fog with a sun-tinted lobe (ART_UX 1.5). */
const GLSL_FOG = /* glsl */ `
vec3 applyFog(vec3 color, vec3 worldPos) {
  vec3 d = worldPos - uCamPos;
  float dist = max(length(d), 0.001);
  float hf = max(exp(-uFogHeight * max(worldPos.y, 0.0)), 0.3);
  float fd = uFogDensity * dist;
  float f = clamp((1.0 - exp(-fd * fd)) * hf, 0.0, 1.0);
  float toSun = pow(max(dot(d / dist, uSunDir), 0.0), 8.0) * 0.35;
  return mix(color, mix(uFogColor, uSunColor, toSun), f);
}
`;

const TOON_VERT = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
attribute float paletteIndex;
uniform float uTime;
uniform vec3 uWind;
uniform vec3 uColor;
uniform float uVertexColors;
uniform float uUsePalette;
uniform vec3 uPalette[16];
uniform float uEmissive[16];
uniform float uWindOn;
varying vec3 vBase;
varying float vEmis;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec3 base = uColor;
  vEmis = 0.0;
  if (uUsePalette > 0.5) {
    int pi = int(clamp(paletteIndex + 0.5, 0.0, 15.0));
    base = uPalette[pi];
    vEmis = uEmissive[pi];
  }
  #ifdef USE_COLOR
  base *= mix(vec3(1.0), color.rgb, uVertexColors);
  #endif
  #ifdef USE_INSTANCING_COLOR
  base *= instanceColor;
  #endif
  vBase = base;
  vec4 wp = vec4(transformed, 1.0);
  vec3 wn = objectNormal;
  #ifdef USE_INSTANCING
  wp = instanceMatrix * wp;
  wn = mat3(instanceMatrix) * wn;
  #endif
  wp = modelMatrix * wp;
  if (uWindOn > 0.5) {
    float sway = sin(uTime * 2.513 + wp.x * 0.07 + wp.z * 0.05) * uWind.y * clamp(transformed.y * 0.25, 0.0, 1.0);
    wp.x += uWind.x * sway;
    wp.z += uWind.z * sway;
  }
  vNormalW = normalize(mat3(modelMatrix) * wn);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const TOON_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform vec3 uShadowTint;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFogHeight;
uniform vec3 uGlobalRim;
uniform vec3 uCamPos;
uniform vec3 uEmissiveColor;
uniform float uEmissiveIntensity;
uniform float uGlossy;
uniform vec3 uRimColor;
uniform float uRimStrength;
uniform float uDissolve;
uniform float uFlash;
uniform float uGhost;
uniform float uFogScale;
varying vec3 vBase;
varying float vEmis;
varying vec3 vNormalW;
varying vec3 vPosW;
${lightingChunk('uGlobalRim')}
${GLSL_FOG}
void main() {
  if (uDissolve > 0.0) {
    float h = fract(sin(dot(floor(vPosW * 9.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    if (h < uDissolve) discard;
  }
  vec3 n = normalize(vNormalW);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(uCamPos - vPosW);
  vec3 c = toonLight(vBase, n, v);
  if (uGlossy > 0.5) {
    vec3 hv = normalize(uSunDir + v);
    c += smoothstep(0.91, 0.93, dot(n, hv)) * uSunColor * 0.6;
  }
  if (uRimStrength > 0.0) c += smoothstep(0.55, 0.7, 1.0 - max(dot(n, v), 0.0)) * uRimColor * uRimStrength;
  c += vBase * vEmis + uEmissiveColor * uEmissiveIntensity;
  c = mix(c, applyFog(c, vPosW), uFogScale);
  c = mix(c, vec3(1.0), uFlash);
  gl_FragColor = vec4(c, uGhost);
  #include <colorspace_fragment>
}
`;

const UNLIT_VERT = /* glsl */ `
varying vec3 vCol;
varying vec2 vUv;
varying vec3 vPosW;
void main() {
  vCol = vec3(1.0);
  #ifdef USE_COLOR
  vCol *= color.rgb;
  #endif
  #ifdef USE_INSTANCING_COLOR
  vCol *= instanceColor;
  #endif
  vUv = uv;
  vec4 wp = vec4(position, 1.0);
  #ifdef USE_INSTANCING
  wp = instanceMatrix * wp;
  #endif
  wp = modelMatrix * wp;
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const UNLIT_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFogHeight;
uniform vec3 uCamPos;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uUseMap;
uniform sampler2D uMap;
uniform float uFogOn;
varying vec3 vCol;
varying vec2 vUv;
varying vec3 vPosW;
${GLSL_FOG}
void main() {
  vec4 c = vec4(uColor * vCol, uOpacity);
  if (uUseMap > 0.5) c *= texture2D(uMap, vUv);
  if (uFogOn > 0.5) c.rgb = applyFog(c.rgb, vPosW);
  gl_FragColor = c;
  #include <colorspace_fragment>
}
`;

/**
 * @typedef {object} ToonOpts
 * @property {number} [color] @property {boolean} [vertexColors] @property {boolean} [palette] @property {boolean} [glossy]
 * @property {number} [emissive] @property {number} [emissiveIntensity] @property {boolean} [wind] @property {boolean} [instanced]
 * @property {boolean} [transparent] @property {boolean} [doubleSide] @property {number} [fogScale]
 */

/**
 * Create the stand-in render service.
 * @param {any} ctx
 */
function createRender(ctx) {
  /** @type {any} */
  let renderer = null;
  /** @type {any} */
  let scene = null;
  /** @type {any} */
  let camera = null;
  let width = 1;
  let height = 1;
  let resizeDirty = false;
  const onWindowResize = () => { resizeDirty = true; };

  const globals = {
    uTime: { value: 0 },
    uSunDir: { value: new Vector3(0.4, 0.8, 0.45).normalize() },
    uSunColor: { value: new Color(PALETTE.day[1].sun).multiplyScalar(PALETTE.day[1].intensity) },
    uAmbSky: { value: new Color(PALETTE.day[1].ambSky) },
    uAmbGround: { value: new Color(PALETTE.day[1].ambGround) },
    uShadowTint: { value: new Color(PALETTE.day[1].shadowTint) },
    uFogColor: { value: new Color(PALETTE.biome.meadows.fog) },
    uFogDensity: { value: 0.00018 },
    uFogHeight: { value: 0.004 },
    uRimColor: { value: new Color(PALETTE.day[1].ambSky).lerp(new Color(0xffffff), 0.4) },
    uCamPos: { value: new Vector3() },
    /** x: wind direction x, y: sway amplitude in metres, z: wind direction z. */
    uWind: { value: new Vector3(0.8, 0.15, 0.6) },
  };

  /** @param {object} own @returns {object} uniforms of a toon material: its own values plus the shared globals */
  function toonUniforms(own) {
    return Object.assign(own, {
      uTime: globals.uTime, uWind: globals.uWind, uSunDir: globals.uSunDir, uSunColor: globals.uSunColor,
      uAmbSky: globals.uAmbSky, uAmbGround: globals.uAmbGround, uShadowTint: globals.uShadowTint,
      uFogColor: globals.uFogColor, uFogDensity: globals.uFogDensity, uFogHeight: globals.uFogHeight,
      uGlobalRim: globals.uRimColor, uCamPos: globals.uCamPos,
    });
  }

  /**
   * One toon material instance; every instance shares the same program per geometry kind.
   * @param {ToonOpts} [opts] @returns {ShaderMaterial}
   */
  function toon(opts) {
    const o = opts || {};
    const palette = [];
    for (let i = 0; i < 16; i++) palette.push(new Color(PALETTE.paper));
    const mat = new ShaderMaterial({
      uniforms: toonUniforms({
        uColor: { value: new Color(o.color !== undefined ? o.color : PALETTE.paper) },
        uVertexColors: { value: o.vertexColors ? 1 : 0 },
        uUsePalette: { value: o.palette ? 1 : 0 },
        uPalette: { value: palette },
        uEmissive: { value: new Float32Array(16) },
        uEmissiveColor: { value: new Color(o.emissive !== undefined ? o.emissive : 0x000000) },
        uEmissiveIntensity: { value: o.emissive !== undefined ? (o.emissiveIntensity !== undefined ? o.emissiveIntensity : 1) : 0 },
        uGlossy: { value: o.glossy ? 1 : 0 },
        uWindOn: { value: o.wind ? 1 : 0 },
        uRimColor: { value: new Color(PALETTE.ora) },
        uRimStrength: { value: 0 },
        uDissolve: { value: 0 },
        uFlash: { value: 0 },
        uGhost: { value: 1 },
        uFogScale: { value: o.fogScale !== undefined ? o.fogScale : 1 },
      }),
      vertexShader: TOON_VERT,
      fragmentShader: TOON_FRAG,
      vertexColors: true,
      transparent: !!o.transparent,
      side: o.doubleSide ? DoubleSide : FrontSide,
    });
    mat.defaultAttributeValues = { color: [1, 1, 1], uv: [0, 0], uv1: [0, 0], paletteIndex: [0] };
    return mat;
  }

  /**
   * @param {{ color?:number, additive?:boolean, map?:any, depthWrite?:boolean, transparent?:boolean, fog?:boolean }} [opts]
   * @returns {ShaderMaterial}
   */
  function unlit(opts) {
    const o = opts || {};
    const transparent = !!(o.transparent || o.additive);
    return new ShaderMaterial({
      uniforms: {
        uSunDir: globals.uSunDir, uSunColor: globals.uSunColor, uFogColor: globals.uFogColor,
        uFogDensity: globals.uFogDensity, uFogHeight: globals.uFogHeight, uCamPos: globals.uCamPos,
        uColor: { value: new Color(o.color !== undefined ? o.color : 0xffffff) },
        uOpacity: { value: 1 },
        uUseMap: { value: o.map ? 1 : 0 },
        uMap: { value: o.map || null },
        uFogOn: { value: o.fog === false ? 0 : 1 },
      },
      vertexShader: UNLIT_VERT,
      fragmentShader: UNLIT_FRAG,
      vertexColors: true,
      transparent,
      blending: o.additive ? AdditiveBlending : NormalBlending,
      depthWrite: o.depthWrite !== undefined ? !!o.depthWrite : !transparent,
    });
  }

  // ------------------------------------------------------------------ blob shadows
  const BLOB_MAX = 96;
  /** @type {any} */
  let blobMesh = null;
  const blobIds = new Int32Array(BLOB_MAX);
  const blobRadius = new Float32Array(BLOB_MAX);
  const blobMatrix = new Matrix4();

  function ensureBlobs() {
    if (blobMesh || !scene) return;
    const geo = new CircleGeometry(1, 16);
    geo.rotateX(-Math.PI / 2);
    const mat = unlit({ color: PALETTE.blob, transparent: true, fog: false });
    mat.uniforms.uOpacity.value = 0.45;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
    blobMesh = new InstancedMesh(geo, mat, BLOB_MAX);
    blobMesh.count = 0;
    blobMesh.frustumCulled = false;
    blobMesh.renderOrder = 1;
    render.layers.world.add(blobMesh);
  }

  /** Position every blob under its entity on the ground, shrinking with altitude. */
  function updateBlobs(alpha) {
    if (!blobMesh) return;
    const world = ctx.world;
    const p = TMP.v1;
    let n = 0;
    for (let i = 0; i < BLOB_MAX; i++) {
      const id = blobIds[i];
      if (id === 0) continue;
      const ent = ctx.ents.get(id);
      if (!ent || !ent.alive) continue;
      ctx.ents.renderPos(ent, alpha, p);
      const g = world ? world.groundAt(p.x, p.y, p.z) : 0;
      const gy = g > 0 ? g : 0;
      const alt = p.y - gy;
      const s = blobRadius[i] * 1.3 * Math.max(0.25, 1 - alt / 40);
      blobMatrix.makeScale(s, 1, s);
      blobMatrix.setPosition(p.x, gy + 0.06, p.z);
      blobMesh.setMatrixAt(n++, blobMatrix);
    }
    blobMesh.count = n;
    blobMesh.instanceMatrix.needsUpdate = true;
  }

  function resize() {
    if (!renderer) return;
    const layer = renderer.domElement.parentElement;
    width = Math.max(1, (layer && layer.clientWidth) || (typeof window !== 'undefined' ? window.innerWidth : 1));
    height = Math.max(1, (layer && layer.clientHeight) || (typeof window !== 'undefined' ? window.innerHeight : 1));
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    renderer.setPixelRatio(Math.min(dpr, render.caps.maxDpr) * render.scale);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    resizeDirty = false;
  }

  /** @returns {'low'|'high'} */
  function pickTier() {
    const f = ctx.flags || {};
    if (f.quality === 'low' || f.quality === 'high') return f.quality;
    const s = ctx.save && ctx.save.settings;
    if (s && (s.quality === 'low' || s.quality === 'high')) return s.quality;
    const coarse = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    return coarse ? 'low' : 'high';
  }

  const render = {
    tier: /** @type {'low'|'high'} */ ('low'),
    caps: TIERS.low,
    scale: 1,
    /** @type {{ sky:any, world:any, props:any, actors:any, vfx:any }} */
    layers: { sky: new Group(), world: new Group(), props: new Group(), actors: new Group(), vfx: new Group() },
    globals,
    glsl: { common: GLSL_COMMON, lighting: lightingChunk('uRimColor'), fog: GLSL_FOG },

    /** Create the renderer, scene, camera and layers; pick the tier. @returns {Promise<void>} */
    async init() {
      if (renderer) return;
      const f = ctx.flags || {};
      render.tier = pickTier();
      render.caps = TIERS[render.tier];
      const res = Number(f.res);
      render.scale = res >= 0.3 && res <= 1 ? res : 1;
      renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: !!f.test, powerPreference: 'high-performance' });
      renderer.setClearColor(new Color(PALETTE.sky.horizon), 1);
      const canvas = renderer.domElement;
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      ctx.dom.layer('canvas').appendChild(canvas);
      scene = new Scene();
      camera = new PerspectiveCamera(60, 1, 0.3, render.caps.farPlane);
      camera.position.set(0, 50, 0);
      for (const key of ['sky', 'world', 'props', 'actors', 'vfx']) scene.add(render.layers[key]);
      ctx.three.renderer = renderer;
      ctx.three.scene = scene;
      ctx.three.camera = camera;
      if (typeof window !== 'undefined') window.addEventListener('resize', onWindowResize);
      resize();
      ensureBlobs();
    },

    /** Link the programs of everything in the scene. @returns {Promise<void>} */
    async compile() {
      if (!renderer) return;
      try {
        if (typeof renderer.compileAsync === 'function') await renderer.compileAsync(scene, camera);
        else renderer.compile(scene, camera);
      } catch (err) {
        renderer.compile(scene, camera);
      }
    },

    /** Re-apply size and state after a WebGL context restore. */
    restore() {
      if (!renderer) return;
      renderer.resetState();
      resize();
    },

    /** Re-read the layer size (also on orientation change). */
    resize,

    /** @param {'low'|'high'} tier */
    setTier(tier) {
      if (tier !== 'low' && tier !== 'high') return;
      if (tier === render.tier) return;
      render.tier = tier;
      render.caps = TIERS[tier];
      if (renderer) resize();
      ctx.bus.emit('quality:changed', { tier });
    },

    materials: {
      /** @param {ToonOpts} [opts] */
      toon(opts) { return toon(opts); },
      /** @param {ToonOpts} [opts] */
      toonSkinned(opts) { return toon(opts); },
      unlit,
    },

    outline: {
      /** No outlines in the stand-in. */
      add() {},
      remove() {},
    },

    blob: {
      /** Blob shadow following the entity on the ground. @param {number} entId @param {number} radius */
      add(entId, radius) {
        ensureBlobs();
        for (let i = 0; i < BLOB_MAX; i++) if (blobIds[i] === entId) { blobRadius[i] = radius; return; }
        for (let i = 0; i < BLOB_MAX; i++) {
          if (blobIds[i] === 0) {
            blobIds[i] = entId;
            blobRadius[i] = radius > 0 ? radius : 0.5;
            return;
          }
        }
      },
      /** @param {number} entId */
      remove(entId) {
        for (let i = 0; i < BLOB_MAX; i++) if (blobIds[i] === entId) blobIds[i] = 0;
      },
    },

    light: {
      /** No point lights in the stand-in (the low tier has none). @returns {null} */
      claim() { return null; },
    },

    /** Screen-space feel: no-ops in the stand-in. */
    flash() {},
    speedLines() {},
    vignette() {},
    desaturate() {},

    /**
     * World position to CSS pixels relative to #app.
     * @param {number} x @param {number} y @param {number} z @param {{x:number,y:number,visible:boolean,depth:number}} out
     */
    project(x, y, z, out) {
      if (!camera) {
        out.x = 0; out.y = 0; out.visible = false; out.depth = 0;
        return out;
      }
      const v = TMP.v1.set(x, y, z);
      out.depth = v.distanceTo(camera.position);
      v.project(camera);
      out.x = (v.x * 0.5 + 0.5) * width;
      out.y = (-v.y * 0.5 + 0.5) * height;
      out.visible = v.z > -1 && v.z < 1 && v.x >= -1 && v.x <= 1 && v.y >= -1 && v.y <= 1;
      return out;
    },

    /**
     * Ray from the camera through a CSS pixel.
     * @param {number} cssX @param {number} cssY @param {{ox:number,oy:number,oz:number,dx:number,dy:number,dz:number}} out
     */
    screenRay(cssX, cssY, out) {
      if (!camera) {
        out.ox = 0; out.oy = 0; out.oz = 0; out.dx = 0; out.dy = 0; out.dz = 1;
        return out;
      }
      const v = TMP.v1.set((cssX / width) * 2 - 1, -(cssY / height) * 2 + 1, 0.5).unproject(camera);
      v.sub(camera.position).normalize();
      out.ox = camera.position.x; out.oy = camera.position.y; out.oz = camera.position.z;
      out.dx = v.x; out.dy = v.y; out.dz = v.z;
      return out;
    },

    /** @returns {{ fps:number, frameMs:number, simMs:number, drawCalls:number, triangles:number, geometries:number, textures:number, programs:number, scale:number, tier:string, particles:number }} */
    stats() {
      const ls = (ctx.loop && ctx.loop.stats) || { fps: 0, frameMs: 0, simMs: 0 };
      const info = renderer ? renderer.info : null;
      const vfx = ctx.vfx;
      return {
        fps: ls.fps, frameMs: ls.frameMs, simMs: ls.simMs,
        drawCalls: info ? info.render.calls : 0,
        triangles: info ? info.render.triangles : 0,
        geometries: info ? info.memory.geometries : 0,
        textures: info ? info.memory.textures : 0,
        programs: info && info.programs ? info.programs.length : 0,
        scale: render.scale, tier: render.tier,
        particles: vfx && typeof vfx.count === 'function' ? vfx.count() : 0,
      };
    },

    /** Remove the canvas and release the GPU context. */
    dispose() {
      if (typeof window !== 'undefined') window.removeEventListener('resize', onWindowResize);
      if (!renderer) return;
      const canvas = renderer.domElement;
      if (canvas.parentElement) canvas.parentElement.removeChild(canvas);
      renderer.dispose();
      renderer = null;
    },
  };

  const drawSystem = {
    id: 'standin.render.draw',
    phase: 'render',
    /** @param {any} c @param {number} dt @param {number} alpha */
    frame(c, dt, alpha) {
      if (!renderer) return;
      if (resizeDirty) resize();
      globals.uTime.value += dt;
      globals.uCamPos.value.copy(camera.position);
      updateBlobs(alpha);
      renderer.render(scene, camera);
    },
  };

  return { render, drawSystem };
}

/**
 * Install the stand-in render service under the owner 'standin:render'.
 * @param {any} ctx
 */
export function install(ctx) {
  const { render, drawSystem } = createRender(ctx);
  ctx.provide('render', render, OWNER);
  ctx.systems.add(Object.assign(drawSystem, { owner: OWNER }));
}
