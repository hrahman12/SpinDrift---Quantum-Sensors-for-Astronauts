# SpinDrift — Quantum Sensors for Astronauts

[Open the live dashboard](https://spindrift-quantum-sensors.vercel.app)

A single-file Three.js frontend exploring cardiac, neural, and oxidative-stress monitoring across ten space environments.

## Run locally

```sh
python -m http.server 8000
```

Open http://localhost:8000. Three.js and fonts require internet access. Optional physiology JSON files can be placed in `data/`; otherwise the interface uses labeled illustrative readings. Schema notes are included at the top of `index.html`.

## Deploy

Hosted on Vercel and connected to this GitHub repository. Updates to `main` deploy automatically.

Research prototype: no live sensors connected. Simulated physiology, unvalidated thresholds, and conceptual space-performance multipliers are labeled. Not for clinical or operational decisions.
