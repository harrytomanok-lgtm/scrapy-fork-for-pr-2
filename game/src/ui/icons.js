/**
 * In-house SVG icon set (ART_UX 7.1): 24 px grid, 2 px stroke, round caps and joins, `currentColor`.
 * Each icon is a list of path `d` strings; a leading '*' fills the path instead of stroking it.
 * Directional icons carry `flip-rtl` so they mirror in Hebrew.
 * @module ui/icons
 */

const NS = 'http://www.w3.org/2000/svg';

/** @type {Record<string, string[]>} */
export const ICONS = {
  pause: ['M9 6v12', 'M15 6v12'],
  map: ['M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z', 'M9 4v14', 'M15 6v14'],
  back: ['M15 5l-7 7 7 7'],
  next: ['M9 5l7 7-7 7'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  check: ['M5 12.5l4.5 4.5L19 7'],
  save: ['M12 3a9 9 0 1 0 9 9', 'M12 7v5l3 2'],
  warn: ['M12 3l10 18H2z', 'M12 10v5', '*M12 17.2a1.2 1.2 0 1 0 0.01 0z'],
  fist: ['M7 11V7a2 2 0 0 1 4 0v3', 'M11 10V6a2 2 0 0 1 4 0v4', 'M15 10V8a2 2 0 0 1 4 0v6a7 7 0 0 1-7 7h-1a6 6 0 0 1-6-6v-3a2 2 0 0 1 2-2h3'],
  flare: ['M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 3 3 5', 'M12 21a2 2 0 0 0 2-2c0-2-2-3-2-5-1 2-2 3-2 5a2 2 0 0 0 2 2z'],
  spirit: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10z', '*M12 10.5a1.5 1.5 0 1 0 0.01 0z'],
  wraps: ['M5 8l14-3', 'M5 12l14-3', 'M5 16l14-3', 'M5 20l14-3', 'M5 8v12', 'M19 5v12'],
  garb: ['M8 3l4 3 4-3 5 4-3 4-2-1v11H8V10l-2 1-3-4z'],
  charm: ['M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z'],
  fruit: ['M12 7a7 7 0 1 0 0.01 0z', 'M12 7c0-2 1-4 3-4', 'M12 7c-1-1-3-1-4 0'],
  draught: ['M10 3h4', 'M10 3v5l-4 7a4 4 0 0 0 3.5 6h5a4 4 0 0 0 3.5-6l-4-7V3', 'M7.5 14h9'],
  core: ['M12 3l8 5v8l-8 5-8-5V8z', 'M12 8l4 2.5v3L12 16l-4-2.5v-3z'],
  shell: ['M12 20c-5 0-9-4-9-9a9 9 0 0 1 18 0c0 5-4 9-9 9z', 'M12 20V5', 'M12 20l-6-12', 'M12 20l6-12'],
  diamond: ['*M12 3l7 9-7 9-7-9z'],
  gear: ['M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z', 'M12 2v3', 'M12 19v3', 'M2 12h3', 'M19 12h3', 'M4.9 4.9l2.1 2.1', 'M17 17l2.1 2.1', 'M4.9 19.1L7 17', 'M17 7l2.1-2.1'],
  pad: ['M7 8h10a4 4 0 0 1 4 4l1 5a2.5 2.5 0 0 1-4.5 1.5L15 16H9l-2.5 2.5A2.5 2.5 0 0 1 2 17l1-5a4 4 0 0 1 4-4z', 'M8 11v3', 'M6.5 12.5h3', '*M16 11.5a1 1 0 1 0 0.01 0z', '*M18 13.5a1 1 0 1 0 0.01 0z'],
  person: ['M12 3a4 4 0 1 0 0 8a4 4 0 1 0 0-8z', 'M4 21a8 8 0 0 1 16 0'],
  ring: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z'],
  bag: ['M5 8h14l-1 12H6z', 'M9 8V6a3 3 0 0 1 6 0v2'],
  scroll: ['M7 4h11a2 2 0 0 1 0 4h-1v10a2 2 0 0 1-2 2H6a2 2 0 0 1 0-4h1z', 'M10 9h4', 'M10 13h4'],
  copy: ['M8 8h11v12H8z', 'M5 16V4h11'],
  restore: ['M4 12a8 8 0 1 0 2.3-5.7', 'M4 4v4h4'],
  globe: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M3 12h18', 'M12 3c3 3 3 15 0 18', 'M12 3c-3 3-3 15 0 18'],
  play: ['*M8 5l11 7-11 7z'],
  lock: ['M6 11h12v9H6z', 'M8 11V8a4 4 0 0 1 8 0v3'],
  arrow: ['*M12 2l7 19-7-4-7 4z'],
  home: ['M4 11l8-7 8 7', 'M6 10v10h12V10'],
  sound: ['M4 9h4l5-4v14l-5-4H4z', 'M16 9a4 4 0 0 1 0 6', 'M18.5 6.5a8 8 0 0 1 0 11'],
  eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z'],
  text: ['M5 6h14', 'M12 6v13', 'M8 19h8'],
  hand: ['M8 12V5a1.5 1.5 0 0 1 3 0v6', 'M11 11V4a1.5 1.5 0 0 1 3 0v7', 'M14 11V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7 6 6 0 0 1-5-3l-3-5a1.5 1.5 0 0 1 2.5-1.6L8 14'],
  key: ['M4 7h16v10H4z', 'M7 10h1', 'M10 10h1', 'M13 10h1', 'M16 10h1', 'M8 14h8'],
  sword: ['M14 4l6 0 0 6-9 9-6-6z', 'M4 20l3-3', 'M8 13l3 3'],
  up: ['*M12 5l7 9H5z'],
  down: ['*M12 19l7-9H5z'],
  lockd: ['M7 11h10v8H7z', 'M9 11V8a3 3 0 0 1 6 0v3'],
  skull: ['M12 3a8 8 0 0 0-5 14v3h10v-3a8 8 0 0 0-5-14z', '*M9 10.5a1.6 1.6 0 1 0 0.01 0z', '*M15 10.5a1.6 1.6 0 1 0 0.01 0z'],
};

/** Icons that point along the reading direction and mirror in RTL. */
const FLIP = new Set(['back', 'next']);

/**
 * Build an inline SVG icon.
 * @param {Document} doc
 * @param {string} name
 * @param {string} [cls]
 * @returns {SVGSVGElement}
 */
export function icon(doc, name, cls) {
  const svg = /** @type {SVGSVGElement} */ (doc.createElementNS(NS, 'svg'));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', (cls || 'ui-ico') + (FLIP.has(name) ? ' flip-rtl' : ''));
  const paths = ICONS[name] || ICONS.diamond;
  for (const d of paths) {
    const p = doc.createElementNS(NS, 'path');
    const filled = d[0] === '*';
    p.setAttribute('d', filled ? d.slice(1) : d);
    if (filled) {
      p.setAttribute('fill', 'currentColor');
      p.setAttribute('stroke', 'none');
    }
    svg.appendChild(p);
  }
  return svg;
}

/**
 * Icon name for an item definition.
 * @param {any} def ItemDef
 * @returns {string}
 */
export function itemIcon(def) {
  if (!def) return 'diamond';
  if (def.slot === 'wraps') return 'wraps';
  if (def.slot === 'garb') return 'garb';
  if (def.slot === 'charm') return 'charm';
  if (def.id === 'ora_draught') return 'draught';
  if (def.id === 'sunfruit') return 'fruit';
  return 'core';
}
