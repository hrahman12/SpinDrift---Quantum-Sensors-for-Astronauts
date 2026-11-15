// Quantum level, skin: a graphitic carbon-dot core for the bilirubin microneedle patch (Tabatabaee et al., ACS Nano 18,
// 28012, 2024). The patch paper's TEM lattice fringes are not public, so the lattice is graphite's (Trucano & Chen 1975,
// COD 9011577), labelled as such. Emission colour from palette.json (439 nm). Quenching and recovery are qualitative.
import * as THREE from 'three';
import { theme, cpk, paletteColour, tracker, addLights, makeArrow, polyline, spheres, sticks, glow, fx, voRow,
  missingScene, NO_CONSTANTS, unit3, hasView, viewLine, radiationRow, dots, halton, num, plainNum } from './q_lib.js';

export const DATA = ['quantum_constants', 'physics', 'palette', 'molecules/bilirubin_cid5280352', 'sensor_parts/cqd', 'recorded/cqd_pl_mendeley_cmfbrvrb8y'];
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

// The descent (opts.view given) has no sliders: setEnv sets everything it shows. Without opts: the earlier explorer.
export function build(D, opts = {}) {
  return opts.view === undefined ? buildLegacy(D, opts) : buildDescent(D, opts);
}

function buildLegacy(D, opts = {}) {
  const Q = D.quantum_constants;
  if (!Q) return missingScene('Carbon-dot graphitic core', NO_CONSTANTS, ['dot', 'lattice', 'ring']);
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
    // one carbon hexagon of this layer, for the 500 pm view: the ring around the hollow site nearest the fragment's
    // centre, (2/3, 1/3) for an A layer and (1/3, 2/3) for a B layer in lattice coordinates
    const hc = type === 'A' ? new THREE.Vector3(a / 2, yk, a / (2 * Math.sqrt(3))) : new THREE.Vector3(0, yk, a / Math.sqrt(3));
    const six = pos.filter((p) => Math.abs(p.distanceTo(hc) - dCC) < 0.02)
      .sort((p, q) => Math.atan2(p.z - hc.z, p.x - hc.x) - Math.atan2(q.z - hc.z, q.x - hc.x));
    let hex = null;
    if (six.length === 6) { hex = polyline(T, [...six, six[0]].map((p) => p.clone().setY(yk + 0.02)), th.accent, { opacity: 0.9 }); hex.visible = false; scene.add(hex); }
    layers.push({ atoms: atomsK, bonds: bondsK, pos, y: yk, n: pos.length, nb: pairs.length, hc, hex });
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
  let state = 0, level = 1, cy = 0, view = null;
  const nAtoms = () => layers.slice(0, nLayers).reduce((s, l) => s + l.n, 0);
  // what the patch paper's open Supporting Information records about its dots (data/sensor_parts/cqd.json)
  const dls = D['sensor_parts/cqd']?.documented?.cqd_size;
  const haveDls = !!dls && dls.value !== null && dls.value !== undefined;
  const dlsRange = haveDls ? String(dls.value).match(/(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\s*nm/) : null;
  const inRange = dlsRange ? (2 * RF) / 10 >= +dlsRange[1] && (2 * RF) / 10 <= +dlsRange[2] : false;
  const R = {
    state: { label: 'sensing state (qualitative)', value: '', unit: '', tag: 'qualitative', source: 'Tabatabaee et al. 2024, abstract' },
    atoms: { label: 'carbon atoms drawn (fragment radius 8 Å: display choice)', value: '', unit: '', tag: 'display', source: '' },
  };
  const readouts = [R.state,
    voRow('graphite a', g.a), voRow('graphite c', g.c), voRow('layer spacing c/2, (002)', g.layer_spacing_d002),
    voRow('in-plane C–C a/√3', g.cc_in_plane), voRow('(100) plane spacing a√3/2', g.d100),
    ...(haveDls ? [voRow('the patch dots, as recorded in the open Supporting Information (Fig. S1)', dls)]
      : [voRow('the patch dots\' TEM lattice fringes', g.patch_dot_lattice_fringe), voRow('the patch dots\' size', g.patch_dot_size)]),
    voRow('emission wavelength drawn', Q.cqd.emission_wavelength), voRow('its CIE colour', Q.cqd.emission_colour),
    voRow('quenching/recovery model', Q.cqd.quenching_model), voRow('what the glow is', Q.cqd.physics_label), R.atoms];

  function applyState() {
    const s = STATES[state];
    level = s.glow; halo.setLevel(level);
    bilGroup.visible = (s.bil || view === 'dot') && !!bilAtoms; blue.visible = s.blue;   // the 10 nm view always shows the molecule, for scale
    R.state.value = s.name;
  }
  const views = {};                                                  // filled below; the targets follow the layers drawn
  function applyLayers() {
    layers.forEach((l, k) => { const on = k < nLayers; l.atoms.mesh.visible = on; l.bonds.visible = on; if (l.hex) l.hex.visible = view === 'ring' && k === nLayers - 1; });
    planes.position.y = yTop(); dimG.visible = nLayers >= 2;
    blue.position.y = yTop() - 2 * dL;
    cy = yTop() / 2; halo.group.position.y = cy; bilGroup.position.y = DISPLAY.bilirubinAt[1] + cy;
    R.atoms.value = String(nAtoms());
    if (views.dot) {
      views.dot.target[1] = cy + 0.25; views.lattice.target[1] = cy;
      layers[nLayers - 1].hc.toArray(views.ring.target);
    }
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
  if (opts.view !== undefined) {
    const top = layers[nLayers - 1];
    labels.push({ position: [top.hc.x, top.hc.y + 0.05, top.hc.z], text: `one carbon hexagon: six atoms, C–C ${fx(dCC, 3)} Å, ${fx(a, 3)} Å across the flats` });
  }

  const info = {
    title: 'Carbon-dot core: graphite lattice and fluorescence (qualitative sensing)',
    lines: [
      `A graphitic core built from graphite's crystal structure (Trucano & Chen 1975, COD 9011577): hexagonal layers with a = ${a} Å, so in-plane C–C = a/√3 = ${fx(dCC, 3)} Å and (100) planes a√3/2 = ${fx(d100, 3)} Å apart (calculated), AB-stacked c/2 = ${fx(dL, 3)} Å apart (c = ${c} Å).`,
      haveDls
        ? `The patch paper's open Supporting Information (Fig. S1) records its dots only as: ${dls.value}. It states no mean size and no indexed lattice spacing (the main text is not open), so the lattice drawn is graphite's, not a measurement on the patch's dots. The fragment's ${2 * RF} Å (${fx((2 * RF) / 10, 1)} nm) width${inRange ? ' lies inside that size range; it' : ''} and the number of layers are display choices. Edge atoms are left bare: the dots' surface groups are not public.`
        : 'The patch paper\'s abstract gives no TEM lattice fringes and no dot size, and the full text is paywalled, so these are graphite\'s values, not measurements on the patch\'s dots; the fragment\'s 8 Å radius and the number of layers are display choices. Edge atoms are left bare: the dots\' surface groups are not public.',
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

  // ------------------------------------------------------------ views (targets follow the number of layers drawn)
  const camDir = unit3([0, 14 - dL, 36]);
  Object.assign(views, {
    dot: { target: [DISPLAY.bilirubinAt[0] / 2, 0, 0], dir: camDir,
      note: `The whole graphitic fragment (${2 * RF} Å across, a display size${inRange ? ` inside the patch dots' ${dlsRange[1]}–${dlsRange[2]} nm DLS range` : ''}) with one bilirubin molecule beside it at true size (PubChem conformer; its place is illustrative, no binding geometry is published). In this view the molecule is drawn in every state, for scale; the state control still sets the glow.` },
    lattice: { target: [0, 0, 0], dir: camDir,
      note: `The stacked carbon layers: ${fx(dL, 3)} Å apart (c/2), with in-plane C–C ${fx(dCC, 3)} Å and (100) planes ${fx(d100, 3)} Å apart. These are graphite's values (Trucano & Chen 1975), not measured on the patch's dots.` },
    ring: { target: [0, 0, 0], dir: unit3([0.2, 0.85, 0.5]),
      note: `One carbon hexagon of the top layer drawn, outlined in green: six atoms ${fx(dCC, 3)} Å apart (a/√3), ${fx(a, 3)} Å across the flats (the lattice constant a) and ${fx(2 * dCC, 3)} Å across the corners (calculated). Spheres are a fraction of the covalent radius (size control).` },
  });
  const showLine = viewLine(info, views);
  function setView(name) {
    view = hasView(views, name) ? name : null;
    applyState(); applyLayers();
    showLine(view);
  }
  applyLayers();                                                     // puts the targets on the layers drawn now
  const setEnv = radiationRow(readouts);                             // this scene does not read magnetic fields
  if (opts.env) setEnv(opts.env);
  if (opts.view !== undefined) setView(opts.view);

  return {
    scene,
    camera: { position: [4.5, 14, 36], target: [4.5, dL, 0], fov: 40 },
    labels, info, readouts, controls, views, setView, setEnv,
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

// ================================================================ the descent: dot (10.0 nm), lattice (2.50 nm), ring (500 pm)
// setEnv decides the glow: bright when no bilirubin value is entered; quenched when one is (the patch's working range
// is not public, so the value itself is not used), with the blue-light recovery the paper reads it by. The energy
// steps come from measured light: excitation and emission maxima of the same Mendeley carbon-dot records.
const CQV = { cycleS: 1.4, quenchS: 6, blueS: 3.5, eScale: 3.0, eScaleRing: 0.32, fragmentRadius: 22 };   // Å: 4.4 nm across, inside the 1-12 nm DLS range
function buildDescent(D, opts) {
  const Q = D.quantum_constants;
  if (!Q) return missingScene('Carbon-dot graphitic core', NO_CONSTANTS, ['dot', 'lattice', 'ring']);
  const T = tracker(), th = theme(D), scene = new THREE.Scene();
  scene.background = null;
  addLights(scene, th);
  const g = Q.graphite, a = g.a.value, dL = g.layer_spacing_d002.value, dCC = g.cc_in_plane.value, d100 = g.d100.value;
  LEVEL.scaleBar = { length: dL, label: `${fx(dL, 3)} Å (graphite layer spacing c/2)` };
  const rSp2 = Q.radii.carbon_sp2.value, colC = cpk(D, 'C') || '#909090';
  const em = paletteColour(D, 'cqd_patch', 439), colEm = em?.hex || th.ink, cEm = new THREE.Color(colEm);
  const RF = CQV.fragmentRadius, NL = 3, frac = DISPLAY.sizeFraction, BX = RF + 10;
  const hc = num(Q.si?.hc_eV_nm);
  // the measured light: emission 439 nm and the excitation of the same records (Mendeley, general carbon dots)
  const rec = D['recorded/cqd_pl_mendeley_cmfbrvrb8y'];
  const exc = rec?.x?.values || [], emis = rec?.series?.[0]?.values || [];
  const pairs439 = exc.filter((_, i) => emis[i] === 439);
  const exMode = pairs439.length ? [...pairs439].sort((p, q) => pairs439.filter((x) => x === q).length - pairs439.filter((x) => x === p).length)[0] : null;
  const lamOut = num(Q.cqd.emission_wavelength) || 439, lamIn = exMode;
  const eOut = hc ? hc / lamOut : null, eIn = hc && lamIn ? hc / lamIn : null;
  const dls = D['sensor_parts/cqd']?.documented?.cqd_size;
  const siEx = String(dls?.source || '').match(/excitation at (\d+) nm/);

  // ------------------------------------------------------------ graphitic layers (atoms at rest: see the info panel)
  const atomMats = [];
  const layers = [];
  for (let k = 0; k < NL; k++) {
    const pts2 = graphiteLayer(a, k % 2 === 0 ? 'A' : 'B', RF), yk = k * dL;
    const pos = pts2.map(([x, y]) => new THREE.Vector3(x, yk, y));
    const at = spheres(T, pos, frac * rSp2, colC, { segments: 10 }); at.mesh.material.emissive = new THREE.Color(colEm); atomMats.push(at.mesh.material);
    const bd = sticks(T, neighbourPairs(pts2, dCC).map(([i, j]) => [pos[i], pos[j]]), 0.075, th.muted);
    scene.add(at.mesh, bd); layers.push({ at, bd, pos, y: yk, hc: k % 2 === 0 ? new THREE.Vector3(a / 2, yk, a / (2 * Math.sqrt(3))) : new THREE.Vector3(0, yk, a / Math.sqrt(3)) });
  }
  const top = layers[NL - 1], yMid = top.y / 2;
  const six = top.pos.filter((p) => Math.abs(p.distanceTo(top.hc) - dCC) < 0.02).sort((p, q) => Math.atan2(p.z - top.hc.z, p.x - top.hc.x) - Math.atan2(q.z - top.hc.z, q.x - top.hc.x));
  const hex = six.length === 6 ? polyline(T, [...six, six[0]].map((p) => p.clone().setY(top.y + 0.02)), th.accent, { opacity: 0.9 }) : null;
  if (hex) scene.add(hex);
  // spacing guides
  const dim = makeArrow(T, th.accent, { shaft: 0.03, head: 0.13, headLen: 0.32, emissive: 0.4 }), dim2 = makeArrow(T, th.accent, { shaft: 0.03, head: 0.13, headLen: 0.32, emissive: 0.4 });
  dim.group.position.set(RF + 1.4, dL / 2, 0); dim.set(new THREE.Vector3(0, 1, 0), dL / 2); dim2.group.position.set(RF + 1.4, dL / 2, 0); dim2.set(new THREE.Vector3(0, -1, 0), dL / 2);
  scene.add(dim.group, dim2.group);

  // ------------------------------------------------------------ bilirubin at true size beside the dot (placement illustrative)
  const bil = D['molecules/bilirubin_cid5280352'], bilGroup = new THREE.Group(); scene.add(bilGroup);
  if (bil?.atoms?.length) {
    const ctr = new THREE.Vector3(), bp = bil.atoms.map((r) => new THREE.Vector3(r[1], r[2], r[3]));
    bp.forEach((p) => ctr.add(p)); ctr.divideScalar(bp.length); bp.forEach((p) => p.sub(ctr));
    const rad = { C: Q.radii.carbon_sp3.value, N: Q.radii.nitrogen.value, O: Q.radii.oxygen?.value, H: Q.radii.hydrogen?.value };
    const els = bil.atoms.map((r) => r[0]);
    bilGroup.add(spheres(T, bp, els.map((e) => frac * (rad[e] ?? rad.C)), els.map((e) => cpk(D, e) || th.muted)).mesh, sticks(T, bil.bonds.map(([i, j]) => [bp[i], bp[j]]), 0.07, th.muted));
    bilGroup.position.set(BX, DISPLAY.bilirubinAt[1] + yMid, 0);
  }

  // ------------------------------------------------------------ light: photons out (439 nm colour), UV in, blue light
  const NPH = 60, photons = dots(T, NPH, 6), phAge = new Float32Array(NPH).fill(9), phDir = [];
  for (let k = 0; k < NPH; k++) { const u = 2 * halton(k + 1, 2) - 1, s = Math.sqrt(1 - u * u), p = 2 * Math.PI * halton(k + 1, 3); phDir.push(new THREE.Vector3(s * Math.cos(p), u, s * Math.sin(p))); }
  scene.add(photons.points);
  const blue = new THREE.Group(); scene.add(blue);
  for (const [x, z] of [[-4, -2], [0, 2.5], [4, -1], [-1.5, -4.5], [2.5, 4]]) { const ar = makeArrow(T, th.ink, { shaft: 0.07, head: 0.24, headLen: 0.6, emissive: 0.5 }); ar.group.position.set(x, 14, z); ar.set(new THREE.Vector3(0, -1, 0), 5); blue.add(ar.group); }

  // ------------------------------------------------------------ energy steps: dot view (left) and ring view (small, beside the ring)
  function stepDiagram(x0, y0, s, wLvl) {
    const grp = new THREE.Group(); scene.add(grp);
    const ys = { g: y0, out: y0 + (eOut || 2.82) * s, in: y0 + (eIn || 3.37) * s };
    for (const [y, c] of [[ys.g, th.ink], [ys.out, colEm], [ys.in, th.muted]]) grp.add(polyline(T, [new THREE.Vector3(x0, y, 0), new THREE.Vector3(x0 + wLvl, y, 0)], c));
    const e = dots(T, 1, 9); e.col.set(new THREE.Color(th.ink).toArray()); grp.add(e.points);
    const ph = dots(T, 1, 8); grp.add(ph.points);
    return { grp, ys, e, ph, x0, w: wLvl, s };
  }
  const big = stepDiagram(-40, -6, CQV.eScale, 6), small = stepDiagram(2.0, top.y - 0.1, CQV.eScaleRing, 0.7);

  // ------------------------------------------------------------ labels (static; tagged texts kept)
  const labels = [
    { position: [-RF, -1.7, 0], text: 'graphitic core: graphite lattice (Trucano & Chen 1975)' },
    { position: [BX - 4, DISPLAY.bilirubinAt[1] + yMid + 6.3, 0], text: 'bilirubin (PubChem 3D conformer, true size; placement illustrative)' },
    { position: [RF + 1.9, dL / 2, 0], text: `${fx(dL, 3)} Å = c/2: graphite (002) layer spacing` },
    { position: [top.hc.x, top.hc.y + 0.05, top.hc.z], text: 'one carbon hexagon' },
    { position: [5, 15.5, 0], text: 'blue light (phototherapy)' },
    { position: [big.x0, big.ys.in + 1.0, 0], text: `light in ${lamIn ?? '?'} nm: up a step` },
    { position: [big.x0 + big.w + 0.5, big.ys.out, 0], text: `glow out ${lamOut} nm` },
    { position: [big.x0 + big.w + 0.5, big.ys.g, 0], text: 'ground' },
  ];

  // ------------------------------------------------------------ state from setEnv
  let mode = 'bright', phase = 0, cyc = 0, glowNow = 1, view = null, bili = null;
  const R = {
    bili: { label: 'bilirubin entered (skin fluid)', plain: 'Bilirubin entered', value: '—', unit: '', tag: 'user input', source: 'env.inputs.bilirubin_isf' },
    range: { label: 'the patch’s working range', plain: 'Patch’s range', value: 'not public', unit: '', tag: 'not yet extracted', source: 'Tabatabaee et al. 2024: the range and its unit are in the paywalled main text' },
    verdict: { label: 'Lean verdict here for the skin sensor', plain: 'Lean says', value: '—', unit: '', tag: 'Lean checker', source: 'verdict cqd_skin' },
    glow: { label: 'the dot’s glow now', plain: 'Glow now', value: '—', unit: '', tag: 'qualitative', source: `${Q.cqd.mechanism?.source || ''}: “${Q.cqd.mechanism?.value || ''}”` },
    inL: { label: 'light in (excitation of the 439 nm records)', plain: 'Light in', value: lamIn ?? 'not found', unit: lamIn ? 'nm' : '', tag: 'recorded', source: `${rec?.meta?.dataset || ''}; the patch’s own spectra were excited at ${siEx ? siEx[1] : '?'} nm (Supporting Information Fig. S1)` },
    inE: { label: 'its photon energy hc/λ', plain: 'Step up', value: eIn ? fx(eIn, 3) : '—', unit: 'eV', tag: 'calculated', source: 'si.hc_eV_nm / wavelength' },
    outL: { ...voRow('glow out (most common emission maximum)', Q.cqd.emission_wavelength), plain: 'Glow colour (wavelength)' },
    outE: { label: 'its photon energy hc/λ', plain: 'Step down (light)', value: eOut ? fx(eOut, 3) : '—', unit: 'eV', tag: 'calculated', source: 'si.hc_eV_nm / wavelength' },
    heat: { label: 'energy lost as heat before the glow', plain: 'Lost as heat', value: eIn && eOut ? fx(eIn - eOut, 3) : '—', unit: 'eV', tag: 'calculated', source: 'difference of the two photon energies' },
    size: { ...voRow('the patch dots, open Supporting Information (Fig. S1)', dls), plain: 'Dot size' },
    still: { label: 'thermal jiggle of the carbon atoms', plain: 'Atom jiggle', value: 'not animated', unit: '', tag: 'not stated', source: Q.motion?.graphite_temperature?.note || 'graphite’s displacement parameters have no stated temperature' },
    timing: { label: 'electron steps: timing', plain: 'Timing', value: 'illustrative', unit: '', tag: 'not stated', source: 'the dots’ lifetime is not in /data' },
  };
  const readouts = [R.bili, R.range, R.verdict, R.glow, R.inL, R.inE, R.outL, R.outE, R.heat, R.size, R.still, R.timing,
    { ...voRow('graphite a', g.a), plain: 'Lattice step' }, { ...voRow('in-plane C–C a/√3', g.cc_in_plane), plain: 'Carbon to carbon' },
    { ...voRow('layer spacing c/2, (002)', g.layer_spacing_d002), plain: 'Sheet to sheet' }];
  const VERD = { REQUIREMENTS_MET: 'met', NOT_MET: 'not met', NEED_MORE_INFORMATION: 'needs more information' };
  const rad = radiationRow(readouts);
  function setEnv(env) {
    if (!env || typeof env !== 'object') return;
    const b = env.inputs?.bilirubin_isf;
    bili = typeof b === 'number' && Number.isFinite(b) ? b : null;
    const next = bili === null ? 'bright' : 'quenched';
    if (next !== mode) { mode = next; phase = 0; }
    R.bili.value = bili === null ? 'none entered' : plainNum(bili, 4);
    R.verdict.value = VERD[env.verdicts?.cqd_skin] || 'no verdict received';
    rad(env);
    applyMode();
  }
  function applyMode() {
    const recover = mode === 'quenched' && phase >= CQV.quenchS;
    blue.visible = recover && view !== 'ring';
    R.glow.value = mode === 'bright' ? 'bright: no bilirubin' : recover ? 'recovering under blue light' : 'quenched by bilirubin';
  }
  const camDir = unit3([0, 14 - dL, 36]);
  const views = {
    dot: { target: [2, yMid + 0.5, 0], dir: unit3([0, 0.7, 0.71]),
      note: `The whole graphitic fragment (${2 * RF} Å across, a display size inside the patch dots’ 1–12 nm DLS range) with one bilirubin molecule beside it at true size, and the dot’s energy steps on the left: light of ${lamIn ?? '?'} nm lifts an electron ${eIn ? fx(eIn, 2) : '?'} eV, it loses ${eIn && eOut ? fx(eIn - eOut, 2) : '?'} eV as heat and drops ${eOut ? fx(eOut, 2) : '?'} eV giving violet-blue light (${lamOut} nm). With bilirubin entered the drop gives no light (quenched) until the blue light brings the glow back.` },
    lattice: { target: [0, yMid, 0], dir: camDir,
      note: `The stacked carbon layers, ${fx(dL, 3)} Å apart, with in-plane C–C ${fx(dCC, 3)} Å and (100) planes ${fx(d100, 3)} Å apart (graphite’s values, not measured on the patch’s dots). The atoms light up in the glow colour each time the dot gives out light.` },
    ring: { target: [top.hc.x + 0.6, top.y + 0.3, top.hc.z], dir: unit3([0.2, 0.85, 0.5]),
      note: `One carbon hexagon (C–C ${fx(dCC, 3)} Å, ${fx(a, 3)} Å across the flats) and, beside it, the electron stepping up and dropping back with the glow’s photon (energy steps drawn small).` },
  };
  const info = {
    title: 'Carbon dot: an electron steps up, drops back and glows, unless bilirubin is near',
    lines: [
      `A carbon dot absorbs light and an electron steps up; it slips down a little, losing energy as heat, then drops back giving violet-blue light. The steps here come from measured light: excitation ${lamIn ?? '?'} nm and emission ${lamOut} nm, the pair of the most common emission maximum in a public carbon-dot dataset (Mendeley cmfbrvrb8y, general carbon dots, not the patch), so the step up is hc/λ = ${eIn ? fx(eIn, 3) : '?'} eV and the step down ${eOut ? fx(eOut, 3) : '?'} eV (calculated). The patch’s own spectra were excited at ${siEx ? siEx[1] : '?'} nm (Supporting Information Fig. S1).`,
      'Sensing (Tabatabaee et al. 2024): the tattoo’s glow is quenched by bilirubin and recovers selectively under the blue light used for jaundice phototherapy; that recovery reports bilirubin. Here the dot glows when no bilirubin value is entered and is quenched when one is (the drop gives no light: the energy goes to bilirubin), with the blue-light recovery shown in turn. The patch’s working range and unit are not public, so the value itself is not used; the quenching model and its rates are not public either, so only these states are shown and the timing is illustrative.',
      `The graphite lattice (Trucano & Chen 1975, COD 9011577) stands in for the dots’ structure. Its displacement parameters are measured (U₃₃ ≈ 0.016 Å² across the layers) but the CIF states no temperature, so no vibration rate can be calculated: the atoms are drawn at rest. The fragment’s extent and the three layers are display choices; edge atoms are left bare (surface groups not public). Bilirubin: PubChem CID 5280352 conformer at true size, placed for comparison only.`,
    ],
    sources: [g.a.source, Q.cqd.mechanism.source, rec?.meta?.sources?.[0], Q.cqd.emission_wavelength.source, dls?.source, Q.motion?.graphite_u_aniso?.source, bil?.meta?.sources?.[0]].filter(Boolean),
    lean: [],
  };
  const showLine = viewLine(info, views);
  function setView(name) {
    view = hasView(views, name) ? name : null;
    big.grp.visible = view !== 'ring'; small.grp.visible = view === 'ring';
    bilGroup.visible = view !== 'ring';
    applyMode(); showLine(view);
  }
  setEnv(opts.env || {});
  setView(opts.view);

  function stepPos(dg, f, quenched) {
    // 0-0.2 rest at ground; 0.2-0.3 up; 0.3-0.45 slip to the emitting level; 0.45-0.55 drop; 0.55-1 rest
    const x = dg.x0 + dg.w * 0.5;
    if (f < 0.2) return [x, dg.ys.g, false];
    if (f < 0.3) return [x, dg.ys.g + (dg.ys.in - dg.ys.g) * ((f - 0.2) / 0.1), false];
    if (f < 0.45) return [x + 0.15 * dg.w * Math.sin(40 * f), dg.ys.in + (dg.ys.out - dg.ys.in) * ((f - 0.3) / 0.15), false];
    if (f < 0.55) return [x, dg.ys.out + (dg.ys.g - dg.ys.out) * ((f - 0.45) / 0.1), !quenched];
    return [x, dg.ys.g, false];
  }
  return {
    scene,
    camera: { position: [2, yMid + 0.5 + 0.7 * 137, 0.71 * 137], target: [2, yMid + 0.5, 0], fov: 40 },
    labels, info, readouts, controls: [], views, setView, setEnv,
    update(dt) {
      const h = Math.min(Math.max(dt, 0), 0.1);
      if (mode === 'quenched') { phase += h; if (phase > CQV.quenchS + CQV.blueS) phase = 0; }
      applyMode();
      const lit = mode === 'bright' || phase >= CQV.quenchS;
      cyc = (cyc + h / CQV.cycleS) % 1;
      let emitting = false;
      for (const dg of [big, small]) {
        const [x, y, out] = stepPos(dg, cyc, !lit);
        dg.e.pos.set([x, y, 0.05], 0); dg.e.flush();
        emitting = emitting || out;
        dg.ph.pos.set([x + dg.w * (0.6 + 1.5 * Math.max(0, cyc - 0.45)), (dg.ys.out + dg.ys.g) / 2, 0.05], 0);
        dg.ph.col.set([cEm.r, cEm.g, cEm.b], 0); dg.ph.alp[0] = lit && cyc > 0.45 && cyc < 0.9 ? 1 : 0; dg.ph.flush();
      }
      glowNow = emitting ? 1 : Math.max(0, glowNow - h * 3);
      for (const m of atomMats) m.emissiveIntensity = 0.9 * glowNow;
      // photons leave the dot when it glows
      for (let k = 0; k < NPH; k++) {
        phAge[k] += h;
        if (phAge[k] > 2 && emitting && halton(k + 1 + Math.floor(cyc * 89), 5) < h * 12) phAge[k] = 0;
        const rr = RF + 9 * phAge[k], on = phAge[k] < 2;
        photons.pos.set([phDir[k].x * rr, yMid + phDir[k].y * rr, phDir[k].z * rr], k * 3);
        photons.col.set([cEm.r, cEm.g, cEm.b], k * 3); photons.alp[k] = on ? 1 - phAge[k] / 2 : 0;
      }
      photons.flush();
    },
    dispose() { T.dispose(); },
  };
}
