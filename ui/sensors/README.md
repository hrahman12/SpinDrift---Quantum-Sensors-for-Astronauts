# ui/sensors: documented 3D sensor models

One module per sensor tab. Each draws the **exact** sensor to scale, but only the parts whose size and position
are published (rule: "draws only parts whose size is in the datasheet, to scale in millimetres with
labels ... Undocumented parts are not drawn"). Everything else is returned in `undocumented` with the reason.

```
scripts/build_sensor_parts.py  ->  data/sensor_parts/{opm,nv,qd,cqd}.json  ->  ui/sensors/{opm,nv,qd,cqd}.js
```

* Every number in the JSON is a value object (`value, unit, source, tag, status, as_of, note`). The source names
  the page, figure or table. Derived numbers are tagged `calculated`, with the formula in the note.
* The build fetches each source from its official location and records its SHA256 in `meta.sha256`. It re-checks
  51 quoted phrases in the fetched text (`checks`, with PDF page numbers). Values read off QuSpin's drawings are
  pinned to the SHA256 of the drawing files they were read from. A missing quote or a changed drawing file
  downgrades the value to `TO_CONFIRM`.
* The modules contain no dimensions of their own. Every size and position comes from the JSON. Explode distances,
  opacities and segment counts are display settings only.
* Colours: neutral `#e1e5d6 / #8e9684 / #5c6552`. Optical parts use the device colour from `data/palette.json`:
  OPM 795 nm and NV 695 nm both render `#ff0000`. The palette has no green, so the NV excitation is not coloured.
  Atoms use CPK colours (C `#909090`, N `#3050f8`, O `#ff0d0d`, H `#ffffff`, S `#ffff30`).
* `parts.js` holds the shared helpers: value-object access, materials, atom instancing, `explode` and `dispose`.

Contract (all four modules): `SENSOR = { id, title, unit, DATA, sources }` (`builds` on nv) and
`build(D, opts) -> { root, components, undocumented, explode(t), labels, dispose() }`. Label positions are in
`root` coordinates and follow their component when exploded.

Rebuild: `python scripts/build_sensor_parts.py` uses the cache in `SPINDRIFT_CACHE/sensor-parts`;
`--refresh` downloads everything again.

---

## OPM: QuSpin QZFM Gen-3 (mm)

Frame: the origin is the housing centre. +y is up, with the skin face at y = -H/2 and the cable at the top. +z points
out of the front (label) face. +x points right when you look at the front face. QuSpin's drawing axis Z+ points
into the skin.

| Component | Size | Position | Source |
|---|---|---|---|
| Housing (x-ray) | 16.6 × **26.4** × 12.4 mm; height `TO_CONFIRM` | centred | QuSpin Gen-3.0 dimensioned drawing (updated 6 Dec 2022, quspin.com/qzfm-dimensions). QuSpin's Gen-3.0 3D mock-up (STL) measures 16.60 × 26.37 × 12.40 mm (calculated; mesh not copied) |
| Vapour cell (795 nm colour) | 3 × 3 × 3 mm, `TO_CONFIRM` | centre 6.25 mm from the left side, 6.20 mm above the skin face (`TO_CONFIRM`), 5.15 mm behind the front face, i.e. (-2.05, -7.00, +1.05) | Centre: Gen-3.0 drawing ("CENTER OF CELL"); the Neuro-1.0 drawing repeats the same offsets. Size: Zhao et al., arXiv 2408.02941 p. 3, who characterise 3rd-generation QZFMs but cite the original-QZFM paper for it |
| Label plate | 13.5 × 6.5 × 0.2 mm | centred in x, 3.34 mm below the top, on the front face | 3D mock-up (calculated) |
| Flex ribbon cable | 6.5 × 0.20 mm, 2 ft (609.6 mm); drawn cut at 78.33 mm | leaves the top face at x = -1.00, 0.45 mm behind the front face | Width and thickness: drawing. Length: drawing and product page. Cut length, offset and inset: mock-up |

**Conflict, to confirm.** The current product page lists 12.4 × 16.6 × **24.4** mm and "6.5 mm from vapor-cell
center to housing". These numbers equal QuSpin's **Gen-2.0** drawing (24.40 and 6.50), and QuSpin's 2021 Gen-3
announcement says Gen-3 has the Gen-2 dimensions. QuSpin's Gen-3.0-specific drawing and 3D file instead give
**26.4 mm** and **6.20 mm**. The model draws the Gen-3.0 drawing. `data/specs.json` (opm.sensor_head, opm.standoff)
and `ui/twin.js` (24.4 mm box, cell 6.5 mm from the skin face) use the product-page / Gen-2.0 numbers.

Housing edges are rounded in the mock-up, but the radii are not dimensioned, so the box has square edges.

Undocumented, not drawn: the laser (795 nm), photodetector, internal optics (prisms; the triaxial beam splitter),
three-axis field-nulling and modulation coils, cell heater and head electronics. The round cable has a length
(6.5 m) but no stated diameter. The electronics unit (3.1 × 11.0 × 16.5 cm) sits at the far end of the cable and
its placement is not documented.

## NV: Omar et al., arXiv 2601.18843 (mm), `opts.build` = `jgu` | `zaquant` | `qant`

Frame: the origin is the centre of the diamond's documented envelope. +z points towards the subject; +y is up.

| Build | Component | Size | Source |
|---|---|---|---|
| JGU | Sensing diamond, truncated square pyramid (695 nm colour) | 0.50 mm square base (back, on the anvil), 0.15 mm square top (towards the subject), 0.18 mm tall | arXiv 2601.18843 p. 4 and Table 2; top face from its ref. [22] = arXiv 2301.06583 (Opt. Lett. 48, 2512) p. 2 |
| JGU | Head front face, flat disc (x-ray) | Ø12 mm, drawn in the plane of the microwave flex-PCB, 0.10 mm behind the diamond's top face | arXiv 2601.18843 p. 14 ("sensor head diameter: 12 mm"). The diamond sticks out ≈100 µm and the PCB is ≈150 µm thick: ref. [20] = arXiv 2512.05776 p. 9 |
| ZAQuant | Diamond, translucent w × l × h envelope | 0.5 × 0.5 × 0.5 mm. Described as "pyramidal"; whether the apex is truncated is not stated | arXiv 2601.18843 Table 2, p. 14 |
| Q.ANT | Diamond, translucent w × l × h envelope | 1 × 1 × 0.5 mm. A truncated pyramid whose top face is not stated | arXiv 2601.18843 p. 14, Table 2 |

Undocumented, not drawn:

* JGU: the diamond anvil (only one 2.5 mm length and a 45° opening angle are given), the polycrystalline diamond
  plate, the housing length, the flex-PCB outline, the modulation coil, the lens, dichroic mirror, PBS, beam
  sampler, the S13228-01 photodiodes (positions), the fibre coupler, fibre holder and optics rod, the fibre and the
  300 µm pump beam path.
* ZAQuant: the CPC, glass rod, dichroic cube, 695 nm filter, photodetectors, ≈1 mT magnet, loop antenna and housing.
  The two-head gradiometer baseline (78 mm) is in `info`.
* Q.ANT: the head (only its 1 dm³ volume is given), the Halbach ring, OBIS laser, photodiode board, optics and FPGA.

## QD: renin nanosensor probe, Long et al., Anal. Chem. 84, 8846 (2012) (nm)

Frame: the origin is the streptavidin tetramer centre, which is also the 1STP crystal origin (the BIOMT operators
are two-fold rotations through it). The JSON stores ångström as deposited; the module divides by 10. Atoms are
drawn as van der Waals spheres: Bondi radii, with H from Rowland & Taylor, as compiled by Mantina et al., J. Phys.
Chem. A 113, 5806 (2009), Table 12, fetched from PMC.

| Component | What is drawn | Source |
|---|---|---|
| Streptavidin tetramer | chain A residues 13–133 (901 heavy atoms) × 4 BIOMT operators; extent 6.31 × 6.31 × 4.96 nm | RCSB PDB 1STP, 2.6 Å, CC0 |
| Biotin × 4 | 16 atoms each, in the binding pockets as deposited | 1STP HETATM BTN |
| Cy5 | 85 atoms (C33H40N2O8S2, with H), 1.97 nm largest extent; placed on +x at **4.67 nm, a display distance** (bounding spheres touching) | PubChem CID 17758493 computed 3D conformer |

Undocumented, not drawn:

* The quantum dot: the abstract gives no product, emission or size, and the full text and SI are paywalled.
* The peptide substrate: no sequence or length is given, so Cy5's real position is unknown.
* The linkers and the number of substrates per dot.
* Streptavidin and biotin hydrogens (the X-ray structure has none) and the unresolved residues (SEQRES 159).

## CQD: carbon-dot microneedle patch, Tabatabaee et al., ACS Nano 18, 28012 (2024) (mm)

**Nothing is drawn.** The needle count, shape, height, base width, pitch, patch size and backing layer are in the
paywalled main text: pubs.acs.org returned 403 to the build, and OpenAlex and FreiDok list no open copy. The open
Supporting Information (figshare 27153931, CC BY-NC 4.0) states none of them; its Fig. S3 shows microscope images
with 500 µm scale bars, and sizes are not measured off images.

What the SI does document is kept in `cqd.json -> documented`:

* GelMA needle material (Table S2, Fig. S3).
* Reader parts (Table S3): AS7341 sensor, ATmega328, Bluetooth, 390/470 nm SMD LEDs, two Li-ion batteries, quartz
  glass and ABS. The AS7341 package (3.1 × 2.0 × 1.0 mm, ams-OSRAM) is known, but its position in the reader is
  not.
* Reader channels 440/470/510 nm (Fig. S10).
* CQD DLS 1–12 nm (Fig. S1).

The module returns an empty `root` and the full `undocumented` list.
