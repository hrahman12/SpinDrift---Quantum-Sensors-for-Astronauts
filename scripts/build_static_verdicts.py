"""Lean results for the public static copy of the page (served from GitHub through raw.githack.com, where no server runs).

For every place, every setting the page offers from its menus (the seven shield values, both parts of the heartbeat)
and two renin/bilirubin cases (empty, or the published references 2.0 pM and 1.3 mg/dL), this asks the running
SpinDrift server for Lean's verdict and stores the exact response. ui/static-shim.js answers POST /api/verdict from
these files on the static copy; any other combination of inputs says it needs the live server.

Usage (server running):   LEAN_API=http://127.0.0.1:8001 python scripts/build_static_verdicts.py
"""
import concurrent.futures as cf
import itertools
import json
import os
import sys
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
BASE = os.environ.get("LEAN_API", "http://127.0.0.1:8001")
OUT = Path(__file__).resolve().parent.parent / "data" / "static" / "verdicts"
DEFAULT = {"shielding_factor": 1, "beats_averaged": 47, "snr_required": 3, "build": "jgu", "target": "r_peak",
           "bandwidth_hz": 30, "renin": None, "bilirubin_isf": None}
SHIELDS = [1, 10, 100, 1000, 10000, 100000, 1000000]
TARGETS = ["r_peak", "q_wave"]
BIO = [(None, None), (2.0, 1.3)]   # empty, or the published references (README: Where the references come from)


def call(path, body=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"} if body is not None else {}
    with urllib.request.urlopen(urllib.request.Request(BASE + path, data=data, headers=headers), timeout=180) as r:
        return json.loads(r.read())


def main():
    ids = [s["id"] for p in call("/api/locations")["places"] for s in p["sub_places"]]
    jobs = [(sid, {**DEFAULT, "shielding_factor": s, "target": t, "renin": ren, "bilirubin_isf": bil})
            for sid in ids for s, t, (ren, bil) in itertools.product(SHIELDS, TARGETS, BIO)]
    results = {}
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(call, "/api/verdict", {"location": sid, "inputs": inp}): (sid, inp) for sid, inp in jobs}
        for f in cf.as_completed(futs):
            sid, inp = futs[f]
            results.setdefault(sid, []).append({"inputs": inp, "response": f.result()})
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for sid, variants in sorted(results.items()):
        variants.sort(key=lambda v: (v["inputs"]["shielding_factor"], v["inputs"]["target"], v["inputs"]["renin"] is None))
        doc = {"location": sid, "made_by": "scripts/build_static_verdicts.py",
               "note": "Exact responses of POST /api/verdict (Lean 4 checker) for the inputs listed; nothing is interpolated.",
               "variants": variants}
        text = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
        (OUT / f"{sid}.json").write_text(text, encoding="utf-8")
        total += len(text.encode("utf-8"))
    print(f"{len(results)} places, {len(jobs)} Lean results, {total / 1e6:.1f} MB written to {OUT}")


if __name__ == "__main__":
    main()
