// SpinDrift: one page. An astronaut wearing four quantum sensors; tap a sensor or scroll and the page dives through
// exact fields of view (2.00 m, 3.00 cm, 5.00 mm, 600 µm, 1.00 µm, 10.0 nm, 2.50 nm, 500 pm, 10.0 fm) to the quantum
// level. The place and exact spot you pick set the magnetic field and radiation context for all four sensors, and
// the Lean prover decides what each sensor can measure there. Every number comes from /data or the server.
import { $, $$, esc, D, S, fmtNum, toast, getJSON, postJSON, lean } from './core.js';
import { createTwin } from './twin.js';
import { createMicro, fovText, scaleLabel, niceLength } from './zoom.js';
import { createSensorView } from './sensorview.js';
import { tabBelow, TAB_HEAD } from './tabs.js';
import { sceneFor } from './outfit.js';
import { SENSORS, DESCENTS } from './story.js';
import { seesaw, deciding, sentence, WORDS, MARK } from './leanphys.js';

const FOOTER = 'Live: space magnetic-field feeds (NOAA L1 magnetometer; ISS position with the IGRF model). Near-live: an optically pumped magnetometer in orbit (ESA Swarm). Recorded: real OPM brain and heart data, NV, quantum-dot and carbon-dot lab data, and Inspiration4 astronaut lab data from NASA OSDR. Simulated: online simulators, labelled. No public live feed exists from these sensors on a human in space. Not diagnostic.';
const FILES = ['palette', 'specs', 'physics', 'nv_heart_derived', 'nasa_i4', 'simulators', 'build_log', 'live_snapshot', 'runs', 'combined_sensor',
  'lean_proofs', 'math_checks', 'quantum_circuits', 'qbio_facts', 'sensor_parts/opm',
  'recorded/nv_odmr_zenodo10629041', 'recorded/qd_fret_figshare5468838', 'recorded/cqd_pl_mendeley_cmfbrvrb8y', 'recorded/eeg_brain_ds004902'];
const OLD_PLACES = { iss: 'ISS · low Earth orbit', gateway: 'Lunar Gateway · NRHO', lunar_base: 'Lunar surface base', mars_transit: 'Mars transit', mars_surface: 'Mars surface' };
const st = { sensor: 'nv', step: 0, verdicts: null, verdictErr: null, brainPeak: null, sex: 'male', scene: null, labels: false,
  inputs: { shielding_factor: 1, beats_averaged: 47, snr_required: 3, build: 'jgu', target: 'r_peak', bandwidth_hz: 30, renin: null, bilirubin_isf: null } };
let twin = null, micro = null, busy = false;
const sensor = (id = st.sensor) => SENSORS.find((s) => s.id === id);
const chain = () => DESCENTS[st.sensor];

// ------------------------------------------------------------------ loading
async function loadAll() {
  let done = 0; const num = $('#ld-num'); $('#ld-1').classList.add('on');
  await Promise.all(FILES.map(async (f) => {
    try { D[f] = await getJSON(`/data/${f}.json`); } catch (e) { D[f] = null; console.warn(e.message); }
    done++; num.textContent = String(Math.round((done / FILES.length) * 55)).padStart(2, '0');
  }));
  D.locations = await getJSON('/api/locations').catch(() => getJSON('/data/locations.json').catch(() => null));
  $('#ld-1').classList.add('ok');
}
function applyPalette() {
  const cols = D.palette?.colours || [];
  const pick = (dev, wl) => cols.find((c) => c.device === dev && (!wl || c.wavelength?.value === wl))?.colour?.value;
  const root = document.documentElement.style;
  const opm = pick('opm'), nv = pick('nv'), cqd = pick('cqd_patch', 439), reader = pick('cqd_patch', 470);
  if (opm) root.setProperty('--opm', opm); if (nv) root.setProperty('--nv', nv); if (cqd) root.setProperty('--cqd', cqd); if (reader) root.setProperty('--reader', reader);
  S.col = { opm: opm || '#ff0000', nv: nv || '#ff0000', cqd: cqd || '#6200ff', reader: reader || '#002dff', qd: '#9aa08f', ink: '#e6ebf2', dim: '#8a93a3' };
}
function opmGeom() {
  const c = D['sensor_parts/opm']?.components; if (!c?.housing?.size || !c?.cell?.centre) return null;
  const v = (q) => (q && typeof q === 'object' && 'value' in q ? q.value : q);
  const hs = c.housing.size, cs = c.cell.size, cc = c.cell.centre;
  const g = { w: v(hs.x), h: v(hs.y), d: v(hs.z), cell: [v(cc.x), v(cc.y), v(cc.z)], cellSize: [v(cs.x), v(cs.y), v(cs.z)] };
  return [g.w, g.h, g.d, ...g.cell, ...g.cellSize].every((x) => typeof x === 'number') ? g : null;
}

// ------------------------------------------------------------------ places: 10 places, each with exact spots
const places = () => (Array.isArray(D.locations?.places) ? D.locations.places : null);
const subPlace = (id = S.location) => { for (const p of places() || []) for (const s of p.sub_places || []) if (s.id === id) return { ...s, place_name: p.name || s.place }; return null; };
function setupPlaces() {
  const P = places(), selP = $('#place'), selS = $('#location');
  if (!P) {      // the location engine is not built: the five older places
    selP.hidden = true; selS.innerHTML = Object.entries(OLD_PLACES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    S.location = selS.value; return;
  }
  selP.hidden = false;
  const grp = (g) => P.filter((p) => p.group === g).map((p) => `<option value="${esc(p.id)}">${esc(p.name || p.id)}</option>`).join('');
  selP.innerHTML = `<optgroup label="Today">${grp('today')}</optgroup><optgroup label="Tomorrow">${grp('tomorrow')}</optgroup>`;
  const fill = () => { const p = P.find((x) => x.id === selP.value) || P[0]; selS.innerHTML = (p.sub_places || []).map((s) => `<option value="${esc(s.id)}">${esc(s.sub_place || s.id)}</option>`).join(''); };
  const keep = subPlace(S.location);
  if (keep) { selP.value = S.location.split('.')[0]; fill(); selS.value = S.location; } else { fill(); S.location = selS.value; }
  selP.onchange = () => { fill(); selS.dispatchEvent(new Event('change')); };
}
const whereText = () => { const s = subPlace(); return s ? `${s.place_name || s.place} · ${s.sub_place}` : (OLD_PLACES[S.location] || S.location); };
const gammaNV = () => D.physics?.nv_odmr_lines?.inputs?.[1]?.value ?? null;     // MHz per mT, sourced in physics.json
// the environment every sensor and every level reads
function env() {
  const E = st.verdicts?.environment, s = subPlace(), old = (S.live || D.live_snapshot)?.opm_readiness?.[S.location]?.ambient_nT;
  const Bvo = E?.B_total_nT || s?.B_total_nT || old || null, B = typeof Bvo?.value === 'number' ? Bvo.value : null;
  const shield = st.inputs.shielding_factor || 1, g = gammaNV();
  const v = st.verdicts?.verdicts || {}, verdicts = {}; for (const k of Object.keys(v)) verdicts[k] = v[k]?.verdict;
  const zee = E?.nv_zeeman_shift_MHz?.value ?? s?.nv_zeeman_shift_MHz?.value ?? (B !== null && g ? g * B * 1e-6 : null);
  return { location: { id: S.location, place: s?.place_name || s?.place || OLD_PLACES[S.location] || S.location, sub_place: s?.sub_place || '', body: s?.body || '' },
    B_nT: B, B_tag: Bvo?.tag || null, B_status: Bvo?.status || null, B_source: Bvo?.source || null, shielding_factor: shield,
    B_at_sensor_nT: B !== null ? B / shield : null, nv_zeeman_shift_MHz: zee,
    radiation: E?.radiation_context?.text || s?.radiation_context?.text || null, verdicts };
}

// ------------------------------------------------------------------ key readouts (all from data files)
function keyReadout(site) {
  if (site === 'brain') { const p = st.brainPeak; return p ? { value: p.value, unit: 'fT', label: 'brain field at the scalp (real recording, Earth)' } : { value: null, label: 'brain field at the scalp' }; }
  if (site === 'heart') { const ab = D.nv_heart_derived?.averaged_beat; return ab ? { value: Math.abs(ab.r_peak_pT.value), unit: 'pT', label: `heartbeat field at the chest (${ab.beats_averaged.value} real beats averaged, Earth)` } : { value: null, label: 'heartbeat field' }; }
  if (site === 'blood') { const lod = D.specs?.qd_renin?.detection_limit; return { value: lod?.value ?? null, unit: lod?.unit || '', label: 'smallest amount of renin the test can see' }; }
  const v = D.nasa_i4?.datasets?.[0]?.variables?.[0], pts = (v?.points || []).filter((p) => typeof p.value?.value === 'number'), last = pts[pts.length - 1];
  return last ? { value: last.value.value, unit: last.value.unit || 'mg/dL', label: `bilirubin in a real astronaut’s blood (Inspiration4, ${last.timepoint})` } : { value: null, label: 'bilirubin' };
}
async function loadBrainPeak() {
  try {
    const ev = (await getJSON('/data/recorded/opm_brain_mne.json')).evoked; let best = 0;
    ev.series.forEach((s) => s.values.forEach((v) => { if (Math.abs(v) > best) best = Math.abs(v); }));
    st.brainPeak = { value: best }; renderCard(); renderLevel();
  } catch (e) { console.warn(e); }
}

// ------------------------------------------------------------------ Lean verdicts
const cardsFor = (id) => { const v = st.verdicts?.verdicts; if (!v) return []; return sensor(id).verdicts.map((k) => k.replace('{build}', st.inputs.build)).map((k) => ({ key: k, ...v[k] })).filter((x) => x.verdict); };
const mainCard = (id) => { const c = cardsFor(id); return c.find((x) => x.verdict === 'NOT_MET') || c.find((x) => x.verdict === 'NEED_MORE_INFORMATION') || c[0] || null; };
let checking = null;
async function checkLean(announce = false) {
  const my = (checking = Symbol());
  try {
    const r = await postJSON('/api/verdict', { location: S.location, inputs: st.inputs });
    if (my !== checking) return;
    st.verdicts = r; st.verdictErr = null;
    if (announce) toast('Lean checked the numbers again.');
  } catch (e) { if (my !== checking) return; st.verdictErr = `Lean checker unavailable (${e.message})`; st.verdicts = null; }
  for (const s of SENSORS) twin?.setVerdict(s.site, mainCard(s.id)?.verdict || null);
  micro?.setEnv(env());
  renderCard(); renderLevel();
}

// ------------------------------------------------------------------ the one card (body level)
function inputsHTML() {
  const I = st.inputs, U = st.verdicts?.input_units || {};
  return `<details class="more"><summary>Change the numbers</summary>
    <div class="inp"><span>Magnetic shield<small>how many times it weakens the field · 1 = none</small></span><select data-in="shielding_factor">${[1, 10, 100, 1000, 10000, 100000].map((v) => `<option value="${v}" ${v === I.shielding_factor ? 'selected' : ''}>× ${v.toLocaleString('en-US')}</option>`).join('')}</select></div>
    <div class="inp"><span>Heartbeats averaged<small>the real recording has 47</small></span><input data-in="beats_averaged" type="number" min="1" max="100000" step="1" value="${I.beats_averaged ?? ''}"></div>
    <div class="inp"><span>How clear the signal must be<small>signal ÷ noise</small></span><input data-in="snr_required" type="number" min="0.1" step="0.1" value="${I.snr_required ?? ''}"></div>
    <div class="inp"><span>Diamond sensor build</span><select data-in="build">${[['jgu', 'JGU'], ['zaquant', 'ZAQuant'], ['qant', 'Q.ANT']].map(([b, n]) => `<option value="${b}" ${b === I.build ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="inp"><span>Part of the heartbeat</span><select data-in="target"><option value="r_peak" ${I.target !== 'q_wave' ? 'selected' : ''}>big spike (R)</option><option value="q_wave" ${I.target === 'q_wave' ? 'selected' : ''}>small dip (Q)</option></select></div>
    <div class="inp"><span>Brain sensor bandwidth<small>Hz, between 3 and 100</small></span><input data-in="bandwidth_hz" type="number" min="1" max="100" step="1" value="${I.bandwidth_hz ?? ''}"></div>
    <div class="inp"><span>Renin in the blood<small>${esc((U.renin || 'pM').split(',')[0])} · empty = not measured</small></span><input data-in="renin" type="number" min="0" step="any" placeholder="not measured" value="${I.renin ?? ''}"></div>
    <div class="inp"><span>Bilirubin in skin fluid<small>${/not yet extracted/.test(U.bilirubin_isf || '') ? 'the paper’s unit is not extracted yet' : esc(U.bilirubin_isf || '')} · empty = not measured</small></span><input data-in="bilirubin_isf" type="number" min="0" step="any" placeholder="not measured" value="${I.bilirubin_isf ?? ''}"></div>
    <div class="btnrow"><button class="ghost" id="btn-run">＋ Do a real run here</button></div></details>`;
}
function wireInputs(root) {
  $$('[data-in]', root).forEach((el) => el.addEventListener('change', () => {
    const k = el.dataset.in, raw = el.value;
    st.inputs[k] = ['build', 'target'].includes(k) ? raw : raw === '' ? null : +raw;
    checkLean(true);
    if (k === 'build' && st.step > 0) goStep(st.step, { force: true });
  }));
}
function renderCard() {
  const E = env(), comb = S.combined || D.combined_sensor || {}, runs = (S.runs?.runs || D.runs?.runs || []).length;
  const word = (s) => { const c = mainCard(s.id); return `<button class="w ${c ? `v-${c.verdict}` : ''}" data-sensor="${s.id}" title="${esc(c ? `${s.name}: ${WORDS[c.verdict]}` : s.name)}">${s.word}<sup>${c ? MARK[c.verdict] : ''}</sup></button>`; };
  const rows = SENSORS.map((s) => {
    const r = keyReadout(s.site), c = mainCard(s.id), req = deciding(c);
    return `<div class="srow ${st.sensor === s.id ? 'on' : ''}" data-sensor="${s.id}">
      <div class="s-head"><span class="s-name"><i class="dotc ${s.color}"></i>${esc(s.name)}</span><span class="s-site">${esc(s.kind)}</span></div>
      <div class="s-main"><div><div class="s-val">${r.value === null || r.value === undefined ? '<span class="na">no value</span>' : `<span>${esc(fmtNum(r.value))}</span><small>${esc(r.unit || '')}</small>`}</div><div class="s-lbl">${esc(r.label)}</div></div>
        ${c ? seesaw(req, c.verdict, { size: 'sm' }) : ''}</div>
      <div class="s-verdict ${c ? `v-${c.verdict}` : ''}">${c ? `${MARK[c.verdict]} ${esc(WORDS[c.verdict])} · ${esc(sentence(req))}` : esc(st.verdictErr || 'Lean is checking…')}</div></div>`;
  }).join('');
  $('#card').innerHTML = `<div class="theorem"><div class="th-tag">⊢ every signal a theorem</div>
      <div class="th-code"><span class="kw">theorem</span> monitor (${SENSORS.map(word).join(' ')} : <span class="ty">Sensor</span>)<br>&nbsp;&nbsp;at <span class="here">${esc(whereText())}</span></div>
      <div class="th-sub">Lean × Quantum × Astrobiology</div></div>
    <p class="card-say">Here the background magnetic field is <b>${E.B_nT === null ? 'not known' : `${fmtNum(E.B_nT)} nT`}</b>${E.B_tag ? ` <span class="chip">${esc(E.B_tag)}</span>` : ''}. Lean, a maths referee, checks what each sensor can measure in this spot. Tap a sensor to dive in.</p>
    ${rows}${inputsHTML()}
    <div class="footer-text">${runs} real runs · combined sensor v${esc(comb.version ?? 0)} · ${esc(FOOTER)}</div>`;
  $$('#card [data-sensor]').forEach((el) => el.addEventListener('click', () => { selectSensor(el.dataset.sensor); goStep(1); }));
  wireInputs($('#card'));
  $('#btn-run')?.addEventListener('click', doRun);
}

// ------------------------------------------------------------------ the rail and the big field-of-view number
function renderRail() {
  const ch = chain();
  $('#rail-wrap').innerHTML = `<div class="chips">${SENSORS.map((s) => `<button data-sensor="${s.id}" class="${s.id === st.sensor ? 'on' : ''}" title="${esc(s.name)}"><i class="dotc ${s.color}"></i>${esc(s.word)}</button>`).join('')}</div>
    <div class="rail">${ch.map((l, i) => `<button data-i="${i}" title="${i + 1} · ${esc(l.name)}" class="${i === st.step ? 'on' : ''}"><i></i><b>${l.fov ? esc(scaleLabel(l.fov)) : 'quantum'}</b></button>`).join('')}</div>`;
  $$('#rail-wrap .rail button').forEach((b) => b.addEventListener('click', () => goStep(+b.dataset.i)));
  $$('#rail-wrap .chips button').forEach((b) => b.addEventListener('click', () => selectSensor(b.dataset.sensor)));
  $('#fov-lvl').textContent = `LEVEL ${st.step + 1} OF ${ch.length} · ${ch[st.step].name.toUpperCase()}`;
}
let fovShown = '', fovNow = 2.0, fovTween = null;
function drawFov(metres, dim) {
  let num, unit; if (metres === null) { [num, unit] = [dim.split(' ')[0], dim.split(' ').slice(1).join(' ')]; } else ({ num, unit } = fovText(metres));
  const key = `${num}${unit}`; if (key === fovShown) return; fovShown = key;
  $('#fov-num').textContent = num; $('#fov-unit').textContent = unit;
}
function setFov(metres, dim) { if (metres !== null) fovNow = metres; if (!fovTween) drawFov(metres, dim); }
function tweenFov(to) {          // the number sweeps smoothly (in powers of ten) while the camera travels
  const from = fovNow; if (!from || !to) return;
  fovTween = { t0: performance.now(), dur: 1100 };
  (function tick() {
    if (!fovTween) return;
    const k = Math.min(1, (performance.now() - fovTween.t0) / fovTween.dur), e = 1 - (1 - k) ** 3;
    drawFov(Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * e));
    if (k >= 1) { fovTween = null; fovNow = to; } else requestAnimationFrame(tick);
  })();
}

// ------------------------------------------------------------------ the level card: plain words first
const first = (t, n = 150) => { const s = String(t || ''); const cut = s.search(/[.!?](\s|$)/); const one = cut > 20 ? s.slice(0, cut + 1) : s; return one.length > n ? `${one.slice(0, n - 1)}…` : one; };
const bigNum = (v) => (v >= 1e6 ? `${fmtNum(+(v / 1e6).toPrecision(2))} million` : v >= 1e4 ? Math.round(+v.toPrecision(2)).toLocaleString('en-US') : fmtNum(+v.toPrecision(3)));
function hereLine(kind, E) {
  const where = `<b>${esc(E.location.place)}${E.location.sub_place ? ` · ${esc(E.location.sub_place)}` : ''}</b>`;
  if (kind === 'radiation') return `<p class="here-line">At ${where}: ${E.radiation ? esc(first(E.radiation, 170)) : 'no radiation note for this spot.'} This sensor reads light, not magnetism.</p>`;
  if (E.B_nT === null) return `<p class="here-line">At ${where} the background magnetic field is not known${E.B_status ? ` (${esc(E.B_status.toLowerCase().replace(/_/g, ' '))})` : ''}, so Lean will not guess.</p>`;
  let t = `At ${where} the background magnetic field is <b>${fmtNum(E.B_nT)} nT</b>.`;
  if (st.sensor === 'opm') { const comp = D.specs?.opm?.field_compensation_max?.value; t += ` ${E.shielding_factor > 1 ? `Your shield weakens it ${E.shielding_factor.toLocaleString('en-US')} times, to <b>${fmtNum(E.B_at_sensor_nT)} nT</b>. ` : ''}The sensor’s own coils can cancel ${comp ?? '?'} nT.`; }
  if (st.sensor === 'nv' && E.nv_zeeman_shift_MHz !== null) t += ` By itself that moves the diamond’s note by <b>${fmtNum(+E.nv_zeeman_shift_MHz.toPrecision(3))} MHz</b>.`;
  return `<p class="here-line">${t}</p>`;
}
function brainRatio(E) {
  const p = st.brainPeak?.value; if (!p) return '';
  const r = E.B_nT !== null ? (E.B_nT * 1e6) / p : null;
  return `<p>Thousands of cells firing together make a field of about ${fmtNum(+p.toPrecision(3))} fT at the scalp${r ? `: about <b>${bigNum(r)} times weaker</b> than the background field at ${esc(E.location.place)}` : ''}.</p>`;
}
const isKey = (x) => (typeof x.value === 'number' || (typeof x.value === 'string' && x.value.length <= 14)) && !/not (yet )?(stated|extracted)/i.test(String(x.value));
const roText = (x) => `${typeof x.value === 'number' ? fmtNum(x.value) : x.value ?? '—'}`;
const roRow = (x, k) => `<div class="mrow" data-ro="${k}" title="${esc([x.tag, x.source].filter(Boolean).join(' · '))}"><span>${esc(x.label)}</span><b>${esc(roText(x))} <small>${esc(x.unit || '')}</small></b></div>`;
const ctlRow = (c) => `<div class="ctrl"><div class="row"><span>${esc(c.label)}</span><output data-o="${esc(c.id)}">${esc(fmtNum(+c.value))} ${esc(c.unit || '')}</output></div><input type="range" data-c="${esc(c.id)}" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.value}"></div>`;
function quickInput() {         // one number to play with, right where it matters
  const I = st.inputs;
  if (st.sensor === 'opm') return `<label class="mini">Shield <select data-in="shielding_factor">${[1, 10, 100, 1000, 10000, 100000].map((v) => `<option value="${v}" ${v === I.shielding_factor ? 'selected' : ''}>× ${v.toLocaleString('en-US')}</option>`).join('')}</select></label>`;
  if (st.sensor === 'nv') return `<label class="mini">Heartbeats averaged <input data-in="beats_averaged" type="number" min="1" max="100000" value="${I.beats_averaged ?? ''}"></label>`;
  if (st.sensor === 'qd') return `<label class="mini">Renin in the sample (pM) <input data-in="renin" type="number" min="0" step="any" placeholder="not measured" value="${I.renin ?? ''}"></label>`;
  return `<label class="mini">Bilirubin in skin fluid <input data-in="bilirubin_isf" type="number" min="0" step="any" placeholder="not measured" value="${I.bilirubin_isf ?? ''}"></label>`;
}
function cellsGenes(site) {     // real cell types and marker genes for this tissue (Human Reference Atlas tables)
  const A = D['bio/asctb']; if (A === undefined) { getJSON('/data/bio/asctb.json').catch(() => null).then((j) => { D['bio/asctb'] = j; renderLevel(); }); return ''; }
  const T = A?.organs?.[{ brain: 'brain', heart: 'heart', blood: 'kidney', skin: 'skin' }[site]]; if (!T) return '';
  let rows = T.rows || [];
  if (site === 'brain') { const m1 = rows.filter((r) => r.anatomical_structures.some((s) => s.id === 'UBERON:0001384')); if (m1.length) rows = m1; }
  const cells = new Set(), genes = new Set();
  rows.forEach((r) => { r.cell_types.forEach((c) => cells.add(c.label || c.name)); (r.genes || []).forEach((g) => genes.add(g.symbol)); });
  return `<p><b>Cells here (Human Reference Atlas):</b> ${esc([...cells].slice(0, 4).join(', '))}${cells.size > 4 ? ` +${cells.size - 4}` : ''}.${genes.size ? ` <b>Genes that mark them:</b> ${esc([...genes].slice(0, 8).join(' · '))}${genes.size > 8 ? ` +${genes.size - 8}` : ''}.` : ''}${site === 'blood' ? ' Renin is made in the kidney by these cells.' : ''}</p>`;
}
const TWIN_SRC = { opm_contact: 'QuSpin QZFM Gen-3 dimension drawing; Human Reference Atlas body, brain and scalp positions (CC BY 4.0); MNE-Python OPM recording layout', opm_cell: 'QuSpin QZFM Gen-3 dimension drawing (cell position); cell size from Zhao et al., arXiv 2408.02941 (to confirm)',
  nv_contact: 'Omar et al., arXiv 2601.18843 (JGU build: 12 mm head face, about 1 cm from the chest); Human Reference Atlas heart position', elbow: 'Long et al., Anal. Chem. 84, 8846 (2012): lab assay on drawn blood; the draw site is shown at the elbow (the paper names none)', forearm: 'Tabatabaee et al., ACS Nano 18, 28012 (2024); the patch site is shown on the forearm (the paper names none); needle sizes are not in an open source' };
function renderLevel() {
  const ch = chain(), i = st.step, lv = ch[i];
  $('#hud').hidden = i === 0; if (i === 0 || !lv) return;
  const E = env(), cur = micro?.current, built = lv.file && cur?.file === fileOf(lv) ? cur.built : null;
  const ro = built?.readouts || [], cs = built?.controls || [], info = built?.info || {};
  const keyIdx = ro.map((x, k) => (isKey(x) ? k : -1)).filter((k) => k >= 0).slice(0, 3), restIdx = ro.map((_, k) => k).filter((k) => !keyIdx.includes(k));
  const c = lv.lean ? mainCard(st.sensor) : null;
  const open = $('#level-card details.more')?.open;
  $('#level-card').innerHTML = `<div class="lvl">Level ${i + 1} of ${ch.length} · ${lv.fov ? esc(scaleLabel(lv.fov)) : 'no ruler at this level'}</div><h3>${esc(lv.title)}</h3>
    ${lv.say.map((t) => `<p>${esc(t)}</p>`).join('')}${lv.brainRatio ? brainRatio(E) : ''}
    ${lv.qb ? `<p class="qb">${esc(lv.qb)}</p>` : ''}
    ${lv.env ? hereLine(lv.env, E) : ''}
    ${c ? `${seesaw(deciding(c), c.verdict)}${quickInput()}` : lv.lean ? `<p class="here-line">${esc(st.verdictErr || 'Lean is checking…')}</p>` : ''}
    ${lv.control && cs[0] ? ctlRow(cs[0]) : ''}
    <details class="more" ${open ? 'open' : ''}><summary>More</summary>
      ${keyIdx.map((k) => roRow(ro[k], k)).join('')}${restIdx.map((k) => roRow(ro[k], k)).join('')}
      ${cs.slice(lv.control ? 1 : 0).map(ctlRow).join('')}
      ${lv.cells ? cellsGenes(sensor().site) : ''}
      ${(info.lines || []).map((t) => `<p>${esc(t)}</p>`).join('')}
      ${(info.lean || []).length ? `<div class="lean-row">${info.lean.map((n) => lean(n)).join('')}</div>` : ''}
      <div class="src">${[lv.src, lv.twin ? TWIN_SRC[lv.twin] : null, ...(info.sources || [])].filter(Boolean).map(esc).join('<br>')}</div>
      <div class="btnrow"><button class="ghost" id="go-specs">Full specs and physics</button></div></details>`;
  $$('#level-card input[data-c]').forEach((inp) => inp.addEventListener('input', () => {
    const ctl = cs.find((x) => x.id === inp.dataset.c), v = +inp.value; if (!ctl) return;
    $(`#level-card [data-o="${ctl.id}"]`).textContent = `${fmtNum(v)} ${ctl.unit || ''}`;
    try { ctl.onInput?.(v); } catch (e) { console.warn(e); }
    refreshReadouts();
  }));
  wireInputs($('#level-card'));
  $('#go-specs')?.addEventListener('click', () => showView(st.sensor));
  drawGene(built?.gene);
}
function refreshReadouts() {
  const ro = micro?.current?.built?.readouts || [];
  $$('#level-card [data-ro]').forEach((el) => { const x = ro[+el.dataset.ro]; if (x) el.querySelector('b').innerHTML = `${esc(roText(x))} <small>${esc(x.unit || '')}</small>`; });
}
function drawGene(g) {
  const el = $('#hud-gene'); if (!g || !g.exons?.length) { el.innerHTML = ''; return; }
  const W = 600, x0 = 10, x1 = W - 10, span = g.end - g.start || 1, X = (p) => x0 + ((p - g.start) / span) * (x1 - x0), fwd = (g.strand ?? 1) > 0;
  el.innerHTML = `<div class="kick"><span>The recipe: gene ${esc(g.symbol)} on chromosome ${esc(g.chrom)}</span><span>${g.exons.length} pieces · ${fmtNum(span / 1000)} thousand letters</span></div>
    <svg viewBox="0 0 ${W} 40" class="chart"><line x1="${x0}" x2="${x1}" y1="18" y2="18" stroke="#8a93a3"/>
    ${g.exons.map(([a, b]) => `<rect x="${X(Math.min(a, b))}" y="10" width="${Math.max(1.4, X(Math.max(a, b)) - X(Math.min(a, b)))}" height="16" rx="1" fill="url(#gg)"><title>piece ${(+a).toLocaleString('en-US')}–${(+b).toLocaleString('en-US')}</title></rect>`).join('')}
    <defs><linearGradient id="gg" x1="0" x2="1"><stop offset="0" stop-color="#b79cff"/><stop offset="1" stop-color="#8fe3ff"/></linearGradient></defs>
    <text x="${x0}" y="38">${(+g.start).toLocaleString('en-US')}</text><text x="${x1}" y="38" text-anchor="end">${(+g.end).toLocaleString('en-US')} · read ${fwd ? 'left to right' : 'right to left'}</text></svg>`;
}

// ------------------------------------------------------------------ moving through the levels
const fileOf = (lv) => (lv.file ? lv.file.replace('build=jgu', `build=${st.inputs.build}`) : null);
async function goStep(i, { force = false } = {}) {
  const ch = chain(); i = Math.max(0, Math.min(ch.length - 1, i));
  if ((i === st.step && !force) || busy) return;
  busy = true;
  const from = st.step, lv = ch[i], dir = i >= from ? 'in' : 'out', depth = i / (ch.length - 1);
  try {
    if (lv.fov) tweenFov(lv.fov);
    if (lv.twin) {
      $('#stage').classList.remove('deep'); micro.close();
      twin?.view(lv.twin); st.step = i;
    } else {
      if (ch[from]?.twin && dir === 'in') twin?.diveIn(0.3);
      const cur = await micro.show({ ...lv, file: fileOf(lv) }, { dir, env: env(), depth });
      if (cur) { $('#stage').classList.add('deep'); st.step = i; }
    }
  } catch (e) { console.warn(e); toast(`This level is still being built (${e.message}).`, 5000); if (ch[st.step]?.twin) twin?.view(ch[st.step].twin); }
  busy = false;
  document.body.classList.toggle('sensor-mode', st.step > 0);
  $('#stage').style.setProperty('--depth', (st.step / (ch.length - 1)).toFixed(3));
  $('#stage').classList.toggle('at-body', st.step === 0);
  renderRail(); renderLevel();
}
const step = (d) => goStep(st.step + d);
function selectSensor(id) {
  if (id === st.sensor) return;
  st.sensor = id; twin?.select(sensor().site);
  if (st.step > 0) goStep(Math.min(st.step, chain().length - 1), { force: true }); else { renderRail(); renderCard(); }
}

// ------------------------------------------------------------------ the figure: dressed for the place, female or male
async function makeTwin(onProgress) {
  const old = $('#twin'), fresh = old.cloneNode(false); old.replaceWith(fresh);
  $('#labels').innerHTML = ''; $('#leaders').innerHTML = '';
  const sc = sceneFor(S.location); st.scene = sc; $('#stage').dataset.bg = sc.backdrop;
  twin = await createTwin({ canvas: fresh, labelsEl: $('#labels'), leadersEl: $('#leaders'), sites: SENSORS.map((s) => ({ id: s.site, name: s.name, sensor: s.kind })),
    colors: { opm: S.col.opm, nv: S.col.nv, cqd: S.col.cqd }, opm: opmGeom(), sex: st.sex, outfit: sc.outfit, backdrop: sc.backdrop,
    onSelect: (site) => { const s = SENSORS.find((x) => x.site === site); if (s) { selectSensor(s.id); goStep(1); } },
    onEdge: (d) => step(d === 'in' ? 1 : -1), onProgress });
  twin.select(sensor().site);
  for (const s of SENSORS) twin.setVerdict(s.site, mainCard(s.id)?.verdict || null);
  const lv = chain()[st.step]; if (lv?.twin) twin.view(lv.twin, { instant: true });
}
async function setSex(sex) {
  if (sex === st.sex) return;
  st.sex = sex; $$('.sex-toggle button').forEach((b) => b.classList.toggle('on', b.dataset.sex === sex));
  await makeTwin();
}
async function onPlaceChange() {
  S.location = $('#location').value;
  await checkLean();
  const sc = sceneFor(S.location);
  if (twin && (sc.outfit !== st.scene?.outfit || sc.backdrop !== st.scene?.backdrop)) await makeTwin();
}

// ------------------------------------------------------------------ runs, polling, the detailed specs pages, sources
async function doRun() {
  const btn = $('#btn-run'); btn.disabled = true; btn.textContent = 'Running…';
  try {
    const j = await postJSON('/api/run', { location: S.location, role: 'crew' });
    S.combined = j.combined; S.runs = await getJSON('/api/runs').catch(() => S.runs);
    toast(`${j.run.run_id}: ${j.run.adds_to_combined.length} new real facts added to the combined sensor.`, 5000);
  } catch (e) { toast(`Run failed: ${e.message}`, 6000); }
  renderCard();
}
async function poll() {
  try { S.health = await getJSON('/api/health'); $('#tb-status').classList.add('ok'); $('#tb-status span').textContent = 'live'; }
  catch { $('#tb-status').classList.remove('ok'); $('#tb-status span').textContent = 'saved data'; }
  try { S.live = await getJSON('/api/live'); } catch { /* snapshot */ }
  try { const L = await getJSON('/api/locations'); if (Array.isArray(L?.places)) D.locations = L; } catch { /* file copy */ }
  try { S.combined = await getJSON('/api/combined'); S.runs = await getJSON('/api/runs'); } catch { /* files */ }
}
const built = {};
async function showView(v) {
  $$('.view').forEach((el) => el.classList.toggle('on', el.id === `view-${v}`));
  if (v === 'body' || built[v]) return;
  built[v] = true;
  const el = $(`#view-${v}`), h = TAB_HEAD[v];
  el.innerHTML = `<button class="ghost" data-back style="margin-bottom:10px">← Back to the dive</button><div class="st-head"><div><div class="kick"><span>${esc(h.kick)}</span></div><h2>${esc(h.title)}</h2><div class="note">${h.sub}</div></div><div class="pills">${h.pills()}</div></div>
    <div class="st-main"><div class="st-view" id="sv-${v}"><div class="sv-empty">Loading the exact-spec model…</div></div><aside class="st-side" id="ss-${v}"></aside></div>
    <div class="st-below" id="sb-${v}"></div>`;
  el.addEventListener('click', (e) => { if (e.target.closest('[data-back]')) showView('body'); });
  try { await createSensorView($(`#sv-${v}`), $(`#ss-${v}`), v); }
  catch (e) { console.warn(e); $(`#sv-${v}`).innerHTML = `<div class="sv-empty">The exact-spec model could not be drawn.<br><span class="src">${esc(e.message)}</span></div>`; }
  try { await tabBelow(v, $(`#sb-${v}`)); } catch (e) { console.error(e); $(`#sb-${v}`).innerHTML = `<div class="box">Could not render: ${esc(e.message)}</div>`; }
}
function sourcesHTML() {
  const rec = ['nv_odmr_zenodo10629041', 'qd_fret_figshare5468838', 'cqd_pl_mendeley_cmfbrvrb8y', 'eeg_brain_ds004902'];
  return `<p>${esc(FOOTER)}</p>
    <h4>Places</h4><ul class="plain">${(D.locations?.meta?.sources || ['NOAA SWPC L1 magnetometer', 'wheretheiss.at ISS position', 'IGRF via ppigrf']).slice(0, 14).map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
    <h4>Recorded datasets</h4><ul class="plain"><li>Kiel Cardio Database (OPM heart) · MNE-Python OPM sample (OPM brain) · NASA OSDR Inspiration4 (OSD-575, OSD-569)</li>${rec.map((id) => { const m = D[`recorded/${id}`]?.meta; return m ? `<li><a href="${esc(m.doi_or_url)}" target="_blank" rel="noopener">${esc(m.dataset)}</a> · ${esc(m.licence)}</li>` : ''; }).join('')}</ul>
    <h4>The figure, anatomy, cells, genes and molecules</h4><ul class="plain">${(twin?.credits || []).map((c) => `<li>${esc(c)}</li>`).join('')}<li>Each level lists its own sources under “More”.</li></ul>
    <h4>Proofs and checks</h4><ul class="plain"><li>Lean 4 (${esc(D.lean_proofs?.toolchain || '')}), core library only: ${esc(String(D.lean_proofs?.theorems?.length || 0))} theorems, ${esc(String(D.lean_proofs?.sorry_count ?? '?'))} unproven steps</li>
      <li>${esc(D.math_checks?.tool || 'Wolfram Language')}: ${esc(String(D.math_checks?.checks?.length || 0))} cross-checks · ${esc(D.quantum_circuits?.tool || 'coda simulate')}: ${esc(String(D.quantum_circuits?.points?.length || 0))} circuits</li></ul>
    <h4>Software</h4><ul class="plain"><li>three.js 0.160 (MIT) · Manrope and JetBrains Mono (SIL Open Font License)</li></ul>`;
}

// ------------------------------------------------------------------ boot
async function boot() {
  await loadAll();
  applyPalette(); setupPlaces();
  $('#location').addEventListener('change', onPlaceChange);
  $$('.sex-toggle button').forEach((b) => b.addEventListener('click', () => setSex(b.dataset.sex)));
  $('#open-sources').addEventListener('click', () => { $('#sources-body').innerHTML = sourcesHTML(); $('#sources').hidden = false; });
  $('#go-src').addEventListener('click', () => $('#open-sources').click());
  $('#close-sources').addEventListener('click', () => { $('#sources').hidden = true; });
  $('#go-down').addEventListener('click', () => step(1)); $('#go-up').addEventListener('click', () => step(-1));
  $('#go-labels').addEventListener('click', (e) => { st.labels = !st.labels; e.target.classList.toggle('on', st.labels); micro.setLabels(st.labels); });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input,select,textarea') || !$('#view-body').classList.contains('on')) return;
    if (e.key === 'ArrowDown' || e.key === ']') { e.preventDefault(); step(1); }
    if (e.key === 'ArrowUp' || e.key === '[') { e.preventDefault(); step(-1); }
  });
  renderCard(); renderRail();
  $('#ld-2').classList.add('on');
  micro = createMicro({ canvas: $('#micro'), labelsEl: $('#micro-labels'), scaleEl: $('#scalebar'), onEdge: (d) => step(d === 'in' ? 1 : -1),
    onFov: (m, dim) => { if (chain()[st.step]?.file) setFov(m, dim); }, onTick: refreshReadouts });
  try { await makeTwin((f) => { $('#ld-num').textContent = String(55 + Math.round(f * 35)).padStart(2, '0'); }); }
  catch (e) { console.error(e); toast(`The 3D figure is unavailable: ${e.message}`, 6000); }
  $('#stage').classList.add('at-body');
  $('#ld-2').classList.add('ok'); $('#ld-3').classList.add('on');
  (function bar() {            // scale bar and field of view while the body figure is showing
    requestAnimationFrame(bar);
    if (!twin || !chain()[st.step]?.twin) return;
    const upp = twin.unitsPerPixel(), n = niceLength(90 * upp);
    $('#scalebar i').style.width = `${n.metres / upp}px`; $('#scalebar span').textContent = `${fmtNum(n.value)} ${n.unit}`;
    setFov(twin.fieldOfView());
  })();
  await checkLean();
  $('#ld-3').classList.add('ok'); $('#ld-num').textContent = '100';
  setTimeout(() => $('#loader').classList.add('done'), 300);
  loadBrainPeak();
  poll(); setInterval(poll, 10000); setInterval(() => checkLean(), 60000);
}
boot();
