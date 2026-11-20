/**
 * The gfx `ctx.render` service (ARCHITECTURE 4.3, 7.1): renderer setup, the low and high tiers with auto-detect and
 * switching, resize and orientation handling, dynamic resolution, context-loss restore, program warm-up, layers,
 * shared lighting globals, the toon material family, outlines, blob shadows, pooled point lights, screen-space feel
 * with the flash budget, the high post chain, projection helpers and stats.
 * @module render/renderer
 */

import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Color, Vector2, Vector3, Vector4, Mesh, SkinnedMesh, InstancedMesh,
  BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Skeleton, Bone, Matrix4,
} from 'three';
import { PALETTE } from '../core/palette.js';
import { TMP } from '../core/math.js';
import { createFlashBudget } from '../core/fx.js';
import { TIERS, chooseTier } from './logic/tiers.js';
import { createDynRes, TELEPORT_HOLD } from './logic/dynres.js';
import { createCalib } from './logic/calib.js';
import { commonChunk, lightingChunk, FOG_CHUNK, SHADOW_VERT_CHUNK, GRADE_CHUNK } from './glsl.js';
import { createShadows } from './shadow.js';
import { createMaterials } from './materials.js';
import { createOutlines } from './outline.js';
import { createBlobs } from './blob.js';
import { createPost, createScreenFx } from './post.js';

const LAYER_KEYS = ['sky', 'world', 'props', 'actors', 'vfx'];

/**
 * @param {any} ctx
 * @returns {{ render:any, drawSystem:any, onSettings:(e:any)=>void, onCine:(e:any)=>void, onCineEnd:(e:any)=>void, onSpawn:(e:any)=>void }}
 */
export function createRender(ctx) {
  /** @type {any} */
  let renderer = null;
  /** @type {any} */
  let scene = null;
  /** @type {any} */
  let camera = null;
  let width = 1;
  let height = 1;
  let resizeDirty = false;
  let dynamic = true;
  let dropped = false;
  let cinematic = false;
  let clock = 0;
  let lastReal = -1;
  let compiling = false;
  let software = false;
  /** Programs the driver failed to link at the last warm-up (0 on a healthy device). */
  let linkFailures = 0;
  let fixedScale = 1;
  const lastCam = new Vector3(NaN, NaN, NaN);
  const onWindowResize = () => {
    resizeDirty = true;
  };

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
    // render polish: the shadow map (written by render/shadow), cloud shadows (written by env), the final grade
    uShadowMap: { value: null },
    uShadowMat: { value: new Matrix4() },
    /** x strength, y 1/size, z depth bias, w on. */
    uShadowP: { value: new Vector4(0, 1 / 1024, 0, 0) },
    /** x, y box centre (world x, z), z half size. */
    uShadowC: { value: new Vector4(0, 0, 20, 0) },
    /** The sky's cloud noise texture (env). */
    uCloudMap: { value: null },
    /** x, y uv offset (drift), z uv per metre, w strength (0: off). */
    uCloudP: { value: new Vector4(0, 0, 0.0001, 0) },
    /** x coverage, y cloud plane height (metres). */
    uCloudQ: { value: new Vector4(0.42, 1500, 0, 0) },
    /** x contrast, y saturation, z vignette, w on (low tier). */
    uGrade: { value: new Vector4(0.14, 1.08, 0.28, 1) },
    /** Drawing buffer size: width, height, 1/width, 1/height. */
    uScreen: { value: new Vector4(1, 1, 1, 1) },
  };
  /** gfx-private shared uniforms. */
  const internal = {
    uViewport: { value: new Vector2(1, 1) },
    uInk: { value: new Color(PALETTE.ink) },
    /** The final grade (shared with render.globals.uGrade; the high composite reads contrast and saturation). */
    uGrade: globals.uGrade,
    uPointPos0: { value: new Vector4(0, 0, 0, 0) },
    uPointPos1: { value: new Vector4(0, 0, 0, 0) },
    uPointCol0: { value: new Color(0, 0, 0) },
    uPointCol1: { value: new Color(0, 0, 0) },
  };

  const materials = createMaterials(globals, internal);
  const outlines = createOutlines(ctx, materials, () => render);
  const blobs = createBlobs(ctx);
  const post = createPost(internal);
  const fx = createScreenFx();
  const budget = createFlashBudget();
  const dyn = createDynRes(TIERS.low, false);
  const shadows = createShadows(globals);
  const calib = createCalib({ maxRatio: 1, target: 30, shadows: false });
  /** Shadow map allowed: not forced off, the device is not among the weakest. */
  let shadowAllowed = true;
  /** The shadow map was shed (calibration or dynamic resolution: the first sacrifice). */
  let shadowShed = false;
  let calibrating = false;

  // ------------------------------------------------------------------ point lights
  const LIGHTS = 2;
  const lightSlots = [];
  for (let i = 0; i < LIGHTS; i++) {
    lightSlots.push({ gen: 0, active: false, priority: 0, x: 0, y: 0, z: 0, color: new Color(), intensity: 0, radius: 0 });
  }
  /** @param {number} i */
  function makeLightHandle(i) {
    const slot = lightSlots[i];
    const gen = ++slot.gen;
    return {
      /** @param {number} x @param {number} y @param {number} z @param {number} color @param {number} intensity @param {number} radius */
      set(x, y, z, color, intensity, radius) {
        if (slot.gen !== gen) return;
        slot.x = x;
        slot.y = y;
        slot.z = z;
        slot.color.setHex(color);
        slot.intensity = intensity;
        slot.radius = radius;
      },
      release() {
        if (slot.gen !== gen) return;
        slot.gen++;
        slot.active = false;
        slot.intensity = 0;
      },
    };
  }
  function updateLights() {
    const n = render.caps.pointLights;
    for (let i = 0; i < LIGHTS; i++) {
      const s = lightSlots[i];
      const pos = i === 0 ? internal.uPointPos0.value : internal.uPointPos1.value;
      const col = i === 0 ? internal.uPointCol0.value : internal.uPointCol1.value;
      if (i < n && s.active && s.intensity > 0 && s.radius > 0) {
        pos.set(s.x, s.y, s.z, s.radius);
        col.copy(s.color).multiplyScalar(s.intensity);
      } else {
        pos.w = 0;
      }
    }
  }

  // ------------------------------------------------------------------ size and tiers
  function layerSize() {
    const el = renderer.domElement.parentElement;
    width = Math.max(1, (el && el.clientWidth) || (typeof window !== 'undefined' ? window.innerWidth : 1));
    height = Math.max(1, (el && el.clientHeight) || (typeof window !== 'undefined' ? window.innerHeight : 1));
  }

  function resize() {
    if (!renderer) return;
    layerSize();
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    const pr = Math.min(dpr, render.caps.maxDpr);
    if (render.tier === 'high') {
      renderer.setPixelRatio(pr);
      renderer.setSize(width, height, false);
      post.setSize(width * pr, height * pr, render.scale);
      const t = post.target();
      if (t) internal.uViewport.value.set(t.width, t.height);
    } else {
      // low: render.scale is the pixel ratio itself (device pixels per CSS pixel), never above the device's own
      renderer.setPixelRatio(Math.min(render.scale, Math.max(dpr, 0.6)));
      renderer.setSize(width, height, false);
      renderer.getDrawingBufferSize(internal.uViewport.value);
    }
    const vp = internal.uViewport.value;
    globals.uScreen.value.set(vp.x, vp.y, 1 / Math.max(1, vp.x), 1 / Math.max(1, vp.y));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    resizeDirty = false;
  }

  function autoTier() {
    const coarse = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    return chooseTier({ flag: null, setting: null, coarse, software });
  }

  /** @returns {'low'|'high'} */
  function pickTier() {
    const f = ctx.flags || {};
    const s = ctx.save && ctx.save.settings;
    return chooseTier({
      flag: f.quality || null,
      setting: s ? s.quality : null,
      coarse: typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches,
      software,
    });
  }

  /** Device pixel ratio the low tier may reach: min(devicePixelRatio, maxDpr). */
  function maxRatio() {
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    return Math.min(dpr, render.caps.maxDpr);
  }

  /** Static check for the weakest phones (2 GB or less): they never get a shadow map. */
  function weakDevice() {
    if (typeof navigator === 'undefined') return false;
    const mem = /** @type {any} */ (navigator).deviceMemory;
    return typeof mem === 'number' && mem > 0 && mem <= 2;
  }

  /** @returns {boolean} the shadow map is drawn this frame */
  function shadowsOn() {
    return render.caps.shadowSize > 0 && shadowAllowed && !shadowShed && (!calibrating || calib.shadows);
  }

  /** @param {'low'|'high'} tier */
  function applyTier(tier) {
    render.tier = tier;
    render.caps = TIERS[tier];
    dyn.configure(render.caps, tier === 'high' && !dropped);
    // the phone tier calibrates its pixel ratio from 1.0 (render/logic/calib); dynamic resolution then keeps it
    calibrating = dynamic && !!render.caps.calibrate;
    if (calibrating) {
      calib.configure({ maxRatio: maxRatio(), target: render.caps.targetFps, shadows: shadowAllowed && !shadowShed && render.caps.shadowSize > 0 });
      dyn.limit(calib.scale);
      dyn.scale = calib.scale;
    }
    dyn.canShed = shadowsOn();
    render.scale = dynamic ? dyn.scale : fixedScale;
    globals.uGrade.value.w = tier === 'high' ? 0 : 1;
    if (scene) shadows.configure(render.caps.shadowSize, render.caps.shadowHalf, render.layers, scene);
    post.setEnabled(tier === 'high');
    if (camera) {
      camera.far = render.caps.farPlane;
      camera.updateProjectionMatrix();
    }
  }
  // ------------------------------------------------------------------ warm-up
  /** @type {any} */
  let warm = null;
  function buildWarm() {
    if (warm) return;
    warm = new Group();
    warm.name = 'gfx.warmup';
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0], 3));
    g.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    g.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    g.setAttribute('color', new Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
    g.setAttribute('paletteIndex', new Float32BufferAttribute([0, 0, 0], 1));
    g.setAttribute('skinIndex', new Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    const col = new Color(1, 1, 1);
    const add = (o) => {
      o.frustumCulled = false;
      warm.add(o);
      return o;
    };
    // toon: static (front, double), skinned, instanced (plain, colour, colour double-sided)
    const tStatic = add(new Mesh(g, materials.toon({})));
    add(new Mesh(g, materials.toon({ doubleSide: true })));
    const bone = new Bone();
    const skinned = new SkinnedMesh(g, materials.toonSkinned({ palette: true }));
    skinned.add(bone);
    skinned.bind(new Skeleton([bone]));
    add(skinned);
    add(new InstancedMesh(g, materials.toon({}), 1));
    const ic = new InstancedMesh(g, materials.toon({}), 1);
    ic.setColorAt(0, col);
    add(ic);
    const icd = new InstancedMesh(g, materials.toon({ doubleSide: true }), 1);
    icd.setColorAt(0, col);
    add(icd);
    // unlit: static, instanced, instanced colour
    add(new Mesh(g, materials.unlit({ additive: true })));
    add(new InstancedMesh(g, materials.unlit({}), 1));
    const uc = new InstancedMesh(g, materials.unlit({ additive: true }), 1);
    uc.setColorAt(0, col);
    add(uc);
    // outlines: static and skinned hulls
    const hs = new Mesh(g, materials.outline(tStatic.material, 2, undefined));
    add(hs);
    const hk = new SkinnedMesh(g, materials.outline(skinned.material, 2, undefined));
    hk.bind(skinned.skeleton, skinned.bindMatrix);
    add(hk);
    // the shadow pass draws static, skinned and instanced casters with its depth material
    shadows.markWarm([tStatic, skinned, warm.children[3]]);
    warm.visible = false;
    render.layers.world.add(warm);
  }

  /** Link every program of the scene (hidden pooled objects included) for the current tier. @param {boolean} sync */
  async function linkAll(sync) {
    buildWarm();
    warm.visible = true;
    /** @type {any[]} */
    const hidden = [];
    scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    const target = render.tier === 'high' ? post.target() : null;
    // the depth programs of the shadow pass link against the shadow target: draw it once with everything visible
    if (render.caps.shadowSize > 0) {
      const on = globals.uShadowP.value.w;
      shadows.render(renderer, scene, 0, 0, 0, 1, 1);
      globals.uShadowP.value.w = on;
    }
    // the proxies (depth material) stay out of the main compile: they only ever draw into the shadow target
    const proxyRoot = scene.getObjectByName('gfx.shadowProxies');
    if (proxyRoot) scene.remove(proxyRoot);
    renderer.setRenderTarget(target);
    try {
      if (!sync && typeof renderer.compileAsync === 'function') {
        await renderer.compileAsync(scene, camera);
      } else {
        renderer.compile(scene, camera);
      }
    } catch (err) {
      renderer.setRenderTarget(target);
      renderer.compile(scene, camera);
    }
    // three inspects a program the first time it draws with it (uniform and attribute tables, link status and info
    // logs): synchronous round trips to the GPU that cost a hitch each. Do them now, behind the loading screen,
    // instead of in the first fight; and count the programs the driver refused, for the device report.
    try {
      const gl = renderer.getContext();
      const list = renderer.info.programs || [];
      let failed = 0;
      for (let i = 0; i < list.length; i++) {
        list[i].getUniforms();
        list[i].getAttributes();
        if (list[i].program && !gl.getProgramParameter(list[i].program, gl.LINK_STATUS)) failed++;
      }
      linkFailures = failed;
    } catch (err) {
      // diagnostics only
    }
    renderer.setRenderTarget(null);
    if (proxyRoot) scene.add(proxyRoot);
    for (let i = 0; i < hidden.length; i++) hidden[i].visible = false;
    warm.visible = false;
    // the screen passes of the tier: one frame with every effect at zero
    if (render.tier === 'high') {
      post.render(renderer, scene, camera);
    } else {
      post.setFx(fx, clock, width / height, true);
      renderer.render(scene, camera);
      post.overlay(renderer);
    }
  }

  /**
   * Release the programs of the previous tier: a material's `dispose` event only drops the renderer's GPU state for
   * it (uniforms and textures stay), so every material relinks the variant of the new tier and stale programs go.
   */
  function releasePrograms() {
    /** @type {Set<any>} */
    const seen = new Set();
    scene.traverse((o) => {
      const m = o.material;
      if (!m) return;
      if (Array.isArray(m)) for (const x of m) seen.add(x);
      else seen.add(m);
    });
    for (const m of post.materials()) seen.add(m);
    for (const m of shadows.materials()) seen.add(m);
    for (const m of seen) m.dispose();
  }

  // ------------------------------------------------------------------ the service
  const render = {
    tier: /** @type {'low'|'high'} */ ('low'),
    caps: /** @type {any} */ (TIERS.low),
    scale: 1,
    /** @type {{ sky:any, world:any, props:any, actors:any, vfx:any }} */
    layers: { sky: new Group(), world: new Group(), props: new Group(), actors: new Group(), vfx: new Group() },
    globals,
    glsl: {
      common: commonChunk('uRimColor'), lighting: lightingChunk('uRimColor'), fog: FOG_CHUNK,
      shadowVert: SHADOW_VERT_CHUNK, grade: GRADE_CHUNK,
    },
    materials: { toon: materials.toon, toonSkinned: materials.toonSkinned, unlit: materials.unlit },

    /** Create the renderer, scene, camera and layers; pick the tier. @returns {Promise<void>} */
    async init() {
      if (renderer) return;
      const f = ctx.flags || {};
      // ?res fixes the scale; on the low tier it is the pixel ratio, up to 2 (read raw: the core flag clamps to 1)
      const raw = f.raw || {};
      const res = raw.res !== undefined && raw.res !== null && raw.res !== '' ? Number(raw.res) : Number(f.res);
      dynamic = !(res >= 0.3 && res <= 2) && !f.test;
      fixedScale = res >= 0.3 && res <= 2 ? res : 1;
      // ?shadows=0 forces the shadow map off and ?shadows=1 on; otherwise the weakest devices never get one
      const sf = raw.shadows;
      shadowAllowed = sf === '0' ? false : sf === '1' ? true : !weakDevice();
      renderer = new WebGLRenderer({
        antialias: true, preserveDrawingBuffer: !!f.test, powerPreference: 'high-performance', stencil: false,
      });
      renderer.info.autoReset = false;
      renderer.setClearColor(new Color(PALETTE.sky.horizon), 1);
      try {
        const gl = renderer.getContext();
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
        software = /swiftshader|llvmpipe|software/i.test(name);
      } catch (err) {
        software = false;
      }
      try {
        // Rendering to half-float targets is an extension in WebGL2 and some phones lack it: the high tier then
        // uses 8-bit targets instead of raising GL errors.
        const gl2 = renderer.getContext();
        post.hdr = !!(gl2.getExtension('EXT_color_buffer_half_float') || gl2.getExtension('EXT_color_buffer_float'));
      } catch (err) {
        post.hdr = false;
      }
      const canvas = renderer.domElement;
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.touchAction = 'none';
      ctx.dom.layer('canvas').appendChild(canvas);
      scene = new Scene();
      scene.name = 'gfx.scene';
      camera = new PerspectiveCamera(60, 1, 0.3, TIERS.low.farPlane);
      camera.position.set(0, 50, 0);
      for (let i = 0; i < LAYER_KEYS.length; i++) scene.add(render.layers[LAYER_KEYS[i]]);
      ctx.three.renderer = renderer;
      ctx.three.scene = scene;
      ctx.three.camera = camera;
      if (typeof window !== 'undefined') {
        window.addEventListener('resize', onWindowResize);
        window.addEventListener('orientationchange', onWindowResize);
        if (window.visualViewport) window.visualViewport.addEventListener('resize', onWindowResize);
      }
      applyTier(pickTier());
      render.scale = dynamic ? dyn.scale : fixedScale;
      resize();
      blobs.build(render.layers.world);
    },

    /** Link every program of the current tier behind the loading screen. @returns {Promise<void>} */
    async compile() {
      if (!renderer || compiling) return;
      compiling = true;
      try {
        await linkAll(!!(ctx.loop && ctx.loop.running));
      } finally {
        compiling = false;
      }
    },

    /** Re-apply size, targets and programs after a WebGL context restore. */
    restore() {
      if (!renderer) return;
      post.disposeTargets();
      post.setEnabled(render.tier === 'high');
      resize();
      linkAll(true).catch((err) => ctx.log.warn('render', 'restore compile failed', err));
    },

    /** Re-read the layer size (also on orientation change). */
    resize,

    /**
     * Picture quality state (render polish): calibration, ceiling, shadow map and drawing buffer (diagnostics, tests).
     * @returns {{ calibrating:boolean, ceiling:number, maxRatio:number, scale:number, shadows:boolean, shadowShed:boolean,
     *   shadowAllowed:boolean, canvas:number[], shadow:any, steps:number }}
     */
    quality() {
      const vp = internal.uViewport.value;
      return {
        calibrating, ceiling: calibrating ? calib.ceiling : dyn.max(), maxRatio: maxRatio(), scale: render.scale,
        shadows: shadowsOn(), shadowShed, shadowAllowed, canvas: [vp.x, vp.y], shadow: shadows.stats(), steps: calib.steps,
      };
    },

    /** Allow or forbid the shadow map for the session (settings, tests); clears a shed. @param {boolean} on */
    setShadows(on) {
      shadowAllowed = !!on;
      shadowShed = false;
      dyn.canShed = shadowsOn();
      if (!shadowsOn()) shadows.off();
    },

    /** @param {'low'|'high'} tier */
    setTier(tier) {
      if (tier !== 'low' && tier !== 'high') return;
      if (tier === render.tier) return;
      applyTier(tier);
      if (renderer) {
        releasePrograms();
        resize();
        linkAll(true).catch((err) => ctx.log.warn('render', 'tier compile failed', err));
      }
      ctx.bus.emit('quality:changed', { tier });
    },

    outline: {
      /** @param {any} mesh @param {{ widthPx?:number, color?:number }} [opts] */
      add(mesh, opts) {
        outlines.add(mesh, opts);
        // every outlined character casts into the shadow map
        shadows.mark(mesh);
      },
      /** @param {any} mesh */
      remove(mesh) {
        outlines.remove(mesh);
      },
    },

    blob: {
      /** @param {number} entId @param {number} radius */
      add(entId, radius) {
        blobs.add(entId, radius);
      },
      /** @param {number} entId */
      remove(entId) {
        blobs.remove(entId);
      },
    },

    light: {
      /**
       * A pooled point light (0 on low, 2 on high). A higher priority takes the slot of the lowest lower one.
       * @param {number} priority @returns {{ set:Function, release:Function }|null}
       */
      claim(priority) {
        const n = render.caps.pointLights;
        if (n <= 0) return null;
        let pick = -1;
        for (let i = 0; i < n; i++) {
          if (!lightSlots[i].active) {
            pick = i;
            break;
          }
        }
        if (pick < 0) {
          let lowest = Infinity;
          for (let i = 0; i < n; i++) {
            if (lightSlots[i].priority < lowest) {
              lowest = lightSlots[i].priority;
              pick = i;
            }
          }
          if (lowest >= priority) return null;
        }
        const s = lightSlots[pick];
        s.active = true;
        s.priority = priority;
        s.intensity = 0;
        return makeLightHandle(pick);
      },
    },

    /**
     * A full-screen flash through the flash budget of ART_UX 3.1 (dropped over budget, alpha clamped).
     * @param {number} color @param {number} alpha @param {number} seconds
     */
    flash(color, alpha, seconds) {
      const s = ctx.save && ctx.save.settings;
      const a = budget.request(alpha, ctx.time.real, !!(s && s.photosensitive));
      if (a <= 0) return false;
      fx.flashColor.setHex(typeof color === 'number' ? color : 0xffffff);
      fx.flashPeak = a;
      fx.flashA = a;
      fx.flashT = 0;
      fx.flashDur = Math.max(0.05, seconds || 0.1);
      return true;
    },
    /** @param {number} amount 0..1, refreshed by the caller every frame it applies */
    speedLines(amount) {
      const a = amount > 1 ? 1 : amount > 0 ? amount : 0;
      if (a > fx.speedIn) fx.speedIn = a;
    },
    /** @param {number} color @param {number} amount @param {number} seconds */
    vignette(color, amount, seconds) {
      fx.vigColor.setHex(typeof color === 'number' ? color : PALETTE.ink);
      fx.vigPeak = Math.max(0, Math.min(1, amount)) * 0.8;
      fx.vigT = 0;
      fx.vigDur = Math.max(0.05, seconds || 0.3);
    },
    /** @param {number} amount @param {number} seconds */
    desaturate(amount, seconds) {
      fx.desPeak = Math.max(0, Math.min(1, amount));
      fx.desT = 0;
      fx.desDur = Math.max(0.05, seconds || 0.5);
    },
    /** Current screen effect values (tests). */
    screenFx() {
      return { flash: fx.flashA, vignette: fx.vigA, desaturate: fx.desA, speed: fx.speed };
    },

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
        linkFailures,
        scale: render.scale, tier: render.tier,
        particles: vfx && typeof vfx.count === 'function' ? vfx.count() : 0,
        outlines: outlines.shown, blobs: blobs.count(), shadows: shadowsOn(),
      };
    },

    /** Remove the canvas and release the GPU context. */
    dispose() {
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', onWindowResize);
        window.removeEventListener('orientationchange', onWindowResize);
        if (window.visualViewport) window.visualViewport.removeEventListener('resize', onWindowResize);
      }
      outlines.dispose();
      blobs.dispose();
      shadows.dispose();
      post.dispose();
      if (!renderer) return;
      const canvas = renderer.domElement;
      if (canvas.parentElement) canvas.parentElement.removeChild(canvas);
      renderer.dispose();
      renderer = null;
    },
  };

  const pPos = new Vector3();
  const tPos = new Vector3();

  const drawSystem = {
    id: 'render.draw',
    phase: 'render',
    /** @param {any} c @param {number} dt @param {number} alpha */
    frame(c, dt, alpha) {
      if (!renderer) return;
      const real = c.time.real;
      const simDt = lastReal < 0 ? 0 : real - lastReal;
      lastReal = real;
      const edt = dt > 0 ? dt : Math.min(0.25, Math.max(0, simDt));
      clock += edt;
      globals.uTime.value = clock;
      if (resizeDirty) resize();
      const cp = camera.position;
      if (lastCam.distanceToSquared(cp) > 150 * 150) dyn.hold(TELEPORT_HOLD);
      lastCam.copy(cp);
      globals.uCamPos.value.copy(cp);
      if (dynamic && dt > 0) {
        const ls = c.loop && c.loop.stats;
        const cost = ls ? ls.costMs : 0;
        const cap = ls ? ls.cap : 0;
        if (calibrating) {
          // the calibration runs through the title flyover (a cinematic, uncapped)
          if (calib.update(dt, false, cost, cap)) {
            if (!calib.shadows && render.caps.shadowSize > 0 && shadowAllowed) shadowShed = true;
            if (calib.scale !== render.scale) {
              dyn.limit(Math.max(calib.ceiling, calib.scale));
              dyn.scale = calib.scale;
              render.scale = calib.scale;
              resize();
            }
          }
          if (calib.phase === 'done') {
            calibrating = false;
            dyn.limit(calib.ceiling);
            dyn.scale = calib.scale;
            dyn.canShed = shadowsOn();
          }
        } else if (dyn.update(dt, cinematic, cost, cap)) {
          render.scale = dyn.scale;
          resize();
        }
        if (dyn.shedRequested) {
          // the order of sacrifices: the shadow map goes first, the resolution only after
          dyn.shedRequested = false;
          dyn.canShed = false;
          shadowShed = true;
        }
        if (dyn.dropRequested && render.tier === 'high' && !dropped) {
          dropped = true;
          render.setTier('low');
          c.bus.emit('ui:toast', { key: 'gfx.quality.lowered', args: null, kind: 'info' });
        }
      }
      // outlines: player and locked target are always drawn
      const p = c.player;
      pPos.set(NaN, NaN, NaN);
      tPos.set(NaN, NaN, NaN);
      if (p && p.alive) {
        c.ents.renderPos(p, alpha, pPos);
        const tid = p.combat ? p.combat.targetId : 0;
        const t = tid ? c.ents.get(tid) : null;
        if (t && t.alive) c.ents.renderPos(t, alpha, tPos);
      }
      camera.updateMatrixWorld();
      outlines.update(camera, render.caps, pPos.x, pPos.y, pPos.z, tPos.x, tPos.y, tPos.z);
      updateLights();
      const s = c.save && c.save.settings;
      fx.tick(edt, !!(s && s.reducedMotion));
      renderer.info.reset();
      // the shadow map follows the player; over a flyer high above the ground it covers the ground below instead
      // (the flyer keeps its blob for altitude reading)
      if (shadowsOn()) {
        let sx = cp.x;
        let sy = cp.y;
        let sz = cp.z;
        if (pPos.x === pPos.x) {
          sx = pPos.x;
          sy = pPos.y;
          sz = pPos.z;
        }
        const w = c.world;
        const gy = w && typeof w.heightAt === 'function' ? w.heightAt(sx, sz) : sy;
        if (sy - gy > 10) sy = Math.max(gy, 0);
        // the shadows soften with the light (dusk, moonlight)
        const sc = globals.uSunColor.value;
        const lum = 0.2126 * sc.r + 0.7152 * sc.g + 0.0722 * sc.b;
        const k = Math.min(1, Math.max(0, (lum - 0.06) / 0.5));
        shadows.render(renderer, scene, sx, sy, sz, 0.6 + 0.4 * k, edt);
      } else {
        shadows.off();
      }
      blobs.update(alpha, shadows.active ? shadows.center : null, shadows.half);
      if (render.tier === 'high' && post.target()) {
        post.setFx(fx, clock, width / height, false);
        post.render(renderer, scene, camera);
      } else {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        if (fx.active()) {
          post.setFx(fx, clock, width / height, true);
          post.overlay(renderer);
        }
      }
    },
  };

  /** @param {any} e settings:changed */
  function onSettings(e) {
    if (!e || e.key !== 'quality') return;
    const f = ctx.flags || {};
    if (f.quality === 'low' || f.quality === 'high') return;
    render.setTier(e.value === 'low' || e.value === 'high' ? e.value : autoTier());
  }
  function onCine() {
    cinematic = true;
  }
  function onCineEnd() {
    cinematic = false;
  }
  function onSpawn() {
    dyn.hold(TELEPORT_HOLD);
  }

  return { render, drawSystem, onSettings, onCine, onCineEnd, onSpawn };
}
