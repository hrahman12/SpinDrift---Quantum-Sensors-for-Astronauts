// Quantum level, deepest: the nucleus of the atom each magnetic sensor reads. Load as q_nucleus.js?id=rb87 (brain: the
// rubidium atom of the optically pumped magnetometer) or q_nucleus.js?id=n14 (heart: the nitrogen of the NV centre).
// ONE sphere is drawn, at the measured root-mean-square charge radius (Angeli & Marinova 2013, read from the IAEA
// nuclear charge radii database by scripts/build_quantum_constants.py). Protons and neutrons are not drawn one by one:
// their arrangement inside a nucleus is not a measured geometry. Scene units: femtometres.
import * as THREE from 'three';
import { theme, cpk, tracker, addLights, makeArrow, polyline, circlePoints, fx, voRow, missingScene, unit3, hasView, viewLine,
  num, plainNum, timesText, placeText } from './q_lib.js';

const ASKED = new URL(import.meta.url).searchParams.get('id') || 'rb87';
const NUCLIDES = {
  rb87: { site: 'brain', title: 'Rubidium-87 nucleus', symbol: '⁸⁷Rb', element: 'Rb', atom: 'the rubidium atom of the brain sensor' },
  n14: { site: 'heart', title: 'Nitrogen-14 nucleus', symbol: '¹⁴N', element: 'N', atom: 'the nitrogen atom of the diamond\'s NV centre' },
};
const ID = NUCLIDES[ASKED] ? ASKED : null, WHAT = NUCLIDES[ID] || { site: 'brain', title: `Nucleus "${ASKED}"`, symbol: ASKED, element: null, atom: '' };

export const DATA = ['quantum_constants', 'specs'];
export const LEVEL = { id: `q_nucleus_${ID || 'unknown'}`, site: WHAT.site, level: 'quantum', title: WHAT.title, unit: 'fm',
  scaleBar: { length: 1, label: '1 fm' } };

// Display choices, not physics (stated in the info panel).
export const DISPLAY = {
  arrowPerHbar: 2.6,       // fm of arrow per ħ of nuclear spin (a spin is not a length)
  slow: { rb87: 1e5, n14: 100 },   // the real Larmor rate is shown this many times slower (printed in the readouts)
  opacity: 0.62,           // the sphere is see-through so that the arrow inside it shows
};
const spinText = (i) => (Number.isInteger(i) ? String(i) : `${Math.round(2 * i)}/2`);

export function build(D, opts = {}) {
  const Q = D.quantum_constants, n = ID ? Q?.nuclei?.[ID] : null, Rvo = n?.rms_charge_radius;
  if (!Q || !n || Rvo?.status !== 'VERIFIED' || !(Rvo.value > 0)) {
    const why = !ID ? `There is no nucleus with the id "${ASKED}" here (the ids are rb87 and n14).`
      : !Q ? 'data/quantum_constants.json did not load.'
        : `The measured charge radius of ${WHAT.symbol} is not in data/quantum_constants.json as a fetched and verified value${Rvo?.note ? ` (${Rvo.note})` : ''}.`;
    const fix = ID ? ' Run python scripts/build_quantum_constants.py with a network connection: it reads the radius from the IAEA nuclear charge radii database and checks it.' : '';
    return missingScene(WHAT.title, `${why} Nothing is drawn at a guessed size.${fix}`, ['nucleus']);
  }
  const T = tracker(), th = theme(D), scene = new THREE.Scene();
  scene.background = null;
  addLights(scene, th);

  // ------------------------------------------------------------ inputs (all from quantum_constants.json)
  const R = Rvo.value, dR = n.rms_charge_radius_uncertainty?.value ?? null;                 // fm
  const Z = n.protons?.value, N = n.neutrons?.value, A = n.mass_number?.value;
  const I = n.nuclear_spin?.value ?? null, tilt = n.spin_tilt?.value ?? null, sLen = n.spin_length?.value ?? null;
  const hf = n.hyperfine || {};
  const col = cpk(D, WHAT.element) || th.muted;                                             // Jmol CPK colour of the element (a display convention)
  LEVEL.scaleBar = { length: R, label: `${R} fm (rms charge radius)` };

  // ------------------------------------------------------------ the one sphere, at the rms charge radius
  const ballMat = T.add(new THREE.MeshStandardMaterial({ color: col, roughness: 0.4, metalness: 0, transparent: true, opacity: DISPLAY.opacity, depthWrite: false }));
  scene.add(new THREE.Mesh(T.add(new THREE.SphereGeometry(R, 64, 40)), ballMat));
  // a measuring line from the centre to the surface
  const rEnd = new THREE.Vector3(Math.cos(-0.5), Math.sin(-0.5), 0).multiplyScalar(R);
  scene.add(polyline(T, [new THREE.Vector3(), rEnd], th.ink, { opacity: 0.9 }));

  // ------------------------------------------------------------ the nuclear spin: vector model of the state m_I = I
  const arrow = makeArrow(T, th.accent, { shaft: 0.07, head: 0.2, headLen: 0.55, emissive: 0.5 });
  const haveSpin = I > 0 && tilt !== null && sLen > 0;
  const L = haveSpin ? DISPLAY.arrowPerHbar * sLen : 0, t0 = haveSpin ? THREE.MathUtils.degToRad(tilt) : 0;
  const top = Math.max(R, L * Math.cos(t0)) + 0.55;
  if (haveSpin) {
    scene.add(arrow.group);
    scene.add(polyline(T, [new THREE.Vector3(0, -top, 0), new THREE.Vector3(0, top, 0)], th.muted, { opacity: 0.7 }));
    // the vector model: one cone for each allowed orientation m_I = -I ... +I (the drawn state is m_I = +I)
    for (let m = -I; m <= I + 1e-9; m += 1) {
      const c = m / Math.sqrt(I * (I + 1)), rr = L * Math.sqrt(Math.max(0, 1 - c * c));
      scene.add(polyline(T, circlePoints(new THREE.Vector3(0, L * c, 0), new THREE.Vector3(0, 1, 0), Math.max(rr, 1e-3)), th.accent, { dashed: true, dash: 0.16, gap: 0.12, opacity: Math.abs(m - I) < 1e-9 ? 0.75 : 0.3 }));
    }
  }
  const dirv = new THREE.Vector3();
  let phase = 0.6;
  const aim = () => { dirv.set(Math.sin(t0) * Math.cos(phase), Math.cos(t0), -Math.sin(t0) * Math.sin(phase)); arrow.set(dirv, L); };
  if (haveSpin) aim();

  // ------------------------------------------------------------ labels (static positions, fm)
  const pm = dR !== null ? ` ± ${dR.toFixed((String(R).split('.')[1] || '').length)}` : '';   // as many decimals as the radius
  const labels = [
    { position: [-R * 0.62, R * 0.62, R * 0.45], text: `${WHAT.symbol} nucleus: ${Z} protons and ${N} neutrons` },
    { position: [rEnd.x, rEnd.y, 0], text: `rms charge radius ${R}${pm} fm (measured)` },
    { position: [-R * 0.7, -R * 0.85, 0], text: 'one sphere: protons and neutrons are not drawn one by one' },
  ];
  if (haveSpin) {
    labels.push({ position: [L * Math.sin(t0) * Math.cos(0.6), L * Math.cos(t0) + 0.25, -L * Math.sin(t0) * Math.sin(0.6)], text: `nuclear spin I = ${spinText(I)}` });
    for (let m = -I; m <= I + 1e-9; m += 1) { const c = m / Math.sqrt(I * (I + 1)); labels.push({ position: [-L * Math.sqrt(Math.max(0, 1 - c * c)) - 0.9, L * c, 0], text: `m = ${m > 0 ? '+' : m < 0 ? '−' : ''}${spinText(Math.abs(m))}` }); }
    labels.push({ position: [0.15, Math.min(top, 4.1), 0], text: 'axis the spin is measured along' });
  }
  const hfs = hf.splitting;
  if (hfs?.value != null) {
    labels.push({ position: [R * 0.75, -R * 0.95, 0], text: ID === 'rb87'
      ? `hyperfine coupling to the electron spin: ${hf.levels?.value || 'F = 1 and F = 2'}, ${fx(hfs.value, 9)} ${hfs.unit} apart`
      : `hyperfine coupling to the NV electron spin: ${hf.lines?.value ?? 3} lines, ${hfs.value} ${hfs.unit} apart` });
  }

  // ------------------------------------------------------------ text
  const ratio = n.atom_over_nucleus, nvRatio = n.nv_distance_over_nucleus;
  const big = (x) => Math.round(x).toLocaleString('en-US');
  let fReal = 0;
  const EV = {
    field: { label: ID === 'rb87' ? 'field at the atoms (after the sensor’s coils)' : 'field here (the NV’s place)', plain: 'Field it feels', value: '—', unit: 'nT', tag: 'from the chosen place', source: '' },
    rate: { label: ID === 'rb87' ? 'Larmor frequency, nucleus turning with the electron (F = 2)' : 'Larmor frequency of the ¹⁴N nucleus', plain: 'Spin turns per second', value: '—', unit: 'Hz', tag: 'calculated', source: ID === 'rb87' ? 'quantum_constants rb87.zeeman_F2_per_nT × field' : 'quantum_constants nuclei.n14.larmor_free_nucleus × field' },
    slow: { label: 'shown slowed by', plain: 'Shown slowed by', value: timesText(DISPLAY.slow[ID] || 1), unit: '×', tag: 'display choice', source: 'a bigger field turns it faster on screen' },
    turn: { label: 'one turn on screen', plain: 'One turn takes', value: '—', unit: 's', tag: 'display', source: '' },
  };
  const src = String(Rvo.source || '');
  const info = {
    title: `${WHAT.symbol} nucleus: one sphere at its measured charge radius`,
    lines: [
      `The nucleus of ${WHAT.atom}: ${Z} protons and ${N} neutrons (A = ${A}). The sphere's radius is the measured root-mean-square charge radius, ${R}${pm} fm (Angeli & Marinova 2013, read from the IAEA nuclear charge radii database and cross-checked against the IAEA Live Chart of Nuclides). A nucleus has no sharp surface: this is the rms radius of its charge distribution.`,
      'Only this one sphere is drawn. Individual protons and neutrons are not shown, because their arrangement inside a nucleus is not a measured geometry.',
      ratio?.value != null
        ? (ID === 'rb87'
          ? `Scale: the atom of the levels above (van der Waals radius ${Q.rb87?.vdw_radius_nm?.value ?? '?'} nm) is ${big(ratio.value)} times larger than this sphere (calculated).`
          : `Scale: the nitrogen atom's covalent radius is ${big(ratio.value)} times this radius (calculated; the covalent radius is to confirm)${nvRatio?.value != null ? `, and the distance from the nitrogen to the vacancy is ${big(nvRatio.value)} times it (calculated)` : ''}.`)
        : '',
      haveSpin
        ? `Nuclear spin I = ${spinText(I)} (${ID === 'rb87' ? `Steck, Table 2${n.spin_parity?.value ? `; the ENSDF ground-state J-pi is ${n.spin_parity.value}` : ''}` : `ENSDF ground-state J-pi ${n.spin_parity?.value || ''}, from the IAEA Live Chart`}). The arrow is the vector model of the state m_I = I: length √(I(I+1)) = ${fx(sLen, 3)} ħ, tilted ${fx(tilt, 2)}° from the axis (calculated). Its length on screen (${DISPLAY.arrowPerHbar} fm per ħ) is a display choice. The dashed cones are the 2I + 1 orientations the spin can take. It turns about the field at the real Larmor rate for the chosen place, shown ${timesText(DISPLAY.slow[ID] || 1)} times slower: ${ID === 'rb87' ? `in the atom the nucleus is locked to the electron (F = I + J), so it turns with it at ${fx(num(n.larmor_with_electron_F2) || 0, 3)} Hz per nT of field left at the atoms (the bare nucleus would turn at ${fx(num(n.larmor_free_nucleus) || 0, 3)} MHz/T)` : `the bare ¹⁴N rate, |μ|/(I h) = ${fx(num(n.larmor_free_nucleus) || 0, 4)} MHz per tesla (calculated from the measured moment); in the NV centre the nuclear quadrupole interaction also acts on it (Barry et al., Table 16), which is not animated`}.`
        : 'No nuclear spin value is loaded, so no arrow is drawn.',
      ID === 'rb87'
        ? `Hyperfine coupling: the nuclear spin couples to the spin of the atom's outer electron (J = 1/2), which splits the ground state into ${hf.levels?.value || 'F = 1 and F = 2'}, ${hf.splitting?.value} ${hf.splitting?.unit} apart (Steck, Fig. 3; A = ${hf.constant_A?.value} ${hf.constant_A?.unit}, Table 5). These are the two levels of the optical-pumping diagram in the atom scene.`
        : `Hyperfine coupling: the ¹⁴N spin (I = 1, so m_I = −1, 0, +1) couples to the NV centre's electron spin and splits each NV resonance into ${hf.lines?.value ?? 3} lines ${hf.splitting?.value} ${hf.splitting?.unit} apart; the JGU heart sensor mixes ${hf.splitting?.value} ${hf.splitting?.unit} into its microwaves to drive all three (Omar et al. 2026).${hf.axial_constants?.value ? ` Barry et al. (2020) compile the axial hyperfine constant A∥ as ${hf.axial_constants.value} ${hf.axial_constants.unit}.` : ''}`,
      `Colour: Jmol CPK colour of ${WHAT.element === 'Rb' ? 'rubidium' : 'nitrogen'}, as in the atom scenes (a display convention).`,
    ].filter(Boolean),
    sources: [src, n.spin_parity?.source, ID === 'rb87' ? n.nuclear_spin?.source : null, hf.splitting?.source, hf.axial_constants?.source, Q.cpk_colours?.[WHAT.element]?.source].filter(Boolean),
    lean: [],
  };
  const readouts = [
    voRow('rms charge radius', Rvo, { value: `${R}${pm}` }),
    voRow('protons Z', n.protons), voRow('neutrons N', n.neutrons), voRow('mass number A', n.mass_number),
    voRow('nuclear spin I', n.nuclear_spin, I !== null ? { value: spinText(I) } : {}),
    voRow('ground-state spin and parity (ENSDF)', n.spin_parity),
    ID === 'rb87' ? voRow('hyperfine splitting of the ground state (F = 1 to F = 2)', hf.splitting, { value: '6.834 682 610 904 290' })
      : voRow('¹⁴N hyperfine splitting of an NV line', hf.splitting),
    ID === 'rb87' ? voRow('hyperfine constant A (5²S1/2)', hf.constant_A, { value: '3.417 341 305 452 145' })
      : voRow('¹⁴N axial hyperfine constant A∥ (values compiled by Barry et al.)', hf.axial_constants),
    ID === 'rb87' ? voRow('ground levels', hf.levels) : voRow('lines per NV resonance, 2I + 1', hf.lines),
    voRow(ID === 'rb87' ? 'atom ÷ nucleus (van der Waals radius ÷ this radius)' : 'atom ÷ nucleus (covalent radius ÷ this radius)', ratio, ratio?.value != null ? { value: big(ratio.value) } : {}),
    ID === 'n14' ? voRow('N–V distance ÷ this radius', nvRatio, nvRatio?.value != null ? { value: big(nvRatio.value) } : {}) : null,
    voRow('vector-model tilt of the spin (m_I = I)', n.spin_tilt, tilt !== null ? { value: fx(tilt, 2) } : {}),
    { ...voRow('magnetic dipole moment', n.magnetic_dipole), plain: 'Its magnet strength' },
    { ...voRow('electric quadrupole moment', n.electric_quadrupole), plain: 'How far from round its charge is' },
    { ...voRow('Larmor rate of the bare nucleus', n.larmor_free_nucleus), plain: 'Turns per tesla (bare nucleus)' },
    ...(ID === 'rb87' ? [{ ...voRow('in the atom: turns with the electron in F = 2', n.larmor_with_electron_F2), plain: 'Turns per nT (in the atom)' }] : []),
    EV.field, EV.rate, EV.slow, EV.turn,
  ].filter(Boolean);
  const PLAIN = { 'rms charge radius': 'Size (charge radius)', 'protons Z': 'Protons', 'neutrons N': 'Neutrons', 'mass number A': 'Protons + neutrons',
    'nuclear spin I': 'Spin', 'ground-state spin and parity (ENSDF)': 'Spin and parity', 'ground levels': 'Levels it makes in the atom',
    'lines per NV resonance, 2I + 1': 'Lines it makes', 'N–V distance ÷ this radius': 'N–V gap ÷ nucleus size', 'vector-model tilt of the spin (m_I = I)': 'Spin tilt' };
  for (const r of readouts) {
    if (!r.plain && PLAIN[r.label]) r.plain = PLAIN[r.label];
    else if (!r.plain && /hyperfine/.test(r.label)) r.plain = 'Pairing with the electron';
    else if (!r.plain && /^atom ÷ nucleus/.test(r.label)) r.plain = 'Atom ÷ nucleus size';
  }

  // ------------------------------------------------------------ the one view
  const views = { nucleus: { target: [0, 0, 0], dir: unit3([0.3, 0.22, 1]),
    note: `The ${WHAT.symbol} nucleus as one sphere of radius ${R} fm, its measured rms charge radius; the sphere is ${fx(2 * R, 2)} fm across in a 10.0 fm view. ${Z} protons and ${N} neutrons, not drawn one by one.${haveSpin ? ` The arrow is the nuclear spin I = ${spinText(I)}, turning at its real Larmor rate for this place (slowed, factor in the readouts); the dashed cones are its ${Math.round(2 * I + 1)} allowed orientations.` : ''}` } };
  const showLine = viewLine(info, views);
  const setView = (name) => showLine(hasView(views, name) ? name : null);          // the same content in every view
  // the place's field turns the nuclear spin at its real Larmor rate (slowed; the factor is printed)
  function setEnv(env) {
    if (!env || typeof env !== 'object') return;
    const comp = num(D.specs?.opm?.field_compensation_max);
    let Bf = null;
    if (ID === 'rb87') { const Bs = typeof env.B_at_sensor_nT === 'number' && Number.isFinite(env.B_at_sensor_nT) ? Math.abs(env.B_at_sensor_nT) : null; Bf = Bs === null ? null : comp !== null ? Math.max(0, Bs - comp) : Bs; }
    else Bf = typeof env.B_nT === 'number' && Number.isFinite(env.B_nT) ? Math.abs(env.B_nT) : null;
    const perNT = ID === 'rb87' ? num(n.larmor_with_electron_F2) : (num(n.larmor_free_nucleus) !== null ? num(n.larmor_free_nucleus) * 1e-3 : null);   // Hz per nT
    fReal = Bf !== null && perNT !== null ? perNT * Bf : 0;
    EV.field.value = Bf === null ? 'not known here' : plainNum(Bf, 5);
    EV.field.source = [placeText(env), ID === 'rb87' ? 'field at the sensor minus what the coils cancel (as in q_rb)' : 'background field of the place (as in q_nv)'].filter(Boolean).join(' · ');
    EV.rate.value = Bf === null ? '—' : plainNum(fReal, 4);
    const shown = fReal / DISPLAY.slow[ID];
    EV.turn.value = shown > 0 ? (1 / shown < 100 ? fx(1 / shown, 2) : Math.round(1 / shown).toLocaleString('en-US')) : 'not turning (no field)';
  }
  setEnv(opts.env || {});
  if (opts.view !== undefined) setView(opts.view);

  return {
    scene,
    camera: { position: unit3([0.3, 0.22, 1]).map((v) => v * 13.74), target: [0, 0, 0], fov: 40 },
    labels, info, readouts, controls: [], views, setView,
    setEnv,
    update(dt) {
      if (!haveSpin) return;
      phase += Math.min(Math.max(dt, 0), 0.1) * 2 * Math.PI * (fReal / DISPLAY.slow[ID]);
      aim();
    },
    dispose() { T.dispose(); },
  };
}
