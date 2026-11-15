"""Check /data against the v10 contract (contract/schema.md, plus the additions logged in STATUS.md).

Flags: files that do not parse, NaN/Infinity, missing meta, malformed value objects (all seven keys, valid tag
and status, null value for NOT_STATED/NOT_YET_EXTRACTED, non-null VERIFIED, as_of on live/near_live), numbers in
value objects without a source, recorded x/series length mismatches, plotted physics curves with missing inputs,
and shape errors in each contract file. Exit code 1 if anything is wrong.

Location engine (data/locations.json, scripts/build_locations.py):
- every sub-place has a source for |B|, or a null |B| with a status other than VERIFIED;
- no numeric value without a tag (every number sits inside an object that carries a tag);
- the calculated OPM and NV fields match their formulas (|B| <= 5 nT; 28.025 MHz/mT x |B|), and the ratio to the
  IGRF field at Johnson Space Center matches too; a false OPM check carries the shielding note, and no note says the
  OPM runs unshielded;
- when a server is running (SPINDRIFT_SERVER, default http://127.0.0.1:8001), its ISS position in
  GET /api/locations/iss.destiny is fresher than 30 s, GET /api/locations lists the same sub-places, an older id
  resolves to its sub-place, POST /api/verdict returns the environment object for a sub-place id and for an older
  id and rejects an unknown id, and the /ui static mount answers "Cache-Control: no-cache" and 304 on
  revalidation; all of this is skipped when no server answers;
- a run record that carries location_id also carries the location's value objects (environment); a run record
  with a Lean block has, per check, a verdict that agrees with its requirements' holds values, a deciding
  requirement among them, and conditions that match their formulas (OPM shielding factor needed = S × lhs / rhs of
  opm_field_nulled; NV heartbeats needed = ceil(lhs / A²) of nv_snr); combined_sensor.json lean_summary lists only
  known sub-places;
- the three optional verdict inputs (brain_signal_fT, brain_trials, nv_bandwidth_hz) each replace exactly one factor
  (A and N of opm_snr_brain, BW of nv_snr) and Lean decides the existing requirement with it: checked in-process with
  the Lean checker (skipped if it is not built) and, on a running server, a bad value answers 400 with a plain message;
- one word is banned from every file under /data and /server (see BANNED below).
"""
import json
import math
import os
import sys
from datetime import datetime, timezone
from fractions import Fraction
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server import locations as loc_engine  # noqa: E402
from server.verdict import CHECK_IDS  # noqa: E402
from server.common import DATA, DEVICES, LOCATION_IDS, RECORDED_IDS, ROOT, STATUSES, TAGS  # noqa: E402

SUB_IDS = ["iss.destiny", "iss.columbus", "iss.kibo", "iss.zvezda", "iss.cupola", "tiangong.tianhe", "tiangong.wentian",
           "tiangong.mengtian", "iss_hotspots.saa", "iss_hotspots.high_latitude", "iss_hotspots.equatorial",
           "earth_analog.concordia", "earth_analog.haughton", "earth_analog.mdrs", "earth_analog.aquarius",
           "earth_flight.jsc", "earth_flight.baikonur", "earth_flight.i4_splashdown", "gateway.halo", "gateway.ppe",
           "gateway.nrho_perilune", "gateway.nrho_apolune", "moon_south_pole.shackleton_rim",
           "moon_south_pole.psr_crater", "moon_south_pole.artemis3_regions", "lunar_anomalies.reiner_gamma",
           "lunar_anomalies.spa_basin", "mars_transit.leaving_magnetosphere", "mars_transit.cruise",
           "mars_transit.solar_storm", "mars_surface.jezero", "mars_surface.gale", "mars_surface.terra_cimmeria",
           "mars_surface.insight"]
SUB_KEYS = ["id", "group", "place", "sub_place", "coords", "body", "B_total_nT", "B_vector_nT", "radiation_context",
            "opm_in_range", "nv_zeeman_shift_MHz", "ratio_to_earth_surface", "notes", "refresh"]
BODIES = ("Earth", "Moon", "Mars", "interplanetary")
BANNED = "hypo" + "thesis"   # written in two parts so that this file can be scanned as well
SERVER = os.environ.get("SPINDRIFT_SERVER", "http://127.0.0.1:8001").rstrip("/")
ISS_MAX_AGE_S = 30
OPTIONAL_INPUTS = {"brain_signal_fT": ("opm_snr_brain", "A", "recorded.opm_brain_mne.evoked.peak_abs_fT"),
                   "brain_trials": ("opm_snr_brain", "N", "recorded.opm_brain_mne.evoked.n_epochs"),
                   "nv_bandwidth_hz": ("nv_snr", "BW", "specs.nv.headline.bandwidth_assumed")}
NV_CARDS = ("nv_heart_jgu", "nv_heart_zaquant", "nv_heart_qant")
ENV_KEYS = ["location_id", "place", "sub_place", "body", "B_total_nT", "shielding_factor", "B_at_sensor_nT",
            "nv_zeeman_shift_MHz", "opm_in_range", "ratio_to_earth_surface", "radiation_context", "refresh"]

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
        check_locations(rel, o)
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
    elif rel == "runs.json":
        for run in o.get("runs", []):
            if "location_id" not in run:
                continue    # a run recorded before the location engine
            env = run.get("environment") or {}
            if run["location_id"] not in SUB_IDS or env.get("id") != run["location_id"] \
                    or not is_vo(env.get("B_total_nT") or {}):
                problems.append(f"{rel}: {run.get('run_id')} has location_id {run.get('location_id')!r} but no "
                                "matching environment with a B_total_nT value object")
            if (run.get("lean") or {}).get("checks"):
                check_run_lean(rel, run)
    elif rel == "combined_sensor.json":
        for k in ("version", "runs_counted", "components", "open_questions"):
            if k not in o:
                problems.append(f"{rel}: missing {k}")
        summary = o.get("lean_summary")
        if summary is not None:
            for cid, e in (summary.get("checks") or {}).items():
                if cid not in CHECK_IDS:
                    problems.append(f"{rel}: lean_summary has unknown check {cid}")
                for key in ("works", "does_not_work", "needs_a_number"):
                    for loc in e.get(key, []):
                        if loc not in SUB_IDS:
                            problems.append(f"{rel}: lean_summary {cid}.{key} lists unknown place {loc!r}")


def untagged_numbers(node, path, tagged=False):
    """Paths of numbers that are not inside any object carrying a tag."""
    if isinstance(node, dict):
        inside = tagged or "tag" in node
        for k, v in node.items():
            yield from untagged_numbers(v, f"{path}.{k}", inside)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from untagged_numbers(v, f"{path}[{i}]", tagged)
    elif isinstance(node, (int, float)) and not isinstance(node, bool) and not tagged:
        yield path


def close(a, b, rel_tol=1e-5, abs_tol=1e-9):
    return a is not None and b is not None and math.isclose(a, b, rel_tol=rel_tol, abs_tol=abs_tol)


def check_locations(rel, o):
    """data/locations.json: {meta, places: [{id, group, name, body, sub_places: [...]}]} and the location tests."""
    if (o.get("meta") or {}).get("fixture"):
        return
    places = o.get("places")
    if not isinstance(places, list):
        problems.append(f"{rel}: no places list (the file is in an older shape: run scripts/build_locations.py; "
                        "an older server process rewrites it every minute until it is restarted)")
        return
    if [p.get("id") for p in places] != loc_engine.PLACE_IDS:
        problems.append(f"{rel}: place ids {[p.get('id') for p in places]}")
    if [p.get("group") for p in places] != ["today"] * 5 + ["tomorrow"] * 5:
        problems.append(f"{rel}: groups must be five today then five tomorrow")
    ref = ((o.get("meta") or {}).get("reference") or {}).get("earth_surface_nT") or {}
    if not isinstance(ref.get("value"), (int, float)):
        problems.append(f"{rel}: meta.reference.earth_surface_nT (IGRF at Johnson Space Center) has no value")
    ids = []
    for p in places:
        for k in ("name", "body", "sub_places"):
            if not p.get(k):
                problems.append(f"{rel}: place {p.get('id')} missing {k}")
        for sp in p.get("sub_places") or []:
            sid = sp.get("id")
            ids.append(sid)
            where = f"{rel}: {sid}"
            for k in SUB_KEYS:
                if k not in sp:
                    problems.append(f"{where} missing {k}")
            if not str(sid).startswith(f"{p.get('id')}.") or sp.get("group") != p.get("group"):
                problems.append(f"{where}: id or group does not match its place {p.get('id')}")
            if sp.get("body") not in BODIES:
                problems.append(f"{where}: body {sp.get('body')!r}")
            if sp.get("refresh") not in loc_engine.REFRESH:
                problems.append(f"{where}: refresh {sp.get('refresh')!r}")
            b = sp.get("B_total_nT") or {}
            if not is_vo(b) or "retrieved_utc" not in b:
                problems.append(f"{where}: B_total_nT must be a value object with retrieved_utc")
                continue
            val = b.get("value")
            # 1. a source for |B|, or null with a status other than VERIFIED
            if val is None:
                if b.get("status") == "VERIFIED" or b.get("status") not in STATUSES:
                    problems.append(f"{where}: |B| is null but its status is {b.get('status')!r}")
            elif not isinstance(val, (int, float)) or isinstance(val, bool) or not b.get("source") \
                    or b.get("tag") not in TAGS:
                problems.append(f"{where}: |B| needs a numeric value, a source and a tag")
            # 2. no numeric value without a tag
            for path in untagged_numbers(sp, ""):
                problems.append(f"{where}: number without a tag at {path}")
            vec = sp.get("B_vector_nT") or {}
            if vec.get("frame") not in loc_engine.FRAMES or not vec.get("tag") or not vec.get("source"):
                problems.append(f"{where}: B_vector_nT needs frame NED|body-fixed|GSE, tag and source")
            comps = [vec.get(k) for k in ("x", "y", "z")]
            if any(c is None for c in comps) and not all(c is None for c in comps):
                problems.append(f"{where}: B_vector_nT has some components null and some not")
            c = sp.get("coords")
            if c is not None and (not all(k in c for k in ("lat", "lon", "alt_km")) or not c.get("tag")
                                  or not c.get("source")):
                problems.append(f"{where}: coords need lat, lon, alt_km, tag and source (or be null)")
            rc = sp.get("radiation_context") or {}
            if not rc.get("text") or not rc.get("source"):
                problems.append(f"{where}: radiation_context needs text and source")
            # 3. the calculated fields match their formulas
            num = val if isinstance(val, (int, float)) and not isinstance(val, bool) else None
            want_in = None if num is None else abs(num) <= loc_engine.OPM_RANGE_NT
            if sp.get("opm_in_range") is not want_in:
                problems.append(f"{where}: opm_in_range {sp.get('opm_in_range')!r}, formula gives {want_in!r}")
            note = sp.get("opm_note") or ""
            if want_in is False and loc_engine.OPM_NOTE_OUT not in note:
                problems.append(f"{where}: opm_in_range is false but the shielding note is missing")
            if "shielded or compensated" not in note:
                problems.append(f"{where}: opm_note must say that QuSpin operates in a shielded or compensated "
                                "environment")
            nv = sp.get("nv_zeeman_shift_MHz") or {}
            if nv.get("tag") != "calculated" or nv.get("formula") != loc_engine.NV_FORMULA:
                problems.append(f"{where}: nv_zeeman_shift_MHz needs tag calculated and formula "
                                f"{loc_engine.NV_FORMULA!r}")
            want_nv = None if num is None else loc_engine.GAMMA_NV * abs(num) * 1e-6
            if (want_nv is None) != (nv.get("value") is None) or (want_nv is not None and not close(nv["value"], want_nv)):
                problems.append(f"{where}: nv_zeeman_shift_MHz {nv.get('value')!r}, formula gives {want_nv!r}")
            ratio = sp.get("ratio_to_earth_surface") or {}
            want_r = None if num is None or not ref.get("value") else abs(num) / ref["value"]
            if ratio.get("tag") != "calculated" or (want_r is None) != (ratio.get("value") is None) \
                    or (want_r is not None and not close(ratio["value"], want_r)):
                problems.append(f"{where}: ratio_to_earth_surface {ratio.get('value')!r}, formula gives {want_r!r}")
    if ids != SUB_IDS:
        problems.append(f"{rel}: sub-place ids differ from the brief: missing {sorted(set(SUB_IDS) - set(ids))}, "
                        f"extra {sorted(set(ids) - set(SUB_IDS))}" + ("" if sorted(ids) != sorted(SUB_IDS) else
                                                                      " (order differs)"))
    for old, new in loc_engine.LEGACY_IDS.items():
        if new not in ids:
            problems.append(f"{rel}: older id {old} maps to {new}, which is not a sub-place")


def check_run_lean(rel, run):
    """A run's Lean block: verdicts consistent with the holds values, deciding requirement present, formulas."""
    rid = run.get("run_id")
    for cid, c in run["lean"]["checks"].items():
        where = f"{rel}: {rid} lean.{cid}"
        reqs = c.get("requirements") or []
        holds = [r.get("holds") for r in reqs]
        want = ("NOT_MET" if False in holds else "NEED_MORE_INFORMATION" if None in holds else "REQUIREMENTS_MET")
        if c.get("verdict") != want or (c.get("verdict_vo") or {}).get("value") != c.get("verdict"):
            problems.append(f"{where}: verdict {c.get('verdict')!r} does not agree with holds {holds}")
        if (c.get("deciding_requirement") or {}).get("id") not in [r.get("id") for r in reqs]:
            problems.append(f"{where}: deciding requirement is not one of its requirements")
        for r in reqs:
            lhs = Fraction(r["lhs"]["exact"]) if r.get("lhs") else None
            rhs = Fraction(r["rhs"]["exact"]) if r.get("rhs") else None
            f = r.get("factors") or {}
            if r["id"] == "opm_field_nulled" and "shielding_factor_needed" in c.get("conditions", {}):
                got = c["conditions"]["shielding_factor_needed"].get("value")
                ok_in = lhs is not None and rhs and f.get("S") not in (None, "?")
                want_v = float(Fraction(f["S"]) * lhs / rhs) if ok_in else None
                if (got is None) != (want_v is None) or (want_v is not None and not close(got, want_v)):
                    problems.append(f"{where}: shielding_factor_needed {got!r}, S × lhs / rhs gives {want_v!r}")
            if r["id"] == "nv_snr" and "heartbeats_needed" in c.get("conditions", {}):
                got = c["conditions"]["heartbeats_needed"].get("value")
                ok_in = lhs is not None and f.get("A") not in (None, "?") and Fraction(f["A"]) != 0
                want_v = math.ceil(lhs / Fraction(f["A"]) ** 2) if ok_in else None
                if got != want_v:
                    problems.append(f"{where}: heartbeats_needed {got!r}, ceil(lhs / A²) gives {want_v!r}")


def check_verdict_inputs():
    """In-process: each optional verdict input replaces exactly one factor, and Lean decides the existing requirement
    with the value given. Returns the line to print."""
    from server import verdict
    if verdict.binary_path() is None:
        return "Lean checker binary not built: optional verdict input checks skipped"
    place = loc_engine.get(None, "iss")

    def build(**inputs):
        return verdict.build("iss", {k: inputs.get(k) for k in verdict.INPUT_NAMES}, None, place=place)

    def factor(resp, cid, rid, symbol):
        req = next(r for r in resp["verdicts"][cid]["requirements"] if r["id"] == rid)
        return req, next(i for i in req["inputs"] if i["symbol"] == symbol)

    common = {"snr_required": 3, "bandwidth_hz": 30}
    base = build(**common)
    given = build(**common, brain_signal_fT=250, brain_trials=40, nv_bandwidth_hz=12.5)
    where = "POST /api/verdict optional inputs (in-process)"
    # without them, the sourced factors are used
    for name, (rid, sym, default_id) in OPTIONAL_INPUTS.items():
        for cid in (["opm_brain"] if rid == "opm_snr_brain" else NV_CARDS):
            _, f = factor(base, cid, rid, sym)
            if f["id"] != default_id:
                problems.append(f"{where}: without {name}, {cid}.{rid}.{sym} is {f['id']}, expected {default_id}")
        u = base["inputs_used"].get(name) or {}
        if u.get("default_from") != default_id or name not in base["input_units"]:
            problems.append(f"{where}: inputs_used/input_units do not list {name} with its default")
    # with them, the value typed feeds the same requirement, tagged user_input
    want = {"brain_signal_fT": "250/1", "brain_trials": "40/1", "nv_bandwidth_hz": "25/2"}
    for name, (rid, sym, default_id) in OPTIONAL_INPUTS.items():
        for cid in (["opm_brain"] if rid == "opm_snr_brain" else NV_CARDS):
            _, f = factor(given, cid, rid, sym)
            if (f["id"], f["origin"], f["tag"], f["lean_factor"]) != (f"inputs.{name}", "user_input", "user_input",
                                                                      want[name]):
                problems.append(f"{where}: {name} did not feed {cid}.{rid}.{sym} ({f['id']}, {f['lean_factor']})")
        u = given["inputs_used"].get(name) or {}
        if u.get("origin") != "user_input" or u.get("tag") != "user_input" or u.get("replaces") != default_id:
            problems.append(f"{where}: inputs_used.{name} does not show the value typed")
    # Lean computed the existing inequality with them: rhs of opm_snr_brain = A² · N, lhs of nv_snr = snr² · η² · BW
    req, _ = factor(given, "opm_brain", "opm_snr_brain", "A")
    if not req["rhs"] or Fraction(req["rhs"]["exact"]) != Fraction(250) ** 2 * 40:
        problems.append(f"{where}: opm_snr_brain rhs {req['rhs']} is not 250² × 40")
    for cid in NV_CARDS:
        req, eta = factor(given, cid, "nv_snr", "η")
        if eta["lean_factor"] not in (None, "?") and (
                not req["lhs"] or Fraction(req["lhs"]["exact"]) != 9 * Fraction(eta["lean_factor"]) ** 2 * Fraction(25, 2)):
            problems.append(f"{where}: {cid} nv_snr lhs {req['lhs']} is not 3² × η² × 12.5")
    # nothing else changed
    allowed = {"opm_snr_brain": {"A", "N"}, "nv_snr": {"BW"}}
    for cid in base["verdicts"]:
        for rb, rg in zip(base["verdicts"][cid]["requirements"], given["verdicts"][cid]["requirements"]):
            changed = {fb["symbol"] for fb, fg in zip(rb["inputs"], rg["inputs"]) if fb["id"] != fg["id"]}
            if not changed <= allowed.get(rb["id"], set()) or len(rb["inputs"]) != len(rg["inputs"]):
                problems.append(f"{where}: {cid}.{rb['id']} changed factors {sorted(changed)}")
    return "optional verdict inputs: checked in-process (each replaces one factor; Lean sides match)"


def check_banned_word():
    """The banned word must not appear in any file under /data or /server."""
    token, hits = BANNED.encode(), []
    for folder in (DATA, ROOT / "server"):
        for path in sorted(folder.rglob("*")):
            if path.is_file() and token in path.read_bytes().lower():
                hits.append(str(path.relative_to(ROOT)).replace(os.sep, "/"))
    for h in hits:
        problems.append(f"{h}: contains the banned word '{BANNED}'")
    return hits


def check_server():
    """Endpoint checks against a running server (skipped when none answers). Returns the lines to print."""
    import requests
    try:
        requests.get(f"{SERVER}/api/health", timeout=3)
    except requests.RequestException:
        return [f"no server at {SERVER}: ISS freshness and endpoint checks skipped"]
    lines = []

    def bad(msg):
        problems.append(f"server {SERVER}: {msg}")

    def call(method, path, **kw):
        try:
            return requests.request(method, f"{SERVER}{path}", timeout=60, **kw)
        except requests.RequestException as e:
            bad(f"{method} {path} failed ({type(e).__name__})")
            return None

    def iss_age(as_of, what):
        try:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat((as_of or "").replace("Z", "+00:00")))
            age = age.total_seconds()
        except ValueError:
            bad(f"{what} has no position time (ISS feed down?)")
            return
        if age > ISS_MAX_AGE_S:
            bad(f"ISS position ({what}) is {age:.0f} s old (limit {ISS_MAX_AGE_S} s)")
        lines.append(f"server {SERVER}: ISS position ({what}) {age:.0f} s old (limit {ISS_MAX_AGE_S} s)")

    # ISS position fresher than 30 s
    r = call("GET", "/api/locations/iss.destiny")
    if r is not None and r.status_code == 404:
        # a server process started before the location engine was added: its ISS feed is checked through /api/live
        r2 = call("GET", "/api/live")
        live = r2.json() if r2 is not None and r2.status_code == 200 else {}
        iss_age(((live.get("iss") or {}).get("lat") or {}).get("as_of"), "/api/live iss.lat")
        lines.append(f"WARNING server {SERVER} predates the location engine (GET /api/locations/iss.destiny: 404): "
                     "restart it; the location endpoint checks were skipped for it")
        return lines
    if r is not None and r.status_code != 200:
        bad(f"GET /api/locations/iss.destiny returned HTTP {r.status_code}")
        return lines
    if r is not None:
        iss_age((r.json().get("coords") or {}).get("as_of"), "/api/locations/iss.destiny coords")
    # the whole file, refreshed
    r = call("GET", "/api/locations")
    if r is not None:
        doc = r.json() if r.status_code == 200 else {}
        ids = [sp.get("id") for pl in doc.get("places") or [] for sp in pl.get("sub_places") or []]
        if r.status_code != 200 or ids != SUB_IDS or "served" not in doc:
            bad(f"GET /api/locations: HTTP {r.status_code}, {len(ids)} sub-places, served block "
                f"{'present' if 'served' in doc else 'missing'}")
        lines.append(f"server {SERVER}: GET /api/locations {r.status_code}, {len(ids)} sub-places")
    # an older id resolves to its sub-place; an unknown id is refused
    for old, new in loc_engine.LEGACY_IDS.items():
        r = call("GET", f"/api/locations/{old}")
        if r is not None and (r.status_code != 200 or r.json().get("id") != new):
            bad(f"GET /api/locations/{old} did not return sub-place {new}")
    r = call("GET", "/api/locations/no_such_place")
    if r is not None and r.status_code != 404:
        bad(f"GET /api/locations/no_such_place returned HTTP {r.status_code}, expected 404")
    # the verdict carries the environment for a sub-place id and for an older id
    done = 0
    for sent, want in (("mars_surface.jezero", "mars_surface.jezero"), ("gateway", "gateway.halo")):
        r = call("POST", "/api/verdict", json={"location": sent, "inputs": {"shielding_factor": 10}})
        if r is None:
            continue
        if r.status_code == 503:
            lines.append(f"server {SERVER}: Lean checker unavailable (HTTP 503), environment check skipped")
            break
        env = (r.json() or {}).get("environment") or {} if r.status_code == 200 else {}
        lost = [k for k in ENV_KEYS if k not in env]
        if r.status_code != 200 or lost or env.get("location_id") != want:
            bad(f"POST /api/verdict location={sent}: HTTP {r.status_code}, environment.location_id "
                f"{env.get('location_id')!r}, missing keys {lost}")
            continue
        b, at = (env["B_total_nT"] or {}).get("value"), (env["B_at_sensor_nT"] or {}).get("value")
        if (b is None) != (at is None) or (b is not None and not close(at, b / 10)):
            bad(f"POST /api/verdict location={sent}: B_at_sensor_nT {at!r} is not B_total_nT {b!r} / 10")
        done += 1
    r = call("POST", "/api/verdict", json={"location": "no_such_place"})
    if r is not None and r.status_code != 422:
        bad(f"POST /api/verdict with an unknown location returned HTTP {r.status_code}, expected 422")
    # the optional inputs: a value that is not a positive number answers 400 with a plain message, also in a run
    n400, tried = 0, 0

    def expect_400(path, name, value):
        body = {"location": "iss", "inputs": {name: value}}
        if path == "/api/run":
            body["role"] = "crew"
        r = call("POST", path, json=body)
        if r is None:
            return False
        detail = r.json().get("detail") if r.headers.get("content-type", "").startswith("application/json") else None
        if r.status_code != 400 or not isinstance(detail, str) or name not in detail:
            bad(f"POST {path} inputs.{name}={value!r}: HTTP {r.status_code} {detail!r}, expected 400 with a plain message")
            return False
        return True

    for name, value in (("brain_signal_fT", -1), ("brain_signal_fT", True), ("brain_trials", 2.5), ("brain_trials", 0),
                        ("nv_bandwidth_hz", "abc")):
        tried += 1
        n400 += expect_400("/api/verdict", name, value)
    if n400 == tried:   # only a server that rejects them on /api/verdict is asked to run: an older one would run for real
        tried += 1
        n400 += expect_400("/api/run", "brain_trials", -3)
    else:
        lines.append(f"server {SERVER}: the /api/run bad-input check was skipped (this server accepts the bad values "
                     "on /api/verdict, so it would execute a real run)")
    fed = "not checked"
    r = call("POST", "/api/verdict", json={"location": "iss", "inputs": {"brain_signal_fT": 250, "brain_trials": 40,
                                                                          "nv_bandwidth_hz": 12.5}})
    if r is not None and r.status_code == 200:
        v = r.json()["verdicts"]
        got = {f["symbol"]: f["id"] for rq in v["opm_brain"]["requirements"] if rq["id"] == "opm_snr_brain"
               for f in rq["inputs"]}
        got_bw = {next(f["id"] for rq in v[c]["requirements"] for f in rq["inputs"] if f["symbol"] == "BW")
                  for c in NV_CARDS}
        if got.get("A") != "inputs.brain_signal_fT" or got.get("N") != "inputs.brain_trials" \
                or got_bw != {"inputs.nv_bandwidth_hz"}:
            bad(f"POST /api/verdict optional inputs did not feed their factors: {got}, NV BW {got_bw}")
            fed = "good values did NOT feed their factors"
        else:
            fed = "good values feed their factors"
    elif r is not None and r.status_code != 503:
        bad(f"POST /api/verdict with the optional inputs returned HTTP {r.status_code}")
    lines.append(f"server {SERVER}: optional verdict inputs: {n400} of {tried} bad values answered 400 with a plain "
                 f"message; {fed}")
    lines.append(f"server {SERVER}: POST /api/verdict environment checked for {done} of 2 location ids")
    # static files must be revalidated by the browser
    if (ROOT / "ui" / "index.html").exists():
        r = call("GET", "/ui/index.html")
        if r is not None:
            cc, etag = r.headers.get("cache-control"), r.headers.get("etag")
            r2 = call("GET", "/ui/index.html", headers={"If-None-Match": etag}) if etag else None
            if r.status_code != 200 or cc != "no-cache" or r2 is None or r2.status_code != 304:
                bad(f"GET /ui/index.html: HTTP {r.status_code}, Cache-Control {cc!r}, revalidation "
                    f"{'HTTP ' + str(r2.status_code) if r2 is not None else 'not possible (no ETag)'}")
            lines.append(f"server {SERVER}: /ui static Cache-Control {cc!r}, revalidation "
                         f"{'HTTP ' + str(r2.status_code) if r2 is not None else 'n/a'}")
    return lines


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
    loc = load("locations.json") if (DATA / "locations.json").exists() else None
    if isinstance(loc, dict) and isinstance(loc.get("places"), list):
        subs = [sp for pl in loc["places"] for sp in pl.get("sub_places") or []]
        by_status = {}
        for sp in subs:
            st = (sp.get("B_total_nT") or {}).get("status")
            by_status[st] = by_status.get(st, 0) + 1
        print(f"locations: {len(loc['places'])} places, {len(subs)} sub-places; |B| status: "
              + ", ".join(f"{k} {v}" for k, v in sorted(by_status.items())))
    print(check_verdict_inputs())
    hits = check_banned_word()
    print(f"banned word in /data and /server: {len(hits)} files")
    for line in check_server():
        print(line)
    print("problems:", len(problems))
    for p in problems:
        print("  -", p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
