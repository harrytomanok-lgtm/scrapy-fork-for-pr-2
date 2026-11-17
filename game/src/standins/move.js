/**
 * Stand-in `ctx.move` (ARCHITECTURE 4.6, 8.0): kinematics for every entity with `ent.move` against the terrain
 * only (no static colliders): ground walk with acceleration, sprint, jump and gravity, slope sliding, swimming
 * at the surface, flight (a second jump press in the air) with damping, ascend and descend, boost stages from
 * `intent.sprint` (Sonic after 2 s), auto-land, the ceiling, Veilstorm push-back, knockback and hurtle
 * (ballistic, `actor:slam` on a ground impact at 14 m/s or more), `dashTo`, `impulse`, `lock` and `face`.
 * Also the player intent system: camera-relative stick, jump and take-off, ascend and descend, sprint and
 * boost from a `dash` hold of 0.2 s, the double-press boost latch, and camera-pitch flight.
 * Replaced by the control package.
 * @module standins/move
 */

import { BALANCE } from '../core/balance.js';
import { TMP, clamp, angleDelta, wrapAngle } from '../core/math.js';
import { TAG } from '../core/ents.js';

const OWNER = 'standin:move';
const M = BALANCE.move;
const HURTLE = BALANCE.combat.hurtle;
const SLAM = BALANCE.combat.slam;
const DEF_RUN = BALANCE.enemyScale.move.run;
const DEF_FLY = BALANCE.enemyScale.move.fly;
const SPRINT_MULT = BALANCE.derived.run.sprintMult;
const SONIC_MULT = BALANCE.derived.boost.sonicMult;
const AIR_ACCEL = 14;
const TURN_RATE = 14;
const SONIC_AFTER = 2;
const SPRINT_HOLD = 0.2;
const LATCH_WINDOW_TICKS = 18;
const SLOPE_SLIDE = 25;
const EDGE_PUSH = 60;
const EDGE_CARRY = 15;
const MAX_EVENTS = 128;

const MODES = ['ground', 'air', 'fly', 'swim', 'hurtle', 'scripted'];
const EV_MODE = 1;
const EV_JUMP = 2;
const EV_BOOST = 3;
const EV_LANDED = 4;
const EV_SLAM = 5;

/**
 * @typedef {{ boostT:number, dashT:number, dashVx:number, dashVy:number, dashVz:number, lockSlow:number, faceYaw:number }} MoveRec
 *   Private per-entity state of the stand-in mover.
 */

/**
 * Create the stand-in move service.
 * @param {any} ctx
 */
function createMove(ctx) {
  /** @type {Map<number, MoveRec>} */
  const recs = new Map();

  // Events raised during the entity iteration are queued and emitted after it (7.2 rule 7).
  const evType = new Uint8Array(MAX_EVENTS);
  const evEnt = new Int32Array(MAX_EVENTS);
  const evA = new Float64Array(MAX_EVENTS);
  const evB = new Float64Array(MAX_EVENTS);
  const evC = new Float64Array(MAX_EVENTS);
  const evD = new Float64Array(MAX_EVENTS);
  const evE = new Float64Array(MAX_EVENTS);
  const evF = new Float64Array(MAX_EVENTS);
  let evCount = 0;
  const pMode = { entId: 0, mode: 'ground', prev: 'ground' };
  const pJump = { entId: 0 };
  const pBoost = { entId: 0, stage: 0 };
  const pLanded = { entId: 0, speed: 0, x: 0, y: 0, z: 0 };
  const pSlam = { entId: 0, sourceId: 0, x: 0, y: 0, z: 0, speed: 0, surface: 'terrain', damage: 0 };
  const pKnock = { entId: 0, sourceId: 0, speed: 0, hurtle: false };
  const pEdge = { factor: 0 };
  let lastEdge = 0;

  function queue(type, entId, a, b, c, d, e, f) {
    if (evCount >= MAX_EVENTS) return;
    const i = evCount++;
    evType[i] = type; evEnt[i] = entId;
    evA[i] = a; evB[i] = b; evC[i] = c; evD[i] = d; evE[i] = e; evF[i] = f;
  }

  function flushEvents() {
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
          pLanded.entId = id; pLanded.speed = evA[i]; pLanded.x = evB[i]; pLanded.y = evC[i]; pLanded.z = evD[i];
          bus.emit('actor:landed', pLanded);
          break;
        case EV_SLAM:
          pSlam.entId = id; pSlam.speed = evA[i]; pSlam.x = evB[i]; pSlam.y = evC[i]; pSlam.z = evD[i];
          pSlam.sourceId = evE[i]; pSlam.damage = evF[i];
          bus.emit('actor:slam', pSlam);
          break;
        default:
          break;
      }
    }
    evCount = 0;
  }

  /** @param {any} ent @returns {MoveRec} */
  function recOf(ent) {
    let r = recs.get(ent.id);
    if (!r) {
      r = { boostT: 0, dashT: 0, dashVx: 0, dashVy: 0, dashVz: 0, lockSlow: 1, faceYaw: NaN };
      recs.set(ent.id, r);
    }
    return r;
  }

  /** Change mode, queueing move:mode when it differs. @param {any} ent @param {string} mode */
  function setModeQueued(ent, mode) {
    const m = ent.move;
    if (m.mode === mode) return;
    queue(EV_MODE, ent.id, MODES.indexOf(mode), MODES.indexOf(m.mode), 0, 0, 0, 0);
    m.mode = mode;
  }

  /** @param {any} ent @param {number} stage */
  function setBoostQueued(ent, stage) {
    if (ent.move.boost === stage) return;
    ent.move.boost = stage;
    queue(EV_BOOST, ent.id, stage, 0, 0, 0, 0, 0);
  }

  /** Turn toward a yaw at TURN_RATE. @param {any} ent @param {number} yaw @param {number} dt */
  function turnToward(ent, yaw, dt) {
    const d = angleDelta(ent.yaw, yaw);
    const max = TURN_RATE * dt;
    ent.yaw = wrapAngle(ent.yaw + (d > max ? max : d < -max ? -max : d));
  }

  /** Land on the ground at height g. @param {any} ent @param {number} g */
  function land(ent, g) {
    const m = ent.move;
    const speed = -ent.vel.y > 0 ? -ent.vel.y : 0;
    ent.pos.y = g;
    ent.vel.y = 0;
    m.grounded = true;
    m.airT = 0;
    m.gravityScale = 1;
    setBoostQueued(ent, 0);
    setModeQueued(ent, 'ground');
    queue(EV_LANDED, ent.id, speed, ent.pos.x, ent.pos.y, ent.pos.z, 0, 0);
  }

  /**
   * Ground and air movement.
   * @param {any} ent @param {MoveRec} r @param {number} dt @param {number} mx @param {number} mz @param {boolean} jump @param {boolean} sprint @param {boolean} flyToggle
   */
  function stepGround(ent, r, dt, mx, mz, jump, sprint, flyToggle) {
    const m = ent.move;
    const world = ctx.world;
    const st = ent.stats;
    const lockF = m.lockT > 0 ? r.lockSlow : 1;
    const run = (st ? st.runSpeed * st.speedMult : DEF_RUN) * m.speedMult * lockF * (sprint && m.grounded ? SPRINT_MULT : 1);
    const tvx = mx * run;
    const tvz = mz * run;
    const accel = (m.grounded ? M.groundAccel : AIR_ACCEL) * dt;
    const dvx = tvx - ent.vel.x;
    const dvz = tvz - ent.vel.z;
    const dl = Math.sqrt(dvx * dvx + dvz * dvz);
    if (dl <= accel) {
      ent.vel.x = tvx;
      ent.vel.z = tvz;
    } else {
      ent.vel.x += (dvx / dl) * accel;
      ent.vel.z += (dvz / dl) * accel;
    }
    if (m.noTurnT <= 0 && !(r.faceYaw === r.faceYaw) && (tvx * tvx + tvz * tvz) > 0.01) turnToward(ent, Math.atan2(tvx, tvz), dt);

    if ((jump || flyToggle) && m.grounded && m.lockT <= 0) {
      if (flyToggle && m.canFly) {
        ent.vel.y = 6;
        m.grounded = false;
        setModeQueued(ent, 'fly');
        return;
      }
      ent.vel.y = M.jumpSpeed;
      m.grounded = false;
      setModeQueued(ent, 'air');
      queue(EV_JUMP, ent.id, 0, 0, 0, 0, 0, 0);
    } else if ((jump || flyToggle) && !m.grounded && m.canFly && m.airT > 0.05) {
      ent.vel.y = Math.max(ent.vel.y, 4);
      setModeQueued(ent, 'fly');
      return;
    }

    if (m.grounded) {
      const slope = world.slopeAt(ent.pos.x, ent.pos.z);
      if (slope > M.walkableSlope) {
        world.normalAt(ent.pos.x, ent.pos.z, TMP.v6);
        ent.vel.x += TMP.v6.x * SLOPE_SLIDE * dt;
        ent.vel.z += TMP.v6.z * SLOPE_SLIDE * dt;
      }
    } else {
      ent.vel.y -= M.gravity * m.gravityScale * dt;
    }
    ent.pos.x += ent.vel.x * dt;
    ent.pos.y += ent.vel.y * dt;
    ent.pos.z += ent.vel.z * dt;
    const g = world.groundAt(ent.pos.x, ent.pos.y, ent.pos.z);
    m.groundY = g;
    if (m.grounded) {
      if (ent.pos.y - g <= M.groundSnap && ent.vel.y <= 0) {
        ent.pos.y = g;
        ent.vel.y = 0;
      } else {
        m.grounded = false;
        setModeQueued(ent, 'air');
      }
    } else if (ent.pos.y <= g) {
      if (ent.vel.y <= 0) land(ent, g);
      else ent.pos.y = g;
    }
    m.airT = m.grounded ? 0 : m.airT + dt;
    if (ent.pos.y < -M.swimDepth && world.heightAt(ent.pos.x, ent.pos.z) < -M.swimDepth) {
      ent.pos.y = -M.swimDepth;
      ent.vel.y = 0;
      m.grounded = false;
      setModeQueued(ent, 'swim');
    }
  }

  /**
   * Swimming at the surface.
   * @param {any} ent @param {MoveRec} r @param {number} dt @param {number} mx @param {number} mz @param {boolean} jump
   */
  function stepSwim(ent, r, dt, mx, mz, jump) {
    const m = ent.move;
    const st = ent.stats;
    const speed = (st ? st.runSpeed * st.speedMult : DEF_RUN) * 0.5 * m.speedMult;
    const k = 1 - Math.exp(-4 * dt);
    ent.vel.x += (mx * speed - ent.vel.x) * k;
    ent.vel.z += (mz * speed - ent.vel.z) * k;
    ent.vel.y = 0;
    if ((mx * mx + mz * mz) > 0.01 && m.noTurnT <= 0) turnToward(ent, Math.atan2(mx, mz), dt);
    ent.pos.x += ent.vel.x * dt;
    ent.pos.z += ent.vel.z * dt;
    ent.pos.y = -M.swimDepth;
    const g = ctx.world.groundAt(ent.pos.x, ent.pos.y, ent.pos.z);
    m.groundY = g;
    if (jump && m.canFly) {
      ent.vel.y = 6;
      setModeQueued(ent, 'fly');
    } else if (g > -M.swimDepth) {
      ent.pos.y = g;
      m.grounded = true;
      setModeQueued(ent, 'ground');
    }
  }

  /**
   * Flight with boost stages.
   * @param {any} ent @param {MoveRec} r @param {number} dt @param {number} mx @param {number} mz @param {number} up @param {boolean} sprint
   */
  function stepFly(ent, r, dt, mx, mz, up, sprint) {
    const m = ent.move;
    const st = ent.stats;
    const lockF = m.lockT > 0 ? r.lockSlow : 1;
    const sMult = (st ? st.speedMult : 1) * m.speedMult * lockF;
    const cruise = (st ? st.flySpeed : DEF_FLY) * sMult;
    if (sprint && m.boostAllowed) {
      r.boostT += dt;
      setBoostQueued(ent, r.boostT >= SONIC_AFTER ? 2 : 1);
    } else {
      r.boostT = 0;
      setBoostQueued(ent, 0);
    }
    const boostSpeed = (st ? st.boostSpeed : cruise * 2.5) * sMult * (m.boost === 2 ? SONIC_MULT : 1);
    const speed = m.boost > 0 ? boostSpeed : cruise;
    let dx = mx;
    let dy = up;
    let dz = mz;
    if (m.boost > 0 && dx * dx + dz * dz < 0.01) {
      dx = Math.sin(ent.yaw);
      dz = Math.cos(ent.yaw);
    }
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dl > 1) { dx /= dl; dy /= dl; dz /= dl; }
    let ty = dy * (m.boost > 0 ? speed : cruise * 0.6);
    if (ent.pos.y > M.ceilingFadeFrom && ty > 0) ty *= clamp(1 - (ent.pos.y - M.ceilingFadeFrom) / (M.ceiling - M.ceilingFadeFrom), 0, 1);
    const k = 1 - Math.exp(-M.flightDamping * dt);
    ent.vel.x += (dx * speed - ent.vel.x) * k;
    ent.vel.y += (ty - ent.vel.y) * k;
    ent.vel.z += (dz * speed - ent.vel.z) * k;
    const vh2 = ent.vel.x * ent.vel.x + ent.vel.z * ent.vel.z;
    if (m.noTurnT <= 0 && !(r.faceYaw === r.faceYaw) && vh2 > 1) turnToward(ent, Math.atan2(ent.vel.x, ent.vel.z), dt);
    ent.pos.x += ent.vel.x * dt;
    ent.pos.y += ent.vel.y * dt;
    ent.pos.z += ent.vel.z * dt;
    if (ent.pos.y > M.ceiling) {
      ent.pos.y = M.ceiling;
      if (ent.vel.y > 0) ent.vel.y = 0;
    }
    const g = ctx.world.groundAt(ent.pos.x, ent.pos.y, ent.pos.z);
    m.groundY = g;
    m.grounded = false;
    m.airT += dt;
    if (ent.pos.y < g) {
      ent.pos.y = g;
      if (ent.vel.y < 0) ent.vel.y = 0;
    }
    if ((ent.vel.y < -0.5 || up < -0.1) && ent.pos.y - g < M.autoLand && g > -M.swimDepth) {
      r.boostT = 0;
      land(ent, g);
    } else if (ent.pos.y < -M.swimDepth) {
      ent.pos.y = -M.swimDepth;
      r.boostT = 0;
      setBoostQueued(ent, 0);
      setModeQueued(ent, 'swim');
    }
  }

  /** Ballistic hurtle; slams on a hard ground impact. @param {any} ent @param {number} dt */
  function stepHurtle(ent, dt) {
    const m = ent.move;
    ent.vel.y -= M.gravity * m.gravityScale * dt;
    ent.pos.x += ent.vel.x * dt;
    ent.pos.y += ent.vel.y * dt;
    ent.pos.z += ent.vel.z * dt;
    const g = ctx.world.groundAt(ent.pos.x, ent.pos.y, ent.pos.z);
    m.groundY = g;
    m.airT += dt;
    const speed = ent.vel.length();
    if (ent.pos.y <= g) {
      ent.pos.y = g;
      if (speed >= SLAM.minSpeed) queue(EV_SLAM, ent.id, speed, ent.pos.x, g, ent.pos.z, m.hurtleSourceId, m.hurtleDamage);
      ent.vel.set(0, 0, 0);
      m.grounded = true;
      m.airT = 0;
      m.gravityScale = 1;
      m.hurtleDamage = 0;
      m.hurtleSourceId = 0;
      setModeQueued(ent, 'ground');
      queue(EV_LANDED, ent.id, speed, ent.pos.x, g, ent.pos.z, 0, 0);
    } else if (speed < HURTLE.stopSpeed) {
      setModeQueued(ent, m.canFly && (ent.tags & TAG.FLYER) !== 0 ? 'fly' : 'air');
    }
  }

  /** Veilstorm push-back toward the island, and world:edge for the player. @param {any} ent @param {number} dt */
  function edge(ent, dt) {
    const world = ctx.world;
    const f = world.edgeFactor(ent.pos.x, ent.pos.z);
    if (ent === ctx.player) {
      const q = Math.round(f * 10) / 10;
      if (Math.abs(q - lastEdge) >= 0.1) {
        lastEdge = q;
        pEdge.factor = q;
        ctx.bus.post('world:edge', pEdge);
      }
    }
    if (f <= 0) return;
    const rr = Math.sqrt(ent.pos.x * ent.pos.x + ent.pos.z * ent.pos.z) || 1;
    const nx = ent.pos.x / rr;
    const nz = ent.pos.z / rr;
    const radial = ent.vel.x * nx + ent.vel.z * nz;
    if (rr >= world.edgeHard) {
      const want = -EDGE_CARRY;
      ent.vel.x += (want - radial) * nx;
      ent.vel.z += (want - radial) * nz;
      ent.yaw = Math.atan2(-nx, -nz);
    } else if (radial > -EDGE_CARRY) {
      ent.vel.x -= nx * EDGE_PUSH * f * dt;
      ent.vel.z -= nz * EDGE_PUSH * f * dt;
    }
  }

  /** @param {any} ent @param {number} dt */
  function integrate(ent, dt) {
    const m = ent.move;
    const r = recOf(ent);
    if (m.lockT > 0) m.lockT = Math.max(0, m.lockT - dt);
    if (m.noTurnT > 0) m.noTurnT = Math.max(0, m.noTurnT - dt);
    const it = ent.intent;
    const active = ent.alive && it !== null && m.mode !== 'scripted';
    const mx = active ? it.mx : 0;
    const mz = active ? it.mz : 0;
    const up = active ? it.up : 0;
    const jump = active ? !!it.jump : false;
    const sprint = active ? !!it.sprint : false;
    const flyToggle = active ? !!it.flyToggle : false;
    if (active && it.faceYaw !== null && it.faceYaw !== undefined && m.noTurnT <= 0) turnToward(ent, it.faceYaw, dt);
    if (r.faceYaw === r.faceYaw) {
      turnToward(ent, r.faceYaw, dt);
      if (Math.abs(angleDelta(ent.yaw, r.faceYaw)) < 1e-3) r.faceYaw = NaN;
    }

    if (r.dashT > 0) {
      const step = Math.min(dt, r.dashT);
      r.dashT -= step;
      const nx = ent.pos.x + r.dashVx * step;
      const nz = ent.pos.z + r.dashVz * step;
      let ny = ent.pos.y + r.dashVy * step;
      const g = ctx.world.groundAt(nx, ny, nz);
      if (g > ent.pos.y + 1.0 && g > ny + 1.0) {
        r.dashT = 0;
      } else {
        if (ny < g) ny = g;
        ent.pos.set(nx, ny, nz);
      }
      ent.vel.set(r.dashVx, r.dashVy, r.dashVz);
      m.groundY = g;
      if (r.dashT <= 0) {
        ent.vel.set(0, 0, 0);
        m.grounded = m.mode !== 'fly' && ent.pos.y - g < 0.05;
      }
    } else {
      switch (m.mode) {
        case 'scripted': break;
        case 'hurtle': stepHurtle(ent, dt); break;
        case 'fly': stepFly(ent, r, dt, mx, mz, up, sprint); break;
        case 'swim': stepSwim(ent, r, dt, mx, mz, jump); break;
        default: stepGround(ent, r, dt, mx, mz, jump, sprint, flyToggle); break;
      }
    }
    if (m.mode !== 'scripted') edge(ent, dt);
    if (it !== null) {
      it.jump = false;
      it.flyToggle = false;
    }
    m.speed = ent.vel.length();
  }

  const move = {
    /** @param {any} ent @param {{ canFly?:boolean, mode?:'ground'|'fly'|'scripted' }} [opts] */
    initActor(ent, opts) {
      if (!ent) return;
      const o = opts || {};
      const g = ctx.world ? ctx.world.groundAt(ent.pos.x, ent.pos.y, ent.pos.z) : 0;
      const mode = o.mode === 'fly' || o.mode === 'scripted' ? o.mode : 'ground';
      ent.move = {
        mode, grounded: mode === 'ground', groundY: g, boost: 0, canFly: !!o.canFly, boostAllowed: true, speedMult: 1,
        lockT: 0, noTurnT: 0, gravityScale: 1, hurtleDamage: 0, hurtleSourceId: 0, airT: 0, speed: 0,
      };
      ent.intent = { mx: 0, mz: 0, up: 0, jump: false, sprint: false, flyToggle: false, faceYaw: null };
      if (recs.size > 256) {
        for (const id of recs.keys()) if (!ctx.ents.get(id)) recs.delete(id);
      }
      recs.delete(ent.id);
      recOf(ent);
    },

    /** @param {any} ent @param {number} x @param {number} y @param {number} z @param {number} [yaw] */
    teleport(ent, x, y, z, yaw) {
      if (!ent) return;
      ent.pos.set(x, y, z);
      ent.vel.set(0, 0, 0);
      if (typeof yaw === 'number') ent.yaw = yaw;
      const world = ctx.world;
      const m = ent.move;
      if ((ent === ctx.player || ent.kind === 'player') && world) {
        world.setFocus(x, y, z);
        world.flushBuilds();
      }
      if (m && world) {
        const g = world.groundAt(x, y, z);
        m.groundY = g;
        if (m.mode !== 'fly' && m.mode !== 'scripted') {
          if (ent.pos.y < g) ent.pos.y = g;
          m.grounded = ent.pos.y - g < 0.05;
          if (m.mode !== (m.grounded ? 'ground' : 'air')) move.setMode(ent, 'ground');
        } else if (ent.pos.y < g) {
          ent.pos.y = g;
        }
        m.airT = 0;
        const r = recOf(ent);
        r.dashT = 0;
        r.boostT = 0;
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
        next = m.grounded ? 'ground' : 'air';
      } else {
        m.grounded = false;
      }
      if (mode === 'scripted') ent.vel.set(0, 0, 0);
      if (next !== 'fly' && m.boost !== 0) {
        m.boost = 0;
        pBoost.entId = ent.id; pBoost.stage = 0;
        ctx.bus.emit('move:boost', pBoost);
      }
      if (m.mode === next) return;
      pMode.entId = ent.id; pMode.mode = next; pMode.prev = m.mode;
      m.mode = next;
      ctx.bus.emit('move:mode', pMode);
    },

    /**
     * @param {any} ent @param {number} vx @param {number} vy @param {number} vz
     * @param {{ hurtle?:boolean, stun?:number, gravityScale?:number, sourceId?:number, slamDamage?:number }} [opts]
     */
    knock(ent, vx, vy, vz, opts) {
      if (!ent || !ent.move) return;
      const o = opts || {};
      const m = ent.move;
      const hurtle = !!o.hurtle;
      ent.vel.set(vx, vy, vz);
      m.lockT = Math.max(m.lockT, o.stun !== undefined ? o.stun : 0.3);
      recOf(ent).lockSlow = 0;
      m.gravityScale = o.gravityScale !== undefined ? o.gravityScale : 1;
      const prev = m.mode;
      if (hurtle) {
        m.mode = 'hurtle';
        m.hurtleDamage = o.slamDamage || 0;
        m.hurtleSourceId = o.sourceId || 0;
        m.grounded = false;
      } else if (m.mode !== 'fly' && vy > 0) {
        m.mode = 'air';
        m.grounded = false;
      }
      if (m.mode !== prev) {
        pMode.entId = ent.id; pMode.mode = m.mode; pMode.prev = prev;
        ctx.bus.emit('move:mode', pMode);
      }
      pKnock.entId = ent.id;
      pKnock.sourceId = o.sourceId || 0;
      pKnock.speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      pKnock.hurtle = hurtle;
      ctx.bus.emit('actor:knocked', pKnock);
    },

    /** Additive velocity. @param {any} ent @param {number} vx @param {number} vy @param {number} vz */
    impulse(ent, vx, vy, vz) {
      if (!ent || !ent.move) return;
      ent.vel.x += vx;
      ent.vel.y += vy;
      ent.vel.z += vz;
      const m = ent.move;
      if (vy > 0 && m.grounded) {
        m.grounded = false;
        if (m.mode === 'ground') move.setMode(ent, 'air');
      }
    },

    /** Straight scripted move over `seconds`, ignoring intent; stops at terrain. */
    dashTo(ent, x, y, z, seconds) {
      if (!ent || !ent.move) return;
      const r = recOf(ent);
      const s = Math.max(1 / 60, seconds);
      r.dashT = s;
      r.dashVx = (x - ent.pos.x) / s;
      r.dashVy = (y - ent.pos.y) / s;
      r.dashVz = (z - ent.pos.z) / s;
    },

    /** @param {any} ent @param {number} seconds @param {{ noTurn?:boolean, slow?:number }} [opts] */
    lock(ent, seconds, opts) {
      if (!ent || !ent.move) return;
      const m = ent.move;
      m.lockT = Math.max(0, seconds);
      m.noTurnT = opts && opts.noTurn ? m.lockT : 0;
      recOf(ent).lockSlow = clamp(opts && opts.slow !== undefined ? opts.slow : 0, 0, 1);
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

    /** @param {any} ent @returns {number} metres above the ground */
    altitude(ent) {
      if (!ent || !ctx.world) return 0;
      return ent.pos.y - ctx.world.groundAt(ent.pos.x, ent.pos.y, ent.pos.z);
    },

    /** @param {any} ent @param {boolean} on */
    setCanFly(ent, on) {
      if (ent && ent.move) ent.move.canFly = !!on;
    },

    /** @param {any} ent @param {boolean} on */
    setBoostAllowed(ent, on) {
      if (!ent || !ent.move) return;
      const m = ent.move;
      m.boostAllowed = !!on;
      if (!on && m.boost !== 0) {
        m.boost = 0;
        recOf(ent).boostT = 0;
        pBoost.entId = ent.id; pBoost.stage = 0;
        ctx.bus.emit('move:boost', pBoost);
      }
    },

    /** Drop private state. */
    dispose() {
      recs.clear();
    },
  };

  const runSystem = {
    id: 'standin.move.run',
    phase: 'move',
    owner: OWNER,
    /** @param {any} c @param {number} dt */
    step(c, dt) {
      if (!c.world) return;
      const list = c.ents.all();
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.move !== null) integrate(e, dt);
      }
      flushEvents();
    },
  };

  // Player intent: camera-relative stick and the buttons (4.6).
  const latch = { on: false, armed: false, lastDashTick: -1000 };
  const playerSystem = {
    id: 'standin.move.player',
    phase: 'intent',
    order: 0,
    owner: OWNER,
    /** @param {any} c */
    step(c) {
      const p = c.player;
      if (!p || !p.alive || !p.intent || !p.move) return;
      const inp = c.input;
      const it = p.intent;
      const ax = inp.axis('moveX');
      const ay = inp.axis('moveY');
      const cam = c.cam;
      const fwd = TMP.v4;
      const right = TMP.v5;
      if (cam) {
        cam.forward(fwd);
        cam.right(right);
      } else {
        fwd.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
        right.set(-Math.cos(p.yaw), 0, Math.sin(p.yaw));
      }
      let mx = fwd.x * ay + right.x * ax;
      let mz = fwd.z * ay + right.z * ax;
      const stick = ax * ax + ay * ay;
      if (inp.pressed('dash')) {
        const tick = c.time.tick;
        if (latch.on) latch.on = false;
        else if (tick - latch.lastDashTick <= LATCH_WINDOW_TICKS) { latch.on = true; latch.armed = stick > 0.01; }
        latch.lastDashTick = tick;
      }
      if (latch.on) {
        if (stick > 0.01) latch.armed = true;
        else if (latch.armed) latch.on = false;
      }
      const buttons = (inp.down('jump') ? 1 : 0) - (inp.down('descend') ? 1 : 0);
      let up = buttons;
      const settings = c.save && c.save.settings;
      const pitchFlight = inp.device === 'touch' || !!(settings && settings.pitchFlight);
      if (p.move.mode === 'fly' && pitchFlight && cam) {
        const pitch = cam.pitch;
        up = clamp(Math.sin(pitch) * ay + buttons, -1, 1);
        const cp = Math.cos(pitch);
        mx *= cp;
        mz *= cp;
      }
      it.mx = mx;
      it.mz = mz;
      it.up = up;
      it.jump = it.jump || inp.pressed('jump');
      it.sprint = (inp.down('dash') && inp.heldTime('dash') >= SPRINT_HOLD) || latch.on;
      it.faceYaw = null;
    },
  };

  /** Reset per-journey state. */
  function reset() {
    recs.clear();
    lastEdge = 0;
    latch.on = false;
    latch.armed = false;
    latch.lastDashTick = -1000;
    evCount = 0;
  }

  return { move, runSystem, playerSystem, reset };
}

/**
 * Install the stand-in move service under the owner 'standin:move'.
 * @param {any} ctx
 */
export function install(ctx) {
  const { move, runSystem, playerSystem, reset } = createMove(ctx);
  ctx.provide('move', move, OWNER);
  ctx.systems.add(playerSystem);
  ctx.systems.add(runSystem);
  ctx.bus.on('game:ended', reset, OWNER);
}
