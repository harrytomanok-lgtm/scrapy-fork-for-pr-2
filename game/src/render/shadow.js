/**
 * The shadow map (render polish, item 2): one orthographic depth map that follows the player (low 1024 texels over
 * a 40 m box, high 2048 over 90 m), drawn before the main pass with a depth-only override material.
 *
 * Casters are chosen by the render package itself, without touching their owners:
 * - every toon mesh under `layers.actors` and every non-instanced toon mesh under `layers.props` (characters,
 *   settlement buildings, props) gets the shadow layer bit; a slow sweep (every 0.5 s) marks new ones;
 * - instanced vegetation and rocks (instanced toon meshes in `layers.props`, ground tufts excluded) are copied into
 *   small proxy instanced meshes that hold only the instances near the box, refreshed every 0.5 s or when the box
 *   moves 4 m, so the shadow pass never redraws the whole forest.
 * Receivers read the map through the shared lighting uniforms (`uShadowMap`, `uShadowMat`, `uShadowP`, `uShadowC`):
 * toon materials and the terrain. Depth textures are core WebGL2; the map is sampled with nearest taps: four on the
 * small map, blended bilinearly and kept soft, nine on the large one with a clean toon edge (render/glsl
 * SHADOW_FRAG_CHUNK). Instances the toon vertex shader hides near the camera are left out of the proxies.
 * Programs: the depth material adds three (static, skinned, instanced), linked at warm-up.
 * @module render/shadow
 */

import {
  WebGLRenderTarget, DepthTexture, RedFormat, UnsignedByteType, NearestFilter, OrthographicCamera, MeshBasicMaterial,
  InstancedMesh, Group, Matrix4, Vector3, DoubleSide, UnsignedIntType,
} from 'three';

/** Object layer bit of the shadow casters. */
export const SHADOW_LAYER = 5;
/** Instances per proxy kind. */
const PROXY_MAX = 320;
/** Distance from the box centre to the light camera, and its depth range (metres). */
const LIGHT_DIST = 160;
const LIGHT_FAR = 340;

/** A material of the toon family (render.materials.toon; owners may rename it). @param {any} m */
function isToon(m) {
  return !!(m.uniforms && m.uniforms.uCharRim && m.uniforms.uShadowP);
}

/**
 * @param {Record<string,{value:any}>} globals render.globals (the shadow uniforms are written here)
 */
export function createShadows(globals) {
  /** @type {any} */
  let rt = null;
  let size = 0;
  let half = 20;
  const cam = new OrthographicCamera(-20, 20, 20, -20, 1, LIGHT_FAR);
  cam.layers.set(SHADOW_LAYER);
  const depthMat = new MeshBasicMaterial({ colorWrite: false, side: DoubleSide });
  depthMat.name = 'gfx.shadowDepth';
  const proxyRoot = new Group();
  proxyRoot.name = 'gfx.shadowProxies';
  /** @type {{ src:any, proxy:any }[]} */
  const proxies = [];
  const bias = new Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const center = new Vector3();
  const lastFill = new Vector3(1e9, 0, 0);
  const lastEye = new Vector3(1e9, 0, 0);
  const tmp = new Vector3();
  const right = new Vector3();
  const up = new Vector3();
  let sweepT = 0;
  let sweepN = 0;
  let lastObj = -1;
  let fillT = 0;
  let layersRef = /** @type {any} */ (null);

  /** @param {any} o */
  function markOne(o) {
    if (!o.isMesh || o.isInstancedMesh) return;
    const m = o.material;
    if (!m || !isToon(m) || m.transparent) return;
    o.layers.enable(SHADOW_LAYER);
  }

  /** @param {any} o */
  function proxyFor(o) {
    if (!o.isInstancedMesh || !o.material || !isToon(o.material)) return;
    const u = o.material.uniforms;
    if (u && u.uNearHide && u.uNearHide.value < 0) return; // ground tufts: too small to cast
    for (let i = 0; i < proxies.length; i++) if (proxies[i].src === o) return;
    const p = new InstancedMesh(o.geometry, depthMat, PROXY_MAX);
    p.count = 0;
    p.frustumCulled = false;
    p.layers.set(SHADOW_LAYER);
    p.matrixAutoUpdate = false;
    p.name = 'gfx.shadowProxy';
    proxyRoot.add(p);
    proxies.push({ src: o, proxy: p });
  }

  /** Mark casters under the actors and props layers and adopt new instanced kinds. */
  function sweep() {
    const L = layersRef;
    if (!L) return;
    L.actors.traverse(markOne);
    const ch = L.props.children;
    for (let i = 0; i < ch.length; i++) {
      const o = ch[i];
      if (o.isInstancedMesh) proxyFor(o);
      else o.traverse(markOne);
    }
  }

  /** Copy the instances near the box into the proxies. @param {number} r horizontal radius */
  function fill(r) {
    const cx = center.x;
    const cz = center.z;
    const eye = globals.uCamPos ? globals.uCamPos.value : null;
    for (let k = 0; k < proxies.length; k++) {
      const { src, proxy } = proxies[k];
      let n = 0;
      if (src.parent && src.visible) {
        const a = src.instanceMatrix.array;
        const b = proxy.instanceMatrix.array;
        const count = src.count;
        // the near hide of the toon vertex shader (an instance close to the camera is not drawn): what is hidden
        // must not cast either
        const nh = eye && src.material.uniforms.uNearHide ? src.material.uniforms.uNearHide.value : 0;
        for (let i = 0; i < count && n < PROXY_MAX; i++) {
          const o = i * 16;
          const dx = a[o + 12] - cx;
          const dz = a[o + 14] - cz;
          if (dx * dx + dz * dz > r * r) continue;
          if (nh > 0) {
            const rr = nh * Math.sqrt(a[o] * a[o] + a[o + 1] * a[o + 1] + a[o + 2] * a[o + 2]);
            const ex = a[o + 12] - eye.x;
            const ez = a[o + 14] - eye.z;
            if (ex * ex + ez * ez < rr * rr && eye.y < a[o + 13] + rr * 4) continue;
          }
          const d = n * 16;
          for (let j = 0; j < 16; j++) b[d + j] = a[o + j];
          n++;
        }
      }
      proxy.count = n;
      proxy.visible = n > 0;
      proxy.instanceMatrix.needsUpdate = true;
      // the source sits in a group at the origin; keep the proxy in the same frame
      proxy.matrix.copy(src.matrixWorld);
      proxy.matrixWorld.copy(src.matrixWorld);
    }
  }

  const api = {
    /** True when a map exists and the pass ran this frame (read by the blob fade). */
    active: false,
    /** Horizontal half-size of the box (metres). */
    get half() {
      return half;
    },
    center,
    /**
     * Create, resize or drop the map. @param {number} texels 0 = none @param {number} halfSize metres
     * @param {any} layers render.layers @param {any} scene
     */
    configure(texels, halfSize, layers, scene) {
      layersRef = layers;
      if (proxyRoot.parent !== scene && scene) scene.add(proxyRoot);
      half = halfSize > 0 ? halfSize : 20;
      cam.left = -half;
      cam.right = half;
      cam.top = half;
      cam.bottom = -half;
      cam.updateProjectionMatrix();
      if (texels === size && rt) return;
      if (rt) rt.dispose();
      rt = null;
      size = texels;
      if (texels > 0) {
        const dt = new DepthTexture(texels, texels, UnsignedIntType);
        dt.minFilter = NearestFilter;
        dt.magFilter = NearestFilter;
        rt = new WebGLRenderTarget(texels, texels, {
          format: RedFormat, type: UnsignedByteType, depthBuffer: true, depthTexture: dt,
          minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false,
        });
        globals.uShadowMap.value = dt;
        globals.uShadowP.value.y = 1 / texels;
      } else {
        globals.uShadowMap.value = null;
      }
      globals.uShadowP.value.w = 0;
      lastFill.set(1e9, 0, 0);
    },
    /**
     * Draw the map around (x, y, z) and publish the uniforms; `strength` 0 (or no map) turns receivers off.
     * @param {any} renderer @param {any} scene @param {number} x @param {number} y @param {number} z
     * @param {number} strength 0..1 @param {number} dt seconds since the last call
     */
    render(renderer, scene, x, y, z, strength, dt) {
      const P = globals.uShadowP.value;
      if (!rt || !(strength > 0)) {
        P.w = 0;
        api.active = false;
        return;
      }
      // sweep for new casters every 0.5 s, and at least every 20 frames (test runs render few, short frames)
      sweepT -= dt;
      const LR = layersRef;
      const nObj = LR ? LR.props.children.length + LR.actors.children.length : 0;
      if (sweepT <= 0 || ++sweepN >= 20 || nObj !== lastObj) {
        lastObj = nObj;
        sweepT = 0.5;
        sweepN = 0;
        sweep();
      }
      center.set(x, y, z);
      fillT -= dt;
      // refill every 0.5 s, when the box moved 4 m, or when the camera moved a metre (near-hidden casters change)
      const eyeNow = globals.uCamPos ? globals.uCamPos.value : center;
      if (fillT <= 0 || lastFill.distanceToSquared(center) > 16 || lastEye.distanceToSquared(eyeNow) > 1) {
        fillT = 0.5;
        lastFill.copy(center);
        lastEye.copy(eyeNow);
        fill(half * 1.45 + 6);
      }
      const L = globals.uSunDir.value;
      cam.position.copy(center).addScaledVector(L, LIGHT_DIST);
      cam.up.set(0, 1, 0);
      if (Math.abs(L.y) > 0.98) cam.up.set(0, 0, 1);
      cam.lookAt(center);
      cam.updateMatrixWorld();
      // snap the box to whole texels in light space, so edges do not crawl as the player moves
      const texel = (2 * half) / size;
      tmp.copy(center).applyMatrix4(cam.matrixWorldInverse);
      const dx = Math.round(tmp.x / texel) * texel - tmp.x;
      const dy = Math.round(tmp.y / texel) * texel - tmp.y;
      right.setFromMatrixColumn(cam.matrixWorld, 0);
      up.setFromMatrixColumn(cam.matrixWorld, 1);
      cam.position.addScaledVector(right, -dx).addScaledVector(up, -dy);
      cam.updateMatrixWorld();
      const prevOverride = scene.overrideMaterial;
      const prevTarget = renderer.getRenderTarget();
      scene.overrideMaterial = depthMat;
      renderer.setRenderTarget(rt);
      renderer.clear(true, true, false);
      renderer.render(scene, cam);
      scene.overrideMaterial = prevOverride;
      renderer.setRenderTarget(prevTarget);
      globals.uShadowMat.value.multiplyMatrices(bias, cam.projectionMatrix).multiply(cam.matrixWorldInverse);
      P.x = strength;
      P.z = 0.05 / (LIGHT_FAR - 1);
      P.w = 1;
      const C = globals.uShadowC.value;
      C.set(center.x, center.z, half, 0);
      api.active = true;
    },
    /** Turn receivers off (the pass is skipped). */
    off() {
      globals.uShadowP.value.w = 0;
      api.active = false;
    },
    /** Mark one mesh as a caster now (outline registration: every character). @param {any} mesh */
    mark(mesh) {
      if (mesh && mesh.isMesh && !mesh.isInstancedMesh) mesh.layers.enable(SHADOW_LAYER);
    },
    /** Warm-up: link the depth programs with the given objects marked (static, skinned, instanced). @param {any[]} objs */
    markWarm(objs) {
      for (let i = 0; i < objs.length; i++) objs[i].layers.enable(SHADOW_LAYER);
    },
    /** @returns {any[]} materials (tier release) */
    materials() {
      return [depthMat];
    },
    stats() {
      let inst = 0;
      for (let i = 0; i < proxies.length; i++) inst += proxies[i].proxy.count;
      return { size, half, active: api.active, proxies: proxies.length, instances: inst };
    },
    dispose() {
      if (rt) rt.dispose();
      rt = null;
      if (proxyRoot.parent) proxyRoot.parent.remove(proxyRoot);
      for (let i = 0; i < proxies.length; i++) proxies[i].proxy.dispose();
      proxies.length = 0;
      depthMat.dispose();
    },
  };
  return api;
}
