// Cell level, blood (quantum-dot renin sensor): red blood cells in plasma. Each cell is the Evans and Fung (1972)
// biconcave shape with its published coefficients (data/bio/cells.json); the crowding cube comes from a real astronaut
// blood count (Inspiration4 crew C001, NASA OSDR OSD-569). Scene units: micrometres. Cell positions are illustrative.
import * as THREE from 'three';

const UM = 'µm', UM3 = 'µm³';
export const DATA = ['bio/cells'];
export const LEVEL = { id: 'cell_rbc', site: 'blood', level: 'cell', title: 'Red blood cells in plasma', unit: UM, scaleBar: { length: 5, label: `5 ${UM}` } };

const C = { ink: '#e1e5d6', muted: '#8e9684', accent: '#a9d48c', light: '#b9c0ab' };
const num = (v) => (v && typeof v.value === 'number' ? v.value : null);
const fmt = (x, d = 2) => Number(x).toLocaleString('en-US', { maximumFractionDigits: d });
const tagOf = (v) => (!v ? '' : v.status === 'VERIFIED' ? v.tag : `${v.tag}, ${String(v.status).toLowerCase().replace(/_/g, ' ')}`);
function rng(seed) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function build(D) {
  const r = D['bio/cells']?.rbc;
  const scene = new THREE.Scene();
  scene.background = null;
  scene.add(new THREE.HemisphereLight(0xe1e5d6, 0x1c1f19, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(0.5, 1, 0.9); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.45); fill.position.set(-0.7, -0.3, -0.6); scene.add(fill);

  const R0 = num(r?.R0), C0 = num(r?.C0), C2 = num(r?.C2), C4 = num(r?.C4);
  if ([R0, C0, C2, C4].some((x) => x === null)) {
    return { scene, camera: { position: [0, 0, 30], target: [0, 0, 0], fov: 40 }, labels: [], readouts: [],
      info: { title: 'Evans-Fung coefficients not loaded', lines: ['data/bio/cells.json lacks one of R0, C0, C2, C4; no cell is drawn. Run scripts/build_bio.py.'], sources: [], lean: [] },
      update() {}, dispose() {} };
  }
  // half-thickness z(r) = 1/2 sqrt(1-(r/R0)^2) (C0 + C2 (r/R0)^2 + C4 (r/R0)^4), sampled with r = R0 sin(th)
  const halfZ = (s) => 0.5 * Math.sqrt(Math.max(0, 1 - s * s)) * (C0 + C2 * s * s + C4 * s ** 4);
  const NP = 64, prof = [];
  for (let k = 0; k <= NP; k++) { const s = Math.sin((k / NP) * Math.PI / 2); prof.push([R0 * s, -halfZ(s)]); }        // lower face, centre -> rim
  for (let k = NP - 1; k >= 0; k--) { const s = Math.sin((k / NP) * Math.PI / 2); prof.push([R0 * s, halfZ(s)]); }       // upper face, rim -> centre
  const cellGeo = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 96);
  const mainMat = new THREE.MeshStandardMaterial({ color: C.ink, roughness: 0.5, metalness: 0, side: THREE.DoubleSide });
  const otherMat = new THREE.MeshStandardMaterial({ color: C.light, roughness: 0.6, metalness: 0, side: THREE.DoubleSide });

  // ---- the main cell, tilted so its dimple faces the camera
  const main = new THREE.Mesh(cellGeo, mainMat);
  main.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0.55, 0.835).normalize());
  scene.add(main);

  // ---- Evans-Fung section, true size, drawn below the main cell
  const secY = -(R0 + 4.6);
  const sec = [];
  for (const [x, y] of prof) sec.push(new THREE.Vector3(x, y + secY, 0));
  for (let k = prof.length - 1; k >= 0; k--) sec.push(new THREE.Vector3(-prof[k][0], prof[k][1] + secY, 0));
  const secGeo = new THREE.BufferGeometry().setFromPoints(sec);
  scene.add(new THREE.Line(secGeo, new THREE.LineBasicMaterial({ color: C.accent })));
  // centre-thickness and thickest-point ticks on the section
  const tMax = num(r.thickness_max), rAt = num(r.r_at_thickness_max);
  const ticks = [new THREE.Vector3(0, secY - C0 / 2, 0), new THREE.Vector3(0, secY + C0 / 2, 0)];
  if (tMax && rAt) ticks.push(new THREE.Vector3(rAt, secY - tMax / 2, 0), new THREE.Vector3(rAt, secY + tMax / 2, 0));
  scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ticks), new THREE.LineBasicMaterial({ color: C.ink })));

  // ---- crowding cube: the mean blood volume per red cell from crew C001's count (calculated)
  const a = num(r.cube_side);
  const obstacles = [[new THREE.Vector3(0, 0, 0), R0 + 0.5], [new THREE.Vector3(0, secY, 0), R0 + 0.6]];
  let cubePos = null;
  if (a) {
    cubePos = new THREE.Vector3(R0 + 2.2 + a / 2, 0, 0);
    const box = new THREE.BoxGeometry(a, a, a);
    const cube = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: C.accent, transparent: true, opacity: 0.07, depthWrite: false }));
    cube.position.copy(cubePos); scene.add(cube);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: C.accent }));
    edges.position.copy(cubePos); scene.add(edges);
    obstacles.push([cubePos.clone(), a * 0.87 + 0.4]);
  }

  // ---- neighbouring cells: same shape, illustrative positions and tilts (sparser than real blood), never overlapping
  const rand = rng(5280);
  const placed = [];
  for (let tries = 0; tries < 4000 && placed.length < 9; tries++) {
    const p = new THREE.Vector3(-24 + 48 * rand(), -15 + 28 * rand(), -18 + 15 * rand());
    if (obstacles.some(([c, rr]) => p.distanceTo(c) < rr + R0 + 0.3)) continue;
    if (placed.some((q) => q.distanceTo(p) < 2 * R0 + 0.5)) continue;
    placed.push(p);
    const m = new THREE.Mesh(cellGeo, otherMat);
    m.position.copy(p);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize());
    scene.add(m);
  }

  // ---- labels
  const crew = r.crew || {};
  const labels = [
    { position: [0, R0 * 0.75, 0], text: `Red blood cell · Evans–Fung shape, ${fmt(num(r.diameter) ?? 2 * R0)} ${UM} across` },
    { position: [0, secY, 0], text: `Section: ${fmt(C0)} ${UM} at the centre` },
  ];
  if (tMax && rAt) labels.push({ position: [rAt, secY + tMax / 2, 0], text: `${fmt(tMax)} ${UM} thickest, at r = ${fmt(rAt)} ${UM}` });
  if (cubePos) labels.push({ position: [cubePos.x, a / 2 + 0.3, 0], text: `Blood volume per red cell: ${fmt(num(r.blood_volume_per_cell), 1)} ${UM3}` });
  labels.push({ position: [-11, 8, 2], text: 'Plasma: renin acts here' });

  // ---- text
  const cnt = crew.rbc_count, mcv = crew.mcv, hct = crew.hematocrit;
  const ms = D['bio/cells']?.meta?.sources || [];
  const pick = (k) => ms.find((s) => s.startsWith(k));
  const info = {
    title: 'Red blood cells in plasma · Evans–Fung (1972) shape',
    lines: [
      `Each cell is the Evans and Fung (1972) biconcave disc: half-thickness z(r) = ½√(1 − (r/R0)²)·(C0 + C2(r/R0)² + C4(r/R0)⁴) with R0 = ${R0} ${UM}, C0 = ${C0} ${UM}, C2 = ${C2} ${UM}, C4 = ${C4} ${UM}. Checked against open-access texts: Evans and Fung's mean diameter 7.82 ${UM} (tabulated in Cells 2022) and their dimensionless coefficients (Sraj et al. 2010) times R0; also quoted directly by Dodson & Dimitrakopoulos (2010).`,
      `From the equation (calculated): ${fmt(num(r.diameter))} ${UM} across, ${fmt(C0)} ${UM} at the centre, thickest ${fmt(tMax)} ${UM} at r = ${fmt(rAt)} ${UM}, volume ${fmt(num(r.volume), 1)} ${UM3}, surface ${fmt(num(r.area), 1)} ${UM}². The green outline below the cell is the true-size section.`,
      cnt?.value ? `Crowding: Inspiration4 crew ${crew.subject}'s first post-flight count (${crew.timepoint}, NASA OSDR OSD-569) was ${cnt.value} million red cells per µL, so each cell has on average ${fmt(num(r.blood_volume_per_cell), 1)} ${UM3} of blood: the cube, ${fmt(a)} ${UM} a side (calculated). Haematocrit ${hct?.value}%, mean cell volume ${mcv?.value} fL (recorded; the Evans–Fung volume is ${fmt(num(r.volume), 1)} ${UM3}).` : 'No crew blood count loaded; the crowding cube is not drawn.',
      'Positions and tilts of the neighbouring cells are illustrative and much sparser than blood; real cells also deform and stack. Colours are display colours.',
      num(r.diameter_in_autologous_plasma) ? `Evans and Fung measured cells in buffered saline (50 cells, one donor). In autologous plasma red cells measured ${fmt(num(r.diameter_in_autologous_plasma), 3)} ${UM} across on average (4,882 cells, 8 donors; Cells 2022); that shape is not drawn because no equation with coefficients is given for it.` : '',
      r.plasma_role?.value ? `Plasma: “${r.plasma_role.value.split(', initiating')[0]}” (UniProt P00797). The quantum-dot sensor measures renin activity (next level).` : '',
    ].filter(Boolean),
    sources: [r.R0?.source?.replace(/ \(Evans-Fung shape: R0\)$/, ''), r.diameter_in_autologous_plasma?.source, pick('Sraj'), pick('Dodson'), pick('Hosseini'), cnt?.source, crew.terms, r.plasma_role?.source].filter(Boolean),
    lean: [],
  };
  const readouts = [
    { label: 'Diameter', value: num(r.diameter), unit: UM, tag: tagOf(r.diameter), source: '2 R0, Evans & Fung' },
    { label: 'Centre / thickest', value: `${fmt(C0)} / ${fmt(tMax)}`, unit: UM, tag: 'calculated', source: 'Evans–Fung equation' },
    { label: 'Volume', value: num(r.volume), unit: UM3, tag: tagOf(r.volume), source: 'Evans–Fung equation' },
    { label: 'Surface area', value: num(r.area), unit: `${UM}²`, tag: tagOf(r.area), source: 'Evans–Fung equation' },
    { label: `RBC count, crew ${crew.subject || ''} ${crew.timepoint || ''}`, value: cnt?.value ?? '-', unit: cnt?.unit || '', tag: tagOf(cnt), source: 'NASA OSDR OSD-569' },
    { label: 'Mean cell volume (MCV)', value: mcv?.value ?? '-', unit: mcv?.unit || '', tag: tagOf(mcv), source: 'NASA OSDR OSD-569' },
    { label: 'Haematocrit', value: hct?.value ?? '-', unit: hct?.unit || '', tag: tagOf(hct), source: 'NASA OSDR OSD-569' },
    { label: 'Blood per red cell', value: num(r.blood_volume_per_cell) ?? '-', unit: UM3, tag: tagOf(r.blood_volume_per_cell), source: '1 / RBC count' },
  ];

  return {
    scene,
    camera: { position: [5, 5, 31], target: [3, -3, 0], fov: 40 },
    labels, info, readouts,
    update() {},
    dispose() {
      scene.traverse((o) => { o.geometry?.dispose?.(); const mt = o.material; (Array.isArray(mt) ? mt : mt ? [mt] : []).forEach((x) => x.dispose?.()); });
    },
  };
}
