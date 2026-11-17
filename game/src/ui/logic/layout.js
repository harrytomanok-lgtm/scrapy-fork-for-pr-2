/**
 * HUD layout modes (ART_UX 6.6) and rectangle helpers shared by the HUD and the tests. Pure module.
 * @module ui/logic/layout
 */

/**
 * @typedef {'portrait'|'landscape'|'short'|'desktop'} HudMode
 *   portrait: phone held upright (three rows over a bottom control deck);
 *   landscape: phone on its side with the touch controls;
 *   short: landscape under 380 px tall, where the left thumb's Gather and Item buttons reach up to 46 px from the
 *          top, so the bar block becomes a single 28 px row;
 *   desktop: no touch controls (keyboard, mouse, gamepad).
 */

/**
 * @param {number} w viewport width (CSS px) @param {number} h viewport height @param {boolean} touch touch controls shown
 * @returns {HudMode}
 */
export function hudMode(w, h, touch) {
  if (h > w) return 'portrait';
  if (!touch) return 'desktop';
  return h < 380 ? 'short' : 'landscape';
}

/**
 * @param {{ x:number, y:number, w:number, h:number }} a @param {{ x:number, y:number, w:number, h:number }} b
 * @param {number} [pad=0] treat rectangles closer than `pad` as touching
 * @returns {boolean}
 */
export function intersects(a, b, pad = 0) {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

/**
 * Pairs of intersecting rectangles (index pairs), for the layout rule of ART_UX 6.6.
 * @param {ReadonlyArray<{ x:number, y:number, w:number, h:number }>} rects
 * @returns {Array<[number, number]>}
 */
export function overlaps(rects) {
  const out = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) if (intersects(rects[i], rects[j])) out.push([i, j]);
  }
  return out;
}
