// SpinDrift real anatomy (three.js 0.160). Human Reference Atlas (HRA, HuBMAP Common Coordinate Framework),
// 3D Reference Object Library, CC BY 4.0. Visible Human Male set (default): whole-body skin, heart, lungs, left and
// right kidney, brain (Allen atlas, mirrored and resized by HRA) and, on request, the blood vasculature.
// Visible Human Female set ({ sex: 'female' }): whole-body skin, heart, lungs, left and right kidney, brain.
// Everything comes from /data/anatomy/manifest.json (male) or manifest_female.json (female), built by
// scripts/build_anatomy.py: the files, HRA's own placement of each organ in the VHMale or VHFemale body frame, the
// app-frame shift, centroids, mount points, the head bounding box (manifest.frame.head_bbox_app) and credits.
// Nothing is positioned by hand here.
// APP FRAME: metres, y up, feet (lowest skin vertex of that body) at y = 0, +z anterior, the body's right at -x.
// The GLB files are uncompressed (no Draco, no meshopt), so GLTFLoader alone reads them.
// Materials: each file material is replaced by a plain MeshStandardMaterial that keeps the file's own base colour,
// roughness and metalness (vertex colours ignored; the files hold no textures). The skin's file material is a
// translucent blue; it is replaced by a translucent neutral material so the organs inside stay visible.
// Colour never means healthy or unhealthy.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const ANATOMY_BASE = '/data/anatomy/';
// manifest per HRA reference body (options.sex)
export const ANATOMY_MANIFESTS = { male: 'manifest.json', female: 'manifest_female.json' };

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

function restyle(root, key, options) {
  const made = new Map();
  const replace = (src) => {
    if (made.has(src)) return made.get(src);
    let mat;
    if (key === 'skin') {
      mat = new THREE.MeshStandardMaterial({
        color: options.skinColor ?? 0xd9dfcc, roughness: 0.6, metalness: 0,
        transparent: true, opacity: options.skinOpacity ?? 0.3, depthWrite: false,
      });
    } else {
      mat = new THREE.MeshStandardMaterial({
        color: src && src.color ? src.color.clone() : new THREE.Color(0xbbbbbb),
        roughness: src && typeof src.roughness === 'number' ? src.roughness : 0.6,
        metalness: src && typeof src.metalness === 'number' ? src.metalness : 0,
      });
    }
    mat.name = `${key}:${(src && src.name) || 'material'}`;
    made.set(src, mat);
    return mat;
  };
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map(replace) : replace(o.material);
  });
  for (const src of made.keys()) if (src && src.dispose) src.dispose();
}

// userData.organ = model key; userData.ontology = { id, label } from the HRA crosswalk of that file (Uberon/FMA),
// so a picked mesh can be looked up in data/bio/asctb.json. Meshes HRA has not mapped keep only their name.
function tag(root, key, model) {
  const cw = model.crosswalk || {};
  root.traverse((o) => {
    o.userData.organ = key;
    const name = o.userData.name || o.name;
    if (name && cw[name]) o.userData.ontology = cw[name];
  });
}

async function loadModel(loader, base, manifest, key, onBytes, options) {
  const m = manifest.models[key];
  const gltf = await loader.loadAsync(base + m.file, (e) => onBytes(Math.min(e.loaded || 0, m.bytes)));
  onBytes(m.bytes);
  const root = gltf.scene;
  root.name = key;
  // HRA API scene transform of this organ (identity for every male organ), then the app-frame shift in y
  const toApp = new THREE.Matrix4().fromArray(manifest.frame.hra_to_app.matrix_column_major);
  const hra = new THREE.Matrix4().fromArray(m.placement.hra_scene_transform_column_major);
  root.applyMatrix4(toApp.multiply(hra));
  restyle(root, key, options);
  tag(root, key, m);
  return root;
}

function addModel(result, key, root, manifest) {
  const m = manifest.models[key];
  result.group.add(root);
  root.traverse((o) => {
    const n = o.userData.name;
    if (n && !result.nodes.has(n)) result.nodes.set(n, o);
  });
  const entry = {
    object: root,
    centroid: m.centroid_app.slice(),
    bbox: { min: m.bbox_app.min.slice(), max: m.bbox_app.max.slice() },
    label: m.organ, uberon: m.uberon, version: m.version, parts: m.parts,
  };
  if (key === 'skin') result.skin = entry;
  else result.organs[key] = entry;
  return entry;
}

/**
 * Load the HRA anatomy in the app frame.
 * @param {(fraction: number) => void} [onProgress] called with 0..1 over the bytes of the models being loaded
 * @param {object} [options] { sex: 'male' | 'female', exclude: ['skin'], baseUrl, include: ['blood_vasculature'],
 *   vasculature: true, skinColor, skinOpacity, manifest }
 *   sex: which HRA reference body; 'male' (default) reads manifest.json, 'female' reads manifest_female.json. The two
 *     are separate bodies (own heights, own feet at y = 0); the female set has no blood vasculature.
 *   exclude: model keys not to load (also over include / vasculature), e.g. ['skin'] when the app draws its own
 *     figure. Organs, mounts and the manifest stay as they are; mounts are skin-surface points measured on the HRA
 *     skin, so credits keep the skin's line. An excluded key can still be loaded later with loadOptional(key).
 *   manifest: an already loaded manifest object (then sex is not used to fetch one).
 * @returns {Promise<{group: THREE.Group, organs: object, skin: object|null, mounts: object, credits: string[],
 *   manifest: object, nodes: Map<string, THREE.Object3D>, missing: {key: string, error: string}[],
 *   loadOptional: (key: string, onProgress?: (fraction: number) => void) => Promise<object>}>}
 *   organs: { heart, lungs, kidney_left, kidney_right, brain[, blood_vasculature] }, each
 *   { object, centroid: [x, y, z], bbox: {min, max}, label, uberon, version, parts }. skin is null when excluded.
 */
export async function loadAnatomy(onProgress, options = {}) {
  const base = options.baseUrl || ANATOMY_BASE;
  const sex = String(options.sex ?? 'male').toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(ANATOMY_MANIFESTS, sex)) {
    throw new Error(`unknown anatomy sex '${options.sex}' (use 'male' or 'female')`);
  }
  const manifest = options.manifest || await fetchJson(`${base}${ANATOMY_MANIFESTS[sex]}`);
  const want = new Set(manifest.load.default);
  for (const k of options.include || []) if (manifest.models[k]) want.add(k);
  if (options.vasculature && manifest.models.blood_vasculature) want.add('blood_vasculature');
  for (const k of options.exclude || []) want.delete(k);
  const keys = [...want];

  const group = new THREE.Group();
  group.name = 'HRA anatomy (app frame)';
  const result = {
    group, organs: {}, skin: null, mounts: manifest.mounts, credits: manifest.credits.slice(), manifest,
    nodes: new Map(), missing: [],
  };
  const loader = new GLTFLoader();
  const done = Object.fromEntries(keys.map((k) => [k, 0]));
  const total = keys.reduce((s, k) => s + (manifest.models[k].bytes || 0), 0) || 1;
  const report = () => {
    if (onProgress) onProgress(Math.min(1, Object.values(done).reduce((a, b) => a + b, 0) / total));
  };
  const settled = await Promise.allSettled(keys.map((k) => loadModel(loader, base, manifest, k, (n) => {
    done[k] = n;
    report();
  }, options)));
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') addModel(result, keys[i], s.value, manifest);
    else result.missing.push({ key: keys[i], error: String((s.reason && s.reason.message) || s.reason) });
  });

  // load a model listed as optional (the blood vasculature, 18 MB) later, into the same group
  result.loadOptional = async (key, onP) => {
    const have = key === 'skin' ? result.skin : result.organs[key];
    if (have) return have;
    if (!manifest.models[key]) throw new Error(`unknown anatomy model ${key}`);
    const root = await loadModel(loader, base, manifest, key, (n) => onP && onP(n / manifest.models[key].bytes),
      options);
    return addModel(result, key, root, manifest);
  };
  return result;
}

// Mount points from the manifest as THREE.Vector3 (app frame): the 3 x 3 scalp grid over the right precentral
// gyrus and the chest point over the heart. The forearm mount is absent (no real landmark in the HRA set).
export function mountVectors(mounts) {
  const v = (a) => (a ? new THREE.Vector3(a[0], a[1], a[2]) : null);
  const scalp = mounts.scalp_right_precentral_gyrus;
  const chest = mounts.chest_over_heart;
  return {
    scalp: scalp ? scalp.points.map((p) => ({ id: p.id, position: v(p.position), normal: v(p.normal),
      row: p.row_along_gyrus, col: p.col_across_gyrus, over: p.underlying_brain_structure })) : [],
    scalpCenter: scalp ? { position: v(scalp.center.position), normal: v(scalp.center.normal) } : null,
    chest: chest ? { position: v(chest.position), normal: v(chest.normal) } : null,
    forearm: mounts.forearm_right_volar && mounts.forearm_right_volar.available
      ? { position: v(mounts.forearm_right_volar.position), normal: v(mounts.forearm_right_volar.normal) } : null,
  };
}
