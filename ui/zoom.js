// The descent below the body. Each level is a scene module in ui/scale/ built only from sourced data. This file
// renders it, points the camera at one of the scene's named views and sets the camera distance so the visible
// height is the level's EXACT field of view (2.00 m, 3.00 cm, 5.00 mm, 600 µm, 1.00 µm, 10.0 nm, 2.50 nm, then
// 500 pm and 10.0 fm). Levels that share a file are one continuous camera move; a new file zooms in, swaps, and
// keeps zooming. The card text lives in ui/story.js and is drawn by ui/app.js.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { D, getJSON, fmtNum } from './core.js';
import { glowView } from './look.js';

const UNIT_M = { m: 1, cm: 1e-2, mm: 1e-3, 'µm': 1e-6, 'μm': 1e-6, um: 1e-6, nm: 1e-9, 'Å': 1e-10, 'Å': 1e-10, pm: 1e-12, fm: 1e-15 };
const STEPS = [['m', 1], ['cm', 1e-2], ['mm', 1e-3], ['µm', 1e-6], ['nm', 1e-9], ['pm', 1e-12], ['fm', 1e-15]];

// a length in metres as three significant digits with the best unit: 0.03 -> 3.00 cm, 6e-4 -> 600 µm
export function fovText(metres) {
  for (const [u, f] of STEPS) { const v = metres / f; if (v >= 0.9995 || u === 'fm') return { num: v >= 99.95 ? v.toFixed(0) : v >= 9.995 ? v.toFixed(1) : v.toFixed(2), unit: u }; }
  return { num: String(metres), unit: 'm' };
}
export const scaleLabel = (metres) => { const t = fovText(metres); return `${t.num} ${t.unit}`; };
export function niceLength(metres) {
  for (const [u, f] of STEPS) {
    const v = metres / f;
    if (v >= 1 || u === 'fm') { const p = 10 ** Math.floor(Math.log10(v)), m = v / p; const n = m >= 5 ? 5 : m >= 2 ? 2 : 1; return { value: n * p, unit: u, metres: n * p * f }; }
  }
  return { value: metres, unit: 'm', metres };
}

export function createMicro({ canvas, labelsEl, scaleEl, onEdge, onFov, onTick }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.001, 1e6);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.enableZoom = false;   // plain scroll descends; pinch or ctrl+scroll zooms
  const view = glowView(renderer, new THREE.Scene(), camera, { strength: 0.6, threshold: 0.8 });
  let cur = null, fly = null, acc = 0, cooldown = 0, lastTick = 0, showLabels = false, token = 0;
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  const tanH = () => Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); view.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);

  function close() {
    if (cur) { try { cur.built.dispose?.(); } catch (e) { console.warn(e); } }
    cur = null; labelsEl.innerHTML = '';
  }
  // where the camera should sit for a view at an exact field of view
  function pose(built, level, lv) {
    const cam = built.camera || {}, v = built.views?.[lv.view] || built.views?.default || null;
    const target = new THREE.Vector3(...(v?.target || cam.target || [0, 0, 0]));
    let dir = v?.dir ? new THREE.Vector3(...v.dir) : new THREE.Vector3(...(cam.position || [0, 0, 10])).sub(new THREE.Vector3(...(cam.target || [0, 0, 0])));
    if (dir.lengthSq() < 1e-12) dir.set(0, 0, 1);
    dir.normalize();
    const unitM = UNIT_M[level.unit];
    const dist = lv.fov && unitM && !level.dimensionless ? (lv.fov / unitM) / (2 * tanH())
      : new THREE.Vector3(...(cam.position || [0, 0, 10])).distanceTo(new THREE.Vector3(...(cam.target || [0, 0, 0])));
    return { target, pos: target.clone().add(dir.multiplyScalar(dist)), dist };
  }
  function range(dist) { controls.minDistance = dist * 0.25; controls.maxDistance = dist * 4; camera.near = dist / 3000; camera.far = dist * 3000; camera.updateProjectionMatrix(); }

  // show one level: lv = { file, view, fov (metres) }; dir 'in' when descending
  async function show(lv, { dir = 'in', env = null, depth = 0 } = {}) {
    const my = ++token;
    view.setStrength(0.45 + 0.75 * depth);
    if (cur && cur.file === lv.file) {            // same scene: one continuous camera move
      try { cur.built.setView?.(lv.view); } catch (e) { console.warn(e); }
      cur.built.scene.background = new THREE.Color('#070a1e').lerp(new THREE.Color('#1a0830'), depth);
      const p = pose(cur.built, cur.level, lv); range(Math.min(p.dist, camera.position.distanceTo(controls.target)));
      controls.minDistance = 0; controls.maxDistance = Infinity;
      fly = { from: camera.position.clone(), fromT: controls.target.clone(), to: p.pos, toT: p.target, t: 0, dur: 1.1, done: () => range(p.dist) };
      cur.lv = lv; return cur;
    }
    if (cur) {                                     // leave the old scene with a short push in (or pull out)
      const off = camera.position.clone().sub(controls.target);
      controls.minDistance = 0; controls.maxDistance = Infinity;
      fly = { from: camera.position.clone(), fromT: controls.target.clone(), to: controls.target.clone().add(off.multiplyScalar(dir === 'in' ? 0.3 : 3)), toT: controls.target.clone(), t: 0, dur: 0.35 };
    }
    const mod = await import(`./scale/${lv.file}`);
    for (const p of mod.DATA || []) if (!(p in D)) D[p] = await getJSON(`/data/${p}.json`).catch(() => null);
    const built = await mod.build(D, { view: lv.view, env });
    if (my !== token) { try { built.dispose?.(); } catch { /* superseded */ } return null; }
    close();
    cur = { file: lv.file, lv, mod, built, level: mod.LEVEL || {}, labels: [] };
    built.scene.background = new THREE.Color('#070a1e').lerp(new THREE.Color('#1a0830'), depth);   // navy at the top, violet at the bottom of the dive
    try { built.setEnv?.(env); built.setView?.(lv.view); } catch (e) { console.warn(e); }
    camera.fov = built.camera?.fov || 40; camera.updateProjectionMatrix();
    const p = pose(built, cur.level, lv);
    controls.target.copy(p.target); controls.minDistance = 0; controls.maxDistance = Infinity;
    camera.near = p.dist / 3000; camera.far = p.dist * 3000; camera.updateProjectionMatrix();
    const k = dir === 'in' ? 3.2 : 0.3;
    camera.position.copy(p.target.clone().add(p.pos.clone().sub(p.target).multiplyScalar(k)));
    fly = { from: camera.position.clone(), fromT: p.target.clone(), to: p.pos, toT: p.target, t: 0, dur: 1.0, done: () => range(p.dist) };
    controls.update(); resize();
    for (const l of built.labels || []) {
      const el = document.createElement('div'); el.className = 'micro-label'; el.textContent = l.text;
      labelsEl.appendChild(el); cur.labels.push({ p: new THREE.Vector3(...l.position), el });
    }
    return cur;
  }
  function setEnv(env) { try { cur?.built.setEnv?.(env); } catch (e) { console.warn(e); } }
  function setLabels(on) { showLabels = on; }

  // plain scroll: one level per gesture; pinch (ctrl+wheel) or ctrl/cmd+scroll: zoom inside the level
  canvas.addEventListener('wheel', (e) => {
    if (!cur) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const k = Math.exp(e.deltaY * 0.0015), off = camera.position.clone().sub(controls.target);
      const len = Math.min(controls.maxDistance, Math.max(controls.minDistance, off.length() * k));
      camera.position.copy(controls.target).add(off.setLength(len)); fly = null; return;
    }
    if (performance.now() < cooldown) return;
    acc += e.deltaY;
    if (Math.abs(acc) > 90) { const d = acc > 0 ? 'in' : 'out'; acc = 0; cooldown = performance.now() + 900; onEdge?.(d); }
  }, { passive: false });

  const clock = new THREE.Clock();
  (function loop() {
    requestAnimationFrame(loop);
    if (!cur || canvas.offsetParent === null) return;
    const dt = Math.min(0.05, clock.getDelta()), t = clock.elapsedTime;
    if (fly) {
      fly.t = Math.min(1, fly.t + dt / fly.dur); const k = 1 - (1 - fly.t) ** 3;
      // move in log distance so a hundred-fold zoom feels even
      const d0 = fly.from.distanceTo(fly.fromT), d1 = fly.to.distanceTo(fly.toT);
      controls.target.lerpVectors(fly.fromT, fly.toT, k);
      const dirF = fly.from.clone().sub(fly.fromT).normalize(), dirT = fly.to.clone().sub(fly.toT).normalize();
      const dirN = dirF.lerp(dirT, k).normalize(), dist = Math.exp(Math.log(d0) + (Math.log(d1) - Math.log(d0)) * k);
      camera.position.copy(controls.target).add(dirN.multiplyScalar(dist));
      if (fly.t >= 1) { const done = fly.done; fly = null; done?.(); }
    }
    try { cur.built.update?.(dt, t); } catch (e) { console.warn(e); }
    controls.update();
    view.render(cur.built.scene);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const l of cur.labels) {
      tmpA.copy(l.p).project(camera);
      const vis = showLabels && tmpA.z < 1 && Math.abs(tmpA.x) < 1.05 && Math.abs(tmpA.y) < 1.05;
      l.el.style.display = vis ? '' : 'none';
      if (vis) l.el.style.transform = `translate(${((tmpA.x + 1) / 2) * w + 8}px, ${((1 - tmpA.y) / 2) * h - 9}px)`;
    }
    // true scale bar and field of view at the orbit target's depth
    const unit = cur.level.unit || 'nm', f = UNIT_M[unit] ?? 1e-9;
    tmpA.copy(controls.target).project(camera); const ax = tmpA.x, ay = tmpA.y;
    tmpB.set(1, 0, 0).applyQuaternion(camera.quaternion).add(controls.target).project(camera);
    const pxPerUnit = Math.hypot((tmpB.x - ax) * w / 2, (tmpB.y - ay) * h / 2);
    const fovUnits = 2 * camera.position.distanceTo(controls.target) * tanH();
    if (cur.level.dimensionless) {
      const Lb = cur.level.scaleBar?.length || 1;
      if (pxPerUnit > 0) { scaleEl.querySelector('i').style.width = `${Lb * pxPerUnit}px`; scaleEl.querySelector('span').textContent = cur.level.scaleBar?.label || `${fmtNum(Lb)} ${unit}`; }
      onFov?.(null, `${fovUnits.toFixed(fovUnits >= 10 ? 1 : 2)} ${unit}`);
    } else {
      if (pxPerUnit > 0) {
        const nice = niceLength((90 / pxPerUnit) * f);
        scaleEl.querySelector('i').style.width = `${(nice.metres / f) * pxPerUnit}px`;
        scaleEl.querySelector('span').textContent = `${fmtNum(nice.value)} ${nice.unit}`;
      }
      onFov?.(fovUnits * f);
    }
    if (t - lastTick > 0.25) { lastTick = t; onTick?.(cur); }
  })();

  return { show, close, resize, setEnv, setLabels, get current() { return cur; } };
}
