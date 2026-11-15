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
