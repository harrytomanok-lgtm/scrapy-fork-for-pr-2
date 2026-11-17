/**
 * The gfx `ctx.render` service (ARCHITECTURE 4.3, 7.1): renderer setup, the low and high tiers with auto-detect and
 * switching, resize and orientation handling, dynamic resolution, context-loss restore, program warm-up, layers,
 * shared lighting globals, the toon material family, outlines, blob shadows, pooled point lights, screen-space feel
 * with the flash budget, the high post chain, projection helpers and stats.
 * @module render/renderer
 */

import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Color, Vector2, Vector3, Vector4, Mesh, SkinnedMesh, InstancedMesh,
  BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Skeleton, Bone,
} from 'three';
import { PALETTE } from '../core/palette.js';
import { TMP } from '../core/math.js';
import { createFlashBudget } from '../core/fx.js';
import { TIERS, chooseTier } from './logic/tiers.js';
import { createDynRes, TELEPORT_HOLD } from './logic/dynres.js';
import { commonChunk, lightingChunk, FOG_CHUNK } from './glsl.js';
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
  };
  /** gfx-private shared uniforms. */
  const internal = {
    uViewport: { value: new Vector2(1, 1) },
    uInk: { value: new Color(PALETTE.ink) },
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
      renderer.setPixelRatio(pr * render.scale);
      renderer.setSize(width, height, false);
      renderer.getDrawingBufferSize(internal.uViewport.value);
    }
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

  /** @param {'low'|'high'} tier */
  function applyTier(tier) {
    render.tier = tier;
    render.caps = TIERS[tier];
    dyn.configure(render.caps, tier === 'high' && !dropped);
    render.scale = dynamic ? dyn.scale : fixedScale;
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
    renderer.setRenderTarget(null);
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
    glsl: { common: commonChunk('uRimColor'), lighting: lightingChunk('uRimColor'), fog: FOG_CHUNK },
    materials: { toon: materials.toon, toonSkinned: materials.toonSkinned, unlit: materials.unlit },

    /** Create the renderer, scene, camera and layers; pick the tier. @returns {Promise<void>} */
    async init() {
      if (renderer) return;
      const f = ctx.flags || {};
      const res = Number(f.res);
      dynamic = !(res >= 0.3 && res <= 1) && !f.test;
      fixedScale = res >= 0.3 && res <= 1 ? res : 1;
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
        scale: render.scale, tier: render.tier,
        particles: vfx && typeof vfx.count === 'function' ? vfx.count() : 0,
        outlines: outlines.shown, blobs: blobs.count(),
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
        if (dyn.update(dt, cinematic)) {
          render.scale = dyn.scale;
          resize();
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
      blobs.update(alpha);
      updateLights();
      const s = c.save && c.save.settings;
      fx.tick(edt, !!(s && s.reducedMotion));
      renderer.info.reset();
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
