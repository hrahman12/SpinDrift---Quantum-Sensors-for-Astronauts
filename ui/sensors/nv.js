// NV-diamond magnetometers of Omar et al., "Human cardiac measurements with diamond magnetometers"
// (arXiv 2601.18843): the JGU, ZAQuant and Q.ANT builds, to scale in millimetres, drawn only from documented
// dimensions (data/sensor_parts/nv.json). opts.build selects the build ('jgu' default).
// Frame: origin at the centre of the diamond's documented envelope, +z towards the subject, +y up.
import * as THREE from 'three';
import { NEUTRAL, num, fmt, paletteColour, toDims, createKit, emptyBuild, explodeRig } from './parts.js';

export const SENSOR = {
  id: 'nv',
  title: 'NV-diamond magnetometers (Omar et al., arXiv 2601.18843)',
  unit: 'mm',
  DATA: ['sensor_parts/nv', 'specs', 'palette'],
  builds: ['jgu', 'zaquant', 'qant'],
  sources: [
    'Omar et al., Human Cardiac Measurements with Diamond Magnetometers, arXiv 2601.18843v1 (2026), pp. 4, 14-15, Table 2, Fig. 1-3',
    'Omar et al., Diamond-optic enhanced photon collection efficiency, arXiv 2301.06583 = Optics Letters 48, 2512 (2023), p. 2 (JGU diamond top face)',
    'Omar et al., Zero- to low-field J-spectroscopy with a diamond magnetometer, arXiv 2512.05776v3, pp. 4, 9 (JGU head)',
    'data/palette.json: NV 695 nm colour',
  ],
};

export function build(D, opts = {}) {
  const P = D?.['sensor_parts/nv'];
  const key = SENSOR.builds.includes(opts.build) ? opts.build : 'jgu';
  const B = P?.builds?.[key];
  if (!B?.components) return emptyBuild('NV diamond', 'data/sensor_parts/nv.json not loaded');
  const kit = createKit();
  const root = new THREE.Group();
  root.name = `NV magnetometer (${key})`;
  const components = [];
  const labels = [];
  const moves = [];
  const undocumented = (B.undocumented || []).map(({ name, reason }) => ({ name, reason }));
  const colourNV = paletteColour(D, 'nv') || NEUTRAL.mid;

  const add = (id, cfg, object, color, xray) => {
    object.name = cfg.name;
    object.userData.componentId = id;
    root.add(object);
    components.push({ id, name: cfg.name, object, dims: toDims(cfg.dims), note: cfg.note, color, xray });
  };
  const skip = (id, cfg) => undocumented.push({ name: cfg?.name || id, reason: 'its numbers are missing from data/sensor_parts/nv.json' });

  const dia = B.components.diamond;
  if (dia?.shape === 'truncated_square_pyramid') {
    // JGU: square frustum, 0.5 mm base at the back (on the diamond anvil), 0.15 mm top facing the subject (+z)
    const base = num(dia.size?.base), top = num(dia.size?.top), h = num(dia.size?.height);
    const z0 = num(dia.centre?.z_base), z1 = num(dia.centre?.z_top);
    const x = num(dia.centre?.x), y = num(dia.centre?.y);
    if (dia.drawn && base && top && h && z0 !== null && z1 !== null && x !== null && y !== null) {
      // CylinderGeometry radii are circumradii of the square sections: side / sqrt(2); thetaStart pi/4 aligns the
      // square's edges with x and y; rotateX(pi/2) turns the +y axis (top) to +z
      const g = new THREE.CylinderGeometry(top / Math.SQRT2, base / Math.SQRT2, h, 4, 1, false, Math.PI / 4);
      g.rotateX(Math.PI / 2);
      const mesh = new THREE.Mesh(kit.geo(g), kit.std(colourNV, { flatShading: true, emissive: colourNV, emissiveIntensity: 0.3, roughness: 0.2 }));
      mesh.position.set(x, y, (z0 + z1) / 2);
      add('diamond', dia, mesh, colourNV, false);
      moves.push({ id: 'diamond', object: mesh, dir: [0, 0, 1], dist: 3 });
      labels.push({ component: 'diamond', position: [x, y, z1], text: `NV diamond: ${fmt(base)} mm square base, ${fmt(top)} mm top, ${fmt(h)} mm tall` });
    } else skip('diamond', dia);
  } else if (dia?.shape === 'envelope_box') {
    // ZAQuant / Q.ANT: only w × l × h is published (pyramid apex or top face not stated): translucent envelope
    const sx = num(dia.size?.x), sy = num(dia.size?.y), sz = num(dia.size?.z);
    const c = [num(dia.centre?.x), num(dia.centre?.y), num(dia.centre?.z)];
    if (dia.drawn && sx && sy && sz && c.every((v) => v !== null)) {
      const mesh = new THREE.Mesh(kit.geo(new THREE.BoxGeometry(sx, sy, sz)),
        kit.std(colourNV, { transparent: true, opacity: 0.45, emissive: colourNV, emissiveIntensity: 0.25, depthWrite: false }));
      mesh.position.set(...c);
      add('diamond', dia, mesh, colourNV, false);
      const what = key === 'zaquant' ? 'pyramidal diamond, apex not stated' : 'truncated-pyramid diamond, top face not stated';
      labels.push({ component: 'diamond', position: [c[0] + sx / 2, c[1] + sy / 2, c[2] + sz / 2], text: `${fmt(sx)} × ${fmt(sy)} × ${fmt(sz)} mm envelope (${what})` });
    } else skip('diamond', dia);
  } else if (dia) skip('diamond', dia);

  const face = B.components.head_face;
  if (face) {
    const d = num(face.size?.diameter);
    const c = [num(face.centre?.x), num(face.centre?.y), num(face.centre?.z)];
    if (face.drawn && d && c.every((v) => v !== null)) {
      // only the 12 mm diameter is published: the head is drawn as its front-face outline (flat disc)
      const mesh = new THREE.Mesh(kit.geo(new THREE.CircleGeometry(d / 2, 96)),
        kit.std(NEUTRAL.light, { side: THREE.DoubleSide, transparent: true, opacity: 0.55, depthWrite: false, metalness: 0.3 }));
      mesh.position.set(...c);
      add('head_face', face, mesh, NEUTRAL.light, true);
      const r = d / 2 / Math.SQRT2;
      labels.push({ component: 'head_face', position: [c[0] + r, c[1] + r, c[2]], text: `Head front face, Ø${fmt(d)} mm (head length not published)` });
    } else skip('head_face', face);
  }

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
