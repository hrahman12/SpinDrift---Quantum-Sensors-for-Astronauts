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
import { comicify, inkRenderer, comicLights } from './comic.js';
import { buildPerson } from './person.js';

const REF_H = 1.75;          // reference height for the fallback figure (m)
const MM = 0.001;
const VCOL = { REQUIREMENTS_MET: 0xa9d48c, NOT_MET: 0xff6b5b, NEED_MORE_INFORMATION: 0xe9b44c };
const SIDE = { brain: 1, heart: 1, blood: -1, skin: -1 };

export async function createTwin({ canvas, labelsEl, leadersEl, sites, onSelect, onProgress, onEdge, onOrganPick, colors = {}, opm = null, sex = 'male' }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.003, 60);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false; controls.enableDamping = true; controls.enableZoom = false;
  controls.minDistance = 0.12; controls.maxDistance = 7;
  comicLights(scene);
  const ink = inkRenderer(renderer, 0.0024);

  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.7, 96), new THREE.MeshBasicMaterial({ color: 0xe9dfc2, transparent: true, opacity: 0.75 }));
  disc.rotation.x = -Math.PI / 2; disc.material.userData.outlineParameters = { visible: false }; scene.add(disc);
  const grid = new THREE.PolarGridHelper(0.7, 12, 7, 96, 0xb9ad8c, 0xd6cba9); grid.position.y = 0.002; scene.add(grid);

  // ---------------------------------------------------------------- body
  // A regular, clothed comic person (ui/person.js). The Human Reference Atlas organs and sensor mounts (real
  // anatomy, CC BY 4.0) sit inside it; the figure turns see-through when a sensor site is opened.
  let anat = null, skinMeshes = [], credits = [], arm = null, hraH = null;
  const organs = {};
  try {
    const mod = await import('./anatomy.js');
    anat = await mod.loadAnatomy(onProgress, { sex, exclude: ['skin'] });
    const got = anat.manifest?.models?.heart?.sex || anat.manifest?.sex;
    if (got && got !== sex) throw new Error(`HRA ${sex} organs are not built yet`);
    scene.add(anat.group); anat.group.updateMatrixWorld(true);
    const skinObj = anat.skin?.object || anat.skin;
    if (skinObj) { const bb = new THREE.Box3().setFromObject(skinObj); hraH = bb.max.y - bb.min.y; skinObj.visible = false; }
    hraH = anat.manifest?.body_height_m || hraH;
    Object.assign(organs, anat.organs || {});
    credits = anat.credits || [];
  } catch (e) { console.info('HRA anatomy not shown:', e.message); if (anat?.group) scene.remove(anat.group); anat = null; }
  const brainC = organs.brain?.centroid ? new THREE.Vector3(...organs.brain.centroid) : null;
  const person = buildPerson({ sex, H: hraH || (sex === 'female' ? 1.613 : 1.753), headCentre: brainC ? brainC.clone().add(new THREE.Vector3(0, -0.035, 0.012)) : null });
  scene.add(person.group); person.group.updateMatrixWorld(true);
  skinMeshes = person.meshes;
  credits.push(person.credit);
  if (!anat) credits.push(sex === 'female' ? 'Female organs: Human Reference Atlas female set not loaded yet, so no organs are drawn inside.' : 'Organs: Human Reference Atlas set not available.');
  const personXray = (on) => person.setXray(on);
  scene.updateMatrixWorld(true);
  const bodyBox = new THREE.Box3().setFromObject(person.group);
  const H = bodyBox.max.y - bodyBox.min.y, cx = 0;

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
  function addOpm(site, s, cableTo) {
    const g = new THREE.Group();
    const housing = new THREE.Mesh(opmGeo, mat(0xeef0e8)); g.add(housing);
    const cell = new THREE.Mesh(new THREE.BoxGeometry(...OG.cellSize.map((q) => q * MM)), new THREE.MeshBasicMaterial({ color: colors.opm || 0xff0000 }));
    cell.position.set(...OG.cell.map((q) => q * MM)); g.add(cell);
    g.position.copy(s.p.clone().add(s.n.clone().multiplyScalar(OG.h * MM / 2)));
    g.quaternion.setFromUnitVectors(up, s.n);
    sensorGroup.add(g); sensors[site].push(housing);
    const top = s.p.clone().add(s.n.clone().multiplyScalar(OG.h * MM));
    const curve = new THREE.CatmullRomCurve3([top, top.clone().add(s.n.clone().multiplyScalar(0.04)), cableTo]);
    sensorGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 1.2 * MM, 6), mat(0x2b2f27)));
  }
  // nine OPMs: 3 x 3 grid at 25 mm pitch on the scalp over the right somatomotor area
  const mounts = anat?.mounts || {};
  // HRA mounts: 3 x 3 scalp grid over the right precentral gyrus, chest point over the heart (see data/anatomy/manifest.json)
  const scalpPts = mounts.scalp_right_precentral_gyrus?.points || null;
  const cableHead = L.brain.clone().add(new THREE.Vector3(-0.05, 0.35, -0.25));
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
      const s = fromOutside(L.heart, p.clone().sub(L.heart)); if (s) addOpm('heart', s, chest.p.clone().add(new THREE.Vector3(0.25, -0.3, 0.45)));
    }
    // JGU head: only the Ø12 mm front face is published (housing length is not), so a 1 mm-thick face disc is drawn
    const nvL = 1 * MM, nvR = 6 * MM;
    const nvPos = chest.p.clone().add(ty.clone().multiplyScalar(-65 * MM));
    const sNv = fromOutside(L.heart, nvPos.clone().sub(L.heart)) || { p: nvPos, n: chest.n };
    const nv = new THREE.Mesh(new THREE.CylinderGeometry(nvR, nvR, nvL, 28), mat(0xa9adb0, { metalness: 0.8, roughness: 0.3 }));
    nv.position.copy(sNv.p.clone().add(sNv.n.clone().multiplyScalar(10 * MM + nvL / 2)));
    nv.quaternion.setFromUnitVectors(up, sNv.n); sensorGroup.add(nv); sensors.heart.push(nv);
    const f0 = nv.position.clone().add(sNv.n.clone().multiplyScalar(nvL / 2));
    const fib = new THREE.CatmullRomCurve3([f0, f0.clone().add(sNv.n.clone().multiplyScalar(0.06)), f0.clone().add(new THREE.Vector3(0.2, -0.35, 0.4))]);
    sensorGroup.add(new THREE.Mesh(new THREE.TubeGeometry(fib, 20, 0.9 * MM, 6), mat(colors.nv || 0xff0000, { emissive: colors.nv || 0xff0000, emissiveIntensity: 0.3 })));
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
  const forearm = person.points.forearmFront || null;
  const elbow = person.points.elbowFront || null;
  credits.push('Forearm and elbow sites: the right forearm (between elbow 0.630 H and wrist 0.485 H) and elbow of the comic figure; neither sensor paper specifies a body site.');
  const markerGeo = new THREE.SphereGeometry(7 * MM, 20, 14);
  if (forearm) { const m = new THREE.Mesh(markerGeo, mat(colors.cqd || 0x6200ff, { emissive: colors.cqd || 0x6200ff, emissiveIntensity: 0.4 })); m.position.copy(forearm.p.clone().add(forearm.n.clone().multiplyScalar(4 * MM))); sensorGroup.add(m); sensors.skin.push(m); L.skin = forearm.p.clone(); }
  if (elbow) { const m = new THREE.Mesh(markerGeo, mat(0x9aa08f, { emissive: 0x9aa08f, emissiveIntensity: 0.3 })); m.position.copy(elbow.p.clone().add(elbow.n.clone().multiplyScalar(4 * MM))); sensorGroup.add(m); sensors.blood.push(m); L.blood = elbow.p.clone(); }
  L.skin ||= new THREE.Vector3(bodyBox.min.x + 0.05, bodyBox.min.y + 0.53 * H, 0.03);
  L.blood ||= new THREE.Vector3(bodyBox.min.x + 0.07, bodyBox.min.y + 0.62 * H, 0.03);
  const ANCH = { brain: (sensors.brain[4] ? sensors.brain[4].getWorldPosition(new THREE.Vector3()) : L.brain), heart: chest ? chest.p.clone() : L.heart, blood: L.blood, skin: L.skin };
  for (const list of Object.values(sensors)) for (const m of list) m.userData.site = Object.keys(sensors).find((k) => sensors[k] === list);
  sensorGroup.traverse((o) => { if (o.isMesh && !o.userData.site) o.userData.site = null; });

  comicify(scene, { keep: (o) => skinMeshes.includes(o) });

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
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); leadersEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
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
      for (const m of list) if (m.material.emissive) { m.material.emissive.setHex(col ?? 0x000000); m.material.emissiveIntensity = col ? pulse + (site === selected ? 0.25 : 0) : 0; }
    }
    ink.render(scene, camera);
    // labels with leader lines
    const w = canvas.clientWidth, h = canvas.clientHeight; let svg = '';
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
  const VIEWS2 = {};
  if (sensors.brain.length) {
    VIEWS2.opm_grid = { site: 'brain', fov: 0.30, target: avg(sensors.brain), dir: scalpN.clone().add(new THREE.Vector3(0, 0.15, 0.35)) };
    const skinPt = wp(opmCentre).sub(scalpN.clone().multiplyScalar(OG.h * MM / 2));
    VIEWS2.opm_contact = { site: 'brain', fov: 0.055, target: skinPt.clone().sub(scalpN.clone().multiplyScalar(0.004)), dir: sideOf(scalpN).add(scalpN.clone().multiplyScalar(0.35)), xray: true };
  }
  if (chest) {
    VIEWS2.chest = { site: 'heart', fov: 0.30, target: chest.p.clone(), dir: chest.n.clone().add(new THREE.Vector3(0.3, 0.15, 0)) };
    const nvMesh = sensors.heart.find((m) => m.geometry?.type === 'CylinderGeometry');
    if (nvMesh) { const nvN = new THREE.Vector3(0, 1, 0).applyQuaternion(nvMesh.quaternion); VIEWS2.nv_contact = { site: 'heart', fov: 0.05, target: wp(nvMesh).sub(nvN.clone().multiplyScalar(0.008)), dir: sideOf(nvN).add(nvN.clone().multiplyScalar(0.3)) }; }
  }
  const kid = [org('kidney_left'), org('kidney_right')].filter(Boolean);
  if (kid.length) VIEWS2.kidneys = { site: 'blood', fov: 0.36, target: kid.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(kid.length), dir: new THREE.Vector3(0, 0.12, 1) };
  if (L.skin) VIEWS2.forearm = { site: 'skin', fov: 0.16, target: L.skin.clone(), dir: (forearm?.n || new THREE.Vector3(0, 0, 1)).clone().add(new THREE.Vector3(-0.3, 0.1, 0)) };
  const housings = sensors.brain.concat(sensors.heart.filter((m) => m.geometry?.type === 'BoxGeometry'));
  function setXray(on) { for (const m of housings) { m.material.transparent = on; m.material.opacity = on ? 0.28 : 1; m.material.depthWrite = !on; } }
  function view(name) {
    const v = VIEWS2[name]; if (!v) return false;
    selected = v.site; focused = v.site; focusOrgans(v.site);
    const dist = v.fov / (2 * tanH());
    camera.near = Math.max(0.0002, dist / 60); camera.updateProjectionMatrix();
    controls.minDistance = dist * 0.15; controls.maxDistance = Math.max(7, dist * 6);
    fly = { from: camera.position.clone(), fromT: controls.target.clone(), to: v.target.clone().add(v.dir.clone().normalize().multiplyScalar(dist)), toT: v.target.clone(), t: 0 };
    setXray(!!v.xray); personXray(v.site !== 'skin');
    return true;
  }
  function views() { return Object.keys(VIEWS2); }
  const baseResetView = resetView;
  function resetAll() { camera.near = 0.003; camera.updateProjectionMatrix(); controls.minDistance = 0.12; controls.maxDistance = 7; setXray(false); personXray(false); baseResetView(); }

  return { select, resetView: resetAll, setVerdict, unitsPerPixel, fieldOfView, resize, credits, organs, view, views, setXray, hasAnatomy: !!anat, get focused() { return focused; } };
}
