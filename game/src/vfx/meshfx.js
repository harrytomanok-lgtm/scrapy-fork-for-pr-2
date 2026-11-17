/**
 * Pooled mesh effects: beams (cylinders with a scrolling core), shells (aura shells and sphere shockwaves) and
 * ground decals draped on the terrain (scorch, cracks, telegraph rings and shapes, shock rings, glyph rings).
 * Each pooled object owns one material instance; all share the three programs of vfx/shaders.js.
 * @module vfx/meshfx
 */

import {
  Mesh, CylinderGeometry, SphereGeometry, BufferGeometry, BufferAttribute, ShaderMaterial, Color, Vector3, Quaternion,
  AdditiveBlending, NormalBlending,
} from 'three';
import { PALETTE } from '../core/palette.js';
import { beamShaders, shellShaders, decalShaders } from './shaders.js';

export const MAX_BEAMS = 16;
export const MAX_SHELLS = 28;
export const MAX_DECALS = 40;
const GRID = 17;

/** @param {any} g render.globals @returns {object} */
function globalUniforms(g) {
  return {
    uTime: g.uTime, uSunDir: g.uSunDir, uSunColor: g.uSunColor, uAmbSky: g.uAmbSky, uAmbGround: g.uAmbGround,
    uShadowTint: g.uShadowTint, uFogColor: g.uFogColor, uFogDensity: g.uFogDensity, uFogHeight: g.uFogHeight,
    uRimColor: g.uRimColor, uCamPos: g.uCamPos, uWind: g.uWind,
  };
}

/**
 * Fringe colour of the three-layer rule (ART_UX 3.1): hue -25 degrees, darker.
 * @param {any} src Color @param {any} out Color @returns {any}
 */
export function fringeOf(src, out) {
  out.copy(src).offsetHSL(-25 / 360, 0.05, -0.12);
  return out;
}

/** @param {any} ctx */
export function createMeshFx(ctx) {
  /** @type {any[]} */
  const beams = [];
  /** @type {any[]} */
  const shells = [];
  /** @type {any[]} */
  const decals = [];
  let built = false;
  let decalSeq = 1;
  const up = new Vector3(0, 1, 0);
  const tmpV = new Vector3();
  const tmpQ = new Quaternion();

  const api = {
    beams, shells, decals,
    /** @param {any} render */
    build(render) {
      if (built) return;
      built = true;
      const layer = render.layers.vfx;
      const gU = render.globals;
      // beams
      const bsh = beamShaders(render.glsl);
      const beamGeo = new CylinderGeometry(1, 1, 1, 12, 1, true);
      beamGeo.translate(0, 0.5, 0);
      for (let i = 0; i < MAX_BEAMS; i++) {
        const mat = new ShaderMaterial({
          uniforms: Object.assign(globalUniforms(gU), {
            uColor: { value: new Color(PALETTE.ora) }, uFringe: { value: new Color(PALETTE.ora) }, uIntensity: { value: 1.6 },
            uAlpha: { value: 1 }, uLen: { value: 1 }, uGrow: { value: 1 }, uPulse: { value: 1 }, uSpeed: { value: 14 },
          }),
          vertexShader: bsh.vert, fragmentShader: bsh.frag, transparent: true, depthWrite: false, blending: AdditiveBlending,
        });
        mat.name = 'gfx.beam';
        const mesh = new Mesh(beamGeo, mat);
        mesh.frustumCulled = false;
        mesh.visible = false;
        mesh.renderOrder = 7;
        mesh.name = 'gfx.beam';
        layer.add(mesh);
        beams.push({
          mesh, mat, active: false, t: 0, fade: 0, fadeT: 0, ax: 0, ay: 0, az: 0, bx: 0, by: 1, bz: 0, radius: 0.3, intensity: 1,
          baseRadius: 0.3, light: null, timed: -1, followA: 0, followB: 0, socketA: 'chest', ending: false, kind: 0, gen: 0, handle: null,
          ringT: 0, hasSet: false,
        });
      }
      // shells
      const ssh = shellShaders(render.glsl);
      const shellGeo = new SphereGeometry(1, 28, 18);
      for (let i = 0; i < MAX_SHELLS; i++) {
        const mat = new ShaderMaterial({
          uniforms: Object.assign(globalUniforms(gU), {
            uColor: { value: new Color(PALETTE.ora) }, uFringe: { value: new Color(PALETTE.ora) }, uIntensity: { value: 1.4 },
            uAlpha: { value: 1 }, uStyle: { value: 0 }, uPhase: { value: 0 }, uFlare: { value: 0 },
          }),
          vertexShader: ssh.vert, fragmentShader: ssh.frag, transparent: true, depthWrite: false, blending: AdditiveBlending,
        });
        mat.name = 'gfx.shell';
        const mesh = new Mesh(shellGeo, mat);
        mesh.frustumCulled = false;
        mesh.visible = false;
        mesh.renderOrder = 7;
        mesh.name = 'gfx.shell';
        layer.add(mesh);
        shells.push({ mesh, mat, active: false, kind: 0, t: 0, seconds: 0.3, radius: 1, x: 0, y: 0, z: 0, entId: 0 });
      }
      // decals
      const dsh = decalShaders(render.glsl);
      const index = [];
      for (let j = 0; j < GRID - 1; j++) {
        for (let i = 0; i < GRID - 1; i++) {
          const a = j * GRID + i;
          index.push(a, a + GRID, a + 1, a + 1, a + GRID, a + GRID + 1);
        }
      }
      const uv = new Float32Array(GRID * GRID * 2);
      for (let j = 0; j < GRID; j++) {
        for (let i = 0; i < GRID; i++) {
          uv[(j * GRID + i) * 2] = (i / (GRID - 1)) * 2 - 1;
          uv[(j * GRID + i) * 2 + 1] = (j / (GRID - 1)) * 2 - 1;
        }
      }
      for (let i = 0; i < MAX_DECALS; i++) {
        const geo = new BufferGeometry();
        geo.setAttribute('position', new BufferAttribute(new Float32Array(GRID * GRID * 3), 3));
        geo.setAttribute('uv', new BufferAttribute(uv, 2));
        geo.setIndex(index);
        const mat = new ShaderMaterial({
          uniforms: Object.assign(globalUniforms(gU), {
            uKind: { value: 0 }, uStyle: { value: 0 }, uShape: { value: 0 }, uColor: { value: new Color(PALETTE.scorch) },
            uColor2: { value: new Color(PALETTE.scorchRim) }, uInkC: { value: new Color(PALETTE.ink) }, uT: { value: 0 },
            uFill: { value: 0 }, uAlpha: { value: 1 }, uRing: { value: 0 }, uSeed: { value: 0 }, uAspect: { value: 1 }, uCone: { value: 0.52 },
          }),
          vertexShader: dsh.vert, fragmentShader: dsh.frag, transparent: true, depthWrite: false, blending: NormalBlending,
          polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
        });
        mat.name = 'gfx.decal';
        const mesh = new Mesh(geo, mat);
        mesh.frustumCulled = false;
        mesh.visible = false;
        mesh.renderOrder = 2;
        mesh.name = 'gfx.decal';
        layer.add(mesh);
        decals.push({
          mesh, mat, geo, active: false, id: 0, kind: 0, t: 0, seconds: -1, age: 0, autoFill: 0, fill: 0, out: 0, outT: 0,
          x: 0, z: 0, radius: 1, cx: 0, cz: 0,
        });
      }
    },

    /**
     * Drape a decal grid on the terrain. Shape 0: square of half-size r around (x,z) rotated by `rot`;
     * 1: rectangle from (x,z) along (dx,dz), length L, half-width r; 2: square of side L ahead of the apex.
     * @param {any} d @param {number} shape @param {number} x @param {number} z @param {number} r @param {number} L
     * @param {number} dx @param {number} dz @param {number} rot
     */
    drape(d, shape, x, z, r, L, dx, dz, rot) {
      const world = ctx.world;
      const arr = d.geo.attributes.position.array;
      let fx = dx;
      let fz = dz;
      if (shape === 0) {
        fx = Math.sin(rot);
        fz = Math.cos(rot);
      }
      const fl = Math.hypot(fx, fz) || 1;
      fx /= fl;
      fz /= fl;
      const sx = fz;
      const sz = -fx;
      let cx = 0;
      let cz = 0;
      for (let j = 0; j < GRID; j++) {
        const v = (j / (GRID - 1)) * 2 - 1;
        for (let i = 0; i < GRID; i++) {
          const u = (i / (GRID - 1)) * 2 - 1;
          let wx;
          let wz;
          if (shape === 0) {
            wx = x + sx * u * r + fx * v * r;
            wz = z + sz * u * r + fz * v * r;
          } else if (shape === 1) {
            const along = (v * 0.5 + 0.5) * L;
            wx = x + fx * along + sx * u * r;
            wz = z + fz * along + sz * u * r;
          } else {
            const along = (v * 0.5 + 0.5) * L;
            wx = x + fx * along + sx * u * L;
            wz = z + fz * along + sz * u * L;
          }
          const h = world ? world.heightAt(wx, wz) : 0;
          const o = (j * GRID + i) * 3;
          arr[o] = wx;
          arr[o + 1] = (h > 0 ? h : 0) + 0.07;
          arr[o + 2] = wz;
          cx += wx;
          cz += wz;
        }
      }
      d.cx = cx / (GRID * GRID);
      d.cz = cz / (GRID * GRID);
      d.geo.attributes.position.needsUpdate = true;
    },

    /** @returns {any|null} a free decal (the oldest timed one is recycled when full) */
    freeDecal() {
      let oldest = null;
      let oa = -1;
      for (let i = 0; i < decals.length; i++) {
        const d = decals[i];
        if (!d.active) return d;
        if (d.seconds > 0 && d.age > oa) {
          oa = d.age;
          oldest = d;
        }
      }
      return oldest;
    },

    /** @param {any} d */
    startDecal(d) {
      d.active = true;
      d.id = decalSeq++;
      d.age = 0;
      d.out = 0;
      d.outT = 0;
      d.mesh.visible = true;
      return d.id;
    },

    /** @param {number} id @returns {any|null} */
    findDecal(id) {
      for (let i = 0; i < decals.length; i++) if (decals[i].active && decals[i].id === id) return decals[i];
      return null;
    },

    /** @returns {any|null} */
    freeShell() {
      for (let i = 0; i < shells.length; i++) if (!shells[i].active) return shells[i];
      return null;
    },

    /** @returns {any|null} */
    freeBeam() {
      for (let i = 0; i < beams.length; i++) if (!beams[i].active) return beams[i];
      return null;
    },

    /**
     * Place a beam mesh from A to B with a visible fraction `grow`.
     * @param {any} b
     */
    placeBeam(b) {
      const dx = b.bx - b.ax;
      const dy = b.by - b.ay;
      const dz = b.bz - b.az;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-3) {
        b.mesh.visible = false;
        return 0;
      }
      tmpV.set(dx / len, dy / len, dz / len);
      tmpQ.setFromUnitVectors(up, tmpV);
      b.mesh.quaternion.copy(tmpQ);
      b.mesh.position.set(b.ax, b.ay, b.az);
      b.mesh.scale.set(b.radius, len, b.radius);
      b.mat.uniforms.uLen.value = len;
      b.mesh.visible = true;
      return len;
    },

    dispose() {
      const all = [];
      for (const b of beams) all.push(b.mesh);
      for (const s of shells) all.push(s.mesh);
      for (const d of decals) {
        all.push(d.mesh);
        d.geo.dispose();
      }
      for (const m of all) {
        if (m.parent) m.parent.remove(m);
        m.material.dispose();
      }
      beams.length = 0;
      shells.length = 0;
      decals.length = 0;
      built = false;
    },
  };
  return api;
}
