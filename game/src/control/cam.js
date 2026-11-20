/**
 * `ctx.cam` (ARCHITECTURE 4.7, ART_UX 5): the third-person camera rig.
 *
 * The orbit (yaw, pitch) is steered on the sim clock by `control.camLook` (look input with sensitivity and
 * invert, auto-recentre behind movement, camera-pitch flight, velocity-following flight, lock-on yaw, framing of
 * an off-screen threat in group combat), because the player's camera-relative intent reads it. The frame system
 * `control.camRig` places the camera: critically damped springs on the pivot (boost lags 0.12 s), distance,
 * height and FOV per mode, portrait framing (body centre at 48% of the height, so the feet sit about 40% up, just
 * above the control deck, with a rest pitch 3 degrees steeper for the ground modes, so the camera rides about 3 m
 * over the feet and the horizon sits near the upper third; body centre at 55% in landscape), look-ahead, lock framing on thirds, a 0.3 m sphere-cast spring arm against terrain and solids (fast
 * in, slow out), flight roll into turns, trauma shake, FOV kicks, punch springs, dialogue over-the-shoulder
 * framing, scripted cinematic shots and a 0.4 s blend back out of cinematics and dialogue.
 * @module control/cam
 */

import { Quaternion, Vector3 } from 'three';
import { SIM_DT } from '../core/constants.js';
import { KIND_MASK, TAG } from '../core/ents.js';
import { clamp, angleDelta, wrapAngle, lerp, smoothstep } from '../core/math.js';
import {
  CAM, CAM_MODES, spring, noise1, kickEnvelope, frameShift, horizontalFov, lockFraming, easeToward, interpAngle, restPitch,
  recentreStep, lockRig,
} from './logic/camMath.js';

const D2R = Math.PI / 180;

/**
 * Create the camera service and its systems.
 * @param {any} ctx
 * @param {any} shared package-private state ({ noLock })
 */
export function createCam(ctx, shared) {
  const st = {
    targetId: 0, lockId: 0, yaw: 0, pitch: -12 * D2R, mode: 'explore', distOverride: 0, lastLookTick: -100000,
    snap: true, lastReal: -1, aspect: 16 / 9, lastX: 0, lastY: 0, lastZ: 0,
    trauma: 0, kickPeak: 0, kickStart: -10, kickDur: 0.25, kickHold: false,
    dlgSpeaker: 0, dlgListener: 0, lockSide: 1, lockStartT: -10, threatT: 0, prevYaw: 0, prevMode: 'explore',
    // Lock-on: an extra turn (rad) away from a wall or pillar behind the hero, and the time to the next clear-path check.
    lockTurn: 0, lockCheckT: 0,
    blendT: 0, blendDur: 0.4, collDist: 5.5,
    // Orbit angles at the start of the last sim step: the rig shows yaw and pitch between these and the current
    // ones with the frame alpha (prevYaw above is the roll-rate state, a different thing).
    stepYaw0: 0, stepPitch0: -12 * D2R,
    // Camera push (finisher): fraction of the arm, start (real s) and duration.
    pushAmt: 0, pushStart: -10, pushDur: 0.9,
    // The last placed camera (position and vertical FOV in radians) for the lock-on readability band.
    camX: 0, camY: 0, camZ: 0, vfov: 60 * D2R,
  };
  const sDist = { x: 5.5, v: 0 };
  const sHeight = { x: 1.6, v: 0 };
  const sFov = { x: 60, v: 0 };
  const sRoll = { x: 0, v: 0 };
  const sAhead = { x: 0, v: 0 };
  const sFrame = { x: CAM.frameLandscape, v: 0 };
  const sPx = { x: 0, v: 0 };
  const sPy = { x: 0, v: 0 };
  const sPz = { x: 0, v: 0 };
  const pX = { x: 0, v: 0 };
  const pY = { x: 0, v: 0 };
  const pZ = { x: 0, v: 0 };
  const lockOut = { yaw: 0, dist: 0, blend: 0 };
  /** Lock-on rig: the look system's (pitch on the sim clock) and the frame rig's (camera place at render time). */
  const lockSim = { back: 0, height: 0, lateral: 0, pitch: 0, pitchLo: 0, pitchHi: 0, fit: false };
  const lockFrm = { back: 0, height: 0, lateral: 0, pitch: 0, pitchLo: 0, pitchHi: 0, fit: false };
  /** 0 = follow framing, 1 = the lock rig's camera place (springs across the switch). */
  const sLock = { x: 0, v: 0 };
  /** Extra lock turns tried, in order, when something solid stands between the hero and the lock camera. */
  const LOCK_TURNS = [0, 25 * D2R, 45 * D2R, 70 * D2R];
  /** Seconds between clear-path checks of the lock camera. */
  const LOCK_CHECK = 0.2;

  /**
   * True when the lock camera for `side` and `turn` sees the hero over clear ground: the sweep from the hero's body
   * centre to the rig's place keeps most of its length (a pillar or a wall right behind the hero fails it).
   * @param {any} c @param {any} hero @param {any} foe @param {number} side @param {number} turn
   */
  function lockClear(c, hero, foe, side, turn) {
    const world = c.world;
    if (!world || typeof world.sweepSphere !== 'function') return true;
    lockFraming(hero.pos.x, hero.pos.z, foe.pos.x, foe.pos.z, side, st.aspect < 1, lockOut);
    const yaw = lockOut.yaw + side * turn;
    const portrait = st.aspect < 1;
    lockRig(foe.pos.x - hero.pos.x, foe.pos.y - hero.pos.y, foe.pos.z - hero.pos.z, hero.height > 0 ? hero.height : 1.8,
      foe.height > 0 ? foe.height : 1.8, yaw, side, portrait ? CAM_MODES.lock.fovP : CAM_MODES.lock.fovL, st.aspect, lockSim);
    if (!lockSim.fit) return false;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const hy = hero.pos.y + (hero.height > 0 ? hero.height : 1.8) * 0.5;
    const cx = hero.pos.x - fx * lockSim.back - fz * lockSim.lateral;
    const cy = hero.pos.y + lockSim.height;
    const cz = hero.pos.z - fz * lockSim.back + fx * lockSim.lateral;
    return !(world.sweepSphere(hero.pos.x, hy, hero.pos.z, cx, cy, cz, CAM.collideRadius, hit) && hit.hit && hit.t < 0.85);
  }
  const hit = { hit: false, t: 1, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, kind: null, colliderId: 0, propKey: 0 };
  const rp = new Vector3();
  const lp = new Vector3();
  const tmp = new Vector3();
  const blendPos = new Vector3();
  const blendQ = new Quaternion();
  const curQ = new Quaternion();

  /** Active cinematic. */
  const cine = {
    active: false, id: '', shots: /** @type {any[]} */ ([]), index: 0, t: 0, skippable: true, freeze: false,
    prevContext: 'game', resolve: /** @type {((v:{skipped:boolean})=>void)|null} */ (null),
    fromX: 0, fromY: 0, fromZ: 0,
  };
  const pCine = { id: '', skippable: true };
  const pCineEnd = { id: '', skipped: false };
  const look = { x: 0, y: 0, z: 0 };
  const fromTmp = { x: 0, y: 0, z: 0 };

  /** @param {boolean} skipped */
  function finishCine(skipped) {
    if (!cine.active) return;
    cine.active = false;
    if (cine.freeze) ctx.time.resume('cine');
    if (ctx.input.context === 'cine') ctx.input.setContext(/** @type {any} */ (cine.prevContext));
    pCineEnd.id = cine.id;
    pCineEnd.skipped = skipped;
    startBlend(0.4);
    ctx.bus.emit('cine:end', pCineEnd);
    const r = cine.resolve;
    cine.resolve = null;
    if (r) r({ skipped });
  }

  /** Remember the current camera pose and blend from it into the rig. @param {number} seconds */
  function startBlend(seconds) {
    const camera = ctx.three && ctx.three.camera;
    if (!camera) return;
    blendPos.copy(camera.position);
    blendQ.copy(camera.quaternion);
    st.blendT = seconds;
    st.blendDur = seconds;
  }

  /** @param {any} spec point or { entId, socket } @param {{x:number,y:number,z:number}} out @returns {boolean} */
  function resolvePoint(spec, out) {
    if (!spec) return false;
    if (typeof spec.entId === 'number') {
      const e = ctx.ents.get(spec.entId);
      if (!e) return false;
      if (ctx.actors && typeof ctx.actors.socket === 'function') {
        ctx.actors.socket(e, spec.socket || 'chest', tmp);
        out.x = tmp.x; out.y = tmp.y; out.z = tmp.z;
      } else {
        out.x = e.pos.x; out.y = e.pos.y + e.height * 0.7; out.z = e.pos.z;
      }
      return true;
    }
    out.x = spec.x; out.y = spec.y; out.z = spec.z;
    return true;
  }

  /** @param {string|undefined} ease @param {number} u */
  function eased(ease, u) {
    if (ease === 'inOut') return smoothstep(0, 1, u);
    if (ease === 'out') return 1 - (1 - u) * (1 - u);
    return u;
  }

  /** Advance and apply the cinematic shot on frame time. @param {any} camera @param {number} dt */
  function runCine(camera, dt) {
    let shot = cine.shots[cine.index];
    cine.t += dt;
    while (shot && cine.t >= shot.seconds) {
      cine.t -= shot.seconds;
      cine.index++;
      cine.fromX = camera.position.x; cine.fromY = camera.position.y; cine.fromZ = camera.position.z;
      shot = cine.shots[cine.index];
    }
    if (!shot) {
      finishCine(false);
      return;
    }
    const u = eased(shot.ease, shot.seconds > 0 ? clamp(cine.t / shot.seconds, 0, 1) : 1);
    if (shot.orbit) {
      const o = shot.orbit;
      const e = ctx.ents.get(o.entId);
      if (e) {
        const yaw = lerp(o.yawFrom, o.yawTo, u);
        camera.position.set(e.pos.x - Math.sin(yaw) * o.dist, e.pos.y + o.height, e.pos.z - Math.cos(yaw) * o.dist);
        look.x = e.pos.x; look.y = e.pos.y + e.height * 0.6; look.z = e.pos.z;
      }
    } else if (shot.from || shot.to) {
      fromTmp.x = cine.fromX; fromTmp.y = cine.fromY; fromTmp.z = cine.fromZ;
      const a = shot.from || fromTmp;
      const b = shot.to || a;
      camera.position.set(lerp(a.x, b.x, u), lerp(a.y, b.y, u), lerp(a.z, b.z, u));
    }
    if (shot.lookAt) resolvePoint(shot.lookAt, look);
    if (shot.lookAt || shot.orbit) camera.lookAt(look.x, look.y, look.z);
    const fov = typeof shot.fov === 'number' ? shot.fov : 50;
    sFov.x = fov;
    sFov.v = 0;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  const cam = {
    /** @returns {string} */
    get mode() { return cine.active ? 'cinematic' : st.mode; },
    /** @returns {number} */
    get yaw() { return st.yaw; },
    /** @returns {number} */
    get pitch() { return st.pitch; },
    /** @returns {boolean} */
    get busy() { return cine.active; },

    /** @param {number} entId */
    setTarget(entId) {
      st.targetId = entId || 0;
      st.snap = true;
      const e = ctx.ents.get(st.targetId);
      if (e) st.yaw = e.yaw;
    },

    /** Horizontal unit vector the camera looks along. @param {any} out */
    forward(out) {
      return out.set(Math.sin(st.yaw), 0, Math.cos(st.yaw));
    },

    /** Horizontal unit vector to the camera's right. @param {any} out */
    right(out) {
      return out.set(-Math.cos(st.yaw), 0, Math.sin(st.yaw));
    },

    /** @param {number} yaw @param {number} pitch @param {number} [dist] */
    setOrbit(yaw, pitch, dist) {
      st.yaw = wrapAngle(yaw);
      st.pitch = clamp(pitch, CAM.pitchMin, CAM.pitchMax);
      st.distOverride = typeof dist === 'number' && dist > 0 ? dist : 0;
      st.lastLookTick = ctx.time.tick;
      st.snap = true;
    },

    /** @param {number} targetId 0 = none */
    setLock(targetId) {
      const id = targetId || 0;
      if (id === st.lockId) return;
      st.lockId = id;
      st.lockStartT = ctx.time.real;
      st.lockTurn = 0;
      st.lockCheckT = 0;
      const p = ctx.ents.get(st.targetId);
      const t = id ? ctx.ents.get(id) : null;
      if (p && t) {
        // Keep the camera on the side it is already on, so the switch is a short ease, not a swing.
        const bearing = Math.atan2(t.pos.x - p.pos.x, t.pos.z - p.pos.z);
        st.lockSide = angleDelta(bearing, st.yaw) >= 0 ? 1 : -1;
      }
    },

    /** @param {number} trauma */
    shake(trauma) {
      st.trauma = clamp(st.trauma + Math.max(0, trauma || 0), 0, 1);
    },

    /** @param {number} deg @param {number} seconds @param {boolean} [hold] */
    fovKick(deg, seconds, hold = false) {
      const settings = ctx.save && ctx.save.settings;
      const k = settings && settings.reducedMotion ? 0.3 : 1;
      const real = ctx.time.real;
      if (deg === 0) {
        // Release a held kick from its current value.
        const cur = kickEnvelope(st.kickPeak, real - st.kickStart, st.kickDur, st.kickHold);
        st.kickPeak = cur;
        st.kickStart = real - 0.06;
        st.kickDur = Math.max(0.05, seconds || 0.25);
        st.kickHold = false;
        return;
      }
      st.kickPeak = deg * k;
      st.kickDur = Math.max(0.05, seconds || 0.25);
      st.kickStart = real;
      st.kickHold = !!hold;
    },

    /** @param {number} dx @param {number} dy @param {number} dz @param {number} amount metres of peak displacement */
    punch(dx, dy, dz, amount) {
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const k = (amount || 0) * 16 * Math.E / l;
      pX.v += dx * k;
      pY.v += dy * k;
      pZ.v += dz * k;
    },

    /**
     * Push the camera in on the followed body and back out (the finisher): the arm shortens by `amount` (fraction)
     * and the view narrows a little, easing in over the first quarter of `seconds` and out over the rest.
     * @param {number} amount 0..0.5 @param {number} seconds @param {number} [entId] unused (the push centres on the hero)
     */
    push(amount, seconds, entId) {
      void entId;
      const settings = ctx.save && ctx.save.settings;
      const k = settings && settings.reducedMotion ? 0.3 : 1;
      st.pushAmt = clamp(amount || 0, 0, 0.5) * k;
      st.pushStart = ctx.time.real;
      st.pushDur = Math.max(0.1, seconds || 0.9);
    },

    /**
     * @param {string} id @param {any[]} shots @param {{ skippable?:boolean, freeze?:boolean }} [opts]
     * @returns {Promise<{ skipped:boolean }>}
     */
    play(id, shots, opts) {
      if (cine.active) finishCine(true);
      const o = opts || {};
      const camera = ctx.three && ctx.three.camera;
      cine.active = true;
      cine.id = String(id);
      cine.shots = Array.isArray(shots) ? shots : [];
      cine.index = 0;
      cine.t = 0;
      cine.skippable = o.skippable !== false;
      cine.freeze = !!o.freeze;
      if (camera) { cine.fromX = camera.position.x; cine.fromY = camera.position.y; cine.fromZ = camera.position.z; }
      if (cine.freeze) ctx.time.pause('cine');
      cine.prevContext = ctx.input.context;
      if (ctx.input.context === 'game') ctx.input.setContext('cine');
      pCine.id = cine.id;
      pCine.skippable = cine.skippable;
      ctx.bus.emit('cine:start', pCine);
      return new Promise((resolve) => {
        if (!cine.active || cine.id !== String(id)) resolve({ skipped: true });
        else cine.resolve = resolve;
      });
    },

    skip() {
      if (cine.active && cine.skippable) finishCine(true);
    },

    /** @param {number} speakerEntId @param {number} listenerEntId */
    dialogue(speakerEntId, listenerEntId) {
      if (st.dlgSpeaker !== (speakerEntId || 0) || st.dlgListener !== (listenerEntId || 0)) startBlend(0.35);
      st.dlgSpeaker = speakerEntId || 0;
      st.dlgListener = listenerEntId || 0;
    },

    endDialogue() {
      if (st.dlgSpeaker) startBlend(0.4);
      st.dlgSpeaker = 0;
      st.dlgListener = 0;
    },

    dispose() {
      finishCine(true);
    },
  };

  /** Current push fraction: quick ease in (first 25%), smooth ease out. @param {number} real */
  function pushEnvelope(real) {
    if (st.pushAmt <= 0) return 0;
    const u = (real - st.pushStart) / st.pushDur;
    if (u >= 1 || u < 0) {
      if (u >= 1) st.pushAmt = 0;
      return 0;
    }
    const e = u < 0.25 ? smoothstep(0, 0.25, u) : 1 - smoothstep(0.25, 1, u);
    return st.pushAmt * e;
  }

  /** @param {any} c @param {any} target @returns {string} */
  function modeOf(c, target) {
    const mv = target.move;
    if (st.dlgSpeaker && c.ents.get(st.dlgSpeaker)) return 'dialogue';
    const lockEnt = st.lockId ? c.ents.get(st.lockId) : null;
    if (lockEnt && lockEnt.alive) return 'lock';
    if (mv && mv.mode === 'fly') return mv.boost > 0 ? 'boost' : 'flight';
    if (target.combat && target.combat.inCombatT > 0) return 'combat';
    return 'explore';
  }

  /** In group combat, the nearest hostile within 30 m (for off-screen framing). */
  function threatFilter(e) {
    return e.alive && (e.tags & TAG.NO_LOCK) === 0 && e.team === 2;
  }

  const lookSystem = {
    id: 'control.camLook',
    phase: 'input',
    order: 50,
    /** @param {any} c */
    step(c) {
      st.stepYaw0 = st.yaw;
      st.stepPitch0 = st.pitch;
      const s = c.save && c.save.settings;
      const lx = c.input.axis('lookX');
      const ly = c.input.axis('lookY');
      if (lx !== 0 || ly !== 0) {
        const sens = s && typeof s.camSens === 'number' ? s.camSens : 1;
        const inv = s && s.invertY ? -1 : 1;
        st.yaw = wrapAngle(st.yaw - lx * D2R * sens);
        st.pitch = clamp(st.pitch + ly * D2R * sens * inv, CAM.pitchMin, CAM.pitchMax);
        st.lastLookTick = c.time.tick;
      }
      const target = c.ents.get(st.targetId);
      if (!target || cine.active) return;
      const mode = modeOf(c, target);
      st.mode = mode;
      const dt = SIM_DT;
      const rest = restPitch(mode, st.aspect < 1);
      const touch = c.input.device === 'touch';
      const pitchFlight = touch || !!(s && s.pitchFlight);
      const idle = (c.time.tick - st.lastLookTick) * SIM_DT;
      const vx = target.vel.x;
      const vz = target.vel.z;
      const vh = Math.sqrt(vx * vx + vz * vz);
      const isPlayer = target === c.player;
      const mxA = Math.abs(c.input.axis('moveX'));
      const myA = c.input.axis('moveY');
      const stickActive = mxA + Math.abs(myA) > 0.05;
      if (mode === 'lock') {
        const lockEnt = c.ents.get(st.lockId);
        // A few times a second: if a wall or pillar blocks the lock camera, turn to the first clear place (the other
        // side, then wider turns); back to the plain framing once it is clear again.
        st.lockCheckT -= dt;
        if (st.lockCheckT <= 0) {
          st.lockCheckT = LOCK_CHECK;
          if (!lockClear(c, target, lockEnt, st.lockSide, st.lockTurn)) {
            let found = false;
            for (let i = 0; i < LOCK_TURNS.length && !found; i++) {
              for (let k2 = 0; k2 < 2 && !found; k2++) {
                const sd = k2 === 0 ? st.lockSide : -st.lockSide;
                if (lockClear(c, target, lockEnt, sd, LOCK_TURNS[i])) {
                  st.lockSide = sd;
                  st.lockTurn = LOCK_TURNS[i];
                  found = true;
                }
              }
            }
          } else if (st.lockTurn > 0 && lockClear(c, target, lockEnt, st.lockSide, 0)) st.lockTurn = 0;
        }
        lockFraming(target.pos.x, target.pos.z, lockEnt.pos.x, lockEnt.pos.z, st.lockSide, st.aspect < 1, lockOut);
        // 250 ms ease on lock and switch; look input can still nudge pitch.
        const k = 1 - Math.exp((-3 / CAM.lockEase) * dt);
        st.yaw = wrapAngle(st.yaw + angleDelta(st.yaw, lockOut.yaw + st.lockSide * st.lockTurn) * k);
        // The lock rig frames both the hero and the target inside the safe area (camMath.lockRig): its pitch when
        // the look input is idle, and never outside the pitch range that keeps both in.
        const portraitNow = st.aspect < 1;
        lockRig(lockEnt.pos.x - target.pos.x, lockEnt.pos.y - target.pos.y, lockEnt.pos.z - target.pos.z, target.height > 0 ? target.height : 1.8,
          lockEnt.height > 0 ? lockEnt.height : 1.8, st.yaw, st.lockSide, portraitNow ? CAM_MODES.lock.fovP : CAM_MODES.lock.fovL, st.aspect, lockSim);
        if (idle > 0.5) st.pitch += (lockSim.pitch - st.pitch) * (1 - Math.exp(-4 * dt));
        const want = clamp(st.pitch, lockSim.pitchLo, lockSim.pitchHi);
        st.pitch = clamp(st.pitch + (want - st.pitch) * (1 - Math.exp(-6 * dt)), CAM.pitchMin, CAM.pitchMax);

        st.threatT = 0;
      } else if (mode === 'flight' || mode === 'boost') {
        if (idle > 0.4 && vh > 3) {
          const rate = (mode === 'boost' ? 220 : 130) * D2R * dt;
          st.yaw = wrapAngle(st.yaw + clamp(angleDelta(st.yaw, Math.atan2(vx, vz)), -rate, rate));
        }
        if (pitchFlight) {
          if (stickActive) {
            // The pitch holds while the stick is deflected, with a soft magnet to level inside +/-8 degrees.
            if (idle > 0.2 && Math.abs(st.pitch) < CAM.levelMagnet) st.pitch += (0 - st.pitch) * (1 - Math.exp(-2.5 * dt));
          } else if (idle > 0.2) {
            st.pitch = easeToward(st.pitch, CAM.flightPitchRest, CAM.flightPitchReturn, dt);
          }
        } else if (idle > 0.4) {
          const climb = vh > 5 ? Math.atan2(target.vel.y, vh) : 0;
          const want = mode === 'boost' ? clamp(climb * 0.6, -40 * D2R, 25 * D2R) : rest + clamp(climb * 0.35, -25 * D2R, 12 * D2R);
          st.pitch += (want - st.pitch) * (1 - Math.exp(-2 * dt));
        }
        st.threatT = 0;
      } else if (mode !== 'dialogue') {
        let framed = false;
        if (mode === 'combat' && isPlayer && c.spatial) {
          // Frame the enemy the next attack goes to (the soft target), else the nearest threat.
          const cb = c.combat;
          const sid = cb && typeof cb.softTarget === 'function' ? cb.softTarget() : 0;
          const se = sid ? c.ents.get(sid) : null;
          const t = se && se.alive && threatFilter(se) ? se
            : c.spatial.nearest(target.pos.x, target.pos.y, target.pos.z, 30, KIND_MASK.HOSTILE_TARGETS, threatFilter);
          if (t) {
            const bearing = Math.atan2(t.pos.x - target.pos.x, t.pos.z - target.pos.z);
            const off = angleDelta(st.yaw, bearing);
            const half = horizontalFov(st.aspect < 1 ? CAM_MODES.combat.fovP : CAM_MODES.combat.fovL, st.aspect) * 0.5;
            if (Math.abs(off) > half * 0.85) st.threatT += dt;
            else st.threatT = 0;
            if (st.threatT > CAM.threatOffscreen && idle > 0.6) {
              const want = bearing - Math.sign(off) * half * 0.55;
              const rate = 140 * D2R * dt;
              st.yaw = wrapAngle(st.yaw + clamp(angleDelta(st.yaw, want), -rate, rate));
              framed = true;
            } else if (idle > 0.35) {
              // Flank: a close enemy straight ahead hides behind the hero, so the view eases a little to the side
              // it is already on (the lock framing does the same on thirds).
              const fdx = t.pos.x - target.pos.x;
              const fdz = t.pos.z - target.pos.z;
              if (fdx * fdx + fdz * fdz < CAM.flankRange * CAM.flankRange && Math.abs(off) < CAM.flankAngle) {
                if (Math.abs(off) > 2 * D2R) st.lockSide = off > 0 ? 1 : -1;
                const want = bearing - st.lockSide * CAM.flankAngle;
                const rate = 60 * D2R * dt;
                st.yaw = wrapAngle(st.yaw + clamp(angleDelta(st.yaw, want), -rate, rate));
                framed = true;
              }
            }
          } else {
            st.threatT = 0;
          }
        }
        const delay = touch || (shared && shared.noLock) ? CAM.recentreDelayTouch : CAM.recentreDelay;
        if (!framed && vh > 1.5 && idle > delay && target.move && target.move.grounded !== undefined) {
          // Recentre behind forward running; pure strafing and backpedalling never spin the camera.
          const fwd = isPlayer ? (myA > 0.3 ? clamp(1 - mxA * 1.5, 0, 1) : 0) : 1;
          // Eased in after the delay and slowed near the heading; any drag resets `idle` and stops it at once.
          st.yaw = wrapAngle(st.yaw + recentreStep(angleDelta(st.yaw, Math.atan2(vx, vz)), CAM.recentreRate * fwd, idle - delay, dt));
          st.pitch += clamp(rest - st.pitch, -30 * D2R * dt, 30 * D2R * dt);
        } else if (idle > delay + 1.5 && Math.abs(st.pitch - rest) > 1e-3) {
          // A camera left pitched far up or down drifts home on its own.
          st.pitch += clamp(rest - st.pitch, -12 * D2R * dt, 12 * D2R * dt);
        }
      }
    },
  };

  const rigSystem = {
    id: 'control.camRig',
    phase: 'camera',
    /** @param {any} c @param {number} frameDt @param {number} alpha */
    frame(c, frameDt, alpha) {
      const camera = c.three && c.three.camera;
      if (!camera) return;
      const real = c.time.real;
      // Frame passes from the rAF driver carry real time; test frames (renderNow) carry 0, so the rig advances by
      // the sim time elapsed since its last frame instead.
      const simNow = real;
      const simDt = st.lastReal < 0 ? 0 : simNow - st.lastReal;
      st.lastReal = simNow;
      const dt = frameDt > 0 ? Math.min(0.1, frameDt) : clamp(simDt, 0, 0.5);
      const world = c.world;
      st.aspect = camera.aspect || 1;
      if (cine.active) {
        runCine(camera, dt);
        if (world) world.setFocus(camera.position.x, camera.position.y, camera.position.z);
        return;
      }
      const target = c.ents.get(st.targetId);
      if (!target) {
        if (world) world.setFocus(camera.position.x, camera.position.y, camera.position.z);
        return;
      }
      const p = c.ents.renderPos(target, alpha, rp);
      const jump = Math.abs(p.x - st.lastX) + Math.abs(p.y - st.lastY) + Math.abs(p.z - st.lastZ) > 60;
      st.lastX = p.x; st.lastY = p.y; st.lastZ = p.z;
      const snap = st.snap || jump;
      st.snap = false;
      if (snap) st.blendT = 0;

      const mode = modeOf(c, target);
      if (mode !== st.mode) st.mode = mode;
      const row = CAM_MODES[mode];
      const portrait = st.aspect < 1;
      const s = c.save && c.save.settings;
      let wantDist = st.distOverride && (mode === 'explore' || mode === 'combat') ? st.distOverride : row.dist;
      let wantHeight = row.height;
      if (portrait) {
        wantDist += CAM.portraitPullBack;
        wantHeight += CAM.portraitRise;
      }
      let wantFov = portrait ? row.fovP : row.fovL;
      const vx = target.vel.x;
      const vz = target.vel.z;
      const vh = Math.sqrt(vx * vx + vz * vz);
      if (mode === 'boost') {
        // Sense of speed: the view widens with speed and a fine buffeting rides on it (Sonic Boost more).
        const v3 = Math.sqrt(vh * vh + target.vel.y * target.vel.y);
        wantFov += clamp((v3 - 25) * 0.16, 0, 8);
        const floor = target.move && target.move.boost === 2 ? 0.26 : 0.14;
        const rm = s && s.reducedMotion ? 0 : 1;
        if (st.trauma < floor * rm) st.trauma = floor * rm;
      }

      // Orbit direction (the camera looks along it), interpolated between the last two sim steps.
      if (snap) {
        st.stepYaw0 = st.yaw;
        st.stepPitch0 = st.pitch;
      }
      const yaw = interpAngle(st.stepYaw0, st.yaw, alpha);
      const pitch = st.stepPitch0 + (st.pitch - st.stepPitch0) * (alpha < 0 ? 0 : alpha > 1 ? 1 : alpha);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const dirX = Math.sin(yaw) * cp;
      const dirY = sp;
      const dirZ = Math.cos(yaw) * cp;

      // Pivot target: the followed body plus the mode's height and look-ahead. Locked on, the lock rig places the
      // camera so the hero and the target both stay inside the safe area (camMath.lockRig); the pivot is then the
      // hero's body centre (shifted onto the view's vertical plane), a point the hero's own body keeps clear, so the
      // spring arm sweeps from it as in every other mode; the distance and the shift along the camera's up axis
      // reach the rig's place from there.
      let px = p.x;
      let py = p.y + wantHeight;
      let pz = p.z;
      let lockShift = 0;
      const lockEnt = mode === 'lock' ? c.ents.get(st.lockId) : null;
      if (lockEnt) {
        const fovL = portrait ? CAM_MODES.lock.fovP : CAM_MODES.lock.fovL;
        lockRig(lockEnt.pos.x - p.x, lockEnt.pos.y - p.y, lockEnt.pos.z - p.z, target.height > 0 ? target.height : 1.8,
          lockEnt.height > 0 ? lockEnt.height : 1.8, yaw, st.lockSide, fovL, st.aspect, lockFrm);
        const fx = Math.sin(yaw);
        const fz = Math.cos(yaw);
        const camX = p.x - fx * lockFrm.back - fz * lockFrm.lateral;
        const camY = p.y + lockFrm.height;
        const camZ = p.z - fz * lockFrm.back + fx * lockFrm.lateral;
        const hy = p.y + (target.height > 0 ? target.height : 1.8) * 0.5;
        // Right is (-fz, 0, fx): drop the hero centre's sideways offset from the camera.
        const rc = (p.x - camX) * -fz + (p.z - camZ) * fx;
        px = p.x + fz * rc;
        py = hy;
        pz = p.z - fx * rc;
        wantDist = (px - camX) * dirX + (py - camY) * dirY + (pz - camZ) * dirZ;
        // Up axis (-sp sin yaw, cp, -sp cos yaw).
        lockShift = (camX - px) * -sp * fx + (camY - py) * cp + (camZ - pz) * -sp * fz;
        wantFov = fovL;
      }
      const run = target.stats && target.stats.runSpeed > 0 ? target.stats.runSpeed : 7;
      spring(sAhead, mode === 'explore' ? clamp(vh / run, 0, 1) * CAM.lookAhead : 0, 3, dt);
      if (vh > 0.01) {
        px += (vx / vh) * sAhead.x;
        pz += (vz / vh) * sAhead.x;
      }
      if (snap) {
        sPx.x = px; sPy.x = py; sPz.x = pz; sPx.v = 0; sPy.v = 0; sPz.v = 0;
        sDist.x = wantDist; sDist.v = 0;
        sHeight.x = wantHeight; sHeight.v = 0;
        sFov.x = wantFov; sFov.v = 0;
        sFrame.x = portrait ? CAM.framePortrait : CAM.frameLandscape; sFrame.v = 0;
        sLock.x = lockEnt ? 1 : 0; sLock.v = 0;
        st.collDist = wantDist;
      } else {
        // Boost lags 0.12 s; flight follows a little looser than the ground; vertical is softer to absorb jumps.
        const wH = mode === 'boost' ? 1 / CAM.boostLag : mode === 'flight' ? 12 : mode === 'lock' ? 10 : 22;
        const wV = mode === 'boost' ? 1 / CAM.boostLag : mode === 'flight' ? 9 : 9;
        spring(sPx, px, wH, dt);
        spring(sPz, pz, wH, dt);
        spring(sPy, py, wV, dt);
        spring(sDist, wantDist, mode === 'boost' ? 2.5 : 4, dt);
        spring(sFov, wantFov, 5, dt);
        spring(sFrame, portrait ? CAM.framePortrait : CAM.frameLandscape, 6, dt);
        spring(sLock, lockEnt ? 1 : 0, 8, dt);
      }
      // Never let the pivot fall behind the body by more than a few metres (sonic speeds).
      const lagX = sPx.x - px;
      const lagZ = sPz.x - pz;
      const lag = Math.sqrt(lagX * lagX + lagZ * lagZ);
      const maxLag = mode === 'boost' ? 2 : mode === 'flight' ? 1.5 : 1.2;
      if (lag > maxLag) {
        sPx.x = px + (lagX / lag) * maxLag;
        sPz.x = pz + (lagZ / lag) * maxLag;
      }

      // Camera up vector, used for the framing shift.
      const upX = -sp * Math.sin(yaw);
      const upY = cp;
      const upZ = -sp * Math.cos(yaw);
      const push = pushEnvelope(real);
      const fov = sFov.x - push * 14;
      const dist = sDist.x * (1 - push);
      // Frame the body (not the pivot, which sits above it): the body's centre lands at the framing height.
      const bodyY = p.y + (target.height > 0 ? target.height : 1.8) * 0.5;
      // Locked on, the lock rig's shift takes over from the follow framing's (sLock springs across the switch).
      const shift = (frameShift(sFrame.x, dist, fov) - (sPy.x - bodyY) * cp) * (1 - sLock.x) + lockShift * sLock.x;
      let cx = sPx.x - dirX * dist + upX * shift;
      let cy = sPy.x - dirY * dist + upY * shift;
      let cz = sPz.x - dirZ * dist + upZ * shift;

      // Spring arm: sphere cast from the pivot; snap in on a hit, ease back out.
      let wantArm = 1;
      if (world && typeof world.sweepSphere === 'function' && mode !== 'dialogue') {
        if (world.sweepSphere(sPx.x, sPy.x, sPz.x, cx, cy, cz, CAM.collideRadius, hit) && hit.hit) {
          wantArm = clamp(hit.t - 0.04, CAM.minDist / Math.max(dist, 0.01), 1);
        }
      }
      if (snap || wantArm < st.collDist) st.collDist = wantArm;
      else st.collDist += (wantArm - st.collDist) * (1 - Math.exp(-4 * dt));
      const arm = st.collDist;
      cx = sPx.x + (cx - sPx.x) * arm;
      cy = sPy.x + (cy - sPy.x) * arm;
      cz = sPz.x + (cz - sPz.x) * arm;

      let lookX = cx + dirX;
      let lookY = cy + dirY;
      let lookZ = cz + dirZ;
      if (mode === 'dialogue') {
        const speaker = c.ents.get(st.dlgSpeaker);
        const listener = (st.dlgListener && c.ents.get(st.dlgListener)) || target;
        const sdx = speaker.pos.x - listener.pos.x;
        const sdz = speaker.pos.z - listener.pos.z;
        const sl = Math.sqrt(sdx * sdx + sdz * sdz) || 1;
        const ux = sdx / sl;
        const uz = sdz / sl;
        // Over the listener's shoulder, 2.2 m behind and 0.6 m to the side, at eye height.
        cx = listener.pos.x - ux * 2.2 - uz * 0.6;
        cz = listener.pos.z - uz * 2.2 + ux * 0.6;
        cy = listener.pos.y + listener.height * 0.92;
        lookX = speaker.pos.x;
        lookY = speaker.pos.y + speaker.height * 0.85;
        lookZ = speaker.pos.z;
      }
      if (world) {
        const floor = world.heightAt(cx, cz) + 0.5;
        if (cy < floor) {
          lookY += floor - cy;
          cy = floor;
        }
      }

      // Shake (trauma squared, smooth noise), punch springs.
      const shakeMul = s ? (typeof s.shake === 'number' ? s.shake : 1) * (s.reducedMotion ? 0.25 : 1) : 1;
      st.trauma = Math.max(0, st.trauma - CAM.traumaDecay * dt);
      const amt = st.trauma * st.trauma * shakeMul;
      const tt = real * 18;
      spring(pX, 0, 16, dt);
      spring(pY, 0, 16, dt);
      spring(pZ, 0, 16, dt);
      const ox = amt * CAM.shakeMetres * noise1(tt, 1) + pX.x;
      const oy = amt * CAM.shakeMetres * noise1(tt, 2) + pY.x;
      const oz = amt * CAM.shakeMetres * noise1(tt, 3) + pZ.x;

      camera.position.set(cx + ox, cy + oy, cz + oz);
      st.camX = cx; st.camY = cy; st.camZ = cz;
      camera.up.set(0, 1, 0);
      camera.lookAt(lookX + ox, lookY + oy, lookZ + oz);

      // Roll into flight turns (up to 6 degrees) plus shake roll.
      const yawRate = dt > 0 ? angleDelta(st.prevYaw, yaw) / dt : 0;
      st.prevYaw = yaw;
      const wantRoll = mode === 'flight' || mode === 'boost' ? clamp(-yawRate * 0.09, -CAM.flightRoll, CAM.flightRoll) : 0;
      spring(sRoll, snap ? 0 : wantRoll, 5, dt);
      const roll = sRoll.x + amt * CAM.shakeRollDeg * D2R * noise1(tt * 0.7, 4);
      if (roll !== 0) camera.rotateZ(roll);

      // Blend out of cinematics and dialogue.
      if (st.blendT > 0) {
        st.blendT = Math.max(0, st.blendT - dt);
        const u = smoothstep(0, 1, 1 - st.blendT / st.blendDur);
        curQ.copy(camera.quaternion);
        lp.copy(camera.position);
        camera.position.copy(blendPos).lerp(lp, u);
        camera.quaternion.copy(blendQ).slerp(curQ, u);
      }

      const kick = kickEnvelope(st.kickPeak, real - st.kickStart, st.kickDur, st.kickHold);
      const fovNow = clamp(fov + kick, 20, 120);
      st.vfov = fovNow * D2R;
      if (Math.abs(camera.fov - fovNow) > 0.01) {
        camera.fov = fovNow;
        camera.updateProjectionMatrix();
      }
      st.prevMode = mode;
      if (world) world.setFocus(camera.position.x, camera.position.y, camera.position.z);
    },
  };

  /** @param {any} e combat:lock payload */
  function onLock(e) {
    const p = ctx.player;
    if (p && e.entId === p.id) cam.setLock(e.targetId);
  }

  /** @param {string} action */
  function onPress(action) {
    if (action === 'skip') cam.skip();
  }

  function onEnded() {
    finishCine(true);
    st.targetId = 0;
    st.lockId = 0;
    st.dlgSpeaker = 0;
    st.dlgListener = 0;
    st.snap = true;
    st.trauma = 0;
    st.kickPeak = 0;
    st.blendT = 0;
    st.pushAmt = 0;
  }

  return { cam, lookSystem, rigSystem, onLock, onPress, onEnded };
}
