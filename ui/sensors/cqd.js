// Carbon-dot microneedle tattoo patch and wearable reader of Tabatabaee et al., ACS Nano 18, 28012 (2024).
// Rule: draw only parts with a documented size. No dimension of the patch (needle count, height, base width, pitch,
// patch size, backing layer) or of the reader is available from an accessible source: the main text is paywalled
// and the open Supporting Information (figshare, CC BY-NC 4.0) states none. So nothing is drawn; everything is
// listed in `undocumented`, with what is documented (materials, reader parts, channels) in the notes.
// Data: data/sensor_parts/cqd.json, built by scripts/build_sensor_parts.py.
import * as THREE from 'three';
import { emptyBuild } from './parts.js';

export const SENSOR = {
  id: 'cqd',
  title: 'Carbon-dot microneedle patch (Tabatabaee et al., ACS Nano 2024)',
  unit: 'mm',
  DATA: ['sensor_parts/cqd', 'specs', 'palette'],
  sources: [
    'Tabatabaee, Naghdi, Peyravian, Kiani & Golmohammadi, An Invisible Dermal Nanotattoo-Based Smart Wearable Sensor for eDiagnostics of Jaundice, ACS Nano 18, 28012 (2024), doi:10.1021/acsnano.4c06191',
    'Supporting Information nn4c06191_si_001.pdf, doi:10.1021/acsnano.4c06191.s001 (figshare 27153931, CC BY-NC 4.0): Tables S2-S3, Figs. S1, S3, S10',
    'ams-OSRAM AS7341 product page (package 3.1 × 2.0 × 1.0 mm)',
  ],
};

export function build(D, opts = {}) {   // eslint-disable-line no-unused-vars
  const P = D?.['sensor_parts/cqd'];
  if (!P) return emptyBuild('Carbon-dot patch', 'data/sensor_parts/cqd.json not loaded');
  const root = new THREE.Group();
  root.name = 'Carbon-dot microneedle patch (no documented geometry)';
  const doc = P.documented || {};
  const known = [
    doc.needle_material?.value && `needle material: ${doc.needle_material.value}`,
    doc.reader_parts?.value && `reader parts: ${doc.reader_parts.value}`,
    doc.reader_channels?.value && `reader channels ${doc.reader_channels.value} nm`,
  ].filter(Boolean).join('; ');
  const undocumented = (P.undocumented || []).map(({ name, reason }) => ({ name, reason }));
  if (known) undocumented.push({ name: 'Documented without geometry (for reference)', reason: known });
  return {
    root,
    components: [],
    undocumented,
    explode() {},
    labels: [],
    dispose() { root.clear(); },
  };
}
