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
 * Shadow map and cloud shadow receivers (render polish). Uniforms live in render.globals:
 * uShadowMat maps world space to the map's [0,1] cube; uShadowP = (strength, 1/size, depth bias, on);
 * uShadowC = (centre x, centre z, half size, 0); uCloudMap is the sky's cloud noise, uCloudP = (offset u, offset v,
 * uv per metre, strength), uCloudQ = (coverage, cloud plane height, 0, 0).
 * The vertex part writes vShadow (the receiver's map coordinate, pushed out along the normal against acne).
 */
export const SHADOW_VERT_CHUNK = /* glsl */ `
uniform mat4 uShadowMat;
uniform vec4 uShadowP;
varying vec3 vShadow;
void gfxShadowCoord(vec3 wp, vec3 wn) {
  vShadow = uShadowP.w > 0.5 ? (uShadowMat * vec4(wp + wn * 0.07, 1.0)).xyz : vec3(-1.0);
}
`;

export const SHADOW_FRAG_CHUNK = /* glsl */ `
uniform sampler2D uShadowMap;
uniform vec4 uShadowP;
uniform vec4 uShadowC;
uniform sampler2D uCloudMap;
uniform vec4 uCloudP;
uniform vec4 uCloudQ;
varying vec3 vShadow;
float gfxShadowTap(vec2 uv, float z) {
  return step(z, texture2D(uShadowMap, uv).r);
}
// 1 lit, 0 shadowed; fades out at the box edge. The large map (high tier) takes nine nearest taps with quadratic
// B-spline weights and a clean toon edge. The small map takes four taps blended bilinearly and keeps the edge soft
// over about a texel: sharpening four taps showed the texel grid as a sawtooth along every shadow edge.
float gfxShadow(vec3 posW) {
  if (uShadowP.w < 0.5) return 1.0;
  vec3 sp = vShadow;
  if (sp.x <= 0.0 || sp.y <= 0.0 || sp.x >= 1.0 || sp.y >= 1.0 || sp.z >= 1.0) return 1.0;
  float z = sp.z - uShadowP.z;
  float t = uShadowP.y;
  float s;
  if (t < 0.0007) {
    vec2 c = sp.xy / t;
    vec2 n = floor(c) + 0.5;
    vec2 d = c - n;
    vec2 w0 = 0.5 * (0.5 - d) * (0.5 - d);
    vec2 w1 = 0.75 - d * d;
    vec2 w2 = 0.5 * (0.5 + d) * (0.5 + d);
    vec2 b = n * t;
    s = w0.y * (w0.x * gfxShadowTap(b + vec2(-t, -t), z) + w1.x * gfxShadowTap(b + vec2(0.0, -t), z) + w2.x * gfxShadowTap(b + vec2(t, -t), z))
      + w1.y * (w0.x * gfxShadowTap(b + vec2(-t, 0.0), z) + w1.x * gfxShadowTap(b, z) + w2.x * gfxShadowTap(b + vec2(t, 0.0), z))
      + w2.y * (w0.x * gfxShadowTap(b + vec2(-t, t), z) + w1.x * gfxShadowTap(b + vec2(0.0, t), z) + w2.x * gfxShadowTap(b + vec2(t, t), z));
    s = smoothstep(0.3, 0.7, s);
  } else {
    vec2 st = sp.xy / t - 0.5;
    vec2 f = fract(st);
    vec2 b = (floor(st) + 0.5) * t;
    s = mix(mix(gfxShadowTap(b, z), gfxShadowTap(b + vec2(t, 0.0), z), f.x),
            mix(gfxShadowTap(b + vec2(0.0, t), z), gfxShadowTap(b + vec2(t, t), z), f.x), f.y);
    s = smoothstep(0.06, 0.94, s);
  }
  vec2 e = abs(posW.xz - uShadowC.xy) / uShadowC.z;
  float fade = smoothstep(0.72, 0.97, max(e.x, e.y));
  return mix(1.0, s, uShadowP.x * (1.0 - fade));
}
// 1 clear, lower under the drifting cloud shadows: the sky's cloud noise projected down along the light
float gfxCloud(vec3 posW) {
  if (uCloudP.w <= 0.0) return 1.0;
  vec2 p = posW.xz + uSunDir.xz * ((uCloudQ.y - posW.y) / max(uSunDir.y, 0.25));
  float n = texture2D(uCloudMap, p * uCloudP.z + uCloudP.xy).r;
  float th = 1.0 - uCloudQ.x;
  return 1.0 - uCloudP.w * smoothstep(th - 0.05, th + 0.08, n);
}
`;

/**
 * Final grade of the phone tier (render polish, item 5), applied to the display value at the end of the world
 * shaders: a small contrast curve around mid grey, a saturation lift and a gentle vignette. uGrade = (contrast,
 * saturation, vignette, on); uScreen = (width, height, 1/width, 1/height) of the drawing buffer. The high tier
 * grades in its composite pass instead (on = 0 here).
 */
export const GRADE_CHUNK = /* glsl */ `
uniform vec4 uGrade;
uniform vec4 uScreen;
vec3 gfxGrade(vec3 c) {
  if (uGrade.w < 0.5) return c;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uGrade.y);
  c = clamp(c, 0.0, 1.0);
  // contrast: a soft S around 0.5 that keeps black and white
  vec3 s = c * c * (3.0 - 2.0 * c);
  c = mix(c, s, uGrade.x);
  vec2 q = (gl_FragCoord.xy * uScreen.zw - 0.5) * vec2(uScreen.x * uScreen.w, 1.0);
  float r = length(q) / max(0.5 * uScreen.x * uScreen.w, 0.5) ;
  c *= 1.0 - uGrade.z * smoothstep(0.55, 1.45, r);
  return c;
}
`;

/**
 * The three-band toon light (ART_UX 1.7): shadow below NdotL -0.05, mid below 0.45, else lit; each edge smoothed
 * over 0.04. Shadow = base x shadow tint (lifted by the hemisphere ambient), mid = base x 0.82 mixed 10% toward the
 * shadow, lit = base x sun. Rim: smoothstep(0.62, 0.72, 1 - NdotV) x max(0, NdotL + 0.4), global rim colour, 0.35.
 * @param {string} rimName
 * @returns {string}
 */
export function lightingChunk(rimName) {
  return /* glsl */ `
${SHADOW_FRAG_CHUNK}
vec3 toonShadow(vec3 base, vec3 n) {
  vec3 amb = mix(uAmbGround, uAmbSky, n.y * 0.5 + 0.5);
  return base * (uShadowTint * 0.8 + amb * 0.38);
}
// sh: 1 lit, 0 in a cast shadow (gfxShadow); cl: 1 clear sky, lower under a cloud shadow (gfxCloud)
vec3 toonLightS(vec3 base, vec3 n, vec3 viewDir, float sh, float cl) {
  float ndl = dot(n, uSunDir);
  float lit = smoothstep(0.43, 0.47, ndl);
  float mid = smoothstep(-0.07, -0.03, ndl);
  vec3 shadowC = toonShadow(base, n);
  vec3 sunC = min(uSunColor, vec3(1.6));
  vec3 midC = mix(base * 0.82 * sunC, shadowC, 0.1);
  vec3 litC = base * sunC;
  vec3 c = mix(shadowC, mix(midC, litC, lit), mid);
  // a cast shadow drops the sunlit side to the shadow band, lifted a quarter toward mid (never darker than it was)
  c = mix(min(c, mix(shadowC, midC, 0.25)), c, sh);
  // a cloud shadow: the sunlit side loses part of the sun and takes some sky
  c = mix(c, mix(shadowC, midC, 0.62), (1.0 - cl) * mid * sh);
  float rim = smoothstep(0.62, 0.72, 1.0 - max(dot(n, viewDir), 0.0)) * max(0.0, ndl + 0.4) * (1.0 - n.y * n.y);
  return c + rim * ${rimName} * 0.35 * (0.4 + 0.6 * sh);
}
vec3 toonLight(vec3 base, vec3 n, vec3 viewDir) {
  return toonLightS(base, n, viewDir, 1.0, 1.0);
}
`;
}

/**
 * Height fog and aerial perspective (ART_UX 1.2 rule 4, 1.5): the exponential-squared fog of 1.5 plus a linear
 * exponential haze that builds with distance, both thinned by the exponential height integral between camera and
 * point (floor 0.22), so near ground stays crisp, far ridges recede in layers and peaks stand clear of hazy valleys.
 * Colour: the region fog (= the sky's horizon); nearer haze leans toward the cool sky ambient; toward the sun (or
 * moon) it lerps to the light colour, more when the light is low.
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
  h = max(h, 0.22);
  float fd = uFogDensity * dist;
  float air = fd * 1.2;
  return clamp(1.0 - exp(-(fd * fd + air) * h), 0.0, 1.0);
}
vec3 fogTint(vec3 worldPos) {
  vec3 dir = normalize(worldPos - uCamPos);
  float lowL = 1.0 - smoothstep(0.15, 0.6, uSunDir.y);
  float toSun = pow(max(dot(dir, uSunDir), 0.0), 6.0) * (0.3 + 0.35 * lowL);
  return mix(uFogColor, min(uSunColor, vec3(1.0)), toSun);
}
vec3 applyFog(vec3 color, vec3 worldPos) {
  float a = fogAmount(worldPos);
  vec3 t = fogTint(worldPos);
  t = mix(t, mix(t, uAmbSky, 0.5), 0.45 * (1.0 - smoothstep(0.15, 0.7, a)));
  return mix(color, t, a);
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
${SHADOW_VERT_CHUNK}
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
  #ifdef USE_INSTANCING
  // negative uNearHide (ground tufts): instances shrink toward their root as they near the camera instead of
  // vanishing, so the foreground keeps its texture without giant blades across the lens
  if (uNearHide < 0.0) {
    vec4 io0 = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float k = smoothstep(-uNearHide * 0.2, -uNearHide, length(io0.xz - uCamPos.xz));
    wp.xyz = io0.xyz + (wp.xyz - io0.xyz) * (0.55 + 0.45 * k);
  }
  #endif
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
  gfxShadowCoord(wp.xyz, vNormalW);
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
uniform float uCharRim;
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
${GRADE_CHUNK}
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
  float sh = gfxShadow(vPosW);
  vec3 c = toonLightS(vBase, n, v, sh, gfxCloud(vPosW));
  if (uPointPos0.w > 0.0) c += pointLight(vBase, n, uPointPos0, uPointCol0);
  if (uPointPos1.w > 0.0) c += pointLight(vBase, n, uPointPos1, uPointCol1);
  if (uGlossy > 0.5) {
    vec3 hv = normalize(uSunDir + v);
    c += smoothstep(0.905, 0.935, dot(n, hv)) * step(-0.05, dot(n, uSunDir)) * min(uSunColor, vec3(1.0)) * 0.6;
  }
  c = min(c, vec3(1.0));
  if (uCharRim > 0.0) {
    // characters never sink into the dark: a lifted shadow floor and a cool moonlit rim that grow as the light drops
    float lum = dot(uSunColor, vec3(0.3, 0.55, 0.15)) + dot(uAmbSky, vec3(0.3, 0.55, 0.15));
    float dark = 1.0 - smoothstep(0.25, 0.9, lum);
    float fr = smoothstep(0.45, 0.72, 1.0 - max(dot(n, v), 0.0));
    vec3 rimC = mix(vec3(1.0, 0.95, 0.86), vec3(0.62, 0.74, 1.0), dark);
    c = max(c, vBase * (0.14 + 0.26 * dark) * uCharRim);
    c += rimC * fr * (0.08 + 0.42 * dark) * uCharRim;
    // sun-side rim: the silhouette edge turned toward the sun (or moon) catches its colour, strongest when the light
    // is low and behind the character; it separates the hero from the ground at golden hour
    float sideL = max(0.0, dot(n, uSunDir) + 0.25) * (0.55 + 0.45 * max(0.0, -dot(uSunDir, v)));
    float low = 1.0 - smoothstep(0.25, 0.8, uSunDir.y);
    c += min(uSunColor, vec3(1.0)) * smoothstep(0.5, 0.78, 1.0 - max(dot(n, v), 0.0)) * sideL * (0.22 + 0.33 * low) * (0.5 + 0.5 * sh) * uCharRim;
  }
  if (uRimStrength > 0.0) c += smoothstep(0.55, 0.7, 1.0 - max(dot(n, v), 0.0)) * uRimColor * uRimStrength;
  c += vBase * vEmis + uEmissiveColor * uEmissiveIntensity;
  c += uRimColor * edge * 2.5;
  if (uFogScale > 1.0) {
    // fogScale above 1 thickens the fog for this material (density x fogScale): far decor fades into the air
    float fa = 1.0 - pow(1.0 - fogAmount(vPosW), uFogScale * uFogScale);
    c = mix(c, fogTint(vPosW), fa);
  } else {
    c = mix(c, applyFog(c, vPosW), uFogScale);
  }
  c = mix(c, vec3(1.0), uFlash);
  gl_FragColor = vec4(c, uGhost);
  #include <colorspace_fragment>
  gl_FragColor.rgb = gfxGrade(gl_FragColor.rgb);
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
