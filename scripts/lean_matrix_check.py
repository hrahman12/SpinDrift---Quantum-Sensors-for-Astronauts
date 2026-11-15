"""Recount Lean's verdict matrix at every real place, with fixed inputs.

Usage (server running):   python scripts/lean_matrix_check.py [--renin PM]
LEAN_API points at another server (default http://127.0.0.1:8001).
"""
import argparse
import collections
import json
import os
import sys
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
BASE = os.environ.get("LEAN_API", "http://127.0.0.1:8001")
CHECKS = ["opm_brain", "opm_heart", "nv_heart_jgu", "nv_heart_zaquant", "nv_heart_qant", "qd_blood", "cqd_skin"]
BASE_INPUTS = {"shielding_factor": 1, "beats_averaged": 47, "snr_required": 3, "build": "jgu", "target": "r_peak", "bandwidth_hz": 30}


def call(path, body=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"} if body is not None else {}
    with urllib.request.urlopen(urllib.request.Request(BASE + path, data=data, headers=headers), timeout=120) as r:
        return json.loads(r.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--renin", type=float, default=None, help="renin in pM, the unit of the detection limit")
    ap.add_argument("--bilirubin", type=float, default=None, help="bilirubin in mg/dL, the unit of the patch's range")
    args = ap.parse_args()
    spots = [s["id"] for p in call("/api/locations").get("places", []) for s in p.get("sub_places", [])]
    scenarios = {"no renin, no bilirubin": dict(BASE_INPUTS)}
    if args.renin is not None:
        scenarios[f"renin {args.renin} pM"] = {**BASE_INPUTS, "renin": args.renin}
    if args.renin is not None and args.bilirubin is not None:
        scenarios[f"renin {args.renin} pM, bilirubin {args.bilirubin} mg/dL"] = {
            **BASE_INPUTS, "renin": args.renin, "bilirubin_isf": args.bilirubin}
    print(f"places: {len(spots)}; fixed inputs: {BASE_INPUTS}")
    for name, inputs in scenarios.items():
        tot, per = collections.Counter(), collections.defaultdict(collections.Counter)
        for sid in spots:
            verdicts = call("/api/verdict", {"location": sid, "inputs": inputs})["verdicts"]
            for c in CHECKS:
                per[c][verdicts[c]["verdict"]] += 1
                tot[verdicts[c]["verdict"]] += 1
        n = sum(tot.values())
        miss = tot["NEED_MORE_INFORMATION"]
        print(f"\n== {name}")
        for c in CHECKS:
            print(f"  {c}: {dict(per[c])}")
        print(f"  all {n} cells: works {tot['REQUIREMENTS_MET']}, does not work {tot['NOT_MET']}, "
              f"needs a number {miss} ({100 * miss / n:.1f}%)")


if __name__ == "__main__":
    main()
