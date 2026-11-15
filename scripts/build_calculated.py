"""Calculated files (contract v10, Section 5): nv_heart_derived.json, physics.json, build_log.json,
clinical_card.json.

`calculated` = a formula applied to sourced inputs; the formula and input ids are stored in each VO note.
A curve is plotted only if every input has a value (VERIFIED or TO_CONFIRM). No generated noise, no
decorative shapes: the averaged heartbeat comes from the real Kiel recording, the curves from cited
equations.
"""
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.common import (DATA, LOCATION_IDS, RECORDED, calc, log_status, meta, missing, read_json,  # noqa: E402
                           vo, write_json)

BUILDS = ["jgu", "zaquant", "qant"]
BARRY = ("Barry et al., 'Sensitivity optimization for NV-diamond magnetometry', Rev. Mod. Phys. 92, 015004 "
         "(2020), arXiv 1903.08176v2")
QS_TECH = "QuSpin technology page, 'How the QZFM works', https://quspin.com/technology/"
SULAI = ("Sulai et al., 'Characterizing atomic magnetic gradiometers for fetal magnetocardiography', "
         "arXiv 1906.03227 (2019), Appendix B, Eq. (B2)")
FRETCALC = ("Benatto et al., 'FRET-Calc: A Free Software and Web Server for Förster Resonance Energy Transfer "
            "Calculation', Comput. Phys. Commun. (2023), doi:10.1016/j.cpc.2023.108715, arXiv 2311.15476, Eq. (2)")


def r(x, n=4):
    return float(round(x, n))


# ---------------------------------------------------------------- nv_heart_derived.json
def averaged_beat(rec):
    from scipy.signal import find_peaks
    fs = rec["meta"]["sample_rate_hz"]
    t = np.array(rec["x"]["values"])
    sig = {s["name"]: np.array(s["values"]) for s in rec["series"]}
    prom = {k: np.percentile(np.abs(v), 99.5) / np.median(np.abs(v)) for k, v in sig.items()}
    ch = max(prom, key=prom.get)
    x = sig[ch]
    pol = 1.0 if np.percentile(x, 99.9) >= -np.percentile(x, 0.1) else -1.0
    xp = pol * x
    peaks, _ = find_peaks(xp, height=0.5 * np.percentile(xp, 99.9), distance=int(0.4 * fs))
    pre, post = int(0.3 * fs), int(0.5 * fs)
    peaks = [p for p in peaks if p - pre >= 0 and p + post < len(x)]
    beats = np.stack([x[p - pre:p + post + 1] for p in peaks])
    avg = beats.mean(axis=0)
    tt = np.arange(-pre, post + 1) / fs
    rr = np.diff(t[peaks])
    return ch, prom[ch], pol, tt, avg, len(peaks), float(avg[pre]), float(np.median(rr))


def nv_heart_derived(specs):
    rec = read_json(RECORDED / "opm_heart_kiel.json")
    if not rec or rec["meta"].get("fixture"):
        raise RuntimeError("opm_heart_kiel.json is still a fixture")
    ch, prom, pol, tt, avg, n, rpk, rr = averaged_beat(rec)
    from server.realdata import qrs_points
    pre = int(round(0.3 * rec["meta"]["sample_rate_hz"]))
    qrs = qrs_points(np.asarray(avg), pre, rec["meta"]["sample_rate_hz"])
    rid = "recorded/opm_heart_kiel.json"
    beats_vo = vo(n, "beats", f"{rid} ({rec['meta']['record']}, channel {ch})", "calculated", "VERIFIED", None,
                  "formula: count of R-peaks found by scipy.signal.find_peaks on the channel with the clearest QRS "
                  f"(largest 99.5th-percentile/median |B| = {prom:.1f}), polarity {'+' if pol > 0 else '-'}, height "
                  "> 0.5 x 99.9th percentile, spacing >= 0.4 s, beats fully inside the 60 s window; inputs: "
                  f"{rid}; median R-R interval {rr:.3f} s")
    rpk_vo = vo(r(rpk, 2), "pT", f"{rid} (averaged beat at the R-peak)", "calculated", "VERIFIED", None,
                f"formula: mean over the {n} beats of B at each R-peak sample; inputs: {rid}, "
                "nv_heart_derived.averaged_beat.beats_averaged. Earth recording with QuSpin QZFM Gen 1 OPMs at "
                "the Kiel array position; a different person and geometry from the NV studies.")
    q_vo = vo(qrs["q_pT"], "pT", f"{rid} (averaged beat)", "calculated", "VERIFIED", None,
              f"formula: {qrs['rule']}; Q at {qrs['q_ms_before_r']} ms before R; QRS {qrs['qrs_ms']} ms; "
              f"inputs: {rid}, nv_heart_derived.averaged_beat")
    head = specs["nv"]["headline"]
    bw, amp = head["bandwidth_assumed"], head["r_peak_average"]
    per = {}
    for b in BUILDS:
        eta, nb = specs["nv"][b]["sensitivity"], specs["nv"][b]["beats_averaged"]
        ids = [f"specs.nv.{b}.sensitivity", "specs.nv.headline.bandwidth_assumed"]
        sbn = eta["value"] * math.sqrt(bw["value"])
        sbn_vo = calc(r(sbn, 2), "pT", [eta, bw], "single_beat_noise = eta * sqrt(BW)", ids)
        avn = sbn / math.sqrt(nb["value"])
        avn_vo = calc(r(avn, 3), "pT", [eta, bw, nb], "averaged_noise = eta * sqrt(BW) / sqrt(N)",
                      ids + [f"specs.nv.{b}.beats_averaged"])
        per[b] = {
            "noise_density": eta,
            "single_beat_noise_pT": sbn_vo,
            "averaged_noise_pT": avn_vo,
            "single_beat_snr": calc(r(amp["value"] / sbn, 3), "", [amp, eta, bw], "single_beat_snr = A / single_beat_noise",
                                    ["specs.nv.headline.r_peak_average"] + ids),
            "averaged_snr": calc(r(amp["value"] / avn, 2), "", [amp, eta, bw, nb], "averaged_snr = A / averaged_noise",
                                 ["specs.nv.headline.r_peak_average"] + ids + [f"specs.nv.{b}.beats_averaged"]),
            "averaged_snr_measured_peak": calc(r(abs(rpk) / avn, 2), "", [rpk_vo, eta, bw, nb],
                                               "averaged_snr_measured_peak = |measured Kiel R-peak| / averaged_noise",
                                               ["nv_heart_derived.averaged_beat.r_peak_pT"] + ids +
                                               [f"specs.nv.{b}.beats_averaged"],
                                               note_extra="uses the OPM-measured R-peak instead of the paper's 25 pT"),
            "averaged_snr_q_wave": calc(r(abs(qrs["q_pT"]) / avn, 2), "", [q_vo, eta, bw, nb],
                                        "averaged_snr_q_wave = |measured Kiel Q wave| / averaged_noise",
                                        ["nv_heart_derived.averaged_beat.q_wave_pT"] + ids +
                                        [f"specs.nv.{b}.beats_averaged"],
                                        note_extra="can this build resolve the Q wave after averaging? (>1 means above "
                                                   "its averaged noise)"),
        }
    obj = {"meta": meta(False, ["Kiel Cardio Database v1.0.0 (PhysioNet, CC BY-SA 4.0)",
                                "Omar et al., arXiv 2601.18843 (2026)"]),
           "recorded_id": "opm_heart_kiel", "channel": ch,
           "averaged_beat": {"t_s": [r(v, 3) for v in tt], "pT": [r(v, 3) for v in avg],
                             "beats_averaged": beats_vo, "r_peak_pT": rpk_vo, "q_wave_pT": q_vo,
                             "q_wave_ms_before_r": qrs["q_ms_before_r"], "qrs_ms": qrs["qrs_ms"],
                             "s_wave_pT": qrs["s_pT"]},
           "per_build": per,
           "note": "Never add generated noise to a trace: the app draws each build's noise as a band of "
                   "+/- averaged_noise_pT (or single_beat_noise_pT) around the real averaged beat."}
    write_json(DATA / "nv_heart_derived.json", obj)
    s = ", ".join(f"{b} {per[b]['single_beat_noise_pT']['value']} pT / SNR {per[b]['averaged_snr']['value']}"
                  for b in BUILDS)
    log_status("data/nv_heart_derived.json", "done", f"{n} beats averaged on {ch}, R-peak {rpk:.1f} pT; {s}")
    return obj


# ---------------------------------------------------------------- physics.json
def physics():
    d_vo = vo(2870, "MHz", BARRY + ", Sec. I.C, p. 4 ('D ≈ 2.87 GHz')", "published_spec", "VERIFIED")
    g_vo = vo(28.025, "MHz/mT", BARRY + ", Eq. (6), gamma = g_e mu_B / h", "published_spec", "TO_CONFIRM",
              None, "Barry et al. give g_e ≈ 2.003, i.e. gamma ≈ 28.03 MHz/mT; 28.025 MHz/mT is the brief's value "
                    "(free-electron g = 2.0023, also used by ODMR-Lab). The two differ by 0.03 %.")
    bs = [r(0.02 * i, 2) for i in range(101)]
    nv = {"plotted": True, "x": bs, "y": [r(d_vo["value"] + g_vo["value"] * b, 3) for b in bs],
          "x_label": "magnetic field along the NV axis B (mT)", "y_label": "ODMR transition frequency f+ (MHz)",
          "equation": "f± = D ± γB (field along the NV axis), Barry et al. Eq. (6)",
          "inputs": [d_vo, g_vo], "missing_inputs": [],
          "extra_series": [{"name": "f- = D - γB", "y": [r(d_vo["value"] - g_vo["value"] * b, 3) for b in bs]}]}

    width = vo("~30", "nT", QS_TECH, "datasheet", "TO_CONFIRM", None,
               "'typically about 30 nT wide'; QuSpin does not say whether this is the full or the half width")
    form = vo("Lorentzian zero-field resonance", "", QS_TECH + "; " + SULAI, "published_spec", "VERIFIED", None,
              "QuSpin: 'Sweeping the field through zero traces out a Lorentzian response called the zero-field "
              "resonance'. Sulai et al. Eq. (B2) steady state with only a transverse field: P_z ∝ Γ'^2/(Γ'^2 + Ω^2) "
              "(absorptive) and P_x ∝ Γ'Ω/(Γ'^2 + Ω^2) (dispersive), Ω = γB, so ΔB = Γ'/γ.")
    rng = vo(5, "nT", "QuSpin QZFM Gen-3 product page, https://quspin.com/products-qzfm/", "datasheet", "VERIFIED",
             None, "dynamic range ±5 nT, shown separately from the dimensionless curve")
    xs = [r(-5 + 0.05 * i, 2) for i in range(201)]
    opm = {"plotted": True, "x": xs, "y": [r(1 / (1 + x * x), 5) for x in xs],
           "x_label": "B / ΔB (ΔB = half width at half maximum)", "y_label": "normalised resonance signal",
           "equation": "S(B)/S(0) = 1 / (1 + (B/ΔB)^2); dispersive companion (B/ΔB) / (1 + (B/ΔB)^2)",
           "inputs": [form, width, rng],
           "missing_inputs": ["QZFM half width ΔB in nT (QuSpin gives '~30 nT wide' without saying full or half "
                              "width), so the x-axis stays dimensionless"],
           "extra_series": [{"name": "dispersive (lock-in output shape)", "y": [r(x / (1 + x * x), 5) for x in xs]}],
           "notes": "The ±5 nT dynamic range is ±0.33 ΔB if 30 nT is the full width, or ±0.17 ΔB if it is the half "
                    "width (to confirm)."}

    eq = vo("E = 1 / (1 + (r/R0)^6)", "", FRETCALC, "published_spec", "VERIFIED", None,
            "Eq. (2), η_FRET = R0^6/(R0^6 + R^6); Eq. (3) gives n_A R0^6/(n_A R0^6 + R^6) for n_A acceptors per donor")
    rs = [r(0.02 * i, 2) for i in range(101)]
    fret = {"plotted": True, "x": rs, "y": [r(1 / (1 + x ** 6), 5) for x in rs],
            "x_label": "donor-acceptor distance r / R0", "y_label": "FRET efficiency E",
            "equation": "E = 1 / (1 + (r/R0)^6) (Förster), single acceptor",
            "inputs": [eq],
            "missing_inputs": ["Förster radius R0 for the paper's quantum dot and Cy5 (dot not stated), so x stays "
                               "dimensionless",
                               "number of Cy5 substrates per quantum dot n_A (the probe carries 'multiple'; count not "
                               "in the abstract), so only the single-acceptor curve is drawn"]}
    cqd = {"plotted": False, "x": [], "y": [], "x_label": "", "y_label": "", "equation": "",
           "inputs": [], "missing_inputs": ["quenching/recovery model and constants from doi:10.1021/acsnano.4c06191"]}
    obj = {"meta": meta(False, [BARRY, QS_TECH, SULAI, FRETCALC]),
           "nv_odmr_lines": nv, "opm_zero_field": opm, "qd_fret_vs_distance": fret, "cqd_quenching": cqd}
    write_json(DATA / "physics.json", obj)
    log_status("data/physics.json", "done", "nv_odmr_lines (D VERIFIED, gamma TO_CONFIRM), opm_zero_field (Lorentzian, "
               "QuSpin + Sulai Eq. B2), qd_fret_vs_distance (FRET-Calc Eq. 2) plotted; cqd_quenching not plotted")
    return obj


# ---------------------------------------------------------------- build_log.json
def fact(text, value):
    return {"fact": text, "value": value}


def build_log(specs, live):
    opm, nvh = specs["opm"], specs["nv"]
    qp = "QuSpin QZFM Gen-3 product page, https://quspin.com/products-qzfm/"
    nvsrc = "Omar et al., arXiv 2601.18843, Section 4"
    rng = vo(5, "nT", qp, "datasheet", "VERIFIED", None, "±5 nT dynamic range")
    bias = vo(1.0, "mT", nvsrc, "published_spec", "VERIFIED", None, "'approximately 1 mT' (ZAQuant magnet, Q.ANT Halbach ring)")
    dims = [vo(v, "mm", qp, "datasheet", "VERIFIED") for v in (12.4, 16.6, 24.4)]
    head_cm3 = 12.4 * 16.6 * 24.4 / 1000.0
    head_vo = calc(r(head_cm3, 2), "cm³", dims, "V = 12.4 mm x 16.6 mm x 24.4 mm", ["specs.opm.sensor_head"])
    qant_vo = vo(1000, "cm³", nvsrc + " ('a sensor head volume of 1 dm3')", "published_spec", "VERIFIED", None, "1 dm³")
    step = vo(0.05, "mT", "ODMR-Lab app.py (field slider step)", "simulated", "VERIFIED")
    amp = nvh["headline"]["r_peak_average"]
    ns = lambda what, note=None: missing("", "not found in the SpinDrift sources", "published_spec", "NOT_STATED", note)  # noqa: E731
    per = {
        "opm": [
            fact("OPM dynamic range", opm["dynamic_range"]),
            fact("OPM sensor-head volume", head_vo),
            fact("OPM sensor-head power", opm["head_power"]),
            fact("OPM total power (head + electronics)", opm["total_power"]),
            fact("OPM vapor cell runs at about 150 °C",
                 vo("~150", "°C", QS_TECH, "datasheet", "VERIFIED", None, "'The vapor cell runs at ~150 °C'")),
            fact("OPM built-in three-axis coils cancel residual fields up to 50 nT; QuSpin asks for about 50 nT or "
                 "below at the sensor", vo(50, "nT", QS_TECH + "; " + qp, "datasheet", "VERIFIED")),
            fact("Rb pump laser part", ns("laser")), fact("Vapor-cell supplier", ns("cell")),
            fact("OPM photodiodes", ns("pd")),
        ],
        "nv": [
            fact("NV bias field (ZAQuant, Q.ANT)", bias),
            fact("JGU NV head", nvh["jgu"]["head_size"]),
            fact("Q.ANT NV head volume", qant_vo),
            fact("NV sensor power", ns("p")),
            fact("NV diamond supplier", nvh["headline"]["diamond_supplier"]),
            fact("Microwave amplifier", ns("mw", "ZAQuant says the microwave signals were amplified; model not stated")),
            fact("ODMR-Lab field step against a 25 pT heartbeat R-peak",
                 calc(round(step["value"] * 1e-3 / (amp["value"] * 1e-12)), "×", [step, amp],
                      "ratio = 0.05 mT / 25 pT", ["simulators.nv.ODMR-Lab.field_step", "specs.nv.headline.r_peak_average"],
                      note_extra="the online NV simulator shows the sensor's operating point, not the heartbeat")),
        ],
        "qd_renin": [
            fact("Renin sensor readout needs a TIRF microscope", specs["qd_renin"]["readout"]),
            fact("Renin sensor detection limit", specs["qd_renin"]["detection_limit"]),
            fact("Quantum-dot model and emission", specs["qd_renin"]["qd_model_and_emission"]),
            fact("Quantum-dot readout power", ns("p")),
        ],
        "cqd_patch": [
            fact("Patch already has a wearable reader", specs["cqd_patch"]["readout"]),
            fact("Patch needle dimensions", specs["cqd_patch"]["needle_dimensions"]),
            fact("Patch reader power", ns("p")),
        ],
    }
    combined = [
        fact("OPM range ±5 nT against the NV bias ~1 mT: the two can't share an enclosure without separating their "
             "fields", calc(round(bias["value"] * 1e-3 / (rng["value"] * 1e-9)), "×", [bias, rng],
                            "ratio = 1 mT / 5 nT", ["specs.nv.zaquant.bias_field", "specs.opm.dynamic_range"])),
        fact("Q.ANT NV head (1 dm³) against the OPM head (5.0 cm³)",
             calc(r(qant_vo["value"] / head_cm3, 0), "×", [qant_vo, head_vo], "ratio = 1000 cm³ / 5.02 cm³",
                  ["specs.nv.qant.head_size", "build_log.opm.head_volume"])),
        fact("Readout hardware differs: the renin sensor needs a TIRF microscope, the patch has a wearable reader",
             vo("TIRF microscope vs wearable IoT reader", "", "doi:10.1021/ac302284s; doi:10.1021/acsnano.4c06191",
                "published_spec", "VERIFIED")),
        fact("Space heritage: an NV magnetometer (OSCAR-QUBE) ran on the ISS",
             specs["space_heritage"]["oscar_qube"]["iss_operation"]),
        fact("Space heritage: an optically pumped helium magnetometer flies on Swarm",
             specs["space_heritage"]["swarm_asm"]["principle"]),
    ]
    for loc_id, rd in (live or {}).get("opm_readiness", {}).items():
        combined.append(fact(f"Field reduction the OPM needs at {loc_id} (latest live snapshot)",
                             rd["shielding_factor"]))
    obj = {"meta": meta(False, ["data/specs.json", "data/live_snapshot.json", "ODMR-Lab app.py"],
                        live_snapshot_fetched_at=(live or {}).get("fetched_at")),
           "per_sensor": per, "combined": combined}
    write_json(DATA / "build_log.json", obj)
    log_status("data/build_log.json", "done", f"{sum(len(v) for v in per.values())} per-sensor and {len(combined)} "
               "combined facts; per-location shielding factors from the latest live snapshot")
    return obj


# ---------------------------------------------------------------- clinical_card.json
def evidence(v, earth=False):
    if v.get("value") is None or v.get("status") == "TO_CONFIRM":
        return "TO_CONFIRM"
    return "EARTH_ONLY" if earth else "SOURCED"


def i4_bilirubin_summary(i4):
    """Summary VO of the open Inspiration4 total bilirubin values (count, crew codes, timepoints, range)."""
    if not i4:
        return None
    pts = [(v["name"], p) for d in i4.get("datasets", []) for v in d["variables"] if "bilirubin" in v["name"].lower()
           for p in v["points"]]
    vals = [p["value"]["value"] for _, p in pts if p["value"]["value"] is not None]
    if not vals:
        return None
    crews = sorted({n.split()[-1] for n, _ in pts})
    tps = []
    for _, p in pts:
        if p["timepoint"] not in tps:
            tps.append(p["timepoint"])
    text = (f"{len(vals)} values, crew {', '.join(crews)}, timepoints {tps[0]} to {tps[-1]}: "
            f"{min(vals):g}-{max(vals):g} mg/dL")
    return vo(text, "mg/dL", "NASA OSDR OSD-575 (data/nasa_i4.json)", "calculated", "VERIFIED", None,
              "formula: count, min and max over the released total bilirubin values; inputs: nasa_i4.datasets[OSD-575]")


def _risk(hrp, name):
    r = next((x for x in (hrp or {}).get("risks", []) if x["heading"] == name), None)
    return {"heading": r["heading"], "text": r["text"], "source": r["source"]} if r else None


def main_rows(loc, specs, live, derived, hrp, i4):
    """The high-level main card: heart Q wave, brain EEG, blood, skin patch, tumour, lung. Real values only."""
    ab = derived["averaged_beat"] if derived else {}
    q = ab.get("q_wave_pT") or missing("pT", "", "calculated", "NOT_YET_EXTRACTED")
    snr_q = {b: derived["per_build"][b]["averaged_snr_q_wave"] for b in BUILDS} if derived else {}
    eeg = read_json(RECORDED / "eeg_brain_ds004902.json", {})
    alpha = eeg.get("alpha_8_12Hz_uV2_per_Hz")
    alpha_vo = (vo("; ".join(f"{k} {v}" for k, v in alpha.items()), "uV^2/Hz",
                   "OpenNeuro ds004902 sub-01, eyes closed (CC0), data/recorded/eeg_brain_ds004902.json", "calculated",
                   "VERIFIED", None, "formula: Welch PSD mean 8-12 Hz over O1/Oz/O2, whole 300 s")
                if alpha else missing("uV^2/Hz", "ds004902", "calculated", "NOT_YET_EXTRACTED"))
    meg = read_json(RECORDED / "opm_brain_mne.json", {})
    meg_vo = None
    if meg.get("evoked"):
        ev = meg["evoked"]
        best = max(((abs(v), s["name"], i, v) for s in ev["series"] for i, v in enumerate(s["values"])
                    if 0.01 < ev["x"]["values"][i] < 0.1), default=None)
        if best:
            meg_vo = vo(best[3], "fT", "MNE-Python OPM sample (nine QuSpin SERF OPMs), data/recorded/opm_brain_mne.json",
                        "calculated", "VERIFIED", None, f"largest |evoked| 10-100 ms after the median-nerve stimulus: "
                        f"{best[1]} at {ev['x']['values'][best[2]] * 1000:.0f} ms, {ev['n_epochs']} epochs")
    rad = (live or {}).get("radiation") or {}
    cabin = {c["name"]: c["reading"] for c in ((live or {}).get("iss_cabin") or [])} if loc == "iss" else {}
    co2 = next((v for k, v in cabin.items() if "ppCO2" in k), None)
    o2 = next((v for k, v in cabin.items() if "ppO2" in k), None)
    bil = i4_bilirubin_summary(i4)
    renin_nf = missing("pM", "NASA OSDR Inspiration4 open data", "recorded", "NOT_STATED",
                       "renin is not measured in any open Inspiration4 file (see nasa_i4.not_found)")
    nf = lambda unit, why: missing(unit, "", "live", "NOT_YET_EXTRACTED", why)  # noqa: E731
    return [
        {"id": "heart_q_wave", "label": "Heart: Q wave", "device": "opm + nv", "reading": q,
         "supporting": [ab.get("r_peak_pT"), *(snr_q[b] for b in BUILDS)] if derived else [],
         "supporting_labels": ["R-peak", "JGU averaged SNR on the Q wave", "ZAQuant averaged SNR on the Q wave",
                               "Q.ANT averaged SNR on the Q wave"],
         "evidence": "EARTH_ONLY", "data": ["recorded/opm_heart_kiel.json", "nv_heart_derived.json"],
         "physics": ["physics.opm_zero_field", "physics.nv_odmr_lines"],
         "risk": _risk(hrp, "Risk of Cardiovascular Adaptations"),
         "review_note": (f"Q wave {ab.get('q_wave_ms_before_r')} ms before R on a {ab.get('beats_averaged', {}).get('value')}"
                         "-beat average of a real OPM heart recording; found by a simple rule, not a clinical reading.")},
        {"id": "brain_eeg", "label": "Brain: EEG alpha and OPM-MEG evoked field", "device": "opm", "reading": alpha_vo,
         "supporting": [meg_vo] if meg_vo else [], "supporting_labels": ["OPM-MEG evoked field peak"],
         "evidence": "EARTH_ONLY", "data": ["recorded/eeg_brain_ds004902.json", "recorded/opm_brain_mne.json"],
         "physics": ["physics.opm_zero_field"], "risk": _risk(hrp, "Risk of Inadequate Sleep and Irregular Schedules"),
         "review_note": "EEG is conventional electrodes (normal sleep vs sleep deprivation, one subject); the evoked "
                        "field is from real QuSpin OPMs. Neither is an astronaut."},
        {"id": "blood", "label": "Blood: renin (quantum-dot nanosensor)", "device": "qd_renin",
         "reading": specs["qd_renin"]["detection_limit"], "supporting": [renin_nf],
         "supporting_labels": ["Inspiration4 renin"], "evidence": "EARTH_ONLY",
         "data": ["recorded/qd_fret_figshare5468838.json", "nasa_i4.json"], "physics": ["physics.qd_fret_vs_distance"],
         "risk": _risk(hrp, "Risk of Cardiovascular Adaptations"),
         "review_note": "The sensor's detection limit is shown; no astronaut renin or ROS value is in open data, and the "
                        "readout is a TIRF microscope (lab assay)."},
        {"id": "skin_patch", "label": "Skin patch: bilirubin", "device": "cqd_patch",
         "reading": bil or missing("mg/dL", "", "recorded", "NOT_YET_EXTRACTED"),
         "supporting": [specs["cqd_patch"]["analyte"]], "supporting_labels": ["patch analyte"],
         "evidence": "EARTH_ONLY", "badge": "NASA data" if bil else None,
         "data": ["nasa_i4.json", "recorded/cqd_pl_mendeley_cmfbrvrb8y.json"], "physics": ["physics.cqd_quenching"],
         "risk": None,
         "review_note": "Inspiration4 serum bilirubin (drawn on the ground before and after flight) is the astronaut "
                        "reference; the patch reads skin interstitial fluid and has not flown."},
        {"id": "tumor", "label": "Tumour risk: space radiation", "device": "environment",
         "reading": rad.get("flux_ge10MeV_pfu") or nf("pfu", "no GOES sample in the latest snapshot"),
         "supporting": [rad["noaa_s_scale"]] if rad.get("noaa_s_scale") else [],
         "supporting_labels": ["NOAA solar radiation storm level"], "evidence": "SOURCED",
         "data": ["live_snapshot.json (radiation)"], "physics": [],
         "risk": _risk(hrp, "Risk of Radiation-Induced Cancers"),
         "review_note": "Proton flux measured by GOES at geostationary orbit: exposure context, not a tumour "
                        "measurement."},
        {"id": "lung", "label": "Lungs: cabin CO2 and O2", "device": "environment",
         "reading": co2 or nf("mmHg", "ISS cabin telemetry only for the ISS location and only from the running server"),
         "supporting": [o2] if o2 else [], "supporting_labels": ["cabin ppO2"],
         "evidence": "TO_CONFIRM" if co2 else "TO_CONFIRM",
         "data": ["live_snapshot.json (iss_cabin)"], "physics": [],
         "risk": [r for r in (_risk(hrp, "Risk of Hypoxia"),
                              _risk(hrp, "Risk of Reduced Cardiorespiratory and Musculoskeletal Fitness")) if r],
         "review_note": "ISS vehicle telemetry, not crew data, and not a lung measurement; units to confirm."},
    ]


def clinical_card(specs, live, derived, hrp, i4):
    locs = {l["id"]: l for l in read_json(DATA / "locations.json", {}).get("locations", [])}
    ready = (live or {}).get("opm_readiness", {})
    bias = vo(1.0, "mT", "Omar et al., arXiv 2601.18843, Section 4", "published_spec", "VERIFIED", None,
              "ZAQuant permanent magnet and Q.ANT Halbach ring, 'approximately 1 mT'")
    card = {}
    for loc in LOCATION_IDS:
        amb = (locs.get(loc) or {}).get("ambient_field_nT") or missing("nT", "no location data", "calculated",
                                                                       "NOT_YET_EXTRACTED")
        rd = ready.get(loc, {})
        sf = rd.get("shielding_factor") or missing("×", "no live snapshot", "calculated", "NOT_YET_EXTRACTED")
        within = rd.get("within_range")
        rows = [
            {"label": "OPM: ambient magnetic field here", "reading": amb, "evidence": evidence(amb),
             "review_note": ("No cited measured field for this location yet." if amb.get("value") is None else
                             f"Field from {amb['source']}.")},
            {"label": "OPM: field reduction needed (ambient ÷ ±5 nT range)", "reading": sf,
             "evidence": evidence(sf, earth=True),
             "review_note": ("Not computable without an ambient field." if sf.get("value") is None else
                             f"OPM needs about {sf['value']:,.0f}× field reduction here." if sf["value"] > 1 else
                             "Ambient field is inside the OPM's ±5 nT range; QuSpin still specifies a shielded or "
                             "field-controlled setup.")},
            {"label": "OPM: inside ±5 nT range", "reading": calc(None if within is None else ("yes" if within else "no"),
                                                                "", [amb, sf], "ambient_nT <= 5", [f"{loc}.ambient_nT"]),
             "evidence": "TO_CONFIRM" if within is None else "EARTH_ONLY",
             "review_note": "Uses the external field; cabin fields are larger (OSCAR-QUBE reported interference "
                            "from station equipment)."},
        ]
        ratio = None if amb.get("value") in (None, 0) else round(bias["value"] * 1e6 / amb["value"], 1)
        rows.append({"label": "NV: own bias field against the ambient field",
                     "reading": calc(ratio, "×", [bias, amb], "ratio = 1 mT / ambient field", ["specs.nv.zaquant.bias_field",
                                                                                              f"{loc}.ambient_nT"]),
                     "evidence": "TO_CONFIRM" if ratio is None else "EARTH_ONLY",
                     "review_note": "The ZAQuant and Q.ANT builds bring their own ~1 mT bias, so ambient field "
                                    "strength doesn't stop them; the JGU build ran at zero bias in a multilayer shield."})
        for b, label in (("jgu", "JGU"), ("zaquant", "ZAQuant"), ("qant", "Q.ANT")):
            snr = derived["per_build"][b]["averaged_snr"] if derived else missing("", "", "calculated", "NOT_YET_EXTRACTED")
            nb = specs["nv"][b]["beats_averaged"]["value"]
            rows.append({"label": f"NV heartbeat ({label}): averaged SNR over {nb:,} beats", "reading": snr,
                         "evidence": evidence(snr, earth=True),
                         "review_note": "Single heartbeats are not resolved at these sensitivities; readings rely on "
                                        "averaging."})
        rows.append({"label": "Quantum-dot renin sensor: detection limit", "reading": specs["qd_renin"]["detection_limit"],
                     "evidence": "EARTH_ONLY",
                     "review_note": "The readout is a TIRF microscope, so this is a lab assay, not a wearable."})
        bil = i4_bilirubin_summary(i4)
        if bil:
            rows.append({"label": "Carbon-dot patch analyte: Inspiration4 total bilirubin", "reading": bil,
                         "evidence": "EARTH_ONLY", "badge": "NASA data",
                         "review_note": "Inspiration4 blood was drawn on the ground before and after the flight; the "
                                        "patch itself has not flown."})
        else:
            rows.append({"label": "Carbon-dot patch analyte: bilirubin",
                         "reading": missing("mg/dL", "NASA OSDR Inspiration4 open data", "recorded", "NOT_YET_EXTRACTED",
                                            "not found in open Inspiration4 data"),
                         "evidence": "TO_CONFIRM", "review_note": "not found in open Inspiration4 data"})
        for h in (hrp or {}).get("hazards", []):
            rows.append({"label": "NASA human spaceflight hazard",
                         "reading": vo(h["text"], "", h["source"], "published_spec", "VERIFIED"),
                         "evidence": "SOURCED", "review_note": "Quoted word for word from NASA."})
        card[loc] = {"main": main_rows(loc, specs, live, derived, hrp, i4), "rows": rows}
    obj = {"meta": meta(False, ["data/locations.json", "data/live_snapshot.json", "data/specs.json",
                                "data/nv_heart_derived.json", "data/hrp.json", "data/nasa_i4.json"],
                        note="Crew role is a display label only; it changes no numbers. Review notes say what a flight "
                             "surgeon may want to look at; nothing here is a diagnosis."),
           **card}
    write_json(DATA / "clinical_card.json", obj)
    log_status("data/clinical_card.json", "done", f"{len(card)} locations, {len(card[LOCATION_IDS[0]]['rows'])} rows each")
    return obj


def main():
    import os
    specs = read_json(DATA / "specs.json")
    # build_all.py hands over its own fresh live cycle, so another server process writing the snapshot file at the
    # same moment cannot change what this build reads
    live = read_json(Path(os.environ["SPINDRIFT_LIVE_JSON"]), {}) if os.environ.get("SPINDRIFT_LIVE_JSON") else \
        read_json(DATA / "live_snapshot.json", {})
    live = None if live.get("meta", {}).get("fixture") else live
    derived = nv_heart_derived(specs)
    physics()
    pp = read_json(DATA / "published_points.json", {})
    if not pp or pp.get("meta", {}).get("fixture"):
        write_json(DATA / "published_points.json", {
            "meta": meta(False, ["doi:10.1021/ac302284s", "doi:10.1021/acsnano.4c06191"],
                         note="Both papers are paywalled. Points are added only by a person reading the figure, "
                              "each with figure and page; until then status stays 'awaiting'."),
            "qd_renin": {"status": "awaiting", "points": []}, "cqd_patch": {"status": "awaiting", "points": []}})
    build_log(specs, live)
    hrp = read_json(DATA / "hrp.json", {})
    i4 = read_json(DATA / "nasa_i4.json", {})
    clinical_card(specs, live, derived, None if hrp.get("meta", {}).get("fixture") else hrp,
                  None if i4.get("meta", {}).get("fixture") else i4)
    print("wrote nv_heart_derived.json, physics.json, build_log.json, clinical_card.json")


if __name__ == "__main__":
    main()
