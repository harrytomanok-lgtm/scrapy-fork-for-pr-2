/**
 * Ocean and Veilstorm (ARCHITECTURE 4.1, ART_UX 1.8): one ocean plane that follows the camera, coloured from a
 * baked 512 x 512 water-depth texture (shallow turquoise to 6 m, deep beyond, a shoreline foam band 0-1.5 m with
 * animated breakup, hashed sun glints), and the Veilstorm wall at the world edge. Two programs.
 * @module world/water
 */

import {
  BufferGeometry, BufferAttribute, Mesh, ShaderMaterial, Color, DataTexture, RedFormat, HalfFloatType, LinearFilter,
  ClampToEdgeWrapping, DataUtils, DoubleSide, CylinderGeometry,
} from 'three';
import { PALETTE } from '../core/palette.js';
import { WORLD_HALF, WORLD_SIZE } from '../core/constants.js';

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
uniform sampler2D uDepth;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform float uHalf;
varying vec3 vPosW;
float wh(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
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
  float n1 = wn(vPosW.xz * 0.07 + vec2(t * 0.21, t * 0.13));
  float n2 = wn(vPosW.xz * 0.19 - vec2(t * 0.27, t * 0.09));
  float n = n1 * 0.6 + n2 * 0.4;
  // Two depth bands with a painted edge.
  float band = smoothstep(4.2, 6.5, depth + (n - 0.5) * 1.6);
  vec3 c = mix(uShallow, uDeep, band);
  c = mix(c, uDeep * 0.82, smoothstep(18.0, 40.0, depth));
  c = mix(c, uShallow * 1.08, (1.0 - smoothstep(0.0, 2.5, depth)) * 0.5);
  // Light: authored colours scaled by the sun and sky.
  c *= uSunColor * 0.55 + uAmbSky * 0.45;
  // Glints: hashed sparkles where the wave normal reflects the sun.
  vec3 wnrm = normalize(vec3((n1 - 0.5) * 0.35, 1.0, (n2 - 0.5) * 0.35));
  float spec = dot(reflect(-uSunDir, wnrm), v);
  float sparkle = step(0.82, wh(floor(vPosW.xz * 0.5) + floor(t * 3.0)));
  c += uSunColor * smoothstep(0.965, 0.985, spec) * sparkle * (1.0 - smoothstep(150.0, 700.0, dist));
  // Shoreline foam band (0 to 1.5 m) with animated breakup.
  float edge = 1.5 * (0.45 + 0.75 * n) + 0.18 * sin(t * 1.4 - depth * 2.6);
  float foam = (1.0 - smoothstep(edge - 0.12, edge + 0.04, depth)) * step(-0.6, depth);
  c = mix(c, uFoam * (uSunColor * 0.5 + uAmbSky * 0.5), foam);
  c = applyFog(c, vPosW);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
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
