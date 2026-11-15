// Shared helpers for the quantum-level scenes (q_nv, q_rb, q_qd, q_cqd). Geometry and drawing only: every number that
// describes nature comes from data/quantum_constants.json, physics.json or a recorded file, read by the scene modules.
import * as THREE from 'three';

// Theme colours (project brief; ink, muted and accent equal ui/style.css). Used for diagrams, axes and for anything whose
// emission colour is not cited. Device colours come from data/palette.json, atom colours from Jmol's CPK table.
export const THEME = { ink: '#e1e5d6', muted: '#8e9684', accent: '#a9d48c', bg: '#23271f' };

export function theme(D) {
  const t = D?.quantum_constants?.theme_colours?.value;
  return t ? { ink: t.ink, muted: t.muted, accent: t.accent, bg: t.background } : THEME;
}
export function cpk(D, el) {
  return D?.quantum_constants?.cpk_colours?.[el]?.value || null;
}
// colour of a cited wavelength from data/palette.json (CIE 1931 -> sRGB, computed there)
export function paletteColour(D, device, wavelength) {
  const c = (D?.palette?.colours || []).find((x) => x.device === device && (wavelength == null || x.wavelength?.value === wavelength));
  return c?.colour?.value ? { hex: c.colour.value, wavelength: c.wavelength, colour: c.colour } : null;
}

// keeps every geometry and material so dispose() frees them
export function tracker() {
  const items = new Set();
  return {
    add(o) { items.add(o); return o; },
    dispose() { for (const o of items) { try { o.dispose?.(); } catch { /* already gone */ } } items.clear(); },
  };
}

export function addLights(scene, t = THEME) {
  scene.add(new THREE.HemisphereLight(t.ink, '#15180f', 1.15));
  const key = new THREE.DirectionalLight('#ffffff', 1.5); key.position.set(5, 9, 7); scene.add(key);
  const fill = new THREE.DirectionalLight(t.accent, 0.3); fill.position.set(-7, -3, -6); scene.add(fill);
}

const UP = new THREE.Vector3(0, 1, 0);

// arrow made of a cylinder and a cone; set(dir, length) re-aims it (dir need not be unit length)
export function makeArrow(T, color, { shaft = 0.05, head = 0.14, headLen = 0.35, opacity = 1, emissive = 0.3 } = {}) {
  const mat = T.add(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: emissive, roughness: 0.45,
    metalness: 0.05, transparent: opacity < 1, opacity }));
  const sg = T.add(new THREE.CylinderGeometry(shaft, shaft, 1, 14)); sg.translate(0, 0.5, 0);
  const hg = T.add(new THREE.ConeGeometry(head, 1, 18)); hg.translate(0, 0.5, 0);
  const group = new THREE.Group(), s = new THREE.Mesh(sg, mat), h = new THREE.Mesh(hg, mat);
  group.add(s, h);
  const d = new THREE.Vector3();
  function set(dir, len) {
    d.copy(dir); const n = d.length();
    if (!(n > 1e-9) || !(len > 1e-6)) { group.visible = false; return; }
    group.visible = true;
    group.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / n));
    const hl = Math.min(headLen, len * 0.45);
    s.scale.set(1, Math.max(len - hl, 1e-4), 1);
    h.position.set(0, len - hl, 0); h.scale.set(1, hl, 1);
  }
  return { group, set, material: mat };
}

export function polyline(T, pts, color, { dashed = false, dash = 0.2, gap = 0.12, opacity = 1 } = {}) {
  const geo = T.add(new THREE.BufferGeometry().setFromPoints(pts));
  const mat = T.add(dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: dash, gapSize: gap, transparent: opacity < 1, opacity })
    : new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
  const line = new THREE.Line(geo, mat);
  if (dashed) line.computeLineDistances();
  return line;
}
// a line strip whose points are rewritten every frame (trails, live curves)
export function liveLine(T, maxPoints, color, { opacity = 1, vertexColors = false } = {}) {
  const geo = T.add(new THREE.BufferGeometry());
  const pos = new Float32Array(maxPoints * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  let col = null;
  if (vertexColors) { col = new Float32Array(maxPoints * 3); geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage)); }
  geo.setDrawRange(0, 0);
  const mat = T.add(new THREE.LineBasicMaterial({ color: vertexColors ? '#ffffff' : color, vertexColors, transparent: opacity < 1, opacity }));
  const line = new THREE.Line(geo, mat); line.frustumCulled = false;
  return { line, pos, col, geo, set(n) { geo.setDrawRange(0, n); geo.attributes.position.needsUpdate = true; if (col) geo.attributes.color.needsUpdate = true; } };
}
export function circlePoints(center, normal, radius, n = 96) {
  const nn = normal.clone().normalize();
  const u = Math.abs(nn.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(nn).normalize() : new THREE.Vector3(1, 0, 0).cross(nn).normalize();
  const v = nn.clone().cross(u);
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; pts.push(center.clone().addScaledVector(u, Math.cos(a) * radius).addScaledVector(v, Math.sin(a) * radius)); }
  return pts;
}

// instanced spheres: positions (Vector3[]), per-instance radii and colours
export function spheres(T, positions, radii, colors, { roughness = 0.45, segments = 18, emissive = 0 } = {}) {
  const geo = T.add(new THREE.SphereGeometry(1, segments, Math.max(8, Math.round(segments * 0.7))));
  const mat = T.add(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness, metalness: 0.0, emissive: '#000000', emissiveIntensity: emissive }));
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, positions.length));
  mesh.count = positions.length;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), c = new THREE.Color();
  const setRadii = (rs) => {
    positions.forEach((p, i) => { const r = Array.isArray(rs) ? rs[i] : rs; s.set(r, r, r); m.compose(p, q, s); mesh.setMatrixAt(i, m); });
    mesh.instanceMatrix.needsUpdate = true;
  };
  setRadii(radii);
  positions.forEach((p, i) => { c.set(Array.isArray(colors) ? colors[i] : colors); mesh.setColorAt(i, c); });
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return { mesh, setRadii };
}
// instanced cylinders between point pairs
export function sticks(T, pairs, radius, colors, { roughness = 0.6 } = {}) {
  const geo = T.add(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true));
  const mat = T.add(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness }));
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, pairs.length));
  mesh.count = pairs.length;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), d = new THREE.Vector3(), c = new THREE.Color();
  pairs.forEach(([a, b], i) => {
    d.subVectors(b, a); const L = d.length();
    q.setFromUnitVectors(UP, d.multiplyScalar(1 / (L || 1)));
    p.addVectors(a, b).multiplyScalar(0.5); s.set(radius, L, radius); m.compose(p, q, s); mesh.setMatrixAt(i, m);
    c.set(Array.isArray(colors) ? colors[i] : colors); mesh.setColorAt(i, c);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}
export function cylinderBetween(T, a, b, radius, material) {
  const geo = T.add(new THREE.CylinderGeometry(radius, radius, 1, 12));
  const mesh = new THREE.Mesh(geo, material);
  const d = new THREE.Vector3().subVectors(b, a), L = d.length();
  mesh.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / (L || 1)));
  mesh.position.addVectors(a, b).multiplyScalar(0.5); mesh.scale.set(1, L, 1);
  return mesh;
}
// soft additive glow (no texture): a few nested back-faced spheres
export function glow(T, color, radius, { layers = 4, strength = 0.22 } = {}) {
  const g = new THREE.Group(), mats = [];
  for (let i = 0; i < layers; i++) {
    const f = 1 + i * 0.45;
    const mat = T.add(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: strength / (1 + i), blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide }));
    const mesh = new THREE.Mesh(T.add(new THREE.SphereGeometry(radius * f, 32, 20)), mat);
    g.add(mesh); mats.push([mat, strength / (1 + i)]);
  }
  return { group: g, setLevel(k) { for (const [m, o] of mats) m.opacity = o * Math.max(0, k); g.visible = k > 0.001; } };
}

export const lerpHex = (a, b, t) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), Math.min(1, Math.max(0, t))).getHexString();
export const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// number formatting for readouts (strings, so the host shows them as given)
export function fx(v, d = 3) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const s = v.toFixed(d);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
}
export function sci(v, d = 2) {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(v))), m = v / 10 ** e;
  return `${m.toFixed(d)}×10${String(e).replace('-', '⁻').replace(/\d/g, (c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[c])}`;
}
// a readout row straight from a value object
export function voRow(label, v, { value, unit } = {}) {
  if (!v) return { label, value: 'no data', unit: '', tag: '', source: '' };
  const shown = value ?? (v.value === null || v.value === undefined ? (v.status === 'NOT_STATED' ? 'not stated in source' : 'not yet extracted') : v.value);
  const st = v.status && v.status !== 'VERIFIED' ? ` · ${v.status === 'TO_CONFIRM' ? 'to confirm' : v.status.toLowerCase().replace(/_/g, ' ')}` : '';
  return { label, value: shown, unit: unit ?? v.unit ?? '', tag: `${v.tag}${st}`, source: v.source || '' };
}

// ---------------------------------------------------------------- deterministic sequences, pixel dots, thermal jiggle
// Halton low-discrepancy sequence: evenly spread, repeatable numbers in [0, 1) (never Math.random)
export const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
// a set of round dots of constant pixel size (a marker, never a size) whose positions, colours and brightness can
// change every frame
export function dots(T, n, px, { additive = true } = {}) {
  const geo = T.add(new THREE.BufferGeometry());
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3).fill(1), alp = new Float32Array(n).fill(1);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alp, 1).setUsage(THREE.DynamicDrawUsage));
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const mat = T.add(new THREE.ShaderMaterial({
    uniforms: { uSize: { value: px * dpr } },
    vertexShader: 'attribute vec3 aColor; attribute float aAlpha; varying vec3 vC; varying float vA; uniform float uSize;\nvoid main(){ vC = aColor; vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uSize; }',
    fragmentShader: 'varying vec3 vC; varying float vA;\nvoid main(){ float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard; float a = (1.0 - smoothstep(0.12, 0.5, r)) * vA; gl_FragColor = vec4(vC * a, a); }',
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, transparent: true,
  }));
  const points = new THREE.Points(geo, mat); points.frustumCulled = false;
  return { points, pos, col, alp, geo, flush() { for (const k of ['position', 'aColor', 'aAlpha']) geo.attributes[k].needsUpdate = true; } };
}
// Thermal jiggle in the Einstein model: every atom oscillates along each axis at one frequency with amplitude
// sqrt(2 <u^2>), so its mean-square displacement per direction is the measured <u^2>. Phases come from Halton
// sequences (bases 2, 3, 5): the motion is repeatable. Returns (atom index, phase in rad, Vector3 out).
export function jiggle(rms) {
  const A = Math.SQRT2 * rms;
  return (i, phase, out) => out.set(A * Math.sin(phase + 2 * Math.PI * halton(i + 1, 2)),
    A * Math.sin(phase + 2 * Math.PI * halton(i + 1, 3)), A * Math.sin(phase + 2 * Math.PI * halton(i + 1, 5)));
}
// "3×10¹³" for a slow-down factor, and the screen time it stands for
export const timesText = (s) => sci(s, s >= 100 ? 1 : 2).replace('.0×', '×');
export const num = (v) => (v && typeof v.value === 'number' && Number.isFinite(v.value) ? v.value : null);
export const plainNum = (x, d = 3) => (x === null || x === undefined || !Number.isFinite(x) ? '—'
  : Math.abs(x) >= 1e4 ? Math.round(x).toLocaleString('en-US') : +x.toPrecision(d) + '');

// ---------------------------------------------------------------- views and the chosen place (scene contract)
export const unit3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
export const hasView = (views, name) => Object.prototype.hasOwnProperty.call(views, name);
// keeps the first info line in step with the view that is shown (labels stay as built: the host reads them once)
export function viewLine(info, views) {
  const lines = info.lines.slice();
  return (name) => { info.lines.length = 0; if (name) info.lines.push(`In this view: ${views[name].note}`); info.lines.push(...lines); };
}
// "At <place · spot>" for readout sources
export const placeText = (env) => [env?.location?.place, env?.location?.sub_place].filter(Boolean).join(' · ');
// one readout row for the chosen place's radiation note, kept last in the list and removed when the place has none
// (for the scenes that do not read magnetic fields)
export function radiationRow(readouts) {
  const row = { label: 'radiation here', plain: 'Radiation here', value: '', unit: '', tag: 'from the chosen place', source: '' };
  return (env) => {
    const text = typeof env?.radiation === 'string' ? env.radiation.trim() : '';
    const at = readouts.indexOf(row);
    if (!text) { if (at >= 0) readouts.splice(at, 1); return; }
    row.value = text; row.source = placeText(env);
    if (at < 0) readouts.push(row);
  };
}

// what a scene returns when its data did not load: an empty stage that says why (every asked-for view points at it)
export function missingScene(title, message, viewNames = ['default']) {
  const scene = new THREE.Scene(); scene.background = null; addLights(scene);
  const readouts = [], views = {};
  for (const n of viewNames) views[n] = { target: [0, 0, 0], dir: [0, 0, 1], note: message };
  return { scene, camera: { position: [0, 0, 10], target: [0, 0, 0], fov: 40 }, labels: [], readouts, controls: [],
    info: { title, lines: [message], sources: [], lean: [] }, views, setView() {}, setEnv() {}, update() {}, dispose() {} };
}
export const NO_CONSTANTS = 'data/quantum_constants.json did not load; run python scripts/build_quantum_constants.py.';

// dispose everything under an object (meshes created outside the tracker)
export function disposeTree(root) {
  root.traverse((o) => {
    o.geometry?.dispose?.();
    const m = o.material; if (Array.isArray(m)) m.forEach((x) => x.dispose?.()); else m?.dispose?.();
  });
}
