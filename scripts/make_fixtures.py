"""Write contract-v10 fixtures for every /data file. Fixtures hold no numbers.

Usage: python scripts/make_fixtures.py [--force]
Without --force, a file that already exists is left alone, so real outputs are never overwritten.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.common import (DATA, RECORDED, DEVICES, LOCATION_IDS, RECORDED_IDS, meta, missing,  # noqa: E402
                           write_json)

PENDING = "NOT_YET_EXTRACTED"


def null_vo(unit="", tag="published_spec"):
    return missing(unit, "fixture", tag, PENDING, "fixture: not yet built")


def fixtures() -> dict:
    m = lambda **kw: meta(True, [], **kw)  # noqa: E731
    files = {
        "specs.json": {"meta": m(), "opm": {}, "nv": {"headline": {}, "jgu": {}, "zaquant": {}, "qant": {}},
                       "qd_renin": {}, "cqd_patch": {}, "space_heritage": {"oscar_qube": {}, "swarm_asm": {}}},
        # places/sub_places shape; the real file is built by scripts/build_locations.py
        "locations.json": {"meta": m(), "places": []},
        "nv_heart_derived.json": {
            "meta": m(), "recorded_id": "opm_heart_kiel", "channel": "",
            "averaged_beat": {"t_s": [], "pT": [], "beats_averaged": null_vo("beats", "calculated"),
                              "r_peak_pT": null_vo("pT", "calculated")},
            "per_build": {b: {k: null_vo("", "calculated") for k in
                              ["noise_density", "single_beat_noise_pT", "averaged_noise_pT", "single_beat_snr",
                               "averaged_snr", "averaged_snr_measured_peak"]}
                          for b in ["jgu", "zaquant", "qant"]}},
        "physics.json": {"meta": m(), **{c: {"plotted": False, "x": [], "y": [], "x_label": "", "y_label": "",
                                             "equation": "", "inputs": [], "missing_inputs": []}
                                         for c in ["nv_odmr_lines", "opm_zero_field", "qd_fret_vs_distance",
                                                   "cqd_quenching"]}},
        "nasa_i4.json": {"meta": m(), "datasets": [], "not_found": []},
        "published_points.json": {"meta": m(), "qd_renin": {"status": "awaiting", "points": []},
                                  "cqd_patch": {"status": "awaiting", "points": []}},
        "hrp.json": {"meta": m(), "hazards": []},
        "simulators.json": {"meta": m(), **{d: [] for d in DEVICES}},
        "clinical_card.json": {"meta": m(), **{loc: {"rows": []} for loc in LOCATION_IDS}},
        "build_log.json": {"meta": m(), "per_sensor": {d: [] for d in DEVICES}, "combined": []},
        "live_snapshot.json": {"meta": m(), "fetched_at": None, "iss": None, "l1": None, "swarm_asm": None,
                               "iss_cabin": None, "opm_readiness": {}, "errors": ["fixture: no live cycle yet"]},
        "runs.json": {"meta": m(), "runs": []},
        "combined_sensor.json": {"meta": m(), "version": 0, "runs_counted": 0, "components": {},
                                 "open_questions": []},
    }
    device = {"opm_brain_mne": "opm", "opm_heart_kiel": "opm", "nv_odmr_zenodo10629041": "nv",
              "qd_fret_figshare5468838": "qd", "cqd_pl_mendeley_cmfbrvrb8y": "cqd"}
    for rid in RECORDED_IDS:
        files[f"recorded/{rid}.json"] = {
            "meta": m(dataset=rid, doi_or_url="", licence="not yet recorded", accessed=None,
                      device_type=device[rid], label=""),
            "x": {"name": "", "unit": "", "values": []}, "series": []}
    return files


def main(force=False):
    RECORDED.mkdir(parents=True, exist_ok=True)
    for name, obj in fixtures().items():
        path = DATA / name
        if path.exists() and not force:
            print(f"keep    {name}")
            continue
        write_json(path, obj)
        print(f"fixture {name}")


if __name__ == "__main__":
    main(force="--force" in sys.argv)
