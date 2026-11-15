# CSV references actually used

The user-provided `competitor_websites.csv` is imported into the searchable in-app reference library. Descriptions are reference material, not evidence that any service exposes a real instrument feed.

## Astronaut Health Intelligence Platform

Source: https://github.com/lucaspalharesbarbosa/astronaut-health-intelligence-platform

Reused assets: `integumentary.glb`, `skeletal.glb`, `cardiovascular.glb`, `nervous.glb`, their original `manifest.json`, and full `LICENSE.md` from `frontend/web/public/anatomy/` on the repository's master branch.

The anatomy is an AHI adaptation of Z-Anatomy / BodyParts3D. These assets remain CC BY-SA 4.0, with original authors, upstream exclusions and modification history preserved in `app/assets/anatomy/LICENSE.md`. SpinDrift changes presentation materials, transparency and selection highlighting at runtime; no anatomical mesh geometry is changed. This is reference anatomy, not a scan of the crew. No AHI simulated telemetry or clinical logic is imported.

## VITRUVIO

Source: https://github.com/Edalenp/NASA-SPACEAPPS-CHALLENGE-2026

Used as an interface reference for selecting body regions alongside mission context and evidence panels. SpinDrift implements its own UI; no VITRUVIO code, model or clinical scoring is copied.

## Habitat Health Monitor

Source: https://github.com/alefnsc/habitat-health-monitor

Reviewed its documented separation of physical nodes, recorded replays, synthetic demos and delayed cloud sync. SpinDrift's live instrument gate independently enforces that distinction. Its Arduino/ESP8266 hobby nodes are not substitutes for SpinDrift's quantum sensors. No hardware connection, code reuse or performance validation is claimed.

## Other entries

All valid web entries are available in the searchable reference library. Their hardware, data and licence claims remain unverified unless separately documented. Listing a project is not an endorsement or an integrated service.

## Rendering dependency

Three.js is vendored under its MIT licence in `app/vendor/three/LICENSE`. The model viewer, loader, orbit controls and meshopt decoder are bundled locally so the anatomy does not depend on a runtime CDN request.


## Spatial interface revision

The cinematic anatomy-plus-context arrangement is inspired by the VITRUVIO interface. Its procedural cabins are not imported: those cabins are illustrative and cannot establish real habitat geometry. SpinDrift uses documented NASA imagery instead, explicitly as a recorded backdrop, with separate original NASA model viewers. The anatomy controls, ray picking and camera focus are implemented locally using the actual mesh names and atlas centres.

Additional original assets: NASA ISS model (NASA/Michael D. Carbajal), NASA VTAD Curiosity model, and the NASA Goddard LRO Moon colour-map model. NASA sources: https://science.nasa.gov/3d-resources/international-space-station-iss-b/ ; https://science.nasa.gov/resource/curiosity-3d-model/ ; https://svs.gsfc.nasa.gov/14959/ . The selected Moon model is colour only; no local elevation or terrain mesh is claimed. Model size and camera orientation in the viewers are presentation choices, not measurement outputs or current mission poses. NASA usage information: https://www.nasa.gov/nasa-brand-center/images-and-media/ .

QuSpin manufacturer reference: Gen 3.0 Mockup.stl from the public manufacturer download linked at https://quspin.com/qzfm-dimensions/ . The file is kept as a local mechanical reference; the source does not specify an open redistribution licence, so it is not relicensed here. No model for the other sensor builds is invented.
