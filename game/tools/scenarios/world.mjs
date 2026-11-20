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
    name: 'world-props',
    async run({ game, assert }) {
      const r = await game((g) => {
        const w = g.ctx.world;
        const p = g.player();
        const out = [];
        w.queryColliders(p.x, p.z, 400, out);
        const rock = out.find((c) => (c.flags & 4) !== 0);
        if (!rock) return { found: false };
        const id = rock.id;
        const key = rock.propKey;
        const pos = { x: rock.x, y: rock.y, z: rock.z };
        const n = w.damageProps(pos.x, pos.y, pos.z, 0.5, 50, 0);
        const after = [];
        w.queryColliders(pos.x, pos.z, 5, after);
        const ev = g.events(['world:propDestroyed']).map((e) => e.payload || e);
        g.step(2);
        return { found: true, n, gone: !after.some((c) => c.id === id), key, ev: ev.map((e) => ({ key: e.key, kind: e.kind })) };
      });
      assert.ok(r.found, 'a destructible prop collider is active near the player');
      assert.ok(r.n >= 1, 'damageProps destroyed it');
      assert.ok(r.gone, 'its collider is gone');
      assert.ok(r.ev.some((e) => e.key === r.key), 'world:propDestroyed recorded with its key');
    },
  },
  {
    name: 'world-streaming',
    async run({ game, assert }) {
      // a flush (teleport) places every prop at full size; walking across a cell grows the new ones in
      const r = await game((g) => {
        const m = g.ctx.world.regions.find((q) => q.id === 'meadows');
        g.teleport(m.cx, m.cz, {});
        g.step(2);
        const flushed = g.ctx.world.info().props.growing;
        const e = g.ctx.player;
        // move the player without a teleport (a teleport flushes): as if it had walked there
        e.pos.x += 150;
        e.pos.y = g.heightAt(e.pos.x, e.pos.z) + 0.5;
        e.prev.x = e.pos.x;
        e.prev.y = e.pos.y;
        g.step(1);
        g.step(1);
        const started = g.ctx.world.info().props.growing;
        for (let i = 0; i < 14; i++) g.step(10);
        return { flushed, started, after: g.ctx.world.info().props.growing };
      });
      assert.equal(r.flushed, 0, 'a teleport flush shows props at full size');
      assert.ok(r.started > 0, `crossing a cell grows new props in (${r.started})`);
      assert.equal(r.after, 0, "growth finishes within two seconds");
      // no tree, rock or cover collider sits on a point of interest or a settlement spot
      const bad = await game((g) => {
        const w = g.ctx.world;
        const pts = [];
        for (const p of w.pois()) if (p.type !== 'crownChest') pts.push([p.id, p.x, p.z]);
        for (const d of g.ctx.defs.all('settlement')) {
          const s = g.ctx.env.settlement(d.id);
          if (s) for (const sp of s.spots) pts.push([d.id + ':' + sp.id, sp.x, sp.z]);
        }
        const out = [];
        const list = [];
        for (const [id, x, z] of pts) {
          g.teleport(x, z, {});
          w.queryColliders(x, z, 1.2, list);
          for (const c of list) if (c.propKey > 0 && (c.flags & 1)) out.push(id + ' ' + c.shape);
        }
        return { n: pts.length, out };
      });
      console.log(`  checked ${bad.n} points`);
      assert.deepEqual(bad.out, [], 'points of interest and spots are clear of vegetation and rocks');
      // the authored places exist
      const places = await game((g) => g.ctx.world.places().map((p) => p.id));
      for (const id of ['saltglass_arches', 'elder_maple', 'lagoon_boardwalk', 'drowned_observatory']) assert.ok(places.includes(id), 'place ' + id);
    },
  },
  {
    name: 'world-map',
    async run({ game, assert }) {
      const r = await game((g) => {
        const c = g.ctx.world.mapCanvas(256);
        const d = c.getContext('2d').getImageData(0, 0, 256, 256).data;
        const seen = new Set();
        for (let i = 0; i < d.length; i += 4 * 7) seen.add((d[i] >> 3) * 1024 + (d[i + 1] >> 3) * 32 + (d[i + 2] >> 3));
        return { w: c.width, distinct: seen.size, cached: g.ctx.world.mapCanvas(256) === c };
      });
      assert.equal(r.w, 256);
      assert.ok(r.distinct > 60, `map has ${r.distinct} distinct colours`);
      assert.ok(r.cached, 'the canvas is cached per size');
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
