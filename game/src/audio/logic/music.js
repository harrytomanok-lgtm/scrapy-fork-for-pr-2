/**
 * Adaptive generative music (ART_UX 9.3), pure and deterministic for a seed. A generator produces one bar at a
 * time for the requested state: three exploration palettes (warm D major pentatonic 84 BPM, cold B Dorian 58 BPM,
 * corrupted C sharp minor with a raised fourth 64 BPM) with a slow chord cycle, soft pads, sparse melodic phrases
 * built from a repeated motif and separated by 8-20 s of rest (shorter by day, longer at night), and the combat
 * layer (132 BPM, 140 for bosses) whose parts enter with intensity 0-3: drums; bass; brass stabs; flute.
 * Notes carry beat times within the bar; the scheduler turns them into context time.
 * @module audio/logic/music
 */

import { createStream } from '../../core/rng.js';

/**
 * @typedef {object} Palette
 * @property {number} root      midi of the tonic (melody octave)
 * @property {number[]} scale   semitones of the scale
 * @property {number} bpm
 * @property {number[][]} prog  chords as semitones from the root
 * @property {number} barsPerChord
 */

/** @type {Record<string, Palette>} */
export const PALETTES = {
  warm: { root: 62, scale: [0, 2, 4, 7, 9], bpm: 84, barsPerChord: 2, prog: [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [0, 4, 7], [-3, 0, 4], [5, 9, 12], [7, 11, 14], [0, 4, 7]] },
  cold: { root: 59, scale: [0, 2, 3, 5, 7, 9, 10], bpm: 58, barsPerChord: 1, prog: [[0, 3, 7], [5, 9, 12], [0, 3, 7], [-2, 2, 5], [0, 3, 7], [5, 9, 12], [3, 7, 10], [-2, 2, 5]] },
  corrupted: { root: 61, scale: [0, 2, 3, 6, 7, 8, 10], bpm: 64, barsPerChord: 2, prog: [[0, 3, 7], [-4, 0, 3], [0, 3, 7], [-6, -2, 2]] },
};

/** Combat layer: same key as the palette, natural minor with the flat sixth for tension. */
export const COMBAT = { scale: [0, 2, 3, 5, 7, 8, 10], bpm: 132, bossBpm: 140, prog: [[0, 3, 7], [0, 3, 7], [-4, 0, 3], [-2, 2, 5]] };

/** Density by day phase (ART_UX 9.3). */
export const DENSITY = Object.freeze({ dawn: 0.4, day: 0.7, golden: 0.8, dusk: 0.5, night: 0.3 });

/** Semitone shift of the combat layer per Form (Ember +0, Tempest +5, Zenith +7 with a Lydian fourth). */
export const FORM_SHIFT = Object.freeze({ ember: 0, tempest: 5, zenith: 7 });

/**
 * @typedef {object} MusicState
 * @property {'explore'|'combat'|'boss'|'silent'} mode
 * @property {'warm'|'cold'|'corrupted'} palette
 * @property {number} intensity   0..3
 * @property {number} density     0..1
 * @property {boolean} night
 * @property {boolean} settlement
 * @property {number} keyShift    semitones (Form, boss phase)
 * @property {boolean} lydian     raise the fourth (Zenith)
 * @property {number} parts       max simultaneous parts (4 on low)
 */

/** @typedef {{ t:number, dur:number, inst:string, midi:number, vel:number }} Note */

/** Melodic rhythm templates: [beat, length] pairs within a 4-beat bar. */
const RHYTHMS = [
  [[0, 1.5], [1.5, 0.5], [2, 2]],
  [[0, 1], [1, 1], [2, 1.5], [3.5, 0.5]],
  [[0, 3], [3, 1]],
  [[0.5, 0.5], [1, 1], [2, 2]],
  [[0, 2], [2, 1], [3, 1]],
  [[0, 1], [1, 0.5], [1.5, 0.5], [2, 2]],
];
const END_RHYTHM = [[0, 1], [1, 3]];
const SLOW_RHYTHMS = [[[0, 4]], [[0, 2], [2, 2]], [[0, 3], [3, 1]]];
const ARP = [[0, 1, 2, 1, 0, 1, 2, 1], [0, 2, 1, 2, 0, 2, 1, 2]];
const BASS_PAT = [0, 0, 7, 0, 0, 7, 0, 12];
const STABS = [[0, 2.5], [0, 2.5, 3.5]];
/** Zenith colour: the combat minor scale with its fourth raised (a "Lydian fourth" over the minor chords). */
export const LYDIAN_FOURTH = [0, 2, 3, 6, 7, 8, 10];
const ROOT_ONLY = [0];

/** @param {number[]} chord @param {number} pc @returns {boolean} the chord holds pitch class `pc` (semitones from the root) */
function hasPc(chord, pc) {
  for (let i = 0; i < chord.length; i++) if ((((chord[i] - pc) % 12) + 12) % 12 === 0) return true;
  return false;
}

/**
 * Fold a key shift (Form plus boss phases) into -5..+6 semitones so modulations never walk the voices out of
 * their ranges. @param {number} s @returns {number}
 */
export function foldShift(s) {
  return ((((s + 5) % 12) + 12) % 12) - 5;
}

/** @returns {Note} */
function note() {
  return { t: 0, dur: 0, inst: '', midi: 0, vel: 0 };
}

/**
 * Create a bar generator.
 * @param {number} seed
 */
export function createMusicGen(seed) {
  const rng = createStream(seed >>> 0);
  /** @type {Note[]} */
  const pool = [];
  for (let i = 0; i < 64; i++) pool.push(note());
  const gen = {
    bar: 0,
    count: 0,
    phraseLeft: 0,
    phraseLen: 0,
    restLeft: 1,
    motif: 0,
    /** last melodic pitch as a scale step index */
    step: 7,
    /** motif steps of the current phrase (relative to the chord) */
    motifSteps: [0, 0, 0, 0, 0, 0],
    lastMode: '',
    /** @type {Note[]} */
    notes: pool,

    /** @param {number} s */
    reset(s) {
      rng.reset(s >>> 0);
      gen.bar = 0;
      gen.phraseLeft = 0;
      gen.restLeft = 1;
      gen.step = 7;
      gen.lastMode = '';
    },

    /** @param {MusicState} st @returns {number} BPM of the next bar */
    bpm(st) {
      if (st.mode === 'boss') return COMBAT.bossBpm;
      if (st.mode === 'combat') return COMBAT.bpm;
      return PALETTES[st.palette].bpm + (st.settlement ? 8 : 0);
    },

    /**
     * Generate the next bar into `gen.notes[0..count)`.
     * @param {MusicState} st @returns {number} note count
     */
    next(st) {
      gen.count = 0;
      if (st.mode !== gen.lastMode) {
        if (st.mode === 'explore') { gen.phraseLeft = 0; gen.restLeft = 1; }
        gen.lastMode = st.mode;
      }
      if (st.mode === 'combat' || st.mode === 'boss') combatBar(st);
      else if (st.mode === 'explore') exploreBar(st);
      gen.bar++;
      return gen.count;
    },
  };

  /** @param {number} t @param {number} dur @param {string} inst @param {number} midi @param {number} vel */
  function push(t, dur, inst, midi, vel) {
    if (gen.count >= pool.length) return;
    const n = pool[gen.count++];
    n.t = t; n.dur = dur; n.inst = inst; n.midi = midi; n.vel = Math.max(0.05, Math.min(1, vel));
  }

  /** Midi of scale step `k` (any integer, octaves wrap) from `root`. @param {number[]} scale @param {number} root @param {number} k */
  function stepMidi(scale, root, k) {
    const n = scale.length;
    const oct = Math.floor(k / n);
    const i = k - oct * n;
    return root + oct * 12 + scale[i];
  }

  /** Nearest scale step to `midi` that is a chord tone. */
  function nearestChordStep(scale, root, chord, fromStep) {
    let best = fromStep;
    let bestD = 99;
    for (let d = -4; d <= 4; d++) {
      const k = fromStep + d;
      const m = stepMidi(scale, root, k);
      const pc = ((m - root) % 12 + 12) % 12;
      for (let c = 0; c < chord.length; c++) {
        if (((chord[c] % 12) + 12) % 12 === pc && Math.abs(d) < bestD) { bestD = Math.abs(d); best = k; }
      }
    }
    return best;
  }

  /** @param {MusicState} st */
  function exploreBar(st) {
    const P = PALETTES[st.palette];
    const root = P.root + st.keyShift;
    const ci = Math.floor(gen.bar / P.barsPerChord) % P.prog.length;
    const chord = P.prog[ci];
    const chordStart = gen.bar % P.barsPerChord === 0;
    const barSec = 240 / gen.bpm(st);
    const d = st.density;
    const pal = st.palette;
    let parts = 0;

    // phrase state
    let inPhrase = false;
    if (gen.phraseLeft > 0) inPhrase = true;
    else if (gen.restLeft > 0) gen.restLeft--;
    if (!inPhrase && gen.restLeft <= 0) {
      gen.phraseLen = rng.next() < 0.6 ? 2 : 4;
      gen.phraseLeft = gen.phraseLen;
      gen.motif = rng.int(0, RHYTHMS.length - 1);
      for (let i = 0; i < 6; i++) gen.motifSteps[i] = rng.int(-2, 2);
      inPhrase = true;
    }
    const phraseBar = inPhrase ? gen.phraseLen - gen.phraseLeft : -1;

    // pad / drone bed: always during phrases, by density during rests (silence at night)
    const padOn = pal === 'cold' && st.night ? false : inPhrase || rng.next() < d * 0.8;
    if (pal === 'corrupted') {
      if (chordStart && parts < st.parts) {
        push(0, 4 * P.barsPerChord, 'drone', root - 24 + chord[0], 0.55 + 0.2 * d);
        parts++;
      }
      if (!st.night && chordStart && rng.next() < 0.5 && parts < st.parts) {
        push(4 * P.barsPerChord - 2.5, 2.5, 'swell', root - 12 + P.prog[(ci + 1) % P.prog.length][0], 0.5);
        parts++;
      }
    } else if (padOn && chordStart && parts < st.parts) {
      const len = 4 * P.barsPerChord;
      const v = (pal === 'cold' ? 0.45 : 0.5) * (0.7 + 0.3 * d);
      for (let c = 0; c < chord.length; c++) push(0.02 * c, len, 'pad', root - 12 + chord[c], v * (c === 0 ? 1 : 0.8));
      parts++;
    }

    // bass pulses (corrupted day)
    if (pal === 'corrupted' && !st.night && parts < st.parts) {
      const b = root - 24 + chord[0];
      push(0, 1.5, 'bass', b, 0.55);
      if (rng.next() < d) push(2.5, 1, 'bass', b, 0.4);
      parts++;
    }

    // lead phrase
    if (inPhrase) {
      let lead = 'flute';
      if (pal === 'cold') lead = st.night ? 'bell' : (rng.next() < 0.5 ? 'bell' : 'flute');
      else if (pal === 'corrupted') lead = 'bell';
      else if (st.night) lead = rng.next() < 0.4 ? 'flute' : 'bell';
      const sparse = st.night || pal === 'cold' || pal === 'corrupted';
      const last = gen.phraseLeft === 1;
      const tpl = last ? END_RHYTHM : sparse ? SLOW_RHYTHMS[gen.motif % SLOW_RHYTHMS.length] : RHYTHMS[gen.motif];
      // the lead sits above 440 Hz, where a phone speaker still plays it (cold's tonic B3 would sit below)
      const leadRoot = lead === 'bell' || root < 61 ? root + 12 : root;
      // first note of each bar: chord tone near the current step; then the motif contour
      let k = nearestChordStep(P.scale, leadRoot, chord, gen.step);
      if (parts < st.parts) {
        for (let i = 0; i < tpl.length; i++) {
          const beat = tpl[i][0];
          const len = tpl[i][1];
          if (i > 0) {
            k += gen.motifSteps[i % 6] + (phraseBar >= 2 && i === 1 ? 1 : 0);
            if (beat === 2 || beat === 0) k = nearestChordStep(P.scale, leadRoot, chord, k);
          }
          if (last && i === tpl.length - 1) {
            // resolve to the tonic when the chord holds it, else to the chord root
            ROOT_ONLY[0] = hasPc(chord, 0) ? 0 : chord[0];
            k = nearestChordStep(P.scale, leadRoot, ROOT_ONLY, k);
          }
          const lo = P.scale.length * 0;
          const hi = P.scale.length * 2 - 1;
          if (k < lo) k += P.scale.length;
          if (k > hi) k -= P.scale.length;
          if (sparse && i > 0 && !(last && i === tpl.length - 1) && rng.next() > 0.55 + 0.4 * d) continue;
          const t = beat + (i > 0 ? rng.range(-0.02, 0.03) : 0);
          push(t, len * (lead === 'bell' ? 1.6 : 0.95), lead, stepMidi(P.scale, leadRoot, k), (beat === 0 ? 0.72 : 0.6) + rng.range(-0.06, 0.06));
        }
        gen.step = k;
        parts++;
      }
      gen.phraseLeft--;
      if (gen.phraseLeft === 0) {
        const restSec = 20 - 12 * d;
        gen.restLeft = Math.max(1, Math.round(restSec / barSec));
      }
    }

    // lute arpeggio (warm day, settlements)
    const luteOn = (pal === 'warm' && !st.night && inPhrase && rng.next() < 0.75) || (st.settlement && !st.night && (inPhrase || rng.next() < d * 0.5));
    if (luteOn && parts < st.parts) {
      const pat = rng.next() < 0.5 ? 0 : 1;
      for (let i = 0; i < 8; i++) {
        if (rng.next() > 0.45 + 0.5 * d) continue;
        const c = ARP[pat][i];
        const lm = root - 12 + chord[c] + (i === 4 && pat === 1 ? 12 : 0);
        // chords below the tonic fold up an octave: a lute string under C3 is mud on a phone
        push(i * 0.5, 0.9, 'lute', lm < 48 ? lm + 12 : lm, 0.42 + (i % 2 === 0 ? 0.08 : 0));
      }
      parts++;
    }

    // night bells / lantern bell in settlements
    if (st.night && (st.settlement || pal === 'warm') && parts < st.parts && rng.next() < 0.5) {
      push(rng.int(0, 3), 3, 'bell', root + 12 + chord[rng.int(0, chord.length - 1)], 0.38);
      parts++;
    }

    // shaker in settlements by day
    if (st.settlement && !st.night && parts < st.parts) {
      for (let i = 0; i < 8; i++) push(i * 0.5, 0.25, 'shaker', 82, i % 2 === 0 ? 0.45 : 0.3);
      parts++;
    }
  }

  /** @param {MusicState} st */
  function combatBar(st) {
    const boss = st.mode === 'boss';
    const intensity = boss ? 3 : Math.max(0, Math.min(3, Math.round(st.intensity)));
    const root = PALETTES[st.palette].root + st.keyShift;
    const ci = gen.bar % COMBAT.prog.length;
    const chord = COMBAT.prog[ci];
    const scale = COMBAT.scale;
    let parts = 0;

    // drums: kick on 1 and 2.5, rim on 3, sixteenth shaker
    push(0, 0.5, 'drum', 45, 0.95);
    push(1.5, 0.5, 'drum', 45, 0.75);
    if (boss) { push(3, 0.5, 'drum', 45, 0.7); push(3.5, 0.5, 'drum', 45, 0.6); }
    push(2, 0.25, 'rim', 76, 0.7);
    const sixteenth = st.parts > 4 || intensity >= 1;
    for (let i = 0; i < (sixteenth ? 16 : 8); i++) {
      const b = sixteenth ? i * 0.25 : i * 0.5;
      push(b, 0.12, 'shaker', 82, (b % 1 === 0 ? 0.55 : 0.32) + rng.range(-0.05, 0.05));
    }
    parts++;

    // a soft chord bed while the threat is low keeps it musical
    if (intensity < 2 && ci % 2 === 0 && parts < st.parts) {
      push(0, 8, 'pad', root - 12 + chord[0], 0.38);
      push(0.02, 8, 'pad', root - 12 + chord[2], 0.3);
      parts++;
    }

    // root-fifth bass ostinato
    if (intensity >= 1 && parts < st.parts) {
      const b = root - 24 + chord[0];
      for (let i = 0; i < 8; i++) push(i * 0.5, 0.42, 'bass', b + BASS_PAT[i], i % 2 === 0 ? 0.8 : 0.6);
      parts++;
    }

    // brass stabs
    if (intensity >= 2 && parts < st.parts) {
      const beats = STABS[ci === 3 ? 1 : 0];
      for (let i = 0; i < beats.length; i++) {
        const bm = root - 12 + chord[0];
        push(beats[i], 0.45, 'brass', bm < 45 ? bm + 12 : bm, 0.7);
        push(beats[i] + 0.01, 0.45, 'brass', root + chord[1], 0.55);
      }
      parts++;
    }

    // flute melody over the top
    if (intensity >= 3 && parts < st.parts) {
      let k = nearestChordStep(scale, root, chord, gen.step);
      // the raised fourth only where the chord does not hold the natural fourth (no semitone clash)
      const sc = st.lydian && !hasPc(chord, 5) ? LYDIAN_FOURTH : scale;
      const tpl = RHYTHMS[(gen.bar >> 1) % RHYTHMS.length];
      for (let i = 0; i < tpl.length; i++) {
        if (i > 0) k += rng.int(-2, 2);
        // chord tones on the strong beats, as in the exploration phrases
        if (tpl[i][0] === 0 || tpl[i][0] === 2) k = nearestChordStep(scale, root, chord, k);
        if (k < 3) k += 7;
        if (k > 13) k -= 7;
        const fm = stepMidi(sc, root, k);
        push(tpl[i][0], tpl[i][1] * 0.9, 'flute', fm < 62 ? fm + 12 : fm, 0.6);
      }
      gen.step = k;
      parts++;
    }
  }

  return gen;
}

/**
 * Notes of a stinger, times in seconds. Written into `out` (preallocated notes); returns the count.
 * @param {string} id @param {number} root midi tonic @param {Note[]} out
 */
export function stingerNotes(id, root, out) {
  let n = 0;
  /** @param {number} t @param {number} dur @param {string} inst @param {number} midi @param {number} vel */
  const p = (t, dur, inst, midi, vel) => {
    if (n >= out.length) return;
    const o = out[n++];
    o.t = t; o.dur = dur; o.inst = inst; o.midi = midi; o.vel = vel;
  };
  if (id === 'levelUp' || id === 'milestone') {
    const steps = [0, 4, 7, 12];
    for (let i = 0; i < 4; i++) p(i * 0.12, 1.2, 'flute', root + steps[i], 0.6);
    p(0.48, 3, 'bell', root + 12, 0.6); p(0.5, 3, 'bell', root + 16, 0.5); p(0.52, 3, 'bell', root + 19, 0.5);
    p(0.45, 3.5, 'pad', root - 12, 0.6); p(0.46, 3.5, 'pad', root - 8, 0.5); p(0.47, 3.5, 'pad', root - 5, 0.5);
    if (id === 'milestone') p(0.9, 2.5, 'bell', root + 24, 0.45);
  } else if (id === 'discover') {
    p(0, 3, 'bell', root + 12, 0.55); p(0.02, 3, 'bell', root + 16, 0.45); p(0.04, 3, 'bell', root + 19, 0.45);
    p(0.6, 0.35, 'flute', root + 7, 0.55); p(0.95, 0.35, 'flute', root + 9, 0.55); p(1.3, 1.6, 'flute', root + 12, 0.6);
    p(0.6, 3.5, 'pad', root - 12, 0.45); p(0.62, 3.5, 'pad', root - 5, 0.4);
  } else if (id === 'transform') {
    // two-bar fill: an accelerating drum roll into a bell chord in the Form's key
    let t = 0;
    let gap = 0.24;
    for (let i = 0; i < 14; i++) { p(t, 0.4, 'drum', 45, 0.45 + i * 0.035); t += gap; gap *= 0.86; }
    p(t, 3, 'bell', root + 12, 0.7); p(t + 0.01, 3, 'bell', root + 16, 0.6); p(t + 0.02, 3, 'bell', root + 19, 0.6);
    p(t, 0.6, 'brass', root - 12, 0.75); p(t, 0.6, 'brass', root - 5, 0.65);
    p(t, 4, 'pad', root - 12, 0.6); p(t + 0.02, 4, 'pad', root - 5, 0.5);
  } else if (id === 'questComplete' || id === 'victory') {
    p(0, 0.3, 'brass', root, 0.7); p(0.3, 0.3, 'brass', root + 4, 0.7); p(0.6, 1.2, 'brass', root + 7, 0.75);
    p(0.6, 3.5, 'pad', root - 12, 0.6); p(0.62, 3.5, 'pad', root - 8, 0.5); p(0.64, 3.5, 'pad', root - 5, 0.5);
    p(0.6, 3, 'bell', root + 12, 0.5);
    if (id === 'victory') { p(0, 0.5, 'drum', 45, 0.9); p(0.6, 0.5, 'drum', 45, 0.9); p(1.2, 2.5, 'flute', root + 12, 0.6); }
  } else if (id === 'finisher') {
    // a one-second hit: drum, open-fifth brass stab and a ringing octave-fifth bell (no third, so it sits on the
    // minor combat layer and on the major exploration palettes alike)
    p(0, 0.5, 'drum', 45, 1); p(0.12, 0.5, 'drum', 45, 0.7);
    p(0, 0.5, 'brass', root - 12, 0.8); p(0.01, 0.5, 'brass', root - 5, 0.7);
    p(0.02, 1.2, 'bell', root + 12, 0.55); p(0.03, 1.2, 'bell', root + 19, 0.45);
  } else if (id === 'death') {
    p(0, 4, 'pad', root - 12, 0.6); p(0.02, 4, 'pad', root - 9, 0.5); p(0.04, 4, 'pad', root - 5, 0.5);
    p(1.6, 3, 'bell', root + 6, 0.35); p(0, 2, 'bass', root - 24, 0.6);
  } else if (id === 'bossIntro') {
    p(0, 0.6, 'drum', 45, 1); p(0.5, 0.6, 'drum', 45, 0.9); p(1.0, 0.6, 'drum', 45, 1);
    p(1.0, 1.4, 'brass', root - 12, 0.8); p(1.0, 1.4, 'brass', root - 6, 0.7); p(1.0, 3, 'drone', root - 24, 0.7);
  }
  return n;
}
