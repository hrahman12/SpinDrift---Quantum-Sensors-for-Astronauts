# Quantum-level scenes (below 1 nm)

The deepest zoom level for each body site shows the quantum physics of the sensor there, as a live three.js scene.

| file | site | sensor | scene unit |
|---|---|---|---|
| `q_nv.js` | heart | NV-diamond magnetometers (Omar et al., arXiv 2601.18843) | Å |
| `q_rb.js` | brain | QuSpin QZFM Gen-3 optically pumped magnetometer (rubidium vapour) | nm |
| `q_qd.js` | blood | quantum-dot renin FRET nanosensor (Long et al., Anal. Chem. 84, 8846, 2012) | R₀ (dimensionless) |
| `q_cqd.js` | skin | carbon-dot microneedle bilirubin patch (Tabatabaee et al., ACS Nano 18, 28012, 2024) | Å |

`q_lib.js` is a shared helper module (arrows, lines, instanced atoms, glows, readout formatting). It is not a scene.

Each scene module follows the contract in `ui/zoom.js`: `DATA`, `LEVEL`, `build(D)` returning
`{ scene, camera, labels, info, readouts, controls, update, dispose }`. `build` also sets `LEVEL.scaleBar` from the data.
If `data/quantum_constants.json` is missing, `build` returns an empty stage whose info panel says how to rebuild it.

## Data

All constants come from `data/quantum_constants.json`, built by `scripts/build_quantum_constants.py`
(`python scripts/build_quantum_constants.py`). Every entry is a value object with its citation (document, table,
figure or equation, page, edition). Derived numbers are tagged `calculated` with formula and inputs. The script
recomputes each derived number, compares it with a recorded Wolfram Language run (stored under `checks`) and stops on
any disagreement. It also checks the Bloch steady state on 2000 random fields and the NV splitting on a 0 to 5 mT grid.

Other inputs: `physics.json` (D and γ for the NV, the FRET curve), `quantum_circuits.json` (12 Ramsey circuits on
Qiskit Aer), `palette.json` (wavelength colours), `lean_proofs.json` (Lean badges), the figshare FRET recording and
the PubChem bilirubin conformer.

Main sources: Steck, *Rubidium 87 D Line Data*, rev. 2.3.4 (8 Aug 2025); CODATA 2022 (NIST); Holloway et al.,
PRB 44, 7123 (1991) for the diamond lattice constant, cross-checked against COD 9011575 and 2300702; Trucano & Chen,
Nature 258, 136 (1975) via COD 9011577 for graphite; Barry et al., RMP 92, 015004 (2020); Sulai et al.,
arXiv 1906.03227, App. B; Mantina et al., JPCA 113, 5806 (2009) for the Rb radius; Cordero et al., Dalton Trans.
2008, 2832 for covalent radii (to confirm: checked against a transcription, the article is paywalled); FRET-Calc
Eqs. 2-3; Griffiths & Schroeter, 3rd ed., Sec. 2.2; Jmol CPK colours.

## What each scene shows

**q_nv (heart).** A diamond-cubic cluster (a = 3.567 Å, C–C = √3a/4 = 1.545 Å) rotated so that the NV axis [111]
points up. One N sits on a lattice site and the neighbouring site along [111] is empty (wire sphere, dashed broken
bonds). Atoms are on ideal sites; relaxation around the vacancy is not modelled. The ground-state levels follow
Barry Eq. 6 (m_s = 0 at 0, m_s = ±1 at D ± γB). The arrow is ⟨S⟩ of the Ramsey state (|0⟩ + |+1⟩)/√2, tilted
54.74° with length √3/2. It precesses about the NV axis at γB in the frame rotating at D. The Ramsey marker follows its
phase φ = 2πγBτ along cos²(φ/2), next to the 12 Qiskit Aer bars.
Controls: B along the axis (0 to 5 mT), atom size. Lean: `nv_splitting`, `nv_centre`, `nv_zero_field`.

**q_rb (brain).** One ⁸⁷Rb atom at its van der Waals radius (0.303 nm). At Sulai's 10¹⁴ cm⁻³ the atoms are about
215 nm apart, so neighbours lie outside the view. σ⁺ D1 pump light at 794.979 nm with the 5²S1/2 and 5²P1/2 hyperfine
sublevels. The 12 σ⁺ lines are drawn with brightness ∝ |d|² from Steck Tables 15 and 18. The dark state F = 2,
m_F = +2 has no σ⁺ line. The polarisation P integrates dP/dτ = z − P + w × P (RK4) from P = 0 into the closed-form
steady state, then restarts. Field and time are dimensionless (w = Ω/Γ′), because the QZFM's Γ′ is not stated.
Controls: w_x, w_y, w_z (−5 to 5). Lean: `opm_steady_state`, `bloch_circle`, `opm_half_width`. The full 3-axis steady
state is checked live (residual readout) and symbolically in Wolfram.

**q_qd (blood).** Dimensionless throughout: the renin paper's abstract does not state the dot's material or size, R₀,
or the number of Cy5 per dot. On the left, a particle in a box (levels ∝ n²/L², Re ψ_n turning at E_n/ħ, |ψ₁|²
shaded), in units of L₀ and E₁(L₀). On the right, Förster transfer E = nR₀⁶/(nR₀⁶ + r⁶) with lengths in R₀. The chart
below shares the r/R₀ axis. It also plots the measured CdTe/CdS → rhodamine 101 efficiencies (figshare, Li et al.
2021), placed at r/R₀ = (1/E − 1)^(1/6). Controls: r/R₀, n, L/L₀. Lean: `fret_half`, `fret_one_acceptor`,
`fret_inverse`.

**q_cqd (skin).** A graphitic fragment built from graphite's lattice: a = 2.464 Å, c = 6.711 Å, AB stacking,
C–C 1.423 Å, layer spacing c/2 = 3.356 Å, (100) spacing 2.134 Å. These are not measurements on the patch's dots: their
TEM fringes and size are not in the abstract. Glow and emitted points use the palette's 439 nm colour. Quenching and
recovery under the phototherapy blue light are shown only as three states, because the model and constants are not
public. A PubChem bilirubin conformer is drawn at true size; its placement is illustrative. Controls: state (0 to 2),
layers, atom size. No Lean theorem applies.

## Display choices (not physics; each one is also stated in its scene's info panel)

- NV: spin precession slowed 10⁸ times (1 s on screen = 10 ns). The ±1 Zeeman shifts are magnified 10× on the level
  diagram. Arrow length is 2.6 Å per ħ. Spheres are 0.35 × the covalent radius. Atoms fade with distance from the
  defect.
- Rb: the Bloch-sphere radius (1.25 nm) stands for |P| = 1. τ advances 1.2 per second on screen. Field arrow length
  ∝ |w|.
- QD: box width (1.3 units per L₀) and energy scale (0.2 per E₁) are diagram scales, not on the R₀ scale. Acceptor
  directions are illustrative. Glow gain is 1.6 × the share of excitations.
- CQD: the fragment radius (8 Å), layer count, photon points and bilirubin placement are display choices.

## Not drawn, because no source gives them

- NV lattice relaxation around the vacancy; dephasing (T₂*); the ¹⁴N hyperfine structure in the 3D scene.
- The QZFM's Γ′ and laser line. The Rb isotope in the QZFM (QuSpin states rubidium only; ⁸⁷Rb constants are shown).
  The optical-pumping populations: no rates are drawn.
- The renin dot's material, size, emission colour and R₀; the Cy5 emission colour (not in palette.json); the number of
  Cy5 per dot.
- The patch dots' lattice fringes and size; the quenching/recovery model, its kinetics and its brightness levels; the
  dots' surface groups.

## The descent: views, setEnv, motion (build called with opts.view)

With `opts.view` each quantum scene builds a descent version with no sliders: `setEnv(env)` sets every state, and the
motion is real motion, slowed by a printed factor (time is scaled, amplitudes never are). Without options the scenes
above are unchanged.

- **q_rb** (gas 10.0 nm, atom 2.50 nm, spin 500 pm). The 5s valence electron as 4,200 points sampled from the
  Coulomb-approximation density r^(2n*) e^(−2r/(n* a0)) (Bates & Damgaard 1949; n* = 1.8048 from Steck's ionization
  limit and CODATA R∞; core electrons not drawn). 40 atoms' spins drawn from one point: each is set along the light when
  pumped, then turns about the field at the atoms until pumped again (ages from a deterministic e^−a sample); their
  average is Sulai's P*. The field at the atoms is max(0, env.B_at_sensor_nT − 50 nT): QuSpin's on-board coils cancel
  up to 50 nT, the same limit Lean's card checks. w = field ÷ 15 nT, the half width of QuSpin's "FWHM ≈ 30 nT" zero-field
  resonance. Light let through = 1/(1 + w²). Zero-field pumping of the 8 ground sublevels from Steck's line strengths
  (3-j/6-j symbols, checked against Tables 15 and 18 to 3×10⁻¹³). Larmor 6.996 Hz/nT (F = 2).
- **q_nv** (lattice 2.50 nm, pair 500 pm). Atoms jiggle with diamond's measured Uiso = 0.001710 Å² at 293 K (COD 2300702)
  at the Einstein frequency that reproduces it, 25.41 THz (calculated), shown 3.2×10¹³ times slower. The other three
  <111> NV directions; the ODMR spectrum (four directions, ¹⁴N triplet 2.16 MHz, ZAQuant linewidth 200 kHz, depth
  normalised) with a sweeping microwave; the optical cycle (532 nm in, 637 nm out, the 1042 nm singlet path from
  m_s = ±1, Barry et al.); heartbeat 25 pT against the noise after N beats (single-beat noise ÷ √N). env.B_nT moves the
  lines and turns the spin at γB (slowed 2×10⁶).
- **q_qd** (default, dimensionless). The hop: excitation envelopes of dot and dye in units of the dot's lifetime (not
  stated), E = 1/(1 + (r/R₀)⁶) at r = R₀ (display); the leash is cut only when env.inputs.renin_pM ≥ env.lod_renin_pM.
- **q_cqd** (dot 10.0 nm, lattice 2.50 nm, ring 500 pm). The electron steps up 3.369 eV (368 nm) and drops 2.824 eV
  giving 439 nm light (the same Mendeley records); quenched when a bilirubin value is entered, recovering under blue
  light. Graphite's displacement parameters have no stated temperature, so its atoms are drawn at rest.
- **q_nucleus** (`?id=rb87|n14`, nucleus 10.0 fm). One sphere at the measured rms charge radius (Angeli & Marinova 2013
  via the IAEA radii file, cross-checked against the IAEA Live Chart), the 2I + 1 orientation cones, the measured magnetic
  dipole and quadrupole moments, and the spin turning at the real Larmor rate for the place (⁸⁷Rb: with the electron,
  6.996 Hz per nT left at the atoms, slowed 10⁵; ¹⁴N: 3.0763 MHz/T, slowed 100).

New entries in `quantum_constants.json` (all read from the fetched files, SHA256 in `meta.sha256`, derived values
cross-checked in Wolfram Language under `checks.motion`): `codata` (μN/h, R∞, a0, u from NIST), `si` (exact h, k, e, c),
`motion` (diamond Uiso and Einstein frequency; graphite U without temperature), `nv_optics`, `rb87.ionization_limit`,
`rb87.atomic_mass_kg`, `rb87.valence_*`, `rb87.thermal_mean_speed` (321 m/s), `opm_model.zero_field_fwhm/hwhm`,
`nuclei.*.magnetic_dipole/electric_quadrupole/larmor_*`.

## Note for the host

`q_qd.js` sets `LEVEL.unit = 'R₀'` and `LEVEL.dimensionless = true`. `ui/zoom.js` draws an SI scale bar from
`LEVEL.unit` and falls back to nm for unknown units, which would mislabel this scene. The host should hide the bar, or
show `LEVEL.scaleBar.label`, when `LEVEL.dimensionless` is set.

## Verify

```sh
python scripts/build_quantum_constants.py       # writes data/quantum_constants.json; stops if a check fails
node --check ui/scale/q_nv.js                  # likewise q_rb.js, q_qd.js, q_cqd.js, q_lib.js
```
