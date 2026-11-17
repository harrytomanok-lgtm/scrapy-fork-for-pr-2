/**
 * The control package (ARCHITECTURE 8.5): movement for every actor (`ctx.move`), the player's intent, the camera
 * (`ctx.cam`), touch controls (input source 'touch'), the full gamepad (input source 'pad') and desktop
 * pointer-lock handling.
 * @module control
 */

import { createMove } from './move.js';
import { createCam } from './cam.js';
import { createTouch } from './touch.js';
import { createPad } from './pad.js';
import { createPointer } from './pointer.js';
import { createLatch } from './logic/intent.js';
import { strings } from './strings.js';

export const pkg = {
  id: 'control',
  /** @param {any} ctx */
  install(ctx) {
    ctx.i18n.addStrings(strings);
    /** Package-private state shared by the intent system, the camera and the touch layer. */
    const shared = { latch: createLatch(), pointerLocked: false, noLock: false };
    const mv = createMove(ctx, shared);
    ctx.provide('move', mv.move, 'control');
    ctx.systems.add(mv.playerSystem);
    ctx.systems.add(mv.runSystem);
    ctx.bus.on('game:ended', mv.reset);

    const cm = createCam(ctx, shared);
    const unsub = ctx.input.onPress(cm.onPress);
    const pointer = createPointer(ctx, shared);
    const camDispose = cm.cam.dispose;
    cm.cam.dispose = () => {
      camDispose();
      unsub();
      pointer.dispose();
    };
    ctx.provide('cam', cm.cam, 'control');
    ctx.systems.add(cm.lookSystem);
    ctx.systems.add(cm.rigSystem);
    ctx.bus.on('combat:lock', cm.onLock);
    ctx.bus.on('game:ended', cm.onEnded);

    ctx.input.registerSource('touch', createTouch(ctx, shared));
    ctx.input.registerSource('pad', createPad(ctx));
  },
};
