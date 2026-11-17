/**
 * Combat visuals that must be driven over time (ARCHITECTURE 4.4: "the combat package calls vfx directly only
 * for things it must control over time"): Dawn Lance and enemy beams from the hand socket, charge emitters, the
 * guard shell, the Form / Gather / charge aura with its rim glow, and the burning-ring status. Everything else
 * (hit sparks, projectiles, telegraphs, afterimages, slams, craters) is automatic through events.
 * Frame phase `vfx`, order 10. No allocation per frame: handles live in the engine records' visual slots,
 * which are a parallel Map created when a record first needs one.
 * @module combat/visuals
 */

import { Vector3 } from 'three';
import { PALETTE } from '../core/palette.js';

/**
 * @param {any} ctx
 * @param {{ recList:any[], airborne:(e:any)=>boolean }} engine
 * @returns {any} the frame system
 */
export function createVisuals(ctx, engine) {
  const HAND = new Vector3();
  /** Per-entity visual handles: entId -> slot. */
  /** @type {Map<number, any>} */
  const slots = new Map();
  /** @type {any[]} */
  const slotList = [];
  const ATTACH_OPTS = { color: PALETTE.ora };
  const BEAM_OPTS = { color: PALETTE.ora, radius: 1, ownerId: 0 };
  let aura = null;
  let auraEnt = 0;
  let auraLevel = 0;
  let pulse = 0;

  function slotOf(id) {
    let s = slots.get(id);
    if (!s) {
      s = { id, beam: null, charge: 0, guard: 0, seen: 0 };
      slots.set(id, s);
      slotList.push(s);
    }
    return s;
  }

  function dropSlot(s) {
    const vfx = ctx.vfx;
    if (s.beam) { try { s.beam.end(0.18); } catch (e) { /* tolerate a disposed vfx */ } s.beam = null; }
    if (vfx && s.charge) vfx.detach(s.charge, 0.15);
    if (vfx && s.guard) vfx.detach(s.guard, 0.15);
    s.charge = 0;
    s.guard = 0;
  }

  function clear() {
    for (let i = 0; i < slotList.length; i++) dropSlot(slotList[i]);
    slots.clear();
    slotList.length = 0;
    if (aura) { try { aura.dispose(); } catch (e) { /* ignore */ } }
    aura = null;
    auraEnt = 0;
    auraLevel = 0;
  }

  const system = {
    id: 'combat.visuals',
    phase: 'vfx',
    order: 10,
    /** @param {any} c @param {number} dt */
    frame(c, dt) {
      const vfx = c.vfx;
      if (!vfx) return;
      const recs = engine.recList;
      const frameNo = (system.frameNo = (system.frameNo + 1) | 0);
      for (let i = 0; i < recs.length; i++) {
        const r = recs[i];
        const e = r.ent;
        if (!e || e.id !== r.id) continue;
        const cs = e.combat;
        const needBeam = r.beamOn && e.alive;
        const needCharge = r.charging && e.alive && cs !== null;
        const needGuard = cs !== null && cs.guarding && e.alive;
        if (!needBeam && !needCharge && !needGuard && !slots.has(r.id)) continue;
        const s = slotOf(r.id);
        s.seen = frameNo;
        if (needBeam) {
          if (!s.beam) {
            BEAM_OPTS.color = r.beamColor; BEAM_OPTS.radius = r.beamRadius; BEAM_OPTS.ownerId = r.id;
            s.beam = vfx.beam(BEAM_OPTS);
          }
          let ax = r.beamAX;
          let ay = r.beamAY;
          let az = r.beamAZ;
          if (c.actors && c.actors.socket) {
            c.actors.socket(e, 'handR', HAND);
            ax = HAND.x; ay = HAND.y; az = HAND.z;
          }
          const flick = 0.85 + 0.15 * Math.sin(c.time.real * 40 + r.id);
          s.beam.set(ax, ay, az, r.beamBX, r.beamBY, r.beamBZ, r.beamRadius * (0.9 + 0.1 * flick), 1.1 * flick);
        } else if (s.beam) {
          s.beam.end(0.2);
          s.beam = null;
        }
        if (needCharge && !s.charge) {
          ATTACH_OPTS.color = r.beamColor !== PALETTE.ora ? r.beamColor : oraOf(e);
          s.charge = vfx.attach('beam_charge', r.id, 'handR', ATTACH_OPTS);
        } else if (!needCharge && s.charge) {
          vfx.detach(s.charge, 0.12);
          s.charge = 0;
        }
        if (needGuard && !s.guard) {
          ATTACH_OPTS.color = oraOf(e);
          s.guard = vfx.attach('guard_shell', r.id, 'chest', ATTACH_OPTS);
        } else if (!needGuard && s.guard) {
          vfx.detach(s.guard, 0.15);
          s.guard = 0;
        }
      }
      // Slots whose entity is gone or idle are released.
      for (let i = slotList.length - 1; i >= 0; i--) {
        const s = slotList[i];
        if (s.seen === frameNo) continue;
        dropSlot(s);
        slots.delete(s.id);
        slotList.splice(i, 1);
      }
      playerAura(c, dt);
    },
    frameNo: 0,
  };

  /** @param {any} e @returns {number} */
  function oraOf(e) {
    const fid = e.combat ? e.combat.formId : null;
    if (fid) {
      const f = ctx.defs.find('form', fid);
      if (f) return f.color;
    }
    return e.team === 2 ? PALETTE.hostile : PALETTE.ora;
  }

  /** The player's aura: Form (full, pulsing), Gather (ramping), charge (half), otherwise off. */
  function playerAura(c, dt) {
    const p = c.player;
    if (!p || !p.combat || !p.alive) {
      if (aura) aura.set(0, PALETTE.ora, 'base');
      auraLevel = 0;
      return;
    }
    if (!aura || auraEnt !== p.id) {
      if (aura) { try { aura.dispose(); } catch (e) { /* ignore */ } }
      aura = c.vfx.aura(p.id);
      auraEnt = p.id;
    }
    const cs = p.combat;
    const f = cs.formId ? ctx.defs.find('form', cs.formId) : null;
    let target = 0;
    let style = 'base';
    let color = PALETTE.ora;
    if (f) {
      target = cs.state === 'transform' ? 1.2 : 0.85;
      style = f.auraStyle;
      color = f.color;
    } else if (cs.gathering) {
      target = 0.75;
    } else if (cs.state === 'transform') {
      target = 1;
    } else if (cs.charge > 0) {
      target = 0.35 + cs.charge * 0.5;
    }
    const rate = target > auraLevel ? 1 / 1.0 : 1 / 0.35;
    auraLevel += Math.max(-rate * dt, Math.min(rate * dt, target - auraLevel));
    pulse += dt * (cs.gathering ? 5 : 2.4);
    const k = auraLevel * (f ? 0.9 + 0.1 * Math.sin(pulse) : 1);
    aura.set(Math.max(0, Math.min(1, k)), color, style);
    if (c.actors && c.actors.rimGlow) c.actors.rimGlow(p, color, Math.max(0, Math.min(1, k * 0.8)));
  }

  return { system, clear };
}
