// Cell level, brain (OPM): a real human neocortical layer 2/3 pyramidal neuron, NeuroMorpho.Org 107146
// (Tamas archive, Fig1b_140312-1rm6_pyr; Molnar et al., eLife 2016). Every coordinate and radius is the reconstruction's own, in micrometres.
// The only change is a rotation that turns the apical dendrite upward. Impulse timing is illustrative (no sourced velocity).
import * as THREE from 'three';

const UM = 'µm';
export const DATA = ['bio/neuron_107146', 'bio/cells'];
export const LEVEL = { id: 'cell_neuron', site: 'brain', level: 'cell', title: 'Human cortical pyramidal neuron', unit: UM, scaleBar: { length: 100, label: `100 ${UM}` } };

const COL = { apical: '#a9d48c', basal: '#e1e5d6', axon: '#8e9684', soma: '#e1e5d6' };
const IMP = { dend: '#a9d48c', axon: '#e1e5d6' };
const SPEED = 350;         // marker speed in um per animation second: a display choice (illustrative timing), not a conduction velocity
const N_DEND = 48, N_AXON = 36;

function rng(seed) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle(a, r) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const srgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const num = (v) => (v && typeof v.value === 'number' ? v.value : null);
const fmt = (x, d = 0) => Number(x).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

// round, constant-pixel-size markers (no textures): circle drawn in the fragment shader
function markerMaterial(px) {
  return new THREE.ShaderMaterial({
    uniforms: { uSize: { value: px * Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1) } },
    vertexShader: 'attribute vec3 aColor; varying vec3 vColor; uniform float uSize;\nvoid main(){ vColor = aColor; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uSize; }',
    fragmentShader: 'varying vec3 vColor;\nvoid main(){ float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard; float a = 1.0 - smoothstep(0.05, 0.5, r); gl_FragColor = vec4(vColor * a, 1.0); }',
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true,
  });
}

function emptyScene(scene, msg) {
  return { scene, camera: { position: [0, 0, 600], target: [0, 0, 0], fov: 40 }, labels: [],
    info: { title: 'Neuron reconstruction not loaded', lines: [msg], sources: [], lean: [] }, readouts: [], update() {}, dispose() {} };
}

export function build(D) {
  const N = D['bio/neuron_107146'];
  const cells = D['bio/cells'];
  const scene = new THREE.Scene();
  scene.background = null;
  scene.add(new THREE.HemisphereLight(0xe1e5d6, 0x1c1f19, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(0.5, 1, 0.8); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-0.6, -0.4, -0.7); scene.add(fill);
  if (!N?.samples?.length) return emptyScene(scene, 'data/bio/neuron_107146.json did not load; run scripts/build_bio.py.');

  // ---- samples, parent links, and the display rotation (apical axis -> +Y, soma at the origin)
  const S = N.samples, n = S.length;
  const index = new Map(S.map((s, i) => [s[0], i]));
  const par = new Int32Array(n), typ = new Uint8Array(n), rad = new Float32Array(n), P = new Float32Array(n * 3);
  const soma = new THREE.Vector3(...N.soma_um);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...N.apical_axis).normalize(), new THREE.Vector3(0, 1, 0));
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const s = S[i];
    typ[i] = s[1]; rad[i] = s[5]; par[i] = s[6] === -1 ? -1 : (index.get(s[6]) ?? -1);
    v.set(s[2], s[3], s[4]).sub(soma).applyQuaternion(q);
    P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
  }
  const segs = [];
  for (let i = 0; i < n; i++) if (par[i] >= 0 && typ[i] !== 1) segs.push(i);
  const typeCol = { 2: new THREE.Color(COL.axon), 3: new THREE.Color(COL.basal), 4: new THREE.Color(COL.apical) };

  // ---- tubes at the reconstructed radius (one merged geometry; 6-sided frustum per SWC segment)
  const R = 6;
  const pos = new Float32Array(segs.length * 2 * R * 3), nor = new Float32Array(pos.length), col = new Float32Array(pos.length);
  const idx = new Uint32Array(segs.length * R * 6);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), u = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), w = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0), XA = new THREE.Vector3(1, 0, 0);
  let vp = 0, ip = 0;
  for (const i of segs) {
    const p = par[i];
    a.fromArray(P, p * 3); b.fromArray(P, i * 3);
    u.subVectors(b, a); const len = u.length(); if (len < 1e-6) continue;
    u.divideScalar(len);
    e1.crossVectors(u, Math.abs(u.y) < 0.9 ? UP : XA).normalize(); e2.crossVectors(u, e1);
    const ra = typ[p] === 1 ? rad[i] : rad[p], rb = rad[i];        // a segment leaving the soma keeps its own radius
    const c = typeCol[typ[i]] || typeCol[3];
    const base = vp / 3;
    for (let k = 0; k < R; k++) {
      const ang = (k / R) * Math.PI * 2;
      w.copy(e1).multiplyScalar(Math.cos(ang)).addScaledVector(e2, Math.sin(ang));
      for (const [o, r0] of [[a, ra], [b, rb]]) {
        pos[vp] = o.x + w.x * r0; pos[vp + 1] = o.y + w.y * r0; pos[vp + 2] = o.z + w.z * r0;
        nor[vp] = w.x; nor[vp + 1] = w.y; nor[vp + 2] = w.z;
        col[vp] = c.r; col[vp + 1] = c.g; col[vp + 2] = c.b; vp += 3;
      }
    }
    for (let k = 0; k < R; k++) {
      const a0 = base + 2 * k, b0 = a0 + 1, a1 = base + 2 * ((k + 1) % R), b1 = a1 + 1;
      idx[ip++] = a0; idx[ip++] = b1; idx[ip++] = b0;
      idx[ip++] = a0; idx[ip++] = a1; idx[ip++] = b1;
    }
  }
  const tubeGeo = new THREE.BufferGeometry();
  tubeGeo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, vp), 3));
  tubeGeo.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, vp), 3));
  tubeGeo.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, vp), 3));
  tubeGeo.setIndex(new THREE.BufferAttribute(idx.subarray(0, ip), 1));
  tubeGeo.computeBoundingSphere();
  scene.add(new THREE.Mesh(tubeGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.02 })));

  // ---- 1-pixel lines along the same branches, so sub-micrometre axons stay visible when zoomed out
  const lp = new Float32Array(segs.length * 6), lc = new Float32Array(segs.length * 6);
  segs.forEach((i, k) => {
    const p = par[i], c = typeCol[typ[i]] || typeCol[3];
    lp.set([P[p * 3], P[p * 3 + 1], P[p * 3 + 2], P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], k * 6);
    lc.set([c.r, c.g, c.b, c.r, c.g, c.b], k * 6);
  });
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  lineGeo.setAttribute('color', new THREE.BufferAttribute(lc, 3));
  scene.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false })));

  // ---- soma: the SWC's three-point soma radius
  const somaR = N.soma_radius_um || rad[0];
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(somaR, 36, 24), new THREE.MeshStandardMaterial({ color: COL.soma, roughness: 0.5 })));

  // ---- impulse markers along real paths: dendrite tips -> soma, soma -> axon tips (illustrative timing)
  const kids = new Uint16Array(n);
  for (let i = 0; i < n; i++) if (par[i] >= 0) kids[par[i]]++;
  const tipsD = [], tipsA = [];
  for (let i = 0; i < n; i++) if (!kids[i]) { if (typ[i] === 3 || typ[i] === 4) tipsD.push(i); else if (typ[i] === 2) tipsA.push(i); }
  const rand = rng(107146);
  shuffle(tipsD, rand); shuffle(tipsA, rand);
  const pathToSoma = (tip) => { const out = []; let i = tip; while (i >= 0 && typ[i] !== 1) { out.push(i); i = par[i]; } if (i >= 0) out.push(i); return out; };
  const imps = [];
  const mk = (path, axon) => {
    const L = new Float32Array(path.length);
    for (let k = 1; k < path.length; k++) { const i = path[k] * 3, j = path[k - 1] * 3; L[k] = L[k - 1] + Math.hypot(P[i] - P[j], P[i + 1] - P[j + 1], P[i + 2] - P[j + 2]); }
    imps.push({ path, L, total: L[path.length - 1], axon, offset: rand() * 8, pause: 0.4 + rand() * 1.6 });
  };
  tipsD.slice(0, N_DEND).forEach((t) => mk(pathToSoma(t), false));
  tipsA.slice(0, N_AXON).forEach((t) => mk(pathToSoma(t).reverse(), true));
  const ipos = new Float32Array(imps.length * 3), icol = new Float32Array(imps.length * 3);
  const impGeo = new THREE.BufferGeometry();
  impGeo.setAttribute('position', new THREE.BufferAttribute(ipos, 3));
  impGeo.setAttribute('aColor', new THREE.BufferAttribute(icol, 3));
  const impPts = new THREE.Points(impGeo, markerMaterial(7));
  impPts.frustumCulled = false;
  scene.add(impPts);
  const cD = srgb(IMP.dend), cA = srgb(IMP.axon);

  // ---- labels at real samples (the sample nearest each compartment's centroid)
  const nearestTo = (t) => {
    let cx = 0, cy = 0, cz = 0, m = 0;
    for (let i = 0; i < n; i++) if (typ[i] === t) { cx += P[i * 3]; cy += P[i * 3 + 1]; cz += P[i * 3 + 2]; m++; }
    if (!m) return null;
    cx /= m; cy /= m; cz /= m;
    let best = -1, bd = Infinity;
    for (let i = 0; i < n; i++) if (typ[i] === t) { const d = (P[i * 3] - cx) ** 2 + (P[i * 3 + 1] - cy) ** 2 + (P[i * 3 + 2] - cz) ** 2; if (d < bd) { bd = d; best = i; } }
    return [P[best * 3], P[best * 3 + 1], P[best * 3 + 2]];
  };
  const labels = [{ position: [0, 0, 0], text: `Soma (radius ${fmt(somaR, 1)} ${UM})` }];
  const la = nearestTo(4), lb = nearestTo(3), lx = nearestTo(2);
  if (la) labels.push({ position: la, text: 'Apical dendrite' });
  if (lb) labels.push({ position: lb, text: 'Basal dendrites' });
  if (lx) labels.push({ position: lx, text: 'Axon' });

  // ---- camera: frame the whole cell around the soma
  let maxR = 0;
  for (let i = 0; i < n; i++) maxR = Math.max(maxR, Math.hypot(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
  const dist = (maxR / Math.tan(THREE.MathUtils.degToRad(20))) * 0.8;
  const cdir = new THREE.Vector3(0.2, 0.14, 1).normalize().multiplyScalar(dist);

  // ---- text
  const lens = N.length_um_by_type || {}, mor = N.morphometry_neuromorpho || {};
  const ref = N.reference || {};
  const meg = cells?.neuron?.meg_source;
  const src = `NeuroMorpho.Org ${N.neuromorpho_id}`;
  const info = {
    title: `Human cortical pyramidal neuron · NeuroMorpho.Org ${N.neuromorpho_id}`,
    lines: [
      `A real reconstruction: ${(N.cell_type || []).filter((x) => x !== 'principal cell').join(', ')} cell, ${(N.brain_region || []).join(', ')}, adult human tissue (${N.protocol}); ${N.stain}-filled and traced in ${N.reconstruction_software}. ${N.archive} archive, ${N.neuron_name}${ref.doi ? `, doi:${ref.doi}` : ''}. NeuroMorpho.Org integrity: “${N.physical_integrity}”.`,
      `${fmt(N.n_samples)} SWC samples drawn as tubes at their reconstructed radius, plus 1-pixel lines on the same branches so the thin axon stays visible when zoomed out. Soma radius ${fmt(somaR, 2)} ${UM}. Shrinkage: ${N.shrinkage_reported || 'not reported'}, not corrected.`,
      'Colours: apical dendrite green, basal dendrites light, axon grey. The cell is turned so its apical dendrite points up (calculated mean apical direction); no coordinate is changed otherwise.',
      `Moving dots: inputs travelling along real dendritic paths to the soma (green) and spikes leaving along real axon paths (light). Illustrative timing: no sourced conduction velocity is used (${SPEED} ${UM} per second on screen), and the dots are markers, not to scale.`,
      meg?.value ? `Why the OPM sees this: MEG/EEG primary currents are “${meg.value.split(': ')[1] || meg.value}” (Neymotin et al. 2020). The OPM over the head reads the summed field of many such cells.` : 'The OPM over the head reads the summed magnetic field of many such cells.',
    ],
    sources: [
      ref.citation || `PubMed ${ref.pmid}`,
      `${N.citation_resource}, neuron ${N.neuromorpho_id} (${N.neuron_name}), CC BY 4.0`,
      N.citation_neuromorpho,
      meg?.source,
    ].filter(Boolean),
    lean: [],
  };
  const readouts = [
    { label: 'SWC samples', value: N.n_samples, unit: '', tag: 'recorded', source: src },
    { label: 'Total length', value: Math.round(N.length_um_total), unit: UM, tag: 'calculated', source: 'from the samples' },
    { label: 'Apical / basal / axon', value: `${fmt(lens['apical dendrite'] || 0)} / ${fmt(lens['basal dendrite'] || 0)} / ${fmt(lens.axon || 0)}`, unit: UM, tag: 'calculated', source: 'from the samples' },
    { label: 'Soma radius', value: somaR, unit: UM, tag: 'recorded', source: src },
    { label: 'Branch points', value: N.bifurcations, unit: '', tag: 'calculated', source: 'from the parent links' },
    { label: 'Width × height × depth', value: `${fmt(mor.width || 0)} × ${fmt(mor.height || 0)} × ${fmt(mor.depth || 0)}`, unit: UM, tag: 'recorded', source: 'NeuroMorpho.Org morphometry' },
    { label: 'Impulse timing', value: 'illustrative', unit: '', tag: 'no sourced velocity', source: 'display only' },
  ];

  return {
    scene,
    camera: { position: [cdir.x, cdir.y, cdir.z], target: [0, 0, 0], fov: 40 },
    labels, info, readouts,
    update(dt, t) {
      for (let m = 0; m < imps.length; m++) {
        const it = imps[m], period = it.total / SPEED + it.pause;
        const s = ((t + it.offset) % period) * SPEED;
        if (s > it.total || it.total <= 0) { icol[m * 3] = icol[m * 3 + 1] = icol[m * 3 + 2] = 0; continue; }
        let lo = 0, hi = it.L.length - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (it.L[mid] <= s) lo = mid; else hi = mid; }
        const f = (s - it.L[lo]) / ((it.L[hi] - it.L[lo]) || 1), i = it.path[lo] * 3, j = it.path[hi] * 3;
        ipos[m * 3] = P[i] + (P[j] - P[i]) * f; ipos[m * 3 + 1] = P[i + 1] + (P[j + 1] - P[i + 1]) * f; ipos[m * 3 + 2] = P[i + 2] + (P[j + 2] - P[i + 2]) * f;
        const edge = Math.min(1, s / 40, (it.total - s) / 40), c = it.axon ? cA : cD;   // fade in and out over 40 um of path
        icol[m * 3] = c[0] * edge; icol[m * 3 + 1] = c[1] * edge; icol[m * 3 + 2] = c[2] * edge;
      }
      impGeo.attributes.position.needsUpdate = true;
      impGeo.attributes.aColor.needsUpdate = true;
    },
    dispose() {
      scene.traverse((o) => { o.geometry?.dispose?.(); const mt = o.material; (Array.isArray(mt) ? mt : mt ? [mt] : []).forEach((x) => x.dispose?.()); });
    },
  };
}
