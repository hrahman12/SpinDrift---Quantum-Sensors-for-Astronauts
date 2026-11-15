// QuSpin QZFM Gen-3 sensor head, to scale in millimetres, drawn only from documented dimensions
// (data/sensor_parts/opm.json, built by scripts/build_sensor_parts.py). Parts without a published size or position
// (laser, photodetector, optics, coils, heater, head electronics) are listed in `undocumented`, not drawn.
// Frame: origin at the housing centre, +y up (skin face at y = -H/2), +z out of the front (label) face,
// +x to the right when looking at the front face.
import * as THREE from 'three';
import { NEUTRAL, num, fmt, paletteColour, toDims, createKit, emptyBuild, explodeRig } from './parts.js';

export const SENSOR = {
  id: 'opm',
  title: 'QuSpin QZFM Gen-3',
  unit: 'mm',
  DATA: ['sensor_parts/opm', 'specs', 'palette'],
  sources: [
    'QuSpin Gen-3.0 QZFM dimensioned drawing (updated 6 Dec 2022) and Gen-3.0 3D mock-up, https://quspin.com/qzfm-dimensions/',
    'QuSpin QZFM Gen-3 product page, https://quspin.com/products-qzfm/',
    'Zhao, Mammei & Fujimoto, QuSpin Zero-Field Magnetometer Characterization for the TUCAN Experiment, arXiv 2408.02941v3, p. 3 (3 × 3 × 3 mm cell)',
    'data/palette.json: rubidium D1 795 nm colour',
  ],
};

export function build(D, opts = {}) {   // eslint-disable-line no-unused-vars
  const P = D?.['sensor_parts/opm'];
  if (!P?.components) return emptyBuild('QZFM Gen-3', 'data/sensor_parts/opm.json not loaded');
  const kit = createKit();
  const root = new THREE.Group();
  root.name = 'QuSpin QZFM Gen-3';
  const components = [];
  const labels = [];
  const moves = [];
  const undocumented = (P.undocumented || []).map(({ name, reason }) => ({ name, reason }));
  const C = P.components;

  const add = (id, cfg, object, color, xray) => {
    object.name = cfg.name;
    object.userData.componentId = id;
    root.add(object);
    components.push({ id, name: cfg.name, object, dims: toDims(cfg.dims), note: cfg.note, color, xray });
  };
  const skip = (id, cfg) => undocumented.push({ name: cfg?.name || id, reason: 'its numbers are missing from data/sensor_parts/opm.json (source not fetched at build time)' });

  // housing: the Gen-3.0 envelope (edge radii not dimensioned, so square edges)
  const h = C.housing;
  const W = num(h?.size?.x), H = num(h?.size?.y), Z = num(h?.size?.z);
  if (!(h?.drawn && W && H && Z)) {
    skip('housing', h);
    return { root, components, undocumented, explode() {}, labels, dispose() { kit.dispose(); root.clear(); } };
  }
  const housing = new THREE.Mesh(kit.geo(new THREE.BoxGeometry(W, H, Z)), kit.std(NEUTRAL.light, { roughness: 0.6 }));
  add('housing', h, housing, NEUTRAL.light, true);
  const hToConfirm = h.size.y.status !== 'VERIFIED' ? ' (height to confirm)' : '';
  labels.push({ component: 'housing', position: [W / 2, H / 2, Z / 2], text: `Gen-3.0 head ${fmt(W)} × ${fmt(H)} × ${fmt(Z)} mm${hToConfirm}` });
  labels.push({ component: 'housing', position: [0, -H / 2, 0], text: 'Skin face: QuSpin axis Z+ points out of it' });

  // vapour cell: centre from QuSpin's Gen-3.0 drawing, 3 mm edge from Zhao et al. (to confirm)
  const cell = C.cell;
  const ce = [num(cell?.size?.x), num(cell?.size?.y), num(cell?.size?.z)];
  const cc = [num(cell?.centre?.x), num(cell?.centre?.y), num(cell?.centre?.z)];
  if (cell?.drawn && ce.every((v) => v) && cc.every((v) => v !== null)) {
    const colour = paletteColour(D, cell.optical) || NEUTRAL.mid;
    const mesh = new THREE.Mesh(kit.geo(new THREE.BoxGeometry(...ce)),
      kit.std(colour, { emissive: colour, emissiveIntensity: 0.35, roughness: 0.25, transparent: true, opacity: 0.85 }));
    mesh.position.set(...cc);
    add('cell', cell, mesh, colour, false);
    moves.push({ id: 'cell', object: mesh, dir: [0, 0, 1], dist: Z + 6 });
    const sizeNote = cell.size.x.status !== 'VERIFIED' ? `${fmt(ce[0])} mm cube (size to confirm)` : `${fmt(ce[0])} mm cube`;
    labels.push({ component: 'cell', position: cc.slice(), text: `Vapour cell centre (QuSpin drawing); ${sizeNote}` });
  } else skip('cell', cell);

  // raised label plate on the front face (QuSpin 3D mock-up)
  const pl = C.label_plate;
  const ps = [num(pl?.size?.x), num(pl?.size?.y), num(pl?.size?.z)];
  const pc = [num(pl?.centre?.x), num(pl?.centre?.y), num(pl?.centre?.z)];
  if (pl?.drawn && ps.every((v) => v) && pc.every((v) => v !== null)) {
    const mesh = new THREE.Mesh(kit.geo(new THREE.BoxGeometry(...ps)), kit.std(NEUTRAL.mid));
    mesh.position.set(...pc);
    add('label_plate', pl, mesh, NEUTRAL.mid, false);
    moves.push({ id: 'label_plate', object: mesh, dir: [0, 0, 1], dist: 3 });
    labels.push({ component: 'label_plate', position: [pc[0], pc[1], pc[2] + ps[2] / 2], text: 'Front face label plate (QuSpin 3D mock-up)' });
  } else skip('label_plate', pl);

  // flex ribbon cable, drawn cut at the length shown in QuSpin's own mock-up
  const cb = C.cable;
  const rw = num(cb?.size?.x), rt = num(cb?.size?.z), rl = num(cb?.size?.drawn_length), full = num(cb?.size?.length);
  const rx = num(cb?.centre?.x), rz = num(cb?.centre?.z), ry0 = num(cb?.centre?.y_start);
  if (cb?.drawn && rw && rt && rl && rx !== null && rz !== null && ry0 !== null) {
    const mesh = new THREE.Mesh(kit.geo(new THREE.BoxGeometry(rw, rl, rt)), kit.std(NEUTRAL.dark, { roughness: 0.7 }));
    mesh.position.set(rx, ry0 + rl / 2, rz);
    add('cable', cb, mesh, NEUTRAL.dark, false);
    moves.push({ id: 'cable', object: mesh, dir: [0, 1, 0], dist: 12 });
    labels.push({ component: 'cable', position: [rx, ry0 + rl, rz], text: `Flex ribbon ${fmt(rw)} × ${fmt(rt)} mm, ${fmt(full)} mm long (shown cut at ${fmt(rl)} mm)` });
  } else skip('cable', cb);

  const explode = explodeRig(moves, labels);
  return {
    root,
    components,
    undocumented,
    explode,
    labels,
    dispose() { kit.dispose(); root.clear(); },
  };
}
