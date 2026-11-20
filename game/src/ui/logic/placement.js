/**
 * Placement of the HUD's centre pieces (the lane of pill, prompt and toasts; the banner) around keep-out boxes: the
 * hero's and the locked target's projected screen boxes. Nothing in the centre may cover either. Pure module, no
 * allocation: callers pass preallocated rectangles and an `out` object.
 * @module ui/logic/placement
 */

/** @typedef {{ x:number, y:number, w:number, h:number, on:boolean }} Box */

/** Gap kept between a centre piece and a keep-out box (CSS px). */
export const KEEP_PAD = 8;

/**
 * Screen box of a standing body from its projected feet and head points.
 * @param {number} fx @param {number} fy feet (CSS px) @param {number} hx @param {number} hy head
 * @param {Box} out
 */
export function bodyBox(fx, fy, hx, hy, out) {
  const tall = Math.max(24, fy - hy);
  const w = Math.max(36, tall * 0.62);
  const cx = (fx + hx) * 0.5;
  out.x = cx - w * 0.5;
  out.y = Math.min(fy, hy) - tall * 0.12;
  out.w = w;
  out.h = tall * 1.18;
  out.on = true;
  return out;
}

/**
 * @param {{x:number,y:number,w:number,h:number}} a @param {{x:number,y:number,w:number,h:number}} b @param {number} [pad]
 * @returns {boolean}
 */
export function hits(a, b, pad = 0) {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

/** @param {{x:number,y:number,w:number,h:number}} r @param {ReadonlyArray<Box>} keeps @param {number} dx @param {number} dy */
function clearOf(r, keeps, dx, dy) {
  for (let i = 0; i < keeps.length; i++) {
    const k = keeps[i];
    if (!k.on) continue;
    if (r.x + dx < k.x + k.w + KEEP_PAD && k.x < r.x + dx + r.w + KEEP_PAD && r.y + dy < k.y + k.h + KEEP_PAD && k.y < r.y + dy + r.h + KEEP_PAD) return false;
  }
  return true;
}

/**
 * Offset for a centre piece whose resting rectangle is `base`: unchanged when it is clear of every keep-out box;
 * otherwise lifted above the highest box it meets (never above `minTop`); otherwise moved sideways beside the boxes
 * (inside `minX..maxX`); otherwise left at rest (the controls under it come first).
 * @param {{x:number,y:number,w:number,h:number}} base
 * @param {ReadonlyArray<Box>} keeps
 * @param {{ minTop:number, minX:number, maxX:number, maxBottom?:number }} lim
 * @param {{ dx:number, dy:number, moved:boolean }} out
 */
export function placeAround(base, keeps, lim, out) {
  out.dx = 0;
  out.dy = 0;
  out.moved = false;
  if (base.w <= 0 || base.h <= 0 || clearOf(base, keeps, 0, 0)) return out;
  // Lift: the bottom goes above the top of every box the piece would meet on its way up.
  let top = Infinity;
  for (let i = 0; i < keeps.length; i++) {
    const k = keeps[i];
    if (!k.on) continue;
    if (base.x < k.x + k.w + KEEP_PAD && k.x < base.x + base.w + KEEP_PAD && k.y < base.y + base.h) top = Math.min(top, k.y);
  }
  if (top < Infinity) {
    const dy = top - KEEP_PAD - (base.y + base.h);
    if (base.y + dy >= lim.minTop && clearOf(base, keeps, 0, dy)) {
      out.dy = dy;
      out.moved = true;
      return out;
    }
  }
  // Drop: below every box, when there is room above the controls.
  if (typeof lim.maxBottom === 'number') {
    let bot = -Infinity;
    for (let i = 0; i < keeps.length; i++) {
      const k = keeps[i];
      if (k.on && base.x < k.x + k.w + KEEP_PAD && k.x < base.x + base.w + KEEP_PAD) bot = Math.max(bot, k.y + k.h);
    }
    const dy = bot + KEEP_PAD - base.y;
    if (bot > -Infinity && base.y + base.h + dy <= lim.maxBottom && clearOf(base, keeps, 0, dy)) {
      out.dy = dy;
      out.moved = true;
      return out;
    }
  }
  // Sideways: try both sides of each box, nearest first.
  let best = Infinity;
  for (let i = 0; i < keeps.length; i++) {
    const k = keeps[i];
    if (!k.on) continue;
    for (let s = 0; s < 2; s++) {
      const x = s === 0 ? k.x - KEEP_PAD - base.w - 1 : k.x + k.w + KEEP_PAD + 1;
      if (x < lim.minX || x + base.w > lim.maxX) continue;
      const dx = x - base.x;
      if (Math.abs(dx) < best && clearOf(base, keeps, dx, 0)) {
        best = Math.abs(dx);
        out.dx = dx;
        out.moved = true;
      }
    }
  }
  return out;
}
