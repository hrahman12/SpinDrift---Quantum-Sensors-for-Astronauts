// Cell level, blood (quantum-dot renin sensor): red blood cells in plasma. Each cell is the Evans and Fung (1972)
// biconcave shape with its published coefficients (data/bio/cells.json); the crowding cube comes from a real astronaut
// blood count (Inspiration4 crew C001, NASA OSDR OSD-569). Scene units: micrometres. Cell positions are illustrative.
// Views: drop (a 5 mm cube of whole blood, one colour, with the number of red cells it holds), slice (a slice one
// cell thick with every cell the crew count puts in it) and edge (the rim of one cell with plasma beside it).
import * as THREE from 'three';

const UM = 'µm', UM3 = 'µm³';
export const DATA = ['bio/cells'];
export const LEVEL = { id: 'cell_rbc', site: 'blood', level: 'cell', title: 'Red blood cells in plasma', unit: UM, scaleBar: { length: 5, label: `5 ${UM}` } };

const C = { ink: '#e1e5d6', muted: '#8e9684', accent: '#a9d48c', light: '#b9c0ab' };
const BLOOD = '#a3302b';                // display colour of blood and of the cells in the views (not computed from a spectrum)
// Display choices of the views (stated in the info panel and in each view's note)
const VIEW = {
  cube: 5000,                           // µm: side of the cube of whole blood in the 5.00 mm view
  slabW: 1400, slabH: 720,              // µm: extent of the drawn slice, a little more than a 600 µm view shows
  gap: 0.25,                            // µm: least plasma kept between two drawn cells
  gapMain: 2.2,                         // µm: clear plasma kept around the cell whose rim the 1.00 µm view shows
  sides: 10,                            // sides of each low-polygon cell in the slice
  tol: 0.05,                            // µm: the packing stops when no pair is closer than (diameter + gap) by more than this
};
const num = (v) => (v && typeof v.value === 'number' ? v.value : null);
const fmt = (x, d = 2) => Number(x).toLocaleString('en-US', { maximumFractionDigits: d });
const tagOf = (v) => (!v ? '' : v.status === 'VERIFIED' ? v.tag : `${v.tag}, ${String(v.status).toLowerCase().replace(/_/g, ' ')}`);
const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
function rng(seed) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Halton low-discrepancy sequence: deterministic, evenly spread starting positions (never Math.random)
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

// Illustrative, deterministic positions for N discs in a W × H rectangle (periodic edges): Halton (bases 2 and 3)
// start, then every pair closer than dmin is pushed apart until none is left. Disc 0 stays at the origin and keeps
// dMain of clearance. Returns the positions and the smallest centre spacing left (checked in a last pass).
function packSlab(N, W, H, dmin, dMain, tol, maxIter = 300) {
  const x = new Float64Array(N), z = new Float64Array(N);
  for (let i = 1; i < N; i++) { x[i] = (halton(i, 2) - 0.5) * W; z[i] = (halton(i, 3) - 0.5) * H; }
  const nx = Math.max(3, Math.floor(W / dmin)), nz = Math.max(3, Math.floor(H / dmin)), gx = nx / W, gz = nz / H;
  const head = new Int32Array(nx * nz), next = new Int32Array(N), cxs = new Int32Array(N), czs = new Int32Array(N);
  const d2min = dmin * dmin, hw = W / 2, hh = H / 2, dM2 = dMain * dMain;
  const NB = [0, 0, 1, 0, -1, 1, 0, 1, 1, 1];           // this grid cell and half of its neighbours: each pair once
  const grid = () => {
    head.fill(-1);
    for (let i = 1; i < N; i++) {
      let cx = ((x[i] + hw) * gx) | 0, cz = ((z[i] + hh) * gz) | 0;
      if (cx >= nx) cx = nx - 1; if (cz >= nz) cz = nz - 1; if (cx < 0) cx = 0; if (cz < 0) cz = 0;
      cxs[i] = cx; czs[i] = cz; const c = cx + nx * cz; next[i] = head[c]; head[c] = i;
    }
  };
  // visits every pair of discs in neighbouring grid cells; `push` moves them apart, otherwise the spacing is only measured
  const sweep = (push) => {
    let worst = 0, least = Infinity;
    for (let i = 1; i < N; i++) {
      for (let q = 0; q < 10; q += 2) {
        let ax = cxs[i] + NB[q], az = czs[i] + NB[q + 1];
        if (ax >= nx) ax -= nx; else if (ax < 0) ax += nx;
        if (az >= nz) az -= nz;
        for (let j = head[ax + nx * az]; j >= 0; j = next[j]) {
          if (q === 0 && j <= i) continue;
          let dx = x[i] - x[j], dz = z[i] - z[j];
          if (dx > hw) dx -= W; else if (dx < -hw) dx += W;
          if (dz > hh) dz -= H; else if (dz < -hh) dz += H;
          const d2 = dx * dx + dz * dz;
          if (d2 < least) least = d2;
          if (!push || d2 >= d2min) continue;
          const d = Math.sqrt(d2), move = (dmin - d) / 2 + 1e-4, ux = d > 1e-9 ? dx / d : 1, uz = d > 1e-9 ? dz / d : 0;
          if (dmin - d > worst) worst = dmin - d;
          x[i] += ux * move; z[i] += uz * move; x[j] -= ux * move; z[j] -= uz * move;
        }
      }
    }
    for (let i = 1; i < N; i++) {
      let xi = x[i], zi = z[i];
      const r2 = xi * xi + zi * zi;
      if (r2 < least) least = r2;
      if (push) {
        if (r2 < dM2) {                                   // keep clear plasma around the cell the 1 µm view visits
          const r = Math.sqrt(r2); if (dMain - r > worst) worst = dMain - r;
          if (r > 1e-9) { const k = (dMain + 1e-4) / r; xi *= k; zi *= k; } else { xi = dMain; zi = 0; }
        }
        if (xi >= hw) xi -= W; else if (xi < -hw) xi += W;
        if (zi >= hh) zi -= H; else if (zi < -hh) zi += H;
        x[i] = xi; z[i] = zi;
      }
    }
    return { worst, least: Math.sqrt(least) };
  };
  let iter = 0, worst = Infinity;
  for (; iter < maxIter && worst > tol; iter++) { grid(); worst = sweep(true).worst; }
  grid();
  return { x, z, iter, minSpacing: sweep(false).least };
}

// One Evans-Fung cell with few polygons, for the thousands of cells of the slice: the centre, the ring of greatest
// thickness and the rim, top and bottom (6 × sides triangles, facing outward). The axis is y, as for the full cell.
function lowPolyCell(R0, rm, zc, zm, S) {
  const pos = [0, zc, 0];
  for (const [rr, y] of [[rm, zm], [R0, 0], [rm, -zm]]) for (let k = 0; k < S; k++) { const a = (k / S) * Math.PI * 2; pos.push(rr * Math.cos(a), y, rr * Math.sin(a)); }
  pos.push(0, -zc, 0);
  const T = (k) => 1 + (k % S), E = (k) => 1 + S + (k % S), B = (k) => 1 + 2 * S + (k % S), bc = 3 * S + 1, idx = [];
  for (let k = 0; k < S; k++) {
    idx.push(0, T(k + 1), T(k));
    idx.push(T(k), T(k + 1), E(k + 1), T(k), E(k + 1), E(k));
    idx.push(B(k), E(k + 1), B(k + 1), B(k), E(k), E(k + 1));
    idx.push(bc, B(k), B(k + 1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
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
  const r = D['bio/cells']?.rbc;
  const inViews = opts.view !== undefined;          // built for the descent: labels and text are written for its views
  const scene = new THREE.Scene();
  scene.background = null;
  scene.add(new THREE.HemisphereLight(0xe1e5d6, 0x1c1f19, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(0.5, 1, 0.9); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.45); fill.position.set(-0.7, -0.3, -0.6); scene.add(fill);

  const R0 = num(r?.R0), C0 = num(r?.C0), C2 = num(r?.C2), C4 = num(r?.C4);
  if ([R0, C0, C2, C4].some((x) => x === null)) {
    const readouts = [], msg = 'data/bio/cells.json lacks one of R0, C0, C2, C4; no cell is drawn. Run scripts/build_bio.py.';
    const v = { target: [0, 0, 0], dir: [0, 0, 1], note: msg };
    return { scene, camera: { position: [0, 0, 30], target: [0, 0, 0], fov: 40 }, labels: [], readouts,
      info: { title: 'Evans-Fung coefficients not loaded', lines: [msg], sources: [], lean: [] },
      views: { drop: v, slice: { ...v }, edge: { ...v } }, setView() {}, setEnv: radiationRow(readouts), update() {}, dispose() {} };
  }
  // half-thickness z(r) = 1/2 sqrt(1-(r/R0)^2) (C0 + C2 (r/R0)^2 + C4 (r/R0)^4), sampled with r = R0 sin(th)
  const halfZ = (s) => 0.5 * Math.sqrt(Math.max(0, 1 - s * s)) * (C0 + C2 * s * s + C4 * s ** 4);
  const NP = 64, prof = [];
  for (let k = 0; k <= NP; k++) { const s = Math.sin((k / NP) * Math.PI / 2); prof.push([R0 * s, -halfZ(s)]); }        // lower face, centre -> rim
  for (let k = NP - 1; k >= 0; k--) { const s = Math.sin((k / NP) * Math.PI / 2); prof.push([R0 * s, halfZ(s)]); }       // upper face, rim -> centre
  const cellGeo = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 96);
  const mainMat = new THREE.MeshStandardMaterial({ color: C.ink, roughness: 0.5, metalness: 0, side: THREE.DoubleSide });
  const otherMat = new THREE.MeshStandardMaterial({ color: C.light, roughness: 0.6, metalness: 0, side: THREE.DoubleSide });
  const legacy = new THREE.Group();                // what the scene shows when no view is asked for; hidden in the views
  scene.add(legacy);

  // ---- the main cell, tilted so its dimple faces the camera (in the views it lies flat, facing +z, like every cell)
  const main = new THREE.Mesh(cellGeo, mainMat);
  const qTilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0.55, 0.835).normalize());
  const qFlat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
  main.quaternion.copy(qTilt);
  scene.add(main);

  // ---- Evans-Fung section, true size, drawn below the main cell
  const secY = -(R0 + 4.6);
  const sec = [];
  for (const [x, y] of prof) sec.push(new THREE.Vector3(x, y + secY, 0));
  for (let k = prof.length - 1; k >= 0; k--) sec.push(new THREE.Vector3(-prof[k][0], prof[k][1] + secY, 0));
  const secGeo = new THREE.BufferGeometry().setFromPoints(sec);
  legacy.add(new THREE.Line(secGeo, new THREE.LineBasicMaterial({ color: C.accent })));
  // centre-thickness and thickest-point ticks on the section
  const tMax = num(r.thickness_max), rAt = num(r.r_at_thickness_max);
  const ticks = [new THREE.Vector3(0, secY - C0 / 2, 0), new THREE.Vector3(0, secY + C0 / 2, 0)];
  if (tMax && rAt) ticks.push(new THREE.Vector3(rAt, secY - tMax / 2, 0), new THREE.Vector3(rAt, secY + tMax / 2, 0));
  legacy.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ticks), new THREE.LineBasicMaterial({ color: C.ink })));

  // ---- crowding cube: the mean blood volume per red cell from crew C001's count (calculated)
  const a = num(r.cube_side);
  const obstacles = [[new THREE.Vector3(0, 0, 0), R0 + 0.5], [new THREE.Vector3(0, secY, 0), R0 + 0.6]];
  let cubePos = null;
  if (a) {
    cubePos = new THREE.Vector3(R0 + 2.2 + a / 2, 0, 0);
    const box = new THREE.BoxGeometry(a, a, a);
    const cube = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: C.accent, transparent: true, opacity: 0.07, depthWrite: false }));
    cube.position.copy(cubePos); legacy.add(cube);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: C.accent }));
    edges.position.copy(cubePos); legacy.add(edges);
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
    legacy.add(m);
  }

  // ---- the views' numbers, all calculated from the same crew count and the Evans-Fung shape
  const crew = r.crew || {};
  const cnt = crew.rbc_count, mcv = crew.mcv, hct = crew.hematocrit;
  const perUm3 = typeof cnt?.value === 'number' ? cnt.value * 1e-3 : null;               // million per µL = 1e6 per 1e9 µm³
  let tCell = tMax, rCell = rAt;                                                          // the cell's greatest thickness and where it is
  if (!tCell || !rCell) { tCell = 0; for (let k = 0; k <= 2000; k++) { const s = k / 2000; if (2 * halfZ(s) > tCell) { tCell = 2 * halfZ(s); rCell = R0 * s; } } }
  const inCube = perUm3 === null ? null : Math.round(cnt.value * 1e6 * (VIEW.cube / 1000) ** 3);   // 1 µL = 1 mm³
  const nSlab = perUm3 === null ? 0 : Math.round(perUm3 * VIEW.slabW * VIEW.slabH * tCell);
  const spacingRO = { label: 'Smallest centre spacing drawn in the slice', value: 'not built', unit: '', tag: 'calculated', source: `checked after the packing; a cell is ${fmt(2 * R0)} ${UM} across` };

  // ---- the views' content, built once (at build when a view is asked for, else the first time one is shown)
  const extra = [];                                // materials and geometries that are not always attached to the scene
  let vw = null;
  function ensureViews() {
    if (vw) return vw;
    const g = new THREE.Group();
    scene.add(g);
    const redMain = new THREE.MeshStandardMaterial({ color: BLOOD, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
    extra.push(redMain);
    // the cube of whole blood: one colour, because at this scale a cell is smaller than a pixel. Its front face is
    // the front of the slice (z = +tCell / 2), so the slice is the cube's first layer of cells.
    const box = new THREE.BoxGeometry(VIEW.cube, VIEW.cube, VIEW.cube);
    const cube = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: BLOOD, roughness: 0.75, metalness: 0 }));
    cube.position.set(0, 0, tCell / 2 - VIEW.cube / 2);
    const cubeEdges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: C.accent, transparent: true, opacity: 0.7 }));
    cubeEdges.position.copy(cube.position);
    g.add(cube, cubeEdges);
    // the slice: every cell the count puts in it, lying flat (the main cell is one of them)
    let slab = null, outline = null;
    if (nSlab > 1) {
      const pk = packSlab(nSlab, VIEW.slabW, VIEW.slabH, 2 * R0 + VIEW.gap, 2 * R0 + VIEW.gapMain, VIEW.tol);
      slab = new THREE.InstancedMesh(lowPolyCell(R0, rCell, halfZ(0), tCell / 2, VIEW.sides), new THREE.MeshStandardMaterial({ color: BLOOD, roughness: 0.55, metalness: 0 }), nSlab - 1);
      const M = new THREE.Matrix4(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
      for (let i = 1; i < nSlab; i++) slab.setMatrixAt(i - 1, M.compose(p.set(pk.x[i], pk.z[i], 0), qFlat, one));
      slab.instanceMatrix.needsUpdate = true;
      slab.computeBoundingSphere();
      const ob = new THREE.BoxGeometry(VIEW.slabW, VIEW.slabH, tCell);
      outline = new THREE.LineSegments(new THREE.EdgesGeometry(ob), new THREE.LineBasicMaterial({ color: C.accent, transparent: true, opacity: 0.5 }));
      ob.dispose();
      g.add(slab, outline);
      spacingRO.value = Number(pk.minSpacing.toFixed(3)); spacingRO.unit = UM;
    }
    // 1 µL = 1 mm³: the unit of the crew count, at true size in the near corner of the cube
    const ul = new THREE.BoxGeometry(1000, 1000, 1000);
    const ulEdges = new THREE.LineSegments(new THREE.EdgesGeometry(ul), new THREE.LineBasicMaterial({ color: C.ink }));
    ul.dispose(); ulEdges.position.set(VIEW.cube / 2 - 500, VIEW.cube / 2 - 500, tCell / 2 - 500 + 2); g.add(ulEdges);
    // spun down: the haematocrit as a column beside the cube (cells below, plasma above), recorded share
    let column = null;
    if (typeof hct?.value === 'number') {
      column = new THREE.Group(); const hc = hct.value / 100, H = VIEW.cube, wc = 900;
      const cellsBox = new THREE.Mesh(new THREE.BoxGeometry(wc, H * hc, wc), new THREE.MeshStandardMaterial({ color: BLOOD, roughness: 0.7 }));
      cellsBox.position.set(0, -H / 2 + (H * hc) / 2, 0);
      const plasmaBox = new THREE.Mesh(new THREE.BoxGeometry(wc, H * (1 - hc), wc), new THREE.MeshStandardMaterial({ color: '#d8c98f', roughness: 0.6, transparent: true, opacity: 0.55, depthWrite: false }));
      plasmaBox.position.set(0, H / 2 - (H * (1 - hc)) / 2, 0);
      column.add(cellsBox, plasmaBox); column.position.set(VIEW.cube / 2 + 1100, 0, tCell / 2 - wc / 2); g.add(column);
      extra.push(cellsBox.material, plasmaBox.material);
    }
    vw = { g, cube, cubeEdges, slab, outline, redMain, ulEdges, column };
    return vw;
  }

  // ---- labels (the host reads them once; built for the descent they sit where its views can see them)
  const labels = inViews ? [
    { position: [R0 - 0.15, 0, 0], text: `Red blood cell · Evans–Fung shape, ${fmt(num(r.diameter) ?? 2 * R0)} ${UM} across` },
    { position: [R0 + 0.42, -0.12, 0], text: 'Plasma: renin acts here' },
    { position: [VIEW.cube / 2, VIEW.cube / 2, tCell / 2], text: inCube ? `Whole blood: a 5 mm cube holds ${inCube.toLocaleString('en-US')} red cells (calculated)` : 'Whole blood: a 5 mm cube (no blood count loaded)' },
    { position: [-VIEW.slabW / 5, VIEW.slabH / 5, tCell / 2], text: nSlab ? `A slice one cell thick: ${nSlab.toLocaleString('en-US')} cells at the crew's count (calculated; positions illustrative)` : 'A slice one cell thick (no blood count loaded)' },
    { position: [VIEW.cube / 2 - 1000, VIEW.cube / 2 - 1000, tCell / 2], text: cnt?.value ? `1 µL: ${cnt.value} million red cells` : '1 µL' },
    { position: [VIEW.cube / 2 + 1100, -VIEW.cube / 2 - 250, 0], text: typeof hct?.value === 'number' ? `spun down: ${hct.value} % cells` : 'spun down' },
  ] : [
    { position: [0, R0 * 0.75, 0], text: `Red blood cell · Evans–Fung shape, ${fmt(num(r.diameter) ?? 2 * R0)} ${UM} across` },
    { position: [0, secY, 0], text: `Section: ${fmt(C0)} ${UM} at the centre` },
  ];
  if (!inViews) {
    if (tMax && rAt) labels.push({ position: [rAt, secY + tMax / 2, 0], text: `${fmt(tMax)} ${UM} thickest, at r = ${fmt(rAt)} ${UM}` });
    if (cubePos) labels.push({ position: [cubePos.x, a / 2 + 0.3, 0], text: `Blood volume per red cell: ${fmt(num(r.blood_volume_per_cell), 1)} ${UM3}` });
    labels.push({ position: [-11, 8, 2], text: 'Plasma: renin acts here' });
  }

  // ---- text
  const ms = D['bio/cells']?.meta?.sources || [];
  const pick = (k) => ms.find((s) => s.startsWith(k));
  const crowd = cnt?.value
    ? `Crowding: Inspiration4 crew ${crew.subject}'s first post-flight count (${crew.timepoint}, NASA OSDR OSD-569) was ${cnt.value} million red cells per µL, so each cell has on average ${fmt(num(r.blood_volume_per_cell), 1)} ${UM3} of blood: ${inViews ? 'a cube' : 'the cube,'} ${fmt(a)} ${UM} a side (calculated). Haematocrit ${hct?.value}%, mean cell volume ${mcv?.value} fL (recorded; the Evans–Fung volume is ${fmt(num(r.volume), 1)} ${UM3}).`
    : 'No crew blood count loaded; the crowding cube is not drawn.';
  const info = {
    title: 'Red blood cells in plasma · Evans–Fung (1972) shape',
    lines: [
      `Each cell is the Evans and Fung (1972) biconcave disc: half-thickness z(r) = ½√(1 − (r/R0)²)·(C0 + C2(r/R0)² + C4(r/R0)⁴) with R0 = ${R0} ${UM}, C0 = ${C0} ${UM}, C2 = ${C2} ${UM}, C4 = ${C4} ${UM}. Checked against open-access texts: Evans and Fung's mean diameter 7.82 ${UM} (tabulated in Cells 2022) and their dimensionless coefficients (Sraj et al. 2010) times R0; also quoted directly by Dodson & Dimitrakopoulos (2010).`,
      `From the equation (calculated): ${fmt(num(r.diameter))} ${UM} across, ${fmt(C0)} ${UM} at the centre, thickest ${fmt(tMax)} ${UM} at r = ${fmt(rAt)} ${UM}, volume ${fmt(num(r.volume), 1)} ${UM3}, surface ${fmt(num(r.area), 1)} ${UM}².${inViews ? '' : ' The green outline below the cell is the true-size section.'}`,
      crowd,
      inViews
        ? (inCube
          ? `5 mm cube: at that count a cube of blood 5 mm on a side (125 µL) holds ${inCube.toLocaleString('en-US')} red cells (calculated: count × volume). One cell is ${fmt(2 * R0)} ${UM} across, ${fmt(VIEW.cube / (2 * R0), 0)} times smaller than the cube, so single cells cannot be told apart there and the volume is drawn in one colour. The red is a display colour, not computed from a spectrum.`
          : '5 mm cube: no blood count is loaded, so the number of cells it holds is not given.')
        : 'Positions and tilts of the neighbouring cells are illustrative and much sparser than blood; real cells also deform and stack. Colours are display colours.',
      inViews && nSlab
        ? `Slice: ${fmt(VIEW.slabW, 0)} × ${fmt(VIEW.slabH, 0)} ${UM} of blood, as thick as one cell lying flat (${fmt(tCell, 3)} ${UM}, the Evans–Fung thickest point), holds ${nSlab.toLocaleString('en-US')} red cells at the same count (calculated: count × volume, rounded). All of them are drawn, lying flat, each as a ${6 * VIEW.sides}-triangle Evans–Fung disc (centre, thickest ring and rim). Their positions are illustrative and deterministic: a Halton sequence, then overlapping pairs are pushed apart until every pair is at least a diameter plus ${VIEW.gap} ${UM} apart (to within ${VIEW.tol} ${UM}), with ${VIEW.gapMain} ${UM} of clear plasma kept around the central cell for the next view. In real blood the cells point every way, bend and stack.`
        : '',
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
  if (inViews) {
    readouts.push(
      { label: 'Red cells in a 5 mm cube of blood', value: inCube ?? 'no count loaded', unit: '', tag: 'calculated', source: 'RBC count × 125 µL (1 µL = 1 mm³)' },
      { label: 'Slice drawn (width × height × thickness)', value: `${fmt(VIEW.slabW, 0)} × ${fmt(VIEW.slabH, 0)} × ${fmt(tCell, 3)}`, unit: UM, tag: 'display', source: 'width and height fill the 600 µm view; thickness = one cell at its thickest (Evans–Fung)' },
      { label: 'Red cells in that slice, all drawn', value: nSlab || 'no count loaded', unit: '', tag: 'calculated', source: 'RBC count × slice volume, rounded; positions illustrative' },
      spacingRO,
    );
  }

  // ---- views (every cell lies in the plane z = 0 and faces +z; the cube's front face is the front of the slice)
  const deg = THREE.MathUtils.degToRad;
  const views = {
    drop: { target: [VIEW.cube / 2, VIEW.cube / 2, tCell / 2], dir: unit([Math.sin(deg(30)) * Math.cos(deg(25)), Math.sin(deg(25)), Math.cos(deg(30)) * Math.cos(deg(25))]),
      note: `A cube of whole blood 5 mm on a side, seen from above one of its corners, drawn in one colour: a red cell is ${fmt(2 * R0)} ${UM} across, far too small to tell apart at this scale.${inCube ? ` At the crew's count of ${cnt.value} million per µL the cube (125 µL) holds ${inCube.toLocaleString('en-US')} red cells (calculated).` : ''} The small cube in its corner is 1 µL (1 mm³), the unit of the count; the outline on its front face is the next view's slice, at true size; the column beside it is the same blood spun down: ${hct?.value ?? '?'} % red cells (the recorded haematocrit) under clear plasma. The red and the plasma colour are display colours.` },
    slice: { target: [0, 0, 0], dir: unit([0.08, -0.17, 1]),
      note: nSlab
        ? `The front layer of that cube, one cell thick (${fmt(tCell, 3)} ${UM}): a ${fmt(VIEW.slabW, 0)} × ${fmt(VIEW.slabH, 0)} ${UM} slice with all ${nSlab.toLocaleString('en-US')} red cells the crew's count puts in it (calculated), drawn lying flat. Positions are illustrative and deterministic; in real blood the cells point every way, bend and stack.`
        : 'No blood count is loaded, so the slice shows the one cell only.' },
    edge: { target: [R0, 0, 0], dir: unit([Math.sin(deg(25)) * Math.cos(deg(20)), Math.sin(deg(25)) * Math.sin(deg(20)), Math.cos(deg(25))]),
      note: `The rim of the central cell of the slice: the Evans–Fung surface closes here with a rounded edge (the cell is already ${fmt(2 * halfZ(1 - 0.5 / R0), 2)} ${UM} thick half a micrometre in from the rim, calculated). Beside it is plasma, where renin acts; renin molecules are far too small to show at this scale and are not drawn. The nearest neighbouring cell is kept at least ${VIEW.gapMain} ${UM} away (a display choice).` },
  };
  const showLine = viewLine(info, views);
  function setView(name) {
    const named = Object.prototype.hasOwnProperty.call(views, name);
    legacy.visible = !named;
    main.quaternion.copy(named ? qFlat : qTilt);
    if (named) {
      const v = ensureViews();
      v.g.visible = true;
      v.cube.visible = name === 'drop';                    // the cube hides its own first layer, so cells show only without it
      main.visible = name !== 'drop'; main.material = v.redMain;
      if (v.slab) { v.slab.visible = name !== 'drop'; v.outline.visible = true; }
      v.ulEdges.visible = name === 'drop'; if (v.column) v.column.visible = name === 'drop';
    } else {
      main.visible = true; main.material = mainMat;
      if (vw) vw.g.visible = false;
    }
    showLine(named ? name : null);
  }
  const PLAIN = { 'Diameter': 'Cell width', 'Centre / thickest': 'Thickness, middle / rim', 'Volume': 'Cell volume', 'Surface area': 'Cell surface', 'Mean cell volume (MCV)': 'Average cell volume', 'Haematocrit': 'Share of blood that is cells', 'Blood per red cell': 'Blood per cell', 'Red cells in a 5 mm cube of blood': 'Cells in a 5 mm cube', 'Slice drawn (width × height × thickness)': 'Slice drawn', 'Red cells in that slice, all drawn': 'Cells in the slice', 'Smallest centre spacing drawn in the slice': 'Closest two cells drawn' };   // plain words for the card
  for (const r of readouts) if (!r.plain && PLAIN[r.label]) r.plain = PLAIN[r.label];
  for (const r of readouts) if (!r.plain && /^RBC count/.test(r.label)) r.plain = 'Red cells per microlitre';
  const setEnv = radiationRow(readouts);
  if (opts.env) setEnv(opts.env);
  if (inViews) { ensureViews(); setView(opts.view); }

  return {
    scene,
    camera: { position: [5, 5, 31], target: [3, -3, 0], fov: 40 },
    labels, info, readouts, views, setView, setEnv,
    update() {},
    dispose() {
      scene.traverse((o) => { o.geometry?.dispose?.(); const mt = o.material; (Array.isArray(mt) ? mt : mt ? [mt] : []).forEach((x) => x.dispose?.()); if (o.isInstancedMesh) o.dispose(); });
      mainMat.dispose(); extra.forEach((x) => x.dispose());
    },
  };
}
