/**
 * Fixed-size slot pool for damage numbers and toasts (ARCHITECTURE 7.2 rule 3). Slots are indices into
 * preallocated arrays owned by the caller; when every slot is busy, the oldest one is recycled. Nothing allocates
 * after creation. Pure module.
 * @module ui/logic/slotPool
 */

/**
 * @typedef {{ size:number, busy:Uint8Array, born:Float64Array, serial:number, live:number }} SlotPool
 */

/** @param {number} size @returns {SlotPool} */
export function createSlotPool(size) {
  return { size, busy: new Uint8Array(size), born: new Float64Array(size), serial: 0, live: 0 };
}

/**
 * Take a free slot, or the oldest busy one when the pool is full.
 * @param {SlotPool} p
 * @returns {number} slot index
 */
export function acquire(p) {
  let free = -1;
  let oldest = 0;
  for (let i = 0; i < p.size; i++) {
    if (!p.busy[i]) {
      free = i;
      break;
    }
    if (p.born[i] < p.born[oldest]) oldest = i;
  }
  const i = free >= 0 ? free : oldest;
  if (!p.busy[i]) p.live++;
  p.busy[i] = 1;
  p.born[i] = ++p.serial;
  return i;
}

/** @param {SlotPool} p @param {number} i */
export function release(p, i) {
  if (i < 0 || i >= p.size || !p.busy[i]) return;
  p.busy[i] = 0;
  p.live--;
}

/** @param {SlotPool} p */
export function releaseAll(p) {
  p.busy.fill(0);
  p.live = 0;
}
