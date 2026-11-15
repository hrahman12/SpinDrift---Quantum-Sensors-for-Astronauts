# AI Disclosure Statement

SpinDrift was developed during the NASA Space Apps Challenge 2026 (Nov 14–15). AI tools (Claude, Codex, Gemini) were used for data pipeline code, frontend code, research synthesis and drafting. Scientific claims trace to peer-reviewed publications and NASA open datasets. Sensor designs (OPM magnetocardiography, OPM-MEG helmets, NV-diamond relaxometry) are based on demonstrated hardware. Environment-specific thresholds are prototype values, not clinically validated.

---

## Hardware & Dataset Traceability Reference

- **CHEST — QuSpin QZFM OPM:** ⁸⁷Rb vapor cell, `<15 fT/√Hz`, domino-sized. Alternative: NV-diamond cardiac magnetometer (`12 mm` head, `6–26 pT/√Hz`, measured real human hearts, arXiv `2601.18843`, Jan 2026).
- **HEAD — Miniaturized OPM-MEG helmet:** `12 × 16.5 × 22.5 mm` per sensor, `<7 fT/√Hz`, `130 Hz` bandwidth, `0.7 W` per head; `49–128` channels (FieldLine HEDscan class); wearable.
- **FINGER — NV-diamond T₁ relaxometry:** `532 nm` excitation, `637–800 nm` readout, ROS sensitivity `5.3 × 10⁻¹³ M/√Hz`; demonstrated in living cardiomyocytes.
- **Data Sources:** NASA OSDR (`OSD-580` heart transcriptomics, `OSD-352` hippocampus multiomics, `Inspiration4` multi-omics), OpenNeuro `ds004902` (71-subject sleep-deprivation EEG, CC0), and published astronaut physiology (renin rise, plasma volume loss, retinal thickening / SANS).
- **Threshold Status:** Prototype hackathon thresholds only — not clinically validated.
