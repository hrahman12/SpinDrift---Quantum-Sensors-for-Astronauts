// Sensor-tab panels shown under each exact-spec 3D model: Lean-checked physics with live calculations, recorded data,
// the online simulators and every hardware spec. Calculations use cited equations with sourced inputs and are labelled.
import { $, $$, esc, D, S, fmtNum, vo, chips, chart, legend, specTable, simCards, wireSimForms, section, lean, readout, pill, postJSON, getJSON } from './core.js';
import { createScope, openStream, rPeaks } from './scope.js';

const instPill = (dev) => S.sensors?.sensors?.[dev]?.connected ? pill('instrument', 'connected', 'ok') : pill('instrument', 'not connected', 'off');
export const TAB_HEAD = {
  opm: { kick: 'Sensor 01 · brain and heart', title: 'QuSpin QZFM Gen-3 optically pumped magnetometer', sub: 'Rubidium vapour at zero field (SERF): a laser spin-polarises the atoms and a magnetic field tips them.', pills: () => instPill('opm') + pill('data', 'recorded replay', 'rec') },
  nv: { kick: 'Sensor 02 · heart', title: 'NV-diamond magnetometers: JGU, ZAQuant and Q.ANT builds', sub: 'Spin-1 defects in diamond read with green light and microwaves (Omar et al., arXiv 2601.18843).', pills: () => instPill('nv') + pill('simulator', 'ODMR-Lab', 'sim') },
  qd: { kick: 'Sensor 03 · blood', title: 'Quantum-dot renin nanosensor', sub: 'Quantum dot → peptide → Cy5 FRET probe; renin cuts the peptide; single molecules counted by TIRF microscopy (Long et al., Anal. Chem. 84, 8846, 2012).', pills: () => instPill('qd_renin') + pill('readout', 'lab TIRF microscope', 'off') },
  cqd: { kick: 'Sensor 04 · skin', title: 'Carbon-dot microneedle patch', sub: 'Carbon quantum dots left in the skin by microneedles; fluorescence tracks bilirubin under blue light; IoT reader (Tabatabaee et al., ACS Nano 18, 28012, 2024).', pills: () => instPill('cqd_patch') + pill('flight', 'has not flown', 'off') },
};

export async function tabBelow(v, el) {
  if (v === 'opm') return opm(el);
  if (v === 'nv') return nv(el);
  if (v === 'qd') return qd(el);
  return cqd(el);
}

// ------------------------------------------------------------------ shared charts
export function beatChart(d, build, w = 560, h = 230, N = null) {
  const ab = d.averaged_beat, t = ab.t_s, y = ab.pT, bands = [];
  if (build && d.per_build[build]) {
    const n = N ? d.per_build[build].single_beat_noise_pT.value / Math.sqrt(N) : d.per_build[build].averaged_noise_pT.value;
    bands.push({ x: t, lo: y.map((v) => v - n), hi: y.map((v) => v + n), color: S.col.nv, opacity: 0.22 });
  }
  const q = ab.q_wave_ms_before_r / 1000;
  return chart({ w, h, series: [{ x: t, y, color: S.col.opm, width: 1.6 }], bands, vlines: [{ x: 0, color: S.col.ink, dash: '2 3', label: 'R', opacity: .7 }, { x: -q, color: S.col.ink, dash: '2 3', label: 'Q', opacity: .7 }], xLabel: 'time from R-peak (s)', yLabel: 'pT' });
}
function bilirubinChart(w = 560, h = 230) {
  const ds = D.nasa_i4.datasets[0], tps = ds.variables[0].points.map((p) => p.timepoint);
  const greys = ['#e1e5d6', '#b9c0ab', '#8e9684', '#6f7865'];
  const series = ds.variables.map((v, i) => ({ x: v.points.map((_, j) => j), y: v.points.map((p) => p.value.value), color: greys[i], dash: ['', '5 3', '2 2', '8 3'][i] }));
  const pts = ds.variables.map((v, i) => ({ x: v.points.map((_, j) => j), y: v.points.map((p) => p.value.value), color: greys[i], r: 2.5, titles: v.points.map((p) => `${v.name} ${p.timepoint}: ${p.value.value ?? 'unspecified in source'} mg/dL`) }));
  return chart({ w, h, series, points: pts, catLabels: tps, xLabel: 'timepoint (days from launch L- / return R+)', yLabel: 'mg/dL' })
    + legend(ds.variables.map((v, i) => ({ name: v.name.replace('Total bilirubin, ', ''), color: greys[i], dash: i > 0 })))
    + '<p class="note">NASA OSDR OSD-575, Inspiration4 comprehensive metabolic panel (serum, drawn on the ground). The patch reads skin interstitial fluid and has not flown.</p>';
}

// ------------------------------------------------------------------ OPM
function blochTool(canvas, getW, onStep) {
  // dP/dtau = z - P + w x P (Sulai Eq. B1 in units of R/Gamma', tau = Gamma' t), integrated with RK4
  let az = -0.6, el = 0.35, P = [0, 0, 0], trail = [], drag = null;
  const ctx = canvas.getContext('2d');
  const f = (p, w) => [-p[0] + (w[1] * p[2] - w[2] * p[1]), -p[1] + (w[2] * p[0] - w[0] * p[2]), 1 - p[2] + (w[0] * p[1] - w[1] * p[0])];
  const add = (a, b, k) => a.map((x, i) => x + b[i] * k);
  canvas.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (!drag) return; az += (e.clientX - drag[0]) * 0.01; el = Math.max(-1.2, Math.min(1.2, el + (e.clientY - drag[1]) * 0.01)); drag = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', () => { drag = null; });
  function frame() {
    requestAnimationFrame(frame);
    if (canvas.offsetParent === null) return;
    const w = getW();
    for (let s = 0; s < 2; s++) {
      const h = 0.02, k1 = f(P, w), k2 = f(add(P, k1, h / 2), w), k3 = f(add(P, k2, h / 2), w), k4 = f(add(P, k3, h), w);
      P = P.map((x, i) => x + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    }
    trail.push([...P]); if (trail.length > 260) trail.shift();
    const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const R = Math.min(W, H) * 0.38, cx = W / 2, cy = H / 2 + 8;
    const pr = (x, y, z) => { const x1 = x * Math.cos(az) - y * Math.sin(az), y1 = x * Math.sin(az) + y * Math.cos(az); return [cx + R * x1, cy - R * (z * Math.cos(el) - y1 * Math.sin(el))]; };
    const path = (fn, col, dash) => { ctx.beginPath(); for (let i = 0; i <= 72; i++) { const t = (i / 72) * 2 * Math.PI; const [a, b] = pr(...fn(t)); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); } ctx.strokeStyle = col; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]); };
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.strokeStyle = '#4e5845'; ctx.stroke();
    path((t) => [Math.cos(t), Math.sin(t), 0], '#4e5845', [3, 3]); path((t) => [Math.cos(t), 0, Math.sin(t)], '#3a4234');
    // Lean-checked locus for a transverse field along y: the circle p_x^2 + (p_z - 1/2)^2 = 1/4
    path((t) => [0.5 * Math.sin(t), 0, 0.5 + 0.5 * Math.cos(t)], 'rgba(169,212,140,.45)', [2, 3]);
    ctx.font = '10px "IBM Plex Mono", monospace'; ctx.fillStyle = '#8e9684';
    for (const [v, l] of [[[1.15, 0, 0], 'x'], [[0, 1.15, 0], 'y'], [[0, 0, 1.15], 'z · pump']]) { const [a, b] = pr(...v), [c, d] = pr(...v.map((q) => -q)); ctx.strokeStyle = '#4e5845'; ctx.beginPath(); ctx.moveTo(c, d); ctx.lineTo(a, b); ctx.stroke(); ctx.fillText(l, a + 4, b); }
    ctx.beginPath(); trail.forEach((p, i) => { const [a, b] = pr(...p); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.stroke();
    const den = 1 + w[0] ** 2 + w[1] ** 2 + w[2] ** 2, Pss = [(w[1] + w[2] * w[0]) / den, (-w[0] + w[1] * w[2]) / den, (1 + w[2] ** 2) / den];
    const [sx, sy] = pr(...Pss); ctx.beginPath(); ctx.arc(sx, sy, 6, 0, 2 * Math.PI); ctx.strokeStyle = '#a9d48c'; ctx.stroke();
    const [ox, oy] = pr(0, 0, 0), [px, py] = pr(...P);
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(px, py); ctx.strokeStyle = S.col.opm; ctx.lineWidth = 3; ctx.stroke(); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(px, py, 4.5, 0, 2 * Math.PI); ctx.fillStyle = S.col.opm; ctx.fill();
    ctx.fillStyle = '#666e5d'; ctx.fillText('drag to turn · ring: Lean-checked steady state · dashed green: bloch_circle locus', 8, H - 6);
    onStep(P, Pss);
  }
  frame();
  return { pump() { P = [0, 0, 0]; trail = []; } };
}
async function opm(el) {
  const sp = D.specs.opm, ph = D.physics.opm_zero_field, live = S.live || D.live_snapshot || {};
  el.innerHTML = section('Physics · optical pumping and spin precession', `<div class="grid g2">
      <div><canvas id="opm-bloch" style="width:100%;height:330px;display:block;cursor:grab"></canvas></div>
      <div>${['ox', 'oy', 'oz'].map((k, i) => `<div class="ctrl"><div class="row"><span>Ω_${'xyz'[i]} / Γ′ (field in half widths)</span><output id="${k}-o"></output></div><input type="range" id="${k}" min="-4" max="4" step="0.05" value="${k === 'oy' ? 1 : 0}"></div>`).join('')}
        <div class="btnrow"><button class="ghost" id="opm-pump">Pump from zero polarisation</button></div>
        <div id="opm-ro" style="margin-top:8px"></div>
        <div>${lean('opm_steady_state')}${lean('bloch_circle')}${lean('opm_half_width')}</div>
        <div class="eq">dP/dτ = ẑ − P + w × P,  w = Ω/Γ′,  τ = Γ′t          (Sulai Eq. B1, units of R/Γ′)
P_ss = (ẑ + w × ẑ + (w·ẑ) w) / (1 + |w|²)                    (Eq. B2)</div></div></div>
      <div id="opm-res"></div>
      <p class="note">A circularly polarised laser on the rubidium D1 line pumps the atoms into a dark, transparent state; a transverse field tips the polarisation (precession at Ω = γB) while relaxation Γ′ pulls it back. The photodiode reads P_z; lock-in detection reads the dispersive P_x. Dimensionless: QuSpin does not state the QZFM's half width numerically beyond about 30 nT wide.</p>`, true, 'Sulai et al. · QuSpin · Lean')
    + section('Recorded replay · heart and brain, streamed at their own sample rates', `<div class="grid g2"><div><div class="kick"><span>Heart · Kiel MCG · ch0 Sensor 0 −Y</span><span id="opm-bpm"></span></div><canvas id="sc-heart" style="width:100%;height:150px;background:rgba(0,0,0,.18);border:1px solid var(--line)"></canvas></div>
      <div><div class="kick"><span>Brain · MNE OPM-MEG, right somatomotor</span><span id="opm-rms"></span></div><canvas id="sc-brain" style="width:100%;height:260px;background:rgba(0,0,0,.18);border:1px solid var(--line)"></canvas></div></div>
      <p class="note">Recorded on Earth with real QuSpin sensors, replayed by the server, looping. Not live and not an astronaut. Heart rate is calculated in the browser from the replay with the build's beat rule.</p>`, false, 'opens the streams')
    + section('Evoked brain field', '<div id="opm-evoked"><p class="note">Loading the recording…</p></div>', false, 'MNE OPM sample')
    + section('Readiness by location', `<table><tr><th>location</th><th>ambient field</th><th>reduction needed</th><th>inside ±5 nT</th></tr>${Object.entries(live.opm_readiness || {}).map(([k, x]) => `<tr><td class="k">${esc(k)}</td><td>${vo(x.ambient_nT)}</td><td>${x.shielding_factor ? vo(x.shielding_factor) : ''}</td><td class="mono">${x.within_range === null ? '—' : x.within_range ? 'yes' : 'no'}</td></tr>`).join('')}</table>`, false, 'live + published fields')
    + section('Hardware · every value sourced', specTable(sp), false, 'datasheet + published')
    + section('Space heritage · ESA Swarm absolute scalar magnetometer', specTable(D.specs.space_heritage?.swarm_asm), false, 'ESA')
    + section('Online simulators', simCards('opm'));
  const W = () => ['ox', 'oy', 'oz'].map((k) => +$(`#${k}`).value);
  const drawRes = () => {
    W().forEach((v, i) => { $(`#${['ox', 'oy', 'oz'][i]}-o`).textContent = v.toFixed(2); });
    $('#opm-res').innerHTML = chart({ w: 1100, h: 200, series: [{ x: ph.x, y: ph.y, color: S.col.opm }, { x: ph.x, y: ph.extra_series[0].y, color: S.col.opm, dash: '5 3' }], vlines: [{ x: W()[1], color: S.col.ink, dash: '3 3', label: 'Ω_y' }, { x: 1, color: '#a9d48c', dash: '2 3', label: 'half width (Lean)' }], xLabel: ph.x_label, yLabel: 'signal / max' })
      + legend([{ name: 'transmitted light ∝ P_z (Lorentzian)', color: S.col.opm }, { name: 'lock-in output ∝ P_x (dispersive)', color: S.col.opm, dash: true }]);
  };
  ['ox', 'oy', 'oz'].forEach((k) => $(`#${k}`).addEventListener('input', drawRes)); drawRes();
  let lastRO = 0;
  const tool = blochTool($('#opm-bloch'), W, (P, Pss) => {
    const now = performance.now(); if (now - lastRO < 120) return; lastRO = now;
    $('#opm-ro').innerHTML = `<div class="sup"><div><span>P_x (lock-in) live</span><span class="mono">${P[0].toFixed(3)}</span></div><div><span>P_z (transmitted) live</span><span class="mono">${P[2].toFixed(3)}</span></div><div><span>steady state P_ss (x, y, z)</span><span class="mono">${Pss.map((v) => v.toFixed(3)).join(', ')}</span></div><div><span>distance to steady state</span><span class="mono">${Math.hypot(P[0] - Pss[0], P[1] - Pss[1], P[2] - Pss[2]).toFixed(4)}</span></div></div>`;
  });
  $('#opm-pump').addEventListener('click', () => tool.pump());
  // streams open only while their section is open
  const sec = el.querySelectorAll('details.con-sec')[1];
  let heart = null, brain = null, esH = null, esB = null;
  sec.addEventListener('toggle', () => {
    if (sec.open) {
      heart ||= createScope($('#sc-heart'), { windowS: 6, fs: 200, names: ['ch0 Sensor 0 −Y'], unit: 'pT', color: S.col.opm, label: 'Kiel Cardio Database, recorded replay' });
      const names = D['recorded/opm_brain_names'] || ['MEG1111', 'MEG1121', 'MEG1131', 'MEG1141', 'MEG1211', 'MEG1221', 'MEG1231', 'MEG1241'];
      brain ||= createScope($('#sc-brain'), { windowS: 4, fs: 250, names, unit: 'fT', color: S.col.opm, label: 'MNE OPM sample, recorded replay' });
      heart.start(); brain.start();
      esH = openStream('opm_heart_kiel', (p) => {
        const s = p.series.find((x) => x.name.startsWith('ch0')) || p.series[0]; heart.push([s.values]);
        const v = heart.values(0); const pk = rPeaks(v, 200);
        if (pk.length >= 3) { const rr = pk.slice(1).map((x, i) => (x - pk[i]) / 200).sort((a, b) => a - b); $('#opm-bpm').textContent = `${(60 / rr[Math.floor(rr.length / 2)]).toFixed(1)} bpm · calculated`; }
      }, () => { $('#opm-bpm').textContent = 'stream unavailable'; });
      esB = openStream('opm_brain_mne', (p) => {
        brain.push(p.series.map((s) => s.values));
        let acc = 0, n = 0; p.series.forEach((s, k) => { const v = brain.values(k); let m = 0; for (const x of v) m += x * x; acc += Math.sqrt(m / (v.length || 1)); n++; });
        $('#opm-rms').textContent = `RMS ${(acc / n).toFixed(0)} fT · calculated`;
      }, () => { $('#opm-rms').textContent = 'stream unavailable'; });
    } else { esH?.close(); esB?.close(); heart?.stop(); brain?.stop(); }
  });
  wireSimForms(el);
  try {
    const meg = await getJSON('/data/recorded/opm_brain_mne.json'), ev = meg.evoked;
    $('#opm-evoked').innerHTML = chart({ w: 1100, h: 240, series: ev.series.map((s, i) => ({ x: ev.x.values, y: s.values, color: S.col.opm, width: 1, opacity: 0.35 + 0.08 * i })), vlines: [{ x: 0, color: S.col.ink, dash: '3 3', label: 'stimulus' }], xLabel: 'time from median-nerve stimulus (s)', yLabel: 'fT' })
      + `<p class="note">${esc(ev.n_epochs)} real epochs averaged, ${ev.series.length} of ${esc(meg.meta.n_opm_channels_in_file ?? '?')} OPM channels. ${esc(meg.meta.label)} Licence: ${esc(meg.meta.licence)}.</p>`;
  } catch (e) { $('#opm-evoked').innerHTML = `<p class="note">Could not load the recording: ${esc(e.message)}</p>`; }
}

// ------------------------------------------------------------------ NV
function nvLines(B, thDeg) {
  const ph = D.physics.nv_odmr_lines, d = ph.inputs[0].value, g = ph.inputs[1].value, th = thDeg * Math.PI / 180, u = g * B / d;
  const c = Math.cos(th), s2 = Math.sin(th) ** 2, s3 = Math.sin(th) ** 3, tn = Math.tan(th);
  return { d, g, up: d * (1 + u * c + 1.5 * u * u * s2 + u ** 3 * (s3 * tn / 8 - 0.5 * s2 * c)), dn: d * (1 - u * c + 1.5 * u * u * s2 - u ** 3 * (s3 * tn / 8 - 0.5 * s2 * c)) };
}
function levelsSVG({ d, up, dn }) {
  const span = Math.max(40, (up - dn) / 2 + 15), lo = d - span, hi = d + span, Y = (f) => 128 - ((f - lo) / (hi - lo)) * 104;
  const lvl = (y, col, w2, lab, val, dash) => `<line x1="150" x2="330" y1="${y}" y2="${y}" stroke="${col}" stroke-width="${w2}" ${dash ? 'stroke-dasharray="4 3"' : ''}/><text x="338" y="${y + 4}">${lab}</text><text x="470" y="${y + 4}" style="font-family:var(--mono);fill:#e1e5d6">${val}</text>`;
  return `<svg class="chart" viewBox="0 0 560 205"><text x="8" y="14">³A₂ ground-state spin levels (frequency units; axis broken above m_s = 0)</text>
    ${lvl(Y(d), '#8e9684', 1, 'D (zero field)', `${d} MHz`, true)}${lvl(Y(up), S.col.nv, 2.5, 'm_s = +1', `${up.toFixed(1)} MHz`)}${lvl(Y(dn), S.col.nv, 2.5, 'm_s = −1', `${dn.toFixed(1)} MHz`)}
    <path d="M140,150 l10,-5 l10,5 l10,-5" stroke="#5c6552" fill="none"/><path d="M140,158 l10,-5 l10,5 l10,-5" stroke="#5c6552" fill="none"/>${lvl(190, '#e1e5d6', 2.5, 'm_s = 0', '0 MHz')}
    <line x1="200" x2="200" y1="190" y2="${Y(dn) + 3}" stroke="${S.col.nv}"/><text x="184" y="175" text-anchor="end">ν−</text><line x1="280" x2="280" y1="190" y2="${Y(up) + 3}" stroke="${S.col.nv}"/><text x="296" y="175">ν+</text>
    <text x="8" y="${Y(d) + 4}">${(up - dn).toFixed(1)} MHz apart</text></svg>`;
}
function sweepTool(canvas, getLines) {
  // replays the measured zero-field spectrum (Zenodo 10629041, mean of three positions) as a sweep; the calculated ν± move
  const zen = D['recorded/nv_odmr_zenodo10629041'], x = zen.x.values;
  const s = zen.series.find((q) => /mean/i.test(q.name)) || zen.series[zen.series.length - 1];
  const med = [...s.values].sort((a, b) => a - b)[Math.floor(s.values.length / 2)], y = s.values.map((v) => v / med);
  const y0 = Math.min(...y), y1 = Math.max(...y), ctx = canvas.getContext('2d'), t0 = performance.now();
  (function frame() {
    requestAnimationFrame(frame);
    if (canvas.offsetParent === null) return;
    const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const m = { l: 46, r: 10, t: 12, b: 26 }, X = (f) => m.l + ((f - x[0]) / (x[x.length - 1] - x[0])) * (W - m.l - m.r), Y = (v) => H - m.b - ((v - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);
    ctx.font = '10px "IBM Plex Mono", monospace'; ctx.fillStyle = '#8e9684'; ctx.strokeStyle = '#3a4234';
    for (let f = Math.ceil(x[0] / 20) * 20; f <= x[x.length - 1]; f += 20) { ctx.beginPath(); ctx.moveTo(X(f), m.t); ctx.lineTo(X(f), H - m.b); ctx.stroke(); ctx.fillText(`${f}`, X(f) - 12, H - 8); }
    const k = Math.floor(((performance.now() - t0) / 3500 % 1) * x.length);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(225,229,214,.25)'; ctx.beginPath(); for (let i = k; i < x.length; i++) { i === k ? ctx.moveTo(X(x[i]), Y(y[i])) : ctx.lineTo(X(x[i]), Y(y[i])); } ctx.stroke();
    ctx.strokeStyle = '#e1e5d6'; ctx.beginPath(); for (let i = 0; i <= k; i++) { i ? ctx.lineTo(X(x[i]), Y(y[i])) : ctx.moveTo(X(x[i]), Y(y[i])); } ctx.stroke();
    ctx.strokeStyle = '#a9d48c'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(x[k]), m.t); ctx.lineTo(X(x[k]), H - m.b); ctx.stroke();
    const L = getLines();
    for (const [f, lab] of [[L.dn, 'ν−'], [L.up, 'ν+']]) {
      for (const df of [-2.16, 0, 2.16]) { const fx = f + df; if (fx < x[0] || fx > x[x.length - 1]) continue; ctx.strokeStyle = S.col.nv; ctx.globalAlpha = df ? 0.5 : 1; ctx.setLineDash(df ? [2, 2] : []); ctx.beginPath(); ctx.moveTo(X(fx), m.t); ctx.lineTo(X(fx), H - m.b); ctx.stroke(); }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      if (f >= x[0] && f <= x[x.length - 1]) { ctx.fillStyle = S.col.nv; ctx.fillText(lab, X(f) + 3, m.t + 10); } else { ctx.fillStyle = S.col.nv; ctx.fillText(`${lab} ${f.toFixed(1)} MHz (outside window)`, f < x[0] ? m.l + 4 : W - 210, m.t + 22); }
    }
    ctx.fillStyle = '#666e5d'; ctx.fillText('microwave frequency (MHz) · measured counts / median (recorded) · ν± at the set field (calculated)', m.l, H - m.b + 2 - 14);
  })();
}
function odmrBars(res) {
  const t = res?.table; if (!t?.data) return '<p class="note">No ODMR-Lab result yet.</p>';
  const head = t.headers, rows = t.data, num = (s) => { const m = String(s).match(/-?[\d.]+/g); return m ? { v: +m[0], e: m[1] ? +m[1] : 0 } : null; };
  const axes = head.map((h, i) => [h, i]).filter(([h]) => /B_par/.test(h));
  const tru = rows.find((r) => /true/i.test(r[0])), cnn = rows.find((r) => /CNN/i.test(r[0]));
  const vals = axes.flatMap(([, i]) => [num(tru?.[i]), num(cnn?.[i])]).filter(Boolean), mx = Math.max(...vals.map((q) => q.v + q.e)) * 1.15 || 1;
  const W = 520, H = 190, bw = 26, gap = 120 / 1, X0 = 50;
  let s = `<svg class="chart bars" viewBox="0 0 ${W} ${H}"><line x1="${X0}" x2="${W - 10}" y1="160" y2="160" stroke="#4e5845"/>`;
  axes.forEach(([h, i], k) => {
    const x = X0 + 20 + k * gap, tv = num(tru?.[i]), cv = num(cnn?.[i]); const Y = (v) => 160 - (v / mx) * 140;
    if (tv) s += `<rect x="${x}" y="${Y(tv.v)}" width="${bw}" height="${160 - Y(tv.v)}" fill="#8e9684"><title>true ${tv.v} mT</title></rect>`;
    if (cv) s += `<rect x="${x + bw + 4}" y="${Y(cv.v)}" width="${bw}" height="${160 - Y(cv.v)}" fill="${S.col.nv}"><title>CNN ${cv.v} ± ${cv.e} mT</title></rect><line x1="${x + bw * 1.5 + 4}" x2="${x + bw * 1.5 + 4}" y1="${Y(cv.v - cv.e)}" y2="${Y(cv.v + cv.e)}" stroke="#e1e5d6"/>`;
    s += `<text x="${x + bw}" y="176" text-anchor="middle">NV axis ${k + 1}</text>`;
  });
  s += `<text x="8" y="14">|B| projected on the four NV axes (mT) · grey: field used · red: CNN estimate ± spread</text></svg>`;
  const extra = head.map((h, i) => [h, i]).filter(([h]) => !/B_par|estimator/.test(h));
  return s + `<table><tr><th>estimator</th>${extra.map(([h]) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr><td class="k">${esc(r[0])}</td>${extra.map(([, i]) => `<td class="mono">${esc(r[i])}</td>`).join('')}</tr>`).join('')}</table>
    <p class="note">${esc(String(res.note || '').replace(/\*\*/g, ''))} Simulated by ODMR-Lab (MIT); not a measurement.</p>`;
}
function ramseyChart() {
  const q = D.quantum_circuits; if (!q) return '<p class="note">quantum_circuits.json not loaded.</p>';
  const xs = Array.from({ length: 121 }, (_, i) => (i / 120) * 2 * Math.PI);
  return `<div class="grid g2"><div>${chart({ w: 560, h: 240, series: [{ x: xs, y: xs.map((p) => Math.cos(p / 2) ** 2), color: '#a9d48c', dash: '4 3' }], points: [{ x: q.points.map((p) => p.phi_rad), y: q.points.map((p) => p.p0), err: q.points.map((p) => 2 * p.binomial_se), color: S.col.nv, r: 4, titles: q.points.map((p) => `φ = ${p.phi_rad.toFixed(3)} rad: ${p.counts['0']}/${p.shots} → P(0) = ${p.p0.toFixed(4)} (theory ${p.p0_theory.toFixed(4)})`) }], xLabel: 'phase φ (rad)', yLabel: 'P(0)', yDomain: [-0.05, 1.05] })}
    ${legend([{ name: 'cos²(φ/2) (theory)', color: '#a9d48c', dash: true }, { name: `measured on ${q.tool} · 4096 shots · ±2 SE`, color: S.col.nv }])}</div>
    <div><svg class="chart" viewBox="0 0 520 120"><line x1="40" x2="500" y1="60" y2="60" stroke="#8e9684"/><text x="8" y="64">|0⟩</text>
      ${[['H', 110], ['RZ(φ)', 220], ['H', 330]].map(([g, x]) => `<rect x="${x - 30}" y="40" width="60" height="40" fill="#1b2130" stroke="#a9d48c"/><text x="${x}" y="65" text-anchor="middle" style="fill:#e1e5d6;font-size:13px">${g}</text>`).join('')}
      <rect x="410" y="40" width="60" height="40" fill="#1b2130" stroke="#e1e5d6"/><path d="M420,72 q20,-24 40,0" stroke="#e1e5d6" fill="none"/><line x1="440" y1="72" x2="455" y2="48" stroke="#e1e5d6"/><text x="440" y="100" text-anchor="middle">measure</text></svg>
      <p class="note">${esc(q.mapping)}</p><p class="note">${esc(q.theory)}. Seeds ${q.points[0].seed_simulator}–${q.points[q.points.length - 1].seed_simulator}; circuit depth ${q.circuit_depth}.</p></div></div>`;
}
async function nv(el) {
  const sp = D.specs.nv, mc = D.math_checks?.eq7_vs_exact;
  const sims = (D.simulators?.nv || []).find((e) => e.tool === 'ODMR-Lab');
  const last = sims?.results?.slice().reverse().find((r) => r.outputs?.table)?.outputs;
  el.innerHTML = section('Physics · NV spin levels and ODMR', `<div class="grid g2"><div>
      <div class="ctrl"><div class="row"><span>|B|</span><output id="nv-b-o"></output></div><input type="range" id="nv-b" min="0" max="2" step="0.01" value="1"></div>
      <div class="ctrl"><div class="row"><span>angle θ to the NV axis</span><output id="nv-th-o"></output></div><input type="range" id="nv-th" min="0" max="80" step="1" value="0"></div>
      <div id="nv-levels"></div></div>
      <div><div id="nv-ro"></div><div>${lean('nv_splitting')}${lean('nv_centre')}${lean('nv_zero_field')}</div>
      <div class="eq">B along the NV axis:  ν± = D ± γB   (Barry Eq. 6)  →  ν₊ − ν₋ = 2γB,  ν₊ + ν₋ = 2D
B at angle θ:  Barry Eq. 7, series in u = γB/D</div>
      ${mc ? `<p class="note">Wolfram cross-check at 1 mT, 30°: exact diagonalisation ${mc.exact_diagonalisation_MHz.map((v) => v.toFixed(5)).join(', ')} MHz; Eq. 7 ${mc.barry_eq7_MHz.map((v) => v.toFixed(5)).join(', ')} MHz; difference ${(mc.difference_MHz[0] * 1e6).toFixed(1)} Hz.</p>` : ''}</div></div>
      <canvas id="nv-sweep" style="width:100%;height:220px;display:block;margin-top:8px;background:rgba(0,0,0,.18);border:1px solid var(--line)"></canvas>
      <p class="note">Measured zero-field ODMR of NV⁻ ensembles (Alam et al., Phys. Rev. Applied 22, 024055, 2024; Zenodo 10629041, CC BY 4.0), replayed as a sweep. The red lines are where the two resonances sit at the set field (calculated), with ¹⁴N hyperfine ticks 2.16 MHz apart.</p>`, true, 'Barry et al. · Lean · Wolfram')
    + section('ODMR-Lab simulator · run it at this field', `<div class="btnrow" style="margin-top:0"><button class="cta" id="nv-sim">Run ODMR-Lab at <span id="nv-sim-b"></span></button></div><div id="nv-sim-out" style="margin-top:10px">${last ? `<div class="kick"><span>Last saved result</span></div>${odmrBars(last)}` : ''}</div>`, false, 'real online simulator · simulated')
    + section('Heartbeat averaging · how many beats each build needs', `<div class="grid g2"><div class="ctrl"><div class="row"><span>build</span></div><select id="nv-build" class="bare"><option value="jgu">JGU</option><option value="zaquant">ZAQuant</option><option value="qant" selected>Q.ANT</option></select></div>
      <div class="ctrl"><div class="row"><span>beats averaged N</span><output id="nv-n-o"></output></div><input type="range" id="nv-n" min="0" max="3.3" step="0.01" value="1.672"></div></div>
      <div id="nv-beat"></div><div id="nv-snr"></div><div>${lean('snr_averaging')}</div>`, false, 'real Kiel beat + calculated noise')
    + section('Ramsey interferometry on a quantum-circuit simulator', ramseyChart(), false, 'coda · Qiskit Aer · simulated')
    + section('Hardware · every value sourced', `<div class="grid g2"><div>${specTable(sp.headline, 'headline')}</div><div>${specTable(sp.jgu, 'JGU (Mainz) build')}</div><div>${specTable(sp.zaquant, 'ZAQuant (Stuttgart) build')}</div><div>${specTable(sp.qant, 'Q.ANT build')}</div><div>${specTable(D.specs.space_heritage?.oscar_qube, 'OSCAR-QUBE: NV magnetometer on the ISS')}</div></div>`, false, 'arXiv 2601.18843')
    + section('Online simulators', simCards('nv'));
  const get = () => nvLines(+$('#nv-b').value, +$('#nv-th').value);
  const draw = () => {
    const B = +$('#nv-b').value, th = +$('#nv-th').value, L = get();
    $('#nv-b-o').textContent = `${B.toFixed(2)} mT`; $('#nv-th-o').textContent = `${th}°`; $('#nv-sim-b').textContent = `${B.toFixed(2)} mT, ${th}°`;
    $('#nv-levels').innerHTML = levelsSVG(L);
    $('#nv-ro').innerHTML = readout('ν₋ (m_s 0 → −1)', L.dn.toFixed(2), 'MHz', `Barry Eq. ${th ? 7 : 6} · calculated`) + readout('ν₊ (m_s 0 → +1)', L.up.toFixed(2), 'MHz') + readout('splitting ν₊ − ν₋', (L.up - L.dn).toFixed(3), 'MHz', `field along the axis read back: ${((L.up - L.dn) / (2 * L.g)).toFixed(4)} mT`);
  };
  $('#nv-b').addEventListener('input', draw); $('#nv-th').addEventListener('input', draw); draw();
  sweepTool($('#nv-sweep'), get);
  const drawBeat = () => {
    const b = $('#nv-build').value, N = Math.max(1, Math.round(10 ** +$('#nv-n').value)), pb = D.nv_heart_derived.per_build[b], ab = D.nv_heart_derived.averaged_beat;
    $('#nv-n-o').textContent = N;
    const single = pb.single_beat_noise_pT.value, noise = single / Math.sqrt(N);
    $('#nv-beat').innerHTML = beatChart(D.nv_heart_derived, b, 1100, 240, N);
    $('#nv-snr').innerHTML = `<div class="grid g3">${readout('noise after averaging', fmtNum(noise), 'pT', `η √BW / √N · ${esc(b.toUpperCase())} η = ${fmtNum(pb.noise_density.value)} ${esc(pb.noise_density.unit)}`)}${readout('SNR, R-peak', fmtNum(Math.abs(ab.r_peak_pT.value) / noise), '', 'calculated, real averaged beat')}${readout('SNR, Q wave', fmtNum(Math.abs(ab.q_wave_pT.value) / noise), '', 'calculated')}</div>`;
  };
  $('#nv-build').addEventListener('change', drawBeat); $('#nv-n').addEventListener('input', drawBeat); drawBeat();
  $('#nv-sim').addEventListener('click', async () => {
    const B = +$('#nv-b').value, th = +$('#nv-th').value * Math.PI / 180, btn = $('#nv-sim');
    btn.disabled = true; $('#nv-sim-out').innerHTML = '<p class="note">Calling the ODMR-Lab Space (a few seconds; longer if it is waking up)…</p>';
    try { const j = await postJSON('/api/simulate/odmr', { bx: +(B * Math.sin(th)).toFixed(4), by: 0, bz: +(B * Math.cos(th)).toFixed(4) }); $('#nv-sim-out').innerHTML = odmrBars(j); }
    catch (e) { $('#nv-sim-out').innerHTML = `<p class="note">ODMR-Lab call failed: ${esc(e.message)}</p>`; }
    btn.disabled = false;
  });
  wireSimForms(el);
}

// ------------------------------------------------------------------ quantum dot
async function qd(el) {
  const ph = D.physics.qd_fret_vs_distance, sp = D.specs.qd_renin, fig1 = D['recorded/qd_fret_figshare5468838'], qb = D.qbio_facts;
  const eff = fig1.series.find((s) => s.name === 'FRET efficiency'), rr = eff.values.map((e) => Math.pow(1 / (e / 100) - 1, 1 / 6));
  let cut = 0;
  el.innerHTML = section('FRET probe · cut a peptide, watch the transfer fall', `<div class="grid g2"><div id="qd-probe"></div>
      <div><div class="ctrl"><div class="row"><span>acceptors per dot n_A</span><output id="qd-n-o"></output></div><input type="range" id="qd-n" min="1" max="10" step="1" value="6"></div>
      <div class="ctrl"><div class="row"><span>dot–Cy5 distance r / R₀</span><output id="qd-r-o"></output></div><input type="range" id="qd-r" min="0.3" max="2" step="0.01" value="1"></div>
      <div class="btnrow"><button class="cta" id="qd-cut">Renin cuts one peptide</button><button class="ghost" id="qd-reset">Reset</button></div>
      <div id="qd-ro"></div><div>${lean('fret_half')}${lean('fret_one_acceptor')}${lean('fret_inverse')}</div>
      <div class="eq">E = n R₀⁶ / (n R₀⁶ + r⁶)     (FRET-Calc Eq. 3; n = 1 gives Eq. 2)</div>
      <p class="note">The paper does not state the acceptor count per dot or the distance, so both are explorer inputs. Each cut removes one Cy5.</p></div></div>
      <div id="qd-fret"></div>`, true, 'FRET-Calc · Lean')
    + section('Confinement · particle in a box', `<div class="ctrl"><div class="row"><span>box size L / L₀</span><output id="qd-l-o"></output></div><input type="range" id="qd-l" min="0.5" max="2" step="0.01" value="1"></div><div id="qd-ladder"></div>
      <p class="note">E_n = n²h²/(8m*L²). Energies in units of E₁ at L₀ (dimensionless): the renin paper does not state the dot's material, effective mass or size, so no eV scale or colour is drawn.</p>`, false, 'textbook model')
    + section('Measured FRET · CdTe/CdS dots to rhodamine 101', `<table><tr><th>pressure</th><th>E measured</th><th>r/R₀ implied (Eq. 2, calculated)</th></tr>${fig1.x.values.map((p, i) => `<tr><td class="mono">${fmtNum(p)} GPa</td><td class="mono">${eff.values[i]} %</td><td class="mono">${rr[i].toFixed(3)}</td></tr>`).join('')}</table><p class="note">${esc(fig1.meta.label)} Li et al., Optics Express 29, 27171 (2021).</p>`, false, 'figshare c.5468838 · recorded')
    + section('Target · human renin', `<div class="sup"><div><span>ChEMBL target</span><span class="mono">${esc(qb?.renin_target?.chembl_id || '')} · ${esc(qb?.renin_target?.type || '')}</span></div><div><span>UniProt</span><span class="mono">${esc(qb?.renin_target?.uniprot || '')}</span></div><div><span>gene</span><span class="mono">REN · ${esc(qb?.renin_gene?.ensembl || '')}</span></div>
      ${(qb?.renin_target?.go_function || []).concat(qb?.renin_target?.go_process || []).map((g) => `<div><span>GO</span><span>${esc(g)}</span></div>`).join('')}<div><span>pathway</span><span>${esc(qb?.renin_target?.reactome || '')}</span></div></div>
      <p class="note">Zoom into the blood on the Body page to see renin's crystal structure (PDB 2REN) and the REN gene. Renin is not measured in any open Inspiration4 file.</p>`, false, 'ChEMBL · Open Targets · UniProt')
    + section('Hardware and chemistry · every value sourced', specTable(sp), false, 'Long et al. 2012')
    + section('Online simulators', simCards('qd_renin'));
  const draw = () => {
    const nA = +$('#qd-n').value, r = +$('#qd-r').value, n = Math.max(0, nA - cut);
    $('#qd-n-o').textContent = nA; $('#qd-r-o').textContent = r.toFixed(2);
    const E = n ? n / (n + r ** 6) : 0, cx = 230, cy = 150, R0px = 70, rpx = r * R0px;
    let arms = '';
    for (let i = 0; i < nA; i++) {
      const a = (i / nA) * 2 * Math.PI - Math.PI / 2, x = cx + Math.cos(a) * (28 + rpx), y = cy + Math.sin(a) * (28 + rpx), gone = i < cut;
      arms += `<line x1="${cx + Math.cos(a) * 28}" y1="${cy + Math.sin(a) * 28}" x2="${x}" y2="${y}" stroke="${gone ? '#4e5845' : '#c4cab7'}" stroke-dasharray="${gone ? '3 3' : ''}"/>`;
      arms += gone ? `<text x="${x}" y="${y + 4}" text-anchor="middle" style="fill:#666e5d;font-size:12px">✕</text>` : `<circle cx="${x}" cy="${y}" r="7" fill="#9b2335" stroke="#e1e5d6"><title>Cy5</title></circle>`;
    }
    $('#qd-probe').innerHTML = `<svg class="chart" viewBox="0 0 460 300"><circle cx="${cx}" cy="${cy}" r="${28 + R0px}" fill="none" stroke="#a9d48c" stroke-dasharray="3 4" opacity=".6"/><text x="${cx + 28 + R0px + 4}" y="${cy - 4}" style="fill:#a9d48c">R₀</text>${arms}
      <circle cx="${cx}" cy="${cy}" r="28" fill="${S.col.qd}" stroke="#e1e5d6"/><text x="${cx}" y="${cy + 4}" text-anchor="middle" style="fill:#1f231b;font-size:11px">QD</text>
      <text x="8" y="16">streptavidin-coated dot · biotinylated Cy5 peptides (schematic layout, distances to scale in R₀)</text><text x="8" y="290">${n} of ${nA} Cy5 attached · ${cut} cut by renin</text></svg>`;
    $('#qd-ro').innerHTML = readout('FRET efficiency E', E.toFixed(3), '', 'calculated, Eq. 3') + readout('Cy5 left on the dot', String(n), `of ${nA}`, 'the TIRF count falls as renin cuts');
    const xs = ph.x;
    $('#qd-fret').innerHTML = chart({ w: 1100, h: 220, series: [{ x: xs, y: ph.y, color: S.col.qd }, ...(n > 1 ? [{ x: xs, y: xs.map((x) => n / (n + x ** 6)), color: '#e1e5d6', dash: '5 3' }] : [])], points: [{ x: rr, y: eff.values.map((v) => v / 100), color: '#e1e5d6', r: 3, titles: fig1.x.values.map((p, i) => `${fmtNum(p)} GPa: E ${eff.values[i]}%`) }], vlines: [{ x: r, color: '#a9d48c', dash: '3 3', label: `E = ${E.toFixed(3)}` }], hlines: [{ y: 0.5, color: '#8e9684', dash: '2 4', label: 'E = 1/2 at r = R₀ (Lean fret_half)' }], xLabel: 'r / R₀', yLabel: 'FRET efficiency E', yDomain: [0, 1.05] })
      + legend([{ name: 'E, one acceptor (physics.json)', color: S.col.qd }, ...(n > 1 ? [{ name: `E, ${n} acceptors (Eq. 3)`, color: '#e1e5d6', dash: true }] : []), { name: 'measured CdTe/CdS points (recorded → calculated r/R₀)', color: '#e1e5d6' }]);
  };
  $('#qd-n').addEventListener('input', () => { cut = Math.min(cut, +$('#qd-n').value); draw(); }); $('#qd-r').addEventListener('input', draw);
  $('#qd-cut').addEventListener('click', () => { cut = Math.min(+$('#qd-n').value, cut + 1); draw(); });
  $('#qd-reset').addEventListener('click', () => { cut = 0; draw(); }); draw();
  const ladder = () => {
    const L = +$('#qd-l').value; $('#qd-l-o').textContent = `${L.toFixed(2)} L₀`;
    const lv = [1, 2, 3, 4].map((k) => (k * k) / (L * L)), top = 10, bot = 165, mx = 64, Yl = (e) => bot - (Math.log10(e + 1) / Math.log10(mx + 1)) * (bot - top), ww = 40 + 120 * L / 2;
    $('#qd-ladder').innerHTML = `<svg class="chart" viewBox="0 0 560 180"><rect x="${280 - ww / 2}" y="${top}" width="${ww}" height="${bot - top}" fill="none" stroke="#5c6552"/>${lv.map((e, i) => `<line x1="${280 - ww / 2}" x2="${280 + ww / 2}" y1="${Yl(e)}" y2="${Yl(e)}" stroke="${S.col.qd}" stroke-width="2"/><text x="${280 + ww / 2 + 8}" y="${Yl(e) + 4}">n=${i + 1}: ${e.toFixed(2)} E₁(L₀)</text>`).join('')}<text x="10" y="${bot}">width ∝ L · log scale</text></svg>`;
  };
  $('#qd-l').addEventListener('input', ladder); ladder();
  wireSimForms(el);
}

// ------------------------------------------------------------------ carbon dots
async function cqd(el) {
  const sp = D.specs.cqd_patch, men = D['recorded/cqd_pl_mendeley_cmfbrvrb8y'], q = D.physics.cqd_quenching;
  const cols = (D.palette?.colours || []).filter((c) => ['cqd_patch', 'opm', 'nv', 'space_heritage'].includes(c.device));
  const ex = men.x.values, em = men.series[0].values, uniq = [...new Set(ex)].sort((a, b) => a - b);
  el.innerHTML = section('Measured emission · pick an excitation wavelength', `<div class="ctrl"><div class="row"><span>excitation (nearest measured record)</span><output id="cqd-ex-o"></output></div><input type="range" id="cqd-ex" min="0" max="${uniq.length - 1}" step="1" value="${uniq.indexOf(Math.max(...uniq.filter((u) => u <= 365))) || 0}"></div>
      <div class="grid g2"><div id="cqd-scatter"></div><div id="cqd-ro"></div></div>`, true, 'Mendeley cmfbrvrb8y · recorded')
    + section('Inspiration4 total bilirubin · real astronaut reference', bilirubinChart(1100, 240), false, 'NASA OSDR OSD-575')
    + section('Colour is physics · CIE 1931 colours of the cited wavelengths', `<table><tr><th>line</th><th>wavelength</th><th>colour</th></tr>${cols.map((c) => `<tr><td>${esc(c.label)}</td><td>${vo(c.wavelength)}</td><td>${c.colour.value ? `<span class="swatch" style="background:${esc(c.colour.value)}"></span><span class="mono">${esc(c.colour.value)}</span>` : `<span class="na">${esc(c.colour.note || 'none')}</span>`}</td></tr>`).join('')}</table>`, false, 'colour-science 0.4.7')
    + section('Physics · quantum-confined fluorescence', `<p>Carbon dots are few-nanometre carbon nanoparticles whose photoluminescence comes from quantum-confined and surface states. A photon lifts an electron across the confined gap; it relaxes and re-emits at a longer wavelength (Stokes shift). Quenchers close the radiative path; removing them restores the glow, which is the patch's sensing step.</p><div class="eq">${esc(sp.physics_label?.value || '')}</div><p class="note">${esc((q.missing_inputs || []).join('; '))}: the quenching and recovery curve is not drawn because its model and constants are not public.</p>`, false, 'physics label')
    + section('Hardware · every value sourced', specTable(sp), false, 'Tabatabaee et al. 2024')
    + section('Online simulators', simCards('cqd_patch'));
  const draw = () => {
    const sel = uniq[+$('#cqd-ex').value], hits = ex.map((x, i) => [x, em[i]]).filter(([x]) => x === sel);
    $('#cqd-ex-o').textContent = `${sel} nm`;
    $('#cqd-scatter').innerHTML = chart({ w: 560, h: 240, points: [{ x: ex, y: em, color: S.col.cqd, stroke: '#e1e5d6', r: 3.5, titles: ex.map((x, i) => `excited ${x} nm → emits ${em[i]} nm`) }, { x: hits.map((h) => h[0]), y: hits.map((h) => h[1]), color: '#a9d48c', r: 7 }], vlines: [{ x: sel, color: '#a9d48c', dash: '3 3' }], xLabel: 'excitation wavelength (nm)', yLabel: 'emission maximum (nm)' });
    const ems = hits.map((h) => h[1]);
    $('#cqd-ro').innerHTML = readout('records at this excitation', String(hits.length), '', 'recorded') + readout('emission maximum', ems.length ? ems.map((v) => fmtNum(v)).join(' · ') : '—', 'nm', 'measured, per record') + `<p class="note">${esc(men.meta.label)} Point colour is the CIE colour of 439 nm, the most common measured emission.</p>`;
  };
  $('#cqd-ex').addEventListener('input', draw); draw();
  wireSimForms(el);
}
