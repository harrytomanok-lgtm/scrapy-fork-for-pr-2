/**
 * Quest scripts (ARCHITECTURE 4.12; GDD 2 and 8.2): the MQ1 tutorial beats and the Ora Awakening, the MQ2 story
 * beats, the finale tether-carrying script `finale_tethers` (Zenith) and the `ending`. Scripts are state machines
 * driven by `api.onTick` (sim time), so they behave the same at any frame rate and under `__GAME__.step(n)`.
 * @module rpg/scripts
 */

import { BALANCE } from '../core/balance.js';
import { TAG } from '../core/ents.js';
import { PALETTE } from '../core/palette.js';

const POST = { x: -1645, z: 1852 };
const RING_RADIUS = 8;
const SPIRE_REACH = 25;
/** MQ1 wisps: the Ora never drops below two bolts (BALANCE.techniques.ora_bolt.ora is 6). */
const TUT_ORA_FLOOR = 12;
/** MQ4: where the Choir waves gather on the Tide Beacon headland, and the latest second wave (s). */
const WAVE_AT = { x: 185, z: 2900 };
const WAVE_SECONDS = 20;

/** @param {any} ctx */
const pl = (ctx) => (ctx.player && ctx.player.alive ? ctx.player : null);

/** @param {any} ctx @param {string} action @param {string} key  an untracked prompt that survives the step change */
function hint(ctx, action, key) {
  ctx.bus.emit('tutorial:prompt', { action, textKey: key });
}

/**
 * A line of rings ahead of the player. Returns the ring list; `api.spawnProp` disposes the props with the step.
 * @param {any} ctx @param {any} api @param {number} n @param {number} spacing @param {number} startAlt @param {number} climb
 */
function ringLine(ctx, api, n, spacing, startAlt, climb) {
  const p = pl(ctx);
  const yaw = p ? p.yaw : 0;
  const ox = p ? p.pos.x : POST.x;
  const oz = p ? p.pos.z : POST.z;
  const rings = [];
  for (let i = 0; i < n; i++) {
    const d = 30 + i * spacing;
    const x = ox + Math.sin(yaw) * d;
    const z = oz + Math.cos(yaw) * d;
    const y = ctx.world.heightAt(x, z) + startAlt + i * climb;
    const h = api.spawnProp('ringGate', x, y, z, { state: i === 0 ? 'next' : 'idle', yaw, scale: 1.4 });
    rings.push({ x, y, z, h, done: false });
  }
  return rings;
}

/** Advance a ring line: returns the number passed. */
function passRings(ctx, rings) {
  const p = pl(ctx);
  let n = 0;
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i];
    if (!r.done && p && n === i) {
      const dx = p.pos.x - r.x;
      const dy = p.pos.y + 1 - r.y;
      const dz = p.pos.z - r.z;
      if (dx * dx + dy * dy + dz * dz <= RING_RADIUS * RING_RADIUS) {
        r.done = true;
        if (r.h) r.h.setState('passed');
        if (rings[i + 1] && rings[i + 1].h) rings[i + 1].h.setState('next');
        ctx.bus.emit('race:gate', { courseId: 'tutorial', index: i + 1, total: rings.length });
      }
    }
    if (r.done) n++;
  }
  return n;
}

/** Spawn `n` enemies on an arc ahead of the player. */
function spawnArc(ctx, enemyId, n, dist, alt, opts) {
  const p = pl(ctx);
  if (!p || !ctx.ai) return;
  for (let i = 0; i < n; i++) {
    const a = p.yaw + (i - (n - 1) / 2) * 0.35;
    const x = p.pos.x + Math.sin(a) * dist;
    const z = p.pos.z + Math.cos(a) * dist;
    ctx.ai.spawn(enemyId, x, ctx.world.heightAt(x, z) + alt, z, opts);
  }
}

/**
 * Register every script on the quests service.
 * @param {any} ctx
 */
export function registerScripts(ctx) {
  const Q = ctx.quests;

  // MQ1 step 1: walk to the post.
  Q.registerScript('tut_move', (c, api) => {
    // A player who has finished MQ1 in an earlier journey is offered to skip the training (the offer's Skip choice
    // runs the skipTutorial action); otherwise Sela's two opening lines.
    if (!api.resumed) {
      if (c.store.state.quests.flags['tut.skipOffer']) {
        delete c.store.state.quests.flags['tut.skipOffer'];
        api.say('mq1_skip');
      } else api.say('mq1_post');
    }
    api.prompt('move', 'rpg.tut.move');
    api.onTick(() => {
      const p = pl(c);
      if (!p) return;
      const dx = p.pos.x - POST.x;
      const dz = p.pos.z - POST.z;
      if (dx * dx + dz * dz < 25) {
        api.clearPrompt();
        api.done();
        hint(c, 'attack', 'rpg.tut.attack');
        api.bark('mq1_post_hit');
      }
    });
  });

  // MQ1 step 3: the Siphon fires, the Ora wakes; jump, take off, three rings.
  Q.registerScript('tut_fly', (c, api) => {
    const p = pl(c);
    c.store.state.player.canFly = true;
    if (p) c.move.setCanFly(p, true);
    if (!api.resumed) {
      if (c.cam) c.cam.shake(0.5);
      api.say('mq1_wake');
    }
    api.prompt('jump', 'rpg.tut.jump');
    const rings = ringLine(c, api, 3, 35, 14, 6);
    let flying = false;
    api.setObjective('rpg.tut.rings', { count: 0, need: 3 });
    api.onTick(() => {
      const e = pl(c);
      if (!e) return;
      if (!flying && e.move && e.move.mode === 'air') api.prompt('jump', 'rpg.tut.fly');
      if (!flying && e.move && e.move.mode === 'fly') {
        flying = true;
        api.clearPrompt();
        api.bark('mq1_rings');
      }
      const n = passRings(c, rings);
      api.setObjective('rpg.tut.rings', { count: n, need: 3 });
      if (n >= rings.length) api.done();
    });
  });

  // MQ1 step 4: boost through a longer ring line.
  Q.registerScript('tut_boost', (c, api) => {
    api.prompt('dash', 'rpg.tut.boost');
    const rings = ringLine(c, api, 5, 70, 18, 2);
    api.setObjective('rpg.tut.rings', { count: 0, need: rings.length });
    api.onTick(() => {
      const n = passRings(c, rings);
      api.setObjective('rpg.tut.rings', { count: n, need: rings.length });
      if (n >= rings.length) api.done();
    });
  });

  // MQ1 step 5 (free script): four wisps drift in; bolt them.
  // A wisp that bursts in its own dive (or dies any other way not by the player's hand) does not count toward the
  // kill step, so a replacement drifts in: the step can always be finished.
  Q.registerScript('mq1_wisps', (c, api) => {
    if (!api.resumed) api.bark('mq1_wisps');
    // After a load inside the step only the wisps it still needs drift in (around the Ringstone the load puts the player at).
    spawnArc(c, 'ember_wisp', api.resumed && api.left >= 0 ? api.left : 4, 28, 10, { aggro: true, level: 1, questTag: 'mq1_wisps' });
    hint(c, 'bolt', 'rpg.tut.bolt');
    let owed = 0;
    api.onEvent('actor:died', (p) => {
      if (p.questTag !== 'mq1_wisps' || p.kind !== 'enemy') return;
      const me = pl(c);
      if (!me || p.sourceId !== me.id) owed++;
    });
    // Gather is taught only in the next beat, so the Ora for the bolts never runs dry here (boosting through the
    // ring line spends it and stops regen): full at the start, then a floor of two bolts.
    const me0 = pl(c);
    if (me0 && me0.stats) c.combat.addOra(me0, me0.stats.oraMax);
    api.onTick(() => {
      const me = pl(c);
      if (me && me.stats && me.stats.ora < TUT_ORA_FLOOR) c.combat.addOra(me, TUT_ORA_FLOOR - me.stats.ora);
    });
    // Spawned from the script phase, not inside the death callback.
    api.onTick(() => {
      if (owed <= 0 || !pl(c)) return;
      owed--;
      spawnArc(c, 'ember_wisp', 1, 26, 10, { aggro: true, level: 1, questTag: 'mq1_wisps' });
    });
    api.onEvent('quest:step', (p) => {
      if (p.questId === 'mq1') api.done();
    });
  });

  // MQ1 step 6: Gather to full Ora -> the scripted Ora Awakening burst.
  Q.registerScript('tut_awakening', (c, api) => {
    c.rpg.unlockTech('gather');
    if (!api.resumed) api.bark('mq1_gather');
    spawnArc(c, 'ember_wisp', 6, 30, 12, { aggro: false, level: 1, questTag: 'mq1_awake' });
    api.prompt('gather', 'rpg.tut.gather');
    let t = -1;
    api.onTick((dt) => {
      const p = pl(c);
      if (!p || !p.combat) return;
      if (t < 0) {
        if ((p.combat.gathering || p.combat.state === 'gather') && p.stats.ora >= p.stats.oraMax - 0.5) {
          t = 0;
          api.clearPrompt();
          c.time.slowMo(0.3, 1.5);
          c.rpg.awaken();
          if (c.vfx) c.vfx.shockwave(p.pos.x, p.pos.y + 1, p.pos.z, { radius: 45, color: PALETTE.ora, seconds: 1.4, sphere: true });
          if (c.cam) c.cam.shake(0.8);
          c.bus.emit('ui:banner', { kind: 'resonance', key: 'rpg.banner.awakening', args: null });
        }
        return;
      }
      t += dt;
      if (t >= 1.5) {
        for (const e of c.ents.list('enemy')) if (e.alive && e.questTag === 'mq1_awake') c.combat.kill(e, 0);
        api.bark('mq1_awake');
        api.done();
      }
    });
  });

  // MQ1 step 7 (free script): two boars charge; the first red telegraph slows time.
  Q.registerScript('mq1_boars', (c, api) => {
    if (!api.resumed) api.bark('mq1_boars');
    spawnArc(c, 'tusk_boar', api.resumed && api.left >= 0 ? api.left : 2, 18, 0, { aggro: true, level: 1, questTag: 'mq1_boars' });
    // The Awakening often leaves the player in the air: the boars are on the ground, so first teach landing.
    const lockHint = () => hint(c, 'lock', c.input && c.input.device === 'touch' ? 'rpg.tut.lockTap' : 'rpg.tut.lock');
    const me = pl(c);
    let landing = !!(me && me.move && me.move.mode === 'fly');
    if (landing) hint(c, 'descend', 'rpg.tut.land');
    else lockHint();
    let locked = false;
    api.onTick(() => {
      const e = pl(c);
      if (!e || !e.move) return;
      if (landing && e.move.mode !== 'fly') {
        landing = false;
        lockHint();
      }
      if (!locked && !landing && c.combat && c.combat.target() > 0) {
        locked = true;
        hint(c, 'attack', 'rpg.tut.heavy');
      }
    });
    let slowed = false;
    api.onEvent('combat:telegraph', (p) => {
      if (slowed || p.kind !== 'red') return;
      const e = c.ents.get(p.entId);
      if (!e || e.questTag !== 'mq1_boars') return;
      slowed = true;
      c.time.slowMo(0.3, 1);
      hint(c, 'dash', 'rpg.tut.flicker');
    });
    api.onEvent('quest:step', (p) => {
      if (p.questId !== 'mq1') return;
      hint(c, null, null);
      api.done();
    });
  });

  // Story beats (free scripts): the line plays once, not again after a load inside the step.
  // MQ1's last beat is said on the way (the flight home is the reward for the fight): a bark, no stop.
  Q.registerScript('mq1_home', (c, api) => {
    if (!api.resumed) api.bark('mq1_home');
    api.done();
  });
  for (const id of ['mq2_raid', 'mq2_durn', 'mq2_siphon']) {
    Q.registerScript(id, (c, api) => {
      if (!api.resumed) api.say(id);
      api.done();
    });
  }

  // MQ4 step 3 (free script): the Choir answers the Dawn Lance in two waves of four (the mq4_wave group, split
  // alternately so each wave mixes Acolytes and Casters). The second wave comes when the first is down to one, or
  // after 20 s near the beacon. After a load only the kills the step still needs come back.
  Q.registerScript('mq4_wave', (c, api) => {
    const g = c.defs.find('group', 'mq4_wave');
    if (!g || !c.ai) return api.done();
    const list = [];
    for (const m of g.members) for (let k = 0; k < m.count; k++) list.push(m.enemy);
    const waveA = [];
    const waveB = [];
    for (let i = 0; i < list.length; i++) (i % 2 === 0 ? waveA : waveB).push(list[i]);
    const left = api.resumed && api.left >= 0 ? Math.min(api.left, list.length) : list.length;
    // On a resume, the kills already made come off the first wave, then off the second.
    const firstN = Math.max(0, left - waveB.length);
    const secondN = Math.min(waveB.length, left);
    const at = { x: 0, y: 0, z: 0 };
    const spawnWave = (wave, n, from) => {
      for (let i = 0; i < n; i++) {
        const id = wave[wave.length - n + i];
        const a = from + (i / Math.max(1, n)) * Math.PI * 2;
        let x = WAVE_AT.x + Math.sin(a) * 9;
        let z = WAVE_AT.z + Math.cos(a) * 9;
        if (c.world.findSpot && c.world.findSpot(x, z, 6, at, {})) { x = at.x; z = at.z; }
        c.ai.spawn(id, x, c.world.heightAt(x, z), z, { aggro: true, questTag: 'mq4_wave' });
      }
    };
    let second = secondN > 0;
    if (firstN > 0) spawnWave(waveA, firstN, 0.4);
    else if (second) {
      spawnWave(waveB, secondN, 1.2);
      second = false;
    }
    let t = 0;
    api.onTick((dt) => {
      if (!second) return;
      const p = pl(c);
      if (!p) return;
      const dx = p.pos.x - WAVE_AT.x;
      const dz = p.pos.z - WAVE_AT.z;
      if (dx * dx + dz * dz < 250 * 250) t += dt;
      let alive = 0;
      const enemies = c.ents.list('enemy');
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (e.alive && e.questTag === 'mq4_wave' && (!e.combat || e.combat.state !== 'dead')) alive++;
      }
      if (alive > 1 && t < WAVE_SECONDS) return;
      second = false;
      spawnWave(waveB, secondN, 1.2);
      c.bus.emit('ui:toast', { key: 'rpg.toast.wave', args: null, kind: 'warn' });
    });
    api.onEvent('quest:step', (p) => {
      if (p.questId === 'mq4') api.done();
    });
  });

  // MQ7 step 4: the Spire relights, the credits card.
  Q.registerScript('ending', (c, api) => {
    const p = pl(c);
    if (c.vfx) c.vfx.shockwave(0, c.world.heightAt(0, 0) + 40, 0, { radius: 400, color: PALETTE.ora, seconds: 3, sphere: true });
    if (c.env) c.env.setHour(BALANCE.time.dayStart);
    if (p && p.stats) {
      c.combat.heal(p, p.stats.hpMax);
      c.combat.addOra(p, p.stats.oraMax);
    }
    c.rpg.setFlag('ending', true);
    // The credits card (nothing else opens the ui 'ending' screen) opens a moment after the last line, once the
    // dialogue screen has closed; free roam resumes when it is closed.
    api.say('mq7_ending').then(() => api.wait(0.3)).then(() => {
      if (c.ui) c.ui.open('ending', {});
      c.bus.emit('ui:banner', { kind: 'quest', key: 'rpg.banner.freeRoam', args: null });
      api.done();
    });
  });

  // The finale: one thread per silenced Siphon; carry each to the Spire base; Zenith after the last.
  Q.registerScript('finale_tethers', (c, api) => {
    const p = pl(c);
    if (!p) return api.done();
    let boss = null;
    for (const e of c.ents.list('boss')) if (e.alive && (!boss || e.defId === 'vorrhal')) boss = e;
    const bossId = boss ? boss.id : 0;
    if (boss) boss.tags |= TAG.SCRIPTED | TAG.INVULNERABLE;
    if (p.stats) c.combat.addOra(p, -p.stats.ora);
    const silenced = c.store.state.world.siphons;
    const total = Math.min(5, silenced.length);
    const anchors = [];
    let carrying = -1;
    let beam = null;
    let delivered = 0;
    const setObj = () => api.setObjective('quest.mq7.tether', { count: delivered, need: total }, 'mq7');

    const release = () => {
      const b = bossId ? c.ents.get(bossId) : null;
      if (b) b.tags &= ~(TAG.SCRIPTED | TAG.INVULNERABLE);
    };
    const finish = () => {
      const e = pl(c);
      if (e) {
        c.combat.setForm(e, 'zenith', { scripted: true });
        c.combat.addOra(e, e.stats.oraMax);
      }
      release();
      api.say('mq7_zenith');
      api.done();
    };
    api.cleanup(() => {
      if (beam && typeof beam.end === 'function') beam.end(0.2);
      beam = null;
      for (const a of anchors) c.quests.removeInteractable(a.id);
    });
    if (total === 0) return finish();
    api.say('mq7_tethers');
    for (let i = 0; i < total; i++) {
      const def = c.defs.find('object', 'tether_' + (i + 1));
      if (!def) continue;
      const y = c.world.heightAt(def.x, def.z);
      const a = { id: def.id, x: def.x, y, z: def.z, h: api.spawnProp('lightPillar', def.x, y, def.z, { state: 'on', color: PALETTE.ora }), done: false };
      anchors.push(a);
      c.quests.addInteractable({ id: def.id, kind: 'object', x: def.x, y: y + 1, z: def.z, radius: 6, promptKey: def.promptKey || 'rpg.prompt.tether',
        onUse: () => {
          if (carrying >= 0 || a.done) return;
          carrying = anchors.indexOf(a);
          c.quests.setInteractable(a.id, false);
          if (a.h) a.h.setState('off');
          beam = c.vfx && c.vfx.beam ? c.vfx.beam({ color: PALETTE.ora, radius: 0.25, ownerId: p.id }) : null;
        } });
    }
    setObj();
    api.onTick(() => {
      const e = pl(c);
      if (!e || carrying < 0) return;
      const a = anchors[carrying];
      if (beam && typeof beam.set === 'function') beam.set(a.x, a.y + 2, a.z, e.pos.x, e.pos.y + 1.2, e.pos.z, 0.25, 1);
      if (e.pos.x * e.pos.x + e.pos.z * e.pos.z > SPIRE_REACH * SPIRE_REACH) return;
      a.done = true;
      carrying = -1;
      delivered++;
      if (beam && typeof beam.end === 'function') beam.end(0.4);
      beam = null;
      c.combat.addOra(e, e.stats.oraMax);
      if (c.vfx) c.vfx.shockwave(0, e.pos.y, 0, { radius: 30, color: PALETTE.ora, seconds: 0.8 });
      c.bus.emit('ui:toast', { key: 'rpg.toast.tether', args: { n: delivered, total }, kind: 'good' });
      setObj();
      if (delivered >= total) finish();
    });
  });
}
