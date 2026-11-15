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
