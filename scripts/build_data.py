"""
Build the SpinDrift data files in ../data/.

Outputs
  data/environments.json   10 environments, array format read by index.html
                           ({id, field, g, comms, crew, risk} plus rich fields)
  data/nasa_hazards.json   NASA HRP hazards and risks, research topics, CSA radiation
                           and ISS research notes (sourced from the pages listed below)
  data/sensor_specs.json   QuSpin QZFM, OPM-MEG helmet and NV-diamond specs with status
  data/heart_data.json     placeholder: OSD-580 gene values NOT yet downloaded
  data/brain_data.json     placeholder: OSD-352 and ds004902 values NOT yet computed
  data/ras_data.json       placeholder: RAS values NOT yet sourced

Nothing is invented: any value without a source in this script is written as null.
Run:  python scripts/build_data.py
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data"
OUT.mkdir(exist_ok=True)

SOURCES = {
    "nasa_hazards": {"url": "https://www.nasa.gov/hrp/hazards/", "updated": "2026-06-12"},
    "nasa_risks": {"url": "https://www.nasa.gov/hrp/risks/", "updated": "2026-07-21"},
    "nasa_research": {"url": "https://www.nasa.gov/hrp/ongoing-hrp-research/", "updated": "2026-08-18"},
    "csa_radiation": {"url": "https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp", "updated": "2026-02-26"},
    "csa_why_science": {"url": "https://www.asc-csa.gc.ca/eng/iss/science/why-do-we-conduct-science-experiments-in-space.asp", "updated": "2025-10-28"},
}

# ---------------------------------------------------------------- NASA / CSA
NASA_HAZARDS = [
    {"id": "space_radiation", "name": "Space Radiation",
     "detail": "Radiation exposure during spaceflight.",
     "source": "nasa_hazards"},
    {"id": "isolation_confinement", "name": "Isolation and Confinement",
     "detail": "Behavioral responses in small groups over long periods.",
     "source": "nasa_hazards"},
    {"id": "distance_from_earth", "name": "Distance from Earth",
     "detail": "Resupply, supplies and medical care get harder to receive as distance grows.",
     "source": "nasa_hazards"},
    {"id": "gravity_fields", "name": "Gravity Fields",
     "detail": "Muscles, bones, inner ear and organs adapt to changing gravity.",
     "source": "nasa_hazards"},
    {"id": "hostile_closed_env", "name": "Hostile / Closed Environments",
     "detail": "Temperature, pressure, lighting, noise, microbes and immune responses.",
     "source": "nasa_hazards"},
]

NASA_HAZARD_FACTS = [
    {"fact": "Mars is on average 140 million miles from Earth.", "source": "nasa_hazards"},
    {"fact": "A Mars trip would take roughly three years, versus a three-day lunar trip.", "source": "nasa_hazards"},
    {"fact": "On Mars, astronauts would live in three-eighths of Earth's gravity for up to two years.", "source": "nasa_hazards"},
]

NASA_RISKS = {
    "human_physiology": [
        "Altered Immune System Responses",
        "Altered Sensorimotor and Vestibular Function",
        "Cardiovascular Adaptations",
        "Decompression Sickness",
        "Host-Microorganism Interactions",
        "Hypoxia",
        "Inadequate Food and Nutrition",
        "Injury and Compromised Performance from Spacewalks",
        "Reduced Cardiorespiratory and Musculoskeletal Fitness",
        "Spaceflight Associated Neuro-ocular Syndrome (SANS)",
        "Spaceflight-Induced Bone Changes",
    ],
    "behavioral_performance_human_factors": [
        "Behavioral Changes and Psychiatric Disorders",
        "Inadequate Teamwork",
        "Inadequate Sleep and Irregular Schedules",
        "Inadequate Systems Operations Support",
        "Injury from Dynamic Loads",
    ],
    "space_radiation": [
        "Radiation-Induced Cancers",
    ],
    "source": "nasa_risks",
    "notes": [
        "NASA's page caption calls Visual Impairment Intracranial Pressure (VIIP) Syndrome "
        "'currently NASA's leading spaceflight-related health risk' (identified 2005).",
    ],
}

NASA_RESEARCH = {
    "artemis_ii": ["ARCHeR (well-being, activity, sleep)",
                   "Immune Biomarkers (blood and saliva)",
                   "Artemis II Standard Measures (shared health data bank)"],
    "low_earth_orbit": ["B-Complex (daily B vitamin for brain and eye changes)",
                        "Brain Fluid Pressure",
                        "CIPHER (multi-body-system studies)",
                        "Simulating Manual Piloting for Moon Landings",
                        "Spacecraft Occupant Protection (re-entry discomfort and sensor data)",
                        "Spinal Fluid Biomarkers",
                        "Standard Measures",
                        "Thigh Cuff (fluid in legs and eye disorders)",
                        "Venous Haemostasis",
                        "Zero T2 (exercise without a treadmill)"],
    "past_investigations": ["Altered Immunity", "Food Acceptability", "Food Physiology",
                            "Omics Archive", "Space Gardening (isolation)", "Spinal Health",
                            "Tempus Pro (telemedicine device)",
                            "Veggie Monitoring (microbes on crop hardware)"],
    "notes": ["VEG-04 botany study harvested plants after 28 days of growth (photo caption)."],
    "source": "nasa_research",
}

CSA = {
    "neutron_radiation": {
        "finding": "Neutron radiation contributes about 30% of total radiation on the ISS "
                   "and is described as especially harmful because it can cause serious biological damage.",
        "instrument": "CANS (Canadian Active Neutron Spectrometer), a compact autonomous neutron instrument",
        "contract": "CSA contract of $5.5 million to Bubble Technology Industries for CANS development",
        "predecessors": ["bubble detectors", "MOSFET", "EVARM", "Radi-N", "Radi-N2"],
        "earth_applications": ["cancer therapy", "aircrew radiation protection",
                               "nuclear threat detection", "public safety"],
        "source": "csa_radiation",
    },
    "iss_science": {
        "purpose": ["Prepare for deep-space destinations: identify, characterize and mitigate effects on astronaut health",
                    "Improve quality of life on Earth"],
        "moon_mars_risks": ["more weightlessness", "more radiation exposure", "longer isolation",
                            "communication delays", "less reliance on Earth for food, materials and emergency medical help"],
        "earth_benefits": ["balance problems (such as in seniors)", "osteoporosis",
                           "cardiovascular disorders", "Type-2 diabetes"],
        "experiments_on_iss_at_any_time": 200,
        "note": "Six months in space gives data that would take years to gather on Earth.",
        "source": "csa_why_science",
    },
}

# ---------------------------------------------------------- environments
# Europa correction: Jupiter's field at Europa is ~400 nT (0.4 uT), NOT 420 uT.
# Its ambient field is weaker than Earth's surface (~50 uT); the constraints there are
# radiation, shielding, pressure, and comms delay.
# Gain figures (150x, 1500x) are illustrative estimates, not measured values.
ENVIRONMENTS = [
    {"id": "iss", "era": "today", "name": "International Space Station", "type": "station",
     "orbit": "LEO ~408 km", "field_uT": 50, "g": 0.0, "comms_s": 0.13, "crew": 7,
     "risk": "Radiation, bone and muscle loss, fluid shift, SANS",
     "nasa_hazards": ["space_radiation", "gravity_fields", "hostile_closed_env"],
     "heart_opm": {"mode": "scalar", "sensitivity_fT": 15, "shielding_required": True, "status": "OPERATIONAL — EARTH-LIMITED"},
     "brain_meg": {"mode": "scalar", "sensitivity_fT": 7, "shielding_required": True, "status": "OPERATIONAL — REQUIRES PORTABLE SHIELD"},
     "finger_nv": {"mode": "standard", "status": "OPERATIONAL — BASELINE"}},
    {"id": "tiangong", "era": "today", "name": "Tiangong Space Station", "type": "station",
     "orbit": "LEO ~389 km", "field_uT": 50, "g": 0.0, "comms_s": 0.13, "crew": 3,
     "risk": "Same LEO profile as ISS", "nasa_hazards": ["space_radiation", "gravity_fields"],
     "heart_opm": {"mode": "scalar", "sensitivity_fT": 15, "shielding_required": True, "status": "OPERATIONAL — EARTH-LIMITED"},
     "brain_meg": {"mode": "scalar", "sensitivity_fT": 7, "shielding_required": True, "status": "OPERATIONAL — REQUIRES PORTABLE SHIELD"},
     "finger_nv": {"mode": "standard", "status": "OPERATIONAL — BASELINE"}},
    {"id": "crew_dragon", "era": "today", "name": "SpaceX Crew Dragon", "type": "capsule",
     "orbit": "LEO to ~1400 km (Polaris Dawn)", "field_uT": 50, "g": 0.0, "comms_s": 0.13, "crew": 4,
     "risk": "Motion sickness, short duration, higher radiation at ~1400 km",
     "nasa_hazards": ["space_radiation"],
     "heart_opm": {"mode": "scalar", "sensitivity_fT": 15, "shielding_required": True, "status": "OPERATIONAL — EARTH-LIMITED"},
     "brain_meg": {"mode": "scalar", "sensitivity_fT": 7, "shielding_required": True, "status": "OPERATIONAL — COMPACT CONFIG ONLY"},
     "finger_nv": {"mode": "standard", "status": "OPERATIONAL — BASELINE"}},
    {"id": "orion", "era": "today", "name": "Orion / Artemis", "type": "capsule",
     "orbit": "Cislunar / NRHO", "field_uT": 0.2, "g": 0.0, "comms_s": 1.3, "crew": 4,
     "risk": "Deep-space radiation, isolation",
     "nasa_hazards": ["space_radiation", "isolation_confinement", "distance_from_earth"],
     "heart_opm": {"mode": "near-SERF", "sensitivity_fT": 2, "shielding_required": False, "status": "ENHANCED — APPROACHING SERF"},
     "brain_meg": {"mode": "near-SERF", "sensitivity_fT": 1.5, "shielding_required": False, "status": "ENHANCED — SHIELDING OPTIONAL"},
     "finger_nv": {"mode": "shifted", "status": "CALIBRATING — NOVEL REGIME"}},
    {"id": "gateway", "era": "today", "name": "Lunar Gateway", "type": "station",
     "orbit": "NRHO around Moon", "field_uT": 0.1, "g": 0.0, "comms_s": 1.3, "crew": 4,
     "risk": "Radiation outside magnetosphere, limited supplies",
     "nasa_hazards": ["space_radiation", "distance_from_earth"], "note": "UNDER CONSTRUCTION — planned 2028+",
     "heart_opm": {"mode": "near-SERF", "sensitivity_fT": 1.5, "shielding_required": False, "status": "ENHANCED — NEAR-SERF ACTIVE"},
     "brain_meg": {"mode": "near-SERF", "sensitivity_fT": 1, "shielding_required": False, "status": "ENHANCED — NO SHIELDING NEEDED"},
     "finger_nv": {"mode": "shifted", "status": "SHIFTED BASELINE — ENHANCED"}},
    {"id": "lunar_base", "era": "tomorrow", "name": "Artemis Base Camp", "type": "surface_habitat",
     "location": "Shackleton Crater rim, lunar south pole", "field_uT": 0.0003, "g": 0.16, "comms_s": 1.3, "crew": 4,
     "risk": "Lunar dust toxicity, 1/6 g bone and muscle, radiation, thermal extremes",
     "nasa_hazards": ["space_radiation", "gravity_fields", "hostile_closed_env"],
     "heart_opm": {"mode": "near-SERF", "sensitivity_fT": 1.5, "shielding_required": False, "status": "ENHANCED — WATCH CRUSTAL ANOMALIES"},
     "brain_meg": {"mode": "near-SERF", "sensitivity_fT": 1, "shielding_required": False, "status": "HELMET WORKS IN HAB"},
     "finger_nv": {"mode": "dust_alert", "status": "CRITICAL USE — LUNAR DUST ROS MONITOR"}},
    {"id": "mars_transit", "era": "tomorrow", "name": "Mars Transit", "type": "interplanetary_cruise",
     "duration": "6–9 months", "field_uT": 0.005, "g": 0.0, "comms_s": "240–1320 (4–22 min)", "crew": 6,
     "risk": "Peak radiation, isolation, deconditioning; no real-time comms",
     "nasa_hazards": ["space_radiation", "isolation_confinement", "distance_from_earth", "gravity_fields"],
     "heart_opm": {"mode": "full-SERF", "sensitivity_fT": 0.1, "shielding_required": False,
                   "status": "PEAK SENSITIVITY (illustrative gain 150x)"},
     "brain_meg": {"mode": "full-SERF", "sensitivity_fT": 0.05, "shielding_required": False, "status": "NO SHIELDING"},
     "finger_nv": {"mode": "hypomagnetic", "status": "NOVEL REGIME — CALIBRATION LEARNING"}},
    {"id": "mars_surface", "era": "tomorrow", "name": "Mars Surface Habitat", "type": "surface_habitat",
     "location": "Jezero Crater / Valles Marineris region", "field_uT": 0.05, "g": 0.38,
     "comms_s": "240–1320 (4–22 min)", "crew": 6,
     "risk": "Perchlorate dust, 0.38 g long-term effects, thin-atmosphere radiation",
     "nasa_hazards": ["space_radiation", "gravity_fields", "hostile_closed_env", "distance_from_earth"],
     "heart_opm": {"mode": "near-SERF", "sensitivity_fT": 1, "shielding_required": False, "status": "ENHANCED — FIELD-PORTABLE MCG"},
     "brain_meg": {"mode": "near-SERF", "sensitivity_fT": 0.5, "shielding_required": False, "status": "FIELD-PORTABLE BRAIN SCANNING"},
     "finger_nv": {"mode": "dust_monitoring", "status": "MARTIAN DUST ROS MONITOR"}},
    {"id": "europa", "era": "tomorrow", "name": "Europa Subsurface Mission", "type": "submarine",
     "location": "Jupiter moon Europa, under ice shell",
     "field_uT": 0.4,
     "field_note": "CORRECTED. Jupiter's field at Europa is ~400 nT (0.4 uT), weaker than Earth's surface (~50 uT). "
                   "The earlier 420 uT value and '8x stronger than Earth' claim were wrong. "
                   "Europa's constraints are radiation, ice shielding, pressure and comms delay.",
     "g": 0.134, "comms_s": "1980–3240 (33–54 min)", "crew": 4,
     "risk": "Jupiter radiation belts, isolation, cold, pressure, communication blackout",
     "nasa_hazards": ["space_radiation", "isolation_confinement", "distance_from_earth", "hostile_closed_env"],
     "heart_opm": {"mode": "degraded", "sensitivity_fT": 50, "shielding_required": True,
                   "status": "DEGRADED — SHIELDING AND COMPENSATION NEEDED (illustrative)"},
     "brain_meg": {"mode": "degraded", "sensitivity_fT": 30, "shielding_required": True,
                   "status": "DEGRADED — HEAVY SHIELDING NEEDED (illustrative)"},
     "finger_nv": {"mode": "astrobiological", "status": "NOVEL USE — NV-DIAMOND FALLBACK"}},
    {"id": "deep_space", "era": "tomorrow", "name": "Interstellar Precursor", "type": "deep_space_vessel",
     "location": "Beyond the heliopause (>120 AU)", "field_uT": 0.0005, "g": 0.0,
     "comms_s": "hours to days", "crew": 4,
     "risk": "No rescue, no resupply, no real-time comms, full physiological autonomy required",
     "nasa_hazards": ["space_radiation", "isolation_confinement", "distance_from_earth"],
     "heart_opm": {"mode": "theoretical-peak", "sensitivity_fT": 0.01,
                   "status": "THEORETICAL PEAK (illustrative gain 1500x)"},
     "brain_meg": {"mode": "theoretical-peak", "sensitivity_fT": 0.005, "status": "THEORETICAL MAXIMUM"},
     "finger_nv": {"mode": "peak", "status": "OPTIMAL ENVIRONMENT"}},
]

SENSITIVITY_SCALE = [
    {"location": "Earth surface", "field_uT": 50, "opm_fT": 15, "gain": "1x"},
    {"location": "ISS (LEO)", "field_uT": 50, "opm_fT": 15, "gain": "1x"},
    {"location": "Europa", "field_uT": 0.4, "opm_fT": 50, "gain": "illustrative; limited by shielding and radiation, not field"},
    {"location": "Moon surface", "field_uT": 0.0003, "opm_fT": 1.5, "gain": "illustrative 10x"},
    {"location": "Lunar Gateway", "field_uT": 0.1, "opm_fT": 1.5, "gain": "illustrative 10x"},
    {"location": "Mars surface", "field_uT": 0.05, "opm_fT": 1, "gain": "illustrative 15x"},
    {"location": "Mars transit", "field_uT": 0.005, "opm_fT": 0.1, "gain": "illustrative 150x"},
    {"location": "Interstellar", "field_uT": 0.0005, "opm_fT": 0.01, "gain": "illustrative 1500x"},
]

# -------------------------------------------------------------- sensors
SENSOR_SPECS = {
    "heart_opm": {"device": "QuSpin QZFM OPM", "atom": "87Rb vapor cell", "noise_fT_rtHz": 15,
                  "alt": "NV-diamond cardiac magnetometer, 6–26 pT/√Hz (arXiv 2601.18843)",
                  "cardiac_field_pT": "50–100", "gamma_Hz_per_nT": 7,
                  "sources": ["QuSpin QZFM datasheet", "Sci Rep 2021;11:5564"]},
    "brain_meg": {"device": "OPM-MEG helmet", "channels": "49–128",
                  "sensor_head_mm": "12 × 16.5 × 22.5", "noise_fT_rtHz": 7, "bandwidth_Hz": 130,
                  "power_W": {"head": 0.7, "total_per_sensor": 3.5},
                  "neural_field_fT": 100,
                  "sources": ["He et al., IEEE TBME 2026, DOI 10.1109/TBME.2026.3724753 (VERIFIED, PMID 42606964)",
                              "Hill et al. NeuroImage 2020 (not checked)"]},
    "finger_nv": {"device": "NV-diamond T1 relaxometry", "D_GHz": 2.87,
                  "excitation_nm": 532, "readout_nm": "637–800",
                  "ros_sensitivity_M_rtHz": 5.3e-13,
                  "sources": ["Ninio et al. ACS Nano 2021", "Wu et al. (cardiomyocytes)"]},
}


# Claim checks from this build. Status: VERIFIED (source says it), PARTIAL (source
# supports part of it), NOT_FOUND (could not confirm), CONTRADICTED (source differs).
REFERENCES = [
    {"claim": "NV-diamond magnetometer detects human cardiac magnetic signals at room temperature",
     "status": "VERIFIED", "source": "arXiv 2601.18843 (alphaXiv: Human Cardiac Measurements with Diamond Magnetometers, Jan 2026)",
     "url": "https://www.alphaxiv.org/abs/2601.18843"},
    {"claim": "Rb scalar OPM measures cardiac fields in unshielded ambient conditions",
     "status": "VERIFIED", "source": "arXiv 2602.14264 (alphaXiv: Magnetocardiography measurements using an OPM under ambient conditions, Feb 2026)",
     "url": "https://www.alphaxiv.org/abs/2602.14264"},
    {"claim": "Wearable OPM-MEG sensor head 12 x 16.5 x 22.5 mm, <7 fT/sqrt(Hz), 130 Hz, 3.5 W per sensor (0.7 W head)",
     "status": "VERIFIED", "source": "He et al., IEEE Trans Biomed Eng 2026, PMID 42606964, DOI 10.1109/TBME.2026.3724753 (published 17 Aug 2026)",
     "url": "https://doi.org/10.1109/TBME.2026.3724753"},
    {"claim": "1147 transcripts significantly regulated in mouse heart after 30 days on ISS; MAPK, PI3K-Akt, GPCR pathways predicted activated",
     "status": "VERIFIED", "source": "Veliz et al. 2023, Biomolecules, PMID 36830740, DOI 10.3390/biom13020371 (n=3 flight vs 3 ground, female mice)",
     "url": "https://doi.org/10.3390/biom13020371",
     "note": "Oxidative-stress transcripts were NOT significantly changed in this paper."},
    {"claim": "Spaceflight-by-sex interactions for renin and aldosterone in 6-month ISS crews",
     "status": "VERIFIED", "source": "Hughson et al. 2016, Am J Physiol Heart Circ Physiol, DOI 10.1152/ajpheart.00802.2015",
     "url": "https://doi.org/10.1152/ajpheart.00802.2015"},
    {"claim": "Plasma volume significantly decreases after spaceflight",
     "status": "VERIFIED", "source": "Shi, South & Meck 2004 RCT, PMID 15018291 (placebo group plasma volume decreased after flight)",
     "url": "https://pubmed.ncbi.nlm.nih.gov/15018291/"},
    {"claim": "Plasma volume -12% (Norsk 2015)",
     "status": "NOT_FOUND", "source": "Not located in searches. Remove the number until a source is found."},
    {"claim": "Renin 4.88x postflight (Skylab)",
     "status": "NOT_FOUND", "source": "Skylab sources report PRA increases, but no 4.88x figure was found. Timing matters: PRA fell after launch and rose about a week later.",
     "url": "https://ntrs.nasa.gov/api/citations/19750019656/downloads/19750019656.pdf"},
    {"claim": "RNFL +8.5% (362 to 393 um) in spaceflight OCT",
     "status": "NOT_FOUND", "source": "Roshdy et al. 2026 meta-analysis of head-down tilt (analog, not flight) reports RNFLT +2 to +7 um with prolonged HDT. Not the same numbers.",
     "url": "https://doi.org/10.3357/AMHP.6777.2026"},
    {"claim": "Spaceflight-associated neuro-ocular syndrome (SANS) exists and is a NASA-listed risk",
     "status": "VERIFIED", "source": "NASA HRP risks page (Jul 2026) lists SANS; VIIP called the leading risk",
     "url": "https://www.nasa.gov/hrp/risks/"},
    {"claim": "Perivascular space and ventricle changes after ~6-month ISS flight",
     "status": "VERIFIED", "source": "Barisano et al. 2022, PNAS, DOI 10.1073/pnas.2120439119",
     "url": "https://doi.org/10.1073/pnas.2120439119"},
    {"claim": "Neutron radiation is about 30% of total ISS radiation",
     "status": "VERIFIED", "source": "CSA article, 26 Feb 2026 (primary source for this figure)",
     "url": "https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp"},
    {"claim": "SERF OPM reaches sub-femtotesla sensitivity; deep-space 0.01 fT",
     "status": "NOT_FOUND", "source": "Lune corpus had no OPM/SERF papers. Treat 0.01 fT and the 1500x gain as illustrative only."},
    {"claim": "Jupiter field at Europa about 400 nT (not 420 uT)",
     "status": "NOT_FOUND", "source": "Corrected from physical knowledge; not checked against a source in this build. Verify with a Galileo magnetometer paper before publishing."},
]


def write(name, obj):
    path = OUT / name
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def main():
    files = {}
    files["environments.json"] = write("environments.json", ENVIRONMENTS)
    files["nasa_hazards.json"] = write("nasa_hazards.json", {
        "sources": SOURCES,
        "hazards": NASA_HAZARDS,
        "hazard_facts": NASA_HAZARD_FACTS,
        "risks": NASA_RISKS,
        "research": NASA_RESEARCH,
        "csa": CSA,
    })
    files["sensor_specs.json"] = write("sensor_specs.json", SENSOR_SPECS)
    files["references.json"] = write("references.json", REFERENCES)
    files["sensitivity_scale.json"] = write("sensitivity_scale.json", SENSITIVITY_SCALE)

    # Organ files (heart/brain/ras) are written by scripts/extract_osdr.py from the OSDR CSVs.
    # This script must not overwrite them.

    print("SpinDrift data build")
    print(f"  output folder: {OUT}")
    print(f"  environments: {len(ENVIRONMENTS)} "
          f"(today: {sum(e['era'] == 'today' for e in ENVIRONMENTS)}, "
          f"tomorrow: {sum(e['era'] == 'tomorrow' for e in ENVIRONMENTS)})")
    print(f"  NASA hazards: {len(NASA_HAZARDS)}; risks: "
          f"{sum(len(v) for k, v in NASA_RISKS.items() if isinstance(v, list) and k != 'notes')}")
    print(f"  sensors: {', '.join(SENSOR_SPECS)}")
    print("  organ files: written by scripts/extract_osdr.py (not this script)")
    for name, path in files.items():
        print(f"  wrote {path.name} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
