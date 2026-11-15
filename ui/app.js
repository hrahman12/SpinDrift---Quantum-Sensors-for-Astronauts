// SpinDrift: one page. An astronaut wearing four quantum sensors; tap a sensor or scroll and the page dives through
// exact fields of view (2.00 m, 3.00 cm, 5.00 mm, 600 µm, 1.00 µm, 10.0 nm, 2.50 nm, 500 pm, 10.0 fm) to the quantum
// level. The place and exact spot you pick set the magnetic field and radiation context for all four sensors, and
// the Lean prover decides what each sensor can measure there. Every number comes from /data or the server.
import { $, $$, esc, D, S, fmtNum, toast, getJSON, postJSON, lean } from './core.js';
import { createTwin } from './twin.js';
import { createMicro, fovText, scaleLabel, niceLength } from './zoom.js';
import { createSensorView } from './sensorview.js';
import { sceneFor } from './outfit.js';
import { AREAS, LEGACY, areaOf, spotsOf } from './areas.js';
import { drawBoard, linkInfo } from './board.js';
import { unifiedHTML } from './unified.js';
import { SENSORS, DESCENTS } from './story.js';
import { seesaw, deciding, WORDS, MARK } from './leanphys.js';

const FOOTER = 'Live: space magnetic-field feeds (NOAA L1 magnetometer; ISS position with the IGRF model). Near-live: an optically pumped magnetometer in orbit (ESA Swarm). Recorded: real OPM brain and heart data, NV, quantum-dot and carbon-dot lab data, and Inspiration4 astronaut lab data from NASA OSDR. No public live feed exists from these sensors on a human in space. Not diagnostic.';
const FILES = ['palette', 'specs', 'physics', 'nv_heart_derived', 'nasa_i4', 'simulators', 'build_log', 'live_snapshot', 'runs', 'combined_sensor',
  'lean_proofs', 'math_checks', 'quantum_circuits', 'qbio_facts', 'sensor_parts/opm',
  'recorded/nv_odmr_zenodo10629041', 'recorded/qd_fret_figshare5468838', 'recorded/cqd_pl_mendeley_cmfbrvrb8y', 'recorded/eeg_brain_ds004902'];
const OLD_PLACES = { iss: 'ISS · low Earth orbit', gateway: 'Lunar Gateway · NRHO', lunar_base: 'Lunar surface base', mars_transit: 'Mars transit', mars_surface: 'Mars surface' };
const st = { sensor: 'nv', step: 0, verdicts: null, verdictErr: null, brainPeak: null, sex: 'male', scene: null, labels: false,
  // renin 2.0 pM and bilirubin 1.3 mg/dL are published population reference values (README), not measurements of anyone
  inputs: { shielding_factor: 1, beats_averaged: 47, snr_required: 3, build: 'jgu', target: 'r_peak', bandwidth_hz: 30, renin: 2.0, bilirubin_isf: 1.3 } };
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
  // ten areas, each with its own clothes and scene; the second menu lists the real exact spots inside the area
  selP.hidden = false;
  selP.innerHTML = AREAS.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
  const fill = () => {
    const a = AREAS.find((x) => x.id === selP.value) || AREAS[0], spots = spotsOf(a, P);
    const multi = new Set(spots.map((s) => s.id.split('.')[0])).size > 1;
    selS.innerHTML = spots.map((s) => `<option value="${esc(s.id)}">${esc(multi ? `${s.place_name} · ${s.sub_place}` : s.sub_place || s.id)}</option>`).join('');
  };
  const keep = subPlace(S.location) ? S.location : LEGACY[S.location] || null;
  selP.value = areaOf(keep || 'iss.destiny').id; fill();
  if (keep && [...selS.options].some((o) => o.value === keep)) selS.value = keep;
  S.location = selS.value;
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
    radiation: E?.radiation_context?.text || s?.radiation_context?.text || null, verdicts,
    // the same four numbers as the Lean cards, so every scene can answer to them
    inputs: { shielding_factor: shield, beats_averaged: st.inputs.beats_averaged, renin_pM: st.inputs.renin, bilirubin_isf: st.inputs.bilirubin_isf },
    lod_renin_pM: st.cond?.qd?.lod ?? null };
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
    const j = await getJSON('/data/recorded/opm_brain_mne.json'), ev = j.evoked; let best = 0;
    ev.series.forEach((s) => s.values.forEach((v) => { if (Math.abs(v) > best) best = Math.abs(v); }));
    st.brainPeak = { value: best }; renderCard(); renderLevel();
    // the live brain trace: one raw OPM channel, played back in real time, with a 1 s running mean taken out
    const fs = j.meta?.sample_rate_hz || 250, raw = j.series?.[0]?.values || [], k = Math.round(fs), hp = new Float32Array(raw.length);
    let acc = 0; for (let i = 0; i < raw.length; i++) { acc += raw[i]; if (i >= k) acc -= raw[i - k]; hp[i] = raw[i] - acc / Math.min(i + 1, k); }
    LIVE.brain = { v: hp, fs, name: j.series?.[0]?.name };
  } catch (e) { console.warn(e); }
}

// ------------------------------------------------------------------ tiny live traces beside each sensor (real recordings)
// brain: a raw OPM channel (MNE OPM sample) played back in real time · heart: the averaged OPM heartbeat of the Kiel
// recording, repeated, with its Q wave marked · blood: red cells streaming past (a picture, no numbers) · skin: a real
// astronaut's bilirubin across the Inspiration4 time points (NASA OSDR), stepped through
const LIVE = { brain: null, heart: null, skin: null };
function prepLive() {
  const ab = D.nv_heart_derived?.averaged_beat;
  if (ab?.pT?.length) {
    const sign = (ab.r_peak_pT?.value ?? 1) < 0 ? -1 : 1, v = ab.pT.map((x) => x * sign), qt = -(ab.q_wave_ms_before_r ?? 0) / 1000;
    let qi = 0; ab.t_s.forEach((t, i) => { if (Math.abs(t - qt) < Math.abs(ab.t_s[qi] - qt)) qi = i; });
    LIVE.heart = { v, dt: (ab.t_s[1] - ab.t_s[0]) || 0.005, qi };
  }
  const pts = (D.nasa_i4?.datasets?.[0]?.variables?.[0]?.points || []).filter((p) => typeof p.value?.value === 'number');
  if (pts.length) LIVE.skin = { v: pts.map((p) => p.value.value), tp: pts.map((p) => p.timepoint), unit: pts[0].value.unit || 'mg/dL' };
}
const LIVE_TITLE = { brain: 'Live: a raw brain recording from real OPM sensors (MNE OPM sample), played back in real time',
  heart: 'Live: the averaged heartbeat from real OPM chest sensors (Kiel Cardio Database); yellow dot = Q wave',
  blood: 'Red blood cells streaming past (a picture: no numbers)', skin: 'A real astronaut’s bilirubin across the Inspiration4 time points (NASA OSDR)' };
const liveCol = (site) => ({ brain: S.col?.opm, heart: S.col?.nv, blood: '#d0473c', skin: S.col?.cqd }[site] || '#9fe6ff');
function drawLive(cv, site, t) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height; g.clearRect(0, 0, W, H);
  g.lineWidth = Math.max(1, W / 90); g.strokeStyle = liveCol(site); g.fillStyle = liveCol(site); g.lineJoin = 'round';
  const line = (vals, lo, hi) => { g.beginPath(); vals.forEach((y, i) => { const X = (i / (vals.length - 1)) * W, Y = H - 3 - ((y - lo) / (hi - lo || 1)) * (H - 6); i ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.stroke(); };
  if (site === 'brain' && LIVE.brain) {                 // 3 s window scrolling at the recording's own pace
    const { v, fs } = LIVE.brain, n = Math.round(3 * fs), end = Math.floor((t * fs) % (v.length - n)) + n, win = Array.from(v.subarray(end - n, end));
    let lo = Infinity, hi = -Infinity; for (const y of win) { if (y < lo) lo = y; if (y > hi) hi = y; }
    line(win.filter((_, i) => i % 2 === 0), lo, hi);
  } else if (site === 'heart' && LIVE.heart) {          // two beats in view, the window slides at real time
    const { v, dt, qi } = LIVE.heart, per = v.length, n = per * 2, off = Math.floor((t / dt) % per), win = [];
    for (let i = 0; i < n; i++) win.push(v[(off + i) % per]);
    const lo = Math.min(...v), hi = Math.max(...v); line(win, lo, hi);
    for (let i = 0; i < n; i++) if ((off + i) % per === qi) { const X = (i / (n - 1)) * W, Y = H - 3 - ((win[i] - lo) / (hi - lo || 1)) * (H - 6); g.beginPath(); g.arc(X, Y, Math.max(1.6, W / 60), 0, 7); g.fillStyle = '#ffd36e'; g.fill(); }
  } else if (site === 'blood') {                        // red cells streaming through a vessel
    g.globalAlpha = 0.25; g.fillRect(0, H * 0.18, W, H * 0.64); g.globalAlpha = 1;
    for (let i = 0; i < 9; i++) { const X = ((i / 9) * W + t * W * 0.18 + (i % 3) * 7) % (W + 10) - 5, Y = H * (0.32 + 0.36 * (((i * 37) % 10) / 10)); g.beginPath(); g.ellipse(X, Y, W / 28, H / 7, 0.3, 0, 7); g.fill(); }
  } else if (site === 'skin' && LIVE.skin) {            // the astronaut's bilirubin, one time point every 1.5 s
    const { v } = LIVE.skin, lo = Math.min(...v) * 0.9, hi = Math.max(...v) * 1.1, k = Math.floor(t / 1.5) % v.length;
    line(v, lo, hi); const X = (k / (v.length - 1 || 1)) * W, Y = H - 3 - ((v[k] - lo) / (hi - lo || 1)) * (H - 6);
    g.beginPath(); g.arc(X, Y, Math.max(1.8, W / 50), 0, 7); g.fill();
  }
}
function attachLive() {        // a tiny canvas inside each body label (the labels are rebuilt with every figure)
  $$('#labels .twin-label').forEach((el) => {
    if (el.querySelector('canvas.mini-live')) return;
    const c = document.createElement('canvas'); c.className = 'mini-live'; c.width = 168; c.height = 40; c.dataset.live = el.dataset.site; el.appendChild(c);
  });
}
(function liveLoop() {
  requestAnimationFrame(liveLoop);
  if (document.hidden) return;
  const t = performance.now() / 1000;
  for (const cv of document.querySelectorAll('canvas.mini-live')) if (cv.offsetParent !== null) drawLive(cv, cv.dataset.live, t);
})();

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
    await conditions(); if (my !== checking) return;
  } catch (e) { if (my !== checking) return; st.verdictErr = window.SPINDRIFT_STATIC ? 'This public copy has Lean results for the menu settings and the reference values; other numbers need the live server.' : 'Lean could not check this spot yet.'; st.verdicts = null; st.cond = null; console.warn(e); }
  for (const s of SENSORS) twin?.setVerdict(s.site, mainCard(s.id)?.verdict || null);
  micro?.setEnv(env());
  renderCard(); renderLevel();
}

// ------------------------------------------------------------------ the one card (body level)
// Lean takes four numbers you can change, one per sensor; everything else comes from the data files and the place.
const SHIELDS = [1, 10, 100, 1000, 10000, 100000, 1000000];
// Each card has two sides: the body (biology numbers) on the left, the sensor hardware on the right, each hardware
// setting with a tiny picture that changes with it. An empty box means "use the recorded or published value".
const reqInput = (key, rid, sym) => st.verdicts?.verdicts?.[key]?.requirements?.find((r) => r.id === rid)?.inputs?.find((x) => x.symbol === sym);
const BIO = {
  opm: [{ k: 'brain_signal_fT', label: 'Brain signal', unit: 'fT', ph: () => reqInput('opm_brain', 'opm_snr_brain', 'A')?.value },
    { k: 'brain_trials', label: 'Responses averaged', unit: '', ph: () => reqInput('opm_brain', 'opm_snr_brain', 'N')?.value }],
  nv: [{ k: 'target', label: 'Part of the beat', options: [['r_peak', 'big spike (R)'], ['q_wave', 'small dip (Q)']] },
    { k: 'beats_averaged', label: 'Heartbeats averaged', unit: '' }],
  qd: [{ k: 'renin', label: 'Renin (published reference)', unit: 'pM', ph: () => 'not measured' }],
  cqd: [{ k: 'bilirubin_isf', label: 'Bilirubin (adult reference)', unit: 'mg/dL', ph: () => 'not measured' }],
};
const etaNV = (b) => D.specs?.nv?.[b]?.sensitivity?.value ?? null;
const HWIN = {
  opm: [{ k: 'shielding_factor', label: 'Magnetic shield', options: SHIELDS.map((v) => [v, `× ${v.toLocaleString('en-US')}`]), vis: (v) => shieldSvg(+v) },
    { k: 'bandwidth_hz', label: 'Bandwidth', unit: 'Hz', vis: (v) => bandSvg(+v) }],
  nv: [{ k: 'build', label: 'Diamond build', options: [['jgu', 'JGU'], ['zaquant', 'ZAQuant'], ['qant', 'Q.ANT']], vis: (v) => buildSvg(v) },
    { k: 'nv_bandwidth_hz', label: 'Bandwidth', unit: 'Hz', ph: () => D.specs?.nv?.headline?.bandwidth_assumed?.value, vis: (v) => bandSvg(+v || D.specs?.nv?.headline?.bandwidth_assumed?.value || 30) }],
  qd: [{ fixed: 'Read by a TIRF microscope (fixed by the paper)', vis: () => tirfSvg() }],
  cqd: [{ fixed: 'Reader light 440 · 470 · 510 nm (fixed by the paper)', vis: () => ledSvg([440, 470, 510]) }],
};
function field(f) {
  const v = st.inputs[f.k];
  if (f.options) return `<select data-in="${f.k}">${f.options.map(([o, t]) => `<option value="${o}" ${String(o) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  const ph = f.ph?.(); return `<input data-in="${f.k}" type="number" min="0" step="any" value="${v ?? ''}" placeholder="${esc(ph === undefined || ph === null ? '' : typeof ph === 'number' ? fmtNum(ph) : ph)}">`;
}
function sidesFor(id) {
  const bio = BIO[id].map((f) => `<label class="fld"><span>${esc(f.label)}${f.unit ? ` <small>${esc(f.unit)}</small>` : ''}</span>${field(f)}</label>`).join('');
  const hw = HWIN[id].map((f) => (f.fixed ? `<div class="fld fixed">${f.vis()}<span>${esc(f.fixed)}</span></div>`
    : `<label class="fld">${f.vis(st.inputs[f.k] ?? f.ph?.())}<span>${esc(f.label)}${f.unit ? ` <small>${esc(f.unit)}</small>` : ''}</span>${field(f)}</label>`)).join('');
  return `<div class="s-sides" data-stop><div class="side"><div class="side-h">Body</div>${bio}</div><div class="side hw"><div class="side-h">Sensor</div>${hw}</div></div>`;
}
// tiny pictures for the hardware side
function shieldSvg(S) {      // one wall per factor of ten of shielding
  const n = Math.max(0, Math.min(6, Math.round(Math.log10(S || 1)))); let w = '';
  for (let i = n - 1; i >= 0; i--) { const dx = 4 + i * 3, dy = 3 + i * 1.8; w += `<rect x="${24 - 5 - dx}" y="${14 - 4 - dy}" width="${10 + 2 * dx}" height="${8 + 2 * dy}" rx="2" fill="none" stroke="#9fb3c8" stroke-opacity="${0.95 - i * 0.12}"/>`; }
  return `<svg viewBox="0 0 48 28" class="hwv">${w}<rect x="19" y="10" width="10" height="8" rx="1.5" fill="#eef0e8"/><rect x="22.5" y="12.5" width="3" height="3" fill="var(--opm)"/></svg>`;
}
function bandSvg(bw) {       // the band the sensor listens to: wider bandwidth lets in more noise
  const x = 6 + 32 * Math.min(1, Math.max(0, Math.log10(Math.max(1, bw || 1)) / 2));
  return `<svg viewBox="0 0 48 28" class="hwv"><path d="M3 23 H45" stroke="#4a5266"/><path d="M3 8 H${x.toFixed(1)} C ${(x + 4).toFixed(1)} 8 ${(x + 5).toFixed(1)} 23 ${(x + 9).toFixed(1)} 23 H45" fill="none" stroke="#9fe6ff" stroke-width="1.6"/><text x="${Math.min(x, 34).toFixed(1)}" y="6" style="font:6px var(--mono);fill:#8a93a3">${esc(fmtNum(+bw))}</text></svg>`;
}
function buildSvg(b) {       // the diamond and its noise (sensitivity from Omar et al., Table 2): a shorter bar is quieter
  const e = etaNV(b), L = e ? Math.min(30, (e / 26) * 30) : 0;
  return `<svg viewBox="0 0 48 28" class="hwv"><path d="M9 7 l5 7 -5 7 -5 -7 z" fill="#c9d6e3" stroke="#e8f0f8" stroke-width=".6"/><circle cx="9" cy="14" r="1.2" fill="var(--nv)"/><rect x="17" y="12" width="${L.toFixed(1)}" height="4" rx="1" fill="#e9b44c"/><text x="17" y="9" style="font:6px var(--mono);fill:#8a93a3">${e ? `${e} pT/√Hz` : 'not stated'}</text></svg>`;
}
function tirfSvg() {         // total internal reflection: light skims the glass and lights only molecules on its surface
  return '<svg viewBox="0 0 48 28" class="hwv"><path d="M4 9 H44" stroke="#c9d6e3"/><path d="M16 26 L20 13 H28 L32 26 Z" fill="#59647a"/><path d="M6 20 L24 9 L42 20" fill="none" stroke="#7fe3d0" stroke-width="1.2"/><circle cx="20" cy="7" r="1.6" fill="#ff6a4d"/><circle cx="28" cy="7" r="1.6" fill="#ff6a4d"/></svg>';
}
function wlColor(nm) {       // visible wavelength to a display colour (a common piecewise approximation)
  let r = 0, g = 0, b = 0;
  if (nm < 440) { r = (440 - nm) / 60; b = 1; } else if (nm < 490) { g = (nm - 440) / 50; b = 1; } else if (nm < 510) { g = 1; b = (510 - nm) / 20; } else if (nm < 580) { r = (nm - 510) / 70; g = 1; } else if (nm < 645) { r = 1; g = (645 - nm) / 65; } else r = 1;
  return `rgb(${Math.round(255 * r)},${Math.round(255 * g)},${Math.round(255 * b)})`;
}
function ledSvg(list) { return `<svg viewBox="0 0 48 28" class="hwv">${list.map((nm, i) => `<circle cx="${10 + i * 14}" cy="13" r="4.5" fill="${wlColor(nm)}"/><text x="${10 + i * 14}" y="25" text-anchor="middle" style="font:5.5px var(--mono);fill:#8a93a3">${nm}</text>`).join('')}</svg>`; }
// Under what condition each sensor works here: Lean's own inequality rearranged for the one number you control,
// then sent back to Lean with that number to confirm.
async function conditions() {
  const v = st.verdicts?.verdicts; if (!v) { st.cond = null; return; }
  const req = (key, id) => (v[key]?.requirements || []).find((r) => r.id === id);
  const dec = (x) => { const n = parseFloat(x?.decimal); return Number.isFinite(n) ? n : null; };
  const I = st.inputs, want = { ...I }, cond = {}, nvKey = `nv_heart_${I.build}`;
  const f = req('opm_brain', 'opm_field_nulled'), fL = dec(f?.lhs), fR = dec(f?.rhs);     // B ≤ B_comp × S
  if (fL !== null && fR) { const sMin = (fL * (I.shielding_factor || 1)) / fR; cond.opm = { sMin, shield: SHIELDS.find((x) => x >= sMin) ?? null }; if (cond.opm.shield) want.shielding_factor = cond.opm.shield; }
  const q = req(nvKey, 'nv_snr'), qL = dec(q?.lhs), qR = dec(q?.rhs);                     // snr²·η²·BW ≤ A²·N
  if (qL !== null && qR) { cond.nv = { beats: Math.max(1, Math.ceil((qL * (I.beats_averaged || 1)) / qR)) }; want.beats_averaged = cond.nv.beats; }
  const b = req('qd_blood', 'qd_renin_above_lod'); cond.qd = { lod: dec(b?.lhs), unit: b?.lhs?.unit || 'pM' };   // LOD ≤ c
  const rng = D.specs?.cqd_patch?.range;                                                    // the patch's stated range (SI Table S1)
  cond.cqd = { range: rng?.status === 'VERIFIED' ? rng : null };
  st.cond = cond;
  try {
    const r = await postJSON('/api/verdict', { location: S.location, inputs: want });
    if (cond.opm) cond.opm.lean = r.verdicts?.opm_brain?.verdict;
    if (cond.nv) cond.nv.lean = r.verdicts?.[nvKey]?.verdict;
  } catch { /* the rearranged number still shows, without Lean's confirmation */ }
}
// the exact values Lean compared for one sensor: what it has here against what it needs, with units
function needRows(card) {
  if (!card) return '';
  const all = card.requirements || [], inp = (r, sym) => r?.inputs?.find((x) => x.symbol === sym);
  // a factor's number: its value, or else the exact fraction Lean was given (for example '<15 fT/√Hz' is sent as 15/1)
  const n = (x) => { if (typeof x?.value === 'number' && Number.isFinite(x.value)) return x.value; const m = /^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(String(x?.lean_factor ?? '')); return m ? +m[1] / +m[2] : null; };
  const p3 = (v) => fmtNum(+v.toPrecision(3));
  const rows = [];
  for (const r of all) {
    if (r.id === 'cqd_range_high') continue;              // shown together with the low end below
    let name, have, need, holds = r.holds;
    if (r.id === 'opm_field_nulled') {
      const B = n(inp(r, 'B_ambient')), C = n(inp(r, 'B_comp')), S = n(inp(r, 'S'));
      name = 'field at the sensor'; have = B !== null && S ? `${p3(B / S)} nT` : 'not known'; need = C !== null ? `≤ ${fmtNum(C)} nT` : '≤ ?';
    } else if (/snr/.test(r.id)) {
      const A = n(inp(r, 'A')), N = n(inp(r, 'N')), e = n(inp(r, 'η')), BW = n(inp(r, 'BW')), s = n(inp(r, 'snr'));
      name = 'signal ÷ noise'; have = A !== null && N !== null && e && BW ? p3((Math.abs(A) * Math.sqrt(N)) / (e * Math.sqrt(BW))) : 'not known'; need = s !== null ? `≥ ${fmtNum(s)}` : '≥ ?';
    } else if (r.id === 'qd_renin_above_lod') {
      const L = inp(r, 'LOD'), c = inp(r, 'c_renin');
      name = 'renin in the sample'; have = n(c) !== null ? `${fmtNum(n(c))} ${c.unit || ''}` : 'not measured'; need = n(L) !== null ? `≥ ${fmtNum(n(L))} ${L.unit || ''}` : '≥ ?';
    } else if (r.id === 'cqd_range_low') {
      const hi = all.find((x) => x.id === 'cqd_range_high'), c = inp(r, 'c_bilirubin'), lo = n(inp(r, 'range_low')), up = n(inp(hi, 'range_high'));
      name = 'bilirubin in skin fluid'; have = n(c) !== null ? `${fmtNum(n(c))} ${c.unit || ''}` : 'not measured';
      need = lo !== null && up !== null ? `${fmtNum(lo)} to ${fmtNum(up)}` : 'range not public';
      holds = r.holds === false || hi?.holds === false ? false : r.holds === true && hi?.holds === true ? true : null;
    } else { name = r.id; have = r.lhs?.decimal ?? '?'; need = `≤ ${r.rhs?.decimal ?? '?'}`; }
    const v = holds === true ? 'REQUIREMENTS_MET' : holds === false ? 'NOT_MET' : 'NEED_MORE_INFORMATION';
    rows.push(`<div class="nrow"><span>${esc(name)}</span><b>${esc(have)}</b><i>${esc(need)}</i><em class="v-${v}">${MARK[v]}</em></div>`);
  }
  return rows.join('');
}
function condLine(id) {
  const c = st.cond?.[id], ok = (x) => (x === 'REQUIREMENTS_MET' ? ' <span class="lean-ok">Lean ✓</span>' : '');
  if (!c) return '';
  if (id === 'opm') return c.shield ? `Works here with a shield of × ${c.shield.toLocaleString('en-US')} or more.${ok(c.lean)}` : `Needs a shield over × ${Math.round(c.sMin).toLocaleString('en-US')}.`;
  if (id === 'nv') return `Works from ${c.beats.toLocaleString('en-US')} heartbeats averaged.${ok(c.lean)}`;
  if (id === 'qd') return c.lod !== null ? `Works when renin is at least ${fmtNum(c.lod)} ${esc(c.unit)}.` : '';
  return c.range ? `Works when bilirubin is within ${esc(c.range.value)} ${esc(c.range.unit || '')}, the patch’s stated range.` : 'Needs the patch’s detection range.';
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
      <div class="s-head"><span class="s-name"><i class="dotc ${s.color}"></i>${esc(s.name)}</span><canvas class="mini-live" data-live="${s.site}" width="150" height="36" title="${esc(LIVE_TITLE[s.site])}"></canvas></div>
      <div class="s-site">${esc(s.kind)}</div>
      <div class="s-main"><div><div class="s-val">${r.value === null || r.value === undefined ? '<span class="na">no value</span>' : `<span>${esc(fmtNum(r.value))}</span><small>${esc(r.unit || '')}</small>`}</div><div class="s-lbl">${esc(r.label)}</div></div>
        ${c ? seesaw(req, c.verdict, { size: 'sm' }) : ''}</div>
      <div class="s-verdict ${c ? `v-${c.verdict}` : ''}">${c ? `${MARK[c.verdict]} ${esc(WORDS[c.verdict])}` : esc(st.verdictErr || 'Lean is checking…')}</div>
      <div class="s-need">${needRows(c)}</div>
      <div class="s-cond">${condLine(s.id)}</div>
      ${sidesFor(s.id)}</div>`;
  });
  if (st.step > 0) { const k = SENSORS.findIndex((s) => s.id === st.sensor); if (k > 0) rows.unshift(...rows.splice(k, 1)); }   // diving: your sensor's card first
  $('#card-lean').innerHTML = `<div class="lean-head">What Lean says<span>${esc(whereText())}</span></div>
    <div class="theorem"><div class="th-tag">⊢ every signal a theorem</div>
      <div class="th-code"><span class="kw">theorem</span> monitor (${SENSORS.map(word).join(' ')} : <span class="ty">Sensor</span>)<br>&nbsp;&nbsp;at <span class="here">${esc(whereText())}</span></div>
      <div class="th-sub">Lean × Quantum × Astrobiology</div></div>
    <p class="card-say">Field here <b>${E.B_nT === null ? 'not known' : `${fmtNum(E.B_nT)} nT`}</b>${E.B_tag ? ` <span class="chip">${esc(E.B_tag)}</span>` : ''} · Lean checks each sensor · tap one to dive.</p>
    ${rows.join('')}
    <div class="footer-text">${runs} runs · all-in-one v${esc(comb.version ?? 0)} · <button class="linkish" id="go-hw">Hardware ›</button></div>`;
  $$('#card .srow').forEach((el) => el.addEventListener('click', (e) => { if (e.target.closest('[data-stop]')) return; selectSensor(el.dataset.sensor); goStep(1); }));
  $$('#card .th-code [data-sensor]').forEach((el) => el.addEventListener('click', () => { selectSensor(el.dataset.sensor); goStep(1); }));
  wireInputs($('#card'));
  $('#go-hw')?.addEventListener('click', () => showTab('hw'));
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
const roText = (x) => `${typeof x.value === 'number' ? fmtNum(x.value) : x.value ?? '—'}`;
const roRow = (x, k) => `<div class="mrow" data-ro="${k}" title="${esc([x.label, x.tag, x.source].filter(Boolean).join(' · '))}"><span>${esc(x.plain || x.label)}</span><b>${esc(roText(x))} <small>${esc(x.plainUnit ?? x.unit ?? '')}</small></b></div>`;
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
// what you are looking at, in the right column above Lean's cards. No sliders of its own: the scene answers to the
// place and to the same four numbers as the Lean cards below it.
function renderLevel() {
  const ch = chain(), i = st.step, lv = ch[i], box = $('#card-level');
  $('#hud').hidden = i === 0;
  if (i === 0 || !lv) { box.innerHTML = ''; drawGene(null); return; }
  const E = env(), cur = micro?.current, built = lv.file && cur?.file === fileOf(lv) ? cur.built : null;
  const ro = (built?.readouts || []).map((x, k) => [x, k]).filter(([x]) => x.tag !== 'simulated'), info = built?.info || {};
  const open = box.querySelector('details.more')?.open;
  box.innerHTML = `<div class="lvl">Level ${i + 1} of ${ch.length} · ${lv.fov ? esc(scaleLabel(lv.fov)) : 'no ruler at this level'}</div><h3>${esc(lv.title)}</h3>
    ${lv.say.map((t) => `<p>${esc(t)}</p>`).join('')}${lv.brainRatio ? brainRatio(E) : ''}
    ${lv.qb ? `<p class="qb">${esc(lv.qb)}</p>` : ''}
    ${lv.env ? hereLine(lv.env, E) : ''}
    <details class="more" ${open ? 'open' : ''}><summary>More</summary>
      ${ro.map(([x, k]) => roRow(x, k)).join('')}
      ${lv.cells ? cellsGenes(sensor().site) : ''}
      ${(info.lines || []).map((t) => `<p>${esc(t)}</p>`).join('')}
      ${(info.lean || []).length ? `<div class="lean-row">${info.lean.map((n) => lean(n)).join('')}</div>` : ''}
      <div class="src">${[lv.src, lv.twin ? TWIN_SRC[lv.twin] : null, ...(info.sources || [])].filter(Boolean).map(esc).join('<br>')}</div>
      <div class="btnrow"><button class="ghost" id="go-specs">This device on the Hardware tab</button></div></details>`;
  $('#go-specs')?.addEventListener('click', () => showView(st.sensor));
  drawGene(built?.gene);
}
function refreshReadouts() {
  const ro = micro?.current?.built?.readouts || [];
  $$('#card-level [data-ro]').forEach((el) => { const x = ro[+el.dataset.ro]; if (x) el.querySelector('b').innerHTML = `${esc(roText(x))} <small>${esc(x.plainUnit ?? x.unit ?? '')}</small>`; });
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
  } catch (e) { console.warn(e); fovTween = null; toast(`This level is still being built (${e.message}).`, 5000); if (ch[st.step]?.twin) twin?.view(ch[st.step].twin); }
  busy = false;
  document.body.classList.toggle('sensor-mode', st.step > 0);
  for (const el of [$('#stage'), $('#card')]) el.style.setProperty('--depth', (st.step / (ch.length - 1)).toFixed(3));
  $('#stage').classList.toggle('at-body', st.step === 0);
  renderRail(); renderLevel(); renderCard();
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
  $('#labels').innerHTML = ''; $('#leaders').innerHTML = ''; $('#twin-notes').innerHTML = '';
  const sc = sceneFor(S.location); st.scene = sc; $('#stage').dataset.bg = sc.backdrop;
  twin = await createTwin({ canvas: fresh, labelsEl: $('#labels'), leadersEl: $('#leaders'), notesEl: $('#twin-notes'), sites: SENSORS.map((s) => ({ id: s.site, name: s.name, sensor: s.kind })),
    colors: { opm: S.col.opm, nv: S.col.nv, cqd: S.col.cqd }, opm: opmGeom(), sex: st.sex, outfit: sc.outfit, backdrop: sc.backdrop,
    onSelect: (site) => { const s = SENSORS.find((x) => x.site === site); if (s) { selectSensor(s.id); goStep(1); } },
    onEdge: (d) => step(d === 'in' ? 1 : -1), onProgress });
  twin.select(sensor().site); attachLive();
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

// ------------------------------------------------------------------ tabs: "Does it work?" and "Hardware"
let hwDev = 'opm';
const HW = [['opm', 'Brain sensor', 'QuSpin QZFM Gen-3'], ['nv', 'Heart sensor', 'NV diamond · JGU, ZAQuant, Q.ANT'], ['qd', 'Blood sensor', 'quantum-dot renin probe'], ['cqd', 'Skin sensor', 'carbon-dot patch']];
const hwBuilt = {};
function showTab(t, dev) {
  $$('.view').forEach((el) => el.classList.toggle('on', el.id === `view-${t}`));
  $$('#tb-nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  if (t === 'hw') { if (dev) hwDev = dev; renderHardware(); }
  if (t === 'one') renderUnified();
}
function renderUnified() {
  const comb = S.combined || D.combined_sensor || {}, runs = S.runs?.runs || D.runs?.runs || [];
  $('#view-one').innerHTML = unifiedHTML({ summary: comb.lean_summary, combined: comb, runs, specs: D.specs });
}
// the board: every run adds what it measured and what Lean proved; scrub the timeline or play the build
let boardUpto = null, boardSeen = new Set(), boardMods = null, boardPlay = null;
function renderBoard() {
  const host = $('#hw-svg'); if (!host) return;
  const runs = S.runs?.runs || D.runs?.runs || [];
  if (boardUpto === null || boardUpto > runs.length - 1) boardUpto = runs.length - 1;
  const { svg, keys, mods } = drawBoard({ build: st.inputs.build, runs, upto: boardUpto, seen: boardSeen });
  host.innerHTML = svg; boardSeen = keys; boardMods = mods;
  const r = runs[boardUpto];
  $('#hw-step').max = Math.max(0, runs.length - 1); $('#hw-step').value = boardUpto;
  $('#hw-step-l').textContent = r ? `run ${boardUpto + 1} of ${runs.length} · ${r.environment?.sub_place || r.location_id || r.location} · ${r.lean?.checks ? 'Lean checked' : 'no Lean record'}` : 'no runs yet';
}
function renderHardware() {
  const el = $('#view-hw');
  if (!el.dataset.ready) {
    el.dataset.ready = '1';
    el.innerHTML = `<div class="hw-head"><h2>Hardware</h2><span>the four real devices, wired part by part · each run adds what it measured and what Lean proved</span></div>
      <section class="hw-board"><div class="hw-board-bar"><button class="ghost" id="hw-play">Play the build</button><input type="range" id="hw-step" min="0" max="0" step="1"><span id="hw-step-l"></span><button class="ghost" id="hw-run">＋ Run here</button></div>
        <div id="hw-svg"></div><div class="hw-inspect" id="hw-inspect" hidden></div></section>
      <div class="hw-devs">${HW.map(([id, n, k]) => `<button data-dev="${id}"><i class="dotc ${id}"></i><b>${esc(n)}</b><small>${esc(k)}</small></button>`).join('')}</div>
      <div class="hw-main">${HW.map(([id]) => `<div class="hw-pair" id="hwp-${id}" hidden><div class="st-view" id="hwv-${id}"><div class="sv-empty">Loading the exact-spec model…</div></div><aside class="st-side" id="hws-${id}"></aside></div>`).join('')}</div>
      <section class="hw-all" id="hw-all"></section>`;
    $$('#view-hw .hw-devs button').forEach((b) => b.addEventListener('click', () => { hwDev = b.dataset.dev; renderHardware(); }));
    $('#hw-step').addEventListener('input', (e) => { boardUpto = +e.target.value; renderBoard(); });
    $('#hw-run').addEventListener('click', doRun);
    $('#hw-play').addEventListener('click', () => {
      if (boardPlay) { clearInterval(boardPlay); boardPlay = null; $('#hw-play').textContent = 'Play the build'; return; }
      const n = (S.runs?.runs || D.runs?.runs || []).length; boardUpto = 0; boardSeen = new Set(); renderBoard(); $('#hw-play').textContent = 'Stop';
      boardPlay = setInterval(() => { if (boardUpto >= n - 1) { clearInterval(boardPlay); boardPlay = null; $('#hw-play').textContent = 'Play the build'; return; } boardUpto++; renderBoard(); }, 1100);
    });
    $('#hw-svg').addEventListener('click', (e) => {
      const g = e.target.closest('[data-link]'), box = $('#hw-inspect');
      if (!g) { box.hidden = true; return; }
      const info = linkInfo(boardMods, g.dataset.link); if (!info) return;
      box.hidden = false;
      box.innerHTML = `<b>${esc(info.title)}</b>${info.lines.map((t) => `<p>${esc(t)}</p>`).join('')}${info.src ? `<p class="src">${esc(info.src)}</p>` : ''}`;
    });
  }
  renderBoard();
  $$('#view-hw .hw-devs button').forEach((b) => b.classList.toggle('on', b.dataset.dev === hwDev));
  for (const [id] of HW) $(`#hwp-${id}`).hidden = id !== hwDev;
  if (!hwBuilt[hwDev]) {
    const id = hwDev;
    hwBuilt[id] = createSensorView($(`#hwv-${id}`), $(`#hws-${id}`), id)
      .catch((e) => { console.warn(e); $(`#hwv-${id}`).innerHTML = `<div class="sv-empty">The exact-spec model could not be drawn.<br><span class="src">${esc(e.message)}</span></div>`; });
  }
  renderAllInOne();
}
// the all-in-one: every run adds the facts it measured or Lean decided at that spot; nothing here is typed in by hand
const vText = (v) => (v && typeof v === 'object' && 'value' in v ? `${typeof v.value === 'number' ? fmtNum(v.value) : v.value ?? '—'}${v.unit && typeof v.value === 'number' ? ` ${v.unit}` : ''}` : String(v ?? '—'));
function renderAllInOne() {
  const box = $('#hw-all'); if (!box) return;
  const comb = S.combined || D.combined_sensor || {}, runs = S.runs?.runs || D.runs?.runs || [];
  const checks = comb.lean_summary?.checks || {}, spotName = (id) => subPlace(id)?.sub_place || id;
  const CHECK = { opm_brain: 'Brain · OPM', opm_heart: 'Heart · OPM', nv_heart_jgu: 'Heart · NV JGU', nv_heart_zaquant: 'Heart · NV ZAQuant', nv_heart_qant: 'Heart · NV Q.ANT', qd_blood: 'Blood · quantum dot', cqd_skin: 'Skin · carbon dots' };
  const COND = { shielding_factor_needed: 'shield needed', heartbeats_needed: 'heartbeats needed' };
  const leanRows = Object.entries(checks).map(([k, x]) => [CHECK[k] || k, { works: x.works, not_met: x.does_not_work, needs_info: x.needs_a_number,
    strictest: x.strictest?.value ? `${COND[x.strictest.condition] || x.strictest.condition}: ${vText(x.strictest.value)} · ${spotName(x.strictest.location_id)}` : null }]);
  box.innerHTML = `<div class="hw-all-head"><h3>Every fact the runs added</h3><span>all-in-one v${esc(comb.version ?? 0)} · ${runs.length} runs</span></div>
    <div class="hw-runs">${runs.slice(-14).map((r) => `<span class="chip" title="${esc(r.run_id || '')}">${esc(r.location?.sub_place || r.location?.id || r.location || '')}</span>`).join('') || '<span class="na">no runs yet</span>'}</div>
    ${leanRows.length ? `<div class="hw-lean">${leanRows.map(([k, x]) => `<div class="hw-lrow"><b>${esc(k)}</b><span><i class="v-REQUIREMENTS_MET">✓ ${x.works?.length ?? 0}</i> · <i class="v-NOT_MET">✗ ${x.not_met?.length ?? 0}</i> · <i class="v-NEED_MORE_INFORMATION">? ${x.needs_info?.length ?? 0}</i> places</span>${x.strictest ? `<em>${esc(x.strictest)}</em>` : ''}</div>`).join('')}</div>` : ''}
    <div class="hw-comps">${Object.entries(comb.components || {}).map(([name, c]) => { const f = (c.facts || []).filter((x) => x.value?.tag !== 'simulated'); if (!f.length) return ''; return `<div class="hw-comp"><b>${esc(name)}</b>${f.slice(-4).map((x) => `<div class="hw-fact"><span>${esc(x.fact)}</span><em>${esc(vText(x.value))}</em></div>`).join('')}${f.length > 4 ? `<small>+${f.length - 4} more</small>` : ''}</div>`; }).join('')}</div>
    ${(comb.open_questions || []).length ? `<div class="hw-open"><b>Still open</b>${comb.open_questions.map((q) => `<p>${esc(q)}</p>`).join('')}</div>` : ''}`;
}

// ------------------------------------------------------------------ runs, polling, sources
async function doRun() {
  const btn = $('#hw-run'); if (btn) { btn.disabled = true; btn.textContent = 'Running…'; }
  try {
    const j = await postJSON('/api/run', { location: S.location, role: 'crew', inputs: st.inputs });   // the same numbers Lean is using on the cards
    S.combined = j.combined; S.runs = await getJSON('/api/runs').catch(() => S.runs);
    boardUpto = null;          // jump to the newest run: its parts and proofs draw in
    toast(`${j.run.run_id}: ${j.run.adds_to_combined.length} facts added to the all-in-one.`, 5000);
  } catch (e) { toast(/503/.test(e.message) ? 'New runs are recorded by the local SpinDrift server. This public page shows the stored runs.' : `Run failed: ${e.message}`, 6000); }
  if (btn) { btn.disabled = false; btn.textContent = '＋ Run here'; }
  renderCard(); renderAllInOne(); renderBoard();
}
async function poll() {
  try { S.health = await getJSON('/api/health'); $('#tb-status').classList.add('ok'); $('#tb-status span').textContent = S.health?.static ? 'public copy · stored Lean results' : S.health?.public ? 'public · Lean live' : 'live'; }
  catch { $('#tb-status').classList.remove('ok'); $('#tb-status span').textContent = 'saved data'; }
  try { S.live = await getJSON('/api/live'); } catch { /* snapshot */ }
  try { const L = await getJSON('/api/locations'); if (Array.isArray(L?.places)) D.locations = L; } catch { /* file copy */ }
  try { S.combined = await getJSON('/api/combined'); S.runs = await getJSON('/api/runs'); } catch { /* files */ }
}
const showView = (v) => (v === 'body' ? showTab('body') : showTab('hw', v));   // a sensor's specs live on the Hardware tab
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
  applyPalette(); setupPlaces(); prepLive();
  $('#location').addEventListener('change', onPlaceChange);
  $$('#tb-nav button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
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
    // zooming in on the astronaut past a certain point starts the dive into the chosen sensor
    if (st.step === 0 && !busy && !fovTween && twin.fieldOfView() < 0.45) goStep(1);
  })();
  await checkLean();
  $('#ld-3').classList.add('ok'); $('#ld-num').textContent = '100';
  setTimeout(() => $('#loader').classList.add('done'), 300);
  loadBrainPeak();
  poll(); setInterval(poll, 10000); setInterval(() => checkLean(), 60000);
}
boot();
