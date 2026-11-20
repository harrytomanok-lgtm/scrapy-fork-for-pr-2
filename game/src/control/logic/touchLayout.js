/**
 * Touch control layouts of ART_UX 6.2 (landscape) and 6.3 (portrait). Pure: the DOM layer and the Node layout
 * tests compute the same rectangles. Coordinates are CSS pixels with the origin at the top-left of the viewport;
 * buttons are circles given by centre and diameter. Controls are physically placed (never mirrored in Hebrew);
 * the left-handed option swaps the sides.
 * @module control/logic/touchLayout
 */

/** Every touch button, in drawing order. */
export const TOUCH_BUTTONS = Object.freeze([
  'attack', 'bolt', 'dash', 'guard', 'jump', 'descend', 'tech1', 'tech2', 'form', 'ultimate', 'gather', 'item',
]);

/** Minimum target and gap (ART_UX 6.1). */
export const MIN_TARGET = 48;
export const MIN_GAP = 8;

/**
 * @typedef {{ action:string, x:number, y:number, d:number, side:'thumbR'|'thumbL' }} TouchButton
 * @typedef {{ x:number, y:number, w:number, h:number }} Rect
 * @typedef {{ portrait:boolean, w:number, h:number, buttons:TouchButton[], move:Rect, look:Rect, deck:Rect|null,
 *   ghost:{ x:number, y:number, d:number }, stickBase:number, stickKnob:number, travel:number }} TouchLayout
 */

/**
 * Compute the layout.
 * @param {{ w:number, h:number, safeL?:number, safeR?:number, safeT?:number, safeB?:number, leftHanded?:boolean }} o
 * @returns {TouchLayout}
 */
export function touchLayout(o) {
  const w = o.w;
  const h = o.h;
  const sl = o.safeL || 0;
  const sr = o.safeR || 0;
  const sb = o.safeB || 0;
  const st = o.safeT || 0;
  const portrait = h > w;
  /** @type {TouchButton[]} */
  const buttons = [];
  // Right-thumb positions are built as (distance from the safe right edge, distance from the safe bottom edge).
  /** @param {string} action @param {number} fromRight @param {number} fromBottom @param {number} d */
  const right = (action, fromRight, fromBottom, d) => {
    buttons.push({ action, x: w - sr - fromRight, y: h - sb - fromBottom, d, side: 'thumbR' });
  };
  /** @param {string} action @param {number} fromLeft @param {number} fromTop @param {number} d */
  const left = (action, fromLeft, fromTop, d) => {
    buttons.push({ action, x: sl + fromLeft, y: fromTop, d, side: 'thumbL' });
  };
  /** @type {Rect} */
  let move;
  /** @type {Rect} */
  let look;
  /** @type {Rect|null} */
  let deck = null;
  let ghost;
  let stickBase;
  let travel;
  if (!portrait) {
    // ART_UX 6.2: Attack anchors the arc at right 22, bottom 22 (centre 60, 60).
    const ax = 60;
    const ay = 60;
    right('attack', ax, ay, 76);
    right('dash', ax, ay + 104, 60);
    right('bolt', ax + 80, ay + 67, 60);
    right('guard', ax + 102, ay - 18, 56);
    right('jump', ax + 176, ay - 6, 60);
    right('descend', ax + 240, ay - 6, 48);
    right('tech2', ax + 24, ay + 174, 48);
    right('tech1', ax + 103, ay + 142, 48);
    right('form', ax + 158, ay + 77, 48);
    right('ultimate', ax + 161, ay + 192, 56);
    // Gather and Item on the left thumb, above the stick zone (boxes at left 24 / bottom 242 and left 92 / bottom 246).
    left('gather', 24 + 28, h - sb - 242 - 28, 56);
    left('item', 92 + 24, h - sb - 246 - 24, 48);
    move = { x: 0, y: Math.round(h * 0.4), w: Math.round(w * 0.4), h: h - Math.round(h * 0.4) };
    look = { x: Math.round(w * 0.4), y: 0, w: w - Math.round(w * 0.4), h };
    ghost = { x: sl + 28 + 60, y: h - sb - 28 - 60, d: 120 };
    stickBase = 120;
    travel = 48;
  } else {
    // ART_UX 6.3: control deck = bottom 32%; arc scaled 0.9 around Attack 68 (radius 92, shrinking under 380 px).
    const deckH = Math.round(h * 0.32);
    const deckTop = h - deckH;
    deck = { x: 0, y: deckTop, w, h: deckH };
    const k = w < 380 ? Math.max(0.86, w / 400) : 1;
    const ax = 56;
    const ay = 56;
    const R = 92 * k;
    right('attack', ax, ay, 68);
    right('dash', ax, ay + R, 54);
    const bolt = { x: ax + R * 0.766, y: ay + R * 0.643 };
    right('bolt', bolt.x, bolt.y, 54);
    const guard = { x: ax + R * 0.985, y: ay - R * 0.15 };
    right('guard', guard.x, guard.y, 50);
    const jumpX = guard.x + 25 + 27 + 12;
    right('jump', jumpX, ay - 4, 54);
    right('descend', jumpX + 27 + 10 + 24, ay - 4, 48);
    // Tech 1, Tech 2, Form and Ultimate stack in a column on the right edge, above the arc.
    let cy = ay + R + 27 + 12 + 24;
    right('tech1', ax, cy, 48);
    cy += 48 + 10;
    right('tech2', ax, cy, 48);
    cy += 48 + 10;
    right('form', ax, cy, 48);
    cy += 24 + 10 + 26;
    right('ultimate', ax, cy, 52);
    // Utility row at the top-left of the deck: Gather 52 and Item 48.
    const rowY = deckTop + 10 + 26;
    left('gather', 12 + 26, rowY, 52);
    left('item', 12 + 52 + 10 + 24, rowY, 48);
    // The move zone reaches 40 px above the deck on the left half (Gather and Item sit on top of it), so a stick
    // thumb landing a little high starts the stick, never a camera turn.
    const stickTop = deckTop - 40;
    move = { x: 0, y: stickTop, w: Math.round(w / 2), h: h - stickTop };
    look = { x: 0, y: 0, w, h: deckTop };
    ghost = { x: sl + 28 + 54, y: h - sb - 28 - 54, d: 108 };
    stickBase = 108;
    travel = 43;
  }
  if (o.leftHanded) {
    for (const b of buttons) {
      b.x = w - b.x;
      b.side = b.side === 'thumbR' ? 'thumbL' : 'thumbR';
    }
    move = { x: w - move.x - move.w, y: move.y, w: move.w, h: move.h };
    look = { x: w - look.x - look.w, y: look.y, w: look.w, h: look.h };
    ghost = { x: w - ghost.x, y: ghost.y, d: ghost.d };
  }
  return { portrait, w, h, buttons, move, look, deck, ghost, stickBase, stickKnob: portrait ? 48 : 52, travel };
}

/**
 * What a touch at (x, y) hits: a button action, 'move', 'look' or null.
 * @param {TouchLayout} layout @param {number} x @param {number} y @param {Record<string, boolean>} [visible]
 * @returns {string|null}
 */
export function hitTest(layout, x, y, visible) {
  for (const b of layout.buttons) {
    if (visible && !visible[b.action]) continue;
    const dx = x - b.x;
    const dy = y - b.y;
    if (dx * dx + dy * dy <= (b.d / 2) * (b.d / 2)) return b.action;
  }
  if (inRect(layout.move, x, y)) return 'move';
  if (inRect(layout.look, x, y)) return 'look';
  return null;
}

/** @param {Rect} r @param {number} x @param {number} y */
function inRect(r, x, y) {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/**
 * Layout problems (empty when valid): overlapping targets or gaps under 8 px, targets under 48 px, targets outside
 * the safe area, more than ten targets for one thumb on the action side.
 * @param {TouchLayout} layout @param {{ safeL?:number, safeR?:number, safeT?:number, safeB?:number }} safe
 * @returns {string[]}
 */
export function layoutProblems(layout, safe) {
  const out = [];
  const b = layout.buttons;
  const sl = safe.safeL || 0;
  const sr = safe.safeR || 0;
  const st = safe.safeT || 0;
  const sb = safe.safeB || 0;
  let rightCount = 0;
  for (let i = 0; i < b.length; i++) {
    const a = b[i];
    if (a.d < MIN_TARGET) out.push(`${a.action} is ${a.d} px`);
    const r = a.d / 2;
    if (a.x - r < sl - 0.01 || a.x + r > layout.w - sr + 0.01 || a.y - r < st - 0.01 || a.y + r > layout.h - sb + 0.01) {
      out.push(`${a.action} outside the safe area`);
    }
    if (a.x > layout.w / 2) rightCount++;
    for (let j = i + 1; j < b.length; j++) {
      const c = b[j];
      const gap = Math.hypot(a.x - c.x, a.y - c.y) - r - c.d / 2;
      if (gap < MIN_GAP - 0.01) out.push(`${a.action} and ${c.action} gap ${gap.toFixed(1)} px`);
    }
  }
  if (rightCount > 10) out.push(`${rightCount} targets on the right side`);
  return out;
}
