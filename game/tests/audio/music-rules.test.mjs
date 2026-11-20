/**
 * Musicality rules of the generative music (ART_UX 9.3), checked on the generated notes: one key and scale per
 * palette, chord tones on the strong beats, consonant layers (no Zenith clash), voice ranges a phone can play,
 * a clear pulse, phrases that resolve, transitions that land on a bar line with a crossfade, and short stingers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMusicGen, stingerNotes, foldShift, PALETTES, COMBAT, LYDIAN_FOURTH } from '../../src/audio/logic/music.js';
import { INSTRUMENTS } from '../../src/audio/logic/instruments.js';
import { createMusic } from '../../src/audio/music.js';

const pc = (m) => ((m % 12) + 12) % 12;
/** Parent scale of each palette: the pentatonic melody of `warm` lives in D major, whose chords use all seven. */
const PARENT = { warm: [0, 2, 4, 5, 7, 9, 11], cold: PALETTES.cold.scale, corrupted: PALETTES.corrupted.scale };
/** Playable ranges (midi) per instrument: leads stay above about 330 Hz, beds and bass below the leads. */
const RANGE = {
  flute: [60, 93], bell: [64, 100], lute: [45, 81], pad: [38, 76], bass: [26, 58], brass: [43, 81], drone: [24, 50], swell: [40, 70],
  drum: [45, 45], rim: [76, 76], shaker: [82, 82],
};
const MELODIC = new Set(['flute', 'bell', 'lute', 'pad', 'bass', 'brass', 'drone', 'swell']);

function state(over) {
  return { mode: 'explore', palette: 'warm', intensity: 0, density: 0.7, night: false, settlement: false, keyShift: 0, lydian: false, parts: 4, ...over };
}

/** Run `bars` bars and hand every bar (notes copied) to `fn(notes, bar, gen)`. */
function run(st, bars, fn, seed = 7) {
  const g = createMusicGen(seed);
  for (let b = 0; b < bars; b++) {
    const before = { phraseLeft: g.phraseLeft, bar: g.bar };
    const n = g.next(st);
    const notes = g.notes.slice(0, n).map((x) => ({ ...x }));
    fn(notes, before, g);
  }
}

const EXPLORE_CASES = [];
for (const palette of ['warm', 'cold', 'corrupted']) {
  for (const night of [false, true]) for (const settlement of [false, true]) EXPLORE_CASES.push(state({ palette, night, settlement, density: night ? 0.3 : 0.8 }));
}

test('chord progressions stay inside their palette scale (one key per palette)', () => {
  for (const id of Object.keys(PALETTES)) {
    for (const ch of PALETTES[id].prog) for (const t of ch) assert.ok(PARENT[id].includes(pc(t)), id + ' chord tone ' + t);
  }
  for (const ch of COMBAT.prog) for (const t of ch) assert.ok(COMBAT.scale.includes(pc(t)), 'combat chord tone ' + t);
});

test('every exploration note is in its palette key; combat notes are in the combat key', () => {
  for (const st of EXPLORE_CASES) {
    const root = PALETTES[st.palette].root;
    run(st, 300, (notes) => {
      for (const n of notes) if (MELODIC.has(n.inst)) assert.ok(PARENT[st.palette].includes(pc(n.midi - root)), st.palette + ' ' + n.inst + ' ' + n.midi);
    });
  }
  for (const mode of ['combat', 'boss']) {
    for (const intensity of [0, 1, 2, 3]) {
      const st = state({ mode, intensity, parts: 8 });
      run(st, 120, (notes) => {
        for (const n of notes) if (MELODIC.has(n.inst)) assert.ok(COMBAT.scale.includes(pc(n.midi - PALETTES.warm.root)), mode + ' ' + n.inst + ' ' + n.midi);
      });
    }
  }
});

test('strong beats carry chord tones (the melody is consonant with the bed)', () => {
  for (const st of EXPLORE_CASES) {
    const P = PALETTES[st.palette];
    run(st, 300, (notes, before) => {
      const chord = P.prog[Math.floor(before.bar / P.barsPerChord) % P.prog.length];
      for (const n of notes) {
        if (n.inst !== 'flute' && n.inst !== 'bell') continue;
        const beat = Math.round(n.t * 100) / 100;
        if (beat !== 0 && beat !== 2) continue;
        assert.ok(chord.some((c) => pc(c) === pc(n.midi - P.root)), st.palette + ' strong-beat ' + n.inst + ' ' + n.midi + ' over ' + chord);
      }
    });
  }
});

test('combat melody: chord tones on strong beats; the Zenith fourth is a weak-beat colour, never against a natural fourth', () => {
  const root = PALETTES.warm.root;
  for (const lydian of [false, true]) {
    let raised = 0;
    run(state({ mode: 'combat', intensity: 3, lydian, parts: 8 }), 200, (notes, before) => {
      const chord = COMBAT.prog[before.bar % COMBAT.prog.length];
      for (const n of notes) {
        if (n.inst !== 'flute') continue;
        const p = pc(n.midi - root);
        if (n.t === 0 || n.t === 2) assert.ok(chord.some((c) => pc(c) === p), 'strong-beat flute ' + p + ' over ' + chord);
        if (p === 6) {
          raised++;
          assert.ok(lydian && !chord.some((c) => pc(c) === 5), 'raised fourth only for Zenith and never over a chord with the natural fourth');
        }
      }
    });
    if (lydian) assert.ok(raised > 0, 'Zenith colours the melody');
  }
  assert.deepEqual(LYDIAN_FOURTH.filter((s) => !COMBAT.scale.includes(s)), [6]);
});

test('voice ranges: every instrument stays in its range for every palette, Form and boss phase', () => {
  const check = (st) => run(st, 200, (notes) => {
    for (const n of notes) {
      const r = RANGE[n.inst];
      assert.ok(r, 'unknown instrument ' + n.inst);
      assert.ok(n.midi >= r[0] && n.midi <= r[1], n.inst + ' ' + n.midi + ' out of ' + r + ' (' + st.mode + ' ' + st.palette + ' shift ' + st.keyShift + ')');
      assert.ok(INSTRUMENTS[n.inst], n.inst + ' is an instrument');
    }
  });
  for (const st of EXPLORE_CASES) check(st);
  for (const palette of ['warm', 'cold', 'corrupted']) {
    for (const form of [0, 5, 7]) {
      for (let phase = 0; phase < 5; phase++) check(state({ mode: 'boss', palette, intensity: 3, keyShift: foldShift(form + phase * 3), parts: 8 }));
    }
  }
  for (let s = -20; s <= 30; s++) assert.ok(foldShift(s) >= -5 && foldShift(s) <= 6 && pc(foldShift(s) - s) === 0);
});

test('a clear pulse: every combat bar starts with the drum on beat 1, and notes fall inside their bar', () => {
  for (const intensity of [0, 1, 2, 3]) {
    run(state({ mode: 'combat', intensity }), 64, (notes) => {
      assert.ok(notes.some((n) => n.inst === 'drum' && n.t === 0), 'kick on beat 1');
      assert.ok(notes.some((n) => n.inst === 'rim' && n.t === 2), 'rim on beat 3');
      for (const n of notes) assert.ok(n.t >= 0 && n.t < 4, 'note at beat ' + n.t);
    });
  }
  for (const st of EXPLORE_CASES) {
    run(st, 100, (notes) => {
      for (const n of notes) assert.ok(n.t >= 0 && n.t < 4 * PALETTES[st.palette].barsPerChord, 'note at beat ' + n.t);
    });
  }
});

test('phrases end on a long note on the tonic or the chord root', () => {
  for (const st of EXPLORE_CASES) {
    const P = PALETTES[st.palette];
    let ends = 0;
    run(st, 400, (notes, before) => {
      if (before.phraseLeft !== 1) return;
      const chord = P.prog[Math.floor(before.bar / P.barsPerChord) % P.prog.length];
      const ok = notes.some((n) => (n.inst === 'flute' || n.inst === 'bell') && n.t > 0.9 && n.t < 1.1 && n.dur >= 2.5
        && (pc(n.midi - P.root) === 0 || pc(n.midi - P.root) === pc(chord[0])));
      assert.ok(ok, st.palette + (st.night ? ' night' : ' day') + ': the phrase ending at bar ' + before.bar + ' resolves');
      ends++;
    });
    assert.ok(ends >= 3, 'phrases end (' + ends + ')');
  }
});

test('stingers: level-up, quest complete, boss defeated and the finisher are short and consonant', () => {
  const out = [];
  for (let i = 0; i < 32; i++) out.push({ t: 0, dur: 0, inst: '', midi: 0, vel: 0 });
  const MAJOR = [0, 4, 7];
  for (const [id, maxLen, pcs] of [['levelUp', 4.5, MAJOR], ['questComplete', 4.5, MAJOR], ['victory', 4.5, MAJOR], ['finisher', 1.6, [0, 7]]]) {
    const n = stingerNotes(id, 62, out);
    assert.ok(n > 0, id + ' has notes');
    let end = 0;
    for (let i = 0; i < n; i++) {
      const o = out[i];
      end = Math.max(end, o.t + o.dur);
      if (MELODIC.has(o.inst)) assert.ok(pcs.includes(pc(o.midi - 62)), id + ' note ' + o.midi + ' is a chord tone');
    }
    assert.ok(end <= maxLen, id + ' lasts ' + end.toFixed(2) + ' s (max ' + maxLen + ')');
  }
});

// ------------------------------------------------------------------ the scheduler with a mock engine

function mockEngine() {
  const calls = [];
  const param = (name) => ({
    value: 0,
    setTargetAtTime(v, t, tc) { calls.push({ name, v, t, tc }); this.value = v; },
    cancelScheduledValues() {},
  });
  const ac = { currentTime: 0, state: 'running', createGain() { return { gain: param('note'), connect() {}, disconnect() {} }; }, createBufferSource() { return null; } };
  return {
    calls, ac, ready: true, tier: 'low', samples: {},
    bus: { explore: { gain: param('explore') }, combat: { gain: param('combat') }, duck: { gain: param('duck') } },
    canAfford() { return true; }, addNodes() {},
  };
}

test('transitions: combat starts on a bar line of its own on the exploration pulse, crossfades over about 2 s, and leaves on a bar after a 4 s tail', () => {
  const eng = mockEngine();
  const music = createMusic({ flags: { seed: 3 }, env: { phase: 'day' } }, eng);
  const bars = [];
  let lastBar = -1;
  const step = (until) => {
    while (eng.ac.currentTime < until) {
      eng.ac.currentTime += 0.02;
      music.frame();
      const b = music.state().bar;
      if (b !== lastBar) { lastBar = b; bars.push(eng.ac.currentTime); }
    }
  };
  step(10);
  const before = eng.calls.length;
  music.set({ mode: 'combat', intensity: 2 });
  step(16);
  const toCombat = eng.calls.slice(before).filter((c) => c.name === 'combat' && c.v > 0);
  assert.equal(toCombat.length, 1, 'one crossfade into combat');
  const T = toCombat[0].t;
  assert.ok(T >= 10 && T < 10 + 60 / PALETTES.warm.bpm + 0.2, 'combat begins within one exploration beat (' + T.toFixed(2) + ')');
  // the switch time is a beat of the exploration bars (they start 0.1 s after the first frame at 0.02 s)
  const beat = 60 / PALETTES.warm.bpm;
  const beats = (T - 0.12) / beat;
  assert.ok(Math.abs(beats - Math.round(beats)) < 0.01, 'on an exploration beat (' + beats.toFixed(3) + ')');
  // a time constant of 0.6 s: 95 % of the way in 1.8 s
  assert.ok(Math.abs(toCombat[0].tc * 3 - 1.8) < 0.01, 'about a 2 s crossfade');
  assert.equal(music.state().mode, 'combat');
  const leave = eng.ac.currentTime;
  music.set({ mode: 'explore' });
  const mark = eng.calls.length;
  step(leave + 8);
  const back = eng.calls.slice(mark).filter((c) => c.name === 'explore' && c.v > 0);
  assert.equal(back.length, 1, 'one crossfade back');
  assert.ok(back[0].t - leave >= 4, 'a 4 s combat tail (' + (back[0].t - leave).toFixed(2) + ')');
  const combatBars = (back[0].t - T) / (4 * 60 / COMBAT.bpm);
  assert.ok(Math.abs(combatBars - Math.round(combatBars)) < 0.01, 'the tail ends on a combat bar line (' + combatBars.toFixed(3) + ' bars)');
  assert.equal(music.state().mode, 'explore');
});

test('the exploration layer fades in on the first frame instead of starting at full gain', () => {
  const eng = mockEngine();
  const music = createMusic({ flags: { seed: 3 }, env: { phase: 'day' } }, eng);
  eng.ac.currentTime = 1;
  music.frame();
  const ex = eng.calls.find((c) => c.name === 'explore');
  assert.ok(ex && ex.v > 0 && ex.v < 1 && ex.tc > 0.1, 'explore layer set by a fade to its mix level');
});
