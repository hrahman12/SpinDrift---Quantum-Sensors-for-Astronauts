// "Physical Lean": every check the Lean prover makes is drawn as a seesaw a ten-year-old can read.
// Lean compares two exact numbers (left ≤ right). The heavier side goes down. If a number is missing there is a
// "?" block and the seesaw stays level, because Lean never guesses. The numbers and the verdict come from Lean
// (POST /api/verdict); this file only draws them.
import { esc, fmtNum } from './core.js';

export const WORDS = { REQUIREMENTS_MET: 'works here', NOT_MET: 'cannot work here', NEED_MORE_INFORMATION: 'a number is missing' };
export const MARK = { REQUIREMENTS_MET: '✓', NOT_MET: '✗', NEED_MORE_INFORMATION: '?' };

const PLAIN = [
  [/^opm_field/, { left: 'magnetic field at the sensor', right: 'what its coils can cancel', good: 'The field is small enough for the sensor to cancel.', bad: 'There is too much magnetic field for the sensor.', fix: 'More shielding would fix it.' }],
  [/snr/, { left: 'noise the signal must beat', right: 'signal collected', good: 'The signal stands clear of the noise.', bad: 'The signal is too faint against the noise.', fix: 'Averaging more heartbeats would help.', squared: true }],
  [/^qd_/, { left: 'smallest amount the test can see', right: 'renin in the sample', good: 'There is enough renin for the test to see.', bad: 'There is too little renin for the test to see.', fix: '' }],
  [/^cqd_/, { left: 'smallest amount the patch can see', right: 'bilirubin in the skin fluid', good: 'There is enough bilirubin for the patch to see.', bad: 'There is too little bilirubin for the patch to see.', fix: '' }],
];
const plainFor = (id) => (PLAIN.find(([re]) => re.test(id)) || [null, { left: 'what is needed', right: 'what we have', good: 'The rule holds.', bad: 'The rule is broken.', fix: '' }])[1];
const num = (x) => { const v = parseFloat(x?.decimal); return Number.isFinite(v) ? v : null; };
const big = (v) => (v >= 1e6 ? `${fmtNum(+(v / 1e6).toPrecision(3))} million` : v >= 1e4 ? `${Math.round(v).toLocaleString('en-US')}` : fmtNum(+v.toPrecision(3)));

// the requirement that decides a verdict card: the first broken one, else the first with a missing number, else the first
export function deciding(card) {
  const r = card?.requirements || [];
  return r.find((x) => x.holds === false) || r.find((x) => x.holds === null || x.holds === undefined) || r[0] || null;
}

export function sentence(req) {
  if (!req) return '';
  const P = plainFor(req.id), L = num(req.lhs), R = num(req.rhs);
  if (req.holds === true || req.holds === false) {
    let ratio = L && R ? (req.holds ? R / L : L / R) : null;
    if (ratio && P.squared) ratio = Math.sqrt(ratio);
    const by = ratio && ratio >= 1.05 ? ` (${big(ratio)} times ${req.holds ? 'more than needed' : 'too much'})` : '';
    return req.holds ? `${P.good}${P.squared && ratio ? ` The signal is ${big(ratio)} times what is needed.` : ''}` : `${P.bad}${P.squared ? (ratio ? ` It would need to be ${big(ratio)} times stronger.` : '') : by} ${P.fix}`.trim();
  }
  const miss = [...new Set((req.missing || []).map((m) => (typeof m === 'string' ? m : m.symbol || m.id || '')).filter(Boolean))].map((s) => MISSING[s] || s);
  if (!miss.length) return 'A number is missing, so Lean will not guess.';
  return `Lean needs ${miss.length === 1 ? 'one more number' : `${['', '', 'two', 'three'][miss.length] || miss.length} more numbers`}: ${miss.join('; ')}. It will not guess.`;
}
// the missing numbers in plain words (keys are the symbols the checker reports)
const MISSING = { c_renin: 'how much renin is in the sample', c_bilirubin: 'how much bilirubin is in the skin fluid',
  range_low: 'the smallest amount the patch can read (its paper is not open to read)', range_high: 'the largest amount the patch can read (its paper is not open to read)',
  LOD: 'the smallest amount the test can see', B_ambient: 'the magnetic field at this spot', B_comp: 'how much field the sensor’s coils can cancel', S: 'the shield',
  snr: 'how clear the signal must be', 'η': 'how sensitive the sensor is', BW: 'the sensor’s bandwidth', A: 'the size of the signal', N: 'how many beats were averaged' };

// the seesaw; size 'sm' for the card rows, 'lg' for the level card
export function seesaw(req, verdict, { size = 'lg' } = {}) {
  if (!req) return '';
  const P = plainFor(req.id), L = num(req.lhs), R = num(req.rhs), known = req.holds === true || req.holds === false;
  let ratio = known && L && R ? Math.max(L / R, R / L) : 1;
  const lg = Math.min(3, Math.log10(Math.max(1, ratio)));
  const ang = known ? (req.holds ? 1 : -1) * (5 + 5 * lg) : 0;          // right side down when the rule holds
  const sH = 15 + 5 * lg, sL = known && !req.holds ? sH : 15, sR = known && req.holds ? sH : 15;
  const W = 240, cx = 120, py = 58, col = { REQUIREMENTS_MET: 'var(--met)', NOT_MET: 'var(--notmet)', NEED_MORE_INFORMATION: 'var(--needinfo)' }[verdict] || 'var(--muted)';
  const val = (x) => (x?.decimal !== undefined && x?.decimal !== null ? `${esc(big(parseFloat(x.decimal)))} ${esc((x.unit || '').replace('²', '²'))}` : '?');
  const q = (x, s, missing) => `<rect x="${x - s / 2}" y="${py - 3 - s}" width="${s}" height="${s}" rx="3" fill="${missing ? 'none' : 'url(#blk)'}" stroke="${missing ? 'var(--needinfo)' : 'none'}" stroke-dasharray="${missing ? '3 3' : ''}"/>${missing ? `<text x="${x}" y="${py - 3 - s / 2 + 4}" text-anchor="middle" style="fill:var(--needinfo);font:600 12px var(--mono)">?</text>` : ''}`;
  const svg = `<svg class="seesaw ${size}" viewBox="0 0 ${W} 88" role="img" aria-label="Lean check: ${esc(P.left)} against ${esc(P.right)}">
    <defs><linearGradient id="blk" x1="0" x2="1"><stop offset="0" stop-color="#b79cff"/><stop offset="1" stop-color="#8fe3ff"/></linearGradient></defs>
    <g><animateTransform attributeName="transform" type="rotate" from="0 ${cx} ${py}" to="${ang} ${cx} ${py}" dur="0.8s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".2 .8 .2 1"/>
      <rect x="28" y="${py - 3}" width="184" height="5" rx="2.5" fill="var(--ink2)"/>
      ${q(52, sL, L === null)}${q(188, sR, R === null)}</g>
    <path d="M${cx},${py + 3} l-13,22 h26 z" fill="none" stroke="var(--ink2)" stroke-width="1.5"/>
    <circle cx="${cx}" cy="${py + 16}" r="0" fill="${col}"/>
    <text x="${cx}" y="14" text-anchor="middle" style="fill:${col};font:600 11px var(--mono);letter-spacing:.08em">${MARK[verdict] || ''} LEAN</text></svg>`;
  if (size === 'sm') return svg;
  return `<div class="lean-phys">${svg}
    <div class="ss-legs"><div><b>${val(req.lhs)}</b><span>${esc(P.left)}</span></div><div><b>${val(req.rhs)}</b><span>${esc(P.right)}</span></div></div>
    <p class="ss-say" style="color:${col}">${esc(sentence(req))}</p>
    <p class="ss-rule">Lean is a maths referee: a program that checks every step. Rule checked: <span class="mono">${esc(req.formula || '')}</span></p></div>`;
}
