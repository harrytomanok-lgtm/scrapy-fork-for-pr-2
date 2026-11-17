/**
 * Debug commands of the gfx package for scenarios (`__GAME__.cmd.gfx*`): the VFX gallery, a beam with the four aura
 * styles, and a telegraph line-up. Development tooling only; nothing here runs unless a command is called.
 * @module vfx/testbed
 */

import { IDS } from '../core/ids.js';
import { PALETTE } from '../core/palette.js';

/** @param {any} ctx */
export function registerVfxTestbed(ctx) {
  /** @param {number} x @param {number} z */
  function ground(x, z) {
    return ctx.world ? Math.max(0, ctx.world.groundAt(x, 800, z)) : 0;
  }
  /** Frame of reference in front of the player: forward (fx, fz), right (rx, rz). */
  function frame(dist) {
    const p = ctx.player;
    const yaw = p ? p.yaw : 0;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    return { x: (p ? p.pos.x : 0) + fx * dist, z: (p ? p.pos.z : 0) + fz * dist, fx, fz, rx: -fz, rz: fx };
  }

  /**
   * Trigger every recipe id of IDS.vfx on a grid. Continuous recipes are previewed as half a second of emission.
   * @param {{ dist?:number, cols?:number, spacing?:number, only?:string[] }} [o]
   */
  function gallery(o = {}) {
    const ids = o.only || IDS.vfx;
    const cols = o.cols || 8;
    const sp = o.spacing || 5;
    const f = frame(o.dist || 22);
    const rows = Math.ceil(ids.length / cols);
    for (let i = 0; i < ids.length; i++) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const u = (c - (cols - 1) / 2) * sp;
      const v = ((rows - 1) / 2 - r) * sp;
      const x = f.x + f.rx * u + f.fx * v;
      const z = f.z + f.rz * u + f.fz * v;
      const y = ground(x, z) + 1.2;
      const big = ids[i] === 'siphon_break' || ids[i] === 'ult_impact' || ids[i] === 'transform_burst' || ids[i] === 'ult_sigil';
      ctx.vfx.burst(ids[i], x, y, z, { dirX: 0, dirY: 1, dirZ: 0, scale: big ? 0.15 : 1 });
      ctx.vfx.preview(ids[i], x, y, z, 0.5);
    }
    return ids.length;
  }

  /** @type {number[]} */
  let actorIds = [];
  /** @type {any[]} */
  let handles = [];
  /** @type {any} */
  let beam = null;

  /**
   * Four actors with the four aura styles, and a charged beam between two points beside them.
   * @param {{ dist?:number, intensity?:number }} [o]
   */
  function beamAura(o = {}) {
    clearBeamAura();
    const f = frame(o.dist || 9);
    const styles = ['base', 'ember', 'tempest', 'zenith'];
    for (let i = 0; i < 4; i++) {
      const u = (i - 1.5) * 3.2;
      const x = f.x + f.rx * u;
      const z = f.z + f.rz * u;
      const id = ctx.debug.api.spawn('choir_acolyte', { x, z, passive: true });
      if (!id) continue;
      actorIds.push(id);
      const h = ctx.vfx.aura(id);
      h.set(typeof o.intensity === 'number' ? o.intensity : 1, undefined, styles[i]);
      handles.push(h);
    }
    const ax = f.x - f.rx * 6 + f.fx * 4;
    const az = f.z - f.rz * 6 + f.fz * 4;
    const bx = f.x + f.rx * 6 + f.fx * 4;
    const bz = f.z + f.rz * 6 + f.fz * 4;
    beam = ctx.vfx.beam({ color: PALETTE.ora, radius: 0.45 });
    beam.set(ax, ground(ax, az) + 1.6, az, bx, ground(bx, bz) + 1.6, bz, 0.45, 1);
    return actorIds.slice();
  }

  /** Keep the test beam alive (its owner would call set every frame). */
  function holdBeam() {
    return !!beam;
  }

  function clearBeamAura() {
    for (const h of handles) h.dispose();
    handles = [];
    if (beam) beam.end(0.18);
    beam = null;
    actorIds = [];
  }

  /**
   * White, red and violet telegraphs with their ground shapes on passive enemies.
   * @param {{ dist?:number, seconds?:number }} [o]
   */
  function telegraphs(o = {}) {
    const f = frame(o.dist || 12);
    const kinds = ['white', 'red', 'violet'];
    const shapes = ['circle', 'line', 'cone'];
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const u = (i - 1) * 9;
      const x = f.x + f.rx * u;
      const z = f.z + f.rz * u;
      const id = ctx.debug.api.spawn('tusk_boar', { x, z, passive: true });
      ids.push(id);
      const ent = ctx.ents.get(id);
      ctx.bus.emit('combat:telegraph', {
        entId: id, kind: kinds[i], seconds: o.seconds || 1.2, shape: shapes[i], radius: i === 0 ? 4 : 7,
        x: ent ? ent.pos.x : x, y: ent ? ent.pos.y : 0, z: ent ? ent.pos.z : z, dirX: -f.fx, dirZ: -f.fz,
      });
    }
    return ids;
  }

  ctx.debug.register('gfxGallery', gallery);
  ctx.debug.register('gfxBeamAura', beamAura);
  ctx.debug.register('gfxHoldBeam', holdBeam);
  ctx.debug.register('gfxClearBeamAura', clearBeamAura);
  ctx.debug.register('gfxTelegraphs', telegraphs);
  ctx.debug.register('gfxVfxState', () => ctx.vfx.debugState());
}
