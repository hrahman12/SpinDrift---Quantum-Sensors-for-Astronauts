// Shared helpers for the sensor models in ui/sensors/*.js. Every size and position comes from
// data/sensor_parts/<id>.json (built by scripts/build_sensor_parts.py); this file only holds colours, materials,
// atom instancing and bookkeeping. Explode distances are display offsets, not dimensions.
import * as THREE from 'three';

export const NEUTRAL = { light: '#e1e5d6', mid: '#8e9684', dark: '#5c6552' };
export const CPK = { C: '#909090', N: '#3050f8', O: '#ff0d0d', H: '#ffffff', S: '#ffff30' };   // Jmol CPK convention

/** Numeric value of a value object, or null (NOT_STATED, NOT_YET_EXTRACTED, missing). */
export function num(v) {
  return v && typeof v.value === 'number' && Number.isFinite(v.value) ? v.value : null;
}

/** Short number for labels: at most 3 decimals, no trailing zeros. */
export function fmt(x) {
  return typeof x === 'number' ? String(Number(x.toFixed(3))) : String(x ?? '');
}

/** Device colour from data/palette.json (e.g. 'opm' 795 nm, 'nv' 695 nm, 'cqd_patch' 439 nm), or null. */
export function paletteColour(D, device) {
  const e = (D?.palette?.colours || []).find((c) => c.device === device && typeof c?.colour?.value === 'string');
  return e ? e.colour.value : null;
}

/** JSON dims list [{label, vo}] -> contract dims [{label, value, unit, source, tag, status}]. */
export function toDims(list) {
  return (list || []).filter((d) => d && d.vo).map(({ label, vo }) => ({
    label, value: vo.value, unit: vo.unit, source: vo.source, tag: vo.tag, status: vo.status,
  }));
}

/** Tracks geometries and materials so dispose() frees everything a build created. */
export function createKit() {
  const geos = new Set();
  const mats = new Set();
  return {
    geo(g) { geos.add(g); return g; },
    mat(m) { mats.add(m); return m; },
    std(colour, extra = {}) {
      return this.mat(new THREE.MeshStandardMaterial({ color: colour, roughness: 0.55, metalness: 0.05, ...extra }));
    },
    dispose() {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      geos.clear();
      mats.clear();
    },
  };
}

/** Result object for a sensor whose data file did not load: nothing is drawn. */
export function emptyBuild(name, reason) {
  return {
    root: Object.assign(new THREE.Group(), { name }),
    components: [],
    undocumented: [{ name: 'All parts', reason }],
    explode() {},
    labels: [],
    dispose() {},
  };
}

/**
 * explode(t) for a set of moving objects. moves: [{ id, object, dir: [x, y, z], dist }]; t in [0, 1].
 * Labels whose component id matches a move's id travel with it.
 */
export function explodeRig(moves, labels) {
  const base = moves.map((m) => m.object.position.clone());
  const dirs = moves.map((m) => new THREE.Vector3(...m.dir).normalize());
  const lbase = labels.map((l) => l.position.slice());
  const d = new THREE.Vector3();
  return function explode(t) {
    const k = Math.min(1, Math.max(0, Number(t) || 0));
    const off = {};
    moves.forEach((m, i) => {
      d.copy(dirs[i]).multiplyScalar(m.dist * k);
      m.object.position.copy(base[i]).add(d);
      if (m.id) off[m.id] = d.toArray();
    });
    labels.forEach((l, i) => {
      const o = off[l.component] || [0, 0, 0];
      for (let j = 0; j < 3; j++) l.position[j] = lbase[i][j] + o[j];
    });
  };
}

/**
 * Space-filling atoms: one InstancedMesh per element, CPK colours, radius per element (scene units).
 * atoms: [[element, x, y, z], ...] already in scene units. Atoms of an element with no radius are not drawn and
 * are counted in group.userData.skipped.
 */
export function atomsGroup(kit, atoms, radii, sphere) {
  const group = new THREE.Group();
  const byEl = {};
  for (const a of atoms) (byEl[a[0]] ||= []).push(a);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  let skipped = 0;
  for (const [el, list] of Object.entries(byEl)) {
    const r = radii[el];
    if (!(r > 0)) { skipped += list.length; continue; }
    const mesh = new THREE.InstancedMesh(sphere, kit.std(CPK[el] || NEUTRAL.mid, { roughness: 0.45 }), list.length);
    list.forEach((a, i) => { p.set(a[1], a[2], a[3]); s.setScalar(r); m4.compose(p, q, s); mesh.setMatrixAt(i, m4); });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.computeBoundingBox) mesh.computeBoundingBox();
    if (mesh.computeBoundingSphere) mesh.computeBoundingSphere();
    mesh.name = `${el} atoms`;
    group.add(mesh);
  }
  group.userData.skipped = skipped;
  return group;
}

/** Centroid of [[el, x, y, z], ...]. */
export function centroid(atoms) {
  const c = [0, 0, 0];
  for (const a of atoms) { c[0] += a[1]; c[1] += a[2]; c[2] += a[3]; }
  return atoms.length ? c.map((v) => v / atoms.length) : c;
}
