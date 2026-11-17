/**
 * Control package scenarios (ARCHITECTURE 8.5): movement, camera modes, touch layouts, knock and slam.
 * Run: node tools/scenarios.mjs control [--only name]
 */

/** @param {any} game @param {any} assert */
async function opening(game, assert) {
  const p = await game((g) => g.player());
  assert.ok(p, 'the player exists after boot');
  return p;
}

export const scenarios = [
  {
    name: 'control-walk-fly',
    width: 640,
    height: 360,
    async run({ game, assert, shot }) {
      const p0 = await opening(game, assert);
      await game((g) => {
        g.move(0, 1);
        g.step(120);
      });
      const p1 = await game((g) => ({ ...g.player(), speed: g.ctx.player.move.speed, run: g.ctx.player.stats.runSpeed }));
      assert.equal(p1.mode, 'ground', 'walking stays on the ground');
      assert.ok(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 10, 'two seconds of running cover ground');
      assert.ok(Math.abs(p1.speed - p1.run) < 1.5, `run speed reached (${p1.speed.toFixed(2)} of ${p1.run})`);
      await shot('control-walk');
      const air = await game((g) => {
        g.press('jump');
        g.step(8);
        const m1 = g.player().mode;
        g.press('jump');
        g.step(4);
        const m2 = g.player().mode;
        g.hold('jump', true);
        g.step(90);
        g.hold('jump', false);
        g.step(10);
        return { m1, m2, alt: g.ctx.move.altitude(g.ctx.player) };
      });
      assert.equal(air.m1, 'air', 'the first jump leaves the ground');
      assert.equal(air.m2, 'fly', 'the second jump takes off');
      assert.ok(air.alt > 15, `holding Jump climbs (${air.alt.toFixed(1)} m)`);
      const fly = await game((g) => {
        const a = g.player();
        g.move(0, 1);
        let n = 0;
        while (n < 1500) {
          g.step(30);
          n += 30;
          const b = g.player();
          if (Math.hypot(b.x - a.x, b.z - a.z) >= 300) break;
        }
        const b = g.player();
        return { d: Math.hypot(b.x - a.x, b.z - a.z), mode: b.mode, secs: n / 60 };
      });
      assert.ok(fly.d >= 300, `flew 300 m (${fly.d.toFixed(0)} m in ${fly.secs} s)`);
      assert.equal(fly.mode, 'fly');
      await shot('control-flight');
      const boost = await game((g) => {
        const before = g.events(['move:boost']).length;
        g.hold('dash', true);
        g.step(20);
        const stage1 = g.ctx.player.move.boost;
        g.step(130);
        const stage2 = g.ctx.player.move.boost;
        const evs = g.events(['move:boost']).slice(before).map((e) => e.payload ? e.payload.stage : e.stage);
        return { stage1, stage2, evs, speed: g.ctx.player.move.speed };
      });
      assert.equal(boost.stage1, 1, 'holding Dash in flight boosts');
      assert.equal(boost.stage2, 2, 'the sonic stage after 2 s');
      assert.ok(boost.speed > 80, `sonic speed ${boost.speed.toFixed(0)} m/s`);
      await shot('control-sonic');
      const landed = await game((g) => {
        g.hold('dash', false);
        g.move(0, 0);
        g.step(30);
        g.hold('descend', true);
        let n = 0;
        while (g.player().mode === 'fly' && n < 3000) {
          g.step(30);
          n += 30;
        }
        g.hold('descend', false);
        g.step(10);
        return { mode: g.player().mode, boost: g.ctx.player.move.boost, alt: g.ctx.move.altitude(g.ctx.player) };
      });
      assert.equal(landed.mode, 'ground', 'descending lands');
      assert.equal(landed.boost, 0);
      assert.ok(Math.abs(landed.alt) < 0.05, 'feet on the ground');
    },
  },
];
