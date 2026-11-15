// SpinDrift UI. Main page: the giant quantum-sensor body (zoomable from 1 m to below 1 nm) and one card with the four
// sensors, their key readouts and Lean's verdicts on your inputs. Then one tab per sensor with its exact-spec 3D model.
// Every number comes from /data or the server; nothing here invents values. Lean, not this file, decides the verdicts.
import { $, $$, esc, D, S, fmtNum, chips, toast, getJSON, postJSON, lean, age } from './core.js';
import { createTwin } from './twin.js';
import { createMicro, CHAINS, LEVEL_NAMES, niceLength, fovText } from './zoom.js';
import { createSensorView } from './sensorview.js';
import { tabBelow, TAB_HEAD } from './tabs.js';
import { sceneFor } from './outfit.js';

const FOOTER = 'Live: space magnetic-field feeds (NOAA L1 magnetometer; ISS position with the IGRF model). Near-live: an optically pumped magnetometer in orbit (ESA Swarm). Recorded: real OPM brain and heart data, NV, quantum-dot and carbon-dot lab data, and Inspiration4 astronaut lab data from NASA OSDR. Simulated: online simulators, labelled. No public live feed exists from these sensors on a human in space. Not diagnostic.';

const SITES = [
  { id: 'brain', name: 'Brain', sensor: 'OPM ×9', tab: 'opm', title: 'Optically pumped magnetometer', model: 'QuSpin QZFM Gen-3', color: 'opm', verdict: ['opm_brain'] },
  { id: 'heart', name: 'Heart', sensor: 'NV diamond + OPM ×4', tab: 'nv', title: 'NV-diamond magnetometer', model: 'JGU · ZAQuant · Q.ANT builds', color: 'nv', verdict: ['nv_heart_{build}', 'opm_heart'] },
  { id: 'blood', name: 'Blood', sensor: 'QD renin assay', tab: 'qd', title: 'Quantum-dot renin nanosensor', model: 'QD–peptide–Cy5 FRET · TIRF readout', color: 'qd', verdict: ['qd_blood'] },
  { id: 'skin', name: 'Skin', sensor: 'carbon-dot patch', tab: 'cqd', title: 'Carbon-dot microneedle patch', model: 'bilirubin · blue light · IoT reader', color: 'cqd', verdict: ['cqd_skin'] },
];
const FILES = ['palette', 'specs', 'physics', 'clinical_card', 'nv_heart_derived', 'nasa_i4', 'simulators', 'build_log', 'live_snapshot',
  'runs', 'combined_sensor', 'lean_proofs', 'math_checks', 'quantum_circuits', 'qbio_facts', 'references', 'sensor_parts/opm',
  'recorded/nv_odmr_zenodo10629041', 'recorded/qd_fret_figshare5468838', 'recorded/cqd_pl_mendeley_cmfbrvrb8y', 'recorded/eeg_brain_ds004902'];
const LV = ['body', 'organ', 'cell', 'molecule', 'quantum'];
const LV_SCALE = { body: '1 m', organ: '10 cm', cell: 'µm', molecule: 'nm', quantum: '< 1 nm' };
const st = { site: 'heart', level: 'body', verdicts: null, lean: null, brainPeak: null, verdictErr: null };
let twin = null, micro = null;

// ------------------------------------------------------------------ loading
async function loadAll() {
  let done = 0; const num = $('#ld-num'); $('#ld-1').classList.add('on');
  await Promise.all(FILES.map(async (f) => {
    try { D[f] = await getJSON(`/data/${f}.json`); } catch (e) { D[f] = null; console.warn(e.message); }
    done++; num.textContent = String(Math.round((done / FILES.length) * 55)).padStart(2, '0');
  }));
  $('#ld-1').classList.add('ok');
}
function applyPalette() {
  const cols = D.palette?.colours || [];
  const pick = (dev, wl) => cols.find((c) => c.device === dev && (!wl || c.wavelength?.value === wl))?.colour?.value;
  const root = document.documentElement.style;
  const opm = pick('opm'), nv = pick('nv'), cqd = pick('cqd_patch', 439), reader = pick('cqd_patch', 470);
  if (opm) root.setProperty('--opm', opm); if (nv) root.setProperty('--nv', nv); if (cqd) root.setProperty('--cqd', cqd); if (reader) root.setProperty('--reader', reader);
  S.col = { opm: opm || '#ff0000', nv: nv || '#ff0000', cqd: cqd || '#6200ff', reader: reader || '#002dff', qd: '#9aa08f', ink: '#1d1d1b', dim: '#6d6a5f' };
}

// OPM housing and vapour cell for the body twin, from the exact-spec data (QuSpin Gen-3.0 drawing)
function opmGeom() {
  const c = D['sensor_parts/opm']?.components; if (!c?.housing?.size || !c?.cell?.centre) return null;
  const v = (q) => (q && typeof q === 'object' && 'value' in q ? q.value : q);
  const hs = c.housing.size, cs = c.cell.size, cc = c.cell.centre;
  const g = { w: v(hs.x), h: v(hs.y), d: v(hs.z), cell: [v(cc.x), v(cc.y), v(cc.z)], cellSize: [v(cs.x), v(cs.y), v(cs.z)] };
  return [g.w, g.h, g.d, ...g.cell, ...g.cellSize].every((x) => typeof x === 'number') ? g : null;
}

// ------------------------------------------------------------------ key readouts (all from data files)
function keyReadout(site) {
  if (site === 'brain') {
    const p = st.brainPeak;
    return p ? { value: p.value, unit: 'fT', label: `evoked field peak · ${p.channel} at ${fmtNum(p.t * 1000)} ms`, tag: 'calculated', note: `max |averaged evoked field| over ${p.n} OPM channels, ${p.epochs} epochs (MNE OPM sample, Earth)` } : { value: null, label: 'evoked field peak (loading the recording)' };
  }
  if (site === 'heart') {
    const ab = D.nv_heart_derived?.averaged_beat;
    return ab ? { value: ab.q_wave_pT.value, unit: 'pT', label: `heart Q wave · ${ab.q_wave_ms_before_r} ms before R · R-peak ${fmtNum(ab.r_peak_pT.value)} pT`, tag: ab.q_wave_pT.tag, note: `${ab.beats_averaged.value} real beats averaged, Kiel Cardio Database OPM (Earth)` } : { value: null, label: 'heart Q wave' };
  }
  if (site === 'blood') {
    const lod = D.specs?.qd_renin?.detection_limit;
    return { value: lod?.value ?? null, unit: lod?.unit || '', label: 'renin detection limit (lab TIRF assay)', tag: lod?.tag, note: `${lod?.source || ''}. Astronaut renin: ${(D.nasa_i4?.not_found || [])[0] || 'not in open data'}` };
  }
  const ds = D.nasa_i4?.datasets?.[0], v = ds?.variables?.[0];
  const pts = (v?.points || []).filter((p) => p.value?.value !== null && p.value?.value !== undefined);
  const last = pts[pts.length - 1];
  return last ? { value: last.value.value, unit: last.value.unit || 'mg/dL', label: `total bilirubin, Inspiration4 ${last.timepoint} (serum, ground draw)`, tag: last.value.tag, note: `${v.name}; NASA OSDR OSD-575. The patch reads skin interstitial fluid and has not flown.` } : { value: null, label: 'total bilirubin' };
}
async function loadBrainPeak() {
  try {
    const meg = await getJSON('/data/recorded/opm_brain_mne.json'), ev = meg.evoked;
    let best = { value: 0 };
    ev.series.forEach((s) => s.values.forEach((v, i) => { if (Math.abs(v) > Math.abs(best.value)) best = { value: v, channel: s.name, t: ev.x.values[i] }; }));
    st.brainPeak = { ...best, value: Math.abs(best.value), n: ev.series.length, epochs: ev.n_epochs };
    renderCard();
  } catch (e) { console.warn(e); }
}

// ------------------------------------------------------------------ the one card
const verdictFor = (site) => {
  const v = st.verdicts?.verdicts; if (!v) return null;
  const s = SITES.find((x) => x.id === site), build = $('#in-build')?.value || 'qant';
  const keys = s.verdict.map((k) => k.replace('{build}', build));
  const list = keys.map((k) => ({ key: k, ...v[k] })).filter((x) => x.verdict);
  return list.length ? list : null;
};
function inputsHTML() {
  return `<div class="inputs"><h4>Your inputs · Lean checks them</h4>
    <div class="inp"><span>Magnetic shielding factor<small>user input · 1 = no shield</small></span><select id="in-shield">${[1, 10, 100, 1000, 10000, 100000].map((v) => `<option value="${v}" ${v === (st.inputs?.shielding_factor ?? 1) ? 'selected' : ''}>${v.toLocaleString('en-US')} ×</option>`).join('')}</select></div>
    <div class="inp"><span>Heartbeats averaged<small>user input · recording has 47</small></span><input id="in-beats" type="number" min="1" max="100000" step="1" value="${st.inputs?.beats_averaged ?? 47}"></div>
    <div class="inp"><span>Required signal-to-noise<small>user input</small></span><input id="in-snr" type="number" min="0.1" step="0.1" value="${st.inputs?.snr_required ?? 3}"></div>
    <div class="inp"><span>NV build</span><select id="in-build">${['jgu', 'zaquant', 'qant'].map((b) => `<option value="${b}" ${b === (st.inputs?.build || 'qant') ? 'selected' : ''}>${b === 'jgu' ? 'JGU' : b === 'zaquant' ? 'ZAQuant' : 'Q.ANT'}</option>`).join('')}</select></div>
    <div class="inp"><span>Heart signal to resolve</span><select id="in-target"><option value="r_peak" ${st.inputs?.target !== 'q_wave' ? 'selected' : ''}>R-peak</option><option value="q_wave" ${st.inputs?.target === 'q_wave' ? 'selected' : ''}>Q wave</option></select></div>
    <div class="inp"><span>OPM measurement bandwidth<small>user input · Hz, within 3–100 Hz</small></span><input id="in-bw" type="number" min="1" max="100" step="1" value="${st.inputs?.bandwidth_hz ?? 30}"></div>
    <div class="inp"><span>Blood renin<small>${esc((st.verdicts?.input_units?.renin || 'pM').split(',')[0])} · blank = not entered</small></span><input id="in-renin" type="number" min="0" step="any" placeholder="not entered" value="${st.inputs?.renin ?? ''}"></div>
    <div class="inp"><span>Skin-fluid bilirubin<small>${st.verdicts?.input_units?.bilirubin_isf?.includes('not yet extracted') ? 'unit not yet extracted from the paper' : esc(st.verdicts?.input_units?.bilirubin_isf || '')} · blank = not entered</small></span><input id="in-bili" type="number" min="0" step="any" placeholder="not entered" value="${st.inputs?.bilirubin_isf ?? ''}"></div>
    <div class="btnrow"><button class="cta" id="btn-check">Check with Lean</button><button class="ghost" id="btn-run">＋ Real run at ${esc($('#location').selectedOptions[0].textContent.split(' · ')[0])}</button></div></div>`;
}
// CryoLean-style verdict card: each requirement Lean checked, with exact numbers, what is missing, and the theorems
function whyHTML(list) {
  const mark = (h) => (h === true ? '<b style="color:var(--met)">✓</b>' : h === false ? '<b style="color:var(--notmet)">✗</b>' : '<b style="color:var(--needinfo)">?</b>');
  return `<div class="why">${list.map((v) => `<div class="why-card"><div class="kick"><span>${esc(v.key.replace(/_/g, ' '))} · ${esc(v.signal || '')}</span><span class="verdict ${esc(v.verdict)}">${esc(v.verdict.replace(/_/g, ' ').toLowerCase())}</span></div>
      <p class="note" style="color:var(--ink2)">${esc(v.reason || '')}</p>
      ${(v.requirements || []).map((r) => `<div class="why-req">${mark(r.holds)} <span>${esc(r.text || r.id)}</span>
        <div class="mono why-num">${esc(r.formula || '')}${r.lhs ? ` · ${esc(r.lhs.decimal)} ${esc(r.lhs.unit || '')}` : ''}${r.rhs ? ` ≤ ${esc(r.rhs.decimal)} ${esc(r.rhs.unit || '')}` : ''}${r.missing?.length ? ` · missing: ${esc(r.missing.map((m) => (typeof m === 'string' ? m : m.id || m.symbol || '')).join(', '))}` : ''}</div>
        <div class="src mono">${esc(r.lean_line || '')}</div></div>`).join('')}
      <div>${(v.theorems || []).slice(0, 4).map((t) => lean(t.name)).join('')}</div><div class="src">${esc(v.decided_by || '')}</div></div>`).join('')}</div>`;
}
function readInputs() {
  const num = (id) => { const v = $(id)?.value; return v === '' || v === undefined ? null : +v; };
  return { shielding_factor: num('#in-shield') ?? 1, beats_averaged: num('#in-beats'), snr_required: num('#in-snr'), build: $('#in-build')?.value, target: $('#in-target')?.value, bandwidth_hz: num('#in-bw'), renin: num('#in-renin'), bilirubin_isf: num('#in-bili') };
}
function renderCard() {
  const comb = S.combined || D.combined_sensor || {};
  const bricks = Object.values(comb.components || {}).reduce((a, c) => a + c.facts.length, 0);
  const runs = (S.runs?.runs || D.runs?.runs || []).length;
  const rows = SITES.map((s) => {
    const r = keyReadout(s.id), vs = verdictFor(s.id);
    return `<div class="srow ${st.site === s.id ? 'on' : ''}" data-site="${s.id}">
      <div class="s-head"><span class="s-name"><i class="dotc ${s.color}"></i>${esc(s.title)}</span><span class="s-site">${esc(s.name)}</span></div>
      <div class="s-val">${r.value === null || r.value === undefined ? '<span class="na" style="font-size:14px">no value</span>' : `<span>${esc(fmtNum(r.value))}</span><small>${esc(r.unit || '')}</small>`}</div>
      <div class="s-lbl" title="${esc(r.note || '')}">${esc(r.label)} ${r.tag ? `<span class="chip">${esc(r.tag)}</span>` : ''}</div>
      <div class="s-meta">${vs ? vs.map((v) => `<span class="verdict ${esc(v.verdict)}" title="${esc(`${v.key}: ${v.reason || ''}`)}">${esc(v.key.replace(/_/g, ' '))}: ${esc(v.verdict.replace(/_/g, ' ').toLowerCase())}</span>`).join('') : `<span class="verdict">${st.verdictErr ? 'Lean checker unavailable' : 'Lean: checking…'}</span>`}
        ${vs ? `<button class="s-go" data-why="${s.id}">${st.why?.[s.id] ? 'hide why' : 'why ▾'}</button>` : ''}<button class="s-go" data-tab="${s.tab}">exact sensor ›</button></div>
      ${vs && st.why?.[s.id] ? whyHTML(vs) : ''}</div>`;
  }).join('');
  const L = st.verdicts?.lean || {};
  const axList = Array.isArray(L.standard_axioms) ? L.standard_axioms : [];
  $('#card').innerHTML = `<h2>Four quantum sensors</h2><div class="sub">${esc($('#location').selectedOptions[0].textContent)} · ${runs} real runs · combined sensor v${esc(comb.version ?? 0)} (${bricks} real facts)</div>
    ${rows}${inputsHTML()}
    <div class="lean-card"><b>∀ Lean decides every verdict.</b> ${st.verdicts ? `${esc(L.toolchain || '')} · source ${esc((L.source_sha256 || '').slice(0, 12))}… · axioms ${esc(axList.join(', ') || 'standard')}${L.axioms_all_standard ? ' (all standard)' : ''} · audit ${esc(L.audit?.status || '')}` : esc(st.verdictErr || 'waiting for the checker')}
      <div style="margin-top:4px">${['verdict_met_iff', 'verdict_notMet_sound', 'verdict_needInfo_sound'].map((n) => lean(n)).join('')}</div>
      <div class="note" style="margin-top:4px">Missing or unconfirmed inputs never become a pass or a fail: Lean answers “need more information”. Sensor colour on the body is this verdict, not health.</div></div>
    <div class="footer-text">${esc(FOOTER)}</div>`;
  $$('#card .srow').forEach((el) => el.addEventListener('click', (e) => { if (e.target.closest('[data-tab]')) return; pickSite(el.dataset.site, true); }));
  $$('#card [data-tab]').forEach((b) => b.addEventListener('click', () => enterTab(b.dataset.tab)));
  $$('#card [data-why]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); st.why = { ...(st.why || {}), [b.dataset.why]: !st.why?.[b.dataset.why] }; renderCard(); }));
  $$('#card .inputs input, #card .inputs select').forEach((el) => el.addEventListener('change', () => { st.inputs = readInputs(); checkLean(); }));
  $('#btn-check').addEventListener('click', () => { st.inputs = readInputs(); checkLean(true); });
  $('#btn-run').addEventListener('click', doRun);
}

// ------------------------------------------------------------------ Lean verdicts
let checking = null;
async function checkLean(announce = false) {
  st.inputs = st.inputs || readInputs();
  const body = { location: S.location, inputs: st.inputs };
  const my = (checking = Symbol());
  try {
    const r = await postJSON('/api/verdict', body);
    if (my !== checking) return;
    st.verdicts = r; st.verdictErr = null;
    if (announce) toast('Lean checked the inputs: verdicts updated.');
  } catch (e) { st.verdictErr = `Lean checker unavailable (${e.message})`; st.verdicts = null; }
  for (const s of SITES) { const vs = verdictFor(s.id); const worst = vs && (vs.find((v) => v.verdict === 'NOT_MET') || vs.find((v) => v.verdict === 'NEED_MORE_INFORMATION') || vs[0]); twin?.setVerdict(s.id, worst?.verdict || null); }
  renderCard();
}

// ------------------------------------------------------------------ zoom levels
function chainFor(site) { return LV.filter((l) => l === 'body' || l === 'organ' || CHAINS[site]?.[l]); }
// each rail stop shows that level's field of view once it has been seen (or its scene's scale bar before)
const stopFov = {};
async function prefetchStops(site) {
  for (const l of ['cell', 'molecule', 'quantum']) {
    const f = CHAINS[site]?.[l]; if (!f || stopFov[`${site}|${l}`]) continue;
    try { const m = await import(`./scale/${f}`); const lb = m.LEVEL?.scaleBar?.label; if (lb && !stopFov[`${site}|${l}`]) { stopFov[`${site}|${l}`] = (lb.match(/^[\d.,]+\s*\S+/) || [lb])[0]; renderRail(); } } catch { /* not built */ }
  }
}
function renderRail() {
  if (st.tab) { renderTabRail(); return; }
  const chain = chainFor(st.site), s = SITES.find((x) => x.id === st.site);
  $('#rail').innerHTML = `<div class="rail-site">${esc(s.name)} · ${esc(s.sensor)}</div>
    ${chain.map((l, i) => `<button data-l="${l}" title="${i + 1} · ${esc(LEVEL_NAMES[l])}" class="${l === st.level ? 'on' : ''}"><i></i><b>${esc(stopFov[`${st.site}|${l}`] || LV_SCALE[l])}</b><span>${i + 1} · ${esc(LEVEL_NAMES[l])}</span></button>`).join('')}`;
  $$('#rail button').forEach((b) => b.addEventListener('click', () => goLevel(b.dataset.l)));
  $('#fov-lvl').textContent = `LEVEL ${chain.indexOf(st.level) + 1} OF ${chain.length} · ${LEVEL_NAMES[st.level].toUpperCase()}`;
}
let fovShown = '';
function setFov(metres, dimLabel) {
  let num, unit;
  if (metres === null) { [num, unit] = [dimLabel.split(' ')[0], dimLabel.split(' ').slice(1).join(' ')]; } else ({ num, unit } = fovText(metres));
  const key = `${num}${unit}`; if (key === fovShown) return; fovShown = key;
  $('#fov-num').textContent = num; $('#fov-unit').textContent = unit;
  if (!st.tab && st.level && !st.levelFovSet?.[`${st.site}|${st.level}`] && metres !== null) {
    st.levelFovSet = { ...(st.levelFovSet || {}), [`${st.site}|${st.level}`]: true };
    setTimeout(() => { stopFov[`${st.site}|${st.level}`] = `${$('#fov-num').textContent} ${$('#fov-unit').textContent}`; renderRail(); }, 1300);
  }
}
// organ level: the real cell types and marker genes of the organ behind each sensor (HRA ASCT+B tables)
const SITE_TABLE = { brain: 'brain', heart: 'heart', blood: 'kidney', skin: 'skin' };
async function organHud(site, picked = null) {
  if (!('bio/asctb' in D)) D['bio/asctb'] = await getJSON('/data/bio/asctb.json').catch(() => null);
  const A = D['bio/asctb']; if (!A || (st.level !== 'organ' && st.level !== 'body')) return;
  const tkey = picked?.key?.startsWith('kidney') ? 'kidney' : picked?.key === 'lungs' ? null : SITE_TABLE[site];
  const T = tkey && A.organs[tkey];
  if (!T) { $('#hud-info').innerHTML = `<div class="lvl">Organ</div><h3>${esc(picked?.name || picked?.key || site)}</h3><p>No ASCT+B rows were selected for this structure.</p>`; $('#hud').hidden = false; return; }
  let rows = T.rows || [];
  const byId = picked?.ontology ? rows.filter((r) => r.anatomical_structures.some((s) => s.id === picked.ontology)) : [];
  if (byId.length) rows = byId; else if (tkey === 'brain') { const m1 = rows.filter((r) => r.anatomical_structures.some((s) => s.id === 'UBERON:0001384')); if (m1.length) rows = m1; }
  const cells = new Map(), genes = new Map(), prots = new Map();
  rows.forEach((r) => { r.cell_types.forEach((c) => cells.set(c.id, c.label || c.name)); (r.genes || []).forEach((g) => genes.set(g.symbol, g.id)); (r.proteins || []).forEach((p) => prots.set(p.symbol || p.name, p.id)); });
  const ery = site === 'blood' ? A.organs.bone_marrow_erythroid : null;
  const eryGenes = ery ? [...new Set(ery.rows.flatMap((r) => (r.genes || []).map((g) => g.symbol)))] : [];
  const where = rows[0]?.anatomical_structures?.slice(-1)[0];
  const ch = chainFor(site);
  $('#hud-info').innerHTML = `<div class="lvl">Level ${ch.indexOf('organ') + 1} of ${ch.length} · Sensor site · cells and genes (HRA ASCT+B)</div><h3>${esc(where ? `${where.label} (${where.id})` : tkey)}</h3>
    <p><b>Cells:</b> ${[...cells.values()].slice(0, 3).map(esc).join(', ')}${cells.size > 3 ? ` +${cells.size - 3}` : ''}</p>
    ${genes.size ? `<p><b>Genes:</b> ${esc([...genes.keys()].slice(0, 8).join(' · '))}${genes.size > 8 ? ` +${genes.size - 8}` : ''}</p>` : prots.size ? `<p><b>Protein markers:</b> ${esc([...prots.keys()].slice(0, 8).join(' · '))}${prots.size > 8 ? ` +${prots.size - 8}` : ''}</p>` : ''}
    <div class="src one">Source: Human Reference Atlas ASCT+B tables (CC BY 4.0)</div>
    <details class="more"><summary>More ▸</summary>
      <p>${[...cells.entries()].map(([id, l]) => `${esc(l)} <span class="chip">${esc(id)}</span>`).join(' ')}</p>
      ${genes.size ? `<p>${esc([...genes.keys()].join(' · '))}</p>` : ''}${prots.size ? `<p>${esc([...prots.keys()].join(' · '))}</p>` : ''}
      ${ery ? `<p><b>Red cells:</b> ${esc(A.organs.blood?.note || 'not in the HRA blood table')}. Erythroid lineage (bone marrow table): ${esc(eryGenes.slice(0, 10).join(' · '))}</p>` : ''}
      <p class="note">${rows.length} table row${rows.length === 1 ? '' : 's'}${picked?.name ? ` · picked mesh ${esc(picked.name)}` : ''}. Click another organ to look it up.</p>
      <div class="src">${esc(T.table?.name || (typeof T.table === 'string' ? T.table : ''))} ${esc(T.table?.version || '')} · ${esc(A.citation || '')}</div></details>`;
  $('#hud').hidden = false; $('#hud-readouts').innerHTML = ''; $('#hud-controls').innerHTML = ''; $('#hud-gene').innerHTML = '';
}
function flash(text) { const f = $('#flash'); f.innerHTML = `<b>${esc(text)}</b>`; f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 520); }
async function goLevel(level) {
  const site = st.site;
  if (level === 'body' || level === 'organ') {
    micro?.close(); $('#stage').classList.remove('deep'); $('#hud').hidden = true;
    st.level = level; renderRail();
    if (level === 'body') twin?.resetView(); else { twin?.select(site, { focus: true }); organHud(site); }
    return;
  }
  try {
    const chain = chainFor(site), dir = chain.indexOf(level) >= chain.indexOf(st.level) ? 'in' : 'out';
    $('#stage').classList.add('diving');
    await micro.open(site, level, { dir, index: chain.indexOf(level) + 1, total: chain.length });
    st.level = level; $('#stage').classList.add('deep'); $('#hud').hidden = false; renderRail();
    setTimeout(() => $('#stage').classList.remove('diving'), 600);
  } catch (e) {
    $('#stage').classList.remove('diving');
    console.warn(e); toast(`The ${LEVEL_NAMES[level].toLowerCase()} scene for the ${site} is not built yet (${e.message}).`, 5000);
  }
}
function step(dir) {
  if (st.tab) { goStep(st.step + dir); return; }
  const chain = chainFor(st.site), i = chain.indexOf(st.level), j = Math.max(0, Math.min(chain.length - 1, i + dir));
  if (j !== i) goLevel(chain[j]);
}

// ------------------------------------------------------------------ sensor tabs: one descent per sensor, starting
// with the sensor in contact with the body part it reads (body twin views), then the cell, molecule and quantum scenes
const TAB_CHAINS = {
  opm: [{ twin: 'opm_grid', fov: '30 cm', name: 'Sensors on the head' }, { twin: 'opm_contact', fov: '5.5 cm', name: 'One sensor on the scalp' },
    { file: 's_sensor.js?id=opm', name: 'The sensor' }, { file: 'cell_neuron.js', name: 'The neuron it hears' }, { file: 'q_rb.js', name: 'Rubidium atom' }],
  nv: [{ twin: 'chest', fov: '30 cm', name: 'Sensors on the chest' }, { twin: 'nv_contact', fov: '5 cm', name: 'NV head at the chest' },
    { file: 's_sensor.js?id=nv&build=jgu', name: 'The diamond' }, { file: 'cell_cardiomyocyte.js', name: 'Heart muscle cell' },
    { file: 'mol_nav15.js', name: 'Nav1.5 and its gene' }, { file: 'q_nv.js', name: 'NV centre' }],
  qd: [{ twin: 'kidneys', fov: '36 cm', name: 'Where renin is made' }, { file: 'cell_rbc.js', name: 'Blood plasma' },
    { file: 's_sensor.js?id=qd', name: 'The probe' }, { file: 'mol_renin.js', name: 'Renin and its gene' }, { file: 'q_qd.js', name: 'Energy transfer' }],
  cqd: [{ twin: 'forearm', fov: '16 cm', name: 'Patch on the forearm' }, { file: 'cell_skin.js', name: 'Skin layers' },
    { file: 'mol_bilirubin.js', name: 'Bilirubin and its gene' }, { file: 'q_cqd.js', name: 'Carbon dot' }],
};
const vget = (k) => st.verdicts?.verdicts?.[k];
const vrow = (k, label) => { const v = vget(k); return v ? { label: `Lean verdict · ${label}`, value: v.verdict.replace(/_/g, ' ').toLowerCase(), unit: '', tag: 'Lean', source: v.reason } : null; };
const voRow = (label, x) => (x ? { label, value: x.value ?? 'not stated', unit: x.unit || '', tag: x.tag, source: x.source } : null);
async function twinCard(name) {
  if (!('anatomy/manifest' in D)) D['anatomy/manifest'] = await getJSON('/data/anatomy/manifest.json').catch(() => null);
  const man = D['anatomy/manifest'], sp = D.specs || {}, opm = D['sensor_parts/opm']?.components, live = S.live || D.live_snapshot || {};
  const amb = live.opm_readiness?.[S.location]?.ambient_nT;
  const pts = man?.mounts?.scalp_right_precentral_gyrus?.points || [];
  const dk = pts[0] && Object.keys(pts[0]).find((k) => /depth|to_cortex|to_gyrus|to_brain/i.test(k) && typeof pts[0][k] === 'number');
  const depth = dk ? pts.map((p) => p[dk] * 1000) : null;
  const C = {
    opm_grid: { title: 'Nine OPMs over the right precentral gyrus', lines: ['QuSpin QZFM Gen-3 heads on a 3 × 3 grid, about 25 mm apart, on the Human Reference Atlas scalp over the precentral gyrus (UBERON:0002703): the layout of the nine-sensor MNE OPM recording.', 'Scroll to descend to one sensor touching the scalp.'],
      rows: [voRow('ambient field here', amb), voRow('field the coils can null', sp.opm?.field_compensation_max), vrow('opm_brain', 'brain')], src: ['HRA Visible Human male (CC BY 4.0)', 'MNE-Python OPM sample', 'QuSpin QZFM Gen-3'] },
    opm_contact: { title: 'One sensor touching the scalp', lines: ['The housing (seen through) stands on the skin; its rubidium cell sits just above the skin face, and the cortex lies a few millimetres below.', 'The magnetic field of the neurons crosses the scalp and reaches the cell.'],
      rows: [voRow('housing height (Gen-3.0 drawing)', opm?.housing?.size?.y), voRow('cell centre above the skin face', opm?.cell?.centre?.y ? { ...opm.cell.centre.y, value: +(opm.cell.centre.y.value + opm.housing.size.y.value / 2).toFixed(2) } : null),
        depth ? { label: 'scalp to cortex in this model', value: `${Math.min(...depth).toFixed(1)}–${Math.max(...depth).toFixed(1)}`, unit: 'mm', tag: 'calculated', source: 'HRA meshes (data/anatomy/manifest.json)' } : null], src: ['QuSpin Gen-3.0 dimension drawing', 'HRA brain and skin'] },
    chest: { title: 'Sensors over the heart', lines: ['A 2 × 2 OPM array at 3 cm spacing (Kiel Cardio Database layout) and the JGU NV-diamond head sit on the chest over the real heart of the Visible Human.', 'Scroll to descend to the NV head at the skin.'],
      rows: [man?.mounts?.chest_over_heart?.heart_centroid_to_skin_m ? { label: 'heart centre to skin', value: +(man.mounts.chest_over_heart.heart_centroid_to_skin_m * 1000).toFixed(1), unit: 'mm', tag: 'calculated', source: 'HRA heart and skin meshes' } : null, vrow('opm_heart', 'OPM heart'), vrow('nv_heart_jgu', 'NV (JGU)')], src: ['HRA Visible Human male', 'Kiel Cardio Database', 'Omar et al., arXiv 2601.18843'] },
    nv_contact: { title: 'NV head about 1 cm from the skin', lines: ['The JGU head’s Ø12 mm front face (the only published housing size) faces the chest; the heart’s field reaches the diamond inside.', 'Scroll to descend into the diamond.'],
      rows: [voRow('JGU noise density', sp.nv?.jgu?.sensitivity), voRow('bandwidth used', sp.nv?.headline?.bandwidth_assumed), vrow('nv_heart_jgu', 'R-peak, JGU')], src: ['Omar et al., arXiv 2601.18843'] },
    kidneys: { title: 'Renin comes from the kidneys', lines: ['Juxtaglomerular granular cells in the kidney make renin (HRA ASCT+B: CL:0000648 → REN). The quantum-dot assay reads renin in drawn blood, on a TIRF microscope.', 'Scroll to descend into the blood.'],
      rows: [voRow('assay detection limit', sp.qd_renin?.detection_limit), vrow('qd_blood', 'blood renin')], src: ['HRA kidneys and ASCT+B kidney v1.8', 'Long et al., Anal. Chem. 84, 8846 (2012)'] },
    forearm: { title: 'Carbon-dot patch on the forearm', lines: ['The microneedle patch leaves carbon dots in the skin; their glow tracks bilirubin under blue light. The site is shown on the right forearm: the paper names no body site, and its needle dimensions are not in an accessible source.', 'Scroll to descend into the skin.'],
      rows: [vrow('cqd_skin', 'skin bilirubin')], src: ['Tabatabaee et al., ACS Nano 18, 28012 (2024)', 'HRA skin'] },
  }[name];
  const chain = TAB_CHAINS[st.tab], i = chain.findIndex((s) => s.twin === name);
  $('#hud-info').innerHTML = `<div class="lvl">Level ${i + 1} of ${chain.length} · ${esc(chain[i].name)}</div><h3>${esc(C.title)}</h3>${C.lines.map((t) => `<p>${esc(t)}</p>`).join('')}
    <div class="kick" style="margin-top:8px"><span>Sources</span></div><div class="src">${C.src.map(esc).join('<br>')}</div>`;
  const rows = C.rows.filter(Boolean);
  $('#hud-readouts').innerHTML = rows.length ? `<div class="kick"><span>Measured and calculated</span></div>${rows.map((x) => `<div class="mrow" title="${esc([x.tag, x.source].filter(Boolean).join(' · '))}"><span>${esc(x.label)}</span><b>${esc(typeof x.value === 'number' ? fmtNum(x.value) : x.value)} <small>${esc(x.unit)}</small></b></div>`).join('')}` : '';
  $('#hud-controls').innerHTML = ''; $('#hud-gene').innerHTML = ''; $('#hud').hidden = false;
}
const tabStop = {};
function renderTabRail() {
  const chain = TAB_CHAINS[st.tab];
  $('#rail').innerHTML = `<div class="rail-site">${esc(TAB_HEAD[st.tab].title.split(':')[0])}</div>${chain.map((s, i) => `<button data-i="${i}" title="${i + 1} · ${esc(s.name)}" class="${i === st.step ? 'on' : ''}"><i></i><b>${esc(s.fov || tabStop[s.file] || '')}</b><span>${i + 1} · ${esc(s.name)}</span></button>`).join('')}`;
  $$('#rail button').forEach((b) => b.addEventListener('click', () => goStep(+b.dataset.i)));
  $('#fov-lvl').textContent = `LEVEL ${st.step + 1} OF ${chain.length} · ${chain[st.step].name.toUpperCase()}`;
}
async function goStep(i) {
  const chain = TAB_CHAINS[st.tab]; if (!chain) return;
  i = Math.max(0, Math.min(chain.length - 1, i));
  if (i === st.step && st.stepReady) return;
  const s = chain[i], dir = i >= st.step ? 'in' : 'out';
  if (s.twin) {
    micro?.close(); $('#stage').classList.remove('deep');
    st.step = i; st.level = 'organ'; st.stepReady = true;
    twin?.view(s.twin); await twinCard(s.twin);
  } else {
    try {
      await micro.openFile(s.file, { dir, index: i + 1, total: chain.length, name: s.name });
      st.step = i; st.level = 'cell'; st.stepReady = true; $('#stage').classList.add('deep'); $('#hud').hidden = false;
      setTimeout(() => { tabStop[s.file] = `${$('#fov-num').textContent} ${$('#fov-unit').textContent}`; if (st.tab) renderTabRail(); }, 1400);
    } catch (e) { console.warn(e); toast(`This level is not available (${e.message}).`, 5000); return; }
  }
  renderTabRail();
}
function enterTab(tab) {
  st.tab = tab; st.step = -1; st.stepReady = false; st.site = SITES.find((x) => x.tab === tab).id;
  $$('.view').forEach((el) => el.classList.toggle('on', el.id === 'view-body'));
  $$('.tb-nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === tab));
  document.body.classList.add('sensor-mode'); $('#go-specs').hidden = false;
  // pre-fill each micro level's rail label with its scene's scale bar until it has been seen
  for (const s of TAB_CHAINS[tab]) if (s.file && !tabStop[s.file]) import(`./scale/${s.file}`).then((m) => { const lb = m.LEVEL?.scaleBar?.label; if (lb && !tabStop[s.file]) { tabStop[s.file] = (lb.match(/^[\d.,]+\s*\S+/) || [lb])[0]; if (st.tab) renderTabRail(); } }).catch(() => {});
  setTimeout(() => { twin?.resize(); micro?.resize(); goStep(0); }, 30);
}
function exitTab() {
  st.tab = null; document.body.classList.remove('sensor-mode'); $('#go-specs').hidden = true;
  $$('.view').forEach((el) => el.classList.toggle('on', el.id === 'view-body'));
  $$('.tb-nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === 'body'));
  setTimeout(() => { twin?.resize(); micro?.resize(); goLevel('body'); }, 30);
}
function pickSite(site, focus) {
  if (st.tab) return;
  st.site = site; S.system = site; prefetchStops(site);
  twin?.select(site, { focus: focus && st.level !== 'body' ? true : focus });
  if (st.level !== 'body' && st.level !== 'organ') goLevel('organ'); else { st.level = focus ? 'organ' : st.level; renderRail(); if (focus) organHud(site); }
  renderCard();
}

// ------------------------------------------------------------------ runs, polling, views
async function doRun() {
  const btn = $('#btn-run'); btn.disabled = true; btn.textContent = 'Running… (real data + ODMR-Lab)';
  try {
    const j = await postJSON('/api/run', { location: S.location, role: 'crew' });
    S.combined = j.combined; S.runs = await getJSON('/api/runs').catch(() => S.runs);
    toast(`${j.run.run_id}: ${j.run.adds_to_combined.length} new real facts added to the combined sensor.`, 5000);
  } catch (e) { toast(`Run failed: ${e.message}`, 6000); }
  renderCard(); updateRuns();
}
function updateRuns() { $('#tb-runs').textContent = String((S.runs?.runs || D.runs?.runs || []).length).padStart(3, '0'); }
async function poll() {
  try { S.health = await getJSON('/api/health'); $('#tb-status').classList.add('ok'); $('#tb-status span').textContent = 'Server online'; }
  catch { $('#tb-status').classList.remove('ok'); $('#tb-status span').textContent = 'Server offline · saved data'; }
  try { S.live = await getJSON('/api/live'); } catch { /* snapshot */ }
  try { S.sensors = await getJSON('/api/sensors/live'); } catch { /* none */ }
  try { S.combined = await getJSON('/api/combined'); S.runs = await getJSON('/api/runs'); updateRuns(); } catch { /* files */ }
}
const built = {};
async function showView(v) {
  $$('.view').forEach((el) => el.classList.toggle('on', el.id === `view-${v}`));
  $$('.tb-nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  if (v === 'body' || built[v]) return;
  built[v] = true;
  const el = $(`#view-${v}`), h = TAB_HEAD[v];
  el.innerHTML = `<button class="ghost" data-back="${v}" style="margin-bottom:10px">← Back to the descent</button><div class="st-head"><div><div class="kick"><span>${esc(h.kick)}</span></div><h2>${esc(h.title)}</h2><div class="note">${h.sub}</div></div><div class="pills">${h.pills()}</div></div>
    <div class="st-main"><div class="st-view" id="sv-${v}"><div class="sv-empty">Loading the exact-spec model…</div></div><aside class="st-side" id="ss-${v}"></aside></div>
    <div class="st-below" id="sb-${v}"></div>`;
  el.querySelector('[data-back]').addEventListener('click', () => enterTab(v));
  try { await createSensorView($(`#sv-${v}`), $(`#ss-${v}`), v); }
  catch (e) { console.warn(e); $(`#sv-${v}`).innerHTML = `<div class="sv-empty">The exact-spec 3D model for this sensor is being built from its documented dimensions.<br><br><span class="src">${esc(e.message)}</span></div>`; $(`#ss-${v}`).innerHTML = '<p class="note">Component list appears with the model.</p>'; }
  try { await tabBelow(v, $(`#sb-${v}`)); } catch (e) { console.error(e); $(`#sb-${v}`).innerHTML = `<div class="box">Could not render: ${esc(e.message)}</div>`; }
}
function sourcesHTML() {
  const rec = ['opm_heart_kiel', 'opm_brain_mne', 'nv_odmr_zenodo10629041', 'qd_fret_figshare5468838', 'cqd_pl_mendeley_cmfbrvrb8y', 'eeg_brain_ds004902'];
  const mol = [D['molecules/renin_2ren']?.meta, D['molecules/bilirubin_cid5280352']?.meta].filter(Boolean);
  return `<p>${esc(FOOTER)}</p>
    <h4>Recorded datasets</h4><ul class="plain">${rec.map((id) => { const m = D[`recorded/${id}`]?.meta; return `<li><b class="mono">${esc(id)}</b>${m ? ` · <a href="${esc(m.doi_or_url)}" target="_blank" rel="noopener">${esc(m.dataset)}</a> · ${esc(m.licence)}` : ''}</li>`; }).join('')}</ul>
    <h4>Structures, genes, cells and anatomy</h4><ul class="plain">${mol.map((m) => `<li>${m.sources.map(esc).join(' · ')}</li>`).join('')}${(twin?.credits || []).map((c) => `<li>${esc(c)}</li>`).join('')}<li>Further scene sources are listed in each zoom level's panel.</li></ul>
    <h4>Proofs, checks and simulators</h4><ul class="plain"><li>Lean 4 (${esc(D.lean_proofs?.toolchain || '')}), core library only: ${esc(String(D.lean_proofs?.theorems?.length || 0))} theorems, ${esc(String(D.lean_proofs?.sorry_count ?? '?'))} sorry, ${esc(D.lean_proofs?.file_sha256?.slice(0, 12) || '')}…</li>
      <li>${esc(D.math_checks?.tool || 'Wolfram Language')}: ${esc(String(D.math_checks?.checks?.length || 0))} cross-checks</li><li>${esc(D.quantum_circuits?.tool || 'coda simulate')}: ${esc(String(D.quantum_circuits?.points?.length || 0))} Ramsey circuits</li>
      <li>Connectors: Wolfram, coda (Qiskit Aer), ChEMBL, Open Targets, VisualNeuroscience.AI atlas, RCSB PDB, UniProt, PubChem</li></ul>
    <h4>Software</h4><ul class="plain"><li>three.js 0.160 (MIT) · IBM Plex Sans and Mono (SIL Open Font License)</li></ul>`;
}

// the body figure: a clothed comic person, female or male; rebuilt on a fresh canvas when switched
st.sex = 'male';
async function makeTwin(onProgress) {
  const old = $('#twin'), fresh = old.cloneNode(false); old.replaceWith(fresh);
  $('#labels').innerHTML = ''; $('#leaders').innerHTML = '';
  const sc = sceneFor(S.location); st.scene = sc; $('#stage').dataset.bg = sc.backdrop;
  twin = await createTwin({ canvas: fresh, labelsEl: $('#labels'), leadersEl: $('#leaders'), sites: SITES.map((s) => ({ id: s.id, name: s.name, sensor: s.sensor })),
    colors: { opm: S.col.opm, nv: S.col.nv, cqd: S.col.cqd }, opm: opmGeom(), sex: st.sex, outfit: sc.outfit, backdrop: sc.backdrop, onSelect: (id) => pickSite(id, true),
    onOrganPick: (p) => { if (st.tab) return; if (st.level === 'body') { st.level = 'organ'; renderRail(); } organHud(st.site, p); },
    onEdge: (d) => step(d === 'in' ? 1 : -1), onProgress });
  twin.select(st.site);
  for (const s of SITES) { const vs = verdictFor(s.id); const worst = vs && (vs.find((v) => v.verdict === 'NOT_MET') || vs.find((v) => v.verdict === 'NEED_MORE_INFORMATION') || vs[0]); twin.setVerdict(s.id, worst?.verdict || null); }
}
async function setSex(sex) {
  if (sex === st.sex) return;
  st.sex = sex; $$('.sex-toggle button').forEach((b) => b.classList.toggle('on', b.dataset.sex === sex));
  toast(`Switching to the ${sex} figure…`, 1800);
  await makeTwin();
  if (st.tab) { const i = st.step; st.step = -1; st.stepReady = false; goStep(Math.max(0, i)); } else goLevel(['body', 'organ'].includes(st.level) ? st.level : 'body');
}

// ------------------------------------------------------------------ boot
async function boot() {
  await loadAll();
  applyPalette();
  S.location = $('#location').value;
  $('#location').addEventListener('change', async (e) => {
    S.location = e.target.value; checkLean();
    const sc = sceneFor(S.location);
    if (twin && (sc.outfit !== st.scene?.outfit || sc.backdrop !== st.scene?.backdrop)) {
      toast(`Dressing for ${$('#location').selectedOptions[0].textContent}…`, 2000);
      await makeTwin();
      if (st.tab) { const i = st.step; st.step = -1; st.stepReady = false; goStep(Math.max(0, i)); } else goLevel(['body', 'organ'].includes(st.level) ? st.level : 'body');
    }
  });
  $$('.tb-nav button').forEach((b) => b.addEventListener('click', () => (b.dataset.view === 'body' ? exitTab() : enterTab(b.dataset.view))));
  $('#go-specs').addEventListener('click', () => showView(st.tab));
  $$('.sex-toggle button').forEach((b) => b.addEventListener('click', () => setSex(b.dataset.sex)));
  $('#open-sources').addEventListener('click', () => { $('#sources-body').innerHTML = sourcesHTML(); $('#sources').hidden = false; });
  $('#close-sources').addEventListener('click', () => { $('#sources').hidden = true; });
  setInterval(() => { $('#tb-utc').textContent = new Date().toISOString().slice(11, 19) + ' UTC'; }, 1000);
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input,select,textarea') || !$('#view-body').classList.contains('on')) return;
    if (e.key === ']' || e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    if (e.key === '[' || e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
  });
  $('#go-down').addEventListener('click', () => step(1)); $('#go-up').addEventListener('click', () => step(-1));
  $('#go-src').addEventListener('click', () => $('#open-sources').click());
  renderCard(); renderRail(); updateRuns(); prefetchStops(st.site);
  $('#ld-2').classList.add('on');
  micro = createMicro({ canvas: $('#micro'), labelsEl: $('#micro-labels'), hud: { info: $('#hud-info'), readouts: $('#hud-readouts'), controls: $('#hud-controls'), gene: $('#hud-gene') }, scaleEl: $('#scalebar'), onEdge: (d) => step(d === 'in' ? 1 : -1),
    onFov: (m, dim) => { if (['cell', 'molecule', 'quantum'].includes(st.level)) setFov(m, dim); } });
  try {
    await makeTwin((f) => { $('#ld-num').textContent = String(55 + Math.round(f * 35)).padStart(2, '0'); });
  } catch (e) { console.error(e); toast(`3D body unavailable: ${e.message}`, 6000); }
  $('#ld-2').classList.add('ok'); $('#ld-3').classList.add('on');
  // scale bar for the body levels
  (function bar() {
    requestAnimationFrame(bar);
    if (!twin || st.level === 'cell' || st.level === 'molecule' || st.level === 'quantum') return;
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
