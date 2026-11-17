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

/**
 * @param {any} ctx
 * @param {{ combat:any }} engine
 * @returns {any} the system
 */
export function createPlayerDriver(ctx, engine) {
  const AO = { dirX: 0, dirZ: 0, targetId: undefined };
  const st = { heavyArmed: false, heavyStarted: false, buffer: '', bufferT: 0, entId: 0, guardByInput: false, gatherByInput: false };

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

  return {
    id: 'combat.player',
    phase: 'intent',
    order: 10,
    /** @param {any} c @param {number} dt */
    step(c, dt) {
      const p = c.player;
      if (!p || !p.alive || !p.combat) return;
      if (st.entId !== p.id) {
        st.entId = p.id; st.heavyArmed = false; st.heavyStarted = false; st.buffer = '';
      }
      const inp = c.input;
      const combat = engine.combat;
      AO.dirX = 0; AO.dirZ = 0; AO.targetId = undefined;
      if (inp.pressed('lock')) combat.setTarget(combat.target() ? 0 : combat.softTarget());
      if (inp.pressed('lockNext')) combat.cycleTarget(1);
      if (inp.pressed('lockPrev')) combat.cycleTarget(-1);

      // Dash press -> Flicker (or Pursuit) at once, before anything else this tick.
      if (inp.pressed('dash')) {
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
      if (inp.pressed('attack')) {
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
      if (inp.down('bolt') || inp.pressed('bolt')) combat.act(p, 'bolt', AO);

      // Guard and Gather are holds; they resume when the action that interrupted them ends.
      if (inp.pressed('guard') || (inp.down('guard') && p.combat.state === 'idle')) {
        if (combat.act(p, 'guardOn', AO)) st.guardByInput = true;
      }
      if (inp.released('guard') || (st.guardByInput && !inp.down('guard') && p.combat.guarding)) {
        combat.act(p, 'guardOff', AO);
        st.guardByInput = false;
      }
      if (inp.pressed('gather') || (inp.down('gather') && p.combat.state === 'idle' && !p.combat.guarding)) {
        if (combat.act(p, 'gatherOn', AO)) st.gatherByInput = true;
      }
      if (inp.released('gather') || (st.gatherByInput && !inp.down('gather') && p.combat.gathering)) {
        combat.act(p, 'gatherOff', AO);
        st.gatherByInput = false;
      }

      if (inp.pressed('tech1')) tryAct(p, 'tech1');
      if (inp.pressed('tech2')) tryAct(p, 'tech2');
      if (inp.released('tech1') || inp.released('tech2')) combat.act(p, 'techRelease', AO);
      if (inp.pressed('ultimate')) tryAct(p, 'ultimate');
      if (inp.pressed('form')) combat.act(p, 'form', AO);
      if (inp.pressed('formNext') && c.rpg && c.rpg.forms) {
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
    },
  };
}
