/**
 * Screen-space feel and the post chain (ARCHITECTURE 4.3, 7.1; ART_UX 3.1).
 * - Screen effects: flash (budgeted), vignette pulse, speed lines, desaturate; Reduced Motion scales speed lines.
 * - low: the scene draws straight to the MSAA canvas; while an effect is active one full-screen quad is blended on top.
 * - high: the scene draws into a multisampled half-float target at the dynamic scale, then quarter-resolution bloom
 *   (bright pass + 4 dual-filter levels, threshold on HDR values so only emissive Ora glows), a composite
 *   (bloom, vignette, grain, speed lines, desaturate, flash, sRGB encode) and FXAA to the canvas.
 * @module render/post
 */

import {
  Scene, OrthographicCamera, Mesh, PlaneGeometry, ShaderMaterial, WebGLRenderTarget, HalfFloatType, UnsignedByteType,
  LinearFilter, Vector2, Vector4, Color, AdditiveBlending, CustomBlending, OneFactor, OneMinusSrcAlphaFactor, AddEquation,
  LinearSRGBColorSpace, NoBlending,
} from 'three';

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
vec3 tap(vec2 o) {
  vec3 c = texture2D(tSrc, vUv + o * uTexel).rgb;
  float l = max(c.r, max(c.g, c.b));
  float k = max(l - uThreshold, 0.0);
  k = k * k / (k + 0.25);
  return c * (k / max(l, 0.0001));
}
void main() {
  vec3 c = tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0));
  gl_FragColor = vec4(min(c * 0.25, vec3(32.0)), 1.0);
}
`;

const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec2 h = uTexel * 0.5;
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += texture2D(tSrc, vUv - h).rgb;
  c += texture2D(tSrc, vUv + h).rgb;
  c += texture2D(tSrc, vUv + vec2(h.x, -h.y)).rgb;
  c += texture2D(tSrc, vUv - vec2(h.x, -h.y)).rgb;
  gl_FragColor = vec4(c * 0.125, 1.0);
}
`;

const UP_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uWeight;
varying vec2 vUv;
void main() {
  vec2 h = uTexel * 0.5;
  vec3 c = texture2D(tSrc, vUv + vec2(-h.x * 2.0, 0.0)).rgb;
  c += texture2D(tSrc, vUv + vec2(-h.x, h.y)).rgb * 2.0;
  c += texture2D(tSrc, vUv + vec2(0.0, h.y * 2.0)).rgb;
  c += texture2D(tSrc, vUv + vec2(h.x, h.y)).rgb * 2.0;
  c += texture2D(tSrc, vUv + vec2(h.x * 2.0, 0.0)).rgb;
  c += texture2D(tSrc, vUv + vec2(h.x, -h.y)).rgb * 2.0;
  c += texture2D(tSrc, vUv + vec2(0.0, -h.y * 2.0)).rgb;
  c += texture2D(tSrc, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
  gl_FragColor = vec4(c / 12.0 * uWeight, 1.0);
}
`;

/** Shared screen-effect functions (speed lines, vignette mask). */
const FX_CHUNK = /* glsl */ `
uniform vec4 uVignette;
uniform vec4 uFlash;
uniform float uDesat;
uniform float uSpeed;
uniform float uTime;
uniform float uAspect;
float fxHash(vec2 p) { return fract(sin(dot(p, vec2(41.31, 289.17))) * 45758.5453); }
float speedLines(vec2 uv) {
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  float r = length(p);
  float a = atan(p.y, p.x) * 9.5492966; // 60 sectors
  float id = floor(a);
  float t = floor(uTime * 14.0);
  float on = step(0.72, fxHash(vec2(id, t)));
  float w = 1.0 - abs(fract(a) - 0.5) * 2.0;
  float thin = smoothstep(0.35, 0.9, w);
  float start = 0.22 + 0.25 * fxHash(vec2(id, t + 7.0));
  return on * thin * smoothstep(start, start + 0.25, r) * uSpeed;
}
float vignetteMask(vec2 uv) {
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0) / max(uAspect, 1.0);
  return smoothstep(0.32, 0.78, length(p) * 1.15);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uGrain;
uniform vec3 uInk;
varying vec2 vUv;
${FX_CHUNK}
vec3 toSRGB(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, step(c, vec3(0.0031308)));
}
void main() {
  vec3 c = texture2D(tScene, vUv).rgb + texture2D(tBloom, vUv).rgb * uBloom;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, vec3(l), uDesat);
  float vm = vignetteMask(vUv);
  c = mix(c, uInk, vm * 0.22);
  c = mix(c, uVignette.rgb, vm * uVignette.a);
  c = mix(c, vec3(1.0), speedLines(vUv) * 0.55);
  c = mix(c, uFlash.rgb, uFlash.a);
  c = toSRGB(clamp(c, 0.0, 1.0));
  c += (fxHash(vUv * 731.0 + fract(uTime * 7.13)) - 0.5) * uGrain;
  gl_FragColor = vec4(c, 1.0);
}
`;

const FXAA_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec3 nw = texture2D(tSrc, vUv + vec2(-1.0, -1.0) * uTexel).rgb;
  vec3 ne = texture2D(tSrc, vUv + vec2(1.0, -1.0) * uTexel).rgb;
  vec3 sw = texture2D(tSrc, vUv + vec2(-1.0, 1.0) * uTexel).rgb;
  vec3 se = texture2D(tSrc, vUv + vec2(1.0, 1.0) * uTexel).rgb;
  vec3 m = texture2D(tSrc, vUv).rgb;
  float lnw = lum(nw), lne = lum(ne), lsw = lum(sw), lse = lum(se), lm = lum(m);
  float lmin = min(lm, min(min(lnw, lne), min(lsw, lse)));
  float lmax = max(lm, max(max(lnw, lne), max(lsw, lse)));
  vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
  float red = max((lnw + lne + lsw + lse) * 0.03125, 0.0078125);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
  dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * uTexel;
  vec3 a = 0.5 * (texture2D(tSrc, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tSrc, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(tSrc, vUv - dir * 0.5).rgb + texture2D(tSrc, vUv + dir * 0.5).rgb);
  float lb = lum(b);
  gl_FragColor = vec4((lb < lmin || lb > lmax) ? a : b, 1.0);
}
`;

/** Low tier overlay: premultiplied layers over the canvas. Colours are display values. */
const OVERLAY_FRAG = /* glsl */ `
varying vec2 vUv;
${FX_CHUNK}
void main() {
  vec3 p = vec3(0.0);
  float a = 0.0;
  float la = vignetteMask(vUv) * uVignette.a;
  p = uVignette.rgb * la + p * (1.0 - la); a = la + a * (1.0 - la);
  la = uDesat * 0.4;
  p = vec3(0.55) * la + p * (1.0 - la); a = la + a * (1.0 - la);
  la = speedLines(vUv) * 0.55;
  p = vec3(1.0) * la + p * (1.0 - la); a = la + a * (1.0 - la);
  la = uFlash.a;
  p = uFlash.rgb * la + p * (1.0 - la); a = la + a * (1.0 - la);
  gl_FragColor = vec4(p, a);
}
`;

/**
 * Screen effect state, advanced by `tick`.
 */
export function createScreenFx() {
  const s = {
    flashColor: new Color(1, 1, 1), flashPeak: 0, flashT: 0, flashDur: 0, flashA: 0,
    vigColor: new Color(0, 0, 0), vigPeak: 0, vigT: 0, vigDur: 0, vigA: 0,
    desPeak: 0, desT: 0, desDur: 0, desA: 0,
    speedIn: 0, speed: 0,
    /** @returns {boolean} any effect visible */
    active() {
      return s.flashA > 0.002 || s.vigA > 0.002 || s.desA > 0.002 || s.speed > 0.01;
    },
    /** @param {number} dt @param {boolean} reduced */
    tick(dt, reduced) {
      if (s.flashT < s.flashDur) {
        s.flashT += dt;
        const k = Math.min(1, s.flashT / s.flashDur);
        s.flashA = s.flashPeak * (1 - k) * (1 - k);
      } else {
        s.flashA = 0;
      }
      if (s.vigT < s.vigDur) {
        s.vigT += dt;
        const k = Math.min(1, s.vigT / s.vigDur);
        s.vigA = s.vigPeak * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85);
      } else {
        s.vigA = 0;
      }
      if (s.desT < s.desDur) {
        s.desT += dt;
        const k = Math.min(1, s.desT / s.desDur);
        s.desA = s.desPeak * (k < 0.1 ? k / 0.1 : 1 - (k - 0.1) / 0.9);
      } else {
        s.desA = 0;
      }
      const target = s.speedIn * (reduced ? 0.3 : 1);
      s.speed += (target - s.speed) * Math.min(1, dt * 8);
      s.speedIn = Math.max(0, s.speedIn - dt * 2.5);
    },
  };
  return s;
}

/**
 * @param {Record<string,{value:any}>} internal  shared uniforms (uInk)
 */
export function createPost(internal) {
  const quadGeo = new PlaneGeometry(2, 2);
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadScene = new Scene();
  const quad = new Mesh(quadGeo, undefined);
  quad.frustumCulled = false;
  quadScene.add(quad);

  const fxUniforms = {
    uVignette: { value: new Vector4(0, 0, 0, 0) },
    uFlash: { value: new Vector4(1, 1, 1, 0) },
    uDesat: { value: 0 },
    uSpeed: { value: 0 },
    uTime: { value: 0 },
    uAspect: { value: 1 },
  };

  /** @param {string} frag @param {object} uniforms @returns {ShaderMaterial} */
  function pass(frag, uniforms) {
    const m = new ShaderMaterial({ uniforms, vertexShader: QUAD_VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
    m.blending = NoBlending;
    return m;
  }

  const bright = pass(BRIGHT_FRAG, { tSrc: { value: null }, uTexel: { value: new Vector2() }, uThreshold: { value: 1.0 } });
  const down = pass(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new Vector2() } });
  const up = pass(UP_FRAG, { tSrc: { value: null }, uTexel: { value: new Vector2() }, uWeight: { value: 1 } });
  up.blending = AdditiveBlending;
  up.transparent = true;
  const composite = pass(COMPOSITE_FRAG, Object.assign({
    tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0.8 }, uGrain: { value: 0.03 }, uInk: internal.uInk,
  }, fxUniforms));
  const fxaa = pass(FXAA_FRAG, { tSrc: { value: null }, uTexel: { value: new Vector2() } });
  const overlay = new ShaderMaterial({
    uniforms: fxUniforms, vertexShader: QUAD_VERT, fragmentShader: OVERLAY_FRAG, depthTest: false, depthWrite: false, transparent: true,
  });
  overlay.blending = CustomBlending;
  overlay.blendEquation = AddEquation;
  overlay.blendSrc = OneFactor;
  overlay.blendDst = OneMinusSrcAlphaFactor;
  overlay.blendSrcAlpha = OneFactor;
  overlay.blendDstAlpha = OneMinusSrcAlphaFactor;

  /** @type {any} */
  let sceneRT = null;
  /** @type {any} */
  let ldrRT = null;
  /** @type {any[]} */
  const bloomRT = [];
  let w = 1;
  let h = 1;
  const tmpCol = new Color();

  /** @param {any} renderer @param {any} material @param {any} target */
  function draw(renderer, material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, cam);
  }

  const api = {
    fxUniforms,
    /** True while the high chain resources exist. */
    enabled: false,
    /** @returns {any} the scene target (high) */
    target() {
      return sceneRT;
    },
    /**
     * Create or resize the high chain targets.
     * @param {number} width drawing-buffer width at scale 1 @param {number} height @param {number} scale
     */
    setSize(width, height, scale) {
      w = Math.max(2, Math.round(width * scale));
      h = Math.max(2, Math.round(height * scale));
      if (!api.enabled) return;
      if (!sceneRT) {
        sceneRT = new WebGLRenderTarget(w, h, { type: HalfFloatType, samples: 4, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: true });
        ldrRT = new WebGLRenderTarget(w, h, { type: UnsignedByteType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
        for (let i = 0; i < 4; i++) {
          bloomRT.push(new WebGLRenderTarget(4, 4, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false }));
        }
        sceneRT.texture.colorSpace = LinearSRGBColorSpace;
      }
      sceneRT.setSize(w, h);
      ldrRT.setSize(w, h);
      let bw = Math.max(2, w >> 2);
      let bh = Math.max(2, h >> 2);
      for (let i = 0; i < 4; i++) {
        bloomRT[i].setSize(bw, bh);
        bw = Math.max(2, bw >> 1);
        bh = Math.max(2, bh >> 1);
      }
    },
    /** @param {boolean} on */
    setEnabled(on) {
      api.enabled = on;
      if (!on) api.disposeTargets();
    },
    disposeTargets() {
      if (sceneRT) sceneRT.dispose();
      if (ldrRT) ldrRT.dispose();
      for (let i = 0; i < bloomRT.length; i++) bloomRT[i].dispose();
      sceneRT = null;
      ldrRT = null;
      bloomRT.length = 0;
    },
    /**
     * Write the screen effect state into the shared uniforms.
     * @param {any} fx createScreenFx state @param {number} time @param {number} aspect @param {boolean} display  colours as display values (low)
     */
    setFx(fx, time, aspect, display) {
      const v = fxUniforms.uVignette.value;
      tmpCol.copy(fx.vigColor);
      if (display) tmpCol.convertLinearToSRGB();
      v.set(tmpCol.r, tmpCol.g, tmpCol.b, fx.vigA);
      const f = fxUniforms.uFlash.value;
      tmpCol.copy(fx.flashColor);
      if (display) tmpCol.convertLinearToSRGB();
      f.set(tmpCol.r, tmpCol.g, tmpCol.b, fx.flashA);
      fxUniforms.uDesat.value = fx.desA;
      fxUniforms.uSpeed.value = fx.speed;
      fxUniforms.uTime.value = time;
      fxUniforms.uAspect.value = aspect;
    },
    /** Low: draw the overlay quad onto the canvas. @param {any} renderer */
    overlay(renderer) {
      const ac = renderer.autoClear;
      renderer.autoClear = false;
      draw(renderer, overlay, null);
      renderer.autoClear = ac;
    },
    /**
     * High: scene into the target, bloom, composite, FXAA to the canvas.
     * @param {any} renderer @param {any} scene @param {any} camera
     */
    render(renderer, scene, camera) {
      if (!sceneRT) return;
      renderer.setRenderTarget(sceneRT);
      renderer.render(scene, camera);
      // bright pass to quarter resolution
      bright.uniforms.tSrc.value = sceneRT.texture;
      bright.uniforms.uTexel.value.set(1 / w, 1 / h);
      draw(renderer, bright, bloomRT[0]);
      for (let i = 1; i < 4; i++) {
        down.uniforms.tSrc.value = bloomRT[i - 1].texture;
        down.uniforms.uTexel.value.set(1 / bloomRT[i - 1].width, 1 / bloomRT[i - 1].height);
        draw(renderer, down, bloomRT[i]);
      }
      const ac = renderer.autoClear;
      renderer.autoClear = false;
      for (let i = 3; i > 0; i--) {
        up.uniforms.tSrc.value = bloomRT[i].texture;
        up.uniforms.uTexel.value.set(1 / bloomRT[i].width, 1 / bloomRT[i].height);
        up.uniforms.uWeight.value = 1;
        draw(renderer, up, bloomRT[i - 1]);
      }
      renderer.autoClear = ac;
      composite.uniforms.tScene.value = sceneRT.texture;
      composite.uniforms.tBloom.value = bloomRT[0].texture;
      draw(renderer, composite, ldrRT);
      fxaa.uniforms.tSrc.value = ldrRT.texture;
      fxaa.uniforms.uTexel.value.set(1 / w, 1 / h);
      draw(renderer, fxaa, null);
    },
    dispose() {
      api.disposeTargets();
      quadGeo.dispose();
      bright.dispose();
      down.dispose();
      up.dispose();
      composite.dispose();
      fxaa.dispose();
      overlay.dispose();
    },
  };
  return api;
}

