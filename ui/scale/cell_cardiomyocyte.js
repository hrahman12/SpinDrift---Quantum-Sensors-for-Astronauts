// Cell level, heart (NV + OPM): a human left-ventricular cardiomyocyte drawn only with sourced dimensions from
// data/bio/cells.json: length (Gerdes et al. 1992), width (calculated from Gerdes' length/width ratio), thickness
// (maximum inscribed circle of transverse profiles, Manandhar et al. 2026) and sarcomere length (Ohler et al. 2009).
// Scene units: micrometres. The depolarisation sweep uses illustrative timing (no sourced conduction velocity).
import * as THREE from 'three';

const UM = 'µm';
export const DATA = ['bio/cells'];
export const LEVEL = { id: 'cell_cardiomyocyte', site: 'heart', level: 'cell', title: 'Human ventricular cardiomyocyte', unit: UM, scaleBar: { length: 20, label: `20 ${UM}` } };

const C = { ink: '#e1e5d6', muted: '#8e9684', accent: '#a9d48c', dark: '#5c6552' };
const SWEEP_S = 2.4, PAUSE_S = 1.2;      // illustrative timing of the excitation sweep (display only)

const num = (v) => (v && typeof v.value === 'number' ? v.value : null);
const fmt = (x, d = 1) => Number(x).toLocaleString('en-US', { maximumFractionDigits: d });
const short = (v) => {   // "Gerdes et al." from the citation the build script wrote
  const head = (v?.source || '').split('. ')[0], first = head.split(/[ ,]/)[0];
  return first ? `${first}${head.split(',').length > 2 || /et al/.test(head) ? ' et al.' : ''}` : '';
};
const tagOf = (v) => (!v ? '' : v.status === 'VERIFIED' ? v.tag : `${v.tag}, ${String(v.status).toLowerCase().replace(/_/g, ' ')}`);
const yearOf = (v) => ((v?.source || '').match(/\b(19|20)\d{2}\b/) || [''])[0];

function ellipse(rx, ry, nSeg) {
  const pts = [];
  for (let k = 0; k <= nSeg; k++) { const a = (k / nSeg) * Math.PI * 2; pts.push([Math.cos(a) * rx, Math.sin(a) * ry]); }
  return pts;
}

export function build(D) {
  const cm = D['bio/cells']?.cardiomyocyte;
  const scene = new THREE.Scene();
  scene.background = null;
  scene.add(new THREE.HemisphereLight(0xe1e5d6, 0x1c1f19, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(0.4, 1, 0.7); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.4); fill.position.set(-0.5, -0.3, -0.8); scene.add(fill);

  const L = num(cm?.length), W = num(cm?.width), T = num(cm?.thickness), SL = num(cm?.sarcomere_length);
  if (!L || !W) {
    return { scene, camera: { position: [0, 0, 200], target: [0, 0, 0], fov: 40 }, labels: [], readouts: [],
      info: { title: 'Cardiomyocyte dimensions not loaded', lines: ['data/bio/cells.json lacks a sourced length or width; nothing is drawn. Run scripts/build_bio.py.'], sources: [], lean: [] },
      update() {}, dispose() {} };
  }
  const thick = T || 0;               // without a sourced thickness the cell would be drawn flat (and the text says so)
  const ry = Math.max(thick, 1e-3) / 2, rz = W / 2;   // y = thickness (vertical), z = width, x = long axis

  // ---- cell body: an elliptic cylinder of the sourced length, width and thickness
  const bodyGeo = new THREE.CylinderGeometry(1, 1, L, 96, 1, true);
  bodyGeo.rotateZ(Math.PI / 2);
  bodyGeo.scale(1, ry, rz);
  const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color: C.ink, transparent: true, opacity: 0.16, roughness: 0.7, side: THREE.DoubleSide, depthWrite: false }));
  body.renderOrder = 2;
  scene.add(body);
  // outline rings at the ends and along the top/bottom edges
  const ring = ellipse(ry, rz, 96);
  const outline = [];
  for (const x of [-L / 2, L / 2]) for (let k = 0; k < ring.length - 1; k++) outline.push(x, ring[k][0], ring[k][1], x, ring[k + 1][0], ring[k + 1][1]);
  for (const [y, z] of [[0, rz], [0, -rz], [ry, 0], [-ry, 0]]) outline.push(-L / 2, y, z, L / 2, y, z);
  const olGeo = new THREE.BufferGeometry(); olGeo.setAttribute('position', new THREE.Float32BufferAttribute(outline, 3));
  scene.add(new THREE.LineSegments(olGeo, new THREE.LineBasicMaterial({ color: C.ink, transparent: true, opacity: 0.55 })));

  // ---- intercalated discs at both ends (where UniProt places Nav1.5, among other sites)
  const discGeo = new THREE.CircleGeometry(1, 72);
  discGeo.rotateY(Math.PI / 2);
  discGeo.scale(1, ry, rz);
  const discMat = new THREE.MeshStandardMaterial({ color: C.accent, emissive: C.accent, emissiveIntensity: 0.25, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  for (const x of [-L / 2, L / 2]) { const d = new THREE.Mesh(discGeo, discMat); d.position.x = x; d.renderOrder = 3; scene.add(d); }

  // ---- Z-lines every sourced sarcomere length, counted from one end
  const zx = [];
  if (SL) for (let x = -L / 2; x <= L / 2 + 1e-6; x += SL) zx.push(x);
  const zring = ellipse(ry * 0.97, rz * 0.97, 48);
  const zp = new Float32Array(zx.length * 48 * 6), zc = new Float32Array(zp.length);
  zx.forEach((x, i) => { for (let k = 0; k < 48; k++) zp.set([x, zring[k][0], zring[k][1], x, zring[k + 1][0], zring[k + 1][1]], (i * 48 + k) * 6); });
  const zGeo = new THREE.BufferGeometry();
  zGeo.setAttribute('position', new THREE.BufferAttribute(zp, 3));
  zGeo.setAttribute('color', new THREE.BufferAttribute(zc, 3));
  scene.add(new THREE.LineSegments(zGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 })));
  const zBase = new THREE.Color(C.muted), zLit = new THREE.Color(C.accent);
  for (let v = 0; v < zc.length; v += 3) { zc[v] = zBase.r; zc[v + 1] = zBase.g; zc[v + 2] = zBase.b; }

  // ---- depolarisation front (illustrative timing)
  const front = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: C.accent, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  front.scale.setScalar(0.98); front.renderOrder = 4;
  scene.add(front);

  // ---- labels (scene coordinates, micrometres)
  const nZ = zx.length;
  const labels = [
    { position: [0, ry + 3, 0], text: `Cardiomyocyte · ${fmt(L, 0)} ${UM} long` },
    { position: [L / 2, 0, rz], text: 'Intercalated disc · Nav1.5 site' },
    { position: [0, 0, rz + 1], text: `${fmt(W)} ${UM} wide (calculated)` },
  ];
  if (T) labels.push({ position: [-L / 2, -ry, 0], text: `${fmt(T)} ${UM} thick` });
  if (SL && nZ > 12) labels.push({ position: [zx[10], ry, 0], text: `Z-lines every ${SL} ${UM}` });

  // ---- text
  const nav = cm.nav15_location?.value || '';
  const info = {
    title: 'Human ventricular cardiomyocyte, sourced dimensions only',
    lines: [
      `Length ${fmt(L, 0)} ${UM}: left-ventricular myocytes isolated from nonfailing donor hearts (Gerdes et al. 1992). Width ${fmt(W)} ${UM} is calculated from that length and the reported length/width ratio ${num(cm.length_width_ratio)}.`,
      T ? `Thickness ${fmt(T)} ${UM}: the maximum inscribed circle of transverse cell profiles in 202 non-failing donor left ventricles (Manandhar et al. 2026), used as the cell's smaller cross-section dimension. Fixed tissue; a different study from the length.`
        : 'No sourced thickness loaded, so the cell is drawn flat.',
      SL ? `Z-lines every ${SL} ${UM}: resting sarcomere length of non-failing human ventricular myocytes (Ohler et al. 2009); about ${fmt(num(cm.sarcomeres_along_length) || L / SL, 0)} sarcomeres along the cell (calculated).` : 'No sourced sarcomere length loaded; Z-lines are not drawn.',
      'Shape: an elliptic cylinder with the sourced length, width and thickness. Real cells have stepped, branched ends; nuclei, mitochondria, T-tubules and myofibrils are not drawn because no sourced dimensions are used for them.',
      nav ? `Nav1.5 (next level), UniProt Q14524 locations: ${nav.split('. ')[0]}; UniProt also notes it colocalises with partner proteins at intercalated discs.` : 'Nav1.5 sits in the cell membrane (UniProt Q14524).',
      'The green band is the depolarisation front that Nav1.5 starts. Illustrative timing: no sourced conduction velocity is used.',
      'The NV-diamond and OPM sensors read the heart’s magnetic field, the sum over many such cells; one cell is far smaller than either sensor.',
    ],
    sources: [cm.length?.source, cm.thickness?.source, cm.sarcomere_length?.source, cm.nav15_location?.source].filter(Boolean),
    lean: [],
  };
  const readouts = [
    { label: 'Length', value: L, unit: UM, tag: tagOf(cm.length), source: `${short(cm.length)} ${yearOf(cm.length)}` },
    { label: 'Width', value: W, unit: UM, tag: tagOf(cm.width), source: 'length ÷ length/width ratio' },
    { label: 'Thickness', value: T ?? 'not sourced', unit: T ? UM : '', tag: tagOf(cm.thickness), source: `${short(cm.thickness)} ${yearOf(cm.thickness)}` },
    { label: 'Sarcomere length', value: SL ?? 'not sourced', unit: SL ? UM : '', tag: tagOf(cm.sarcomere_length), source: `${short(cm.sarcomere_length)} ${yearOf(cm.sarcomere_length)}` },
    { label: 'Sarcomeres along the cell', value: num(cm.sarcomeres_along_length) ?? '-', unit: '', tag: 'calculated', source: 'length ÷ sarcomere length' },
    { label: 'Excitation sweep', value: 'illustrative', unit: '', tag: 'no sourced velocity', source: 'display only' },
  ];

  return {
    scene,
    camera: { position: [-62, 78, 188], target: [0, 0, 0], fov: 40 },
    labels, info, readouts,
    update(dt, t) {
      const ph = t % (SWEEP_S + PAUSE_S), on = ph < SWEEP_S;
      const x = -L / 2 + (ph / SWEEP_S) * L;
      front.visible = on;
      front.position.x = x;
      for (let i = 0; i < nZ; i++) {
        const d = on ? Math.abs(zx[i] - x) : 1e9, k = Math.exp(-(d * d) / 18);
        const r = zBase.r + (zLit.r - zBase.r) * k, g = zBase.g + (zLit.g - zBase.g) * k, b = zBase.b + (zLit.b - zBase.b) * k;
        for (let v = i * 96, e = v + 96; v < e; v++) { zc[v * 3] = r; zc[v * 3 + 1] = g; zc[v * 3 + 2] = b; }
      }
      zGeo.attributes.color.needsUpdate = true;
    },
    dispose() {
      scene.traverse((o) => { o.geometry?.dispose?.(); const mt = o.material; (Array.isArray(mt) ? mt : mt ? [mt] : []).forEach((x) => x.dispose?.()); });
    },
  };
}
