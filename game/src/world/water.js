/**
 * Ocean and Veilstorm (ARCHITECTURE 4.1, ART_UX 1.8): one ocean plane that follows the camera, coloured from a
 * baked 512 x 512 water-depth texture (clear turquoise over the sand, shallow to 6 m, deep beyond, darker far out),
 * two layers of drifting ripples, a sky-coloured Fresnel sheen at grazing angles, the sun's glint path (a broad sheen
 * when the sun is low, hashed sparkles near the camera) and soft shore foam (the contact line and wash bands rolling
 * in); and the Veilstorm wall at the world edge. Two programs; one depth fetch per water pixel, no other texture.
 * @module world/water
 */

import {
  BufferGeometry, BufferAttribute, Mesh, ShaderMaterial, Color, DataTexture, RedFormat, HalfFloatType, LinearFilter,
  ClampToEdgeWrapping, DataUtils, DoubleSide, CylinderGeometry,
} from 'three';
import { PALETTE } from '../core/palette.js';
import { WORLD_HALF, WORLD_SIZE } from '../core/constants.js';
import { polishUniforms } from './terrain.js';

/** Side of the water-depth texture. */
export const DEPTH_SIZE = 512;
const DEPTH_MIN = -24;
const DEPTH_MAX = 80;
const PLANE = 9000;

const WATER_VERT = /* glsl */ `
varying vec3 vPosW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WATER_FRAG = (glsl) => /* glsl */ `
${glsl.common}
${glsl.fog}
${glsl.grade || ''}
uniform sampler2D uDepth;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform float uHalf;
varying vec3 vPosW;
float wh(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float wn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wh(i), wh(i + vec2(1.0, 0.0)), f.x), mix(wh(i + vec2(0.0, 1.0)), wh(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 uv = (vPosW.xz + uHalf) / (2.0 * uHalf);
  float depth = texture2D(uDepth, clamp(uv, vec2(0.0005), vec2(0.9995))).r;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) depth = 80.0;
  float t = uTime;
  vec3 toCam = uCamPos - vPosW;
  float dist = length(toCam);
  vec3 v = toCam / max(dist, 0.001);
  float nearK = 1.0 - smoothstep(60.0, 260.0, dist);
  // two layers of ripples drifting across each other: a long swell along the wind, a short chop across it
  vec2 wd = normalize(uWind.xz + vec2(0.0001));
  vec2 p1 = vPosW.xz * 0.06 + wd * (t * 0.05);
  vec2 p2 = vec2(vPosW.x * 0.17 - vPosW.z * 0.05, vPosW.z * 0.17 + vPosW.x * 0.05) - wd.yx * (t * 0.11);
  float n1 = wn(p1);
  float n2 = wn(p2);
  float n = n1 * 0.6 + n2 * 0.4;
  vec3 wnrm = normalize(vec3((n1 - 0.5) * 0.5 + (n2 - 0.5) * 0.3 * nearK, 1.0, (n2 - 0.5) * 0.5 - (n1 - 0.5) * 0.2));
  // colour by depth: clear turquoise over the sand, a painted band edge, deep blue beyond, darker far out
  float band = smoothstep(4.2, 6.5, depth + (n - 0.5) * 1.6);
  vec3 c = mix(uShallow, uDeep, band);
  c = mix(c, uDeep * 0.72, smoothstep(14.0, 40.0, depth));
  c = mix(c, uShallow * 1.2, (1.0 - smoothstep(0.0, 2.2, depth)) * 0.55);
  c *= uSunColor * 0.5 + uAmbSky * 0.5;
  // ripple crests: thin lighter contour lines of the chop near the camera
  float crest = smoothstep(0.62, 0.7, n2) * (1.0 - smoothstep(0.7, 0.8, n2)) * nearK;
  c += (uAmbSky * 0.5 + uSunColor * 0.15) * crest * 0.35;
  // sky sheen at grazing angles (Fresnel): toward the distance the water takes the horizon colour
  float fres = pow(1.0 - clamp(dot(v, wnrm), 0.0, 1.0), 4.0);
  vec3 skyC = mix(uFogColor, uAmbSky, 0.55);
  c = mix(c, skyC, clamp(fres * 0.7, 0.0, 0.6));
  // the sun's glint path: a broad sheen toward the sun when it is low, hashed sparkles near the camera
  vec3 rv = reflect(-v, wnrm);
  float sd = max(dot(rv, uSunDir), 0.0);
  float lowL = 1.0 - smoothstep(0.2, 0.7, uSunDir.y);
  vec3 sunC = min(uSunColor, vec3(1.2));
  c += sunC * pow(sd, 24.0) * (0.18 + 0.4 * lowL);
  float sparkle = step(0.8, wh(floor(vPosW.xz * 0.6) + floor(t * 4.0)));
  c += sunC * smoothstep(0.93, 0.975, sd) * mix(1.0, sparkle, nearK) * (0.6 + 0.4 * lowL) * (1.0 - smoothstep(300.0, 1400.0, dist));
  // shore foam: the contact line plus soft wash bands rolling in, broken up by noise
  float edge = 0.45 + 0.6 * n + 0.15 * sin(t * 1.3 - depth * 2.4);
  float foam = (1.0 - smoothstep(edge - 0.25, edge + 0.1, depth)) * step(-0.6, depth);
  float wave = fract(t * 0.12 - depth * 0.32 + n1 * 0.35);
  float wash = smoothstep(0.82, 0.9, wave) * (1.0 - smoothstep(0.93, 0.99, wave)) * (1.0 - smoothstep(0.6, 2.8, depth)) * smoothstep(0.38, 0.6, n2);
  foam = max(foam, wash * 0.75);
  c = mix(c, uFoam * (uSunColor * 0.45 + uAmbSky * 0.55), clamp(foam, 0.0, 1.0));
  c = applyFog(c, vPosW);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
  ${glsl.grade ? 'gl_FragColor.rgb = gfxGrade(gl_FragColor.rgb);' : ''}
}
`;

const WALL_VERT = /* glsl */ `
varying vec3 vPosW;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WALL_FRAG = (glsl) => /* glsl */ `
${glsl.common}
uniform vec3 uStormA;
uniform vec3 uStormB;
uniform vec3 uStormC;
varying vec3 vPosW;
varying vec2 vUv;
float sh(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float sn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sh(i), sh(i + vec2(1.0, 0.0)), f.x), mix(sh(i + vec2(0.0, 1.0)), sh(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float t = uTime;
  vec2 p = vec2(vUv.x * 220.0, vUv.y * 14.0);
  float a = sn(p * vec2(1.0, 1.0) + vec2(t * 0.6, -t * 0.25));
  float b = sn(p * vec2(2.3, 3.1) + vec2(-t * 1.1, t * 0.4));
  float streak = sn(vec2(vUv.x * 900.0 + t * 3.0, vUv.y * 2.0));
  float m = a * 0.55 + b * 0.3 + streak * 0.15;
  vec3 c = mix(uStormA, uStormB, smoothstep(0.35, 0.7, m));
  c = mix(c, uStormC, smoothstep(0.78, 0.9, m));
  c *= uSunColor * 0.45 + uAmbSky * 0.55;
  float dist = length(uCamPos.xz - vPosW.xz);
  float near = 1.0 - smoothstep(150.0, 2600.0, dist);
  float alpha = (0.32 + 0.45 * m) * (0.45 + 0.55 * near);
  alpha *= smoothstep(0.0, 0.04, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
  gl_FragColor = vec4(c, clamp(alpha, 0.0, 0.92));
  #include <colorspace_fragment>
}
`;

/**
 * @param {any} ctx
 * @param {ReturnType<import('./gen/grid.js').createGrid>} grid
 * @param {number} wallRadius
 */
export function createWater(ctx, grid, wallRadius) {
  const glsl = ctx.render.glsl;
  const g = ctx.render.globals;
  const S = DEPTH_SIZE;
  const data = new Uint16Array(S * S);
  const texel = WORLD_SIZE / S;

  /** Water depth at the centre of texel (i, j). */
  function depthAt(i, j) {
    const x = -WORLD_HALF + (i + 0.5) * texel;
    const z = -WORLD_HALF + (j + 0.5) * texel;
    const d = -grid.heightAt(x, z);
    return d < DEPTH_MIN ? DEPTH_MIN : d > DEPTH_MAX ? DEPTH_MAX : d;
  }
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) data[j * S + i] = DataUtils.toHalfFloat(depthAt(i, j));
  const tex = new DataTexture(data, S, S, RedFormat, HalfFloatType);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array([-PLANE, 0, -PLANE, -PLANE, 0, PLANE, PLANE, 0, -PLANE, PLANE, 0, PLANE]), 3));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  const mat = new ShaderMaterial({
    uniforms: {
      uTime: g.uTime, uSunDir: g.uSunDir, uSunColor: g.uSunColor, uAmbSky: g.uAmbSky, uAmbGround: g.uAmbGround,
      uShadowTint: g.uShadowTint, uFogColor: g.uFogColor, uFogDensity: g.uFogDensity, uFogHeight: g.uFogHeight,
      uRimColor: g.uRimColor, uCamPos: g.uCamPos, uWind: g.uWind,
      ...polishUniforms(g),
      uDepth: { value: tex },
      uDeep: { value: new Color(PALETTE.ocean.deep) },
      uShallow: { value: new Color(PALETTE.ocean.shallow) },
      uFoam: { value: new Color(PALETTE.ocean.foam) },
      uHalf: { value: WORLD_HALF },
    },
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG(glsl),
  });
  const ocean = new Mesh(geo, mat);
  ocean.frustumCulled = false;
  ocean.matrixAutoUpdate = false;
  ctx.render.layers.world.add(ocean);

  const wallGeo = new CylinderGeometry(wallRadius, wallRadius, 1700, 96, 1, true);
  wallGeo.translate(0, 800, 0);
  const wallMat = new ShaderMaterial({
    uniforms: {
      uTime: g.uTime, uSunDir: g.uSunDir, uSunColor: g.uSunColor, uAmbSky: g.uAmbSky, uAmbGround: g.uAmbGround,
      uShadowTint: g.uShadowTint, uFogColor: g.uFogColor, uFogDensity: g.uFogDensity, uFogHeight: g.uFogHeight,
      uRimColor: g.uRimColor, uCamPos: g.uCamPos, uWind: g.uWind,
      uStormA: { value: new Color(PALETTE.sky.cloud[2]) },
      uStormB: { value: new Color(PALETTE.tempest) },
      uStormC: { value: new Color(PALETTE.sky.cloud[0]) },
    },
    vertexShader: WALL_VERT,
    fragmentShader: WALL_FRAG(glsl),
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const wall = new Mesh(wallGeo, wallMat);
  wall.frustumCulled = false;
  wall.matrixAutoUpdate = false;
  wall.renderOrder = 5;
  wall.updateMatrix();
  ctx.render.layers.world.add(wall);

  return {
    texture: tex,
    /** Decoded depth stored at texel (i, j) (tests). */
    texelDepth(i, j) {
      return DataUtils.fromHalfFloat(data[j * S + i]);
    },
    /** Keep the plane under the camera. */
    follow(x, z) {
      ocean.matrix.elements[12] = Math.round(x / 64) * 64;
      ocean.matrix.elements[14] = Math.round(z / 64) * 64;
      ocean.matrixWorldNeedsUpdate = true;
    },
    /** Re-sample the texels around (x, z, r) after a grid edit. */
    edited(x, z, r) {
      const i0 = Math.max(0, Math.floor((x - r + WORLD_HALF) / texel) - 1);
      const i1 = Math.min(S - 1, Math.ceil((x + r + WORLD_HALF) / texel) + 1);
      const j0 = Math.max(0, Math.floor((z - r + WORLD_HALF) / texel) - 1);
      const j1 = Math.min(S - 1, Math.ceil((z + r + WORLD_HALF) / texel) + 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) data[j * S + i] = DataUtils.toHalfFloat(depthAt(i, j));
      tex.needsUpdate = true;
    },
    dispose() {
      for (const m of [ocean, wall]) {
        if (m.parent) m.parent.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      }
      tex.dispose();
    },
  };
}
