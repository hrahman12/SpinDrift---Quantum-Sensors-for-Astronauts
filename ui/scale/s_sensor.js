// Descent level "the sensor": wraps an exact-spec sensor model (ui/sensors/<id>.js, documented dimensions only) as
// a scale scene. Load as s_sensor.js?id=opm | ?id=nv&build=jgu | ?id=qd. One named view per drawn component (its
// id) plus `whole`. Housings are see-through so the sensing element shows; parts with no documented size are listed
// in the card, not drawn.
import * as THREE from 'three';

const q = new URL(import.meta.url).searchParams;
const ID = q.get('id') || 'opm', BUILD = q.get('build') || undefined;
const mod = await import(`../sensors/${ID}.js`);
const UNIT = mod.SENSOR.unit === 'nm' ? 'nm' : 'mm';
export const DATA = mod.SENSOR.DATA || [];
export const LEVEL = { id: `s_sensor_${ID}`, site: { opm: 'brain', nv: 'heart', qd: 'blood', cqd: 'skin' }[ID], level: 'sensor',
  title: mod.SENSOR.title, unit: UNIT, scaleBar: { length: 1, label: `1 ${UNIT}` } };

export function build(D) {
  const b = mod.build(D, { build: BUILD });
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe8f5, 0x10131a, 0.95));
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(2, 3, 2.5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 0.9); rim.position.set(-2.4, 1.8, -2.6); scene.add(rim);
  scene.add(b.root); b.root.updateMatrixWorld(true);
  for (const c of b.components) if (c.xray) c.object.traverse((m) => { if (m.isMesh) { m.material.transparent = true; m.material.opacity = 0.2; m.material.depthWrite = false; } });
  const dir = new THREE.Vector3(0.55, 0.3, 0.78).normalize().toArray();
  const centre = (o) => new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).toArray();
  const views = { whole: { target: centre(b.root), dir, note: 'the whole drawn model' }, default: { target: centre(b.root), dir } };
  for (const c of b.components) views[c.id] = { target: centre(c.object), dir, note: c.name };
  const dims = b.components.flatMap((c) => (c.dims || []).slice(0, 3).map((d) => ({ label: `${c.name}: ${d.label}`, value: d.value ?? 'not stated', unit: d.unit || '', tag: d.tag, source: d.source })));
  const und = (b.undocumented || []).map((u) => u.name);
  const box = new THREE.Box3().setFromObject(b.root), size = box.getSize(new THREE.Vector3()), r = Math.max(size.x, size.y, size.z) || 1;
  const home = new THREE.Vector3(...views.whole.target).add(new THREE.Vector3(...dir).multiplyScalar((r * 1.9) / (2 * Math.tan(THREE.MathUtils.degToRad(20)))));
  return {
    scene, views,
    camera: { position: home.toArray(), target: views.whole.target, fov: 40 },
    labels: (b.labels || []).map((l) => ({ position: l.position, text: l.text })),
    info: {
      title: `${mod.SENSOR.title}: the sensor, to scale`,
      lines: [`Drawn from documented dimensions only: ${b.components.map((c) => c.name).join(', ') || 'nothing'}.`,
        und.length ? `Not drawn, size not documented: ${und.join(', ')}.` : ''].filter(Boolean),
      sources: mod.SENSOR.sources || [], lean: [],
    },
    readouts: dims.slice(0, 10),
    controls: [{ id: 'explode', label: 'Pull the parts apart', min: 0, max: 1, step: 0.01, value: 0, unit: '', onInput(v) { b.explode?.(v); } }],
    setView() {}, setEnv() {},
    update() {},
    dispose() { b.dispose?.(); },
  };
}
