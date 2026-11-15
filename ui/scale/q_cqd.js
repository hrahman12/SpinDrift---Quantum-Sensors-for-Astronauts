// Quantum level, skin: a graphitic carbon-dot core for the bilirubin microneedle patch (Tabatabaee et al., ACS Nano 18,
// 28012, 2024). The patch paper's TEM lattice fringes are not public, so the lattice is graphite's (Trucano & Chen 1975,
// COD 9011577), labelled as such. Emission colour from palette.json (439 nm). Quenching and recovery are qualitative.
import * as THREE from 'three';
import { theme, cpk, paletteColour, tracker, addLights, makeArrow, polyline, spheres, sticks, glow, fx, voRow,
  missingScene, NO_CONSTANTS } from './q_lib.js';

export const DATA = ['quantum_constants', 'physics', 'palette', 'molecules/bilirubin_cid5280352'];
export const LEVEL = { id: 'q_cqd', site: 'skin', level: 'quantum', title: 'Carbon-dot graphitic core', unit: 'Å',
  scaleBar: { length: 3.3555, label: '3.356 Å (graphite layer spacing c/2)' } };

// Display choices, not physics (stated in the info panel).
export const DISPLAY = {
  fragmentRadius: 8,     // Å; the patch dots' size is not public, so the fragment's extent is a display choice
  maxLayers: 4,
  sizeFraction: 0.3,     // spheres at 0.3 × covalent radius
  photons: 54,           // points standing for emitted light (not to scale: 439 nm is far larger than the view)
  photonSpeed: 7,        // Å per second on screen
  bilirubinAt: [18, 0.5, 0],
};
const STATES = [
  { name: 'fluorescent carbon dots', glow: 1, bil: false, blue: false },
  { name: 'quenched (with bilirubin, qualitative)', glow: 0.1, bil: true, blue: false },
  { name: 'blue light: fluorescence recovers (bilirubin-selective, qualitative)', glow: 1, bil: true, blue: true },
];

// ---------------------------------------------------------------- geometry (pure; also used by the self-check)
// one graphite layer (P6_3/mmc, AB stacking): type A has C at (0,0) and (1/3,2/3), type B at (0,0) and (2/3,1/3)
export function graphiteLayer(a, type, radius) {
  const basis = type === 'A' ? [[0, 0], [1 / 3, 2 / 3]] : [[0, 0], [2 / 3, 1 / 3]];
  const n = Math.ceil(radius / a) + 2, out = [];
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (const [u, v] of basis) {
    const fu = i + u, fv = j + v;
    const x = a * (fu - fv / 2), y = a * fv * Math.sqrt(3) / 2;            // a1 = a(1, 0), a2 = a(−1/2, √3/2)
    if (Math.hypot(x, y) <= radius + 1e-9) out.push([x, y]);
  }
  return out;
}
export function neighbourPairs(pts, d, tol = 0.02) {
  const pairs = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    if (Math.abs(Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) - d) < tol) pairs.push([i, j]);
  }
  return pairs;
}
function mulberry32(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function build(D) {
  const Q = D.quantum_constants;
  if (!Q) return missingScene('Carbon-dot graphitic core', NO_CONSTANTS);
  const T = tracker(), th = theme(D), scene = new THREE.Scene();
  scene.background = null;
  addLights(scene, th);
  const instanced = [];
  const g = Q.graphite, a = g.a.value, c = g.c.value, dL = g.layer_spacing_d002.value, dCC = g.cc_in_plane.value, d100 = g.d100.value;
  LEVEL.scaleBar = { length: dL, label: `${fx(dL, 3)} Å (graphite layer spacing c/2)` };
  const rSp2 = Q.radii.carbon_sp2.value;
  const colC = cpk(D, 'C') || '#909090';
  const pal = paletteColour(D, 'cqd_patch', 439);
  const colEm = pal?.hex || th.ink;                                   // CIE colour of 439 nm
  const RF = DISPLAY.fragmentRadius;

  // ------------------------------------------------------------ graphitic layers along y (the c axis)
  let frac = DISPLAY.sizeFraction, nLayers = 3;
  const layers = [];
  for (let k = 0; k < DISPLAY.maxLayers; k++) {
    const type = k % 2 === 0 ? 'A' : 'B';
    const pts2 = graphiteLayer(a, type, RF);
    const yk = k * dL;                                                // layer 0 at y = 0, stacked along +y
    const pos = pts2.map(([x, y]) => new THREE.Vector3(x, yk, y));
    const atomsK = spheres(T, pos, frac * rSp2, colC);
    const pairs = neighbourPairs(pts2, dCC).map(([i, j]) => [pos[i], pos[j]]);
    const bondsK = sticks(T, pairs, 0.075, th.muted);
    scene.add(atomsK.mesh, bondsK);
    instanced.push(atomsK.mesh, bondsK);
    layers.push({ atoms: atomsK, bonds: bondsK, pos, y: yk, n: pos.length, nb: pairs.length });
  }
  const yTop = () => layers[nLayers - 1].y;

  // spacing guides: interlayer c/2 between layers 0 and 1, (100) planes on the top layer
  const dimX = RF + 1.4, dimG = new THREE.Group(); scene.add(dimG);
  const dim = makeArrow(T, th.accent, { shaft: 0.03, head: 0.13, headLen: 0.32, emissive: 0.4 });
  const dim2 = makeArrow(T, th.accent, { shaft: 0.03, head: 0.13, headLen: 0.32, emissive: 0.4 });
  dim.group.position.set(dimX, dL / 2, 0); dim.set(new THREE.Vector3(0, 1, 0), dL / 2);
  dim2.group.position.set(dimX, dL / 2, 0); dim2.set(new THREE.Vector3(0, -1, 0), dL / 2);
  dimG.add(dim.group, dim2.group);
  for (const y of [0, dL]) dimG.add(polyline(T, [new THREE.Vector3(RF - 0.6, y, 0), new THREE.Vector3(dimX + 0.4, y, 0)], th.accent, { dashed: true, dash: 0.3, gap: 0.2, opacity: 0.7 }));
  const a2 = new THREE.Vector3(-0.5, 0, Math.sqrt(3) / 2);                // in-plane a2 direction (scene x, z)
  const planes = new THREE.Group(); scene.add(planes);
  for (const off of [new THREE.Vector3(0, 0, 0), new THREE.Vector3(a, 0, 0)]) {
    const p0 = off.clone().addScaledVector(a2, -RF * 0.85).setY(0.03), p1 = off.clone().addScaledVector(a2, RF * 0.85).setY(0.03);
    planes.add(polyline(T, [p0, p1], th.accent, { dashed: true, dash: 0.25, gap: 0.15, opacity: 0.9 }));
  }

  // ------------------------------------------------------------ emission at the palette's 439 nm colour
  const halo = glow(T, colEm, RF * 0.85, { layers: 3, strength: 0.14 }); scene.add(halo.group);
  const rand = mulberry32(439);
  const phot = [];
  for (let i = 0; i < DISPLAY.photons; i++) {
    const u = 2 * rand() - 1, ph = 2 * Math.PI * rand(), s = Math.sqrt(1 - u * u);
    phot.push({ dir: new THREE.Vector3(s * Math.cos(ph), u, s * Math.sin(ph)), r: RF * (1 + 1.6 * rand()) });
  }
  const photMat = T.add(new THREE.MeshBasicMaterial({ color: colEm, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
  const photMesh = new THREE.InstancedMesh(T.add(new THREE.SphereGeometry(0.28, 10, 8)), photMat, DISPLAY.photons);
  photMesh.frustumCulled = false; scene.add(photMesh); instanced.push(photMesh);
  const RMAX = RF * 2.7, mtx = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1), qI = new THREE.Quaternion(), pp = new THREE.Vector3();

  // ------------------------------------------------------------ bilirubin (PubChem 3D conformer, true size; placement illustrative)
  const bil = D['molecules/bilirubin_cid5280352'];
  const bilGroup = new THREE.Group(); scene.add(bilGroup);
  let bilAtoms = null;
  if (bil?.atoms?.length) {
    const ctr = new THREE.Vector3();
    const bp = bil.atoms.map((r) => new THREE.Vector3(r[1], r[2], r[3]));
    bp.forEach((p) => ctr.add(p)); ctr.divideScalar(bp.length); bp.forEach((p) => p.sub(ctr));
    const rad = { C: Q.radii.carbon_sp3.value, N: Q.radii.nitrogen.value, O: Q.radii.oxygen?.value, H: Q.radii.hydrogen?.value };
    const els = bil.atoms.map((r) => r[0]);
    const rr = (f) => els.map((e) => f * (rad[e] ?? rad.C));
    bilAtoms = { mesh: spheres(T, bp, rr(frac), els.map((e) => cpk(D, e) || th.muted)), rr };
    const bb = sticks(T, bil.bonds.map(([i, j]) => [bp[i], bp[j]]), 0.07, th.muted);
    bilGroup.add(bilAtoms.mesh.mesh, bb); instanced.push(bilAtoms.mesh.mesh, bb);
    bilGroup.position.set(...DISPLAY.bilirubinAt);
  }

  // ------------------------------------------------------------ blue light (phototherapy) arrows, state 2
  const blue = new THREE.Group(); scene.add(blue);
  for (const [x, z] of [[-4, -2], [0, 2.5], [4, -1], [-1.5, -4.5], [2.5, 4]]) {
    const ar = makeArrow(T, th.ink, { shaft: 0.07, head: 0.24, headLen: 0.6, emissive: 0.5 });
    ar.group.position.set(x, 14, z); ar.set(new THREE.Vector3(0, -1, 0), 5); blue.add(ar.group);
  }

  // ------------------------------------------------------------ state, readouts, controls
  let state = 0, level = 1, cy = 0;
  const nAtoms = () => layers.slice(0, nLayers).reduce((s, l) => s + l.n, 0);
  const R = {
    state: { label: 'sensing state (qualitative)', value: '', unit: '', tag: 'qualitative', source: 'Tabatabaee et al. 2024, abstract' },
    atoms: { label: 'carbon atoms drawn (fragment radius 8 Å: display choice)', value: '', unit: '', tag: 'display', source: '' },
  };
  const readouts = [R.state,
    voRow('graphite a', g.a), voRow('graphite c', g.c), voRow('layer spacing c/2, (002)', g.layer_spacing_d002),
    voRow('in-plane C–C a/√3', g.cc_in_plane), voRow('(100) plane spacing a√3/2', g.d100),
    voRow('the patch dots\' TEM lattice fringes', g.patch_dot_lattice_fringe), voRow('the patch dots\' size', g.patch_dot_size),
    voRow('emission wavelength drawn', Q.cqd.emission_wavelength), voRow('its CIE colour', Q.cqd.emission_colour),
    voRow('quenching/recovery model', Q.cqd.quenching_model), voRow('what the glow is', Q.cqd.physics_label), R.atoms];

  function applyState() {
    const s = STATES[state];
    level = s.glow; halo.setLevel(level);
    bilGroup.visible = s.bil && !!bilAtoms; blue.visible = s.blue;
    R.state.value = s.name;
  }
  function applyLayers() {
    layers.forEach((l, k) => { const on = k < nLayers; l.atoms.mesh.visible = on; l.bonds.visible = on; });
    planes.position.y = yTop(); dimG.visible = nLayers >= 2;
    blue.position.y = yTop() - 2 * dL;
    cy = yTop() / 2; halo.group.position.y = cy; bilGroup.position.y = DISPLAY.bilirubinAt[1] + cy;
    R.atoms.value = String(nAtoms());
  }
  function applySize() {
    for (const l of layers) l.atoms.setRadii(frac * rSp2);
    if (bilAtoms) bilAtoms.mesh.setRadii(bilAtoms.rr(frac));
  }
  applyState(); applyLayers();

  const yDef = 2 * dL;                                                // top of the default three layers
  const labels = [
    { position: [dimX + 0.5, dL / 2, 0], text: `${fx(dL, 3)} Å = c/2: graphite (002) layer spacing` },
    { position: [a * 0.5 - RF * 0.85 * 0.5, yDef + 0.3, RF * 0.85 * Math.sqrt(3) / 2], text: `(100) planes ${fx(d100, 3)} Å apart` },
    { position: [-1, yDef + 1.1, 0], text: `hexagonal carbon layer, C–C ${fx(dCC, 3)} Å (graphite, not measured on the patch)` },
    { position: [-RF, -1.7, 0], text: 'graphitic core: graphite lattice (Trucano & Chen 1975)' },
    { position: [RF * 1.45, -RF * 0.95, 0], text: 'glow: CIE colour of 439 nm (palette.json)' },
    { position: [DISPLAY.bilirubinAt[0] - 4, DISPLAY.bilirubinAt[1] + dL + 6.3, 0], text: 'bilirubin (PubChem 3D conformer, true size; placement illustrative)' },
    { position: [5, 15.5, 0], text: 'blue light, as used for jaundice phototherapy (state 2)' },
  ];

  const info = {
    title: 'Carbon-dot core: graphite lattice and fluorescence (qualitative sensing)',
    lines: [
      `A graphitic core built from graphite's crystal structure (Trucano & Chen 1975, COD 9011577): hexagonal layers with a = ${a} Å, so in-plane C–C = a/√3 = ${fx(dCC, 3)} Å and (100) planes a√3/2 = ${fx(d100, 3)} Å apart (calculated), AB-stacked c/2 = ${fx(dL, 3)} Å apart (c = ${c} Å).`,
      'The patch paper\'s abstract gives no TEM lattice fringes and no dot size, and the full text is paywalled, so these are graphite\'s values, not measurements on the patch\'s dots; the fragment\'s 8 Å radius and the number of layers are display choices. Edge atoms are left bare: the dots\' surface groups are not public.',
      'Glow and points: the CIE colour of 439 nm (palette.json), the most common emission maximum in a public carbon-dot dataset (Mendeley cmfbrvrb8y, general carbon dots, not the patch). The points stand for emitted light; a 439 nm wave is far larger than this view.',
      'Sensing, qualitative only (Tabatabaee et al. 2024, abstract): the tattoo\'s fluorescence is quenched and then recovers selectively under the blue light used for jaundice phototherapy, and that recovery reports bilirubin. The quenching/recovery model and its constants are not public (physics.json cqd_quenching), so the state control switches between three pictures; no curve, rate or brightness level is implied.',
      'Bilirubin: PubChem CID 5280352 computed 3D conformer at true size; its place beside the dot is illustrative (no binding geometry is published). Carbon dots are fluorescent nanoparticles; their emission is not a spin-based quantum measurement. Spheres: × covalent radii (Cordero et al. 2008, to confirm); colours Jmol CPK.',
    ],
    sources: [g.a.source, g.structure.source, g.patch_dot_lattice_fringe.source, Q.cqd.mechanism.source,
      Q.cqd.emission_wavelength.source, Q.cqd.emission_colour.source, bil?.meta?.sources?.[0], Q.radii.carbon_sp2.source].filter(Boolean),
    lean: [],
  };

  const controls = [
    { id: 'state', label: 'state: 0 glowing · 1 quenched · 2 blue light, recovered', min: 0, max: 2, step: 1, value: state, unit: '',
      onInput(v) { state = Math.max(0, Math.min(2, Math.round(+v))); applyState(); } },
    { id: 'layers', label: 'graphite layers drawn', min: 1, max: DISPLAY.maxLayers, step: 1, value: nLayers, unit: '',
      onInput(v) { nLayers = Math.max(1, Math.min(DISPLAY.maxLayers, Math.round(+v))); applyLayers(); } },
    { id: 'size', label: 'atom size (× covalent radius)', min: 0.2, max: 1, step: 0.05, value: frac, unit: '×', onInput(v) { frac = +v; applySize(); } },
  ];

  return {
    scene,
    camera: { position: [4.5, 14, 36], target: [4.5, dL, 0], fov: 40 },
    labels, info, readouts, controls,
    update(dt) {
      const h = Math.min(Math.max(dt, 0), 0.1);
      const shown = Math.round(DISPLAY.photons * level);
      for (let i = 0; i < DISPLAY.photons; i++) {
        const p = phot[i];
        p.r += DISPLAY.photonSpeed * h;
        if (p.r > RMAX) p.r = RF;
        pp.copy(p.dir).multiplyScalar(p.r); pp.y += cy;
        mtx.compose(pp, qI, one); photMesh.setMatrixAt(i, mtx);
      }
      photMesh.count = shown; photMesh.instanceMatrix.needsUpdate = true;
      photMat.opacity = 0.35 + 0.6 * level;
    },
    dispose() { for (const m of instanced) m.dispose?.(); T.dispose(); },
  };
}
