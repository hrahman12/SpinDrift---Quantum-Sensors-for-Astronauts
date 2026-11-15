// Carbon-dot microneedle tattoo patch and wearable reader of Tabatabaee et al., ACS Nano 18, 28012 (2024).
// Rule: draw only parts with a documented size. The patch (needle count, height, base width, pitch, patch size,
// backing layer) and the reader housing have no dimension in an accessible source: the main text is paywalled and
// the open Supporting Information (figshare, CC BY-NC 4.0) states none. The one part with a documented size is the
// reader's AS7341 spectral sensor (Table S3), whose package is 3.1 × 2.0 × 1.0 mm (ams-OSRAM). It is drawn alone,
// at a display position, because where it sits in the reader is not documented. Everything else is listed in
// `undocumented`. Data: data/sensor_parts/cqd.json, built by scripts/build_sensor_parts.py.
import * as THREE from 'three';
import { NEUTRAL, num, fmt, toDims, createKit, emptyBuild, explodeRig } from './parts.js';

export const SENSOR = {
  id: 'cqd',
  title: 'Carbon-dot microneedle patch (Tabatabaee et al., ACS Nano 2024)',
  unit: 'mm',
  DATA: ['sensor_parts/cqd', 'specs', 'palette'],
  sources: [
    'Tabatabaee, Naghdi, Peyravian, Kiani & Golmohammadi, ACS Nano 18, 28012 (2024), doi:10.1021/acsnano.4c06191',
    'Supporting Information nn4c06191_si_001.pdf, doi:10.1021/acsnano.4c06191.s001 (figshare 27153931, CC BY-NC 4.0): Tables S2-S3, Figs. S1, S3, S10',
    'ams-OSRAM AS7341 product page (package 3.1 × 2.0 × 1.0 mm)',
  ],
};

export function build(D, opts = {}) {   // eslint-disable-line no-unused-vars
  const P = D?.['sensor_parts/cqd'];
  if (!P) return emptyBuild('Carbon-dot patch', 'data/sensor_parts/cqd.json not loaded');
  const kit = createKit();
  const root = new THREE.Group();
  root.name = 'Carbon-dot patch reader: AS7341 package';
  const components = [];
  const labels = [];
  const doc = P.documented || {};
  const undocumented = (P.undocumented || [])
    .filter(({ name }) => !/^AS7341\b/.test(name))   // drawn below; its missing position is stated on the part
    .map(({ name, reason }) => ({ name, reason }));

  // AS7341 package (ams-OSRAM datasheet): length along x, height along y, width along z, centred at the origin.
  // The origin is a display position only: the sensor's place inside the reader is not documented.
  const pkg = doc.as7341_package || {};
  const L = num(pkg.length), W = num(pkg.width), H = num(pkg.height);
  if (L && W && H) {
    const name = 'AS7341 spectral sensor package (reader)';
    const mesh = new THREE.Mesh(kit.geo(new THREE.BoxGeometry(L, H, W)), kit.std(NEUTRAL.dark, { roughness: 0.4 }));
    mesh.name = name;
    mesh.userData.componentId = 'as7341';
    root.add(mesh);
    components.push({
      id: 'as7341',
      name,
      object: mesh,
      dims: toDims([{ label: 'length', vo: pkg.length }, { label: 'width', vo: pkg.width }, { label: 'height', vo: pkg.height }]),
      note: 'Package size from the ams-OSRAM datasheet; the part is named in Table S3 of the Supporting Information. '
        + 'Where it sits inside the reader is not documented, so it is drawn alone at the origin (a display position, '
        + 'not its place in the reader).',
      color: NEUTRAL.dark,
      xray: false,
    });
    labels.push({ component: 'as7341', position: [L / 2, H / 2, W / 2], text: `AS7341 package ${fmt(L)} × ${fmt(W)} × ${fmt(H)} mm (ams-OSRAM)` });
    labels.push({ component: 'as7341', position: [-L / 2, -H / 2, 0], text: 'Display position: its place in the reader is not documented' });
  } else {
    undocumented.push({ name: 'AS7341 multispectral sensor', reason: 'its package numbers are missing from data/sensor_parts/cqd.json' });
  }

  const known = [
    doc.needle_material?.value && `needle material: ${doc.needle_material.value}`,
    doc.reader_parts?.value && `reader parts: ${doc.reader_parts.value}`,
    doc.reader_channels?.value && `reader channels ${doc.reader_channels.value} nm`,
  ].filter(Boolean).join('; ');
  if (known) undocumented.push({ name: 'Documented without geometry (for reference)', reason: known });

  const explode = explodeRig([], labels);
  return {
    root,
    components,
    undocumented,
    explode,
    labels,
    dispose() { kit.dispose(); root.clear(); },
  };
}
