# Competitor review (68 entries in competitor_websites.csv), 2026-11-15

Three reviewers each checked a third of the list: the live site (WebFetch or a browser tab) and the repo README. Sign-in walls, PIN screens and forms were not used. Granularity scored 0-5 on distinct signals, per-organ detail, units and thresholds, real cited data, hardware specs, simulation depth and visual quality.

## Most granular entries
| Entry | Score | Data | What makes it granular |
|---|---|---|---|
| Vista (vista-health.vercel.app) | 5 | crew synthetic; environment real | 15 self-checks with units and 4-level status, 3D anatomy, JPL-based light delay, live DONKI, 119-entry library |
| Astronaut Health Intelligence Platform (lucaspalharesbarbosa.github.io/...) | 4.5 | vitals simulated; Inspiration4 panels real, SHA-256 per file | Z-Anatomy 3D model, personal baselines with forecast bands, scenario clock, FHIR export |
| Space6ix (space6ix-health-monitor.vercel.app) | 4.5 | crew simulated; OSDR + RadLab panel real | spaceflight-specific signals, 4 OSDR studies, ISS/CRaTER/MSL-RAD dosimetry, "Demo parameter" tags |
| PROHOR (prohor-rho.vercel.app) | 4.5 | OSD-575 real; baseline demo synthetic (labelled) | all 531 OSD-575 values with ranges, change from pre-flight median, CSV row and hash, "What this does not tell us" |
| HELIOS (hel-ios.vercel.app) | 4.5 | synthetic 10 Hz telemetry, OSDR-cited baselines | 3D twin view modes, organ callouts, ECG/pleth at 25 mm/s, cabin life support, suit HUD |
| ASTRA (astra-lac-nu.vercel.app) | 4.5 (README) | mixed: Inspiration4, OSDR EDA, Horizons, DONKI real; crew seeded | 14 indicators vs NASA-STD-3001 and z-scores, BodyParts3D, "Ship Sense" |
| Crew Health Console, Vitruvio, Sol Health, Astrobalance, AstroVitals, AURA-EIMO, Crew Health Monitor, Health Signal, AstroPulse (Space Monkeys) | 4 | mostly simulated crews with real references | cited limits, device imports, storm replays, provenance labels (Replay/Sim/Model/Computed), validated phone-camera pulse |

## What every strong entry shares (SpinDrift avoids all of it)
3D body twins; vitals tile grids with traffic-light scores; personal baselines and forecast cones; Inspiration4 blood-panel explorers; NOAA/DONKI space-weather chips; Earth-Mars light delay; solar-storm replays; ECG-paper oscilloscope traces (often synthetic); suit HUDs; self-check forms, triage and AI assistants; dark mission-control styling.

## What none of them has
Quantum sensors. No entry shows quantum physics, real magnetic heart or brain recordings from real OPMs, real NV or quantum-dot lab spectra, real online quantum-simulator runs, full sensor hardware specs, or a design that grows with every run. Every crew in every entry is synthetic or seeded; the strongest label it.

## Practices worth keeping (compatible with real data only)
- A source line on every reading, with the dataset checksum where one exists.
- The formula behind every calculated number, on hover.
- Honest empty states: "awaiting simulator run", "not yet extracted", "No physical instrument connected".
- Freshness stamps on live values (as_of, age, stale badge), and feed outages shown as technical notices, not health alerts.
- Say what a number cannot tell you (each main-card row's review note).
