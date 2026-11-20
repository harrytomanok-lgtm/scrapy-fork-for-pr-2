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
import { REMATCH, TRIALS, TRIAL_REWARDS, TRIAL_LEASH, RINGSTONES } from './data/challenges.js';
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

  // ---- boss rematches
  for (const bossId of Object.keys(REMATCH.bosses)) {
    Q.registerScript('rematch_' + bossId, (c, api) => {
      const bd = c.defs.find('boss', bossId);
      const p = pl(c);
      if (!bd || !p || !c.ai || c.ai.boss) return api.done();
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
      c.ai.startBoss(bossId, { level });
      c.bus.emit('ui:toast', { key: 'rpg.toast.rematch', args: { level }, kind: 'warn' });
      let t = 0;
      api.onTick((dt) => {
        t += dt;
      });
      api.onEvent('boss:end', (e) => {
        if (e.bossId !== bossId) return;
        if (!e.defeated) return;
        const par = REMATCH.bosses[bossId];
        const s = Math.round(t * 10) / 10;
        const medal = s <= par.gold ? 'gold' : s <= par.silver ? 'silver' : 'bronze';
        recordMedal(c, 'rematch.' + bossId, s, medal, REMATCH.rewards);
        c.bus.emit('ui:banner', { kind: 'quest', key: 'rpg.medal.' + medal, args: { seconds: s } });
        api.done();
      });
      // A death ends the rematch here (the boss's own retry still offers another go).
      api.onEvent('player:died', () => api.done());
    });
  }

  // ---- trial fights: waves on Sela's Ledge, against the clock
  for (const trialId of Object.keys(TRIALS)) {
    const tr = TRIALS[trialId];
    if (tr.kind === 'race') {
      Q.registerScript(trialId, (c, api) => {
        const course = c.defs.find('course', tr.course);
        const p = pl(c);
        if (course && p) {
          const g0 = course.gates[0];
          const y = c.world.heightAt(course.start.x, course.start.z) + 30;
          c.move.teleport(p, course.start.x, y, course.start.z, Math.atan2(g0.x - course.start.x, g0.z - course.start.z));
          c.move.setMode(p, 'fly');
          if (c.cam) c.cam.setOrbit(Math.atan2(g0.x - course.start.x, g0.z - course.start.z), 0.1);
          host.raceStart(tr.course);
        }
        api.done();
      });
      continue;
    }
    Q.registerScript(trialId, (c, api) => {
      const p = pl(c);
      if (!p || !c.ai) return api.done();
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
      const spawnWave = () => {
        c.ai.spawnGroup(tr.waves[wave], at.x, at.z - 6, { level, questTag: tag, aggro: true, radius: 9 });
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
      api.onEvent('player:died', () => end(false));
      api.onTick((dt) => {
        if (over) return;
        t += dt;
        const e = pl(c);
        if (e && Math.hypot(e.pos.x - at.x, e.pos.z - at.z) > TRIAL_LEASH) return end(false);
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

  // ---- Ringstone travel (the menu's Travel choices; the map screen calls ctx.quests.travel directly)
  for (const id of RINGSTONES) Q.registerScript('travel_' + id, (c, api) => {
    api.done();
    host.travel('ringstone_' + id);
  });
}
