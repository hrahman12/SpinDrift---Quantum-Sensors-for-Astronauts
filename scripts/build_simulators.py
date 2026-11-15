"""Build data/simulators.json (contract v10, Section 6) and run the ODMR-Lab API (the one automated
simulator call). Every other simulator is a link plus an input list that a person runs in a browser;
results are pasted back through POST /api/simulators/{device}. Nothing is installed or run locally.

Existing results are kept. ODMR-Lab runs A and B are only called again with --rerun-odmr.
Simulator output is tagged `simulated` and is never called live or recorded.
"""
import base64
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.common import DATA, DEVICES, log_status, meta, now_iso, read_json, vo, write_json  # noqa: E402

OUT = DATA / "simulator_outputs"
NV = "Omar et al., arXiv 2601.18843 (2026)"
QS = "QuSpin QZFM Gen-3 product page, https://quspin.com/products-qzfm/"
QS_TECH = "QuSpin technology page, https://quspin.com/technology/"
ODMR_APP = "ODMR-Lab app.py (https://huggingface.co/spaces/jeorgexyz/odmr-lab/blob/main/app.py), slider default"


def src_in(name, value, unit, source, note=None, status="VERIFIED"):
    return {"name": name, "value": vo(value, unit, source, "published_spec", status, None, note),
            "origin": "spindrift_source"}


def app_in(name, value, unit, source=ODMR_APP, note=None):
    return {"name": name, "value": vo(value, unit, source, "simulated", "VERIFIED", None, note or "app default"),
            "origin": "app_default"}


ODMR_RUNS = {
    "A": {"label": "Run A, ZAQuant/Q.ANT operating point", "b": (0.0, 0.0, 1.0)},
    "B": {"label": "Run B, JGU zero bias", "b": (0.0, 0.0, 0.0)},
}
ODMR_DEFAULTS = {"contrast": 0.03, "linewidth": 6.0, "photon_log": 6.3, "temp": 300.0, "strain": 2.0, "seed": 0,
                 "run_nlls": True}


def catalogue():
    return {
        "nv": [
            {"tool": "ODMR-Lab", "url": "https://huggingface.co/spaces/jeorgexyz/odmr-lab", "access": "browser_and_api",
             "account_needed": False,
             "models": "Ensemble NV ODMR spectrum from the ground-state Hamiltonian H = D(T)Sz^2 + E(Sx^2 - Sy^2) + "
                       "gamma B.S (D 2870 MHz, dD/dT -74 kHz/K, gamma 28.025 MHz/mT, 14N hyperfine A 2.16 MHz, four "
                       "<111> axes, 24 lines) with photon shot noise; a trained 1D residual CNN and a nonlinear "
                       "least-squares fit then estimate the four axis projections and |B|.",
             "limits": "Per its README: trained and evaluated on synthetic spectra, not validated on measured spectra; "
                       "no microwave power broadening, laser intensity noise or frequency-calibration error; field "
                       "slider step 0.05 mT (range -4 to 4 mT); linewidth slider minimum 2 MHz. MIT licence, created "
                       "September 2026. The spectrum shows the sensor's operating point, not a heartbeat.",
             "inputs": [
                 src_in("Run A field magnitude |B|", 1.0, "mT", NV + ", Section 4 (ZAQuant and Q.ANT bias ~1 mT)",
                        "published bias is approximately 1 mT"),
                 app_in("Run A field direction", "(0, 0, 1)", "unit vector", "SpinDrift choice",
                        "direction of the bias is not stated in the paper; +z chosen, marked app_default"),
                 src_in("Run B field (bx, by, bz)", "(0, 0, 0)", "mT", NV + ", Section 4 and Table 2 (JGU zero DC bias)"),
                 app_in("contrast", 0.03, ""), app_in("linewidth", 6.0, "MHz"),
                 app_in("photon rate", 6.3, "log10 per s"), app_in("temperature", 300, "K"),
                 app_in("E strain", 2.0, "MHz"), app_in("noise seed", 0, ""),
                 app_in("run NLLS baseline", "true", ""),
             ],
             "missing_inputs": [
                 "per-build ODMR contrast, photon rate and strain: not stated in arXiv 2601.18843",
                 "ZAQuant resonance linewidth ~200 kHz (arXiv 2601.18843, p. 8) is below the Space's 2 MHz minimum, "
                 "so the app default 6 MHz was used",
                 "bias field direction relative to the NV axes: not stated",
             ],
             "results": []},
            {"tool": "SimOS Virtual Lab", "url": "https://simos.kherb.io/virtual/lab/index.html?path=Welcome.ipynb",
             "access": "browser", "account_needed": False,
             "models": "NV centre ODMR and spin dynamics with the SimOS library, in a Jupyter notebook that runs in "
                       "the browser (Pyodide/WebAssembly). Linked from https://simos.readthedocs.io.",
             "limits": "Manual run. Code executes in the visitor's browser; results depend on the notebook the person "
                       "writes. SpinDrift does not run it.",
             "inputs": [
                 src_in("bias field", 1.0, "mT", NV + ", Section 4", "approximately 1 mT (ZAQuant, Q.ANT)"),
                 src_in("zero-field splitting D", 2870, "MHz",
                        "Doherty et al., Phys. Rep. 528, 1 (2013), doi:10.1016/j.physrep.2013.02.001",
                        "room-temperature value", "TO_CONFIRM"),
                 src_in("gyromagnetic ratio gamma", 28.025, "MHz/mT",
                        "Doherty et al., Phys. Rep. 528, 1 (2013); value as used by ODMR-Lab odmr.py", None,
                        "TO_CONFIRM"),
             ],
             "missing_inputs": ["contrast, linewidth and laser/microwave powers of the three NV builds: not stated"],
             "results": []},
        ],
        "opm": [
            {"tool": "SimuFísica Bloch Equation Generator",
             "url": "https://simufisica.com/en/tools/bloch-equation-generator/", "access": "browser",
             "account_needed": False,
             "models": "Optical Bloch equations for up to 30 atomic levels; its paper (arXiv 2506.01108) works a "
                       "rubidium-87 example. Models the atom-light physics, not the full OPM.",
             "limits": "Manual run. No vapor-cell, buffer-gas, spin-exchange or magnetometer-readout model.",
             "inputs": [
                 src_in("atomic species", "rubidium", "", QS),
                 src_in("field range at the sensor", "±5", "nT", QS, "QZFM dynamic range"),
                 src_in("zero-field resonance width", "~30", "nT", QS_TECH,
                        "'typically about 30 nT wide'; whether this is the full or half width is not stated",
                        "TO_CONFIRM"),
                 src_in("modulation field frequency", "1", "kHz", QS_TECH, "'A small 1 kHz modulation field'"),
                 src_in("vapor-cell temperature", "~150", "°C", QS_TECH),
             ],
             "missing_inputs": ["rubidium isotope used in the QZFM", "laser wavelength, power and detuning",
                                "cell dimensions and buffer gas", "relaxation rates"],
             "results": []},
            {"tool": "DRCMR Bloch Simulator", "url": "https://www.drcmr.dk/BlochSimulator/", "access": "browser",
             "account_needed": False,
             "models": "Spin precession and relaxation in magnetic fields (Bloch equations), built for MRI and NMR "
                       "teaching.",
             "limits": "Manual run. Classical magnetisation only; no optical pumping or atomic level structure.",
             "inputs": [
                 src_in("field range at the sensor", "±5", "nT", QS, "QZFM dynamic range"),
                 src_in("rubidium precession rate", 6.998, "Hz/nT", QS_TECH,
                        "QuSpin states 6.998 Hz per nT for its QTFM rubidium magnetometer", "TO_CONFIRM"),
             ],
             "missing_inputs": ["T1 and T2 of the QZFM vapor cell: not stated"],
             "results": []},
        ],
        "qd_renin": [
            {"tool": "nanoHUB Quantum Dot Lab", "url": "https://nanohub.org/tools/qdot", "access": "browser",
             "account_needed": True,
             "models": "Confinement energy levels and optical transitions for dot shapes such as boxes, domes and "
                       "pyramids.",
             "limits": "Manual run with a free nanoHUB account. Approximate for round colloidal core/shell dots.",
             "inputs": [],
             "missing_inputs": ["quantum-dot material and size: not stated in doi:10.1021/ac302284s (abstract)"],
             "results": []},
            {"tool": "FRET-Calc", "url": "https://nanocalc.org/fretcalc", "access": "browser", "account_needed": False,
             "models": "Spectral overlap integral, Förster radius R0, FRET efficiency and rate from the donor "
                       "emission spectrum, acceptor absorption spectrum and refractive index (arXiv 2311.15476).",
             "limits": "Manual run. Any quantum dot chosen is a labelled stand-in because the paper's dot is not "
                       "stated. Spectra: Thermo Fisher Fluorescence SpectraViewer or FluoroFinder list Qdot "
                       "nanocrystals and Cy5.",
             "inputs": [src_in("acceptor", "Cy5", "", "doi:10.1021/ac302284s (abstract)")],
             "missing_inputs": ["donor quantum-dot emission spectrum (dot not stated)",
                                "Cy5 absorption spectrum file (not yet downloaded)",
                                "refractive index of the medium", "orientation factor kappa^2"],
             "results": []},
        ],
        "cqd_patch": [
            {"tool": "MCX Cloud", "url": "http://mcx.space/cloud", "access": "browser", "account_needed": None,
             "models": "In-browser Monte Carlo simulation of light transport through tissue. It models how the "
                       "reader's light travels through skin, not the carbon-dot chemistry; no online simulator exists "
                       "for the carbon-dot chemistry.",
             "limits": "Manual run. Launch limits (2021): 10 million photons, volume up to 100 voxels per side, "
                       "1-minute jobs. An MCX JSON input is prepared only when every optical property has a citation.",
             "inputs": [src_in("reader wavelengths", "440, 470, 510", "nm",
                               "doi:10.1021/acsnano.4c06191", "full text paywalled", "TO_CONFIRM")],
             "missing_inputs": ["skin absorption coefficient at 440/470/510 nm (cited)",
                                "skin scattering coefficient at those wavelengths (cited)",
                                "anisotropy g (cited)", "refractive index (cited)"],
             "results": []},
        ],
    }


def odmr_call(b, defaults):
    from gradio_client import Client
    c = Client("jeorgexyz/odmr-lab", verbose=False)
    return c.predict(b[0], b[1], b[2], defaults["contrast"], defaults["linewidth"], defaults["photon_log"],
                     defaults["temp"], defaults["strain"], defaults["seed"], defaults["run_nlls"], api_name="/solve")


def run_odmr(entry, rerun=False):
    done = {r["outputs"].get("run") for r in entry["results"] if r.get("via") == "api"}
    OUT.mkdir(parents=True, exist_ok=True)
    for key, run in ODMR_RUNS.items():
        if key in done and not rerun:
            continue
        res, err = None, None
        for attempt in (1, 2):  # brief: if asleep, wait 60 s and retry once
            try:
                res = odmr_call(run["b"], ODMR_DEFAULTS)
                break
            except Exception as e:
                err = f"{type(e).__name__}: {e}"
                if attempt == 1:
                    time.sleep(60)
        if res is None:
            log_status("ODMR-Lab API", "failed", f"run {key}: {err}; results left empty")
            continue
        plot, table, note = res
        plot_file = None
        if isinstance(plot, dict) and isinstance(plot.get("plot"), str) and plot["plot"].startswith("data:image"):
            png = base64.b64decode(plot["plot"].split(",", 1)[1])
            plot_file = OUT / f"odmr_lab_run_{key}.png"
            plot_file.write_bytes(png)
        entry["results"].append({
            "run_at": now_iso(), "via": "api",
            "outputs": {"run": key, "label": run["label"],
                        "inputs_used": {"bx": run["b"][0], "by": run["b"][1], "bz": run["b"][2], **ODMR_DEFAULTS},
                        "table": table, "note": note,
                        "plot_file": str(plot_file.relative_to(DATA.parent)).replace("\\", "/") if plot_file else None,
                        "tag": "simulated",
                        "caveat": "Simulated spectrum from an online simulator; not a measurement."}})
        log_status("ODMR-Lab API", "done", f"run {key} ({run['label']}) via /solve; plot saved: {bool(plot_file)}")


def main(rerun=False):
    old = read_json(DATA / "simulators.json", {})
    sims = catalogue()
    for dev in DEVICES:  # keep every earlier result (api and pasted)
        for entry in sims[dev]:
            prev = next((e for e in old.get(dev, []) if e.get("tool") == entry["tool"]), None)
            if prev:
                entry["results"] = prev.get("results", [])
    run_odmr(sims["nv"][0], rerun)
    obj = {"meta": meta(False, ["https://huggingface.co/spaces/jeorgexyz/odmr-lab", "arXiv 2601.18843",
                                "QuSpin product and technology pages", "doi:10.1021/ac302284s",
                                "doi:10.1021/acsnano.4c06191"]), **sims}
    write_json(DATA / "simulators.json", obj)
    n = sum(len(e["results"]) for d in DEVICES for e in sims[d])
    print(f"wrote simulators.json ({n} results)")
    return obj


if __name__ == "__main__":
    main(rerun="--rerun-odmr" in sys.argv)
