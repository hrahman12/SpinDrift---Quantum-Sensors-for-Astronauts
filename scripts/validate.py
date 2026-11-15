"""Check /data against the v10 contract (contract/schema.md, plus the additions logged in STATUS.md).

Flags: files that do not parse, NaN/Infinity, missing meta, malformed value objects (all seven keys, valid tag
and status, null value for NOT_STATED/NOT_YET_EXTRACTED, non-null VERIFIED, as_of on live/near_live), numbers in
value objects without a source, recorded x/series length mismatches, plotted physics curves with missing inputs,
and shape errors in each contract file. Exit code 1 if anything is wrong.
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.common import DATA, DEVICES, LOCATION_IDS, RECORDED_IDS, STATUSES, TAGS  # noqa: E402

VO_KEYS = {"value", "unit", "source", "tag", "status", "as_of", "note"}
CONTRACT = ["specs.json", "locations.json", "nv_heart_derived.json", "physics.json", "nasa_i4.json",
            "published_points.json", "hrp.json", "simulators.json", "clinical_card.json", "build_log.json",
            "live_snapshot.json", "runs.json", "combined_sensor.json"] + [f"recorded/{r}.json" for r in RECORDED_IDS]
EXTRA = ["recorded/eeg_brain_ds004902.json", "palette.json", "assets.json", "device_map.json"]
problems, counts = [], {}


def bad_const(c):
    raise ValueError(f"non-finite number {c}")


def load(rel):
    p = DATA / rel
    if not p.exists():
        problems.append(f"{rel}: missing")
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"), parse_constant=bad_const)
    except Exception as e:
        problems.append(f"{rel}: does not parse ({e})")
        return None


def is_vo(n):
    return isinstance(n, dict) and {"value", "tag", "status"} <= n.keys()


def walk(rel, path, n):
    if isinstance(n, float) and (math.isnan(n) or math.isinf(n)):
        problems.append(f"{rel}{path}: NaN/Inf")
    if is_vo(n):
        missing_keys = VO_KEYS - n.keys()
        if missing_keys:
            problems.append(f"{rel}{path}: VO missing keys {sorted(missing_keys)}")
        tag, st, val = n.get("tag"), n.get("status"), n.get("value")
        counts.setdefault(rel, {}).setdefault(f"{tag}/{st}", 0)
        counts[rel][f"{tag}/{st}"] += 1
        if tag not in TAGS:
            problems.append(f"{rel}{path}: bad tag {tag!r}")
        if st not in STATUSES:
            problems.append(f"{rel}{path}: bad status {st!r}")
        if st in ("NOT_STATED", "NOT_YET_EXTRACTED") and val is not None:
            problems.append(f"{rel}{path}: {st} must have value null")
        if st == "VERIFIED" and val is None:
            problems.append(f"{rel}{path}: VERIFIED but value null")
        if tag in ("live", "near_live") and val is not None and not n.get("as_of"):
            problems.append(f"{rel}{path}: {tag} value without as_of")
        if val is not None and not n.get("source"):
            problems.append(f"{rel}{path}: value without a source")
        if tag == "calculated" and val is not None and not n.get("note"):
            problems.append(f"{rel}{path}: calculated value without formula note")
    if isinstance(n, dict):
        for k, v in n.items():
            walk(rel, f"{path}.{k}", v)
    elif isinstance(n, list):
        for i, v in enumerate(n):
            walk(rel, f"{path}[{i}]", v)


def check_meta(rel, obj):
    m = obj.get("meta") if isinstance(obj, dict) else None
    if not isinstance(m, dict) or not isinstance(m.get("fixture"), bool) or "generated_at" not in m \
            or not isinstance(m.get("sources"), list):
        problems.append(f"{rel}: meta must have fixture (bool), generated_at and sources (list)")
        return None
    return m


def shapes(rel, o):
    if rel == "specs.json":
        for k in ("opm", "nv", "qd_renin", "cqd_patch", "space_heritage"):
            if k not in o:
                problems.append(f"{rel}: missing {k}")
        for k in ("headline", "jgu", "zaquant", "qant"):
            if k not in o.get("nv", {}):
                problems.append(f"{rel}: nv missing {k}")
    elif rel == "locations.json":
        ids = [l.get("id") for l in o.get("locations", [])]
        if sorted(ids) != sorted(LOCATION_IDS):
            problems.append(f"{rel}: location ids {ids}")
        for l in o.get("locations", []):
            if l.get("field_kind") not in ("live_feed", "model", "published", "none"):
                problems.append(f"{rel}: bad field_kind for {l.get('id')}")
    elif rel.startswith("recorded/"):
        m = o.get("meta", {})
        for k in ("dataset", "doi_or_url", "licence", "accessed", "device_type", "label"):
            if not m.get(k) and not m.get("fixture"):
                problems.append(f"{rel}: meta.{k} missing")
        nx = len(o.get("x", {}).get("values", []))
        for s in o.get("series", []):
            if len(s.get("values", [])) != nx:
                problems.append(f"{rel}: series {s.get('name')!r} length {len(s.get('values', []))} != x length {nx}")
            if any(v is None or (isinstance(v, float) and not math.isfinite(v)) for v in s.get("values", [])):
                problems.append(f"{rel}: series {s.get('name')!r} has null/non-finite values")
    elif rel == "physics.json":
        for cid in ("nv_odmr_lines", "opm_zero_field", "qd_fret_vs_distance", "cqd_quenching"):
            c = o.get(cid)
            if not c:
                problems.append(f"{rel}: missing curve {cid}")
                continue
            if c["plotted"]:
                if not c["x"] or len(c["x"]) != len(c["y"]):
                    problems.append(f"{rel}: {cid} plotted but x/y empty or unequal")
                if any(i.get("value") is None for i in c["inputs"]):
                    problems.append(f"{rel}: {cid} plotted although an input has no value")
            elif not c["missing_inputs"]:
                problems.append(f"{rel}: {cid} not plotted but no missing_inputs listed")
    elif rel == "simulators.json":
        for d in DEVICES:
            for e in o.get(d, []):
                for k in ("tool", "url", "access", "account_needed", "models", "limits", "inputs", "missing_inputs",
                          "results"):
                    if k not in e:
                        problems.append(f"{rel}: {d}/{e.get('tool')} missing {k}")
                for r in e.get("results", []):
                    if r.get("via") not in ("api", "pasted"):
                        problems.append(f"{rel}: {d}/{e.get('tool')} result via {r.get('via')!r}")
    elif rel == "clinical_card.json":
        for loc in LOCATION_IDS:
            if loc not in o:
                problems.append(f"{rel}: missing location {loc}")
                continue
            for row in o[loc].get("rows", []) + o[loc].get("main", []):
                if row.get("evidence") not in ("SOURCED", "EARTH_ONLY", "TO_CONFIRM"):
                    problems.append(f"{rel}: {loc} row {row.get('label')!r} bad evidence")
    elif rel == "build_log.json":
        for d in DEVICES:
            if d not in o.get("per_sensor", {}):
                problems.append(f"{rel}: per_sensor missing {d}")
    elif rel == "combined_sensor.json":
        for k in ("version", "runs_counted", "components", "open_questions"):
            if k not in o:
                problems.append(f"{rel}: missing {k}")


def main():
    report = {}
    for rel in CONTRACT + EXTRA:
        obj = load(rel)
        if obj is None:
            continue
        m = check_meta(rel, obj)
        walk(rel, "", obj)
        shapes(rel, obj)
        report[rel] = "fixture" if m and m.get("fixture") else "real"
    others = sorted(str(p.relative_to(DATA)).replace("\\", "/") for p in DATA.rglob("*.json")
                    if str(p.relative_to(DATA)).replace("\\", "/") not in CONTRACT + EXTRA)
    for rel in others:  # outside the contract: parse and NaN check only
        load(rel)
    for rel, kind in report.items():
        c = counts.get(rel, {})
        print(f"{kind:8s} {rel:45s} " + ", ".join(f"{k} {v}" for k, v in sorted(c.items())))
    print(f"outside contract v10 (parse/NaN check only): {len(others)} files")
    print("problems:", len(problems))
    for p in problems:
        print("  -", p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
