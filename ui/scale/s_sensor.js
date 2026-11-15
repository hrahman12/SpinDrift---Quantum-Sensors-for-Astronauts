// Descent level "the sensor": wraps an exact-spec sensor model (ui/sensors/<id>.js, documented dimensions only) as
// a scale scene. Load as s_sensor.js?id=opm | ?id=nv&build=jgu | ?id=qd. Housings are x-rayed so the sensing element
// shows; parts with no documented size are listed in the card, not drawn.
import * as THREE from 'three';

const q = new URL(import.meta.url).searchParams;
const ID = q.get('id') || 'opm', BUILD = q.get('build') || undefined;
const mod = await import(`../sensors/${ID}.js`);
const UNIT = mod.SENSOR.unit === 'nm' ? 'nm' : 'mm';
const FOCUS = { opm: 'housing', nv: 'diamond', qd: null }[ID];
export const DATA = mod.SENSOR.DATA || [];
export const LEVEL = { id: `s_sensor_${ID}`, site: { opm: 'brain', nv: 'heart', qd: 'blood', cqd: 'skin' }[ID], level: 'sensor',
  title: mod.SENSOR.title, unit: UNIT, scaleBar: { length: 1, label: `1 ${UNIT}` } };

export function build(D) {
  const b = mod.build(D, { build: BUILD });
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xe8eddc, 0x1a1d16, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.3); key.position.set(2, 3, 2.5); scene.add(key);
  scene.add(b.root);
  for (const c of b.components) if (c.xray) c.object.traverse((m) => { if (m.isMesh) { m.material.transparent = true; m.material.opacity = 0.22; m.material.depthWrite = false; } });
  const fc = FOCUS ? b.components.find((c) => c.id.includes(FOCUS)) : null;
  const box = new THREE.Box3().setFromObject(fc ? fc.object : b.root);
  const size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z) || 1, dist = (r * (ID === 'nv' ? 3.2 : 1.9)) / (2 * Math.tan(THREE.MathUtils.degToRad(20)));
  const pos = ctr.clone().add(new THREE.Vector3(0.6, 0.35, 0.72).normalize().multiplyScalar(dist));
  const dims = b.components.flatMap((c) => (c.dims || []).slice(0, 3).map((d) => ({ label: `${c.name}: ${d.label}`, value: d.value ?? 'not stated', unit: d.unit || '', tag: d.tag, source: d.source })));
  const und = (b.undocumented || []).map((u) => u.name);
  let spin = 0;
  return {
    scene,
    camera: { position: pos.toArray(), target: ctr.toArray(), fov: 40 },
    labels: (b.labels || []).map((l) => ({ position: l.position, text: l.text })),
    info: {
      title: `${mod.SENSOR.title}: the sensor, to scale`,
      lines: [`Drawn from documented dimensions only: ${b.components.map((c) => c.name).join(', ') || 'nothing'}.`,
        und.length ? `Not drawn, size not documented: ${und.join(', ')}.` : ''].filter(Boolean),
      sources: mod.SENSOR.sources || [], lean: [],
    },
    readouts: dims.slice(0, 10),
    controls: [{ id: 'explode', label: 'Exploded view', min: 0, max: 1, step: 0.01, value: 0, unit: '', onInput(v) { b.explode?.(v); } }],
    update(dt) { spin += dt * 0.12; b.root.rotation.y = spin; },
    dispose() { b.dispose?.(); },
  };
}
