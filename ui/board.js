// A Flux-style board for the Hardware tab: the four sensors' real signal chains, wired part by part, built up run by
// run from the stored runs and their Lean results. Positions are a drawing choice; every label, wavelength and
// frequency comes from ui/hwdata.js (each part names its source). Each light or microwave trace can be opened to the
// photon level: wavelength or frequency, photon energy E = hν and frequency ν = c/λ (exact SI constants).
import { esc, fmtNum } from './core.js';
import { MODULES, nvModule, SRC } from './hwdata.js';

const H = 6.62607015e-34, C = 299792458, QE = 1.602176634e-19;   // SI defining constants (exact)
export function photonOf(link) {
  if (link.kind === 'opt' && link.nm) { const nu = C / (link.nm * 1e-9); return { nm: link.nm, nu, eV: (H * nu) / QE }; }
  if ((link.kind === 'mw' || link.kind === 'coil') && link.hz) { const lam = C / link.hz; return { hz: link.hz, lam, eV: (H * link.hz) / QE }; }
  return null;
}
export function wlColor(nm) {
  if (!nm) return '#b9c6bf';
  let r = 0, g = 0, b = 0;
  if (nm < 440) { r = (440 - nm) / 60; b = 1; } else if (nm < 490) { g = (nm - 440) / 50; b = 1; } else if (nm < 510) { g = 1; b = (510 - nm) / 20; }
  else if (nm < 580) { r = (nm - 510) / 70; g = 1; } else if (nm < 645) { r = 1; g = (645 - nm) / 65; } else r = 1;
  const f = nm > 700 ? Math.max(0.45, 1 - (nm - 700) / 220) : 1;          // the eye sees deep red dimly
  return `rgb(${Math.round(255 * r * f)},${Math.round(255 * g * f)},${Math.round(255 * b * f)})`;
}

const BOX = { opm: [40, 120, 700, 360], nv: [860, 120, 700, 360], qd: [40, 560, 700, 360], cqd: [860, 560, 700, 360] };
const HUB = [745, 486, 110, 68];
const PW = 102, PH = 56;
// a font size that fits the text in the box (monospace: about 0.6 × size per character), never below 7.5 px
const fit = (t, max, size) => Math.max(7.5, Math.min(size, (max / (String(t).length * 0.6)) || size)).toFixed(1);
const VERD = { REQUIREMENTS_MET: ['#8fc27a', 'works'], NOT_MET: ['#e0705f', 'cannot work'], NEED_MORE_INFORMATION: ['#d9a944', 'number missing'] };

function partXY(box, p) {
  const [x, y, w, h] = box, cw = (w - 48) / 6, ch = (h - 84) / 3;
  return { x: x + 24 + p.c * cw + (cw - PW) / 2, y: y + 64 + p.r * ch + (ch - PH) / 2 };
}
function route(a, b) {          // an elbow route between two part boxes
  const ax = a.x + PW / 2, ay = a.y + PH / 2, bx = b.x + PW / 2, by = b.y + PH / 2;
  if (Math.abs(ax - bx) < 2) return `M${ax} ${ay + (by > ay ? PH / 2 : -PH / 2)} V${by + (by > ay ? -PH / 2 : PH / 2)}`;
  const x1 = bx > ax ? a.x + PW : a.x, x2 = bx > ax ? b.x : b.x + PW, xm = (x1 + x2) / 2;
  if (Math.abs(ay - by) < 2) return `M${x1} ${ay} H${x2}`;
  return `M${x1} ${ay} H${xm} V${by} H${x2}`;
}
function traceSVG(id, d, link, fresh) {
  const k = link.kind, cls = `tr tr-${k}${fresh ? ' fresh' : ''}`, data = `data-link="${esc(id)}"`;
  if (k === 'opt') {
    const col = wlColor(link.nm);
    return `<g class="${cls}" ${data}><path d="${d}" stroke="${col}" stroke-width="3.2" fill="none" opacity=".55" ${link.nm ? '' : 'stroke-dasharray="7 5"'}/>
      <path class="photons" d="${d}" stroke="${col}" stroke-width="3.2" fill="none" stroke-dasharray="1.5 15" stroke-linecap="round"/>
      <path class="hit" d="${d}" stroke="transparent" stroke-width="14" fill="none"/></g>`;
  }
  if (k === 'mw') return `<g class="${cls}" ${data}><path d="${d}" stroke="#c3c9d1" stroke-width="5" fill="none" opacity=".25"/><path d="${d}" stroke="#c3c9d1" stroke-width="1.6" fill="none"/>
      <path class="photons slow" d="${d}" stroke="#e8edf3" stroke-width="2" fill="none" stroke-dasharray="10 12"/><path class="hit" d="${d}" stroke="transparent" stroke-width="14" fill="none"/></g>`;
  if (k === 'coil') return `<g class="${cls}" ${data}><path d="${d}" stroke="#c98a3d" stroke-width="1.6" fill="none" stroke-dasharray="3 4"/><path class="hit" d="${d}" stroke="transparent" stroke-width="12" fill="none"/></g>`;
  if (k === 'rf') return `<g class="${cls}" ${data}><path d="${d}" stroke="#9fe6ff" stroke-width="1.6" fill="none" stroke-dasharray="1 6" stroke-linecap="round"/><path class="hit" d="${d}" stroke="transparent" stroke-width="12" fill="none"/></g>`;
  if (k === 'fluid') return `<g class="${cls}" ${data}><path d="${d}" stroke="#8fb9cf" stroke-width="2.4" fill="none" stroke-dasharray="6 4"/><path class="hit" d="${d}" stroke="transparent" stroke-width="12" fill="none"/></g>`;
  if (k === 'hop') return `<g class="${cls}" ${data}><path d="${d}" stroke="#6fd0c2" stroke-width="2" fill="none" stroke-dasharray="2 5"/><path class="hit" d="${d}" stroke="transparent" stroke-width="12" fill="none"/></g>`;
  return `<g class="${cls}" ${data}><path d="${d}" stroke="#c98a3d" stroke-width="2.4" fill="none"/><path class="hit" d="${d}" stroke="transparent" stroke-width="12" fill="none"/></g>`;
}
function partSVG(id, p, xy, fresh) {
  const glow = p.glow ? `<rect x="${xy.x - 3}" y="${xy.y - 3}" width="${PW + 6}" height="${PH + 6}" rx="9" fill="none" stroke="#6fd0c2" stroke-opacity=".5"/>` : '';
  const pads = [0.3, 0.7].map((f) => `<rect x="${xy.x - 4}" y="${xy.y + PH * f - 3}" width="5" height="6" rx="1" fill="#c9a24a"/><rect x="${xy.x + PW - 1}" y="${xy.y + PH * f - 3}" width="5" height="6" rx="1" fill="#c9a24a"/>`).join('');
  return `<g class="part${p.missing ? ' missing' : ''}${p.port ? ' port' : ''}${fresh ? ' fresh' : ''}" data-part="${esc(id)}">${glow}
    <rect x="${xy.x}" y="${xy.y}" width="${PW}" height="${PH}" rx="6" fill="${p.missing ? 'none' : '#1b1f24'}" stroke="${p.missing ? '#6b7280' : '#46505b'}" ${p.missing ? 'stroke-dasharray="4 3"' : ''}/>${p.missing ? '' : pads}
    <text x="${xy.x + PW / 2}" y="${xy.y + 23}" class="pl" style="font-size:${fit(p.label, PW - 10, 11.5)}px">${esc(p.label)}</text>
    <text x="${xy.x + PW / 2}" y="${xy.y + 39}" class="ps" style="font-size:${fit(p.sub, PW - 8, 9.5)}px">${esc(p.sub)}</text>
    <title>${esc(`${p.label} · ${p.sub}\nSource: ${SRC[p.src] || p.src}`)}</title></g>`;
}

// state: { build, runs (stored runs, oldest first), upto (index of the last run shown), seen (Set of element keys
// drawn last time, so new ones animate in) }
export function drawBoard(state) {
  const { build = 'jgu', runs = [], upto = runs.length - 1, seen = new Set() } = state;
  const shown = runs.slice(0, upto + 1), keys = new Set(), out = [];
  const fresh = (k) => { keys.add(k); return !seen.has(k); };
  const mods = { opm: MODULES.opm, nv: nvModule(build), qd: MODULES.qd, cqd: MODULES.cqd };
  // what the runs so far have proven: the latest verdict per check, the strictest condition per check, the places
  const latest = {}, strictest = {}, places = [];
  for (const r of shown) {
    const L = r.lean?.checks; if (!L) continue;
    if (!places.find((p) => p.id === r.location_id)) places.push({ id: r.location_id, name: r.environment?.sub_place || r.location_id, run: r.run_id });
    for (const [cid, c] of Object.entries(L)) {
      latest[cid] = { verdict: c.verdict, run: r.run_id, where: r.environment?.sub_place || r.location_id };
      for (const [key, cond] of Object.entries(c.conditions || {})) {
        const v = cond?.value; if (typeof v !== 'number') continue;
        if (!strictest[cid] || v > strictest[cid].value) strictest[cid] = { key, value: v, unit: cond.unit, where: r.environment?.sub_place || r.location_id, run: r.run_id };
      }
    }
  }
  const facts = {};          // facts each run added, per sensor (data/runs.json adds_to_combined)
  for (const r of shown) for (const a of r.adds_to_combined || []) {
    const d = /^Lean verdict, QuSpin|^OPM|EEG/.test(a.fact) ? 'opm' : /NV|ODMR|JGU|ZAQUANT|ZAQuant|QANT|Q\.ANT/.test(a.fact) ? 'nv' : /renin|FRET|Donor|QD/.test(a.fact) ? 'qd' : /carbon|patch|bilirubin|Patch/.test(a.fact) ? 'cqd' : null;
    if (d) facts[d] = (facts[d] || 0) + 1;
  }
  out.push(`<svg viewBox="0 0 1600 960" class="board" role="img" aria-label="The four sensors wired part by part">
    <defs><pattern id="dots" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".9" fill="#1c2b22"/></pattern></defs>
    <rect x="8" y="8" width="1584" height="944" rx="22" fill="#0d1612" stroke="#2b3d33"/><rect x="8" y="8" width="1584" height="944" rx="22" fill="url(#dots)"/>
    <text x="40" y="58" class="bt">SpinDrift all-in-one · built from ${shown.length} run${shown.length === 1 ? '' : 's'}</text>
    <text x="40" y="84" class="bs">${places.length ? `places with a Lean result: ${esc(places.map((p) => p.name).join(' · '))}` : 'no run with a Lean result yet'}</text>`);
  // the hub: where the four outputs meet (a design target, not a built part)
  out.push(`<g class="hub"><rect x="${HUB[0]}" y="${HUB[1]}" width="${HUB[2]}" height="${HUB[3]}" rx="8" fill="#14191e" stroke="#6fd0c2" stroke-dasharray="4 3"/>
    ${Array.from({ length: 7 }, (_, i) => `<rect x="${HUB[0] + 10 + i * 13.5}" y="${HUB[1] - 5}" width="6" height="5" fill="#c9a24a"/><rect x="${HUB[0] + 10 + i * 13.5}" y="${HUB[1] + HUB[3]}" width="6" height="5" fill="#c9a24a"/>`).join('')}
    <text x="${HUB[0] + HUB[2] / 2}" y="${HUB[1] + 30}" class="pl">one bus</text><text x="${HUB[0] + HUB[2] / 2}" y="${HUB[1] + 46}" class="ps">design target</text></g>`);
  for (const [key, M] of Object.entries(mods)) {
    const box = BOX[key], [x, y, w, h] = box, pos = {};
    for (const p of M.parts) pos[p.id] = partXY(box, p);
    const lv = latest[M.check], vc = lv ? VERD[lv.verdict] : null;
    out.push(`<g class="module"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="#101a15" stroke="#3c4a40"/>
      <text x="${x + 20}" y="${y + 30}" class="mt">${esc(M.title)}</text><text x="${x + 20}" y="${y + 48}" class="ms">${esc(M.sub)}</text>
      ${vc ? `<g class="${fresh(`${key}-v-${lv.verdict}-${lv.run}`) ? 'fresh' : ''}"><circle cx="${x + w - 26}" cy="${y + 28}" r="7" fill="${vc[0]}"/><text x="${x + w - 40}" y="${y + 32}" class="vt" text-anchor="end">${esc(`${vc[1]} at ${lv.where}`)}</text></g>` : `<text x="${x + w - 20}" y="${y + 32}" class="vt" text-anchor="end">no Lean run yet</text>`}
      <text x="${x + w - 20}" y="${y + 50}" class="ms" text-anchor="end">${facts[key] || 0} facts from the runs</text></g>`);
    // shield walls around the brain sensor: one wall per factor of ten the Lean runs have shown it needs
    if (key === 'opm' && strictest.opm_brain) {
      const s = strictest.opm_brain, n = Math.min(6, Math.max(1, Math.ceil(Math.log10(s.value))));
      for (let i = 0; i < n; i++) out.push(`<rect class="shield${fresh(`shield-${i}`) ? ' fresh' : ''}" x="${x - 6 - i * 5}" y="${y - 6 - i * 5}" width="${w + 12 + i * 10}" height="${h + 12 + i * 10}" rx="${16 + i * 4}" fill="none" stroke="#9fb3c8" stroke-opacity="${0.75 - i * 0.1}"/>`);
      out.push(`<text x="${x + 20}" y="${y + h - 14}" class="ms">shield needed × ${esc(fmtNum(Math.round(s.value)))} → ${n} walls, one per ×10 · ${esc(s.where)} · ${esc(s.run)}</text>`);
    }
    if (key === 'nv') {
      const s = strictest[M.check];
      out.push(`<text x="${x + 20}" y="${y + h - 14}" class="ms">${s ? `heartbeats needed: ${esc(fmtNum(s.value))} at ${esc(s.where)} (Lean, ${esc(s.run)})` : 'heartbeats needed: no Lean run gave a number yet'}</text>`);
    }
    for (const [i, l] of M.links.entries()) {
      const a = pos[l.a], b = pos[l.b]; if (!a || !b) continue;
      out.push(traceSVG(`${key}:${i}`, route(a, b), l, fresh(`${key}-t-${i}`)));
    }
    for (const p of M.parts) out.push(partSVG(`${key}:${p.id}`, p, pos[p.id], fresh(`${key}-p-${p.id}`)));
    // the module's output to the hub
    const o = pos.out; if (o) {
      const ox = o.x + (key === 'opm' || key === 'qd' ? PW : 0), oy = o.y + PH / 2, hx = key === 'opm' || key === 'qd' ? HUB[0] : HUB[0] + HUB[2], hy = HUB[1] + HUB[3] / 2 + (key === 'opm' || key === 'nv' ? -14 : 14);
      const kind = key === 'cqd' ? 'rf' : key === 'qd' ? 'fluid' : 'cu';
      out.push(traceSVG(`${key}:hub`, `M${ox} ${oy} H${(ox + hx) / 2} V${hy} H${hx}`, { kind, note: key === 'qd' ? 'lab result, sent on afterwards' : key === 'cqd' ? 'Bluetooth' : 'cable' }, fresh(`${key}-hub`)));
    }
  }
  out.push('</svg>');
  return { svg: out.join(''), keys, mods };
}

// the text for one trace when it is opened: the connection, and its photons
export function linkInfo(mods, id) {
  const [key, i] = id.split(':'), M = mods[key]; if (!M) return null;
  if (i === 'hub') return { title: `${M.title} → one bus`, lines: ['The four outputs meet here in the all-in-one design: a design target, not a built part.'] };
  const l = M.links[+i]; if (!l) return null;
  const A = M.parts.find((p) => p.id === l.a), B = M.parts.find((p) => p.id === l.b), ph = photonOf(l), lines = [];
  const kindName = { opt: 'light', mw: 'microwave line', coil: 'applied field', cu: 'copper', rf: 'radio link', fluid: 'sample', hop: 'energy hop (FRET)' }[l.kind];
  if (ph?.nm) lines.push(`${l.nm} nm light · ν = ${fmtNum(+(ph.nu / 1e12).toPrecision(4))} THz · one photon carries ${fmtNum(+ph.eV.toPrecision(4))} eV`);
  else if (l.kind === 'opt') lines.push('the source names this light but not its wavelength, so no photon energy is computed');
  if (ph?.hz) lines.push(l.hz >= 1e6 ? `${fmtNum(+(l.hz / 1e9).toPrecision(4))} GHz · free-space wavelength ${fmtNum(+(ph.lam * 100).toPrecision(3))} cm · one photon carries ${fmtNum(+(ph.eV * 1e6).toPrecision(3))} µeV` : `${fmtNum(l.hz)} Hz field · one quantum carries ${fmtNum(+(ph.eV * 1e12).toPrecision(3))} peV`);
  if (l.kind === 'coil' && !l.hz) lines.push('a static field (0 Hz)');
  if (l.note) lines.push(l.note);
  return { title: `${A?.label} → ${B?.label} · ${kindName}`, lines, src: SRC[A?.src] || '' };
}
