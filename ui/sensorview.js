// Exact-spec 3D sensor viewer. The models (ui/sensors/<id>.js) draw only parts whose size is documented, to scale;
// this viewer adds rotate/zoom, click-to-focus on a component, exploded view, x-ray, labels and a true scale bar.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { D, esc, getJSON, fmtNum, chips } from './core.js';
import { niceLength } from './zoom.js';
import { glowView } from './look.js';

const UNIT_M = { mm: 1e-3, nm: 1e-9, 'µm': 1e-6, m: 1 };

export async function createSensorView(view, side, id) {
  const mod = await import(`./sensors/${id}.js`);
  const S = mod.SENSOR;
  for (const p of S.DATA || []) if (!(p in D)) D[p] = await getJSON(`/data/${p}.json`).catch(() => null);
  view.innerHTML = `<canvas></canvas><div class="sv-labels"></div>
    <div class="sv-tools">
      <div class="ctrl"><div class="row"><span>Exploded view</span><output id="sv-ex-o-${id}">0%</output></div><input type="range" id="sv-ex-${id}" min="0" max="1" step="0.01" value="0"></div>
      <button class="ghost" id="sv-xray-${id}">X-ray</button><button class="ghost on" id="sv-spin-${id}">Spin</button><button class="ghost" id="sv-reset-${id}">Reset view</button>
    </div>
    <div class="sv-scale"><i></i><span></span></div>`;
  const canvas = view.querySelector('canvas'), labelsEl = view.querySelector('.sv-labels'), scaleEl = view.querySelector('.sv-scale');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1e6);
  scene.add(new THREE.HemisphereLight(0xe8eddc, 0x1a1d16, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(2, 3, 2.5); camera.add(key); scene.add(camera);
  const glow = glowView(renderer, scene, camera, { strength: 0.45, threshold: 0.85 });
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 0.8;
  let built = null, buildId = S.builds?.[0], selected = null, xray = false, fit = null;
  const labels = [];
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

  function meshesOf(obj) { const out = []; obj.traverse((o) => { if (o.isMesh) out.push(o); }); return out; }
  function rebuild() {
    if (built) { scene.remove(built.root); try { built.dispose?.(); } catch (e) { console.warn(e); } }
    labelsEl.innerHTML = ''; labels.length = 0; selected = null;
    built = mod.build(D, { build: buildId });
    scene.add(built.root);
    for (const c of built.components) for (const m of meshesOf(c.object)) { m.userData.comp = c.id; m.userData.baseOpacity = m.material.opacity ?? 1; m.userData.baseEmissive = m.material.emissive ? m.material.emissive.getHex() : null; }
    for (const l of built.labels || []) {
      const el = document.createElement('div'); el.className = 'sv-label'; el.textContent = l.text; el.dataset.comp = l.component || '';
      labelsEl.appendChild(el); labels.push({ p: new THREE.Vector3(...l.position), el, comp: l.component });
    }
    let drawn = false; built.root.traverse((o) => { if (o.isMesh || o.isLine || o.isPoints) drawn = true; });
    view.querySelector('.sv-empty')?.remove();
    if (!drawn) {
      const msg = document.createElement('div'); msg.className = 'sv-empty';
      msg.innerHTML = 'Nothing is drawn: no dimension of this sensor is documented in a source we could open.<br>Parts known to exist are listed on the right with the reason.';
      view.appendChild(msg); drawSide(); return;
    }
    const box = new THREE.Box3().setFromObject(built.root), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z) || 1, dist = r / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.7;
    fit = { target: c.clone(), pos: c.clone().add(new THREE.Vector3(0.55, 0.38, 0.75).normalize().multiplyScalar(dist)) };
    camera.near = r / 2000; camera.far = r * 200; camera.updateProjectionMatrix();
    controls.minDistance = r * 0.02; controls.maxDistance = r * 8;
    camera.position.copy(fit.pos); controls.target.copy(fit.target); controls.update();
    applyXray(); drawSide();
  }
  function applyXray() {
    for (const c of built.components) if (c.xray) for (const m of meshesOf(c.object)) { m.material.transparent = xray || m.userData.baseOpacity < 1; m.material.opacity = xray ? 0.16 : m.userData.baseOpacity; m.material.depthWrite = !xray; }
  }
  let fly = null;
  function focus(compId) {
    selected = compId;
    for (const c of built.components) for (const m of meshesOf(c.object)) if (m.material.emissive) { m.material.emissive.setHex(c.id === compId ? 0x3d5a2a : (m.userData.baseEmissive ?? 0)); }
    labels.forEach((l) => l.el.classList.toggle('on', l.comp === compId));
    side.querySelectorAll('.comp').forEach((e) => e.classList.toggle('on', e.dataset.comp === compId));
    const c = built.components.find((x) => x.id === compId);
    if (c) {
      const box = new THREE.Box3().setFromObject(c.object), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
      const r = Math.max(size.x, size.y, size.z) || 1, dist = Math.max(controls.minDistance * 1.2, r / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 2.2);
      const dir = camera.position.clone().sub(controls.target).normalize();
      fly = { from: camera.position.clone(), fromT: controls.target.clone(), to: ctr.clone().add(dir.multiplyScalar(dist)), toT: ctr, t: 0 };
    }
    drawDetail();
  }
  function drawSide() {
    side.innerHTML = `<div class="kick"><span>${esc(S.title)}</span><span>to scale · ${esc(S.unit)}</span></div>
      ${S.builds ? `<div class="inp" style="margin-top:8px"><span>Build</span><select id="sv-build-${id}">${S.builds.map((b) => `<option value="${b}" ${b === buildId ? 'selected' : ''}>${esc(b.toUpperCase())}</option>`).join('')}</select></div>` : ''}
      <h4 style="margin:10px 0 6px;font:600 11px var(--mono);letter-spacing:.1em;color:var(--muted)">COMPONENTS · CLICK TO ZOOM</h4>
      ${built.components.map((c) => `<div class="comp" data-comp="${esc(c.id)}"><i style="background:${esc(c.color || '#8e9684')}"></i><span>${esc(c.name)}</span><small>${c.dims?.length || 0} dims</small></div>`).join('')}
      <div id="sv-detail-${id}"></div>
      ${built.undocumented?.length ? `<h4 style="margin:12px 0 4px;font:600 11px var(--mono);letter-spacing:.1em;color:var(--muted)">NOT DRAWN · SIZE NOT DOCUMENTED</h4>${built.undocumented.map((u) => `<div class="undoc"><b>${esc(u.name)}</b> · ${esc(u.reason)}</div>`).join('')}` : ''}
      <p class="src" style="margin-top:10px">${(S.sources || []).map(esc).join(' · ')}</p>`;
    side.querySelectorAll('.comp').forEach((e) => e.addEventListener('click', () => focus(e.dataset.comp)));
    side.querySelector(`#sv-build-${id}`)?.addEventListener('change', (e) => { buildId = e.target.value; rebuild(); });
    drawDetail();
  }
  function drawDetail() {
    const el = side.querySelector(`#sv-detail-${id}`); if (!el) return;
    const c = built.components.find((x) => x.id === selected);
    if (!c) { el.innerHTML = '<p class="note" style="margin-top:8px">Pick a component to zoom to it and see every documented dimension with its source.</p>'; return; }
    el.innerHTML = `<div class="box" style="margin-top:8px"><h3>${esc(c.name)}</h3>
      ${(c.dims || []).map((d) => `<div class="sup"><div><span>${esc(d.label)}</span><span class="vo"><span class="v">${d.value === null || d.value === undefined ? '<span class="na">not stated</span>' : esc(fmtNum(d.value))}</span> <small>${esc(d.unit || '')}</small> ${chips({ tag: d.tag || 'published_spec', status: d.status || 'VERIFIED' })}</span></div></div><div class="src">${esc(d.source || '')}</div>`).join('')}
      ${c.note ? `<p class="note">${esc(c.note)}</p>` : ''}</div>`;
  }

  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(built.root, true).find((h) => h.object.userData.comp && h.object.visible);
    if (hit) focus(hit.object.userData.comp);
  });
  view.querySelector(`#sv-ex-${id}`).addEventListener('input', (e) => { built.explode?.(+e.target.value); view.querySelector(`#sv-ex-o-${id}`).textContent = `${Math.round(e.target.value * 100)}%`; });
  view.querySelector(`#sv-xray-${id}`).addEventListener('click', (e) => { xray = !xray; e.target.classList.toggle('on', xray); applyXray(); });
  view.querySelector(`#sv-spin-${id}`).addEventListener('click', (e) => { controls.autoRotate = !controls.autoRotate; e.target.classList.toggle('on', controls.autoRotate); });
  view.querySelector(`#sv-reset-${id}`).addEventListener('click', () => { if (!fit) return; fly = { from: camera.position.clone(), fromT: controls.target.clone(), to: fit.pos.clone(), toT: fit.target.clone(), t: 0 }; });

  const ro = new ResizeObserver(() => { const w = view.clientWidth, h = view.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); glow.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); });
  ro.observe(view);
  rebuild();
  (function loop() {
    requestAnimationFrame(loop);
    if (view.offsetParent === null) return;
    if (fly) {
      fly.t = Math.min(1, fly.t + 0.04); const k = fly.t < 0.5 ? 2 * fly.t * fly.t : 1 - (-2 * fly.t + 2) ** 2 / 2;
      camera.position.lerpVectors(fly.from, fly.to, k); controls.target.lerpVectors(fly.fromT, fly.toT, k); if (fly.t >= 1) fly = null;
    }
    controls.update(); glow.render();
    const w = view.clientWidth, h = view.clientHeight;
    for (const l of labels) {
      tmp.copy(l.p).applyMatrix4(built.root.matrixWorld).project(camera);
      const vis = tmp.z < 1; l.el.style.display = vis ? '' : 'none';
      if (vis) l.el.style.transform = `translate(${((tmp.x + 1) / 2) * w + 8}px, ${((1 - tmp.y) / 2) * h - 9}px)`;
    }
    const f = UNIT_M[S.unit] ?? 1e-3;
    tmp.copy(controls.target).project(camera);
    tmp2.set(1, 0, 0).applyQuaternion(camera.quaternion).add(controls.target).project(camera);
    const ppu = Math.hypot((tmp2.x - tmp.x) * w / 2, (tmp2.y - tmp.y) * h / 2);
    if (ppu > 0) { const n = niceLength((90 / ppu) * f); scaleEl.querySelector('i').style.width = `${(n.metres / f) * ppu}px`; scaleEl.querySelector('span').textContent = `${fmtNum(n.value)} ${n.unit}`; }
  })();
  return { focus, rebuild, get built() { return built; } };
}
