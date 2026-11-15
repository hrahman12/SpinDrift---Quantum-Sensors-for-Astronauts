// The unified sensor: one new instrument that does the four jobs the four sensors do separately, designed only from
// what the stored runs and their Lean results have proven, plus the parts the four papers document (ui/hwdata.js).
// Every requirement names the runs that prove it. This is a design, not a measured device: it says so on the page.
import { esc, fmtNum } from './core.js';
import { SRC } from './hwdata.js';

const BUILD = { nv_heart_jgu: 'JGU', nv_heart_zaquant: 'ZAQuant', nv_heart_qant: 'Q.ANT' };
const ETA = { nv_heart_jgu: 13, nv_heart_zaquant: 7, nv_heart_qant: 26 };   // pT/√Hz, Omar et al. Table 2

function place(id, runs) { const r = runs.find((x) => x.location_id === id); return r?.environment?.sub_place || id; }
function listPlaces(ids, runs) { return ids?.length ? ids.map((i) => place(i, runs)).join(', ') : 'none yet'; }

// the requirements the runs have proven, one per job, with the runs that prove each
export function requirements(summary, combined, runs, specs) {
  const C = summary?.checks || {}, req = [];
  const opm = C.opm_brain;
  if (opm) {
    const s = opm.strictest;
    req.push({ job: 'Brain field', sensor: 'OPM (QuSpin QZFM Gen-3)', works: opm.works, fails: opm.does_not_work, needs: opm.needs_a_number,
      need: s ? `field at the head ≤ 50 nT → shield of at least × ${fmtNum(Math.round(s.value.value))} (strictest so far: ${place(s.location_id, runs)})` : 'no Lean condition yet',
      proof: s ? [s.run_id] : [], walls: s ? Math.min(6, Math.ceil(Math.log10(s.value.value))) : 0, S: s?.value?.value ?? null });
  }
  const nv = Object.entries(BUILD).map(([cid, name]) => ({ cid, name, c: C[cid] })).filter((x) => x.c);
  if (nv.length) {
    const known = nv.filter((x) => typeof x.c.strictest?.value?.value === 'number').sort((a, b) => a.c.strictest.value.value - b.c.strictest.value.value);
    const best = known[0];
    req.push({ job: 'Heart field', sensor: best ? `NV diamond, ${best.name} build (${ETA[best.cid]} pT/√Hz)` : 'NV diamond',
      works: best?.c.works || [], fails: best?.c.does_not_work || [], needs: best?.c.needs_a_number || [],
      need: best ? `average at least ${fmtNum(best.c.strictest.value.value)} heartbeats (strictest so far: ${place(best.c.strictest.location_id, runs)}); ${known.slice(1).map((x) => `${x.name} would need ${fmtNum(x.c.strictest.value.value)}`).join(', ')}` : 'no Lean condition yet: the runs gave no heartbeat count',
      proof: best ? [best.c.strictest.run_id] : [] });
  }
  const qd = C.qd_blood, lod = specs?.qd_renin?.detection_limit;
  if (qd) req.push({ job: 'Blood renin', sensor: 'single-QD FRET nanosensor, TIRF counting', works: qd.works, fails: qd.does_not_work, needs: qd.needs_a_number,
    need: `a measured renin value at or above the detection limit (${lod?.value ?? '?'} ${lod?.unit || 'pM'}); read off the body by TIRF counting`, proof: [] });
  const cqd = C.cqd_skin;
  if (cqd) req.push({ job: 'Skin bilirubin', sensor: 'carbon-dot microneedle tattoo + AS7341 reader', works: cqd.works, fails: cqd.does_not_work, needs: cqd.needs_a_number,
    need: 'the patch’s detection range (not in an open source) and a measured bilirubin value', proof: [] });
  const sep = (combined?.components?.['field separation']?.facts || []).find((f) => /OPM ±5 nT range against the NV/.test(f.fact));
  return { req, sep: sep?.value || null };
}

// one board: a shielded chamber for the atoms, the diamond head with its magnet outside it, the optical reader for
// the tattoo, a sample port for the blood test, and one shared core
function boardSVG(R) {
  const opm = R.req.find((r) => r.job === 'Brain field'), walls = opm?.walls || 0;
  const box = (x, y, w, h, t, s, extra = '') => `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#1b1f24" stroke="#46505b" ${extra}/>
    <text x="${x + w / 2}" y="${y + h / 2 - 4}" class="pl">${esc(t)}</text><text x="${x + w / 2}" y="${y + h / 2 + 13}" class="ps">${esc(s)}</text></g>`;
  const wire = (d, col = '#c98a3d', dash = '') => `<path d="${d}" stroke="${col}" stroke-width="2.2" fill="none" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
  const shield = Array.from({ length: walls }, (_, i) => `<rect x="${60 - i * 7}" y="${130 - i * 7}" width="${440 + i * 14}" height="${300 + i * 14}" rx="${18 + i * 4}" fill="none" stroke="#9fb3c8" stroke-opacity="${0.8 - i * 0.1}"/>`).join('');
  return `<svg viewBox="0 0 1600 760" class="board unified" role="img" aria-label="The unified sensor board">
    <rect x="8" y="8" width="1584" height="744" rx="22" fill="#0d1612" stroke="#2b3d33"/>
    <text x="40" y="56" class="bt">Unified sensor · one board for brain, heart, blood and skin</text>
    <text x="40" y="82" class="bs">a design derived from the Lean-checked runs; positions are a drawing choice</text>
    ${shield}<text x="80" y="160" class="mt">Atom chamber (brain)</text><text x="80" y="180" class="ms">${walls ? `${walls} shield walls: × ${fmtNum(Math.round(opm.S))} needed` : 'no shield need proven yet'}</text>
    ${box(90, 210, 150, 60, '795 nm laser', 'Rb-87 D1, circular')}${box(300, 210, 150, 60, 'Rb-87 cell', '3×3×3 mm, ≈150 °C')}${box(300, 330, 150, 60, 'Photodetector', 'lock-in 923 Hz')}${box(90, 330, 150, 60, 'Nulling coils', '±50 nT each axis')}
    ${wire('M240 240 H300', '#c00000')}${wire('M375 270 V330', '#c00000')}${wire('M240 360 H300', '#c98a3d', '3 4')}
    <text x="1100" y="160" class="mt">Diamond head (heart)</text><text x="1100" y="180" class="ms">its 1 mT magnet stays outside the chamber</text>
    ${box(1100, 210, 150, 60, 'Green laser', 'to the diamond')}${box(1310, 210, 150, 60, 'Diamond + magnet', 'NV, ≈1 mT bias')}${box(1310, 330, 150, 60, 'Balanced detection', '> 695 nm glow')}${box(1100, 330, 150, 60, 'Microwave', '2.87 GHz ± 28 MHz')}
    ${wire('M1250 240 H1310', '#b9c6bf', '7 5')}${wire('M1385 270 V330', '#e03030')}${wire('M1250 360 H1280 V250 H1310', '#c3c9d1')}
    <line x1="560" y1="150" x2="1040" y2="150" stroke="#e0705f" stroke-dasharray="6 6"/>
    <text x="800" y="140" class="vt" text-anchor="middle">${R.sep ? `keep apart: the OPM works within ±5 nT, the NV head carries ≈1 mT (× ${fmtNum(R.sep.value)})` : 'keep the NV magnet away from the atoms'}</text>
    ${box(700, 300, 200, 90, 'Shared core', 'one controller + demodulation')}${box(700, 440, 200, 70, 'One bus', 'USB-C · Bluetooth')}${box(700, 560, 200, 70, 'Power', 'OPM 5 W + NV 5 W + battery')}
    ${wire('M450 360 H700')}${wire('M1100 360 H900')}${wire('M800 390 V440')}${wire('M800 510 V560')}
    <text x="80" y="560" class="mt">Optical reader (skin)</text>${box(80, 590, 160, 60, 'LEDs 390 · 470 nm', 'through quartz')}${box(280, 590, 160, 60, 'AS7341', '440·470·510 nm')}${box(480, 590, 130, 60, 'Tattoo', 'carbon dots')}
    ${wire('M240 620 H280', '#6000ff')}${wire('M440 620 H480', '#0040ff')}${wire('M360 590 V530 H700', '#9fe6ff', '1 6')}
    <text x="1100" y="560" class="mt">Sample port (blood)</text>${box(1100, 590, 160, 60, 'QD + Cy5 probes', 'renin cuts the link')}${box(1310, 590, 160, 60, 'TIRF counting', 'off the body · LOD 25 pM')}
    ${wire('M1260 620 H1310', '#b9c6bf', '7 5')}${wire('M1390 590 V530 H900', '#8fb9cf', '6 4')}
  </svg>`;
}

export function unifiedHTML({ summary, combined, runs, specs }) {
  const R = requirements(summary, combined, runs, specs), withLean = runs.filter((r) => r.lean?.checks).length;
  const row = (r) => `<tr><td><b>${esc(r.job)}</b><br><small>${esc(r.sensor)}</small></td>
    <td><span class="v-REQUIREMENTS_MET">✓ ${r.works.length}</span> · <span class="v-NOT_MET">✗ ${r.fails.length}</span> · <span class="v-NEED_MORE_INFORMATION">? ${r.needs.length}</span><br><small>${esc(r.fails.length ? `fails at ${listPlaces(r.fails, runs)}` : r.works.length ? `works at ${listPlaces(r.works, runs)}` : `needs a number at ${listPlaces(r.needs, runs)}`)}</small></td>
    <td>${esc(r.need)}${r.proof.length ? `<br><small>proved in ${esc(r.proof.join(', '))}</small>` : ''}</td></tr>`;
  return `<div class="hw-head"><h2>Unified sensor</h2><span>one new instrument for all four jobs, designed from ${withLean} Lean-checked run${withLean === 1 ? '' : 's'} of ${runs.length}</span></div>
    <div class="un-board">${boardSVG(R)}</div>
    <table class="un-req"><tr><th style="width:24%">Job</th><th style="width:26%">What Lean said across the runs</th><th style="width:50%">So the unified sensor needs</th></tr>${R.req.map(row).join('')}</table>
    <div class="un-notes"><p><b>Shared parts.</b> Light: a 795 nm laser for the atoms, a green laser for the diamond, 390 and 470 nm LEDs for the tattoo. Detectors: a photodetector, a balanced photodiode pair, the AS7341 spectral sensor. One controller replaces the separate lock-ins (923 Hz for the atoms; 3 kHz and 140 kHz drives for the diamond).</p>
    <p><b>What this is.</b> A design that meets every condition the runs have proven so far. It is not a built or tested device. Each new run can tighten a condition and change the design.</p>
    <p class="src">${esc([SRC.zhao, SRC.omar, SRC.long, SRC.tabaSI].join(' · '))}</p></div>`;
}
