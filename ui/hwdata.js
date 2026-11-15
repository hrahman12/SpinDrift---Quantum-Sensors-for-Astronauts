// The real signal chain of each sensor, part by part, as the papers describe it. Positions on the board are a
// drawing choice (a grid of 6 columns × 3 rows per module); every label, wavelength and frequency is from the
// source named on the part. A part a source does not describe is not drawn; a value a source does not give says so.
export const SRC = {
  zhao: 'Zhao, Mammei & Fujimoto, arXiv 2408.02941 (2024)',
  omar: 'Omar et al., arXiv 2601.18843 (2026)',
  long: 'Long et al., Anal. Chem. 84, 8846 (2012), doi:10.1021/ac302284s (PubMed abstract)',
  tabaSI: 'Tabatabaee et al., ACS Nano 18, 28012 (2024), Supporting Information Tables S2–S3, Figs S1, S10',
  taba: 'Tabatabaee et al., ACS Nano 18, 28012 (2024), doi:10.1021/acsnano.4c06191 (PubMed abstract)',
  quspin: 'QuSpin QZFM Gen-3 product page and dimensioned drawing',
  barry: 'Barry et al., Rev. Mod. Phys. 92, 015004 (2020)',
  oscar: 'OSCAR-QUBE NV magnetometer on the ISS (data/specs.json)',
  ams: 'ams OSRAM AS7341 datasheet (package 3.1 × 2.0 × 1.0 mm)',
};

// kinds of connection: opt = light in free space or fibre (nm), mw = microwave line (Hz), coil = a field the head
// applies (Hz, 0 = static), cu = copper (power or signal), rf = radio link, fluid = sample handling, hop = FRET
export const MODULES = {
  opm: {
    title: 'Brain · OPM', sub: 'QuSpin QZFM Gen-3', check: 'opm_brain', color: 'opm',
    parts: [
      { id: 'laser', c: 0, r: 1, label: '795 nm laser', sub: 'circular · Rb-87 D1', src: 'zhao' },
      { id: 'prism1', c: 1, r: 1, label: 'Prism', sub: 'internal optics', src: 'zhao' },
      { id: 'cell', c: 2, r: 1, label: 'Rb-87 cell', sub: '3×3×3 mm · ≈150 °C', src: 'zhao', glow: true },
      { id: 'prism2', c: 3, r: 1, label: 'Second prism', sub: 'to the detector', src: 'zhao' },
      { id: 'pd', c: 4, r: 1, label: 'Photodetector', sub: 'transmitted light', src: 'zhao' },
      { id: 'lockin', c: 5, r: 1, label: 'Lock-in', sub: 'on board · 923 Hz', src: 'zhao' },
      { id: 'mod', c: 2, r: 0, label: 'Modulation coils', sub: '923 Hz field', src: 'zhao' },
      { id: 'comp', c: 2, r: 2, label: 'Nulling coils', sub: '3 sets · ±50 nT each', src: 'zhao' },
      { id: 'power', c: 0, r: 2, label: 'Power', sub: '0.7 W head · 5 W total', src: 'quspin' },
      { id: 'out', c: 5, r: 2, label: 'Output', sub: 'analog + USB · ~5 ms', src: 'quspin', port: true },
    ],
    links: [
      { a: 'laser', b: 'prism1', kind: 'opt', nm: 795 }, { a: 'prism1', b: 'cell', kind: 'opt', nm: 795 },
      { a: 'cell', b: 'prism2', kind: 'opt', nm: 795, note: 'light the atoms let through' }, { a: 'prism2', b: 'pd', kind: 'opt', nm: 795 },
      { a: 'pd', b: 'lockin', kind: 'cu' }, { a: 'mod', b: 'cell', kind: 'coil', hz: 923 }, { a: 'comp', b: 'cell', kind: 'coil', hz: 0 },
      { a: 'lockin', b: 'out', kind: 'cu' }, { a: 'power', b: 'laser', kind: 'cu', note: 'power' },
    ],
  },
  nv_jgu: {
    title: 'Heart · NV (JGU)', sub: 'zero-bias endoscope head · 13 pT/√Hz', check: 'nv_heart_jgu', color: 'nv',
    parts: [
      { id: 'laser', c: 0, r: 0, label: 'Green laser', sub: 'Verdi G5 head (rack)', src: 'omar' },
      { id: 'fibre', c: 1, r: 0, label: 'High-power fibre', sub: 'to the head', src: 'omar' },
      { id: 'coupler', c: 2, r: 0, label: 'Fibre coupler', sub: 'output holder', src: 'omar' },
      { id: 'pbs', c: 3, r: 0, label: 'PBS', sub: 'polarizing splitter', src: 'omar' },
      { id: 'sampler', c: 4, r: 0, label: 'Beam sampler', sub: 'laser reference', src: 'omar' },
      { id: 'dichroic', c: 4, r: 1, label: 'Dichroic mirror', sub: 'green in, red out', src: 'omar' },
      { id: 'diamond', c: 5, r: 1, label: 'Diamond', sub: '0.5×0.5×0.18 mm + lens', src: 'omar', glow: true },
      { id: 'mod', c: 3, r: 1, label: 'Field modulation', sub: '6.12 kHz · µT · [100]', src: 'omar' },
      { id: 'mw', c: 0, r: 2, label: 'Microwave', sub: '2.87 GHz ⊗ 2.16 MHz', src: 'omar' },
      { id: 'ant', c: 5, r: 2, label: 'PCB antenna', sub: 'custom board', src: 'omar' },
      { id: 'pd', c: 2, r: 1, label: 'Photodiodes', sub: 'differential · Hamamatsu', src: 'omar' },
      { id: 'lockin', c: 1, r: 1, label: 'Lock-in', sub: 'Zurich Instruments', src: 'omar' },
      { id: 'out', c: 0, r: 1, label: 'PC', sub: 'control + analysis', src: 'omar', port: true },
    ],
    links: [
      { a: 'laser', b: 'fibre', kind: 'opt', nm: null, note: 'green; the paper names the laser, not its line' },
      { a: 'fibre', b: 'coupler', kind: 'opt', nm: null }, { a: 'coupler', b: 'pbs', kind: 'opt', nm: null }, { a: 'pbs', b: 'sampler', kind: 'opt', nm: null },
      { a: 'sampler', b: 'dichroic', kind: 'opt', nm: null }, { a: 'dichroic', b: 'diamond', kind: 'opt', nm: null },
      { a: 'diamond', b: 'pd', kind: 'opt', nm: 637, note: 'red glow; 637 nm is the NV zero-phonon line (Barry et al.)' },
      { a: 'pd', b: 'lockin', kind: 'cu' }, { a: 'lockin', b: 'out', kind: 'cu' },
      { a: 'mw', b: 'ant', kind: 'mw', hz: 2.87e9, note: 'FM 140 kHz, ±100 kHz, locked on resonance' }, { a: 'ant', b: 'diamond', kind: 'mw', hz: 2.87e9 },
      { a: 'mod', b: 'diamond', kind: 'coil', hz: 6120 },
    ],
  },
  nv_zaquant: {
    title: 'Heart · NV (ZAQuant)', sub: '1 mT bias · 7 pT/√Hz', check: 'nv_heart_zaquant', color: 'nv',
    parts: [
      { id: 'laser', c: 0, r: 1, label: 'Green laser', sub: 'excitation path', src: 'omar' },
      { id: 'cube', c: 1, r: 1, label: 'Dichroic cube', sub: 'green in, red out', src: 'omar' },
      { id: 'rod', c: 2, r: 1, label: 'Glass rod', sub: 'guides the light', src: 'omar' },
      { id: 'diamond', c: 3, r: 1, label: 'Diamond', sub: '0.5×0.5×0.5 mm on a CPC', src: 'omar', glow: true },
      { id: 'magnet', c: 3, r: 0, label: 'Permanent magnet', sub: '≈1 mT along one NV axis', src: 'omar' },
      { id: 'mw', c: 5, r: 0, label: 'Microwave', sub: 'double resonance · 3 kHz AM', src: 'omar' },
      { id: 'amp', c: 4, r: 0, label: 'Amplifier', sub: 'microwave', src: 'omar' },
      { id: 'loop', c: 4, r: 1, label: 'Loop antenna', sub: 'at the diamond', src: 'omar' },
      { id: 'filter', c: 1, r: 2, label: '695 nm long-pass', sub: 'filter', src: 'omar' },
      { id: 'pd', c: 2, r: 2, label: 'Balanced detection', sub: 'cancels laser noise', src: 'omar' },
      { id: 'lockin', c: 3, r: 2, label: 'Lock-in', sub: 'Zurich Instruments HF2LI', src: 'omar' },
      { id: 'out', c: 5, r: 2, label: 'Output', sub: 'gradiometer: 2 heads, 78 mm', src: 'omar', port: true },
    ],
    links: [
      { a: 'laser', b: 'cube', kind: 'opt', nm: null, note: 'green; the line is not stated' }, { a: 'cube', b: 'rod', kind: 'opt', nm: null }, { a: 'rod', b: 'diamond', kind: 'opt', nm: null },
      { a: 'diamond', b: 'filter', kind: 'opt', nm: 695, note: 'red glow above 695 nm passes the filter' }, { a: 'filter', b: 'pd', kind: 'opt', nm: 695 },
      { a: 'pd', b: 'lockin', kind: 'cu' }, { a: 'lockin', b: 'out', kind: 'cu' },
      { a: 'mw', b: 'amp', kind: 'mw', hz: 2.87e9, note: 'the lines sit 28 MHz either side of 2.87 GHz at 1 mT (28.025 MHz/mT)' },
      { a: 'amp', b: 'loop', kind: 'mw', hz: 2.87e9 }, { a: 'loop', b: 'diamond', kind: 'mw', hz: 2.87e9 }, { a: 'magnet', b: 'diamond', kind: 'coil', hz: 0 },
    ],
  },
  nv_qant: {
    title: 'Heart · NV (Q.ANT)', sub: '1 mT bias · unshielded · 26 pT/√Hz', check: 'nv_heart_qant', color: 'nv',
    parts: [
      { id: 'laser', c: 0, r: 1, label: 'OBIS laser', sub: 'fibre-coupled · 100 mW', src: 'omar' },
      { id: 'optics', c: 1, r: 1, label: 'Head optics', sub: '≈40 % collection (sim.)', src: 'omar' },
      { id: 'diamond', c: 2, r: 1, label: 'Diamond', sub: '1×1×0.5 mm · 1.7 ppm NV⁻', src: 'omar', glow: true },
      { id: 'halbach', c: 2, r: 0, label: 'Halbach ring', sub: '≈1 mT bias', src: 'omar' },
      { id: 'pd', c: 3, r: 1, label: 'Balanced photodiodes', sub: '+ differential amp', src: 'omar' },
      { id: 'fpga', c: 4, r: 1, label: 'FPGA', sub: 'control + microwave', src: 'omar' },
      { id: 'out', c: 5, r: 1, label: 'USB-C', sub: 'to a PC', src: 'omar', port: true },
      { id: 'head', c: 0, r: 2, label: 'Head volume', sub: '1 dm³', src: 'omar' },
    ],
    links: [
      { a: 'laser', b: 'optics', kind: 'opt', nm: null, note: 'green; the line is not stated' }, { a: 'optics', b: 'diamond', kind: 'opt', nm: null },
      { a: 'diamond', b: 'pd', kind: 'opt', nm: 637, note: 'red glow; 637 nm zero-phonon line (Barry et al.)' },
      { a: 'pd', b: 'fpga', kind: 'cu' }, { a: 'fpga', b: 'out', kind: 'cu' }, { a: 'fpga', b: 'diamond', kind: 'mw', hz: 2.87e9, note: 'generated on the FPGA' },
      { a: 'halbach', b: 'diamond', kind: 'coil', hz: 0 },
    ],
  },
  qd: {
    title: 'Blood · quantum dot', sub: 'single-QD renin nanosensor · lab TIRF', check: 'qd_blood', color: 'qd',
    parts: [
      { id: 'sample', c: 0, r: 1, label: 'Plasma sample', sub: 'renin cuts the link', src: 'long' },
      { id: 'probe', c: 2, r: 1, label: 'QD nanosensor', sub: 'streptavidin QD + Cy5 peptides', src: 'long', glow: true },
      { id: 'tirf', c: 2, r: 0, label: 'TIRF excitation', sub: 'total internal reflection', src: 'long' },
      { id: 'hop', c: 3, r: 2, label: 'FRET', sub: 'QD donor → Cy5 acceptor', src: 'long' },
      { id: 'counts', c: 4, r: 1, label: 'Cy5 counting', sub: 'single molecules', src: 'long' },
      { id: 'out', c: 5, r: 1, label: 'Result', sub: 'renin activity · LOD 25 pM', src: 'long', port: true },
      { id: 'gap', c: 0, r: 2, label: 'Not in the abstract', sub: 'QD model, colours, camera', src: 'long', missing: true },
    ],
    links: [
      { a: 'sample', b: 'probe', kind: 'fluid' }, { a: 'tirf', b: 'probe', kind: 'opt', nm: null, note: 'excitation; wavelength not in the abstract' },
      { a: 'probe', b: 'hop', kind: 'hop' }, { a: 'probe', b: 'counts', kind: 'opt', nm: null, note: 'Cy5 emission; wavelength not in the abstract' },
      { a: 'counts', b: 'out', kind: 'cu' },
    ],
  },
  cqd: {
    title: 'Skin · carbon dots', sub: 'GelMA microneedle tattoo + wearable reader', check: 'cqd_skin', color: 'cqd',
    parts: [
      { id: 'leds', c: 0, r: 0, label: 'SMD LEDs', sub: '390 nm · 470 nm', src: 'tabaSI' },
      { id: 'window', c: 1, r: 0, label: 'Quartz window', sub: 'ABS housing', src: 'tabaSI' },
      { id: 'patch', c: 2, r: 1, label: 'Microneedle tattoo', sub: 'GelMA + carbon dots', src: 'tabaSI', glow: true },
      { id: 'isf', c: 2, r: 2, label: 'Skin fluid', sub: 'bilirubin quenches the glow', src: 'taba' },
      { id: 'sensor', c: 3, r: 0, label: 'AS7341', sub: '440 · 470 · 510 nm channels', src: 'tabaSI' },
      { id: 'mcu', c: 4, r: 1, label: 'ATmega328', sub: 'AVR microcontroller', src: 'tabaSI' },
      { id: 'bt', c: 5, r: 1, label: 'Bluetooth', sub: 'module', src: 'tabaSI' },
      { id: 'battery', c: 4, r: 2, label: 'Li-ion polymer ×2', sub: '+ charging module', src: 'tabaSI' },
      { id: 'out', c: 5, r: 2, label: 'IoT link', sub: 'real-time readings', src: 'taba', port: true },
    ],
    links: [
      { a: 'leds', b: 'window', kind: 'opt', nm: 390 }, { a: 'window', b: 'patch', kind: 'opt', nm: 470, note: '470 nm is also the blue used for phototherapy' },
      { a: 'patch', b: 'sensor', kind: 'opt', nm: 440, note: 'carbon-dot glow read at 440, 470 and 510 nm' },
      { a: 'isf', b: 'patch', kind: 'fluid' }, { a: 'sensor', b: 'mcu', kind: 'cu', note: 'I²C' }, { a: 'mcu', b: 'bt', kind: 'cu' },
      { a: 'battery', b: 'mcu', kind: 'cu', note: 'power' }, { a: 'bt', b: 'out', kind: 'rf' },
    ],
  },
};
export const nvModule = (build) => MODULES[`nv_${build}`] || MODULES.nv_jgu;
