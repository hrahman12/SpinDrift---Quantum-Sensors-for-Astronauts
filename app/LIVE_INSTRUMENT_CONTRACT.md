# Live instrument connection

The UI polls the configured server's `/api/sensors/live`. This is a requested integration, not a claim that the data-owner server implements it. No frontend device emulator is provided.

Return a `sensors` object keyed by `opm`, `nv`, `qd_renin`, and `cqd_patch`. Each entry requires:

- `device`: the corresponding key.
- `connected`: true only while the physical instrument is connected.
- `instrument_id`: the actual instrument identifier; hardware provenance must be maintained by the server.
- `location`: a mission location ID matching the selected mission.
- `readings`: an object of v10 value objects, each with `tag: live`, `status: VERIFIED`, a measurement timestamp with timezone, a source, and a unit.

The frontend excludes simulated, calculated, near-live, recorded, unverified, missing, wrong-location and stale values. Its instrument freshness limit is an application policy in `config.json`, not a hardware performance specification. Hardware authentication and source verification must be enforced by the data server; a JSON label alone does not establish instrument authenticity.

Real instrument access, transport adapters, authentication, calibration records and measurement timestamps are needed before this can operate. Environmental feeds must never be substituted for physiological signals.

The simulator directory lists real developer-maintained research software and explicitly states where a device-specific model is missing. Launching a solver is not evidence that a sensor simulation ran. No live measurement is derived from those links.
