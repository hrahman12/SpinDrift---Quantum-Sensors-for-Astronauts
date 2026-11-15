// Quantum level, heart: the NV- centre in diamond that the NV-diamond heart magnetometers read (Omar et al.,
// arXiv 2601.18843). Lattice, levels and Ramsey phase are computed only from data/quantum_constants.json,
// physics.json and quantum_circuits.json; display choices are listed in DISPLAY and stated in the info panel.
import * as THREE from 'three';
import { theme, cpk, paletteColour, tracker, addLights, makeArrow, polyline, liveLine, circlePoints, spheres, sticks,
  cylinderBetween, lerpHex, smooth, fx, voRow, missingScene, NO_CONSTANTS } from './q_lib.js';

export const DATA = ['quantum_constants', 'physics', 'quantum_circuits', 'palette', 'lean_proofs'];
export const LEVEL = { id: 'q_nv', site: 'heart', level: 'quantum', title: 'NV centre in diamond', unit: 'Å',
  scaleBar: { length: 3.56715, label: '3.567 Å (one diamond cell)' } };

// Display choices, not physics (each one is stated in the info panel).
export const DISPLAY = {
  slowdown: 1e8,            // spin precession shown 10^8 times slower: 1 s on screen = 10 ns
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

export function build(D) {
  const Q = D.quantum_constants;
  if (!Q) return missingScene('NV centre in diamond', NO_CONSTANTS);
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
    slow: { label: 'shown slowed by', value: `${DISPLAY.slowdown.toExponential(0).replace('e+', '×10^')} (1 s = 10 ns)`, unit: '', tag: 'display choice', source: '' },
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
    R.up.value = fx(L.up, 3); R.dn.value = fx(L.dn, 3); R.split.value = fx(L.split, 3); R.centre.value = fx(L.centre, 3);
    R.rot.value = fx(gam * B, 3);
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

  const info = {
    title: 'NV⁻ centre in diamond: spin-1 levels and the Ramsey phase',
    lines: [
      `Diamond cubic lattice, a = ${a.toFixed(3)} Å (Holloway et al. 1991, 25 °C; COD crystal structures agree within 0.0006 Å); C–C bond √3a/4 = ${dcc.toFixed(3)} Å (calculated). One nitrogen sits on a carbon site and the next site along [111] is empty: the nitrogen-vacancy centre (Barry et al. 2020, Sec. I.A). Atoms are on ideal lattice sites; the relaxation around the vacancy is not drawn. Dashed: the vacancy's four broken bonds.`,
      `Ground-state spin levels for a field along the NV axis (Barry Eq. 6): m_s = 0 at 0, m_s = ±1 at D ± γB, with D = ${Dz} MHz and γ = ${gam} MHz/mT from physics.json (γ to confirm: Barry gives g ≈ 2.003, i.e. 28.03 MHz/mT; 28.025 MHz/mT is the CODATA free-electron value). On the level diagram the gap 0 → D is to scale and the ±1 shifts are drawn ${MAG}× larger so that they show.`,
      `Arrow: the spin expectation <S> of the Ramsey superposition (|0⟩ + |+1⟩)/√2, tilted ${tilt.toFixed(2)}° from the axis with length √3/2 ħ (calculated from the spin-1 matrices; arrow ${DISPLAY.spinArrowPerHbar} Å per ħ). In the frame rotating at the microwave frequency D it precesses about the NV axis at γB (${fx(gam, 3)} MHz per mT); it is shown ${DISPLAY.slowdown.toExponential(0).replace('e+', '×10^')} times slower, so 1 s on screen is 10 ns. In the lab frame it turns at ν+ = D + γB, about 2.9 GHz.`,
      'Ramsey (Barry Sec. I.D–E): a π/2 pulse makes the superposition, the free precession for τ gathers φ = 2πγBτ, a second π/2 pulse turns φ into a population, P(m_s = 0) = cos²(φ/2). The marker follows the arrow\'s phase; each sequence restarts after one full fringe. Bars: 12 circuits H·RZ(φ)·H run on Qiskit Aer through coda, 4096 shots each (simulated, not a device). No dephasing (T₂*) is modelled.',
      `Spheres: ${DISPLAY.sizeFraction} × the covalent radius by default (C ${rC} Å, N ${rN} Å; Cordero et al. 2008, to confirm against the paywalled article); set the size control to 1 for the full radius. Colours: Jmol CPK for C and N; the spin and the ±1 levels use the CIE colour of 695 nm, the NV fluorescence band edge in palette.json. The heart builds (Omar et al. 2026) use a bias of about 1 mT (ZAQuant, Q.ANT) or none (JGU).`,
    ],
    sources: [Q.diamond.lattice_constant.source, Q.nv.geometry.source, Dvo.source, Gvo.source,
      Q.electron.gyromagnetic_ratio_over_2pi.source, 'data/quantum_circuits.json (coda simulate, Qiskit Aer, 2026-11-15)',
      Q.radii.carbon_sp3.source, Q.cpk_colours?.C?.source, nvPal?.colour?.source].filter(Boolean),
    lean: ['nv_splitting', 'nv_centre', 'nv_zero_field'],
  };

  const controls = [
    { id: 'B', label: 'B along the NV axis', min: 0, max: DISPLAY.bMax, step: 0.01, value: B, unit: 'mT', onInput(v) { B = +v; refreshLevels(); } },
    { id: 'size', label: 'atom size (× covalent radius)', min: 0.2, max: 1, step: 0.05, value: frac, unit: '×',
      onInput(v) { frac = +v; atomMesh.setRadii(radiiFor(frac)); vMesh.scale.setScalar(frac * rC); } },
  ];

  return {
    scene,
    camera: { position: [-1.2, 3.6, 33], target: [-1.2, 0.4, 0], fov: 40 },
    labels, info, readouts, controls,
    update(dt) {
      const step = Math.min(Math.max(dt, 0), 0.1) / DISPLAY.slowdown;   // seconds of spin time this frame
      const fHz = gam * B * 1e6;
      phi += TWO_PI * fHz * step; tauNs += step * 1e9;
      if (phi >= TWO_PI) { phi -= TWO_PI; tauNs = fHz > 0 ? (phi / (TWO_PI * fHz)) * 1e9 : 0; trailPts.length = 0; }
      else if (tauNs >= DISPLAY.tauMaxNs) { phi = 0; tauNs = 0; trailPts.length = 0; }
      setSpin(); pushTrail();
    },
    dispose() { for (const m of instanced) m.dispose?.(); T.dispose(); },
  };
}
