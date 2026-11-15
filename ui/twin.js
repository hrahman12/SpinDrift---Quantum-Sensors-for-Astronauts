// SpinDrift body twin (three.js): the whole body with the four quantum sensors at true size (1 unit = 1 m).
// Body: the Human Reference Atlas anatomy (ui/anatomy.js, CC BY 4.0) when present; otherwise "Cesium Man" (c) 2017
// Cesium, CC BY 4.0 (KhronosGroup glTF-Sample-Assets), scaled to a 1.75 m reference height, with its texture removed.
// Sensors: QuSpin QZFM Gen-3 heads 12.4 x 16.6 x 24.4 mm (nine over the right somatomotor area as in the MNE OPM
// recording; a 2 x 2 chest array at 3 cm spacing as in the Kiel Cardio Database), the JGU NV head (12 mm housing about
// 1 cm from the chest), the carbon-dot patch site on the right forearm and the blood-draw site for the renin assay.
// Each sensor is placed by casting a ray onto the real skin surface. Sensor colour shows the Lean verdict on whether
// it can measure here (not health): green met, red not met, amber needs information.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { lookLights, glowView, gradientBg, BACKDROPS } from './look.js';
import { buildPerson } from './person.js';
import { slimTransform, legSlim, deformMesh, bodyModel, tuck, dress, hair, faceShell, evaExtras } from './outfit.js';

const REF_H = 1.75;          // reference height for the fallback figure (m)
const MM = 0.001;
const VCOL = { REQUIREMENTS_MET: 0xa9d48c, NOT_MET: 0xff6b5b, NEED_MORE_INFORMATION: 0xe9b44c };
const SIDE = { brain: 1, heart: 1, blood: -1, skin: -1 };

const GROUND = { orbit: 0x1b2740, deep_space: 0x141a2a, lunar: 0x55544f, mars: 0x5a2e1a, earth: 0x24382c, antarctic: 0x8c9ba6, arctic: 0x4a4438, desert: 0x5c4026, ocean: 0x0f3a4c, steppe: 0x4f4430 };
export async function createTwin({ canvas, labelsEl, leadersEl, notesEl = null, sites, onSelect, onProgress, onEdge, onOrganPick, colors = {}, opm = null, sex = 'male', outfit = 'cabin', backdrop = 'orbit', skinTone = 0xc99a7a }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.003, 60);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false; controls.enableDamping = true; controls.enableZoom = false;
  controls.minDistance = 0.12; controls.maxDistance = 7;
  lookLights(scene);
  scene.background = gradientBg(BACKDROPS[backdrop] || BACKDROPS.orbit);
  const glow = glowView(renderer, scene, camera, { strength: 0.5, threshold: 0.82 });

  // the ground of the place, fading out at its edge, and a soft contact shadow under the feet
  const radial = (stops) => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), rg = g.createRadialGradient(128, 128, 0, 128, 128, 128); for (const [o, col] of stops) rg.addColorStop(o, col); g.fillStyle = rg; g.fillRect(0, 0, 256, 256); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const gc = new THREE.Color(GROUND[backdrop] ?? 0x1a2230), css = `rgba(${Math.round(gc.r * 255)},${Math.round(gc.g * 255)},${Math.round(gc.b * 255)},`;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.6, 96), new THREE.MeshBasicMaterial({ map: radial([[0, `${css}0.95)`], [0.55, `${css}0.6)`], [1, `${css}0)`]]), transparent: true, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2; scene.add(disc);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 64), new THREE.MeshBasicMaterial({ map: radial([[0, 'rgba(0,0,0,0.6)'], [0.6, 'rgba(0,0,0,0.25)'], [1, 'rgba(0,0,0,0)']]), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.002; shadow.scale.set(1, 0.7, 1); scene.add(shadow);

  // ---------------------------------------------------------------- body
  // A real person: the Human Reference Atlas body surface (CC BY 4.0), slimmed and dressed for the scene
  // (ui/outfit.js), with the real organs and sensor mounts inside. It turns see-through when a sensor site opens.
  // If the matching HRA set is missing, a simple drawn figure (ui/person.js) stands in and says so.
  let anat = null, skinMeshes = [], bare = [], credits = [], arm = null;
  const organs = {}, dressed = [];
  let personXray = () => {}, slim = null, headC = null, closeUp = false;
  const headShells = [];
  try {
    const mod = await import('./anatomy.js');
    anat = await mod.loadAnatomy(onProgress, { sex });
    const got = anat.manifest?.models?.heart?.sex || anat.manifest?.sex;
    if (got && String(got).toLowerCase() !== sex) throw new Error(`HRA ${sex} set is not built yet`);
    const skinObj = anat.skin?.object || anat.skin;
    if (!skinObj) throw new Error('HRA skin missing');
    scene.add(anat.group); anat.group.updateMatrixWorld(true);
    const bb0 = new THREE.Box3().setFromObject(skinObj), H0 = bb0.max.y - bb0.min.y;
    slim = slimTransform({ H: H0, y0: bb0.min.y, cx: (bb0.min.x + bb0.max.x) / 2, cz: (bb0.min.z + bb0.max.z) / 2, s: 0.85 });
    skinObj.traverse((o) => { if (o.isMesh) { deformMesh(o, slim); skinMeshes.push(o); } });
    const thinLegs = legSlim(skinMeshes, { H: H0, y0: bb0.min.y, cx: (bb0.min.x + bb0.max.x) / 2 });
    if (thinLegs) for (const m of skinMeshes) deformMesh(m, thinLegs);
    for (const o of Object.values(anat.organs || {})) o?.object?.traverse((m) => { if (m.isMesh) deformMesh(m, slim); });
    for (const [k, o] of Object.entries(anat.organs || {})) if (o?.object) { const c = new THREE.Box3().setFromObject(o.object).getCenter(new THREE.Vector3()); organs[k] = { ...o, centroid: c.toArray() }; }
    credits = (anat.credits || []).concat(['Figure: the HRA reference body drawn 15% narrower (torso and limbs, head unchanged) and dressed for the scene; garments are smoothed shells grown from the body, so their thickness and colours are a drawing choice.']);
    const body = bodyModel(skinMeshes, { H: H0, y0: bb0.min.y, cx: (bb0.min.x + bb0.max.x) / 2 });
    const hb = new THREE.Box3(); for (let i = 0; i < body.n; i++) if (body.cls[i] === 2 && body.hy[i] > 0.88) hb.expandByPoint(new THREE.Vector3(body.P[3 * i], body.P[3 * i + 1], body.P[3 * i + 2]));
    headC = hb.getCenter(new THREE.Vector3());
    tuck(body, skinMeshes);
    const { meshes } = dress(body, { outfit, sex });
    const hr = outfit === 'eva' ? null : hair(body, { sex, headCentre: headC });
    const face = faceShell(body, { color: skinTone });
    for (const g of [...meshes, face, hr].filter(Boolean)) { scene.add(g); dressed.push(g); }
    headShells.push(...[face, hr].filter(Boolean));
    if (outfit === 'eva') {
      const ex = evaExtras({ headCentre: headC, headH: hb.max.y - hb.min.y }); scene.add(ex); dressed.push(...ex.children); headShells.push(...ex.children);
    }
    const skinMat = new THREE.MeshStandardMaterial({ color: skinTone, roughness: 0.72, metalness: 0 });
    for (const m of skinMeshes) m.material = skinMat;
    const all = [skinMat, ...dressed.map((d) => d.material)];
    personXray = (on) => { for (const m of all) { m.userData.base ??= { t: m.transparent, o: m.opacity }; m.transparent = on || m.userData.base.t; m.opacity = on ? Math.min(0.25, m.userData.base.o) : m.userData.base.o; m.depthWrite = !on && !m.userData.base.t; m.userData.outlineParameters = { ...(m.userData.outlineParameters || {}), visible: !on }; m.needsUpdate = true; } };
    bare = skinMeshes.slice();     // the body surface itself, under any clothes
    skinMeshes = [...dressed.filter((d) => d.isMesh && d.material.opacity >= 0.99), ...skinMeshes];
  } catch (e) {
    console.info('HRA body not used:', e.message); if (anat?.group) scene.remove(anat.group); anat = null;
    const person = buildPerson({ sex, H: sex === 'female' ? 1.613 : 1.753 });
    scene.add(person.group); skinMeshes = person.meshes; bare = person.meshes; personXray = (on) => person.setXray(on); headC = person.head.centre;
    credits.push(person.credit, sex === 'female' ? 'Female figure: the Human Reference Atlas female set is not built yet, so a simple drawn figure stands in, with no organs.' : 'Figure: the Human Reference Atlas set is not available, so a simple drawn figure stands in.');
  }
  scene.updateMatrixWorld(true);
  const bodyBox = new THREE.Box3(); skinMeshes.forEach((m) => bodyBox.expandByObject(m));
  const H = bodyBox.max.y - bodyBox.min.y, cx = 0;
  const person = { head: { centre: headC || new THREE.Vector3(0, bodyBox.max.y - 0.12, 0) }, points: {} };

  // ---------------------------------------------------------------- landmarks (from the real meshes where available)
  const centroid = (o) => { const bb = new THREE.Box3().setFromObject(o?.object || o); return bb.getCenter(new THREE.Vector3()); };
  const L = {};
  const org = (k) => organs[k]?.centroid ? new THREE.Vector3(...organs[k].centroid) : (organs[k]?.object ? centroid(organs[k].object) : null);
  L.heart = org('heart') || new THREE.Vector3(cx + 0.035 * H / 1.507, bodyBox.min.y + 0.985 / 1.507 * H, 0.045 * H / 1.507);
  L.brain = org('brain') || new THREE.Vector3(cx, bodyBox.min.y + (1.335 / 1.507) * H, 0.005 * H / 1.507);
  L.kidney = org('kidney_left') || org('kidney') || null;
  // surface placement by raycasting onto the skin
  const ray = new THREE.Raycaster();
  function onSkin(from, dir) {
    ray.set(from, dir.clone().normalize()); ray.far = 2;
    const hit = ray.intersectObjects(skinMeshes, false)[0];
    if (!hit) return null;
    const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : dir.clone().negate();
    if (n.dot(dir) > 0) n.negate();
    return { p: hit.point.clone(), n: n.normalize() };
  }
  // cast from outside inward: start a metre out along dir, look back toward the inner point
  const fromOutside = (inner, outDir) => onSkin(inner.clone().add(outDir.clone().normalize().multiplyScalar(1.0)), outDir.clone().negate());

  // ---------------------------------------------------------------- sensors at true size
  const sensors = { brain: [], heart: [], blood: [], skin: [] };
  const sensorGroup = new THREE.Group(); scene.add(sensorGroup);
  const up = new THREE.Vector3(0, 1, 0);
  // housing and vapour-cell geometry from data/sensor_parts/opm.json (QuSpin Gen-3.0 drawing); frame: +y along the
  // long axis, skin face at y = -h/2
  const OG = opm || { w: 16.6, h: 24.4, d: 12.4, cell: [0, -24.4 / 2 + 6.5, 0], cellSize: [3, 3, 3] };
  const opmGeo = new THREE.BoxGeometry(OG.w * MM, OG.h * MM, OG.d * MM);
  const mats = [];
  const mat = (c, o = {}) => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.05, emissive: 0x000000, ...o }); mats.push(m); return m; };
  function addOpm(site, s, route) {
    const g = new THREE.Group();
    const housing = new THREE.Mesh(opmGeo, mat(0xeef0e8)); g.add(housing);
    // the vapour cell: a glass box lit from inside by the laser (drawn see-through, with its edges)
    const cellGeo = new THREE.BoxGeometry(...OG.cellSize.map((q) => q * MM));
    const cell = new THREE.Mesh(cellGeo, new THREE.MeshBasicMaterial({ color: colors.opm || 0xff0000, transparent: true, opacity: 0.5, depthWrite: false }));
    cell.add(new THREE.LineSegments(new THREE.EdgesGeometry(cellGeo), new THREE.LineBasicMaterial({ color: 0xffe6dc, transparent: true, opacity: 0.75 })));
    cell.position.set(...OG.cell.map((q) => q * MM)); g.add(cell);
    g.position.copy(s.p.clone().add(s.n.clone().multiplyScalar(OG.h * MM / 2)));
    g.quaternion.setFromUnitVectors(up, s.n);
    sensorGroup.add(g); sensors[site].push(housing); housing.userData.cell = cell;
    cell.material.color.multiplyScalar(2.2);   // bright enough to glow: this is the lit rubidium cell
    const top = s.p.clone().add(s.n.clone().multiplyScalar(OG.h * MM));
    sensorGroup.add(cable([top, top.clone().add(s.n.clone().multiplyScalar(0.02)), ...route(top)], 1.2 * MM, mat(0x2b2f27)));
  }
  // Cables run along the body, about 1.5 cm off the surface, to the collar or the waistband, like a worn system:
  // the route is found by casting onto the body from the front or the back at fixed drops below the sensor.
  const off15 = (h) => (h ? h.p.clone().add(h.n.clone().multiplyScalar(0.015)) : null);
  const fromFront = (x, y) => off15(onSkin(new THREE.Vector3(x, y, 0.8), new THREE.Vector3(0, 0, -1)));
  const fromBack = (x, y) => off15(onSkin(new THREE.Vector3(x, y, -0.8), new THREE.Vector3(0, 0, 1)));
  const hC = person.head.centre;
  const backOfHead = [fromBack(hC.x - 0.025, hC.y + 0.02), fromBack(hC.x - 0.02, hC.y - 0.08), fromBack(hC.x - 0.015, hC.y - 0.16), fromBack(hC.x - 0.03, hC.y - 0.3)].filter(Boolean);
  const headRoute = (top) => {
    if (!backOfHead.length) return [];
    const mid = top.clone().lerp(backOfHead[0], 0.5), r = Math.max(top.distanceTo(hC), backOfHead[0].distanceTo(hC)) + 0.01;
    return [mid.sub(hC).setLength(r).add(hC), ...backOfHead];
  };
  const downFront = (top) => [0.05, 0.12, 0.2, 0.28].map((d) => fromFront(top.x, top.y - d)).filter(Boolean);
  function cable(pts, r, material) {
    const p = pts.filter((q, i) => i === 0 || q.distanceTo(pts[i - 1]) > 1e-4);
    if (p.length < 2) p.push(p[0].clone().add(new THREE.Vector3(0, -0.01, 0)));
    return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(p), 16 * p.length, r, 6), material);
  }
  // nine OPMs: 3 x 3 grid at 25 mm pitch on the scalp over the right somatomotor area
  const mounts = anat?.mounts || {};
  // HRA mounts: 3 x 3 scalp grid over the right precentral gyrus, chest point over the heart (see data/anatomy/manifest.json)
  const scalpPts = mounts.scalp_right_precentral_gyrus?.points || null;
  const cableHead = headRoute;
  if (scalpPts && scalpPts.length >= 9) {
    for (const m of scalpPts.slice(0, 9)) { const sp = fromOutside(person.head.centre, new THREE.Vector3(...m.normal).normalize()); if (sp) addOpm('brain', sp, cableHead); }
  } else {
    const c0 = mounts.scalp_centre ? new THREE.Vector3(...mounts.scalp_centre.normal) : new THREE.Vector3(-0.62, 0.72, 0.08).normalize();
    const t1 = new THREE.Vector3().crossVectors(c0, up).normalize(), t2 = new THREE.Vector3().crossVectors(t1, c0).normalize();
    const hc = L.brain;
    const centreHit = fromOutside(hc, c0);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      if (!centreHit) break;
      const p = centreHit.p.clone().add(t1.clone().multiplyScalar(i * 25 * MM)).add(t2.clone().multiplyScalar(j * 25 * MM));
      const s = fromOutside(hc, p.clone().sub(hc)); if (s) addOpm('brain', s, cableHead);
    }
  }
  // chest: 2 x 2 OPM array at 3 cm spacing over the heart, and the NV head 1 cm off the skin
  const cm = mounts.chest_over_heart;
  const chest = fromOutside(L.heart, cm?.normal ? new THREE.Vector3(...cm.normal).normalize() : new THREE.Vector3(0, 0, 1));
  if (chest) {
    const tx = new THREE.Vector3().crossVectors(up, chest.n).normalize(), ty = new THREE.Vector3().crossVectors(chest.n, tx).normalize();
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const p = chest.p.clone().add(tx.clone().multiplyScalar((dx - 0.5) * 30 * MM)).add(ty.clone().multiplyScalar((dy - 0.5) * 30 * MM));
      const s = fromOutside(L.heart, p.clone().sub(L.heart)); if (s) addOpm('heart', s, downFront);
    }
    // JGU head: only the Ø12 mm front face is published (housing length is not), so a 1 mm-thick face disc is drawn
    const nvL = 1 * MM, nvR = 6 * MM;
    const nvPos = chest.p.clone().add(ty.clone().multiplyScalar(-65 * MM));
    const sNv = fromOutside(L.heart, nvPos.clone().sub(L.heart)) || { p: nvPos, n: chest.n };
    const nv = new THREE.Mesh(new THREE.CylinderGeometry(nvR, nvR, nvL, 28), mat(0xa9adb0, { metalness: 0.8, roughness: 0.3 }));
    nv.position.copy(sNv.p.clone().add(sNv.n.clone().multiplyScalar(10 * MM + nvL / 2)));
    nv.quaternion.setFromUnitVectors(up, sNv.n); sensorGroup.add(nv); sensors.heart.push(nv);
    const f0 = nv.position.clone().add(sNv.n.clone().multiplyScalar(nvL / 2));
    sensorGroup.add(cable([f0, f0.clone().add(sNv.n.clone().multiplyScalar(0.015)), ...downFront(f0)], 0.9 * MM, mat(colors.nv || 0xff0000, { emissive: colors.nv || 0xff0000, emissiveIntensity: 0.3 })));
  }
  // right forearm (the body's right = -x): carbon-dot patch site; antecubital vein: blood-draw site for the renin assay
  // front surface of the right forearm (midway elbow-wrist) and the front of the elbow. Neither paper fixes a body
  // site, so these are display placements: from the figure's arm joints, or on the HRA skin (no arm landmarks there)
  // at the elbow and wrist heights of Drillis & Contini (1966) body-segment proportions (0.630 H and 0.485 H).
  const frontOf = (p) => p ? onSkin(p.clone().add(new THREE.Vector3(0, 0, 0.4)), new THREE.Vector3(0, 0, -1)) : null;
  function armSlice(fracH) {
    // in a 12 mm slice at this height, the skin vertices on the body's right beyond the first 15 mm gap from the
    // outside are the arm hanging beside the trunk; cast onto its front surface at the cluster centre
    const y = bodyBox.min.y + fracH * H, pts = [], v = new THREE.Vector3();
    for (const m of skinMeshes) {
      const pos = m.geometry?.attributes?.position; if (!pos) continue;
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); if (Math.abs(v.y - y) < 0.006 && v.x < cx) pts.push([v.x, v.z]); }
    }
    if (pts.length < 20) return null;
    pts.sort((a, b) => a[0] - b[0]);
    let cut = -1; for (let i = 1; i < pts.length; i++) if (pts[i][0] - pts[i - 1][0] > 0.015) { cut = i; break; }
    if (cut < 8) return null;
    const a = pts.slice(0, cut), mx = a.reduce((s, q) => s + q[0], 0) / a.length, mz = a.reduce((s, q) => s + q[1], 0) / a.length;
    return frontOf(new THREE.Vector3(mx, y, mz));
  }
  const forearm = person.points.forearmFront || armSlice((0.630 + 0.485) / 2);
  const elbow = person.points.elbowFront || armSlice(0.630);
  credits.push('Forearm and elbow sites: the right forearm (between elbow 0.630 H and wrist 0.485 H) and elbow of the figure; neither sensor paper specifies a body site.');
  // From far away each arm site is a small ball you can tap. Close up the ball gives way to a thin ring drawn on
  // the skin itself (under any sleeve): a site marker 10 mm across, not the outline of a device. The patch's own
  // size is not in an open source and the renin test is a lab assay on drawn blood, so no device is drawn here.
  const markerGeo = new THREE.SphereGeometry(7 * MM, 20, 14);
  const farMarkers = [], rings = [], ARM = {};
  function skinRing(hit, col) {
    // the point on the bare skin under the (possibly clothed) hit, and a ring that follows the skin around it
    ray.set(hit.p.clone().add(hit.n.clone().multiplyScalar(0.08)), hit.n.clone().negate()); ray.far = 0.3;
    const h0 = ray.intersectObjects(bare, false)[0]; if (!h0) return null;
    const c = h0.point.clone(), n = hit.n.clone().normalize();
    const t1 = new THREE.Vector3().crossVectors(n, Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : up).normalize(), t2 = new THREE.Vector3().crossVectors(t1, n).normalize();
    // only the few skin triangles around the site, so following the surface costs almost nothing
    const tri = [], v3 = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (const m of bare) {
      const g = m.geometry, pos = g?.attributes?.position; if (!pos) continue;
      const idx = g.index, cnt = idx ? idx.count : pos.count, cl = m.worldToLocal(c.clone());
      const lim = (0.03 / (m.matrixWorld.getMaxScaleOnAxis() || 1)) ** 2;
      for (let i = 0; i + 2 < cnt; i += 3) {
        v3[0].fromBufferAttribute(pos, idx ? idx.getX(i) : i); if (v3[0].distanceToSquared(cl) > lim) continue;
        v3[1].fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1); v3[2].fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2);
        for (const q of v3) { q.applyMatrix4(m.matrixWorld); tri.push(q.x, q.y, q.z); }
      }
    }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
    const patch = [new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))];
    const R = 5 * MM, pts = [];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2, q = c.clone().add(t1.clone().multiplyScalar(R * Math.cos(a))).add(t2.clone().multiplyScalar(R * Math.sin(a)));
      ray.set(q.clone().add(n.clone().multiplyScalar(0.03)), n.clone().negate()); ray.far = 0.08;
      const h = tri.length ? ray.intersectObjects(patch, false)[0] : null;
      pts.push((h ? h.point.clone() : q).add(n.clone().multiplyScalar(0.25 * MM)));
    }
    pg.dispose();
    const ring = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 120, 0.11 * MM, 8, true), new THREE.MeshBasicMaterial({ color: col }));
    ring.visible = false; scene.add(ring); rings.push(ring);
    return { p: c, n, t1, t2, R };
  }
  function armSite(key, hit, col) {
    const m = new THREE.Mesh(markerGeo, mat(col, { emissive: col, emissiveIntensity: 0.35 }));
    m.position.copy(hit.p.clone().add(hit.n.clone().multiplyScalar(4 * MM))); sensorGroup.add(m); sensors[key].push(m); farMarkers.push(m);
    L[key] = hit.p.clone(); ARM[key] = skinRing(hit, 0x9fe6ff);
  }
  if (forearm) armSite('skin', forearm, colors.cqd || 0x6200ff);
  if (elbow) armSite('blood', elbow, 0x9aa08f);
  L.skin ||= new THREE.Vector3(bodyBox.min.x + 0.05, bodyBox.min.y + 0.53 * H, 0.03);
  L.blood ||= new THREE.Vector3(bodyBox.min.x + 0.07, bodyBox.min.y + 0.62 * H, 0.03);
  const ANCH = { brain: (sensors.brain[4] ? sensors.brain[4].getWorldPosition(new THREE.Vector3()) : L.brain), heart: chest ? chest.p.clone() : L.heart, blood: L.blood, skin: L.skin };
  for (const list of Object.values(sensors)) for (const m of list) m.userData.site = Object.keys(sensors).find((k) => sensors[k] === list);
  sensorGroup.traverse((o) => { if (o.isMesh && !o.userData.site) o.userData.site = null; });


  // ---------------------------------------------------------------- labels and picking
  const labelEls = {};
  for (const s of sites) {
    const el = document.createElement('button'); el.className = 'twin-label'; el.dataset.site = s.id;
    el.innerHTML = `<i></i>${s.name} <small>${s.sensor}</small>`;
    el.addEventListener('click', () => onSelect?.(s.id)); labelsEl.appendChild(el); labelEls[s.id] = el;
  }
  const ptr = new THREE.Vector2(); let downAt = null;
  canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    const r = canvas.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera); ray.far = 60;
    const hit = ray.intersectObjects(Object.values(sensors).flat(), false)[0];
    if (hit) { onSelect?.(hit.object.userData.site); return; }
    // otherwise an organ: report its key and HRA ontology ID so the app can show its cells and genes
    const orgObjs = Object.entries(organs).filter(([, o]) => o?.object).map(([k, o]) => { o.object.userData.organKey = k; return o.object; });
    const oh = ray.intersectObjects(orgObjs, true)[0];
    if (oh) { let o = oh.object; while (o && !o.userData.organKey) o = o.parent; onOrganPick?.({ key: o?.userData.organKey, ontology: oh.object.userData.ontology || null, name: oh.object.name }); }
  });
  // highlight the organ behind the selected sensor site (renin comes from the kidneys' juxtaglomerular cells)
  const SITE_ORGANS = { brain: ['brain'], heart: ['heart'], blood: ['kidney_left', 'kidney_right'], skin: [] };
  function focusOrgans(site) {
    for (const [k, o] of Object.entries(organs)) {
      const on = (SITE_ORGANS[site] || []).includes(k);
      o?.object?.traverse((m) => { if (m.isMesh && m.material?.emissive) { m.material.emissive.setHex(on ? 0x3a5530 : 0x000000); m.material.emissiveIntensity = on ? 0.9 : 0; } });
    }
  }

  // ---------------------------------------------------------------- state
  let selected = null, fly = null, focused = null, push = 0;
  let active = null, noteEls = [], garmentsOff = false;      // the current exact-scale view, its captions, clothes hidden
  const verdicts = {};
  const home = { pos: new THREE.Vector3(cx, bodyBox.min.y + 0.55 * H, 4.3 * H / 1.75), target: new THREE.Vector3(cx, bodyBox.min.y + 0.49 * H, 0) };
  camera.position.copy(home.pos); controls.target.copy(home.target);
  const OUT = { brain: new THREE.Vector3(-0.75, 0.55, 0.6), heart: new THREE.Vector3(0.25, 0.12, 1), blood: new THREE.Vector3(-0.7, 0.05, 0.75), skin: new THREE.Vector3(-0.75, 0.1, 0.7) };
  function select(id, { focus = false } = {}) {
    selected = id;
    for (const [k, el] of Object.entries(labelEls)) el.classList.toggle('on', k === id);
    focusOrgans(id);
    if (focus && ANCH[id]) {
      focused = id; personXray(id !== 'skin');
      const to = ANCH[id].clone().add(OUT[id].clone().normalize().multiplyScalar(id === 'brain' ? 0.42 : 0.38));
      fly = { from: camera.position.clone(), fromT: controls.target.clone(), to, toT: ANCH[id].clone(), t: 0 };
    }
  }
  function resetView() { focused = null; fly = { from: camera.position.clone(), fromT: controls.target.clone(), to: home.pos.clone(), toT: home.target.clone(), t: 0 }; }
  function setVerdict(site, v) {
    verdicts[site] = v;
    labelEls[site]?.classList.remove('met', 'notmet', 'needinfo');
    if (v) labelEls[site]?.classList.add({ REQUIREMENTS_MET: 'met', NOT_MET: 'notmet', NEED_MORE_INFORMATION: 'needinfo' }[v]);
  }
  function unitsPerPixel() {
    const d = camera.position.distanceTo(controls.target);
    return (2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / (canvas.clientHeight || 1);
  }
  // plain scroll descends or ascends one level per gesture; pinch (ctrl+wheel) or ctrl/cmd+scroll zooms freely
  let acc = 0, cooldown = 0;
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const k = Math.exp(e.deltaY * 0.0015), off = camera.position.clone().sub(controls.target);
      camera.position.copy(controls.target).add(off.setLength(Math.min(controls.maxDistance, Math.max(controls.minDistance, off.length() * k)))); fly = null; return;
    }
    if (performance.now() < cooldown) return;
    acc += e.deltaY;
    if (Math.abs(acc) > 90) { const dir = acc > 0 ? 'in' : 'out'; acc = 0; cooldown = performance.now() + 1100; onEdge?.(dir, focused || selected); }
  }, { passive: false });
  function fieldOfView() { return 2 * camera.position.distanceTo(controls.target) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)); }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); glow.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); leadersEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  new ResizeObserver(resize).observe(canvas); resize();

  const tmp = new THREE.Vector3(), t0 = performance.now();
  (function loop() {
    if (!canvas.isConnected) { renderer.dispose(); return; }   // replaced by a new figure
    requestAnimationFrame(loop);
    if (canvas.offsetParent === null) return;
    const t = (performance.now() - t0) / 1000;
    if (fly) {
      fly.t = Math.min(1, fly.t + 0.03); const k = fly.t < 0.5 ? 2 * fly.t * fly.t : 1 - (-2 * fly.t + 2) ** 2 / 2;
      camera.position.lerpVectors(fly.from, fly.to, k); controls.target.lerpVectors(fly.fromT, fly.toT, k); if (fly.t >= 1) fly = null;
    }
    controls.update();
    for (const [site, list] of Object.entries(sensors)) {
      const v = verdicts[site], col = VCOL[v];
      const pulse = v === 'NOT_MET' || v === 'NEED_MORE_INFORMATION' ? 0.35 + 0.35 * Math.sin(t * 5) : 0.25;
      for (const m of list) if (m.material.emissive) { m.material.emissive.setHex(col ?? 0x000000); m.material.emissiveIntensity = col && !closeUp ? pulse + (site === selected ? 0.25 : 0) : 0; }
    }
    // arm sites: a ball from far away, a ring on the skin close up; clothes step aside only when the view is
    // already inside a hand's width of the arm
    const fNow = fieldOfView(), near = fNow <= 0.25, off = !!active?.arm && fNow < 0.08;
    for (const m of farMarkers) m.visible = !near;
    for (const r of rings) r.visible = near;
    if (off !== garmentsOff) { garmentsOff = off; for (const d of dressed) if (!headShells.includes(d)) d.visible = !off; }
    glow.render();
    // labels with leader lines
    const w = canvas.clientWidth, h = canvas.clientHeight; let svg = '';
    for (const nt of noteEls) {
      tmp.copy(nt.p).project(camera);
      const vis = !fly && closeUp && tmp.z < 1 && Math.abs(tmp.x) < 0.9 && Math.abs(tmp.y) < 0.9;
      nt.el.style.display = vis ? '' : 'none';
      if (vis) nt.el.style.transform = `translate(${((tmp.x + 1) / 2) * w + 10}px, ${((1 - tmp.y) / 2) * h - 10}px)`;
    }
    const placed = [];
    for (const s of sites) {
      const el = labelEls[s.id], a = ANCH[s.id]; if (!a) { el.style.display = 'none'; continue; }
      tmp.copy(a).project(camera); if (tmp.z > 1) { el.style.display = 'none'; continue; }
      el.style.display = '';
      const x = (tmp.x * 0.5 + 0.5) * w, y = (-tmp.y * 0.5 + 0.5) * h, side = SIDE[s.id], ew = el.offsetWidth;
      let lx = x + side * Math.min(150, w * 0.11); lx = side > 0 ? Math.min(lx, w - ew - 10) : Math.max(lx, ew + 230);
      placed.push({ s, el, x, y, lx, ly: y - 8, side, ew, eh: el.offsetHeight });
    }
    // keep labels on the same side from overlapping: push later ones down
    for (const side of [1, -1]) {
      const list = placed.filter((p) => p.side === side).sort((a, b) => a.ly - b.ly);
      for (let i = 1; i < list.length; i++) { const prev = list[i - 1], min = prev.ly + (prev.eh + list[i].eh) / 2 + 6; if (list[i].ly < min) list[i].ly = min; }
    }
    for (const p of placed) {
      p.el.style.left = `${p.side > 0 ? p.lx : p.lx - p.ew}px`; p.el.style.top = `${p.ly - p.eh / 2}px`;
      const on = selected === p.s.id;
      svg += `<line x1="${p.x}" y1="${p.y}" x2="${p.lx}" y2="${p.ly}" class="${on ? 'on' : ''}"/><circle cx="${p.x}" cy="${p.y}" r="${on ? 4 : 2.5}"/>`;
    }
    leadersEl.innerHTML = svg;
  })();

  // ---------------------------------------------------------------- sensor-tab descent: frame a sensor in contact
  // with the body at a set field of view (visible height in metres); x-ray the housings to show the cell inside
  const tanH = () => Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const wp = (m) => m.getWorldPosition(new THREE.Vector3());
  const avg = (list) => list.reduce((a, m) => a.add(wp(m)), new THREE.Vector3()).divideScalar(list.length || 1);
  const opmCentre = sensors.brain[4] || sensors.brain[0];
  const scalpN = opmCentre ? new THREE.Vector3(0, 1, 0).applyQuaternion(opmCentre.parent.quaternion).normalize() : new THREE.Vector3(-0.7, 0.7, 0);
  const sideOf = (n) => new THREE.Vector3().crossVectors(n, Math.abs(n.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : up).normalize();
  // Views at exact fields of view (visible height, metres): 2.00 m the person, 3.00 cm a sensor on the body,
  // 5.00 mm the sensing element. `see` shows the bare, see-through body so the organ under the sensor shows.
  const VIEWS2 = {};
  VIEWS2.home = { site: null, fov: 2.0, target: new THREE.Vector3(cx, bodyBox.min.y + 0.5 * H, 0), dir: new THREE.Vector3(0, 0.05, 1) };
  if (sensors.brain.length) {
    // the sensor farthest from the middle of the grid, looked at from outside the grid, so nothing stands in front
    const c0 = avg(sensors.brain);
    const edge = sensors.brain.reduce((a, m) => (wp(m).distanceTo(c0) > wp(a).distanceTo(c0) ? m : a), sensors.brain[0]);
    const nE = new THREE.Vector3(0, 1, 0).applyQuaternion(edge.parent.quaternion).normalize();
    const out = wp(edge).sub(c0); out.sub(nE.clone().multiplyScalar(out.dot(nE))).normalize();
    const dirE = out.clone().multiplyScalar(0.92).add(nE.clone().multiplyScalar(0.32));
    VIEWS2.opm_contact = { site: 'brain', fov: 0.03, target: wp(edge).sub(nE.clone().multiplyScalar(0.003)), dir: dirE, xray: true, see: true };
    const cellMesh = edge.userData.cell;
    VIEWS2.opm_cell = { site: 'brain', fov: 0.005, target: cellMesh ? wp(cellMesh) : wp(edge), dir: dirE, xray: true, see: true };
  }
  if (chest) {
    const nvMesh = sensors.heart.find((m) => m.geometry?.type === 'CylinderGeometry');
    if (nvMesh) { const nvN = new THREE.Vector3(0, 1, 0).applyQuaternion(nvMesh.quaternion); VIEWS2.nv_contact = { site: 'heart', fov: 0.03, target: wp(nvMesh).sub(nvN.clone().multiplyScalar(0.005)), dir: nvN.clone().multiplyScalar(0.8).add(sideOf(nvN).multiplyScalar(0.55)).add(new THREE.Vector3(0, 0.22, 0)) }; }
  }
  // the two arm sites: look almost straight down at the bare skin (clothes step aside this close) with the ring in view
  const armView = (site, A, fallback, text) => {
    if (A) return { site, fov: 0.03, target: A.p.clone(), dir: A.n.clone().add(A.t1.clone().multiplyScalar(0.22)).add(A.t2.clone().multiplyScalar(0.3)), arm: true,
      notes: [{ p: A.p.clone().add(A.t2.clone().multiplyScalar(A.R * 1.15)), text }] };
    return { site, fov: 0.03, target: fallback.clone(), dir: new THREE.Vector3(-0.35, 0.25, 0.9) };
  };
  if (L.blood) VIEWS2.elbow = armView('blood', ARM.blood, L.blood, 'blood is taken here');
  if (L.skin) VIEWS2.forearm = armView('skin', ARM.skin, L.skin, 'the patch goes here');
  if (VIEWS2.opm_contact) {
    const e = VIEWS2.opm_contact, c = VIEWS2.opm_cell.target;
    e.notes = [{ p: c.clone(), text: 'glass cell' }]; VIEWS2.opm_cell.notes = [{ p: c.clone(), text: 'rubidium gas inside' }];
  }
  if (VIEWS2.nv_contact) VIEWS2.nv_contact.notes = [{ p: VIEWS2.nv_contact.target.clone(), text: 'diamond sensor face' }];
  // short plain captions for the close-up views
  function setNotes(v) {
    if (!notesEl) return;
    notesEl.innerHTML = ''; noteEls = [];
    for (const nt of v?.notes || []) { const el = document.createElement('div'); el.className = 'micro-label'; el.textContent = nt.text; el.style.display = 'none'; notesEl.appendChild(el); noteEls.push({ el, p: nt.p }); }
  }
  const housings = sensors.brain.concat(sensors.heart.filter((m) => m.geometry?.type === 'BoxGeometry'));
  let xrayOn = false;
  function setXray(on) {
    if (on === xrayOn) return; xrayOn = on;
    // needsUpdate: three.js compiles opaque materials with alpha forced to 1, so the switch needs a recompile
    for (const m of housings) { m.material.transparent = on; m.material.opacity = on ? 0.16 : 1; m.material.depthWrite = !on; m.material.needsUpdate = true; }
  }
  function view(name, { instant = false } = {}) {
    const v = VIEWS2[name]; if (!v) return false;
    if (v.site) { selected = v.site; focused = v.site; focusOrgans(v.site); for (const [k, el] of Object.entries(labelEls)) el.classList.toggle('on', k === v.site); } else focused = null;
    const dist = v.fov / (2 * tanH());
    camera.near = Math.max(0.0002, dist / 80); camera.updateProjectionMatrix();
    controls.minDistance = dist * 0.3; controls.maxDistance = Math.max(4.2, dist * 3);
    const to = v.target.clone().add(v.dir.clone().normalize().multiplyScalar(dist));
    if (instant) { camera.position.copy(to); controls.target.copy(v.target); fly = null; }
    else fly = { from: camera.position.clone(), fromT: controls.target.clone(), to, toT: v.target.clone(), t: 0 };
    setXray(!!v.xray); personXray(!!v.see); closeUp = v.fov < 0.5;
    active = v; setNotes(v);
    for (const h of headShells) h.visible = !v.see;
    glow.setStrength(v.fov < 0.5 ? 0.25 : 0.5);
    return true;
  }
  // push in past the current stop (used while the next, deeper scene loads) so the dive feels continuous
  function diveIn(k = 0.35) { const off = camera.position.clone().sub(controls.target); controls.minDistance = 0; fly = { from: camera.position.clone(), fromT: controls.target.clone(), to: controls.target.clone().add(off.multiplyScalar(k)), toT: controls.target.clone(), t: 0 }; }
  function views() { return Object.keys(VIEWS2); }
  function resetAll() { view('home'); }
  view('home', { instant: true });

  return { select, resetView: resetAll, setVerdict, unitsPerPixel, fieldOfView, resize, credits, organs, view, views, diveIn, setXray, hasAnatomy: !!anat, get focused() { return focused; } };
}
