// Molecule level, skin (carbon-dot patch): bilirubin, the patch's analyte. Atoms and bonds of PubChem CID 5280352's
// computed 3D conformer (reused from data/molecules/bilirubin_cid5280352.json), atom spheres scaled from PubChem's
// van der Waals radii (data/bio/elements.json), and the UGT1A1 exon structure from Ensembl (UGT1A1 conjugates bilirubin).
// Scene units: angstrom.
import * as THREE from 'three';

const ANG = 'Å';
export const DATA = ['molecules/bilirubin_cid5280352', 'bio/genes', 'bio/elements', 'specs'];
export const LEVEL = { id: 'mol_bilirubin', site: 'skin', level: 'molecule', title: 'Bilirubin', unit: ANG, scaleBar: { length: 5, label: `5 ${ANG}` } };

const CPK = { C: '#909090', N: '#3050f8', O: '#ff0d0d', H: '#ffffff' };      // as in ui/mol3d.js (and PubChem's CPK list)
const BOND_R = 0.11, DOUBLE_R = 0.075, DOUBLE_OFF = 0.13;                     // display radii of bond sticks (angstrom)
const fmt = (x, d = 1) => Number(x).toLocaleString('en-US', { maximumFractionDigits: d });
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
  const mol = D['molecules/bilirubin_cid5280352'];
  const g = D['bio/genes']?.genes?.UGT1A1;
  const els = D['bio/elements']?.elements || {};
  const patch = D.specs?.cqd_patch;
  const scene = new THREE.Scene();
  scene.background = null;
  scene.add(new THREE.HemisphereLight(0xe1e5d6, 0x1c1f19, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(0.4, 0.8, 1); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-0.6, -0.5, -0.7); scene.add(fill);
  if (!mol?.atoms?.length) {
    const readouts = [], msg = 'data/molecules/bilirubin_cid5280352.json did not load; run scripts/build_molecules.py.';
    return { scene, camera: { position: [0, 0, 60], target: [0, 0, 0], fov: 40 }, labels: [], readouts,
      info: { title: 'Bilirubin not loaded', lines: [msg], sources: [], lean: [] },
      views: { whole: { target: [0, 0, 0], dir: [0, 0, 1], note: msg } }, setView() {}, setEnv: radiationRow(readouts), update() {}, dispose() {} };
  }
  const at = mol.atoms.map((a) => new THREE.Vector3(a[1], a[2], a[3]));
  const c0 = new THREE.Vector3(); at.forEach((p) => c0.add(p)); c0.divideScalar(at.length); at.forEach((p) => p.sub(c0));
  const elem = mol.atoms.map((a) => a[0]);

  // ---- atoms: spheres at a chosen fraction of each element's van der Waals radius (PubChem); 100% = space-filling
  let frac = 0.25;
  const vdw = (e) => els[e]?.vdw_radius_A?.value ?? null;
  const sphere = new THREE.SphereGeometry(1, 26, 18);
  const mats = {};
  const mat = (e) => (mats[e] ||= new THREE.MeshStandardMaterial({ color: els[e]?.cpk || CPK[e] || '#ff80ff', roughness: 0.45 }));
  const atomMeshes = at.map((p, i) => {
    const m = new THREE.Mesh(sphere, mat(elem[i]));
    m.position.copy(p); m.scale.setScalar((vdw(elem[i]) ?? 1.5) * frac);
    scene.add(m); return m;
  });

  // ---- bonds from PubChem (order 1 or 2), drawn as sticks
  const bondMat = new THREE.MeshStandardMaterial({ color: '#b9c0ab', roughness: 0.6 });
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 12);
  const up = new THREE.Vector3(0, 1, 0);
  const nbr = at.map(() => []);
  for (const [i, j, order] of mol.bonds) {
    nbr[i].push([j, order]); nbr[j].push([i, order]);
    const a = at[i], b = at[j], mid = a.clone().add(b).multiplyScalar(0.5), dir = b.clone().sub(a), len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());
    const perp = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) < 0.9 * len ? up : new THREE.Vector3(1, 0, 0)).normalize().multiplyScalar(DOUBLE_OFF);
    const offs = order === 2 ? [perp, perp.clone().negate()] : [new THREE.Vector3()];
    for (const o of offs) {
      const m = new THREE.Mesh(cyl, bondMat);
      m.position.copy(mid).add(o); m.quaternion.copy(q);
      const r = order === 2 ? DOUBLE_R : BOND_R; m.scale.set(r, len, r);
      scene.add(m);
    }
  }

  // ---- labels at atoms found from the bond graph: carboxylic acids (C with =O and -OH) and lactam carbonyls (O=C-N)
  const labels = [];
  elem.forEach((e, i) => {
    if (e !== 'C') return;
    const os = nbr[i].filter(([j]) => elem[j] === 'O');
    const dbl = os.find(([, o]) => o === 2), sgl = os.find(([, o]) => o === 1);
    if (os.length === 2 && dbl && sgl && nbr[sgl[0]].some(([k]) => elem[k] === 'H')) labels.push({ position: at[i].toArray(), text: 'Carboxylic acid (–COOH)' });
    else if (dbl && nbr[i].some(([j]) => elem[j] === 'N')) labels.push({ position: at[dbl[0]].toArray(), text: 'Lactam C=O' });
  });

  // ---- size, camera
  let dmax = 0, maxR = 0;
  for (let i = 0; i < at.length; i++) { maxR = Math.max(maxR, at[i].length()); for (let j = i + 1; j < at.length; j++) dmax = Math.max(dmax, at[i].distanceTo(at[j])); }
  const dist = ((maxR + 1.5) / Math.tan(THREE.MathUtils.degToRad(20))) * 1.0;
  const cpos = new THREE.Vector3(0.2, 0.25, 1).normalize().multiplyScalar(dist);

  const gene = g ? { symbol: g.symbol, chrom: g.chrom, start: g.start, end: g.end, strand: g.strand, exons: g.exon_coords, transcript: g.canonical_transcript } : undefined;
  const mane = (g?.mane || []).map((m) => m.refseq).filter(Boolean).join(', ');
  const conj = g?.bilirubin_conjugation;
  const counts = elem.reduce((o, e) => ((o[e] = (o[e] || 0) + 1), o), {});
  const info = {
    title: `Bilirubin · PubChem CID ${mol.cid} · gene UGT1A1`,
    lines: [
      `${mol.name}, ${mol.formula} (${mol.molecular_weight} g/mol): ${mol.n_atoms} atoms and ${mol.n_bonds} bonds of PubChem's computed 3D conformer, a model geometry, not a crystal structure.`,
      `Atom spheres are a chosen fraction (slider; 25% at start) of each element's van der Waals radius from PubChem (C ${vdw('C') ?? '?'}, N ${vdw('N') ?? '?'}, O ${vdw('O') ?? '?'}, H ${vdw('H') ?? '?'} ${ANG}); 100% shows the space-filling envelope. Bond sticks are display size. CPK colours.`,
      'Labels mark the two carboxylic acids and the two lactam carbonyls, found from the PubChem bond list.',
      g?.function?.value ? `UGT1A1 (gene track): “${g.function.value}” (UniProt P22309).` : '',
      conj?.value ? `${conj.value} (Bosma et al. 1994).` : '',
      patch?.mechanism?.value ? `The carbon-dot patch reads bilirubin in skin interstitial fluid by ${patch.mechanism.value} (Tabatabaee et al. 2024).` : '',
      g ? `Gene UGT1A1: chr${g.chrom}:${fmt(g.start, 0)}–${fmt(g.end, 0)} (${g.strand > 0 ? '+' : '−'} strand, ${D['bio/genes'].assembly}), ${g.n_exons} exons in ${g.canonical_transcript}${mane ? ` (MANE Select ${mane})` : ''}; protein ${g.translation?.length_aa} aa.` : 'Gene data not loaded.',
    ].filter(Boolean),
    sources: [...(mol.meta?.sources || []), D['bio/elements']?.meta?.sources?.[0], g?.function?.source, conj?.source, patch?.mechanism?.source,
      g ? `Ensembl REST API, release ${D['bio/genes'].ensembl_release}, ${g.ensembl_gene_id}` : null].filter(Boolean),
    lean: [],
  };
  const readouts = [
    { label: 'Formula', value: mol.formula, unit: '', tag: 'recorded', source: 'PubChem' },
    { label: 'Molecular weight', value: Number(mol.molecular_weight), unit: 'g/mol', tag: 'recorded', source: 'PubChem' },
    { label: 'Atoms C / H / N / O', value: `${counts.C || 0} / ${counts.H || 0} / ${counts.N || 0} / ${counts.O || 0}`, unit: '', tag: 'calculated', source: 'PubChem conformer' },
    { label: 'Largest atom–atom distance', value: Number(dmax.toFixed(2)), unit: ANG, tag: 'calculated', source: 'computed conformer' },
    { label: 'Atom size', value: Math.round(frac * 100), unit: '% of vdW', tag: 'display', source: 'PubChem vdW radii' },
    g ? { label: 'UGT1A1 exons', value: g.n_exons, unit: '', tag: 'recorded', source: `Ensembl ${D['bio/genes'].ensembl_release}` } : null,
  ].filter(Boolean);
  const sizeRO = readouts.find((r) => r.label === 'Atom size');
  const controls = [{
    id: 'vdw', label: 'Atom size (% of van der Waals radius)', value: 25, min: 15, max: 100, step: 5, unit: '%',
    onInput: (v) => { frac = v / 100; atomMeshes.forEach((m, i) => m.scale.setScalar((vdw(elem[i]) ?? 1.5) * frac)); sizeRO.value = v; },
  }];

  // ---- view: the whole molecule around the centroid of its atoms
  const views = { whole: { target: [0, 0, 0], dir: unit([0.2, 0.25, 1]),
    note: `The whole bilirubin molecule, centred on the centroid of its ${at.length} atoms; its two farthest atoms are ${fmt(dmax, 2)} ${ANG} apart (calculated from the PubChem conformer), so it fits inside a 2.50 nm (25 ${ANG}) view.` } };
  const showLine = viewLine(info, views);
  const setView = (name) => showLine(Object.prototype.hasOwnProperty.call(views, name) ? name : null);   // the same content in every view
  const PLAIN = { 'Formula': 'Atoms in it', 'Molecular weight': 'Weight per mole', 'Atoms C / H / N / O': 'Atoms by element', 'Largest atom–atom distance': 'Length of the molecule', 'Atom size': 'Atom size drawn', 'UGT1A1 exons': 'Gene pieces' };   // plain words for the card
  for (const r of readouts) if (!r.plain && PLAIN[r.label]) r.plain = PLAIN[r.label];
  const setEnv = radiationRow(readouts);
  if (opts.env) setEnv(opts.env);
  if (opts.view !== undefined) setView(opts.view);

  return {
    scene,
    camera: { position: cpos.toArray(), target: [0, 0, 0], fov: 40 },
    labels, info, readouts, controls, gene, views, setView, setEnv,
    update() {},
    dispose() {
      scene.traverse((o) => { o.geometry?.dispose?.(); const mt = o.material; (Array.isArray(mt) ? mt : mt ? [mt] : []).forEach((x) => x.dispose?.()); });
    },
  };
}
