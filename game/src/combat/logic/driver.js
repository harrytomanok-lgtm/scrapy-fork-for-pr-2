/**
 * The player action driver `combat.player` (ARCHITECTURE 4.9 rules, GDD 5.1): input actions -> combat.act.
 * attack tap = Strike String (presses queue the next step), attack held 0.35 s = Breaker (Meteor Heel in the
 * air, hold to charge), bolt pressed or held = Ora Bolt auto-fire, guard and gather held, `dash` **pressed** =
 * Flicker Step at once (or Pursuit inside its window; the hold belongs to control), tech1 / tech2 with
 * hold-to-charge, ultimate, form and formNext, lock / lockNext / lockPrev. A press that cannot start yet is
 * buffered for a short window so fast inputs are never lost.
 * Pure: no three, no window.
 * @module combat/logic/driver
 */

import { BALANCE } from '../../core/balance.js';

const HEAVY_HOLD = BALANCE.tech.breaker.holdSeconds;
/** Seconds a press that could not start waits for the current action to become cancellable. */
const BUFFER_SECONDS = 0.22;
/** The actions whose press and release edges the driver reads. */
const LATCHED = Object.freeze(['attack', 'dash', 'bolt', 'guard', 'gather', 'tech1', 'tech2', 'ultimate', 'form', 'formNext', 'lock', 'lockNext', 'lockPrev']);

/**
 * @param {any} ctx
 * @param {{ combat:any }} engine
 * @returns {any} the system (`latch` holds the companion input-phase system)
 */
export function createPlayerDriver(ctx, engine) {
  const AO = { dirX: 0, dirZ: 0, targetId: undefined };
  const st = { heavyArmed: false, heavyStarted: false, buffer: '', bufferT: 0, entId: 0, guardByInput: false, gatherByInput: false };
  // Hit-stop freezes the gameplay phases, so this driver does not run on frozen ticks while the input edges are
  // cleared every tick: a press (or the start of a hold, such as a Meteor Heel right after an air string) made
  // during a hit-stop would be lost. The latch system runs in the input phase on frozen ticks and keeps the edges.
  const latchP = new Uint8Array(LATCHED.length);
  const latchR = new Uint8Array(LATCHED.length);
  let latched = false;

  /** @param {any} inp @param {string} a */
  function pressed(inp, a) {
    if (inp.pressed(a)) return true;
    if (!latched) return false;
    const i = LATCHED.indexOf(a);
    return i >= 0 && latchP[i] === 1;
  }
  /** @param {any} inp @param {string} a */
  function released(inp, a) {
    if (inp.released(a)) return true;
    if (!latched) return false;
    const i = LATCHED.indexOf(a);
    return i >= 0 && latchR[i] === 1;
  }

  const latch = {
    id: 'combat.latch',
    phase: 'input',
    order: 50,
    /** @param {any} c */
    step(c) {
      if (!c.time.frozen) return;
      const inp = c.input;
      for (let i = 0; i < LATCHED.length; i++) {
        if (inp.pressed(LATCHED[i])) { latchP[i] = 1; latched = true; }
        if (inp.released(LATCHED[i])) { latchR[i] = 1; latched = true; }
      }
    },
  };

  /** @param {string} action */
  function tryAct(p, action) {
    const ok = engine.combat.act(p, action, AO);
    if (!ok && (action === 'attack' || action === 'tech1' || action === 'tech2' || action === 'ultimate')) {
      st.buffer = action;
      st.bufferT = BUFFER_SECONDS;
    } else if (ok && st.buffer === action) {
      st.buffer = '';
    }
    return ok;
  }

  function clearLatch() {
    if (!latched) return;
    latchP.fill(0);
    latchR.fill(0);
    latched = false;
  }

  return {
    id: 'combat.player',
    phase: 'intent',
    order: 10,
    latch,
    /** @param {any} c @param {number} dt */
    step(c, dt) {
      const p = c.player;
      if (!p || !p.alive || !p.combat) {
        clearLatch();
        return;
      }
      runDriver(c, dt, p);
      clearLatch();
    },
  };

  /** @param {any} c @param {number} dt @param {any} p */
  function runDriver(c, dt, p) {
    {
      if (st.entId !== p.id) {
        st.entId = p.id; st.heavyArmed = false; st.heavyStarted = false; st.buffer = '';
      }
      const inp = c.input;
      const combat = engine.combat;
      AO.dirX = 0; AO.dirZ = 0; AO.targetId = undefined;
      if (pressed(inp, 'lock')) combat.setTarget(combat.target() ? 0 : combat.softTarget());
      if (pressed(inp, 'lockNext')) combat.cycleTarget(1);
      if (pressed(inp, 'lockPrev')) combat.cycleTarget(-1);

      // Dash press -> Flicker (or Pursuit) at once, before anything else this tick.
      if (pressed(inp, 'dash')) {
        const it = p.intent;
        let dx = it ? it.mx : 0;
        let dz = it ? it.mz : 0;
        if (dx * dx + dz * dz < 0.01) { dx = -Math.sin(p.yaw); dz = -Math.cos(p.yaw); }
        AO.dirX = dx; AO.dirZ = dz;
        combat.act(p, 'flicker', AO);
        AO.dirX = 0; AO.dirZ = 0;
        st.buffer = '';
      }

      // Attack: tap = string, hold = Breaker / Meteor Heel (charge while held).
      if (pressed(inp, 'attack')) {
        st.heavyArmed = true;
        st.heavyStarted = false;
        tryAct(p, 'attack');
      }
      if (st.heavyArmed && !st.heavyStarted && inp.down('attack') && inp.heldTime('attack') >= HEAVY_HOLD) {
        st.heavyStarted = true;
        if (st.buffer === 'attack') st.buffer = '';
        if (!combat.act(p, 'heavyStart', AO)) st.heavyStarted = false;
      }
      if (st.heavyArmed && !inp.down('attack')) {
        if (st.heavyStarted) combat.act(p, 'heavyRelease', AO);
        st.heavyArmed = false;
        st.heavyStarted = false;
      }

      // Bolt: tap or hold (auto-fire whenever the cooldown allows).
      if (inp.down('bolt') || pressed(inp, 'bolt')) combat.act(p, 'bolt', AO);

      // Guard and Gather are holds; they resume when the action that interrupted them ends.
      if (pressed(inp, 'guard') || (inp.down('guard') && p.combat.state === 'idle')) {
        if (combat.act(p, 'guardOn', AO)) st.guardByInput = true;
      }
      if (released(inp, 'guard') || (st.guardByInput && !inp.down('guard') && p.combat.guarding)) {
        combat.act(p, 'guardOff', AO);
        st.guardByInput = false;
      }
      if (pressed(inp, 'gather') || (inp.down('gather') && p.combat.state === 'idle' && !p.combat.guarding)) {
        if (combat.act(p, 'gatherOn', AO)) st.gatherByInput = true;
      }
      if (released(inp, 'gather') || (st.gatherByInput && !inp.down('gather') && p.combat.gathering)) {
        combat.act(p, 'gatherOff', AO);
        st.gatherByInput = false;
      }

      if (pressed(inp, 'tech1')) tryAct(p, 'tech1');
      if (pressed(inp, 'tech2')) tryAct(p, 'tech2');
      if (released(inp, 'tech1') || released(inp, 'tech2')) combat.act(p, 'techRelease', AO);
      if (pressed(inp, 'ultimate')) tryAct(p, 'ultimate');
      if (pressed(inp, 'form')) combat.act(p, 'form', AO);
      if (pressed(inp, 'formNext') && c.rpg && c.rpg.forms) {
        const forms = c.rpg.forms();
        if (forms.length > 0) {
          const i = forms.indexOf(c.rpg.selectedForm);
          c.rpg.selectForm(forms[(i + 1) % forms.length]);
        }
      }

      // Buffered press.
      if (st.buffer) {
        st.bufferT -= dt;
        if (st.bufferT <= 0) st.buffer = '';
        else if (combat.act(p, st.buffer, AO)) {
          // A buffered charge technique whose button is already up fires uncharged.
          if ((st.buffer === 'tech1' || st.buffer === 'tech2' || st.buffer === 'ultimate') && !inp.down(st.buffer)) combat.act(p, 'techRelease', AO);
          st.buffer = '';
        }
      }
    }
  }
}
