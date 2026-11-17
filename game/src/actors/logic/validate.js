/**
 * Spec validation (ARCHITECTURE 8.4 Definition of Done): bones exist for the rig, at most 16 palette slots,
 * at most 28 bones, known shapes, chains on real bones, Form blocks well formed, triangle count per Form.
 * Pure (no three).
 * @module actors/logic/validate
 */

import { boneNames, isRig, MAX_BONES } from './rigs.js';
import { SHAPES, partTriangles, specParts } from './mesh.js';

/**
 * @param {any} spec
 * @returns {{ errors:string[], triangles:number, maxTriangles:number }} triangles of the base look, max over Forms
 */
export function validateSpec(spec) {
  const errors = [];
  const id = spec && spec.id ? spec.id : '?';
  const err = (m) => errors.push(id + ': ' + m);
  if (!spec || typeof spec !== 'object') return { errors: ['spec is not an object'], triangles: 0, maxTriangles: 0 };
  if (!isRig(spec.rig)) err('unknown rig ' + spec.rig);
  const bones = boneNames(spec.rig);
  if (bones.length > MAX_BONES) err('more than 28 bones');
  const slots = Object.keys(spec.palette || {});
  if (!slots.length) err('no palette');
  if (slots.length > 16) err('more than 16 palette slots (' + slots.length + ')');
  for (const s of slots) if (typeof spec.palette[s] !== 'number') err('palette slot ' + s + ' is not a colour');
  if (!(spec.scale > 0)) err('scale must be > 0');
  if (!spec.build || !(spec.build.height > 0)) err('build.height must be > 0');
  if (!(spec.radius > 0)) err('radius must be > 0');
  const checkParts = (parts, where) => {
    for (const p of parts) {
      if (bones.indexOf(p.bone) < 0) err(where + ': part on unknown bone ' + p.bone);
      if (SHAPES.indexOf(p.shape) < 0) err(where + ': unknown shape ' + p.shape);
      if (slots.indexOf(p.slot) < 0) err(where + ': part slot ' + p.slot + ' is not in the palette');
      if (!Array.isArray(p.size) || !p.size.length) err(where + ': part without size');
    }
  };
  checkParts(spec.parts || [], 'parts');
  for (const c of spec.chains || []) for (const b of c.bones) if (bones.indexOf(b) < 0) err('chain on unknown bone ' + b);
  if (spec.emissive) for (const k of Object.keys(spec.emissive)) if (slots.indexOf(k) < 0) err('emissive slot ' + k + ' is not in the palette');
  const tri = (formKey) => {
    let n = 0;
    for (const p of specParts(spec, formKey)) n += partTriangles(p);
    return n;
  };
  const triangles = tri(null);
  let maxTriangles = triangles;
  if (spec.forms) {
    for (const f of Object.keys(spec.forms)) {
      const F = spec.forms[f];
      if (F.palette) for (const k of Object.keys(F.palette)) if (slots.indexOf(k) < 0) err('form ' + f + ' palette slot ' + k + ' unknown');
      if (F.emissive) for (const k of Object.keys(F.emissive)) if (slots.indexOf(k) < 0) err('form ' + f + ' emissive slot ' + k + ' unknown');
      if (F.partsAdd) checkParts(F.partsAdd, 'form ' + f);
      maxTriangles = Math.max(maxTriangles, tri(f));
    }
  }
  return { errors, triangles, maxTriangles };
}
