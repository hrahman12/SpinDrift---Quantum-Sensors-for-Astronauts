// SpinDrift quantum body twin (Three.js). The figure is "Cesium Man" (c) 2017 Cesium, CC BY 4.0
// (KhronosGroup glTF-Sample-Assets); its material is replaced, so the Cesium logo texture (excluded from the licence)
// is never shown. Markers and sensors are schematic: parts and labels only, never data shapes.
// A marker is grey until a real dataset exists for that system; then it takes the reading sensor's own colour
// from data/palette.json (wavelength-derived). Colour never means "healthy" or "unhealthy": SpinDrift does not diagnose.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// anchor points in model units (joint positions read from the GLB: shoulders y 1.074, elbows (+-0.306, 0.964),
// wrists (+-0.447, 0.882), neck 1.126-1.193, height 1.45)
const ANCHORS = {
  brain:  [0.0, 1.33, 0.0],
  heart:  [0.035, 0.985, 0.045],
  lungs:  [-0.06, 1.0, 0.0],
  blood:  [0.306, 0.962, 0.0],
  skin:   [-0.377, 0.923, 0.03],
  tumour: [0.0, 0.62, 0.0],
};
const LABEL_SIDE = { brain: 1, heart: 1, lungs: -1, blood: 1, skin: -1, tumour: -1 };
const GREY = 0x7d8574;

export async function createTwin({ canvas, labelsEl, leadersEl, systems, modelUrl, onSelect, onProgress, safeArea }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
  camera.position.set(0.0, 1.0, 3.1);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.78, 0);
  controls.enablePan = false;
  controls.minDistance = 1.6;
  controls.maxDistance = 5;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = 1.75;
  controls.enableDamping = true;

  scene.add(new THREE.HemisphereLight(0xe8eddc, 0x1c2018, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(1.5, 2.5, 2.0);
  scene.add(key);

  // platform
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.62, 72),
    new THREE.MeshBasicMaterial({ color: 0x3a4a33, transparent: true, opacity: 0.55 }));
  disc.rotation.x = -Math.PI / 2;
  scene.add(disc);
  const grid = new THREE.PolarGridHelper(0.62, 12, 6, 72, 0x6f8b5f, 0x4c5e42);
  grid.position.y = 0.002;
  scene.add(grid);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.004, 8, 120),
    new THREE.MeshBasicMaterial({ color: 0x9dbd86 }));
  rim.rotation.x = Math.PI / 2;
  scene.add(rim);

  // body
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xd9dfcc, transparent: true, opacity: 0.32, roughness: 0.55,
    metalness: 0.0, depthWrite: false, side: THREE.DoubleSide });
  const wireMat = new THREE.MeshBasicMaterial({ color: 0xc9d4b8, wireframe: true, transparent: true, opacity: 0.22 });
  let bodyMeshes = [];
  let modelOk = false;
  try {
    const gltf = await new GLTFLoader().loadAsync(modelUrl, (e) => onProgress && e.total && onProgress(e.loaded / e.total));
    gltf.scene.traverse((o) => {
      if (o.isMesh) { o.material = bodyMat; o.frustumCulled = false; bodyMeshes.push(o); }
    });
    scene.add(gltf.scene);
    modelOk = true;
  } catch (e) {
    // fallback: a plain figure from primitives (parts only)
    const g = new THREE.Group();
    const add = (geo, x, y, z) => { const m = new THREE.Mesh(geo, bodyMat); m.position.set(x, y, z); g.add(m); bodyMeshes.push(m); };
    add(new THREE.SphereGeometry(0.11, 24, 16), 0, 1.31, 0);
    add(new THREE.CapsuleGeometry(0.13, 0.33, 8, 16), 0, 0.92, 0);
    for (const s of [-1, 1]) {
      add(new THREE.CapsuleGeometry(0.04, 0.4, 6, 12), s * 0.07, 0.34, 0);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.36, 6, 12), bodyMat);
      arm.position.set(s * 0.27, 0.98, 0); arm.rotation.z = s * 1.2; g.add(arm); bodyMeshes.push(arm);
    }
    scene.add(g);
  }

  // organ markers
  const markers = {};
  const markerGroup = new THREE.Group();
  scene.add(markerGroup);
  const mk = (id, geo, scale = [1, 1, 1], pos) => {
    const mat = new THREE.MeshStandardMaterial({ color: GREY, emissive: GREY, emissiveIntensity: 0.25, transparent: true,
      opacity: 0.9, roughness: 0.4 });
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(...scale);
    m.position.set(...(pos || ANCHORS[id]));
    m.userData.system = id;
    markerGroup.add(m);
    (markers[id] = markers[id] || []).push(m);
    return m;
  };
  mk('brain', new THREE.SphereGeometry(0.06, 24, 16), [1.15, 0.85, 1.0]);
  mk('heart', new THREE.SphereGeometry(0.032, 20, 14), [1, 1.2, 0.9]);
  mk('lungs', new THREE.SphereGeometry(0.045, 20, 14), [0.8, 1.5, 0.7], [-0.065, 1.0, -0.005]);
  mk('lungs', new THREE.SphereGeometry(0.045, 20, 14), [0.8, 1.5, 0.7], [0.07, 1.0, -0.005]);
  mk('blood', new THREE.SphereGeometry(0.022, 16, 12));
  mk('skin', new THREE.BoxGeometry(0.06, 0.012, 0.045), [1, 1, 1]);
  const halo = mk('tumour', new THREE.TorusGeometry(0.34, 0.008, 8, 120), [1, 1, 1]);
  halo.rotation.x = Math.PI / 2;

  // sensors (shown in "sensors" mode): sizes from specs (OPM head 12.4 x 16.6 x 24.4 mm; NV head 12 mm), scaled to the figure
  const sensorGroup = new THREE.Group();
  sensorGroup.visible = false;
  scene.add(sensorGroup);
  const s = 1.45 / 1750; // model units per mm for a 1.75 m person
  const opmGeo = new THREE.BoxGeometry(12.4 * s * 1.6, 24.4 * s * 1.6, 16.6 * s * 1.6);
  const opmMat = new THREE.MeshStandardMaterial({ color: 0xe6e9df, roughness: 0.5 });
  for (let i = 0; i < 9; i++) { // helmet array: nine OPMs, as in the MNE OPM recording
    const a = -1.1 + i * (2.2 / 8), r = 0.135;
    const b = new THREE.Mesh(opmGeo, opmMat);
    b.position.set(Math.sin(a) * r, 1.36 + Math.cos(a * 1.4) * 0.03, Math.cos(a) * r * 0.85);
    b.lookAt(0, 1.33, 0);
    sensorGroup.add(b);
  }
  for (const [dx, dy] of [[0, 0], [-0.03, 0], [-0.03, 0.03], [0, 0.03]]) { // Kiel 2 x 2 chest array (3 cm spacing)
    const b = new THREE.Mesh(opmGeo, opmMat);
    b.position.set(0.05 + dx * 1.2, 0.97 + dy * 1.2, 0.12);
    sensorGroup.add(b);
  }
  const nv = new THREE.Mesh(new THREE.CylinderGeometry(6 * s * 2.2, 6 * s * 2.2, 0.05, 20),
    new THREE.MeshStandardMaterial({ color: 0xb8bcb0, metalness: 0.6, roughness: 0.3 }));
  nv.rotation.x = Math.PI / 2;
  nv.position.set(0.0, 0.93, 0.13);
  sensorGroup.add(nv);

  // labels
  const labelEls = {};
  for (const sys of systems) {
    const el = document.createElement('button');
    el.className = 'twin-label';
    el.dataset.system = sys.id;
    el.innerHTML = `<span class="n">${sys.n}</span>${sys.name}`;
    el.addEventListener('click', () => onSelect && onSelect(sys.id));
    labelsEl.appendChild(el);
    labelEls[sys.id] = el;
  }

  // picking
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let downAt = null;
  canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    const r = canvas.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(markerGroup.children, false)[0];
    if (hit && onSelect) onSelect(hit.object.userData.system);
  });

  let selected = null;
  function setState(id, { color = null, hasData = false } = {}) {
    for (const m of markers[id] || []) {
      const c = hasData && color ? new THREE.Color(color) : new THREE.Color(GREY);
      m.material.color.copy(c);
      m.material.emissive.copy(c);
      m.material.emissiveIntensity = hasData ? 0.65 : 0.2;
    }
    if (labelEls[id]) labelEls[id].classList.toggle('has-data', !!hasData);
  }
  function select(id) {
    selected = id;
    for (const [k, el] of Object.entries(labelEls)) el.classList.toggle('on', k === id);
    for (const [k, list] of Object.entries(markers)) for (const m of list) m.scale.multiplyScalar(1); // keep scale
  }
  function setMode(mode) {
    sensorGroup.visible = mode === 'sensors';
    for (const m of bodyMeshes) m.material = mode === 'sensors' ? wireMat : bodyMat;
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    leadersEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  window.addEventListener('resize', resize);
  resize();

  const tmp = new THREE.Vector3();
  function placeLabels() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const safe = (safeArea && safeArea()) || { left: 0, right: w };
    let svg = '';
    for (const sys of systems) {
      const el = labelEls[sys.id];
      tmp.set(...ANCHORS[sys.id]);
      if (sys.id === 'tumour') tmp.x -= 0.34;
      tmp.project(camera);
      const x = (tmp.x * 0.5 + 0.5) * w, y = (-tmp.y * 0.5 + 0.5) * h;
      const side = LABEL_SIDE[sys.id];
      const ew = el.offsetWidth;
      let lx = x + side * Math.min(170, w * 0.12);
      // keep the label inside the visible stage (between the side panels)
      if (side > 0) lx = Math.min(lx, safe.right - ew - 8); else lx = Math.max(lx, safe.left + ew + 8);
      const ly = y - 8;
      el.style.left = `${side > 0 ? lx : lx - ew}px`;
      el.style.top = `${ly - el.offsetHeight / 2}px`;
      const on = selected === sys.id;
      svg += `<line x1="${x}" y1="${y}" x2="${lx}" y2="${ly}" class="${on ? 'on' : ''}"/><circle cx="${x}" cy="${y}" r="${on ? 4 : 2.5}" class="${on ? 'on' : ''}"/>`;
    }
    leadersEl.innerHTML = svg;
  }

  let t0 = performance.now();
  (function loop() {
    requestAnimationFrame(loop);
    const t = (performance.now() - t0) / 1000;
    controls.update();
    for (const [id, list] of Object.entries(markers)) {
      const pulse = id === selected ? 1 + 0.12 * Math.sin(t * 4) : 1;
      for (const m of list) m.material.opacity = id === selected ? 0.95 : 0.8 * pulse;
    }
    halo.rotation.z = t * 0.15;
    renderer.render(scene, camera);
    placeLabels();
  })();

  return { setState, select, setMode, resize, modelOk };
}
