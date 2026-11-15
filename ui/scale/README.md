# ui/scale: cell and molecule scenes

Scenes for the powers-of-ten zoom in `ui/zoom.js`: below each sensor's body site the page goes to a **cell**, then a
**molecule + gene**, then the **quantum** level. This file covers the cell and molecule modules (`cell_*.js`,
`mol_*.js`); the quantum modules (`q_*.js`, `q_lib.js`) are described in [QUANTUM.md](QUANTUM.md).

| site | sensor | cell | molecule + gene |
|---|---|---|---|
| brain | QuSpin OPM | `cell_neuron.js` | none (no clearly relevant structure) |
| heart | NV diamond, OPM | `cell_cardiomyocyte.js` | `mol_nav15.js` (Nav1.5, SCN5A) |
| blood | quantum-dot renin sensor | `cell_rbc.js` | `mol_renin.js` (renin, REN) |
| skin | carbon-dot microneedle patch | `cell_skin.js` | `mol_bilirubin.js` (bilirubin, UGT1A1) |

## Rules every scene follows

- Every size, coordinate and rate comes from a cited source or is calculated from cited inputs (and is labelled
  "calculated"). A value with no source is not drawn at a size; the scene's info panel says so.
- Display-only choices are named as such in the info panel: tube and sphere thickness of molecular traces, the
  1-pixel lines and constant-size markers, the block footprint of the skin, cell positions in the blood scene, and all
  animation timing (no sourced conduction velocity is used anywhere).
- Colours: theme colours (ink `#e1e5d6`, muted `#8e9684`, accent `#a9d48c`, and the UI greys `#b9c0ab` and `#5c6552`),
  CPK colours for atoms, and device colours from `data/palette.json` where a device is shown (carbon-dot emission
  439 nm in the skin scene). No image textures; round markers are drawn in a small shader.
- Units: cell scenes in micrometres (`'µm'`, U+00B5), molecule scenes in angstrom (`'Å'`, U+00C5), as `ui/zoom.js`'s
  scale bar expects.

## Module contract

```js
import * as THREE from 'three';
export const DATA = ['bio/cells'];          // /data paths (no .json) the host loads into D before build()
export const LEVEL = { id, site, level, title, unit, scaleBar: { length, label } };
export function build(D) {
  return { scene, camera: { position, target, fov: 40 }, labels: [{ position, text }],
           info: { title, lines, sources, lean: [] }, readouts: [{ label, value, unit, tag, source }],
           gene /* molecule scenes */, controls /* mol_bilirubin only */, update(dt, t), dispose() };
}
```

Labels are in scene coordinates (they do not move), so no labelled object is animated. Each module is self-contained
(no shared helper file) and degrades to an explanatory empty scene if its data file is missing.

## Data: `scripts/build_bio.py` -> `data/bio/`

Run `python scripts/build_bio.py` (about two minutes; network). It uses only official endpoints, records the SHA256 of
every download in each file's `meta.sha256`, builds citations from the PubMed records it fetches (E-utilities), and checks
every literature value against the downloaded source text: a value is `VERIFIED` only if its quote is found there
(the quote is kept in the value object's `note`), otherwise `TO_CONFIRM`. PMC article pages sometimes answer automated
requests with a browser check; the script does not retry or bypass it and lists such pages in `meta.browser_check_not_read`
(the red-cell coefficients are verified through Europe PMC open-access texts independently of those pages).

| file | content | sources |
|---|---|---|
| `genes.json` | REN, SCN5A, UGT1A1: Ensembl gene ID, chromosome, start, end, strand, canonical (MANE Select) transcript, exons in transcript order and sorted genomic `exon_coords`, translation, UTRs, UniProt function | Ensembl REST API (release 116, GRCh38.p14); UniProt P00797, Q14524, P22309 (CC BY 4.0); Bosma et al. 1994 (PubMed 8027054) |
| `neuron_107146.json` | 22,892 SWC samples `[id, type, x, y, z, radius, parent]` in µm, type codes, record metadata, calculated lengths, tips, branch points and apical axis | NeuroMorpho.Org neuron 107146 (API + CNG SWC), CC BY 4.0 |
| `nav15_8vyj.json` | C-alpha trace in the shape of `data/molecules/renin_2ren.json` (same `ca` columns), plus per-residue `ca_repeat` and `ca_topology`, UniProt repeats, transmembrane segments, pore loops, the IFM motif, a calculated membrane normal | RCSB PDB 8VYJ (CC0 1.0); UniProt Q14524; Biswas et al. 2025 |
| `cells.json` | cardiomyocyte, red-blood-cell and skin value objects; Inspiration4 crew C001 blood count; MEG-source statement | see the scenes below |
| `elements.json` | van der Waals radii and CPK colours of H, C, N, O, S | PubChem periodic table API |

`data/bio/asctb.json` belongs to another build and is not written here. The neuron file is written without
indentation (about 0.9 MB instead of 2.5 MB); the others use `server.common.write_json`.

## Scenes

### `cell_neuron.js` (brain, µm)
Data: `bio/neuron_107146`, `bio/cells`.
- Human neocortical layer 2/3 pyramidal cell, NeuroMorpho.Org 107146 (`Fig1b_140312-1rm6_pyr`, Tamas archive,
  biocytin, Neurolucida, integrity "Dendrites & Axon Complete"). Original paper: Molnár G, Rózsa M, Baka J, et al.,
  eLife 2016;5:e18167, doi:10.7554/eLife.18167 (PMC4999310). Cite also NeuroMorpho.Org (RRID:SCR_002145) and Tecuatl C,
  Ljungquist B, Ascoli GA, FASEB BioAdv 2024;6:207-221, doi:10.1096/fba.2024-00048 (NeuroMorpho.Org terms of use).
- Drawn: every SWC segment as a 6-sided frustum at its reconstructed radius (one merged mesh, ~276k triangles), the
  same branches as 1-pixel lines, the soma as a sphere of the SWC soma radius 9.342 µm. Rotated so the calculated mean
  apical direction points up (rotation only).
- Animated: 48 markers run from real dendrite tips to the soma along the parent links and 36 from the soma to real
  axon tips. **Illustrative timing** (350 µm per on-screen second); markers are not to scale.
- Why the OPM sees it: Neymotin SA et al., eLife 2020;9:e51214, doi:10.7554/eLife.51214 ("the net intracellular current
  flow in the apical dendrites of pyramidal neurons").
- Not used: any conduction velocity (no sourced value for this cell type), shrinkage correction (not reported).

### `cell_cardiomyocyte.js` (heart, µm)
Data: `bio/cells`.
- Length 141 µm and length/width ratio 7.5: Gerdes AM et al., Circulation 1992;86:426-430, doi:10.1161/01.cir.86.2.426
  (abstract; nonfailing donor left-ventricular myocytes). Width 18.8 µm: calculated, length / ratio.
- Thickness 15.7 µm: myocyte maximum inscribed circle diameter, 202 non-failing donor left ventricles, Manandhar S et
  al., Cardiovasc Res 2026;122:1964-1977, doi:10.1093/cvr/cvag166 (PMC13653500), used as the smaller transverse dimension.
- Z-lines every 1.899 µm: resting sarcomere length, non-failing human ventricular myocytes, Ohler A et al., Cardiol Res
  Pract 2009:802373, doi:10.4061/2009/802373 (PMC2833295); 74 sarcomeres along the cell (calculated).
- Nav1.5 location (sarcolemma, T-tubules, intercalated discs): UniProt Q14524.
- Drawn as an elliptic cylinder; stepped ends, nuclei, mitochondria, T-tubules and myofibrils are not drawn. The
  depolarisation sweep has **illustrative timing**.

### `cell_rbc.js` (blood, µm)
Data: `bio/cells`.
- Shape: Evans E, Fung YC, Microvasc Res 1972;4:335-347, doi:10.1016/0026-2862(72)90069-6. Half-thickness
  z(r) = ½√(1−(r/R0)²)(C0 + C2(r/R0)² + C4(r/R0)⁴), R0 = 3.91 µm, C0 = 0.81 µm, C2 = 7.83 µm, C4 = −4.39 µm, drawn with
  `LatheGeometry`; a true-size section is drawn below the main cell. Verified via Fischer TM, Cells 2022;11:1941
  (Evans-Fung mean diameter 7.82 µm, Table 1), Sraj I et al., Opt Express 2010;18:16702 (dimensionless coefficients
  0.207161, 2.002558, −1.122762), and when PMC serves them Dodson WR & Dimitrakopoulos P, Biophys J 2010;99:2906 and
  Hosseini SM & Feng JJ, Biophys J 2012;103:1.
- Calculated from the equation: diameter 7.82 µm, thickest 2.566 µm at r = 2.738 µm, volume 94.1 µm³, area 134.1 µm².
- Crowding cube: NASA OSDR OSD-569 (SpaceX Inspiration4) complete blood count, crew C001 at R+1: 4.84 million/µL, so
  206.6 µm³ of blood per red cell (calculated), a cube 5.912 µm a side; haematocrit 43.6 %, MCV 90.1 fL (recorded).
- Context, not drawn: red cells in autologous plasma average 8.123 µm across (Fischer 2022).
- Cell positions and tilts are **illustrative** and sparser than blood. Plasma role of renin: UniProt P00797.

### `cell_skin.js` (skin, µm)
Data: `bio/cells`, `palette`.
- Stratum corneum 18.3 µm and cellular epidermis 56.6 µm, dorsal forearm: Sandby-Møller J, Poulsen T, Wulf HC, Acta Derm
  Venereol 2003;83:410-413, doi:10.1080/00015550310015419 (abstract).
- Dermis 1613.8 µm, right dorsal forearm, 50 MHz ultrasound: Wang Y et al., Quant Imaging Med Surg 2025;15:5218-5231,
  doi:10.21037/qims-2024-2637 (PMC12209672, Table 3).
- Patch: "dissolving/hydrogel microneedles loaded with fluorescent carbon quantum dots" (Tabatabaee RS et al., ACS Nano
  2024;18:28012-28025, doi:10.1021/acsnano.4c06191, abstract). **Needle height, base, tip, pitch and array size are not
  in any accessible source (full text paywalled), so no needle is drawn**; a marker in the carbon-dot emission colour
  (439 nm, `data/palette.json`) marks the site. The block footprint is the field of view only; the dermal-epidermal
  junction is drawn flat.

### `mol_nav15.js` (heart, Å)
Data: `bio/nav15_8vyj`, `bio/genes`.
- RCSB PDB 8VYJ, full-length human Nav1.5, cryo-EM 3.6 Å, 1,395 of 2,016 residues modelled: Biswas R et al., PNAS
  2025;122:e2416181122, doi:10.1073/pnas.2416181122 (PMC12107192). PDB numbering checked against UniProt Q14524 (all 1,395 match).
- Colour by UniProt topology (transmembrane, pore-forming loop, extracellular, cytoplasmic); labels for repeats I-IV at
  the centroid of their transmembrane residues; the IFM motif (Ile1485-Phe1486-Met1487) located by sequence search of the
  DIII-DIV linker as defined by Biswas et al. Turned so the calculated membrane normal (mean of the 24 transmembrane
  segments, oriented by UniProt topology) points up; the transmembrane residues span 39.8 Å along it (calculated, not a
  membrane thickness).
- Gene track: SCN5A, chr3:38,548,057-38,649,743 (−), ENST00000423572.7 (MANE Select NM_000335.5), 28 exons; its
  translation is 2,015 aa while the UniProt canonical sequence used for numbering is 2,016 aa.

### `mol_renin.js` (blood, Å)
Data: `molecules/renin_2ren` (from `scripts/build_molecules.py`), `bio/genes`, `specs`.
- PDB 2REN, X-ray 2.5 Å (Sielecki AR et al., Science 1989;243:1346, PubMed 2493678), C-alpha trace coloured by the
  file's HELIX/SHEET records; catalytic Asp38 and Asp226 (UniProt P00797 active sites 104 and 292).
- Sensor mechanism and detection limit from `data/specs.json` (Long et al., Anal Chem 2012, doi:10.1021/ac302284s).
- Gene track: REN, chr1:204,154,815-204,190,324 (−), ENST00000272190.9 (MANE Select NM_000537.4), 10 exons.

### `mol_bilirubin.js` (skin, Å)
Data: `molecules/bilirubin_cid5280352`, `bio/genes`, `bio/elements`, `specs`.
- PubChem CID 5280352 computed 3D conformer (a model geometry), 79 atoms, 82 bonds, CPK colours. Atom spheres are a
  slider-chosen fraction (25 % at start, 100 % = space-filling) of PubChem's van der Waals radii (H 1.20, C 1.70, N 1.55,
  O 1.52 Å). Labels for the two carboxylic acids and two lactam carbonyls come from the bond list.
- UGT1A1 conjugates bilirubin: UniProt P22309 function and Bosma PJ et al., J Biol Chem 1994;269:17960-17964
  (PubMed 8027054). Gene track: UGT1A1, chr2:233,760,262-233,773,313 (+), ENST00000305208.10 (MANE Select
  NM_000463.3), 5 exons.

## Checking

```sh
python scripts/build_bio.py                       # rebuild data/bio (prints a summary)
for f in ui/scale/cell_*.js ui/scale/mol_*.js; do node --check "$f"; done
```

A node smoke test (outside the repo) imported each module with the vendored `app/vendor/three` build, called `build()`
on the real `/data` files, ran `update()` and `dispose()`, and checked finite geometry and labels, units, gene
coordinates and the info text.
