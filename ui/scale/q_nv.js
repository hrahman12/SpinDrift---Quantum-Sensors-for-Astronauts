// Quantum level, heart: the NV- centre in diamond that the NV-diamond heart magnetometers read (Omar et al.,
// arXiv 2601.18843). Lattice, levels and Ramsey phase are computed only from data/quantum_constants.json,
// physics.json and quantum_circuits.json; display choices are listed in DISPLAY and stated in the info panel.
import * as THREE from 'three';
import { theme, cpk, paletteColour, tracker, addLights, makeArrow, polyline, liveLine, circlePoints, spheres, sticks,
  cylinderBetween, lerpHex, smooth, fx, sci, voRow, missingScene, NO_CONSTANTS, unit3, hasView, viewLine, placeText,
  dots, jiggle, halton, num, plainNum, timesText } from './q_lib.js';

export const DATA = ['quantum_constants', 'physics', 'quantum_circuits', 'palette', 'lean_proofs', 'nv_heart_derived', 'specs'];
export const LEVEL = { id: 'q_nv', site: 'heart', level: 'quantum', title: 'NV centre in diamond', unit: 'Å',
  scaleBar: { length: 3.56715, label: '3.567 Å (one diamond cell)' } };

// Display choices, not physics (each one is stated in the info panel).
export const DISPLAY = {
  slowdown: 1e8,            // spin precession shown 10^8 times slower: 1 s on screen = 10 ns
  envSlowdown: 2e6,         // with a place's own field (nT, not mT): 1 s on screen = 500 ns, so tens of thousands of nT turn
                            // the spin visibly and tens of nT nearly stop it
  levelMagnification: 10,   // m_s = ±1 Zeeman shifts drawn 10x larger than the 0 -> D gap on the level diagram
  bMax: 5,                  // mT; field control range, far below the 102 mT level crossing D/γ
  spinArrowPerHbar: 2.6,    // Å of arrow per ħ of spin (a spin is not a length)
  tauMaxNs: 1000,           // a Ramsey sequence restarts after one full fringe or 1 µs of free precession
  sizeFraction: 0.35,       // atom spheres drawn at 0.35 × covalent radius so the bonds stay visible
};
const TWO_PI = Math.PI * 2;

// ---------------------------------------------------------------- physics (pure; also used by the self-check)
// Barry et al., Rev. Mod. Phys. 92, 015004, Eq. 6: field along the NV axis
export function nvLines(D, gamma, B) {
  const up = D + gamma * B, dn = D - gamma * B;
  return { up, dn, split: up - dn, centre: (up + dn) / 2 };
}
// ideal Ramsey fringe after pi/2 - tau - pi/2: P(m_s = 0) = cos^2(phi/2)  (quantum_circuits.json "theory")
export const ramseyP0 = (phi) => Math.cos(phi / 2) ** 2;
// <S> of (|0> + e^{i phi}|+1>)/sqrt2 in the NV frame (z = NV axis), from the spin-1 matrices (quantum_constants nv.spin_operators)
export const spinExpectation = (phi) => [Math.cos(phi) / Math.SQRT2, Math.sin(phi) / Math.SQRT2, 0.5];
// diamond cubic sites (crystal axes, Å) within rCut of `centre`: FCC lattice plus the (1/4,1/4,1/4) basis atom
export function diamondSites(a, centre, rCut) {
  const fcc = [[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]], out = [];
  const n = Math.ceil(rCut / a) + 1;
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) {
    for (const f of fcc) for (const s of [0, 1]) {
      const p = [a * (i + f[0] + s / 4), a * (j + f[1] + s / 4), a * (k + f[2] + s / 4)];
      const d = Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]);
      if (d <= rCut + 1e-9) out.push({ p, sub: s, d });
    }
  }
  return out;
}

// The descent (opts.view given) has no sliders: the place and the four numbers (setEnv) set everything it shows.
// Without opts the scene is the earlier explorer, unchanged.
export function build(D, opts = {}) {
  return opts.view === undefined ? buildLegacy(D, opts) : buildDescent(D, opts);
}

function buildLegacy(D, opts = {}) {
  const Q = D.quantum_constants;
  if (!Q) return missingScene('NV centre in diamond', NO_CONSTANTS, ['lattice', 'pair']);
  const T = tracker(), th = theme(D), scene = new THREE.Scene();
  scene.background = null;
  addLights(scene, th);
  const instanced = [];

  // ------------------------------------------------------------ inputs (all sourced)
  const ph = D.physics?.nv_odmr_lines;
  const Dvo = ph?.inputs?.[0] || Q.nv.D, Gvo = ph?.inputs?.[1] || Q.nv.gamma;
  const Dz = Dvo.value, gam = Gvo.value;                       // MHz, MHz/mT
  const a = Q.diamond.lattice_constant.value, dcc = Q.diamond.cc_bond_length.value;
  LEVEL.scaleBar = { length: a, label: `${a.toFixed(3)} Å (one diamond cell)` };
  const rC = Q.radii.carbon_sp3.value, rN = Q.radii.nitrogen.value;
  const colC = cpk(D, 'C') || '#909090', colN = cpk(D, 'N') || '#3050f8';
  const nvPal = paletteColour(D, 'nv');
  const colNV = nvPal?.hex || th.ink;                          // CIE colour of the 695 nm NV fluorescence band edge
  const tilt = Q.nv.superposition_spin_tilt.value, sLen = Q.nv.superposition_spin_length.value;
  const qc = D.quantum_circuits?.points || [];

  // ------------------------------------------------------------ lattice, rotated so the NV axis [111] points up
  const axis111 = new THREE.Vector3(1, 1, 1).normalize();
  const qR = new THREE.Quaternion().setFromUnitVectors(axis111, new THREE.Vector3(0, 1, 0));
  const mid = [a / 8, a / 8, a / 8];                             // midway between N at (0,0,0) and V at (a/4)(1,1,1)
  const toScene = (p) => new THREE.Vector3(p[0] - mid[0], p[1] - mid[1], p[2] - mid[2]).applyQuaternion(qR);
  const rCut = 1.52 * a;                                         // encloses the whole cubic cell [0, a]^3
  const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-6;
  const sites = diamondSites(a, mid, rCut);
  const vSite = sites.find((s) => near(s.p, [a / 4, a / 4, a / 4]));
  const nSite = sites.find((s) => near(s.p, [0, 0, 0]));
  const atoms = sites.filter((s) => s !== vSite);
  const pos = atoms.map((s) => toScene(s.p));
  const isN = atoms.map((s) => s === nSite);
  const fade = (d) => 0.72 * smooth(3.0, rCut, d);
  const atomCol = atoms.map((s, i) => lerpHex(isN[i] ? colN : colC, th.bg, isN[i] ? 0 : fade(s.d)));
  const radiiFor = (f) => atoms.map((s, i) => f * (isN[i] ? rN : rC));
  let frac = DISPLAY.sizeFraction;
  const atomMesh = spheres(T, pos, radiiFor(frac), atomCol);
  instanced.push(atomMesh.mesh); scene.add(atomMesh.mesh);

  // bonds between nearest neighbours; the four bonds of the vacancy are broken (drawn dashed)
  const pairs = [], pairCol = [];
  for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
    const d = Math.hypot(atoms[i].p[0] - atoms[j].p[0], atoms[i].p[1] - atoms[j].p[1], atoms[i].p[2] - atoms[j].p[2]);
    if (Math.abs(d - dcc) < 0.02) { pairs.push([pos[i], pos[j]]); pairCol.push(lerpHex(th.muted, th.bg, fade(Math.max(atoms[i].d, atoms[j].d)))); }
  }
  const bondMesh = sticks(T, pairs, 0.06, pairCol);
  instanced.push(bondMesh); scene.add(bondMesh);
  const vPos = toScene(vSite.p), nPos = toScene(nSite.p);
  const vNbrs = atoms.map((s, i) => [s, i]).filter(([s]) => Math.abs(Math.hypot(s.p[0] - vSite.p[0], s.p[1] - vSite.p[1], s.p[2] - vSite.p[2]) - dcc) < 0.02);
  for (const [, i] of vNbrs) scene.add(polyline(T, [vPos, pos[i]], th.ink, { dashed: true, dash: 0.12, gap: 0.08, opacity: 0.8 }));

  // the empty site: a wire sphere the size a carbon would have
  const vMat = T.add(new THREE.MeshBasicMaterial({ color: th.ink, wireframe: true, transparent: true, opacity: 0.45 }));
  const vGeo = T.add(new THREE.SphereGeometry(1, 14, 10));
  const vMesh = new THREE.Mesh(vGeo, vMat); vMesh.position.copy(vPos); vMesh.scale.setScalar(frac * rC); scene.add(vMesh);

  // one conventional cubic cell [0, a]^3
  const corners = [];
  for (const x of [0, a]) for (const y of [0, a]) for (const z of [0, a]) corners.push([x, y, z]);
  const edges = [];
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
    const diff = corners[i].map((v, k) => Math.abs(v - corners[j][k]));
    if (diff.filter((v) => v > 1e-9).length === 1) edges.push(toScene(corners[i]), toScene(corners[j]));
  }
  const cellGeo = T.add(new THREE.BufferGeometry().setFromPoints(edges));
  const cellMat = T.add(new THREE.LineDashedMaterial({ color: th.accent, dashSize: 0.22, gapSize: 0.14, transparent: true, opacity: 0.75 }));
  const cell = new THREE.LineSegments(cellGeo, cellMat); cell.computeLineDistances(); scene.add(cell);
  const cellCorner = toScene([a, a, 0]);

  // NV symmetry axis through N and V
  const axisMat = T.add(new THREE.MeshBasicMaterial({ color: th.accent, transparent: true, opacity: 0.55 }));
  scene.add(cylinderBetween(T, new THREE.Vector3(0, -7.2, 0), new THREE.Vector3(0, 7.2, 0), 0.025, axisMat));

  // ------------------------------------------------------------ the electron spin <S>, precessing about the NV axis
  const Ls = DISPLAY.spinArrowPerHbar * sLen;
  const spin = makeArrow(T, colNV, { shaft: 0.05, head: 0.15, headLen: 0.38, emissive: 0.45 });
  scene.add(spin.group);
  const th0 = THREE.MathUtils.degToRad(tilt);
  scene.add(polyline(T, circlePoints(new THREE.Vector3(0, Ls * Math.cos(th0), 0), new THREE.Vector3(0, 1, 0), Ls * Math.sin(th0)),
    colNV, { dashed: true, dash: 0.14, gap: 0.1, opacity: 0.55 }));
  const TRAIL = 90, trail = liveLine(T, TRAIL, colNV, { vertexColors: true });
  scene.add(trail.line);
  const trailPts = [];

  // field arrow along the axis, length proportional to B
  const bArrow = makeArrow(T, th.ink, { shaft: 0.04, head: 0.12, headLen: 0.3, emissive: 0.15 });
  const bBase = new THREE.Vector3(-6.4, -3.2, 0); bArrow.group.position.copy(bBase); scene.add(bArrow.group);

  // ------------------------------------------------------------ level diagram (frequency axis, not space)
  const x0 = 8.2, wL = 3.2, yb = -4.4, H = 6.0, yD = yb + H, MAG = DISPLAY.levelMagnification;
  const lineGeo = T.add(new THREE.CylinderGeometry(0.045, 0.045, wL, 10)); lineGeo.rotateZ(Math.PI / 2);
  const mat0 = T.add(new THREE.MeshStandardMaterial({ color: th.ink, emissive: th.ink, emissiveIntensity: 0.2 }));
  const matPM = T.add(new THREE.MeshStandardMaterial({ color: colNV, emissive: colNV, emissiveIntensity: 0.35 }));
  const lv0 = new THREE.Mesh(lineGeo, mat0); lv0.position.set(x0 + wL / 2, yb, 0); scene.add(lv0);
  const lvUp = new THREE.Mesh(lineGeo, matPM), lvDn = new THREE.Mesh(lineGeo, matPM);
  scene.add(lvUp, lvDn);
  scene.add(polyline(T, [new THREE.Vector3(x0, yD, 0), new THREE.Vector3(x0 + wL, yD, 0)], th.muted, { dashed: true }));
  const fAxis = makeArrow(T, th.muted, { shaft: 0.02, head: 0.09, headLen: 0.25, emissive: 0 });
  fAxis.group.position.set(x0 - 0.35, yb - 0.3, 0); fAxis.set(new THREE.Vector3(0, 1, 0), H + 4.0); scene.add(fAxis.group);
  const nuDn = makeArrow(T, colNV, { shaft: 0.035, head: 0.11, headLen: 0.28 }), nuUp = makeArrow(T, colNV, { shaft: 0.035, head: 0.11, headLen: 0.28 });
  nuDn.group.position.set(x0 + 0.9, yb, 0); nuUp.group.position.set(x0 + 2.3, yb, 0);
  scene.add(nuDn.group, nuUp.group);

  // ------------------------------------------------------------ Ramsey fringe: 12 simulated circuits + cos^2(phi/2)
  const xr0 = -15.4, W = 6.0, yr = -4.4, Hr = 3.0;
  const xOf = (phi) => xr0 + (phi / TWO_PI) * W;
  const barGeo = T.add(new THREE.BoxGeometry(0.34, 1, 0.34)); barGeo.translate(0, 0.5, 0);
  const barMat = T.add(new THREE.MeshStandardMaterial({ color: th.muted, roughness: 0.5, emissive: th.muted, emissiveIntensity: 0.15 }));
  for (const p of qc) {
    const bar = new THREE.Mesh(barGeo, barMat);
    bar.position.set(xOf(p.phi_rad), yr, 0); bar.scale.set(1, Math.max(p.p0 * Hr, 1e-3), 1); scene.add(bar);
  }
  const curve = [];
  for (let i = 0; i <= 120; i++) { const phi = (i / 120) * TWO_PI; curve.push(new THREE.Vector3(xOf(phi), yr + ramseyP0(phi) * Hr, 0.2)); }
  scene.add(polyline(T, curve, th.ink));
  scene.add(polyline(T, [new THREE.Vector3(xr0 - 0.3, yr, 0), new THREE.Vector3(xr0 + W + 0.3, yr, 0)], th.muted));
  scene.add(polyline(T, [new THREE.Vector3(xr0 - 0.3, yr + Hr, 0), new THREE.Vector3(xr0 + W + 0.3, yr + Hr, 0)], th.muted, { dashed: true }));
  const markMat = T.add(new THREE.MeshStandardMaterial({ color: colNV, emissive: colNV, emissiveIntensity: 0.5 }));
  const marker = new THREE.Mesh(T.add(new THREE.SphereGeometry(0.17, 18, 12)), markMat); scene.add(marker);
  const stem = new THREE.Mesh(T.add(new THREE.CylinderGeometry(0.02, 0.02, 1, 8).translate(0, 0.5, 0)), markMat); scene.add(stem);

  // ------------------------------------------------------------ state, readouts, controls
  let B = 1.0, phi = 0, tauNs = 0;
  let slow = DISPLAY.slowdown, nd = 3;                           // slow-down in use and decimals shown (6 once a place sets B)
  const slowText = (s) => `${s.toExponential(0).replace('e+', '×10^')} (1 s = ${fx(1e9 / s, 0)} ns)`;
  const dir = new THREE.Vector3(), tip = new THREE.Vector3(), cTrail = new THREE.Color(colNV), cBg = new THREE.Color(th.bg);
  const nearestSim = () => {
    if (!qc.length) return null;
    let best = qc[0];
    for (const p of qc) if (Math.abs(Math.atan2(Math.sin(p.phi_rad - phi), Math.cos(p.phi_rad - phi))) < Math.abs(Math.atan2(Math.sin(best.phi_rad - phi), Math.cos(best.phi_rad - phi)))) best = p;
    return best;
  };
  const SRC_EQ6 = 'Barry et al., Rev. Mod. Phys. 92, 015004 (2020), Eq. 6; D and γ from physics.json';
  const R = {
    up: { label: 'ν+ = D + γB (m_s 0 → +1)', value: '', unit: 'MHz', tag: 'calculated', source: SRC_EQ6 },
    dn: { label: 'ν− = D − γB (m_s 0 → −1)', value: '', unit: 'MHz', tag: 'calculated', source: SRC_EQ6 },
    split: { label: 'splitting ν+ − ν− = 2γB', value: '', unit: 'MHz', tag: 'calculated · Lean nv_splitting', source: SRC_EQ6 },
    centre: { label: 'centre (ν+ + ν−)/2 = D', value: '', unit: 'MHz', tag: 'calculated · Lean nv_centre', source: SRC_EQ6 },
    rot: { label: 'precession rate in the frame rotating at D (= γB)', value: '', unit: 'MHz', tag: 'calculated', source: 'Barry Sec. I.D–E: φ = γe B τ' },
    slow: { label: 'shown slowed by', value: slowText(slow), unit: '', tag: 'display choice', source: '' },
    phi: { label: 'Ramsey phase φ = 2πγBτ', value: '', unit: 'rad', tag: 'calculated', source: 'Barry Sec. I.E, p. 6' },
    tau: { label: 'free-precession time τ (this sequence)', value: '', unit: 'ns', tag: 'calculated', source: 'τ shown = screen time / slow-down' },
    p0: { label: 'P(m_s = 0) = cos²(φ/2) after the last π/2 pulse', value: '', unit: '', tag: 'calculated', source: 'quantum_circuits.json theory' },
    sim: { label: 'nearest Qiskit Aer circuit (4096 shots)', value: '', unit: '', tag: 'simulated', source: 'quantum_circuits.json (coda simulate, Qiskit Aer)' },
    check: { label: 'self-check |(ν+ − ν−) − 2γB|', value: '', unit: 'MHz', tag: 'calculated', source: 'floating-point check of the Lean identity' },
  };
  const readouts = [R.up, R.dn, R.split, R.centre, R.rot, R.slow, R.phi, R.tau, R.p0, R.sim, R.check,
    voRow('zero-field splitting D', Dvo), voRow('γ = g μB / h', Gvo),
    voRow('CODATA 2022 γe/2π', Q.electron.gyromagnetic_ratio_over_2pi_per_mT),
    voRow('lattice constant a', Q.diamond.lattice_constant), voRow('C–C bond √3a/4 (= N–V distance, ideal sites)', Q.diamond.cc_bond_length),
    voRow('tilt of <S> from the NV axis', Q.nv.superposition_spin_tilt), voRow('levels cross (m_s = −1 meets 0) at D/γ', Q.nv.gslac_field)];

  function refreshLevels() {
    const L = nvLines(Dz, gam, B);
    const off = MAG * ((gam * B) / Dz) * H;
    lvUp.position.set(x0 + wL / 2, yD + off, 0); lvDn.position.set(x0 + wL / 2, yD - off, 0);
    nuDn.set(new THREE.Vector3(0, 1, 0), yD - off - yb); nuUp.set(new THREE.Vector3(0, 1, 0), yD + off - yb);
    bArrow.set(new THREE.Vector3(0, 1, 0), 0.7 * B);
    R.up.value = fx(L.up, nd); R.dn.value = fx(L.dn, nd); R.split.value = fx(L.split, nd); R.centre.value = fx(L.centre, nd);
    R.rot.value = fx(gam * B, nd);
    R.slow.value = slowText(slow);
    R.check.value = Math.abs(L.split - 2 * gam * B).toExponential(1);
  }
  function setSpin() {
    const [sx, sy, sz] = spinExpectation(phi);
    dir.set(sx, sz, -sy);                                       // NV frame -> scene: x' -> X, z' (axis) -> Y, y' -> -Z
    spin.set(dir, Ls);
    tip.copy(dir).normalize().multiplyScalar(Ls);
    const x = xOf(phi), p0 = ramseyP0(phi);
    marker.position.set(x, yr + p0 * Hr, 0.25); stem.position.set(x, yr, 0.25); stem.scale.set(1, Math.max(p0 * Hr, 1e-3), 1);
    R.phi.value = fx(phi, 3); R.tau.value = fx(tauNs, 2); R.p0.value = fx(p0, 4);
    const s = nearestSim();
    R.sim.value = s ? `P(0) = ${fx(s.p0, 4)} ± ${fx(s.binomial_se, 4)} at φ = ${fx(s.phi_rad, 3)} rad (theory ${fx(s.p0_theory, 4)})` : 'no data';
  }
  function pushTrail() {
    trailPts.push(tip.clone()); while (trailPts.length > TRAIL) trailPts.shift();
    const n = trailPts.length;
    for (let i = 0; i < n; i++) {
      const p = trailPts[i], k = (i + 1) / n, c = cBg.clone().lerp(cTrail, k);
      trail.pos.set([p.x, p.y, p.z], i * 3); trail.col.set([c.r, c.g, c.b], i * 3);
    }
    trail.set(n);
  }
  refreshLevels(); setSpin();

  // ------------------------------------------------------------ labels (static positions, scene units Å)
  const labels = [
    { position: [nPos.x + 0.35, nPos.y - 0.2, nPos.z], text: 'N: nitrogen in place of one carbon' },
    { position: [vPos.x + 0.35, vPos.y + 0.15, vPos.z], text: 'vacancy: the neighbouring site along [111] is empty' },
    { position: [0.15, 7.5, 0], text: 'NV axis ∥ [111]' },
    { position: [cellCorner.x, cellCorner.y, cellCorner.z], text: `one cubic cell, a = ${a.toFixed(3)} Å` },
    { position: [Ls * Math.sin(th0) + 0.3, Ls * Math.cos(th0) + 0.2, 0], text: `electron spin <S>, ${tilt.toFixed(2)}° from the axis` },
    { position: [bBase.x + 0.25, bBase.y - 0.45, 0], text: 'B along the NV axis (arrow ∝ B)' },
    { position: [x0 - 0.5, yD + 4.25, 0], text: 'ground-state spin levels · frequency axis · ±1 shifts drawn ×10' },
    { position: [x0 + wL + 0.25, yb, 0], text: 'm_s = 0' },
    { position: [x0 + wL + 0.25, yD, 0], text: `D = ${Dz} MHz (B = 0)` },
    { position: [x0 + wL + 0.25, yD + 1.0, 0], text: 'm_s = +1: upper red line, D + γB' },
    { position: [x0 + wL + 0.25, yD - 1.0, 0], text: 'm_s = −1: lower red line, D − γB' },
    { position: [x0 + 0.4, yb - 0.6, 0], text: 'ν−   ν+  microwave lines' },
    { position: [xr0 - 0.2, yr + Hr + 1.45, 0], text: 'Ramsey fringe P(m_s = 0) against φ' },
    { position: [xr0 - 0.2, yr + Hr + 0.95, 0], text: 'bars: Qiskit Aer, 4096 shots · line: cos²(φ/2)' },
    { position: [xr0 - 0.3, yr - 0.55, 0], text: 'φ = 0' },
    { position: [xr0 + W - 0.3, yr - 0.55, 0], text: '2π' },
  ];
  if (opts.view !== undefined) labels.push({ position: [-0.55, 0, 0], text: `N–V distance ${dcc.toFixed(3)} Å (ideal lattice sites)` });

  const info = {
    title: 'NV⁻ centre in diamond: spin-1 levels and the Ramsey phase',
    lines: [
      `Diamond cubic lattice, a = ${a.toFixed(3)} Å (Holloway et al. 1991, 25 °C; COD crystal structures agree within 0.0006 Å); C–C bond √3a/4 = ${dcc.toFixed(3)} Å (calculated). One nitrogen sits on a carbon site and the next site along [111] is empty: the nitrogen-vacancy centre (Barry et al. 2020, Sec. I.A). Atoms are on ideal lattice sites; the relaxation around the vacancy is not drawn. Dashed: the vacancy's four broken bonds.`,
      `Ground-state spin levels for a field along the NV axis (Barry Eq. 6): m_s = 0 at 0, m_s = ±1 at D ± γB, with D = ${Dz} MHz and γ = ${gam} MHz/mT from physics.json (γ to confirm: Barry gives g ≈ 2.003, i.e. 28.03 MHz/mT; 28.025 MHz/mT is the CODATA free-electron value). On the level diagram the gap 0 → D is to scale and the ±1 shifts are drawn ${MAG}× larger so that they show.`,
      `Arrow: the spin expectation <S> of the Ramsey superposition (|0⟩ + |+1⟩)/√2, tilted ${tilt.toFixed(2)}° from the axis with length √3/2 ħ (calculated from the spin-1 matrices; arrow ${DISPLAY.spinArrowPerHbar} Å per ħ). In the frame rotating at the microwave frequency D it precesses about the NV axis at γB (${fx(gam, 3)} MHz per mT); it is shown ${DISPLAY.slowdown.toExponential(0).replace('e+', '×10^')} times slower, so 1 s on screen is 10 ns. In the lab frame it turns at ν+ = D + γB, about 2.9 GHz.`,
      'Ramsey (Barry Sec. I.D–E): a π/2 pulse makes the superposition, the free precession for τ gathers φ = 2πγBτ, a second π/2 pulse turns φ into a population, P(m_s = 0) = cos²(φ/2). The marker follows the arrow\'s phase; each sequence restarts after one full fringe. Bars: 12 circuits H·RZ(φ)·H run on Qiskit Aer through coda, 4096 shots each (simulated, not a device). No dephasing (T₂*) is modelled.',
      `Spheres: ${DISPLAY.sizeFraction} × the covalent radius by default (C ${rC} Å, N ${rN} Å; Cordero et al. 2008, to confirm against the paywalled article); set the size control to 1 for the full radius. Colours: Jmol CPK for C and N; the spin and the ±1 levels use the CIE colour of 695 nm, the NV fluorescence band edge in palette.json. The heart builds (Omar et al. 2026) use a bias of about 1 mT (ZAQuant, Q.ANT) or none (JGU).`,
      `When a place is chosen, B becomes that place's background field (given in nT; 1 nT = 10⁻⁶ mT exactly) and the rows "from this place's field" give γB and 2γB (Lean nv_splitting). The field is taken along the NV axis, which is the case Eq. 6 describes; its real direction relative to the crystal is not known. The spin is then shown ${DISPLAY.envSlowdown.toExponential(0).replace('e+', '×10^')} times slower instead of ${DISPLAY.slowdown.toExponential(0).replace('e+', '×10^')}, a display choice that lets fields of tens of thousands of nT turn it visibly while fields of tens of nT nearly stop it, and a sequence restarts only after a full fringe. Moving the B control returns to the control's value and the first slow-down.`,
    ],
    sources: [Q.diamond.lattice_constant.source, Q.nv.geometry.source, Dvo.source, Gvo.source,
      Q.electron.gyromagnetic_ratio_over_2pi.source, 'data/quantum_circuits.json (coda simulate, Qiskit Aer, 2026-11-15)',
      Q.radii.carbon_sp3.source, Q.cpk_colours?.C?.source, nvPal?.colour?.source].filter(Boolean),
    lean: ['nv_splitting', 'nv_centre', 'nv_zero_field'],
  };

  const controls = [
    { id: 'B', label: 'B along the NV axis', min: 0, max: DISPLAY.bMax, step: 0.01, value: B, unit: 'mT',
      onInput(v) { B = +v; controls[0].value = B; slow = DISPLAY.slowdown; nd = 3; refreshLevels(); } },
    { id: 'size', label: 'atom size (× covalent radius)', min: 0.2, max: 1, step: 0.05, value: frac, unit: '×',
      onInput(v) { frac = +v; atomMesh.setRadii(radiiFor(frac)); vMesh.scale.setScalar(frac * rC); } },
  ];

  // ------------------------------------------------------------ views (the same content; the camera moves)
  const views = {
    lattice: { target: [-1.2, 0.4, 0], dir: unit3([0, 3.2, 33]),
      note: `The diamond cluster with the NV centre at its middle (one cubic cell is ${a.toFixed(3)} Å), the spin-level diagram on the right and the Ramsey fringe on the left.` },
    pair: { target: [0, 0, 0], dir: unit3([0.45, 0.3, 1]),
      note: `The nitrogen atom and the empty site next to it, ${dcc.toFixed(3)} Å apart along [111] (ideal lattice sites: √3a/4, calculated), each with its three carbon neighbours. The arrow is the spin <S> turning about the N–V axis; spheres are ${DISPLAY.sizeFraction} × the covalent radius unless the size control is moved.` },
  };
  const showLine = viewLine(info, views);
  const setView = (name) => showLine(hasView(views, name) ? name : null);

  // ------------------------------------------------------------ the chosen place: its background field becomes B
  const EV = {
    place: { label: 'this place: background field', value: '—', unit: '', tag: '', source: '' },
    shift: { label: 'from this place\'s field: Zeeman shift γB', value: '—', unit: 'MHz', tag: 'calculated', source: SRC_EQ6 },
    split: { label: 'from this place\'s field: splitting 2γB', value: '—', unit: 'MHz', tag: 'calculated · Lean nv_splitting', source: SRC_EQ6 },
    turn: { label: 'from this place\'s field: one turn of the spin takes, on screen', value: '—', unit: 's', tag: 'display', source: '' },
  };
  function setEnv(env) {
    if (!env || typeof env !== 'object') return;
    if (readouts.indexOf(EV.place) < 0) readouts.unshift(EV.place, EV.shift, EV.split, EV.turn);
    const Bn = typeof env.B_nT === 'number' && Number.isFinite(env.B_nT) ? env.B_nT : null;
    const status = env.B_status && env.B_status !== 'VERIFIED' ? String(env.B_status).toLowerCase().replace(/_/g, ' ') : null;
    EV.place.tag = [env.B_tag, status].filter(Boolean).join(' · ');
    EV.place.source = [placeText(env), env.B_source].filter(Boolean).join(' · ');
    if (Bn === null) {
      EV.place.value = 'not known for this place'; EV.shift.value = EV.split.value = EV.turn.value = '—';
      EV.shift.source = EV.split.source = SRC_EQ6; EV.turn.source = '';
      return;                                                    // the scene keeps the field it had
    }
    const BmT = Bn / 1e6;                                        // 1 nT = 1e-6 mT exactly
    B = BmT; slow = DISPLAY.envSlowdown; nd = 6;
    controls[0].value = B;
    const shift = gam * BmT, host = typeof env.nv_zeeman_shift_MHz === 'number' ? env.nv_zeeman_shift_MHz : null;
    EV.place.value = `${Bn.toLocaleString('en-US', { maximumFractionDigits: 3 })} nT = ${+BmT.toFixed(9)} mT`;
    EV.shift.value = fx(shift, 6); EV.split.value = fx(2 * shift, 6);
    EV.shift.source = `${SRC_EQ6}; γ × B with the field along the NV axis${host !== null ? `; the app's own value: ${fx(host, 6)} MHz` : ''}`;
    EV.split.source = `${SRC_EQ6}; field along the NV axis`;
    const turn = shift > 0 ? slow / (shift * 1e6) : null;        // seconds on screen per turn in the frame rotating at D
    EV.turn.value = turn === null ? 'never (B = 0)' : turn < 100 ? fx(turn, 2) : Math.round(turn).toLocaleString('en-US');
    EV.turn.source = `slowed ${slowText(slow)}`;
    refreshLevels();
  }
  if (opts.env) setEnv(opts.env);
  if (opts.view !== undefined) setView(opts.view);

  return {
    scene,
    camera: { position: [-1.2, 3.6, 33], target: [-1.2, 0.4, 0], fov: 40 },
    labels, info, readouts, controls, views, setView, setEnv,
    update(dt) {
      const step = Math.min(Math.max(dt, 0), 0.1) / slow;         // seconds of spin time this frame
      const fHz = gam * B * 1e6;
      phi += TWO_PI * fHz * step; tauNs += step * 1e9;
      if (phi >= TWO_PI) { phi -= TWO_PI; tauNs = fHz > 0 ? (phi / (TWO_PI * fHz)) * 1e9 : 0; trailPts.length = 0; }
      else if (slow === DISPLAY.slowdown && tauNs >= DISPLAY.tauMaxNs) { phi = 0; tauNs = 0; trailPts.length = 0; }
      setSpin(); pushTrail();
    },
    dispose() { for (const m of instanced) m.dispose?.(); T.dispose(); },
  };
}

// ================================================================ the descent: lattice (2.50 nm) and pair (500 pm)
// Everything comes from setEnv: the place's field moves the lines and turns the spin; the heartbeats entered shrink the
// noise. Atoms jiggle with diamond's measured mean-square displacement (Einstein model for the rate).
const DESC = {
  jiggleHz: 0.8,        // the Einstein frequency is shown at 0.8 Hz on screen (the factor is printed)
  spinSlow: 2e6,        // spin precession shown 2×10^6 times slower (1 s on screen = 500 ns)
  sweepS: 8,            // one microwave sweep across the spectrum takes 8 s on screen (illustrative)
  cycleS: 1.6,          // one optical cycle takes 1.6 s on screen (illustrative; the rates are not in /data)
  depth: 0.8,           // the deepest dip is drawn at 80 % of the chart height (contrast not stated: normalised)
};
function setStick(mesh, i, a, b, r, m4, q, s, p, d, UP) {
  d.subVectors(b, a); const L = d.length() || 1e-6;
  q.setFromUnitVectors(UP, d.multiplyScalar(1 / L)); p.addVectors(a, b).multiplyScalar(0.5); s.set(r, L, r);
  mesh.setMatrixAt(i, m4.compose(p, q, s));
}

function buildDescent(D, opts) {
  const Q = D.quantum_constants;
  if (!Q) return missingScene('NV centre in diamond', NO_CONSTANTS, ['lattice', 'pair']);
  const T = tracker(), th = theme(D), scene = new THREE.Scene();
  scene.background = null;
  addLights(scene, th);
  const ph = D.physics?.nv_odmr_lines, Dvo = ph?.inputs?.[0] || Q.nv.D, Gvo = ph?.inputs?.[1] || Q.nv.gamma;
  const Dz = Dvo.value, gam = Gvo.value;                                     // MHz, MHz/mT
  const a = Q.diamond.lattice_constant.value, dcc = Q.diamond.cc_bond_length.value;
  LEVEL.scaleBar = { length: a, label: `${a.toFixed(3)} Å (one diamond cell)` };
  const rC = Q.radii.carbon_sp3.value, rN = Q.radii.nitrogen.value;
  const colC = cpk(D, 'C') || '#909090', colN = cpk(D, 'N') || '#3050f8', colNV = paletteColour(D, 'nv')?.hex || '#ff0000';
  const mo = Q.motion || {}, opt = Q.nv_optics || {}, n14 = Q.nuclei?.n14 || {};
  const rms = num(mo.diamond_rms_displacement), nuE = num(mo.diamond_einstein_frequency);             // Å, THz
  const A14 = num(Q.nv.n14_hyperfine_splitting), lw = num(opt.zaquant_linewidth) ? num(opt.zaquant_linewidth) / 1000 : null;   // MHz
  const tilt = Q.nv.superposition_spin_tilt.value, sLen = Q.nv.superposition_spin_length.value;
  const cos3 = Math.abs(Math.cos(THREE.MathUtils.degToRad(Q.diamond.bond_angle.value)));            // 1/3 (calculated)
  const nvh = D.nv_heart_derived || {}, builds = [['jgu', 'JGU'], ['zaquant', 'ZAQuant'], ['qant', 'Q.ANT']];
  const peakVO = D.specs?.nv?.headline?.r_peak_average, peak = num(peakVO);                          // pT

  // ------------------------------------------------------------ lattice, rotated so the NV axis [111] points up
  const qR = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 1, 1).normalize(), new THREE.Vector3(0, 1, 0));
  const mid = [a / 8, a / 8, a / 8];
  const toS = (p) => new THREE.Vector3(p[0] - mid[0], p[1] - mid[1], p[2] - mid[2]).applyQuaternion(qR);
  const rCut = 1.52 * a, near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-6;
  const sites = diamondSites(a, mid, rCut);
  const vSite = sites.find((s) => near(s.p, [a / 4, a / 4, a / 4])), nSite = sites.find((s) => near(s.p, [0, 0, 0]));
  const atoms = sites.filter((s) => s !== vSite), base = atoms.map((s) => toS(s.p)), isN = atoms.map((s) => s === nSite);
  const fade = (dd) => 0.72 * smooth(3.0, rCut, dd);
  const FRAC = DISPLAY.sizeFraction;
  const atomMesh = spheres(T, base, atoms.map((s, i) => FRAC * (isN[i] ? rN : rC)), atoms.map((s, i) => lerpHex(isN[i] ? colN : colC, th.bg, isN[i] ? 0 : fade(s.d))));
  scene.add(atomMesh.mesh);
  const pairs = [];
  for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
    if (Math.abs(Math.hypot(atoms[i].p[0] - atoms[j].p[0], atoms[i].p[1] - atoms[j].p[1], atoms[i].p[2] - atoms[j].p[2]) - dcc) < 0.02) pairs.push([i, j]);
  }
  const bondMesh = sticks(T, pairs.map(([i, j]) => [base[i], base[j]]), 0.06, pairs.map(([i, j]) => lerpHex(th.muted, th.bg, fade(Math.max(atoms[i].d, atoms[j].d)))));
  scene.add(bondMesh);
  const vPos = toS(vSite.p), nPos = toS(nSite.p);
  for (let i = 0; i < atoms.length; i++) {
    if (Math.abs(Math.hypot(atoms[i].p[0] - vSite.p[0], atoms[i].p[1] - vSite.p[1], atoms[i].p[2] - vSite.p[2]) - dcc) < 0.02) scene.add(polyline(T, [vPos, base[i]], th.ink, { dashed: true, dash: 0.12, gap: 0.08, opacity: 0.8 }));
  }
  const vMesh = new THREE.Mesh(T.add(new THREE.SphereGeometry(1, 14, 10)), T.add(new THREE.MeshBasicMaterial({ color: th.ink, wireframe: true, transparent: true, opacity: 0.45 })));
  vMesh.position.copy(vPos); vMesh.scale.setScalar(FRAC * rC); scene.add(vMesh);
  // the NV axis and the three other <111> directions an NV can take in the crystal
  scene.add(cylinderBetween(T, new THREE.Vector3(0, -6.2, 0), new THREE.Vector3(0, 6.2, 0), 0.025, T.add(new THREE.MeshBasicMaterial({ color: th.accent, transparent: true, opacity: 0.55 }))));
  for (const d of [[1, -1, -1], [-1, 1, -1], [-1, -1, 1]]) {
    const u = new THREE.Vector3(...d).normalize().applyQuaternion(qR).multiplyScalar(5.6);
    scene.add(polyline(T, [u.clone().negate(), u], th.accent, { dashed: true, dash: 0.25, gap: 0.18, opacity: 0.5 }));
  }

  // ------------------------------------------------------------ the electron spin <S>, precessing about the NV axis at γB
  const Ls = DISPLAY.spinArrowPerHbar * sLen, t0 = THREE.MathUtils.degToRad(tilt);
  const spin = makeArrow(T, colNV, { shaft: 0.05, head: 0.15, headLen: 0.38, emissive: 0.45 }); scene.add(spin.group);
  scene.add(polyline(T, circlePoints(new THREE.Vector3(0, Ls * Math.cos(t0), 0), new THREE.Vector3(0, 1, 0), Ls * Math.sin(t0)), colNV, { dashed: true, dash: 0.14, gap: 0.1, opacity: 0.55 }));
  // red glow: photons leaving the defect when the optical cycle ends in m_s = 0 (bright path)
  const NPH = 48, glowPh = dots(T, NPH, 5); scene.add(glowPh.points);
  const red = new THREE.Color(colNV), phDir = [], phAge = new Float32Array(NPH).fill(9);
  for (let k = 0; k < NPH; k++) { const ct = 2 * halton(k + 1, 2) - 1, st = Math.sqrt(1 - ct * ct), pp = 2 * Math.PI * halton(k + 1, 3); phDir.push(new THREE.Vector3(st * Math.cos(pp), ct, st * Math.sin(pp))); }
  // the 14N nucleus: about 5 fm across, far too small to see; a marker only
  const nucDot = dots(T, 1, 5); nucDot.col.set(new THREE.Color(th.accent).toArray()); nucDot.pos.set(nPos.toArray()); nucDot.flush(); scene.add(nucDot.points);

  // ------------------------------------------------------------ lattice view only: spectrum, optical cycle, noise bars
  const charts = new THREE.Group(); scene.add(charts);
  // ODMR: red glow against microwave frequency, around D
  const sx0 = -9.0, sW = 17.5, sy0 = 6.7, sH = 3.6, NS = 900;
  const spec = liveLine(T, NS, th.ink); charts.add(spec.line);
  const sticksL = new THREE.LineSegments(T.add(new THREE.BufferGeometry()), T.add(new THREE.LineBasicMaterial({ color: colNV, transparent: true, opacity: 0.8 })));
  const stickPos = new Float32Array(12 * 6); sticksL.geometry.setAttribute('position', new THREE.BufferAttribute(stickPos, 3).setUsage(THREE.DynamicDrawUsage)); sticksL.frustumCulled = false; charts.add(sticksL);
  charts.add(polyline(T, [new THREE.Vector3(sx0, sy0, 0), new THREE.Vector3(sx0 + sW, sy0, 0)], th.muted));
  charts.add(polyline(T, [new THREE.Vector3(sx0 + sW / 2, sy0 - 0.25, 0), new THREE.Vector3(sx0 + sW / 2, sy0 + sH + 0.2, 0)], th.muted, { dashed: true, dash: 0.15, gap: 0.12, opacity: 0.6 }));
  const mwLine = liveLine(T, 2, th.accent); charts.add(mwLine.line);
  // optical cycle: triplet ground and excited states, the singlet pair; energies from the wavelengths (eV scale)
  const cx = -9.0, cyb = -10.6, eS = 1.75;                     // Å per eV on this diagram
  const eG = num(opt.green_excitation_eV), eZ = num(opt.zpl_eV), eIR = num(opt.singlet_ir_eV);
  const yA0 = cyb, yA1 = cyb + 0.35, yE0 = cyb + (eZ || 1.95) * eS, yE1 = yE0 + 0.35, yTop = cyb + (eG || 2.33) * eS;
  const ySA = yE0 - 0.55, ySE = ySA - (eIR || 1.19) * eS, xS = cx + 5.2;
  const lvl = (x, y, w, col) => charts.add(polyline(T, [new THREE.Vector3(x, y, 0), new THREE.Vector3(x + w, y, 0)], col));
  lvl(cx, yA0, 1.6, th.ink); lvl(cx + 2.0, yA1, 1.6, colNV); lvl(cx, yE0, 1.6, th.muted); lvl(cx + 2.0, yE1, 1.6, th.muted);
  lvl(xS, ySA, 1.5, th.muted); lvl(xS, ySE, 1.5, th.muted);
  const arrowAt = (from, to, col, dashed = false) => charts.add(polyline(T, [from, to], col, { dashed, dash: 0.18, gap: 0.12 }));
  arrowAt(new THREE.Vector3(cx + 0.5, yA0, 0), new THREE.Vector3(cx + 0.5, yTop, 0), th.accent);
  arrowAt(new THREE.Vector3(cx + 1.1, yE0, 0), new THREE.Vector3(cx + 1.1, yA0, 0), colNV);
  arrowAt(new THREE.Vector3(cx + 3.6, yE1, 0), new THREE.Vector3(xS + 0.2, ySA, 0), th.muted, true);
  arrowAt(new THREE.Vector3(xS + 0.75, ySA, 0), new THREE.Vector3(xS + 0.75, ySE, 0), th.muted, true);
  arrowAt(new THREE.Vector3(xS + 0.2, ySE, 0), new THREE.Vector3(cx + 1.6, yA0, 0), th.muted, true);
  const electron = dots(T, 1, 9); electron.col.set(new THREE.Color(th.ink).toArray()); charts.add(electron.points);
  // heartbeat against noise after N beats (pT, linear)
  const bx0 = 2.2, by0 = -10.6, bH = 3.6;
  const barGeo = T.add(new THREE.BoxGeometry(0.9, 1, 0.1)); barGeo.translate(0, 0.5, 0);
  const beatBar = new THREE.Mesh(barGeo, T.add(new THREE.MeshStandardMaterial({ color: colNV, emissive: colNV, emissiveIntensity: 0.35 })));
  beatBar.position.set(bx0, by0, 0); charts.add(beatBar);
  const noiseMat = T.add(new THREE.MeshStandardMaterial({ color: th.muted, emissive: th.muted, emissiveIntensity: 0.25 }));
  const noiseBars = builds.map((_, k) => { const b = new THREE.Mesh(barGeo, noiseMat); b.position.set(bx0 + 1.6 + 1.5 * k, by0, 0); charts.add(b); return b; });
  charts.add(polyline(T, [new THREE.Vector3(bx0 - 0.6, by0, 0), new THREE.Vector3(bx0 + 5.4, by0, 0)], th.muted));

  // ------------------------------------------------------------ labels (static; texts the host tags are kept)
  const labels = [
    { position: [nPos.x + 0.35, nPos.y - 0.2, nPos.z], text: 'N: nitrogen in place of one carbon' },
    { position: [vPos.x + 0.35, vPos.y + 0.15, vPos.z], text: 'vacancy: the neighbouring site along [111] is empty' },
    { position: [Ls * Math.sin(t0) + 0.3, Ls * Math.cos(t0) + 0.2, 0], text: `electron spin <S>, ${tilt.toFixed(2)}° from the axis` },
    { position: [nPos.x - 0.75, nPos.y - 0.35, nPos.z], text: '¹⁴N nucleus (spin 1)' },
    { position: [0.15, 6.0, 0], text: 'NV axis ∥ [111]' },
    { position: [3.9, 3.6, 0], text: 'the 3 other NV directions' },
    { position: [sx0, sy0 + sH + 0.55, 0], text: 'red glow against microwave frequency' },
    { position: [sx0 + sW / 2 - 1.3, sy0 - 0.55, 0], text: `D = ${Dz} MHz` },
    { position: [sx0 + sW - 3.2, sy0 + sH + 0.55, 0], text: 'green line: the microwave' },
    { position: [cx - 0.1, yA0 - 0.5, 0], text: 'ground, m_s = 0' },
    { position: [cx + 2.0, yA1 - 0.5, 0], text: 'm_s = ±1' },
    { position: [cx - 0.1, yE0 + 0.45, 0], text: 'excited' },
    { position: [cx + 0.55, (yA0 + yTop) / 2, 0], text: `green ${num(opt.green_excitation) || 532} nm` },
    { position: [cx + 1.15, (yA0 + yE0) / 2 - 0.8, 0], text: `red ${num(opt.zpl) || 637} nm` },
    { position: [xS + 0.85, (ySA + ySE) / 2, 0], text: `singlets, ${num(opt.singlet_ir) || 1042} nm (dark)` },
    { position: [bx0 - 0.4, by0 - 0.5, 0], text: 'heartbeat' },
    { position: [bx0 + 1.3, by0 - 0.5, 0], text: 'noise: JGU · ZAQuant · Q.ANT' },
  ];

  // ------------------------------------------------------------ state from the place and the numbers (setEnv)
  let B = 0, haveB = false, Nbeats = null, phi = 0, mwT = 0, cyc = 0, glowLevel = 1, sweep = 0, jig = 0;
  const lines = [];                                                         // [offset MHz, weight]
  let Rf = 8, depthScale = 1;
  const fluor = (f) => { let s = 0; for (const [f0, wt] of lines) { const x = (f - f0) / ((lw || 0.2) / 2); s += wt / (1 + x * x); } return 1 - DESC.depth * s * depthScale; };
  function makeSpectrum() {
    lines.length = 0;
    const gb = gam * B;                                                     // MHz: γB along the aligned axis
    for (const [proj, wt] of [[1, 1], [cos3, 3]]) for (const ms of [1, -1]) for (const mi of [-1, 0, 1]) lines.push([ms * (gb * proj + (A14 || 0) * mi), wt]);
    Rf = Math.max(8, gb + 3 * (A14 || 0) + 1.5);
    depthScale = 1; let worst = 0;
    for (let i = 0; i < NS; i++) worst = Math.max(worst, 1 - fluor(-Rf + (2 * Rf * i) / (NS - 1)));
    for (const [f0] of lines) worst = Math.max(worst, 1 - fluor(f0));
    depthScale = worst > 0 ? 1 / (worst / DESC.depth) : 1;
    for (let i = 0; i < NS; i++) { const f = -Rf + (2 * Rf * i) / (NS - 1); spec.pos.set([sx0 + (i / (NS - 1)) * sW, sy0 + sH * fluor(f), 0], i * 3); }
    spec.set(NS);
    lines.forEach(([f0, wt], k) => { const x = sx0 + ((f0 + Rf) / (2 * Rf)) * sW; stickPos.set([x, sy0 - 0.05, 0.01, x, sy0 - 0.05 - 0.18 * wt, 0.01], k * 6); });
    sticksL.geometry.attributes.position.needsUpdate = true;
  }
  const VERD = { REQUIREMENTS_MET: 'met', NOT_MET: 'not met', NEED_MORE_INFORMATION: 'needs more information' };
  const SRC6 = 'Barry et al., Rev. Mod. Phys. 92, 015004 (2020), Eq. 6; D and γ from physics.json';
  const R = {
    field: { label: 'field here (background field of the place)', plain: 'Field here', value: '—', unit: 'nT', tag: '', source: '' },
    shift: { label: 'Zeeman shift γB, field along the NV axis', plain: 'Line shift', value: '—', unit: 'MHz', tag: 'calculated', source: SRC6 },
    split: { label: 'splitting 2γB of the aligned NVs', plain: 'Gap between the two lines', value: '—', unit: 'MHz', tag: 'calculated · Lean nv_splitting', source: SRC6 },
    other: { label: 'shift for the 3 other NV directions, γB/3', plain: 'Shift, other 3 directions', value: '—', unit: 'MHz', tag: 'calculated', source: 'projection cos(109.47°) = −1/3 of a field along one axis (first order)' },
    depth: { label: 'dip depth (glow contrast)', plain: 'Glow dip depth', value: 'same at every field', unit: '', tag: 'calculated', source: 'the field moves the lines, the depth stays (first order); the builds’ contrast is not stated, so the depth is drawn normalised' },
    width: { ...voRow('resonance linewidth (ZAQuant)', opt.zaquant_linewidth), plain: 'Line width' },
    hf: { ...voRow('¹⁴N hyperfine splitting of each line', Q.nv.n14_hyperfine_splitting), plain: 'Nitrogen splits each line by' },
    beat: { label: 'line shift from a heartbeat R-peak, γ × 25 pT', plain: 'Heartbeat moves the line by', value: peak ? fx(gam * peak * 1e-9 * 1e6, 3) : '—', unit: 'Hz', tag: 'calculated', source: `${peakVO?.source || ''}; γ from physics.json` },
    N: { label: 'heartbeats averaged (your number)', plain: 'Heartbeats averaged', value: '—', unit: '', tag: 'user input', source: 'env.inputs.beats_averaged' },
    ...Object.fromEntries(builds.map(([b, name]) => [b, { label: `noise after N beats, ${name}: single-beat noise / √N`, plain: `Noise after N beats (${name})`, value: '—', unit: 'pT', tag: 'calculated · Lean snr_averaging', source: `${nvh.per_build?.[b]?.single_beat_noise_pT?.note || ''}` }])),
    ...Object.fromEntries(builds.map(([b, name]) => [`v_${b}`, { label: `Lean verdict, heart, ${name}`, plain: `Lean says (${name})`, value: '—', unit: '', tag: 'Lean checker', source: `verdict nv_heart_${b}` }])),
    turn: { label: 'one turn of the spin (frame rotating at D), on screen', plain: 'One spin turn takes', value: '—', unit: 's', tag: 'display', source: `slowed ${timesText(DESC.spinSlow)}` },
    jig: { ...voRow('thermal jiggle per direction, rms (diamond, 293 K)', mo.diamond_rms_displacement, { value: rms ? fx(rms, 4) : undefined }), plain: 'How far atoms jiggle' },
    nuE: { ...voRow('jiggle frequency (Einstein model, from the measured jiggle)', mo.diamond_einstein_frequency, { value: nuE ? fx(nuE, 2) : undefined }), plain: 'Jiggles per second (THz)' },
    jslow: { label: 'jiggle shown slowed by', plain: 'Jiggle slowed by', value: nuE ? timesText((nuE * 1e12) / DESC.jiggleHz) : 'not animated', unit: '×', tag: 'display choice', source: `the Einstein frequency shown at ${DESC.jiggleHz} Hz; the amplitude is not scaled` },
  };
  const readouts = [R.field, R.shift, R.split, R.other, R.depth, R.width, R.hf, R.beat, R.N, ...builds.map(([b]) => R[b]), ...builds.map(([b]) => R[`v_${b}`]), R.turn, R.jig, R.nuE, R.jslow,
    { ...voRow('zero-field splitting D', Dvo), plain: 'Microwave note at zero field' }, { ...voRow('γ = g μB / h', Gvo), plain: 'Shift per millitesla' },
    { ...voRow('green pump light', opt.green_excitation), plain: 'Green light in' }, { ...voRow('zero-phonon line', opt.zpl), plain: 'Red light out' },
    { ...voRow('singlet infrared line', opt.singlet_ir), plain: 'Dark (infrared) path' }];
  function setEnv(env) {
    if (!env || typeof env !== 'object') return;
    const Bn = typeof env.B_nT === 'number' && Number.isFinite(env.B_nT) ? Math.abs(env.B_nT) : null;
    const status = env.B_status && env.B_status !== 'VERIFIED' ? String(env.B_status).toLowerCase().replace(/_/g, ' ') : null;
    R.field.tag = [env.B_tag, status].filter(Boolean).join(' · ');
    R.field.source = [placeText(env), env.B_source].filter(Boolean).join(' · ');
    haveB = Bn !== null; B = haveB ? Bn / 1e6 : 0;                         // mT (1 nT = 10^-6 mT exactly)
    R.field.value = haveB ? plainNum(Bn, 5) : 'not known here (lines drawn at B = 0)';
    R.shift.value = haveB ? fx(gam * B, 6) : '—'; R.split.value = haveB ? fx(2 * gam * B, 6) : '—'; R.other.value = haveB ? fx(gam * B * cos3, 6) : '—';
    const turn = haveB && B > 0 ? DESC.spinSlow / (gam * B * 1e6) : null;
    R.turn.value = turn === null ? 'never (B = 0 or not known)' : turn < 100 ? fx(turn, 2) : Math.round(turn).toLocaleString('en-US');
    const nIn = env.inputs?.beats_averaged;
    Nbeats = typeof nIn === 'number' && nIn >= 1 ? nIn : null;
    R.N.value = Nbeats === null ? 'not given (bars at one beat)' : String(Nbeats);
    const shown = [];
    builds.forEach(([b], k) => {
      const s1 = num(nvh.per_build?.[b]?.single_beat_noise_pT), n = s1 !== null ? s1 / Math.sqrt(Nbeats || 1) : null;
      R[b].value = n === null ? '—' : fx(n, 2); shown.push(n);
      R[`v_${b}`].value = VERD[env.verdicts?.[`nv_heart_${b}`]] || 'no verdict received';
    });
    const top = Math.max(peak || 0, ...shown.filter((x) => x !== null));
    beatBar.scale.set(1, peak && top ? Math.max(1e-3, (peak / top) * bH) : 1e-3, 1);
    noiseBars.forEach((bar, k) => bar.scale.set(1, shown[k] && top ? Math.max(1e-3, (shown[k] / top) * bH) : 1e-3, 1));
    makeSpectrum();
  }
  const views = {
    lattice: { target: [0, -0.2, 0], dir: unit3([0, 0.12, 1]),
      note: `The diamond around one NV centre (a = ${a.toFixed(3)} Å), its atoms jiggling with diamond’s measured thermal motion; the NV axis and the three other directions an NV can take; above, the red glow against the microwave frequency, with the two lines of each NV direction split by the ¹⁴N nucleus into three (${A14} MHz apart); below, the optical cycle and the heartbeat against the noise after the beats you entered.` },
    pair: { target: [0, 0, 0], dir: unit3([0.45, 0.3, 1]),
      note: `The nitrogen and the empty site next to it, ${dcc.toFixed(3)} Å apart (ideal sites), jiggling; the electron spin <S> turning about the N–V axis at γB, slowed ${timesText(DESC.spinSlow)} times, so a bigger field turns it faster; red light leaving the centre whenever the green light finds the spin in m_s = 0. The ¹⁴N nucleus is far too small to see: a dot marks it.` },
  };
  const info = {
    title: 'NV⁻ centre: the lines move with the field, the glow keeps working',
    lines: [
      `Green light (${num(opt.green_excitation) || 532} nm) lifts the NV’s electrons; from m_s = 0 they fall back giving red light (zero-phonon line ${num(opt.zpl) || 637} nm), from m_s = ±1 they mostly take the dark path through the singlets (${num(opt.singlet_ir) || 1042} nm, infrared) and land in m_s = 0: Barry et al. “${opt.isc?.value || ''}”. The dot on the diagram follows one electron: when the microwave sits on a line it starts in m_s = ±1 and takes the dark path. Timing illustrative: the rates are not in /data, and the dark path is drawn every time although Barry says only that it is the more likely one.`,
      `The spectrum: glow against microwave frequency around D = ${Dz} MHz. Each NV direction gives two lines at D ± γB·cosθ, each split into three by the ¹⁴N spin (m_I = −1, 0, +1, ${A14} MHz apart, Omar et al.); NVs along the field’s axis move by γB, the other three directions by γB/3 (first order, equal numbers of NVs in the four directions assumed). Lines are drawn ${lw ? lw * 1000 : '?'} kHz wide (ZAQuant’s linewidth); the dip depth is normalised because the builds’ contrast is not stated. The place’s field moves the lines but not their depth: the readout keeps working anywhere near Earth.`,
      `The heartbeat: the average R-peak of ${peak ?? '?'} pT (Omar et al. p. 10) moves a line by only γ × ${peak ?? '?'} pT = ${R.beat.value} Hz. Averaging N heartbeats shrinks the noise as 1/√N (Lean snr_averaging): the grey bars are the single-beat noise of each build (η√BW, nv_heart_derived.json) divided by √N for the number you entered.`,
      rms && nuE ? `Atoms jiggle with diamond’s measured thermal motion: Uiso = ${num(mo.diamond_u_iso)} Å² at ${num(mo.diamond_temperature)} K (Houben et al. 2023, COD 2300702), ${fx(rms, 4)} Å per direction, the true amplitude. Their rate is the Einstein frequency that gives this motion, ${fx(nuE, 2)} THz (calculated), shown ${timesText((nuE * 1e12) / DESC.jiggleHz)} times slower; the nitrogen is given the carbons’ motion (its own is not measured).` : 'Thermal motion is not animated: diamond’s displacement parameter is not in quantum_constants.json.',
      `The spin <S> of the Ramsey superposition turns about the NV axis at γB in the frame rotating at D, shown ${timesText(DESC.spinSlow)} times slower (1 s on screen = 500 ns). The field is taken along the NV axis (Eq. 6); its real direction relative to the crystal is not known.`,
    ],
    sources: [Q.diamond.lattice_constant.source, Q.nv.geometry.source, Dvo.source, Gvo.source, opt.isc?.source, opt.zaquant_linewidth?.source,
      Q.nv.n14_hyperfine_splitting?.source, mo.diamond_u_iso?.source, peakVO?.source, 'data/nv_heart_derived.json per_build single_beat_noise_pT'].filter(Boolean),
    lean: ['nv_splitting', 'nv_centre', 'nv_zero_field', 'snr_averaging'],
  };
  const showLine = viewLine(info, views);
  function setView(name) {
    const named = hasView(views, name);
    charts.visible = !named || name === 'lattice';
    showLine(named ? name : null);
  }
  setEnv(opts.env || {});
  setView(opts.view);

  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), s4 = new THREE.Vector3(), p4 = new THREE.Vector3(), d4 = new THREE.Vector3(), UPv = new THREE.Vector3(0, 1, 0);
  const jg = rms ? jiggle(rms) : null, cur = base.map((p) => p.clone()), dv = new THREE.Vector3(), dirv = new THREE.Vector3();
  const radii = atoms.map((s, i) => FRAC * (isN[i] ? rN : rC));
  function moveAtoms() {
    if (!jg) return;
    const phase = 2 * Math.PI * jig;
    for (let i = 0; i < base.length; i++) { cur[i].copy(base[i]).add(jg(i, phase, dv)); s4.setScalar(radii[i]); atomMesh.mesh.setMatrixAt(i, m4.compose(cur[i], q4.identity(), s4)); }
    atomMesh.mesh.instanceMatrix.needsUpdate = true;
    pairs.forEach(([i, j], k) => setStick(bondMesh, k, cur[i], cur[j], 0.06, m4, q4, s4, p4, d4, UPv));
    bondMesh.instanceMatrix.needsUpdate = true;
    nucDot.pos.set(cur[atoms.indexOf(nSite)].toArray()); nucDot.flush();
  }
  // one optical cycle: 0-0.25 green up, 0.25-0.35 relax, then red down (bright) or through the singlets (dark)
  let dark = false;
  function cyclePos(f) {
    const xa = dark ? cx + 2.8 : cx + 0.8;
    if (f < 0.25) return [xa, (dark ? yA1 : yA0) + (yTop - (dark ? yA1 : yA0)) * (f / 0.25)];
    if (f < 0.35) return [xa, yTop + ((dark ? yE1 : yE0) - yTop) * ((f - 0.25) / 0.1)];
    if (!dark) return [xa, yE0 + (yA0 - yE0) * ((f - 0.35) / 0.65)];
    if (f < 0.55) { const g = (f - 0.35) / 0.2; return [xa + (xS + 0.75 - xa) * g, yE1 + (ySA - yE1) * g]; }
    if (f < 0.75) return [xS + 0.75, ySA + (ySE - ySA) * ((f - 0.55) / 0.2)];
    const g = (f - 0.75) / 0.25; return [xS + 0.75 + (cx + 0.8 - xS - 0.75) * g, ySE + (yA0 - ySE) * g];
  }
  const UP = new THREE.Vector3(0, 1, 0);
  return {
    scene,
    camera: { position: [0, -0.2 + 0.12 * 34.3, 34.3], target: [0, -0.2, 0], fov: 40 },
    labels, info, readouts, controls: [], views, setView, setEnv,
    update(dt) {
      const h = Math.min(Math.max(dt, 0), 0.1);
      jig += h * DESC.jiggleHz; moveAtoms();
      // spin: precession at γB (frame rotating at D), slowed
      phi = (phi + 2 * Math.PI * gam * B * 1e6 * (h / DESC.spinSlow)) % (2 * Math.PI);
      const [sx, sy, sz] = spinExpectation(phi); dirv.set(sx, sz, -sy); spin.set(dirv, Ls);
      // microwave sweep and the glow it gives
      sweep = (sweep + h / DESC.sweepS) % 2;
      const fmw = -Rf + 2 * Rf * (sweep < 1 ? sweep : 2 - sweep), xm = sx0 + ((fmw + Rf) / (2 * Rf)) * sW;
      mwLine.pos.set([xm, sy0 - 0.2, 0.02, xm, sy0 + sH + 0.2, 0.02]); mwLine.set(2);
      glowLevel = fluor(fmw);
      // optical cycle: the start state follows the microwave (on a line: m_s = ±1, dark path)
      cyc += h / DESC.cycleS;
      if (cyc >= 1) { cyc -= 1; dark = glowLevel < 1 - DESC.depth * 0.5; }
      const [ex, ey] = cyclePos(cyc); electron.pos.set([ex, ey, 0.05], 0); electron.flush();
      // red photons: launched when a bright cycle ends
      const launch = !dark && cyc > 0.35;
      for (let k = 0; k < NPH; k++) {
        phAge[k] += h;
        if (phAge[k] > 2.2 && launch && halton(k + 1 + Math.floor(cyc * 97), 7) < h * 9) phAge[k] = 0;
        const r = 0.4 + 3.2 * phAge[k], on = phAge[k] < 2.2;
        glowPh.pos.set([phDir[k].x * r, phDir[k].y * r, phDir[k].z * r], k * 3);
        glowPh.col.set([red.r, red.g, red.b], k * 3); glowPh.alp[k] = on ? Math.max(0, 1 - phAge[k] / 2.2) : 0;
      }
      glowPh.flush();
    },
    dispose() { atomMesh.mesh.dispose?.(); bondMesh.dispose?.(); T.dispose(); },
  };
}
