/**
 * `ctx.move` (ARCHITECTURE 4.6): the service around the pure mover (logic/mover.js), the `control.move` run
 * system (kinematics, static colliders, soft actor separation, Veilstorm edge) and the `control.player` intent
 * system (logic/intent.js). Events raised during the entity iteration are queued in typed arrays and emitted
 * after it (7.2 rule 7).
 * @module control/move
 */

import { KIND_MASK } from '../core/ents.js';
import { SIM_DT } from '../core/constants.js';
import { TMP, wrapAngle, clamp } from '../core/math.js';
import {
  MODES, createMoveState, createIntent, createRec, resetRec, stepActor, knock as knockActor, impulse as impulseActor,
  dashTo as dashActor, hang as hangActor, setBoostAllowed as boostAllowed, setMode as setModeRaw, setBoost, separatePair,
} from './logic/mover.js';
import { createIntentInput, createLatch, resetLatch, computeIntent } from './logic/intent.js';

const MAX_EVENTS = 256;
const EV_MODE = 1;
const EV_JUMP = 2;
const EV_BOOST = 3;
const EV_LANDED = 4;
const EV_SLAM = 5;
const SURFACES = ['terrain', 'prop'];

/**
 * Create the move service and its systems.
 * @param {any} ctx
 * @param {any} shared package-private state shared with the camera and touch layer ({ latch })
 */
export function createMove(ctx, shared) {
  /** @type {Map<number, import('./logic/mover.js').MoveRec>} */
  const recs = new Map();
  const evType = new Uint8Array(MAX_EVENTS);
  const evEnt = new Int32Array(MAX_EVENTS);
  const evA = new Float64Array(MAX_EVENTS);
  const evB = new Float64Array(MAX_EVENTS);
  const evX = new Float64Array(MAX_EVENTS);
  const evY = new Float64Array(MAX_EVENTS);
  const evZ = new Float64Array(MAX_EVENTS);
  const evS = new Float64Array(MAX_EVENTS);
  const evD = new Float64Array(MAX_EVENTS);
  let evCount = 0;
  let iterating = false;
  const pMode = { entId: 0, mode: 'ground', prev: 'ground' };
  const pJump = { entId: 0 };
  const pBoost = { entId: 0, stage: 0 };
  const pLanded = { entId: 0, speed: 0, x: 0, y: 0, z: 0 };
  const pSlam = { entId: 0, sourceId: 0, x: 0, y: 0, z: 0, speed: 0, surface: 'terrain', damage: 0 };
  const pKnock = { entId: 0, sourceId: 0, speed: 0, hurtle: false };
  const pEdge = { factor: 0 };
  let lastEdge = 0;
  /** @type {any[]} */
  const near = [];

  /**
   * @param {number} type @param {number} id @param {number} a @param {number} b
   * @param {number} x @param {number} y @param {number} z @param {number} s @param {number} d
   */
  function queue(type, id, a, b, x, y, z, s, d) {
    if (evCount >= MAX_EVENTS) return;
    const i = evCount++;
    evType[i] = type; evEnt[i] = id; evA[i] = a; evB[i] = b; evX[i] = x; evY[i] = y; evZ[i] = z; evS[i] = s; evD[i] = d;
  }

  let flushing = false;
  /** Emit the queue; events queued by listeners during the flush are appended and emitted in the same pass. */
  function flush() {
    if (flushing) return;
    flushing = true;
    const bus = ctx.bus;
    for (let i = 0; i < evCount; i++) {
      const id = evEnt[i];
      switch (evType[i]) {
        case EV_MODE:
          pMode.entId = id; pMode.mode = MODES[evA[i]]; pMode.prev = MODES[evB[i]];
          bus.emit('move:mode', pMode);
          break;
        case EV_JUMP:
          pJump.entId = id;
          bus.emit('move:jump', pJump);
          break;
        case EV_BOOST:
          pBoost.entId = id; pBoost.stage = evA[i];
          bus.emit('move:boost', pBoost);
          break;
        case EV_LANDED:
          pLanded.entId = id; pLanded.speed = evA[i]; pLanded.x = evX[i]; pLanded.y = evY[i]; pLanded.z = evZ[i];
          bus.emit('actor:landed', pLanded);
          break;
        case EV_SLAM:
          pSlam.entId = id; pSlam.speed = evA[i]; pSlam.surface = SURFACES[evB[i]];
          pSlam.x = evX[i]; pSlam.y = evY[i]; pSlam.z = evZ[i]; pSlam.sourceId = evS[i]; pSlam.damage = evD[i];
          bus.emit('actor:slam', pSlam);
          break;
        default:
          break;
      }
    }
    evCount = 0;
    flushing = false;
  }

  /** Event sink for the pure mover: queues during the run system, emits at once from API calls. */
  const sink = {
    /** @param {any} ent @param {string} mode @param {string} prev */
    mode(ent, mode, prev) {
      queue(EV_MODE, ent.id, MODES.indexOf(mode), MODES.indexOf(prev), 0, 0, 0, 0, 0);
      if (!iterating) flush();
    },
    /** @param {any} ent */
    jump(ent) {
      queue(EV_JUMP, ent.id, 0, 0, 0, 0, 0, 0, 0);
      if (!iterating) flush();
    },
    /** @param {any} ent @param {number} stage */
    boost(ent, stage) {
      queue(EV_BOOST, ent.id, stage, 0, 0, 0, 0, 0, 0);
      if (!iterating) flush();
    },
    /** @param {any} ent @param {number} speed */
    landed(ent, speed) {
      queue(EV_LANDED, ent.id, speed, 0, ent.pos.x, ent.pos.y, ent.pos.z, 0, 0);
      if (!iterating) flush();
    },
    /** @param {any} ent @param {number} speed @param {string} surface */
    slam(ent, speed, surface) {
      const m = ent.move;
      queue(EV_SLAM, ent.id, speed, surface === 'prop' ? 1 : 0, ent.pos.x, ent.pos.y, ent.pos.z, m.hurtleSourceId, m.hurtleDamage);
      if (!iterating) flush();
    },
  };

  /** @param {any} ent */
  function recOf(ent) {
    let r = recs.get(ent.id);
    if (!r) {
      r = createRec();
      recs.set(ent.id, r);
    }
    return r;
  }

  /** @param {any} ent */
  function isPlayer(ent) {
    return ent === ctx.player || ent.kind === 'player';
  }

  const move = {
    /** @param {any} ent @param {{ canFly?:boolean, mode?:'ground'|'fly'|'scripted' }} [opts] */
    initActor(ent, opts) {
      if (!ent) return;
      ent.move = createMoveState(opts);
      if (!ent.intent) ent.intent = createIntent();
      else {
        const it = ent.intent;
        it.mx = 0; it.mz = 0; it.up = 0; it.jump = false; it.sprint = false; it.flyToggle = false; it.faceYaw = null;
      }
      const world = ctx.world;
      if (world) {
        const g = world.groundAt(ent.pos.x, ent.pos.y, ent.pos.z);
        ent.move.groundY = g;
        if (ent.move.mode === 'ground' && ent.pos.y - g > 0.05) {
          ent.move.grounded = false;
          ent.move.mode = 'air';
        }
      }
      if (recs.size > 256) {
        for (const id of recs.keys()) if (!ctx.ents.get(id)) recs.delete(id);
      }
      const r = recOf(ent);
      resetRec(r);
      if (isPlayer(ent)) resetLatch(shared.latch);
    },

    /** @param {any} ent @param {number} x @param {number} y @param {number} z @param {number} [yaw] */
    teleport(ent, x, y, z, yaw) {
      if (!ent) return;
      ent.pos.set(x, y, z);
      ent.vel.set(0, 0, 0);
      if (typeof yaw === 'number') ent.yaw = wrapAngle(yaw);
      const world = ctx.world;
      if (isPlayer(ent) && world) {
        world.setFocus(x, y, z);
        world.flushBuilds();
      }
      const m = ent.move;
      if (m && world) {
        const g = world.groundAt(x, y, z);
        m.groundY = g;
        if (m.mode !== 'fly' && m.mode !== 'scripted' && m.mode !== 'swim') {
          if (ent.pos.y < g) ent.pos.y = g;
          m.grounded = ent.pos.y - g < 0.05;
          if (m.grounded) ent.pos.y = g;
          setModeRaw(ent, sink, m.grounded ? 'ground' : 'air');
        } else if (ent.pos.y < g) {
          ent.pos.y = g;
        }
        m.airT = 0;
        if (m.boost !== 0) setBoost(ent, sink, 0);
        resetRec(recOf(ent));
      }
      ent.prev.copy(ent.pos);
    },

    /** @param {any} ent @param {'ground'|'fly'|'scripted'|'air'} mode */
    setMode(ent, mode) {
      if (!ent || !ent.move || MODES.indexOf(mode) < 0) return;
      const m = ent.move;
      let next = mode;
      if (mode === 'ground') {
        const g = ctx.world ? ctx.world.groundAt(ent.pos.x, ent.pos.y, ent.pos.z) : ent.pos.y;
        m.grounded = ent.pos.y - g < 0.05;
        if (m.grounded) ent.pos.y = g;
        next = m.grounded ? 'ground' : 'air';
        m.gravityScale = 1;
      } else {
        m.grounded = false;
      }
      if (mode === 'scripted') ent.vel.set(0, 0, 0);
      if (next !== 'fly' && m.boost !== 0) setBoost(ent, sink, 0);
      const r = recOf(ent);
      if (next === 'fly') r.boostT = 0;
      setModeRaw(ent, sink, next);
    },

    /**
     * @param {any} ent @param {number} vx @param {number} vy @param {number} vz
     * @param {{ hurtle?:boolean, stun?:number, gravityScale?:number, sourceId?:number, slamDamage?:number }} [opts]
     */
    knock(ent, vx, vy, vz, opts) {
      if (!ent || !ent.move) return;
      const o = opts || {};
      knockActor(ent, recOf(ent), sink, vx, vy, vz, o);
      pKnock.entId = ent.id;
      pKnock.sourceId = o.sourceId || 0;
      pKnock.speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      pKnock.hurtle = !!o.hurtle;
      ctx.bus.emit('actor:knocked', pKnock);
    },

    /** @param {any} ent @param {number} vx @param {number} vy @param {number} vz */
    impulse(ent, vx, vy, vz) {
      if (!ent || !ent.move) return;
      impulseActor(ent, sink, vx, vy, vz);
    },

    /** @param {any} ent @param {number} x @param {number} y @param {number} z @param {number} seconds */
    dashTo(ent, x, y, z, seconds) {
      if (!ent || !ent.move) return;
      dashActor(ent, recOf(ent), x, y, z, seconds);
    },

    /**
     * Air hang for air strings and Pursuit (addition to 4.6): an airborne body falls with `gravityScale` (default the
     * juggle gravity 0.3) and at most 3 m/s for `seconds`. No effect on the ground or in flight.
     * @param {any} ent @param {number} seconds @param {number} [gravityScale] @param {number} [vy] vertical speed to take now
     */
    hang(ent, seconds, gravityScale, vy) {
      if (!ent || !ent.move) return;
      hangActor(ent, recOf(ent), seconds, typeof gravityScale === 'number' ? gravityScale : 0.3, typeof vy === 'number' ? vy : NaN);
    },

    /** @param {any} ent @param {number} seconds @param {{ noTurn?:boolean, slow?:number }} [opts] */
    lock(ent, seconds, opts) {
      if (!ent || !ent.move) return;
      const m = ent.move;
      m.lockT = Math.max(0, seconds || 0);
      m.noTurnT = opts && opts.noTurn ? m.lockT : 0;
      recOf(ent).lockSlow = clamp(opts && typeof opts.slow === 'number' ? opts.slow : 0, 0, 1);
    },

    /** @param {any} ent @param {number} yaw @param {boolean} [immediate] */
    face(ent, yaw, immediate = false) {
      if (!ent) return;
      if (immediate || !ent.move) {
        ent.yaw = wrapAngle(yaw);
        if (ent.move) recOf(ent).faceYaw = NaN;
        return;
      }
      recOf(ent).faceYaw = wrapAngle(yaw);
    },

    /** @param {any} ent @returns {number} metres above world.groundAt */
    altitude(ent) {
      if (!ent || !ctx.world) return 0;
      return ent.pos.y - ctx.world.groundAt(ent.pos.x, ent.pos.y, ent.pos.z);
    },

    /** @param {any} ent @param {boolean} on */
    setCanFly(ent, on) {
      if (!ent || !ent.move) return;
      ent.move.canFly = !!on;
      if (!on && ent.move.mode === 'fly') move.setMode(ent, 'air');
    },

    /** @param {any} ent @param {boolean} on */
    setBoostAllowed(ent, on) {
      if (!ent || !ent.move) return;
      boostAllowed(ent, recOf(ent), sink, on);
    },

    /** Private hurtle spin (radians) for visuals; 0 when not hurtling. @param {any} ent */
    spin(ent) {
      const r = ent ? recs.get(ent.id) : null;
      return r ? r.spin : 0;
    },

    dispose() {
      recs.clear();
    },
  };

  const runSystem = {
    id: 'move.run',
    phase: 'move',
    /** @param {any} c @param {number} dt */
    step(c, dt) {
      const world = c.world;
      if (!world) return;
      const list = c.ents.all();
      iterating = true;
      let playerEdge = -1;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.move === null || !e.alive) continue;
        const f = stepActor(e, recOf(e), dt, world, sink);
        if (e === c.player) playerEdge = f;
      }
      // Soft actor-actor separation, each pair once, in id order.
      const spatial = c.spatial;
      if (spatial) {
        for (let i = 0; i < list.length; i++) {
          const a = list[i];
          if (a.move === null || !a.alive || (KIND_MASK[a.kind] & KIND_MASK.ACTORS) === 0) continue;
          const n = spatial.query(a.pos.x, a.pos.z, a.radius + 2, near, KIND_MASK.ACTORS);
          for (let j = 0; j < n; j++) {
            const b = near[j];
            if (b.id <= a.id || b.move === null || !b.alive) continue;
            separatePair(a, b, dt);
          }
        }
        near.length = 0;
      }
      iterating = false;
      flush();
      if (playerEdge >= 0) {
        const q = Math.round(playerEdge * 10) / 10;
        if (Math.abs(q - lastEdge) >= 0.1 - 1e-9) {
          lastEdge = q;
          pEdge.factor = q;
          c.bus.emit('world:edge', pEdge);
        }
      }
    },
  };

  // Player intent (4.6): camera-relative stick, buttons, sprint and boost, the touch latch, camera-pitch flight.
  const inp = createIntentInput();
  const playerSystem = {
    id: 'control.player',
    phase: 'intent',
    order: 0,
    /** @param {any} c */
    step(c) {
      const p = c.player;
      if (!p || !p.alive || !p.intent || !p.move) return;
      const input = c.input;
      const cam = c.cam;
      inp.ax = input.axis('moveX');
      inp.ay = input.axis('moveY');
      inp.dashDown = input.down('dash');
      inp.dashHeld = input.heldTime('dash');
      inp.dashPressed = input.pressed('dash');
      inp.jumpPressed = input.pressed('jump');
      inp.jumpDown = input.down('jump');
      inp.descendDown = input.down('descend');
      inp.touch = input.device === 'touch';
      const settings = c.save && c.save.settings;
      inp.pitchFlight = inp.touch || !!(settings && settings.pitchFlight);
      inp.flying = p.move.mode === 'fly';
      inp.t = c.time.tick * SIM_DT;
      if (cam) {
        const f = cam.forward(TMP.v4);
        const r = cam.right(TMP.v5);
        inp.fwdX = f.x; inp.fwdZ = f.z; inp.rightX = r.x; inp.rightZ = r.z;
        inp.pitch = cam.pitch;
      } else {
        inp.fwdX = Math.sin(p.yaw); inp.fwdZ = Math.cos(p.yaw); inp.rightX = -Math.cos(p.yaw); inp.rightZ = Math.sin(p.yaw);
        inp.pitch = 0;
      }
      computeIntent(inp, shared.latch, p.intent);
    },
  };

  /** Reset per-journey state. */
  function reset() {
    recs.clear();
    lastEdge = 0;
    evCount = 0;
    resetLatch(shared.latch);
  }

  return { move, runSystem, playerSystem, reset };
}
