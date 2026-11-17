/**
 * Debug commands of the gfx package for scenarios (`__GAME__.cmd.gfx*`): a row of material test meshes.
 * Development tooling only; nothing here runs unless a command is called.
 * @module render/testbed
 */

import { Mesh, SphereGeometry, TorusKnotGeometry, CapsuleGeometry, BoxGeometry, Float32BufferAttribute, Group } from 'three';
import { PALETTE } from '../core/palette.js';

/** @param {any} ctx */
export function registerTestbed(ctx) {
  /** @type {any} */
  let group = null;

  function clear() {
    if (!group) return;
    const r = ctx.render;
    group.traverse((o) => {
      if (o.isMesh && o.name === 'gfx.test') r.outline.remove(o);
    });
    if (group.parent) group.parent.remove(group);
    group = null;
  }

  /**
   * A row of six meshes centred on (x, z), spaced along the axis perpendicular to `yaw`:
   * toon, palette, glossy, emissive, outlined, Form rim. Returns the centre.
   * @param {{ x?:number, z?:number, yaw?:number, spacing?:number }} [o]
   */
  function row(o = {}) {
    clear();
    const r = ctx.render;
    const p = ctx.player;
    const yaw = typeof o.yaw === 'number' ? o.yaw : p ? p.yaw : 0;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const cx = typeof o.x === 'number' ? o.x : (p ? p.pos.x : 0) + fx * 7;
    const cz = typeof o.z === 'number' ? o.z : (p ? p.pos.z : 0) + fz * 7;
    const sp = o.spacing || 2.2;
    group = new Group();
    group.name = 'gfx.testRow';
    const sphere = new SphereGeometry(0.8, 32, 18);
    const pal = new SphereGeometry(0.8, 32, 18);
    const pos = pal.getAttribute('position');
    const idx = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) idx[i] = pos.getY(i) > 0.15 ? 1 : pos.getY(i) < -0.35 ? 2 : 0;
    pal.setAttribute('paletteIndex', new Float32BufferAttribute(idx, 1));
    const meshes = [
      new Mesh(sphere, r.materials.toon({ color: PALETTE.paper })),
      new Mesh(pal, r.materials.toon({ palette: true })),
      new Mesh(new TorusKnotGeometry(0.5, 0.18, 96, 12), r.materials.toon({ color: 0x9fd8ff, glossy: true })),
      new Mesh(sphere, r.materials.toon({ color: PALETTE.structure.ringstone, emissive: PALETTE.ora, emissiveIntensity: 1.6 })),
      new Mesh(new CapsuleGeometry(0.55, 0.9, 6, 16), r.materials.toon({ color: PALETTE.biome.meadows.foliage })),
      new Mesh(new BoxGeometry(1.1, 1.1, 1.1), r.materials.toon({ color: PALETTE.structure.terracotta })),
    ];
    const pm = meshes[1].material.uniforms;
    pm.uPalette.value[0].setHex(PALETTE.structure.clay);
    pm.uPalette.value[1].setHex(PALETTE.structure.terracotta);
    pm.uPalette.value[2].setHex(PALETTE.structure.copper);
    pm.uEmissive.value[2] = 0;
    meshes[5].material.uniforms.uRimColor.value.setHex(PALETTE.ora);
    meshes[5].material.uniforms.uRimStrength.value = 0.9;
    const n = meshes.length;
    for (let i = 0; i < n; i++) {
      const m = meshes[i];
      const k = (i - (n - 1) / 2) * sp;
      const x = cx + fz * k;
      const z = cz - fx * k;
      const gy = ctx.world ? Math.max(0, ctx.world.groundAt(x, 500, z)) : 0;
      m.position.set(x, gy + 1.0, z);
      m.rotation.y = yaw + 0.6;
      m.name = 'gfx.test';
      group.add(m);
    }
    r.layers.actors.add(group);
    for (let i = 0; i < n; i++) r.outline.add(meshes[i], { widthPx: 2 });
    return { x: cx, z: cz, yaw };
  }

  ctx.debug.register('gfxTestRow', row);
  ctx.debug.register('gfxClearTest', clear);
}
