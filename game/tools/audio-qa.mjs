/**
 * Audio QA: renders every sound of the game offline and measures it.
 *
 *   node tools/audio-qa.mjs            full report, exit code 1 when anything is flagged
 *   node tools/audio-qa.mjs --json F   also write the raw numbers to F
 *   node tools/audio-qa.mjs --only sfx|music|loops|mix   one section
 *
 * The one-shots and instrument samples are pure JS synthesis (src/audio/logic) and are measured as rendered. The
 * mix (each one-shot through the real engine and bus, 30 s of every music palette and intensity, the live loops,
 * ambience beds, ten loud sounds at once, a barrage) is rendered by the real engine and music scheduler inside an
 * OfflineAudioContext in headless Chromium (tools/lib/harness.mjs resolves Playwright), stepped in 50 ms frames.
 *
 * Measures: peak, RMS, approximate loudness (BS.1770 K-weighted; momentary maximum for one-shots, gated integrated
 * for music and loops), crest factor, DC offset, clipped samples, energy share below 250 Hz, 250 Hz-4 kHz, above
 * 6 kHz and in the phone band 500 Hz-4 kHz, the first-sample jump (click), the level just before the end (cut-off),
 * stereo balance and mono compatibility, the loop-point discontinuity of looping buffers, and music ducking.
 */
import * as esbuild from 'esbuild';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPlaywright } from './lib/harness.mjs';
import { GAME_ROOT } from './gen-registry.mjs';

// ------------------------------------------------------------------ analysis (also injected into the page)

/**
 * Self-contained analysis functions. Defined in one closure so the same code runs in Node and, through
 * `toString()`, in the page.
 */
function makeAnalyzer() {
  /** RBJ biquad coefficients. */
  function biq(type, fc, q, gainDb, fs) {
    const A = Math.pow(10, gainDb / 40);
    const w = 2 * Math.PI * fc / fs;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    let b0; let b1; let b2; let a0; let a1; let a2;
    if (type === 'hs') {
      const sA = 2 * Math.sqrt(A) * al;
      b0 = A * ((A + 1) + (A - 1) * c + sA); b1 = -2 * A * ((A - 1) + (A + 1) * c); b2 = A * ((A + 1) + (A - 1) * c - sA);
      a0 = (A + 1) - (A - 1) * c + sA; a1 = 2 * ((A - 1) - (A + 1) * c); a2 = (A + 1) - (A - 1) * c - sA;
    } else {
      b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al;
    }
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  }
  function filt(x, k) {
    const y = new Float64Array(x.length);
    let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = k[0] * x[i] + k[1] * x1 + k[2] * x2 - k[3] * y1 - k[4] * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  }
  /** K-weighted signal (BS.1770 pre-filter and RLB high-pass). */
  function kweight(x, fs) {
    return filt(filt(x, biq('hs', 1500, Math.SQRT1_2, 4, fs)), biq('hp', 38, 0.5, 0, fs));
  }
  /** Momentary (400 ms) loudness blocks, 100 ms hop: mean square summed over channels. */
  function blocks(chs, fs) {
    const kw = chs.map((c) => kweight(c, fs));
    const win = Math.round(0.4 * fs);
    const hop = Math.round(0.1 * fs);
    const n = chs[0].length;
    const out = [];
    for (let s = 0; s === 0 || s + win <= n; s += hop) {
      let z = 0;
      for (const k of kw) {
        let a = 0;
        const e = Math.min(n, s + win);
        for (let i = s; i < e; i++) a += k[i] * k[i];
        z += a / win;
      }
      out.push(z);
      if (s + win > n) break;
    }
    return out;
  }
  const lufs = (z) => (z > 0 ? -0.691 + 10 * Math.log10(z) : -120);
  /** Gated integrated loudness. */
  function integrated(bl) {
    const g1 = bl.filter((z) => lufs(z) > -70);
    if (!g1.length) return -120;
    const m1 = g1.reduce((a, b) => a + b, 0) / g1.length;
    const g2 = g1.filter((z) => lufs(z) > lufs(m1) - 10);
    return lufs(g2.reduce((a, b) => a + b, 0) / Math.max(1, g2.length));
  }
  /** In-place radix-2 FFT. */
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len;
      const wr = Math.cos(ang); const wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1; let ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k; const b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci; const ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
  }
  /** Energy shares: [<250, 250-4k, >6k, 500-4k]. */
  function bands(x, fs) {
    const N = 2048;
    const re = new Float64Array(N); const im = new Float64Array(N);
    const acc = new Float64Array(N / 2);
    const hop = N / 2;
    for (let s = 0; s === 0 || s + N <= x.length; s += hop) {
      for (let i = 0; i < N; i++) {
        const v = s + i < x.length ? x[s + i] : 0;
        re[i] = v * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); im[i] = 0;
      }
      fft(re, im);
      for (let k = 0; k < N / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
      if (s + N >= x.length) break;
    }
    let tot = 0; const b = [0, 0, 0, 0];
    for (let k = 1; k < N / 2; k++) {
      const f = k * fs / N; const p = acc[k];
      tot += p;
      if (f < 250) b[0] += p; else if (f < 4000) b[1] += p;
      if (f > 6000) b[2] += p;
      if (f >= 500 && f < 4000) b[3] += p;
    }
    return b.map((v) => (tot > 0 ? v / tot : 0));
  }
  const db = (v) => (v > 1e-9 ? 20 * Math.log10(v) : -180);

  /**
   * Measure channels `chs` (Float32Array[]). kind 'sfx' uses the momentary maximum, otherwise gated integrated
   * loudness. Returns plain numbers (dB where named so).
   */
  function analyze(chs, fs, kind) {
    const n = chs[0].length;
    let peak = 0; let ss = 0; let sum = 0; let clip = 0;
    for (const c of chs) {
      for (let i = 0; i < n; i++) {
        const v = c[i]; const a = Math.abs(v);
        if (a > peak) peak = a;
        if (a >= 0.999) clip++;
        ss += v * v; sum += v;
      }
    }
    const rms = Math.sqrt(ss / (n * chs.length));
    // a one-shot: RMS over its audible part (to -50 dB of the peak), so long quiet tails do not hide its level
    let rmsA = rms;
    if (kind === 'sfx') {
      const c = chs[0];
      let last = n - 1;
      while (last > 0 && Math.abs(c[last]) < peak * 0.003) last--;
      let a = 0;
      for (let i = 0; i <= last; i++) a += c[i] * c[i];
      rmsA = Math.sqrt(a / Math.max(1, last + 1));
    }
    const bl = blocks(chs, fs);
    const loud = kind === 'sfx' ? lufs(Math.max(...bl)) : integrated(bl);
    const mono = new Float64Array(n);
    for (const c of chs) for (let i = 0; i < n; i++) mono[i] += c[i] / chs.length;
    const b = bands(mono, fs);
    const c0 = chs[0];
    // cut-off: RMS of the 20 ms before the last 6 ms, relative to the peak
    const te = Math.max(0, n - Math.round(0.006 * fs));
    const ts = Math.max(0, te - Math.round(0.02 * fs));
    let tss = 0;
    for (let i = ts; i < te; i++) tss += c0[i] * c0[i];
    const tail = db(Math.sqrt(tss / Math.max(1, te - ts)) / Math.max(1e-9, peak));
    const r = {
      peak: db(peak), rms: db(kind === 'sfx' ? rmsA : rms), lufs: loud, crest: db(peak) - db(kind === 'sfx' ? rmsA : rms),
      dc: sum / (n * chs.length), clip, lo: b[0], mid: b[1], hi: b[2], ph: b[3], click: db(Math.abs(c0[0])), tail,
      bal: null, corr: null, monoLoss: null, secs: n / fs,
    };
    if (chs.length === 2) {
      let l = 0; let rr = 0; let lr = 0;
      for (let i = 0; i < n; i++) { l += chs[0][i] * chs[0][i]; rr += chs[1][i] * chs[1][i]; lr += chs[0][i] * chs[1][i]; }
      r.bal = 10 * Math.log10(Math.max(1e-12, l) / Math.max(1e-12, rr));
      r.corr = l > 0 && rr > 0 ? lr / Math.sqrt(l * rr) : 1;
      // energy of the mono fold-down against the average channel energy
      let m = 0;
      for (let i = 0; i < n; i++) { const v = (chs[0][i] + chs[1][i]) * 0.5; m += v * v; }
      r.monoLoss = 10 * Math.log10(Math.max(1e-12, (l + rr) / 2) / Math.max(1e-12, m));
    }
    return r;
  }

  /**
   * Loop-point discontinuity of a looping buffer: the jump from the last to the first sample against the spread of
   * sample-to-sample steps, measured on the signal and on an 8-sample average (low-frequency steps).
   */
  function seam(x) {
    const n = x.length;
    const ratio = (y) => {
      let s = 0;
      for (let i = 1; i < y.length; i++) s += (y[i] - y[i - 1]) ** 2;
      const sd = Math.sqrt(s / (y.length - 1));
      return Math.abs(y[0] - y[y.length - 1]) / Math.max(1e-12, sd);
    };
    let worst = ratio(x);
    // circular moving averages (8 and 64 samples) so low-frequency steps across the wrap show too
    for (const w of [8, 64]) {
      const sm = new Float64Array(n);
      let a = 0;
      for (let k = -w; k < 0; k++) a += x[(k + n) % n];
      for (let i = 0; i < n; i++) {
        sm[i] = a / w;
        a += x[i] - x[(i - w + n) % n];
      }
      // rotate so the wrap of the averaged signal sits at the array ends
      const rot = new Float64Array(n);
      for (let i = 0; i < n; i++) rot[i] = sm[(i + (w >> 1)) % n];
      worst = Math.max(worst, ratio(rot));
    }
    return worst;
  }

  return { analyze, seam, lufs, blocks, integrated, bands };
}

const QA = makeAnalyzer();

// ------------------------------------------------------------------ the page side

/** Runs in the page: `AQ` is the bundled audio package, `QA` the analyzer. */
async function pageRun(only) {
  const AQ = /** @type {any} */ (window).AQ;
  const QA = /** @type {any} */ (window).QA;
  const SR = 48000;
  const STEP = 0.05;
  const out = { sfx: [], ins: [], mixSfx: [], music: [], loops: [], beds: [], seams: [], stack: [], errors: [] };
  const want = (s) => !only || only === s;

  /**
   * Render `seconds` of the real engine and music scheduler offline. `script(t, eng, music, ctx)` runs every
   * 50 ms of render time before the frame updates.
   */
  async function offline(seconds, tier, script, envInit) {
    const real = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
    const ac = new Proxy(real, {
      get(t, k) {
        if (k === 'state') return 'running';
        const v = Reflect.get(t, k, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    const env = Object.assign({ phase: 'day' }, envInit || {});
    const ctx = {
      flags: { seed: 123 }, rng: AQ.createRng({ seed: 123 }), log: { warn() {} }, save: null, render: { tier },
      ents: { get() { return null; } }, three: null, env,
    };
    const eng = AQ.createEngine(ctx, { makeContext: () => ac, sync: true, noWindow: true });
    const music = AQ.createMusic(ctx, eng);
    eng.unlock();
    const tick = (t) => {
      try {
        script(t, eng, music, ctx);
        eng.frame(ctx);
        music.frame();
      } catch (err) {
        out.errors.push(String(err && err.stack || err));
      }
    };
    tick(0);
    for (let k = 1; k * STEP < seconds - 0.01; k++) {
      const t = k * STEP;
      real.suspend(t).then(() => { tick(real.currentTime); real.resume(); });
    }
    const buf = await real.startRendering();
    return { L: buf.getChannelData(0), R: buf.getChannelData(1), eng, music };
  }
  const slice = (r, a, b) => [r.L.subarray(Math.round(a * SR), Math.round(b * SR)), r.R.subarray(Math.round(a * SR), Math.round(b * SR))];

  // 1. one-shot sources and instrument samples (pure synthesis)
  const ids = Object.keys(AQ.RECIPES).filter((id) => !AQ.RECIPES[id].live);
  if (want('sfx')) {
    for (const id of ids) {
      const data = AQ.renderRecipe(id, 0);
      out.sfx.push({ id, mix: AQ.RECIPES[id].mix, ...QA.analyze([data], AQ.recipeRate(id), 'sfx') });
    }
    for (const id of AQ.INSTRUMENT_IDS) {
      for (let b = 0; b < AQ.INSTRUMENTS[id].bases.length; b++) {
        const data = AQ.renderInstrument(id, b);
        out.ins.push({ id: id + '@' + AQ.INSTRUMENTS[id].bases[b], ...QA.analyze([data], AQ.INSTRUMENTS[id].sr, 'sfx') });
      }
    }
    for (const c of ['white', 'pink']) out.seams.push({ id: 'noise_' + c, seam: QA.seam(AQ.loopNoise(2, 22050, c)) });
  }

  // 2. every one-shot through the engine (centred, vol 1), 2.5 s apart, music silent; the duck gain is sampled
  if (want('sfx') || want('mix')) {
    const SLOT = 2.5;
    const duckMin = new Float64Array(ids.length).fill(1);
    const r = await offline(ids.length * SLOT + 0.5, 'low', (t, eng, music) => {
      if (t === 0) music.set({ mode: 'silent' });
      const k = Math.round(t / STEP);
      const slotSteps = Math.round(SLOT / STEP);
      const i = Math.floor(k / slotSteps);
      if (i < ids.length && k % slotSteps === 2) eng.play(ids[i], { vol: 1, pitch: 1 });
      if (i < ids.length && eng.bus.duck) duckMin[i] = Math.min(duckMin[i], eng.bus.duck.gain.value);
    });
    for (let i = 0; i < ids.length; i++) {
      const s = slice(r, i * SLOT, (i + 1) * SLOT);
      out.mixSfx.push({ id: ids[i], duck: 20 * Math.log10(Math.max(1e-6, duckMin[i])), ...QA.analyze(s, SR, 'sfx') });
    }
  }

  // 3. music: 32 s per palette / intensity, measured after the first 4 s
  if (want('music') || want('mix')) {
    const cases = [
      ['warm day', { mode: 'explore', palette: 'warm' }, 'day'], ['warm night', { mode: 'explore', palette: 'warm' }, 'night'],
      ['warm town', { mode: 'explore', palette: 'warm', settlement: true }, 'day'], ['cold day', { mode: 'explore', palette: 'cold' }, 'day'],
      ['cold night', { mode: 'explore', palette: 'cold' }, 'night'], ['corrupt day', { mode: 'explore', palette: 'corrupted' }, 'day'],
      ['corrupt night', { mode: 'explore', palette: 'corrupted' }, 'night'],
      ['combat i0', { mode: 'combat', palette: 'warm', intensity: 0 }, 'day'], ['combat i1', { mode: 'combat', palette: 'warm', intensity: 1 }, 'day'],
      ['combat i2', { mode: 'combat', palette: 'warm', intensity: 2 }, 'day'], ['combat i3', { mode: 'combat', palette: 'warm', intensity: 3 }, 'day'],
      ['boss', { mode: 'boss', palette: 'cold' }, 'day'],
    ];
    for (const [name, st, phase] of cases) {
      const r = await offline(32, 'low', (t, eng, music) => { if (t === 0) music.set(st); }, { phase });
      out.music.push({ id: name, ...QA.analyze(slice(r, 4, 32), SR, 'music') });
    }
  }

  // 4. live loops at three levels, and the ambience beds
  if (want('loops') || want('mix')) {
    const kinds = ['wind_loop', 'gather_loop', 'beam_loop', 'siphon_loop', 'ambience'];
    for (const id of kinds) {
      const levels = [0.1, 0.5, 1];
      let vid = 0;
      const r = await offline(13, 'low', (t, eng, music) => {
        if (t === 0) { music.set({ mode: 'silent' }); vid = eng.loop(id, { vol: 1 }); }
        const seg = Math.min(2, Math.floor(t / 4));
        eng.setParam(vid, 'level', levels[seg]);
      });
      for (let s = 0; s < 3; s++) out.loops.push({ id: id + ' ' + levels[s], ...QA.analyze(slice(r, s * 4 + 1, s * 4 + 4), SR, 'loop') });
    }
    if (AQ.BEDS) {
      for (const bed of Object.keys(AQ.BEDS)) {
        let vid = 0;
        const r = await offline(16, 'low', (t, eng, music) => {
          if (t === 0) { music.set({ mode: 'silent' }); vid = eng.loop('ambience', { vol: 1 }); eng.setParam(vid, 'bed', bed); eng.setParam(vid, 'level', 0.5); }
          if (eng.ambient) eng.ambient(t, bed);
        });
        out.beds.push({ id: 'bed ' + bed, ...QA.analyze(slice(r, 2, 16), SR, 'loop') });
      }
    }
  }

  // 5. stacking: ten loud sounds at once over combat music, then a 6 s barrage
  if (want('mix')) {
    const LOUD = ['explosion_l', 'ult_impact', 'hit_finisher', 'sonic_boom', 'boss_roar', 'crater', 'nova', 'explosion_m', 'transform_burst', 'siphon_break'];
    const BARRAGE = ['bolt_fire', 'bolt_hit', 'hit_light', 'hit_heavy', 'xp_orb', 'explosion_s', 'player_hurt', 'guard_block', 'whoosh', 'hit_finisher'];
    let k = 0;
    const r = await offline(14, 'low', (t, eng, music, ctx) => {
      if (t === 0) {
        // worst case: every volume slider at the top
        eng.setVolume('master', 1); eng.setVolume('sfx', 1); eng.setVolume('music', 1);
        music.set({ mode: 'combat', palette: 'warm', intensity: 3 });
      }
      if (Math.abs(t - 3) < 0.01) for (const id of LOUD) eng.play(id, { vol: 1.15, pitch: 1 });
      if (t >= 7 && t < 13) {
        for (let j = 0; j < 2; j++) {
          const id = BARRAGE[(k++ * 7) % BARRAGE.length];
          eng.play(id, { vol: 1.15, pitch: 1, x: ctx.rng.fx.range(-6, 6), y: 0, z: ctx.rng.fx.range(2, 10) });
        }
      }
    });
    out.stack.push({ id: 'combat music alone', ...QA.analyze(slice(r, 0.5, 2.9), SR, 'music') });
    out.stack.push({ id: '10 loud at once', ...QA.analyze(slice(r, 2.9, 6.5), SR, 'music') });
    out.stack.push({ id: 'barrage 40/s', ...QA.analyze(slice(r, 7, 13), SR, 'music') });
    out.stack.push({ id: 'nodes max', peak: r.eng.nodes() });
  }
  return out;
}

// ------------------------------------------------------------------ categories and limits

/** Mix category of a one-shot. */
export function category(id) {
  if (/^(ui_|dialogue_tick)/.test(id)) return 'ui';
  if (/^(step_|jump$|land$|takeoff|whoosh|amb_)/.test(id)) return 'foley';
  if (/^(explosion_l|ult_impact|sonic_boom|boss_roar|siphon_break|transform_burst|player_death|crater|nova|hit_finisher|land_heavy)$/.test(id)) return 'big';
  if (/^(level_up|quest_|discover|race_|ringstone|shrine|chest_open|ring_gate|gather_full|heal|xp_orb|pickup_item|shells)/.test(id)) return 'reward';
  return 'combat';
}

/** Ids that may carry little in the phone band by design (sub layers of a bigger sound are checked as a whole). */
const PHONE_EXEMPT = new Set([]);

const LIMITS = {
  click: -30, // dBFS of the first sample
  tail: -36, // dB under the peak in the 20 ms before the end
  dc: 0.004,
  hi: 0.3, // share of energy above 6 kHz
  phone: 0.15, // minimum share in 500 Hz-4 kHz
  phoneMusic: 0.08,
  seam: 1.5,
  catSpread: 5, // LU from the category median
  balance: 2, // dB
  monoLoss: 3, // dB
};

/** Flags of one measured row. @param {any} r @param {'sfx'|'ins'|'mix'|'music'|'loop'} kind */
function flagsOf(r, kind) {
  const f = [];
  if (r.clip > 0) f.push('clip ' + r.clip);
  if (kind === 'sfx' || kind === 'ins') {
    if (r.click > LIMITS.click) f.push('click');
    if (r.tail > LIMITS.tail) f.push('cut-off');
    if (Math.abs(r.dc) > LIMITS.dc) f.push('dc');
  }
  if (kind !== 'ins' && r.hi > LIMITS.hi) f.push('harsh');
  if ((kind === 'sfx' || kind === 'loop' || kind === 'music') && r.ph < (kind === 'music' ? LIMITS.phoneMusic : LIMITS.phone) && !PHONE_EXEMPT.has(r.id)) f.push('no phone band');
  if (r.bal !== null && r.bal !== undefined && Math.abs(r.bal) > LIMITS.balance && kind !== 'mix') f.push('balance');
  if (r.monoLoss !== null && r.monoLoss !== undefined && r.monoLoss > LIMITS.monoLoss) f.push('mono');
  return f;
}

// ------------------------------------------------------------------ printing

const fx = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '-' : v.toFixed(d));
const pc = (v) => (v === null || v === undefined ? '-' : Math.round(v * 100) + '%');

function table(title, rows, cols) {
  console.log('\n' + title);
  const head = cols.map((c) => c[0]);
  const body = rows.map((r) => cols.map((c) => String(c[1](r))));
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  console.log(head.map((h, i) => (i === 0 ? h.padEnd(w[i]) : h.padStart(w[i]))).join('  '));
  for (const b of body) console.log(b.map((v, i) => (i === 0 ? v.padEnd(w[i]) : v.padStart(w[i]))).join('  '));
}

const COLS = [
  ['id', (r) => r.id], ['peak', (r) => fx(r.peak)], ['rms', (r) => fx(r.rms)], ['LUFS', (r) => fx(r.lufs)], ['crest', (r) => fx(r.crest)],
  ['dc', (r) => fx(r.dc, 4)], ['clip', (r) => r.clip], ['<250', (r) => pc(r.lo)], ['.25-4k', (r) => pc(r.mid)], ['>6k', (r) => pc(r.hi)],
  ['.5-4k', (r) => pc(r.ph)], ['click', (r) => fx(r.click, 0)], ['tail', (r) => fx(r.tail, 0)],
];
const STEREO = [['bal', (r) => fx(r.bal)], ['corr', (r) => fx(r.corr, 2)], ['monoL', (r) => fx(r.monoLoss)]];

// ------------------------------------------------------------------ main

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
  const src = [
    "export { createEngine } from './src/audio/engine.js';",
    "export { createMusic } from './src/audio/music.js';",
    "export { RECIPES, renderRecipe, recipeRate } from './src/audio/logic/recipes.js';",
    "export { INSTRUMENTS, INSTRUMENT_IDS, renderInstrument } from './src/audio/logic/instruments.js';",
    "export { loopNoise } from './src/audio/logic/dsp.js';",
    "export * from './src/audio/logic/ambience.js';",
    "export { createRng } from './src/core/rng.js';",
  ];
  let bundle;
  try {
    bundle = await esbuild.build({ stdin: { contents: src.join('\n'), resolveDir: GAME_ROOT, loader: 'js' }, bundle: true, write: false, format: 'iife', globalName: 'AQ', target: 'es2020', logLevel: 'silent' });
  } catch (err) {
    // before the ambience module exists
    bundle = await esbuild.build({ stdin: { contents: src.filter((l) => !l.includes('ambience')).join('\n'), resolveDir: GAME_ROOT, loader: 'js' }, bundle: true, write: false, format: 'iife', globalName: 'AQ', target: 'es2020', logLevel: 'silent' });
  }
  const pw = await loadPlaywright();
  const browser = await pw.chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  let res;
  const t0 = Date.now();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>audio-qa</title>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.addScriptTag({ content: 'window.QA = (' + makeAnalyzer.toString() + ')();' });
    page.setDefaultTimeout(0);
    res = await page.evaluate(pageRun, only);
  } finally {
    await browser.close();
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const flagged = [];
  const note = (section, r, f) => { if (f.length) flagged.push(section + ' ' + r.id + ': ' + f.join(', ')); };

  if (res.sfx.length) {
    for (const r of res.sfx) r.flags = flagsOf(r, 'sfx');
    table('ONE-SHOT SOURCES (rendered buffer, variant 0; dB / dBFS; LUFS = momentary max)', res.sfx, [...COLS, ['mix', (r) => r.mix], ['flags', (r) => r.flags.join(' ')]]);
    for (const r of res.sfx) note('sfx', r, r.flags);
    for (const r of res.ins) r.flags = flagsOf(r, 'ins');
    table('INSTRUMENT SAMPLES', res.ins, [...COLS, ['flags', (r) => r.flags.join(' ')]]);
    for (const r of res.ins) note('instrument', r, r.flags);
    table('LOOP SEAMS (jump at the loop point in standard deviations of a sample step; limit ' + LIMITS.seam + ')', res.seams, [['id', (r) => r.id], ['seam', (r) => fx(r.seam, 2)]]);
    for (const r of res.seams) if (r.seam > LIMITS.seam) flagged.push('loop seam ' + r.id + ': ' + r.seam.toFixed(2));
  }
  if (res.mixSfx.length) {
    const cats = {};
    for (const r of res.mixSfx) { r.cat = category(r.id); (cats[r.cat] = cats[r.cat] || []).push(r.lufs); }
    const med = {};
    for (const c of Object.keys(cats)) { const a = cats[c].slice().sort((x, y) => x - y); med[c] = a[a.length >> 1]; }
    for (const r of res.mixSfx) {
      r.flags = [];
      if (r.clip > 0) r.flags.push('clip ' + r.clip);
      r.dev = r.lufs - med[r.cat];
      if (Math.abs(r.dev) > LIMITS.catSpread) r.flags.push((r.dev > 0 ? 'loud' : 'quiet') + ' for ' + r.cat);
      note('mix', r, r.flags);
    }
    table('ONE-SHOTS THROUGH THE ENGINE (master output, centred, vol 1)', res.mixSfx, [['id', (r) => r.id], ['cat', (r) => r.cat], ['peak', (r) => fx(r.peak)], ['LUFS', (r) => fx(r.lufs)],
      ['vs cat', (r) => fx(r.dev)], ['clip', (r) => r.clip], ['duck', (r) => fx(r.duck)], ['flags', (r) => r.flags.join(' ')]]);
    console.log('\ncategory medians (LUFS, momentary max): ' + Object.keys(med).map((c) => c + ' ' + med[c].toFixed(1)).join(', '));
    // ordering rules
    if (!(med.ui < med.combat - 3)) flagged.push('order: UI (' + med.ui.toFixed(1) + ') must be at least 3 LU under combat (' + med.combat.toFixed(1) + ')');
    if (!(med.big > med.combat)) flagged.push('order: big moments (' + med.big.toFixed(1) + ') must be louder than combat (' + med.combat.toFixed(1) + ')');
    res.medians = med;
  }
  if (res.music.length) {
    for (const r of res.music) r.flags = flagsOf(r, 'music');
    table('MUSIC (master output, 28 s after a 4 s settle; LUFS = gated integrated)', res.music, [...COLS.slice(0, 11), ...STEREO, ['flags', (r) => r.flags.join(' ')]]);
    for (const r of res.music) note('music', r, r.flags);
    if (res.medians) {
      const sfxRef = res.medians.combat;
      for (const r of res.music) {
        // music sits under the effects (integrated against the momentary maximum of the combat sounds):
        // exploration 6 LU under, combat 3 LU under
        const gap = /combat|boss/.test(r.id) ? 3 : 6;
        if (r.lufs > sfxRef - gap) flagged.push('music ' + r.id + ' (' + r.lufs.toFixed(1) + ') is not under the effects (combat median ' + sfxRef.toFixed(1) + ' - ' + gap + ')');
      }
    }
    const exAll = res.music.filter((r) => !/combat|boss/.test(r.id)).map((r) => r.lufs);
    if (exAll.length && Math.max(...exAll) - Math.min(...exAll) > 7) flagged.push('music: exploration palettes differ by ' + (Math.max(...exAll) - Math.min(...exAll)).toFixed(1) + ' LU (limit 7)');
    const ex = res.music.filter((r) => !/combat|boss/.test(r.id)).map((r) => r.lufs);
    const cb = res.music.filter((r) => /combat i3|boss/.test(r.id)).map((r) => r.lufs);
    if (ex.length && cb.length && Math.max(...ex) > Math.min(...cb)) flagged.push('music: exploration is louder than full combat');
  }
  if (res.loops.length || res.beds.length) {
    const rows = [...res.loops, ...res.beds];
    for (const r of rows) r.flags = flagsOf(r, 'loop');
    table('LIVE LOOPS AND AMBIENCE BEDS (master output)', rows, [...COLS.slice(0, 11), ...STEREO, ['flags', (r) => r.flags.join(' ')]]);
    for (const r of rows) note('loop', r, r.flags);
  }
  if (res.stack.length) {
    const rows = res.stack.filter((r) => r.lufs !== undefined);
    for (const r of rows) r.flags = flagsOf(r, 'mix');
    table('STACKING (master output)', rows, [['id', (r) => r.id], ['peak', (r) => fx(r.peak, 2)], ['LUFS', (r) => fx(r.lufs)], ['clip', (r) => r.clip], ['bal', (r) => fx(r.bal)], ['flags', (r) => r.flags.join(' ')]]);
    for (const r of rows) note('stack', r, r.flags);
    for (const r of rows) if (r.peak > -0.3) flagged.push('stack ' + r.id + ': peak ' + r.peak.toFixed(2) + ' dBFS (limit -0.3)');
    const nm = res.stack.find((r) => r.id === 'nodes max');
    if (nm) console.log('nodes at the end of the stack render: ' + nm.peak);
  }
  for (const e of res.errors.slice(0, 5)) { console.log('page error: ' + e); flagged.push('page error'); }
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(res, null, 1));
  console.log('\n' + (flagged.length ? 'FLAGGED (' + flagged.length + '):\n  ' + flagged.join('\n  ') : 'nothing flagged') + '\n(' + secs + ' s)');
  process.exitCode = flagged.length ? 1 : 0;
}

export { makeAnalyzer, LIMITS };

if (process.argv[1] && join(process.argv[1]) === join(GAME_ROOT, 'tools', 'audio-qa.mjs')) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 2;
  });
}
