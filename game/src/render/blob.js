/**
 * Instanced blob shadows (ART_UX 1.5): one draw call, radial gradient, opacity 0.45, colour `PALETTE.blob`, under
 * every registered entity; the disc follows the terrain slope and shrinks and fades with altitude so it reads height
 * in flight.
 * @module render/blob
 */

import { InstancedMesh, InstancedBufferAttribute, PlaneGeometry, ShaderMaterial, Color, Matrix4, Vector3, Quaternion } from 'three';
import { PALETTE } from '../core/palette.js';
import { BLOB_VERT, BLOB_FRAG } from './glsl.js';
import { normalBlend } from './materials.js';

const MAX = 160;
const OPACITY = 0.45;

/** @param {any} ctx */
export function createBlobs(ctx) {
  const ids = new Int32Array(MAX);
  const radius = new Float32Array(MAX);
  /** @type {any} */
  let mesh = null;
  /** @type {any} */
  let alphaAttr = null;
  const m = new Matrix4();
  const pos = new Vector3();
  const nrm = new Vector3();
  const up = new Vector3(0, 1, 0);
  const q = new Quaternion();
  const scl = new Vector3();

  const api = {
    /** @param {any} layer the group to draw into */
    build(layer) {
      if (mesh) return;
      const geo = new PlaneGeometry(2, 2);
      geo.rotateX(-Math.PI / 2);
      const mat = new ShaderMaterial({
        uniforms: { uColor: { value: new Color(PALETTE.blob) } },
        vertexShader: BLOB_VERT,
        fragmentShader: BLOB_FRAG,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4,
      });
      normalBlend(mat);
      mat.name = 'gfx.blob';
      mesh = new InstancedMesh(geo, mat, MAX);
      alphaAttr = new InstancedBufferAttribute(new Float32Array(MAX), 1);
      geo.setAttribute('aAlpha', alphaAttr);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      mesh.name = 'gfx.blobs';
      layer.add(mesh);
    },
    /** @param {number} entId @param {number} r */
    add(entId, r) {
      const rr = r > 0 ? r : 0.5;
      for (let i = 0; i < MAX; i++) {
        if (ids[i] === entId) {
          radius[i] = rr;
          return;
        }
      }
      for (let i = 0; i < MAX; i++) {
        if (ids[i] === 0) {
          ids[i] = entId;
          radius[i] = rr;
          return;
        }
      }
    },
    /** @param {number} entId */
    remove(entId) {
      for (let i = 0; i < MAX; i++) if (ids[i] === entId) ids[i] = 0;
    },
    /** @returns {number} live blobs */
    count() {
      return mesh ? mesh.count : 0;
    },
    /**
     * @param {number} alpha interpolation factor
     * @param {{x:number,z:number}|null} [shadowC] centre of the shadow map box when the map is drawn
     * @param {number} [shadowHalf] its half size: grounded entities well inside it lose their blob (real shadow)
     */
    update(alpha, shadowC, shadowHalf = 0) {
      if (!mesh) return;
      const world = ctx.world;
      const arr = alphaAttr.array;
      let n = 0;
      for (let i = 0; i < MAX; i++) {
        const id = ids[i];
        if (id === 0) continue;
        const ent = ctx.ents.get(id);
        if (!ent) {
          ids[i] = 0;
          continue;
        }
        if (!ent.alive) continue;
        ctx.ents.renderPos(ent, alpha, pos);
        let gy = 0;
        if (world) {
          const g = world.groundAt(pos.x, pos.y + 0.5, pos.z);
          gy = g > 0 ? g : 0;
          const h0 = world.heightAt(pos.x, pos.z);
          if (gy > 0 && Math.abs(gy - h0) < 0.3) {
            const hx = world.heightAt(pos.x + 0.6, pos.z);
            const hz = world.heightAt(pos.x, pos.z + 0.6);
            nrm.set(h0 - hx, 0.6, h0 - hz).normalize();
          } else {
            nrm.copy(up);
          }
        } else {
          nrm.copy(up);
        }
        const alt = Math.max(0, pos.y - gy);
        if (alt > 120) continue;
        let k = Math.max(0.3, 1 - alt / 50);
        if (shadowC && alt < 8) {
          const dx = pos.x - shadowC.x;
          const dz = pos.z - shadowC.z;
          const d = Math.max(Math.abs(dx), Math.abs(dz));
          const t = Math.min(1, Math.max(0, (d - shadowHalf * 0.55) / (shadowHalf * 0.25)));
          // inside the map the real shadow takes over; a faint contact blob stays under the feet
          k *= 0.25 + 0.75 * t * t * (3 - 2 * t);
        }
        const s = radius[i] * 1.25 * Math.max(0.45, 1 - alt / 60);
        q.setFromUnitVectors(up, nrm);
        pos.y = gy + 0.05;
        scl.set(s, 1, s);
        m.compose(pos, q, scl);
        mesh.setMatrixAt(n, m);
        arr[n] = OPACITY * k;
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      alphaAttr.needsUpdate = true;
    },
    dispose() {
      if (!mesh) return;
      if (mesh.parent) mesh.parent.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh = null;
    },
  };
  return api;
}
