/**
 * The control package (ARCHITECTURE 8.5): movement for every actor (`ctx.move`), the player's intent, the camera
 * (`ctx.cam`), touch controls (input source 'touch') and the full gamepad (input source 'pad').
 * @module control
 */

import { createMove } from './move.js';
import { createLatch } from './logic/intent.js';

export const pkg = {
  id: 'control',
  /** @param {any} ctx */
  install(ctx) {
    /** Package-private state shared by the intent system, the camera and the touch layer. */
    const shared = { latch: createLatch() };
    const mv = createMove(ctx, shared);
    ctx.provide('move', mv.move, 'control');
    ctx.systems.add(mv.playerSystem);
    ctx.systems.add(mv.runSystem);
    ctx.bus.on('game:ended', mv.reset);
  },
};
