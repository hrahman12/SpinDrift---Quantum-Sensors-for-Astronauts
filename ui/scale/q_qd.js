// Quantum level, blood: the quantum-dot renin nanosensor (Long et al., Anal. Chem. 84, 8846, 2012). The paper's abstract
// does not state the dot's material or size, nor the Förster radius R0 or the number of Cy5 per dot, so this scene is
// dimensionless: the FRET geometry is in units of R0 and the particle-in-a-box diagram in units of L0 and E1(L0).
import * as THREE from 'three';
import { theme, tracker, addLights, polyline, liveLine, circlePoints, glow, fx, voRow, missingScene, NO_CONSTANTS,
  unit3, hasView, viewLine, radiationRow, makeArrow, dots, halton, num, plainNum } from './q_lib.js';

export const DATA = ['quantum_constants', 'physics', 'recorded/qd_fret_figshare5468838', 'lean_proofs', 'specs'];
export const LEVEL = { id: 'q_qd', site: 'blood', level: 'quantum', title: 'Quantum-dot exciton and Förster transfer to Cy5',
  unit: 'R₀', dimensionless: true,
  scaleBar: { length: 1, label: '1 R₀ (Förster radius; its value in nm is not stated for this dot, so no SI scale)' } };

// Display choices, not physics (stated in the info panel).
export const DISPLAY = {
  boxWidthPerL0: 1.3,     // scene units of box width per L0 (the box diagram is not on the R0 scale)
  energyPerE1: 0.2,       // scene units of height per E1(L0)
  phaseRatePerE1: 0.8,    // rad per second on screen per E1(L0): Re ψ_n oscillates at E_n/ħ in dimensionless time
  glowGain: 1.6,          // acceptor glow = gain × (share of excitations it receives)
  pulseSpeed: 0.7,        // R0 per second for the transfer pulses
};

// ---------------------------------------------------------------- physics (pure; also used by the self-check)
// FRET-Calc Eq. 3 (Eq. 2 for n = 1): E = n R0^6 / (n R0^6 + r^6), with x = r/R0
export const fretE = (x, n = 1) => n / (n + x ** 6);
// inverse: x = (n (1/E − 1))^(1/6)  (Lean fret_inverse for n = 1)
export const fretInverse = (E, n = 1) => (n * (1 / E - 1)) ** (1 / 6);
// particle in a box (Griffiths Sec. 2.2): E_n / E1(L0) = n^2 / (L/L0)^2; ψ_n(ξ) ∝ sin(n π ξ), ξ = x/L
export const boxLevel = (n, Lrel) => (n * n) / (Lrel * Lrel);
export const boxPsi = (n, xi) => Math.sin(n * Math.PI * xi);
// acceptor directions: the first along +x, the rest spread over the upper hemisphere (illustrative; Eq. 3 needs only r)
export function acceptorDirections(n) {
  const out = [], ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = n === 1 ? 0 : (i / n) * 0.92, r = Math.sqrt(1 - y * y), az = i * ga;
    out.push(new THREE.Vector3(Math.cos(az) * r, y, Math.sin(az) * r));
  }
  return out;
}

// The descent (opts.view given) has no sliders: setEnv sets everything it shows. Without opts: the earlier explorer.
export function build(D, opts = {}) {
  return opts.view === undefined ? buildLegacy(D, opts) : buildDescent(D, opts);
}

function buildLegacy(D, opts = {}) {
  const Q = D.quantum_constants;
  if (!Q) return missingScene('Quantum-dot exciton and Förster transfer', NO_CONSTANTS, ['default']);
  const T = tracker(), th = theme(D), scene = new THREE.Scene();
  scene.background = null;
  addLights(scene, th);
  const ph = D.physics?.qd_fret_vs_distance;
  const rec = D['recorded/qd_fret_figshare5468838'];
  const pts = Q.qd.figshare_points || [];
  const NMAX = 10;

  // ------------------------------------------------------------ Förster transfer (units of R0)
  const donorMat = T.add(new THREE.MeshStandardMaterial({ color: th.ink, emissive: th.ink, emissiveIntensity: 0.5, roughness: 0.3 }));
  const donor = new THREE.Mesh(T.add(new THREE.SphereGeometry(0.08, 28, 18)), donorMat); scene.add(donor);
  const donorGlow = glow(T, th.ink, 0.12, { layers: 4, strength: 0.32 }); scene.add(donorGlow.group);
  const o = new THREE.Vector3();
  for (const nrm of [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)]) {
    scene.add(polyline(T, circlePoints(o, nrm, 1, 120), th.muted, { dashed: true, dash: 0.05, gap: 0.04, opacity: 0.45 }));
  }
  const accGeo = T.add(new THREE.SphereGeometry(0.065, 24, 16));
  const accMat = T.add(new THREE.MeshStandardMaterial({ color: th.accent, emissive: th.accent, emissiveIntensity: 0.45, roughness: 0.35 }));
  const pulseMat = T.add(new THREE.MeshBasicMaterial({ color: th.accent, transparent: true, opacity: 0.8, depthWrite: false }));
  const pulseGeo = T.add(new THREE.SphereGeometry(0.03, 12, 8));
  const acc = [];
  for (let i = 0; i < NMAX; i++) {
    const m = new THREE.Mesh(accGeo, accMat), g = glow(T, th.accent, 0.1, { layers: 3, strength: 0.35 });
    const link = liveLine(T, 2, th.muted, { opacity: 0.55 }), pulse = new THREE.Mesh(pulseGeo, pulseMat.clone());
    T.add(pulse.material);
    scene.add(m, g.group, link.line, pulse);
    acc.push({ m, g, link, pulse, phase: i / NMAX });
  }

  // E(r/R0) chart under the geometry: its x axis is the same r/R0 as the space above it
  const yc = -2.3, Hc = 1.5, xMax = 2.25;
  scene.add(polyline(T, [new THREE.Vector3(0, yc, 0), new THREE.Vector3(xMax, yc, 0)], th.muted));
  scene.add(polyline(T, [new THREE.Vector3(0, yc, 0), new THREE.Vector3(0, yc + Hc + 0.12, 0)], th.muted));
  for (const x of [1, 2]) scene.add(polyline(T, [new THREE.Vector3(x, yc - 0.05, 0), new THREE.Vector3(x, yc + 0.05, 0)], th.muted));
  scene.add(polyline(T, [new THREE.Vector3(0, yc + Hc, 0), new THREE.Vector3(xMax, yc + Hc, 0)], th.muted, { dashed: true, dash: 0.05, gap: 0.04, opacity: 0.6 }));
  scene.add(polyline(T, [new THREE.Vector3(0, yc + 0.5 * Hc, 0), new THREE.Vector3(1, yc + 0.5 * Hc, 0), new THREE.Vector3(1, yc, 0)], th.muted, { dashed: true, dash: 0.04, gap: 0.04, opacity: 0.6 }));
  if (ph?.x?.length) scene.add(polyline(T, ph.x.map((x, i) => new THREE.Vector3(x, yc + ph.y[i] * Hc, 0)), th.ink, { dashed: true, dash: 0.05, gap: 0.035, opacity: 0.8 }));
  const NC = 160, curveN = liveLine(T, NC, th.accent); scene.add(curveN.line);
  const ptMat = T.add(new THREE.MeshStandardMaterial({ color: th.ink, emissive: th.ink, emissiveIntensity: 0.35 }));
  const ptGeo = T.add(new THREE.SphereGeometry(0.035, 14, 10));
  for (const p of pts) {
    const s = new THREE.Mesh(ptGeo, ptMat); s.position.set(p.r_over_R0.value, yc + (p.E.value / 100) * Hc, 0.03); scene.add(s);
  }
  const markMat = T.add(new THREE.MeshStandardMaterial({ color: th.accent, emissive: th.accent, emissiveIntensity: 0.6 }));
  const marker = new THREE.Mesh(T.add(new THREE.SphereGeometry(0.05, 18, 12)), markMat); scene.add(marker);
  const guide = liveLine(T, 2, th.muted, { opacity: 0.5 }); scene.add(guide.line);

  // ------------------------------------------------------------ particle in a box (units of L0 and E1(L0))
  const xa = -3.1, yf = -2.3, wallH = 3.45;
  const wallGeo = T.add(new THREE.BoxGeometry(0.06, wallH, 0.3)); wallGeo.translate(0, wallH / 2, 0);
  const wallMat = T.add(new THREE.MeshStandardMaterial({ color: th.muted, roughness: 0.6, transparent: true, opacity: 0.85 }));
  const wallL = new THREE.Mesh(wallGeo, wallMat), wallR = new THREE.Mesh(wallGeo, wallMat);
  scene.add(wallL, wallR);
  const floor = liveLine(T, 2, th.muted); scene.add(floor.line);
  const NP = 72;
  const lvl = [1, 2, 3].map(() => ({ line: liveLine(T, 2, th.ink), psi: liveLine(T, NP, th.accent) }));
  for (const l of lvl) scene.add(l.line.line, l.psi.line);
  // |ψ1|² as a filled strip on the n = 1 level
  const densGeo = T.add(new THREE.BufferGeometry());
  const densPos = new Float32Array(NP * 2 * 3), idx = [];
  for (let i = 0; i < NP - 1; i++) { const a = 2 * i, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, b, d, c); }
  densGeo.setAttribute('position', new THREE.BufferAttribute(densPos, 3).setUsage(THREE.DynamicDrawUsage)); densGeo.setIndex(idx);
  const densMat = T.add(new THREE.MeshBasicMaterial({ color: th.accent, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
  const dens = new THREE.Mesh(densGeo, densMat); dens.frustumCulled = false; scene.add(dens);

  // ------------------------------------------------------------ state, readouts
  let r = 1, n = 1, Lrel = 1, tPhase = 0, tPulse = 0;
  const dirs = { n: 0, v: [] };
  const R = {
    E: { label: 'transfer efficiency E = nR₀⁶ / (nR₀⁶ + r⁶)', value: '', unit: '', tag: 'calculated', source: 'FRET-Calc Eq. 3 (Eq. 2 for n = 1)' },
    left: { label: 'left to the dot\'s own emission, 1 − E', value: '', unit: '', tag: 'calculated', source: '' },
    per: { label: 'share reaching each Cy5, E/n', value: '', unit: '', tag: 'calculated', source: 'Eq. 3: all n acceptors at one distance r' },
    inv: { label: 'self-check: r/R₀ back from E, (n(1/E − 1))^(1/6)', value: '', unit: 'R₀', tag: 'calculated · Lean fret_inverse (n = 1)', source: '' },
    half: { label: 'E at r = R₀, n = 1', value: fx(fretE(1, 1), 3), unit: '', tag: 'calculated · Lean fret_half', source: 'FRET-Calc Eq. 2' },
    box: { label: 'box levels E₁, E₂, E₃', value: '', unit: 'E₁(L₀)', tag: 'calculated', source: 'Griffiths & Schroeter Sec. 2.2: E_n ∝ n²/L²' },
    gap: { label: 'spacing E₂ − E₁', value: '', unit: 'E₁(L₀)', tag: 'calculated', source: 'no material, so no eV or wavelength' },
  };
  const readouts = [R.E, R.left, R.per, R.inv, R.half, R.box, R.gap,
    ...pts.map((p) => ({ label: `measured E at ${p.pressure_GPa < 0.001 ? '1 atm' : `${p.pressure_GPa} GPa`} → r/R₀ (n = 1)`,
      value: `${fx(p.E.value, 1)} % → ${fx(p.r_over_R0.value, 3)}`, unit: '', tag: 'recorded → calculated',
      source: `${rec?.meta?.paper || 'Li et al., Opt. Express 29, 27171 (2021)'}, Table S1 (CdTe/CdS dots + rhodamine 101, not the renin sensor)` })),
    voRow('dot material and size', Q.qd.dot_material_and_size), voRow('Förster radius R₀ (dot + Cy5)', Q.qd.forster_radius),
    voRow('Cy5 per dot', Q.qd.acceptors_per_dot), voRow('probe', Q.qd.probe)];

  function placeAcceptors() {
    if (dirs.n !== n) { dirs.v = acceptorDirections(n); dirs.n = n; }
    const E = fretE(r, n), share = E / n;
    for (let i = 0; i < NMAX; i++) {
      const a = acc[i], on = i < n;
      a.m.visible = on; a.link.line.visible = on; a.pulse.visible = on;
      if (!on) { a.g.setLevel(0); continue; }
      const p = dirs.v[i].clone().multiplyScalar(r);
      a.m.position.copy(p); a.g.group.position.copy(p); a.g.setLevel(Math.min(1, DISPLAY.glowGain * share));
      a.link.pos.set([0, 0, 0, p.x, p.y, p.z]); a.link.set(2);
      a.pulse.material.opacity = Math.min(0.9, 0.15 + DISPLAY.glowGain * share);
    }
    donorGlow.setLevel(1 - E);
    for (let i = 0; i < NC; i++) { const x = (i / (NC - 1)) * xMax; curveN.pos.set([x, yc + fretE(x, n) * Hc, 0.01], i * 3); }
    curveN.set(NC);
    marker.position.set(r, yc + E * Hc, 0.04);
    guide.pos.set([r, yc + E * Hc, 0, r, 0, 0]); guide.set(2);
    R.E.value = fx(E, 4); R.left.value = fx(1 - E, 4); R.per.value = fx(share, 4); R.inv.value = fx(fretInverse(E, n), 6);
  }
  function placeBox() {
    const Lw = DISPLAY.boxWidthPerL0 * Lrel, xl = xa - Lw / 2, xr = xa + Lw / 2;
    wallL.position.set(xl - 0.03, yf, 0); wallR.position.set(xr + 0.03, yf, 0);
    floor.pos.set([xl, yf, 0, xr, yf, 0]); floor.set(2);
    const E = [1, 2, 3].map((k) => boxLevel(k, Lrel));
    R.box.value = E.map((e) => fx(e, 3)).join(', '); R.gap.value = fx(E[1] - E[0], 3);
    return { Lw, xl, E };
  }
  function drawWaves() {
    const { Lw, xl, E } = placeBox();
    const ys = E.map((e) => yf + DISPLAY.energyPerE1 * e);
    const amp = Math.min(0.17, 0.42 * (ys[1] - ys[0]));
    lvl.forEach((l, k) => {
      l.line.pos.set([xl, ys[k], 0, xl + Lw, ys[k], 0]); l.line.set(2);
      const c = Math.cos(DISPLAY.phaseRatePerE1 * E[k] * tPhase);
      for (let i = 0; i < NP; i++) { const xi = i / (NP - 1); l.psi.pos.set([xl + xi * Lw, ys[k] + amp * boxPsi(k + 1, xi) * c, 0.01], i * 3); }
      l.psi.set(NP);
    });
    for (let i = 0; i < NP; i++) {
      const xi = i / (NP - 1), x = xl + xi * Lw, h = 1.6 * amp * boxPsi(1, xi) ** 2;
      densPos.set([x, ys[0], -0.01, x, ys[0] + h, -0.01], i * 6);
    }
    densGeo.attributes.position.needsUpdate = true;
  }
  placeAcceptors(); drawWaves();

  const labels = [
    { position: [0.1, -0.22, 0], text: 'quantum dot (donor)' },
    { position: [1.08, 0.12, 0], text: 'Cy5 acceptor(s) at r' },
    { position: [0.55, 0.92, 0], text: 'R₀ shell: E = ½ for one acceptor' },
    { position: [0.08, yc + Hc + 0.18, 0], text: 'E' },
    { position: [-0.22, yc + Hc, 0], text: '1' },
    { position: [-0.22, yc + 0.5 * Hc, 0], text: '½' },
    { position: [0.92, yc - 0.2, 0], text: 'r = R₀' },
    { position: [1.95, yc - 0.2, 0], text: '2R₀' },
    { position: [1.15, yc + Hc - 0.25, 0], text: 'green: E for n Cy5 · dashed: n = 1 (physics.json)' },
    { position: [1.15, yc + 0.35, 0], text: 'dots: measured CdTe/CdS → rhodamine 101' },
    { position: [xa - 1.35, yf + wallH + 0.55, 0], text: 'the dot\'s exciton as a particle in a box' },
    { position: [xa - 1.35, yf + wallH + 0.25, 0], text: 'no material or size stated: units L₀ and E₁(L₀)' },
    { position: [xa - 1.35, yf - 0.25, 0], text: 'levels n = 1, 2, 3 · curves Re ψ_n · shaded |ψ₁|²' },
  ];

  const info = {
    title: 'Quantum-dot renin sensor: confinement and Förster transfer (dimensionless)',
    lines: [
      'The renin nanosensor is a streptavidin-coated quantum dot carrying several biotinylated, Cy5-labelled peptides; renin cuts them, Cy5 leaves and the transfer signal drops (Long et al. 2012, abstract). The abstract states neither the dot\'s material nor its size, nor R₀ or the number of Cy5 per dot, so nothing here is in nm or eV.',
      'Left: the exciton as a particle in a one-dimensional box (Griffiths & Schroeter Sec. 2.2): E_n = n²h²/(8mL²), ψ_n ∝ sin(nπx/L). Box width in units of L₀, energies in E₁(L₀): halving L multiplies every level by 4. The curves are Re ψ_n(x, t), each turning at its own E_n/ħ in dimensionless time; the shaded band is the ground-state density |ψ₁|².',
      'Right: Förster transfer from the dot to Cy5, E = nR₀⁶/(nR₀⁶ + r⁶) (FRET-Calc Eqs. 2–3), with every length in units of R₀. The chart below shares the r/R₀ axis with the space above it. Acceptor directions are illustrative (Eq. 3 needs only one distance r); glows scale with the share of excitations each part receives.',
      'Dots on the chart: measured FRET efficiencies of CdTe/CdS quantum dots with rhodamine 101 at five pressures (Li et al., Opt. Express 29, 27171, 2021, Table S1, figshare CC BY 4.0), placed at r/R₀ = (1/E − 1)^(1/6) (Lean fret_inverse). A different dot and dye from the renin sensor: real data, not this sensor.',
      'Colours are theme colours: neither the dot\'s nor Cy5\'s emission wavelength is in palette.json, so no wavelength colour is drawn. The SI scale bar does not apply to this scene (lengths are in R₀).',
    ],
    sources: [Q.qd.fret_eq2.source, Q.qd.fret_eq3.source, Q.qd.particle_in_a_box.source, Q.qd.dot_material_and_size.source,
      rec?.meta?.sources?.[0], rec?.meta?.paper].filter(Boolean),
    lean: ['fret_half', 'fret_one_acceptor', 'fret_inverse'],
  };

  const controls = [
    { id: 'r', label: 'donor–acceptor distance r', min: 0.3, max: 2, step: 0.01, value: r, unit: 'R₀', onInput(v) { r = +v; placeAcceptors(); } },
    { id: 'n', label: 'Cy5 acceptors per dot n (not stated: explorer)', min: 1, max: NMAX, step: 1, value: n, unit: '', onInput(v) { n = Math.round(+v); placeAcceptors(); } },
    { id: 'L', label: 'box length L', min: 0.75, max: 2, step: 0.01, value: Lrel, unit: 'L₀', onInput(v) { Lrel = +v; drawWaves(); } },
  ];

  // ---- the one view: this scene has no SI scale, so the host keeps the camera distance of `camera` (given again here)
  const camera = { position: [-0.6, 0.8, 8.4], target: [-0.9, -0.6, 0], fov: 40 };
  const off = camera.position.map((v, k) => v - camera.target[k]);
  const views = { default: { target: camera.target.slice(), dir: unit3(off), distance: Math.hypot(...off),
    note: 'The particle-in-a-box diagram on the left and the Förster transfer with its E(r/R₀) chart on the right. Lengths are in units of R₀ and L₀, which have no stated value in nm for this dot, so no field of view in metres applies.' } };
  const showLine = viewLine(info, views);
  const setView = (name) => showLine(hasView(views, name) ? name : null);          // the same content in every view
  const setEnv = radiationRow(readouts);                                           // this scene does not read magnetic fields
  if (opts.env) setEnv(opts.env);
  if (opts.view !== undefined) setView(opts.view);

  return {
    scene,
    camera,
    labels, info, readouts, controls, views, setView, setEnv,
    update(dt) {
      const h = Math.min(Math.max(dt, 0), 0.1);
      tPhase += h; tPulse += h;
      drawWaves();
      for (let i = 0; i < n; i++) {
        const a = acc[i], f = ((tPulse * DISPLAY.pulseSpeed) / Math.max(r, 0.3) + a.phase) % 1;
        a.pulse.position.copy(a.m.position).multiplyScalar(f);
      }
    },
    dispose() { T.dispose(); },
  };
}

// ================================================================ the descent (view default): the hop is the star
// setEnv decides the leash: cut only when the renin entered is at or above the sensor's detection limit (Lean's
// qd_blood card); intact below it; "no number yet" when nothing is entered. Time is in units of the dot's lifetime
// τ_D, which is not stated for this sensor, so the timing is illustrative; the dipoles are drawn as excitation
// envelopes, not oscillations, because the light's frequency (the dot's colour) is not stated either.
const QDV = { cycleS: 2.4, cycleTau: 3, driftS: 4, rCut: 2.6, boxW: 0.8, eScale: 0.13, wallH: 2.0, xa: -1.75, yf: 0.25 };
function buildDescent(D, opts) {
  const Q = D.quantum_constants;
  if (!Q) return missingScene('Quantum-dot exciton and Förster transfer', NO_CONSTANTS, ['default']);
  const T = tracker(), th = theme(D), scene = new THREE.Scene();
  scene.background = null;
  addLights(scene, th);
  const ph = D.physics?.qd_fret_vs_distance, rec = D['recorded/qd_fret_figshare5468838'], pts = Q.qd.figshare_points || [];
  const lodVO = D.specs?.qd_renin?.detection_limit;

  // ------------------------------------------------------------ donor, acceptor, leash, dipole envelopes (markers, not sizes)
  const marks = dots(T, 2, 16); marks.pos.set([0, 0, 0, 1, 0, 0]); marks.col.set([...new THREE.Color(th.ink).toArray(), ...new THREE.Color(th.accent).toArray()]); scene.add(marks.points);
  const o = new THREE.Vector3();
  for (const nrm of [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)]) scene.add(polyline(T, circlePoints(o, nrm, 1, 120), th.muted, { dashed: true, dash: 0.05, gap: 0.04, opacity: 0.45 }));
  const leashA = liveLine(T, 2, th.muted, { opacity: 0.8 }), leashB = liveLine(T, 2, th.muted, { opacity: 0.8 }); scene.add(leashA.line, leashB.line);
  const dipD = makeArrow(T, th.ink, { shaft: 0.012, head: 0.04, headLen: 0.08, emissive: 0.5 }), dipD2 = makeArrow(T, th.ink, { shaft: 0.012, head: 0.04, headLen: 0.08, emissive: 0.5 });
  const dipA = makeArrow(T, th.accent, { shaft: 0.012, head: 0.04, headLen: 0.08, emissive: 0.5 }), dipA2 = makeArrow(T, th.accent, { shaft: 0.012, head: 0.04, headLen: 0.08, emissive: 0.5 });
  scene.add(dipD.group, dipD2.group, dipA.group, dipA2.group);
  const hop = dots(T, 1, 8); hop.col.set(new THREE.Color(th.accent).toArray()); scene.add(hop.points);
  const NPH = 30, photons = dots(T, NPH, 6), phAge = new Float32Array(NPH).fill(9), phFrom = new Uint8Array(NPH), phDir = [];
  for (let k = 0; k < NPH; k++) { const a = 2 * Math.PI * halton(k + 1, 2), z = 0.6 * (2 * halton(k + 1, 3) - 1); phDir.push(new THREE.Vector3(Math.cos(a), Math.sin(a), z).normalize()); }
  scene.add(photons.points);

  // ------------------------------------------------------------ E(r/R0) chart below, sharing the r/R0 axis
  const yc = -2.3, Hc = 1.5, xMax = 2.75;
  scene.add(polyline(T, [new THREE.Vector3(0, yc, 0), new THREE.Vector3(xMax, yc, 0)], th.muted));
  scene.add(polyline(T, [new THREE.Vector3(0, yc, 0), new THREE.Vector3(0, yc + Hc + 0.12, 0)], th.muted));
  for (const x of [1, 2]) scene.add(polyline(T, [new THREE.Vector3(x, yc - 0.05, 0), new THREE.Vector3(x, yc + 0.05, 0)], th.muted));
  const curve = []; for (let i = 0; i <= 160; i++) { const x = (i / 160) * xMax; curve.push(new THREE.Vector3(x, yc + fretE(x, 1) * Hc, 0)); }
  scene.add(polyline(T, curve, th.accent));
  if (ph?.x?.length) scene.add(polyline(T, ph.x.filter((x) => x <= xMax).map((x, i) => new THREE.Vector3(x, yc + ph.y[i] * Hc, 0)), th.ink, { dashed: true, dash: 0.05, gap: 0.035, opacity: 0.7 }));
  const ptMat = T.add(new THREE.MeshStandardMaterial({ color: th.ink, emissive: th.ink, emissiveIntensity: 0.35 })), ptGeo = T.add(new THREE.SphereGeometry(0.03, 12, 8));
  for (const p of pts) { const s = new THREE.Mesh(ptGeo, ptMat); s.position.set(p.r_over_R0.value, yc + (p.E.value / 100) * Hc, 0.03); scene.add(s); }
  const marker = dots(T, 1, 10); marker.col.set(new THREE.Color(th.accent).toArray()); scene.add(marker.points);

  // ------------------------------------------------------------ the dot's exciton as a particle in a box (units L0, E1(L0))
  const { boxW, eScale, wallH, xa, yf } = QDV, xl = xa - boxW / 2;
  const wallGeo = T.add(new THREE.BoxGeometry(0.04, wallH, 0.2)); wallGeo.translate(0, wallH / 2, 0);
  const wallMat = T.add(new THREE.MeshStandardMaterial({ color: th.muted, roughness: 0.6, transparent: true, opacity: 0.85 }));
  for (const x of [xl - 0.02, xl + boxW + 0.02]) { const wm = new THREE.Mesh(wallGeo, wallMat); wm.position.set(x, yf, 0); scene.add(wm); }
  scene.add(polyline(T, [new THREE.Vector3(xl, yf, 0), new THREE.Vector3(xl + boxW, yf, 0)], th.muted));
  const NP = 60, psi = [1, 2, 3].map(() => liveLine(T, NP, th.accent)), lev = [1, 2, 3].map(() => liveLine(T, 2, th.ink));
  for (const l of [...psi, ...lev]) scene.add(l.line);

  // ------------------------------------------------------------ labels (static; tagged texts kept)
  const labels = [
    { position: [0.1, -0.22, 0], text: 'quantum dot (donor)' },
    { position: [1.08, 0.14, 0], text: 'Cy5 acceptor(s) at r' },
    { position: [0.45, 0.92, 0], text: 'R₀: half the energy hops' },
    { position: [0.35, 0.12, 0], text: 'leash (renin cuts it)' },
    { position: [0.08, yc + Hc + 0.18, 0], text: 'E' },
    { position: [0.92, yc - 0.2, 0], text: 'r = R₀' },
    { position: [1.95, yc - 0.2, 0], text: '2R₀' },
    { position: [1.0, yc + Hc - 0.15, 0], text: 'energy that hops, E = 1/(1 + (r/R₀)⁶)' },
    { position: [xl - 0.2, yf + wallH + 0.15, 0], text: 'exciton in a box' },
  ];

  // ------------------------------------------------------------ state from setEnv
  let state = 'none', r = 1, rFrom = 1, drift = 1, cyc = 0, cycles = 0, hops = 0, lastHop = false, tPhase = 0;
  const R = {
    renin: { label: 'renin entered', plain: 'Renin entered', value: '—', unit: 'pM', tag: 'user input', source: 'env.inputs.renin_pM' },
    lod: { label: 'the sensor’s detection limit', plain: 'Smallest renin it sees', value: '—', unit: 'pM', tag: lodVO?.tag || '', source: lodVO?.source || 'env.lod_renin_pM (Lean card)' },
    leash: { label: 'the leash', plain: 'Leash', value: '—', unit: '', tag: 'from Lean’s qd_blood card', source: 'cut only when renin ≥ the detection limit (Long et al. 2012: renin cleaves the peptide and Cy5 leaves)' },
    verdict: { label: 'Lean verdict here for the blood sensor', plain: 'Lean says', value: '—', unit: '', tag: 'Lean checker', source: 'verdict qd_blood' },
    E: { label: 'transfer efficiency E = nR₀⁶ / (nR₀⁶ + r⁶), n = 1', plain: 'Energy that hops', value: '—', unit: '', tag: 'calculated', source: 'FRET-Calc Eq. 2 (Lean fret_half at r = R₀)' },
    keep: { label: 'left to the dot’s own glow, 1 − E', plain: 'Dot keeps', value: '—', unit: '', tag: 'calculated', source: 'FRET-Calc Eq. 2' },
    rate: { label: 'hop rate × τ_D = (R₀/r)⁶', plain: 'Hop speed (per lifetime)', value: '—', unit: '', tag: 'calculated', source: 'Förster rate k_T = (1/τ_D)(R₀/r)⁶' },
    count: { label: 'hops counted in the drawn cycles', plain: 'Hops seen', value: '0 of 0', unit: '', tag: 'display', source: 'deterministic Halton choice per cycle; tends to E' },
    r: { label: 'donor-acceptor distance drawn', plain: 'Distance drawn', value: '1', unit: 'R₀', tag: 'display choice', source: 'r = R₀ while intact (the sensor’s r/R₀ is not stated); drifts to 2.6 R₀ once cut' },
    time: { label: 'time unit', plain: 'Time unit', value: 'dot lifetime τ_D (not stated: timing illustrative)', unit: '', tag: 'not stated', source: Q.qd.dot_material_and_size?.source || '' },
    ...Object.fromEntries([['mat', 'dot material and size', Q.qd.dot_material_and_size, 'Dot material and size'], ['R0', 'Förster radius R₀ (dot + Cy5)', Q.qd.forster_radius, 'Förster radius'], ['n', 'Cy5 per dot', Q.qd.acceptors_per_dot, 'Dyes per dot']].map(([k, l, v, p]) => [k, { ...voRow(l, v), plain: p }])),
  };
  const readouts = [R.renin, R.lod, R.leash, R.verdict, R.E, R.keep, R.rate, R.count, R.r, R.time, R.mat, R.R0, R.n,
    ...pts.map((p) => ({ label: `measured E at ${p.pressure_GPa < 0.001 ? '1 atm' : `${p.pressure_GPa} GPa`} → r/R₀`, plain: 'Measured hop (other dots)', value: `${fx(p.E.value, 1)} % → ${fx(p.r_over_R0.value, 3)}`, unit: '', tag: 'recorded → calculated', source: `${rec?.meta?.paper || 'Li et al., Opt. Express 29, 27171 (2021)'}, Table S1 (CdTe/CdS dots + rhodamine 101, not the renin sensor)` }))];
  const VERD = { REQUIREMENTS_MET: 'met', NOT_MET: 'not met', NEED_MORE_INFORMATION: 'needs more information' };
  const rad = radiationRow(readouts);
  function setEnv(env) {
    if (!env || typeof env !== 'object') return;
    rad(env);
    const rn = env.inputs?.renin_pM ?? env.inputs?.renin ?? null;
    const lod = typeof env.lod_renin_pM === 'number' ? env.lod_renin_pM : num(lodVO);
    const renin = typeof rn === 'number' && Number.isFinite(rn) ? rn : null;
    const prev = state;
    state = renin === null ? 'none' : lod !== null && renin >= lod ? 'cut' : 'below';
    R.renin.value = renin === null ? 'no number yet' : plainNum(renin, 4);
    R.lod.value = lod === null ? 'not stated' : plainNum(lod, 4);
    R.leash.value = state === 'cut' ? 'cut: the dye drifts away, the hop stops' : state === 'below' ? 'intact: below what the sensor can see' : 'intact: no renin number yet';
    R.verdict.value = VERD[env.verdicts?.qd_blood] || 'no verdict received';
    if (state === 'cut' && prev !== 'cut') { rFrom = r; drift = 0; }
    if (state !== 'cut') { r = 1; drift = 1; }
    refresh();
  }
  function refresh() {
    const E = fretE(r, 1);
    R.E.value = fx(E, 4); R.keep.value = fx(1 - E, 4); R.rate.value = fx(1 / r ** 6, 4); R.r.value = fx(r, 2);
    marker.pos.set([r, yc + E * Hc, 0.04], 0); marker.flush();
    const cut = state === 'cut', g = 0.08;
    leashA.pos.set([0, 0, 0, cut ? 0.5 - g : r, 0, 0]); leashA.set(2);
    leashB.pos.set(cut ? [0.5 + g, 0, 0, r, 0, 0] : [r, 0, 0, r, 0, 0]); leashB.set(2);
    marks.pos.set([r, 0, 0], 3); marks.flush();
  }
  const views = { default: { target: [0.35, -0.45, 0], dir: unit3([0.04, 0.12, 1]),
    note: 'The hop: energy leaves the dot and arrives at the dye with efficiency E = 1/(1 + (r/R₀)⁶). The white arrows shrink as the dot loses its excitation, the green ones grow as the dye takes it; each cycle ends with light from the dye (a hop) or from the dot. When renin is at or above what the sensor can see, the leash is cut, the dye drifts away and the hop stops. Lengths are in units of R₀ (its value in nm is not stated for this dot).' } };
  const info = {
    title: 'Quantum-dot renin sensor: the hop stops when renin cuts the leash',
    lines: [
      'The renin nanosensor is a quantum dot carrying Cy5-labelled peptide leashes; renin cuts them, Cy5 leaves and the energy transfer drops (Long et al. 2012, abstract). Here the leash is cut only when the renin you entered is at or above the sensor’s detection limit (the same test as Lean’s qd_blood card); below it, or with no number, the leash stays.',
      'Förster transfer: the dot’s excitation hops to the dye at the rate (1/τ_D)(R₀/r)⁶ and the dot keeps it otherwise, so E = 1/(1 + (r/R₀)⁶) (FRET-Calc Eq. 2). The arrows show the share of the excitation each side holds through one cycle (in units of the dot’s lifetime τ_D, not stated: timing illustrative); they are envelopes, not oscillations, because the dot’s and the dye’s colours (their light’s frequency) are not stated. Whether a cycle ends in a hop is chosen by a Halton sequence, so the count of hops tends to E.',
      'Drawn at r = R₀ while intact (E = ½, Lean fret_half): the sensor’s real r/R₀, its R₀ in nm, the dot’s material and size and the number of Cy5 per dot are not in the abstract, so markers stand for the dot and the dye and nothing has a size. Once cut, the dye drifts to 2.6 R₀ (display) and E falls below 1 %.',
      'Left: the dot’s exciton as a particle in a box (Griffiths & Schroeter Sec. 2.2) in units of L₀ and E₁(L₀); each Re ψ_n turns at its own E_n/ħ in dimensionless time. Chart: E against r/R₀, with the measured CdTe/CdS → rhodamine 101 points of Li et al. 2021 (a different dot and dye: real data, not this sensor).',
    ],
    sources: [Q.qd.fret_eq2.source, Q.qd.particle_in_a_box.source, Q.qd.dot_material_and_size.source, lodVO?.source, rec?.meta?.sources?.[0], rec?.meta?.paper].filter(Boolean),
    lean: ['fret_half', 'fret_one_acceptor', 'fret_inverse'],
  };
  const showLine = viewLine(info, views);
  const setView = (name) => showLine(hasView(views, name) ? name : null);
  setEnv(opts.env || {});
  setView(opts.view);
  const UP = new THREE.Vector3(0, 1, 0), DN = new THREE.Vector3(0, -1, 0);

  return {
    scene,
    camera: { position: [0.35 + 0.04 * 8.4, -0.45 + 0.12 * 8.4, 8.4], target: [0.35, -0.45, 0], fov: 40 },
    labels, info, readouts, controls: [], views, setView, setEnv,
    update(dt) {
      const h = Math.min(Math.max(dt, 0), 0.1);
      if (state === 'cut' && drift < 1) { drift = Math.min(1, drift + h / QDV.driftS); r = rFrom + (QDV.rCut - rFrom) * (drift * drift * (3 - 2 * drift)); refresh(); }
      // one excitation cycle: envelopes in units of τ_D
      cyc += h / QDV.cycleS;
      const k = 1 / r ** 6, u = cyc * QDV.cycleTau, pD = Math.exp(-(1 + k) * u), pA = (k / (1 + k)) * (1 - Math.exp(-(1 + k) * u));
      if (cyc >= 1) {
        cyc -= 1; cycles++;
        lastHop = halton(cycles, 3) < fretE(r, 1); if (lastHop) hops++;
        R.count.value = `${hops} of ${cycles}`;
        for (let j = 0; j < NPH; j++) if (phAge[j] > 1.6) { phAge[j] = 0; phFrom[j] = lastHop ? 1 : 0; break; }
      }
      const L = 0.42;
      dipD.group.position.set(0, 0, 0); dipD.set(UP, L * pD); dipD2.group.position.set(0, 0, 0); dipD2.set(DN, L * pD);
      dipA.group.position.set(r, 0, 0); dipA.set(UP, L * pA); dipA2.group.position.set(r, 0, 0); dipA2.set(DN, L * pA);
      marks.alp[0] = 0.35 + 0.65 * pD; marks.alp[1] = (0.35 + 0.65 * Math.min(1, pA * 2)) * (state === 'cut' ? Math.max(0.25, 1 - 0.75 * drift) : 1); marks.flush();
      const hx = Math.min(1, u / 0.8) * r; hop.pos.set([hx, 0.02, 0.02], 0); hop.alp[0] = k > 0.02 && u < 0.8 ? 0.9 : 0; hop.flush();
      for (let j = 0; j < NPH; j++) {
        phAge[j] += h;
        const on = phAge[j] < 1.6, ox = phFrom[j] ? r : 0, rr = 0.1 + 1.3 * phAge[j];
        photons.pos.set([ox + phDir[j].x * rr, phDir[j].y * rr, phDir[j].z * rr], j * 3);
        const c = new THREE.Color(phFrom[j] ? th.accent : th.ink);
        photons.col.set([c.r, c.g, c.b], j * 3); photons.alp[j] = on ? 1 - phAge[j] / 1.6 : 0;
      }
      photons.flush();
      // particle in a box: Re ψ_n turning at E_n/ħ (dimensionless)
      tPhase += h;
      for (let n = 1; n <= 3; n++) {
        const E = boxLevel(n, 1), y = yf + eScale * E, c = Math.cos(DISPLAY.phaseRatePerE1 * E * tPhase), amp = 0.12;
        lev[n - 1].pos.set([xl, y, 0, xl + boxW, y, 0]); lev[n - 1].set(2);
        for (let i = 0; i < NP; i++) { const xi = i / (NP - 1); psi[n - 1].pos.set([xl + xi * boxW, y + amp * boxPsi(n, xi) * c, 0.01], i * 3); }
        psi[n - 1].set(NP);
      }
    },
    dispose() { T.dispose(); },
  };
}
