/**
 * The sky dome (ART_UX 1.6): one shader, drawn LAST among the opaques with the depth test on (LessEqual) at the far
 * plane (the vertex shader writes z = w, so depth 1.0), so early-z rejects every pixel the terrain, props and actors
 * already cover and the fragment shader only runs on the visible sky. Transparents still draw after it. Vertical gradient (zenith, horizon = the fog colour so the far
 * land melts into the sky, below-horizon), a hard sun disc with a soft halo, a moon disc with a pale ring, painted
 * three-tone clouds sampled from one pre-baked 256 px tiling noise texture (no per-pixel fbm) with a darker rim at
 * the threshold, hash stars and the Seam (a faint violet scar above the Spire) at night. One draw call, one program.
 * Cloud layer count is a uniform (low 1, high 2).
 * @module env/sky
 */

import {
  ShaderMaterial, Mesh, SphereGeometry, DataTexture, RGBAFormat, UnsignedByteType, RepeatWrapping, LinearFilter,
  LinearMipmapLinearFilter, Color, Vector3, Vector4, BackSide, LessEqualDepth,
} from 'three';
import { PALETTE } from '../core/palette.js';

const NOISE = 256;
/** Height of the painted cloud plane above the camera (metres) and its texture scale (uv per metre). */
export const CLOUD_HEIGHT = 1500;
export const CLOUD_UV = 0.16 / CLOUD_HEIGHT;

/** @param {number} x @param {number} y @param {number} p period @param {number} seed @returns {number} 0..1 */
function latticeHash(x, y, p, seed) {
  const xi = ((x % p) + p) % p;
  const yi = ((y % p) + p) % p;
  let h = (xi * 374761393 + yi * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Periodic value noise. @param {number} x @param {number} y @param {number} p @param {number} seed */
function vnoise(x, y, p, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  let fx = x - x0;
  let fy = y - y0;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = latticeHash(x0, y0, p, seed);
  const b = latticeHash(x0 + 1, y0, p, seed);
  const c = latticeHash(x0, y0 + 1, p, seed);
  const d = latticeHash(x0 + 1, y0 + 1, p, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/**
 * Bake the tiling cloud noise: R and G are two independent 5-octave fbm fields (two cloud layers), B a fine detail
 * field used for the Seam's ragged edge and star twinkle.
 * @returns {DataTexture}
 */
export function bakeCloudNoise() {
  const data = new Uint8Array(NOISE * NOISE * 4);
  for (let y = 0; y < NOISE; y++) {
    for (let x = 0; x < NOISE; x++) {
      const u = x / NOISE;
      const v = y / NOISE;
      let r = 0;
      let g = 0;
      let amp = 0.5;
      let norm = 0;
      for (let o = 0; o < 5; o++) {
        const p = 4 << o;
        r += vnoise(u * p, v * p, p, 11 + o) * amp;
        g += vnoise(u * p + 0.37, v * p + 0.71, p, 47 + o) * amp;
        norm += amp;
        amp *= 0.5;
      }
      r /= norm;
      g /= norm;
      const b = vnoise(u * 64, v * 64, 64, 91) * 0.6 + vnoise(u * 128, v * 128, 128, 93) * 0.4;
      // widen the contrast so the coverage threshold has a usable range
      const i = (y * NOISE + x) * 4;
      data[i] = Math.max(0, Math.min(255, Math.round(((r - 0.5) * 1.9 + 0.5) * 255)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(((g - 0.5) * 1.9 + 0.5) * 255)));
      data[i + 2] = Math.round(b * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new DataTexture(data, NOISE, NOISE, RGBAFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec4 p = projectionMatrix * viewMatrix * wp;
  gl_Position = p.xyww;
}
`;

/** The final grade of the low tier (render polish), inline so the sky stays one program. */
const GRADE = /* glsl */ `
  if (uGrade.w > 0.5) {
    vec3 g = gl_FragColor.rgb;
    float gl = dot(g, vec3(0.2126, 0.7152, 0.0722));
    g = clamp(mix(vec3(gl), g, uGrade.y), 0.0, 1.0);
    g = mix(g, g * g * (3.0 - 2.0 * g), uGrade.x);
    vec2 q = (gl_FragCoord.xy * uScreen.zw - 0.5) * vec2(uScreen.x * uScreen.w, 1.0);
    float r = length(q) / max(0.5 * uScreen.x * uScreen.w, 0.5);
    gl_FragColor.rgb = g * (1.0 - uGrade.z * smoothstep(0.55, 1.45, r));
  }
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunTrue;
uniform vec3 uMoonDir;
uniform vec3 uSunCol;
uniform float uSunVis;
uniform float uNight;
uniform sampler2D uNoise;
uniform vec4 uCloudOfs;
uniform float uLayers;
uniform float uCoverage;
uniform vec3 uTone0;
uniform vec3 uTone1;
uniform vec3 uTone2;
uniform vec3 uRim;
uniform vec3 uMoonCol;
uniform vec3 uStarCol;
uniform vec3 uSeamCol;
uniform vec3 uSeamCenter;
uniform vec3 uSeamNormal;
uniform float uTime;
uniform vec4 uGrade;
uniform vec4 uScreen;
varying vec3 vDir;

float skyHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

// One painted cloud layer: returns tone weight in rgb, coverage in a.
vec4 cloudLayer(vec2 uv, vec2 sunOfs, float chan, float cover) {
  vec4 t0 = texture2D(uNoise, uv);
  vec4 t1 = texture2D(uNoise, uv + sunOfs);
  float n = mix(t0.r, t0.g, chan);
  float s = mix(t1.r, t1.g, chan);
  float th = 1.0 - cover;
  float a = smoothstep(th, th + 0.012, n);
  // thickness above the threshold and the lit side (density falling toward the sun = lit)
  float lit = n - s;
  vec3 c = uTone1;
  c = mix(c, uTone0, smoothstep(0.005, 0.02, lit));
  c = mix(c, uTone2, smoothstep(-0.01, -0.03, lit) * (1.0 - smoothstep(th + 0.2, th + 0.32, n)));
  c = mix(uRim, c, smoothstep(th + 0.025, th + 0.04, n));
  return vec4(c, a);
}

void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  float up = clamp(y, 0.0, 1.0);
  float sd = dot(d, uSunTrue);
  vec3 sunC = min(uSunCol, vec3(1.0));

  // gradient: a wide horizon band, the zenith above; below the horizon the fog colour
  vec3 horizon = mix(uHorizon, sunC, pow(max(sd, 0.0), 8.0) * 0.35 * uSunVis);
  vec3 c = mix(horizon, uZenith, smoothstep(0.0, 1.0, pow(up, 0.5)));
  // sunrise and sunset glow (and the afterglow of blue hour): a warm band low on the sky, widest toward the sun,
  // that lingers a little after the sun has set
  float low = (1.0 - smoothstep(0.04, 0.42, uSunTrue.y)) * smoothstep(-0.3, -0.02, uSunTrue.y);
  vec2 sxz = normalize(uSunTrue.xz + vec2(0.0001));
  vec2 dxz = normalize(d.xz + vec2(0.0001));
  float az = dot(dxz, sxz) * 0.5 + 0.5;
  float band = exp(-max(y + 0.02, 0.0) * mix(9.0, 4.0, az));
  vec3 glowC = mix(sunC, vec3(sunC.r, sunC.g * 0.62, sunC.b * 0.55), 0.5 + 0.5 * az);
  c = mix(c, glowC, band * low * (0.12 + 0.6 * az * az));

  // night: stars and the Seam
  if (uNight > 0.01 && y > 0.0) {
    vec3 p = d * 90.0;
    vec3 cell = floor(p);
    float h = skyHash(cell);
    vec3 off = vec3(skyHash(cell + 3.1), skyHash(cell + 7.7), skyHash(cell + 1.3)) * 0.6 + 0.2;
    float r = length(fract(p) - off);
    float tw = 0.6 + 0.4 * sin(uTime * (1.5 + h * 3.0) + h * 40.0);
    float star = (1.0 - smoothstep(0.06, 0.16, r)) * step(0.955, h) * tw * smoothstep(0.02, 0.25, y);
    c += uStarCol * star * uNight;

    float along = dot(d, uSeamCenter);
    float rag0 = texture2D(uNoise, vec2(dot(d.xz, vec2(1.7, -1.1)), 0.37)).r;
    float across = abs(dot(d, uSeamNormal) + (rag0 - 0.5) * 0.035);
    vec2 suv = vec2(atan(d.z, d.x) * 1.6, d.y * 3.0);
    float rag = texture2D(uNoise, suv * 0.5).b;
    float w = 0.006 + 0.016 * rag * rag;
    float span = smoothstep(0.3, 0.75, along);
    float core = (1.0 - smoothstep(w * 0.2, w, across)) * 0.7;
    float glow = (1.0 - smoothstep(0.0, w * 9.0, across)) * 0.3;
    c += uSeamCol * (core + glow) * span * uNight;
  }

  // sun: hard disc and halo
  float sunVis = uSunVis * smoothstep(-0.04, 0.02, y);
  c += sunC * (pow(max(sd, 0.0), 300.0) * 0.5 + pow(max(sd, 0.0), 22.0) * 0.22 + pow(max(sd, 0.0), 5.0) * 0.18 * low) * sunVis;
  float sunDisc = smoothstep(0.99955, 0.99962, sd) * sunVis;

  // moon: disc and pale ring
  float md = dot(d, uMoonDir);
  float moonVis = uNight * smoothstep(-0.02, 0.05, y);
  float moonDisc = smoothstep(0.99968, 0.99974, md);
  float ring = smoothstep(0.9988, 0.99915, md) * (1.0 - smoothstep(0.9993, 0.99955, md));
  c += uMoonCol * (ring * 0.35 + pow(max(md, 0.0), 60.0) * 0.16 + pow(max(md, 0.0), 9.0) * 0.07) * moonVis;

  // painted clouds over the discs
  if (y > 0.0) {
    float k = 1.0 / (y + 0.09);
    vec2 base = d.xz * k * 0.16;
    vec2 sunOfs = normalize(uSunTrue.xz + vec2(0.0001)) * 0.018;
    vec4 l1 = cloudLayer(base + uCloudOfs.xy, sunOfs, 0.0, uCoverage);
    float fade = smoothstep(0.015, 0.16, y);
    float sunOcc = 1.0 - l1.a * fade;
    c = mix(c, sunC * 1.15, sunDisc * sunOcc);
    c = mix(c, uMoonCol, moonDisc * moonVis * sunOcc);
    if (uLayers > 1.5) {
      vec4 l2 = cloudLayer(base * 0.62 + uCloudOfs.zw, sunOfs, 1.0, uCoverage * 0.85);
      c = mix(c, l2.rgb, l2.a * fade * 0.85);
    }
    c = mix(c, l1.rgb, l1.a * fade);
  } else {
    c = mix(c, sunC * 1.15, sunDisc);
  }
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
  ${GRADE}
}
`;

/**
 * Create the sky dome. The caller adds `mesh` to `render.layers.sky` and calls `update` every frame.
 */
export function createSky() {
  const noise = bakeCloudNoise();
  const tone = PALETTE.sky.cloud;
  const uniforms = {
    uZenith: { value: new Color(PALETTE.sky.zenith) },
    uHorizon: { value: new Color(PALETTE.sky.horizon) },
    uSunTrue: { value: new Vector3(0, 1, 0) },
    uMoonDir: { value: new Vector3(0, -1, 0) },
    uSunCol: { value: new Color(PALETTE.day[1].sun) },
    uSunVis: { value: 1 },
    uNight: { value: 0 },
    uNoise: { value: noise },
    uCloudOfs: { value: new Vector4() },
    uLayers: { value: 1 },
    uCoverage: { value: 0.42 },
    uTone0: { value: new Color(tone[0]) },
    uTone1: { value: new Color(tone[1]) },
    uTone2: { value: new Color(tone[2]) },
    uRim: { value: new Color(tone[2]) },
    uMoonCol: { value: new Color(PALETTE.day[4].sun) },
    uStarCol: { value: new Color(PALETTE.zenith) },
    uSeamCol: { value: new Color(PALETTE.hostile).multiplyScalar(0.4) },
    uSeamCenter: { value: new Vector3(0, 1, 0) },
    uSeamNormal: { value: new Vector3(1, 0, 0) },
    uTime: { value: 0 },
    uGrade: { value: new Vector4(0, 1, 0, 0) },
    uScreen: { value: new Vector4(1, 1, 1, 1) },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    depthWrite: false,
    depthTest: true,
    depthFunc: LessEqualDepth,
    side: BackSide,
  });
  material.name = 'env.sky';
  const geometry = new SphereGeometry(1, 40, 20);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'env.sky';
  mesh.frustumCulled = false;
  // after every opaque (world, props and actors use renderOrder <= 8); three draws transparents after all opaques
  mesh.renderOrder = 1000;
  mesh.matrixAutoUpdate = false;

  const base0 = new Color(tone[0]);
  const base1 = new Color(tone[1]);
  const base2 = new Color(tone[2]);
  const tint = new Color();
  const seamBand = new Vector3(1, 0.22, -0.4).normalize();
  const tmp = new Vector3();
  let ofsX1 = 0;
  let ofsZ1 = 0;
  let ofsX2 = 0;
  let ofsZ2 = 0;
  /** World-space drift of cloud layer one (uv), for the ground's cloud shadows. */
  const cloud = { x: 0, y: 0 };

  return {
    mesh,
    uniforms,
    noise,
    cloud,
    /**
     * @param {any} cam camera (position) @param {number} dt real seconds
     * @param {{ zenith:Color, horizon:Color, sunTrue:Vector3, moonDir:Vector3, sunColor:Color, ambSky:Color, shadow:Color,
     *           night:number, wind:Vector3, layers:number, time:number }} s
     */
    update(cam, dt, s) {
      const p = cam.position;
      const r = cam.far * 0.9;
      mesh.matrix.makeScale(r, r, r).setPosition(p.x, p.y, p.z);
      mesh.matrixWorldNeedsUpdate = true;
      uniforms.uZenith.value.copy(s.zenith);
      uniforms.uHorizon.value.copy(s.horizon);
      uniforms.uSunTrue.value.copy(s.sunTrue);
      uniforms.uMoonDir.value.copy(s.moonDir);
      uniforms.uSunCol.value.copy(s.sunColor);
      uniforms.uSunVis.value = Math.max(0, Math.min(1, (s.sunTrue.y + 0.06) * 8));
      uniforms.uNight.value = s.night;
      uniforms.uLayers.value = s.layers;
      uniforms.uTime.value = s.time;
      // cloud tones: lit by the sun colour and the sky ambient; dark and blue at night
      tint.copy(s.sunColor).multiplyScalar(0.62).add(tmpColor(s.ambSky, 0.5));
      clampColor(tint, 1.05);
      uniforms.uTone0.value.copy(base0).multiply(tint);
      uniforms.uTone1.value.copy(base1).multiply(tint);
      tint.copy(s.ambSky).multiplyScalar(0.75).add(tmpColor(s.shadow, 0.35)).add(tmpColor(s.sunColor, 0.12));
      clampColor(tint, 1);
      uniforms.uTone2.value.copy(base2).multiply(tint);
      uniforms.uRim.value.copy(uniforms.uTone2.value).multiplyScalar(0.78);
      // scroll: layer one 2 m/s, layer two 3.5 m/s along the wind, in texture units of the cloud plane
      const w = s.wind;
      const wl = Math.sqrt(w.x * w.x + w.z * w.z) || 1;
      const k = dt * 0.0011;
      ofsX1 = (ofsX1 + (w.x / wl) * 2 * k) % 1;
      ofsZ1 = (ofsZ1 + (w.z / wl) * 2 * k) % 1;
      ofsX2 = (ofsX2 + (w.x / wl) * 3.5 * k) % 1;
      ofsZ2 = (ofsZ2 + (w.z / wl) * 3.5 * k) % 1;
      // the clouds are anchored to the world (a plane CLOUD_HEIGHT above the camera): they pass overhead as the
      // camera travels, and the ground's cloud shadows (render.globals uCloudP) sample the same pattern
      const cx = (p.x * CLOUD_UV) % 1;
      const cz = (p.z * CLOUD_UV) % 1;
      uniforms.uCloudOfs.value.set((ofsX1 + cx) % 1, (ofsZ1 + cz) % 1, (ofsX2 + 0.43 + cx * 0.62) % 1, (ofsZ2 + 0.17 + cz * 0.62) % 1);
      cloud.x = ofsX1;
      cloud.y = ofsZ1;
      // the Seam: a great-circle scar through the point 2600 m above the Spire
      tmp.set(-p.x, 2600 - p.y, -p.z).normalize();
      uniforms.uSeamCenter.value.copy(tmp);
      uniforms.uSeamNormal.value.crossVectors(tmp, seamBand).normalize();
    },
    dispose() {
      if (mesh.parent) mesh.parent.remove(mesh);
      geometry.dispose();
      material.dispose();
      noise.dispose();
    },
  };
}

const TMPC = new Color();
/** @param {Color} c @param {number} k @returns {Color} shared scratch */
function tmpColor(c, k) {
  return TMPC.copy(c).multiplyScalar(k);
}
/** @param {Color} c @param {number} m */
function clampColor(c, m) {
  if (c.r > m) c.r = m;
  if (c.g > m) c.g = m;
  if (c.b > m) c.b = m;
}

