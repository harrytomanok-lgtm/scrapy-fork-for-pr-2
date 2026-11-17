/**
 * Gameplay prop kinds (ARCHITECTURE 4.2 table): states (the first is the default), collider, glow colour and the
 * default light colour. Pure data: Node tests load it.
 * @module env/data/props
 */

import { PALETTE } from '../../core/palette.js';

/**
 * @typedef {{ states:string[], collider:null|{ shape:'capsule'|'box'|'disc'|'sphere', r?:number, h:number, hx?:number, hz?:number },
 *             glow:number, color:number }} PropKind
 */

/** @type {Readonly<Record<string, PropKind>>} */
export const PROP_KINDS = Object.freeze({
  ringstone: { states: ['idle', 'active'], collider: { shape: 'capsule', r: 0.8, h: 4.2 }, glow: PALETTE.structure.ringstone, color: PALETTE.structure.ringstone },
  shrine: { states: ['ready', 'claimed'], collider: null, glow: PALETTE.ora, color: PALETTE.ora },
  chest: { states: ['locked', 'closed', 'open'], collider: { shape: 'box', hx: 0.8, hz: 0.55, h: 1.1 }, glow: PALETTE.ember, color: PALETTE.ember },
  siphon: { states: ['closed', 'open', 'destroyed'], collider: { shape: 'capsule', r: 4, h: 40 }, glow: PALETTE.hostile, color: PALETTE.hostile },
  ringGate: { states: ['idle', 'next', 'passed'], collider: null, glow: PALETTE.ora, color: PALETTE.ora },
  trainingPost: { states: ['idle', 'broken'], collider: { shape: 'capsule', r: 0.4, h: 2.2 }, glow: PALETTE.ora, color: PALETTE.ora },
  bell: { states: ['idle', 'used'], collider: { shape: 'box', hx: 1.25, hz: 0.3, h: 3.3 }, glow: PALETTE.ora, color: PALETTE.ora },
  fallenBlade: { states: ['idle', 'used'], collider: { shape: 'box', hx: 0.6, hz: 0.3, h: 3.4 }, glow: PALETTE.ora, color: PALETTE.ora },
  saltPillar: { states: ['idle', 'used', 'broken'], collider: { shape: 'capsule', r: 1.2, h: 6 }, glow: PALETTE.biome.coast.accent, color: PALETTE.biome.coast.accent },
  crate: { states: ['idle', 'used', 'broken'], collider: { shape: 'box', hx: 0.6, hz: 0.6, h: 1.2 }, glow: PALETTE.ember, color: PALETTE.ember },
  lightPillar: { states: ['on', 'off'], collider: null, glow: PALETTE.ora, color: PALETTE.ora },
  campfire: { states: ['idle'], collider: { shape: 'box', hx: 0.9, hz: 0.9, h: 0.5 }, glow: PALETTE.structure.lantern, color: PALETTE.structure.lantern },
  tent: { states: ['idle'], collider: { shape: 'disc', r: 1.9, h: 2.4 }, glow: PALETTE.structure.lantern, color: PALETTE.structure.lantern },
  signpost: { states: ['idle'], collider: { shape: 'box', hx: 0.3, hz: 0.3, h: 2.2 }, glow: PALETTE.ora, color: PALETTE.ora },
});
