// Live 3D molecule viewer (three.js). Draws only deposited or published coordinates:
// a protein C-alpha trace (PDB) or a small molecule's atoms and bonds (PubChem). Nothing is generated.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const CPK = { C: '#909090', N: '#3050f8', O: '#ff0d0d', H: '#ffffff' };   // Jmol CPK colours (a display convention)
const RAD = { C: 0.34, N: 0.33, O: 0.32, H: 0.18 };                          // ball-and-stick display radii, angstrom

export function createMolViewer(host, { kind, data, ss = {}, siteColor = '#a9d48c', onHover }) {
  const canvas = document.createElement('canvas');
  const layer = document.createElement('div'); layer.className = 'mol-labels';
  host.append(canvas, layer);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 5000);
  scene.add(new THREE.HemisphereLight(0xe1e5d6, 0x1c1f19, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.3); key.position.set(4, 6, 5); camera.add(key); scene.add(camera);
  const group = new THREE.Group(); scene.add(group);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 1.1; controls.enablePan = false;
  const labels = [];   // {pos: Vector3 (group space), el}
  const pickables = [];
  const hidden = { hydrogens: [] };
  let radius = 10;

  if (kind === 'protein') {
    const cols = { H: new THREE.Color(ss.H || '#ff9a3c'), E: new THREE.Color(ss.E || '#8fd0ff'), C: new THREE.Color(ss.C || '#7d8572') };
    const pts = data.ca.map((r) => new THREE.Vector3(r[3], r[4], r[5]));
    const c = new THREE.Vector3(); pts.forEach((p) => c.add(p)); c.divideScalar(pts.length);
    pts.forEach((p) => p.sub(c));
    // contiguous segments: break at residue-number gaps or C-alpha spacing over 4.3 A
    const segs = []; let cur = [0];
    for (let i = 1; i < pts.length; i++) {
      if (data.ca[i][1] - data.ca[i - 1][1] > 1 || pts[i].distanceTo(pts[i - 1]) > 4.3) { segs.push(cur); cur = []; }
      cur.push(i);
    }
    segs.push(cur);
    for (const seg of segs) {
      if (seg.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(seg.map((i) => pts[i]));
      const tub = seg.length * 6, rad = 8;
      const geo = new THREE.TubeGeometry(curve, tub, 0.45, rad, false);
      const colors = new Float32Array(geo.attributes.position.count * 3);
      for (let i = 0; i <= tub; i++) {
        const res = seg[Math.min(seg.length - 1, Math.round((i / tub) * (seg.length - 1)))];
        const col = cols[data.ca[res][6]] || cols.C;
        for (let j = 0; j <= rad; j++) { const v = (i * (rad + 1) + j) * 3; colors[v] = col.r; colors[v + 1] = col.g; colors[v + 2] = col.b; }
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 }));
      mesh.userData = { seg, tub, rad };
      group.add(mesh); pickables.push(mesh);
    }
    for (const s of data.active_sites || []) {
      const p = pts[s.index];
      const ball = new THREE.Mesh(new THREE.SphereGeometry(1.5, 24, 16), new THREE.MeshStandardMaterial({ color: siteColor, emissive: siteColor, emissiveIntensity: 0.35 }));
      ball.position.copy(p); group.add(ball);
      const el = document.createElement('div'); el.className = 'mol-label';
      el.textContent = `${s.pdb_name[0]}${s.pdb_name.slice(1).toLowerCase()}${s.pdb_residue} · catalytic`;
      layer.appendChild(el); labels.push({ pos: p.clone(), el, site: true });
    }
    radius = Math.max(...pts.map((p) => p.length()));
  } else {
    const at = data.atoms.map((a) => new THREE.Vector3(a[1], a[2], a[3]));
    const c = new THREE.Vector3(); at.forEach((p) => c.add(p)); c.divideScalar(at.length); at.forEach((p) => p.sub(c));
    const geoS = new THREE.SphereGeometry(1, 20, 14);
    const mats = {}; const mat = (el) => (mats[el] ||= new THREE.MeshStandardMaterial({ color: CPK[el] || '#ff80ff', roughness: 0.45 }));
    data.atoms.forEach((a, i) => {
      const m = new THREE.Mesh(geoS, mat(a[0])); m.position.copy(at[i]); m.scale.setScalar(RAD[a[0]] || 0.3);
      m.userData = { atom: i, el: a[0] }; group.add(m); pickables.push(m);
      if (a[0] === 'H') hidden.hydrogens.push(m);
    });
    const bondMat = new THREE.MeshStandardMaterial({ color: '#b9c0ab', roughness: 0.6 });
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 10);
    const up = new THREE.Vector3(0, 1, 0);
    for (const [i, j, order] of data.bonds) {
      const a = at[i], b = at[j], mid = a.clone().add(b).multiplyScalar(0.5), dir = b.clone().sub(a), len = dir.length();
      const q = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());
      const perp = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) < 0.9 * len ? up : new THREE.Vector3(1, 0, 0)).normalize().multiplyScalar(0.13);
      const offs = order === 2 ? [perp, perp.clone().negate()] : [new THREE.Vector3()];
      for (const o of offs) {
        const m = new THREE.Mesh(cyl, bondMat); m.position.copy(mid).add(o); m.quaternion.copy(q);
        m.scale.set(order === 2 ? 0.07 : 0.1, len, order === 2 ? 0.07 : 0.1); group.add(m);
        if (data.atoms[i][0] === 'H' || data.atoms[j][0] === 'H') hidden.hydrogens.push(m);
      }
    }
    radius = Math.max(...at.map((p) => p.length())) + 1;
  }
  camera.position.set(0, 0, radius / Math.sin(THREE.MathUtils.degToRad(19)) * 0.95);
  controls.update();

  // hover: residue (protein) or atom (small molecule) under the pointer
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables.filter((m) => m.visible), false)[0];
    if (!hit) { onHover?.(null); return; }
    if (kind === 'protein') {
      const { seg, tub, rad } = hit.object.userData;
      const i = Math.floor(hit.faceIndex / (2 * rad));
      const res = seg[Math.min(seg.length - 1, Math.round((i / tub) * (seg.length - 1)))];
      onHover?.({ residue: data.ca[res] });
    } else onHover?.({ atom: hit.object.userData.atom, el: hit.object.userData.el });
  });
  canvas.addEventListener('pointerleave', () => onHover?.(null));

  const ro = new ResizeObserver(() => {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  });
  ro.observe(host);
  const tmp = new THREE.Vector3();
  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (host.offsetParent === null) return;
    controls.update(); renderer.render(scene, camera);
    const w = host.clientWidth, h = host.clientHeight;
    for (const l of labels) {
      tmp.copy(l.pos).applyMatrix4(group.matrixWorld).project(camera);
      const vis = tmp.z < 1 && l.el.dataset.off !== '1';
      l.el.style.display = vis ? '' : 'none';
      if (vis) l.el.style.transform = `translate(${((tmp.x + 1) / 2) * w + 10}px, ${((1 - tmp.y) / 2) * h - 8}px)`;
    }
  };
  loop();
  return {
    set(name, on) {
      if (name === 'spin') controls.autoRotate = on;
      if (name === 'hydrogens') hidden.hydrogens.forEach((m) => { m.visible = on; });
      if (name === 'sites') { group.children.filter((m) => m.geometry?.type === 'SphereGeometry' && kind === 'protein').forEach((m) => { m.visible = on; }); labels.forEach((l) => { l.el.dataset.off = on ? '0' : '1'; }); }
    },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); },
  };
}
