# STATUS

## Notes before contract v10 (kept for history)

- contract/schema.md: written (v1).
- specs.json: pending (in this run).
- live_ambient.json: pending (NOAA endpoint in the brief is 404; working endpoint is /json/rtsw/rtsw_mag_1m.json).
- Blocked: Kiel Cardio DB and OPM-MEG datasets not downloaded (sizes not checked); ESA Swarm ASM needs a VirES token; simulator rule conflicts (online-only vs pip packages); renin/patch measured points not yet entered from papers.

## Log (contract v10)
Format: `<ISO time> <agent> <file or feed> <done|failed|changed> <note>`

2026-11-15T07:24:16Z claude-code contract/schema.md changed replaced v1 with the v10 contract section, word for word
2026-11-15T07:24:16Z claude-code contract changed locations.json is wrapped as {meta, locations:[...]} because every /data file must carry meta; the array shape is unchanged inside 'locations'
2026-11-15T07:24:16Z claude-code contract changed object-shaped files (physics, simulators, clinical_card, live_snapshot) carry a top-level 'meta' key next to their contract keys; readers should skip 'meta' when iterating ids
2026-11-15T07:24:16Z claude-code data/legacy changed moved pre-v10 specs.json and build_log.json to data/legacy/ (old shape); other pre-v10 files left in place because the root index.html reads heart_data/brain_data/ras_data/environments
2026-11-15T07:24:16Z claude-code data/* done fixtures written for every v10 file (no numbers, value null, NOT_YET_EXTRACTED, meta.fixture true) by scripts/make_fixtures.py
2026-11-15T07:24:16Z claude-code server/main.py done stub FastAPI server serving the fixtures: /api/live, /api/health, /api/stream/{id}, /api/simulators/{device}, /api/run (503 in stub), /api/combined
2026-11-15T07:24:16Z claude-code kiel-cardio 1.0.0 done full download 6.8 GB to the session scratchpad; 704/704 files match SHA256SUMS.txt (8 README images not fetched)
2026-11-15T07:24:16Z claude-code zenodo 24005272 done 3 zips + README downloaded to the session scratchpad; all 4 sizes match the Zenodo listing
2026-11-15T07:29:31Z codex app/* done fresh six-view frontend with strict provenance, fixture/offline handling, live polling, recorded SSE, simulator paste-back and connected-run controls; supports logged locations wrapper
2026-11-15T07:29:31Z codex index.html changed removed previous illustrative dashboard; root now redirects to /app/
2026-11-15T07:29:31Z codex app/tests done five provenance/freshness/sample-alignment unit checks pass; integration fails on legacy JSON metadata and /api/live HTTP 404 at configured localhost:8000; no synthetic replacements
2026-11-15T07:30:20Z codex app/browser done browser smoke checks passed for all six views, run-error display, crew-label update and mobile overflow; no browser page errors
2026-11-15T07:30:20Z codex README.md changed replaced obsolete illustrative-dashboard instructions with fresh app launch and actual integration limitations
2026-11-15T07:35:41Z claude-code data/recorded/opm_heart_kiel.json done data/subject1_preprocessed_trial13, 8 channels, 12000 samples at 200 Hz, pT from the header; sha256 verified
2026-11-15T07:37:09Z claude-code data/recorded/opm_brain_mne.json done 8 of 9 OPM channels, 15000 samples at 250 Hz (from 1000 Hz), fT; evoked from 201 of 201 median-nerve epochs
2026-11-15T07:40:10Z claude-code ODMR-Lab API done run A (Run A, ZAQuant/Q.ANT operating point) via /solve; plot saved: True
2026-11-15T07:40:13Z claude-code ODMR-Lab API done run B (Run B, JGU zero bias) via /solve; plot saved: True
2026-11-15T07:40:42Z claude-code data/specs.json done built from the v10 tables: 15 datasheet + 57 published_spec VERIFIED, 7 TO_CONFIRM, 6 NOT_YET_EXTRACTED, 4 NOT_STATED
2026-11-15T07:40:42Z claude-code data/specs.json changed upgraded to VERIFIED from primary sources: opm.sensitivity_dual_axis_typical, opm.total_power, opm.electronics_size (QuSpin Gen-3 product page); nv.headline r_peak_average, sensitivity_for_single_beat_snr5, bandwidth_assumed, reference_opm_mapping, data_availability and per-build sensitivity/beats_averaged (arXiv 2601.18843 PDF)
2026-11-15T07:40:42Z claude-code data/specs.json changed nv.headline.standoff NOT_STATED -> '~1 cm (JGU, ZAQuant)' from the full text pp. 4 and 6; opm.quantum_effect source moved to https://quspin.com/technology/ because the brief's URL returns HTTP 404
2026-11-15T07:40:42Z claude-code data/specs.json changed space_heritage.oscar_qube mass 420 g and power 5 W sourced from the paper abstract (Crossref, CC BY 4.0); '10 months 2021-22', 'continuous-wave' and 'station interference' stay TO_CONFIRM because the APS full text returns 403
2026-11-15T07:40:42Z claude-code NOAA L1 feed changed products/solar-wind/mag-5-minute.json and mag-2-hour.json both return HTTP 404; server falls back to the official NOAA SWPC RTSW file json/rtsw/rtsw_mag_1m.json (active spacecraft field, currently SOLAR1); the VO note records the fallback
2026-11-15T07:40:42Z claude-code ISS + IGRF done wheretheiss.at position + IGRF-14 (ppigrf 2.1.0) total field, tag calculated
2026-11-15T07:40:42Z claude-code Swarm ASM failed VIRES_TOKEN missing; swarm_asm is null until the user sets the env var (free registration at vires.services)
2026-11-15T07:40:42Z claude-code server/main.py done replaced the stub: background polling (L1 60 s, ISS 10 s, Swarm 10 min), atomic live_snapshot.json + locations.json, SSE streams at the recording rate, simulator paste endpoint, /api/run
2026-11-15T07:40:42Z claude-code contract changed recorded/opm_brain_mne.json carries an extra top-level key 'evoked' {x, series, n_epochs, ...} because the averaged evoked response has its own time axis; x/series keep the contract shape
2026-11-15T07:40:42Z claude-code data/simulators.json done catalogue for all four devices; ODMR-Lab /solve API runs A (|B| 1 mT, +z) and B (zero field) saved with table, note and plot PNG in data/simulator_outputs/
2026-11-15T07:46:25Z claude-code data/recorded/opm_brain_mne.json done 8 of 9 OPM channels, 15000 samples at 250 Hz (from 1000 Hz), fT; evoked from 201 of 201 median-nerve epochs
2026-11-15T07:46:26Z claude-code data/recorded/nv_odmr_zenodo10629041.json done Raw_data.txt md5 verified; 201 frequencies 2820.0-2920.0 MHz; positions [1, 24, 47] + mean; CC BY 4.0
2026-11-15T07:46:29Z claude-code data/recorded/qd_fret_figshare5468838.json done deposit has no numeric spectra/decay curves; used the published Table S1 (5 pressures: QD and QD-Rh101 emission intensity, FRET efficiency) from the CC BY 4.0 supplement, md5 verified
2026-11-15T07:46:31Z claude-code data/recorded/cqd_pl_mendeley_cmfbrvrb8y.json done zip sha256 verified; deposit has no PL spectra, so used the 23 first-hand external measurement records (excitation nm vs measured emission max nm); CC BY 4.0
2026-11-15T07:49:21Z codex app/live changed live-only human-sensor cards now exclude recorded, simulated, calculated, stale, unverified, disconnected and wrong-location readings; /api/sensors/live integration documented, no physical instrument connected
2026-11-15T07:49:21Z codex app/mission done real NASA observation-site imagery switches with ISS, Gale Crater and Taurus-Littrow selection; no invented station or local terrain telemetry
2026-11-15T07:49:21Z codex app/assets done reused AHI Z-Anatomy reference meshes from user CSV under CC BY-SA 4.0; original licence and attribution retained; Three.js MIT vendored locally
2026-11-15T07:49:21Z codex app/research done imported CSV into searchable reference library; documented actual reuse and unverified claims; added researched simulator tools for all four devices with explicit missing model limits
2026-11-15T07:49:21Z codex app/tests done seven unit checks pass; browser loaded real anatomy GLBs, synchronized real places, selected all four sensors, searched CSV, and passed mobile overflow with no browser page errors
2026-11-15T07:49:51Z claude-code data/recorded/opm_heart_kiel.json done data/subject1_preprocessed_trial03, 8 channels, 12000 samples at 200 Hz, pT from the header; sha256 verified
2026-11-15T07:49:52Z claude-code data/nv_heart_derived.json done 47 beats averaged on ch0 Sensor 0 -Y, R-peak -43.1 pT; jgu 71.2 pT / SNR 38.46, zaquant 38.34 pT / SNR 11.29, qant 142.41 pT / SNR 7.85
2026-11-15T07:49:52Z claude-code data/physics.json done nv_odmr_lines (D VERIFIED, gamma TO_CONFIRM), opm_zero_field (Lorentzian, QuSpin + Sulai Eq. B2), qd_fret_vs_distance (FRET-Calc Eq. 2) plotted; cqd_quenching not plotted
2026-11-15T07:49:52Z claude-code data/build_log.json done 23 per-sensor and 10 combined facts; per-location shielding factors from the latest live snapshot
2026-11-15T07:49:53Z claude-code data/clinical_card.json done 5 locations, 9 rows each
2026-11-15T07:50:23Z codex app/config.json changed running existing data-owner FastAPI on localhost:8001 because localhost:8000 serves no API; frontend configured to 8001; fallback server default remains 8000; health reports L1, ISS and IGRF ok, Swarm token and cabin telemetry unavailable
2026-11-15T07:52:21Z claude-code data/nasa_i4.json done OSD-575 CMP sha256 verified; total bilirubin 27 numeric values for 4 crew codes; renin and aldosterone not found in open I4 data
2026-11-15T07:52:22Z claude-code data/hrp.json done five hazards quoted word for word from https://www.nasa.gov/hrp/hazards/
2026-11-15T07:52:42Z claude-code data/nv_heart_derived.json done 47 beats averaged on ch0 Sensor 0 -Y, R-peak -43.1 pT; jgu 71.2 pT / SNR 38.46, zaquant 38.34 pT / SNR 11.29, qant 142.41 pT / SNR 7.85
2026-11-15T07:52:42Z claude-code data/physics.json done nv_odmr_lines (D VERIFIED, gamma TO_CONFIRM), opm_zero_field (Lorentzian, QuSpin + Sulai Eq. B2), qd_fret_vs_distance (FRET-Calc Eq. 2) plotted; cqd_quenching not plotted
2026-11-15T07:52:42Z claude-code data/build_log.json done 23 per-sensor and 10 combined facts; per-location shielding factors from the latest live snapshot
2026-11-15T07:52:42Z claude-code data/clinical_card.json done 5 locations, 14 rows each
2026-11-15T07:58:07Z codex app/immersive.css changed cinematic full-width 3D anatomy workbench inspired by CSV references, floating live-only instrument cards, spatial selection pins, orbit/zoom, target focus, anatomy/skeleton/surface controls
2026-11-15T07:58:07Z codex app/assets done original NASA ISS, Curiosity and LRO colour-only Moon GLB viewers; official QuSpin Gen-3 mechanical mockup STL viewer; source credits retained and no fabricated CAD or terrain geometry
2026-11-15T07:59:33Z codex app/browser done immersive browser check passed: actual anatomy, ISS, Curiosity, Moon and QuSpin source models loaded; atlas pins select device; keyboard orbit/zoom and focus/layers work; responsive viewport no overflow; no page errors
2026-11-15T08:06:38Z claude-code data/recorded/eeg_brain_ds004902.json done ds004902 sub-01 eyes-closed EEG, NS and SD sessions (CC0, md5 ETag verified); alpha 8-12 Hz power NS 13.330, SD 10.263 uV^2/Hz (occipital mean)
2026-11-15T08:12:04Z claude-code data/palette.json done colours calculated from cited wavelengths (795, 695, 439, 470 nm; 1083 nm IR has none); fit vs CIE 1931 table at 450/555/600 nm: largest difference 0.009 (colour-matching units)
2026-11-15T08:12:04Z claude-code data/assets.json done 18 openly licensed real images (Kiel CC BY-SA 4.0, arXiv 2601.18843 CC BY 4.0, figshare CC BY 4.0, ODMR-Lab outputs)
2026-11-15T08:12:04Z claude-code data/device_map.json done physics <-> biology pairing per device for the UI
2026-11-15T08:13:38Z claude-code data/nasa_i4.json done OSD-575 CMP sha256 verified; total bilirubin 27 numeric values for 4 crew codes; renin and aldosterone not found in open I4 data
2026-11-15T08:13:39Z claude-code data/hrp.json done five hazards quoted word for word from https://www.nasa.gov/hrp/hazards/
2026-11-15T08:14:25Z claude-code data/nv_heart_derived.json done 47 beats averaged on ch0 Sensor 0 -Y, R-peak -43.1 pT; jgu 71.2 pT / SNR 38.46, zaquant 38.34 pT / SNR 11.29, qant 142.41 pT / SNR 7.85
2026-11-15T08:14:25Z claude-code data/physics.json done nv_odmr_lines (D VERIFIED, gamma TO_CONFIRM), opm_zero_field (Lorentzian, QuSpin + Sulai Eq. B2), qd_fret_vs_distance (FRET-Calc Eq. 2) plotted; cqd_quenching not plotted
2026-11-15T08:14:25Z claude-code data/build_log.json done 23 per-sensor and 10 combined facts; per-location shielding factors from the latest live snapshot
2026-11-15T08:14:25Z claude-code data/clinical_card.json done 5 locations, 14 rows each
2026-11-15T08:16:53Z claude-code data/nv_heart_derived.json done 47 beats averaged on ch0 Sensor 0 -Y, R-peak -43.1 pT; jgu 71.2 pT / SNR 38.46, zaquant 38.34 pT / SNR 11.29, qant 142.41 pT / SNR 7.85
2026-11-15T08:16:53Z claude-code data/physics.json done nv_odmr_lines (D VERIFIED, gamma TO_CONFIRM), opm_zero_field (Lorentzian, QuSpin + Sulai Eq. B2), qd_fret_vs_distance (FRET-Calc Eq. 2) plotted; cqd_quenching not plotted
2026-11-15T08:16:53Z claude-code data/build_log.json done 23 per-sensor and 10 combined facts; per-location shielding factors from the latest live snapshot
2026-11-15T08:16:53Z claude-code data/clinical_card.json done 5 locations, 14 rows each
2026-11-15T08:17:27Z claude-code data/nv_heart_derived.json done 47 beats averaged on ch0 Sensor 0 -Y, R-peak -43.1 pT; jgu 71.2 pT / SNR 38.46, zaquant 38.34 pT / SNR 11.29, qant 142.41 pT / SNR 7.85
2026-11-15T08:17:27Z claude-code data/physics.json done nv_odmr_lines (D VERIFIED, gamma TO_CONFIRM), opm_zero_field (Lorentzian, QuSpin + Sulai Eq. B2), qd_fret_vs_distance (FRET-Calc Eq. 2) plotted; cqd_quenching not plotted
2026-11-15T08:17:27Z claude-code data/build_log.json done 23 per-sensor and 10 combined facts; per-location shielding factors from the latest live snapshot
2026-11-15T08:17:27Z claude-code data/clinical_card.json done 5 locations, 14 rows each
2026-11-15T08:17:57Z claude-code data/nv_heart_derived.json done 47 beats averaged on ch0 Sensor 0 -Y, R-peak -43.1 pT; jgu 71.2 pT / SNR 38.46, zaquant 38.34 pT / SNR 11.29, qant 142.41 pT / SNR 7.85
2026-11-15T08:17:57Z claude-code data/physics.json done nv_odmr_lines (D VERIFIED, gamma TO_CONFIRM), opm_zero_field (Lorentzian, QuSpin + Sulai Eq. B2), qd_fret_vs_distance (FRET-Calc Eq. 2) plotted; cqd_quenching not plotted
2026-11-15T08:17:57Z claude-code data/build_log.json done 23 per-sensor and 10 combined facts; per-location shielding factors from the latest live snapshot
2026-11-15T08:17:57Z claude-code data/clinical_card.json done 5 locations, 14 rows each
2026-11-15T08:17:58Z claude-code server/runs.py done real-run engine: each run processes the next real Kiel recording (175 total), makes one ODMR-Lab /solve call with the location's field + 1 mT bias, takes the next real figshare FRET row, Inspiration4 bilirubin timepoint and Mendeley carbon-dot record; new facts are stacked onto combined_sensor.json (static specs once)
2026-11-15T08:17:58Z claude-code data/runs.json done two verification runs (iss 39 blocks, mars_surface 15 blocks); combined_sensor version 2
2026-11-15T08:17:58Z claude-code contract changed additive: combined_sensor components may include 'magnetic sensitivity' and 'body signals (recorded)'; each fact carries 'device'; runs carry 'notes', 'errors' and 'real_work'
2026-11-15T08:17:58Z claude-code contract changed additive endpoints: GET /api/runs, GET /api/devices/live?location=, GET /api/sensors/live (instrument slot per app/LIVE_INSTRUMENT_CONTRACT.md, connected false until a real instrument posts), POST /api/sensors/{device}/ingest (needs env SPINDRIFT_INGEST_KEY)
2026-11-15T08:17:58Z claude-code contract changed additive: /api/live and live_snapshot.json carry 'radiation' (GOES primary integral protons >=10 and >=100 MeV, NOAA S-level); iss_lat/lon unchanged
2026-11-15T08:17:58Z claude-code contract changed additive files: recorded/eeg_brain_ds004902.json (device_type 'eeg', conventional EEG for comparison), palette.json, assets.json (+ data/assets/), device_map.json; clinical_card.<loc>.main (six rows: heart_q_wave, brain_eeg, blood, skin_patch, tumor, lung); hrp.json 'risks' (verbatim NASA HRP risk statements)
2026-11-15T08:17:58Z claude-code Swarm ASM changed nominal flag corrected to Flags_F == 0 (Swarm L1b Product Definition Issue 5.27, Table 6-2)
2026-11-15T08:17:58Z claude-code locations.json done lunar_base 38 nT (Apollo 12 ALSEP, Dyal et al. 1973 Table 2), mars_surface 2013 nT (InSight, Johnson et al. 2020), gateway NOT_STATED (no NRHO measurement exists)
2026-11-15T08:17:58Z claude-code ISS cabin done Lightstreamer ISSLIVE items USLAB000058/59/53/55 live; units TO_CONFIRM (ISS-Mimic labels vs spreadsheet); TimeStamp = day-of-year*24 + hour
2026-11-15T08:17:58Z claude-code server on port 8001 changed the copy of server.main started by Codex on port 8001 still runs the old code and rewrites live_snapshot.json without radiation/cabin every 60 s; restart it to load the new endpoints
2026-11-15T08:18:12Z claude-code data/specs.json changed space_heritage.swarm_asm.charlie_asm TO_CONFIRM -> VERIFIED (ESA IDEAS+ weekly reports wk45/46 2014; DTU release notes): lost 5 Nov 2014
2026-11-15T08:20:42Z claude-code data/recorded/opm_heart_kiel.json done data/subject1_preprocessed_trial03, 8 channels, 12000 samples at 200 Hz, pT from the header; sha256 verified
2026-11-15T08:20:48Z claude-code data/recorded/opm_brain_mne.json done 8 of 9 OPM channels, 15000 samples at 250 Hz (from 1000 Hz), fT; evoked from 201 of 201 median-nerve epochs
2026-11-15T08:20:48Z claude-code data/recorded/nv_odmr_zenodo10629041.json done Raw_data.txt md5 verified; 201 frequencies 2820.0-2920.0 MHz; positions [1, 24, 47] + mean; CC BY 4.0
2026-11-15T08:20:48Z claude-code data/recorded/qd_fret_figshare5468838.json done deposit has no numeric spectra/decay curves; used the published Table S1 (5 pressures: QD and QD-Rh101 emission intensity, FRET efficiency) from the CC BY 4.0 supplement, md5 verified
2026-11-15T08:20:48Z claude-code data/recorded/cqd_pl_mendeley_cmfbrvrb8y.json done zip sha256 verified; deposit has no PL spectra, so used the 23 first-hand external measurement records (excitation nm vs measured emission max nm); CC BY 4.0
2026-11-15T08:20:54Z claude-code data/recorded/eeg_brain_ds004902.json done ds004902 sub-01 eyes-closed EEG, NS and SD sessions (CC0, md5 ETag verified); alpha 8-12 Hz power NS 13.330, SD 10.263 uV^2/Hz (occipital mean)
2026-11-15T08:20:54Z claude-code data/nasa_i4.json done OSD-575 CMP sha256 verified; total bilirubin 27 numeric values for 4 crew codes; renin and aldosterone not found in open I4 data
2026-11-15T08:20:56Z claude-code data/hrp.json done five hazards quoted word for word from https://www.nasa.gov/hrp/hazards/
2026-11-15T08:20:56Z claude-code data/nv_heart_derived.json done 47 beats averaged on ch0 Sensor 0 -Y, R-peak -43.1 pT; jgu 71.2 pT / SNR 38.46, zaquant 38.34 pT / SNR 11.29, qant 142.41 pT / SNR 7.85
2026-11-15T08:20:56Z claude-code data/physics.json done nv_odmr_lines (D VERIFIED, gamma TO_CONFIRM), opm_zero_field (Lorentzian, QuSpin + Sulai Eq. B2), qd_fret_vs_distance (FRET-Calc Eq. 2) plotted; cqd_quenching not plotted
2026-11-15T08:20:56Z claude-code data/build_log.json done 23 per-sensor and 10 combined facts; per-location shielding factors from the latest live snapshot
2026-11-15T08:20:57Z claude-code data/clinical_card.json done 5 locations, 14 rows each
2026-11-15T08:21:06Z claude-code data/palette.json done colours calculated from cited wavelengths (795, 695, 439, 470 nm; 1083 nm IR has none); table check at 450/555/600 nm: largest difference 0.0000; beyond 700 nm the CIE chromaticity stays at x 0.7347, y 0.2653 (deep red)
2026-11-15T08:21:06Z claude-code data/assets.json done 20 openly licensed real images (Kiel CC BY-SA 4.0, arXiv 2601.18843 CC BY 4.0, figshare CC BY 4.0, ODMR-Lab outputs)
2026-11-15T08:21:06Z claude-code data/device_map.json done physics <-> biology pairing per device for the UI

## Final report (2026-11-15T08:22:29Z)

### Files and value objects by tag/status
- assets.json: no value objects
- build_log.json: calculated/NOT_YET_EXTRACTED 1, calculated/VERIFIED 8, datasheet/VERIFIED 5, published_spec/NOT_STATED 9, published_spec/NOT_YET_EXTRACTED 1, published_spec/TO_CONFIRM 1, published_spec/VERIFIED 8
- clinical_card.json: calculated/NOT_YET_EXTRACTED 3, calculated/VERIFIED 78, live/NOT_YET_EXTRACTED 4, live/TO_CONFIRM 2, live/VERIFIED 6, published_spec/VERIFIED 40, recorded/NOT_STATED 6, recorded/VERIFIED 2
- combined_sensor.json: calculated/VERIFIED 25, datasheet/VERIFIED 7, published_spec/TO_CONFIRM 1, published_spec/VERIFIED 13, recorded/VERIFIED 6, simulated/VERIFIED 2
- device_map.json: no value objects
- hrp.json: no value objects
- live_snapshot.json: calculated/NOT_YET_EXTRACTED 3, calculated/VERIFIED 4, datasheet/VERIFIED 5, live/VERIFIED 9, published_spec/NOT_STATED 3
- locations.json: calculated/VERIFIED 1, live/VERIFIED 1, published_spec/NOT_STATED 3
- nasa_i4.json: recorded/NOT_STATED 1, recorded/VERIFIED 27
- nv_heart_derived.json: calculated/VERIFIED 21, published_spec/VERIFIED 3
- palette.json: calculated/NOT_STATED 2, calculated/TO_CONFIRM 1, calculated/VERIFIED 3, published_spec/NOT_STATED 1, published_spec/TO_CONFIRM 1, published_spec/VERIFIED 3, recorded/VERIFIED 1
- physics.json: datasheet/TO_CONFIRM 1, datasheet/VERIFIED 1, published_spec/TO_CONFIRM 1, published_spec/VERIFIED 3
- published_points.json: no value objects
- recorded/cqd_pl_mendeley_cmfbrvrb8y.json: no value objects
- recorded/eeg_brain_ds004902.json: no value objects
- recorded/nv_odmr_zenodo10629041.json: no value objects
- recorded/opm_brain_mne.json: no value objects
- recorded/opm_heart_kiel.json: no value objects
- recorded/qd_fret_figshare5468838.json: no value objects
- runs.json: calculated/VERIFIED 53, datasheet/VERIFIED 9, published_spec/TO_CONFIRM 1, published_spec/VERIFIED 23, recorded/VERIFIED 16, simulated/VERIFIED 10
- simulators.json: published_spec/TO_CONFIRM 5, published_spec/VERIFIED 9, simulated/VERIFIED 8
- specs.json: datasheet/VERIFIED 15, published_spec/NOT_STATED 4, published_spec/NOT_YET_EXTRACTED 6, published_spec/TO_CONFIRM 6, published_spec/VERIFIED 58

### TO_CONFIRM items (specs, physics, palette, simulators)
- specs.json.opm.bandwidth_serf_class: '80–150 open loop, 350 closed loop' Hz: Class figure, not the Gen-3 datasheet. Slide 20 lists 80–150 Hz open loop for zero-field SERF OPMs and footnotes the 350 Hz closed-loop figure to Fiel
- specs.json.cqd_patch.reader_channels: '440, 470, 510' nm: full text is paywalled; not checked against the primary source
- specs.json.cqd_patch.calibration_model: 'ex vivo rat skin' : full text is paywalled; not checked against the primary source
- specs.json.space_heritage.oscar_qube.principle: 'NV-diamond magnetometer using continuous-wave ODMR' : the abstract confirms ODMR with NV centres in diamond; 'continuous-wave' is not in the abstract and the APS full text returned HTTP 403 on 2026-11-15,
- specs.json.space_heritage.oscar_qube.iss_operation: 'ran on the ISS for 10 months in 2021–22' : the abstract confirms deployment aboard the ISS; duration and years: the APS full text returned HTTP 403 on 2026-11-15, so this is not yet checked
- specs.json.space_heritage.oscar_qube.measurement_location: 'inside the station, where equipment caused interference' : the APS full text returned HTTP 403 on 2026-11-15, so this is not yet checked
- physics.json.nv_odmr_lines.inputs[1]: 28.025 MHz/mT: Barry et al. give g_e ≈ 2.003, i.e. gamma ≈ 28.03 MHz/mT; 28.025 MHz/mT is the brief's value (free-electron g = 2.0023, also used by ODMR-Lab). The tw
- physics.json.opm_zero_field.inputs[1]: '~30' nT: 'typically about 30 nT wide'; QuSpin does not say whether this is the full or the half width
- palette.json.colours[3].wavelength: 470 nm: 
- palette.json.colours[3].colour: '#002dff' sRGB hex: formula: CIE 1931 colour-matching table -> XYZ -> linear sRGB, negatives clipped, scaled to full brightness, sRGB gamma; inputs: Patch reader channel 
- simulators.json.nv[1].inputs[1].value: 2870 MHz: room-temperature value
- simulators.json.nv[1].inputs[2].value: 28.025 MHz/mT: 
- simulators.json.opm[0].inputs[2].value: '~30' nT: 'typically about 30 nT wide'; whether this is the full or half width is not stated
- simulators.json.opm[1].inputs[1].value: 6.998 Hz/nT: QuSpin states 6.998 Hz per nT for its QTFM rubidium magnetometer
- simulators.json.cqd_patch[0].inputs[0].value: '440, 470, 510' nm: full text paywalled

### Upgraded or corrected from primary sources
- data/specs.json changed upgraded to VERIFIED from primary sources: opm.sensitivity_dual_axis_typical, opm.total_power, opm.electronics_size (QuSpin Gen-3 product page); nv.headline r_peak_average, sensitivity_for_single_beat_snr5, bandwidth_assumed, reference_opm_mapping, data_availability and per-build sensitivity/beats_averaged (arXiv 2601.18843 PDF)
- data/specs.json changed nv.headline.standoff NOT_STATED -> '~1 cm (JGU, ZAQuant)' from the full text pp. 4 and 6; opm.quantum_effect source moved to https://quspin.com/technology/ because the brief's URL returns HTTP 404
- data/specs.json changed space_heritage.oscar_qube mass 420 g and power 5 W sourced from the paper abstract (Crossref, CC BY 4.0); '10 months 2021-22', 'continuous-wave' and 'station interference' stay TO_CONFIRM because the APS full text returns 403
- data/specs.json changed space_heritage.swarm_asm.charlie_asm TO_CONFIRM -> VERIFIED (ESA IDEAS+ weekly reports wk45/46 2014; DTU release notes): lost 5 Nov 2014

### Feeds (latest snapshot 2026-11-15T08:21:30Z)
- NOAA L1: ok, 3.13 nT from SOLAR1 (brief URLs retired by NWS SCN 26-21; /json/rtsw/ replacement used)
- ISS position + IGRF-14: ok, 41613.2 nT
- GOES protons: not in snapshot
- ISS cabin (Lightstreamer ISSLIVE): not in snapshot
- Swarm ASM: null: VIRES_TOKEN missing

### Failures logged
- Swarm ASM failed VIRES_TOKEN missing; swarm_asm is null until the user sets the env var (free registration at vires.services)

### Simulator results
- opm / SimuFísica Bloch Equation Generator: 0 result(s): awaiting simulator run
- opm / DRCMR Bloch Simulator: 0 result(s): awaiting simulator run
- nv / ODMR-Lab: 2 result(s) (api, api)
- nv / SimOS Virtual Lab: 0 result(s): awaiting simulator run
- qd_renin / nanoHUB Quantum Dot Lab: 0 result(s): awaiting simulator run
- qd_renin / FRET-Calc: 0 result(s): awaiting simulator run
- cqd_patch / MCX Cloud: 0 result(s): awaiting simulator run
- runs so far: 2; combined sensor version 2, 54 bricks

### Still to do by a person
- Swarm ASM: register free at https://vires.services, then set the environment variable VIRES_TOKEN before starting the server (never commit it).
- Manual simulator runs (browser): SimOS Virtual Lab, SimuFísica Bloch Equation Generator, DRCMR Bloch Simulator, FRET-Calc, nanoHUB Quantum Dot Lab (free account), MCX Cloud; paste results through POST /api/simulators/{device}.
- Published data points from the paywalled renin (doi:10.1021/ac302284s) and patch (doi:10.1021/acsnano.4c06191) papers, each with figure and page.
- TO_CONFIRM items above (APS full text of the OSCAR-QUBE paper; CQD reader channels; QuSpin resonance width full vs half; ISS cabin units).
- Restart the server on port 8001 (started by Codex with the old code) so it serves the new endpoints.
- Real instruments: if one becomes available, set SPINDRIFT_INGEST_KEY and post readings to /api/sensors/{device}/ingest; until then every device shows 'No physical instrument connected'.
2026-11-15T08:27:43Z claude-code server on port 8001 changed restarted by Claude Code at the user's request: the stale process (old code) was stopped and the current server.main now runs on 8001; it writes locations.json and live_snapshot.json with the measured lunar/Mars fields, radiation and ISS cabin data
2026-11-15T08:27:43Z claude-code NOAA SWPC feeds changed GOES (and RTSW) responses arrived as the complete JSON array followed by NUL padding; the parser now ignores trailing NUL padding and records it in the VO note
2026-11-15T08:27:43Z claude-code contract/CODEX_PROMPT.md changed Codex is told to delete its current UI and build a new one from scratch, keeping only tooling (serve.py, config.json, contract.mjs, tests)
2026-11-15T08:58:37Z claude-code ui/ done new UI served at http://127.0.0.1:8001/ui/: Vitruvio-style console (own code) with a 3D body twin (Cesium Man, CC BY 4.0), six system tiles from clinical_card main, live space panel, real runs and the tower, plus four deep quantum tabs (OPM Bloch sphere, NV ODMR with live ODMR-Lab button, QD FRET and particle in a box, carbon dots), tower and sources
2026-11-15T08:58:37Z claude-code server/main.py changed serves /ui and /data as static files, / redirects to /ui/, new POST /api/simulate/odmr (one ODMR-Lab call, 8 s apart, saved to simulators.json)
2026-11-15T09:14:36Z claude-code data/lean_proofs.json done 12 theorems, 0 sorry, kernel-checked
2026-11-15T09:15:20Z claude-code data/math_checks.json done Wolfram cross-check of the 12 Lean theorems plus Eq. 7 vs exact
2026-11-15T09:15:20Z claude-code data/quantum_circuits.json done 12 Ramsey circuits, coda simulate (Aer), 4096 shots each
2026-11-15T09:16:30Z claude-code data/molecules done renin 2REN (320 C-alpha), bilirubin CID 5280352 (79 atoms)
2026-11-15T09:17:10Z claude-code data/math_checks.json done Wolfram cross-check of the 12 Lean theorems plus Eq. 7 vs exact
2026-11-15T09:17:10Z claude-code data/quantum_circuits.json done 12 Ramsey circuits, coda simulate (Aer), 4096 shots each
2026-11-15T09:57:53Z claude-code data/anatomy done HRA VH male skin+heart+lungs+kidneys+brain (+vasculature optional), 68.0 MB, body 1.824 m, mounts scalp 3x3 + chest; forearm not available
2026-11-15T09:57:53Z claude-code data/bio/asctb.json done HRA ASCT+B rows: heart 8, kidney 1, skin 34, brain 87, blood 0, bone_marrow_erythroid 3
2026-11-15T09:58:06Z claude-code data/quantum_constants.json done 87 value objects for the quantum scenes (Steck rev 2.3.4, CODATA 2022, Holloway 1991, COD graphite/diamond, Barry, Sulai, Mantina); Bloch residual 8.3e-16, Python = Wolfram
2026-11-15T09:58:08Z claude-code data/lean_proofs.json done 50 theorems (12 physics, 38 checker), 0 sorry, kernel-checked, all standard axioms: True; spindrift-check selftest pass
2026-11-15T10:01:06Z claude-code lean/ changed new SpinDrift/Checker.lean (exact Nat-fraction requirements prod lhs <= prod rhs, verdict REQUIREMENTS_MET/NOT_MET/NEED_MORE_INFORMATION) and SpinDrift/Soundness.lean (38 theorems incl. verdict_met_iff, verdict_notMet_sound, verdict_needInfo_sound, missing_never_decides; standard axioms only, 0 sorry); CLI lean_exe spindrift-check (lean/Main.lean, selftest pass); Check.lean extended; Physics.lean: unused binder h in fret_inverse renamed _h (lint warning only), lake build has 0 warnings
2026-11-15T10:01:06Z claude-code server/verdict.py done Lean-decided verdict cards for opm_brain, opm_heart, nv_heart_jgu/zaquant/qant, qd_blood, cqd_skin: Python builds exact Fraction inputs from sourced VOs and user inputs, untrusted values sent as ?, spindrift-check decides; specs.opm has no field-compensation limit so opm_field_nulled stays NEED_MORE_INFORMATION
2026-11-15T10:01:06Z claude-code server/main.py changed new POST /api/verdict (other endpoints unchanged); the server on port 8001 was not restarted and needs a restart by a person to serve it
2026-11-15T10:01:06Z claude-code scripts/build_lean.py changed parses every lean/SpinDrift/*.lean (doc-comment capture fixed), adds file/full_name/module per theorem, records checker source and binary SHA-256 and the spindrift-check selftest in data/lean_proofs.json
2026-11-15T10:01:18Z claude-code data/anatomy done HRA VH male skin+heart+lungs+kidneys+brain (+vasculature optional), 68.0 MB, body 1.824 m, mounts scalp 3x3 + chest; forearm not available
2026-11-15T10:01:18Z claude-code data/bio/asctb.json done HRA ASCT+B rows: heart 8, kidney 1, skin 34, brain 85, blood 0, bone_marrow_erythroid 3
2026-11-15T10:01:45Z claude-code data/quantum_constants.json done 106 value objects for the quantum scenes (Steck rev 2.3.4, CODATA 2022, Holloway 1991, COD graphite/diamond, Barry, Sulai, Mantina); Bloch residual 8.3e-16, Python = Wolfram
2026-11-15T10:03:45Z claude-code data/bio done genes REN/SCN5A/UGT1A1 (Ensembl 116), neuron NMO 107146 (22892 samples), Nav1.5 8VYJ (1395 C-alpha), cells.json (27 VERIFIED, 0 TO_CONFIRM, 3 NOT_YET_EXTRACTED)
2026-11-15T10:05:03Z claude-code data/anatomy done HRA VH male skin+heart+lungs+kidneys+brain (+vasculature optional), 68.0 MB, body 1.824 m, mounts scalp 3x3 + chest; forearm not available
2026-11-15T10:05:03Z claude-code data/bio/asctb.json done HRA ASCT+B rows: heart 8, kidney 1, skin 34, brain 85, blood 0, bone_marrow_erythroid 3
2026-11-15T10:12:13Z claude-code data/quantum_constants.json done 108 value objects for the quantum scenes (Steck rev 2.3.4, CODATA 2022, Holloway 1991, COD graphite/diamond, Barry, Sulai, Mantina); Bloch residual 8.3e-16, Python = Wolfram
2026-11-15T10:17:03Z claude-code data/bio done genes REN/SCN5A/UGT1A1 (Ensembl 116), neuron NMO 107146 (22892 samples), Nav1.5 8VYJ (1395 C-alpha), cells.json (16 VERIFIED, 11 TO_CONFIRM, 3 NOT_YET_EXTRACTED)
2026-11-15T10:21:49Z claude-code data/bio done genes REN/SCN5A/UGT1A1 (Ensembl 116), neuron NMO 107146 (22892 samples), Nav1.5 8VYJ (1395 C-alpha), cells.json (28 VERIFIED, 0 TO_CONFIRM, 3 NOT_YET_EXTRACTED)
2026-11-15T10:24:28Z claude-code data/bio done genes REN/SCN5A/UGT1A1 (Ensembl 116), neuron NMO 107146 (22892 samples), Nav1.5 8VYJ (1395 C-alpha), cells.json (28 VERIFIED, 0 TO_CONFIRM, 3 NOT_YET_EXTRACTED)
2026-11-15T11:17:31Z claude-code data/anatomy/manifest_female.json done HRA VH female skin+heart+lungs+kidneys+brain, 55.7 MB GLB (62.8 MB with metadata), body 1.658 m, head bbox center [-0.006828, 1.550707, -0.042721] size [0.167881, 0.214142, 0.219239] m, mounts scalp 3x3 + chest; forearm not available
2026-11-15T11:18:20Z claude-code data/anatomy/manifest.json changed added frame.head_bbox_app (male head: skin vertices above the chin; center [0.000919, 1.713449, 0.023208] size [0.195671, 0.221654, 0.242102] m) from the local GLB files, SHA256 verified; no other value changed
2026-11-15T11:19:28Z claude-code scripts/build_anatomy.py changed --sex male|female|both (female: HRA VH female skin v1.5, heart v1.3, lung v1.4, kidneys v1.3, brain v1.4 -> data/anatomy/manifest_female.json, same structure; male output unchanged, verified by a sandboxed --reuse-local rebuild: only frame.head_bbox_app is new); --head-bbox-only; frame.head_bbox_app = bbox of skin vertices above the chin point found on the skin midline profile
2026-11-15T11:19:28Z claude-code ui/anatomy.js changed loadAnatomy options sex: male|female (manifest.json or manifest_female.json) and exclude: [keys] (e.g. skin); no options = exactly as before (stubbed-three test: same fetch, same GLBs, same result keys)
2026-11-15T13:01:30Z claude-code data/quantum_constants.json done 137 value objects for the quantum scenes (Steck rev 2.3.4, CODATA 2022, Holloway 1991, COD graphite/diamond, Barry, Sulai, Mantina); Bloch residual 8.3e-16, Python = Wolfram; nuclei from the IAEA charge radii file: rb87 R = 4.1989 fm (VERIFIED), I = 1.5; n14 R = 2.5582 fm (VERIFIED), I = 1.0
2026-11-15T18:31:42Z claude-code data/locations.json done 10 places, 34 sub-places (32 VERIFIED fields, 2 not), 7 downloads with sha256, 0 source errors
2026-11-15T18:32:24Z claude-code data/locations.json done 10 places, 34 sub-places (32 VERIFIED fields, 2 not), 7 downloads with sha256, 0 source errors
2026-11-15T18:37:33Z claude-code data/locations.json changed missing or not in the places/sub_places shape at server start; rebuilding with scripts/build_locations.py
2026-11-15T18:38:08Z claude-code data/locations.json done 10 places, 34 sub-places (32 VERIFIED fields, 2 not), 7 downloads with sha256, 0 source errors
2026-11-15T19:30:49Z claude-code contract changed locations.json is now {meta, places: [{id, group, name, body, sub_places: [...]}]} (10 places, 34 sub-places, built by scripts/build_locations.py; contract v10.2): the old [{id, label, ambient_field_nT, field_kind}] list is gone and the five older location ids map to sub-places (iss -> iss.destiny, gateway -> gateway.halo, lunar_base -> moon_south_pole.shackleton_rim, mars_transit -> mars_transit.cruise, mars_surface -> mars_surface.insight); new GET /api/locations and GET /api/locations/{id}; /api/run, /api/devices/live and /api/verdict accept sub-place ids and the older ids; the verdict response gains environment; a run record gains location_id and environment
2026-11-15T19:30:49Z claude-code server/live.py changed no longer writes data/locations.json (it is built by scripts/build_locations.py and refreshed in memory by server/locations.py); new feeds: Tiangong (SGP4 on the CelesTrak TLE for NORAD 48274 + IGRF, every 60 s) and the NOAA GOES magnetometer (every 60 s); the L1 feed also carries the GSE components; ISS poll every 5 s; opm_readiness keeps its five older ids, each read from its sub-place
2026-11-15T19:31:38Z claude-code data/locations.json done 10 places, 34 sub-places (32 VERIFIED fields, 2 not), 7 downloads with sha256, 0 source errors
2026-11-15T19:35:56Z claude-code data/lean_proofs.json done 50 theorems (12 physics, 38 checker), 0 sorry, kernel-checked, all standard axioms: True; spindrift-check selftest pass
2026-11-15T19:43:11Z claude-code data/locations.json done 10 places, 34 sub-places (32 VERIFIED fields, 2 not), 7 downloads with sha256, 0 source errors
2026-11-15T19:44:21Z claude-code data/locations.json done 10 places, 34 sub-places (32 VERIFIED fields, 2 not), 7 downloads with sha256, 0 source errors
2026-11-15T19:45:45Z claude-code data/locations.json done 10 places, 34 sub-places (32 VERIFIED fields, 2 not), 7 downloads with sha256, 0 source errors
2026-11-15T19:47:47Z claude-code scripts/build_locations.py done new builder for data/locations.json (10 places, 34 sub-places); sources: wheretheiss.at + IGRF-14, CelesTrak TLEs + SGP4 (Tiangong 48274; ISS 24-h track for the SAA, high-latitude and equator passes), NOAA L1 and GOES magnetometers, CDAWeb via cdasws (latest ARTEMIS THEMIS-C FGM file; OMNI 1-min May 2024), Ravat et al. 2020 lunar grid (cross-check Tsunakawa et al. 2015), Langlais et al. 2019 Mars model, NASA/JPL rover positions, published coordinates; sha256 recorded for every download; called from build_all.py after specs
2026-11-15T19:47:47Z claude-code server/locations.py done new location engine: loads data/locations.json (keeps the last good copy if the file is rewritten in the older shape), refreshes live sub-places in memory (iss 5 s, tiangong, noaa_l1 and goes_mag 60 s), maps the five older ids to sub-places, computes opm_in_range / nv_zeeman_shift_MHz / ratio_to_earth_surface, and builds the verdict environment and the run environment
2026-11-15T19:47:47Z claude-code server/main.py changed new GET /api/locations and GET /api/locations/{id}; /api/run, /api/devices/live and /api/verdict accept sub-place ids and the five older ids (422 otherwise); POST /api/run takes optional inputs for its Lean check; GET /api/combined adds lean_summary computed from runs.json; new loops for Tiangong and the GOES magnetometer, ISS every 5 s; rebuilds data/locations.json at start if it is missing or in the older shape; /ui and /data static mounts send Cache-Control: no-cache (304 revalidation kept)
2026-11-15T19:47:47Z claude-code server/verdict.py changed the OPM ambient field is the sub-place B_total_nT (null or non-VERIFIED sent to Lean as missing); response gains environment (server/locations.environment) and location.location_id; new lean_record() for run records (deciding requirement with exact sides, holds, missing symbols, inputs; OPM shielding factor needed and NV heartbeats needed from Lean sides); module docstring no longer names the earlier pattern
2026-11-15T19:47:47Z claude-code server/runs.py changed a run record carries location_id, environment (the sub-place value objects) and lean (per sensor check: verdict, deciding requirement, conditions); environment and Lean facts are stacked onto the combined sensor (new components environment and measurability (Lean)); combined_sensor.json gains lean_summary (per check: where Lean said works / does not work / needs a number, strictest condition seen)
2026-11-15T19:47:47Z claude-code server/devices.py changed panels take the sub-place: ambient field and readiness from data/locations.json, NV line shift item, radiation context item; ISS cabin items for every iss.* sub-place
2026-11-15T19:47:47Z claude-code scripts/validate.py changed locations tests (ids and shape, source or non-VERIFIED null for |B|, no untagged numbers, OPM/NV/ratio formulas, shielding note), run Lean blocks (verdict vs holds, formulas), lean_summary ids, banned-word scan of /data and /server, and server checks when one answers (ISS position under 30 s, /api/locations, older ids, verdict environment, 422 on unknown ids, no-cache + 304 on /ui); an older server process is checked through /api/live and reported with a warning
2026-11-15T19:47:47Z claude-code build_all.py changed locations step (scripts/build_locations.py) after specs; live cycle no longer writes locations.json
2026-11-15T19:47:47Z claude-code scripts/make_fixtures.py changed locations.json fixture in the places shape (empty places)
2026-11-15T19:47:47Z claude-code scripts/build_calculated.py changed clinical card ambient field for the five older ids falls back to their sub-places in data/locations.json
2026-11-15T19:47:47Z claude-code requirements.txt changed added sgp4 2.27, cdasws 1.8.18, cdflib 1.3.16 (location engine)
2026-11-15T19:47:47Z claude-code data/runs.json changed test runs run-0005..run-0008 made on a throwaway server on port 8002 (real Kiel records and ODMR-Lab calls; 0007 and 0008 carry Lean blocks); the Lean blocks store typed inputs with the contract tag user_input, which app/contract.mjs does not list yet, so app/tests/check-data.mjs flags them (an /app change)
2026-11-15T19:51:30Z claude-code data/locations.json changed missing or not in the places/sub_places shape at server start; rebuilding with scripts/build_locations.py
2026-11-15T19:51:41Z claude-code data/locations.json done 10 places, 34 sub-places (32 VERIFIED fields, 2 not), 7 downloads with sha256, 0 source errors
2026-11-15T19:53:45Z claude-code data/locations.json done 10 places, 34 sub-places (32 VERIFIED fields, 2 not), 7 downloads with sha256, 0 source errors
2026-11-15T19:55:48Z claude-code server/verdict.py changed three optional POST /api/verdict inputs, each replacing one factor only when given and tagged user_input: brain_signal_fT (A of opm_snr_brain; default the recorded peak of recorded/opm_brain_mne.json), brain_trials (N of opm_snr_brain; default the recorded n_epochs), nv_bandwidth_hz (BW of nv_snr for all three NV builds; default specs.nv.headline.bandwidth_assumed); listed in inputs_used (value typed, or the default used) and input_units; no Lean source change
2026-11-15T19:55:48Z claude-code server/main.py changed VerdictInputs gains brain_signal_fT, brain_trials, nv_bandwidth_hz (also accepted in POST /api/run inputs); a value of these that is not a positive number (or not a whole number for brain_trials; true and strings rejected) answers 400 with a plain message; other validation errors keep the 422 answer
2026-11-15T19:55:48Z claude-code scripts/validate.py changed tests for the three optional verdict inputs: in-process with the Lean checker (each replaces exactly one factor; Lean sides equal A^2 N and snr^2 eta^2 BW), and on a running server (bad values answer 400 with a plain message; the /api/run case is sent only to a server that already rejects them on /api/verdict)
2026-11-15T19:55:48Z claude-code data/runs.json changed run-0009-3752 (iss, no inputs) was executed on the restarted port-8001 server by a validate.py check that expected a 400: that server predates the optional inputs and ignored the bad value; the check is now guarded so it cannot run against such a server
2026-11-15T19:56:06Z claude-code data/quantum_constants.json done 179 value objects for the quantum scenes (Steck rev 2.3.4, CODATA 2022, Holloway 1991, COD graphite/diamond, Barry, Sulai, Mantina); Bloch residual 8.3e-16, Python = Wolfram; nuclei from the IAEA charge radii file: rb87 R = 4.1989 fm (VERIFIED), I = 1.5; n14 R = 2.5582 fm (VERIFIED), I = 1.0
2026-11-15T19:57:02Z claude-code data/quantum_constants.json done 179 value objects for the quantum scenes (Steck rev 2.3.4, CODATA 2022, Holloway 1991, COD graphite/diamond, Barry, Sulai, Mantina); Bloch residual 8.3e-16, Python = Wolfram; nuclei from the IAEA charge radii file: rb87 R = 4.1989 fm (VERIFIED), I = 1.5; n14 R = 2.5582 fm (VERIFIED), I = 1.0
2026-11-15T21:34:38Z claude-code .gitignore changed data/literature/raw/ ignored: the raw literature cache is 23.6 MB, above 20 MB
2026-11-15T22:05:34Z claude-code data/literature/opm.json done 2741 unique paper records (1622 arXiv API, 1119 PubMed E-utilities, 194 merged by DOI) from 13 queries, raw responses gzip-cached with SHA-256 in data/literature/raw; values only from the device's own paper arXiv:2408.02941: 3 values with paper id and exact sentence in 3 of 9 parameters, 6 NOT_FOUND; 189 matches in other papers counted, not written
2026-11-15T22:05:47Z claude-code data/literature/nv.json done 3778 unique paper records (3298 arXiv API, 480 PubMed E-utilities, 279 merged by DOI) from 9 queries, raw responses gzip-cached with SHA-256 in data/literature/raw; values only from the device's own paper arXiv:2601.18843: 14 values with paper id and exact sentence in 9 of 11 parameters, 2 NOT_FOUND; 187 matches in other papers counted, not written
2026-11-15T22:06:04Z claude-code data/literature/qd.json done 5628 unique paper records (996 arXiv API, 4632 PubMed E-utilities, 19 merged by DOI) from 18 queries, raw responses gzip-cached with SHA-256 in data/literature/raw; values only from the device's own paper PMID:23003565: 1 values with paper id and exact sentence in 1 of 11 parameters, 10 NOT_FOUND; 836 matches in other papers counted, not written
2026-11-15T22:06:35Z claude-code data/literature/cqd.json done 10127 unique paper records (322 arXiv API, 9805 PubMed E-utilities, 2 merged by DOI) from 17 queries, raw responses gzip-cached with SHA-256 in data/literature/raw; values only from the device's own paper PMID:39356285: 9 values with paper id and exact sentence in 6 of 25 parameters, 19 NOT_FOUND; 2736 matches in other papers counted, not written
2026-11-15T22:09:00Z claude-code data/literature/opm.json done 2741 unique paper records (1622 arXiv API, 1119 PubMed E-utilities, 194 merged by DOI) from 13 queries, raw responses gzip-cached with SHA-256 in data/literature/raw; values only from the device's own paper arXiv:2408.02941: 3 values with paper id and exact sentence in 3 of 9 parameters, 6 NOT_FOUND; 189 matches in other papers counted, not written
2026-11-15T22:09:11Z claude-code data/literature/nv.json done 3778 unique paper records (3298 arXiv API, 480 PubMed E-utilities, 279 merged by DOI) from 9 queries, raw responses gzip-cached with SHA-256 in data/literature/raw; values only from the device's own paper arXiv:2601.18843: 14 values with paper id and exact sentence in 9 of 11 parameters, 2 NOT_FOUND; 187 matches in other papers counted, not written
2026-11-15T22:09:34Z claude-code data/literature/qd.json done 5628 unique paper records (996 arXiv API, 4632 PubMed E-utilities, 19 merged by DOI) from 18 queries, raw responses gzip-cached with SHA-256 in data/literature/raw; values only from the device's own paper PMID:23003565: 1 values with paper id and exact sentence in 1 of 11 parameters, 10 NOT_FOUND; 836 matches in other papers counted, not written
2026-11-15T22:10:09Z claude-code data/literature/cqd.json done 10127 unique paper records (322 arXiv API, 9805 PubMed E-utilities, 2 merged by DOI) from 17 queries, raw responses gzip-cached with SHA-256 in data/literature/raw; values only from the device's own paper PMID:39356285: 9 values with paper id and exact sentence in 6 of 25 parameters, 19 NOT_FOUND; 2736 matches in other papers counted, not written
