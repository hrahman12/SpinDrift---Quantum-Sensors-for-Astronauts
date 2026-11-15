// Quantum level, brain: one 87Rb atom of the optically pumped magnetometer's vapour, its optical pumping on the D1
// line into the dark state, and the electron polarisation P integrating the dimensionless Bloch equation of
// Sulai et al. (arXiv 1906.03227, Eqs. B1-B2). Constants from data/quantum_constants.json (Steck rev. 2.3.4).
import * as THREE from 'three';
import { theme, cpk, paletteColour, tracker, addLights, makeArrow, polyline, liveLine, circlePoints, cylinderBetween, halton, dots, timesText, num, plainNum,
  glow, fx, sci, voRow, missingScene, NO_CONSTANTS, unit3, hasView, viewLine, placeText } from './q_lib.js';

export const DATA = ['quantum_constants', 'physics', 'palette', 'lean_proofs', 'specs'];
export const LEVEL = { id: 'q_rb', site: 'brain', level: 'quantum', title: '87Rb optical pumping and spin precession', unit: 'nm',
  scaleBar: { length: 0.606, label: '0.606 nm (one Rb atom across, van der Waals)' } };

// Display choices, not physics (stated in the info panel).
export const DISPLAY = {
  blochRadius: 1.25,     // nm of arrow per unit polarisation (|P| = 1 in units of R/Γ′); a polarisation is not a length
  tauPerSecond: 1.2,     // dimensionless time τ advanced per second on screen
  fieldArrowPerUnit: 0.22, // nm of arrow per unit of |w|
  settleTol: 2e-3,       // |P − P*| below this for `settleHold` s restarts the trajectory from P = 0 (pump switched on)
  settleHold: 1.2,
  blochScale: { gas: 1, atom: 0.8, spin: 0.16 },   // the Bloch-sphere drawing is shrunk to fit the 2.50 nm and 500 pm views
  wMax: 5,               // range of the field controls; a place's field is clipped to it
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

// The descent (opts.view given) has no sliders: the place and the four numbers (setEnv) set everything it shows.
// Without opts the scene is the earlier explorer, unchanged.
export function build(D, opts = {}) {
  return opts.view === undefined ? buildLegacy(D, opts) : buildDescent(D, opts);
}

function buildLegacy(D, opts = {}) {
  const Q = D.quantum_constants;
  if (!Q) return missingScene('⁸⁷Rb optical pumping', NO_CONSTANTS, ['gas', 'atom', 'spin']);
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
  const rim = new THREE.Mesh(T.add(new THREE.SphereGeometry(rAtom * 1.001, 18, 12)), rimMat);
  scene.add(rim);

  // ------------------------------------------------------------ Bloch sphere (display) and axes
  // Everything that draws the polarisation sits in one group, so a view can shrink the whole drawing (DISPLAY.blochScale).
  const bloch = new THREE.Group();
  scene.add(bloch);
  const o = new THREE.Vector3();
  bloch.add(polyline(T, circlePoints(o, new THREE.Vector3(0, 1, 0), RB), th.muted, { dashed: true, dash: 0.06, gap: 0.05, opacity: 0.7 }));
  bloch.add(polyline(T, circlePoints(o, new THREE.Vector3(0, 0, 1), RB), th.muted, { opacity: 0.45 }));
  bloch.add(polyline(T, circlePoints(o, new THREE.Vector3(1, 0, 0), RB), th.muted, { opacity: 0.3 }));
  const shellMat = T.add(new THREE.MeshBasicMaterial({ color: th.ink, transparent: true, opacity: 0.035, depthWrite: false }));
  bloch.add(new THREE.Mesh(T.add(new THREE.SphereGeometry(RB, 40, 24)), shellMat));
  for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) bloch.add(polyline(T, [toScene(v, -1.3 * RB), toScene(v, 1.3 * RB)], th.muted, { opacity: 0.7 }));
  // the circle of steady states for a field along y (Lean bloch_circle): p_x² + (p_z − ½)² = ¼
  bloch.add(polyline(T, circlePoints(toScene([0, 0, 0.5], RB), new THREE.Vector3(0, 0, 1), 0.5 * RB), th.accent, { dashed: true, dash: 0.04, gap: 0.035, opacity: 0.6 }));

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
  // the same light drawn once more beside the atom, for the 2.50 nm view (the beam is far wider than any of these views)
  const nearPump = new THREE.Group();
  nearPump.visible = false; scene.add(nearPump);
  for (const x of [-1.45, 1.45]) {
    const ar = makeArrow(T, colPump, { shaft: 0.014, head: 0.045, headLen: 0.12, emissive: 0.6 });
    ar.group.position.set(x, -1.2, 0); ar.set(new THREE.Vector3(0, 1, 0), 0.5); nearPump.add(ar.group);
  }

  // ------------------------------------------------------------ live vectors: field w, polarisation P, steady state P*
  const wArrow = makeArrow(T, th.muted, { shaft: 0.016, head: 0.05, headLen: 0.13, emissive: 0.1 });
  bloch.add(wArrow.group);
  const pArrow = makeArrow(T, th.accent, { shaft: 0.028, head: 0.075, headLen: 0.18, emissive: 0.45 });
  bloch.add(pArrow.group);
  const starMat = T.add(new THREE.MeshStandardMaterial({ color: th.ink, emissive: th.ink, emissiveIntensity: 0.6 }));
  const star = new THREE.Mesh(T.add(new THREE.SphereGeometry(0.045, 18, 12)), starMat); bloch.add(star);
  const starGlow = glow(T, th.ink, 0.06, { layers: 3, strength: 0.25 }); bloch.add(starGlow.group);
  const starLine = liveLine(T, 2, th.ink, { opacity: 0.55 }); bloch.add(starLine.line);
  const TRAIL = 600, trail = liveLine(T, TRAIL, th.accent, { vertexColors: true });
  bloch.add(trail.line);

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
  if (opts.view !== undefined) {
    // in the views the legend sits at the foot of the arrows, inside the 2.50 nm and 500 pm frames
    const legend = labels.find((l) => l.text.startsWith('green: P'));
    if (legend) legend.position = [0.03, 0.05, 0.02];
    labels.push({ position: [3.4, 2.9, 0], text: `the next atom is about ${fx(om.mean_atom_spacing.value, 0)} nm away on average (not drawn)` });
    labels.push({ position: [1.5, -0.98, 0], text: 'the same pump light, drawn again beside the atom (the beam is far wider than this view)' });
  }

  const info = {
    title: '⁸⁷Rb: optical pumping into the dark state, and the spin polarisation P',
    lines: [
      `One ⁸⁷Rb atom at its van der Waals radius, ${fx(rAtom, 3)} nm (Mantina et al. 2009). In Sulai et al.'s 150 °C cell the vapour holds 10¹⁴ atoms per cm³, so neighbours are about ${fx(om.mean_atom_spacing.value, 0)} nm apart (n^(−1/3), calculated) and lie far outside this view. QuSpin's QZFM cell also runs at about 150 °C; QuSpin states rubidium but not the isotope, so ⁸⁷Rb constants from Steck (rev. 2.3.4) are shown.`,
      'Optical pumping: circularly polarised σ⁺ light on the Rb D1 line (794.978 851 156 nm in vacuum, Steck Table 4) drives Δm_F = +1 to 5²P1/2, which has only F′ = 1 and 2 (Steck Fig. 3). Spontaneous decay returns the atom to any ground sublevel, so the population piles up in F = 2, m_F = +2, which σ⁺ light cannot excite (no entry in Steck Table 15): the dark, transparent state. Arrow brightness ∝ |d|² from Steck Tables 15 and 18; decay paths are not drawn.',
      'Green arrow: the electron polarisation P integrating dP/dτ = z − P + w × P with RK4, where w = Ω/Γ′ is the field as a Larmor rate over the relaxation-plus-pumping rate Γ′ = Γ + R and P is in units of R/Γ′ (Sulai Eq. B1, rescaled). It starts at P = 0 when the pump comes on and spirals into the closed-form steady state P* (Eq. B2; arXiv v1 prints −Γ′² in P_z, the + sign is the one that solves B1). Once settled it restarts.',
      `Dimensionless: QuSpin does not state the QZFM's Γ′ (its zero-field resonance is "about 30 nT wide", full or half width not stated) and Sulai's B1 does not fix how τ maps to seconds, so w and τ have no SI units. τ runs at ${DISPLAY.tauPerSecond} per second on screen; the Bloch sphere radius stands for |P| = 1 (display). At the QZFM's 5 nT range the F = 2 Zeeman neighbours split by 35 Hz (g_F μB/h = 6.996 Hz/nT, calculated), too small to draw.`,
      'Lean-checked: the transverse-field steady state (opm_steady_state), the circle of steady states for a field along y (bloch_circle) and the half width at w = 1 (opm_half_width). The full three-axis steady state is checked live by putting P* back into the equation (self-check readout) and symbolically in Wolfram Language (quantum_constants.json checks).',
      'When a place is chosen, the field at the sensor (the place\'s background field divided by your shield) is put on w_y, across the pump and the probe; its real direction at the sensor is not known. It is divided by QuSpin\'s stated resonance width, "about 30 nT wide" (to confirm: QuSpin does not say whether that is the full or the half width, so the ratio could be twice as large), and clipped to the control range; the readout says when it is clipped. If that width were missing from /data the sensor\'s verified ±5 nT working range would be the scale, and the row would say so. The verdict row repeats what the Lean checker decided for this place.',
    ],
    sources: [rb.d1_wavelength_vacuum.source, rb.ground_hfs_splitting.source, rb.g_J_ground.source, 'Steck rev. 2.3.4, Tables 15 and 18 (D1 σ⁺ matrix elements), Eq. 23 (g_F)',
      om.bloch_equation.source, om.steady_state.source, om.cell_density.source, rb.vdw_radius.source,
      opm?.colour?.source, Q.cpk_colours?.Rb?.source].filter(Boolean),
    lean: ['opm_steady_state', 'bloch_circle', 'opm_half_width'],
  };

  const WMAX = DISPLAY.wMax;
  const mk = (i, id, label) => { const c = { id, label, min: -WMAX, max: WMAX, step: 0.05, value: w[i], unit: 'Ω/Γ′',
    onInput(v) { w = w.slice(); w[i] = +v; c.value = w[i]; refreshField(); } }; return c; };
  // w_y first: it is the field across both the pump and the probe (the Lean theorems' case) and the one a place drives
  const controls = [mk(1, 'wy', 'field w_y (across the pump and the probe)'), mk(0, 'wx', 'field w_x (along the probe axis)'), mk(2, 'wz', 'field w_z (along the pump)')];

  // ------------------------------------------------------------ views: one scene, three distances
  const spacing = om.mean_atom_spacing.value;
  const views = {
    gas: { target: [-1.75, -0.55, 0], dir: unit3([0.65, 1.95, 11.0]),
      note: `One ⁸⁷Rb atom (${fx(2 * rAtom, 3)} nm across, van der Waals) in the vapour, with the pump light below it and its level diagram on the left. The mean spacing of the atoms is ${fx(spacing, 1)} nm (n^(−1/3) at Sulai's 10¹⁴ cm⁻³, calculated in quantum_constants.json), ${fx(spacing / 10, 1)} times the height of a 10.0 nm view, so no neighbour is in the frame.` },
    atom: { target: [0, 0, 0], dir: unit3([0.65, 1.95, 11.0]),
      note: `The atom at its van der Waals radius, ${fx(rAtom, 3)} nm, inside the drawing of its spin polarisation. For this view the Bloch sphere is drawn ${fx(RB * DISPLAY.blochScale.atom, 2)} nm in radius, which stands for |P| = 1 (a display scale, not a size).` },
    spin: { target: [0, 0, 0], dir: unit3([0.65, 1.95, 11.0]),
      note: `The spin polarisation P (green arrow), the steady state P* it settles into (white dot) and the field w (grey arrow). A 500 pm view is smaller than the atom (${fx(2000 * rAtom, 0)} pm across), so the frame lies inside the atom's van der Waals sphere, which is drawn fainter here. The Bloch sphere is drawn ${fx(1000 * RB * DISPLAY.blochScale.spin, 0)} pm in radius for |P| = 1 (a display scale).` },
  };
  const showLine = viewLine(info, views);
  function setView(name) {
    const named = hasView(views, name);
    bloch.scale.setScalar(named ? DISPLAY.blochScale[name] : 1);
    atomMat.opacity = name === 'spin' ? 0.14 : 0.32;
    rim.visible = name !== 'spin';
    nearPump.visible = named;
    showLine(named ? name : null);
  }

  // ------------------------------------------------------------ the chosen place: the field at the sensor drives w_y
  // The model needs the field in units of the resonance's half width. /data holds QuSpin's "about 30 nT wide" (to
  // confirm; full or half width not stated); without it the sensor's verified ±5 nT working range is the scale.
  const num1 = (vo) => { const m = String(vo?.value ?? '').match(/\d+(?:\.\d+)?/); return m ? +m[0] : null; };
  const widthVO = (D.physics?.opm_zero_field?.inputs || []).find((x) => x?.unit === 'nT' && /wide|width/i.test(x.note || '') && num1(x) > 0) || null;
  const rangeVO = D.specs?.opm?.dynamic_range || null;
  const scaleNT = widthVO ? num1(widthVO) : (rangeVO && num1(rangeVO) > 0 ? num1(rangeVO) : null);
  const toConfirm = (vo) => (vo?.status && vo.status !== 'VERIFIED' ? `, ${String(vo.status).toLowerCase().replace(/_/g, ' ')}` : '');
  const EV = {
    field: { label: 'this place: field at the sensor (background ÷ shield)', value: '—', unit: '', tag: '', source: '' },
    ratio: { label: widthVO ? `field at the sensor ÷ the zero-field resonance width (QuSpin: about ${scaleNT} nT wide${toConfirm(widthVO)}; full or half width not stated)`
      : 'field at the sensor ÷ the sensor\'s working range', value: '—', unit: '', tag: `calculated${toConfirm(widthVO)}`, source: (widthVO || rangeVO)?.source || '' },
    alt: { label: `the same ratio if the ${scaleNT} nT is the full width (half width ${scaleNT / 2} nT)`, value: '—', unit: '', tag: `calculated${toConfirm(widthVO)}`, source: 'twice the row above' },
    shown: { label: 'field shown in the scene, w_y', value: '—', unit: 'Ω/Γ′', tag: 'display', source: `clipped to the control range ±${WMAX}; drawn along y, across the pump and the probe (the direction of the place's field at the sensor is not known)` },
    left: { label: 'polarisation left along the pump at that ratio, 1/(1 + w²), before clipping', value: '—', unit: '', tag: `calculated${toConfirm(widthVO)}`, source: 'Sulai Eq. B2 for a field across the pump (Lean opm_steady_state), reading the stated width as the half width' },
    verdict: { label: 'Lean verdict here for the brain sensor', value: '—', unit: '', tag: 'Lean checker', source: 'verdict opm_brain, decided by the Lean checker from this place and your inputs' },
  };
  const VERDICT = { REQUIREMENTS_MET: 'requirements met: the spins can settle along the pump', NOT_MET: 'NOT MET: the spins cannot settle',
    NEED_MORE_INFORMATION: 'need more information: Lean will not decide without it' };
  function setEnv(env) {
    if (!env || typeof env !== 'object') return;
    // the working range is not a half width, so the two rows that need one appear only with the width from /data
    if (readouts.indexOf(EV.field) < 0) readouts.unshift(...[EV.verdict, EV.field, EV.ratio, widthVO ? EV.alt : null, EV.shown, widthVO ? EV.left : null].filter(Boolean));
    const v = env.verdicts?.opm_brain;
    EV.verdict.value = VERDICT[v] || 'no verdict received';
    EV.verdict.source = v === 'NOT_MET'
      ? 'verdict opm_brain from the Lean checker: the field at the sensor is more than the sensor can work in, so the spins keep turning about the field faster than the pump lines them up'
      : 'verdict opm_brain, decided by the Lean checker from this place and your inputs';
    const Bs = typeof env.B_at_sensor_nT === 'number' && Number.isFinite(env.B_at_sensor_nT) ? env.B_at_sensor_nT : null;
    const shield = typeof env.shielding_factor === 'number' && env.shielding_factor > 0 ? env.shielding_factor : null;
    const status = env.B_status && env.B_status !== 'VERIFIED' ? String(env.B_status).toLowerCase().replace(/_/g, ' ') : null;
    EV.field.tag = [env.B_tag, status].filter(Boolean).join(' · ');
    EV.field.source = [placeText(env), typeof env.B_nT === 'number' ? `${env.B_nT.toLocaleString('en-US', { maximumFractionDigits: 3 })} nT${shield ? ` ÷ ${shield.toLocaleString('en-US')}` : ''}` : null, env.B_source].filter(Boolean).join(' · ');
    if (Bs === null || !scaleNT) {
      EV.field.value = Bs === null ? 'not known for this place' : `${Bs.toLocaleString('en-US', { maximumSignificantDigits: 6 })} nT`;
      EV.ratio.value = EV.alt.value = EV.left.value = '—';
      EV.shown.value = `${fx(w[1], 3)} (the control's value; no field to put in)`;
      return;                                                    // the scene keeps the field it had
    }
    const raw = Bs / scaleNT, clipped = Math.max(-WMAX, Math.min(WMAX, raw)), isClipped = clipped !== raw;
    const big = (x) => (Math.abs(x) >= 1000 ? Math.round(x).toLocaleString('en-US') : fx(x, 3));
    EV.field.value = `${Bs.toLocaleString('en-US', { maximumSignificantDigits: 6 })} nT`;
    EV.ratio.value = big(raw); EV.alt.value = big(2 * raw);
    EV.shown.value = isClipped ? `${fx(clipped, 2)} (clipped from ${big(raw)})` : fx(clipped, 3);
    EV.left.value = sci(1 / (1 + raw * raw), 2);
    w = [0, clipped, 0];
    controls[0].value = clipped; controls[1].value = 0; controls[2].value = 0;
    refreshField();
  }
  if (opts.env) setEnv(opts.env);
  if (opts.view !== undefined) setView(opts.view);

  return {
    scene,
    camera: { position: [-1.1, 1.4, 11.0], target: [-1.75, -0.55, 0], fov: 40 },
    labels, info, readouts, controls, views, setView, setEnv,
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

// ================================================================ the descent: gas (10 nm), atom (2.50 nm), spin (500 pm)
// Angular-momentum algebra for the D1 line (Steck Eqs. 35-36): relative line strengths from Wigner 3-j and 6-j symbols.
// The sigma+ values are checked against Steck's Tables 15 and 18 (quantum_constants.json) in the scene.
const fact = (n) => { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
const rnd0 = (x) => Math.round(x);
export function w3j(j1, j2, j3, m1, m2, m3) {
  if (Math.abs(m1 + m2 + m3) > 1e-9 || j3 < Math.abs(j1 - j2) - 1e-9 || j3 > j1 + j2 + 1e-9) return 0;
  if (Math.abs(m1) > j1 + 1e-9 || Math.abs(m2) > j2 + 1e-9 || Math.abs(m3) > j3 + 1e-9) return 0;
  const tri = fact(rnd0(j1 + j2 - j3)) * fact(rnd0(j1 - j2 + j3)) * fact(rnd0(-j1 + j2 + j3)) / fact(rnd0(j1 + j2 + j3 + 1));
  const pre = Math.sqrt(tri * fact(rnd0(j1 + m1)) * fact(rnd0(j1 - m1)) * fact(rnd0(j2 + m2)) * fact(rnd0(j2 - m2)) * fact(rnd0(j3 + m3)) * fact(rnd0(j3 - m3)));
  let s = 0;
  const k0 = Math.max(0, rnd0(j2 - j3 - m1), rnd0(j1 - j3 + m2)), k1 = Math.min(rnd0(j1 + j2 - j3), rnd0(j1 - m1), rnd0(j2 + m2));
  for (let k = k0; k <= k1; k++) {
    s += (k % 2 ? -1 : 1) / (fact(k) * fact(rnd0(j1 + j2 - j3 - k)) * fact(rnd0(j1 - m1 - k)) * fact(rnd0(j2 + m2 - k)) * fact(rnd0(j3 - j2 + m1 + k)) * fact(rnd0(j3 - j1 - m2 + k)));
  }
  return (rnd0(j1 - j2 - m3) % 2 ? -1 : 1) * pre * s;
}
export function w6j(j1, j2, j3, j4, j5, j6) {
  for (const [a, b, c] of [[j1, j2, j3], [j1, j5, j6], [j4, j2, j6], [j4, j5, j3]]) {
    if (c < Math.abs(a - b) - 1e-9 || c > a + b + 1e-9 || Math.abs(a + b + c - Math.round(a + b + c)) > 1e-9) return 0;
  }
  const del = (a, b, c) => Math.sqrt(fact(rnd0(a + b - c)) * fact(rnd0(a - b + c)) * fact(rnd0(-a + b + c)) / fact(rnd0(a + b + c + 1)));
  const a1 = rnd0(j1 + j2 + j3), a2 = rnd0(j1 + j5 + j6), a3 = rnd0(j4 + j2 + j6), a4 = rnd0(j4 + j5 + j3);
  const b1 = rnd0(j1 + j2 + j4 + j5), b2 = rnd0(j2 + j3 + j5 + j6), b3 = rnd0(j3 + j1 + j6 + j4);
  let s = 0;
  for (let t = Math.max(a1, a2, a3, a4); t <= Math.min(b1, b2, b3); t++) {
    s += (t % 2 ? -1 : 1) * fact(t + 1) / (fact(t - a1) * fact(t - a2) * fact(t - a3) * fact(t - a4) * fact(b1 - t) * fact(b2 - t) * fact(b3 - t));
  }
  return del(j1, j2, j3) * del(j1, j5, j6) * del(j4, j2, j6) * del(j4, j5, j3) * s;
}
// |<F mF| e r_q |F' mF'>|^2 in units of |<J||er||J'>|^2 (Steck Eqs. 35-36); D1: J = J' = 1/2, I = 3/2
export function d1Strength(F, m, Fp, mp, I = 1.5, J = 0.5, Jp = 0.5) {
  const q = m - mp;
  if (Math.abs(q) > 1) return 0;
  const s6 = w6j(J, Jp, 1, Fp, F, I), s3 = w3j(Fp, 1, F, mp, q, -m);
  return (2 * F + 1) * (2 * Fp + 1) * (2 * J + 1) * s6 * s6 * s3 * s3;
}
// optical pumping with sigma+ light and no field (rate equations, excited state eliminated): 8 ground sublevels
export function pumpModel() {
  const G = [], E = [];
  for (const F of [1, 2]) for (let m = -F; m <= F; m++) G.push({ F, m });
  for (const F of [1, 2]) for (let m = -F; m <= F; m++) E.push({ F, m });
  const A = G.map((g) => E.map((e) => (e.m === g.m + 1 ? d1Strength(g.F, g.m, e.F, e.m) : 0)));
  const Bd = E.map((e) => { const s = G.map((g) => d1Strength(g.F, g.m, e.F, e.m)); const t = s.reduce((a, b) => a + b, 0); return s.map((x) => x / t); });
  const amax = Math.max(...A.map((r) => r.reduce((a, b) => a + b, 0)));
  const out = A.map((r) => r.reduce((a, b) => a + b, 0) / amax);
  const M = G.map((_, i) => G.map((__, k) => A[i].reduce((s, a, j) => s + a * Bd[j][k], 0) / amax));
  const dark = G.findIndex((g) => g.F === 2 && g.m === 2);
  return { G, out, M, dark, step(p, h) {
    const d = new Float64Array(p.length);
    for (let i = 0; i < p.length; i++) { d[i] -= out[i] * p[i]; for (let k = 0; k < p.length; k++) d[k] += M[i][k] * p[i]; }
    for (let i = 0; i < p.length; i++) p[i] += h * d[i];
  } };
}
// inverse CDF of the Gamma(2, 1) distribution (lifetimes whose ages, at any instant, follow e^-a)
const gamma2q = (u) => { let x = 1.68; for (let k = 0; k < 40; k++) { const f = 1 - (1 + x) * Math.exp(-x) - u, df = x * Math.exp(-x); x = Math.max(1e-6, x - f / df); } return x; };
// rotate v about the unit axis k by angle a (right-handed), in place
function rotAbout(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a), kd = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const x = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  for (let i = 0; i < 3; i++) v[i] = v[i] * c + x[i] * s + k[i] * kd * (1 - c);
  return v;
}

function buildDescent(D, opts) {
  const Q = D.quantum_constants;
  if (!Q) return missingScene('⁸⁷Rb optical pumping', NO_CONSTANTS, ['gas', 'atom', 'spin']);
  const T = tracker(), th = theme(D), scene = new THREE.Scene();
  scene.background = null;
  addLights(scene, th);
  const rb = Q.rb87, om = Q.opm_model, cod = Q.codata || {};
  const rAtom = num(rb.vdw_radius_nm);
  LEVEL.scaleBar = { length: 2 * rAtom, label: `${fx(2 * rAtom, 3)} nm (one Rb atom across, van der Waals)` };
  const colPump = paletteColour(D, 'opm')?.hex || th.ink;
  const hwhm = num(om.zero_field_hwhm), fL1 = num(rb.zeeman_F2_per_nT);                  // nT, Hz per nT (F = 2)
  const compVO = D.specs?.opm?.field_compensation_max, comp = num(compVO);               // nT the coils cancel
  const rangeVO = D.specs?.opm?.dynamic_range;
  const gammaP = hwhm && fL1 ? 2 * Math.PI * fL1 * hwhm : null;                          // s^-1, Γ' = γ ΔB (calculated)
  const spacing = num(om.mean_atom_spacing), vbar = num(rb.thermal_mean_speed);
  const SPEED_UP = 1.0;                                    // the faster of turning and pumping is shown at 1 turn per second
  const VIEW_SCALE = { gas: 1.2, atom: 0.75, spin: 0.17 }; // nm of drawing per unit polarisation, per view

  // ------------------------------------------------------------ the 5s valence electron as a cloud of points
  const nStar = num(rb.valence_n_star), a0 = num(cod.bohr_radius) ? num(cod.bohr_radius) * 1e9 : null;   // nm
  const NCLOUD = 4200;
  let cloud = null;
  if (nStar && a0) {
    const rMax = 40 * a0, NG = 4000, cdf = new Float64Array(NG + 1);
    for (let i = 1; i <= NG; i++) { const r = (i / NG) * rMax; cdf[i] = cdf[i - 1] + r ** (2 * nStar) * Math.exp(-2 * r / (nStar * a0)); }
    for (let i = 1; i <= NG; i++) cdf[i] /= cdf[NG];
    cloud = dots(T, NCLOUD, 2.2);
    const ink = new THREE.Color(th.ink);
    for (let k = 0; k < NCLOUD; k++) {
      const u = halton(k + 1, 2); let lo = 0, hi = NG;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cdf[m] < u) lo = m; else hi = m; }
      const r = (hi / NG) * rMax, ct = 2 * halton(k + 1, 3) - 1, st = Math.sqrt(1 - ct * ct), ph = 2 * Math.PI * halton(k + 1, 5);
      cloud.pos.set([r * st * Math.cos(ph), r * ct, r * st * Math.sin(ph)], k * 3);
      cloud.col.set([ink.r, ink.g, ink.b], k * 3); cloud.alp[k] = 0.42;
    }
    cloud.flush(); scene.add(cloud.points);
  }
  // the nucleus: 8.4 fm across, far too small to see; a marker only
  const nuc = dots(T, 1, 5); nuc.col.set(new THREE.Color(th.accent).toArray()); nuc.flush(); scene.add(nuc.points);

  // ------------------------------------------------------------ spins of 40 atoms (state diagram drawn from one point)
  // Each atom is lined up along the pump (z) when the light pumps it, then turns about the field until it is pumped
  // again. Ages since the last pumping follow e^-a (renewal with Gamma(2) lifetimes): their average is Sulai's P*.
  const K = 40, life = [], off = [];
  for (let k = 0; k < K; k++) { life.push(gamma2q((k + 0.5) / K)); off.push(halton(k + 1, 2)); }
  const spins = new THREE.Group(); scene.add(spins);
  const sGeo = T.add(new THREE.BufferGeometry()); const sPos = new Float32Array(K * 6);
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage));
  const sLines = new THREE.LineSegments(sGeo, T.add(new THREE.LineBasicMaterial({ color: th.ink, transparent: true, opacity: 0.55 })));
  sLines.frustumCulled = false; spins.add(sLines);
  const tips = dots(T, K, 4); spins.add(tips.points);
  const mean = makeArrow(T, th.accent, { shaft: 0.028, head: 0.075, headLen: 0.18, emissive: 0.45 }); spins.add(mean.group);
  const star = dots(T, 1, 7); star.col.set(new THREE.Color(th.ink).toArray()); spins.add(star.points);
  spins.add(polyline(T, [new THREE.Vector3(0, -1.25, 0), new THREE.Vector3(0, 1.25, 0)], th.muted, { opacity: 0.6 }));
  const wArrow = makeArrow(T, th.muted, { shaft: 0.014, head: 0.045, headLen: 0.12, emissive: 0.1 }); spins.add(wArrow.group);

  // ------------------------------------------------------------ the pump light: rays moving up, brightness = light let through
  const NR = 26, rays = new THREE.Group(); scene.add(rays);
  const rGeo = T.add(new THREE.BufferGeometry()); const rPos = new Float32Array(NR * 6), rCol = new Float32Array(NR * 6);
  rGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3).setUsage(THREE.DynamicDrawUsage));
  rGeo.setAttribute('color', new THREE.BufferAttribute(rCol, 3).setUsage(THREE.DynamicDrawUsage));
  const rLines = new THREE.LineSegments(rGeo, T.add(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false })));
  rLines.frustumCulled = false; rays.add(rLines);
  const rayX = Array.from({ length: NR }, (_, k) => -1.7 + 3.4 * halton(k + 1, 2)), rayP = Array.from({ length: NR }, (_, k) => halton(k + 1, 3));
  const pumpC = new THREE.Color(colPump);

  // ------------------------------------------------------------ gas view only: levels with populations, resonance curve
  const gasOnly = new THREE.Group(); scene.add(gasOnly);
  const xc = -3.25, dx = 0.3, yS1 = -1.9, yS2 = -1.0, yP1 = 1.5, yP2 = 1.95;
  const markGeo = T.add(new THREE.CylinderGeometry(0.014, 0.014, 0.22, 8)); markGeo.rotateZ(Math.PI / 2);
  const gMat = T.add(new THREE.MeshStandardMaterial({ color: th.ink, emissive: th.ink, emissiveIntensity: 0.25 }));
  const eMat = T.add(new THREE.MeshStandardMaterial({ color: th.muted, emissive: th.muted, emissiveIntensity: 0.2 }));
  const sub = (F, m, y) => new THREE.Vector3(xc + m * dx, y, 0);
  for (const [F, y, mat] of [[1, yS1, gMat], [2, yS2, gMat], [1, yP1, eMat], [2, yP2, eMat]]) {
    for (let m = -F; m <= F; m++) { const mk = new THREE.Mesh(markGeo, mat); mk.position.copy(sub(F, m, y)); gasOnly.add(mk); }
  }
  for (const s of rb.d1_sigma_plus_strengths || []) {
    const k = s.strength.value / 0.5;
    const mat = T.add(new THREE.MeshBasicMaterial({ color: colPump, transparent: true, opacity: 0.15 + 0.6 * k }));
    const a = sub(s.F, s.mF, s.F === 1 ? yS1 : yS2), b = sub(s.Fp, s.mFp, s.Fp === 1 ? yP1 : yP2);
    gasOnly.add(cylinderBetween(T, a.clone().add(new THREE.Vector3(0, 0.02, 0)), b.clone().add(new THREE.Vector3(0, -0.02, 0)), 0.005 + 0.008 * k, mat));
  }
  // population bars on the 8 ground sublevels (rate equations with no field; pump rate illustrative)
  const pm = pumpModel(), pop = new Float64Array(pm.G.length).fill(1 / pm.G.length);
  const barGeo = T.add(new THREE.BoxGeometry(0.16, 1, 0.04)); barGeo.translate(0, 0.5, 0);
  const barMat = T.add(new THREE.MeshStandardMaterial({ color: th.accent, emissive: th.accent, emissiveIntensity: 0.35 }));
  const BAR_H = 0.62;
  const bars = pm.G.map((g) => { const b = new THREE.Mesh(barGeo, barMat); b.position.copy(sub(g.F, g.m, g.F === 1 ? yS1 : yS2)).add(new THREE.Vector3(0, 0.03, 0)); gasOnly.add(b); return b; });
  // self-check: the sigma+ strengths from the 3-j and 6-j symbols against Steck's tables
  let worstS = 0;
  for (const s of rb.d1_sigma_plus_strengths || []) worstS = Math.max(worstS, Math.abs(d1Strength(s.F, s.mF, s.Fp, s.mFp) - s.strength.value));
  // the zero-field resonance: light let through against the field left at the atoms (Lorentzian, half width from /data)
  const cx0 = 2.0, cW = 1.55, cy0 = -0.55, cH = 1.35, Bspan = 5 * (hwhm || 15);
  const cX = (B) => cx0 + ((B + Bspan) / (2 * Bspan)) * cW;
  if (hwhm) {
    const curve = [];
    for (let i = 0; i <= 160; i++) { const B = -Bspan + (2 * Bspan * i) / 160; curve.push(new THREE.Vector3(cX(B), cy0 + cH / (1 + (B / hwhm) ** 2), 0)); }
    gasOnly.add(polyline(T, curve, th.ink));
    gasOnly.add(polyline(T, [new THREE.Vector3(cx0, cy0, 0), new THREE.Vector3(cx0 + cW, cy0, 0)], th.muted));
    gasOnly.add(polyline(T, [new THREE.Vector3(cX(0), cy0, 0), new THREE.Vector3(cX(0), cy0 + cH + 0.1, 0)], th.muted, { dashed: true, dash: 0.05, gap: 0.04, opacity: 0.6 }));
    const r5 = num(rangeVO) ?? (rangeVO?.value ? Math.abs(parseFloat(String(rangeVO.value).replace('±', ''))) : null);
    if (r5) for (const s of [-1, 1]) gasOnly.add(polyline(T, [new THREE.Vector3(cX(s * r5), cy0, 0), new THREE.Vector3(cX(s * r5), cy0 + cH, 0)], th.accent, { dashed: true, dash: 0.04, gap: 0.04, opacity: 0.55 }));
  }
  const here = dots(T, 1, 9); here.col.set(new THREE.Color(th.accent).toArray()); gasOnly.add(here.points);
  const offChart = makeArrow(T, th.accent, { shaft: 0.012, head: 0.04, headLen: 0.1, emissive: 0.5 }); gasOnly.add(offChart.group);

  // ------------------------------------------------------------ labels (static; texts the host tags are kept)
  const labels = [
    { position: [rAtom * 0.7, -rAtom * 0.9, 0.1], text: `⁸⁷Rb atom, van der Waals radius ${fx(rAtom, 3)} nm` },
    { position: [0.3, -3.55, 0], text: 'σ⁺ pump light, Rb D1 794.979 nm (+ħ per photon along z)' },
    { position: [0.3, -3.95, 0], text: 'the beam and its wavelength are far larger than this view' },
    { position: [0.55, -0.85, 0], text: 'pump light (σ⁺, 795 nm)' },
    { position: [0.03, 0.05, 0.02], text: 'green: P (live) · white: steady state P* · grey: field w = Ω/Γ′' },
    { position: [0.24, 0.24, 0.1], text: '5s electron cloud' },
    { position: [-0.11, -0.06, 0], text: 'nucleus' },
    { position: [xc + 2.4 * dx + 0.1, yS1, 0], text: '5²S1/2 F = 1' },
    { position: [xc + 2.4 * dx + 0.1, yS2, 0], text: 'F = 2' },
    { position: [xc + 2.4 * dx + 0.1, yP1, 0], text: '5²P1/2 F′ = 1' },
    { position: [xc + 2.4 * dx + 0.1, yP2, 0], text: 'F′ = 2' },
    { position: [xc + 2 * dx - 0.1, yS2 + BAR_H + 0.12, 0], text: 'dark state F = 2, m_F = +2' },
    { position: [xc - 2 * dx - 0.2, (yS1 + yS2) / 2, 0], text: '6.834 GHz' },
    { position: [xc - 2 * dx, yP2 + 0.4, 0], text: 'bars: atoms per level (no field)' },
    { position: [cx0, cy0 + cH + 0.3, 0], text: 'light through the cell' },
    { position: [cx0 + 0.3, cy0 - 0.25, 0], text: 'field at the atoms' },
    { position: [cx0 + 0.02, cy0 - 0.5, 0], text: `−${fx(Bspan, 0)} nT` },
    { position: [cx0 + cW - 0.35, cy0 - 0.5, 0], text: `+${fx(Bspan, 0)} nT` },
    { position: [3.3, 3.3, 0], text: spacing ? `next atom: about ${fx(spacing, 0)} nm away` : 'next atom: far away' },
  ];

  // ------------------------------------------------------------ state from the place (setEnv)
  let w = [0, 0, 0], wMag = 0, Batoms = null, slow = gammaP ? gammaP / (2 * Math.PI) / SPEED_UP : 1, tau = 0, through = 1;
  let popHold = 0;
  const VERDICT = { REQUIREMENTS_MET: 'met: the spins can line up', NOT_MET: 'not met: the spins cannot settle',
    NEED_MORE_INFORMATION: 'needs more information' };
  const R = {
    verdict: { label: 'Lean verdict here for the brain sensor', plain: 'Lean says', value: '—', unit: '', tag: 'Lean checker', source: 'verdict opm_brain from the Lean checker for this place and your numbers' },
    sensor: { label: 'field at the sensor (background ÷ shield)', plain: 'Field at the sensor', value: '—', unit: 'nT', tag: '', source: '' },
    comp: { label: 'the sensor’s coils cancel up to', plain: 'Its coils cancel up to', value: comp ?? 'not stated', unit: comp ? 'nT' : '', tag: compVO?.tag || '', source: compVO?.source || '' },
    atoms: { label: 'field left at the atoms, max(0, field − coil limit)', plain: 'Field left at the atoms', value: '—', unit: 'nT', tag: 'calculated', source: 'perfect nulling up to the coil limit assumed; drawn across the pump (the real direction is not known)' },
    ratio: { label: 'field at the atoms ÷ resonance half width (w)', plain: 'Field ÷ resonance width', value: '—', unit: '', tag: 'calculated', source: `half width ${hwhm} nT = FWHM / 2; ${om.zero_field_fwhm?.source || ''}` },
    lined: { label: 'spin polarisation along the pump, P_z* = 1/(1 + w²)', plain: 'Spins lined up', value: '—', unit: '', tag: 'calculated', source: 'Sulai Eq. B2, field across the pump (Lean opm_steady_state)' },
    light: { label: 'light let through, above its unpumped level (zero-field resonance)', plain: 'Light let through', value: '—', unit: '', tag: 'calculated', source: `Lorentzian 1/(1 + (B/ΔB)²) (physics.json opm_zero_field); QuSpin: “${om.transparency?.value || ''}”` },
    larmor: { label: 'Larmor frequency at the atoms (free ⁸⁷Rb, F = 2)', plain: 'Spin turns per second', value: '—', unit: 'Hz', tag: 'calculated', source: `${fx(fL1, 4)} Hz/nT × field (g_F μB/h, Steck Eq. 23 with CODATA)` },
    larmorS: { label: 'Larmor frequency if the coils were off', plain: 'Turns per second, coils off', value: '—', unit: 'Hz', tag: 'calculated', source: `${fx(fL1, 4)} Hz/nT × field at the sensor` },
    pumpRate: { label: 'pumping and relaxation rate Γ′ = 2π × (Hz/nT) × half width', plain: 'How fast light lines them up', value: gammaP ? fx(gammaP, 0) : '—', unit: 's⁻¹', tag: 'calculated', source: 'with the free-atom F = 2 rate; in the dense vapour spin-exchange slows the precession by a factor not in /data' },
    slow: { label: 'spins shown slowed by', plain: 'Shown slowed by', value: '—', unit: '×', tag: 'display choice', source: 'the faster of turning and pumping is shown at 1 turn per second' },
    avg: { label: 'average of the 40 drawn spins, along the pump (compare P_z*)', plain: 'Drawn spins lined up', value: '—', unit: '', tag: 'calculated', source: 'deterministic renewal ages; a finite sample of 40' },
    dark: { label: 'atoms in F = 2, m_F = +2 while pumping with no field (rate equations)', plain: 'Atoms in the dark state', value: '—', unit: '%', tag: 'calculated', source: `Steck Eqs. 35-36 line strengths (against Tables 15 and 18: largest difference ${worstS.toExponential(1)}); both ground levels pumped equally; buffer-gas collisions not modelled; pump rate illustrative` },
  };
  const readouts = [R.verdict, R.sensor, R.comp, R.atoms, R.ratio, R.lined, R.light, R.larmor, R.larmorS, R.pumpRate, R.slow, R.avg, R.dark,
    { ...voRow('mean speed of an atom in the 150 °C gas', rb.thermal_mean_speed, { value: vbar ? fx(vbar, 0) : undefined }), plain: 'Atom speed in the hot gas' },
    { ...voRow('mean atom spacing at 10¹⁴ cm⁻³ (Sulai, 150 °C)', om.mean_atom_spacing, { value: spacing ? fx(spacing, 1) : undefined }), plain: 'Distance to the next atom' },
    { ...voRow('5s electron: most probable radius (Coulomb approximation)', rb.valence_r_most_probable, { value: num(rb.valence_r_most_probable) ? fx(num(rb.valence_r_most_probable), 3) : undefined }), plain: 'Electron cloud size' },
    { ...voRow('Rb D1 wavelength (vacuum)', rb.d1_wavelength_vacuum, { value: '794.978 851 156' }), plain: 'Laser wavelength' },
    { ...voRow('ground-state hyperfine splitting', rb.ground_hfs_splitting, { value: '6.834 682 610 904 290' }), plain: 'Gap between F = 1 and F = 2' },
    { ...voRow('zero-field resonance width (FWHM)', om.zero_field_fwhm), plain: 'Resonance width' },
    { ...voRow('sensor working range', rangeVO), plain: 'Sensor range' }];

  const views = {
    gas: { target: [-0.2, -0.35, 0], dir: unit3([0.06, 0.18, 1]),
      note: `One ⁸⁷Rb atom of the vapour: its 5s electron cloud (most probable radius ${fx(num(rb.valence_r_most_probable) || 0, 3)} nm), the pump light, the levels it pumps (left) and the zero-field resonance (right). The next atom is about ${fx(spacing || 0, 0)} nm away (10¹⁴ atoms per cm³ at 150 °C), so the gas is mostly empty space.` },
    atom: { target: [0, 0, 0], dir: unit3([0.06, 0.18, 1]),
      note: 'The atom: its valence electron cloud, the nucleus at the centre (far too small to see: a dot marks it) and the spins of 40 atoms of the cell drawn from one point. Each spin is set along the light when its atom is pumped, then turns about the field left at the atoms until it is pumped again; the green arrow is their average.' },
    spin: { target: [0, 0, 0], dir: unit3([0.06, 0.18, 1]),
      note: 'Inside the electron cloud: the spins of the 40 atoms and their average (green). With a small field at the atoms they all point along the light (lined up: the cell is transparent); with a large field they turn round many times between pumpings and point every way (scrambled: the light is absorbed).' },
  };
  const info = {
    title: '⁸⁷Rb: the spins line up only when the field at the atoms is small',
    lines: [
      'Circularly polarised light on the Rb D1 line (794.979 nm, Steck Table 4) pumps the atoms into F = 2, m_F = +2, which this light cannot excite: the atoms stop absorbing and the cell turns transparent. The bars show that pumping with no field, from rate equations with Steck’s line strengths (Eqs. 35-36, checked against Tables 15 and 18); both ground levels are pumped equally, buffer-gas collisions are left out and the pump rate is illustrative.',
      `A field across the light turns each pumped spin at the Larmor frequency (${fx(fL1, 3)} Hz per nT for a free ⁸⁷Rb atom in F = 2) until the light pumps it again. The 40 thin lines are 40 atoms of the cell at their ages since their last pumping (a deterministic sample of the e^-a age distribution); their average is Sulai’s steady state P* = (z + w × z + (w·z)w)/(1 + |w|²) with w = field ÷ ${hwhm} nT, the half width of QuSpin’s “FWHM ≈ 30 nT” zero-field resonance. The light let through follows the same 1/(1 + w²).`,
      `The place sets the field: the background field divided by your shield is the field at the sensor, and QuSpin’s on-board coils cancel up to ${comp ?? '?'} nT, so the atoms see what is left above that (perfect nulling assumed, drawn across the pump). Lean’s card checks the same limit. Below it the spins stay lined up; above it they scramble and the light dims.`,
      `Timing: the faster of turning and pumping is shown at one turn per second, so the slow-down factor changes with the field (readout). Γ′ = 2π × ${fx(fL1, 3)} Hz/nT × ${hwhm} nT uses the free-atom rate; in the dense vapour spin-exchange collisions slow the precession by a factor that is not in /data. The electron cloud is the outer part of the 5s orbital in the Coulomb approximation (Bates & Damgaard 1949) with n* = ${fx(nStar || 0, 4)} from Steck’s ionization limit; the 36 core electrons are not drawn, and the cloud does not move: it is a stationary state.`,
      vbar ? `The atom flies at about ${fx(vbar, 0)} m/s on average (150 °C, Steck’s mass) and changes direction at each collision with the buffer gas; the view rides with it.` : '',
    ].filter(Boolean),
    sources: [rb.d1_wavelength_vacuum.source, 'Steck rev. 2.3.4, Eqs. 35-36, Tables 15 and 18', om.steady_state.source, om.zero_field_fwhm?.source,
      compVO?.source, rb.valence_density_model?.source, rb.ionization_limit?.source, cod.bohr_radius?.source].filter(Boolean),
    lean: ['opm_steady_state', 'bloch_circle', 'opm_half_width'],
  };
  const showLine = viewLine(info, views);

  function setEnv(env) {
    if (!env || typeof env !== 'object') return;
    const v = env.verdicts?.opm_brain;
    R.verdict.value = VERDICT[v] || 'no verdict received';
    const Bs = typeof env.B_at_sensor_nT === 'number' && Number.isFinite(env.B_at_sensor_nT) ? Math.abs(env.B_at_sensor_nT) : null;
    const status = env.B_status && env.B_status !== 'VERIFIED' ? String(env.B_status).toLowerCase().replace(/_/g, ' ') : null;
    const shield = env.shielding_factor ?? env.inputs?.shielding_factor ?? 1;
    R.sensor.tag = [env.B_tag, status].filter(Boolean).join(' · ');
    R.sensor.source = [placeText(env), typeof env.B_nT === 'number' && Number.isFinite(env.B_nT) ? `${env.B_nT.toLocaleString('en-US', { maximumFractionDigits: 3 })} nT ÷ shield ${shield}` : null, env.B_source].filter(Boolean).join(' · ');
    Batoms = Bs === null ? null : comp !== null ? Math.max(0, Bs - comp) : Bs;
    R.sensor.value = Bs === null ? 'not known here' : plainNum(Bs, 4);
    R.atoms.value = Batoms === null ? '—' : plainNum(Batoms, 4);
    if (Batoms === null || !hwhm) {
      w = [0, 0, 0]; wMag = 0; through = 1;
      for (const r of [R.ratio, R.lined, R.light, R.larmor, R.larmorS]) r.value = '—';
    } else {
      wMag = Batoms / hwhm; w = [0, wMag, 0];                 // across the pump and the probe (physics y)
      const pz = 1 / (1 + wMag * wMag); through = pz;
      R.ratio.value = plainNum(wMag, 3); R.lined.value = pz < 1e-3 ? sci(pz, 1) : fx(pz, 3); R.light.value = R.lined.value;
      R.larmor.value = plainNum(fL1 * Batoms, 4); R.larmorS.value = plainNum(fL1 * Bs, 4);
    }
    const fFast = Math.max(fL1 && Batoms ? fL1 * Batoms : 0, gammaP ? gammaP / (2 * Math.PI) : 1);
    slow = fFast / SPEED_UP;
    R.slow.value = timesText(slow);
    if (hwhm && Batoms !== null) {
      const Bc = Math.min(Batoms, Bspan * 0.999);
      here.pos.set([cX(Bc), cy0 + cH / (1 + (Bc / hwhm) ** 2), 0.02], 0); here.alp[0] = 1;
      offChart.group.position.set(cx0 + cW + 0.05, cy0 + 0.05, 0);
      offChart.set(new THREE.Vector3(1, 0, 0), Batoms > Bspan ? 0.32 : 0);
    } else { here.alp[0] = 0; offChart.set(new THREE.Vector3(1, 0, 0), 0); }
    here.flush();
  }
  function setView(name) {
    const named = hasView(views, name), s = VIEW_SCALE[named ? name : 'gas'];
    spins.scale.setScalar(s); rays.scale.setScalar(s / VIEW_SCALE.gas);
    gasOnly.visible = !named || name === 'gas';
    if (cloud) { cloud.alp.fill(name === 'spin' ? 0.22 : 0.42); cloud.flush(); }
    showLine(named ? name : null);
  }

  const v3 = [0, 0, 0], tmp = new THREE.Vector3();
  function drawSpins() {
    const k = wMag > 0 ? [w[0] / wMag, w[1] / wMag, w[2] / wMag] : null;
    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < K; i++) {
      const age = (tau + off[i] * life[i]) % life[i];
      v3[0] = 0; v3[1] = 0; v3[2] = 1;
      if (k) rotAbout(v3, k, wMag * age);
      mx += v3[0]; my += v3[1]; mz += v3[2];
      const X = v3[0], Y = v3[2], Z = -v3[1];                 // physics (z = pump) -> scene (Y up)
      sPos.set([0, 0, 0, X, Y, Z], i * 6); tips.pos.set([X, Y, Z], i * 3); tips.alp[i] = 0.9;
    }
    sGeo.attributes.position.needsUpdate = true; tips.flush();
    mx /= K; my /= K; mz /= K;
    tmp.set(mx, mz, -my); mean.set(tmp, tmp.length());
    const n2 = wMag * wMag, ps = [(w[1] + w[2] * w[0]) / (1 + n2), (-w[0] + w[1] * w[2]) / (1 + n2), (1 + w[2] * w[2]) / (1 + n2)];
    star.pos.set([ps[0], ps[2], -ps[1]], 0); star.flush();
    wArrow.set(new THREE.Vector3(w[0], w[2], -w[1]), wMag > 0 ? 0.35 : 0);
    R.avg.value = fx(mz, 3);
  }
  setEnv(opts.env || {});
  setView(opts.view);
  drawSpins();

  return {
    scene,
    camera: { position: [-0.2 + 0.06 * 13.7, -0.35 + 0.18 * 13.7, 13.7], target: [-0.2, -0.35, 0], fov: 40 },
    labels, info, readouts, controls: [], views, setView, setEnv,
    update(dt) {
      const h = Math.min(Math.max(dt, 0), 0.1);
      if (gammaP) tau += (h * gammaP) / slow;                // τ = Γ' t; real time = screen time ÷ slow-down
      drawSpins();
      // light rays move up; their brightness above a 0.15 floor (display) is the light let through
      const lvl = 0.15 + 0.85 * through;
      for (let i = 0; i < NR; i++) {
        rayP[i] = (rayP[i] + h * 0.45) % 1;
        const y = -4.6 + 9.2 * rayP[i], x = rayX[i], f = Math.min(1, rayP[i] * 6, (1 - rayP[i]) * 6) * lvl;
        rPos.set([x, y, -0.3, x, y + 0.55, -0.3], i * 6);
        rCol.set([pumpC.r * f, pumpC.g * f, pumpC.b * f, pumpC.r * f, pumpC.g * f, pumpC.b * f], i * 6);
      }
      rGeo.attributes.position.needsUpdate = true; rGeo.attributes.color.needsUpdate = true;
      // zero-field pumping of the populations (restarts once nearly all atoms sit in the dark state)
      for (let s = 0; s < 4; s++) pm.step(pop, (h * 0.7) / 4);
      if (pop[pm.dark] > 0.985) { popHold += h; if (popHold > 1.6) { pop.fill(1 / pop.length); popHold = 0; } }
      bars.forEach((b, i) => b.scale.set(1, Math.max(1e-3, pop[i] * BAR_H), 1));
      R.dark.value = fx(100 * pop[pm.dark], 1);
    },
    dispose() { T.dispose(); },
  };
}
