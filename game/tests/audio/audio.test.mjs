/**
 * Audio package Node tests (ARCHITECTURE 8.2 Definition of Done): every IDS.sfx id has a recipe, the step mapping
 * covers all five surfaces, voice limits and stealing with a mock AudioContext, the 120-node budget, and the
 * music pattern generator is deterministic for a seed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { IDS } from '../../src/core/ids.js';
import { createRng } from '../../src/core/rng.js';
import { RECIPES, CAPS, renderRecipe } from '../../src/audio/logic/recipes.js';
import { INSTRUMENTS, INSTRUMENT_IDS, renderInstrument, sampleFor } from '../../src/audio/logic/instruments.js';
import { createSlot, pickSlot, findMerge, STEP_SURFACE, HIT_CLASS, distanceGain, distanceCutoff } from '../../src/audio/logic/voices.js';
import { createMusicGen, stingerNotes, PALETTES, COMBAT } from '../../src/audio/logic/music.js';
import { LIVE_IDS } from '../../src/audio/loops.js';
import { createEngine, NODE_BUDGET } from '../../src/audio/engine.js';

// ------------------------------------------------------------------ mock WebAudio

function param(v = 0) {
  return {
    value: v,
    setValueAtTime(x) { this.value = x; return this; },
    setTargetAtTime(x) { this.value = x; return this; },
    linearRampToValueAtTime(x) { this.value = x; return this; },
    exponentialRampToValueAtTime(x) { this.value = x; return this; },
    cancelScheduledValues() { return this; },
  };
}

function createMockContext() {
  const stats = { created: 0, oscillators: 0, sources: 0 };
  const node = (extra) => {
    stats.created++;
    return { connect() {}, disconnect() {}, ...extra };
  };
  const ac = {
    state: 'running',
    sampleRate: 48000,
    currentTime: 0,
    destination: { connect() {}, disconnect() {} },
    listener: {},
    stats,
    resume() { return Promise.resolve(); },
    suspend() { return Promise.resolve(); },
    close() { return Promise.resolve(); },
    createGain: () => node({ gain: param(1) }),
    createDynamicsCompressor: () => node({ threshold: param(), ratio: param(), attack: param(), release: param(), knee: param() }),
    createBiquadFilter: () => node({ type: 'lowpass', frequency: param(350), Q: param(1) }),
    createDelay: () => node({ delayTime: param() }),
    createConvolver: () => node({ buffer: null }),
    createStereoPanner: () => node({ pan: param() }),
    createWaveShaper: () => node({ curve: null }),
    createOscillator() {
      stats.oscillators++;
      return node({ type: 'sine', frequency: param(440), start() {}, stop() {} });
    },
    createBufferSource() {
      stats.sources++;
      return node({ buffer: null, loop: false, playbackRate: param(1), onended: null, start() {}, stop() {} });
    },
    createBuffer(ch, n, sr) {
      const data = [];
      for (let i = 0; i < ch; i++) data.push(new Float32Array(n));
      return { duration: n / sr, length: n, sampleRate: sr, getChannelData: (i) => data[i], copyToChannel(d, i) { data[i].set(d); } };
    },
  };
  return ac;
}

function mockCtx(tier = 'low') {
  return {
    flags: { seed: 7 },
    save: { settings: { volMaster: 0.8, volMusic: 0.7, volSfx: 0.9 } },
    render: { tier },
    rng: createRng({ seed: 7 }),
    log: { warn() {} },
    ents: { get: () => null },
  };
}

let shared = null;
function engineWithMock(tier = 'low') {
  const ac = createMockContext();
  const e = createEngine(mockCtx(tier), { makeContext: () => ac, sync: true, noWindow: true });
  e.unlock();
  return { e, ac };
}

// ------------------------------------------------------------------ recipes

test('every IDS.sfx id has a recipe, and every recipe is a catalog id', () => {
  for (const id of IDS.sfx) assert.ok(RECIPES[id], 'recipe for ' + id);
  for (const id of Object.keys(RECIPES)) assert.ok(IDS.sfx.includes(id), id + ' is in IDS.sfx');
});

test('live loops are exactly the four _loop ids; every other recipe renders finite, audible, normalised audio', () => {
  const live = IDS.sfx.filter((id) => RECIPES[id].live);
  assert.deepEqual(live.sort(), ['beam_loop', 'gather_loop', 'siphon_loop', 'wind_loop']);
  for (const id of live) assert.ok(LIVE_IDS.includes(id));
  for (const id of IDS.sfx) {
    if (RECIPES[id].live) {
      assert.equal(renderRecipe(id, 0), null);
      continue;
    }
    for (let v = 0; v < 3; v++) {
      const b = renderRecipe(id, v);
      assert.ok(b && b.length > 100, id + ' renders');
      let peak = 0;
      let sum = 0;
      for (let i = 0; i < b.length; i++) {
        assert.ok(Number.isFinite(b[i]), id + ' finite');
        peak = Math.max(peak, Math.abs(b[i]));
        sum += b[i] * b[i];
      }
      assert.ok(peak > 0.5 && peak <= 0.95, id + ' peak ' + peak);
      assert.ok(Math.sqrt(sum / b.length) > 0.005, id + ' is audible');
    }
  }
});

test('variants differ and rendering is deterministic', () => {
  const a = renderRecipe('hit_light', 0);
  const b = renderRecipe('hit_light', 0);
  const c = renderRecipe('hit_light', 1);
  assert.deepEqual(a, b);
  let diff = 0;
  for (let i = 0; i < Math.min(a.length, c.length); i++) diff += Math.abs(a[i] - c[i]);
  assert.ok(diff > 1, 'variant 1 differs from variant 0');
});

test('instruments render and map notes to the nearest sample', () => {
  for (const id of INSTRUMENT_IDS) {
    for (let i = 0; i < INSTRUMENTS[id].bases.length; i++) {
      const b = renderInstrument(id, i);
      let peak = 0;
      for (let k = 0; k < b.length; k++) peak = Math.max(peak, Math.abs(b[k]));
      assert.ok(peak > 0.5, id + ' sample ' + i);
    }
  }
  const o = sampleFor('flute', 81, { index: 0, rate: 0 });
  assert.equal(o.index, 1);
  assert.equal(o.rate, 1);
  sampleFor('flute', 74, o);
  assert.ok(Math.abs(o.rate - Math.pow(2, 5 / 12)) < 1e-9);
});

// ------------------------------------------------------------------ mapping

test('the step mapping covers all five surfaces (sand = grass at pitch 0.7)', () => {
  for (const s of ['grass', 'stone', 'snow', 'water', 'sand']) {
    assert.ok(STEP_SURFACE[s], s);
    assert.ok(RECIPES[STEP_SURFACE[s][0]], s + ' maps to a recipe');
  }
  assert.deepEqual([...STEP_SURFACE.sand], ['step_grass', 0.7]);
  assert.deepEqual([...STEP_SURFACE.stone], ['step_stone', 1]);
});

test('hit classes map to recipes', () => {
  for (const k of Object.keys(HIT_CLASS)) {
    assert.ok(IDS.feel.includes(k), k + ' is a feel class');
    assert.ok(RECIPES[HIT_CLASS[k]], HIT_CLASS[k]);
  }
  for (const k of ['lightHit', 'heavyHit', 'finisher', 'boltHit']) assert.ok(HIT_CLASS[k]);
});

test('distance gain and lowpass follow ART_UX 9.1', () => {
  assert.equal(distanceGain(0), 1);
  assert.ok(Math.abs(distanceGain(15) - 0.5) < 1e-12);
  assert.ok(Math.abs(distanceCutoff(0) - 18000) < 1e-6);
  assert.ok(Math.abs(distanceCutoff(150) - 2000) < 1e-6);
});

// ------------------------------------------------------------------ voice logic

test('pickSlot: free slots first, caps steal within their group, a full pool steals the oldest and quietest', () => {
  const slots = [];
  for (let i = 0; i < 6; i++) slots.push(createSlot());
  const busy = (i, cap, start, vol) => Object.assign(slots[i], { id: i + 1, sfx: 'x' + i, cap, start, end: start + 1, vol });
  assert.equal(pickSlot(slots, 6, null, 99, 0, 1), 0);
  busy(0, 'bolt', 0, 1);
  busy(1, 'bolt', 0.5, 1);
  // cap 2 reached: steal the older bolt
  assert.equal(pickSlot(slots, 6, 'bolt', 2, 0.6, 1), 0);
  // under the cap: free slot
  assert.equal(pickSlot(slots, 6, 'bolt', 3, 0.6, 1), 2);
  busy(2, null, 0.55, 0.1);
  busy(3, null, 0.58, 1);
  busy(4, null, 0.59, 1);
  busy(5, null, 0.595, 1);
  // full: the quiet one (slot 2) scores higher than the equally old loud ones
  assert.equal(pickSlot(slots, 6, null, 99, 0.6, 1), 2);
  // merge window
  slots[3].sfx = 'hit_light';
  assert.equal(findMerge(slots, 6, 'hit_light', 0.6), 3);
  assert.equal(findMerge(slots, 6, 'hit_light', 0.7), -1);
});

test('engine with a mock context: voice limit per tier, per-recipe caps, merges, no oscillators for one-shots, node budget', () => {
  const { e, ac } = engineWithMock('low');
  shared = { e, ac };
  assert.equal(e.pending(), 0, 'everything rendered synchronously');
  assert.equal(e.variants('hit_light'), 2, 'two variants on low');
  const osc0 = ac.stats.oscillators;
  // 10 bolts at once: same-id merge inside 30 ms
  const ids = [];
  for (let i = 0; i < 10; i++) ids.push(e.play('bolt_fire'));
  assert.equal(new Set(ids).size, 1, 'same-id sounds within 30 ms merge');
  // spread over time: the bolt group stays at its cap of 6
  for (let i = 0; i < 20; i++) {
    ac.currentTime += 0.04;
    assert.ok(e.play(i % 2 ? 'bolt_fire' : 'bolt_hit') > 0);
  }
  const slots = e.debugSlots();
  const bolts = slots.filter((s) => s.id !== 0 && s.cap === 'bolt').length;
  assert.equal(bolts, CAPS.bolt, 'bolt cap');
  // flood with many different sounds: never more than 24 voices on low, nodes within budget
  const all = Object.keys(RECIPES).filter((id) => !RECIPES[id].live);
  for (let i = 0; i < 300; i++) {
    ac.currentTime += 0.011;
    e.play(all[i % all.length], { x: (i % 7) * 3, y: 0, z: 5 });
    assert.ok(e.voices() <= 24, 'voices ' + e.voices());
    assert.ok(e.nodes() <= NODE_BUDGET, 'nodes ' + e.nodes());
  }
  assert.equal(e.voices(), 24, 'the pool is saturated');
  assert.equal(ac.stats.oscillators, osc0, 'one-shots create no oscillator');
  // live loops fit in the budget by stealing one-shots
  const l1 = e.loop('beam_loop');
  const l2 = e.loop('wind_loop');
  assert.ok(l1 > 0 && l2 > 0);
  assert.ok(e.nodes() <= NODE_BUDGET, 'nodes with loops ' + e.nodes());
  e.stop(l1, 0.1);
  e.stop(l2, 0.1);
  ac.currentTime += 1;
  e.frame({ three: null });
  assert.equal(e.voices() <= 24, true);
});

test('engine: high tier has 32 voices and 3 variants; noaudio creates no context', () => {
  const { e } = engineWithMock('high');
  assert.equal(e.variants('hit_heavy'), 3);
  const all = Object.keys(RECIPES).filter((id) => !RECIPES[id].live);
  let t = 0;
  for (let i = 0; i < 200; i++) {
    t += 0.011;
    e.ac.currentTime = t;
    e.play(all[i % all.length]);
  }
  assert.ok(e.voices() <= 32);
  assert.ok(e.nodes() <= NODE_BUDGET);
  let made = 0;
  const off = createEngine({ ...mockCtx(), flags: { noaudio: true } }, { makeContext: () => { made++; return createMockContext(); }, noWindow: true });
  off.unlock();
  assert.equal(made, 0);
  assert.equal(off.ready, false);
  assert.equal(off.play('hit_light'), 0);
  assert.equal(off.nodes(), 0);
});

test('engine: stopping a voice and the onended release return the nodes', () => {
  const { e, ac } = shared || engineWithMock('low');
  ac.currentTime += 10;
  const slots = e.debugSlots();
  for (const s of slots) if (s.src && s.src.onended) s.src.onended.call(s.src);
  assert.equal(slots.filter((s) => s.id !== 0 && !s.loop).length, 0, 'ended voices are released');
});

// ------------------------------------------------------------------ music

/** @param {any} st @param {number} seed @param {number} bars */
function run(st, seed, bars) {
  const g = createMusicGen(seed);
  const out = [];
  for (let b = 0; b < bars; b++) {
    const n = g.next(st);
    for (let i = 0; i < n; i++) {
      const x = g.notes[i];
      out.push([b, x.t, x.dur, x.inst, x.midi, x.vel]);
    }
  }
  return out;
}

const EXPLORE = { mode: 'explore', palette: 'warm', intensity: 0, density: 0.7, night: false, settlement: false, keyShift: 0, lydian: false, parts: 4 };

test('music pattern generator is deterministic for a seed', () => {
  for (const palette of ['warm', 'cold', 'corrupted']) {
    const st = { ...EXPLORE, palette };
    const a = run(st, 1234, 48);
    const b = run(st, 1234, 48);
    assert.ok(a.length > 20, palette + ' produces notes');
    assert.deepEqual(a, b, palette + ': same note list twice');
    assert.notDeepEqual(a, run(st, 99, 48), palette + ': another seed gives other music');
  }
  const c = { ...EXPLORE, mode: 'combat', intensity: 3 };
  assert.deepEqual(run(c, 5, 16), run(c, 5, 16));
});

test('exploration melodies stay in the scale; phrases leave rests; night is sparser', () => {
  for (const palette of ['warm', 'cold', 'corrupted']) {
    const P = PALETTES[palette];
    const notes = run({ ...EXPLORE, palette }, 42, 64);
    for (const n of notes) {
      if (n[3] !== 'flute' && n[3] !== 'bell') continue;
      const pc = (((n[4] - P.root) % 12) + 12) % 12;
      assert.ok(P.scale.includes(pc), palette + ' melody note ' + n[4] + ' in scale');
    }
    // bars with no melodic note exist (rests between phrases)
    const melodicBars = new Set(notes.filter((n) => n[3] === 'flute' || n[3] === 'bell').map((n) => n[0]));
    assert.ok(melodicBars.size < 64 && melodicBars.size > 4, palette + ' has phrases and rests (' + melodicBars.size + ' / 64 bars)');
  }
  const day = run({ ...EXPLORE, density: 0.7 }, 3, 64).length;
  const night = run({ ...EXPLORE, density: 0.3, night: true }, 3, 64).length;
  assert.ok(night < day, 'night (' + night + ') is sparser than day (' + day + ')');
});

test('combat layers enter with intensity; low tier caps the parts', () => {
  const parts = (intensity) => new Set(run({ ...EXPLORE, mode: 'combat', intensity, parts: 8 }, 8, 8).map((n) => n[3]));
  assert.ok(parts(0).has('drum') && !parts(0).has('bass'));
  assert.ok(parts(1).has('bass') && !parts(1).has('brass'));
  assert.ok(parts(2).has('brass') && !parts(2).has('flute'));
  assert.ok(parts(3).has('flute'));
  const g = createMusicGen(1);
  assert.equal(g.bpm({ ...EXPLORE, mode: 'combat' }), COMBAT.bpm);
  assert.equal(g.bpm({ ...EXPLORE, mode: 'boss' }), COMBAT.bossBpm);
  assert.equal(g.bpm({ ...EXPLORE, settlement: true }), PALETTES.warm.bpm + 8);
});

test('stingers produce notes for every contract id', () => {
  const buf = [];
  for (let i = 0; i < 32; i++) buf.push({ t: 0, dur: 0, inst: '', midi: 0, vel: 0 });
  for (const id of ['transform', 'levelUp', 'questComplete', 'discover', 'death', 'milestone', 'bossIntro', 'victory']) {
    const n = stingerNotes(id, 62, buf);
    assert.ok(n >= 3, id);
    for (let i = 0; i < n; i++) assert.ok(INSTRUMENTS[buf[i].inst], id + ' uses instrument ' + buf[i].inst);
  }
});
