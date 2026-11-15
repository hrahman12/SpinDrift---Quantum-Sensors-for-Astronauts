// Molecule level, heart (NV + OPM): the cardiac sodium channel Nav1.5 (gene SCN5A). C-alpha trace of RCSB PDB 8VYJ
// (full-length human Nav1.5, electron-microscopy structure, CC0) from data/bio/nav15_8vyj.json, coloured by UniProt Q14524 membrane topology,
// plus the SCN5A exon structure from Ensembl (data/bio/genes.json). Scene units: angstrom.
import * as THREE from 'three';

const ANG = 'Å';
export const DATA = ['bio/nav15_8vyj', 'bio/genes'];
export const LEVEL = { id: 'mol_nav15', site: 'heart', level: 'molecule', title: 'Nav1.5 cardiac sodium channel', unit: ANG, scaleBar: { length: 20, label: `20 ${ANG}` } };

// display colours (theme): transmembrane helices, pore-forming loops, extracellular, cytoplasmic, unannotated
const TOPO = { M: '#a9d48c', P: '#e1e5d6', X: '#8e9684', C: '#5c6552', '-': '#5c6552' };
const ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' };
const TUBE = 0.55;                 // display radius of the C-alpha tube (angstrom): a drawing choice, not an atom size

function traceMeshes(pts, ca, colourOf, mat) {
  const segs = []; let cur = [0];
  for (let i = 1; i < pts.length; i++) {
    if (ca[i][0] !== ca[i - 1][0] || ca[i][1] - ca[i - 1][1] > 1 || pts[i].distanceTo(pts[i - 1]) > 4.3) { segs.push(cur); cur = []; }
    cur.push(i);
  }
  segs.push(cur);
  const out = [];
  for (const seg of segs) {
    if (seg.length < 2) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(TUBE * 1.4, 10, 8), new THREE.MeshStandardMaterial({ color: colourOf(seg[0]) }));
      m.position.copy(pts[seg[0]]); out.push(m); continue;
    }
    const curve = new THREE.CatmullRomCurve3(seg.map((i) => pts[i]));
    const tub = seg.length * 5, rad = 7;
    const geo = new THREE.TubeGeometry(curve, tub, TUBE, rad, false);
    const colors = new Float32Array(geo.attributes.position.count * 3);
    for (let i = 0; i <= tub; i++) {
      const c = colourOf(seg[Math.min(seg.length - 1, Math.round((i / tub) * (seg.length - 1)))]);
      for (let j = 0; j <= rad; j++) { const v = (i * (rad + 1) + j) * 3; colors[v] = c.r; colors[v + 1] = c.g; colors[v + 2] = c.b; }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    out.push(new THREE.Mesh(geo, mat));
  }
  return out;
}
const fmt = (x, d = 0) => Number(x).toLocaleString('en-US', { maximumFractionDigits: d });
const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

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
  const nav = D['bio/nav15_8vyj'];
  const g = D['bio/genes']?.genes?.SCN5A;
  const scene = new THREE.Scene();
  scene.background = null;
  scene.add(new THREE.HemisphereLight(0xe1e5d6, 0x1c1f19, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(0.4, 0.8, 1); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-0.6, -0.5, -0.7); scene.add(fill);
  if (!nav?.ca?.length) {
    const readouts = [], msg = 'data/bio/nav15_8vyj.json did not load; run scripts/build_bio.py.';
    return { scene, camera: { position: [0, 0, 250], target: [0, 0, 0], fov: 40 }, labels: [], readouts,
      info: { title: 'Nav1.5 structure not loaded', lines: [msg], sources: [], lean: [] },
      views: { whole: { target: [0, 0, 0], dir: [0, 0, 1], note: msg } }, setView() {}, setEnv: radiationRow(readouts), update() {}, dispose() {} };
  }
  // ---- coordinates: centred on the transmembrane residues and turned so the calculated membrane normal points up
  const ca = nav.ca;
  const centre = new THREE.Vector3(...(nav.tm_centre_A || nav.centre_A));
  const qn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...(nav.membrane_normal || [0, 1, 0])).normalize(), new THREE.Vector3(0, 1, 0));
  const pts = ca.map((r) => new THREE.Vector3(r[3], r[4], r[5]).sub(centre).applyQuaternion(qn));
  const topo = nav.ca_topology || '', rep = nav.ca_repeat || '';
  const cols = Object.fromEntries(Object.entries(TOPO).map(([k, v]) => [k, new THREE.Color(v)]));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 });
  for (const m of traceMeshes(pts, ca, (i) => cols[topo[i]] || cols['-'], mat)) scene.add(m);

  // ---- IFM motif (fast inactivation), located in the build by sequence search of the III-IV linker
  const labels = [];
  const site = (nav.sites || []).find((s) => s.name === 'IFM motif');
  if (site?.index?.length) {
    const sm = new THREE.MeshStandardMaterial({ color: '#e1e5d6', emissive: '#e1e5d6', emissiveIntensity: 0.45 });
    const sg = new THREE.SphereGeometry(1.6, 20, 14);
    const c = new THREE.Vector3();
    for (const i of site.index) { const b = new THREE.Mesh(sg, sm); b.position.copy(pts[i]); scene.add(b); c.add(pts[i]); }
    c.divideScalar(site.index.length);
    labels.push({ position: c.toArray(), text: `IFM motif · Ile${site.uniprot_positions[0]}–Phe${site.uniprot_positions[1]}–Met${site.uniprot_positions[2]}` });
  }
  // ---- labels at calculated centroids of annotated residues
  const centroid = (test) => {
    const c = new THREE.Vector3(); let k = 0;
    pts.forEach((p, i) => { if (test(i)) { c.add(p); k++; } });
    return k ? c.divideScalar(k) : null;
  };
  for (const r of ['1', '2', '3', '4']) {
    const c = centroid((i) => rep[i] === r && topo[i] === 'M');
    if (c) labels.push({ position: c.toArray(), text: `Repeat ${ROMAN[r]}` });
  }
  const pore = centroid((i) => topo[i] === 'P');
  if (pore) labels.push({ position: pore.toArray(), text: 'Pore: 4 pore-forming loops' });
  const ext = centroid((i) => topo[i] === 'X'), cyt = centroid((i) => topo[i] === 'C');
  if (ext) labels.push({ position: ext.toArray(), text: 'Extracellular side' });
  if (cyt) labels.push({ position: cyt.toArray(), text: 'Cytoplasmic side' });

  // ---- camera
  let maxR = 0; for (const p of pts) maxR = Math.max(maxR, p.length());
  const dist = (maxR / Math.tan(THREE.MathUtils.degToRad(20))) * 0.95;
  const cpos = new THREE.Vector3(0.35, 0.12, 1).normalize().multiplyScalar(dist);

  // ---- gene track (host draws it)
  const gene = g ? { symbol: g.symbol, chrom: g.chrom, start: g.start, end: g.end, strand: g.strand, exons: g.exon_coords, transcript: g.canonical_transcript } : undefined;
  const mane = (g?.mane || []).map((m) => m.refseq).filter(Boolean).join(', ');
  const span = nav.tm_span_A ? nav.tm_span_A[1] - nav.tm_span_A[0] : null;
  const info = {
    title: `Nav1.5 · PDB ${nav.pdb_id} · gene SCN5A`,
    lines: [
      `Human Nav1.5, full length, electron-microscopy structure at ${nav.resolution_A} ${ANG} (PDB ${nav.pdb_id}; Biswas et al. 2025), reported in the open state. C-alpha trace of the ${fmt(nav.n_residues)} modelled residues of ${fmt(nav.sequence_length)}; gaps are unmodelled regions.`,
      'Colours follow UniProt Q14524 topology: transmembrane helices green, the four pore-forming loops bright, extracellular parts grey, cytoplasmic parts dark.',
      `Turned so the calculated membrane normal (mean direction of the 24 transmembrane segments, cytoplasm to outside) points up; the transmembrane residues span ${span ? fmt(span, 1) : '?'} ${ANG} along it (calculated, not a membrane thickness).`,
      site ? `IFM motif (Ile${site.uniprot_positions[0]}–Phe${site.uniprot_positions[1]}–Met${site.uniprot_positions[2]}): “Isoleucine-Phenylalanine-Methionine (IFM) motif in the linker between D III and D IV”, crucial for fast inactivation (Biswas et al. 2025); found here by sequence search.` : '',
      'The tube follows the C-alpha path; its thickness and the sphere sizes are display choices, not atom sizes.',
      g ? `Gene SCN5A: chr${g.chrom}:${fmt(g.start)}–${fmt(g.end)} (${g.strand > 0 ? '+' : '−'} strand, ${D['bio/genes'].assembly}), ${g.n_exons} exons in ${g.canonical_transcript}${mane ? ` (MANE Select ${mane})` : ''}. ${g.isoform_note ? `Note: ${g.isoform_note}.` : ''}` : 'Gene data not loaded.',
    ].filter(Boolean),
    sources: [
      `RCSB PDB ${nav.pdb_id} (CC0 1.0)`, nav.citation?.full,
      `UniProt ${nav.uniprot} (CC BY 4.0)`,
      g ? `Ensembl REST API, release ${D['bio/genes'].ensembl_release}, ${g.ensembl_gene_id}` : null,
    ].filter(Boolean),
    lean: [],
  };
  const readouts = [
    { label: 'Structure', value: nav.pdb_id, unit: '', tag: 'recorded', source: 'RCSB PDB' },
    { label: 'Resolution', value: nav.resolution_A, unit: ANG, tag: 'recorded', source: nav.method },
    { label: 'Modelled residues', value: `${fmt(nav.n_residues)} / ${fmt(nav.sequence_length)}`, unit: '', tag: 'recorded', source: 'C-alpha atoms / UniProt length' },
    { label: 'Helix residues (file)', value: nav.helix_residues, unit: '', tag: 'recorded', source: 'HELIX records' },
    { label: 'TM residue span', value: span ? Number(span.toFixed(1)) : '-', unit: ANG, tag: 'calculated', source: 'along the membrane normal' },
    g ? { label: 'SCN5A exons', value: g.n_exons, unit: '', tag: 'recorded', source: `Ensembl ${D['bio/genes'].ensembl_release}` } : null,
    g ? { label: 'Protein (transcript)', value: g.translation?.length_aa, unit: 'aa', tag: 'recorded', source: g.translation?.id } : null,
  ].filter(Boolean);

  // ---- view: the centre of the box around the modelled C-alpha atoms (the channel is taller than a 10 nm view)
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) p.toArray().forEach((v, k) => { lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v); });
  const size = hi.map((v, k) => v - lo[k]);
  const views = { whole: { target: lo.map((v, k) => (v + hi[k]) / 2), dir: unit([0.35, 0.12, 1]),
    note: `The whole modelled channel, centred on the box around its C-alpha atoms: ${fmt(size[0])} ${ANG} across, ${fmt(size[1])} ${ANG} along the membrane normal and ${fmt(size[2])} ${ANG} deep (calculated).${size[1] > 100 ? ` A 10.0 nm view is 100 ${ANG} tall, so the far ends of the extracellular and cytoplasmic parts reach past the frame.` : ''}` } };
  const showLine = viewLine(info, views);
  const setView = (name) => showLine(Object.prototype.hasOwnProperty.call(views, name) ? name : null);   // the same content in every view
  const PLAIN = { 'Structure': 'Structure file', 'Resolution': 'Sharpness of the map', 'Modelled residues': 'Building blocks seen', 'Helix residues (file)': 'Coiled parts', 'TM residue span': 'Part across the membrane', 'SCN5A exons': 'Gene pieces', 'Protein (transcript)': 'Protein length' };   // plain words for the card
  for (const r of readouts) if (!r.plain && PLAIN[r.label]) r.plain = PLAIN[r.label];
  const setEnv = radiationRow(readouts);
  if (opts.env) setEnv(opts.env);
  if (opts.view !== undefined) setView(opts.view);

  return {
    scene,
    camera: { position: cpos.toArray(), target: [0, 0, 0], fov: 40 },
    labels, info, readouts, gene, views, setView, setEnv,
    update() {},
    dispose() {
      scene.traverse((o) => { o.geometry?.dispose?.(); const mt = o.material; (Array.isArray(mt) ? mt : mt ? [mt] : []).forEach((x) => x.dispose?.()); });
    },
  };
}
