/**
 * actors scenarios (ARCHITECTURE 8.4): lineup, Forms, clips, locomotion, crowd.
 * Run with `node tools/scenarios.mjs actors [--only name]`. Screenshots go to tools/out/shots.
 * Display actors are spawned and framed in the page by the package's debug commands (actorsLineup, actorsStage).
 */

/** Boot state shared by every scenario: test journey running, AI and ambient spawns off, noon. */
async function opening(game, assert) {
  const p = await game((g) => g.player());
  assert.ok(p, 'the player exists after boot');
  await game((g) => {
    g.ai(false);
    g.ambient(false);
    g.setHour(12);
    g.killAll();
    g.step(2);
  });
  return p;
}

const HUMANS = ['hero_a', 'hero_b', 'npc_sela', 'npc_kerrin', 'npc_dov', 'npc_mira', 'npc_bren', 'npc_yael', 'npc_noa', 'npc_talia', 'npc_eli',
  'npc_oren', 'npc_ilan', 'npc_rina', 'npc_gal', 'npc_villager_1', 'npc_villager_2', 'npc_villager_3', 'npc_villager_4', 'npc_villager_5', 'npc_villager_6'];
const FOES = ['ember_wisp', 'tusk_boar', 'bramble_boar', 'choir_acolyte', 'choir_caster', 'scuttlecrab', 'rust_golem', 'frost_harrier', 'choir_vanguard'];
const BOSSES = ['durn', 'iskra', 'vorrhal', 'bramblehorn', 'gorrumaw'];

/** In the page: frame one display actor from its front three-quarter. */
function closeUp(g, id, dist, h, look) {
  const e = g.ctx.ents.get(id);
  const a = e.yaw + 0.3;
  g.cmd.actorsStage([e.pos.x + Math.sin(a) * dist, e.pos.y + h, e.pos.z + Math.cos(a) * dist], [e.pos.x, e.pos.y + look, e.pos.z]);
}

export const scenarios = [
  {
    name: 'actors-lineup',
    query: 'res=1',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const prog0 = await game((g) => g.stats().programs);
      const n = await game((g, ids) => {
        const out = g.cmd.actorsLineup({ ids, dist: 14, back: 12, up: 2.2, look: 1.0 });
        g.step(3);
        return out.filter((x) => x > 0).length;
      }, HUMANS);
      assert.equal(n, HUMANS.length, 'every humanoid spec spawned');
      await shot('actors-lineup-people');
      const info = await game((g) => g.cmd.actorsInfo());
      assert.equal(info.nan, 0, 'no NaN bone matrices');
      await game((g, ids) => { g.cmd.actorsLineup({ ids, dist: 12, back: 9, up: 2.4, look: 0.9 }); g.step(3); }, FOES);
      await shot('actors-lineup-enemies');
      await game((g, ids) => { g.cmd.actorsLineup({ ids, dist: 22, back: 22, up: 5, look: 2.6 }); g.step(3); }, BOSSES);
      await shot('actors-lineup-bosses');
      const all = await game((g) => {
        const out = g.cmd.actorsLineup({ dist: 30, back: 36, up: 7, look: 1.5 });
        g.step(3);
        return out.filter((x) => x > 0).length;
      });
      assert.equal(all, 35, 'all 35 specs in one row');
      await shot('actors-lineup-all');
      const s = await game((g) => g.stats());
      assert.equal(s.programs, prog0, 'no program linked by actors');
      await game((g, fn) => {
        const id = g.cmd.actorsLineup({ ids: ['hero_a'], dist: 4 })[0];
        new Function('g', 'id', fn)(g, id);
        g.step(3);
      }, `(${closeUp.toString()})(g, id, 2.4, 1.3, 1.05);`);
      await shot('actors-lineup-hero');
      console.log(`    programs ${s.programs}, draw calls ${s.drawCalls}, triangles ${s.triangles}`);
    },
  },
  {
    name: 'actors-forms',
    query: 'res=1',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const res = await game((g, fn) => {
        const ids = g.cmd.actorsLineup({ ids: ['hero_a', 'hero_a', 'hero_a', 'hero_a'], dist: 6, gap: 0.9, back: 4.2, up: 1.5, look: 1.0 });
        const forms = [null, 'ember', 'tempest', 'zenith'];
        ids.forEach((id, i) => g.cmd.actorsForm(id, forms[i]));
        g.step(20);
        return ids.map((id) => g.cmd.actorsPalette(id));
      }, '');
      const keep = ['coat', 'coatLining', 'trousers', 'boots', 'wraps', 'bronze', 'skin', 'hair', 'ink'];
      for (const k of keep) {
        assert.ok(res.every((p) => p[k] === res[0][k]), `slot ${k} is identical in base and every Form`);
      }
      assert.ok(res[1].seam !== res[0].seam || res[1].sash !== res[0].sash, 'Ember changes seams or sash');
      assert.notEqual(res[1].eye, res[0].eye, 'Ember irises take the Form colour');
      assert.notEqual(res[2].eye, res[0].eye, 'Tempest irises take the Form colour');
      const tris = await game((g) => g.cmd.actorsInfo().actors.map((a) => a.tris));
      assert.ok(tris[2] > tris[0] && tris[3] > tris[0], 'Tempest and Zenith add parts (mantle and vanes, blades)');
      assert.ok(Math.max(...tris) <= 1800, `hero Forms stay within 1,800 triangles (max ${Math.max(...tris)})`);
      await shot('actors-forms');
      const nan = await game((g) => g.cmd.actorsNaN());
      assert.equal(nan, 0, 'no NaN bone matrices');
    },
  },
  {
    name: 'actors-clips',
    query: 'res=1',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const id = await game((g) => {
        const i = g.cmd.actorsLineup({ ids: ['hero_a'], dist: 5 })[0];
        const e = g.ctx.ents.get(i);
        const a = e.yaw + 0.55;
        g.cmd.actorsStage([e.pos.x + Math.sin(a) * 3.4, e.pos.y + 1.5, e.pos.z + Math.cos(a) * 3.4], [e.pos.x, e.pos.y + 0.95, e.pos.z]);
        g.step(2);
        return i;
      });
      // every standard clip resolves and plays without NaN
      const bad = await game((g, i) => {
        const ids = g.ctx.defs.all('clip').filter((c) => c.rig === 'humanoid').map((c) => c.id.split('.')[1]);
        const out = [];
        for (const c of ids) {
          g.cmd.actorsPlay(i, c);
          g.step(4);
          if (g.cmd.actorsNaN() !== 0) out.push(c);
        }
        return { out, n: ids.length };
      }, id);
      assert.equal(bad.out.length, 0, `clips play without NaN (${bad.out.join(', ')})`);
      assert.ok(bad.n >= 47, `every standard humanoid clip exists (${bad.n})`);
      const mid = { attack1: 0.12, heavy: 0.1, beam_loop: 0.2, gather: 0.3, fly_boost: 0.2, guard: 0.3 };
      for (const [clip, t] of Object.entries(mid)) {
        const playing = await game((g, i, c, sec) => {
          g.cmd.actorsPlay(i, 'idle', { blend: 0 });
          g.step(30);
          g.cmd.actorsPlay(i, c, { blend: 0.04, loop: c === 'fly_boost' || c === 'guard' || c === 'gather' || c === 'beam_loop' });
          g.step(Math.round(sec * 60));
          return g.cmd.actorsInfo().actors[0].clip;
        }, id, clip, t);
        assert.equal(playing, clip, `${clip} is playing mid-clip`);
        await shot('actors-clip-' + clip);
      }
    },
  },
  {
    name: 'actors-locomotion',
    query: 'res=1',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const modes = new Set();
      const sample = async () => {
        const r = await game((g) => {
          g.step(12);
          const info = g.cmd.actorsInfo();
          const p = info.actors.find((a) => a.id === g.ctx.player.id);
          return { nan: info.nan, mode: p ? p.mode : '' };
        });
        modes.add(r.mode);
        assert.equal(r.nan, 0, 'no NaN in bone matrices (' + r.mode + ')');
      };
      await game((g) => { g.setCamera({ pitch: 0.15, dist: 6 }); g.move(0, 1); g.step(30); });
      await sample();
      await shot('actors-loco-run');
      await game((g) => { g.hold('sprint', true); g.step(40); });
      await sample();
      await game((g) => { g.hold('sprint', false); g.move(0, 0.35); g.step(30); });
      await sample();
      await game((g) => { g.move(0, 0); g.press('jump'); g.step(8); });
      await sample();
      await game((g) => { g.press('flyToggle'); g.step(20); g.hold('jump', true); g.step(40); g.hold('jump', false); g.move(0, 1); g.step(60); });
      await sample();
      await shot('actors-loco-fly');
      await game((g) => { g.hold('sprint', true); g.step(60); });
      await sample();
      await shot('actors-loco-boost');
      await game((g) => { g.hold('sprint', false); g.move(0, 0); g.step(30); });
      await sample();
      const steps = await game((g) => g.events(['actor:step']).length);
      console.log(`    modes: ${[...modes].join(', ')}; footsteps ${steps}`);
      assert.ok(modes.has('ground'), 'ground locomotion seen');
    },
  },
  {
    name: 'actors-crowd',
    query: 'res=1',
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const base = await game((g) => {
        g.cmd.actorsClear();
        g.cmd.actorsStage(null);
        g.step(3);
        return g.stats().drawCalls;
      });
      const r = await game((g) => {
        const p = g.ctx.player;
        const ids = [];
        for (let i = 0; i < 12; i++) {
          const a = p.yaw + (i - 5.5) * 0.06;
          ids.push(g.cmd.actorsSpawn('choir_acolyte', p.pos.x + Math.sin(a) * 30, p.pos.z + Math.cos(a) * 30, p.yaw + Math.PI));
        }
        g.cmd.actorsStage([p.pos.x, p.pos.y + 2, p.pos.z], [p.pos.x + Math.sin(p.yaw) * 30, p.pos.y + 1, p.pos.z + Math.cos(p.yaw) * 30]);
        g.step(3);
        const t0 = performance.now();
        for (let i = 0; i < 10; i++) g.step(1);
        const ms = (performance.now() - t0) / 10;
        return { ids: ids.length, stats: g.stats(), ms, info: g.cmd.actorsInfo() };
      });
      await shot('actors-crowd');
      const extra = r.stats.drawCalls - base;
      console.log(`    12 acolytes at 30 m: +${extra} draw calls, ${r.ms.toFixed(1)} ms per stepped frame, posed ${r.info.posed}, reduced ${r.info.reduced}`);
      assert.equal(r.ids, 12, '12 acolytes spawned');
      assert.ok(extra <= 30, `acolytes add at most 30 draw calls (got ${extra})`);
    },
  },
];
