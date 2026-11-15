// A regular, clothed comic person (male or female) for the body view. Built from simple rounded shapes so it reads
// like a newspaper-strip character. Joint heights are fractions of height H from Drillis & Contini (1966) body-segment
// proportions (as tabulated in Winter, Biomechanics and Motor Control of Human Movement): ankle 0.039, knee 0.285,
// hip 0.530, wrist 0.485, elbow 0.630, shoulder 0.818, eye 0.936; shoulder width 0.259, foot length 0.152, foot width
// 0.055, hand length 0.108. Widths, head size and clothing are a drawing choice, not measurements.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

export function buildPerson({ sex = 'male', H = 1.75, skin = 0xd9a07b, headCentre = null }) {
  const F = sex === 'female';
  const g = new THREE.Group(); g.name = `comic person (${sex})`;
  const meshes = [], mats = [];
  const mat = (c) => { const m = new THREE.MeshLambertMaterial({ color: c }); mats.push(m); return m; };
  const C = { skin: mat(skin), hair: mat(F ? 0x5a3424 : 0x3b2a20), shirt: mat(F ? 0xe0675a : 0x3f78c4), trousers: mat(F ? 0x34466e : 0x5b5446), shoes: mat(0x2a2a28) };
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1d1d1b }); eyeMat.userData.outlineParameters = { visible: false }; mats.push(eyeMat);
  const add = (geo, m, pos, quat, scale) => { const o = new THREE.Mesh(geo, m); if (pos) o.position.copy(pos); if (quat) o.quaternion.copy(quat); if (scale) o.scale.copy(scale); g.add(o); meshes.push(o); return o; };
  const limb = (a, b, r, m) => { const d = b.clone().sub(a); const o = add(new THREE.CapsuleGeometry(r, d.length(), 6, 18), m, a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize())); return o; };
  const v = (x, y, z = 0) => new THREE.Vector3(x * H, y * H, z * H);

  // torso (shirt): a lathe profile, flattened front to back
  const prof = F
    ? [[0, 0.515], [0.086, 0.52], [0.088, 0.56], [0.068, 0.625], [0.078, 0.69], [0.080, 0.75], [0.077, 0.795], [0.055, 0.82], [0.028, 0.83], [0, 0.832]]
    : [[0, 0.515], [0.080, 0.52], [0.083, 0.56], [0.074, 0.62], [0.082, 0.69], [0.089, 0.76], [0.087, 0.80], [0.060, 0.825], [0.030, 0.835], [0, 0.837]];
  add(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r * H, y * H)), 40), C.shirt, null, null, new THREE.Vector3(1, 1, 0.62));
  // hips (trousers)
  add(new THREE.SphereGeometry(1, 32, 16), C.trousers, v(0, 0.505), null, new THREE.Vector3((F ? 0.090 : 0.082) * H, 0.05 * H, 0.056 * H));
  // neck and head
  const neckR = (F ? 0.024 : 0.027) * H;
  limb(v(0, 0.80), v(0, 0.89), neckR, C.skin);
  const R = new THREE.Vector3(F ? 0.0745 : 0.0775, 0.065 * H, F ? 0.0945 : 0.0985);
  const hc = headCentre ? headCentre.clone() : new THREE.Vector3(0, H - R.y, 0.004);
  hc.y = Math.min(hc.y, H - R.y);
  add(new THREE.SphereGeometry(1, 40, 28), C.skin, hc, null, R);
  // hair: a cap over the top and back; a ponytail for the female figure
  const cap = add(new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI * (F ? 0.5 : 0.43)), C.hair, hc, null, R.clone().multiplyScalar(1.05));
  cap.rotation.x = -0.32;
  if (F) limb(hc.clone().add(new THREE.Vector3(0, 0.02, -R.z * 0.95)), hc.clone().add(new THREE.Vector3(0, -0.13, -R.z * 1.25)), 0.024, C.hair);
  // face: two eyes at eye height, 63 mm apart (mean adult interpupillary distance, Dodgson 2004), and a smile
  const onFace = (x, dy) => { const t = 1 - (x / R.x) ** 2 - (dy / R.y) ** 2; return new THREE.Vector3(hc.x + x, hc.y + dy, hc.z + R.z * Math.sqrt(Math.max(0, t))); };
  const eyeY = 0.936 * H - hc.y;
  for (const x of [-0.0315, 0.0315]) add(new THREE.SphereGeometry(0.006, 16, 12), eyeMat, onFace(x, eyeY).add(new THREE.Vector3(0, 0, 0.001)), null, new THREE.Vector3(1, 1.45, 0.45));
  const smile = add(new THREE.TorusGeometry(0.019, 0.0028, 6, 20, Math.PI * 0.62), eyeMat, onFace(0, eyeY - 0.05).add(new THREE.Vector3(0, 0, 0.002)));
  smile.rotation.z = Math.PI + Math.PI * 0.19;

  // arms, slightly away from the body; the body's right is -x
  const pts = {};
  for (const s of [-1, 1]) {
    const S = v(s * 0.105, 0.795), E = v(s * 0.125, 0.630), W = v(s * 0.143, 0.485), Hd = v(s * 0.154, 0.395);
    add(new THREE.SphereGeometry((F ? 0.020 : 0.022) * H, 20, 14), C.shirt, S);
    limb(S, E, (F ? 0.019 : 0.021) * H, C.shirt);             // short sleeve
    limb(E, W, (F ? 0.015 : 0.017) * H, C.skin);              // forearm
    limb(W, Hd, (F ? 0.016 : 0.018) * H, C.skin);             // hand
    if (s < 0) {
      const mid = E.clone().add(W).multiplyScalar(0.5), rF = (F ? 0.015 : 0.017) * H;
      pts.forearmFront = { p: mid.clone().add(new THREE.Vector3(0, 0, rF)), n: new THREE.Vector3(0, 0, 1) };
      pts.elbowFront = { p: E.clone().add(new THREE.Vector3(0, -0.01 * H, (F ? 0.019 : 0.021) * H)), n: new THREE.Vector3(0, 0, 1) };
    }
  }
  // legs (trousers) and shoes
  for (const s of [-1, 1]) {
    const Hj = v(s * 0.048, 0.50), K = v(s * 0.046, 0.285, 0.003), A = v(s * 0.044, 0.05);
    limb(Hj, K, (F ? 0.035 : 0.034) * H, C.trousers);
    limb(K, A, (F ? 0.025 : 0.026) * H, C.trousers);
    const fl = 0.152 * H, fw = 0.055 * H;
    const shoe = add(new THREE.CapsuleGeometry(fw / 2, fl - fw, 6, 16), C.shoes, v(s * 0.044, 0.022, 0.03));
    shoe.rotation.x = Math.PI / 2; shoe.scale.set(1, 1, 0.7);
  }

  function setXray(on) {
    for (const m of mats) { if (m === eyeMat) continue; m.transparent = on; m.opacity = on ? 0.2 : 1; m.depthWrite = !on; m.userData.outlineParameters = { visible: !on }; m.needsUpdate = true; }
  }
  return { group: g, meshes, head: { centre: hc, radii: R }, points: pts, setXray, H,
    credit: 'Comic figure drawn for SpinDrift: joint heights from Drillis & Contini (1966) body-segment proportions; widths, head size and clothes are a drawing choice.' };
}
