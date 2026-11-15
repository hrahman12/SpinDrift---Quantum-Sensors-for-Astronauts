// Real-person figure: the Human Reference Atlas body surface, slimmed and dressed for each scene.
// Garments are grown from the body itself: the skin is welded, each vertex is classed (head, arm, torso/legs) from
// the body's own shape, a region is cut out, smoothed (Taubin) so no anatomy shows, and pushed out along its normals.
// Joint heights for sleeves and hems use Drillis & Contini (1966) proportions (elbow 0.630 H, wrist 0.485 H,
// hip 0.530 H, ankle 0.039 H). Garment thickness, colours, the helmet and the backpack are a drawing choice.
import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// thinner figure: torso and limbs narrowed about the body axis, the head kept as is, a smooth blend at the neck
export function slimTransform({ H, y0, cx = 0, cz = 0, s = 0.85 }) {
  return (v) => {
    const hy = (v.y - y0) / H, k = hy < 0.80 ? s : hy > 0.88 ? 1 : s + (1 - s) * ((hy - 0.80) / 0.08);
    v.x = cx + (v.x - cx) * k; v.z = cz + (v.z - cz) * k; return v;
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

// cut a region, smooth it, offset it along its normals
export function garment(body, pick, { offset = 0.006, smooth = 6, color = 0x3f78c4, after = 2, name = 'garment' }) {
  const { P, I, n } = body, sel = new Int32Array(n).fill(-1);
  let m = 0; for (let i = 0; i < n; i++) if (pick(i)) sel[i] = m++;
  const tris = []; for (let t = 0; t < I.length; t += 3) { const a = sel[I[t]], b = sel[I[t + 1]], c = sel[I[t + 2]]; if (a >= 0 && b >= 0 && c >= 0) tris.push(a, b, c); }
  if (!tris.length) return null;
  const pos = new Float32Array(m * 3); for (let i = 0; i < n; i++) if (sel[i] >= 0) { const j = sel[i] * 3; pos[j] = P[3 * i]; pos[j + 1] = P[3 * i + 1]; pos[j + 2] = P[3 * i + 2]; }
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
  taubin(smooth);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(tris); geo.computeVertexNormals();
  const N = geo.attributes.normal.array; for (let i = 0; i < pos.length; i++) pos[i] += N[i] * offset;
  taubin(after); geo.attributes.position.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere();
  const mat = new THREE.MeshLambertMaterial({ color });
  const mesh = new THREE.Mesh(geo, mat); mesh.name = name; return mesh;
}

// scene outfits: what a person would wear there
export const OUTFITS = {
  cabin: { label: 'station clothes', top: { male: 0x3f78c4, female: 0xd9645a }, sleeve: 'short', topOff: 0.006, bottom: { male: 0x5b5446, female: 0x34466e }, botOff: 0.008, feet: 0x2a2a28 },
  field: { label: 'field jacket and boots', top: { male: 0x7c7a4a, female: 0x8a6a4a }, sleeve: 'long', topOff: 0.012, bottom: { male: 0x4b4a3e, female: 0x4b4a3e }, botOff: 0.01, feet: 0x5a4632, bootHy: 0.075 },
  cold: { label: 'expedition parka', top: { male: 0xd8432f, female: 0xd8432f }, sleeve: 'long', topOff: 0.03, topSmooth: 12, bottom: { male: 0x2c2c33, female: 0x2c2c33 }, botOff: 0.016, feet: 0x1d1d1b, bootHy: 0.09, gloves: 0x1d1d1b },
  dive: { label: 'wetsuit', suit: { male: 0x1f3b44, female: 0x1f3b44 }, suitOff: 0.003, suitSmooth: 4, feet: 0x1d1d1b },
  launch: { label: 'launch and entry suit', suit: { male: 0xece8dc, female: 0xece8dc }, suitOff: 0.016, suitSmooth: 10, feet: 0xb9b5a8, bootHy: 0.065, gloves: 0x34466e },
  eva: { label: 'EVA suit', suit: { male: 0xf2f0ea, female: 0xf2f0ea }, suitOff: 0.045, suitSmooth: 14, feet: 0x8e8b82, bootHy: 0.085, gloves: 0x8e8b82, helmet: true, pack: true },
};

export function dress(body, { outfit = 'cabin', sex = 'male' }) {
  const O = OUTFITS[outfit] || OUTFITS.cabin, out = [], { cls, hy } = body;
  const add = (g) => { if (g) out.push(g); };
  const isHand = (i) => cls[i] === 1 && hy[i] < 0.485;
  if (O.suit) {
    add(garment(body, (i) => cls[i] !== 2 && hy[i] < 0.86 && hy[i] >= (O.bootHy || 0.045) && !isHand(i), { offset: O.suitOff, smooth: O.suitSmooth, color: O.suit[sex], name: O.label }));
  } else {
    const shirt = (i) => cls[i] !== 2 && hy[i] < 0.86 && ((cls[i] === 0 && hy[i] >= 0.515) || (cls[i] === 1 && hy[i] >= (O.sleeve === 'long' ? 0.49 : 0.63)));
    add(garment(body, shirt, { offset: O.topOff, smooth: O.topSmooth || 7, color: O.top[sex], name: O.label }));
    add(garment(body, (i) => cls[i] === 0 && hy[i] < 0.54 && hy[i] >= (O.bootHy || 0.045), { offset: O.botOff, smooth: 10, color: O.bottom[sex], name: 'trousers' }));
  }
  add(garment(body, (i) => cls[i] === 0 && hy[i] < (O.bootHy || 0.05), { offset: 0.007, smooth: 5, color: O.feet, name: 'shoes' }));
  if (O.gloves) add(garment(body, isHand, { offset: 0.006, smooth: 4, color: O.gloves, name: 'gloves' }));
  return { meshes: out, outfit: O };
}

// hair: a smoothed cap over the scalp (longer down the back for the female figure)
export function hair(body, { sex = 'male', headCentre }) {
  const { P, cls, hy } = body;
  return garment(body, (i) => cls[i] === 2 && (hy[i] > 0.935 || (P[3 * i + 2] < headCentre.z - 0.02 && hy[i] > (sex === 'female' ? 0.86 : 0.905))), { offset: sex === 'female' ? 0.011 : 0.007, smooth: 6, color: sex === 'female' ? 0x5a3424 : 0x3b2a20, name: 'hair' });
}

// helmet and life-support backpack for the EVA suit (sizes are a drawing choice)
export function evaExtras({ headCentre, headH, chestY, backZ }) {
  const g = new THREE.Group();
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(headH * 0.68, 40, 28), new THREE.MeshLambertMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.22, depthWrite: false }));
  bubble.position.copy(headCentre); bubble.material.userData.outlineParameters = { thickness: 0.003, color: [0.11, 0.11, 0.1], alpha: 1 }; g.add(bubble);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(headH * 0.685, 40, 20, -Math.PI * 0.32, Math.PI * 0.64, Math.PI * 0.28, Math.PI * 0.32), new THREE.MeshLambertMaterial({ color: 0xe0a83a, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
  visor.position.copy(headCentre); visor.rotation.y = Math.PI / 2 * 0; g.add(visor);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.56, 0.2), new THREE.MeshLambertMaterial({ color: 0xe6e3da }));
  pack.position.set(headCentre.x, chestY, backZ - 0.1); g.add(pack);
  return g;
}

// which outfit and backdrop suit a location id (sub-place ids from data/locations.json, plus the five older ids)
export function sceneFor(id = 'iss') {
  const s = String(id);
  if (/^(moon_south_pole|lunar_anomalies)\b/.test(s) || s === 'lunar_base') return { outfit: 'eva', backdrop: 'lunar' };
  if (/^mars_surface\b/.test(s)) return { outfit: 'eva', backdrop: 'mars' };
  if (s === 'earth_analog.concordia') return { outfit: 'cold', backdrop: 'antarctic' };
  if (s === 'earth_analog.haughton') return { outfit: 'field', backdrop: 'arctic' };
  if (s === 'earth_analog.mdrs') return { outfit: 'field', backdrop: 'desert' };
  if (s === 'earth_analog.aquarius') return { outfit: 'dive', backdrop: 'ocean' };
  if (s === 'earth_flight.baikonur') return { outfit: 'launch', backdrop: 'steppe' };
  if (s === 'earth_flight.i4_splashdown') return { outfit: 'launch', backdrop: 'ocean' };
  if (/^earth_(flight|analog)\b/.test(s)) return { outfit: 'cabin', backdrop: 'earth' };
  if (/^(gateway|mars_transit)\b/.test(s)) return { outfit: 'cabin', backdrop: 'deep_space' };
  return { outfit: 'cabin', backdrop: 'orbit' };
}
