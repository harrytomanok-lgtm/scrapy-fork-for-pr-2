/**
 * Audio package scenarios (ARCHITECTURE 8.2 env-audio, env-audio-barrage). The harness runs these WITH audio:
 * the query removes `noaudio`, and a synthetic click on the page is the unlocking user gesture.
 */

const QUERY = 'noaudio=0';

/** Click the page (the user gesture), then wait for the context to run and the first buffers to render. */
async function unlock(page, game, assert) {
  await page.mouse.click(5, 5);
  await page.waitForFunction(() => {
    const a = /** @type {any} */ (window).__GAME__.ctx.audio;
    return a.ready && a.debug().state === 'running';
  }, null, { timeout: 30000, polling: 100 });
  // the priority sounds come first; wait until everything is rendered so later checks are stable
  await page.waitForFunction(() => /** @type {any} */ (window).__GAME__.ctx.audio.debug().pending === 0, null, { timeout: 120000, polling: 250 });
  const d = await game((g) => g.ctx.audio.debug());
  assert.equal(d.state, 'running', 'the AudioContext runs after the gesture');
  return d;
}

/** In the page: a full combat:hit payload at the player. */
function hitPayload(g, cls) {
  const p = g.ctx.player;
  return {
    attackerId: p.id, targetId: 0, techId: 'strike_string', class: cls, amount: 10, x: p.pos.x + 3, y: p.pos.y + 1, z: p.pos.z + 3,
    dirX: 0, dirZ: 1, blocked: false, perfect: false, crit: false,
  };
}

export const scenarios = [
  {
    name: 'audio-play',
    query: QUERY,
    async run({ page, game, assert }) {
      const before = await game((g) => ({ ready: g.ctx.audio.ready, nodes: g.ctx.audio.nodes(), owner: g.ctx.providers.audio }));
      assert.equal(before.owner, 'audio', 'the audio package provides ctx.audio');
      assert.equal(before.ready, false, 'no AudioContext before the first gesture');
      assert.equal(before.nodes, 0);
      await unlock(page, game, assert);
      const r = await game((g, hp) => {
        const f = (0, eval)('(' + hp + ')');
        const a = g.ctx.audio;
        g.ctx.bus.emit('combat:hit', f(g, 'lightHit'));
        g.ctx.bus.emit('combat:hit', f(g, 'heavyHit'));
        g.ctx.bus.emit('rpg:levelUp', { level: 2, statPoints: 3, tp: 1 });
        const v = a.voices();
        const ids = [a.play('ui_confirm'), a.play('bolt_fire', { x: g.ctx.player.pos.x, y: 1, z: g.ctx.player.pos.z + 10 })];
        return { voices: v, ids, nodes: a.nodes(), d: a.debug() };
      }, hitPayload.toString());
      assert.ok(r.voices > 0, 'combat:hit and rpg:levelUp start voices (' + r.voices + ')');
      assert.ok(r.ids[0] > 0 && r.ids[1] > 0, 'play returns voice ids');
      assert.ok(r.nodes <= 120, 'node budget (' + r.nodes + ')');
      // every id of the catalog plays (or is a live loop)
      const bad = await game((g) => {
        const a = g.ctx.audio;
        const out = [];
        for (const id of ['step_grass', 'step_stone', 'step_snow', 'step_water', 'jump', 'land', 'land_heavy', 'takeoff', 'flicker_out', 'flicker_in',
          'boost_start', 'sonic_boom', 'whoosh', 'hit_finisher', 'gather_full', 'bolt_hit', 'beam_charge', 'beam_end', 'nova', 'explosion_s',
          'explosion_m', 'explosion_l', 'rock_break', 'crater', 'ult_rise', 'ult_impact', 'guard_on', 'guard_block', 'perfect', 'transform_rise',
          'transform_burst', 'burnout', 'tele_white', 'tele_red', 'tele_violet', 'enemy_growl', 'enemy_death', 'boss_roar', 'player_hurt',
          'player_death', 'heal', 'xp_orb', 'pickup_item', 'shells', 'quest_start', 'quest_step', 'quest_complete', 'discover', 'ringstone',
          'shrine', 'chest_open', 'ring_gate', 'race_start', 'race_end', 'siphon_core', 'siphon_break', 'ui_move', 'ui_back', 'ui_error',
          'ui_open', 'ui_close', 'dialogue_tick']) {
          if (!a.play(id, { vol: 0.05 })) out.push(id);
        }
        return out;
      });
      assert.deepEqual(bad, [], 'every one-shot id plays');
      // live loops start, take a level, and stop
      const loops = await game((g) => {
        const a = g.ctx.audio;
        const ids = ['wind_loop', 'gather_loop', 'beam_loop', 'siphon_loop'].map((id) => a.loop(id, { vol: 0.2 }));
        for (const v of ids) a.setParam(v, 'level', 0.7);
        const n = a.nodes();
        for (const v of ids) a.stop(v, 0.05);
        return { ids, n };
      });
      assert.ok(loops.ids.every((v) => v > 0), 'all four live loops start: ' + loops.ids.join(','));
      assert.ok(loops.n <= 120, 'nodes with the loops running: ' + loops.n);
      // the frame system tears the stopped loops down and the one-shots end
      await page.waitForTimeout(2500);
      await game((g) => g.render());
      const after = await game((g) => ({ v: g.ctx.audio.debug(), s: g.stats() }));
      assert.ok(after.v.nodes <= 120, 'nodes settle: ' + after.v.nodes);
      assert.equal(typeof after.s.audioNodes, 'number');
    },
  },
  {
    name: 'audio-music',
    query: QUERY,
    async run({ page, game, assert }) {
      await unlock(page, game, assert);
      // exploration music plays by itself
      await page.waitForTimeout(4000);
      const e = await game((g) => g.ctx.audio.debug());
      assert.equal(e.music.mode, 'explore');
      assert.ok(e.music.bar > 0, 'the generator advances bars (' + e.music.bar + ')');
      await game((g) => g.ctx.audio.setMusic({ mode: 'combat', intensity: 3 }));
      await page.waitForFunction(() => /** @type {any} */ (window).__GAME__.ctx.audio.debug().music.mode === 'combat', null, { timeout: 8000, polling: 100 });
      await page.waitForTimeout(2500);
      const c = await game((g) => ({ d: g.ctx.audio.debug(), voices: g.ctx.audio.voices() }));
      assert.ok(c.d.musicVoices > 0 || c.voices > 0, 'combat music sounds (' + c.d.musicVoices + ' notes)');
      // stingers over the combat layer
      await game((g) => { g.ctx.audio.stinger('levelUp'); g.ctx.audio.stinger('transform'); g.ctx.audio.stinger('discover'); });
      await game((g) => g.ctx.audio.setMusic({ mode: 'explore' }));
      // the combat tail is 4 s and lands on a bar
      await page.waitForFunction(() => /** @type {any} */ (window).__GAME__.ctx.audio.debug().music.mode === 'explore', null, { timeout: 12000, polling: 100 });
      const x = await game((g) => g.ctx.audio.debug());
      assert.equal(x.music.mode, 'explore', 'back to exploration');
      assert.ok(x.nodes <= 120, 'node budget (' + x.nodes + ')');
      // boss and palettes
      await game((g) => g.ctx.audio.setMusic({ mode: 'boss', palette: 'cold' }));
      await page.waitForFunction(() => /** @type {any} */ (window).__GAME__.ctx.audio.debug().music.mode === 'boss', null, { timeout: 8000, polling: 100 });
      await game((g) => g.ctx.audio.setMusic({ mode: 'explore', palette: 'corrupted' }));
      await page.waitForTimeout(500);
      const pausedOk = await game((g) => { g.ctx.audio.setPaused(true); g.ctx.audio.setPaused(false); return true; });
      assert.ok(pausedOk);
    },
  },
  {
    name: 'audio-gameplay',
    query: QUERY,
    async run({ page, game, assert, shot }) {
      await unlock(page, game, assert);
      // walk (footsteps), jump, take off (wind loop), fly, land: the real event flow with audio on
      const r = await game((g) => {
        g.move(0, 1);
        g.step(90);
        g.render();
        g.press('jump');
        g.step(12);
        g.press('jump');
        g.step(6);
        g.hold('jump', true);
        g.step(60);
        g.hold('jump', false);
        g.move(0, 1);
        g.step(60);
        g.render();
        const flying = g.player().mode;
        const d = g.ctx.audio.debug();
        return { flying, voices: g.ctx.audio.voices(), nodes: d.nodes };
      });
      assert.equal(r.flying, 'fly');
      assert.ok(r.voices > 0, 'flight is audible (' + r.voices + ' voices)');
      assert.ok(r.nodes <= 120);
      await shot('audio-gameplay');
    },
  },
  {
    name: 'audio-barrage',
    query: QUERY,
    async run({ page, game, assert }) {
      await unlock(page, game, assert);
      // count oscillators created from here on: one-shots must never build one
      await game((g) => {
        const AC = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
        const proto = AC.prototype;
        const orig = proto.createOscillator;
        /** @type {any} */ (window).__oscCount = 0;
        proto.createOscillator = function () {
          /** @type {any} */ (window).__oscCount++;
          return orig.call(this);
        };
        g.god(true);
        g.setOra(9999);
        for (let i = 0; i < 4; i++) g.spawn('tusk_boar', { dist: 8 + i * 2, aggro: true });
      });
      let maxNodes = 0;
      let maxVoices = 0;
      const t0 = Date.now();
      let i = 0;
      // 10 s of real time and at least 25 bursts (a loaded machine renders slowly), capped at 60 s.
      while ((Date.now() - t0 < 10000 || i < 25) && Date.now() - t0 < 60000) {
        const s = await game((g, hp, k) => {
          const f = (0, eval)('(' + hp + ')');
          g.setOra(9999);
          g.press('bolt');
          g.step(4);
          const b = g.ctx.bus;
          const p = g.ctx.player;
          for (let j = 0; j < 3; j++) b.emit('combat:hit', f(g, j === 0 ? 'boltHit' : j === 1 ? 'lightHit' : 'heavyHit'));
          b.emit('pickup:collected', { kind: 'xp', itemId: null, amount: 1 });
          if (k % 5 === 0) b.emit('world:crater', { x: p.pos.x + 12, y: p.pos.y, z: p.pos.z, radius: 6, depth: 2, deformed: true, sourceId: p.id });
          if (k % 7 === 0) b.emit('rpg:levelUp', { level: 3, statPoints: 3, tp: 1 });
          g.render();
          return { n: g.ctx.audio.nodes(), v: g.ctx.audio.voices() };
        }, hitPayload.toString(), i++);
        maxNodes = Math.max(maxNodes, s.n);
        maxVoices = Math.max(maxVoices, s.v);
        await page.waitForTimeout(40);
      }
      const osc = await page.evaluate(() => /** @type {any} */ (window).__oscCount);
      assert.ok(i > 20, 'the barrage ran (' + i + ' bursts)');
      assert.ok(maxVoices > 4, 'the barrage is audible (max ' + maxVoices + ' voices)');
      assert.ok(maxNodes <= 120, 'at most 120 live audio nodes (max ' + maxNodes + ')');
      assert.equal(osc, 0, 'no oscillator was created for a one-shot');
      console.log('  barrage: ' + i + ' bursts, max nodes ' + maxNodes + ', max voices ' + maxVoices);
    },
  },
  {
    // Ambience beds: the bed follows the region (and the shore), the critters sound around the listener, and the
    // master output stays within the node budget.
    name: 'audio-ambience',
    query: QUERY,
    async run({ page, game, assert }) {
      await unlock(page, game, assert);
      const bedAt = async (x, z) => {
        await game((g, p) => { g.god(true); g.ai(false); g.teleport(p.x, p.z, {}); g.step(4); }, { x, z });
        await page.waitForFunction(() => {
          const pl = /** @type {any} */ (window).__GAME__.ctx.audio.debug().place;
          return pl && pl.bed !== '';
        }, null, { timeout: 30000, polling: 200 }).catch(() => {});
        // the bed check runs at 1 Hz of frame time: render frames until it settles
        let last = '';
        for (let i = 0; i < 6; i++) {
          last = await game((g) => { g.step(2); g.render(); return g.ctx.audio.debug().place.bed; });
          await page.waitForTimeout(400);
        }
        return game((g) => ({ bed: g.ctx.audio.debug().place.bed, region: g.ctx.world.regionAt(g.ctx.player.pos.x, g.ctx.player.pos.z), nodes: g.ctx.audio.nodes(), last }));
      };
      const storm = await bedAt(2000, -1700);
      assert.equal(storm.region, 'stormwell');
      assert.equal(storm.bed, 'hum', 'the Stormwell hums');
      const frost = await bedAt(-400, -2300);
      assert.equal(frost.bed, 'wind', 'wind in the Frostspine');
      const meadow = await bedAt(-1300, 1400);
      assert.equal(meadow.bed, 'meadow', 'the meadows');
      assert.ok(meadow.nodes <= 120, 'node budget (' + meadow.nodes + ')');
      console.log('    beds: ' + JSON.stringify({ storm, frost, meadow }));
    },
  },
  {
    // Place audio: the Siphon drone starts near a standing Siphon and stops when it is silenced or far; the
    // corrupted palette plays near standing Siphons and at Choir camps (ART_UX 9.3).
    name: 'audio-siphon-camp',
    query: QUERY,
    async run({ page, game, assert }) {
      await unlock(page, game, assert);
      const where = await game((g) => {
        g.god(true);
        g.ai(false);
        const s = g.ctx.world.pois('siphon')[0];
        const camps = g.ctx.world.pois('camp');
        const choir = camps.find((c) => {
          const t = g.ctx.defs.has('spawnTable', c.regionId) ? g.ctx.defs.get('spawnTable', c.regionId) : null;
          const rows = t && t.camps ? t.camps.filter((r) => r.tier === c.data.tier) : [];
          if (!rows.some((r) => r.group.indexOf('camp_choir') === 0)) return false;
          // far from every Siphon, so only the camp can turn the music corrupted
          return g.ctx.world.pois('siphon').every((q) => Math.hypot(q.x - c.x, q.z - c.z) > 450);
        });
        g.teleport(s.x + 40, s.z + 30, {});
        g.step(4);
        return { siphon: { id: s.id, x: s.x, z: s.z }, camp: choir ? { id: choir.id, x: choir.x, z: choir.z } : null };
      });
      // The place check runs at 1 Hz of frame time (frames are slow here): poll until it reflects the new spot.
      const place = async (key, want) => {
        await page.waitForFunction(({ k, w }) => {
          const pl = /** @type {any} */ (window).__GAME__.ctx.audio.debug().place;
          return pl && pl[k] === w;
        }, { k: key, w: want }, { timeout: 30000, polling: 200 }).catch(() => {});
        return game((g) => g.ctx.audio.debug().place);
      };
      const near = await place('siphonLoop', true);
      assert.equal(near.nearSiphon, where.siphon.id, 'the nearest standing Siphon is found');
      assert.equal(near.palette, 'corrupted', 'corrupted music near a standing Siphon');
      assert.ok(near.siphonLoop, 'the Siphon drone plays near a standing Siphon');
      const zone = await game((g) => { g.step(20); return g.ctx.rpg.inSiphonZone; });
      assert.equal(zone, true, 'rpg reports the Siphon zone within 80 m');
      // Silenced: the drone stops and the music leaves the corrupted palette.
      await game((g, id) => {
        g.ctx.bus.emit('siphon:state', { id, state: 'destroyed', regionId: '' });
        g.step(2);
      }, where.siphon.id);
      const down = await place('siphonLoop', false);
      assert.equal(down.siphonLoop, false, 'the drone stops when the Siphon is silenced');
      assert.notEqual(down.nearSiphon, where.siphon.id, 'a silenced Siphon no longer counts');
      assert.ok(where.camp, 'a Choir camp exists away from the Siphons');
      await game((g, c) => {
        g.teleport(c.x + 30, c.z, {});
        g.step(4);
      }, where.camp);
      const camp = await place('nearCamp', where.camp ? where.camp.id : '');
      assert.equal(camp.nearCamp, where.camp.id, 'the Choir camp is found');
      assert.equal(camp.palette, 'corrupted', 'corrupted music at a Choir camp');
      await game((g, c) => {
        g.teleport(c.x + 600, c.z + 600, {});
        g.step(4);
      }, where.camp);
      const far = await place('nearCamp', '');
      assert.equal(far.siphonLoop, false, 'no drone far from Siphons');
      console.log('    place: ' + JSON.stringify({ near, down, camp, far }));
    },
  },
];
