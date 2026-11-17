/**
 * Builder (ARCHITECTURE 8.4): turns an actor spec into a cached rig: one merged rigid-skinned BufferGeometry per
 * Form look (base plus each Form's added parts), the bone layout, the upper-body mask, spring chains, sockets and
 * face bones. Geometry is shared by every actor of a spec and disposed with the service.
 * @module actors/builder
 */

import { BufferGeometry, BufferAttribute, Sphere, Vector3 } from 'three';
import { mergeSpec } from './logic/mesh.js';
import { DEFAULT_CHAINS, UPPER, SOCKETS, SOCKET_OFFSET, buildScale } from './logic/rigs.js';
import { family } from './logic/poses.js';

/** Socket names in a fixed order (4.5). */
export const SOCKET_NAMES = Object.freeze(['handR', 'handL', 'chest', 'head', 'feet', 'back']);

/** @param {ReturnType<typeof mergeSpec>} m @returns {BufferGeometry} */
function toGeometry(m) {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(m.position, 3));
  geo.setAttribute('normal', new BufferAttribute(m.normal, 3));
  geo.setAttribute('paletteIndex', new BufferAttribute(m.paletteIndex, 1));
  geo.setAttribute('skinIndex', new BufferAttribute(m.skinIndex, 4));
  const w = new Float32Array(m.vertices * 4);
  for (let i = 0; i < w.length; i += 4) w[i] = 1;
  geo.setAttribute('skinWeight', new BufferAttribute(w, 4));
  geo.setIndex(new BufferAttribute(m.index, 1));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * A cached rig for one spec.
 * @param {any} spec actorSpec
 * @param {(tag:string, ...a:any[]) => void} warn
 */
export function buildRig(spec, warn) {
  const base = mergeSpec(spec, null);
  if (base.problems.length) warn('spec ' + spec.id + ': ' + base.problems[0]);
  const fam = family(spec.rig);
  const scale = spec.scale > 0 ? spec.scale : 1;
  const nb = base.bones.length;
  const { sy } = buildScale(spec.rig, spec.build);
  const upper = new Uint8Array(nb);
  for (const n of UPPER[spec.rig] || UPPER.humanoid) {
    const i = base.bones.indexOf(n);
    if (i >= 0) upper[i] = 1;
  }
  const chainsSrc = spec.chains || DEFAULT_CHAINS[spec.rig] || [];
  const chains = [];
  let springN = 0;
  for (const c of chainsSrc) {
    const idx = [];
    for (const b of c.bones) {
      const i = base.bones.indexOf(b);
      if (i >= 0) idx.push(i);
    }
    if (!idx.length) continue;
    chains.push({ idx: Int8Array.from(idx), stiffness: c.stiffness || 40, damping: c.damping || 6, start: springN, trail: !/^sash|^tail1$/.test(c.bones[0]) || spec.rig !== 'humanoid' });
    springN += idx.length;
  }
  const sockMap = SOCKETS[spec.rig] || SOCKETS.humanoid;
  const sockOff = SOCKET_OFFSET[fam] || SOCKET_OFFSET.humanoid;
  const socketBone = new Int8Array(SOCKET_NAMES.length);
  const socketOff = new Float32Array(SOCKET_NAMES.length * 3);
  for (let s = 0; s < SOCKET_NAMES.length; s++) {
    const n = SOCKET_NAMES[s];
    socketBone[s] = base.bones.indexOf(sockMap[n]);
    const o = sockOff[n] || [0, 0, 0];
    for (let k = 0; k < 3; k++) socketOff[s * 3 + k] = o[k] * sy * scale;
  }
  const geos = new Map();
  const g = toGeometry(base);
  const H = spec.build.height * scale;
  geos.set('', g);
  const sphere = new Sphere(new Vector3(0, H * 0.5, 0), Math.max(g.boundingSphere ? g.boundingSphere.radius * 1.35 : H, H * 0.9));
  const slotIndex = {};
  base.slots.forEach((s, i) => { slotIndex[s] = i; });
  return {
    spec, id: spec.id, rig: spec.rig, fam, names: base.bones, nb, parent: base.parent, rest: base.rest,
    offScale: sy * scale, upper, chains, springN, socketBone, socketOff, geos, sphere,
    triangles: base.triangles, radius: spec.radius, height: H, hover: !!spec.hover, face: !!spec.face,
    browL: base.bones.indexOf('browL'), browR: base.bones.indexOf('browR'), jaw: base.bones.indexOf('jaw'),
    hips: base.bones.indexOf('hips'), chest: base.bones.indexOf('chest'), spine: base.bones.indexOf('spine'),
    head: base.bones.indexOf('head'), neck: base.bones.indexOf('neck'), extra: base.bones.indexOf('extra1'),
    slots: base.slots, slotIndex, stride: H / (fam === 'humanoid' ? 1.8 : fam === 'quadruped' ? 1.2 : 1),
  };
}

/**
 * Geometry of a rig for a Form look (built lazily and cached on the rig).
 * @param {any} rig @param {string|null} formKey @returns {BufferGeometry}
 */
export function geometryFor(rig, formKey) {
  const key = formKey && rig.spec.forms && rig.spec.forms[formKey] ? formKey : '';
  let g = rig.geos.get(key);
  if (!g) {
    g = toGeometry(mergeSpec(rig.spec, key));
    rig.geos.set(key, g);
  }
  return g;
}
