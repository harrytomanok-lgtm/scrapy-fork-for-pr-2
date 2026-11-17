/**
 * The instanced particle renderer (ART_UX 3.1): one pooled simulation (logic/pool.js), three draw calls (additive
 * soft, additive streak, alpha dust) sharing one program and the canvas atlas, plus per-frame "immediate" sprites
 * (projectile cores, glow sprites, pillars, icons) appended to the same buffers. Allocation-free per frame.
 * @module vfx/particles
 */

import {
  InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, Mesh, ShaderMaterial, AdditiveBlending, NormalBlending,
} from 'three';
import { createParticlePool, cullCoverage } from './logic/pool.js';
import { particleShaders } from './shaders.js';

export const MAX_POOL = 3500;
const MAX_IMM = 800;
const PER_MAT = MAX_POOL + MAX_IMM;
/** Overdraw cap on low: additive particles may cover at most this fraction of the screen. */
export const OVERDRAW_LOW = 0.4;

/** @param {any} ctx */
export function createParticles(ctx) {
  const pool = createParticlePool(MAX_POOL);
  const imm = {
    n: 0,
    px: new Float32Array(MAX_IMM), py: new Float32Array(MAX_IMM), pz: new Float32Array(MAX_IMM),
    vx: new Float32Array(MAX_IMM), vy: new Float32Array(MAX_IMM), vz: new Float32Array(MAX_IMM),
    size: new Float32Array(MAX_IMM), rot: new Float32Array(MAX_IMM), cell: new Float32Array(MAX_IMM), len: new Float32Array(MAX_IMM),
    r: new Float32Array(MAX_IMM), g: new Float32Array(MAX_IMM), b: new Float32Array(MAX_IMM), a: new Float32Array(MAX_IMM),
    core: new Float32Array(MAX_IMM), mat: new Uint8Array(MAX_IMM),
  };
  /** @type {{ mesh:any, geo:any, pos:any, vel:any, p:any, c:any, n:number, attrs:any[] }[]} */
  const gpu = [];
  let built = false;

  const api = {
    pool,
    /** @param {any} render @param {any} atlas */
    build(render, atlas) {
      if (built) return;
      built = true;
      const sh = particleShaders(render.glsl);
      const g = render.globals;
      for (let m = 0; m < 3; m++) {
        const geo = new InstancedBufferGeometry();
        geo.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
        geo.setIndex([0, 1, 2, 0, 2, 3]);
        const pos = new InstancedBufferAttribute(new Float32Array(PER_MAT * 3), 3);
        const vel = new InstancedBufferAttribute(new Float32Array(PER_MAT * 4), 4);
        const p = new InstancedBufferAttribute(new Float32Array(PER_MAT * 4), 4);
        const c = new InstancedBufferAttribute(new Float32Array(PER_MAT * 4), 4);
        pos.setUsage(35048);
        vel.setUsage(35048);
        p.setUsage(35048);
        c.setUsage(35048);
        geo.setAttribute('iPos', pos);
        geo.setAttribute('iVel', vel);
        geo.setAttribute('iP', p);
        geo.setAttribute('iC', c);
        geo.instanceCount = 0;
        const mat = new ShaderMaterial({
          uniforms: {
            uTime: g.uTime, uSunDir: g.uSunDir, uSunColor: g.uSunColor, uAmbSky: g.uAmbSky, uAmbGround: g.uAmbGround,
            uShadowTint: g.uShadowTint, uFogColor: g.uFogColor, uFogDensity: g.uFogDensity, uFogHeight: g.uFogHeight,
            uRimColor: g.uRimColor, uCamPos: g.uCamPos, uWind: g.uWind,
            uAtlas: { value: atlas }, uAdditive: { value: m === 2 ? 0 : 1 },
          },
          vertexShader: sh.vert,
          fragmentShader: sh.frag,
          transparent: true,
          depthWrite: false,
          blending: m === 2 ? NormalBlending : AdditiveBlending,
        });
        mat.name = 'gfx.particles';
        const mesh = new Mesh(geo, mat);
        mesh.frustumCulled = false;
        mesh.renderOrder = m === 2 ? 5 : 6;
        mesh.name = m === 0 ? 'gfx.particlesAdd' : m === 1 ? 'gfx.particlesStreak' : 'gfx.particlesDust';
        render.layers.vfx.add(mesh);
        gpu.push({ mesh, geo, pos, vel, p, c, n: 0, attrs: [pos, vel, p, c] });
      }
    },

    /**
     * One sprite for this frame only (not pooled, not counted in vfx.count()).
     * @param {number} mat @param {number} x @param {number} y @param {number} z @param {number} size @param {number} rot
     * @param {number} cell @param {number} r @param {number} g @param {number} b @param {number} a @param {number} core
     * @param {number} len streak length (0 = billboard) @param {number} dx @param {number} dy @param {number} dz streak direction
     */
    sprite(mat, x, y, z, size, rot, cell, r, g, b, a, core, len, dx, dy, dz) {
      const i = imm.n;
      if (i >= MAX_IMM) return;
      imm.n = i + 1;
      imm.mat[i] = mat;
      imm.px[i] = x; imm.py[i] = y; imm.pz[i] = z;
      imm.vx[i] = dx; imm.vy[i] = dy; imm.vz[i] = dz;
      imm.size[i] = size; imm.rot[i] = rot; imm.cell[i] = cell; imm.len[i] = len;
      imm.r[i] = r; imm.g[i] = g; imm.b[i] = b; imm.a[i] = a; imm.core[i] = core;
    },

    /** Drop this frame's immediate sprites (after upload). */
    clearSprites() {
      imm.n = 0;
    },

    /**
     * Fill the GPU buffers from the pool and the immediate sprites.
     * @param {any} camera @param {boolean} low  apply the overdraw cap
     */
    upload(camera, low) {
      if (!built) return;
      const P = pool;
      const live = P.live;
      if (low && camera) {
        const f = 1 / Math.tan((camera.fov * Math.PI) / 360);
        const aspect = camera.aspect || 1;
        const cx = camera.position.x;
        const cy = camera.position.y;
        const cz = camera.position.z;
        for (let i = 0; i < live; i++) {
          if (P.mat[i] === 2) {
            P.area[i] = 0;
            continue;
          }
          const dx = P.px[i] - cx;
          const dy = P.py[i] - cy;
          const dz = P.pz[i] - cz;
          const d = Math.max(0.3, Math.sqrt(dx * dx + dy * dy + dz * dz));
          P.dist[i] = d;
          const t = P.age[i] / P.life[i];
          const sz = P.s0[i] + (P.s1[i] - P.s0[i]) * t;
          let len = sz;
          if (P.stretch[i] > 0) len = Math.sqrt(P.vx[i] * P.vx[i] + P.vy[i] * P.vy[i] + P.vz[i] * P.vz[i]) * P.stretch[i] + sz;
          else if (P.stretch[i] < 0) len = -P.stretch[i];
          const sn = (sz * f) / d;
          const ln = (len * f) / d;
          // a soft sprite covers about a third of its quad; one sprite never counts more than the screen
          P.area[i] = Math.min(1, (sn * ln * 0.35) / (4 * aspect));
        }
        cullCoverage(P, OVERDRAW_LOW, 48);
      }
      for (let m = 0; m < 3; m++) gpu[m].n = 0;
      for (let i = 0; i < P.live; i++) {
        const m = P.mat[i];
        const G = gpu[m];
        const k = G.n++;
        const t = P.age[i] / P.life[i];
        const e = 1 - (1 - t) * (1 - t);
        const sz = P.s0[i] + (P.s1[i] - P.s0[i]) * e;
        let a = P.ca[i];
        const fi = P.fadeIn[i];
        if (fi > 0 && t < fi) a *= t / fi;
        if (m === 2) a *= Math.pow(1 - t, 1.3) * Math.min(1, t * 12 + 0.25);
        else a *= fi > 0 ? 1 - Math.max(0, (t - fi) / (1 - fi)) ** 2 : 1 - t * t;
        let cell = P.cell[i];
        const fr = P.frames[i];
        if (fr > 1) cell += Math.min(fr - 1, Math.floor(t * fr));
        let len = 0;
        const st = P.stretch[i];
        if (st > 0) len = Math.sqrt(P.vx[i] * P.vx[i] + P.vy[i] * P.vy[i] + P.vz[i] * P.vz[i]) * st + sz;
        else if (st < 0) len = -st;
        const pa = G.pos.array;
        const va = G.vel.array;
        const ppa = G.p.array;
        const ca = G.c.array;
        pa[k * 3] = P.px[i]; pa[k * 3 + 1] = P.py[i]; pa[k * 3 + 2] = P.pz[i];
        va[k * 4] = P.vx[i]; va[k * 4 + 1] = P.vy[i]; va[k * 4 + 2] = P.vz[i]; va[k * 4 + 3] = P.core[i];
        ppa[k * 4] = sz; ppa[k * 4 + 1] = P.rot[i] + P.rotV[i] * P.age[i]; ppa[k * 4 + 2] = cell; ppa[k * 4 + 3] = len;
        ca[k * 4] = P.cr[i]; ca[k * 4 + 1] = P.cg[i]; ca[k * 4 + 2] = P.cb[i]; ca[k * 4 + 3] = a;
      }
      for (let i = 0; i < imm.n; i++) {
        const G = gpu[imm.mat[i]];
        const k = G.n++;
        const pa = G.pos.array;
        const va = G.vel.array;
        const ppa = G.p.array;
        const ca = G.c.array;
        pa[k * 3] = imm.px[i]; pa[k * 3 + 1] = imm.py[i]; pa[k * 3 + 2] = imm.pz[i];
        va[k * 4] = imm.vx[i]; va[k * 4 + 1] = imm.vy[i]; va[k * 4 + 2] = imm.vz[i]; va[k * 4 + 3] = imm.core[i];
        ppa[k * 4] = imm.size[i]; ppa[k * 4 + 1] = imm.rot[i]; ppa[k * 4 + 2] = imm.cell[i]; ppa[k * 4 + 3] = imm.len[i];
        ca[k * 4] = imm.r[i]; ca[k * 4 + 1] = imm.g[i]; ca[k * 4 + 2] = imm.b[i]; ca[k * 4 + 3] = imm.a[i];
      }
      for (let m = 0; m < 3; m++) {
        const G = gpu[m];
        G.geo.instanceCount = G.n;
        G.mesh.visible = G.n > 0;
        if (G.n === 0) continue;
        for (let j = 0; j < 4; j++) {
          const at = G.attrs[j];
          at.clearUpdateRanges();
          at.addUpdateRange(0, G.n * at.itemSize);
          at.needsUpdate = true;
        }
      }
    },

    /** Remove the meshes. */
    dispose() {
      for (let m = 0; m < gpu.length; m++) {
        const G = gpu[m];
        if (G.mesh.parent) G.mesh.parent.remove(G.mesh);
        G.geo.dispose();
        G.mesh.material.dispose();
      }
      gpu.length = 0;
      built = false;
    },
  };
  return api;
}
