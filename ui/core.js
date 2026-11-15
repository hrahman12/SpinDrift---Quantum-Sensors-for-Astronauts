// Shared helpers for the SpinDrift UI. Every number shown comes from /data or the server; the only numbers made here
// are calculations from cited equations with sourced inputs, and they are labelled "calculated".

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const D = {};   // data files, keyed by path under /data without .json
export const S = { location: 'iss', system: 'heart', live: null, sensors: null, runs: null, combined: null, health: null, twin: null, col: {} };

// ------------------------------------------------------------------ value objects
export const NA = { NOT_STATED: 'unspecified in source', NOT_YET_EXTRACTED: 'not yet extracted' };
export function fmtNum(v) {
  if (typeof v !== 'number') return String(v);
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 10000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (a >= 100) return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (a >= 1) return String(+v.toPrecision(4));
  return String(+v.toPrecision(3));
}
export function voVal(vo) {
  if (!vo) return '<span class="na">no data</span>';
  if (vo.value === null || vo.value === undefined) return `<span class="na">${esc(NA[vo.status] || 'no value')}</span>`;
  return `<span class="v">${esc(fmtNum(vo.value))}</span>${vo.unit ? ` <small>${esc(vo.unit)}</small>` : ''}`;
}
export function chips(vo) {
  if (!vo) return '';
  const c = [`<span class="chip">${esc(vo.tag)}</span>`];
  if (vo.status !== 'VERIFIED') c.push(`<span class="chip ${esc(vo.status)}">${vo.status === 'TO_CONFIRM' ? 'to confirm' : esc(vo.status.toLowerCase())}</span>`);
  return c.join('');
}
export function tip(vo) {
  if (!vo) return '';
  return esc([vo.source && `Source: ${vo.source}`, vo.as_of && `As of: ${vo.as_of}`, vo.note && `Note: ${vo.note}`, `Tag: ${vo.tag} · status: ${vo.status}`].filter(Boolean).join('\n'));
}
export const vo = (v) => `<span class="vo" title="${tip(v)}">${voVal(v)} ${chips(v)}</span>`;
export function age(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!isFinite(s)) return '';
  if (s < 90) return `${Math.max(0, Math.round(s))} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
export function toast(msg, ms = 4000) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
export async function getJSON(url) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); }
export async function postJSON(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `${r.status}`);
  return r.json();
}

// ------------------------------------------------------------------ SVG charts (real arrays only)
export function ticks(a, b, n = 5) {
  const span = b - a; if (!(span > 0)) return [a];
  const st0 = span / n, mag = 10 ** Math.floor(Math.log10(st0)), err = st0 / mag;
  const st = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const out = []; for (let v = Math.ceil(a / st) * st; v <= b + st * 1e-9; v += st) out.push(+v.toFixed(10)); return out;
}
export function chart({ w = 560, h = 230, series = [], points = [], bands = [], vlines = [], hlines = [], xLabel = '', yLabel = '', xDomain, yDomain, xTickFmt, catLabels, id = '' }) {
  const m = { l: 52, r: 12, t: 10, b: 34 };
  const xs = [...series.flatMap((s) => s.x), ...points.flatMap((p) => p.x), ...bands.flatMap((b) => b.x)];
  const ys = [...series.flatMap((s) => s.y), ...points.flatMap((p) => p.y.map((v, i) => [v - (p.err?.[i] || 0), v + (p.err?.[i] || 0)]).flat()), ...bands.flatMap((b) => [...b.lo, ...b.hi])].filter((v) => v !== null && isFinite(v));
  let [x0, x1] = xDomain || [Math.min(...xs), Math.max(...xs)];
  let [y0, y1] = yDomain || [Math.min(...ys), Math.max(...ys)];
  if (!yDomain) { const pad = (y1 - y0) * 0.06 || 1; y0 -= pad; y1 += pad; }
  if (x1 === x0) { x0 -= 1; x1 += 1; }
  const X = (v) => m.l + ((v - x0) / (x1 - x0)) * (w - m.l - m.r);
  const Y = (v) => h - m.b - ((v - y0) / (y1 - y0)) * (h - m.t - m.b);
  const xt = catLabels ? catLabels.map((_, i) => i) : ticks(x0, x1, 6), yt = ticks(y0, y1, 5);
  let s = `<svg class="chart" ${id ? `id="${id}"` : ''} viewBox="0 0 ${w} ${h}" role="img">`;
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
  for (const v of hlines) {
    if (v.y < y0 || v.y > y1) continue;
    s += `<line x1="${m.l}" x2="${w - m.r}" y1="${Y(v.y)}" y2="${Y(v.y)}" stroke="${v.color || '#a9d48c'}" ${v.dash ? `stroke-dasharray="${v.dash}"` : ''} opacity="${v.opacity ?? 0.8}"/>`;
    if (v.label) s += `<text x="${w - m.r - 4}" y="${Y(v.y) - 4}" text-anchor="end" style="fill:${v.color || '#a9d48c'}">${esc(v.label)}</text>`;
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
    p.x.forEach((x, i) => {
      if (p.y[i] === null || !isFinite(p.y[i])) return;
      if (p.err?.[i]) s += `<line x1="${X(x)}" x2="${X(x)}" y1="${Y(p.y[i] - p.err[i])}" y2="${Y(p.y[i] + p.err[i])}" stroke="${p.color}" opacity=".8"/>`;
      s += `<circle cx="${X(x)}" cy="${Y(p.y[i])}" r="${p.r || 3}" fill="${p.color}" stroke="${p.stroke || 'none'}"><title>${esc(p.titles ? p.titles[i] : '')}</title></circle>`;
    });
  }
  return s + '</svg>';
}
export const legend = (items) => `<div class="legend">${items.map((i) => `<span><i style="border-color:${i.color};${i.dash ? 'border-top-style:dashed' : ''}"></i>${esc(i.name)}</span>`).join('')}</div>`;

// ------------------------------------------------------------------ page pieces
export function specTable(obj, title) {
  const rows = Object.entries(obj || {}).map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${vo(v)}<div class="src">${esc(v?.source || '')}${v?.note ? ' · ' + esc(v.note) : ''}</div></td></tr>`).join('');
  return `<div class="scroll"><table>${title ? `<caption class="kick" style="text-align:left;padding-bottom:4px">${esc(title)}</caption>` : ''}<tr><th>key</th><th>value · tag · status · source</th></tr>${rows}</table></div>`;
}
export function simCards(device) {
  return (D.simulators?.[device] || []).map((e) => `<div class="box"><div class="kick"><span>Online simulator · ${esc(e.access)}</span><span>${e.results.length ? e.results.length + ' result(s)' : 'awaiting simulator run'}</span></div>
    <h3><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.tool)}</a></h3><p>${esc(e.models)}</p><p class="note">Limits: ${esc(e.limits)}${e.account_needed ? ' · free account needed' : ''}</p>
    <div class="sup">${e.inputs.map((i) => `<div><span>${esc(i.name)} <span class="chip">${esc(i.origin)}</span></span>${vo(i.value)}</div>`).join('')}</div>
    ${e.missing_inputs.length ? `<p class="note">Missing inputs: ${esc(e.missing_inputs.join('; '))}</p>` : ''}
    ${e.access === 'browser' ? `<details><summary>Paste a result from this simulator</summary><p class="note">Run it in your browser, then paste what it returned. Saved with via "pasted" and picked up by the next run.</p>
      <textarea data-sim-inputs="${esc(device)}|${esc(e.tool)}" placeholder='inputs used, JSON e.g. {"field_nT": 5}'></textarea>
      <textarea data-sim-outputs="${esc(device)}|${esc(e.tool)}" placeholder='outputs, JSON e.g. {"R0_nm": {"value": 6.1, "unit": "nm", "source": "FRET-Calc", "tag": "simulated", "status": "VERIFIED", "as_of": null, "note": null}}'></textarea>
      <button class="cta" data-sim-send="${esc(device)}|${esc(e.tool)}">Save result</button></details>` : ''}</div>`).join('');
}
export function wireSimForms(root) {
  $$('[data-sim-send]', root).forEach((b) => b.addEventListener('click', async () => {
    const [device, tool] = b.dataset.simSend.split('|');
    try {
      const inputs_used = JSON.parse($(`[data-sim-inputs="${device}|${tool}"]`, root).value || '{}');
      const outputs = JSON.parse($(`[data-sim-outputs="${device}|${tool}"]`, root).value || '{}');
      await postJSON(`/api/simulators/${device}`, { tool, inputs_used, outputs });
      D.simulators = await getJSON('/data/simulators.json');
      toast(`Saved a pasted ${tool} result.`);
    } catch (e) { toast(`Could not save: ${e.message}`); }
  }));
}
export const head = (k, t, p) => `<div class="page-head"><div><div class="kick">${esc(k)}</div><h2>${esc(t)}</h2><p>${p}</p></div></div>`;
export const section = (title, body, open = false, meta = '') => `<details class="con-sec" ${open ? 'open' : ''}><summary><span>${esc(title)}</span><span class="meta">${esc(meta)}</span></summary><div class="con-sec-body">${body}</div></details>`;

// "Lean-checked" mark for a theorem in data/lean_proofs.json
export function lean(name) {
  const short = String(name).replace(/^SpinDrift\./, '');
  const t = (D.lean_proofs?.theorems || []).find((x) => x.name === short || x.name === name || x.full_name === name || x.full_name === `SpinDrift.${short}`);
  if (!t) return '';
  const ok = t.kernel_checked && t.standard_axioms_only;
  const title = `Lean 4 theorem SpinDrift.${t.name}\n${t.doc}\n\n${t.statement}\n\nproof: ${t.tactics}\naxioms: ${(t.axioms || []).join(', ') || 'none'}\n${D.lean_proofs.toolchain}`;
  return `<button class="lean ${ok ? 'ok' : ''}" data-lean="${esc(t.name)}" title="${esc(title)}"><b>∀</b>Lean-checked</button>`;
}

// big instrument readout
export const readout = (label, value, unit = '', sub = '', id = '') => `<div class="ro" ${id ? `id="${id}"` : ''}><div class="ro-l">${esc(label)}</div><div class="ro-v"><span>${value}</span><small>${esc(unit)}</small></div>${sub ? `<div class="ro-s">${sub}</div>` : ''}</div>`;
export const pill = (label, state, kind = '') => `<span class="pill ${kind}"><i></i>${esc(label)}: <b>${esc(state)}</b></span>`;

export function percentile(arr, p) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b); const i = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[i];
}
