import test from 'node:test';
import assert from 'node:assert/strict';
import { bodyBox, placeAround, hits, KEEP_PAD } from '../../src/ui/logic/placement.js';

const box = () => ({ x: 0, y: 0, w: 0, h: 0, on: false });
const out = () => ({ dx: 0, dy: 0, moved: false });

test('bodyBox spans feet to head with a margin', () => {
  const b = bodyBox(200, 500, 200, 400, box());
  assert.ok(b.on);
  assert.ok(b.y < 400 && b.y + b.h > 500);
  assert.ok(Math.abs(b.x + b.w / 2 - 200) < 0.01);
});

test('a piece clear of the boxes stays put', () => {
  const o = placeAround({ x: 10, y: 10, w: 50, h: 20 }, [bodyBox(300, 500, 300, 400, box())], { minTop: 0, minX: 0, maxX: 400 }, out());
  assert.equal(o.moved, false);
  assert.equal(o.dx, 0);
  assert.equal(o.dy, 0);
});

test('a piece on the hero lifts above it', () => {
  const hero = bodyBox(200, 500, 200, 380, box());
  const base = { x: 120, y: 440, w: 160, h: 40 };
  const o = placeAround(base, [hero], { minTop: 100, minX: 0, maxX: 400 }, out());
  assert.ok(o.moved && o.dy < 0);
  assert.equal(hits({ x: base.x + o.dx, y: base.y + o.dy, w: base.w, h: base.h }, hero, KEEP_PAD - 1), false);
});

test('with no room above, the piece moves sideways', () => {
  const hero = bodyBox(200, 500, 200, 120, box());
  const base = { x: 160, y: 440, w: 80, h: 40 };
  const o = placeAround(base, [hero], { minTop: 100, minX: 0, maxX: 420 }, out());
  assert.ok(o.moved && o.dx !== 0 && o.dy === 0);
  assert.equal(hits({ x: base.x + o.dx, y: base.y, w: base.w, h: base.h }, hero), false);
});

test('switched-off boxes are ignored', () => {
  const hero = bodyBox(200, 500, 200, 380, box());
  hero.on = false;
  const o = placeAround({ x: 120, y: 440, w: 160, h: 40 }, [hero], { minTop: 0, minX: 0, maxX: 400 }, out());
  assert.equal(o.moved, false);
});
