# SpinDrift v11: prompt for Codex (web app in /app)

Project: SpinDrift, NASA Space Apps 2026, team Brain Freeze. Challenge: "Create Health Monitoring Software for Astronauts on Space Missions." **Quantum sensing is the product.** Four real devices: an optically pumped magnetometer (OPM, QuSpin QZFM Gen-3: brain and heart fields), an NV-diamond magnetometer (three published builds: JGU, ZAQuant, Q.ANT: heart field), a quantum-dot renin nanosensor (blood), and a carbon quantum-dot microneedle patch (skin bilirubin).

Claude Code has finished the data and the server. You own `/app` only.

**First, get rid of the current UI.** Delete the existing interface in `/app`: `index.html`, `main.js`, every `*-view.mjs` (anatomy-view, mission-view, object-view), `places.mjs`, `reference-library.mjs`, `simulator-directory.mjs`, `sensor-live.mjs`, `style.css`, `mission.css`, `immersive.css`, and the `assets/`, `research/` and `vendor/` folders if only the old UI uses them. Then build a new UI from scratch from this prompt. Do not carry over the old layout, components, styling, colours or 3D views. You may keep the tooling, which is not UI: `serve.py`, `config.json` (keep `serverUrl` at `http://localhost:8001`), `contract.mjs` (the validator), `/app/tests` and `LIVE_INSTRUMENT_CONTRACT.md`, updating them where this prompt differs.

## 1. Rules (override anything else)
1. Real only. Every number, curve, waveform, image and colour on the page comes from `/data` or the server. No generated waveforms, sample spectra, placeholder charts, mock numbers, random noise, decorative curves or illustrative data shapes. Schematic diagrams may show parts and labels only, never a data shape.
2. Every displayed number shows its value object (VO): value + unit, a tag chip (`live`, `near_live`, `recorded`, `datasheet`, `published_spec`, `calculated`, `simulated`), a status chip, the source on hover or in a details row, and `as_of` when present. Display text: NOT_STATED = "unspecified in source"; NOT_YET_EXTRACTED = "not yet extracted"; TO_CONFIRM = the value plus a "to confirm" chip. `value: null` is shown as that text, never as 0 or a dash pretending to be data.
3. Simulated output is always labelled "simulated". The ODMR-Lab plot PNGs say "measured" in their own legend: overlay a visible "SIMULATED (online simulator)" label on them.
4. Recorded data is always labelled with its file's `meta.label` (for example "Recorded on Earth with real QuSpin OPM sensors. Not an astronaut.").
5. No diagnosis or treatment advice. Crew role is a label only and changes no numbers. Never use the word "hypothesis".
6. Do not edit `/data`, `/server`, `/scripts`, `/contract`. Never hard-code a number that exists in the data. Test-only data stays in `/app/tests` and is never loaded by the app.
7. Footer, exact text: "Live: space magnetic-field feeds (NOAA L1 magnetometer; ISS position with the IGRF model). Near-live: an optically pumped magnetometer in orbit (ESA Swarm). Recorded: real OPM brain and heart data, NV, quantum-dot and carbon-dot lab data, and Inspiration4 astronaut lab data from NASA OSDR. Simulated: online simulators, labelled. No public live feed exists from these sensors on a human in space. Not diagnostic."

## 2. Running it
- Data: `python build_all.py` (rebuilds every file, then `scripts/validate.py`; currently 0 problems).
- Server: `uvicorn server.main:app --port 8001` (already running with the current code; Claude Code restarted it). Port 8000 is taken on this machine by a static `python -m http.server 8000`. If you restart the server, run it from the repo root.
- Contract: `contract/schema.md` (v10, word for word) plus the additive changes logged in `STATUS.md` and summarised in section 7 below.

## 3. The idea the page must make obvious
**Real runs build one real all-in-one quantum sensor.** Each press of Run does real work on real data, and its new facts are stacked as bricks onto a tower: the combined sensor. Think of building the Salesforce Tower out of Lincoln Logs and LEGO, one real brick per fact. And **quantum physics and biology get equal space**: every device is shown as a pair, physics on one side and the biology it reads on the other, at the same visual weight.

What one run does (server, `POST /api/run {location, role}`):
- OPM: processes the next real Kiel Cardio Database recording (175 in all: 7 subjects × 25 sensor positions) and measures that position's heart R-peak and Q wave.
- NV: makes one real call to the ODMR-Lab online simulator with the published ~1 mT bias plus the location's field vector (simulated output), and computes each NV build's averaged SNR on this run's real R-peak and Q wave.
- Quantum-dot renin: takes the next row of the real figshare FRET table and turns it into r/R0 with the Förster equation.
- Carbon-dot patch: takes the next real Inspiration4 total-bilirubin timepoint (NASA OSDR OSD-575) and the next real measured carbon-dot emission record.
- Links between devices (field clash 200,000×, optical readouts, readout hardware, power budget), each a VO.
- Static specs are added once; every run's new real data adds new bricks. A device with nothing new shows "no new data this run". Pasted simulator results are picked up by the next run.

## 4. Screens

### 4.1 Main card (top of the page, always visible)
From `clinical_card.json[<location>].main`, six rows in this order: **Heart Q wave**, **Brain EEG**, **Blood**, **Skin patch**, **Tumour risk**, **Lungs**. Each row: label, reading VO, supporting VOs with their `supporting_labels`, evidence badge (`SOURCED` / `EARTH_ONLY` / `TO_CONFIRM`), optional `badge` ("NASA data"), the NASA risk quote (`risk.heading` + `risk.text`, verbatim, with source link; `lung.risk` is a list of two), the `review_note`, and links to the `data` files. The heart row also offers a small real averaged-beat plot with Q, R and S marked (`nv_heart_derived.averaged_beat`: `t_s`, `pT`, `q_wave_pT`, `q_wave_ms_before_r`, `qrs_ms`, `s_wave_pT`). The tumour and lung rows are environment context (GOES radiation, ISS cabin air), never body measurements: say so on the row.

### 4.2 Four device benches: physics | biology, equal width
Driven by `device_map.json`. For each device, two panels side by side (stack on narrow screens, physics first):

**OPM**
- Physics: `physics.opm_zero_field` (Lorentzian `y` plus `extra_series` dispersive shape; x is B/ΔB, dimensionless; show `missing_inputs` and `notes`); `specs.opm` as a full hardware table (all 17 keys with VO chips); the explanation text from `device_map`.
- Biology: live-paced replays over SSE, `/api/stream/opm_heart_kiel` (8 channels, 200 Hz, pT) and `/api/stream/opm_brain_mne` (8 channels, 250 Hz, fT); the evoked response (`recorded/opm_brain_mne.json` → `evoked`: its own x and series, 201 epochs); the averaged heartbeat with Q/R/S; conventional EEG for comparison (`recorded/eeg_brain_ds004902.json`: 60 s window, `psd` for normal sleep vs sleep deprivation, `alpha_8_12Hz_uV2_per_Hz`), clearly marked "conventional EEG electrodes, not a quantum sensor".

**NV diamond**
- Physics: `physics.nv_odmr_lines` (`y` = f+ and `extra_series` f−, D and γ inputs shown with their chips; γ is TO_CONFIRM); real ODMR spectra from `recorded/nv_odmr_zenodo10629041.json` (three positions + mean, counts vs MHz); the latest ODMR-Lab result from the last run (`runs.json` → `real_work.odmr_lab`: `b_sent_mT`, `b_true_mT`, `b_cnn_mT`, `table`, `plot_file`), plus runs A and B in `simulators.json`; `specs.nv` as three side-by-side build tables (jgu, zaquant, qant) and the headline table.
- Biology: the real averaged heartbeat (`nv_heart_derived.averaged_beat`) with each build's noise drawn as a band of ± `per_build.<build>.averaged_noise_pT` around it (and optionally ± `single_beat_noise_pT`): this is the only allowed way to show noise; never generate noise. SNR table per build: `single_beat_snr`, `averaged_snr`, `averaged_snr_measured_peak`, `averaged_snr_q_wave`.

**Quantum-dot renin**
- Physics: `physics.qd_fret_vs_distance` (dimensionless r/R0; show both missing inputs); the real figshare table (`recorded/qd_fret_figshare5468838.json`: x = pressure in GPa, series = QD emission, QD-Rh101 emission, FRET efficiency, units as given, "a.u. (unit not stated)" kept); the TEM micrograph from `assets.json` (`qd_tem_figS1`); `specs.qd_renin`.
- Biology: blood renin. Say plainly that renin is not in open astronaut data (`nasa_i4.not_found`) and that the readout is a TIRF microscope (a lab assay, not a wearable). Detection limit VO.
- Simulators: FRET-Calc and nanoHUB Quantum Dot Lab cards from `simulators.json.qd_renin` (url, models, limits, inputs with origin, missing inputs, results). "awaiting simulator run" until a result exists. A paste form posts `{tool, inputs_used, outputs}` to `POST /api/simulators/qd_renin`.

**Carbon-dot patch**
- Physics: `physics.cqd_quenching` is not plotted: show its `missing_inputs` as the content, no curve. Real carbon-dot data from `recorded/cqd_pl_mendeley_cmfbrvrb8y.json` as a scatter (`meta.plot_hint` = "scatter": excitation nm vs measured emission nm). State `specs.cqd_patch.physics_label` (carbon-dot emission is not a spin-based quantum measurement).
- Biology: Inspiration4 total bilirubin per crew code over the seven timepoints (`nasa_i4.datasets[0].variables`: 4 lines × L-92, L-44, L-3, R+1, R+45, R+82, R+194, labels exactly as released, mg/dL, the NA point shown as "unspecified in source"); the reference range from the VO note.
- Simulators: MCX Cloud card (`simulators.json.cqd_patch`) with paste form to `POST /api/simulators/cqd_patch`; it models light in skin, not carbon-dot chemistry, so say so.

### 4.3 Run and the tower (the centrepiece)
- Controls: location select (`iss`, `gateway`, `lunar_base`, `mars_transit`, `mars_surface`), crew role (label only), Run button → `POST /api/run`. Show progress (a run takes about 5-10 s: one PhysioNet record and one ODMR-Lab call).
- Run result: what this run did (`real_work.kiel_record`, ODMR-Lab inputs and outputs with its plot, `figshare_row`), the links between devices, the new bricks (`adds_to_combined`), `notes` per device and any `errors`.
- Tower: `combined_sensor.json` (`GET /api/combined`). One column per component (magnetic shielding, field separation, magnetic sensitivity, optical readout, microwave drive, chemistry readout, body signals (recorded), power, size, data link). Each fact is one brick, stacked in run order (`from_run`), coloured by its `device` (section 5), labelled on hover with the fact, its VO and its run id. New bricks from the latest run animate in once (opacity/position only, no fake data). Show `version`, `runs_counted`, component `status` (sourced/open) and the `open_questions` beside the tower. Run history from `GET /api/runs`.

### 4.4 Live strip (secondary, small, honest)
From `/api/live` (poll 5 s) and `/api/sensors/live`: ISS position and IGRF field at the ISS (calculated), NOAA L1 field (spacecraft name from the feed, e.g. SOLAR1), GOES proton flux and NOAA S-level (`radiation`), ISS cabin readings ("ISS vehicle telemetry, not crew data", units to confirm), Swarm ASM (shows its error, currently "VIRES_TOKEN missing"), OPM readiness per location. Instrument slot from `/api/sensors/live`: all four devices currently `connected: false`. Show "No physical instrument connected" and never fill the slot with anything else. Use `GET /api/devices/live?location=` for the per-device live and environment items if useful.

### 4.5 Build log, flight-surgeon card, sources
- Build log: `build_log.json` (`per_sensor` and `combined`).
- Flight-surgeon card: `clinical_card.json[<location>].rows` (evidence chips, review notes, the five NASA hazards verbatim from `hrp.json`).
- Sources/audit: every VO's source; licence and attribution for every image (`assets.json`); dataset licences from each recorded file's `meta`; `published_points.json` shows "awaiting" (paywalled figures, points entered only by a person with figure and page).

## 5. Look: different from every competitor
`C:\Users\Rahma\Downloads\competitor_websites.csv` lists 68 other entries for this challenge. SpinDrift must not look like any of them. A review of their sites found these shared patterns. **Do not use any of them as a visual element or layout idea:**
- 3D body twins or rotatable anatomy models, including thermal/cyan "view modes" and organ callouts (Astronaut Health Intelligence Platform, Space6ix, Vitruvio, Vista, AstroVitals, AstroMed, HELIOS, ASTRA, AURA-EIMO, Crew Health Monitor, cheeseOS, Haoma, BEKUR-Aegis). To show where a sensor sits, use the real Kiel photo of the OPMs on a person (`assets.json`) or a flat line schematic of sensor placement with parts and labels only.
- Grids of vitals tiles with green/amber/red status, readiness or early-warning scores (NEWS2), triage levels, anomaly indices, gauges and rings.
- Personal-baseline bands, digital-twin projection cones and "day the threshold is crossed" forecasts; day-by-day 180-day mission simulations with seeded synthetic crews.
- ECG-paper grids and oscilloscope styling (25 mm/s, pink grid, pleth sweeps: HELIOS, AURA-EIMO) and spacesuit or visor HUD overlays (HELIOS, AURA-EIMO, Health Signal, Arasaka EVA).
- An Inspiration4 blood-panel explorer as a centrepiece (PROHOR, Vitruvio, Space6ix and others already do this). In SpinDrift, Inspiration4 bilirubin appears only as the astronaut reference for the carbon-dot patch.
- Space-weather chips as a headline (NOAA Kp/GOES, NASA DONKI), Earth-Mars light-delay panels, solar-storm replays. SpinDrift's live feeds stay in a small secondary strip.
- Scrolling ECG/EEG "monitor" traces (several competitors draw synthetic ones). SpinDrift's traces are real magnetic recordings from real OPMs and must look like lab data: thin lines, real axes, dataset label, no glow, no fake sweep.
- Symptom check-in forms, triage flows, AI chat or voice assistants, gamification, dark sci-fi "mission control" themes with glows and starfields.

What none of them has, and SpinDrift must lead with: quantum physics shown as physics (resonance lines, the zero-field resonance, FRET versus distance, real lab spectra, real online quantum-simulator runs, full hardware spec tables, real photos of the sensors), paired at equal weight with the biology each sensor reads, and a tower of real facts that grows with every real run. Good practice worth keeping from the review: a source line on every reading with the dataset checksum where we have one (Kiel SHA-256, OSD-575 SHA-256, Zenodo MD5, Mendeley SHA-256: see each recorded file's `meta`); the formula behind every calculated number (each calculated VO's `note`), shown on hover; honest empty states ("awaiting simulator run", "not yet extracted").

SpinDrift's own visual language, built only from what is real:
- **Colour is physics.** Data colours come only from `palette.json`, computed from cited wavelengths with the CIE 1931 tables: rubidium D1 795 nm and NV fluorescence above 695 nm both render spectral red `#ff0000` (both sit at the CIE red limit, so tell OPM and NV apart by label and line style, never by inventing a colour); measured carbon-dot emission 439 nm `#6200ff`; patch reader 470 nm `#002dff` (to confirm); the Swarm 1083 nm laser and the renin Cy5 line have no colour (infrared / no cited wavelength): use neutral grey for them and say why on hover. Everything else is neutral greyscale on a light, paper-like background, like a lab notebook or an instrument bench, not a dark "mission control" screen.
- **Instrument-bench layout**: the six-row main card at top, then the four physics | biology benches, then the tower with its run history. No vitals tiles grid, no gauges, rings or speedometers, no starfields, glows or gradients, no generic 3D body, no chatbot.
- **Typography**: a clear sans-serif for text and a monospace face for every value + unit + chip, so numbers read like an instrument printout.
- **Images**: only from `assets.json`, each captioned with its title, licence and attribution: the Kiel photos of the real QuSpin OPMs on a person, figure images from the NV paper (CC BY 4.0), the TEM micrograph of the quantum dots. QuSpin product photos are not licensed; link to the product page instead.
- **Charts**: plot only arrays from the files and endpoints; axis labels and units from the files; no smoothing or interpolation beyond the data; legends name the dataset and its tag.

## 6. Acceptance checks
- None of the old UI remains: its files are deleted and no old layout, component, style or 3D view was carried over (only the tooling listed at the top is kept).
- `scripts/validate.py` shows 0 problems, and your `contract.mjs` validator accepts every file and endpoint response.
- Search `/app` for hard-coded numbers that also exist in `/data`: none.
- With the server stopped, the app shows the last good `live_snapshot.json` and says the server is offline; recorded, calculated and simulated content still renders from `/data`.
- Run three runs at different locations: the tower grows by the new bricks each time, the Kiel record advances, and each ODMR-Lab result appears with its "simulated" label.
- Every image has a caption with licence and attribution; every number has a chip and a source.
- Physics and biology panels have equal width on desktop.

## 7. Contract additions since v10 (all additive, logged in STATUS.md)
- `locations.json` is `{meta, locations: [...]}`.
- Object files carry a top-level `meta` next to their keys (skip it when iterating ids).
- `recorded/opm_brain_mne.json` has an extra `evoked` {x, series, n_epochs, ...}.
- New files: `recorded/eeg_brain_ds004902.json` (`device_type: "eeg"`, extra `psd` and `alpha_8_12Hz_uV2_per_Hz`), `palette.json`, `assets.json` (+ `data/assets/`), `device_map.json`, `simulator_outputs/*.png`.
- `clinical_card.<location>.main` (six rows) next to `rows`; `hrp.json` has `risks` (verbatim NASA HRP risk statements) next to `hazards` (each with `heading` and `text`).
- `physics.<curve>.extra_series` (second line) and `opm_zero_field.notes`.
- `nv_heart_derived.averaged_beat` adds `q_wave_pT`, `q_wave_ms_before_r`, `qrs_ms`, `s_wave_pT`; `per_build.<build>.averaged_snr_q_wave`.
- `/api/live` and `live_snapshot.json` add `radiation` (GOES ≥10 MeV and ≥100 MeV flux, `noaa_s_scale`, `satellite`); `iss.b_total_nT.components_enu_nT`.
- `runs.json` runs add `notes`, `errors`, `real_work`; `combined_sensor` facts add `device`; components include "magnetic sensitivity" and "body signals (recorded)".
- New endpoints: `GET /api/runs`, `GET /api/devices/live?location=`, `GET /api/sensors/live`, `POST /api/sensors/{device}/ingest` (needs `SPINDRIFT_INGEST_KEY`; for a future real instrument only).
