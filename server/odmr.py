"""One real call to the ODMR-Lab online simulator (MIT, huggingface.co/spaces/jeorgexyz/odmr-lab, endpoint /solve).

Used by the run engine: the field sent is the published NV bias (~1 mT, arXiv 2601.18843 Section 4) plus the
measured or modelled ambient field at the run's location. The bias direction is not stated in the paper, so +z
is used (app_default); ambient components are mapped onto the simulator's x, y, z as given (app_default
orientation). Output is tagged simulated: an online simulation, never a measurement.
"""
from __future__ import annotations

import base64
import re

from server.common import DATA, vo

DEFAULTS = {"contrast": 0.03, "linewidth": 6.0, "photon_log": 6.3, "temp": 300.0, "strain": 2.0, "seed": 0,
            "run_nlls": False}
SRC = "ODMR-Lab /solve, https://huggingface.co/spaces/jeorgexyz/odmr-lab (online simulator, MIT licence)"


def solve(b_mT: tuple[float, float, float], plot_name: str, attempts: int = 2) -> dict:
    from gradio_client import Client
    err = None
    for _ in range(attempts):
        try:
            c = Client("jeorgexyz/odmr-lab", verbose=False)
            plot, table, note = c.predict(b_mT[0], b_mT[1], b_mT[2], DEFAULTS["contrast"], DEFAULTS["linewidth"],
                                          DEFAULTS["photon_log"], DEFAULTS["temp"], DEFAULTS["strain"],
                                          DEFAULTS["seed"], DEFAULTS["run_nlls"], api_name="/solve")
            break
        except Exception as e:  # Space asleep or busy
            err = f"{type(e).__name__}: {e}"
    else:
        raise RuntimeError(f"ODMR-Lab unavailable: {err}")
    m = re.search(r"true\s+([\d.]+)\s*mT.*?CNN\s+([\d.]+)\s*mT", note or "")
    plot_file = None
    if isinstance(plot, dict) and str(plot.get("plot", "")).startswith("data:image"):
        out = DATA / "simulator_outputs" / f"{plot_name}.png"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(base64.b64decode(plot["plot"].split(",", 1)[1]))
        plot_file = f"data/simulator_outputs/{plot_name}.png"
    return {
        "b_sent_mT": [round(v, 6) for v in b_mT],
        "b_true_mT": vo(float(m.group(1)), "mT", SRC, "simulated", "VERIFIED", None,
                        "field magnitude the simulator used for its spectrum") if m else None,
        "b_cnn_mT": vo(float(m.group(2)), "mT", SRC, "simulated", "VERIFIED", None,
                       "field magnitude the simulator's neural network estimated from its simulated spectrum") if m else None,
        "table": table, "note": note, "plot_file": plot_file, "settings": DEFAULTS,
        "caveat": "Simulated spectrum from an online simulator. Not a measurement.",
    }
