// SpinDrift UI. Every number, curve and colour comes from /data or the server; nothing is generated here except
// curves calculated from cited equations with sourced inputs (labelled "calculated").
import { createTwin } from './twin.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const D = {};          // data files
const S = { location: 'iss', system: 'heart', live: null, sensors: null, runs: null, combined: null, health: null, twin: null };

// ------------------------------------------------------------------ value objects
const NA = { NOT_STATED: 'unspecified in source', NOT_YET_EXTRACTED: 'not yet extracted' };
function fmtNum(v) {
  if (typeof v !== 'number') return String(v);
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 10000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (a >= 100) return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (a >= 1) return String(+v.toPrecision(4));
  return String(+v.toPrecision(3));
}
function voVal(vo) {
  if (!vo) return '<span class="na">no data</span>';
  if (vo.value === null || vo.value === undefined) return `<span class="na">${esc(NA[vo.status] || 'no value')}</span>`;
  return `<span class="v">${esc(fmtNum(vo.value))}</span>${vo.unit ? ` <small>${esc(vo.unit)}</small>` : ''}`;
}
function chips(vo) {
  if (!vo) return '';
  const c = [`<span class="chip">${esc(vo.tag)}</span>`];
  if (vo.status !== 'VERIFIED') c.push(`<span class="chip ${esc(vo.status)}">${vo.status === 'TO_CONFIRM' ? 'to confirm' : esc(vo.status.toLowerCase())}</span>`);
  return c.join('');
}
function tip(vo) {
  if (!vo) return '';
  return esc([vo.source && `Source: ${vo.source}`, vo.as_of && `As of: ${vo.as_of}`, vo.note && `Note: ${vo.note}`, `Tag: ${vo.tag} · status: ${vo.status}`].filter(Boolean).join('\n'));
}
const vo = (v) => `<span class="vo" title="${tip(v)}">${voVal(v)} ${chips(v)}</span>`;
function age(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!isFinite(s)) return '';
  if (s < 90) return `${Math.max(0, Math.round(s))} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
function toast(msg, ms = 4000) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

// ------------------------------------------------------------------ loading
const FILES = ['palette', 'specs', 'physics', 'clinical_card', 'device_map', 'nv_heart_derived', 'nasa_i4', 'hrp',
  'simulators', 'assets', 'locations', 'build_log', 'live_snapshot', 'runs', 'combined_sensor',
  'recorded/nv_odmr_zenodo10629041', 'recorded/qd_fret_figshare5468838', 'recorded/cqd_pl_mendeley_cmfbrvrb8y',
  'recorded/eeg_brain_ds004902'];
async function getJSON(url) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); }
async function loadAll() {
  let done = 0;
  const num = $('#ld-num');
  $('#ld-1').classList.add('on');
  await Promise.all(FILES.map(async (f) => {
    try { D[f] = await getJSON(`/data/${f}.json`); } catch (e) { D[f] = null; console.warn(e); }
    done++; num.textContent = String(Math.round((done / FILES.length) * 70)).padStart(2, '0');
  }));
  $('#ld-1').classList.add('ok');
}

function applyPalette() {
  const cols = D.palette?.colours || [];
  const pick = (dev, wl) => cols.find((c) => c.device === dev && (!wl || c.wavelength?.value === wl))?.colour?.value;
  const root = document.documentElement.style;
  const opm = pick('opm'), nv = pick('nv'), cqd = pick('cqd_patch', 439), reader = pick('cqd_patch', 470);
  if (opm) root.setProperty('--opm', opm);
  if (nv) root.setProperty('--nv', nv);
  if (cqd) root.setProperty('--cqd', cqd);
  if (reader) root.setProperty('--reader', reader);
  S.col = { opm: opm || '#ff0000', nv: nv || '#ff0000', cqd: cqd || '#6200ff', reader: reader || '#002dff', qd: '#9aa08f', env: '#d9ddd0', ink: '#e1e5d6', dim: '#8e9684' };
}

// ------------------------------------------------------------------ charts (real arrays only)
function ticks(a, b, n = 5) {
  const span = b - a; if (!(span > 0)) return [a];
  const st0 = span / n, mag = 10 ** Math.floor(Math.log10(st0)), err = st0 / mag;
  const st = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const out = []; for (let v = Math.ceil(a / st) * st; v <= b + st * 1e-9; v += st) out.push(+v.toFixed(10)); return out;
}
function chart({ w = 560, h = 230, series = [], points = [], bands = [], vlines = [], xLabel = '', yLabel = '', xDomain, yDomain, xTickFmt, catLabels }) {
  const m = { l: 52, r: 12, t: 10, b: 34 };
  const xs = [...series.flatMap((s) => s.x), ...points.flatMap((p) => p.x), ...bands.flatMap((b) => b.x)];
  const ys = [...series.flatMap((s) => s.y), ...points.flatMap((p) => p.y), ...bands.flatMap((b) => [...b.lo, ...b.hi])].filter((v) => v !== null && isFinite(v));
  let [x0, x1] = xDomain || [Math.min(...xs), Math.max(...xs)];
  let [y0, y1] = yDomain || [Math.min(...ys), Math.max(...ys)];
  if (!yDomain) { const pad = (y1 - y0) * 0.06 || 1; y0 -= pad; y1 += pad; }
  if (x1 === x0) { x0 -= 1; x1 += 1; }
  const X = (v) => m.l + ((v - x0) / (x1 - x0)) * (w - m.l - m.r);
  const Y = (v) => h - m.b - ((v - y0) / (y1 - y0)) * (h - m.t - m.b);
  const xt = catLabels ? catLabels.map((_, i) => i) : ticks(x0, x1, 6), yt = ticks(y0, y1, 5);
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img">`;
  s += '<g class="gr">' + yt.map((v) => `<line x1="${m.l}" x2="${w - m.r}" y1="${Y(v)}" y2="${Y(v)}"/>`).join('') + '</g>';
  s += `<g class="ax"><line x1="${m.l}" x2="${w - m.r}" y1="${h - m.b}" y2="${h - m.b}"/><line x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${h - m.b}"/></g>`;
  s += xt.map((v) => `<text x="${X(v)}" y="${h - m.b + 14}" text-anchor="middle">${esc(catLabels ? catLabels[v] : (xTickFmt ? xTickFmt(v) : fmtNum(v)))}</text>`).join('');
  s += yt.map((v) => `<text x="${m.l - 6}" y="${Y(v) + 3}" text-anchor="end">${esc(fmtNum(v))}</text>`).join('');
  s += `<text x="${(m.l + w - m.r) / 2}" y="${h - 4}" text-anchor="middle">${esc(xLabel)}</text>`;
  s += `<text transform="translate(12 ${(m.t + h - m.b) / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>`;
  for (const b of bands) {
    const top = b.x.map((x, i) => `${X(x)},${Y(b.hi[i])}`).join(' ');
    const bot = b.x.map((x, i) => `${X(x)},${Y(b.lo[i])}`).reverse().join(' ');
    s += `<polygon points="${top} ${bot}" fill="${b.color}" opacity="${b.opacity ?? 0.18}"/>`;
  }
  for (const v of vlines) {
    if (v.x < x0 || v.x > x1) continue;
    s += `<line x1="${X(v.x)}" x2="${X(v.x)}" y1="${m.t}" y2="${h - m.b}" stroke="${v.color || '#a9d48c'}" stroke-width="${v.width || 1}" ${v.dash ? `stroke-dasharray="${v.dash}"` : ''} opacity="${v.opacity ?? 1}"/>`;
    if (v.label) s += `<text x="${X(v.x) + 3}" y="${m.t + 10}" style="fill:${v.color || '#a9d48c'}">${esc(v.label)}</text>`;
  }
  for (const se of series) {
    const d = se.x.map((x, i) => (se.y[i] === null || !isFinite(se.y[i]) ? null : `${X(x)},${Y(se.y[i])}`)).filter(Boolean);
    if (d.length) s += `<polyline points="${d.join(' ')}" fill="none" stroke="${se.color}" stroke-width="${se.width || 1.4}" ${se.dash ? `stroke-dasharray="${se.dash}"` : ''} opacity="${se.opacity ?? 1}"/>`;
  }
  for (const p of points) {
    p.x.forEach((x, i) => { if (p.y[i] !== null && isFinite(p.y[i])) s += `<circle cx="${X(x)}" cy="${Y(p.y[i])}" r="${p.r || 3}" fill="${p.color}" stroke="${p.stroke || 'none'}"><title>${esc(p.titles ? p.titles[i] : '')}</title></circle>`; });
  }
  return s + '</svg>';
}
const legend = (items) => `<div class="legend">${items.map((i) => `<span><i style="border-color:${i.color};${i.dash ? 'border-top-style:dashed' : ''}"></i>${esc(i.name)}</span>`).join('')}</div>`;

// ------------------------------------------------------------------ systems and the twin
const SYSTEMS = [
  { id: 'brain', n: '01', name: 'Brain', row: 'brain_eeg', sensor: 'OPM-MEG · EEG for comparison', tab: 'opm', colorKey: 'opm' },
  { id: 'heart', n: '02', name: 'Heart', row: 'heart_q_wave', sensor: 'OPM magnetocardiography · NV diamond', tab: 'nv', colorKey: 'opm' },
  { id: 'lungs', n: '03', name: 'Lungs', row: 'lung', sensor: 'ISS cabin air · environment', tab: null, colorKey: 'env' },
  { id: 'blood', n: '04', name: 'Blood', row: 'blood', sensor: 'Quantum-dot renin nanosensor · lab TIRF', tab: 'qd', colorKey: 'qd' },
  { id: 'skin', n: '05', name: 'Skin', row: 'skin_patch', sensor: 'Carbon-dot microneedle patch', tab: 'cqd', colorKey: 'cqd' },
  { id: 'tumour', n: '06', name: 'Tumour risk', row: 'tumor', sensor: 'Space radiation · GOES protons', tab: null, colorKey: 'env' },
];
const rowOf = (sys) => (D.clinical_card?.[S.location]?.main || []).find((r) => r.id === sys.row);
const hasData = (sys) => { const r = rowOf(sys); return !!(r && r.reading && r.reading.value !== null && sys.id !== 'blood'); };

function shortVal(r) {
  if (!r || !r.reading) return 'no data';
  const v = r.reading;
  if (v.value === null) return NA[v.status] || 'no value';
  if (typeof v.value === 'string') return v.value.length > 40 ? v.value.slice(0, 40) + '…' : v.value;
  return `${fmtNum(v.value)} ${(v.unit || '').split(' (')[0]}`;
}

function renderTiles() {
  $('#tiles').innerHTML = SYSTEMS.map((sys) => {
    const r = rowOf(sys), on = sys.id === S.system, data = hasData(sys);
    return `<button class="tile ${on ? 'on' : ''}" data-system="${sys.id}">
      <div class="t-head"><span><span class="n">${sys.n}</span>${esc(sys.name)}</span><i style="${data ? `background:${S.col[sys.colorKey]}` : ''}"></i></div>
      <div class="t-val">${esc(shortVal(r))}</div><div class="t-sub">${esc(sys.sensor)}</div></button>`;
  }).join('');
  $$('#tiles .tile').forEach((t) => t.addEventListener('click', () => selectSystem(t.dataset.system)));
}

function selectSystem(id) {
  S.system = id;
  S.twin?.select(id);
  renderTiles();
  renderSysPanel();
}

let sysTab = 'readings';
function renderSysPanel() {
  const sys = SYSTEMS.find((s) => s.id === S.system), r = rowOf(sys), data = hasData(sys);
  const sup = (r?.supporting || []).map((v, i) => v ? `<div><span>${esc(r.supporting_labels?.[i] || '')}</span>${vo(v)}</div>` : '').join('');
  const risks = r?.risk ? (Array.isArray(r.risk) ? r.risk : [r.risk]) : [];
  let body = '';
  if (sysTab === 'readings') {
    body = `<div class="reading"><div class="lbl">${esc(r?.label || sys.name)}</div>
      <div class="big ${typeof r?.reading?.value === 'string' ? 'txt' : ''}">${vo(r?.reading)}</div>
      <div class="note">${r?.reading?.as_of ? `measured ${esc(age(r.reading.as_of))} · ` : ''}evidence <span class="chip ev">${esc(r?.evidence || '')}</span>${r?.badge ? ` <span class="chip badge">${esc(r.badge)}</span>` : ''}</div></div>
      ${sup ? `<div class="sup">${sup}</div>` : ''}${miniFor(sys)}`;
  } else if (sysTab === 'quantum') {
    body = quantumFor(sys);
  } else {
    body = `${risks.map((k) => `<div class="risk"><b>${esc(k.heading)}</b>${esc(k.text)}<div class="src">${esc(k.source)}</div></div>`).join('') || '<p class="note">No NASA risk statement linked to this row.</p>'}
      <p class="note">${esc(r?.review_note || '')}</p>
      <div class="sup">${(r?.data || []).map((f) => `<div><span>data</span><a href="/data/${esc(f.split(' ')[0])}" target="_blank">${esc(f)}</a></div>`).join('')}</div>`;
  }
  $('#sys-panel').innerHTML = `<div class="kick"><span>System ${sys.n}</span><span class="tag ${data ? 'data' : ''}">${data ? 'REAL DATA' : 'NO ASTRONAUT DATA'}</span></div>
    <div class="sys-title">${esc(sys.name)}</div><div class="sys-sensor">${esc(sys.sensor)}</div>
    <div class="subtabs">${['readings', 'quantum', 'context'].map((t) => `<button data-t="${t}" class="${t === sysTab ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
    ${body}
    ${sys.tab ? `<div class="btnrow"><button class="cta" data-goto="${sys.tab}">Open the ${esc({ opm: 'OPM', nv: 'NV diamond', qd: 'quantum-dot', cqd: 'carbon-dot' }[sys.tab])} tab →</button></div>` : ''}`;
  $$('#sys-panel .subtabs button').forEach((b) => b.addEventListener('click', () => { sysTab = b.dataset.t; renderSysPanel(); }));
  $$('#sys-panel [data-goto]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.goto)));
}

function miniFor(sys) {
  if (sys.id === 'heart' && D.nv_heart_derived) return beatChart(D.nv_heart_derived, null, 320, 170);
  if (sys.id === 'brain' && D['recorded/eeg_brain_ds004902']?.psd) {
    const p = D['recorded/eeg_brain_ds004902'].psd;
    return chart({ w: 320, h: 170, series: p.series.map((s, i) => ({ x: p.x.values, y: s.values, color: i ? S.col.dim : S.col.ink, dash: i ? '4 3' : '' })), xLabel: 'Hz', yLabel: 'uV²/Hz' })
      + legend(p.series.map((s, i) => ({ name: s.name, color: i ? S.col.dim : S.col.ink, dash: !!i }))) + '<p class="note">Conventional EEG electrodes (OpenNeuro ds004902, CC0), shown for comparison with OPM-MEG.</p>';
  }
  if (sys.id === 'skin' && D.nasa_i4) return bilirubinChart(320, 170);
  if (sys.id === 'blood') return '<p class="note">Renin is not measured in any open Inspiration4 file, and the renin nanosensor is read on a TIRF microscope (a lab assay). Its quantum physics is in the quantum-dot tab.</p>';
  return '';
}
function quantumFor(sys) {
  const q = {
    brain: ['Optically pumped rubidium spins', 'Laser light spin-polarises rubidium atoms; at zero field the vapour is transparent and a femtotesla brain field tips the spins (zero-field resonance, SERF regime).', 'P_z ∝ Γ′² / (Γ′² + Ω²),  Ω = γB'],
    heart: ['NV spin-1 and rubidium spins', 'The heart field shifts the NV ms = ±1 levels by γB (≈28 MHz/mT) and tips the OPM\'s rubidium spins. Single beats are below the NV builds\' noise; averaging hundreds to thousands of beats resolves the QRS.', 'ν± = D ± γB'],
    lungs: ['Environment, not a quantum reading', 'Cabin CO₂ and O₂ are ISS vehicle telemetry. No quantum sensor here reads the lungs.', ''],
    blood: ['Quantum confinement and FRET', 'A quantum dot\'s size sets its energy levels; its excitation passes to Cy5 by Förster transfer. Renin cuts the peptide, Cy5 leaves, and the Cy5 count drops.', 'E = R₀⁶ / (R₀⁶ + r⁶)'],
    skin: ['Quantum-confined fluorescence', 'Carbon-dot fluorescence is quenched and selectively recovers with bilirubin under blue light. Carbon-dot emission is not a spin-based quantum measurement.', ''],
    tumour: ['Environment, not a quantum reading', 'GOES measures the proton flux at geostationary orbit: exposure context for the radiation risk, not a tumour measurement.', ''],
  }[sys.id];
  return `<div class="reading"><div class="lbl">Quantum principle</div><div class="big txt">${esc(q[0])}</div></div><p class="note" style="color:var(--ink2)">${esc(q[1])}</p>${q[2] ? `<div class="eq">${esc(q[2])}</div>` : ''}`;
}

function beatChart(d, build, w = 560, h = 230) {
  const ab = d.averaged_beat, t = ab.t_s, y = ab.pT;
  const bands = [];
  if (build && d.per_build[build]) {
    const n = d.per_build[build].averaged_noise_pT.value;
    bands.push({ x: t, lo: y.map((v) => v - n), hi: y.map((v) => v + n), color: S.col.nv, opacity: 0.22 });
  }
  const q = ab.q_wave_ms_before_r / 1000;
  const vl = [{ x: 0, color: S.col.ink, dash: '2 3', label: 'R', opacity: .7 }, { x: -q, color: S.col.ink, dash: '2 3', label: 'Q', opacity: .7 }];
  return chart({ w, h, series: [{ x: t, y, color: S.col.opm, width: 1.6 }], bands, vlines: vl, xLabel: 'time from R-peak (s)', yLabel: 'pT' })
    + `<p class="note">Real averaged heartbeat: ${esc(ab.beats_averaged.value)} beats, ${esc(d.channel)}, Kiel Cardio Database (QuSpin QZFM Gen 1, Earth, not an astronaut). Q ${esc(fmtNum(ab.q_wave_pT.value))} pT at ${esc(ab.q_wave_ms_before_r)} ms before R; QRS ${esc(ab.qrs_ms)} ms.${build ? ` Band: ± averaged noise of the ${esc(build.toUpperCase())} NV build.` : ''}</p>`;
}
function bilirubinChart(w = 560, h = 230) {
  const ds = D.nasa_i4.datasets[0];
  const tps = ds.variables[0].points.map((p) => p.timepoint);
  const greys = ['#e1e5d6', '#b9c0ab', '#8e9684', '#6f7865'];
  const series = ds.variables.map((v, i) => ({ x: v.points.map((_, j) => j), y: v.points.map((p) => p.value.value), color: greys[i], dash: ['', '5 3', '2 2', '8 3'][i] }));
  const pts = ds.variables.map((v, i) => ({ x: v.points.map((_, j) => j), y: v.points.map((p) => p.value.value), color: greys[i], r: 2.5, titles: v.points.map((p) => `${v.name} ${p.timepoint}: ${p.value.value ?? 'unspecified in source'} mg/dL`) }));
  return chart({ w, h, series, points: pts, catLabels: tps, xLabel: 'timepoint (days from launch L- / return R+)', yLabel: 'mg/dL' })
    + legend(ds.variables.map((v, i) => ({ name: v.name.replace('Total bilirubin, ', ''), color: greys[i], dash: i > 0 }))) + `<p class="note">NASA OSDR OSD-575, Inspiration4 comprehensive metabolic panel (drawn on the ground). The patch reads skin interstitial fluid and has not flown.</p>`;
}

function renderRight() {
  const live = S.live || D.live_snapshot || {};
  const rd = live.opm_readiness?.[S.location] || {};
  const comb = S.combined || D.combined_sensor || {};
  const comps = Object.entries(comb.components || {});
  const bricks = comps.reduce((a, [, c]) => a + c.facts.length, 0);
  const mini = comps.map(([, c]) => `<div>${c.facts.slice(-14).map((f) => `<i class="b-${esc(f.device || 'link')}"></i>`).join('')}</div>`).join('');
  const rad = live.radiation, cab = (S.location === 'iss' ? live.iss_cabin : null) || [];
  const sens = S.sensors?.sensors || {};
  const last = (S.runs?.runs || D.runs?.runs || []).slice(-1)[0];
  $('#right-panel').innerHTML = `
    <div class="card"><h4><span>Combined sensor</span><span>v${esc(comb.version ?? 0)}</span></h4>
      <div class="mini-tower">${mini}</div>
      <div class="kv"><span>real runs</span><span class="mono">${esc(comb.runs_counted ?? 0)}</span></div>
      <div class="kv"><span>bricks (real facts)</span><span class="mono">${bricks}</span></div>
      <div class="kv"><span>open questions</span><span class="mono">${(comb.open_questions || []).length}</span></div>
      <div class="btnrow"><button class="cta" data-goto="tower">Open the tower →</button></div></div>
    <div class="card"><h4><span>Space environment</span><span>${esc(age(live.fetched_at))}</span></h4>
      <div class="kv"><span>field here</span>${vo(rd.ambient_nT)}</div>
      <div class="kv"><span>OPM needs</span>${rd.shielding_factor ? vo(rd.shielding_factor) : '<span class="na">—</span>'}</div>
      <div class="kv"><span>L1 field (${esc(live.l1?.spacecraft || 'L1')})</span>${vo(live.l1?.bt_nT)}</div>
      <div class="kv"><span>protons ≥10 MeV</span>${rad ? vo(rad.flux_ge10MeV_pfu) : '<span class="na">no data</span>'}</div>
      <div class="kv"><span>storm level</span>${rad ? vo(rad.noaa_s_scale) : '<span class="na">no data</span>'}</div>
      ${cab.map((c) => `<div class="kv"><span>${esc(c.name.replace(' (US Lab', ' (Lab').replace(' MCA)', ')'))}</span>${vo(c.reading)}</div>`).join('')}
      <div class="kv"><span>Swarm ASM</span>${live.swarm_asm ? vo(live.swarm_asm.f_nT) : '<span class="na">VIRES_TOKEN missing</span>'}</div></div>
    <div class="card"><h4><span>Instruments</span><span>live slot</span></h4>
      ${['opm', 'nv', 'qd_renin', 'cqd_patch'].map((d) => `<div class="kv"><span>${esc({ opm: 'OPM', nv: 'NV diamond', qd_renin: 'QD renin', cqd_patch: 'CQD patch' }[d])}</span><span class="na">${sens[d]?.connected ? 'connected' : 'not connected'}</span></div>`).join('')}
      <p class="note">No public live feed exists from these sensors on a human in space.</p></div>
    ${last ? `<div class="card"><h4><span>Last run</span><span>${esc(last.run_id)}</span></h4>
      <div class="kv"><span>location</span><span>${esc(last.location)}</span></div>
      <div class="kv"><span>Kiel record</span><span class="mono" style="font-size:11px">${esc((last.real_work?.kiel_record || '').replace('data/', ''))}</span></div>
      <div class="kv"><span>ODMR-Lab |B|</span>${vo(last.real_work?.odmr_lab?.b_cnn_mT)}</div>
      <div class="kv"><span>new bricks</span><span class="mono">${last.adds_to_combined.length}</span></div></div>` : ''}`;
  $$('#right-panel [data-goto]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.goto)));
}

function renderRunbar() {
  const runs = S.runs?.runs || D.runs?.runs || [];
  $('#rb-count').textContent = runs.length;
  $('#tb-runs').textContent = String(runs.length).padStart(3, '0');
  const last = runs.slice(-1)[0];
  $('#rb-last').textContent = last ? `last ${last.run_id} · ${last.location} · ${age(last.started_at)}` : 'no run yet';
  $('#rb-loc').textContent = $('#location').selectedOptions[0].textContent.split(' · ')[0];
}

function refreshTwin() {
  if (!S.twin) return;
  for (const sys of SYSTEMS) S.twin.setState(sys.id, { hasData: hasData(sys), color: S.col[sys.colorKey] });
}

// ------------------------------------------------------------------ runs
async function doRun() {
  const btn = $('#run');
  btn.disabled = true; btn.innerHTML = 'Running… (real data + ODMR-Lab)';
  try {
    const r = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: S.location, role: $('#role').value || 'crew' }) });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    const j = await r.json();
    S.combined = j.combined;
    S.runs = await getJSON('/api/runs').catch(() => S.runs);
    S.lastNew = new Set(j.run.adds_to_combined.map((b) => `${b.component}|${b.fact}`));
    toast(`${j.run.run_id}: ${j.run.adds_to_combined.length} new bricks · ${j.run.real_work.kiel_record?.replace('data/', '') || ''}${j.run.errors.length ? ' · ' + j.run.errors.join('; ') : ''}`, 6000);
    renderRunbar(); renderRight(); renderTower();
  } catch (e) {
    toast(`Run failed: ${e.message}. Is the server running (uvicorn server.main:app --port 8001)?`, 7000);
  } finally {
    btn.disabled = false; btn.innerHTML = `＋ Run at <span id="rb-loc"></span>`; renderRunbar();
  }
}

// ------------------------------------------------------------------ pages helpers
function specTable(obj, title) {
  const rows = Object.entries(obj || {}).map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${vo(v)}<div class="src">${esc(v?.source || '')}${v?.note ? ' · ' + esc(v.note) : ''}</div></td></tr>`).join('');
  return `<div class="scroll"><table>${title ? `<caption class="kick" style="text-align:left;padding-bottom:4px">${esc(title)}</caption>` : ''}<tr><th>key</th><th>value · tag · status · source</th></tr>${rows}</table></div>`;
}
function simCards(device) {
  return (D.simulators?.[device] || []).map((e) => `<div class="box"><div class="kick"><span>Online simulator · ${esc(e.access)}</span><span>${e.results.length ? e.results.length + ' result(s)' : 'awaiting simulator run'}</span></div>
    <h3><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.tool)}</a></h3><p>${esc(e.models)}</p><p class="note">Limits: ${esc(e.limits)}${e.account_needed ? ' · free account needed' : ''}</p>
    <div class="sup">${e.inputs.map((i) => `<div><span>${esc(i.name)} <span class="chip">${esc(i.origin)}</span></span>${vo(i.value)}</div>`).join('')}</div>
    ${e.missing_inputs.length ? `<p class="note">Missing inputs: ${esc(e.missing_inputs.join('; '))}</p>` : ''}
    ${e.access === 'browser' ? `<details><summary>Paste a result from this simulator</summary><p class="note">Run it in your browser, then paste what it returned. Saved with via "pasted" and picked up by the next run.</p>
      <textarea data-sim-inputs="${esc(device)}|${esc(e.tool)}" placeholder='inputs used, JSON e.g. {"field_nT": 5}'></textarea>
      <textarea data-sim-outputs="${esc(device)}|${esc(e.tool)}" placeholder='outputs, JSON e.g. {"R0_nm": {"value": 6.1, "unit": "nm", "source": "FRET-Calc", "tag": "simulated", "status": "VERIFIED", "as_of": null, "note": null}}'></textarea>
      <button class="cta" data-sim-send="${esc(device)}|${esc(e.tool)}">Save result</button></details>` : ''}</div>`).join('');
}
function wireSimForms(root) {
  $$('[data-sim-send]', root).forEach((b) => b.addEventListener('click', async () => {
    const [device, tool] = b.dataset.simSend.split('|');
    try {
      const inputs_used = JSON.parse($(`[data-sim-inputs="${device}|${tool}"]`, root).value || '{}');
      const outputs = JSON.parse($(`[data-sim-outputs="${device}|${tool}"]`, root).value || '{}');
      const r = await fetch(`/api/simulators/${device}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, inputs_used, outputs }) });
      if (!r.ok) throw new Error(await r.text());
      D.simulators = await getJSON('/data/simulators.json');
      toast(`Saved a pasted ${tool} result.`);
    } catch (e) { toast(`Could not save: ${e.message}`); }
  }));
}
const asset = (id) => (D.assets?.assets || []).find((a) => a.id === id);
const fig = (a, extraClass = '') => a ? `<figure class="${extraClass}"><img src="/${esc(a.file)}" alt="${esc(a.title)}" loading="lazy"><figcaption>${esc(a.title)}. ${esc(a.attribution)} (${esc(a.licence)}; ${esc(a.changes)}).</figcaption></figure>` : '';
const head = (k, t, p) => `<div class="page-head"><div><div class="kick">${esc(k)}</div><h2>${esc(t)}</h2><p>${p}</p></div></div>`;

// ------------------------------------------------------------------ NV tab
function nvTab() {
  const ph = D.physics.nv_odmr_lines, Dz = ph.inputs[0], G = ph.inputs[1], sp = D.specs.nv;
  const zen = D['recorded/nv_odmr_zenodo10629041'];
  const nvFigs = (D.assets?.assets || []).filter((a) => a.id.startsWith('nv_paper')).slice(1, 4);
  $('#view-nv').innerHTML = head('Quantum sensor 02 · NV centre in diamond', 'NV-diamond magnetometer: a spin-1 defect read with light and microwaves',
    'Three published builds (JGU, ZAQuant, Q.ANT; Omar et al., arXiv 2601.18843) recorded human magnetocardiograms at 6–26 pT/√Hz with sensing volumes below 0.5 mm³. An NV magnetometer of the same family flew 10 months on the ISS (OSCAR-QUBE, to confirm).') + `
  <div class="grid g2">
    <div class="box"><div class="kick"><span>Quantum mechanism</span><span>Barry et al., Rev. Mod. Phys. 92, 015004</span></div>
      <h3>Ground-state spin Hamiltonian</h3>
      <div class="eq">H₀ / h = D S_z² + (g_e μ_B / h) (B · S)
D = ${esc(Dz.value)} MHz (zero-field splitting) ${chips(Dz)}
γ = g_e μ_B / h = ${esc(G.value)} MHz/mT ${chips(G)}</div>
      <p>The NV⁻ centre is a spin-1 (S = 1) ground state, ³A₂. Spin-spin interaction lifts m_s = ±1 above m_s = 0 by D even at zero field. Green light pumps the spin into m_s = 0, which fluoresces more brightly than m_s = ±1 (spin-dependent intersystem crossing), so a microwave resonance shows up as a dip in red fluorescence: optically detected magnetic resonance (ODMR).</p>
      <div class="eq">B along the NV axis:   ν± = D ± γB            (Barry Eq. 6)
B at angle θ:         ν± = D[1 ± u cosθ + (3/2)u² sin²θ ± u³((1/8)sin³θ tanθ − (1/2)sin²θ cosθ)],  u = γB/D   (Eq. 7)
¹⁴N hyperfine: each line splits into three, 2.16 MHz apart (JGU drives all three: 2.87 GHz mixed with 2.16 MHz)</div>
    </div>
    <div class="box"><div class="kick"><span>Interactive · calculated from the equations above</span><span>tag calculated</span></div>
      <h3>Dial the field, watch the resonances split</h3>
      <div class="ctrl">|B| <input type="range" id="nv-b" min="0" max="2" step="0.01" value="1"><output id="nv-b-o"></output></div>
      <div class="ctrl">angle θ to the NV axis <input type="range" id="nv-th" min="0" max="80" step="1" value="0"><output id="nv-th-o"></output></div>
      <div id="nv-levels"></div>
      <div id="nv-freqs" class="sup"></div>
    </div>
    <div class="box wide"><div class="kick"><span>Real measured spectrum (recorded) with the calculated resonances</span><span>Zenodo 10629041 · CC BY 4.0</span></div>
      <div id="nv-spec"></div>
      <p class="note">Measured zero-field ODMR of NV⁻ ensembles in a laser-written diamond waveguide (Alam et al., Phys. Rev. Applied 22, 024055, 2024): three of the 47 positions and their mean, each divided by its own median so they overlay (that division is the only processing). Lines: where the two resonances sit at the chosen field (calculated), with ¹⁴N hyperfine ticks. The measured spectrum itself is at zero field and does not move.</p>
    </div>
    <div class="box"><div class="kick"><span>Real online simulator · ODMR-Lab</span><span>tag simulated</span></div>
      <h3>Run ODMR-Lab at this field</h3>
      <p>One real call to the ODMR-Lab simulator (Hugging Face, MIT): ensemble NV spectrum from the full ground-state Hamiltonian with ¹⁴N hyperfine and photon shot noise, then a neural network and a least-squares fit estimate |B|. Settings are the app defaults; the field is the one you dialled (θ in the x–z plane).</p>
      <div class="btnrow"><button class="cta" id="nv-sim">Run ODMR-Lab at <span id="nv-sim-b"></span></button></div>
      <div id="nv-sim-out" style="margin-top:10px"></div>
    </div>
    <div class="box"><div class="kick"><span>Field geometry · calculated</span><span>physics.json</span></div>
      <h3>f± against field (along the axis)</h3><div id="nv-lines"></div></div>
    <div class="box wide"><div class="kick"><span>Biology · the heart</span><span>real recording + calculated noise bands</span></div>
      <h3>What each NV build would see of a real heartbeat</h3>
      <div class="ctrl">noise band of build <select id="nv-build" class="num" style="width:auto"><option value="jgu">JGU · 13 pT/√Hz · zero bias</option><option value="zaquant">ZAQuant · 7 pT/√Hz · 1 mT</option><option value="qant" selected>Q.ANT · 26 pT/√Hz · unshielded</option></select></div>
      <div id="nv-beat"></div><div class="scroll" id="nv-snr"></div></div>
    <div class="box wide"><div class="kick"><span>Hardware · every value sourced</span><span>specs.json</span></div>
      <div class="grid g2"><div>${specTable(sp.headline, 'headline')}</div><div>${specTable(sp.jgu, 'JGU (Mainz) build')}</div><div>${specTable(sp.zaquant, 'ZAQuant (Stuttgart) build')}</div><div>${specTable(sp.qant, 'Q.ANT build')}</div><div>${specTable(D.specs.space_heritage.oscar_qube, 'OSCAR-QUBE: NV magnetometer on the ISS')}</div></div></div>
    <div class="box wide"><div class="kick"><span>The real sensors</span><span>arXiv 2601.18843, CC BY 4.0</span></div><div class="grid g3">${nvFigs.map((a) => fig(a)).join('')}</div></div>
    ${simCards('nv')}
  </div>`;
  const draw = () => {
    const B = +$('#nv-b').value, th = +$('#nv-th').value * Math.PI / 180, d = Dz.value, g = G.value, u = g * B / d;
    const c = Math.cos(th), s2 = Math.sin(th) ** 2, s3 = Math.sin(th) ** 3, tn = Math.tan(th);
    const nup = d * (1 + u * c + 1.5 * u * u * s2 + u ** 3 * (s3 * tn / 8 - 0.5 * s2 * c));
    const ndn = d * (1 - u * c + 1.5 * u * u * s2 - u ** 3 * (s3 * tn / 8 - 0.5 * s2 * c));
    $('#nv-b-o').textContent = `${B.toFixed(2)} mT`; $('#nv-th-o').textContent = `${Math.round(th * 180 / Math.PI)}°`;
    $('#nv-sim-b').textContent = `${B.toFixed(2)} mT, ${Math.round(th * 180 / Math.PI)}°`;
    $('#nv-freqs').innerHTML = `<div><span>ν− (m_s 0 → −1)</span><span class="mono">${ndn.toFixed(2)} MHz</span></div><div><span>ν+ (m_s 0 → +1)</span><span class="mono">${nup.toFixed(2)} MHz</span></div><div><span>splitting ν+ − ν−</span><span class="mono">${(nup - ndn).toFixed(2)} MHz</span></div><div><span>formula</span><span class="mono">Barry Eq. ${th ? '7' : '6'} · calculated</span></div>`;
    // level diagram: m_s = 0 at the bottom, then a broken axis that magnifies the region around D so the splitting shows
    const span = Math.max(40, (nup - ndn) / 2 + 15), lo = d - span, hi = d + span;
    const Yu = (f) => 128 - ((f - lo) / (hi - lo)) * 104;
    const lvl = (y, col, w2, lab, val) => `<line x1="150" x2="330" y1="${y}" y2="${y}" stroke="${col}" stroke-width="${w2}"/><text x="338" y="${y + 4}">${lab}</text><text x="470" y="${y + 4}" style="font-family:var(--mono);fill:#e1e5d6">${val}</text>`;
    $('#nv-levels').innerHTML = `<svg class="chart" viewBox="0 0 560 205">
      <text x="8" y="14">³A₂ ground-state spin levels (frequency units; axis broken above m_s = 0)</text>
      ${lvl(Yu(d), S.col.dim, 1, 'D (zero field)', `${d} MHz`).replace('stroke-width="1"', 'stroke-width="1" stroke-dasharray="4 3"')}
      ${lvl(Yu(nup), S.col.nv, 2.5, 'm_s = +1', `${nup.toFixed(1)} MHz`)}
      ${lvl(Yu(ndn), S.col.nv, 2.5, 'm_s = −1', `${ndn.toFixed(1)} MHz`)}
      <path d="M140,150 l10,-5 l10,5 l10,-5" stroke="#5c6552" fill="none"/><path d="M140,158 l10,-5 l10,5 l10,-5" stroke="#5c6552" fill="none"/>
      ${lvl(190, S.col.ink, 2.5, 'm_s = 0', '0 MHz')}
      <line x1="200" x2="200" y1="190" y2="${Yu(ndn) + 3}" stroke="${S.col.nv}" marker-end="url(#ar)"/><text x="184" y="175" text-anchor="end">ν−</text>
      <line x1="280" x2="280" y1="190" y2="${Yu(nup) + 3}" stroke="${S.col.nv}" marker-end="url(#ar)"/><text x="296" y="175">ν+</text>
      <text x="8" y="${Yu(d) + 4}">${(nup - ndn).toFixed(1)} MHz apart</text>
      <defs><marker id="ar" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="${S.col.nv}"/></marker></defs></svg>`;
    // real spectrum + calculated lines
    const x = zen.x.values;
    const norm = (vals) => { const sorted = [...vals].sort((a, b) => a - b); const med = sorted[Math.floor(sorted.length / 2)]; return vals.map((v) => v / med); };
    const greys = ['#8e9684', '#b9c0ab', '#6f7865'];
    const series = zen.series.map((s, i) => ({ x, y: norm(s.values), color: i === 3 ? S.col.ink : greys[i], width: i === 3 ? 1.8 : 1, opacity: i === 3 ? 1 : 0.8 }));
    const vl = [];
    for (const f of [ndn, nup]) { vl.push({ x: f, color: S.col.nv, width: 1.6, label: f === ndn ? 'ν−' : 'ν+' }); vl.push({ x: f - 2.16, color: S.col.nv, dash: '2 2', opacity: .6 }); vl.push({ x: f + 2.16, color: S.col.nv, dash: '2 2', opacity: .6 }); }
    const outside = [ndn, nup].some((f) => f < x[0] || f > x[x.length - 1]);
    $('#nv-spec').innerHTML = chart({ w: 1100, h: 250, series, vlines: vl, xLabel: 'microwave frequency (MHz)', yLabel: 'counts / median', xDomain: [x[0], x[x.length - 1]] })
      + legend([...zen.series.map((s, i) => ({ name: s.name, color: i === 3 ? S.col.ink : greys[i] })), { name: 'ν± at the dialled field (calculated)', color: S.col.nv }])
      + (outside ? '<p class="note">At this field one or both resonances lie outside the measured 2820–2920 MHz window.</p>' : '');
    $('#nv-lines').innerHTML = chart({ w: 560, h: 220, series: [{ x: ph.x, y: ph.y, color: S.col.nv }, { x: ph.x, y: ph.extra_series[0].y, color: S.col.nv, dash: '5 3' }], vlines: [{ x: B, color: S.col.ink, dash: '3 3', label: `${B.toFixed(2)} mT` }], xLabel: ph.x_label, yLabel: 'MHz' })
      + legend([{ name: 'f+ = D + γB', color: S.col.nv }, { name: 'f− = D − γB', color: S.col.nv, dash: true }]);
  };
  $('#nv-b').addEventListener('input', draw); $('#nv-th').addEventListener('input', draw); draw();
  const drawBeat = () => {
    const b = $('#nv-build').value, pb = D.nv_heart_derived.per_build;
    $('#nv-beat').innerHTML = beatChart(D.nv_heart_derived, b, 1100, 260);
    $('#nv-snr').innerHTML = `<table><tr><th>build</th><th>noise density</th><th>single-beat noise</th><th>averaged noise</th><th>single-beat SNR</th><th>averaged SNR (25 pT)</th><th>SNR, measured R-peak</th><th>SNR, Q wave</th></tr>${['jgu', 'zaquant', 'qant'].map((k) => `<tr><td class="k">${k.toUpperCase()}</td><td>${vo(pb[k].noise_density)}</td><td>${vo(pb[k].single_beat_noise_pT)}</td><td>${vo(pb[k].averaged_noise_pT)}</td><td>${vo(pb[k].single_beat_snr)}</td><td>${vo(pb[k].averaged_snr)}</td><td>${vo(pb[k].averaged_snr_measured_peak)}</td><td>${vo(pb[k].averaged_snr_q_wave)}</td></tr>`).join('')}</table><p class="note">single_beat_noise = η·√BW (BW 30 Hz); averaged_noise = single/√N; SNR = amplitude / noise. Single heartbeats are not resolved at these sensitivities; readings rely on averaging.</p>`;
  };
  $('#nv-build').addEventListener('change', drawBeat); drawBeat();
  $('#nv-sim').addEventListener('click', async () => {
    const B = +$('#nv-b').value, th = +$('#nv-th').value * Math.PI / 180, btn = $('#nv-sim');
    btn.disabled = true; $('#nv-sim-out').innerHTML = '<p class="note">Calling the ODMR-Lab Space (a few seconds; longer if it is waking up)…</p>';
    try {
      const r = await fetch('/api/simulate/odmr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bx: +(B * Math.sin(th)).toFixed(4), by: 0, bz: +(B * Math.cos(th)).toFixed(4) }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.status);
      const j = await r.json();
      $('#nv-sim-out').innerHTML = `<div class="sup"><div><span>field sent</span><span class="mono">${j.b_sent_mT.map((v) => v.toFixed(3)).join(', ')} mT</span></div><div><span>|B| used</span>${vo(j.b_true_mT)}</div><div><span>|B| estimated by its CNN</span>${vo(j.b_cnn_mT)}</div></div>${j.plot_file ? `<figure class="simwrap"><img src="/${j.plot_file.replace(/^\/?/, '')}?t=${Date.now()}" alt="ODMR-Lab output"><figcaption>ODMR-Lab output (MIT). Its legend says "measured"; it is a simulated spectrum.</figcaption></figure>` : ''}`;
    } catch (e) { $('#nv-sim-out').innerHTML = `<p class="note">ODMR-Lab call failed: ${esc(e.message)}</p>`; }
    btn.disabled = false;
  });
  wireSimForms($('#view-nv'));
}

// ------------------------------------------------------------------ OPM tab
function blochSVG(P) {
  const R = 110, cx = 150, cy = 140, az = -0.6, el = 0.33;
  const proj = (x, y, z) => { const x1 = x * Math.cos(az) - y * Math.sin(az), y1 = x * Math.sin(az) + y * Math.cos(az); return [cx + R * x1, cy - R * (z * Math.cos(el) - y1 * Math.sin(el))]; };
  const path = (f) => { let d = ''; for (let i = 0; i <= 72; i++) { const t = (i / 72) * 2 * Math.PI; const [a, b] = proj(...f(t)); d += (i ? 'L' : 'M') + a.toFixed(1) + ',' + b.toFixed(1); } return d; };
  const [px, py] = proj(P[0], P[1], P[2]), [ex, ey] = proj(P[0], P[1], 0), [ox, oy] = proj(0, 0, 0);
  const ax = (v, l) => { const [a, b] = proj(...v); const [c, d] = proj(...v.map((q) => -q)); return `<line x1="${c}" y1="${d}" x2="${a}" y2="${b}" stroke="#5c6552"/><text x="${a + 4}" y="${b}">${l}</text>`; };
  return `<svg class="chart" viewBox="0 0 300 290">
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="rgba(169,212,140,.04)" stroke="#5c6552"/>
    <path d="${path((t) => [Math.cos(t), Math.sin(t), 0])}" fill="none" stroke="#5c6552" stroke-dasharray="3 3"/>
    <path d="${path((t) => [Math.cos(t), 0, Math.sin(t)])}" fill="none" stroke="#3f4737"/>
    ${ax([1.15, 0, 0], 'x')}${ax([0, 1.15, 0], 'y · B_y')}${ax([0, 0, 1.15], 'z · pump σ⁺ (Rb D1)')}
    <line x1="${px}" y1="${py}" x2="${ex}" y2="${ey}" stroke="${S.col.dim}" stroke-dasharray="2 2"/>
    <line x1="${ox}" y1="${oy}" x2="${px}" y2="${py}" stroke="${S.col.opm}" stroke-width="3"/>
    <circle cx="${px}" cy="${py}" r="5" fill="${S.col.opm}"/>
    <text x="8" y="282">steady-state electron polarisation P (calculated, Sulai Eq. B2)</text></svg>`;
}
async function opmTab() {
  const sp = D.specs.opm, ph = D.physics.opm_zero_field, sw = D.specs.space_heritage.swarm_asm;
  const kiel = (D.assets?.assets || []).filter((a) => a.id.startsWith('kiel_')).slice(0, 2);
  const eeg = D['recorded/eeg_brain_ds004902'];
  $('#view-opm').innerHTML = head('Quantum sensor 01 · optically pumped magnetometer', 'QuSpin QZFM Gen-3: rubidium spins at zero field',
    `A laser spin-polarises a rubidium vapour; a magnetic field tips the spins and changes how much light the cell lets through. ${esc(sp.sensitivity_dual_axis.value)} ${esc(sp.sensitivity_dual_axis.unit)} dual-axis, ±5 nT range, ${esc(sp.sensor_head.value)} mm head, no cryogenics. Real OPM heart and brain recordings below; the same physics family flies on ESA's Swarm (helium-4 ASM).`) + `
  <div class="grid g2">
    <div class="box"><div class="kick"><span>Quantum mechanism</span><span>QuSpin; Sulai et al. arXiv 1906.03227</span></div>
      <h3>Optical pumping, dark state, spin precession, SERF</h3>
      <p><b>Optical pumping.</b> Circularly polarised light on the rubidium D1 line (795 nm) transfers angular momentum to the atoms and drives them into the stretched spin state, which no longer absorbs the pump: a dark, transparent state. QuSpin: "When the background magnetic field is zero, the rubidium atoms become largely transparent."</p>
      <p><b>Precession.</b> A transverse field B rotates the polarisation at the Larmor rate Ω = γB; relaxation Γ′ (spin collisions plus pumping) pulls it back. The balance gives the steady state below.</p>
      <p><b>SERF.</b> With a dense vapour (QZFM cell ${vo((D.build_log?.per_sensor?.opm || []).find((f) => /vapor cell/i.test(f.fact))?.value)}; about 10¹⁴ atoms/cm³ in Sulai's 150 °C cell) and near-zero field, spin exchange is so fast that the atoms share one spin temperature and spin-exchange collisions stop dephasing the precession: the spin-exchange relaxation-free regime, which narrows the zero-field resonance to about 30 nT (QuSpin, to confirm full vs half width).</p>
      <div class="eq">2 d⟨F⟩/dt = R (s − ⟨P⟩) + Ω × ⟨P⟩ − Γ⟨P⟩          (Sulai Eq. B1)
⟨P⟩ = R / (Γ′(Γ′² + Ω²)) · [ Γ′Ω_y + Ω_zΩ_x ,  −Γ′Ω_x + Ω_yΩ_z ,  Γ′² + Ω_z² ],  Γ′ = Γ + R   (Eq. B2)</div>
      <p class="note">Single-beam QZFM: the photodiode sees the transmitted light (∝ P_z, a Lorentzian in B); a 1 kHz modulation field and lock-in detection turn it into a dispersion curve with maximum slope at zero field (QuSpin). Two orthogonal modulation fields give two axes.</p>
    </div>
    <div class="box"><div class="kick"><span>Interactive · Bloch sphere</span><span>tag calculated · dimensionless Ω/Γ′</span></div>
      <div class="bloch"><div id="opm-bloch"></div><div>
        <div class="ctrl">Ω_x/Γ′ <input type="range" id="ox" min="-5" max="5" step="0.05" value="0"><output id="ox-o"></output></div>
        <div class="ctrl">Ω_y/Γ′ <input type="range" id="oy" min="-5" max="5" step="0.05" value="0.6"><output id="oy-o"></output></div>
        <div class="ctrl">Ω_z/Γ′ <input type="range" id="oz" min="-5" max="5" step="0.05" value="0"><output id="oz-o"></output></div>
        <div class="sup" id="opm-p"></div>
        <p class="note">Field in units of the resonance half width (B/ΔB, ΔB = Γ′/γ). QuSpin does not state the QZFM's ΔB numerically beyond "about 30 nT wide", so the axes stay dimensionless.</p></div></div>
      <div id="opm-res"></div></div>
    <div class="box wide"><div class="kick"><span>Biology · heart, recorded replay paced at 200 Hz</span><span>Kiel Cardio Database · CC BY-SA 4.0</span></div>
      <h3>Real OPM magnetocardiogram (QuSpin QZFM Gen 1, Earth)</h3>
      <canvas id="opm-stream" width="1100" height="200" style="width:100%;height:200px;background:rgba(0,0,0,.15);border:1px solid var(--line)"></canvas>
      <p class="note" id="opm-stream-note">Streams /api/stream/opm_heart_kiel at the recording's own 200 Hz, looping. Recorded, not live; not an astronaut.</p>
      ${beatChart(D.nv_heart_derived, null, 1100, 230)}</div>
    <div class="box"><div class="kick"><span>Biology · brain</span><span>MNE OPM sample (nine QuSpin SERF OPMs)</span></div>
      <h3>Somatosensory evoked field</h3><div id="opm-evoked"><p class="note">Loading the recording (2.6 MB)…</p></div></div>
    <div class="box"><div class="kick"><span>Comparison · conventional EEG (not quantum)</span><span>OpenNeuro ds004902 · CC0</span></div>
      <h3>Alpha power after normal sleep vs sleep deprivation</h3>
      ${eeg?.psd ? chart({ w: 560, h: 220, series: eeg.psd.series.map((s, i) => ({ x: eeg.psd.x.values, y: s.values, color: i ? S.col.dim : S.col.ink, dash: i ? '4 3' : '' })), xLabel: 'frequency (Hz)', yLabel: 'uV²/Hz' }) + legend(eeg.psd.series.map((s, i) => ({ name: s.name, color: i ? S.col.dim : S.col.ink, dash: !!i }))) : ''}
      <p class="note">${eeg ? esc(Object.entries(eeg.alpha_8_12Hz_uV2_per_Hz).map(([k, v]) => `${k}: ${v} uV²/Hz`).join(' · ')) + ' (8–12 Hz, occipital mean, one subject).' : ''}</p></div>
    <div class="box"><div class="kick"><span>Readiness by location</span><span>live + published fields</span></div>
      <h3>How much field reduction the OPM needs</h3><div id="opm-ready"></div>
      <p class="note">Ambient ÷ ±5 nT range. Uses the external field; cabin fields are larger (OSCAR-QUBE reported interference from station equipment). QuSpin asks for about 50 nT or below at the sensor; built-in coils cancel up to 50 nT.</p></div>
    <div class="box"><div class="kick"><span>Space heritage</span><span>ESA</span></div>
      <h3>An optically pumped magnetometer in orbit</h3>${specTable(sw)}<div class="kv"><span>latest Swarm F</span>${(S.live || D.live_snapshot)?.swarm_asm ? vo((S.live || D.live_snapshot).swarm_asm.f_nT) : '<span class="na">VIRES_TOKEN missing (free at vires.services)</span>'}</div></div>
    <div class="box wide"><div class="kick"><span>Hardware · QuSpin QZFM Gen-3</span><span>datasheet + published</span></div>${specTable(sp)}</div>
    <div class="box wide"><div class="kick"><span>The real sensors</span><span>Kiel Cardio Database photos</span></div><div class="grid g2">${kiel.map((a) => fig(a)).join('')}</div></div>
    ${simCards('opm')}
  </div>`;
  const draw = () => {
    const wx = +$('#ox').value, wy = +$('#oy').value, wz = +$('#oz').value, den = 1 + wx * wx + wy * wy + wz * wz;
    const P = [(wy + wz * wx) / den, (-wx + wy * wz) / den, (1 + wz * wz) / den];
    $('#ox-o').textContent = wx.toFixed(2); $('#oy-o').textContent = wy.toFixed(2); $('#oz-o').textContent = wz.toFixed(2);
    $('#opm-bloch').innerHTML = blochSVG(P);
    $('#opm-p').innerHTML = `<div><span>P_x (lock-in, dispersive)</span><span class="mono">${P[0].toFixed(3)}</span></div><div><span>P_y</span><span class="mono">${P[1].toFixed(3)}</span></div><div><span>P_z (transmitted light)</span><span class="mono">${P[2].toFixed(3)}</span></div><div><span>|P| (units of R/Γ′)</span><span class="mono">${Math.hypot(...P).toFixed(3)}</span></div>`;
    $('#opm-res').innerHTML = chart({ w: 560, h: 200, series: [{ x: ph.x, y: ph.y, color: S.col.opm }, { x: ph.x, y: ph.extra_series[0].y, color: S.col.opm, dash: '5 3' }], vlines: [{ x: wy, color: S.col.ink, dash: '3 3', label: 'Ω_y' }], xLabel: ph.x_label, yLabel: 'signal / max' })
      + legend([{ name: 'transmitted light ∝ P_z (Lorentzian)', color: S.col.opm }, { name: 'lock-in output ∝ P_x (dispersive)', color: S.col.opm, dash: true }]);
  };
  ['ox', 'oy', 'oz'].forEach((id) => $(`#${id}`).addEventListener('input', draw)); draw();
  const live = S.live || D.live_snapshot || {};
  $('#opm-ready').innerHTML = `<table><tr><th>location</th><th>ambient field</th><th>reduction needed</th><th>inside ±5 nT</th></tr>${Object.entries(live.opm_readiness || {}).map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${vo(v.ambient_nT)}</td><td>${v.shielding_factor ? vo(v.shielding_factor) : ''}</td><td class="mono">${v.within_range === null ? '—' : v.within_range ? 'yes' : 'no'}</td></tr>`).join('')}</table>`;
  startStream();
  try {
    const meg = await getJSON('/data/recorded/opm_brain_mne.json');
    const ev = meg.evoked;
    $('#opm-evoked').innerHTML = chart({ w: 560, h: 230, series: ev.series.map((s, i) => ({ x: ev.x.values, y: s.values, color: S.col.opm, width: 1, opacity: 0.35 + 0.08 * i })), vlines: [{ x: 0, color: S.col.ink, dash: '3 3', label: 'stimulus' }], xLabel: 'time from median-nerve stimulus (s)', yLabel: 'fT' })
      + `<p class="note">${esc(ev.n_epochs)} real epochs averaged, ${ev.series.length} OPM channels. ${esc(meg.meta.label)} ${esc(meg.meta.licence)}.</p>`;
  } catch (e) { $('#opm-evoked').innerHTML = `<p class="note">Could not load the recording: ${esc(e.message)}</p>`; }
  wireSimForms($('#view-opm'));
}
let es = null;
function startStream() {
  if (es) return;
  const cv = $('#opm-stream'); if (!cv) return;
  const ctx = cv.getContext('2d'), buf = [], keep = 800;
  const chName = D.nv_heart_derived?.channel || '';
  try { es = new EventSource('/api/stream/opm_heart_kiel'); } catch { return; }
  es.onmessage = (m) => {
    const p = JSON.parse(m.data); const s = p.series.find((x) => chName.startsWith(x.name.split(' ')[0])) || p.series[0];
    buf.push(...s.values); while (buf.length > keep) buf.shift();
    const w = cv.width, h = cv.height, lo = Math.min(...buf), hi = Math.max(...buf);
    ctx.clearRect(0, 0, w, h); ctx.strokeStyle = S.col.opm; ctx.lineWidth = 1.4; ctx.beginPath();
    buf.forEach((v, i) => { const x = (i / keep) * w, y = h - 10 - ((v - lo) / ((hi - lo) || 1)) * (h - 20); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke(); ctx.fillStyle = '#8e9684'; ctx.font = '11px IBM Plex Mono';
    ctx.fillText(`${s.name} · ${p.unit} · ${lo.toFixed(1)} to ${hi.toFixed(1)} · last 4 s · recorded replay`, 8, 14);
  };
  es.onerror = () => { $('#opm-stream-note').textContent = 'Stream unavailable (is the server running?). The averaged beat below comes from the saved data.'; };
}

// ------------------------------------------------------------------ quantum-dot tab
function qdTab() {
  const ph = D.physics.qd_fret_vs_distance, sp = D.specs.qd_renin, fig1 = D['recorded/qd_fret_figshare5468838'];
  const eff = fig1.series.find((s) => s.name === 'FRET efficiency');
  const rr = eff.values.map((e) => Math.pow(1 / (e / 100) - 1, 1 / 6));
  $('#view-qd').innerHTML = head('Quantum sensor 03 · semiconductor quantum dot', 'Quantum-dot renin nanosensor: confinement and Förster transfer',
    `A streptavidin-coated quantum dot carries several biotinylated, Cy5-labelled peptides. Renin cuts the peptide, Cy5 leaves, FRET stops and the Cy5 count falls; single molecules are counted by TIRF microscopy. Detection limit ${esc(sp.detection_limit.value)} ${esc(sp.detection_limit.unit)} (Long et al., Anal. Chem. 84, 8846, 2012).`) + `
  <div class="grid g2">
    <div class="box"><div class="kick"><span>Quantum mechanism · confinement</span><span>textbook model</span></div>
      <h3>Particle in a box: size sets the levels</h3>
      <div class="eq">E_n = n² h² / (8 m* L²),  n = 1, 2, 3 …
halve L → every level ×4;  the band-gap step above the bulk gap grows as 1/L²</div>
      <div class="ctrl">box size L / L₀ <input type="range" id="qd-l" min="0.5" max="2" step="0.01" value="1"><output id="qd-l-o"></output></div>
      <div id="qd-ladder"></div>
      <p class="note">Energies in units of E₁ at L₀ (dimensionless). The renin paper does not state the dot's material, effective mass or size, so no eV scale or emission colour is drawn: drawing one would invent it.</p></div>
    <div class="box"><div class="kick"><span>Quantum mechanism · FRET</span><span>FRET-Calc, Comput. Phys. Commun. 2023</span></div>
      <h3>Förster energy transfer to Cy5</h3>
      <div class="eq">k_FRET = (1/τ_D)(R₀/r)⁶                    (Eq. 1)
E = R₀⁶ / (R₀⁶ + r⁶)                        (Eq. 2)
E = n_A R₀⁶ / (n_A R₀⁶ + r⁶)  for n_A acceptors (Eq. 3)
R₀ = 0.0211 (κ² Θ_D J(λ) / n⁴)^(1/6) nm     (Eq. 4)</div>
      <div class="ctrl">r / R₀ <input type="range" id="qd-r" min="0" max="2" step="0.01" value="1"><output id="qd-r-o"></output></div>
      <div class="ctrl">acceptors per dot n_A <input type="range" id="qd-n" min="1" max="10" step="1" value="1"><output id="qd-n-o"></output></div>
      <div id="qd-fret"></div></div>
    <div class="box"><div class="kick"><span>Real lab data (recorded)</span><span>figshare c.5468838 · CC BY 4.0</span></div>
      <h3>Measured FRET from CdTe/CdS dots to rhodamine 101</h3>
      ${chart({ w: 560, h: 220, series: [{ x: fig1.x.values, y: eff.values, color: S.col.qd }], points: [{ x: fig1.x.values, y: eff.values, color: S.col.ink, r: 3.5 }], xLabel: 'pressure (GPa)', yLabel: 'FRET efficiency (%)' })}
      <table><tr><th>pressure</th><th>E measured</th><th>r/R₀ implied (calculated, Eq. 2)</th></tr>${fig1.x.values.map((p, i) => `<tr><td class="mono">${fmtNum(p)} GPa</td><td class="mono">${eff.values[i]} %</td><td class="mono">${rr[i].toFixed(3)}</td></tr>`).join('')}</table>
      <p class="note">${esc(fig1.meta.label)} Li et al., Optics Express 29, 27171 (2021), Table S1. Compression packs more acceptors near each dot, raising E.</p></div>
    <div class="box"><div class="kick"><span>The real dots</span><span>TEM micrograph</span></div>${fig(asset('qd_tem_figS1'))}</div>
    <div class="box wide"><div class="kick"><span>Biology · blood renin</span><span>renin–angiotensin system</span></div>
      <h3>What it would measure in an astronaut</h3>
      <p>Renin starts the renin–angiotensin cascade that regulates blood volume and pressure; weightlessness alters blood circulation (NASA: Risk of Cardiovascular Adaptations).</p>
      <div class="sup"><div><span>detection limit</span>${vo(sp.detection_limit)}</div><div><span>readout</span>${vo(sp.readout)}</div><div><span>Inspiration4 renin</span><span class="na">${esc((D.nasa_i4?.not_found || [])[0] || '')}</span></div></div></div>
    <div class="box wide"><div class="kick"><span>Hardware and chemistry · every value sourced</span><span>specs.json</span></div>${specTable(sp)}</div>
    ${simCards('qd_renin')}
  </div>`;
  const draw = () => {
    const L = +$('#qd-l').value, r = +$('#qd-r').value, n = +$('#qd-n').value;
    $('#qd-l-o').textContent = `${L.toFixed(2)} L₀`; $('#qd-r-o').textContent = r.toFixed(2); $('#qd-n-o').textContent = n;
    const lv = [1, 2, 3, 4].map((k) => (k * k) / (L * L)), H = 180, top = 10, bot = 165, mx = 16 / 0.25;
    const Yl = (e) => bot - (Math.log10(e + 1) / Math.log10(mx + 1)) * (bot - top);
    const wellW = 40 + 120 * L / 2;
    $('#qd-ladder').innerHTML = `<svg class="chart" viewBox="0 0 560 ${H}"><rect x="${280 - wellW / 2}" y="${top}" width="${wellW}" height="${bot - top}" fill="none" stroke="#5c6552"/>
      ${lv.map((e, i) => `<line x1="${280 - wellW / 2}" x2="${280 + wellW / 2}" y1="${Yl(e)}" y2="${Yl(e)}" stroke="${S.col.qd}" stroke-width="2"/><text x="${280 + wellW / 2 + 8}" y="${Yl(e) + 4}">n=${i + 1}: ${e.toFixed(2)} E₁(L₀)</text>`).join('')}
      <text x="10" y="${bot}">width ∝ L</text><text x="10" y="${top + 10}">log scale</text></svg>`;
    const xs = ph.x, multi = xs.map((x) => n / (n + x ** 6));
    $('#qd-fret').innerHTML = chart({ w: 560, h: 210, series: [{ x: xs, y: ph.y, color: S.col.qd }, ...(n > 1 ? [{ x: xs, y: multi, color: S.col.ink, dash: '5 3' }] : [])], points: [{ x: rr, y: eff.values.map((v) => v / 100), color: S.col.ink, r: 3, titles: fig1.x.values.map((p, i) => `${fmtNum(p)} GPa: E ${eff.values[i]}%`) }], vlines: [{ x: r, color: '#a9d48c', dash: '3 3', label: `E = ${(n / (n + r ** 6)).toFixed(3)}` }], xLabel: 'r / R₀', yLabel: 'FRET efficiency E', yDomain: [0, 1.05] })
      + legend([{ name: 'E, one acceptor (physics.json)', color: S.col.qd }, ...(n > 1 ? [{ name: `E, ${n} acceptors (Eq. 3 explorer; the probe's count is not stated)`, color: S.col.ink, dash: true }] : []), { name: 'measured CdTe/CdS points (recorded → calculated r/R₀)', color: S.col.ink }]);
  };
  ['qd-l', 'qd-r', 'qd-n'].forEach((id) => $(`#${id}`).addEventListener('input', draw)); draw();
  wireSimForms($('#view-qd'));
}

// ------------------------------------------------------------------ carbon-dot tab
function cqdTab() {
  const sp = D.specs.cqd_patch, men = D['recorded/cqd_pl_mendeley_cmfbrvrb8y'], q = D.physics.cqd_quenching;
  const cols = (D.palette?.colours || []).filter((c) => c.device === 'cqd_patch' || c.device === 'opm' || c.device === 'nv' || c.device === 'space_heritage');
  $('#view-cqd').innerHTML = head('Quantum sensor 04 · carbon quantum dots', 'Carbon-dot microneedle patch: quantum-confined fluorescence in the skin',
    `Dissolving/hydrogel microneedles leave fluorescent carbon quantum dots in the skin as an invisible tattoo. Their fluorescence is quenched and recovers selectively with bilirubin under the blue light used for jaundice phototherapy; an IoT wearable reader tracks it (Tabatabaee et al., ACS Nano 18, 28012, 2024).`) + `
  <div class="grid g2">
    <div class="box"><div class="kick"><span>Quantum mechanism</span><span>physics label</span></div>
      <h3>Why carbon dots glow, and what that is not</h3>
      <p>Carbon dots are few-nanometre carbon nanoparticles whose photoluminescence comes from quantum-confined states and surface states. Absorbing a photon lifts an electron across the confined gap; it relaxes and re-emits at a longer wavelength (Stokes shift). Quenchers close the radiative path; removing them restores the glow, which is the patch's sensing step.</p>
      <div class="eq">${esc(sp.physics_label.value)}</div>
      <p class="note">${esc(q.missing_inputs.join('; '))}: the quenching/recovery curve is not drawn because its model and constants are not public.</p></div>
    <div class="box"><div class="kick"><span>Real lab data (recorded)</span><span>Mendeley cmfbrvrb8y · CC BY 4.0</span></div>
      <h3>Measured carbon-dot emission against excitation</h3>
      ${chart({ w: 560, h: 230, series: [], points: [{ x: men.x.values, y: men.series[0].values, color: S.col.cqd, stroke: '#e1e5d6', r: 4, titles: men.x.values.map((x, i) => `excited ${x} nm → emits ${men.series[0].values[i]} nm`) }], xLabel: 'excitation wavelength (nm)', yLabel: 'emission maximum (nm)' })}
      <p class="note">${esc(men.meta.label)} The authors' own validation syntheses (${men.x.values.length} records with emission). Point colour: the CIE colour of 439 nm, the most common measured emission.</p></div>
    <div class="box"><div class="kick"><span>Colour is physics</span><span>CIE 1931 tables</span></div>
      <h3>Colours computed from cited wavelengths</h3>
      <table><tr><th>line</th><th>wavelength</th><th>colour</th></tr>${cols.map((c) => `<tr><td>${esc(c.label)}</td><td>${vo(c.wavelength)}</td><td>${c.colour.value ? `<span class="swatch" style="background:${esc(c.colour.value)}"></span><span class="mono">${esc(c.colour.value)}</span>` : `<span class="na">${esc(c.colour.note || 'none')}</span>`}</td></tr>`).join('')}</table></div>
    <div class="box"><div class="kick"><span>Biology · skin and blood bilirubin</span><span>NASA OSDR OSD-575</span></div>
      <h3>Inspiration4 total bilirubin (real astronaut reference)</h3>${bilirubinChart(560, 230)}</div>
    <div class="box wide"><div class="kick"><span>Hardware · every value sourced</span><span>specs.json</span></div>${specTable(sp)}</div>
    ${simCards('cqd_patch')}
  </div>`;
  wireSimForms($('#view-cqd'));
}

// ------------------------------------------------------------------ tower and sources
function renderTower() {
  const el = $('#view-tower'); if (!el) return;
  const comb = S.combined || D.combined_sensor || {}, runs = S.runs?.runs || D.runs?.runs || [];
  const cols = Object.entries(comb.components || {}).map(([name, c]) => `<div class="tcol"><div class="lbl">${esc(name)}<br>${c.facts.length} · ${esc(c.status)}</div>${c.facts.map((f) => `<div class="brick b-${esc(f.device || 'link')} ${S.lastNew?.has(`${name}|${f.fact}`) ? 'new' : ''}" title="${esc(f.fact)}\n${esc(String(f.value.value))} ${esc(f.value.unit || '')}\n${esc(f.value.tag)} · ${esc(f.value.status)}\nfrom ${esc(f.from_run)}\n${esc(f.value.source || '')}"></div>`).join('')}</div>`).join('');
  el.innerHTML = head('The combined sensor', `One real all-in-one quantum sensor, version ${comb.version ?? 0}`,
    'Every brick is a real fact added by a real run: a new Kiel heart position measured, an ODMR-Lab simulation, a measured FRET row, an Inspiration4 timepoint, a measured carbon-dot record, or a sourced spec. Bricks only ever get added.') + `
    <div class="box"><div class="tower">${cols}</div>
      <div class="tlegend"><span class="l-opm">OPM (795 nm)</span><span class="l-nv">NV diamond (695 nm, hatched)</span><span class="l-qd">quantum dot (no cited colour)</span><span class="l-cqd">carbon dot (439 nm)</span><span class="l-link">link between devices</span></div>
      <div class="btnrow"><button class="cta" id="tower-run">＋ Run at ${esc($('#location').selectedOptions[0].textContent)}</button></div></div>
    <div class="grid g2" style="margin-top:12px">
      <div class="box"><h3>Open questions</h3><ul class="plain">${(comb.open_questions || []).map((q) => `<li>${esc(q)}</li>`).join('')}</ul></div>
      <div class="box"><h3>Run history</h3><ul class="plain">${runs.slice().reverse().map((r) => `<li><b class="mono">${esc(r.run_id)}</b> · ${esc(r.location)} · ${esc(r.role)} · ${esc(age(r.started_at))} · ${r.adds_to_combined.length} bricks · ${esc((r.real_work?.kiel_record || '').replace('data/', ''))}${r.errors?.length ? ' · ' + esc(r.errors.join('; ')) : ''}</li>`).join('')}</ul></div>
    </div>`;
  $('#tower-run')?.addEventListener('click', doRun);
}
function sourcesTab() {
  const rec = ['opm_heart_kiel', 'opm_brain_mne', 'nv_odmr_zenodo10629041', 'qd_fret_figshare5468838', 'cqd_pl_mendeley_cmfbrvrb8y', 'eeg_brain_ds004902'];
  $('#view-sources').innerHTML = head('Sources and credits', 'Where every number comes from', 'Each value carries its source, tag and status (hover any value). Datasets, images and the 3D figure keep their licences.') + `
  <div class="grid g2">
    <div class="box wide"><h3>Recorded datasets</h3><div class="scroll"><table><tr><th>id</th><th>dataset</th><th>licence</th><th>label</th></tr>${rec.map((id) => `<tr><td class="k">${esc(id)}</td><td>${id.startsWith('opm_brain') ? 'MNE-Python OPM sample, OPM_SEF_raw.fif' : `<span data-ds="${id}">loading…</span>`}</td><td data-lic="${id}"></td><td data-lab="${id}"></td></tr>`).join('')}</table></div></div>
    <div class="box"><h3>NASA</h3><ul class="plain"><li>NASA OSDR OSD-575 Inspiration4 metabolic panel (total bilirubin), ${esc(D.nasa_i4?.meta?.licence || '')}</li>${(D.hrp?.hazards || []).map((h) => `<li><b>${esc(h.heading)}</b>: ${esc(h.text)} <span class="src">${esc(h.source)}</span></li>`).join('')}</ul></div>
    <div class="box"><h3>Images and 3D</h3><ul class="plain"><li>3D figure: "Cesium Man" © 2017 Cesium, CC BY 4.0 (KhronosGroup glTF-Sample-Assets); material replaced, so the Cesium logo in its texture (excluded from the licence) is not shown.</li>${(D.assets?.assets || []).map((a) => `<li>${esc(a.title)}: ${esc(a.attribution)} (${esc(a.licence)})</li>`).join('')}</ul></div>
    <div class="box wide"><h3>Footer</h3><p>${esc($('.footer-text').textContent)}</p><p class="note">Fonts: IBM Plex Sans and Mono (SIL Open Font License). 3D: three.js (MIT).</p></div>
  </div>`;
  for (const id of rec.filter((i) => i !== 'opm_brain_mne')) {
    const m = D[`recorded/${id}`]?.meta;
    (async () => {
      const meta = m || (await getJSON(`/data/recorded/${id}.json`).then((j) => j.meta).catch(() => null));
      if (!meta) return;
      $(`[data-ds="${id}"]`).innerHTML = `<a href="${esc(meta.doi_or_url)}" target="_blank" rel="noopener">${esc(meta.dataset)}</a>`;
      $(`[data-lic="${id}"]`).textContent = meta.licence; $(`[data-lab="${id}"]`).textContent = meta.label;
    })();
  }
  $('[data-lic="opm_brain_mne"]').textContent = 'no licence stated'; $('[data-lab="opm_brain_mne"]').textContent = 'Recorded on Earth with real QuSpin OPM sensors. Not an astronaut.';
}

// ------------------------------------------------------------------ views
const built = {};
function showView(v) {
  $$('.view').forEach((el) => el.classList.toggle('on', el.id === `view-${v}`));
  $$('.tb-nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  if (!built[v]) {
    built[v] = true;
    try { ({ opm: opmTab, nv: nvTab, qd: qdTab, cqd: cqdTab, tower: renderTower, sources: sourcesTab })[v]?.(); }
    catch (e) { $(`#view-${v}`).innerHTML = `<div class="box">Could not render this tab: ${esc(e.message)}</div>`; console.error(e); }
  }
  if (v === 'overview') setTimeout(() => S.twin?.resize(), 0);
}

// ------------------------------------------------------------------ live polling
async function poll() {
  try { S.health = await getJSON('/api/health'); $('#tb-status').classList.add('ok'); $('#tb-status span').textContent = 'Server online'; }
  catch { $('#tb-status').classList.remove('ok'); $('#tb-status span').textContent = 'Server offline · saved data'; }
  try { S.live = await getJSON('/api/live'); } catch { /* keep snapshot */ }
  try { S.sensors = await getJSON('/api/sensors/live'); } catch { /* none */ }
  try { S.combined = await getJSON('/api/combined'); S.runs = await getJSON('/api/runs'); } catch { /* data files */ }
  renderRight(); renderRunbar();
}

// ------------------------------------------------------------------ tour
const TOUR = [
  ['Your quantum body twin', 'Grey where there is no real data; coloured with the reading sensor\'s own light where a real recording exists (rubidium 795 nm and NV 695 nm both render spectral red; carbon dots 439 nm violet). Colour never means healthy or unhealthy. Click a part to inspect it; drag to turn.'],
  ['Six systems', 'The tiles along the bottom are the main card: heart Q wave, brain, lungs, blood, skin and tumour risk, each with its real value, tag and status. Hover any value for its source.'],
  ['Real runs build one sensor', 'Run does real work: the next real Kiel heart recording, one ODMR-Lab simulator call, and the next rows of real quantum-dot, carbon-dot and Inspiration4 data. Each new fact is a brick in the combined sensor.'],
  ['Four quantum sensors in depth', 'The OPM, NV diamond, quantum-dot and carbon-dot tabs pair the quantum physics (equations, interactive calculations, real lab spectra, online simulators, full hardware specs) with the biology each sensor reads.'],
  ['Honest by design', 'No public live feed exists from these sensors on a human in space. Live data here is the space environment; body signals are real Earth recordings and real Inspiration4 lab values. Not diagnostic.'],
];
let tourI = 0;
function showTour(i) {
  tourI = i; const [t, b] = TOUR[i];
  $('#tour').hidden = false; $('#tour-step').textContent = `TOUR · ${String(i + 1).padStart(2, '0')} / ${String(TOUR.length).padStart(2, '0')}`;
  $('#tour-title').textContent = t; $('#tour-body').textContent = b; $('#tour-prog').style.width = `${((i + 1) / TOUR.length) * 100}%`;
  $('#tour-next').textContent = i === TOUR.length - 1 ? 'Done' : 'Next →';
}
const endTour = () => { $('#tour').hidden = true; try { localStorage.setItem('spindrift-tour', '1'); } catch { /* private mode */ } };

// ------------------------------------------------------------------ boot
async function boot() {
  await loadAll();
  applyPalette();
  $('#ld-2').classList.add('on', 'ok');
  $('#location').addEventListener('change', (e) => { S.location = e.target.value; renderTiles(); renderSysPanel(); renderRight(); renderRunbar(); refreshTwin(); });
  $('#run').addEventListener('click', doRun);
  $$('.tb-nav button, .statusline [data-view]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  $$('.seg').forEach((b) => b.addEventListener('click', () => { $$('.seg').forEach((x) => x.classList.toggle('on', x === b)); S.twin?.setMode(b.dataset.mode); }));
  $('#tour-btn').addEventListener('click', () => showTour(0));
  $('#tour-next').addEventListener('click', () => (tourI < TOUR.length - 1 ? showTour(tourI + 1) : endTour()));
  $('#tour-skip').addEventListener('click', endTour); $('#tour-x').addEventListener('click', endTour);
  setInterval(() => { $('#tb-utc').textContent = new Date().toISOString().slice(11, 19) + ' UTC'; }, 1000);
  renderTiles(); renderSysPanel(); renderRight(); renderRunbar();
  try {
    S.twin = await createTwin({ canvas: $('#twin'), labelsEl: $('#labels'), leadersEl: $('#leaders'), systems: SYSTEMS,
      modelUrl: '/data/assets/models/CesiumMan.glb', onSelect: selectSystem,
      safeArea: () => {
        const c = $('#twin').getBoundingClientRect(), l = $('#sys-panel').getBoundingClientRect(), r = $('#right-panel').getBoundingClientRect();
        return { left: Math.max(0, l.right - c.left), right: Math.min(c.width, r.left - c.left) };
      },
      onProgress: (f) => { $('#ld-num').textContent = String(70 + Math.round(f * 30)).padStart(2, '0'); } });
    refreshTwin(); S.twin.select(S.system);
  } catch (e) { console.error(e); toast(`3D view unavailable: ${e.message}`); }
  $('#ld-num').textContent = '100'; $('#ld-3').classList.add('on', 'ok');
  setTimeout(() => $('#loader').classList.add('done'), 350);
  let seen = false; try { seen = !!localStorage.getItem('spindrift-tour'); } catch { /* private mode */ }
  if (!seen) setTimeout(() => showTour(0), 900);
  poll(); setInterval(poll, 10000);
}
boot();
