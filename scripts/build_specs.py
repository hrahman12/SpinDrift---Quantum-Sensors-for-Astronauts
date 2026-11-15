"""Build data/specs.json (contract v10) from the SpinDrift v10 tables.

Values are copied from the brief. Each TO_CONFIRM value was re-checked against its primary source on
2026-11-15 (QuSpin product + technology pages, OSTI slides 3003039, arXiv 2601.18843 PDF, PubMed
abstracts, Crossref abstract of Phys. Rev. Applied 25, 054017). Upgrades and corrections are written
in each VO's note and logged in STATUS.md. Nothing is added beyond the brief's keys.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.common import DATA, meta, vo, missing, write_json  # noqa: E402

CHECKED = "2026-11-15"
QS = f"QuSpin QZFM Gen-3 product page, https://quspin.com/products-qzfm/ (accessed {CHECKED})"
QS_TECH = f"QuSpin technology page, 'How the QZFM works', https://quspin.com/technology/ (accessed {CHECKED})"
OSTI = "OSTI slides, https://www.osti.gov/servlets/purl/3003039"
HSE = "HSE University listing of the QuSpin spec, https://hse.ru/en/cdm-centre/brain/QZFM_Gen3"
NV = "Omar et al., 'Human Cardiac Measurements with Diamond Magnetometers', arXiv 2601.18843v1 (Jan 2026), https://arxiv.org/pdf/2601.18843"
QD = ("Long, Zhang, Zhang, Zhang, 'Single quantum dot based nanosensor for renin assay', Anal. Chem. "
      "84(20):8846-8852 (2012), doi:10.1021/ac302284s, PubMed 23003565 (abstract)")
CQD = ("Tabatabaee, Naghdi, Peyravian, Kiani, Golmohammadi, 'An Invisible Dermal Nanotattoo-Based Smart "
       "Wearable Sensor for eDiagnostics of Jaundice', ACS Nano 18(41):28012-28025 (2024), "
       "doi:10.1021/acsnano.4c06191, PubMed 39356285 (abstract)")
OSCAR = ("Beerden et al., 'Diamond-based magnetometer aboard the International Space Station', Phys. Rev. "
         "Applied 25, 054017 (2026), doi:10.1103/483m-8hfc, CC BY 4.0 (abstract via Crossref)")
ESA_ASM = f"ESA Earth Online, ASM overview, https://earth.esa.int/eogateway/instruments/asm/description (accessed {CHECKED})"


def d(value, unit, source=QS, status="VERIFIED", note=None):
    return vo(value, unit, source, "datasheet", status, None, note)


def p(value, unit, source, status="VERIFIED", note=None):
    return vo(value, unit, source, "published_spec", status, None, note)


def upgraded(where):
    return f"upgraded from TO_CONFIRM on {CHECKED}: {where}"


def opm():
    return {
        "quantum_effect": d("zero-field resonance of spin-polarized rubidium vapor, single laser beam", "", QS_TECH,
                            note="The brief's source URL https://quspin.com/products-qzfm/zero-field-magnetometer-"
                                 f"description/ returned HTTP 404 on {CHECKED}; the same description ('based on "
                                 "zero-field resonance with a single laser beam', rubidium vapor cell, laser light "
                                 "optically pumps the atoms) is on the technology page."),
        "sensitivity_dual_axis": d("<15", "fT/√Hz (3–100 Hz)"),
        "sensitivity_dual_axis_typical": d("7–10", "fT/√Hz", QS, "VERIFIED",
                                           upgraded("the Gen-3 product page states 'typically 7–10 fT/√Hz'")),
        "sensitivity_triaxial": p("<23 (typ. ~15, all axes at once)", "fT/√Hz (3–100 Hz)", OSTI + " (slide 23)",
                                  note="Also stated on the QuSpin Gen-3 product page."),
        "dynamic_range": d("±5", "nT"),
        "sensor_head": d("12.4 × 16.6 × 24.4", "mm"),
        "standoff": d("6.5 (vapor-cell center to housing)", "mm"),
        "head_power": d("~0.7", "W"),
        "total_power": d("5", "W", QS, "VERIFIED",
                         upgraded("the product page now lists 'Total power consumption Approximately 5 W'; "
                                  "the HSE listing also states 5 W total")),
        "electronics_size": d("3.1 × 11.0 × 16.5", "cm", QS, "VERIFIED",
                              upgraded("the product page now lists 'Electronics dimensions 3.1 × 11.0 × 16.5 cm'; "
                                       "matches " + HSE)),
        "latency": d("~5", "ms"),
        "outputs": d("analog and USB digital", "",
                     note="Product page footnote: the USB digital output carries one axis at a fixed 200 Hz, for "
                          "setup and diagnostics; the analog outputs carry the full measurement."),
        "cable": d("2 ft flexible FPC, then 6.5 m round cable", ""),
        "calibration": d("automated internal reference", ""),
        "cooling": d("none, room temperature", ""),
        "atomic_species": d("rubidium", ""),
        "bandwidth_serf_class": p("80–150 open loop, 350 closed loop", "Hz", OSTI + " (slide 20)", "TO_CONFIRM",
                                  "Class figure, not the Gen-3 datasheet. Slide 20 lists 80–150 Hz open loop for "
                                  "zero-field SERF OPMs and footnotes the 350 Hz closed-loop figure to FieldLine "
                                  "(Alem et al., Front. Neurosci. 17, 1190310, 2023). The QuSpin technology page "
                                  "states 'Bandwidth of ~150 Hz' for the QZFM."),
    }


def nv():
    head = {
        "sensitivity_range": p("6–26", "pT/√Hz", NV + " (abstract)"),
        "sensing_volume": p("<0.5", "mm³", NV + " (abstract)"),
        "averaging": p("a few hundred to several thousand heartbeats", "", NV + " (abstract)"),
        "r_peak_average": p(25, "pT", NV + " (Section 3.1, p. 10)", "VERIFIED",
                            upgraded("p. 10, 'reliable detection of the average 25 pT R-peaks'")),
        "sensitivity_for_single_beat_snr5": p("~1", "pT/√Hz", NV + " (Section 3.1, p. 10)", "VERIFIED",
                                              upgraded("p. 10, 'with a signal-to-noise ratio of 5 would require a "
                                                       "sensitivity of about 1 pT/√Hz'")),
        "bandwidth_assumed": p(30, "Hz", NV + " (Section 3.1, p. 10)", "VERIFIED",
                               upgraded("p. 10, 'a bandwidth of approximately 30 Hz' (stored as 30; the paper says "
                                        "approximately); the same sentence gives a single-shot RMS noise floor of "
                                        "50 pT")),
        "reference_opm_mapping": p("FieldLine OPM array, two-layer µ-metal shielding, 2.5 cm spacing, ≥5 cm "
                                   "standoff, traces averaged over 100 heartbeats", "", NV + " (Section 2.2, p. 6)",
                                   "VERIFIED", upgraded("p. 6; Fig. 2b shows 47 OPM MCG traces, band-pass 3–30 Hz")),
        "data_availability": p("available upon reasonable request", "", NV + " (Section 6, p. 15)", "VERIFIED",
                               upgraded("p. 15, 'The noise characterization and MCG analysis data are available "
                                        "upon reasonable request from the authors.'")),
        "standoff": p("~1 cm (JGU and ZAQuant); Q.ANT: subject lying directly below the sensor, distance not stated",
                      "cm", NV + " (pp. 4 and 6)", "VERIFIED",
                      "changed from NOT_STATED after reading the full text: p. 4 'approximately 1 cm away from a "
                      "seated subject's chest' (JGU); p. 6 'sitting ∼1 cm away from the sensor head' (ZAQuant)"),
        "diamond_supplier": missing("", NV, "published_spec", "NOT_STATED",
                                    "The text does not name a supplier. Two co-authors are at Element Six Global "
                                    "Innovation Centre; the JGU diamond design is in Omar et al., Optics Letters 48, "
                                    "2512 (2023), doi:10.1364/OL.486998."),
    }
    t2 = NV + " (Table 2, p. 15)"
    avg = NV + " (Section 2.1, p. 6)"
    meth = NV + " (Section 4, pp. 13-15)"
    ns = "unspecified in source"
    jgu = {
        "sensitivity": p(13, "pT/√Hz", t2, "VERIFIED", upgraded("Table 2; averaged between 20 and 30 Hz (p. 4)")),
        "beats_averaged": p(12000, "beats", avg, "VERIFIED",
                            upgraded("p. 6, 'The amount of averages for the displayed data were 12000, 300, and 2000'; "
                                     "position B in Fig. 2 used 6,000")),
        "diamond": p("0.5 × 0.5 mm base, 0.18 mm tall, truncated pyramid", "", NV + " (p. 4; Table 2)"),
        "laser": p("Coherent Verdi G5", "", meth),
        "detector": p("differential photodiode board", "", meth,
                      note=f"model {ns}; acknowledgements say Hamamatsu supplied the non-magnetic photodiodes"),
        "microwave": p("custom PCB antenna", "", meth, note="'custom made printed circuit board (PCB)'"),
        "bias_field": p("none; 6.12 kHz modulation field", "", meth, note="modulation field of µT amplitude along [100]"),
        "readout": p("Zurich Instruments lock-in", "", meth, note=f"model {ns}"),
        "shielding": p("multilayer shielded room", "", t2),
        "head_size": p("12 mm aluminum housing", "mm", meth, note="'sensor head diameter: 12 mm'"),
    }
    zaq = {
        "sensitivity": p(7, "pT/√Hz", t2, "VERIFIED", upgraded("Table 2")),
        "beats_averaged": p(300, "beats", avg, "VERIFIED", upgraded("p. 6")),
        "diamond": p("0.5 × 0.5 × 0.5 mm, pyramidal, CPC-mounted", "", meth + "; Table 2"),
        "laser": p("green laser", "", meth, note=f"model {ns}"),
        "detector": p("balanced photodetection", "", meth, note=f"model {ns}; 695 nm long-pass filter"),
        "microwave": p("loop antenna after amplification", "", meth),
        "bias_field": p("permanent magnet, ~1 mT", "", meth),
        "readout": p("Zurich Instruments HF2LI", "", meth),
        "shielding": p("single-layer shield", "", t2),
        "head_size": missing("", NV, "published_spec", "NOT_STATED"),
    }
    qant = {
        "sensitivity": p(26, "pT/√Hz", t2, "VERIFIED", upgraded("Table 2")),
        "beats_averaged": p(2000, "beats", avg, "VERIFIED", upgraded("p. 6")),
        "diamond": p("1 × 1 × 0.5 mm truncated pyramid, ~1.7 ppm NV⁻", "", meth, note="NV⁻ content by EPR"),
        "laser": p("Coherent OBIS, fiber-coupled, 100 mW at fiber", "", meth),
        "detector": p("low-noise balanced photodiode board", "", meth, note=f"model {ns}"),
        "microwave": p("FPGA-based generation", "", meth, note=f"antenna {ns}"),
        "bias_field": p("in-house Halbach ring, ~1 mT", "", meth),
        "readout": p("FPGA controller, USB-C to PC", "", meth),
        "shielding": p("unshielded", "", t2),
        "head_size": p(1, "dm³", meth, note="'a sensor head volume of 1 dm3'"),
    }
    return {"headline": head, "jgu": jgu, "zaquant": zaq, "qant": qant}


def qd_renin():
    return {
        "quantum_effect": p("quantum confinement in a semiconductor nanocrystal; FRET from quantum-dot donor to Cy5 "
                            "acceptor", "", QD,
                            note="The abstract states the QD-donor / Cy5-acceptor FRET; 'quantum confinement in a "
                                 "semiconductor nanocrystal' is the general physics of quantum dots, not a claim of "
                                 "this paper."),
        "probe": p("streptavidin-coated quantum dot + multiple biotinylated, Cy5-labeled peptide substrates", "", QD),
        "mechanism": p("renin cleaves the substrate, Cy5 leaves, FRET signal and Cy5 counts drop", "", QD),
        "detection_limit": p(25, "pM", QD),
        "readout": p("single-molecule counting by total internal reflection fluorescence (TIRF) microscopy", "", QD),
        "qd_model_and_emission": missing("", QD, "published_spec", "NOT_STATED"),
        "linear_range": missing("", QD, "published_spec", "NOT_YET_EXTRACTED", "full text is paywalled"),
        "assay_time": missing("", QD, "published_spec", "NOT_YET_EXTRACTED", "full text is paywalled"),
    }


def cqd_patch():
    tc = "full text is paywalled; not checked against the primary source"
    return {
        "sensing_element": p("dissolving/hydrogel microneedles loaded with fluorescent carbon quantum dots, left in "
                             "the skin as an invisible tattoo", "", CQD),
        "mechanism": p("selective recovery of quenched fluorescence upon the blue light used for jaundice "
                       "phototherapy", "", CQD),
        "analyte": p("bilirubin in skin interstitial fluid", "", CQD),
        "readout": p("IoT-integrated wearable optoelectronic reader; minimally invasive, continuous, real-time", "", CQD),
        "validation": p("high correlation with blood bilirubin", "", CQD),
        "reader_channels": p("440, 470, 510", "nm", CQD, "TO_CONFIRM", tc),
        "calibration_model": p("ex vivo rat skin", "", CQD, "TO_CONFIRM", tc),
        "needle_dimensions": missing("", CQD, "published_spec", "NOT_YET_EXTRACTED"),
        "detection_limit": missing("", CQD, "published_spec", "NOT_YET_EXTRACTED"),
        "range": missing("", CQD, "published_spec", "NOT_YET_EXTRACTED"),
        "dot_wavelengths": missing("", CQD, "published_spec", "NOT_YET_EXTRACTED"),
        "physics_label": p("carbon dots are fluorescent nanoparticles; their emission is not a spin-based quantum "
                           "measurement", "", CQD, note="general physics label, not a claim of the paper"),
    }


def heritage():
    blocked = "the APS full text returned HTTP 403 on 2026-11-15, so this is not yet checked"
    oscar = {
        "principle": p("NV-diamond magnetometer using continuous-wave ODMR", "", OSCAR, "TO_CONFIRM",
                       "the abstract confirms ODMR with NV centres in diamond; 'continuous-wave' is not in the "
                       "abstract and " + blocked),
        "form_factor": p("1U (10 × 10 × 10 cm)", "cm", OSCAR),
        "mass": p(420, "g", OSCAR, note="stated in the paper abstract (the brief pointed to the poster)"),
        "power": p(5, "W", OSCAR, note="stated in the paper abstract (the brief pointed to the poster)"),
        "sensitivity": p("<300", "nT/√Hz", OSCAR),
        "iss_operation": p("ran on the ISS for 10 months in 2021–22", "", OSCAR, "TO_CONFIRM",
                           "the abstract confirms deployment aboard the ISS; duration and years: " + blocked),
        "measurement_location": p("inside the station, where equipment caused interference", "", OSCAR, "TO_CONFIRM",
                                  blocked),
        "flight_data": missing("", OSCAR, "published_spec", "NOT_STATED", "flight data not public"),
    }
    swarm = {
        "instrument": p("Absolute Scalar Magnetometer (ASM) on ESA's Swarm satellites", "", ESA_ASM),
        "principle": p("optically pumped helium-4 magnetometer", "", ESA_ASM,
                       note="ESA: based on electron spin resonance and the Zeeman effect; an HF discharge excites "
                            "4He atoms to the metastable state; linearly polarized pumping light"),
        "role": p("measures field strength and calibrates the vector magnetometer", "", ESA_ASM),
        "charlie_asm": p("The ASM on Swarm Charlie was lost.", "",
                         "ESA IDEAS+ Swarm Weekly Report, week 45 2014 (IDEAS+-SER-OQC-REP-2071, Sec. 2.1, p. 7) and "
                         "week 46 (Sec. 2.1); DTU Space release notes SW-RN-DTU-GS-002 Rev 1, Sec. 3.1.1",
                         "VERIFIED",
                         "switched off by failure protection on 5 Nov 2014 (about 19:37 UTC) after a suspect current "
                         "reading; restarts failed; the redundant ASM on Charlie had been declared lost during "
                         "commissioning; https://ftp-qras.earth.esa.int/swarm/swarm_instruments/weekly/2014/"
                         "swarm--swarm_instruments--weekly--20141103--l1b.pdf"),
    }
    return {"oscar_qube": oscar, "swarm_asm": swarm}


def build():
    return {
        "meta": meta(False, [QS, QS_TECH, OSTI, HSE, NV, QD, CQD, OSCAR, ESA_ASM]),
        "opm": opm(), "nv": nv(), "qd_renin": qd_renin(), "cqd_patch": cqd_patch(),
        "space_heritage": heritage(),
    }


def main():
    obj = build()
    write_json(DATA / "specs.json", obj)
    print("wrote specs.json")
    return obj


if __name__ == "__main__":
    main()
