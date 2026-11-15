// Molecule level, blood (quantum-dot renin sensor): human renin, crystal structure PDB 2REN (CC0), reused from
// data/molecules/renin_2ren.json (C-alpha trace, HELIX/SHEET secondary structure, UniProt P00797 catalytic aspartates),
// plus the REN exon structure from Ensembl (data/bio/genes.json). Scene units: angstrom.
import * as THREE from 'three';

const ANG = 'Å';
export const DATA = ['molecules/renin_2ren', 'bio/genes', 'specs'];
export const LEVEL = { id: 'mol_renin', site: 'blood', level: 'molecule', title: 'Renin', unit: ANG, scaleBar: { length: 10, label: `10 ${ANG}` } };

const SS = { H: '#a9d48c', E: '#e1e5d6', C: '#8e9684' };   // display colours (theme): helix, strand, coil
const TUBE = 0.5;                                          // display radius of the C-alpha tube (angstrom)

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
    const tub = seg.length * 6, rad = 8;
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
const cap = (s) => s.charAt(0) + s.slice(1).toLowerCase();

// "Sielecki AR et al., Science 243:1346 (1989), PubMed 2493678" from the PDB JRNL records kept in the JSON
function pdbCitation(j) {
  const get = (k) => (j || []).filter((l) => l.startsWith(`${k} `)).map((l) => l.slice(k.length).replace(/^\s*\d?\s+/, '').trim()).join(' ');
  const first = (get('AUTH').split(',')[0] || '').trim();
  const m = first.match(/^((?:[A-Z]\.)+)([A-Z' -]+)$/);
  const author = m ? `${cap(m[2])} ${m[1].replace(/\./g, '')}` : first;
  const ref = get('REF').match(/^(.+?)\s+V\.\s*(\d+)\s+(\w+)\s+(\d{4})$/);
  const journal = ref ? `${ref[1].split(' ').map(cap).join(' ')} ${ref[2]}:${ref[3]} (${ref[4]})` : get('REF');
  const pmid = get('PMID');
  return `${author} et al., ${journal}${pmid ? `, PubMed ${pmid}` : ''}`;
}

export function build(D) {
  const ren = D['molecules/renin_2ren'];
  const g = D['bio/genes']?.genes?.REN;
  const qd = D.specs?.qd_renin;
  const scene = new THREE.Scene();
  scene.background = null;
  scene.add(new THREE.HemisphereLight(0xe1e5d6, 0x1c1f19, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(0.4, 0.8, 1); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-0.6, -0.5, -0.7); scene.add(fill);
  if (!ren?.ca?.length) {
    return { scene, camera: { position: [0, 0, 120], target: [0, 0, 0], fov: 40 }, labels: [], readouts: [],
      info: { title: 'Renin structure not loaded', lines: ['data/molecules/renin_2ren.json did not load; run scripts/build_molecules.py.'], sources: [], lean: [] }, update() {}, dispose() {} };
  }
  const ca = ren.ca;
  const c0 = new THREE.Vector3(); ca.forEach((r) => c0.add(new THREE.Vector3(r[3], r[4], r[5]))); c0.divideScalar(ca.length);
  const pts = ca.map((r) => new THREE.Vector3(r[3], r[4], r[5]).sub(c0));
  const cols = Object.fromEntries(Object.entries(SS).map(([k, v]) => [k, new THREE.Color(v)]));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 });
  for (const m of traceMeshes(pts, ca, (i) => cols[ca[i][6]] || cols.C, mat)) scene.add(m);

  // ---- catalytic aspartates from UniProt P00797, mapped onto the PDB chain in build_molecules.py
  const labels = [];
  const sm = new THREE.MeshStandardMaterial({ color: '#e1e5d6', emissive: '#e1e5d6', emissiveIntensity: 0.45 });
  const sg = new THREE.SphereGeometry(1.5, 22, 16);
  for (const s of ren.active_sites || []) {
    const p = pts[s.index]; if (!p) continue;
    const b = new THREE.Mesh(sg, sm); b.position.copy(p); scene.add(b);
    labels.push({ position: p.toArray(), text: `${cap(s.pdb_name)}${s.pdb_residue} · catalytic (UniProt ${cap(s.uniprot_residue === 'D' ? 'ASP' : s.uniprot_residue)}${s.uniprot_position})` });
  }
  let maxR = 0; for (const p of pts) maxR = Math.max(maxR, p.length());
  const dist = (maxR / Math.tan(THREE.MathUtils.degToRad(20))) * 1.05;
  const cpos = new THREE.Vector3(0.25, 0.2, 1).normalize().multiplyScalar(dist);

  const gene = g ? { symbol: g.symbol, chrom: g.chrom, start: g.start, end: g.end, strand: g.strand, exons: g.exon_coords, transcript: g.canonical_transcript } : undefined;
  const mane = (g?.mane || []).map((m) => m.refseq).filter(Boolean).join(', ');
  const info = {
    title: `Renin · PDB ${ren.pdb_id} · gene REN`,
    lines: [
      `Human renin, recombinant, X-ray crystal structure at ${ren.resolution_A} ${ANG} (PDB ${ren.pdb_id}; ${pdbCitation(ren.journal)}). C-alpha trace of ${fmt(ren.n_residues)} residues; secondary structure from the file's HELIX and SHEET records (helix green, strand light, coil grey).`,
      `Bright spheres: the two catalytic aspartates (UniProt P00797 active sites, positions ${(ren.active_sites || []).map((s) => s.uniprot_position).join(' and ')} of the precursor), matched to the PDB chain by sequence context.`,
      g?.function?.value ? `Function: “${g.function.value.split(', initiating')[0]}” (UniProt P00797).` : '',
      qd?.mechanism?.value ? `What the quantum-dot sensor sees: ${qd.mechanism.value} (Long et al. 2012).` : '',
      'The tube follows the C-alpha path; its thickness and the sphere sizes are display choices, not atom sizes.',
      g ? `Gene REN: chr${g.chrom}:${fmt(g.start)}–${fmt(g.end)} (${g.strand > 0 ? '+' : '−'} strand, ${D['bio/genes'].assembly}), ${g.n_exons} exons in ${g.canonical_transcript}${mane ? ` (MANE Select ${mane})` : ''}; protein ${g.translation?.length_aa} aa.` : 'Gene data not loaded.',
    ].filter(Boolean),
    sources: [...(ren.meta?.sources || []), qd?.mechanism?.source, g ? `Ensembl REST API, release ${D['bio/genes'].ensembl_release}, ${g.ensembl_gene_id}` : null].filter(Boolean),
    lean: [],
  };
  const readouts = [
    { label: 'Structure', value: ren.pdb_id, unit: '', tag: 'recorded', source: 'RCSB PDB' },
    { label: 'Resolution', value: ren.resolution_A, unit: ANG, tag: 'recorded', source: ren.method },
    { label: 'Residues (C-alpha)', value: ren.n_residues, unit: '', tag: 'recorded', source: `chain ${(ren.chains || []).join(', ')}` },
    { label: 'Helix / strand residues', value: `${ren.helix_residues} / ${ren.strand_residues}`, unit: '', tag: 'recorded', source: 'HELIX / SHEET records' },
    g ? { label: 'REN exons', value: g.n_exons, unit: '', tag: 'recorded', source: `Ensembl ${D['bio/genes'].ensembl_release}` } : null,
    qd?.detection_limit?.value ? { label: 'Sensor detection limit', value: qd.detection_limit.value, unit: qd.detection_limit.unit, tag: qd.detection_limit.tag, source: 'Long et al. 2012' } : null,
  ].filter(Boolean);
  return {
    scene,
    camera: { position: cpos.toArray(), target: [0, 0, 0], fov: 40 },
    labels, info, readouts, gene,
    update() {},
    dispose() {
      scene.traverse((o) => { o.geometry?.dispose?.(); const mt = o.material; (Array.isArray(mt) ? mt : mt ? [mt] : []).forEach((x) => x.dispose?.()); });
    },
  };
}
