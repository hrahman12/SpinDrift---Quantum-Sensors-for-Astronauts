## Shared contract v10 (identical in the Claude Code and Codex prompts; change it only by logging the change in /STATUS.md first)

Layout: `/data` and `/server` belong to Claude Code. `/app` belongs to Codex. `/contract/schema.md` holds this section word for word. `/STATUS.md` is a shared log: both agents append one line per change, formatted `<ISO time> <agent> <file or feed> <done|failed|changed> <note>`. Neither agent edits the other's folders.

### Value object (VO): used for every number or fact
`{ "value": number | string | null, "unit": string, "source": string, "tag": "live" | "near_live" | "recorded" | "datasheet" | "published_spec" | "calculated" | "simulated" | "user_input", "status": "VERIFIED" | "NOT_STATED" | "NOT_YET_EXTRACTED" | "TO_CONFIRM", "as_of": ISO-8601 | null, "note": string | null }`
- `value` is null when status is NOT_STATED or NOT_YET_EXTRACTED. TO_CONFIRM may carry a value that still has to be checked against the primary source.
- `as_of` is required for live and near_live (the time of the measurement, not of the fetch). For recorded, it is the recording date if known.
- For calculated, `note` holds the formula and the ids of its inputs.
- Display text: NOT_STATED = "unspecified in source". NOT_YET_EXTRACTED = "not yet extracted". TO_CONFIRM = the value plus a "to confirm" chip.

Every `/data` JSON file has `"meta": { "fixture": bool, "generated_at": ISO-8601, "sources": [string] }`.

### /data files
1. `specs.json`: `{ "opm": {key: VO}, "nv": { "headline": {key: VO}, "jgu": {key: VO}, "zaquant": {key: VO}, "qant": {key: VO} }, "qd_renin": {key: VO}, "cqd_patch": {key: VO}, "space_heritage": { "oscar_qube": {key: VO}, "swarm_asm": {key: VO} } }`
2. `locations.json`: `[ { "id": "iss" | "gateway" | "lunar_base" | "mars_transit" | "mars_surface", "label": string, "ambient_field_nT": VO, "field_kind": "live_feed" | "model" | "published" | "none" } ]`
3. `recorded/<id>.json`: `{ "meta": { ..., "dataset": string, "doi_or_url": string, "licence": string, "accessed": ISO-8601, "device_type": "opm" | "nv" | "qd" | "cqd", "label": string }, "x": { "name": string, "unit": string, "values": [number] }, "series": [ { "name": string, "unit": string, "values": [number] } ] }`
   Required ids: `opm_brain_mne`, `opm_heart_kiel`, `nv_odmr_zenodo10629041`, `qd_fret_figshare5468838`, `cqd_pl_mendeley_cmfbrvrb8y`.
4. `nv_heart_derived.json`: `{ "recorded_id": "opm_heart_kiel", "channel": string, "averaged_beat": { "t_s": [number], "pT": [number], "beats_averaged": VO, "r_peak_pT": VO }, "per_build": { "jgu" | "zaquant" | "qant": { "noise_density": VO, "single_beat_noise_pT": VO, "averaged_noise_pT": VO, "single_beat_snr": VO, "averaged_snr": VO, "averaged_snr_measured_peak": VO } } }`
5. `physics.json`: `{ "<curve id>": { "plotted": bool, "x": [number], "y": [number], "x_label": string, "y_label": string, "equation": string, "inputs": [VO], "missing_inputs": [string] } }`. Curve ids: `nv_odmr_lines`, `opm_zero_field`, `qd_fret_vs_distance`, `cqd_quenching`.
6. `nasa_i4.json`: `{ "datasets": [ { "accession": string, "title": string, "url": string, "variables": [ { "name": string, "unit": string, "points": [ { "timepoint": string, "value": VO } ] } ] } ], "not_found": [string] }`
7. `published_points.json`: `{ "qd_renin": { "status": "awaiting" | "loaded", "points": [ { "x": VO, "y": VO, "figure": string, "page": string } ] }, "cqd_patch": { same shape } }`
8. `hrp.json`: `{ "hazards": [ { "text": string, "source": string } ] }`, verbatim quotes only.
9. `simulators.json`: `{ "opm" | "nv" | "qd_renin" | "cqd_patch": [ { "tool": string, "url": string, "access": "browser" | "browser_and_api", "account_needed": bool | null, "models": string, "limits": string, "inputs": [ { "name": string, "value": VO, "origin": "spindrift_source" | "app_default" } ], "missing_inputs": [string], "results": [ { "run_at": ISO-8601, "via": "api" | "pasted", "outputs": object } ] } ] }`
10. `clinical_card.json`: `{ "<location id>": { "rows": [ { "label": string, "reading": VO, "evidence": "SOURCED" | "EARTH_ONLY" | "TO_CONFIRM", "review_note": string } ] } }`. Crew role is a display label only; it changes no numbers.
11. `build_log.json`: `{ "per_sensor": { "opm" | "nv" | "qd_renin" | "cqd_patch": [ { "fact": string, "value": VO } ] }, "combined": [ { "fact": string, "value": VO } ] }`
12. `live_snapshot.json`: the last good response of `GET /api/live`, for offline fallback.

### /server (FastAPI at http://localhost:8000, CORS open for localhost)
- `GET /api/live` returns `{ "fetched_at": ISO-8601, "iss": { "lat": VO, "lon": VO, "alt_km": VO, "velocity_kmh": VO, "b_total_nT": VO, "igrf_generation": string } | null, "l1": { "bt_nT": VO, "bx_gsm_nT": VO, "by_gsm_nT": VO, "bz_gsm_nT": VO, "spacecraft": string | null } | null, "swarm_asm": { "f_nT": VO, "satellite": string, "lat": VO, "lon": VO, "alt_km": VO } | null, "iss_cabin": [ { "name": string, "reading": VO } ] | null, "opm_readiness": { "<location id>": { "ambient_nT": VO, "opm_range_nT": VO, "shielding_factor": VO, "within_range": bool | null } }, "errors": [string] }`
- `GET /api/stream/{recorded_id}` is Server-Sent Events. Each event is `{ "x": [number], "series": [ { "name": string, "values": [number] } ], "unit": string, "dataset": string, "tag": "recorded" }`, paced at the recording's own sample rate and looping.
- `POST /api/simulators/{device}` with `{ "tool": string, "inputs_used": object, "outputs": object }` appends a result with `via: "pasted"` to `simulators.json` and returns the updated entry.
- `GET /api/health` returns `{ "ok": bool, "feeds": { "<feed>": "ok" | "stale" | "error" } }`.

### Runs and the combined sensor (added v10.1)
13. `runs.json`: `{ "runs": [ { "run_id": string, "started_at": ISO-8601, "location": string, "role": string, "inputs": { "opm" | "nv" | "qd_renin" | "cqd_patch": [VO] }, "outputs": { same keys: [VO] }, "links": [ { "from": device, "to": device, "fact": string, "value": VO } ], "adds_to_combined": [ { "component": string, "fact": string, "value": VO } ] } ] }`
14. `combined_sensor.json`: `{ "version": int, "runs_counted": int, "components": { "<component>": { "facts": [ { "fact": string, "value": VO, "from_run": string } ], "status": "sourced" | "open" } }, "open_questions": [string] }`. It only grows: each run appends facts, never invents them.
- `POST /api/run` with `{ "location": string, "role": string }` executes one run (Section 8 of the Claude Code prompt) and returns the new run plus the updated combined sensor.
- `GET /api/combined` returns `combined_sensor.json`.

### Parallel rule
Claude Code commits fixtures for every file, plus a stub server that serves them, before anything else. Fixtures contain no numbers: empty arrays, `value: null`, status NOT_YET_EXTRACTED, `meta.fixture: true`. Codex builds against the fixtures immediately and never hard-codes a number; Codex may keep test-only data in `/app/tests`, never loaded by the app. Real outputs replace the fixtures with the same shape, so the app needs no code change.

### Footer (exact text)
"Live: space magnetic-field feeds (NOAA L1 magnetometer; ISS position with the IGRF model). Near-live: an optically pumped magnetometer in orbit (ESA Swarm). Recorded: real OPM brain and heart data, NV, quantum-dot and carbon-dot lab data, and Inspiration4 astronaut lab data from NASA OSDR. Simulated: online simulators, labelled. No public live feed exists from these sensors on a human in space. Not diagnostic."
