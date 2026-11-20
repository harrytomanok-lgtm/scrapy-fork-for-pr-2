/**
 * The bark queue: lines said while play goes on (toasts "Speaker: line"), one every `gap` seconds of sim time.
 * Sequences queue behind each other (never interleave), and a queued line is said even after the quest step that
 * barked it has ended; only a world change (clear) drops them. Pure: the caller shows the lines.
 * @module rpg/logic/barks
 */

/**
 * @param {number} gap seconds between two lines
 * @returns {{ push:(node:any)=>void, tick:(dt:number, show:(node:any)=>void)=>void, clear:()=>void, readonly length:number }}
 */
export function createBarkQueue(gap) {
  /** @type {any[]} */
  const queue = [];
  let wait = 0;
  return {
    /** Queue one line. The first line of an idle queue is said on the next tick. */
    push(node) {
      queue.push(node);
    },
    tick(dt, show) {
      if (wait > 0) wait -= dt;
      if (wait > 0 || queue.length === 0) return;
      show(queue.shift());
      wait = gap;
    },
    clear() {
      queue.length = 0;
      wait = 0;
    },
    get length() {
      return queue.length;
    },
  };
}
