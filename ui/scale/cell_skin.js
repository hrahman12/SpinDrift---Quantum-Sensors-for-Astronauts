// Cell level, skin (carbon-dot microneedle patch): forearm skin layers at sourced thicknesses (data/bio/cells.json):
// stratum corneum and cellular epidermis (Sandby-Moller et al. 2003, dorsal forearm biopsies) and dermis (Wang et al. 2025,
// right dorsal forearm, 50 MHz ultrasound). The patch's microneedle geometry is not in any accessible source, so the
// needles are not drawn. Scene units: micrometres; y = 0 is the skin surface.
// Views: full (the whole skin thickness), top (stratum corneum, living epidermis, upper dermis) and dots (carbon dots
// as specks within the 1-12 nm DLS range that data/sensor_parts/cqd.json records from the paper's open Supporting
// Information; their number and positions are illustrative).
import * as THREE from 'three';

const UM = 'µm';
export const DATA = ['bio/cells', 'palette', 'sensor_parts/cqd'];
export const LEVEL = { id: 'cell_skin', site: 'skin', level: 'cell', title: 'Skin at the carbon-dot patch site', unit: UM, scaleBar: { length: 100, label: `100 ${UM}` } };

const C = { ink: '#e1e5d6', muted: '#8e9684', accent: '#a9d48c', dark: '#5c6552' };
const BLOCK_X = 600, BLOCK_Z = 400;       // footprint of the drawn block = field of view only, not a measured size
// Display choices of the views (no measured extent, count, depth or position is used for any of them)
const VIEW = {
  blockX: 6000, blockZ: 3000,             // µm: the block drawn in the views, wide enough for the 5.00 mm view; its front face stays where it was
  dots: 180,                              // specks drawn in the 1.00 µm view (the dots' number density is not sourced)
  dotsBox: [2.6, 1.3, 1.3],               // µm: the box the specks fill
  dotsBelowJunction: 70,                  // µm: where the specks sit, below the dermal-epidermal junction (the depth of the dots is not sourced)
};
const num = (v) => (v && typeof v.value === 'number' ? v.value : null);
const fmt = (x, d = 1) => Number(x).toLocaleString('en-US', { maximumFractionDigits: d });
const tagOf = (v) => (!v ? '' : v.status === 'VERIFIED' ? v.tag : `${v.tag}, ${String(v.status).toLowerCase().replace(/_/g, ' ')}`);
const srgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
// Halton low-discrepancy sequence: deterministic, evenly spread positions (never Math.random)
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

function markerMaterial(px) {
  return new THREE.ShaderMaterial({
    uniforms: { uSize: { value: px * Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1) } },
    vertexShader: 'attribute vec3 aColor; varying vec3 vColor; uniform float uSize;\nvoid main(){ vColor = aColor; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uSize; }',
    fragmentShader: 'varying vec3 vColor;\nvoid main(){ float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard; float a = 1.0 - smoothstep(0.1, 0.5, r); gl_FragColor = vec4(vColor * a, 1.0); }',
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
}
// one readout row for the chosen place's radiation note (this scene does not read magnetic fields)
function radiationRow(readouts) {
  const row = { label: 'Radiation here', plain: 'Radiation here', value: '', unit: '', tag: 'from the chosen place', source: '' };
  return (env) => {
    const text = typeof env?.radiation === 'string' ? env.radiation.trim() : '';
    const at = readouts.indexOf(row);
    if (!text) { if (at >= 0) readouts.splice(at, 1); return; }
    row.value = text; row.source = [env.location?.place, env.location?.sub_place].filter(Boolean).join(' · ');
    if (at < 0) readouts.push(row);
  };
}
// keeps the first info line in step with the view that is shown (labels stay as built: the host reads them once)
function viewLine(info, views) {
  const lines = info.lines.slice();
  return (name) => { info.lines.length = 0; if (name) info.lines.push(`In this view: ${views[name].note}`); info.lines.push(...lines); };
}

export function build(D, opts = {}) {
  const s = D['bio/cells']?.skin;
  const pal = D.palette?.colours || [];
  const parts = D['sensor_parts/cqd'];
  const inViews = opts.view !== undefined;          // built for the descent: labels are placed for its views
  const scene = new THREE.Scene();
  scene.background = null;
  scene.add(new THREE.HemisphereLight(0xe1e5d6, 0x1c1f19, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(0.4, 1, 0.6); scene.add(key);

  const layers = [
    { key: 'stratum_corneum', name: 'Stratum corneum', color: C.ink, opacity: 0.55 },
    { key: 'cellular_epidermis', name: 'Cellular epidermis', color: C.accent, opacity: 0.32 },
    { key: 'dermis', name: 'Dermis', color: C.muted, opacity: 0.14 },
  ].map((l) => ({ ...l, vo: s?.[l.key], h: num(s?.[l.key]) }));
  const labels = [], blocks = [];
  let top = 0;
  layers.forEach((l, i) => {
    if (!l.h) return;                                  // a layer without a sourced thickness is not drawn
    const geo = new THREE.BoxGeometry(BLOCK_X, l.h, BLOCK_Z);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: l.color, transparent: true, opacity: l.opacity, roughness: 0.8, depthWrite: false }));
    m.position.y = -(top + l.h / 2); m.renderOrder = 3 - i; scene.add(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: C.ink, transparent: true, opacity: 0.45 }));
    e.position.copy(m.position); scene.add(e);
    blocks.push(m, e); l.mesh = m;
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

  // ---- carbon dots (1.00 µm view): specks whose diameters lie in the DLS range recorded from the open Supporting
  // Information. Count, positions and depth are illustrative: Halton sequences, no measured density or place.
  const dls = parts?.documented?.cqd_size;
  const range = dls?.value ? String(dls.value).match(/(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\s*nm/) : null;
  const dMin = range ? +range[1] : null, dMax = range ? +range[2] : null;             // nm
  const junction = layers.reduce((d, l) => (l.key !== 'dermis' && l.h ? d + l.h : d), 0);   // depth of the dermal-epidermal junction
  const dotsAt = [0, -(junction + VIEW.dotsBelowJunction), 0];
  const dots = new THREE.Group();
  dots.position.fromArray(dotsAt); dots.visible = false; scene.add(dots);
  if (dMin > 0 && dMax >= dMin) {
    const mat = new THREE.MeshStandardMaterial({ color: cqd, emissive: cqd, emissiveIntensity: 0.9, roughness: 0.4 });
    const inst = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), mat, VIEW.dots);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), size = new THREE.Vector3();
    for (let k = 0; k < VIEW.dots; k++) {
      p.set((halton(k + 1, 2) - 0.5) * VIEW.dotsBox[0], (halton(k + 1, 3) - 0.5) * VIEW.dotsBox[1], (halton(k + 1, 5) - 0.5) * VIEW.dotsBox[2]);
      const dia = dMin + (dMax - dMin) * halton(k + 1, 7);                              // nm, spread evenly over the recorded range
      size.setScalar(dia / 2000);                                                       // radius in µm
      inst.setMatrixAt(k, M.compose(p, q, size));
    }
    inst.instanceMatrix.needsUpdate = true;
    dots.add(inst);
  }
  // a second marker shows where the specks are while they are far too small to see (5.00 mm and 600 µm views)
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.Float32BufferAttribute(dotsAt, 3));
  dg.setAttribute('aColor', new THREE.Float32BufferAttribute(srgb(cqd), 3));
  const dotsMark = new THREE.Points(dg, markerMaterial(9));
  dotsMark.visible = false; scene.add(dotsMark);

  // the fluid label: beside the block as before, or on the specks when built for the descent
  if (ep?.h) labels.push({ position: inViews ? dotsAt.slice() : [-BLOCK_X / 2 + 60, -(ep.top + ep.h + 70), 0], text: 'Interstitial fluid: bilirubin is read here' });

  // ---- text
  const sc = s?.stratum_corneum, epi = s?.cellular_epidermis, der = s?.dermis, geom = s?.microneedle_geometry, mn = s?.patch_microneedles;
  const ms = D['bio/cells']?.meta?.sources || [];
  const needleSrc = parts?.needle_geometry?.height;
  const info = {
    title: 'Forearm skin at the carbon-dot patch site',
    lines: [
      `To scale: stratum corneum ${fmt(num(sc))} ${UM} and cellular epidermis ${fmt(num(epi))} ${UM} (dorsal forearm biopsies of 71 volunteers, Sandby-Møller et al. 2003); dermis ${fmt((num(der) || 0) / 1000, 2)} mm (right dorsal forearm, 50 MHz ultrasound, 74 adults, Wang et al. 2025). Two studies with different methods.`,
      mn?.value ? `The patch is “${mn.value}” that stay in the skin as an invisible tattoo (Tabatabaee et al. 2024).` : 'The patch is a carbon-dot microneedle tattoo (Tabatabaee et al. 2024).',
      needleSrc
        ? 'Needle height, base width, tip, pitch and array size are not stated in any accessible source: the main text is not open, and the open Supporting Information gives no needle dimension. So the needles are not drawn: the purple dot marks the site only.'
        : 'Needle height, base width, tip, pitch and array size are not in the abstract, and the full text and supporting information are paywalled, so the needles are not drawn: the purple dot marks the site only.',
      'The analyte, bilirubin, is read in the skin’s interstitial fluid. The dermal–epidermal junction is drawn flat (its folds are not drawn); the block’s width and depth are only the field of view.',
      'Marker colour: the measured carbon-dot emission maximum, 439 nm (data/palette.json); layer colours are display colours.',
      !inViews ? ''
        : range
          ? `Carbon dots (1.00 µm view): ${VIEW.dots} specks with diameters spread evenly over ${dMin}–${dMax} nm, the range of the DLS diameter histogram in the paper's open Supporting Information (Fig. S1; no mean size is stated and the histogram's shape is not recorded here). How many dots there are per volume, where they sit and how deep they go are not in any accessible source, so the count, the positions (Halton sequences, no randomness) and the depth (${VIEW.dotsBelowJunction} ${UM} below the dermal–epidermal junction; the paper's title calls the tattoo dermal) are illustrative.`
          : 'Carbon dots: data/sensor_parts/cqd.json did not give a size range, so no dots are drawn.',
    ].filter(Boolean),
    sources: [sc?.source, der?.source, ms.find((x) => x.startsWith('Tabatabaee')), pal.find((p) => p.device === 'cqd_patch' && p.wavelength?.value === 439)?.wavelength?.source, inViews ? dls?.source : null].filter(Boolean),
    lean: [],
  };
  const readouts = [
    { label: 'Stratum corneum', value: num(sc) ?? 'not sourced', unit: num(sc) ? UM : '', tag: tagOf(sc), source: 'Sandby-Møller 2003' },
    { label: 'Cellular epidermis', value: num(epi) ?? 'not sourced', unit: num(epi) ? UM : '', tag: tagOf(epi), source: 'Sandby-Møller 2003' },
    { label: 'Dermis', value: num(der) ?? 'not sourced', unit: num(der) ? UM : '', tag: tagOf(der), source: 'Wang 2025, Table 3' },
    { label: 'Skin drawn, total', value: num(s?.total_drawn) ?? '-', unit: UM, tag: tagOf(s?.total_drawn), source: 'sum of layers' },
    { label: 'Microneedle size', value: 'not public', unit: '', tag: tagOf(geom) || 'not yet extracted', source: needleSrc ? 'Tabatabaee 2024: main text not open; not in the open Supporting Information' : 'Tabatabaee 2024 (paywalled)' },
  ];
  if (inViews) {
    readouts.push(
      { label: 'Carbon-dot diameter (DLS range)', value: range ? `${dMin}–${dMax}` : 'not loaded', unit: range ? 'nm' : '', tag: tagOf(dls), source: dls?.source || 'data/sensor_parts/cqd.json' },
      { label: 'Dots drawn in the 1 µm view', value: range ? `${VIEW.dots}, illustrative` : 'none', unit: '', tag: 'display', source: 'number density, positions and depth are not sourced' },
    );
  }

  // ---- views. The targets sit on the block's front face, which stays where it always was (z = BLOCK_Z / 2).
  const camDir = unit([330, 230, 640]);
  const epiDepth = junction;                            // the 600 µm view is centred twice as deep as the junction
  const views = {
    full: { target: [0, -top / 2, BLOCK_Z / 2], dir: camDir,
      note: `The whole skin thickness drawn, ${fmt(top / 1000, 2)} mm (stratum corneum, cellular epidermis and dermis), cut open at the front, with the patch site marked on the surface. The block is drawn ${fmt(VIEW.blockX / 1000, 0)} mm wide and ${fmt(VIEW.blockZ / 1000, 0)} mm deep to fill the frame; that extent is a display choice, not a measured size.` },
    top: { target: [0, -2 * epiDepth, BLOCK_Z / 2], dir: camDir,
      note: `The top of the skin, cut open at the front: stratum corneum ${fmt(num(sc))} ${UM}, cellular epidermis ${fmt(num(epi))} ${UM} and the upper part of the dermis. The second purple dot, inside the dermis, marks where the next view shows the carbon dots.` },
    dots: { target: dotsAt.slice(), dir: unit([0.3, 0.2, 1]),
      note: range
        ? `Carbon dots as glowing specks, ${dMin}–${dMax} nm across (the DLS range in the paper's open Supporting Information, Fig. S1), in the skin's fluid ${VIEW.dotsBelowJunction} ${UM} below the dermal–epidermal junction. The view is 1,000 nm tall, so the largest speck is ${fmt((dMax / 1000) * 100, 1)} % of its height. The number of specks (${VIEW.dots}), their positions and their depth are illustrative: none of them is sourced.`
        : 'No carbon-dot size range is loaded (data/sensor_parts/cqd.json), so no dots are drawn here.' },
  };
  const showLine = viewLine(info, views);
  function setView(name) {
    const named = Object.prototype.hasOwnProperty.call(views, name);
    const sx = named ? VIEW.blockX / BLOCK_X : 1, sz = named ? VIEW.blockZ / BLOCK_Z : 1;
    for (const o of blocks) { o.scale.set(sx, 1, sz); o.position.z = BLOCK_Z / 2 - (BLOCK_Z * sz) / 2; }   // the front face does not move
    dots.visible = named;
    // in the views the dermis is drawn lighter and denser so that its 1.6 mm reads as a body (display colours)
    for (const l of layers) if (l.mesh) { l.mesh.material.opacity = named ? { stratum_corneum: 0.7, cellular_epidermis: 0.5, dermis: 0.4 }[l.key] : l.opacity; l.mesh.material.color.set(named && l.key === 'dermis' ? '#b9c0ab' : l.color); }
    dotsMark.visible = name === 'full' || name === 'top';
    showLine(named ? name : null);
  }
  const PLAIN = { 'Stratum corneum': 'Dead top layer', 'Cellular epidermis': 'Living top layer', 'Dermis': 'Deep layer (dermis)', 'Skin drawn, total': 'Skin thickness', 'Microneedle size': 'Needle size', 'Carbon-dot diameter (DLS range)': 'Dot size', 'Dots drawn in the 1 µm view': 'Dots drawn' };   // plain words for the card
  for (const r of readouts) if (!r.plain && PLAIN[r.label]) r.plain = PLAIN[r.label];
  const setEnv = radiationRow(readouts);
  if (opts.env) setEnv(opts.env);
  if (inViews) setView(opts.view);

  return {
    scene,
    camera: { position: [330, 150, 640], target: [0, -80, 0], fov: 40 },
    labels, info, readouts, views, setView, setEnv,
    update() {},
    dispose() {
      scene.traverse((o) => { o.geometry?.dispose?.(); const mt = o.material; (Array.isArray(mt) ? mt : mt ? [mt] : []).forEach((x) => x.dispose?.()); });
    },
  };
}
