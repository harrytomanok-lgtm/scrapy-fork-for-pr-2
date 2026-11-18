/**
 * VFX shader sources, built on `render.glsl` chunks and `render.globals` (ARCHITECTURE 7.2 rule 11).
 * Four programs: particles (shared by the three particle materials), beams, shells (auras and sphere waves) and
 * ground decals (scorch, cracks, telegraph rings and shapes, shock rings, glyph rings). Features are uniforms.
 * @module vfx/shaders
 */

/** @param {{ common:string, fog:string }} glsl */
export function particleShaders(glsl) {
  const vert = /* glsl */ `
${glsl.common}
attribute vec3 iPos;
attribute vec4 iVel;
attribute vec4 iP;
attribute vec4 iC;
varying vec2 vUv;
varying vec4 vC;
varying float vCore;
varying vec3 vPosW;
void main() {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec2 c = position.xy;
  float s = iP.x;
  vec3 wp;
  float cy = c.y;
  if (iP.w > 0.0) {
    vec3 d = iVel.xyz;
    float dl = length(d);
    d = dl > 1e-5 ? d / dl : up;
    vec3 toCam = normalize(uCamPos - iPos);
    vec3 side = cross(d, toCam);
    float sl = length(side);
    side = sl > 1e-5 ? side / sl : right;
    wp = iPos + d * (c.y * iP.w) + side * (c.x * s);
    cy = -c.y;
  } else {
    float cs = cos(iP.y);
    float sn = sin(iP.y);
    vec2 rc = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * s;
    wp = iPos + right * rc.x + up * rc.y;
  }
  float cell = iP.z;
  float col = mod(cell, 4.0);
  float row = floor(cell / 4.0 + 0.001);
  vUv = vec2((col + 0.5 + c.x * 0.98) * 0.25, 1.0 - (row + 0.5 - cy * 0.98) * 0.25);
  vC = iC;
  vCore = iVel.w;
  vPosW = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
  const frag = /* glsl */ `
${glsl.common}
${glsl.fog}
uniform sampler2D uAtlas;
uniform float uAdditive;
varying vec2 vUv;
varying vec4 vC;
varying float vCore;
varying vec3 vPosW;
void main() {
  vec4 t = texture2D(uAtlas, vUv);
  float a = t.a * vC.a;
  if (a < 0.003) discard;
  vec3 c = vC.rgb;
  if (uAdditive > 0.5) {
    float m = max(max(c.r, c.g), max(c.b, 1.0));
    c = mix(c, vec3(m), clamp(t.r * vCore * 0.9, 0.0, 1.0));
    a *= 1.0 - fogAmount(vPosW);
  } else {
    c *= 0.7 + 0.42 * t.g;
    c = applyFog(c, vPosW);
  }
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}
`;
  return { vert, frag };
}

/** Beam: open cylinder along local +Y (0..1), white core at 30% radius, body, fringe, scrolling noise, pulses. */
export function beamShaders(glsl) {
  const vert = /* glsl */ `
varying vec2 vUv;
varying vec3 vPosW;
varying vec3 vNrmW;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  vNrmW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
  const frag = /* glsl */ `
${glsl.common}
${glsl.fog}
uniform vec3 uColor;
uniform vec3 uFringe;
uniform float uIntensity;
uniform float uAlpha;
uniform float uLen;
uniform float uGrow;
uniform float uPulse;
uniform float uSpeed;
uniform float uCore;
varying vec2 vUv;
varying vec3 vPosW;
varying vec3 vNrmW;
void main() {
  vec3 v = normalize(uCamPos - vPosW);
  float f = abs(dot(normalize(vNrmW), v));
  float along = vUv.y * uLen;
  float n = gfxNoise(vec3(vUv.x * 7.0, along * 0.45 - uTime * uSpeed, 1.7));
  float n2 = gfxNoise(vec3(vUv.x * 13.0 + 3.0, along * 1.1 - uTime * uSpeed * 1.7, 5.1));
  float body = smoothstep(0.05, 0.55, f + (n - 0.5) * 0.35);
  float core = smoothstep(0.84, 0.97, f + (n2 - 0.5) * 0.1);
  float p = fract(along / 6.0 - uTime * 1.6);
  float pulse = smoothstep(0.86, 0.97, p) * (1.0 - smoothstep(0.97, 1.0, p)) * uPulse;
  vec3 c = mix(uFringe, uColor, body);
  c *= uIntensity * (1.0 + pulse * 1.5);
  c = mix(c, vec3(max(1.0, uIntensity)), core * uCore);
  float a = (body * (0.4 + 0.4 * n) + core * 0.6) * uAlpha;
  float ends = smoothstep(0.0, 0.6, along) * (1.0 - smoothstep(uGrow * uLen - 0.6, uGrow * uLen, along));
  a *= ends * (1.0 - fogAmount(vPosW));
  gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;
  return { vert, frag };
}

/**
 * Shell: an ellipsoid around a point. Style 0 = expanding sphere wave (fresnel), 1 base aura, 2 ember, 3 tempest,
 * 4 zenith, 5 enemy. Auras: lantern-glow fresnel shell crossed by three rising ring bands.
 */
export function shellShaders(glsl) {
  const vert = /* glsl */ `
varying vec3 vLocal;
varying vec3 vPosW;
varying vec3 vNrmW;
void main() {
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  vNrmW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
  const frag = /* glsl */ `
${glsl.common}
${glsl.fog}
uniform vec3 uColor;
uniform vec3 uFringe;
uniform float uIntensity;
uniform float uAlpha;
uniform float uStyle;
uniform float uPhase;
uniform float uFlare;
varying vec3 vLocal;
varying vec3 vPosW;
varying vec3 vNrmW;
void main() {
  vec3 v = normalize(uCamPos - vPosW);
  vec3 n = normalize(vNrmW);
  float fres = 1.0 - abs(dot(n, v));
  float a;
  vec3 c;
  if (uStyle < 0.5) {
    float rim = pow(fres, 3.0);
    float nz = gfxNoise(vLocal * 4.0 + vec3(0.0, uTime * 2.0, 0.0));
    a = (rim * 0.65 + 0.015) * (0.6 + 0.6 * nz);
    c = mix(uFringe, uColor, rim);
    c = mix(c, vec3(1.0), smoothstep(0.75, 1.0, rim) * 0.6);
  } else if (uStyle > 5.5) {
    // Flame aura (camera-facing plane, vLocal.xy in [-1, 1]): a soft additive silhouette of energy rising off the
    // body, widest at the feet and thinning into flickering tongues above the head. uStyle 6 ember, 7 tempest,
    // 8 zenith, 9 gather; +5 is the front layer (wisps and streaks only, so the body stays readable).
    // uColor = body, uFringe = tips, uPhase = flow time, uFlare = swell.
    float front = step(10.5, uStyle);
    float st = uStyle - front * 5.0;
    float y01 = vLocal.y * 0.5 + 0.5;
    float ax = abs(vLocal.x);
    float spd = st > 7.5 && st < 8.5 ? 0.45 : st > 6.5 && st < 7.5 ? 1.6 : 1.0;
    float t = uPhase;
    float n1 = gfxNoise(vec3(vLocal.x * 2.3, vLocal.y * 1.5 - t * 1.1 * spd, st * 3.1 + front * 7.0));
    float n2 = gfxNoise(vec3(vLocal.x * 5.5, vLocal.y * 3.2 - t * 2.3 * spd, 4.0 + st));
    float prof = mix(0.95, 0.16, pow(y01, 0.85)) * (1.0 + uFlare * 0.3);
    // separate tongues in the upper half: the width breathes with a slow noise across x
    float tong = gfxNoise(vec3(vLocal.x * 3.2, y01 * 1.3 - t * 1.4 * spd, 11.0 + st));
    prof *= mix(1.0, 0.4 + 1.0 * tong, smoothstep(0.3, 0.85, y01));
    float wob = (n1 - 0.5) * 0.55 * (0.25 + y01) + (n2 - 0.5) * 0.26 * y01;
    float edge = prof + wob - ax;
    float body = smoothstep(0.0, 0.28, edge);
    float top = 1.0 - smoothstep(0.55 + 0.3 * n1, 1.0, y01);
    float bottom = smoothstep(0.0, 0.1, y01);
    float rimK = 1.0 - smoothstep(0.02, 0.36, edge);
    float mask = body * top * bottom;
    float tipK = smoothstep(0.5, 1.0, y01 + (n2 - 0.5) * 0.35);
    c = mix(uColor, uFringe, tipK);
    float streak = 0.0;
    if (st > 6.5 && st < 7.5) {
      // Tempest: wind streaks spiralling up (opposite slant on the front layer reads as a helix)
      float sl = mix(1.1, -1.1, front);
      float s = fract(vLocal.y * 2.4 + vLocal.x * sl - t * 1.9);
      streak = smoothstep(0.09, 0.0, abs(s - 0.5) - 0.02) * smoothstep(1.0, 0.2, ax) * smoothstep(0.02, 0.2, y01);
      c = mix(c, uFringe * 1.3, streak);
    } else if (st > 7.5 && st < 8.5) {
      // Zenith: slow vertical light rays
      float ray = gfxNoise(vec3(vLocal.x * 7.0, y01 * 0.6 - t * 0.2, 9.0));
      streak = smoothstep(0.62, 0.9, ray) * 0.8;
      c = mix(c, vec3(1.0), 0.3 + streak * 0.4);
    } else {
      // Ember and Gather: hot licks climbing the flame
      float lick = gfxNoise(vec3(vLocal.x * 3.0, vLocal.y * 2.0 - t * 2.8 * spd, 2.0 + front));
      streak = smoothstep(0.6, 0.85, lick);
      c = mix(c, uFringe * 1.2, streak * 0.5);
    }
    float hot = (1.0 - y01) * smoothstep(0.25, 0.75, edge);
    c = mix(c, vec3(1.0), hot * 0.2);
    if (front > 0.5) {
      a = mask * (rimK * 0.22 + streak * 0.55) * (0.7 + 0.6 * n2);
    } else {
      // back layer is alpha-blended (true hue on any ground): a soft body, a stronger rim, flowing licks
      a = mask * (0.36 + 0.5 * rimK + streak * 0.3) * (0.6 + 0.6 * n2);
    }
  } else {
    float y01 = vLocal.y * 0.5 + 0.5;
    float rim = pow(fres, 1.7);
    float bands = 0.0;
    float f = fract(y01 * 1.5 - uPhase);
    float w = uStyle > 3.5 && uStyle < 4.5 ? 0.05 : 0.08;
    bands += smoothstep(w, 0.0, abs(f - 0.5));
    float tongue = 0.0;
    if (uStyle > 1.5 && uStyle < 2.5) {
      float nz = gfxNoise(vec3(vLocal.x * 3.0, vLocal.y * 2.5 - uTime * 3.5, vLocal.z * 3.0));
      tongue = smoothstep(0.45, 0.85, nz + (1.0 - y01) * 0.35) * 0.9;
    } else if (uStyle > 2.5 && uStyle < 3.5) {
      float nz = gfxNoise(vec3(vLocal.x * 9.0, vLocal.y * 9.0 + uTime * 11.0, vLocal.z * 9.0));
      tongue = step(0.86, nz) * 1.4;
    } else {
      float nz = gfxNoise(vec3(vLocal.x * 4.0, vLocal.y * 3.0 - uTime * 1.6, vLocal.z * 4.0));
      tongue = smoothstep(0.55, 0.9, nz) * 0.35;
    }
    float fadeY = smoothstep(-1.0, -0.55, vLocal.y) * (1.0 - smoothstep(0.55, 1.0, vLocal.y));
    a = (rim * 0.75 + bands * (0.35 + rim * 0.65) + tongue * rim + uFlare * 0.5) * fadeY;
    c = mix(uFringe, uColor, rim);
    c = mix(c, vec3(1.0), bands * 0.55 + uFlare * 0.3);
  }
  a *= uAlpha * (1.0 - fogAmount(vPosW));
  gl_FragColor = vec4(c * uIntensity, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;
  return { vert, frag };
}

/**
 * Ground decal on a terrain-draped grid; uv in [-1, 1]. uKind: 0 scorch, 1 crack, 2 telegraph ring, 3 telegraph
 * shape (uShape 0 circle, 1 line, 2 cone), 4 shock ring, 5 glyph ring. uStyle for telegraphs: 0 white, 1 red, 2 violet.
 */
export function decalShaders(glsl) {
  const vert = /* glsl */ `
varying vec2 vP;
varying vec3 vPosW;
void main() {
  vP = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
  const frag = /* glsl */ `
${glsl.common}
${glsl.fog}
uniform float uKind;
uniform float uStyle;
uniform float uShape;
uniform vec3 uColor;
uniform vec3 uColor2;
uniform vec3 uInkC;
uniform float uT;
uniform float uFill;
uniform float uAlpha;
uniform float uRing;
uniform float uSeed;
uniform float uAspect;
uniform float uCone;
varying vec2 vP;
varying vec3 vPosW;
float ringLine(float r, float at, float w) { return smoothstep(w, 0.0, abs(r - at)); }
void main() {
  vec2 p = vP;
  float r = length(p);
  float ang = atan(p.y, p.x);
  vec3 c = uColor;
  float a = 0.0;
  if (uKind < 0.5) {
    // one noise octave plus a cheap angular ripple: a scorch can fill the screen (camera in the crater)
    float n = gfxNoise(vec3(p * 3.2, uSeed)) * 0.85 + (sin(ang * 9.0 + uSeed * 3.0) * 0.5 + 0.5) * 0.15;
    float e = r + (n - 0.5) * 0.42;
    a = (1.0 - smoothstep(0.62, 0.95, e)) * 0.92;
    float rimBand = smoothstep(0.42, 0.7, e) * (1.0 - smoothstep(0.72, 0.9, e));
    float cool = 1.0 - smoothstep(0.0, 0.55, uT);
    c = mix(uColor, uColor2 * 2.2, rimBand * cool * (0.6 + 0.4 * n));
    a = max(a, rimBand * cool);
    a *= 1.0 - smoothstep(0.75, 1.0, uT);
  } else if (uKind < 1.5) {
    float n = gfxNoise(vec3(p * 4.0, uSeed));
    float k = abs(fract(ang * 1.114 + n * 0.45 + uSeed) - 0.5);
    float line = smoothstep(0.05, 0.0, k * (r + 0.15)) * (1.0 - smoothstep(0.55, 1.0, r));
    float pit = 1.0 - smoothstep(0.1, 0.3, r + (n - 0.5) * 0.2);
    a = max(line, pit * 0.8) * (1.0 - smoothstep(0.7, 1.0, uT));
    c = uInkC;
  } else if (uKind < 2.5) {
    float pulse = ringLine(r, fract(uT * 2.0) * 0.95, 0.06) * 0.6;
    if (uStyle < 0.5) {
      a = ringLine(r, 0.9, 0.07) + pulse + (1.0 - smoothstep(0.0, 0.9, r)) * 0.12;
    } else if (uStyle < 1.5) {
      float notch = step(0.16, fract(ang * 1.2732 + 0.08));
      float outer = ringLine(r, 0.9, 0.07) * notch;
      float inner = ringLine(r, 0.74, 0.03);
      float tri = step(abs(fract(ang * 1.2732) - 0.5), 0.12) * smoothstep(0.98, 0.94, r) * smoothstep(0.78, 0.82, r);
      a = max(outer, max(inner, tri)) + (1.0 - smoothstep(0.0, 0.9, r)) * 0.18;
      float border = ringLine(r, 1.0, 0.03);
      c = mix(c, uInkC, border);
      a = max(a, border * 0.8);
    } else {
      float s = fract(ang * 0.4775 + r * 1.6 - uTime * 0.9);
      a = smoothstep(0.12, 0.0, abs(s - 0.5) - 0.3) * (1.0 - smoothstep(0.85, 1.0, r)) * 0.8 + ringLine(r, 0.92, 0.05);
    }
    a = min(a, 1.0) * smoothstep(1.0, 0.97, r);
  } else if (uKind < 3.5) {
    float inside;
    float prog;
    float border;
    if (uShape < 0.5) {
      inside = 1.0 - smoothstep(0.97, 1.0, r);
      prog = r;
      border = ringLine(r, 0.97, 0.04);
    } else if (uShape < 1.5) {
      float ex = abs(p.x);
      float t = p.y * 0.5 + 0.5;
      inside = (1.0 - smoothstep(0.92, 1.0, ex)) * smoothstep(0.0, 0.02, t) * (1.0 - smoothstep(0.98, 1.0, t));
      prog = t;
      border = max(smoothstep(0.08, 0.0, abs(ex - 0.93)), smoothstep(0.03 / uAspect, 0.0, abs(t - 0.985))) * inside;
    } else {
      vec2 q = vec2(p.x, p.y * 0.5 + 0.5);
      float rr = length(q);
      float aa = abs(atan(q.x, q.y));
      inside = (1.0 - smoothstep(uCone - 0.02, uCone, aa)) * (1.0 - smoothstep(0.97, 1.0, rr)) * step(0.0, q.y);
      prog = rr;
      border = max(ringLine(rr, 0.97, 0.03), smoothstep(0.04, 0.0, abs(aa - uCone + 0.03)) * step(rr, 1.0)) * step(0.0, q.y);
    }
    float filled = 1.0 - smoothstep(uFill - 0.015, uFill, prog);
    float front = ringLine(prog, uFill, 0.03) * step(0.01, uFill);
    a = inside * (0.16 + filled * 0.34) + front * inside * 0.9 + border * 0.95;
    c = mix(uColor, vec3(1.0), front * 0.25);
    if (uStyle > 0.5 && uStyle < 1.5) {
      float hatch = step(0.5, fract((p.x + p.y) * 6.0)) * 0.1 * inside;
      a += hatch;
    }
    a = min(a, 1.0);
  } else if (uKind < 4.5) {
    float w = 0.05 + 0.1 * (1.0 - uT);
    a = ringLine(r, uRing, w) * (1.0 - uT) * 0.95 + (1.0 - smoothstep(0.0, uRing, r)) * 0.12 * (1.0 - uT);
    c = mix(uColor, vec3(1.0), ringLine(r, uRing, w * 0.35) * 0.5);
  } else if (uKind < 5.5) {
    float spin = ang + uTime * 1.2;
    float ticks = step(0.7, fract(spin * 3.8197)) * step(0.62, r) * step(r, 0.8);
    a = (ringLine(r, 0.9, 0.04) + ringLine(r, 0.55, 0.03) + ticks) * (1.0 - smoothstep(0.6, 1.0, uT)) * smoothstep(0.0, 0.1, uT);
    c = uColor;
  } else {
    // Form light on the ground (uRing: 2 ember, 3 tempest, 4 zenith), strength uFill: a soft pool of the Form
    // colour plus the Form's own pattern, so a Form reads on the phone without bloom.
    float pool = 1.0 - smoothstep(0.0, 1.0, r);
    pool *= pool;
    if (uRing < 1.5) {
      // Gather: rings of light drawn inward toward the feet, faster as the charge grows
      float rr = fract(r * 2.4 + uTime * 0.9);
      a = pool * 0.35 + smoothstep(0.08, 0.0, abs(rr - 0.5) - 0.02) * (1.0 - smoothstep(0.7, 1.0, r)) * 0.7 + ringLine(r, 0.93, 0.04) * 0.8;
    } else if (uRing < 2.5) {
      float n = gfxNoise(vec3(p * 3.0, uTime * 1.5));
      float lick = gfxNoise(vec3(ang * 2.0, r * 4.0 - uTime * 2.2, 1.7));
      float heat = smoothstep(0.35, 0.0, abs(r - 0.62 - (lick - 0.5) * 0.25)) * (0.55 + 0.45 * n);
      a = pool * (0.55 + 0.35 * n) + heat * 0.8;
    } else if (uRing < 3.5) {
      float s = fract(ang * 0.4775 + r * 0.8 - uTime * 1.4);
      float arcs = smoothstep(0.1, 0.0, abs(s - 0.5) - 0.3) * smoothstep(0.3, 0.55, r) * (1.0 - smoothstep(0.82, 1.0, r));
      a = pool * 0.4 + arcs * 0.75;
    } else {
      float rr = fract(r * 2.2 - uTime * 0.45);
      a = pool * 0.45 + ringLine(rr, 0.5, 0.06) * (1.0 - smoothstep(0.65, 1.0, r)) * 0.75;
    }
    a = min(a, 1.0) * uFill;
    c = mix(uColor, vec3(1.0), pool * 0.3);
  }
  a *= uAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(applyFog(c, vPosW), clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;
  return { vert, frag };
}
