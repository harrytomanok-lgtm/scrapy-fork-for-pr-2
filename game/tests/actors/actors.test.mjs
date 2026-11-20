/**
 * actors package: specs, rigs, mesh merging, poses and clips (ARCHITECTURE 8.4 Definition of Done).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDS } from '../../src/core/ids.js';
import { buildSpecs, budgetOf, villagerLook } from '../../src/actors/data/specs.js';
import { CHAIN_KINDS } from '../../src/actors/builder.js';
import { DEFAULT_CHAINS } from '../../src/actors/logic/rigs.js';
import { validateSpec } from '../../src/actors/logic/validate.js';
import { mergeSpec, partTriangles, specParts } from '../../src/actors/logic/mesh.js';
import { boneNames, skeleton, RIG_KINDS, MAX_BONES } from '../../src/actors/logic/rigs.js';
import { POSES, compilePose, blendPose, mirror, pose, family, poseSize } from '../../src/actors/logic/poses.js';
import { CLIP_DEFS, HUMANOID_CLIPS, CREATURE_CLIPS, resolveClip, sampleClip, compileClip } from '../../src/actors/logic/clips.js';

const SPECS = buildSpecs();
const byId = new Map(SPECS.map((s) => [s.id, s]));

test('every IDS.actorSpec id has a spec, in order, and nothing else', () => {
  assert.deepEqual(SPECS.map((s) => s.id), [...IDS.actorSpec]);
});

test('every spec validates: rig bones, at most 16 slots, at most 28 bones, known shapes and slots', () => {
  for (const s of SPECS) {
    const v = validateSpec(s);
    assert.deepEqual(v.errors, [], s.id);
    assert.ok(Object.keys(s.palette).length <= 16, s.id + ' slots');
    assert.ok(boneNames(s.rig).length <= MAX_BONES, s.id + ' bones');
  }
});

test('every spec stays inside its triangle budget in every Form (ART_UX 2.1)', () => {
  for (const s of SPECS) {
    const v = validateSpec(s);
    assert.ok(v.maxTriangles <= budgetOf(s.id), `${s.id}: ${v.maxTriangles} > ${budgetOf(s.id)}`);
    assert.ok(v.triangles > 150, `${s.id} is not a stub (${v.triangles})`);
  }
});

test('merged geometry matches the counted triangles and binds every vertex to a real bone', () => {
  for (const id of ['hero_a', 'choir_acolyte', 'bramblehorn', 'frost_harrier', 'ember_wisp']) {
    const s = byId.get(id);
    const m = mergeSpec(s, null);
    let n = 0;
    for (const p of specParts(s, null)) n += partTriangles(p);
    assert.equal(m.triangles, n, id);
    assert.deepEqual(m.problems, [], id);
    const nb = m.bones.length;
    for (let i = 0; i < m.skinIndex.length; i += 4) assert.ok(m.skinIndex[i] < nb);
    for (let i = 0; i < m.position.length; i++) assert.ok(Number.isFinite(m.position[i]) && Number.isFinite(m.normal[i]), id + ' finite');
    for (let i = 0; i < m.index.length; i++) assert.ok(m.index[i] < m.vertices);
  }
});

test('humanoids stand on the ground and are about their build height', () => {
  for (const s of SPECS.filter((x) => x.rig === 'humanoid' && !x.hover)) {
    const m = mergeSpec(s, null);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 1; i < m.position.length; i += 3) { lo = Math.min(lo, m.position[i]); hi = Math.max(hi, m.position[i]); }
    const H = s.build.height * s.scale;
    assert.ok(Math.abs(lo) < 0.06 * H, `${s.id} feet at ${lo.toFixed(3)}`);
    assert.ok(hi > H * 0.92 && hi < H * 1.45, `${s.id} top at ${hi.toFixed(2)} for height ${H}`);
  }
});

test('hero Forms: exactly ember, tempest, zenith; hair, skin and body colours never change', () => {
  const body = ['coat', 'coatLining', 'trousers', 'boots', 'wraps', 'bronze', 'skin', 'hair'];
  for (const id of ['hero_a', 'hero_b']) {
    const s = byId.get(id);
    assert.deepEqual(Object.keys(s.forms).sort(), ['ember', 'tempest', 'zenith']);
    for (const f of Object.values(s.forms)) {
      for (const k of body) assert.ok(!(f.palette && k in f.palette), `${id} form changes ${k}`);
      assert.ok(f.partsAdd && f.partsAdd.length > 0, 'each Form adds seams or parts');
    }
    // sash, long tail, collar, boots: the silhouette keys of ART_UX 2.2
    for (const b of ['sash1', 'sash2', 'sash3', 'tail1']) assert.ok(s.parts.some((p) => p.bone === b), `${id} has a part on ${b}`);
  }
  assert.ok(byId.get('hero_b').parts.filter((p) => p.bone === 'tail1')[0].size[1] > byId.get('hero_a').parts.filter((p) => p.bone === 'tail1')[0].size[1], 'hero_b has the longer tail');
  assert.ok(byId.get('hero_a').build.shoulder > byId.get('hero_b').build.shoulder, 'hero_a has the broader shoulders');
});

test('every hostile carries violet siphon-glass (ART_UX 2.5)', () => {
  for (const id of ['ember_wisp', 'tusk_boar', 'bramble_boar', 'choir_acolyte', 'choir_caster', 'scuttlecrab', 'rust_golem', 'frost_harrier', 'choir_vanguard', 'durn', 'bramblehorn', 'gorrumaw', 'iskra', 'vorrhal']) {
    const s = byId.get(id);
    assert.ok(Object.values(s.palette).includes(0x7b3cff), id);
  }
});

test('rig skeletons: parents precede children, bind positions finite', () => {
  for (const rig of RIG_KINDS) {
    const sk = skeleton(rig, { height: 1.8, shoulder: 0.44 }, 1);
    for (let i = 0; i < sk.names.length; i++) {
      assert.ok(sk.parent[i] < i, `${rig}: ${sk.names[i]}`);
      for (let k = 0; k < 3; k++) assert.ok(Number.isFinite(sk.world[i * 3 + k]));
    }
  }
});

test('poses compile without unknown bones and mirror twice to themselves', () => {
  for (const fam of Object.keys(POSES)) {
    for (const [id, p] of Object.entries(POSES[fam])) {
      const problems = [];
      compilePose(fam, p, problems);
      assert.deepEqual(problems, [], `${fam}.${id}`);
      const a = compilePose(fam, p);
      const b = compilePose(fam, mirror(mirror(p)));
      for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-6, `${fam}.${id} mirror`);
    }
  }
});

test('pose blending of identical poses is the identity, and w=0/1 return the ends', () => {
  const a = pose('humanoid', 'run_c');
  const b = pose('humanoid', 'guard');
  const out = new Float32Array(a.length);
  for (const w of [0, 0.3, 0.77, 1]) {
    blendPose(a, a, w, out);
    for (let i = 0; i < a.length; i++) assert.ok(Math.abs(out[i] - a[i]) < 1e-6);
  }
  blendPose(a, b, 0, out);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(out[i] - a[i]) < 1e-6);
  blendPose(a, b, 1, out);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(out[i] - b[i]) < 1e-6);
});

test('every standard clip id resolves for each rig that must have it (no fallback)', () => {
  for (const id of IDS.clip) assert.ok(HUMANOID_CLIPS.includes(id), 'humanoid list covers IDS.clip: ' + id);
  for (const rig of ['humanoid', 'giant']) for (const c of HUMANOID_CLIPS) assert.equal(resolveClip(rig, c).fallback, false, `${rig}.${c}`);
  for (const rig of ['quadruped', 'flyer', 'blob']) for (const c of CREATURE_CLIPS) assert.equal(resolveClip(rig, c).fallback, false, `${rig}.${c}`);
  const fb = resolveClip('quadruped', 'beam_loop');
  assert.ok(fb.fallback && fb.clip.id === 'quadruped.attack1', 'a missing clip falls back to attack1');
});

test('clip sampling is continuous at loop points and has no jumps inside', () => {
  for (const def of CLIP_DEFS) {
    const c = compileClip(def);
    const n = poseSize(family(def.rig));
    const a = new Float32Array(n);
    const b = new Float32Array(n);
    if (c.loop) {
      sampleClip(c, 0, a);
      sampleClip(c, c.seconds - 1e-5, b);
      for (let i = 0; i < n; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-3, `${def.id} loop seam [${i}] ${a[i]} vs ${b[i]}`);
    }
    const dt = 0.0005;
    sampleClip(c, 0, a);
    for (let t = dt; t <= c.seconds; t += dt) {
      sampleClip(c, t, b);
      for (let i = 0; i < n; i++) assert.ok(Math.abs(a[i] - b[i]) < 0.2, `${def.id} jump at ${t.toFixed(3)} [${i}]`);
      a.set(b);
    }
  }
});

test('clip keys are ordered, start at 0 and end at the clip length', () => {
  for (const def of CLIP_DEFS) {
    assert.equal(def.keys[0].t, 0, def.id);
    assert.ok(Math.abs(def.keys[def.keys.length - 1].t - def.seconds) < 1e-9, def.id);
    for (let i = 1; i < def.keys.length; i++) assert.ok(def.keys[i].t >= def.keys[i - 1].t, def.id);
  }
});

test('spring chains: humanoids carry sash, hair tail and hem flaps; quadrupeds a tail and ears; all on real bones', () => {
  for (const [rig, chains] of Object.entries(DEFAULT_CHAINS)) {
    const names = boneNames(rig);
    for (const c of chains) {
      for (const b of c.bones) assert.ok(names.includes(b), `${rig}: chain bone ${b}`);
      assert.ok(CHAIN_KINDS.includes(c.kind), `${rig}: chain kind ${c.kind}`);
    }
  }
  const kinds = (rig) => [...new Set(DEFAULT_CHAINS[rig].map((c) => c.kind))].sort();
  assert.deepEqual(kinds('humanoid'), ['cloth', 'hair', 'hem']);
  assert.deepEqual(kinds('quadruped'), ['ear', 'tail']);
  assert.ok(byId.get('hero_a').parts.some((p) => p.bone === 'eyes'), 'the hero blinks (eye parts on the eyes bone)');
  for (const b of ['tail2', 'tail3', 'hemL', 'hemR']) assert.ok(byId.get('hero_a').parts.some((p) => p.bone === b), `hero part on ${b}`);
});

test('wind-ups per attack exist for each creature family, and strikes start from their anticipation key', () => {
  const def = (id) => CLIP_DEFS.find((d) => d.id === id);
  for (const fam of ['humanoid', 'quadruped', 'flyer']) for (const a of ['slam', 'bite', 'ranged']) assert.ok(def(`${fam}.windup_${a}`), `${fam}.windup_${a}`);
  assert.ok(compileClip(def('humanoid.slam')).lead > 0, 'slam has an anticipation key');
  assert.equal(compileClip(def('humanoid.idle')).lead, 0, 'idle has none');
  for (const f of ['ember', 'tempest', 'zenith']) assert.ok(def('humanoid.transform_' + f), 'transformation pose for ' + f);
  for (const s of SPECS) if (s.clips) for (const id of Object.values(s.clips)) assert.ok(def(id), `${s.id} override ${id}`);
});

test('generic villagers get a deterministic look per person', () => {
  const a = villagerLook(17);
  assert.deepEqual(villagerLook(17), a);
  const looks = new Set();
  for (let i = 1; i < 40; i++) looks.add(JSON.stringify(villagerLook(i).palette));
  assert.ok(looks.size >= 12, `variety (${looks.size} looks in 39 people)`);
  for (let i = 1; i < 40; i++) { const k = villagerLook(i).scale; assert.ok(k >= 0.94 && k <= 1.04); }
  for (const k of Object.keys(a.palette)) assert.ok(k in byId.get('npc_villager_1').palette, 'slot ' + k);
});
