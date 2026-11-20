/**
 * Lock-on framing (control/logic/camMath lockRig): the hero and the locked target both inside the safe area, in
 * portrait and landscape, for target distances of 2 to 30 m and height differences of -10 to +25 m.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lockRig, lockProject, lockFraming, LOCK_SAFE, LOCK_CMIN, CAM_MODES } from '../../src/control/logic/camMath.js';

const VIEWS = [
  { name: 'portrait 412x915', aspect: 412 / 915, fov: CAM_MODES.lock.fovP },
  { name: 'landscape 915x412', aspect: 915 / 412, fov: CAM_MODES.lock.fovL },
];
const HERO_H = 1.8;
const BODIES = [1.2, 2.4, 4.2];

/** @returns {string[]} the points of the hero or target outside the safe area */
function sweep(view, side) {
  const S = view.aspect < 1 ? LOCK_SAFE.portrait : LOCK_SAFE.landscape;
  const rig = { back: 0, height: 0, lateral: 0, pitch: 0, pitchLo: 0, pitchHi: 0, fit: false };
  const fr = { yaw: 0, dist: 0, blend: 0 };
  const pr = { u: 0, v: 0, depth: 0 };
  const bad = [];
  const eps = 1e-6;
  for (let d = 2; d <= 30; d += 1) {
    for (let dy = -10; dy <= 25; dy += 2.5) {
      for (const bearing of [0, 1.1, -2.4]) {
        for (const th of BODIES) {
          const tx = Math.sin(bearing) * d;
          const tz = Math.cos(bearing) * d;
          lockFraming(0, 0, tx, tz, side, view.aspect < 1, fr);
          lockRig(tx, dy, tz, HERO_H, th, fr.yaw, side, view.fov, view.aspect, rig);
          if (rig.height < LOCK_CMIN - 1e-9) bad.push(`camera under the feet d=${d} dy=${dy}`);
          if (!rig.fit) {
            bad.push(`no fit d=${d} dy=${dy} b=${bearing} h=${th}`);
            continue;
          }
          // Every pitch the look input may choose inside the range keeps everything in.
          for (const pitch of [rig.pitch, rig.pitchLo, rig.pitchHi]) {
            const pts = [['hero feet', 0, 0, 0], ['hero head', 0, HERO_H, 0], ['target feet', tx, dy, tz], ['target head', tx, dy + th, tz]];
            for (const [n, x, y, z] of pts) {
              lockProject(rig, pitch, fr.yaw, x, y, z, view.fov, view.aspect, pr);
              const ok = pr.depth > 0.3 && pr.v <= S.top + eps && pr.v >= S.bottom - eps && Math.abs(pr.u) <= S.side + eps;
              if (!ok) bad.push(`${n} d=${d} dy=${dy} b=${bearing} h=${th} u=${pr.u.toFixed(2)} v=${pr.v.toFixed(2)}`);
            }
          }
        }
      }
    }
  }
  return bad;
}

for (const view of VIEWS) {
  for (const side of [1, -1]) {
    test(`lock framing keeps hero and target in the safe area: ${view.name}, side ${side}`, () => {
      const bad = sweep(view, side);
      assert.deepEqual(bad.slice(0, 8), [], `${bad.length} misses`);
    });
  }
}

test('lock framing: the hero sits in the lower middle in portrait, on its side, and the camera pulls back only when needed', () => {
  const view = VIEWS[0];
  const rig = { back: 0, height: 0, lateral: 0, pitch: 0, pitchLo: 0, pitchHi: 0, fit: false };
  const fr = { yaw: 0, dist: 0, blend: 0 };
  const pr = { u: 0, v: 0, depth: 0 };
  // The reported case: a boar 7 m away on level ground.
  lockFraming(0, 0, 0, 7, 1, true, fr);
  lockRig(0, 0, 7, HERO_H, 1.2, fr.yaw, 1, view.fov, view.aspect, rig);
  lockProject(rig, rig.pitch, fr.yaw, 0, HERO_H * 0.5, 0, view.fov, view.aspect, pr);
  assert.ok(pr.v < -0.05 && pr.v > -0.45, 'hero centre in the lower middle: ' + pr.v);
  assert.ok(pr.u < 0, 'hero on the side away from the target');
  const near = rig.back;
  lockFraming(0, 0, 0, 3, 1, true, fr);
  lockRig(0, 22, 3, HERO_H, 2.4, fr.yaw, 1, view.fov, view.aspect, rig);
  assert.ok(rig.back > near, 'a flyer high above pulls the camera back');
});
