"""Run engine (contract v10.1, Section 8): every run is a pass through all four devices with real work, and its new
facts are stacked onto the combined all-in-one quantum sensor.

What a run does (nothing is invented):
- OPM: processes the next real Kiel Cardio Database recording (175 in total: 7 subjects x 25 positions), so each
  run measures the heart field (R-peak, Q wave) at a new real sensor position; field reduction needed at the
  location (calculated from the location's field and the ±5 nT range).
- NV: one real call to the ODMR-Lab online simulator with the published ~1 mT bias plus the location's field
  vector (simulated output); averaged SNR of each NV build against this run's real R-peak and Q wave.
- Quantum-dot renin: the next row of the real figshare Table S1 (QD -> dye FRET efficiency) turned into r/R0 with
  the Förster equation; any newly pasted simulator result (FRET-Calc, nanoHUB).
- Carbon-dot patch: the next real Inspiration4 total-bilirubin timepoint (NASA OSDR OSD-575) and the next real
  measured carbon-dot emission record (Mendeley cmfbrvrb8y); any newly pasted MCX result.
- Links between devices (field clash, optical readouts, readout hardware, power), each a VO.
Static facts (specs) are added to the combined sensor once; facts from each run's new real data are added every
run. A device with nothing new records "no new data this run".
"""
from __future__ import annotations

import json
import math
import secrets
import threading

from server import odmr, realdata
from server.common import DATA, DEVICES, RECORDED, calc, meta, missing, now_iso, read_json, vo, write_json

LOCK = threading.Lock()
COMPONENTS = ["magnetic shielding", "field separation", "magnetic sensitivity", "optical readout", "microwave drive",
              "chemistry readout", "body signals (recorded)", "power", "size", "data link"]
NV_SRC = "Omar et al., arXiv 2601.18843 (2026)"
QS = "QuSpin QZFM Gen-3 product page, https://quspin.com/products-qzfm/"
INSIGHT_ENU = (1168.0, -1353.0, 925.0)  # east, north, up from Johnson et al. 2020 Table 1 (N -1353, E 1168, Down -925)


def _block(component, fact, value, device):
    return {"component": component, "fact": fact, "value": value, "device": device}


def _key(b):
    v = b["value"]
    return (b["component"], b["fact"], json.dumps(v.get("value")), v.get("as_of"))


def _empty_combined():
    return {"meta": meta(False, []), "version": 0, "runs_counted": 0,
            "components": {c: {"facts": [], "status": "open"} for c in COMPONENTS}, "open_questions": []}


def _ambient_vector_nT(location, live, locs):
    """(east, north, up) in nT for the ODMR-Lab input, with a note on where it came from."""
    if location == "iss" and (live.get("iss") or {}).get("b_total_nT", {}).get("components_enu_nT"):
        b = live["iss"]["b_total_nT"]
        return tuple(b["components_enu_nT"]), f"IGRF at the ISS position ({b['as_of']}), east/north/up"
    if location == "mars_transit" and live.get("l1"):
        l1 = live["l1"]
        comp = [l1[k]["value"] for k in ("bx_gsm_nT", "by_gsm_nT", "bz_gsm_nT")]
        if all(c is not None for c in comp):
            return tuple(comp), f"NOAA L1 field GSM x/y/z ({l1['bt_nT']['as_of']}, spacecraft {l1.get('spacecraft')})"
    if location == "mars_surface":
        return INSIGHT_ENU, "InSight measured surface field (Johnson et al. 2020, Table 1), east/north/up"
    amb = next((l["ambient_field_nT"] for l in locs if l["id"] == location), None)
    if amb and isinstance(amb.get("value"), (int, float)):
        return (0.0, 0.0, float(amb["value"])), f"{amb['source']} (magnitude only; direction app_default +z)"
    return (0.0, 0.0, 0.0), "no measured field for this location; bias only"


def execute(location: str, role: str, live: dict) -> dict:
    with LOCK:
        return _execute(location, role, live or {})


def _execute(location, role, live):
    runs = read_json(DATA / "runs.json", {})
    if not runs or runs.get("meta", {}).get("fixture"):
        runs = {"meta": meta(False, []), "runs": []}
    comb = read_json(DATA / "combined_sensor.json", {})
    if not comb or comb.get("meta", {}).get("fixture"):
        comb = _empty_combined()
    n = len(runs["runs"])
    run_id = f"run-{n + 1:04d}-{secrets.token_hex(2)}"
    specs = read_json(DATA / "specs.json")
    derived = read_json(DATA / "nv_heart_derived.json")
    sims = read_json(DATA / "simulators.json", {})
    locs = read_json(DATA / "locations.json", {}).get("locations", [])
    inputs = {d: [] for d in DEVICES}
    outputs = {d: [] for d in DEVICES}
    links, blocks, notes, errors = [], [], {}, []
    open_q = set(comb.get("open_questions", []))

    rd = (live.get("opm_readiness") or {}).get(location) or {}
    amb = rd.get("ambient_nT") or next((l["ambient_field_nT"] for l in locs if l["id"] == location),
                                       missing("nT", "no data", "recorded", "NOT_STATED"))
    sf = rd.get("shielding_factor")
    rng = specs["opm"]["dynamic_range"]

    # ---------------------------------------------------------------- OPM
    inputs["opm"] += [amb, rng]
    if sf and sf.get("value") is not None:
        outputs["opm"].append(sf)
        blocks.append(_block("magnetic shielding", f"OPM field reduction needed at {location}", sf, "opm"))
    else:
        open_q.add(f"No measured magnetic field for {location}, so the OPM shielding need there is unknown.")
    subject, trial = realdata.kiel_slice(n)
    try:
        kb = realdata.kiel_beat(subject, trial)
        src = (f"Kiel Cardio Database v1.0.0 (PhysioNet, CC BY-SA 4.0), {kb['record']}, {kb['channel']}, sensor at "
               f"{kb['sensor_position_cm']} cm")
        r_vo = vo(kb["r_peak_pT"], "pT", src, "calculated", "VERIFIED", None,
                  f"formula: mean of {kb['beats']} beats at the R-peak (2-62 s window, clearest channel); inputs: "
                  f"{kb['record']} (sha256 {kb['sha256'][:12]}...)")
        q = kb["qrs"]
        q_vo = vo(q["q_pT"], "pT", src, "calculated", "VERIFIED", None,
                  f"formula: {q['rule']}; Q {q['q_ms_before_r']} ms before R, QRS {q['qrs_ms']} ms; inputs: {kb['record']}")
        outputs["opm"] += [r_vo, q_vo]
        blocks.append(_block("body signals (recorded)",
                             f"OPM heart field, subject {subject} position {trial}: R-peak", r_vo, "opm"))
        blocks.append(_block("body signals (recorded)",
                             f"OPM heart field, subject {subject} position {trial}: Q wave", q_vo, "opm"))
    except Exception as e:
        kb, r_vo, q_vo = None, None, None
        errors.append(f"Kiel record s{subject} t{trial}: {type(e).__name__}: {e}")
    blocks += [
        _block("magnetic shielding", "OPM built-in coils cancel residual fields up to 50 nT",
               vo(50, "nT", "QuSpin technology page, https://quspin.com/technology/", "datasheet", "VERIFIED"), "opm"),
        _block("power", "OPM sensor-head power", specs["opm"]["head_power"], "opm"),
        _block("power", "OPM total power (head + electronics)", specs["opm"]["total_power"], "opm"),
        _block("size", "OPM sensor head", specs["opm"]["sensor_head"], "opm"),
        _block("data link", "OPM outputs", specs["opm"]["outputs"], "opm"),
        _block("data link", "OPM latency", specs["opm"]["latency"], "opm"),
        _block("optical readout", "OPM: one laser beam through a rubidium vapor cell onto a photodiode",
               specs["opm"]["quantum_effect"], "opm"),
    ]
    eeg = read_json(RECORDED / "eeg_brain_ds004902.json", {})
    if eeg.get("alpha_8_12Hz_uV2_per_Hz"):
        a = eeg["alpha_8_12Hz_uV2_per_Hz"]
        blocks.append(_block("body signals (recorded)", "EEG alpha power, eyes closed (conventional electrodes, "
                                                       "for comparison with OPM-MEG)",
                             vo(", ".join(f"{k}: {v} uV^2/Hz" for k, v in a.items()), "uV^2/Hz",
                                "OpenNeuro ds004902 sub-01 (CC0), data/recorded/eeg_brain_ds004902.json", "calculated",
                                "VERIFIED", None, "formula: Welch PSD mean 8-12 Hz over O1/Oz/O2, 300 s"), "opm"))
    meg = read_json(RECORDED / "opm_brain_mne.json", {})
    if meg.get("evoked"):
        ev = meg["evoked"]
        best = max(((abs(v), s["name"], i) for s in ev["series"] for i, v in enumerate(s["values"])
                    if 0.01 < ev["x"]["values"][i] < 0.1), default=None)
        if best:
            amp, name, i = best
            s = next(s for s in ev["series"] if s["name"] == name)
            blocks.append(_block("body signals (recorded)", "OPM-MEG somatosensory evoked field peak (MNE OPM sample)",
                                 vo(s["values"][i], "fT", "MNE-Python OPM sample, data/recorded/opm_brain_mne.json",
                                    "calculated", "VERIFIED", None,
                                    f"formula: largest |evoked| 10-100 ms after stimulus; {name} at "
                                    f"{ev['x']['values'][i] * 1000:.0f} ms; {ev['n_epochs']} epochs"), "opm"))

    # ---------------------------------------------------------------- NV
    bias = vo(1.0, "mT", NV_SRC + ", Section 4", "published_spec", "VERIFIED", None, "approximately 1 mT")
    inputs["nv"] += [bias, amb]
    clash = calc(round(bias["value"] * 1e-3 / 5e-9), "×", [bias, rng], "ratio = 1 mT / 5 nT",
                 ["specs.nv.zaquant.bias_field", "specs.opm.dynamic_range"])
    links.append({"from": "opm", "to": "nv", "fact": "OPM needs |B| <= 5 nT; the NV builds carry a ~1 mT bias",
                  "value": clash})
    blocks.append(_block("field separation", "OPM ±5 nT range against the NV ~1 mT bias", clash, "link"))
    if amb.get("value"):
        ratio = calc(round(bias["value"] * 1e6 / amb["value"], 1), "×", [bias, amb], "ratio = 1 mT / ambient field",
                     ["specs.nv.zaquant.bias_field", f"{location}.ambient_nT"], as_of=amb.get("as_of"))
        outputs["nv"].append(ratio)
        links.append({"from": "nv", "to": "opm", "fact": f"NV bias against the ambient field at {location}",
                      "value": ratio})
        blocks.append(_block("field separation", f"NV bias against the ambient field at {location}", ratio, "nv"))
    vec, vec_note = _ambient_vector_nT(location, live, locs)
    b_sent = (vec[0] * 1e-6, vec[1] * 1e-6, bias["value"] + vec[2] * 1e-6)
    try:
        res = odmr.solve(b_sent, f"odmr_lab_{run_id}")
        res["inputs_note"] = f"bias +z (app_default) plus {vec_note}"
        outputs["nv"] += [v for v in (res["b_true_mT"], res["b_cnn_mT"]) if v]
        if res["b_cnn_mT"]:
            blocks.append(_block("microwave drive", f"ODMR-Lab run at {location}: field estimated from the simulated "
                                                    "NV spectrum", res["b_cnn_mT"], "nv"))
    except Exception as e:
        res = None
        errors.append(f"ODMR-Lab: {type(e).__name__}: {e}")
    if kb and derived:
        for b in ("jgu", "zaquant", "qant"):
            avn = derived["per_build"][b]["averaged_noise_pT"]
            for label, sig in (("R-peak", r_vo), ("Q wave", q_vo)):
                snr = calc(round(abs(sig["value"]) / avn["value"], 2), "", [sig, avn],
                           f"SNR = |{label} measured this run| / averaged noise", [f"runs.{run_id}.opm.{label}",
                                                                                   f"nv_heart_derived.{b}.averaged_noise_pT"])
                outputs["nv"].append(snr)
                blocks.append(_block("magnetic sensitivity", f"{b.upper()} NV averaged SNR on the {label} of subject "
                                                             f"{subject} position {trial}", snr, "nv"))
    blocks += [
        _block("microwave drive", "JGU: 2.87 GHz microwave mixed with 2.16 MHz, custom PCB antenna",
               specs["nv"]["jgu"]["microwave"], "nv"),
        _block("microwave drive", "ZAQuant: microwaves amplified into a loop antenna", specs["nv"]["zaquant"]["microwave"],
               "nv"),
        _block("microwave drive", "Q.ANT: FPGA microwave generation", specs["nv"]["qant"]["microwave"], "nv"),
        _block("optical readout", "ZAQuant: green excitation, fluorescence through a 695 nm long-pass filter, balanced "
                                  "photodetection", specs["nv"]["zaquant"]["detector"], "nv"),
        _block("size", "NV active sensing volume", specs["nv"]["headline"]["sensing_volume"], "nv"),
        _block("size", "Q.ANT NV head", specs["nv"]["qant"]["head_size"], "nv"),
        _block("power", "NV magnetometer that flew on the ISS (OSCAR-QUBE): power",
               specs["space_heritage"]["oscar_qube"]["power"], "nv"),
        _block("size", "NV magnetometer that flew on the ISS (OSCAR-QUBE): mass",
               specs["space_heritage"]["oscar_qube"]["mass"], "nv"),
        _block("data link", "Q.ANT readout", specs["nv"]["qant"]["readout"], "nv"),
    ]

    # ---------------------------------------------------------------- quantum-dot renin
    fig = read_json(RECORDED / "qd_fret_figshare5468838.json", {})
    blocks += [
        _block("chemistry readout", "Renin nanosensor detection limit", specs["qd_renin"]["detection_limit"], "qd_renin"),
        _block("chemistry readout", "Renin nanosensor readout", specs["qd_renin"]["readout"], "qd_renin"),
    ]
    inputs["qd_renin"].append(specs["qd_renin"]["detection_limit"])
    if fig.get("series"):
        k = n % len(fig["x"]["values"])
        p = fig["x"]["values"][k]
        e_pct = next(s for s in fig["series"] if s["name"] == "FRET efficiency")["values"][k]
        e_vo = vo(e_pct, "%", "figshare c.5468838 Table S1 (CdTe/CdS -> rhodamine 101, CC BY 4.0)", "recorded",
                  "VERIFIED", None, f"at {p:g} GPa; CdTe/CdS quantum dots, not the renin sensor")
        r_ratio = calc(round((1.0 / (e_pct / 100.0) - 1.0) ** (1 / 6), 3), "r/R0", [e_vo],
                       "r/R0 = (1/E - 1)^(1/6) (Förster, FRET-Calc Eq. 2)", ["recorded.qd_fret_figshare5468838"])
        inputs["qd_renin"].append(e_vo)
        outputs["qd_renin"].append(r_ratio)
        blocks.append(_block("chemistry readout", f"Measured QD -> dye FRET efficiency at {p:g} GPa", e_vo, "qd_renin"))
        blocks.append(_block("chemistry readout", f"Donor-acceptor distance implied at {p:g} GPa", r_ratio, "qd_renin"))
    links.append({"from": "nv", "to": "qd_renin", "fact": "Both read out optically",
                  "value": vo("NV: green excitation, red fluorescence above 695 nm (ZAQuant); renin QD: Cy5 "
                              "fluorescence counted by TIRF microscopy", "", NV_SRC + "; doi:10.1021/ac302284s",
                              "published_spec", "VERIFIED")})

    # ---------------------------------------------------------------- carbon-dot patch
    i4 = read_json(DATA / "nasa_i4.json", {})
    blocks += [
        _block("chemistry readout", "Patch analyte", specs["cqd_patch"]["analyte"], "cqd_patch"),
        _block("data link", "Patch reader", specs["cqd_patch"]["readout"], "cqd_patch"),
        _block("optical readout", "Patch reader channels", specs["cqd_patch"]["reader_channels"], "cqd_patch"),
    ]
    variables = [v for d in i4.get("datasets", []) for v in d["variables"]]
    if variables:
        tps = []
        for v in variables:
            for pnt in v["points"]:
                if pnt["timepoint"] not in tps:
                    tps.append(pnt["timepoint"])
        tp = tps[n % len(tps)]
        vals = []
        for v in variables:
            pnt = next((x for x in v["points"] if x["timepoint"] == tp), None)
            if pnt:
                vals.append(f"{v['name'].split()[-1]} {pnt['value']['value'] if pnt['value']['value'] is not None else 'NA'}")
        bil = vo(", ".join(vals), "mg/dL", "NASA OSDR OSD-575 (Inspiration4 CMP, total bilirubin)", "recorded",
                 "VERIFIED", None, f"timepoint {tp} (days from launch L- or return R+); drawn on the ground")
        inputs["cqd_patch"].append(bil)
        outputs["cqd_patch"].append(bil)
        blocks.append(_block("body signals (recorded)", f"Inspiration4 total bilirubin at {tp}", bil, "cqd_patch"))
    men = read_json(RECORDED / "cqd_pl_mendeley_cmfbrvrb8y.json", {})
    if men.get("series"):
        j = n % len(men["x"]["values"])
        ex, em = men["x"]["values"][j], men["series"][0]["values"][j]
        e_vo = vo(f"excited at {ex:g} nm, emits at {em:g} nm", "nm", "Mendeley Data doi:10.17632/cmfbrvrb8y.1 "
                  "(CC BY 4.0), external measurement records", "recorded", "VERIFIED", None,
                  f"record {j + 1} of {len(men['x']['values'])}; general carbon dots, not the patch")
        outputs["cqd_patch"].append(e_vo)
        blocks.append(_block("optical readout", f"Measured carbon-dot emission, record {j + 1}", e_vo, "cqd_patch"))
    links.append({"from": "qd_renin", "to": "cqd_patch", "fact": "Both use fluorescent dots; readout hardware differs",
                  "value": vo("TIRF microscope (renin) vs wearable IoT reader (patch)", "",
                              "doi:10.1021/ac302284s; doi:10.1021/acsnano.4c06191", "published_spec", "VERIFIED")})
    links.append({"from": "opm", "to": "cqd_patch", "fact": "Shared power budget",
                  "value": vo("OPM 5 W total; NV, quantum-dot and patch-reader power unspecified in source", "W",
                              QS + "; " + NV_SRC, "published_spec", "VERIFIED")})
    open_q.add("NV, quantum-dot readout and patch-reader power are unspecified in their sources.")
    open_q.add("The OPM needs a field of a few nT while the NV builds carry ~1 mT: how far apart, or how shielded, "
               "must they sit in one unit?")
    open_q.add("The renin readout needs a TIRF microscope; no wearable quantum-dot renin reader exists in the source.")

    # ---------------------------------------------------------------- simulator results pasted since the last run
    last_run_at = runs["runs"][-1]["started_at"] if runs["runs"] else ""
    sim_wait = set()
    for dev in ("opm", "qd_renin", "cqd_patch"):
        for e in sims.get(dev, []):
            for r in e.get("results", []):
                if r.get("via") == "pasted" and r["run_at"] > last_run_at:
                    sv = vo(json.dumps(r["outputs"])[:400], "", f"{e['tool']} ({e['url']}), pasted result", "simulated",
                            "VERIFIED", None, f"pasted {r['run_at']}")
                    outputs[dev].append(sv)
                    blocks.append(_block("optical readout" if dev != "qd_renin" else "chemistry readout",
                                         f"{e['tool']} result", sv, dev))
        if not any(e.get("results") for e in sims.get(dev, [])):
            sim_wait.add(dev)

    # ---------------------------------------------------------------- stack the new blocks
    existing = {(c, f["fact"], json.dumps(f["value"].get("value")), f["value"].get("as_of"))
                for c, comp in comb["components"].items() for f in comp["facts"]}
    new = []
    for b in blocks:
        if b["value"] is None or b["value"].get("value") is None:
            continue
        if _key(b) in existing:
            continue
        existing.add(_key(b))
        new.append(b)
        comp = comb["components"].setdefault(b["component"], {"facts": [], "status": "open"})
        comp["facts"].append({"fact": b["fact"], "value": b["value"], "from_run": run_id, "device": b["device"]})
    for comp in comb["components"].values():
        comp["status"] = "sourced" if any(f["value"].get("value") is not None for f in comp["facts"]) else "open"
    for d in DEVICES:
        msgs = []
        if not any(b["device"] == d for b in new):
            msgs.append("no new data this run")
        if d in sim_wait:
            msgs.append("awaiting simulator run")
        if msgs:
            notes[d] = "; ".join(msgs)
    comb["version"] += 1
    comb["runs_counted"] += 1
    comb["open_questions"] = sorted(open_q)
    comb["meta"] = meta(False, ["data/runs.json"], last_run=run_id)
    run = {"run_id": run_id, "started_at": now_iso(), "location": location, "role": role,
           "inputs": inputs, "outputs": outputs, "links": links,
           "adds_to_combined": [{"component": b["component"], "fact": b["fact"], "value": b["value"]} for b in new],
           "notes": notes, "errors": errors,
           "real_work": {"kiel_record": kb["record"] if kb else None, "odmr_lab": res,
                         "figshare_row": (n % len(fig["x"]["values"])) + 1 if fig.get("x") else None}}
    runs["runs"].append(run)
    runs["meta"] = meta(False, ["server/runs.py"], runs=len(runs["runs"]))
    write_json(DATA / "runs.json", runs)
    write_json(DATA / "combined_sensor.json", comb)
    return {"run": run, "combined": comb}
