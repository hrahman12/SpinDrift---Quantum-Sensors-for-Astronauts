"""Write data/specs.json and append one run to data/build_log.json.
Every value object carries a source. Items not yet checked against the vendor page are TO_CONFIRM."""
import json
from datetime import datetime, timezone
from pathlib import Path
DATA = Path(__file__).resolve().parent.parent / "data"
NOW = datetime.now(timezone.utc).isoformat(timespec="seconds")

def v(value, unit, source, tag="datasheet", status="TO_CONFIRM"):
    return {"value": value, "unit": unit, "source": source, "tag": tag, "status": status}

QZFM = "QuSpin QZFM Gen-3 spec, quspin.com/products-qzfm (as given in brief; not re-checked)"
specs = {
    "opm": {
        "sensitivity_dual_axis": v(15, "fT/rtHz (3-100 Hz)", QZFM),
        "sensitivity_triaxial": v(23, "fT/rtHz (3-100 Hz)", QZFM),
        "dynamic_range": v(5, "nT (+/-)", QZFM),
        "head_size": v("12.4 x 16.6 x 24.4", "mm", QZFM),
        "head_power": v(0.7, "W", QZFM),
        "total_power": v(5, "W", "HSE listing of QuSpin spec (as given in brief)"),
        "latency": v(5, "ms", QZFM),
        "cooling": v("none, room temperature", "", QZFM),
    },
    "nv": {
        "jgu": {
            "diamond": v("0.5 x 0.5 x 0.18 (truncated pyramid)", "mm", "arXiv 2601.18843 (as given in brief)", "published_spec"),
            "headline_noise": v("6-26", "pT/rtHz", "arXiv 2601.18843 abstract (verified title/date only)", "published_spec", "TO_CONFIRM"),
        },
        "zaquant": {"diamond": v("0.5 x 0.5 x 0.5", "mm", "arXiv 2601.18843 (as given in brief)", "published_spec")},
        "qant": {"diamond": v("1 x 1 x 0.5", "mm", "arXiv 2601.18843 (as given in brief)", "published_spec")},
        "headline": {"sensing_volume": v("<0.5", "mm^3", "arXiv 2601.18843 (as given in brief)", "published_spec")},
    },
    "qd_renin": {
        "detection_limit": v(25, "pM", "Long et al., Anal Chem 84(20):8846, doi:10.1021/ac302284s (as given in brief)", "published_spec"),
        "readout": v("TIRF single-molecule counting", "", "same", "published_spec", "VERIFIED"),
    },
    "cqd_patch": {
        "reader": v("IoT optoelectronic reader", "", "Tabatabaee et al., ACS Nano 2024, doi:10.1021/acsnano.4c06191", "published_spec", "VERIFIED"),
        "needle_dimensions": v(None, "", "NOT YET EXTRACTED (full text needed)", "published_spec", "NOT_YET_EXTRACTED"),
    },
}
(DATA / "specs.json").write_text(json.dumps(specs, indent=2, ensure_ascii=False), encoding="utf-8")

live = json.loads((DATA / "live_ambient.json").read_text(encoding="utf-8"))
LIVE_BT = live["samples"][-1]["bt_nT"]
log_path = DATA / "build_log.json"
log = json.loads(log_path.read_text(encoding="utf-8")) if log_path.exists() else {"runs": []}
entries = [
    {"fact": "Field clash: OPM +/-5 nT range vs NV bias ~1 mT", "value": v(200000, "x ratio (1 mT / 5 nT)", "calculated from specs.json", "calculated", "VERIFIED")},
    {"fact": "Live solar-wind |B| at L1 (latest sample)", "value": v(LIVE_BT, "nT", "data/live_ambient.json (NOAA SWPC RTSW)", "live", "VERIFIED")},
]
log["runs"].append({"run_id": f"run-{len(log['runs'])+1}", "ran_at": NOW, "entries": entries})
log_path.write_text(json.dumps(log, indent=2, ensure_ascii=False), encoding="utf-8")
print("specs.json written; build_log runs:", len(log["runs"]))
