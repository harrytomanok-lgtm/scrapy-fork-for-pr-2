/**
 * Stand-in `ctx.cam` (ARCHITECTURE 4.7, 8.0): an orbit follow camera with the mode table of ART_UX 5 (explore,
 * flight, boost, lock, combat, dialogue, cinematic; portrait framing), look input with sensitivity and invert,
 * auto-recentre behind movement, terrain clearance, trauma shake, FOV kicks, punch, lock framing on the
 * midpoint, dialogue framing and linear cinematic shots. Calls `world.setFocus` every frame.
 * Also registers a minimal touch source in `dom.layer('touch')` (floating stick, camera drag, Attack, Bolt,
 * Jump and Dash with `data-action`), disposed with the stand-in. Replaced by the control package.
 * @module standins/cam
 */

import { SIM_DT } from '../core/constants.js';
import { TMP, clamp, damp, angleDelta, wrapAngle, lerp, smoothstep } from '../core/math.js';

const OWNER = 'standin:cam';
const D2R = Math.PI / 180;

/** ART_UX 5 mode table: [distance, height, pitch deg, fov landscape, fov portrait]. */
const MODES = {
  explore: [5.5, 1.6, -12, 60, 72],
  flight: [7.5, 1.2, -6, 66, 78],
  boost: [9, 1.0, -6, 76, 88],
  lock: [6.5, 1.8, -15, 62, 74],
  combat: [7, 2.0, -15, 64, 76],
  dialogue: [2.2, 1.6, 0, 40, 40],
  cinematic: [6, 1.6, -10, 50, 50],
};

/**
 * Minimal touch controls registered as input source 'touch'.
 * @param {any} ctx
 * @returns {{ poll:(input:any)=>void, dispose:()=>void }}
 */
function createTouchSource(ctx) {
  const ID = 'touch';
  const dom = ctx.dom;
  if (!dom || typeof document === 'undefined') return { poll() {}, dispose() {} };
  dom.addStyle('standin-touch', `
.sti-root{position:absolute;inset:0;pointer-events:none;touch-action:none;user-select:none;-webkit-user-select:none;
  -webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;overscroll-behavior:none;display:none}
.sti-root.sti-on{display:block}
.sti-zone{position:absolute;pointer-events:auto;touch-action:none}
.sti-look{inset-block:0;inset-inline-end:0;inline-size:60%}
.sti-move{inset-block-end:0;inset-inline-start:0;inline-size:40%;block-size:60%}
.sti-ring{position:absolute;border-radius:50%;border:2px solid rgba(243,235,221,.45);background:rgba(27,22,38,.18);pointer-events:none}
.sti-base{inline-size:120px;block-size:120px;margin:-60px 0 0 -60px;display:none}
.sti-knob{inline-size:52px;block-size:52px;margin:-26px 0 0 -26px;background:rgba(243,235,221,.55);display:none}
.sti-ghost{inline-size:120px;block-size:120px;left:calc(28px + env(safe-area-inset-left));bottom:calc(28px + env(safe-area-inset-bottom))}
.sti-btn{position:absolute;pointer-events:auto;touch-action:none;border-radius:50%;border:2px solid rgba(243,235,221,.7);
  background:rgba(27,22,38,.35);box-sizing:border-box}
.sti-btn.sti-down{background:rgba(127,242,224,.45)}
.sti-btn::after{content:"";position:absolute;inset:30%;background:rgba(243,235,221,.85)}
.sti-attack::after{border-radius:50%}
.sti-bolt::after{transform:rotate(45deg);inset:34%}
.sti-dash::after{clip-path:polygon(0 0,60% 50%,0 100%,40% 100%,100% 50%,40% 0)}
.sti-jump::after{clip-path:polygon(50% 0,100% 70%,70% 70%,50% 40%,30% 70%,0 70%)}
`);
  // Touch controls are physically placed and never mirrored in Hebrew (ART_UX 6.1), so they use physical sides.
  const root = document.createElement('div');
  root.className = 'sti-root';
  root.setAttribute('dir', 'ltr');
  const look = document.createElement('div');
  look.className = 'sti-zone sti-look';
  look.setAttribute('data-action', 'look');
  const moveZone = document.createElement('div');
  moveZone.className = 'sti-zone sti-move';
  moveZone.setAttribute('data-action', 'move');
  const ghost = document.createElement('div');
  ghost.className = 'sti-ring sti-ghost';
  const base = document.createElement('div');
  base.className = 'sti-ring sti-base';
  const knob = document.createElement('div');
  knob.className = 'sti-ring sti-knob';
  root.append(look, moveZone, ghost, base, knob);

  const R = 104;
  /** [action, size px, offset x (left of the attack centre), offset y (above it)] */
  const BUTTONS = [['attack', 76, 0, 0], ['bolt', 60, -R * 0.74, R * 0.68], ['dash', 60, 0, R], ['jump', 60, -R, -6]];
  /** @type {Array<() => void>} */
  const offs = [];
  const listen = (el, type, fn, opts) => {
    el.addEventListener(type, fn, opts);
    offs.push(() => el.removeEventListener(type, fn, opts));
  };
  const input = () => ctx.input;

  for (const [action, size, ox, oy] of BUTTONS) {
    const b = document.createElement('div');
    b.className = `sti-btn sti-${action}`;
    b.setAttribute('data-action', String(action));
    b.style.width = `${size}px`;
    b.style.height = `${size}px`;
    b.style.right = `calc(${60 - Number(ox) - Number(size) / 2}px + env(safe-area-inset-right))`;
    b.style.bottom = `calc(${60 + Number(oy) - Number(size) / 2}px + env(safe-area-inset-bottom))`;
    root.append(b);
    const down = (e) => {
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
      b.classList.add('sti-down');
      input().setButton(String(action), true, ID);
    };
    const up = () => {
      b.classList.remove('sti-down');
      input().setButton(String(action), false, ID);
    };
    listen(b, 'pointerdown', down);
    listen(b, 'pointerup', up);
    listen(b, 'pointercancel', up);
  }

  const stick = { id: -1, ox: 0, oy: 0 };
  const lookPtr = { id: -1, x: 0, y: 0 };
  const TRAVEL = 48;
  const place = (el, x, y) => {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  };
  const rootPos = (e) => {
    const r = root.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  listen(moveZone, 'pointerdown', (e) => {
    e.preventDefault();
    stick.id = e.pointerId;
    try { moveZone.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }
    const [x, y] = rootPos(e);
    stick.ox = x;
    stick.oy = y;
    place(base, x, y);
    place(knob, x, y);
    base.style.display = 'block';
    knob.style.display = 'block';
    ghost.style.display = 'none';
  });
  listen(moveZone, 'pointermove', (e) => {
    if (e.pointerId !== stick.id) return;
    const [x, y] = rootPos(e);
    let dx = (x - stick.ox) / TRAVEL;
    let dy = (y - stick.oy) / TRAVEL;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 1) { dx /= len; dy /= len; }
    place(knob, stick.ox + dx * TRAVEL, stick.oy + dy * TRAVEL);
    const dead = len < 0.1;
    input().setAxis('moveX', dead ? 0 : dx, ID);
    input().setAxis('moveY', dead ? 0 : -dy, ID);
  });
  const stickUp = (e) => {
    if (e.pointerId !== stick.id) return;
    stick.id = -1;
    base.style.display = 'none';
    knob.style.display = 'none';
    ghost.style.display = '';
    input().setAxis('moveX', 0, ID);
    input().setAxis('moveY', 0, ID);
  };
  listen(moveZone, 'pointerup', stickUp);
  listen(moveZone, 'pointercancel', stickUp);
  listen(look, 'pointerdown', (e) => {
    e.preventDefault();
    lookPtr.id = e.pointerId;
    lookPtr.x = e.clientX;
    lookPtr.y = e.clientY;
    try { look.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }
  });
  listen(look, 'pointermove', (e) => {
    if (e.pointerId !== lookPtr.id) return;
    const dx = e.clientX - lookPtr.x;
    const dy = e.clientY - lookPtr.y;
    lookPtr.x = e.clientX;
    lookPtr.y = e.clientY;
    input().addLook(dx * 0.25, -dy * 0.25, ID);
  });
  const lookUp = (e) => {
    if (e.pointerId === lookPtr.id) lookPtr.id = -1;
  };
  listen(look, 'pointerup', lookUp);
  listen(look, 'pointercancel', lookUp);
  listen(root, 'touchstart', (e) => { e.preventDefault(); }, { passive: false });
  listen(root, 'contextmenu', (e) => { e.preventDefault(); });
  dom.layer('touch').append(root);

  const coarse = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  let shown = false;
  let disposed = false;
  return {
    /** Show the controls while the touch device is in use. @param {any} inp */
    poll(inp) {
      if (disposed) return;
      const want = inp.device === 'touch' || (coarse && inp.device !== 'pad');
      if (want !== shown) {
        shown = want;
        root.classList.toggle('sti-on', want);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const off of offs) off();
      if (root.parentElement) root.parentElement.removeChild(root);
    },
  };
}

/**
 * Create the stand-in camera service.
 * @param {any} ctx
 */
function createCam(ctx) {
  const st = {
    targetId: 0, lockId: 0, yaw: 0, pitch: -12 * D2R, dist: 5.5, fov: 60, mode: 'explore',
    distOverride: 0, lastLookTick: -100000, snap: true, lastX: 0, lastY: 0, lastZ: 0,
    trauma: 0, kickPeak: 0, kickStart: -10, kickDur: 0.25, kickHold: false,
    punchX: 0, punchY: 0, punchZ: 0, lastReal: -1, lookAhead: 0,
    dlgSpeaker: 0, dlgListener: 0,
  };
  /** Active cinematic. */
  const cine = {
    active: false, id: '', shots: /** @type {any[]} */ ([]), index: 0, t: 0, skippable: true, freeze: false,
    prevContext: 'game', resolve: /** @type {((v:{skipped:boolean})=>void)|null} */ (null),
    fromX: 0, fromY: 0, fromZ: 0,
  };
  const pivot = TMP.v7;
  const pCine = { id: '', skippable: true };
  const pCineEnd = { id: '', skipped: false };
  const lookTarget = { x: 0, y: 0, z: 0 };
  const fromTmp = { x: 0, y: 0, z: 0 };

  /** @param {boolean} skipped */
  function finishCine(skipped) {
    if (!cine.active) return;
    cine.active = false;
    if (cine.freeze) ctx.time.resume('cine');
    if (ctx.input.context === 'cine') ctx.input.setContext(/** @type {any} */ (cine.prevContext));
    pCineEnd.id = cine.id;
    pCineEnd.skipped = skipped;
    ctx.bus.emit('cine:end', pCineEnd);
    const r = cine.resolve;
    cine.resolve = null;
    st.snap = true;
    if (r) r({ skipped });
  }

  /** @param {any} spec point or { entId, socket } @param {any} out @returns {boolean} */
  function resolvePoint(spec, out) {
    if (!spec) return false;
    if (typeof spec.entId === 'number') {
      const e = ctx.ents.get(spec.entId);
      if (!e) return false;
      if (ctx.actors) ctx.actors.socket(e, spec.socket || 'chest', TMP.v8);
      else TMP.v8.set(e.pos.x, e.pos.y + e.height * 0.7, e.pos.z);
      out.x = TMP.v8.x; out.y = TMP.v8.y; out.z = TMP.v8.z;
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

  /** Advance and apply the cinematic shot. @param {any} camera @param {number} dt */
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
        lookTarget.x = e.pos.x; lookTarget.y = e.pos.y + e.height * 0.6; lookTarget.z = e.pos.z;
      }
    } else if (shot.from || shot.to) {
      fromTmp.x = cine.fromX; fromTmp.y = cine.fromY; fromTmp.z = cine.fromZ;
      const a = shot.from || fromTmp;
      const b = shot.to || a;
      camera.position.set(lerp(a.x, b.x, u), lerp(a.y, b.y, u), lerp(a.z, b.z, u));
    }
    if (shot.lookAt) resolvePoint(shot.lookAt, lookTarget);
    if (shot.lookAt || shot.orbit) camera.lookAt(lookTarget.x, lookTarget.y, lookTarget.z);
    const fov = typeof shot.fov === 'number' ? shot.fov : 50;
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
      st.pitch = clamp(pitch, -70 * D2R, 70 * D2R);
      st.distOverride = typeof dist === 'number' && dist > 0 ? dist : 0;
      st.lastLookTick = ctx.time.tick;
      st.snap = true;
    },

    /** @param {number} targetId 0 = none */
    setLock(targetId) {
      st.lockId = targetId || 0;
    },

    /** @param {number} trauma */
    shake(trauma) {
      st.trauma = clamp(st.trauma + Math.max(0, trauma), 0, 1);
    },

    /** @param {number} deg @param {number} seconds @param {boolean} [hold] */
    fovKick(deg, seconds, hold = false) {
      const settings = ctx.save && ctx.save.settings;
      const k = settings && settings.reducedMotion ? 0.3 : 1;
      st.kickPeak = deg * k;
      st.kickDur = Math.max(0.05, seconds || 0.25);
      st.kickStart = ctx.time.real;
      st.kickHold = !!hold && deg !== 0;
    },

    /** @param {number} dx @param {number} dy @param {number} dz @param {number} amount */
    punch(dx, dy, dz, amount) {
      st.punchX += dx * amount;
      st.punchY += dy * amount;
      st.punchZ += dz * amount;
    },

    /**
     * Linear shot interpolation on frame time.
     * @param {string} id @param {any[]} shots @param {{ skippable?:boolean, freeze?:boolean }} [opts]
     * @returns {Promise<{ skipped:boolean }>}
     */
    play(id, shots, opts) {
      if (cine.active) finishCine(true);
      const o = opts || {};
      const camera = ctx.three && ctx.three.camera;
      cine.active = true;
      cine.id = id;
      cine.shots = Array.isArray(shots) ? shots : [];
      cine.index = 0;
      cine.t = 0;
      cine.skippable = o.skippable !== false;
      cine.freeze = !!o.freeze;
      if (camera) { cine.fromX = camera.position.x; cine.fromY = camera.position.y; cine.fromZ = camera.position.z; }
      if (cine.freeze) ctx.time.pause('cine');
      cine.prevContext = ctx.input.context;
      if (ctx.input.context === 'game') ctx.input.setContext('cine');
      pCine.id = id;
      pCine.skippable = cine.skippable;
      ctx.bus.emit('cine:start', pCine);
      return new Promise((resolve) => {
        if (!cine.active || cine.id !== id) resolve({ skipped: true });
        else cine.resolve = resolve;
      });
    },

    /** Skip the cinematic when it is skippable. */
    skip() {
      if (cine.active && cine.skippable) finishCine(true);
    },

    /** @param {number} speakerEntId @param {number} listenerEntId */
    dialogue(speakerEntId, listenerEntId) {
      st.dlgSpeaker = speakerEntId || 0;
      st.dlgListener = listenerEntId || 0;
    },

    endDialogue() {
      st.dlgSpeaker = 0;
      st.dlgListener = 0;
      st.snap = true;
    },

    /** Remove the touch controls; end a running cinematic. */
    dispose() {
      finishCine(true);
      touch.dispose();
      if (unsubSkip) unsubSkip();
    },
  };

  const touch = createTouchSource(ctx);
  const unsubSkip = ctx.input && typeof ctx.input.onPress === 'function'
    ? ctx.input.onPress((action) => { if (action === 'skip') cam.skip(); })
    : null;

  /**
   * Camera mode for a follow target (cinematics are handled separately).
   * @param {any} c @param {any} target @returns {string}
   */
  function modeOf(c, target) {
    const mv = target.move;
    const lockEnt = st.lockId ? c.ents.get(st.lockId) : null;
    if (st.dlgSpeaker && c.ents.get(st.dlgSpeaker)) return 'dialogue';
    if (lockEnt && lockEnt.alive) return 'lock';
    if (mv && mv.mode === 'fly') return mv.boost > 0 ? 'boost' : 'flight';
    if (target.combat && target.combat.inCombatT > 0) return 'combat';
    return 'explore';
  }

  /**
   * Orbit steering on the sim clock: look input, auto-recentre, flight pitch and lock yaw. The orbit feeds the
   * player's camera-relative intent and camera-pitch flight, so it must advance by ticks, never by frame time.
   */
  const lookSystem = {
    id: 'standin.cam.look',
    phase: 'input',
    order: 50,
    owner: OWNER,
    /** @param {any} c */
    step(c) {
      const s = c.save && c.save.settings;
      const lx = c.input.axis('lookX');
      const ly = c.input.axis('lookY');
      if (lx !== 0 || ly !== 0) {
        const sens = s && typeof s.camSens === 'number' ? s.camSens : 1;
        const inv = s && s.invertY ? -1 : 1;
        st.yaw = wrapAngle(st.yaw - lx * D2R * sens);
        st.pitch = clamp(st.pitch + ly * D2R * sens * inv, -70 * D2R, 70 * D2R);
        st.lastLookTick = c.time.tick;
      }
      const target = c.ents.get(st.targetId);
      if (!target || cine.active) return;
      const mode = modeOf(c, target);
      st.mode = mode;
      const dt = SIM_DT;
      const row = MODES[mode];
      const touchDev = c.input.device === 'touch';
      const pitchFlight = touchDev || !!(s && s.pitchFlight);
      const idle = (c.time.tick - st.lastLookTick) * SIM_DT;
      const vx = target.vel.x;
      const vz = target.vel.z;
      const vh = Math.sqrt(vx * vx + vz * vz);
      if (mode === 'lock') {
        const lockEnt = c.ents.get(st.lockId);
        const d = angleDelta(st.yaw, Math.atan2(lockEnt.pos.x - target.pos.x, lockEnt.pos.z - target.pos.z));
        st.yaw = wrapAngle(st.yaw + d * (1 - Math.exp(-6 * dt)));
        st.pitch = damp(st.pitch, row[2] * D2R, 4, dt);
      } else if (mode === 'flight' || mode === 'boost') {
        if (idle > 0.4 && vh > 3) {
          const rate = (mode === 'boost' ? 200 : 120) * D2R * dt;
          st.yaw = wrapAngle(st.yaw + clamp(angleDelta(st.yaw, Math.atan2(vx, vz)), -rate, rate));
        }
        const stickIdle = Math.abs(c.input.axis('moveX')) + Math.abs(c.input.axis('moveY')) < 0.05;
        if (!pitchFlight) {
          const follow = vh > 5 ? clamp(Math.atan2(target.vel.y, vh) * 0.35, -25 * D2R, 12 * D2R) : 0;
          if (idle > 0.4) st.pitch = damp(st.pitch, row[2] * D2R + follow, 2, dt);
        } else if (stickIdle && idle > 0.2) {
          st.pitch = damp(st.pitch, row[2] * D2R, 2, dt);
        } else if (Math.abs(st.pitch) < 8 * D2R && idle > 0.2) {
          st.pitch = damp(st.pitch, 0, 1.5, dt);
        }
      } else if (mode !== 'dialogue' && vh > 1.5 && idle > (touchDev ? 1.0 : 1.5)) {
        // Recentre behind forward running; pure strafing does not spin the camera around the player.
        const fwd = c.input.axis('moveY') > 0.3 ? clamp(1 - Math.abs(c.input.axis('moveX')) * 2, 0, 1) : 0;
        const rate = 70 * D2R * dt * (target === c.player ? fwd : 1);
        st.yaw = wrapAngle(st.yaw + clamp(angleDelta(st.yaw, Math.atan2(vx, vz)), -rate, rate));
        st.pitch += clamp(row[2] * D2R - st.pitch, -30 * D2R * dt, 30 * D2R * dt);
      }
    },
  };

  const rigSystem = {
    id: 'standin.cam.rig',
    phase: 'camera',
    owner: OWNER,
    /**
     * Place the camera from the orbit (visual smoothing only; the orbit itself is steered in the sim step).
     * @param {any} c @param {number} frameDt @param {number} alpha
     */
    frame(c, frameDt, alpha) {
      const camera = c.three && c.three.camera;
      if (!camera) return;
      const real = c.time.real;
      const simDt = st.lastReal < 0 ? 0 : real - st.lastReal;
      st.lastReal = real;
      const dt = Math.min(0.25, frameDt > 0 ? frameDt : simDt);
      const world = c.world;
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
      const p = c.ents.renderPos(target, alpha, TMP.v6);
      const jump = Math.abs(p.x - st.lastX) + Math.abs(p.y - st.lastY) + Math.abs(p.z - st.lastZ) > 60;
      st.lastX = p.x; st.lastY = p.y; st.lastZ = p.z;
      const snap = st.snap || jump || dt <= 0;
      st.snap = false;

      const mode = modeOf(c, target);
      st.mode = mode;
      const lockEnt = mode === 'lock' ? c.ents.get(st.lockId) : null;
      const speaker = mode === 'dialogue' ? c.ents.get(st.dlgSpeaker) : null;
      const row = MODES[mode];
      const aspect = camera.aspect || 1;
      const portrait = aspect < 1;
      let wantDist = st.distOverride && (mode === 'explore' || mode === 'combat') ? st.distOverride : row[0];
      let wantHeight = row[1];
      if (portrait) { wantDist += 1.5; wantHeight += 0.6; }
      const wantFov = portrait ? row[4] : row[3];
      const s = c.save && c.save.settings;
      const vx = target.vel.x;
      const vz = target.vel.z;
      const vh = Math.sqrt(vx * vx + vz * vz);

      if (lockEnt) {
        const dx = lockEnt.pos.x - p.x;
        const dz = lockEnt.pos.z - p.z;
        const sep = Math.sqrt(dx * dx + dz * dz);
        wantDist = 6.5 + clamp((sep - 4) / 30, 0, 1) * 7.5 + (portrait ? 1.5 : 0);
        pivot.set((p.x + lockEnt.pos.x) * 0.5, (p.y + lockEnt.pos.y) * 0.5 + wantHeight, (p.z + lockEnt.pos.z) * 0.5);
      } else {
        const run = target.stats && target.stats.runSpeed > 0 ? target.stats.runSpeed : 7;
        st.lookAhead = snap ? 0 : damp(st.lookAhead, mode === 'explore' ? clamp(vh / run, 0, 1) * 2 : 0, 3, dt);
        const inv = vh > 0.01 ? st.lookAhead / vh : 0;
        pivot.set(p.x + vx * inv, p.y + wantHeight, p.z + vz * inv);
      }

      if (snap) {
        st.dist = wantDist;
        st.fov = wantFov;
      } else {
        st.dist = damp(st.dist, wantDist, mode === 'boost' ? 3 : 5, dt);
        st.fov = damp(st.fov, wantFov, 4, dt);
      }

      const cp = Math.cos(st.pitch);
      const dirX = Math.sin(st.yaw) * cp;
      const dirY = Math.sin(st.pitch);
      const dirZ = Math.cos(st.yaw) * cp;
      let dist = st.dist;
      if (world) {
        for (let k = 1; k <= 4; k++) {
          const f = k / 4;
          const sx = pivot.x - dirX * dist * f;
          const sy = pivot.y - dirY * dist * f;
          const sz = pivot.z - dirZ * dist * f;
          if (sy < world.heightAt(sx, sz) + 0.4) {
            dist = Math.max(1.2, dist * (f - 0.2));
            break;
          }
        }
      }
      let cx = pivot.x - dirX * dist;
      let cy = pivot.y - dirY * dist;
      let cz = pivot.z - dirZ * dist;

      if (mode === 'dialogue') {
        const listener = st.dlgListener ? c.ents.get(st.dlgListener) : target;
        const l = listener || target;
        const sdx = speaker.pos.x - l.pos.x;
        const sdz = speaker.pos.z - l.pos.z;
        const sl = Math.sqrt(sdx * sdx + sdz * sdz) || 1;
        cx = l.pos.x - (sdx / sl) * 2.2 - (sdz / sl) * 0.6;
        cy = l.pos.y + 1.7;
        cz = l.pos.z - (sdz / sl) * 2.2 + (sdx / sl) * 0.6;
        pivot.set(speaker.pos.x, speaker.pos.y + speaker.height * 0.85, speaker.pos.z);
      }
      if (world) cy = Math.max(cy, world.heightAt(cx, cz) + 0.5);

      const shakeMul = s ? (typeof s.shake === 'number' ? s.shake : 1) * (s.reducedMotion ? 0.25 : 1) : 1;
      st.trauma = Math.max(0, st.trauma - 1.4 * dt);
      const amt = st.trauma * st.trauma * shakeMul;
      const tt = real * 23;
      const ox = amt * 0.6 * Math.sin(tt * 1.3 + 1.1) * Math.cos(tt * 0.7);
      const oy = amt * 0.6 * Math.sin(tt * 1.7 + 2.3);
      const oz = amt * 0.6 * Math.sin(tt * 1.1 + 4.2) * Math.cos(tt * 0.9);
      const decay = Math.exp(-12 * dt);
      st.punchX *= decay; st.punchY *= decay; st.punchZ *= decay;

      camera.position.set(cx + ox + st.punchX, cy + oy + st.punchY, cz + oz + st.punchZ);
      // Frame the body below the centre: at 55% of the height in landscape, 62% in portrait (ART_UX 5).
      if (mode !== 'dialogue' && mode !== 'lock') {
        const frameUp = (portrait ? 0.12 : 0.05) * 2 * dist * Math.tan((st.fov * D2R) / 2);
        pivot.y = p.y + target.height * 0.55 + frameUp;
      }
      camera.lookAt(pivot.x, pivot.y, pivot.z);
      camera.rotateZ(amt * 3 * D2R * Math.sin(tt * 0.8 + 0.5));

      const e = real - st.kickStart;
      let kick;
      if (st.kickHold) kick = st.kickPeak * clamp(e / 0.1, 0, 1);
      else kick = e < 0.06 ? st.kickPeak * (e / 0.06) : st.kickPeak * clamp(1 - (e - 0.06) / st.kickDur, 0, 1);
      const fov = st.fov + kick;
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      if (world) world.setFocus(camera.position.x, camera.position.y, camera.position.z);
    },
  };

  /** @param {any} e combat:lock payload */
  function onLock(e) {
    const p = ctx.player;
    if (p && e.entId === p.id) cam.setLock(e.targetId);
  }

  function onEnded() {
    finishCine(true);
    st.targetId = 0;
    st.lockId = 0;
    st.dlgSpeaker = 0;
    st.dlgListener = 0;
    st.snap = true;
  }

  return { cam, lookSystem, rigSystem, touch, onLock, onEnded };
}

/**
 * Install the stand-in camera under the owner 'standin:cam' and register the stand-in touch source.
 * @param {any} ctx
 */
export function install(ctx) {
  const { cam, lookSystem, rigSystem, touch, onLock, onEnded } = createCam(ctx);
  ctx.provide('cam', cam, OWNER);
  ctx.systems.add(lookSystem);
  ctx.systems.add(rigSystem);
  ctx.bus.on('combat:lock', onLock, OWNER);
  ctx.bus.on('game:ended', onEnded, OWNER);
  ctx.input.registerSource('touch', touch);
}
