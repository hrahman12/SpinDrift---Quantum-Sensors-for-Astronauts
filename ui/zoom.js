// Powers-of-ten descent below the body: cell, molecule + gene, and quantum scenes for each sensor's body site.
// Each scene is a module in ui/scale/ that builds itself only from sourced data (see ui/scale/README.md); this file
// renders it (with a glow pass for emissive parts), draws its labels, readouts, controls and gene track, keeps a true
// scale bar and a live field-of-view readout, and turns scrolling into descending or ascending one level.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { D, esc, getJSON, lean, fmtNum } from './core.js';

export const CHAINS = {
  brain: { cell: 'cell_neuron.js', quantum: 'q_rb.js' },
  heart: { cell: 'cell_cardiomyocyte.js', molecule: 'mol_nav15.js', quantum: 'q_nv.js' },
  blood: { cell: 'cell_rbc.js', molecule: 'mol_renin.js', quantum: 'q_qd.js' },
  skin: { cell: 'cell_skin.js', molecule: 'mol_bilirubin.js', quantum: 'q_cqd.js' },
};
export const LEVEL_NAMES = { body: 'Body', organ: 'Sensor site', cell: 'Cell', molecule: 'Molecule + gene', quantum: 'Quantum' };

const UNIT_M = { m: 1, cm: 1e-2, mm: 1e-3, 'µm': 1e-6, 'μm': 1e-6, um: 1e-6, nm: 1e-9, 'Å': 1e-10, 'Å': 1e-10 };
export function niceLength(metres) {
  const steps = [['m', 1], ['cm', 1e-2], ['mm', 1e-3], ['µm', 1e-6], ['nm', 1e-9], ['Å', 1e-10], ['pm', 1e-12]];
  for (const [u, f] of steps) {
    const v = metres / f;
    if (v >= 1 || u === 'pm') { const p = 10 ** Math.floor(Math.log10(v)), m = v / p; const n = m >= 5 ? 5 : m >= 2 ? 2 : 1; return { value: n * p, unit: u, metres: n * p * f }; }
  }
  return { value: metres, unit: 'm', metres };
}
// a length in metres as three significant digits with the best SI unit, for the field-of-view readout
export function fovText(metres) {
  const steps = [['m', 1], ['cm', 1e-2], ['mm', 1e-3], ['µm', 1e-6], ['nm', 1e-9]];
  for (const [u, f] of steps) { const v = metres / f; if (v >= 1 || u === 'nm') return { num: v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2), unit: u }; }
  return { num: String(metres), unit: 'm' };
}

export function createMicro({ canvas, labelsEl, hud, scaleEl, onEdge, onFov }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.001, 1e6);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.enableZoom = false;   // plain scroll descends; pinch or ctrl+scroll zooms
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(new THREE.Scene(), camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 0.82);
  composer.addPass(renderPass); composer.addPass(bloom); composer.addPass(new OutputPass());
  let cur = null, lastRO = 0, acc = 0, cooldown = 0, intro = null;
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);

  function close() {
    if (cur) { try { cur.built.dispose?.(); } catch (e) { console.warn(e); } }
    cur = null; labelsEl.innerHTML = '';
    for (const k of ['info', 'readouts', 'controls', 'gene']) hud[k].innerHTML = '';
  }

  // dir 'in' starts wide and descends into the scene; 'out' starts close and pulls back
  async function open(site, level, opts = {}) {
    const file = CHAINS[site]?.[level];
    if (!file) throw new Error(`no ${level} scene for ${site}`);
    return openFile(file, opts);
  }
  async function openFile(file, { dir = 'in', index = 0, total = 0, name = '' } = {}) {
    const mod = await import(`./scale/${file}`);
    for (const p of mod.DATA || []) if (!(p in D)) D[p] = await getJSON(`/data/${p}.json`).catch(() => null);
    const built = await mod.build(D);
    close();
    cur = { mod, built, level: mod.LEVEL || {}, labels: [], index, total, name };
    renderPass.scene = built.scene;
    const cam = built.camera || {};
    camera.fov = cam.fov || 40;
    const target = new THREE.Vector3(...(cam.target || [0, 0, 0])), home = new THREE.Vector3(...(cam.position || [0, 0, 10]));
    controls.target.copy(target);
    const d = home.distanceTo(target);
    controls.minDistance = d * 0.06; controls.maxDistance = d * 6;
    camera.near = d / 2000; camera.far = d * 2000; camera.updateProjectionMatrix();
    const startK = dir === 'out' ? 0.35 : 3.2;
    camera.position.copy(target.clone().add(home.clone().sub(target).multiplyScalar(startK)));
    intro = { from: camera.position.clone(), to: home.clone(), t: 0 };
    cur.home = home.clone();
    controls.update(); resize();
    for (const l of built.labels || []) {
      const el = document.createElement('div'); el.className = 'micro-label'; el.textContent = l.text;
      labelsEl.appendChild(el); cur.labels.push({ p: new THREE.Vector3(...l.position), el });
    }
    drawInfo(); drawControls(); drawGene(); drawReadouts();
    return cur.level;
  }
  function home() { if (cur) intro = { from: camera.position.clone(), to: cur.home.clone(), t: 0 }; }

  function drawInfo() {
    const { built, level } = cur, i = built.info || {};
    hud.info.innerHTML = `<div class="lvl">Level ${cur.index} of ${cur.total} · ${esc(cur.name || LEVEL_NAMES[level.level] || level.level)}</div><h3>${esc(i.title || level.title || '')}</h3>
      ${(i.lines || []).map((t) => `<p>${esc(t)}</p>`).join('')}
      ${(i.lean || []).length ? `<div class="lean-row">${i.lean.map((n) => lean(n)).join('')}</div>` : ''}
      ${(i.sources || []).length ? `<div class="kick" style="margin-top:8px"><span>Sources</span></div><div class="src">${i.sources.map((s) => esc(s)).join('<br>')}</div>` : ''}`;
  }
  function drawReadouts() {
    const r = cur?.built.readouts || [];
    hud.readouts.innerHTML = r.length ? `<div class="kick"><span>Measured and calculated</span></div>` + r.map((x) => `<div class="mrow" title="${esc([x.tag, x.source].filter(Boolean).join(' · '))}"><span>${esc(x.label)}</span><b>${esc(typeof x.value === 'number' ? fmtNum(x.value) : x.value ?? '—')} <small>${esc(x.unit || '')}</small></b></div>`).join('') : '';
  }
  function drawControls() {
    const cs = cur.built.controls || [];
    hud.controls.innerHTML = cs.map((c) => `<div class="ctrl"><div class="row"><span>${esc(c.label)}</span><output data-o="${esc(c.id)}">${esc(fmtNum(+c.value))} ${esc(c.unit || '')}</output></div>
      <input type="range" data-c="${esc(c.id)}" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.value}"></div>`).join('');
    hud.controls.querySelectorAll('input[data-c]').forEach((inp) => inp.addEventListener('input', () => {
      const c = cs.find((x) => x.id === inp.dataset.c); const v = +inp.value;
      hud.controls.querySelector(`[data-o="${c.id}"]`).textContent = `${fmtNum(v)} ${c.unit || ''}`;
      try { c.onInput?.(v); } catch (e) { console.warn(e); }
      drawReadouts();
    }));
  }
  function drawGene() {
    const g = cur.built.gene; if (!g || !g.exons?.length) { hud.gene.innerHTML = ''; return; }
    const W = 600, H = 58, x0 = 10, x1 = W - 10, span = g.end - g.start || 1;
    const X = (p) => x0 + ((p - g.start) / span) * (x1 - x0);
    const fwd = (g.strand ?? 1) > 0;
    let arrows = ''; for (let i = 1; i < 12; i++) { const x = x0 + (i / 12) * (x1 - x0); arrows += fwd ? `<path d="M${x - 3},26 l4,4 l-4,4" stroke="#8e9684" fill="none"/>` : `<path d="M${x + 3},26 l-4,4 l4,4" stroke="#8e9684" fill="none"/>`; }
    hud.gene.innerHTML = `<div class="kick"><span>Gene ${esc(g.symbol)} · chr${esc(g.chrom)}:${(+g.start).toLocaleString('en-US')}–${(+g.end).toLocaleString('en-US')} (${fwd ? '+' : '−'} strand)</span><span>${g.exons.length} exons · ${esc(g.transcript || '')} · ${fmtNum(span / 1000)} kb</span></div>
      <svg viewBox="0 0 ${W} ${H}" class="chart"><line x1="${x0}" x2="${x1}" y1="30" y2="30" stroke="#8e9684"/>${arrows}
      ${g.exons.map(([a, b]) => `<rect x="${X(Math.min(a, b))}" y="21" width="${Math.max(1.2, X(Math.max(a, b)) - X(Math.min(a, b)))}" height="18" fill="#a9d48c"><title>exon ${(+a).toLocaleString('en-US')}–${(+b).toLocaleString('en-US')}</title></rect>`).join('')}
      <text x="${x0}" y="54">${(+g.start).toLocaleString('en-US')}</text><text x="${x1}" y="54" text-anchor="end">${(+g.end).toLocaleString('en-US')}</text></svg>`;
  }

  // plain scroll: one level per gesture; pinch (ctrl+wheel) or ctrl/cmd+scroll: zoom inside the level
  canvas.addEventListener('wheel', (e) => {
    if (!cur) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const k = Math.exp(e.deltaY * 0.0015), off = camera.position.clone().sub(controls.target);
      const len = Math.min(controls.maxDistance, Math.max(controls.minDistance, off.length() * k));
      camera.position.copy(controls.target).add(off.setLength(len)); intro = null; return;
    }
    if (performance.now() < cooldown) return;
    acc += e.deltaY;
    if (Math.abs(acc) > 90) { const dir = acc > 0 ? 'in' : 'out'; acc = 0; cooldown = performance.now() + 1100; onEdge?.(dir); }
  }, { passive: false });

  const clock = new THREE.Clock();
  (function loop() {
    requestAnimationFrame(loop);
    if (!cur || canvas.offsetParent === null) return;
    const dt = Math.min(0.05, clock.getDelta()), t = clock.elapsedTime;
    if (intro) {
      intro.t = Math.min(1, intro.t + dt / 0.9); const k = 1 - (1 - intro.t) ** 3;
      camera.position.lerpVectors(intro.from, intro.to, k); if (intro.t >= 1) intro = null;
    }
    try { cur.built.update?.(dt, t); } catch (e) { console.warn(e); }
    controls.update();
    composer.render();
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const l of cur.labels) {
      tmpA.copy(l.p).project(camera);
      const vis = tmpA.z < 1 && Math.abs(tmpA.x) < 1.1 && Math.abs(tmpA.y) < 1.1;
      l.el.style.display = vis ? '' : 'none';
      if (vis) l.el.style.transform = `translate(${((tmpA.x + 1) / 2) * w + 8}px, ${((1 - tmpA.y) / 2) * h - 9}px)`;
    }
    // true scale bar and field of view at the orbit target's depth
    const unit = cur.level.unit || 'nm', f = UNIT_M[unit] ?? 1e-9;
    tmpA.copy(controls.target).project(camera); const ax = tmpA.x, ay = tmpA.y;
    tmpB.set(1, 0, 0).applyQuaternion(camera.quaternion).add(controls.target).project(camera);
    const pxPerUnit = Math.hypot((tmpB.x - ax) * w / 2, (tmpB.y - ay) * h / 2);
    const fovUnits = 2 * camera.position.distanceTo(controls.target) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
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
    if (t - lastRO > 0.25) { lastRO = t; if (cur.built.readouts?.length) drawReadouts(); }
  })();

  return { open, openFile, close, resize, home, get current() { return cur; } };
}
