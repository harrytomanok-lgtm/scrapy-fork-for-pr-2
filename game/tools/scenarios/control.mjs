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
  {
    name: 'control-camera-modes',
    width: 640,
    height: 360,
    async run({ page, game, assert, shot }) {
      await opening(game, assert);
      /** Settle the camera with frame passes, then read its state. */
      const camState = () => game((g) => {
        for (let i = 0; i < 40; i++) g.step(1);
        const c = g.ctx.three.camera;
        const p = g.ctx.player;
        const pt = { x: 0, y: 0, visible: false, depth: 0 };
        g.ctx.render.project(p.pos.x, p.pos.y + p.height * 0.6, p.pos.z, pt);
        return {
          mode: g.ctx.cam.mode, fov: c.fov, d: Math.hypot(c.position.x - p.pos.x, c.position.y - p.pos.y, c.position.z - p.pos.z),
          px: pt.x / innerWidth, py: pt.y / innerHeight, visible: pt.visible,
          above: c.position.y - g.ctx.world.heightAt(c.position.x, c.position.z),
        };
      });
      await game((g) => { g.move(0, 1); g.step(60); g.move(0, 0); g.step(30); });
      const ex = await camState();
      assert.equal(ex.mode, 'explore');
      assert.ok(ex.d > 4 && ex.d < 8, `explore distance ${ex.d.toFixed(2)}`);
      assert.ok(Math.abs(ex.fov - 60) < 1.5, `explore fov ${ex.fov.toFixed(1)}`);
      assert.ok(ex.visible && Math.abs(ex.px - 0.5) < 0.08, 'the player is centred horizontally');
      assert.ok(ex.above >= 0.45, 'the camera stays above the terrain');
      await shot('control-cam-explore');
      await game((g) => {
        g.press('jump'); g.step(8); g.press('jump'); g.step(4);
        g.hold('jump', true); g.step(120); g.hold('jump', false);
        g.move(0, 1); g.step(60);
      });
      const fl = await camState();
      assert.equal(fl.mode, 'flight');
      assert.ok(fl.d > 6 && fl.d < 11, `flight distance ${fl.d.toFixed(2)}`);
      assert.ok(fl.fov > 63 && fl.fov < 70, `flight fov ${fl.fov.toFixed(1)}`);
      await shot('control-cam-flight');
      await game((g) => { g.hold('dash', true); g.step(30); });
      const bo = await camState();
      assert.equal(bo.mode, 'boost');
      assert.ok(bo.fov > 72, `boost fov ${bo.fov.toFixed(1)}`);
      assert.ok(bo.visible, 'the player stays on screen while boosting');
      await shot('control-cam-boost');
      // Lock on a spawned enemy on the ground.
      const lock = await game((g) => {
        g.hold('dash', false);
        g.move(0, 0);
        g.ai(false);
        const p = g.player();
        g.teleport(p.x, p.z, { yaw: 0 });
        g.step(5);
        const id = g.spawn('tusk_boar', { dist: 9, passive: true });
        g.lock(id);
        for (let i = 0; i < 50; i++) g.step(1);
        const e = g.ctx.ents.get(id);
        const pt = { x: 0, y: 0, visible: false, depth: 0 };
        g.ctx.render.project(e.pos.x, e.pos.y + e.height * 0.5, e.pos.z, pt);
        const pp = { x: 0, y: 0, visible: false, depth: 0 };
        const pl = g.ctx.player;
        g.ctx.render.project(pl.pos.x, pl.pos.y + pl.height * 0.5, pl.pos.z, pp);
        return { id, mode: g.ctx.cam.mode, target: pt, player: pp, W: innerWidth };
      });
      assert.equal(lock.mode, 'lock', 'locking switches the camera to lock framing');
      assert.ok(lock.target.visible && lock.player.visible, 'player and target are both on screen');
      assert.ok(Math.abs(lock.target.x - lock.player.x) > lock.W * 0.08, 'player and target on different thirds');
      await shot('control-cam-lock');
      await game((g) => { g.lock(0); g.killAll(); g.step(30); });
      await page.setViewportSize({ width: 400, height: 800 });
      await game((g) => g.screenshotReady());
      const po = await camState();
      assert.equal(po.mode, 'explore');
      assert.ok(Math.abs(po.fov - 72) < 1.5, `portrait fov ${po.fov.toFixed(1)}`);
      assert.ok(po.py < 0.6 && po.py > 0.25, `portrait: the player sits above the control deck (${po.py.toFixed(2)})`);
      await shot('control-cam-portrait');
    },
  },
  {
    name: 'control-knock',
    width: 640,
    height: 360,
    async run({ game, assert, shot }) {
      await opening(game, assert);
      const r = await game((g) => {
        g.ai(false);
        const w = g.ctx.world;
        const p = g.player();
        // Find a steep hillside near the start: the largest rise over 6 m within 600 m.
        let best = null;
        for (let x = p.x - 600; x <= p.x + 600; x += 12) {
          for (let z = p.z - 600; z <= p.z + 600; z += 12) {
            const h0 = w.heightAt(x, z);
            if (h0 < 2) continue;
            for (let k = 0; k < 8; k++) {
              const a = (k / 8) * Math.PI * 2;
              const dx = Math.sin(a);
              const dz = Math.cos(a);
              const rise = w.heightAt(x + dx * 6, z + dz * 6) - h0;
              const flat = Math.abs(w.heightAt(x - dx * 8, z - dz * 8) - h0);
              if (flat < 1.5 && (!best || rise > best.rise)) best = { x, z, dx, dz, rise };
            }
          }
        }
        if (!best) return { err: 'no hillside' };
        // Stand 12 m back from the foot of the slope; the enemy 3 m in front.
        const px = best.x - best.dx * 12;
        const pz = best.z - best.dz * 12;
        g.teleport(px, pz, { yaw: Math.atan2(best.dx, best.dz) });
        g.setCamera({ yaw: Math.atan2(best.dx, best.dz) + 0.6, pitch: -0.15 });
        g.step(5);
        const id = g.spawn('tusk_boar', { x: px + best.dx * 4, z: pz + best.dz * 4, passive: true });
        g.step(2);
        const e = g.ctx.ents.get(id);
        const before = g.events(['actor:slam']).length;
        const pl = g.ctx.player;
        g.ctx.move.knock(e, best.dx * 30, 3, best.dz * 30, { hurtle: true, sourceId: pl.id, slamDamage: 20 });
        const mode = e.move.mode;
        g.step(45);
        const evs = g.events(['actor:slam']).slice(before);
        const slam = evs.map((x) => x.payload || x).find((x) => x.entId === id) || null;
        g.step(20);
        return { rise: best.rise, mode, slam, after: e.move.mode };
      });
      assert.ok(!r.err, r.err);
      assert.equal(r.mode, 'hurtle', 'a hurtle knock makes the body ballistic');
      assert.ok(r.slam, `slammed into the hillside (rise ${r.rise.toFixed(1)} m over 6 m)`);
      assert.ok(r.slam.speed >= 14, 'slam speed over the threshold');
      assert.equal(r.slam.damage, 20, 'the slam carries slamDamage');
      assert.equal(r.slam.surface, 'terrain');
      assert.notEqual(r.after, 'hurtle');
      await shot('control-knock');
    },
  },
];
