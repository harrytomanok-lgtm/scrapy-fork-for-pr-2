/**
 * Mover logic (ARCHITECTURE 8.5 Definition of Done) against a mock world.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOVER, createMoveState, createIntent, createRec, stepActor, knock, setBoostAllowed, dashTo, separatePair,
} from '../../src/control/logic/mover.js';
import { pushOut, createContact, CFLAG } from '../../src/control/logic/colliders.js';

const DT = 1 / 60;

/** Mock world: a height function, optional colliders, edge at 3300..3450. */
function mockWorld(heightFn = () => 0, colliders = []) {
  const h = heightFn;
  const w = {
    seaLevel: 0, edgeStart: 3300, edgeHard: 3450, ceiling: 1500,
    heightAt: (x, z) => h(x, z),
    groundAt: (x, y, z) => h(x, z),
    normalAt(x, z, out) {
      const e = 0.5;
      const nx = h(x - e, z) - h(x + e, z);
      const nz = h(x, z - e) - h(x, z + e);
      const ny = 2 * e;
      const l = Math.hypot(nx, ny, nz);
      return out.set(nx / l, ny / l, nz / l);
    },
    slopeAt(x, z) {
      const n = w.normalAt(x, z, { set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; } });
      return 1 - n.y;
    },
    edgeFactor(x, z) {
      const r = Math.hypot(x, z);
      return Math.min(1, Math.max(0, (r - 3300) / 150));
    },
    queryColliders(x, z, r, out) {
      let n = 0;
      for (const c of colliders) out[n++] = c;
      out.length = n;
      return n;
    },
  };
  return w;
}

function makeSink() {
  const ev = { mode: [], jump: 0, boost: [], landed: [], slam: [] };
  return {
    ev,
    mode(e, m, p) { ev.mode.push([m, p]); },
    jump() { ev.jump++; },
    boost(e, s) { ev.boost.push(s); },
    landed(e, s) { ev.landed.push(s); },
    slam(e, s, surface) { ev.slam.push({ speed: s, surface }); },
  };
}

function v3(x = 0, y = 0, z = 0) {
  return { x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; } };
}

function makeEnt(o = {}) {
  return {
    id: o.id || 1, kind: o.kind || 'player', alive: true, tags: 0,
    pos: v3(o.x || 0, o.y || 0, o.z || 0), vel: v3(), yaw: 0, radius: 0.4, height: 1.8,
    stats: { runSpeed: 10, flySpeed: 30, boostSpeed: 80, speedMult: 1 },
    move: createMoveState({ canFly: !!o.canFly, mode: o.mode }),
    intent: createIntent(),
  };
}

function run(ent, world, sink, ticks, before) {
  const r = ent.__rec || (ent.__rec = createRec());
  for (let i = 0; i < ticks; i++) {
    if (before) before(i, ent);
    stepActor(ent, r, DT, world, sink);
  }
  return r;
}

test('walk speed converges to runSpeed', () => {
  const w = mockWorld();
  const e = makeEnt();
  const s = makeSink();
  e.intent.mz = 1;
  run(e, w, s, 60);
  assert.ok(Math.abs(e.move.speed - 10) < 1e-6, `speed ${e.move.speed}`);
  assert.equal(e.move.mode, 'ground');
  // Acceleration is 40 m/s^2: after 0.1 s the speed is about 4.
  const e2 = makeEnt();
  e2.intent.mz = 1;
  run(e2, w, s, 6);
  assert.ok(Math.abs(e2.move.speed - 4) < 0.05, `accel ${e2.move.speed}`);
  // Sprint multiplies the run speed.
  e.intent.sprint = true;
  run(e, w, s, 90);
  assert.ok(Math.abs(e.move.speed - 10 * MOVER.sprintMult) < 1e-6);
});

test('jump apex matches gravity and jump speed', () => {
  const w = mockWorld();
  const e = makeEnt();
  const s = makeSink();
  let maxY = 0;
  run(e, w, s, 120, (i, ent) => {
    if (i === 0) ent.intent.jump = true;
    ent.intent.up = 1; // jump held: full height
    maxY = Math.max(maxY, ent.pos.y);
  });
  const apex = (11 * 11) / (2 * 28);
  assert.ok(Math.abs(maxY - apex) < 0.15, `apex ${maxY} vs ${apex}`);
  assert.equal(s.ev.jump, 1);
  assert.equal(e.move.mode, 'ground');
  assert.equal(s.ev.landed.length, 1);
  // Releasing early (player) cuts the jump.
  const e2 = makeEnt();
  let max2 = 0;
  run(e2, w, makeSink(), 120, (i, ent) => {
    if (i === 0) ent.intent.jump = true;
    ent.intent.up = 0;
    max2 = Math.max(max2, ent.pos.y);
  });
  assert.ok(max2 < apex * 0.7, `short hop ${max2}`);
});

test('slopes above the limit slide, walkable slopes hold', () => {
  // Steep: height = -0.9 x (slope well above 0.4 once normalised).
  const steep = mockWorld((x) => -3 * x);
  const e = makeEnt({ y: 0 });
  run(e, steep, makeSink(), 60);
  assert.ok(e.pos.x > 0.5, `slid downhill ${e.pos.x}`);
  // Walkable: gentle slope, no input, stays.
  const gentle = mockWorld((x) => -0.2 * x);
  const g = makeEnt({ y: 0 });
  run(g, gentle, makeSink(), 120);
  assert.ok(Math.abs(g.pos.x) < 0.05, `held ${g.pos.x}`);
  // Uphill input on the steep slope makes no progress.
  const u = makeEnt({ y: 0 });
  run(u, steep, makeSink(), 60, (i, ent) => { ent.intent.mx = -1; });
  assert.ok(u.pos.x > -0.2, `no climb ${u.pos.x}`);
});

test('second jump press in the air takes off when canFly; flight hover holds altitude', () => {
  const w = mockWorld();
  const e = makeEnt({ canFly: true });
  const s = makeSink();
  run(e, w, s, 20, (i, ent) => {
    if (i === 0 || i === 12) ent.intent.jump = true;
    ent.intent.up = 1;
  });
  assert.equal(e.move.mode, 'fly');
  run(e, w, s, 30, (i, ent) => { ent.intent.up = 1; });
  const y0 = e.pos.y;
  run(e, w, s, 60, (i, ent) => { ent.intent.up = 0; });
  const y1 = e.pos.y;
  run(e, w, s, 180, (i, ent) => { ent.intent.up = 0; });
  assert.ok(y0 > 3, `climbed ${y0}`);
  assert.ok(Math.abs(e.pos.y - y1) < 0.05, `hover ${y1} -> ${e.pos.y}`);
  assert.equal(e.move.mode, 'fly');
  // Without canFly a second press is buffered, not flight.
  const n = makeEnt();
  run(n, w, makeSink(), 20, (i, ent) => { if (i === 0 || i === 12) ent.intent.jump = true; });
  assert.notEqual(n.move.mode, 'fly');
});

test('boost reaches stage 2 after 2 s and emits move:boost; setBoostAllowed(false) drops to cruise', () => {
  const w = mockWorld();
  const e = makeEnt({ canFly: true, mode: 'fly', y: 50 });
  e.pos.y = 50;
  const s = makeSink();
  run(e, w, s, 60, (i, ent) => { ent.intent.sprint = true; ent.intent.mz = 1; });
  assert.equal(e.move.boost, 1);
  assert.deepEqual(s.ev.boost, [1]);
  run(e, w, s, 61, (i, ent) => { ent.intent.sprint = true; ent.intent.mz = 1; });
  assert.equal(e.move.boost, 2);
  assert.deepEqual(s.ev.boost, [1, 2]);
  run(e, w, s, 120, (i, ent) => { ent.intent.sprint = true; ent.intent.mz = 1; });
  assert.ok(Math.abs(e.move.speed - 80 * MOVER.sonicMult) < 1, `sonic ${e.move.speed}`);
  setBoostAllowed(e, e.__rec, s, false);
  assert.equal(e.move.boost, 0);
  assert.deepEqual(s.ev.boost, [1, 2, 0]);
  run(e, w, s, 180, (i, ent) => { ent.intent.sprint = true; ent.intent.mz = 1; });
  assert.equal(e.move.boost, 0);
  assert.ok(Math.abs(e.move.speed - 30) < 0.5, `cruise ${e.move.speed}`);
});

test('auto-land when descending near the ground', () => {
  const w = mockWorld();
  const e = makeEnt({ canFly: true, mode: 'fly' });
  e.pos.y = 6;
  const s = makeSink();
  run(e, w, s, 120, (i, ent) => { ent.intent.up = -1; });
  assert.equal(e.move.mode, 'ground');
  assert.equal(e.pos.y, 0);
});

test('a hurtling body hitting the ground at 20 m/s slams, at 8 m/s it does not', () => {
  const w = mockWorld();
  const a = makeEnt({ kind: 'enemy' });
  a.pos.y = 0.5;
  const s = makeSink();
  const r = createRec();
  knock(a, r, s, 0, -20, 0, { hurtle: true, sourceId: 7, slamDamage: 12 });
  assert.equal(a.move.mode, 'hurtle');
  assert.equal(a.move.hurtleDamage, 12);
  for (let i = 0; i < 10; i++) stepActor(a, r, DT, w, s);
  assert.equal(s.ev.slam.length, 1);
  assert.ok(s.ev.slam[0].speed >= 20 && s.ev.slam[0].surface === 'terrain');
  assert.equal(a.move.mode, 'ground');
  const b = makeEnt({ kind: 'enemy' });
  b.pos.y = 0.1;
  const s2 = makeSink();
  const r2 = createRec();
  knock(b, r2, s2, 0, -8, 0, { hurtle: true });
  for (let i = 0; i < 10; i++) stepActor(b, r2, DT, w, s2);
  assert.equal(s2.ev.slam.length, 0);
  assert.equal(b.move.mode, 'ground');
});

test('a hurtle into a hillside slams', () => {
  // Flat until x = 10, then a wall rising 3 m per metre.
  const w = mockWorld((x) => (x > 10 ? (x - 10) * 3 : 0));
  const e = makeEnt({ kind: 'enemy' });
  const s = makeSink();
  const r = createRec();
  knock(e, r, s, 25, 4, 0, { hurtle: true });
  for (let i = 0; i < 60 && s.ev.slam.length === 0; i++) stepActor(e, r, DT, w, s);
  assert.equal(s.ev.slam.length, 1, 'slammed into the hillside');
  assert.ok(e.pos.x < 12);
});

test('capsule push-out from sphere, capsule, box and disc colliders', () => {
  const c = createContact();
  const cases = [
    { shape: 'sphere', x: 0.5, y: 1, z: 0, r: 0.5, flags: CFLAG.SOLID },
    { shape: 'capsule', x: 0.6, y: 0, z: 0, r: 0.4, h: 3, flags: CFLAG.SOLID },
    { shape: 'disc', x: 0, y: 0, z: 0.7, r: 0.5, h: 2, flags: CFLAG.SOLID },
    { shape: 'box', x: 1, y: 0, z: 0, hx: 0.8, hz: 0.8, h: 3, yaw: 0.4, flags: CFLAG.SOLID },
  ];
  for (const col of cases) {
    const pos = v3(0, 0, 0);
    const vel = v3(1, 0, 1);
    const pushed = pushOut(pos, vel, 0.4, 1.8, [col], 1, c);
    assert.ok(pushed, `${col.shape} pushes`);
    // After the push nothing overlaps any more.
    const again = pushOut(pos, null, 0.4, 1.8, [col], 1, createContact());
    assert.ok(!again || c.total > 0, `${col.shape} resolved`);
    assert.ok(Math.hypot(pos.x, pos.z) > 0.05, `${col.shape} moved ${pos.x},${pos.z}`);
  }
  // Non-solid colliders never push.
  const p = v3();
  assert.equal(pushOut(p, null, 0.4, 1.8, [{ shape: 'sphere', x: 0, y: 1, z: 0, r: 1, flags: CFLAG.PLATFORM }], 1, c), false);
  // A low box is stepped onto instead of pushing sideways.
  const q = v3(0.2, 0, 0);
  pushOut(q, null, 0.4, 1.8, [{ shape: 'box', x: 0, y: 0, z: 0, hx: 1, hz: 1, h: 0.3, yaw: 0, flags: CFLAG.SOLID }], 1, c);
  assert.ok(Math.abs(q.y - 0.3) < 1e-6 && Math.abs(q.x - 0.2) < 1e-6);
  // The mover walks into a wall box and stops at its face.
  const w = mockWorld(() => 0, [{ id: 3, shape: 'box', x: 5, y: 0, z: 0, hx: 1, hz: 4, h: 4, yaw: 0, flags: CFLAG.SOLID }]);
  const e = makeEnt();
  run(e, w, makeSink(), 120, (i, ent) => { ent.intent.mx = 1; });
  assert.ok(Math.abs(e.pos.x - (4 - 0.4)) < 0.02, `stopped at the face ${e.pos.x}`);
});

test('a hurtle into a prop at slam speed slams with surface prop', () => {
  const w = mockWorld(() => 0, [{ id: 4, shape: 'disc', x: 3, y: 0, z: 0, r: 1, h: 5, flags: CFLAG.SOLID, propKey: 9 }]);
  const e = makeEnt({ kind: 'enemy' });
  e.pos.y = 1;
  const s = makeSink();
  const r = createRec();
  knock(e, r, s, 20, 2, 0, { hurtle: true });
  for (let i = 0; i < 30 && s.ev.slam.length === 0; i++) stepActor(e, r, DT, w, s);
  assert.equal(s.ev.slam.length, 1);
  assert.equal(s.ev.slam[0].surface, 'prop');
});

test('the Veilstorm edge pushes back and never lets the body through', () => {
  const w = mockWorld();
  const e = makeEnt({ canFly: true, mode: 'fly' });
  e.pos.x = 3200;
  e.pos.y = 50;
  let maxR = 0;
  run(e, w, makeSink(), 600, (i, ent) => {
    ent.intent.mx = 1;
    ent.intent.sprint = true;
    maxR = Math.max(maxR, Math.hypot(ent.pos.x, ent.pos.z));
  });
  assert.ok(maxR <= 3450 + MOVER.edgeOvershoot + 1e-6, `max radius ${maxR}`);
  // Released at the wall, the body is carried back inside.
  run(e, w, makeSink(), 240);
  assert.ok(Math.hypot(e.pos.x, e.pos.z) < 3450, 'carried back');
});

test('swim when the feet are more than 1.2 m under sea level', () => {
  const w = mockWorld((x) => -0.5 * x);
  const e = makeEnt();
  run(e, w, makeSink(), 400, (i, ent) => { ent.intent.mx = 1; });
  assert.equal(e.move.mode, 'swim');
  assert.ok(Math.abs(e.pos.y + MOVER.swimDepth) < 1e-6);
});

test('dashTo moves straight and stops at a solid; separation pushes overlapping actors apart', () => {
  const w = mockWorld();
  const e = makeEnt();
  const r = createRec();
  dashTo(e, r, 6, 0, 0, 0.5);
  for (let i = 0; i < 40; i++) stepActor(e, r, DT, w, makeSink());
  assert.ok(Math.abs(e.pos.x - 6) < 0.05, `dash ${e.pos.x}`);
  const wall = mockWorld(() => 0, [{ id: 1, shape: 'box', x: 3, y: 0, z: 0, hx: 0.5, hz: 3, h: 3, yaw: 0, flags: CFLAG.SOLID }]);
  const b = makeEnt();
  const rb = createRec();
  dashTo(b, rb, 8, 0, 0, 0.5);
  for (let i = 0; i < 40; i++) stepActor(b, rb, DT, wall, makeSink());
  assert.ok(b.pos.x < 2.5, `blocked ${b.pos.x}`);
  const a1 = makeEnt({ id: 1 });
  const a2 = makeEnt({ id: 2, x: 0.3 });
  for (let i = 0; i < 60; i++) separatePair(a1, a2, DT);
  assert.ok(Math.abs(a2.pos.x - a1.pos.x) > 0.79, `separated ${a2.pos.x - a1.pos.x}`);
});
