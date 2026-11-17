/**
 * World package scenarios (ARCHITECTURE 8.1): regions from the air, the Thornwood vista toward the Spire,
 * craters, the Worker fallback, props, water and the map. Budgets are the low tier's (7.1).
 */

const LOW = { drawCalls: 120, triangles: 250000 };

/**
 * In the page: put the player (flying) at (x, alt above ground, z) facing yaw, set the camera, settle streaming.
 * @param {any} g @param {number} x @param {number} z @param {number} alt @param {number} yaw @param {number} pitch
 */
function view(g, x, z, alt, yaw, pitch) {
  g.teleport(x, z, { alt, yaw });
  g.setCamera({ yaw, pitch });
  g.step(3);
  g.cmd.flushBuilds();
  g.step(3);
  g.cmd.flushBuilds();
  g.render();
  const s = g.stats();
  return { drawCalls: s.drawCalls, triangles: s.triangles, programs: s.programs, info: g.cmd.worldInfo() };
}

/** @param {any} assert @param {any} s @param {string} label */
function budget(assert, s, label) {
  assert.ok(s.drawCalls > 0, `${label}: something was drawn`);
  assert.ok(s.drawCalls <= LOW.drawCalls, `${label}: draw calls ${s.drawCalls} <= ${LOW.drawCalls}`);
  assert.ok(s.triangles <= LOW.triangles, `${label}: triangles ${s.triangles} <= ${LOW.triangles}`);
}

export const scenarios = [
  {
    name: 'world-regions',
    query: 'hour=10',
    width: 640,
    height: 360,
    async run({ game, assert, shot }) {
      const info = await game((g) => g.cmd.worldInfo());
      console.log(`  world: ${info.cell} m grid via ${info.bakeMode}, ready in ${Math.round(info.bakeMs)} ms`);
      const regions = await game((g) => g.ctx.world.regions.map((r) => ({ id: r.id, cx: r.cx, cz: r.cz })));
      assert.equal(regions.length, 7, 'seven regions');
      for (const r of regions) {
        const got = await game((g, rr) => g.regionAt(rr.cx, rr.cz), r);
        assert.equal(got, r.id, `regionAt at the centre of ${r.id}`);
        // Look from 90 m up toward the island centre (or south for the Spire) so each shot shows the region and its neighbours.
        const yaw = r.id === 'spire' ? 0.6 : Math.atan2(-r.cx, -r.cz);
        const s = await game(view, r.cx, r.cz, r.id === 'spire' ? 160 : 90, yaw, -0.32);
        console.log(`  ${r.id}: ${s.drawCalls} calls, ${s.triangles} tris, ${s.info.tiles} tiles, trees ${s.info.props.trees}, rocks ${s.info.props.rocks}`);
        budget(assert, s, r.id);
        await shot('world-region-' + r.id);
      }
    },
  },
  {
    name: 'world-vista-400',
    query: 'hour=10',
    width: 640,
    height: 360,
    async run({ game, assert, shot }) {
      // 400 m above Thornwood, looking east-north-east at the Spire.
      const x = -2300;
      const z = -300;
      const yaw = Math.atan2(-x, -z);
      const s = await game(view, x, z, 400, yaw, -0.18);
      console.log(`  vista-400: ${s.drawCalls} calls, ${s.triangles} tris, ${s.programs} programs, tiles ${s.info.tiles}`);
      budget(assert, s, 'vista-400');
      await shot('world-vista-400');
      const s2 = await game(view, x, z, 60, yaw, -0.12);
      console.log(`  vista-60: ${s2.drawCalls} calls, ${s2.triangles} tris`);
      budget(assert, s2, 'vista-60');
      await shot('world-vista-60');
    },
  },
  {
    name: 'world-crater',
    width: 640,
    height: 360,
    async run({ game, assert, shot }) {
      const r = await game((g) => {
        const lm = g.ctx.world.landmark('haven_aster');
        const x = lm.x + 260;
        const z = lm.z - 120;
        const before = g.heightAt(x, z);
        g.crater(x, z, 12, 3.6);
        const after = g.heightAt(x, z);
        const small0 = g.heightAt(x + 60, z);
        g.crater(x + 60, z, 4, 1.2);
        const small1 = g.heightAt(x + 60, z);
        const ev = g.events(['world:crater']).map((e) => e.payload || e);
        return { x, z, before, after, small0, small1, n: ev.length };
      });
      assert.ok(r.before - r.after >= 2, `crater lowered heightAt by ${(r.before - r.after).toFixed(2)} m (>= 2)`);
      assert.equal(r.small0, r.small1, 'a radius-4 crater does not edit the grid');
      assert.ok(r.n >= 2, 'world:crater emitted for both');
      const yaw = Math.PI * 0.75;
      await game(view, r.x - Math.sin(yaw) * 26, r.z - Math.cos(yaw) * 26, 14, yaw, -0.45);
      await shot('world-crater');
    },
  },
  {
    name: 'world-worker-fallback',
    width: 400,
    height: 800,
    async run({ page, harness, game, assert, shot }) {
      const first = await game((g) => g.cmd.worldInfo());
      assert.equal(first.bakeMode, 'worker', 'the normal boot bakes in the Worker');
      assert.equal(first.cell, 4, 'the Worker bakes the 4 m grid');
      await page.addInitScript(() => {
        // Simulate an embedding page that blocks blob: workers.
        window.Worker = function BlockedWorker() {
          throw new Error('blocked by the page');
        };
      });
      await harness.reload();
      const info = await game((g) => g.cmd.worldInfo());
      assert.equal(info.bakeMode, 'main', 'the fallback bake ran on the main thread');
      assert.equal(info.cell, 8, 'the fallback grid is 8 m');
      assert.equal(await game((g) => g.ctx.world.cell), 8, 'world.cell reports 8');
      const p = await game((g) => g.player());
      assert.ok(p && Math.abs(p.y - (await game((g, q) => g.heightAt(q.x, q.z), p))) < 3, 'the player stands on the 8 m terrain');
      console.log(`  fallback: ready in ${Math.round(info.bakeMs)} ms`);
      await game((g) => g.step(20));
      await shot('world-worker-fallback');
    },
  },
];
