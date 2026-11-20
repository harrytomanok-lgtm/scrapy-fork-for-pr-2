/**
 * Reasons to keep playing after the ending, started from any Ringstone's menu (dialogue `ringstone_menu`): boss
 * rematches at a level above the player's, and three trials (a timed fight and a wave survival on Sela's Ledge, the
 * Spire Circuit flight course), each with bronze, silver and gold. Records and medals live in quest flags
 * (`rematch.<bossId>`, `trial.<trialId>`: { best, medals }), so they are saved with the journey. Also the Ringstone
 * travel of the same menu. Scripts run in sim time and are torn down with the journey.
 * @module rpg/challenges
 */

import { BALANCE } from '../core/balance.js';
import { PALETTE } from '../core/palette.js';
import { REMATCH, TRIALS, TRIAL_REWARDS, TRIAL_LEASH, TRIAL_SPAWN_WAIT, RINGSTONES } from './data/challenges.js';
import { medalFor } from './logic/activity.js';

const ORDER = ['bronze', 'silver', 'gold'];

/** @param {any} ctx */
const pl = (ctx) => (ctx.player && ctx.player.alive ? ctx.player : null);

/**
 * Keep the best time and pay each medal the first time it is won. Returns the record.
 * @param {any} ctx @param {string} key flag key @param {number} seconds @param {string} medal @param {Record<string, number>} rewards
 */
export function recordMedal(ctx, key, seconds, medal, rewards) {
  const f = ctx.store.state.quests.flags;
  const rec = f[key] && typeof f[key] === 'object' ? f[key] : (f[key] = { best: 0, medals: [] });
  if (!rec.best || seconds < rec.best) rec.best = seconds;
  const upTo = ORDER.indexOf(medal);
  let paid = 0;
  for (let i = 0; i <= upTo; i++) {
    if (rec.medals.indexOf(ORDER[i]) >= 0) continue;
    rec.medals.push(ORDER[i]);
    paid += rewards[ORDER[i]] || 0;
  }
  if (paid > 0) ctx.rpg.addShells(paid, 'challenge');
  return rec;
}

/**
 * Register the challenge scripts on the quests service.
 * @param {any} ctx @param {{ travel:(id:string)=>boolean, raceStart:(id:string)=>boolean }} host
 */
export function registerChallenges(ctx, host) {
  const Q = ctx.quests;
  /** The running rematch (rpg reads it for the kill's reward): its boss, and whether it is the first clear. */
  const rematch = { bossId: '', first: false };
  /** The activity that another one cancels when it starts (a rematch). */
  const active = { cancel: /** @type {null|(() => void)} */ (null) };
  const cancelActive = () => {
    const f = active.cancel;
    active.cancel = null;
    if (f) f();
  };
  /** The trial fight the player just died in (its Retry runs it again), until another respawn. */
  const lastTrial = { id: '' };

  // ---- boss rematches
  for (const bossId of Object.keys(REMATCH.bosses)) {
    Q.registerScript('rematch_' + bossId, (c, api) => {
      const bd = c.defs.find('boss', bossId);
      const p = pl(c);
      if (!bd || !p || !c.ai) return api.done();
      if (c.ai.boss) {
        c.bus.emit('ui:toast', { key: 'rpg.toast.busyBoss', args: null, kind: 'warn' });
        return api.done();
      }
      if (c.store.state.world.bosses.indexOf(bossId) < 0) return api.done();
      cancelActive();
      const level = Math.min(REMATCH.levelCap, Math.max(bd.level, c.rpg.level) + REMATCH.levelAbove);
      const lm = c.world.landmark(bd.arena.landmarkId);
      if (lm) {
        const x = lm.x + bd.arena.retry.dx;
        const z = lm.z + bd.arena.retry.dz;
        c.move.teleport(p, x, c.world.heightAt(x, z), z, Math.atan2(lm.x - x, lm.z - z));
        c.move.setMode(p, 'ground');
      }
      c.combat.heal(p, p.stats.hpMax);
      c.combat.addOra(p, p.stats.oraMax);
      rematch.bossId = bossId;
      rematch.first = !(c.store.state.quests.flags['rematch.' + bossId]);
      c.ai.startBoss(bossId, { level });
      c.bus.emit('ui:toast', { key: 'rpg.toast.rematch', args: { level }, kind: 'warn' });
      // One attempt: a death waits for the death screen. Retry restarts the fight and the clock; Rise, leaving the
      // arena, travelling or starting another activity cancels it for good (the boss is not left pending).
      let t = 0;
      let down = false;
      let over = false;
      const cancel = () => {
        if (over) return;
        over = true;
        if (c.ai) c.ai.cancelBoss(bossId);
        api.done();
      };
      api.cleanup(() => {
        if (!over) {
          over = true;
          if (c.ai) c.ai.cancelBoss(bossId);
        }
        if (rematch.bossId === bossId) rematch.bossId = '';
        if (active.cancel === cancel) active.cancel = null;
      });
      active.cancel = cancel;
      api.onTick((dt) => {
        if (!down) t += dt;
      });
      api.onEvent('player:died', () => {
        down = true;
      });
      api.onEvent('player:respawned', (e) => {
        if (!down) return;
        down = false;
        if (e.retry) t = 0;
        else cancel();
      });
      api.onEvent('boss:end', (e) => {
        if (e.bossId !== bossId || over) return;
        if (!e.defeated) {
          // The fight was reset: by the player's death (Retry may follow), else the player left the arena.
          const me = c.player;
          if (down || !me || !me.alive || (me.combat && me.combat.state === 'dead')) {
            down = true;
            return;
          }
          cancel();
          return;
        }
        over = true;
        const par = REMATCH.bosses[bossId];
        const sec = Math.round(t * 10) / 10;
        const medal = sec <= par.gold ? 'gold' : sec <= par.silver ? 'silver' : 'bronze';
        recordMedal(c, 'rematch.' + bossId, sec, medal, REMATCH.rewards);
        c.bus.emit('ui:banner', { kind: 'quest', key: 'rpg.medal.' + medal, args: { seconds: sec } });
        // The script ends once the boss is down for good (Durn runs for a moment before he falls): the kill reads
        // rematch.first for its reward.
        api.wait(4).then(() => api.done());
      });
    });
  }

  // ---- trial fights: waves on Sela's Ledge, against the clock
  for (const trialId of Object.keys(TRIALS)) {
    const tr = TRIALS[trialId];
    if (tr.kind === 'race') {
      Q.registerScript(trialId, (c, api) => {
        cancelActive();
        const course = c.defs.find('course', tr.course);
        const p = pl(c);
        // The race starts first: when it is refused (a race already on) the player stays where they are.
        if (course && p && c.ai && c.ai.boss) c.bus.emit('ui:toast', { key: 'rpg.toast.busyBoss', args: null, kind: 'warn' });
        else if (course && p && !host.raceStart(tr.course)) c.bus.emit('ui:toast', { key: 'rpg.toast.busyRace', args: null, kind: 'warn' });
        else if (course && p) {
          const g0 = course.gates[0];
          const y = c.world.heightAt(course.start.x, course.start.z) + 30;
          c.move.teleport(p, course.start.x, y, course.start.z, Math.atan2(g0.x - course.start.x, g0.z - course.start.z));
          c.move.setMode(p, 'fly');
          if (c.cam) c.cam.setOrbit(Math.atan2(g0.x - course.start.x, g0.z - course.start.z), 0.1);
        }
        api.done();
      });
      continue;
    }
    Q.registerScript(trialId, (c, api) => {
      const p = pl(c);
      if (!p || !c.ai) return api.done();
      cancelActive();
      const at = tr.at;
      c.move.teleport(p, at.x, c.world.heightAt(at.x, at.z), at.z + 12, Math.PI);
      c.move.setMode(p, 'ground');
      c.combat.heal(p, p.stats.hpMax);
      c.combat.addOra(p, p.stats.oraMax);
      const tag = 'trial_' + trialId;
      const level = Math.min(BALANCE.level.cap, c.rpg.level + tr.levelAbove);
      let wave = 0;
      let t = 0;
      let over = false;
      /** Seconds a wave has failed to spawn (the cap of live enemies, no ground): retried, then the trial ends. */
      let stuck = -1;
      const spawnWave = () => {
        const ids = c.ai.spawnGroup(tr.waves[wave], at.x, at.z - 6, { level, questTag: tag, aggro: true, radius: 9 });
        if (!Array.isArray(ids) || ids.length === 0) {
          if (stuck < 0) stuck = 0;
          return;
        }
        stuck = -1;
        if (c.vfx) c.vfx.shockwave(at.x, c.world.heightAt(at.x, at.z) + 0.5, at.z - 6, { radius: 12, color: PALETTE.hostile, seconds: 0.6, ground: true });
        if (tr.waves.length > 1) c.bus.emit('ui:toast', { key: 'rpg.toast.trialWave', args: { n: wave + 1, total: tr.waves.length }, kind: 'warn' });
        else c.bus.emit('ui:toast', { key: 'rpg.toast.trialGo', args: null, kind: 'warn' });
      };
      const end = (won) => {
        if (over) return;
        over = true;
        const list = c.ents.list('enemy');
        for (let i = list.length - 1; i >= 0; i--) if (list[i].alive && list[i].questTag === tag) c.ai.despawn(list[i].id);
        if (won) {
          const s = Math.round(t * 10) / 10;
          const medal = medalFor(s, tr.medals);
          recordMedal(c, 'trial.' + trialId, s, medal === 'none' ? 'none' : medal, TRIAL_REWARDS);
          c.bus.emit('ui:banner', { kind: 'quest', key: medal === 'none' ? 'rpg.trial.done' : 'rpg.medal.' + medal, args: { seconds: s } });
        } else c.bus.emit('ui:toast', { key: 'rpg.toast.trialFailed', args: null, kind: 'warn' });
        api.done();
      };
      api.cleanup(() => {
        if (!over) {
          over = true;
          const list = c.ents.list('enemy');
          for (let i = list.length - 1; i >= 0; i--) if (list[i].alive && list[i].questTag === tag) c.ai.despawn(list[i].id);
        }
      });
      spawnWave();
      api.onEvent('player:died', () => {
        lastTrial.id = trialId;
        end(false);
      });
      api.onTick((dt) => {
        if (over) return;
        t += dt;
        const e = pl(c);
        if (e && Math.hypot(e.pos.x - at.x, e.pos.z - at.z) > TRIAL_LEASH) return end(false);
        if (stuck >= 0) {
          // A wave that did not spawn is not a cleared wave: try again twice a second, give up cleanly.
          stuck += dt;
          if (stuck > TRIAL_SPAWN_WAIT) return end(false);
          if (Math.floor(stuck * 2) !== Math.floor((stuck - dt) * 2)) spawnWave();
          return;
        }
        const list = c.ents.list('enemy');
        let alive = 0;
        for (let i = 0; i < list.length; i++) if (list[i].alive && list[i].questTag === tag && (!list[i].combat || list[i].combat.state !== 'dead')) alive++;
        if (alive > 0) return;
        wave++;
        if (wave >= tr.waves.length) end(true);
        else spawnWave();
      });
    });
  }

  // ---- Retry of a lost trial: the death screen's Retry (rpg.respawn retry) starts it again on the Ledge.
  const retry = {
    /** The running rematch: { bossId ('' when none), first } (rpg pays a repeat kill a share, see rpgService). */
    get rematch() {
      return rematch;
    },
    get available() {
      return lastTrial.id !== '';
    },
    /** Run the lost trial again; false when there is none. */
    run() {
      const id = lastTrial.id;
      lastTrial.id = '';
      if (!id) return false;
      ctx.quests.runActions([{ op: 'script', script: id }]);
      return true;
    },
    clear() {
      lastTrial.id = '';
    },
  };

  // ---- Ringstone travel (the menu's Travel choices; the map screen calls ctx.quests.travel directly)
  for (const id of RINGSTONES) Q.registerScript('travel_' + id, (c, api) => {
    api.done();
    host.travel('ringstone_' + id);
  });
  return retry;
}
