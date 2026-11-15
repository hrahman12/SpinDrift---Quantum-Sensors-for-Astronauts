// Renin nanosensor probe of Long et al., Anal. Chem. 84, 8846 (2012), at the nanometre scale, drawn only from
// deposited or published structures (data/sensor_parts/qd.json): the streptavidin tetramer and its biotins from
// RCSB PDB 1STP (CC0; tetramer from the file's BIOMT operators) and Cy5 from PubChem CID 17758493 (computed 3D
// conformer). Atoms are van der Waals spheres (Bondi radii, H from Rowland & Taylor) in CPK colours.
// The quantum dot and the peptide substrate have no accessible documented size or sequence: listed, not drawn.
// Cy5 is placed beside the streptavidin at a display distance, not at a documented position.
import * as THREE from 'three';
import { CPK, num, fmt, toDims, createKit, emptyBuild, explodeRig, atomsGroup, centroid } from './parts.js';

export const SENSOR = {
  id: 'qd',
  title: 'Quantum-dot renin nanosensor probe (Long et al., Anal. Chem. 2012)',
  unit: 'nm',
  DATA: ['sensor_parts/qd', 'specs', 'palette'],
  sources: [
    'Long, Zhang, Zhang & Zhang, Single quantum dot based nanosensor for renin assay, Anal. Chem. 84, 8846 (2012), doi:10.1021/ac302284s (abstract)',
    'RCSB PDB 1STP, streptavidin-biotin complex, Weber et al., Science 243, 85 (1989), CC0 1.0',
    'PubChem CID 17758493 (Cy5), computed 3D conformer',
    'Mantina et al., J. Phys. Chem. A 113, 5806 (2009), Table 12 (Bondi van der Waals radii; H from Rowland & Taylor)',
  ],
};

const A = 0.1;   // the data file keeps coordinates in ångström as deposited; 1 Å = 0.1 nm

function applyOp(op, x, y, z) {
  return [0, 1, 2].map((r) => op[r][0] * x + op[r][1] * y + op[r][2] * z + op[r][3]);
}

export function build(D, opts = {}) {   // eslint-disable-line no-unused-vars
  const P = D?.['sensor_parts/qd'];
  const S = P?.structures;
  if (!S?.streptavidin?.atoms_au) return emptyBuild('QD renin probe', 'data/sensor_parts/qd.json not loaded');
  const kit = createKit();
  const root = new THREE.Group();
  root.name = 'Renin nanosensor probe';
  const components = [];
  const labels = [];
  const moves = [];
  const undocumented = (P.undocumented || []).map(({ name, reason }) => ({ name, reason }));
  const radii = {};
  for (const [el, v] of Object.entries(P.radii_A || {})) if (num(v)) radii[el] = num(v) * A;
  const sphere = kit.geo(new THREE.SphereGeometry(1, 18, 12));
  const C = P.components || {};

  const add = (id, cfg, object, color) => {
    object.name = cfg.name;
    object.userData.componentId = id;
    root.add(object);
    const skipped = [];
    object.traverse((o) => { if (o.userData?.skipped) skipped.push(o.userData.skipped); });
    const n = skipped.reduce((s, v) => s + v, 0);
    const note = n ? `${cfg.note} ${n} atoms without a radius in the data file are not drawn.` : cfg.note;
    components.push({ id, name: cfg.name, object, dims: toDims(cfg.dims), note, color, xray: false });
  };

  // streptavidin tetramer and biotins: BIOMT operator k applied to chain A gives subunit k
  const ops = S.streptavidin.biomt || [];
  const strep = new THREE.Group();
  const biot = new THREE.Group();
  let top = 0;
  ops.forEach((op, k) => {
    const atoms = S.streptavidin.atoms_au.map((a) => [a[0], ...applyOp(op, a[1], a[2], a[3]).map((v) => v * A)]);
    const sub = atomsGroup(kit, atoms, radii, sphere);
    sub.name = `Subunit ${k + 1}`;
    strep.add(sub);
    const dir = centroid(atoms);
    moves.push({ id: null, object: sub, dir: dir.some((v) => v) ? dir : [1, 0, 0], dist: 1.5 });
    for (const a of atoms) top = Math.max(top, a[2] + (radii[a[0]] || 0));
    const bAtoms = (S.biotin?.atoms_au || []).map((a) => [a[0], ...applyOp(op, a[1], a[2], a[3]).map((v) => v * A)]);
    if (bAtoms.length) {
      const b = atomsGroup(kit, bAtoms, radii, sphere);
      b.name = `Biotin ${k + 1}`;
      biot.add(b);
      moves.push({ id: k === 0 ? 'biotin' : null, object: b, dir: dir.some((v) => v) ? dir : [1, 0, 0], dist: 1.5 });
      if (k === 0) labels.push({ component: 'biotin', position: centroid(bAtoms), text: 'Biotin in its binding pocket (one per subunit)' });
    }
  });
  if (C.streptavidin?.drawn && ops.length) {
    add('streptavidin', C.streptavidin, strep, CPK.C);
    const ext = ['x', 'y', 'z'].map((ax) => num((C.streptavidin.dims || []).find((d) => d.label === `extent ${ax}`)?.vo));
    const size = ext.every((v) => v) ? `, ${ext.map(fmt).join(' × ')} nm` : '';
    labels.push({ component: 'streptavidin', position: [0, top, 0], text: `Streptavidin tetramer, PDB 1STP${size}` });
  }
  if (C.biotin?.drawn && biot.children.length) add('biotin', C.biotin, biot, CPK.S);

  // Cy5: PubChem conformer, centred, then moved along +x by the display distance from the data file
  const cy = S.cy5;
  const off = num(C.cy5?.display_offset_x);
  if (C.cy5?.drawn && cy?.atoms?.length && off !== null) {
    const c0 = centroid(cy.atoms);
    const atoms = cy.atoms.map((a) => [a[0], (a[1] - c0[0]) * A, (a[2] - c0[1]) * A, (a[3] - c0[2]) * A]);
    const g = atomsGroup(kit, atoms, radii, sphere);
    g.position.set(off, 0, 0);
    add('cy5', C.cy5, g, CPK.N);
    moves.push({ id: 'cy5', object: g, dir: [1, 0, 0], dist: 1.5 });
    labels.push({ component: 'cy5', position: [off, (cy.radius_nm || 1), 0], text: 'Cy5 (PubChem conformer), shown beside: real position not documented' });
  } else if (C.cy5) undocumented.push({ name: C.cy5.name, reason: 'its numbers are missing from data/sensor_parts/qd.json' });

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
