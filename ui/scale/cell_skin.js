// Cell level, skin (carbon-dot microneedle patch): forearm skin layers at sourced thicknesses (data/bio/cells.json):
// stratum corneum and cellular epidermis (Sandby-Moller et al. 2003, dorsal forearm biopsies) and dermis (Wang et al. 2025,
// right dorsal forearm, 50 MHz ultrasound). The patch's microneedle geometry is not in any accessible source, so the
// needles are not drawn. Scene units: micrometres; y = 0 is the skin surface.
import * as THREE from 'three';

const UM = 'µm';
export const DATA = ['bio/cells', 'palette'];
export const LEVEL = { id: 'cell_skin', site: 'skin', level: 'cell', title: 'Skin at the carbon-dot patch site', unit: UM, scaleBar: { length: 100, label: `100 ${UM}` } };

const C = { ink: '#e1e5d6', muted: '#8e9684', accent: '#a9d48c', dark: '#5c6552' };
const BLOCK_X = 600, BLOCK_Z = 400;       // footprint of the drawn block = field of view only, not a measured size
const num = (v) => (v && typeof v.value === 'number' ? v.value : null);
const fmt = (x, d = 1) => Number(x).toLocaleString('en-US', { maximumFractionDigits: d });
const tagOf = (v) => (!v ? '' : v.status === 'VERIFIED' ? v.tag : `${v.tag}, ${String(v.status).toLowerCase().replace(/_/g, ' ')}`);
const srgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

function markerMaterial(px) {
  return new THREE.ShaderMaterial({
    uniforms: { uSize: { value: px * Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1) } },
    vertexShader: 'attribute vec3 aColor; varying vec3 vColor; uniform float uSize;\nvoid main(){ vColor = aColor; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uSize; }',
    fragmentShader: 'varying vec3 vColor;\nvoid main(){ float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard; float a = 1.0 - smoothstep(0.1, 0.5, r); gl_FragColor = vec4(vColor * a, 1.0); }',
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
}

export function build(D) {
  const s = D['bio/cells']?.skin;
  const pal = D.palette?.colours || [];
  const scene = new THREE.Scene();
  scene.background = null;
  scene.add(new THREE.HemisphereLight(0xe1e5d6, 0x1c1f19, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(0.4, 1, 0.6); scene.add(key);

  const layers = [
    { key: 'stratum_corneum', name: 'Stratum corneum', color: C.ink, opacity: 0.55 },
    { key: 'cellular_epidermis', name: 'Cellular epidermis', color: C.accent, opacity: 0.32 },
    { key: 'dermis', name: 'Dermis', color: C.muted, opacity: 0.14 },
  ].map((l) => ({ ...l, vo: s?.[l.key], h: num(s?.[l.key]) }));
  const labels = [];
  let top = 0;
  layers.forEach((l, i) => {
    if (!l.h) return;                                  // a layer without a sourced thickness is not drawn
    const geo = new THREE.BoxGeometry(BLOCK_X, l.h, BLOCK_Z);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: l.color, transparent: true, opacity: l.opacity, roughness: 0.8, depthWrite: false }));
    m.position.y = -(top + l.h / 2); m.renderOrder = 3 - i; scene.add(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: C.ink, transparent: true, opacity: 0.45 }));
    e.position.copy(m.position); scene.add(e);
    l.top = top; top += l.h;
    const y = l.key === 'dermis' ? -(l.top + 150) : -(l.top + l.h / 2);
    labels.push({ position: [BLOCK_X / 2, y, BLOCK_Z / 2], text: `${l.name} · ${l.h >= 1000 ? `${fmt(l.h / 1000, 2)} mm` : `${fmt(l.h)} ${UM}`}` });
  });
  if (top > 0) labels.push({ position: [BLOCK_X / 2, -top, BLOCK_Z / 2], text: `${fmt(top / 1000, 2)} mm down: dermis ends (subcutis not drawn)` });

  // ---- patch site: a marker in the carbon-dot emission colour; no needle is drawn because no needle size is sourced
  const cqd = pal.find((p) => p.device === 'cqd_patch' && p.wavelength?.value === 439)?.colour?.value || C.accent;
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.Float32BufferAttribute([0, 1, 0], 3));
  mg.setAttribute('aColor', new THREE.Float32BufferAttribute(srgb(cqd), 3));
  scene.add(new THREE.Points(mg, markerMaterial(16)));
  labels.push({ position: [0, 2, 0], text: 'Carbon-dot patch site · needles not drawn (geometry not public)' });
  const ep = layers.find((l) => l.key === 'cellular_epidermis');
  if (ep?.h) labels.push({ position: [-BLOCK_X / 2 + 60, -(ep.top + ep.h + 70), 0], text: 'Interstitial fluid: bilirubin is read here' });

  // ---- text
  const sc = s?.stratum_corneum, epi = s?.cellular_epidermis, der = s?.dermis, geom = s?.microneedle_geometry, mn = s?.patch_microneedles;
  const ms = D['bio/cells']?.meta?.sources || [];
  const info = {
    title: 'Forearm skin at the carbon-dot patch site',
    lines: [
      `To scale: stratum corneum ${fmt(num(sc))} ${UM} and cellular epidermis ${fmt(num(epi))} ${UM} (dorsal forearm biopsies of 71 volunteers, Sandby-Møller et al. 2003); dermis ${fmt((num(der) || 0) / 1000, 2)} mm (right dorsal forearm, 50 MHz ultrasound, 74 adults, Wang et al. 2025). Two studies with different methods.`,
      mn?.value ? `The patch is “${mn.value}” that stay in the skin as an invisible tattoo (Tabatabaee et al. 2024).` : 'The patch is a carbon-dot microneedle tattoo (Tabatabaee et al. 2024).',
      'Needle height, base width, tip, pitch and array size are not in the abstract, and the full text and supporting information are paywalled, so the needles are not drawn: the purple dot marks the site only.',
      'The analyte, bilirubin, is read in the skin’s interstitial fluid. The dermal–epidermal junction is drawn flat (its folds are not drawn); the block’s width and depth are only the field of view.',
      'Marker colour: the measured carbon-dot emission maximum, 439 nm (data/palette.json); layer colours are display colours.',
    ],
    sources: [sc?.source, der?.source, ms.find((x) => x.startsWith('Tabatabaee')), pal.find((p) => p.device === 'cqd_patch' && p.wavelength?.value === 439)?.wavelength?.source].filter(Boolean),
    lean: [],
  };
  const readouts = [
    { label: 'Stratum corneum', value: num(sc) ?? 'not sourced', unit: num(sc) ? UM : '', tag: tagOf(sc), source: 'Sandby-Møller 2003' },
    { label: 'Cellular epidermis', value: num(epi) ?? 'not sourced', unit: num(epi) ? UM : '', tag: tagOf(epi), source: 'Sandby-Møller 2003' },
    { label: 'Dermis', value: num(der) ?? 'not sourced', unit: num(der) ? UM : '', tag: tagOf(der), source: 'Wang 2025, Table 3' },
    { label: 'Skin drawn, total', value: num(s?.total_drawn) ?? '-', unit: UM, tag: tagOf(s?.total_drawn), source: 'sum of layers' },
    { label: 'Microneedle size', value: 'not public', unit: '', tag: tagOf(geom) || 'not yet extracted', source: 'Tabatabaee 2024 (paywalled)' },
  ];
  return {
    scene,
    camera: { position: [330, 150, 640], target: [0, -80, 0], fov: 40 },
    labels, info, readouts,
    update() {},
    dispose() {
      scene.traverse((o) => { o.geometry?.dispose?.(); const mt = o.material; (Array.isArray(mt) ? mt : mt ? [mt] : []).forEach((x) => x.dispose?.()); });
    },
  };
}
