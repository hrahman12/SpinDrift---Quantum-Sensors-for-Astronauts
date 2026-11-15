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
