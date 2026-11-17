/**
 * Focus navigation for keyboard and gamepad (ART_UX 7.1): spatial moves between the focusable rectangles of the
 * open screen, with wrap-around so no element is a dead end, and a checker for whole graphs (Node tests and the
 * ui-screens scenario use the same code on synthetic and real layouts). Directions are physical, like arrow keys
 * and the D-pad, in both languages. Pure module.
 * @module ui/logic/focus
 */

/** @typedef {{ x:number, y:number, w:number, h:number }} Rect */
/** @typedef {'up'|'down'|'left'|'right'} Dir */

export const DIRS = Object.freeze(['up', 'down', 'left', 'right']);

/**
 * The index focused after moving from `from` in `dir`, or `from` when there is nowhere to go.
 * Candidates lie beyond the current rectangle's centre in that direction; the score is the distance along the
 * direction plus twice the orthogonal offset. With no candidate the move wraps to the farthest element on the
 * opposite side that best overlaps the current row or column.
 * @param {ReadonlyArray<Rect>} rects
 * @param {number} from
 * @param {Dir} dir
 * @returns {number}
 */
export function moveFocus(rects, from, dir) {
  const n = rects.length;
  if (n === 0) return -1;
  if (from < 0 || from >= n) return 0;
  const a = rects[from];
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const horiz = dir === 'left' || dir === 'right';
  const sign = dir === 'right' || dir === 'down' ? 1 : -1;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < n; i++) {
    if (i === from) continue;
    const b = rects[i];
    const bx = b.x + b.w / 2;
    const by = b.y + b.h / 2;
    const along = (horiz ? bx - ax : by - ay) * sign;
    if (along <= 1) continue;
    const ortho = Math.abs(horiz ? by - ay : bx - ax);
    // Same row or column (overlapping extents) costs nothing sideways.
    const overlap = horiz ? b.y < a.y + a.h && a.y < b.y + b.h : b.x < a.x + a.w && a.x < b.x + b.w;
    const score = along + (overlap ? 0 : 2 * ortho + 40);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best >= 0) return best;
  // Wrap: the farthest element on the other side, preferring the same row or column.
  let wrap = -1;
  let wrapScore = -Infinity;
  for (let i = 0; i < n; i++) {
    if (i === from) continue;
    const b = rects[i];
    const bx = b.x + b.w / 2;
    const by = b.y + b.h / 2;
    const back = (horiz ? ax - bx : ay - by) * sign;
    const ortho = Math.abs(horiz ? by - ay : bx - ax);
    const score = back - 3 * ortho;
    if (back >= -1 && score > wrapScore) {
      wrapScore = score;
      wrap = i;
    }
  }
  return wrap >= 0 ? wrap : from;
}

/**
 * Problems of a focus graph (empty = fine): elements with no exit (every move stays put) when there is more than
 * one element, and elements that cannot be reached from the first one, or cannot reach it back.
 * @param {ReadonlyArray<Rect>} rects
 * @returns {string[]}
 */
export function focusProblems(rects) {
  const n = rects.length;
  const out = [];
  if (n <= 1) return out;
  /** @type {number[][]} */
  const edges = [];
  for (let i = 0; i < n; i++) {
    const e = [];
    for (const d of DIRS) {
      const j = moveFocus(rects, i, /** @type {Dir} */ (d));
      if (j !== i && e.indexOf(j) < 0) e.push(j);
    }
    edges.push(e);
    if (!e.length) out.push('element ' + i + ' is a dead end');
  }
  const reach = (start, adj) => {
    const seen = new Uint8Array(n);
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const k = /** @type {number} */ (stack.pop());
      for (const j of adj[k]) if (!seen[j]) {
        seen[j] = 1;
        stack.push(j);
      }
    }
    return seen;
  };
  const fwd = reach(0, edges);
  /** @type {number[][]} */
  const rev = [];
  for (let i = 0; i < n; i++) rev.push([]);
  for (let i = 0; i < n; i++) for (const j of edges[i]) rev[j].push(i);
  const back = reach(0, rev);
  for (let i = 0; i < n; i++) {
    if (!fwd[i]) out.push('element ' + i + ' is unreachable');
    if (!back[i]) out.push('element ' + i + ' cannot return');
  }
  return out;
}

/**
 * Rectangles for a layout described as rows of item counts (a synthetic screen for tests): every row fills
 * `width`, items share it equally, rows are `rowH` apart. A row given as a negative count is a vertical column
 * of that many items placed at the start of the remaining height.
 * @param {ReadonlyArray<number>} rows
 * @param {number} [width=560] @param {number} [rowH=56]
 * @returns {Rect[]}
 */
export function gridRects(rows, width = 560, rowH = 56) {
  const out = [];
  let y = 0;
  for (const count of rows) {
    const k = Math.max(1, count);
    const w = width / k;
    for (let i = 0; i < k; i++) out.push({ x: i * w + 4, y: y + 4, w: w - 8, h: rowH - 8 });
    y += rowH;
  }
  return out;
}

/**
 * The focus layout of every menu screen as rows of item counts, in its narrowest (portrait) arrangement: the
 * shared tab bar first where a screen has one. Used by the Node test; the ui-screens scenario checks the real DOM.
 */
export const SCREEN_FOCUS_ROWS = Object.freeze({
  title: [1, 1, 1, 1, 2],
  newgame: [2, 2, 3, 1, 2],
  pause: [5, 5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  character: [5, 4, 2, 2, 2, 2],
  techniques: [5, 3, 1, 1, 1, 1, 3],
  inventory: [5, 4, 4, 4, 2],
  quests: [5, 2, 1, 1, 1, 1],
  map: [5, 1],
  settings: [6, 2, 3, 1, 1, 1, 2, 2],
  controls: [3, 1],
  savecode: [2, 1, 1],
  shop: [2, 1, 1, 1, 1, 1],
  dialogue: [1, 1, 1],
  death: [1, 1],
  ending: [1],
  fatal: [2],
  confirm: [2],
});
