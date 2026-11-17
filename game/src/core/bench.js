/**
 * The scripted benchmark of ARCHITECTURE 7.3 (`?bench=1` and `__GAME__.bench()`).
 *
 * It starts a fresh journey with the `tutorial=0` shortcut (storage is memory-only under `bench=1`, see flags.js)
 * and plays three segments using only service APIs and input injection (through the `__GAME__` helpers):
 * (1) 60 s of flight from Sparkstead toward Thornwood, boosting to Sonic with Gather stops, at 60, 400 and 800 m;
 * (2) a 40 s fight at a Meadows camp against 12 spawned enemies with the Strike String, Flare Barrage, Ember Form,
 * Nova Ring and Ringfall; (3) 20 s inside Sparkstead. It records each frame's duration and reports, per segment,
 * p50 and p95 frame time and the frames over 50 ms, plus the minimum and final dynamic-resolution scale and the
 * peaks of draw calls, triangles, particles, programs and audio nodes.
 *
 * Real time: driven by the frame system `core.bench` while the loop runs. Test mode without autoplay: driven by
 * `loop.stepSim(2)` + `loop.renderNow()` per frame (a 30 fps frame), so it completes under SwiftShader.
 * @module core/bench
 */

/** Sim ticks per benchmark frame in step-driven mode (30 fps reference frames). */
const STEP_TICKS = 2;
/** Frames over this many ms are counted (GC pauses, late shader links). */
const SLOW_FRAME_MS = 50;
/** Stats are sampled for peaks every this many frames. */
const SAMPLE_EVERY = 4;
/** Step-driven mode yields to the event loop every this many frames. */
const YIELD_EVERY = 8;

/**
 * @typedef {object} BenchSegmentReport
 * @property {string} name
 * @property {number} seconds    scripted sim seconds
 * @property {number} frames
 * @property {number} p50        ms
 * @property {number} p95        ms
 * @property {number} over50     frames over 50 ms
 */

/**
 * @typedef {object} BenchReport
 * @property {string} mode       'realtime' | 'stepped'
 * @property {number} durationScale
 * @property {BenchSegmentReport[]} segments
 * @property {{ min:number, final:number }} resolution
 * @property {{ drawCalls:number, triangles:number, particles:number, programs:number, audioNodes:number }} peaks
 * @property {{ afterWarmup:number, peak:number, constant:boolean }} programs
 * @property {number} errors      entries of `__GAME__.errors` added during the run
 * @property {boolean} aborted    true when the sim could not advance (a pause that would not clear)
 * @property {string} text        the panel text
 */

/**
 * @param {Float64Array} arr @param {number} n @param {number} q 0..1
 * @returns {number}
 */
function percentile(arr, n, q) {
  if (n === 0) return 0;
  const sorted = Array.from(arr.subarray(0, n)).sort((a, b) => a - b);
  return sorted[Math.min(n - 1, Math.floor(q * (n - 1) + 0.5))];
}

/** @param {number} v @returns {string} */
const ms = (v) => v.toFixed(1);

/**
 * Build the three segments. Each has `seconds`, a `start` and timed `cues`, and an optional per-frame `update`.
 * @param {any} g  the __GAME__ api
 * @param {any} ctx
 * @param {number} k duration scale
 */
function buildScript(g, ctx, k) {
  const at = (s) => s * k;
  const yawTo = (fromX, fromZ, toX, toZ) => Math.atan2(toX - fromX, toZ - fromZ);
  const lm = (id, fx, fz) => ctx.world.landmark(id) || { x: fx, z: fz };
  const spark = lm('sparkstead', -1430, 1580);
  const thorn = lm('bramble_hollow', -300, 600);
  const flyYaw = yawTo(spark.x, spark.z, thorn.x, thorn.z);
  const flyStage = (alt) => () => {
    const p = ctx.player;
    g.teleport(p ? p.pos.x : spark.x, p ? p.pos.z : spark.z, { alt, fly: true, yaw: flyYaw });
    g.setCamera({ yaw: flyYaw });
    g.move(0, 1);
    g.hold('dash', true);
  };
  const gatherStop = () => {
    g.hold('dash', false);
    g.move(0, 0);
    g.hold('gather', true);
  };
  const resumeFlight = () => {
    g.hold('gather', false);
    g.move(0, 1);
    g.hold('dash', true);
  };
  let nextAttack = 0;

  return [
    {
      name: 'flight',
      seconds: at(60),
      start() {
        g.clearInput();
        g.god(true);
        g.goto('sparkstead', { alt: 60 });
        flyStage(60)();
      },
      cues: [
        [at(8), gatherStop], [at(10), resumeFlight],
        [at(20), flyStage(400)], [at(28), gatherStop], [at(30), resumeFlight],
        [at(40), flyStage(800)], [at(48), gatherStop], [at(50), resumeFlight],
      ],
    },
    {
      name: 'fight',
      seconds: at(40),
      start() {
        g.clearInput();
        const camps = ctx.world.pois('camp');
        const camp = camps.find((c) => c.regionId === 'meadows') || { x: spark.x + 220, z: spark.z };
        g.teleport(camp.x, camp.z, { fly: false });
        for (const t of ['strike_string', 'flare_barrage', 'nova_ring', 'ringfall']) g.unlockTech(t);
        g.unlockForm('ember');
        g.setSlot(0, 'flare_barrage');
        g.setSlot(1, 'nova_ring');
        g.setSlot('ultimate', 'ringfall');
        const kinds = ['tusk_boar', 'choir_acolyte', 'ember_wisp'];
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          g.spawn(kinds[i % 3], { x: camp.x + Math.sin(a) * 12, z: camp.z + Math.cos(a) * 12, aggro: true });
        }
        nextAttack = 0;
      },
      cues: [
        [at(0.5), () => g.press('lock')],
        [at(6), () => g.hold('tech1', true)], [at(9), () => g.hold('tech1', false)],
        [at(12), () => g.press('form')],
        [at(18), () => g.press('tech2')],
        [at(24), () => { g.setSurge(100); g.press('ultimate'); }],
        [at(30), () => g.hold('tech1', true)], [at(33), () => g.hold('tech1', false)],
        [at(36), () => g.press('tech2')],
      ],
      /** @param {number} t */
      update(t) {
        if (t >= nextAttack) {
          g.press('attack');
          nextAttack = t + 0.4 * k;
        }
      },
    },
    {
      name: 'settlement',
      seconds: at(20),
      start() {
        g.clearInput();
        g.killAll();
        g.setForm(null);
        g.goto('sparkstead');
      },
      cues: [],
      /** @param {number} t */
      update(t) {
        const a = (t / Math.max(k, 1e-3)) * 0.6;
        g.move(Math.sin(a), Math.cos(a) * 0.5 + 0.5);
      },
    },
  ];
}

/**
 * Run the benchmark.
 * @param {any} ctx
 * @param {any} g   the `__GAME__` api (its helpers call service APIs only)
 * @param {{ durationScale?:number, panel?:boolean }} [opts]  durationScale shortens every segment (CI); panel: show the result panel (default true)
 * @returns {Promise<BenchReport>}
 */
export async function runBench(ctx, g, opts = {}) {
  const k = typeof opts.durationScale === 'number' && opts.durationScale > 0 ? opts.durationScale : 1;
  const stepped = !!(ctx.flags.test && !ctx.flags.autoplay);
  const errors0 = ctx.log.errors.length;

  ctx.flags.tutorial = 0;
  if (ctx.ui) ctx.ui.closeAll();
  ctx.session.start({ slot: 1, newGame: true });
  if (ctx.ui) ctx.ui.closeAll();

  const script = buildScript(g, ctx, k);
  const durations = script.map((s) => new Float64Array(Math.ceil(s.seconds * 120) + 64));
  const counts = new Int32Array(script.length);
  const peaks = { drawCalls: 0, triangles: 0, particles: 0, programs: 0, audioNodes: 0 };
  const res = { min: Infinity, final: 1 };
  const programs = { afterWarmup: -1, peak: 0 };
  let seg = 0;
  let segStart = 0;
  let cueIndex = 0;
  let frame = 0;
  let aborted = false;

  function sample() {
    const s = g.stats();
    if (s.drawCalls > peaks.drawCalls) peaks.drawCalls = s.drawCalls;
    if (s.triangles > peaks.triangles) peaks.triangles = s.triangles;
    if (s.particles > peaks.particles) peaks.particles = s.particles;
    if (s.programs > peaks.programs) peaks.programs = s.programs;
    if (s.audioNodes > peaks.audioNodes) peaks.audioNodes = s.audioNodes;
    if (s.scale < res.min) res.min = s.scale;
    res.final = s.scale;
    if (programs.afterWarmup < 0) programs.afterWarmup = s.programs;
    if (s.programs > programs.peak) programs.peak = s.programs;
  }

  function beginSegment() {
    segStart = ctx.time.real;
    cueIndex = 0;
    script[seg].start();
  }

  /** Run cues and the per-frame update; advance the segment when its time is up. @returns {boolean} false when done */
  function drive() {
    const s = script[seg];
    const t = ctx.time.real - segStart;
    while (cueIndex < s.cues.length && t >= s.cues[cueIndex][0]) /** @type {any} */ (s.cues[cueIndex++][1])();
    if (s.update) s.update(t);
    if (t < s.seconds) return true;
    seg++;
    if (seg >= script.length) return false;
    beginSegment();
    return true;
  }

  /** @param {number} dur */
  function record(dur) {
    const i = counts[seg];
    if (i < durations[seg].length) {
      durations[seg][i] = dur;
      counts[seg] = i + 1;
    }
    if (frame++ % SAMPLE_EVERY === 0) sample();
  }

  const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  beginSegment();

  if (stepped) {
    let going = true;
    while (going) {
      const t0 = clock();
      const cur = seg;
      going = drive();
      let ran = ctx.loop.stepSim(STEP_TICKS);
      if (ran === 0) {
        if (ctx.ui) ctx.ui.closeAll();
        ran = ctx.loop.stepSim(STEP_TICKS);
        if (ran === 0) {
          aborted = true;
          ctx.log.warn('bench', 'the sim is paused and could not be resumed; benchmark aborted');
          break;
        }
      }
      ctx.loop.renderNow();
      if (going && seg === cur) record(clock() - t0);
      if (frame % YIELD_EVERY === 0) await new Promise((r) => setTimeout(r, 0));
    }
  } else {
    await new Promise((resolve) => {
      let last = -1;
      ctx.systems.add({
        id: 'core.bench',
        phase: 'debug',
        order: 100,
        owner: 'core.bench',
        frame() {
          const now = clock();
          if (last >= 0) record(now - last);
          last = now;
          if (!drive()) {
            ctx.systems.removeOwner('core.bench');
            resolve(undefined);
          }
        },
      });
      ctx.loop.start();
    });
  }
  g.clearInput();
  sample();

  /** @type {BenchSegmentReport[]} */
  const segments = script.map((s, i) => {
    let over = 0;
    for (let j = 0; j < counts[i]; j++) if (durations[i][j] > SLOW_FRAME_MS) over++;
    return { name: s.name, seconds: s.seconds, frames: counts[i], p50: percentile(durations[i], counts[i], 0.5),
      p95: percentile(durations[i], counts[i], 0.95), over50: over };
  });
  const report = {
    mode: stepped ? 'stepped' : 'realtime',
    durationScale: k,
    segments,
    resolution: { min: Number.isFinite(res.min) ? res.min : res.final, final: res.final },
    peaks,
    programs: { afterWarmup: Math.max(0, programs.afterWarmup), peak: programs.peak, constant: programs.peak === Math.max(0, programs.afterWarmup) },
    errors: ctx.log.errors.length - errors0,
    aborted,
    text: '',
  };
  report.text = formatReport(report, ctx);
  if (opts.panel !== false) showPanel(ctx, report.text);
  return report;
}

/**
 * The selectable panel text.
 * @param {BenchReport} r @param {any} ctx
 * @returns {string}
 */
export function formatReport(r, ctx) {
  const lines = [];
  const nav = typeof navigator !== 'undefined' ? navigator.userAgent : 'node';
  lines.push(`KETHRA benchmark (${r.mode}, duration x${r.durationScale})${r.aborted ? ' ABORTED' : ''}`);
  lines.push(`tier ${ctx.render ? ctx.render.tier : '?'}  ${nav}`);
  for (const s of r.segments) {
    lines.push(`${s.name.padEnd(11)} frames ${String(s.frames).padStart(5)}  p50 ${ms(s.p50)} ms  p95 ${ms(s.p95)} ms  >50ms ${s.over50}`);
  }
  lines.push(`resolution scale  min ${r.resolution.min}  final ${r.resolution.final}`);
  const p = r.peaks;
  lines.push(`peaks  draws ${p.drawCalls}  tris ${p.triangles}  particles ${p.particles}  programs ${p.programs}  audio nodes ${p.audioNodes}`);
  lines.push(`programs after warm-up ${r.programs.afterWarmup}, peak ${r.programs.peak} (${r.programs.constant ? 'constant' : 'GREW'})`);
  lines.push(`errors during the run: ${r.errors}`);
  return lines.join('\n');
}

/**
 * Show the result panel (selectable text, close button) in the overlay layer.
 * @param {any} ctx @param {string} text
 */
function showPanel(ctx, text) {
  const dom = ctx.dom;
  if (!dom) return;
  const layer = dom.layer('overlay');
  const old = layer.querySelector('.k-bench');
  if (old) old.remove();
  const panel = dom.el('div', 'k-bench', layer);
  dom.el('pre', 'k-select', panel, text);
  const close = /** @type {HTMLButtonElement} */ (dom.el('button', 'k-btn', panel, '×'));
  close.type = 'button';
  close.setAttribute('aria-label', 'close');
  close.addEventListener('click', () => panel.remove());
}
