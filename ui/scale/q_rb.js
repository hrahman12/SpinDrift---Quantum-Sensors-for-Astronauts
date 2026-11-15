// Quantum level, brain: one 87Rb atom of the optically pumped magnetometer's vapour, its optical pumping on the D1
// line into the dark state, and the electron polarisation P integrating the dimensionless Bloch equation of
// Sulai et al. (arXiv 1906.03227, Eqs. B1-B2). Constants from data/quantum_constants.json (Steck rev. 2.3.4).
import * as THREE from 'three';
import { theme, cpk, paletteColour, tracker, addLights, makeArrow, polyline, liveLine, circlePoints, cylinderBetween,
  glow, fx, sci, voRow, missingScene, NO_CONSTANTS } from './q_lib.js';

export const DATA = ['quantum_constants', 'physics', 'palette', 'lean_proofs'];
export const LEVEL = { id: 'q_rb', site: 'brain', level: 'quantum', title: '87Rb optical pumping and spin precession', unit: 'nm',
  scaleBar: { length: 0.606, label: '0.606 nm (one Rb atom across, van der Waals)' } };

// Display choices, not physics (stated in the info panel).
export const DISPLAY = {
  blochRadius: 1.25,     // nm of arrow per unit polarisation (|P| = 1 in units of R/Γ′); a polarisation is not a length
  tauPerSecond: 1.2,     // dimensionless time τ advanced per second on screen
  fieldArrowPerUnit: 0.22, // nm of arrow per unit of |w|
  settleTol: 2e-3,       // |P − P*| below this for `settleHold` s restarts the trajectory from P = 0 (pump switched on)
  settleHold: 1.2,
};

// ---------------------------------------------------------------- physics (pure; also used by the self-check)
// dP/dτ = z − P + w × P   (Sulai Eq. B1 with s = z, w = Ω/Γ′, P in units of R/Γ′)
export function blochRHS(P, w) {
  return [-P[0] + (w[1] * P[2] - w[2] * P[1]),
    -P[1] + (w[2] * P[0] - w[0] * P[2]),
    1 - P[2] + (w[0] * P[1] - w[1] * P[0])];
}
// closed-form steady state P* = (z + w × z + (w·z) w) / (1 + |w|²)   (Sulai Eq. B2, sign of Γ′² as in Lean opm_steady_state)
export function steadyState(w) {
  const n2 = w[0] * w[0] + w[1] * w[1] + w[2] * w[2];
  return [(w[1] + w[2] * w[0]) / (1 + n2), (-w[0] + w[1] * w[2]) / (1 + n2), (1 + w[2] * w[2]) / (1 + n2)];
}
export function rk4(P, w, h) {
  const add = (a, b, s) => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
  const k1 = blochRHS(P, w), k2 = blochRHS(add(P, k1, h / 2), w), k3 = blochRHS(add(P, k2, h / 2), w), k4 = blochRHS(add(P, k3, h), w);
  return [0, 1, 2].map((i) => P[i] + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}
const norm = (v) => Math.hypot(v[0], v[1], v[2]);
// physics frame (x, y, z; z = pump axis) -> scene (X, Y up, Z): x -> X, z -> Y, y -> −Z (a proper rotation)
const toScene = (v, s = 1) => new THREE.Vector3(v[0] * s, v[2] * s, -v[1] * s);

export function build(D) {
  const Q = D.quantum_constants;
  if (!Q) return missingScene('⁸⁷Rb optical pumping', NO_CONSTANTS);
  const T = tracker(), th = theme(D), scene = new THREE.Scene();
  scene.background = null;
  addLights(scene, th);
  const rb = Q.rb87, om = Q.opm_model;
  const rAtom = rb.vdw_radius_nm.value;                         // 0.303 nm, Mantina et al. 2009
  LEVEL.scaleBar = { length: 2 * rAtom, label: `${fx(2 * rAtom, 3)} nm (one Rb atom across, van der Waals)` };
  const opm = paletteColour(D, 'opm');
  const colPump = opm?.hex || th.ink;                            // CIE colour of the 795 nm D1 line (palette.json)
  const colRb = cpk(D, 'Rb') || th.muted;
  const RB = DISPLAY.blochRadius;

  // ------------------------------------------------------------ the atom at its van der Waals radius
  const atomMat = T.add(new THREE.MeshStandardMaterial({ color: colRb, transparent: true, opacity: 0.32, roughness: 0.35, depthWrite: false }));
  scene.add(new THREE.Mesh(T.add(new THREE.SphereGeometry(rAtom, 40, 28)), atomMat));
  const rimMat = T.add(new THREE.MeshBasicMaterial({ color: colRb, wireframe: true, transparent: true, opacity: 0.25 }));
  scene.add(new THREE.Mesh(T.add(new THREE.SphereGeometry(rAtom * 1.001, 18, 12)), rimMat));

  // ------------------------------------------------------------ Bloch sphere (display) and axes
  const o = new THREE.Vector3();
  scene.add(polyline(T, circlePoints(o, new THREE.Vector3(0, 1, 0), RB), th.muted, { dashed: true, dash: 0.06, gap: 0.05, opacity: 0.7 }));
  scene.add(polyline(T, circlePoints(o, new THREE.Vector3(0, 0, 1), RB), th.muted, { opacity: 0.45 }));
  scene.add(polyline(T, circlePoints(o, new THREE.Vector3(1, 0, 0), RB), th.muted, { opacity: 0.3 }));
  const shellMat = T.add(new THREE.MeshBasicMaterial({ color: th.ink, transparent: true, opacity: 0.035, depthWrite: false }));
  scene.add(new THREE.Mesh(T.add(new THREE.SphereGeometry(RB, 40, 24)), shellMat));
  for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) scene.add(polyline(T, [toScene(v, -1.3 * RB), toScene(v, 1.3 * RB)], th.muted, { opacity: 0.7 }));
  // the circle of steady states for a field along y (Lean bloch_circle): p_x² + (p_z − ½)² = ¼
  scene.add(polyline(T, circlePoints(toScene([0, 0, 0.5], RB), new THREE.Vector3(0, 0, 1), 0.5 * RB), th.accent, { dashed: true, dash: 0.04, gap: 0.035, opacity: 0.6 }));

  // ------------------------------------------------------------ σ+ pump light along +z (D1, 795 nm)
  const pumpY = -3.15;
  for (const [x, z] of [[-0.55, 0.25], [0, 0], [0.55, -0.25]]) {
    const ar = makeArrow(T, colPump, { shaft: 0.022, head: 0.07, headLen: 0.18, emissive: 0.6 });
    ar.group.position.set(x, pumpY, z); ar.set(new THREE.Vector3(0, 1, 0), 1.05); scene.add(ar.group);
  }
  const ringR = 0.24, arc = Math.PI * 1.65, ringY = pumpY + 0.55;
  const ringGeo = T.add(new THREE.TorusGeometry(ringR, 0.012, 8, 60, arc)); ringGeo.rotateX(-Math.PI / 2);   // positive sense about +y
  const ringMat = T.add(new THREE.MeshBasicMaterial({ color: colPump }));
  const ring = new THREE.Mesh(ringGeo, ringMat); ring.position.set(0, ringY, 0); scene.add(ring);
  const headGeo = T.add(new THREE.ConeGeometry(0.04, 0.11, 14));
  const ringHead = new THREE.Mesh(headGeo, ringMat);
  ringHead.position.set(ringR * Math.cos(arc), ringY, -ringR * Math.sin(arc));
  ringHead.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-Math.sin(arc), 0, -Math.cos(arc)));
  scene.add(ringHead);

  // ------------------------------------------------------------ live vectors: field w, polarisation P, steady state P*
  const wArrow = makeArrow(T, th.muted, { shaft: 0.016, head: 0.05, headLen: 0.13, emissive: 0.1 });
  scene.add(wArrow.group);
  const pArrow = makeArrow(T, th.accent, { shaft: 0.028, head: 0.075, headLen: 0.18, emissive: 0.45 });
  scene.add(pArrow.group);
  const starMat = T.add(new THREE.MeshStandardMaterial({ color: th.ink, emissive: th.ink, emissiveIntensity: 0.6 }));
  const star = new THREE.Mesh(T.add(new THREE.SphereGeometry(0.045, 18, 12)), starMat); scene.add(star);
  const starGlow = glow(T, th.ink, 0.06, { layers: 3, strength: 0.25 }); scene.add(starGlow.group);
  const starLine = liveLine(T, 2, th.ink, { opacity: 0.55 }); scene.add(starLine.line);
  const TRAIL = 600, trail = liveLine(T, TRAIL, th.accent, { vertexColors: true });
  scene.add(trail.line);

  // ------------------------------------------------------------ level diagram: 5²S1/2 and 5²P1/2 hyperfine sublevels
  const xc = -4.5, dx = 0.36, yS1 = -1.75, yS2 = -1.0, yP1 = 1.3, yP2 = 1.75;
  const markGeo = T.add(new THREE.CylinderGeometry(0.016, 0.016, 0.26, 8)); markGeo.rotateZ(Math.PI / 2);
  const gMat = T.add(new THREE.MeshStandardMaterial({ color: th.ink, emissive: th.ink, emissiveIntensity: 0.25 }));
  const eMat = T.add(new THREE.MeshStandardMaterial({ color: th.muted, emissive: th.muted, emissiveIntensity: 0.2 }));
  const darkMat = T.add(new THREE.MeshStandardMaterial({ color: th.accent, emissive: th.accent, emissiveIntensity: 0.7 }));
  const sub = (F, m, y) => new THREE.Vector3(xc + m * dx, y, 0);
  for (const [F, y, mat] of [[1, yS1, gMat], [2, yS2, gMat], [1, yP1, eMat], [2, yP2, eMat]]) {
    for (let m = -F; m <= F; m++) {
      const dark = y === yS2 && m === 2;
      const mk = new THREE.Mesh(markGeo, dark ? darkMat : mat); mk.position.copy(sub(F, m, y)); scene.add(mk);
    }
  }
  const darkGlow = glow(T, th.accent, 0.09, { layers: 4, strength: 0.3 });
  darkGlow.group.position.copy(sub(2, 2, yS2)); scene.add(darkGlow.group);
  // σ+ arrows m_F -> m_F + 1, brightness ∝ |d|² (Steck Tables 15 and 18)
  const strengths = rb.d1_sigma_plus_strengths || [];
  const sMax = Math.max(...strengths.map((s) => s.strength.value), 1e-9);
  for (const s of strengths) {
    const k = s.strength.value / sMax;
    const mat = T.add(new THREE.MeshBasicMaterial({ color: colPump, transparent: true, opacity: 0.18 + 0.72 * k }));
    const a = sub(s.F, s.mF, s.F === 1 ? yS1 : yS2), b = sub(s.Fp, s.mFp, s.Fp === 1 ? yP1 : yP2);
    scene.add(cylinderBetween(T, a.clone().add(new THREE.Vector3(0, 0.02, 0)), b.clone().add(new THREE.Vector3(0, -0.02, 0)), 0.006 + 0.01 * k, mat));
  }
  // broken optical axis between the manifolds
  const axX = xc - 1.15;
  scene.add(polyline(T, [new THREE.Vector3(axX, yS1 - 0.2, 0), new THREE.Vector3(axX, 0.05, 0)], th.muted));
  scene.add(polyline(T, [new THREE.Vector3(axX, 0.05, 0), new THREE.Vector3(axX - 0.08, 0.15, 0), new THREE.Vector3(axX + 0.08, 0.3, 0), new THREE.Vector3(axX - 0.08, 0.45, 0), new THREE.Vector3(axX, 0.55, 0)], th.muted));
  scene.add(polyline(T, [new THREE.Vector3(axX, 0.55, 0), new THREE.Vector3(axX, yP2 + 0.25, 0)], th.muted));

  // ------------------------------------------------------------ state
  let w = [0, 0.6, 0], P = [0, 0, 0], tau = 0, settled = 0, Pstar = steadyState(w);
  const trailPts = [];
  const cA = new THREE.Color(th.accent), cBg = new THREE.Color(th.bg);
  const tmp = new THREE.Vector3();
  const R = {
    px: { label: 'P_x (Sulai\'s probe axis)', value: '', unit: 'R/Γ′', tag: 'calculated', source: 'RK4 of dP/dτ = z − P + w × P (Sulai Eq. B1, dimensionless)' },
    py: { label: 'P_y', value: '', unit: 'R/Γ′', tag: 'calculated', source: 'RK4 of Sulai Eq. B1' },
    pz: { label: 'P_z (along the pump: sets the transmitted light)', value: '', unit: 'R/Γ′', tag: 'calculated', source: 'RK4 of Sulai Eq. B1' },
    star: { label: 'steady state P* = (z + w×z + (w·z)w)/(1 + |w|²)', value: '', unit: 'R/Γ′', tag: 'calculated', source: 'Sulai Eq. B2' },
    dist: { label: '|P − P*| (converging)', value: '', unit: 'R/Γ′', tag: 'calculated', source: '' },
    res: { label: 'self-check |z − P* + w × P*|', value: '', unit: '', tag: 'calculated', source: 'P* put back into Eq. B1' },
    circ: { label: 'Lean bloch_circle check: p_x² + (p_z − ½)² − ¼', value: '', unit: '', tag: 'calculated', source: 'valid for a field along y' },
    tau: { label: 'time since the pump came on, τ', value: '', unit: 'dimensionless', tag: 'calculated', source: `${DISPLAY.tauPerSecond} per second on screen` },
  };
  const readouts = [R.px, R.py, R.pz, R.star, R.dist, R.res, R.circ, R.tau,
    voRow('Rb D1 wavelength (vacuum)', rb.d1_wavelength_vacuum, { value: '794.978 851 156' }),
    voRow('Rb D1 frequency', rb.d1_frequency, { value: '377.107 463 380' }),
    voRow('ground-state hyperfine splitting', rb.ground_hfs_splitting, { value: '6.834 682 610 904 290' }),
    voRow('5²P1/2 hyperfine splitting', rb.p12_hfs_splitting),
    voRow('g_F (F = 2, Steck Fig. 3)', rb.g_F_F2, { value: '+1/2' }), voRow('g_F (F = 1, Steck Fig. 3)', rb.g_F_F1, { value: '−1/2' }),
    voRow('g_F (F = 2) with the nuclear term', rb.g_F_F2_exact), voRow('g_F (F = 1) with the nuclear term', rb.g_F_F1_exact),
    voRow('Zeeman splitting, F = 2 neighbours', rb.zeeman_F2_per_nT), voRow('nuclear spin I', rb.nuclear_spin, { value: '3/2' }),
    voRow('dark state for σ⁺ D1 light', rb.dark_state), voRow('Rb van der Waals radius', rb.vdw_radius),
    voRow('mean atom spacing at 10¹⁴ cm⁻³ (Sulai, 150 °C)', om.mean_atom_spacing)];

  function refreshField() {
    Pstar = steadyState(w);
    const wl = norm(w);
    wArrow.set(toScene(w), DISPLAY.fieldArrowPerUnit * wl);
    star.position.copy(toScene(Pstar, RB)); starGlow.group.position.copy(star.position);
    starLine.pos.set([0, 0, 0, star.position.x, star.position.y, star.position.z]); starLine.set(2);
    R.star.value = `(${fx(Pstar[0])}, ${fx(Pstar[1])}, ${fx(Pstar[2])})`;
    const r = blochRHS(Pstar, w);
    R.res.value = sci(norm(r), 1);
    R.circ.value = Math.abs(w[0]) < 1e-12 && Math.abs(w[2]) < 1e-12 ? sci(Pstar[0] ** 2 + (Pstar[2] - 0.5) ** 2 - 0.25, 1) : 'field not along y';
    settled = 0;
  }
  function restart() { P = [0, 0, 0]; tau = 0; settled = 0; trailPts.length = 0; }
  function draw() {
    const v = toScene(P, RB);
    pArrow.set(v, v.length());
    trailPts.push(v.clone()); while (trailPts.length > TRAIL) trailPts.shift();
    const n = trailPts.length;
    for (let i = 0; i < n; i++) {
      const p = trailPts[i], c = cBg.clone().lerp(cA, 0.25 + 0.75 * ((i + 1) / n));
      trail.pos.set([p.x, p.y, p.z], i * 3); trail.col.set([c.r, c.g, c.b], i * 3);
    }
    trail.set(n);
    R.px.value = fx(P[0]); R.py.value = fx(P[1]); R.pz.value = fx(P[2]);
    tmp.set(P[0] - Pstar[0], P[1] - Pstar[1], P[2] - Pstar[2]);
    R.dist.value = fx(tmp.length(), 4); R.tau.value = fx(tau, 2);
  }
  refreshField(); draw();

  const labels = [
    { position: [rAtom * 0.75, -rAtom * 0.9, 0.2], text: `⁸⁷Rb atom, van der Waals radius ${fx(rAtom, 3)} nm` },
    { position: [1.33 * RB, 0, 0], text: 'x (Sulai\'s probe axis)' },
    { position: [0, 0, -1.33 * RB], text: 'y' },
    { position: [0.05, 1.33 * RB, 0], text: 'z: pump axis' },
    { position: [0.6, pumpY + 0.3, 0], text: 'σ⁺ pump light, Rb D1 794.979 nm (+ħ per photon along z)' },
    { position: [0.6, pumpY - 0.15, 0], text: 'the beam and its wavelength are far larger than this view' },
    { position: [0.55 * RB, 0.95 * RB, 0], text: 'dashed: steady states for a field along y (Lean bloch_circle)' },
    { position: [-2.35, -1.45 * RB, 0], text: 'green: P (live) · white: steady state P* · grey: field w = Ω/Γ′' },
    { position: [xc + 2.4 * dx + 0.1, yS1, 0], text: '5²S1/2 F = 1' },
    { position: [xc + 2.4 * dx + 0.1, yS2, 0], text: 'F = 2' },
    { position: [xc + 2.4 * dx + 0.1, yP1, 0], text: '5²P1/2 F′ = 1' },
    { position: [xc + 2.4 * dx + 0.1, yP2, 0], text: 'F′ = 2' },
    { position: [xc + 2 * dx - 0.1, yS2 - 0.32, 0], text: 'dark state F = 2, m_F = +2' },
    { position: [axX - 0.1, (yS1 + yS2) / 2, 0], text: '6.834 682 611 GHz' },
    { position: [axX - 0.1, (yP1 + yP2) / 2, 0], text: '814.5 MHz' },
    { position: [axX - 0.1, 0.3, 0], text: '377.107 THz (axis broken)' },
    { position: [xc - 2 * dx, yP2 + 0.45, 0], text: 'σ⁺ D1 arrows: Δm_F = +1, brightness ∝ |d|² (Steck Tables 15, 18)' },
    { position: [xc - 2 * dx, yS1 - 0.4, 0], text: 'm_F = −2 … +2 (neighbours split by 35 Hz at 5 nT: not visible)' },
  ];

  const info = {
    title: '⁸⁷Rb: optical pumping into the dark state, and the spin polarisation P',
    lines: [
      `One ⁸⁷Rb atom at its van der Waals radius, ${fx(rAtom, 3)} nm (Mantina et al. 2009). In Sulai et al.'s 150 °C cell the vapour holds 10¹⁴ atoms per cm³, so neighbours are about ${fx(om.mean_atom_spacing.value, 0)} nm apart (n^(−1/3), calculated) and lie far outside this view. QuSpin's QZFM cell also runs at about 150 °C; QuSpin states rubidium but not the isotope, so ⁸⁷Rb constants from Steck (rev. 2.3.4) are shown.`,
      'Optical pumping: circularly polarised σ⁺ light on the Rb D1 line (794.978 851 156 nm in vacuum, Steck Table 4) drives Δm_F = +1 to 5²P1/2, which has only F′ = 1 and 2 (Steck Fig. 3). Spontaneous decay returns the atom to any ground sublevel, so the population piles up in F = 2, m_F = +2, which σ⁺ light cannot excite (no entry in Steck Table 15): the dark, transparent state. Arrow brightness ∝ |d|² from Steck Tables 15 and 18; decay paths are not drawn.',
      'Green arrow: the electron polarisation P integrating dP/dτ = z − P + w × P with RK4, where w = Ω/Γ′ is the field as a Larmor rate over the relaxation-plus-pumping rate Γ′ = Γ + R and P is in units of R/Γ′ (Sulai Eq. B1, rescaled). It starts at P = 0 when the pump comes on and spirals into the closed-form steady state P* (Eq. B2; arXiv v1 prints −Γ′² in P_z, the + sign is the one that solves B1). Once settled it restarts.',
      `Dimensionless: QuSpin does not state the QZFM's Γ′ (its zero-field resonance is "about 30 nT wide", full or half width not stated) and Sulai's B1 does not fix how τ maps to seconds, so w and τ have no SI units. τ runs at ${DISPLAY.tauPerSecond} per second on screen; the Bloch sphere radius stands for |P| = 1 (display). At the QZFM's 5 nT range the F = 2 Zeeman neighbours split by 35 Hz (g_F μB/h = 6.996 Hz/nT, calculated), too small to draw.`,
      'Lean-checked: the transverse-field steady state (opm_steady_state), the circle of steady states for a field along y (bloch_circle) and the half width at w = 1 (opm_half_width). The full three-axis steady state is checked live by putting P* back into the equation (self-check readout) and symbolically in Wolfram Language (quantum_constants.json checks).',
    ],
    sources: [rb.d1_wavelength_vacuum.source, rb.ground_hfs_splitting.source, rb.g_J_ground.source, 'Steck rev. 2.3.4, Tables 15 and 18 (D1 σ⁺ matrix elements), Eq. 23 (g_F)',
      om.bloch_equation.source, om.steady_state.source, om.cell_density.source, rb.vdw_radius.source,
      opm?.colour?.source, Q.cpk_colours?.Rb?.source].filter(Boolean),
    lean: ['opm_steady_state', 'bloch_circle', 'opm_half_width'],
  };

  const mk = (i, id, label) => ({ id, label, min: -5, max: 5, step: 0.05, value: w[i], unit: 'Ω/Γ′',
    onInput(v) { w = w.slice(); w[i] = +v; refreshField(); } });
  const controls = [mk(0, 'wx', 'field w_x (along the probe axis)'), mk(1, 'wy', 'field w_y'), mk(2, 'wz', 'field w_z (along the pump)')];

  return {
    scene,
    camera: { position: [-1.1, 1.4, 11.0], target: [-1.75, -0.55, 0], fov: 40 },
    labels, info, readouts, controls,
    update(dt) {
      const dTau = Math.min(Math.max(dt, 0), 0.1) * DISPLAY.tauPerSecond;
      const nSub = Math.max(1, Math.ceil(dTau / 0.01));
      for (let i = 0; i < nSub; i++) P = rk4(P, w, dTau / nSub);
      tau += dTau;
      tmp.set(P[0] - Pstar[0], P[1] - Pstar[1], P[2] - Pstar[2]);
      settled = tmp.length() < DISPLAY.settleTol ? settled + dt : 0;
      if (settled > DISPLAY.settleHold) restart();
      draw();
    },
    dispose() { T.dispose(); },
  };
}
