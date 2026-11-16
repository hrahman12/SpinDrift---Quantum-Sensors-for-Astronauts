// Real-person figure: the Human Reference Atlas body surface, slimmed and dressed for each scene.
// Garments are grown from the body itself: the skin is welded, each vertex is classed (head, arm, torso/legs) from
// the body's own shape, a region is cut out, smoothed (Taubin) so no anatomy shows, and pushed out along its normals.
// Joint heights for sleeves and hems use Drillis & Contini (1966) proportions (elbow 0.630 H, wrist 0.485 H,
// hip 0.530 H, ankle 0.039 H). Garment thickness, colours, the helmet and the backpack are a drawing choice.
import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lookOf } from './areas.js';

// thinner figure: torso and limbs narrowed about the body axis, the head kept as is, a smooth blend at the neck
export function slimTransform({ H, y0, cx = 0, cz = 0, s = 0.85 }) {
  return (v) => {
    const hy = (v.y - y0) / H, k = hy < 0.80 ? s : hy > 0.88 ? 1 : s + (1 - s) * ((hy - 0.80) / 0.08);
    v.x = cx + (v.x - cx) * k; v.z = cz + (v.z - cz) * k; return v;
  };
}
// thinner legs: each leg narrowed about its own centre line, found per centimetre of height from the skin itself.
// Only the stretch where the two legs are clearly apart is changed (from just above the ankles up to the highest
// clean slice below the hips), with smooth blends at both ends, so feet, hips and hands stay as they are.
export function legSlim(skinMeshes, { H, y0, cx = 0, s = 0.82 }) {
  const v = new THREE.Vector3(), bins = new Map(), BIN = 0.01;
  for (const m of skinMeshes) {
    m.updateMatrixWorld(true);
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      const hy = (v.y - y0) / H; if (hy < 0.03 || hy > 0.56) continue;
      const k = Math.floor((v.y - y0) / BIN); let b = bins.get(k); if (!b) bins.set(k, b = []); b.push(v.x, v.z);
    }
  }
  // per slice: one leg cluster on each side (gaps over 12 mm split clusters; the middle and the hands are left out)
  const legs = new Map();
  for (const [k, a] of bins) {
    const idx = []; for (let j = 0; j < a.length; j += 2) idx.push(j);
    idx.sort((p, q) => a[p] - a[q]);
    const out = {}; let start = 0;
    for (let j = 1; j <= idx.length; j++) {
      if (j < idx.length && a[idx[j]] - a[idx[j - 1]] <= 0.012) continue;
      const c = idx.slice(start, j); start = j;
      let sx = 0, sz = 0; for (const q of c) { sx += a[q]; sz += a[q + 1]; }
      const mx = sx / c.length, mz = sz / c.length, x0 = a[c[0]], x1 = a[c[c.length - 1]], d = mx - cx;
      if (c.length < 6 || Math.abs(d) < 0.02 * H || Math.abs(d) > 0.09 * H || x1 - x0 > 0.14 * H) continue;
      const side = d > 0 ? 'L' : 'R';
      out[side] = side in out ? null : { x: mx, z: mz, x0, x1 };   // two candidates on one side: not a clean slice
    }
    if (out.L && out.R) legs.set(k, out);
  }
  const kKnee = Math.floor((0.285 * H) / BIN);          // knee height 0.285 H (Drillis & Contini 1966)
  if (!legs.has(kKnee)) return null;
  let kTop = kKnee, kBot = kKnee;
  while (legs.has(kTop + 1)) kTop++;
  while (legs.has(kBot - 1)) kBot--;
  const hyTop = (kTop * BIN) / H, hyBot = Math.max(0.085, ((kBot + 1) * BIN) / H);
  const at = (y, side) => {
    const t = (y - y0) / BIN - 0.5, k = Math.floor(t), f = t - k, A = legs.get(k)?.[side], B = legs.get(k + 1)?.[side];
    if (A && B) return { x: A.x + (B.x - A.x) * f, z: A.z + (B.z - A.z) * f, x0: Math.min(A.x0, B.x0), x1: Math.max(A.x1, B.x1) };
    return A || B || null;
  };
  return (p) => {
    const hy = (p.y - y0) / H; if (hy <= hyBot - 0.03 || hy >= hyTop) return p;
    const w = Math.min(1, (hy - (hyBot - 0.03)) / 0.03) * Math.min(1, (hyTop - hy) / 0.06);
    const c = at(p.y, p.x > cx ? 'L' : 'R'); if (!c || p.x < c.x0 - 0.003 || p.x > c.x1 + 0.003) return p;
    const k = 1 - (1 - s) * w;
    p.x = c.x + (p.x - c.x) * k; p.z = c.z + (p.z - c.z) * k; return p;
  };
}
export function deformMesh(mesh, fn) {
  mesh.updateMatrixWorld(true);
  const g = mesh.geometry, pos = g.attributes.position, m = mesh.matrixWorld, inv = m.clone().invert(), v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m); fn(v); v.applyMatrix4(inv); pos.setXYZ(i, v.x, v.y, v.z); }
  pos.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
}

// one welded world-space body with per-vertex classes: 0 torso/legs, 1 arm, 2 head
export function bodyModel(skinMeshes, { H, y0, cx = 0 }) {
  const parts = skinMeshes.map((m) => {
    m.updateMatrixWorld(true);
    let g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
    if (!g.index) g = mergeVertices(g, 1e-6);
    return g;
  });
  const welded = mergeVertices(parts.length > 1 ? mergeGeometries(parts) : parts[0], 2e-5);
  const P = welded.attributes.position.array, n = welded.attributes.position.count, I = welded.index.array;
  const cls = new Uint8Array(n), hyA = new Float32Array(n);
  const slices = new Map();
  for (let i = 0; i < n; i++) {
    const hy = (P[3 * i + 1] - y0) / H; hyA[i] = hy;
    if (hy > 0.865) { cls[i] = 2; continue; }
    if (hy > 0.80) { if (Math.abs(P[3 * i] - cx) > 0.105 * H) cls[i] = 1; continue; }
    if (hy < 0.34) continue;
    const k = Math.floor(hy * H / 0.01); if (!slices.has(k)) slices.set(k, []); slices.get(k).push(i);
  }
  // in each 1 cm slice, clusters separated by gaps are limbs or trunk; clusters centred far from the axis are arms
  for (const list of slices.values()) {
    list.sort((a, b) => P[3 * a] - P[3 * b]);
    let start = 0;
    const flush = (end) => { let sx = 0; for (let j = start; j < end; j++) sx += P[3 * list[j]]; const c = sx / (end - start); if (Math.abs(c - cx) > 0.10 * H) for (let j = start; j < end; j++) cls[list[j]] = 1; };
    for (let j = 1; j < list.length; j++) if (P[3 * list[j]] - P[3 * list[j - 1]] > 0.012) { flush(j); start = j; }
    if (list.length) flush(list.length);
  }
  return { P, I, n, cls, hy: hyA, H, y0, cx };
}

// A clothed figure shows no anatomy between the legs. Below the height where the legs separate, the body surface is
// three pieces: two legs and what hangs between them. That middle piece is folded up flat against the body, and the
// front of the lower trunk is kept no further forward than the thighs beside it. The same moves are applied to the
// welded model (so garments grow from the tidy shape) and to the skin meshes underneath.
export function tuck(body, skinMeshes) {
  const { P, I, n, cls, hy, H, y0, cx } = body;
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < n; i++) if (cls[i] === 0 && hy[i] > 0.45 && hy[i] < 0.55) { const z = P[3 * i + 2]; if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
  const zMid = (zmin + zmax) / 2, SL = 0.004, occ = new Set();
  for (let i = 0; i < n; i++) if (cls[i] === 0 && Math.abs(P[3 * i] - cx) < 0.006 * H && P[3 * i + 2] < zMid) occ.add(Math.floor((hy[i] * H) / SL));
  let kGap = null; for (let k = Math.floor((0.53 * H) / SL); k > Math.floor((0.40 * H) / SL); k--) if (!occ.has(k)) { kGap = k; break; }
  if (kGap === null) return 0;
  const hyCut = ((kGap + 1) * SL) / H - 0.002;
  // connected pieces of the surface below the cut
  const par = new Int32Array(n).fill(-1), find = (a) => { while (par[a] >= 0) a = par[a]; return a; };
  const below = (i) => cls[i] === 0 && hy[i] < hyCut;
  const uni = (a, b) => { a = find(a); b = find(b); if (a === b) return; if (par[a] > par[b]) [a, b] = [b, a]; par[a] += par[b]; par[b] = a; };
  for (let t3 = 0; t3 < I.length; t3 += 3) { const a = I[t3], b = I[t3 + 1], c = I[t3 + 2]; if (below(a) && below(b) && below(c)) { uni(a, b); uni(b, c); } }
  const comp = new Map();
  for (let i = 0; i < n; i++) if (below(i)) { const r = find(i); let c = comp.get(r); if (!c) comp.set(r, c = { size: 0, sx: 0, top: 0 }); c.size++; c.sx += P[3 * i]; if (hy[i] > c.top) c.top = hy[i]; }
  const legs = [...comp.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 2).map((e) => e[0]);
  // the level of the front surface just beside the middle (a ring 5.5 to 9 cm from the midline), per centimetre of height
  const ringZ = new Map(), bin = (h) => Math.round((h * H) / 0.01), side = new Map();
  for (let i = 0; i < n; i++) { if (cls[i] !== 0 || hy[i] < hyCut - 0.02 || hy[i] > 0.56) continue; const ax = Math.abs(P[3 * i] - cx), z = P[3 * i + 2]; if (ax > 0.03 * H && ax < 0.05 * H && z > zMid) { const k = bin(hy[i]); if (!ringZ.has(k)) ringZ.set(k, []); ringZ.get(k).push(z); } }
  for (const [k, zs] of ringZ) { zs.sort((p, q) => p - q); side.set(k, zs[Math.floor(zs.length * 0.5)]); }
  // blend the middle of the front smoothly into the surface around it: every vertex there takes the average
  // height (z) of its neighbours, repeated until the patch is a smooth membrane held by its edges
  const inC = new Uint8Array(n), C = [];
  for (let i = 0; i < n; i++) if (cls[i] === 0 && hy[i] >= hyCut - 0.012 && hy[i] <= 0.515 && Math.abs(P[3 * i] - cx) < 0.042 * H && P[3 * i + 2] > zMid) { inC[i] = 1; C.push(i); }
  const nbr = new Map(); for (const i of C) nbr.set(i, new Set());
  for (let t3 = 0; t3 < I.length; t3 += 3) { const a = I[t3], b = I[t3 + 1], c = I[t3 + 2]; if (inC[a]) { nbr.get(a).add(b); nbr.get(a).add(c); } if (inC[b]) { nbr.get(b).add(a); nbr.get(b).add(c); } if (inC[c]) { nbr.get(c).add(a); nbr.get(c).add(b); } }
  const old = new Map(); for (const i of C) old.set(i, [P[3 * i], P[3 * i + 1], P[3 * i + 2]]);
  const lists = C.map((i) => [i, [...nbr.get(i)]]);
  // nothing hangs below the line where the legs join: fold the middle of the front up to that line
  const yLift = y0 + (hyCut + 0.04) * H;
  for (const i of C) if (Math.abs(P[3 * i] - cx) < 0.032 * H && P[3 * i + 1] < yLift) P[3 * i + 1] = yLift - (yLift - P[3 * i + 1]) * 0.08;
  // first bring anything that sticks out down to the level of the surface beside it, then relax (over-relaxation, so it converges)
  for (const i of C) { const cap = side.get(bin(hy[i])) ?? side.get(bin(hy[i]) + 1) ?? side.get(bin(hy[i]) - 1); if (cap !== undefined && Math.abs(P[3 * i] - cx) < 0.03 * H && P[3 * i + 2] > cap) P[3 * i + 2] = cap; }
  for (let it = 0; it < 1500; it++) for (const [i, ns] of lists) { if (!ns.length) continue; let s = 0; for (const j of ns) s += P[3 * j + 2]; const z = P[3 * i + 2]; P[3 * i + 2] = z + 1.8 * (s / ns.length - z); }
  const moves = new Map(), key = (x, y, z) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
  for (const i of C) { const o3 = old.get(i); if (Math.abs(o3[2] - P[3 * i + 2]) > 1e-5 || Math.abs(o3[1] - P[3 * i + 1]) > 1e-5) moves.set(key(o3[0], o3[1], o3[2]), [P[3 * i], P[3 * i + 1], P[3 * i + 2]]); }
  if (!moves.size) return 0;
  const v = new THREE.Vector3();
  for (const m of skinMeshes) {
    m.updateMatrixWorld(true);
    const pos = m.geometry.attributes.position, mw = m.matrixWorld, inv = mw.clone().invert(); let touched = false;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mw); const to = moves.get(key(v.x, v.y, v.z)); if (!to) continue;
      v.set(to[0], to[1], to[2]).applyMatrix4(inv); pos.setXYZ(i, v.x, v.y, v.z); touched = true;
    }
    if (touched) { pos.needsUpdate = true; m.geometry.computeVertexNormals(); }
  }
  return moves.size;
}

// Clothes hang flat at the front of the hips, so the skin under them must lie flat there too, or it shows through
// the cloth. Between the legs (hy lo..hi, within 5% of the height of the midline) the body surface is kept a little
// behind the front of the thighs beside it, on the welded model (garments grow from it) and on the skin meshes.
export function flattenFront(body, skinMeshes, [lo, hi] = [0.39, 0.545], margin = 0.004) {
  const { P, n, H, cx, hy } = body, cap = new Map(), bin = (i) => Math.round((hy[i] * H) / 0.01);
  for (let i = 0; i < n; i++) {
    if (body.cls[i] !== 0 || hy[i] < lo - 0.01 || hy[i] > hi + 0.01) continue;
    const ax = Math.abs(P[3 * i] - cx);
    if (ax > 0.05 * H && ax < 0.09 * H) { const k = bin(i); cap.set(k, Math.max(cap.get(k) ?? -Infinity, P[3 * i + 2])); }
  }
  const moves = new Map(), key = (x, y, z) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
  // full strength up to 3.5 cm under the top of the band and within 3.5% of the height of the midline, fading to
  // nothing at the band's edges, so the surface has no step (a step shows as a dark crease in the cloth)
  const fade = (x, full, none) => (x <= full ? 1 : x >= none ? 0 : (none - x) / (none - full));
  for (let i = 0; i < n; i++) {
    const ax = Math.abs(P[3 * i] - cx);
    if (body.cls[i] !== 0 || hy[i] < lo || hy[i] > hi || ax >= 0.05 * H) continue;
    const c = cap.get(bin(i)); if (c === undefined || P[3 * i + 2] <= c - margin) continue;
    const w = fade(hy[i], hi - 0.035, hi) * fade(ax / H, 0.035, 0.05), z = P[3 * i + 2] - w * (P[3 * i + 2] - (c - margin));
    if (w <= 0) continue;
    moves.set(key(P[3 * i], P[3 * i + 1], P[3 * i + 2]), z); P[3 * i + 2] = z;
  }
  if (!moves.size) return 0;
  const v = new THREE.Vector3();
  for (const m of skinMeshes) {
    m.updateMatrixWorld(true);
    const pos = m.geometry.attributes.position, mw = m.matrixWorld, inv = mw.clone().invert(); let touched = false;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mw); const z = moves.get(key(v.x, v.y, v.z)); if (z === undefined) continue;
      v.z = z; v.applyMatrix4(inv); pos.setXYZ(i, v.x, v.y, v.z); touched = true;
    }
    if (touched) { pos.needsUpdate = true; m.geometry.computeVertexNormals(); }
  }
  return moves.size;
}

// cut a region, smooth it, offset it along its normals
export function garment(body, pick, { offset = 0.006, smooth = 6, color = 0x3f78c4, after = 2, name = 'garment', melt = 0, flatFront = null }) {
  const { P, I, n } = body, sel = new Int32Array(n).fill(-1);
  let m = 0; for (let i = 0; i < n; i++) if (pick(i)) sel[i] = m++;
  const tris = []; for (let t = 0; t < I.length; t += 3) { const a = sel[I[t]], b = sel[I[t + 1]], c = sel[I[t + 2]]; if (a >= 0 && b >= 0 && c >= 0) tris.push(a, b, c); }
  if (!tris.length) return null;
  const pos = new Float32Array(m * 3); for (let i = 0; i < n; i++) if (sel[i] >= 0) { const j = sel[i] * 3; pos[j] = P[3 * i]; pos[j + 1] = P[3 * i + 1]; pos[j + 2] = P[3 * i + 2]; }
  if (flatFront) {      // clothes hang flat at the front: between the legs the cloth lies no further forward than the thighs beside it
    const [lo, hi] = flatFront, { H, cx, hy } = body, side = new Map(), bin = (i) => Math.round((hy[i] * H) / 0.01);
    for (let i = 0; i < n; i++) {
      if (sel[i] < 0 || hy[i] < lo - 0.01 || hy[i] > hi + 0.01) continue;
      const ax = Math.abs(P[3 * i] - cx);
      if (ax > 0.05 * H && ax < 0.09 * H) { const k = bin(i); side.set(k, Math.max(side.get(k) ?? -Infinity, P[3 * i + 2])); }
    }
    for (let i = 0; i < n; i++) {
      if (sel[i] < 0 || hy[i] < lo || hy[i] > hi || Math.abs(P[3 * i] - cx) >= 0.05 * H) continue;
      const cap = side.get(bin(i)); const j = sel[i] * 3 + 2;
      if (cap !== undefined && pos[j] > cap) pos[j] = cap;
    }
  }
  // adjacency (CSR) inside the region
  const deg = new Uint32Array(m); for (let t = 0; t < tris.length; t += 3) { deg[tris[t]] += 2; deg[tris[t + 1]] += 2; deg[tris[t + 2]] += 2; }
  const off = new Uint32Array(m + 1); for (let i = 0; i < m; i++) off[i + 1] = off[i] + deg[i];
  const nb = new Uint32Array(off[m]), fill = off.slice(0, m);
  for (let t = 0; t < tris.length; t += 3) { const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]]; nb[fill[a]++] = b; nb[fill[a]++] = c; nb[fill[b]++] = a; nb[fill[b]++] = c; nb[fill[c]++] = a; nb[fill[c]++] = b; }
  const tmp = new Float32Array(m * 3);
  const step = (lam) => {
    for (let i = 0; i < m; i++) {
      const s = off[i], e = off[i + 1]; if (e === s) { tmp[3 * i] = pos[3 * i]; tmp[3 * i + 1] = pos[3 * i + 1]; tmp[3 * i + 2] = pos[3 * i + 2]; continue; }
      let ax = 0, ay = 0, az = 0; for (let k = s; k < e; k++) { const q = nb[k] * 3; ax += pos[q]; ay += pos[q + 1]; az += pos[q + 2]; }
      const c = e - s; tmp[3 * i] = pos[3 * i] + lam * (ax / c - pos[3 * i]); tmp[3 * i + 1] = pos[3 * i + 1] + lam * (ay / c - pos[3 * i + 1]); tmp[3 * i + 2] = pos[3 * i + 2] + lam * (az / c - pos[3 * i + 2]);
    }
    pos.set(tmp);
  };
  const taubin = (k) => { for (let it = 0; it < k; it++) { step(0.5); step(-0.53); } };
  for (let it = 0; it < melt; it++) step(0.5);     // plain smoothing: melts small features (nose, ears, folds) away
  taubin(smooth);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(tris); geo.computeVertexNormals();
  const N = geo.attributes.normal.array; for (let i = 0; i < pos.length; i++) pos[i] += N[i] * offset;
  taubin(after); geo.attributes.position.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere();
  // a small depth bias draws cloth in front of skin that lies on the same surface, so no skin flickers through it
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  const mesh = new THREE.Mesh(geo, mat); mesh.name = name; return mesh;
}

// scene outfits: what a person would wear there
export const OUTFITS = {
  cabin: { label: 'station clothes', top: { male: 0x56708f, female: 0x8f6670 }, sleeve: 'short', topOff: 0.006, bottom: { male: 0x3b4049, female: 0x3a4152 }, botOff: 0.008, feet: 0x22252b },
  field: { label: 'field jacket and boots', top: { male: 0x5e6250, female: 0x6a5e50 }, sleeve: 'long', topOff: 0.012, bottom: { male: 0x3d3b33, female: 0x3d3b33 }, botOff: 0.01, feet: 0x4a3f33, bootHy: 0.075 },
  cold: { label: 'expedition parka', top: { male: 0x9a4a3c, female: 0x9a4a3c }, sleeve: 'long', topOff: 0.03, topSmooth: 12, bottom: { male: 0x2c2f36, female: 0x2c2f36 }, botOff: 0.016, feet: 0x1b1d22, bootHy: 0.09, gloves: 0x1b1d22 },
  everyday: { label: 'everyday clothes', top: { male: 0x8ea7c2, female: 0xb98f86 }, sleeve: 'short', topOff: 0.006, bottom: { male: 0x34507a, female: 0x34507a }, botOff: 0.008, feet: 0xcfcfcf },
  flight: { label: 'flight overall', suit: { male: 0x2f4064, female: 0x2f4064 }, suitOff: 0.008, suitSmooth: 6, feet: 0x1f2329 },
  dive: { label: 'wetsuit', suit: { male: 0x1d2c33, female: 0x1d2c33 }, suitOff: 0.003, suitSmooth: 4, feet: 0x15191d },
  launch: { label: 'launch and entry suit', suit: { male: 0xd9d7cf, female: 0xd9d7cf }, suitOff: 0.016, suitSmooth: 10, feet: 0x9a978e, bootHy: 0.065, gloves: 0x3b4a66 },
  eva: { label: 'surface suit', suit: { male: 0xe9e7e1, female: 0xe9e7e1 }, suitOff: 0.02, suitSmooth: 10, feet: 0x8a877f, bootHy: 0.085, gloves: 0x8a877f, helmet: true },
};

export function dress(body, { outfit = 'cabin', sex = 'male' }) {
  const O = OUTFITS[outfit] || OUTFITS.cabin, out = [], { cls, hy } = body;
  const add = (g) => { if (g) out.push(g); };
  const isHand = (i) => cls[i] === 1 && hy[i] < 0.485;
  if (O.suit) {
    // the body under the suit is already flat at the front of the hips (flattenFront), so the suit follows it
    add(garment(body, (i) => cls[i] !== 2 && hy[i] < 0.86 && hy[i] >= (O.bootHy || 0.045) && !isHand(i), { offset: O.suitOff, smooth: O.suitSmooth, melt: 22, color: O.suit[sex], name: O.label }));
  } else {
    const shirt = (i) => cls[i] !== 2 && hy[i] < 0.86 && ((cls[i] === 0 && hy[i] >= 0.515) || (cls[i] === 1 && hy[i] >= (O.sleeve === 'long' ? 0.49 : 0.70)));
    add(garment(body, shirt, { offset: O.topOff, smooth: O.topSmooth || 7, color: O.top[sex], name: O.label }));
    add(garment(body, (i) => cls[i] === 0 && hy[i] < 0.54 && hy[i] >= (O.bootHy || 0.045), { offset: O.botOff + 0.01, smooth: 4, melt: 30, color: O.bottom[sex], name: 'trousers' }));
  }
  add(garment(body, (i) => cls[i] === 0 && hy[i] < (O.bootHy || 0.05), { offset: 0.007, smooth: 5, color: O.feet, name: 'shoes' }));
  if (O.gloves) add(garment(body, isHand, { offset: 0.006, smooth: 4, color: O.gloves, name: 'gloves' }));
  return { meshes: out, outfit: O };
}

// hair: a smoothed cap over the scalp (longer down the back for the female figure)
export function hair(body, { sex = 'male', headCentre }) {
  const { P, cls, hy } = body;
  // the top of the head, and the back and sides down to the neck; never the face
  return garment(body, (i) => cls[i] === 2 && (hy[i] > 0.972 || (P[3 * i + 2] < headCentre.z + 0.012 && hy[i] > (sex === 'female' ? 0.87 : 0.925))), { offset: sex === 'female' ? 0.012 : 0.008, smooth: 6, melt: 10, color: sex === 'female' ? 0x3a2c26 : 0x2b2420, name: 'hair' });
}

// a smooth, featureless head over the real face (no eyes, nose or mouth): a calm mannequin-like head
export function faceShell(body, { color }) {
  const { cls } = body;
  return garment(body, (i) => cls[i] === 2, { offset: 0.006, smooth: 4, melt: 70, after: 4, color, name: 'head' });
}

// a clear helmet bubble for the surface suit; nothing else is added (no backpack or visor is drawn, because their
// real dimensions are not in an open source)
export function evaExtras({ headCentre, headH }) {
  const g = new THREE.Group();
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(headH * 0.68, 48, 32), new THREE.MeshStandardMaterial({ color: 0xe8f4ff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.12, depthWrite: false }));
  bubble.position.copy(headCentre); g.add(bubble);
  return g;
}

// which outfit and backdrop suit a location id: the look of its area (ui/areas.js)
export function sceneFor(id = 'iss') { return lookOf(String(id)); }
