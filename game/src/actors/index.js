/**
 * actors package (ARCHITECTURE 2.3, 4.5, 8.4): character construction and animation. Registers the actor specs
 * and clips, replaces the stand-in `ctx.actors`, adds the `actors.anim` frame system, its listeners and the debug
 * commands used by the actors scenarios (a lineup stage with its own camera, clip and Form control, NaN check).
 * @module actors
 */

import { TAG } from '../core/ents.js';
import { createActors } from './service.js';
import { buildSpecs } from './data/specs.js';
import { CLIP_DEFS } from './logic/clips.js';

/** @param {any} ctx */
function registerDebug(ctx) {
  /** Stage camera for scenarios: overrides the camera after the camera phase while set. */
  const stage = { on: false, fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0 };
  /** @type {number[]} display entities */
  const shown = [];
  ctx.systems.add({
    id: 'actors.stage',
    phase: 'render',
    order: -100,
    frame(c) {
      if (!stage.on || !c.three || !c.three.camera) return;
      const cam = c.three.camera;
      cam.position.set(stage.fx, stage.fy, stage.fz);
      cam.lookAt(stage.tx, stage.ty, stage.tz);
      cam.updateMatrixWorld();
    },
  });
  const groundY = (x, z) => (ctx.world && ctx.world.heightAt ? ctx.world.heightAt(x, z) : 0);

  /** @param {string} specId @param {number} x @param {number} z @param {number} yaw @returns {number} */
  function spawn(specId, x, z, yaw) {
    const e = ctx.ents.create('npc', { defId: specId, team: 0, yaw, pos: { x, y: groundY(x, z), z }, tags: TAG.SCRIPTED | TAG.NO_LOCK });
    if (!e) return 0;
    ctx.actors.create(e, specId, {});
    shown.push(e.id);
    return e.id;
  }

  const cmd = {
    /** @param {[number,number,number]|null} from @param {[number,number,number]} [to] */
    actorsStage(from, to) {
      if (!from) { stage.on = false; return; }
      stage.on = true;
      stage.fx = from[0]; stage.fy = from[1]; stage.fz = from[2];
      stage.tx = to[0]; stage.ty = to[1]; stage.tz = to[2];
    },
    /**
     * Spawn display actors in a row ahead of the player, facing the camera at a front three-quarter angle.
     * @param {{ ids?:string[], dist?:number, gap?:number, hidePlayer?:boolean, back?:number, up?:number, look?:number }} [o] back/up/look aim the stage camera
     */
    actorsLineup(o = {}) {
      cmd.actorsClear();
      const p = ctx.player;
      if (!p) return [];
      const ids = o.ids || ctx.defs.all('actorSpec').map((s) => s.id);
      const gap = o.gap || 0.5;
      // behind the player by default, away from the Ringstone prop ahead of the start position
      const yaw = p.yaw + (typeof o.turn === 'number' ? o.turn : Math.PI);
      const fx = Math.sin(yaw); const fz = Math.cos(yaw);
      const rx = -fz; const rz = fx;
      let width = 0;
      const sizes = ids.map((id) => {
        const b = ctx.actors.bounds(id);
        const w = Math.max(0.6, b.radius * 2) + gap;
        width += w;
        return w;
      });
      const dist = o.dist || 6;
      const cx = p.pos.x + fx * dist;
      const cz = p.pos.z + fz * dist;
      let off = -width / 2;
      const out = [];
      for (let i = 0; i < ids.length; i++) {
        off += sizes[i] / 2;
        out.push(spawn(ids[i], cx + rx * off, cz + rz * off, yaw + Math.PI - 0.5));
        off += sizes[i] / 2;
      }
      if (o.hidePlayer !== false) ctx.actors.setVisible(p, false);
      if (typeof o.back === 'number') {
        const cy = groundY(cx, cz);
        cmd.actorsStage([cx - fx * o.back, cy + (o.up || 2), cz - fz * o.back], [cx, cy + (o.look || 1), cz]);
      }
      return out;
    },
    /** @param {string} specId @param {number} x @param {number} z @param {number} [yaw] @returns {number} */
    actorsSpawn(specId, x, z, yaw = 0) {
      return spawn(specId, x, z, yaw);
    },
    actorsClear() {
      for (const id of shown) ctx.ents.destroy(id);
      shown.length = 0;
      if (ctx.player) ctx.actors.setVisible(ctx.player, true);
    },
    /** @param {number} entId @param {string} clipId @param {object} [opts] */
    actorsPlay(entId, clipId, opts) {
      ctx.actors.play(ctx.ents.get(entId), clipId, opts);
    },
    /** @param {number} entId @param {string|null} formKey */
    actorsForm(entId, formKey) {
      ctx.actors.setForm(ctx.ents.get(entId), formKey);
    },
    /** @param {number} entId @param {string} name */
    actorsExpr(entId, name) {
      ctx.actors.setExpression(ctx.ents.get(entId), name);
    },
    /** @returns {object} animator diagnostics */
    actorsInfo() {
      const d = ctx.actors.debug;
      if (!d) return null;
      const recs = d.records();
      return {
        count: recs.length, nan: d.nanCount(), posed: d.stats.posed, reduced: d.stats.reduced,
        actors: recs.map((r) => ({ id: r.entId, spec: r.rig.id, clip: r.full.id, upper: r.upper.id, mode: r.locoMode, form: r.formKey, tris: r.mesh.geometry.index.count / 3 })),
      };
    },
    /** @param {number} entId @returns {object|null} palette slots of an actor as hex numbers, by slot name */
    actorsPalette(entId) {
      const e = ctx.ents.get(entId);
      const r = e && e.visual && e.visual.actorsRecord ? e.visual : null;
      if (!r) return null;
      const out = {};
      r.rig.slots.forEach((s, i) => { out[s] = r.mat.uniforms.uPalette.value[i].getHex(); });
      return out;
    },
    /** @returns {number} NaN or infinite bone matrices */
    actorsNaN() {
      return ctx.actors.debug ? ctx.actors.debug.nanCount() : -1;
    },
  };
  for (const k of Object.keys(cmd)) ctx.debug.register(k, cmd[k]);
}

export const pkg = {
  id: 'actors',
  /** @param {any} ctx */
  install(ctx) {
    ctx.defs.register('actorSpec', buildSpecs());
    ctx.defs.register('clip', CLIP_DEFS.slice());
    const { actors, animSystem, on } = createActors(ctx);
    ctx.provide('actors', actors, 'actors');
    ctx.systems.add(animSystem);
    ctx.bus.on('actor:removed', on.removed);
    ctx.bus.on('actor:died', on.died);
    ctx.bus.on('actor:damaged', on.damaged);
    ctx.bus.on('actor:staggered', on.staggered);
    ctx.bus.on('combat:form', on.form);
    ctx.bus.on('dialogue:line', on.line);
    if (ctx.debug && ctx.debug.register) registerDebug(ctx);
  },
};
