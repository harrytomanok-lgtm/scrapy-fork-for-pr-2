/**
 * Inverted-hull outlines (ART_UX 1.7) with the tier rules of 7.1: low draws the player, the locked target and the
 * 6 nearest characters; high draws characters within 100 m and props within 40 m. A hull is a child of the outlined
 * mesh that shares its geometry (and skeleton for skinned meshes), so it follows every pose for free.
 * @module render/outline
 */

import { Mesh, SkinnedMesh } from 'three';

const MAX = 128;

/**
 * @param {any} ctx
 * @param {{ outline:(target:any, widthPx:number, color:number|undefined) => any }} materials
 * @param {() => any} getRender
 */
export function createOutlines(ctx, materials, getRender) {
  /** @type {{ target:any, hull:any, kind:number, dist:number }[]} kind 0 unknown, 1 character, 2 prop */
  const recs = [];
  let warned = false;

  /** @param {any} obj @returns {number} 1 when under layers.actors, 2 when under another layer, 0 when detached */
  function kindOf(obj) {
    const r = getRender();
    let p = obj.parent;
    while (p) {
      if (p === r.layers.actors) return 1;
      if (p.isScene) return 2;
      p = p.parent;
    }
    return 0;
  }

  /** @param {any} mesh @param {number} x @param {number} y @param {number} z @returns {number} squared distance */
  function dist2(mesh, x, y, z) {
    const e = mesh.matrixWorld.elements;
    const dx = e[12] - x;
    const dy = e[13] - y;
    const dz = e[14] - z;
    return dx * dx + dy * dy + dz * dz;
  }

  const api = {
    /**
     * @param {any} mesh @param {{ widthPx?:number, color?:number }} [opts]
     */
    add(mesh, opts) {
      if (!mesh || !mesh.isMesh) return;
      const o = opts || {};
      for (let i = 0; i < recs.length; i++) {
        if (recs[i].target === mesh) {
          recs[i].hull.material.uniforms.uWidthPx.value = o.widthPx > 0 ? o.widthPx : 2;
          return;
        }
      }
      if (mesh.isInstancedMesh || recs.length >= MAX) {
        if (!warned) ctx.log.warn('render', 'outline: instanced meshes and more than', MAX, 'outlines are not supported');
        warned = true;
        return;
      }
      const mat = materials.outline(mesh.material, o.widthPx || 2, o.color);
      let hull;
      if (mesh.isSkinnedMesh) {
        hull = new SkinnedMesh(mesh.geometry, mat);
        hull.bindMode = mesh.bindMode;
        hull.bind(mesh.skeleton, mesh.bindMatrix);
      } else {
        hull = new Mesh(mesh.geometry, mat);
      }
      hull.name = 'gfx.outlineHull';
      hull.frustumCulled = mesh.frustumCulled;
      hull.matrixAutoUpdate = false;
      hull.renderOrder = mesh.renderOrder;
      hull.visible = false;
      mesh.add(hull);
      recs.push({ target: mesh, hull, kind: 0, dist: 0 });
    },

    /** @param {any} mesh */
    remove(mesh) {
      for (let i = recs.length - 1; i >= 0; i--) {
        const r = recs[i];
        if (r.target !== mesh) continue;
        if (r.hull.parent) r.hull.parent.remove(r.hull);
        r.hull.material.dispose();
        recs[i] = recs[recs.length - 1];
        recs.pop();
      }
    },

    /** Number of hulls drawn this frame. */
    shown: 0,

    /**
     * Per-frame visibility by tier and distance.
     * @param {any} camera @param {any} caps
     * @param {number} px @param {number} py @param {number} pz  player position (NaN when none)
     * @param {number} tx @param {number} ty @param {number} tz  locked target position (NaN when none)
     */
    update(camera, caps, px, py, pz, tx, ty, tz) {
      const cx = camera.position.x;
      const cy = camera.position.y;
      const cz = camera.position.z;
      const charR2 = caps.outlineCharRange * caps.outlineCharRange;
      const propR2 = caps.outlinePropRange * caps.outlinePropRange;
      let candidates = 0;
      for (let i = 0; i < recs.length; i++) {
        const r = recs[i];
        if (r.kind === 0) r.kind = kindOf(r.target);
        r.hull.visible = false;
        r.dist = -1;
        if (r.kind === 0 || !r.target.visible) continue;
        const d2 = dist2(r.target, cx, cy, cz);
        if (r.kind === 2) {
          r.hull.visible = d2 <= propR2;
          continue;
        }
        if (d2 > charR2) continue;
        // forced: the player and the locked target (feet position within 1.5 m of the mesh origin)
        if (dist2(r.target, px, py, pz) < 2.25 || dist2(r.target, tx, ty, tz) < 2.25) {
          r.hull.visible = true;
          continue;
        }
        r.dist = d2;
        candidates++;
      }
      // the N nearest remaining characters (selection without sorting or allocation)
      let budget = caps.outlineNearest;
      while (budget > 0 && candidates > 0) {
        let best = -1;
        let bd = Infinity;
        for (let i = 0; i < recs.length; i++) {
          const r = recs[i];
          if (r.dist >= 0 && r.dist < bd) {
            bd = r.dist;
            best = i;
          }
        }
        if (best < 0) break;
        recs[best].hull.visible = true;
        recs[best].dist = -1;
        candidates--;
        budget--;
      }
      let n = 0;
      for (let i = 0; i < recs.length; i++) if (recs[i].hull.visible) n++;
      api.shown = n;
    },

    /** Drop every hull. */
    dispose() {
      for (let i = recs.length - 1; i >= 0; i--) api.remove(recs[i].target);
    },
  };
  return api;
}
