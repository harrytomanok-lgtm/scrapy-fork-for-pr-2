/**
 * GLSL chunks and shader sources of the toon family (ART_UX 1.5, 1.7). Every feature is a uniform; the only
 * program variants are the geometry kinds three adds itself (static, skinned, instanced, instanced colour).
 * All shaders are mediump-safe in design (no derivatives, no dynamic loops) and run under `precision highp float`.
 * @module render/glsl
 */

/**
 * Global uniform declarations plus small helpers (hash, value noise, wind sway).
 * @param {string} rimName the name the global rim colour is declared under
 * @returns {string}
 */
export function commonChunk(rimName) {
  return /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform vec3 uShadowTint;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFogHeight;
uniform vec3 ${rimName};
uniform vec3 uCamPos;
uniform vec3 uWind;
float gfxHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float gfxNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(gfxHash(i), gfxHash(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(gfxHash(i + vec3(0.0, 1.0, 0.0)), gfxHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(gfxHash(i + vec3(0.0, 0.0, 1.0)), gfxHash(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(gfxHash(i + vec3(0.0, 1.0, 1.0)), gfxHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
// Horizontal sway in metres for a vertex at world position wp, h metres above the object's base.
vec3 gfxWind(vec3 wp, float h) {
  float ph = uTime * 2.513 + wp.x * 0.07 + wp.z * 0.05;
  float s = sin(ph) + 0.35 * sin(uTime * 5.3 + wp.x * 0.31 + wp.z * 0.27);
  s *= uWind.y * clamp(h * 0.25, 0.0, 1.0) * clamp(h * 0.25, 0.0, 1.0);
  return vec3(uWind.x * s, 0.0, uWind.z * s);
}
`;
}

/**
 * The three-band toon light (ART_UX 1.7): shadow below NdotL -0.05, mid below 0.45, else lit; each edge smoothed
 * over 0.04. Shadow = base x shadow tint (lifted by the hemisphere ambient), mid = base x 0.82 mixed 10% toward the
 * shadow, lit = base x sun. Rim: smoothstep(0.62, 0.72, 1 - NdotV) x max(0, NdotL + 0.4), global rim colour, 0.35.
 * @param {string} rimName
 * @returns {string}
 */
export function lightingChunk(rimName) {
  return /* glsl */ `
vec3 toonShadow(vec3 base, vec3 n) {
  vec3 amb = mix(uAmbGround, uAmbSky, n.y * 0.5 + 0.5);
  return base * (uShadowTint * 0.8 + amb * 0.38);
}
vec3 toonLight(vec3 base, vec3 n, vec3 viewDir) {
  float ndl = dot(n, uSunDir);
  float lit = smoothstep(0.43, 0.47, ndl);
  float mid = smoothstep(-0.07, -0.03, ndl);
  vec3 shadowC = toonShadow(base, n);
  vec3 sunC = min(uSunColor, vec3(1.6));
  vec3 midC = mix(base * 0.82 * sunC, shadowC, 0.1);
  vec3 litC = base * sunC;
  vec3 c = mix(shadowC, mix(midC, litC, lit), mid);
  float rim = smoothstep(0.62, 0.72, 1.0 - max(dot(n, viewDir), 0.0)) * max(0.0, ndl + 0.4) * (1.0 - n.y * n.y);
  return c + rim * ${rimName} * 0.35;
}
`;
}

/**
 * Exponential-squared height fog (ART_UX 1.5): density along the view ray scaled by the exponential height
 * integral between camera and point (floor 0.3 so distant peaks still fade); toward the sun the colour lerps up
 * to 35% to the sun colour.
 */
export const FOG_CHUNK = /* glsl */ `
float fogAmount(vec3 worldPos) {
  vec3 d = worldPos - uCamPos;
  float dist = max(length(d), 0.001);
  float k = max(uFogHeight, 0.00001);
  float y0 = max(uCamPos.y, 0.0);
  float y1 = max(worldPos.y, 0.0);
  float dy = y1 - y0;
  float h = abs(dy) > 1.0 ? (exp(-k * y0) - exp(-k * y1)) / (k * dy) : exp(-k * y0);
  h = max(h, 0.3);
  float fd = uFogDensity * dist;
  return clamp(1.0 - exp(-fd * fd * h), 0.0, 1.0);
}
vec3 fogTint(vec3 worldPos) {
  vec3 dir = normalize(worldPos - uCamPos);
  float toSun = pow(max(dot(dir, uSunDir), 0.0), 8.0) * 0.35;
  return mix(uFogColor, min(uSunColor, vec3(1.0)), toSun);
}
vec3 applyFog(vec3 color, vec3 worldPos) {
  return mix(color, fogTint(worldPos), fogAmount(worldPos));
}
`;

/** Toon vertex shader: static, skinned and instanced through three's own chunks. */
export const TOON_VERT = /* glsl */ `
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
uniform float uNearHide;
uniform vec3 uCamPos;
varying vec3 vBase;
varying float vEmis;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vPosL;
float gwHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
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
  vPosL = transformed;
  vec4 wp = vec4(transformed, 1.0);
  vec3 wn = objectNormal;
  #ifdef USE_INSTANCING
  wp = instanceMatrix * wp;
  wn = mat3(instanceMatrix) * wn;
  #endif
  wp = modelMatrix * wp;
  if (uWindOn > 0.5) {
    float wt = uTime;
    float ph = wt * 2.513 + wp.x * 0.07 + wp.z * 0.05;
    float s = sin(ph) + 0.35 * sin(wt * 5.3 + wp.x * 0.31 + wp.z * 0.27);
    float hh = clamp(transformed.y * 0.25, 0.0, 1.0);
    s *= uWind.y * hh * hh;
    wp.x += uWind.x * s;
    wp.z += uWind.z * s;
  }
  vNormalW = normalize(mat3(modelMatrix) * wn);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #ifdef USE_INSTANCING
  // near hide (vegetation): an instance whose trunk is within uNearHide x its scale of the camera, horizontally,
  // and whose crown reaches the camera height collapses to a point outside the view (no canopy filling the screen)
  if (uNearHide > 0.0) {
    vec4 io = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float sc = length(instanceMatrix[0].xyz);
    float r = uNearHide * sc;
    vec2 dh = io.xz - uCamPos.xz;
    if (dot(dh, dh) < r * r && uCamPos.y < io.y + r * 4.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
  #endif
}
`;

/** Toon fragment shader. */
export const TOON_FRAG = /* glsl */ `
${commonChunk('uGlobalRim')}
uniform vec3 uEmissiveColor;
uniform float uEmissiveIntensity;
uniform float uGlossy;
uniform vec3 uRimColor;
uniform float uRimStrength;
uniform float uDissolve;
uniform float uFlash;
uniform float uGhost;
uniform float uFogScale;
uniform vec4 uPointPos0;
uniform vec4 uPointPos1;
uniform vec3 uPointCol0;
uniform vec3 uPointCol1;
varying vec3 vBase;
varying float vEmis;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vPosL;
${lightingChunk('uGlobalRim')}
${FOG_CHUNK}
vec3 pointLight(vec3 base, vec3 n, vec4 lp, vec3 lc) {
  vec3 l = lp.xyz - vPosW;
  float d = length(l);
  float att = clamp(1.0 - d / max(lp.w, 0.001), 0.0, 1.0);
  float nl = dot(n, l / max(d, 0.001));
  return base * lc * att * att * (0.35 + 0.65 * smoothstep(0.0, 0.05, nl));
}
void main() {
  float edge = 0.0;
  if (uDissolve > 0.0) {
    float nz = gfxNoise(vPosL * 5.0) * 0.78 + clamp(vPosL.y * 0.22, 0.0, 1.0) * 0.22;
    float th = uDissolve * 1.08;
    if (nz < th) discard;
    edge = 1.0 - smoothstep(0.0, 0.07, nz - th);
  }
  vec3 n = normalize(vNormalW);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(uCamPos - vPosW);
  vec3 c = toonLight(vBase, n, v);
  if (uPointPos0.w > 0.0) c += pointLight(vBase, n, uPointPos0, uPointCol0);
  if (uPointPos1.w > 0.0) c += pointLight(vBase, n, uPointPos1, uPointCol1);
  if (uGlossy > 0.5) {
    vec3 hv = normalize(uSunDir + v);
    c += smoothstep(0.905, 0.935, dot(n, hv)) * step(-0.05, dot(n, uSunDir)) * min(uSunColor, vec3(1.0)) * 0.6;
  }
  c = min(c, vec3(1.0));
  if (uRimStrength > 0.0) c += smoothstep(0.55, 0.7, 1.0 - max(dot(n, v), 0.0)) * uRimColor * uRimStrength;
  c += vBase * vEmis + uEmissiveColor * uEmissiveIntensity;
  c += uRimColor * edge * 2.5;
  c = mix(c, applyFog(c, vPosW), uFogScale);
  c = mix(c, vec3(1.0), uFlash);
  gl_FragColor = vec4(c, uGhost);
  #include <colorspace_fragment>
}
`;

/** Unlit vertex shader (static and instanced, optional vertex and instance colours). */
export const UNLIT_VERT = /* glsl */ `
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

/** Unlit fragment shader; additive variants fade to black in fog instead of to the fog colour. */
export const UNLIT_FRAG = /* glsl */ `
${commonChunk('uGlobalRim')}
uniform vec3 uColor;
uniform float uOpacity;
uniform float uUseMap;
uniform sampler2D uMap;
uniform float uFogOn;
uniform float uAdditive;
varying vec3 vCol;
varying vec2 vUv;
varying vec3 vPosW;
${FOG_CHUNK}
void main() {
  vec4 c = vec4(uColor * vCol, uOpacity);
  if (uUseMap > 0.5) c *= texture2D(uMap, vUv);
  if (uFogOn > 0.5) {
    if (uAdditive > 0.5) c.rgb *= 1.0 - fogAmount(vPosW);
    else c.rgb = applyFog(c.rgb, vPosW);
  }
  gl_FragColor = c;
  #include <colorspace_fragment>
}
`;

/**
 * Inverted-hull outline (ART_UX 1.7): back faces pushed out along the clip-space normal for a constant width in
 * pixels (widthPx at 1080p, scaled by the render height, minimum 1 px). Colour = base x 0.25 shifted toward ink.
 * Shares the palette, wind, ghost and dissolve uniforms of the outlined material; hidden while ghosted or dissolving.
 */
export const OUTLINE_VERT = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
attribute float paletteIndex;
uniform float uTime;
uniform vec3 uWind;
uniform vec3 uColor;
uniform float uVertexColors;
uniform float uUsePalette;
uniform vec3 uPalette[16];
uniform float uWindOn;
uniform float uGhost;
uniform float uDissolve;
uniform float uWidthPx;
uniform vec2 uViewport;
uniform vec3 uInk;
uniform vec4 uOutlineColor;
varying vec3 vCol;
varying vec3 vPosW;
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec3 base = uColor;
  if (uUsePalette > 0.5) {
    int pi = int(clamp(paletteIndex + 0.5, 0.0, 15.0));
    base = uPalette[pi];
  }
  #ifdef USE_COLOR
  base *= mix(vec3(1.0), color.rgb, uVertexColors);
  #endif
  vCol = mix(mix(base * 0.25, uInk, 0.55), uOutlineColor.rgb, uOutlineColor.a);
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  if (uWindOn > 0.5) {
    float ph = uTime * 2.513 + wp.x * 0.07 + wp.z * 0.05;
    float s = sin(ph) + 0.35 * sin(uTime * 5.3 + wp.x * 0.31 + wp.z * 0.27);
    float hh = clamp(transformed.y * 0.25, 0.0, 1.0);
    s *= uWind.y * hh * hh;
    wp.x += uWind.x * s;
    wp.z += uWind.z * s;
  }
  vPosW = wp.xyz;
  vec4 clip = projectionMatrix * viewMatrix * wp;
  vec3 wn = normalize(mat3(modelMatrix) * objectNormal);
  vec2 cn = (projectionMatrix * viewMatrix * vec4(wn, 0.0)).xy * uViewport;
  float cl = length(cn);
  vec2 dir = cl > 1e-5 ? cn / cl : vec2(0.0);
  float px = max(uWidthPx * uViewport.y / 1080.0, 1.0);
  clip.xy += dir * px * 2.0 / uViewport * clip.w;
  if (uGhost < 0.99 || uDissolve > 0.001) clip = vec4(0.0, 0.0, -2.0, 1.0);
  gl_Position = clip;
}
`;

export const OUTLINE_FRAG = /* glsl */ `
${commonChunk('uGlobalRim')}
varying vec3 vCol;
varying vec3 vPosW;
${FOG_CHUNK}
void main() {
  gl_FragColor = vec4(applyFog(vCol, vPosW), 1.0);
  #include <colorspace_fragment>
}
`;

/** Instanced blob shadow: radial gradient disc with a per-instance alpha (ART_UX 1.5). */
export const BLOB_VERT = /* glsl */ `
attribute float aAlpha;
varying vec2 vUv;
varying float vA;
void main() {
  vUv = uv;
  vA = aAlpha;
  vec4 wp = vec4(position, 1.0);
  #ifdef USE_INSTANCING
  wp = instanceMatrix * wp;
  #endif
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * wp;
}
`;

export const BLOB_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
varying float vA;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.3, 1.0, d)) * vA;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;
