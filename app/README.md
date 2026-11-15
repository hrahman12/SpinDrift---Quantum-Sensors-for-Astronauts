# SpinDrift fresh interface

Run `python app/serve.py` from the repository root and open http://localhost:8080/app/. No frontend dependencies or build step are needed.

The separate data-owner server starts with `uvicorn server.main:app --port 8000`. Configure its address in `app/config.json`. Hosted HTTPS deployments require an HTTPS backend and appropriate CORS. The frontend does not implement or impersonate the backend.

Only contract-valid v10 data is rendered. Both the logged `{meta, locations}` wrapper and original locations array are supported. Legacy JSON is never used as an alternative source. Every sourced reading has a tag and expandable provenance. Unknowns remain empty. Live readings show measurement age and stale status. Fixture and offline banners remain visible.

The backend supplies actual simulator definitions, results, connected runs, specifications, recordings and terrain data. External NASA terrain/archive links and the QuTiP link are source navigation, not executed simulations or integrated terrain measurements. Paste-back outputs require value objects tagged `simulated`. No local signal generator is present.

Run `node --test app/tests/contract.test.mjs` for unit checks and `node app/tests/check-data.mjs` for integration validation. Integration scans every JSON under `/data`, including legacy files, and `/api/live`; obsolete contracts and unavailable services intentionally fail loudly. Test values are never imported by the app.

The required footer describes intended source categories; individual panels and the connection report identify actual availability.


Live-only instrument mode excludes archived recordings from the sensor measurement panels. See `LIVE_INSTRUMENT_CONTRACT.md` for the required physical instrument feed. Research specifications, NASA archives and simulations remain explicitly separate. The CSV reference library supplies attributed Z-Anatomy assets; provenance and reuse details are in `research/REUSE.md`.


The spatial workbench now includes a large interactive anatomy view with source-derived anatomical pins, orbit/zoom, target focus, and anatomy/skeleton/surface layers. Separate viewers load original NASA ISS, Curiosity and LRO Moon models, plus the manufacturer-provided QuSpin mechanical mockup. Viewers support drag and keyboard arrow/+/- controls. The current local session config uses backend port 8001 because port 8000 was occupied by a non-API service; changing `serverUrl` restores another deployment address.
