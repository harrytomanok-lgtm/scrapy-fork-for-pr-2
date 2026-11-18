/**
 * Dynamic resolution controller (ARCHITECTURE 7.1). Pure and allocation-free after creation.
 *
 * Every `interval` seconds the window is judged against the target rate, clamped to [min, max]:
 * - the decisions use the real cost of a frame (`costMs`, sim plus frame pass, from ctx.loop.stats), which does not
 *   depend on the frame cap: the rate the cost allows, 1000 / average cost, under target - 3 lowers the scale by one
 *   step, over target + 8 raises it by one step;
 * - the presented rate still lowers the scale when it falls under target - 3 (a GPU-bound frame whose cost the CPU
 *   does not see), and a raise also needs the presented rate to reach target - 3; without a cost sample (costMs <= 0)
 *   the presented rate alone decides, as in ARCHITECTURE 7.1;
 * - while the loop's frame cap is below the target (a 30 fps menu on the high tier) the window is discarded and nothing
 *   changes, so a capped menu never lowers the scale or drops the tier.
 * A hold (cinematic, the first 5 s after a teleport) also discards the window and blocks changes. On a tier that may drop (high), sitting at the minimum
 * scale for `dropAfter` seconds raises `dropRequested` once per controller.
 * @module render/logic/dynres
 */

/**
 * @typedef {object} DynRes
 * @property {number} scale           current scale
 * @property {boolean} dropRequested  true once the drop rule fired (high only)
 * @property {(dt:number, held:boolean, costMs?:number, cap?:number) => boolean} update  feed one presented frame of `dt`
 *   real seconds, its cost in ms (0: unknown) and the frame cap in force (0: uncapped); true when the scale changed
 * @property {(caps:{ targetFps:number, dynRes:{min:number,max:number,step:number,interval:number} }, canDrop:boolean) => void} configure
 * @property {(seconds:number) => void} hold    block changes for this many seconds (teleport)
 * @property {() => void} reset
 */

/** Seconds at the minimum scale before a high tier asks to drop to low. */
export const DROP_AFTER = 6;
/** Seconds of hold after a teleport. */
export const TELEPORT_HOLD = 5;

/**
 * @param {{ targetFps:number, dynRes:{min:number,max:number,step:number,interval:number} }} caps
 * @param {boolean} [canDrop]
 * @returns {DynRes}
 */
export function createDynRes(caps, canDrop = false) {
  let target = 30;
  let min = 0.6;
  let max = 1;
  let step = 0.1;
  let interval = 3;
  let drop = false;
  let winT = 0;
  let winFrames = 0;
  let winCost = 0;
  let winCostN = 0;
  let holdT = 0;
  let atMinT = 0;

  /** @param {number} v */
  function snap(v) {
    return Math.round(v * 1000) / 1000;
  }

  const dr = {
    scale: 1,
    dropRequested: false,
    configure(c, cd) {
      target = c.targetFps;
      min = c.dynRes.min;
      max = c.dynRes.max;
      step = c.dynRes.step;
      interval = c.dynRes.interval;
      drop = !!cd;
      if (dr.scale > max) dr.scale = max;
      if (dr.scale < min) dr.scale = min;
      winT = 0;
      winFrames = 0;
      winCost = 0;
      winCostN = 0;
      atMinT = 0;
    },
    hold(seconds) {
      if (seconds > holdT) holdT = seconds;
      winT = 0;
      winFrames = 0;
      winCost = 0;
      winCostN = 0;
    },
    reset() {
      dr.scale = max;
      dr.dropRequested = false;
      winT = 0;
      winFrames = 0;
      winCost = 0;
      winCostN = 0;
      holdT = 0;
      atMinT = 0;
    },
    update(dt, held, costMs = 0, cap = 0) {
      if (!(dt > 0)) return false;
      if (holdT > 0) holdT -= dt;
      if (held || holdT > 0 || (cap > 0 && cap < target)) {
        winT = 0;
        winFrames = 0;
        winCost = 0;
        winCostN = 0;
        atMinT = 0;
        return false;
      }
      if (drop && !dr.dropRequested && dr.scale <= min + 1e-6) {
        atMinT += dt;
        if (atMinT >= DROP_AFTER) dr.dropRequested = true;
      } else {
        atMinT = 0;
      }
      winT += dt;
      winFrames++;
      if (costMs > 0) {
        winCost += costMs;
        winCostN++;
      }
      if (winT < interval) return false;
      const shown = winFrames / winT;
      const costFps = winCostN > 0 ? 1000 / (winCost / winCostN) : 0;
      winT = 0;
      winFrames = 0;
      winCost = 0;
      winCostN = 0;
      const slow = shown < target - 3 || (costFps > 0 && costFps < target - 3);
      const fast = costFps > 0 ? costFps > target + 8 && shown >= target - 3 : shown > target + 8;
      let next = dr.scale;
      if (slow) next = Math.max(min, snap(dr.scale - step));
      else if (fast) next = Math.min(max, snap(dr.scale + step));
      if (next === dr.scale) return false;
      dr.scale = next;
      return true;
    },
  };
  dr.configure(caps, canDrop);
  dr.scale = max;
  return dr;
}
