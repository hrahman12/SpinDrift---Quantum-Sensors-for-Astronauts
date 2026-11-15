"""Live feeds for /api/live (contract v10, Section 2 of the brief).

Feeds: NOAA SWPC L1 magnetometer (live), ISS position from wheretheiss.at (live), the IGRF field at the
ISS position (calculated), ESA Swarm ASM via VirES (near_live, needs VIRES_TOKEN), ISS cabin telemetry
via Lightstreamer (optional, live). A feed that fails returns None plus an error string; nothing is
filled in.
"""
from __future__ import annotations

import math
import os
from datetime import datetime, timedelta, timezone

import requests

from server.common import DATA, LOCATION_IDS, calc, meta, missing, now_iso, read_json, vo, write_json

UA = {"User-Agent": "SpinDrift-data-server/10 (research prototype)"}
TIMEOUT = 15

NOAA_URLS = [
    "https://services.swpc.noaa.gov/products/solar-wind/mag-5-minute.json",
    "https://services.swpc.noaa.gov/products/solar-wind/mag-2-hour.json",
    # Official NOAA SWPC real-time solar wind (RTSW) 1-minute magnetometer file, same L1 instruments.
    # Used only if both product files above fail; the source field and STATUS.md say so.
    "https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json",
]
ISS_URL = "https://api.wheretheiss.at/v1/satellites/25544"
L1_STALE = timedelta(minutes=15)
ISS_STALE = timedelta(minutes=2)
SWARM_STALE = timedelta(hours=12)
OPM_RANGE_NOTE = ("Uses the external field. Fields inside a spacecraft cabin are larger; OSCAR-QUBE reported "
                  "interference from station equipment.")
QUSPIN = "QuSpin QZFM Gen-3 product page, https://quspin.com/products-qzfm/"


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse_time(s: str) -> datetime:
    s = s.strip().replace(" ", "T")
    if s.endswith("Z"):
        s = s[:-1]
    dt = datetime.fromisoformat(s.split(".")[0])
    return dt.replace(tzinfo=timezone.utc)


def _num(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


# ---------------------------------------------------------------- NOAA L1
def fetch_l1():
    """Newest L1 field sample. Returns (dict of VOs, error or None, url used)."""
    errors = []
    for url in NOAA_URLS:
        try:
            r = requests.get(url, headers=UA, timeout=TIMEOUT)
            if r.status_code != 200:
                errors.append(f"{url} HTTP {r.status_code}")
                continue
            rows = r.json()
        except Exception as e:  # network or JSON error
            errors.append(f"{url} {type(e).__name__}: {e}")
            continue
        if not rows:
            errors.append(f"{url} empty")
            continue
        if isinstance(rows[0], list):  # products/*.json: first row is the header
            header, body = rows[0], rows[1:]
            recs = [dict(zip(header, row)) for row in body]
            spacecraft = None
        else:  # json/rtsw: list of dicts; use the active spacecraft only
            recs = [x for x in rows if x.get("active") in (True, "true", 1)]
            spacecraft = None
        recs = [x for x in recs if _num(x.get("bt")) is not None and x.get("time_tag")]
        if not recs:
            errors.append(f"{url} no row with numeric bt")
            continue
        newest = max(recs, key=lambda x: _parse_time(x["time_tag"]))
        if "source" in newest:
            spacecraft = newest.get("source")
        as_of = _iso(_parse_time(newest["time_tag"]))
        src = f"NOAA SWPC, {url}"
        note = None if url == NOAA_URLS[0] else (
            "fallback: " + "; ".join(errors) if errors else None)
        out = {
            "bt_nT": vo(_num(newest["bt"]), "nT", src, "live", "VERIFIED", as_of, note),
            "bx_gsm_nT": _vo_or_missing(newest.get("bx_gsm"), src, as_of),
            "by_gsm_nT": _vo_or_missing(newest.get("by_gsm"), src, as_of),
            "bz_gsm_nT": _vo_or_missing(newest.get("bz_gsm"), src, as_of),
            "spacecraft": spacecraft,
        }
        return out, None, url, errors
    return None, "L1 feed failed: " + "; ".join(errors), None, errors


def _vo_or_missing(x, src, as_of):
    v = _num(x)
    if v is None:
        return missing("nT", src, "live", "NOT_STATED", "component missing in the newest row")
    return vo(v, "nT", src, "live", "VERIFIED", as_of)


# ---------------------------------------------------------------- ISS + IGRF
def fetch_iss():
    try:
        r = requests.get(ISS_URL, headers=UA, timeout=TIMEOUT)
        if r.status_code != 200:
            return None, f"ISS position HTTP {r.status_code}"
        j = r.json()
    except Exception as e:
        return None, f"ISS position {type(e).__name__}: {e}"
    as_of = _iso(datetime.fromtimestamp(int(j["timestamp"]), tz=timezone.utc))
    src = f"wheretheiss.at, {ISS_URL}"
    pos = {
        "lat": vo(_num(j["latitude"]), "deg", src, "live", "VERIFIED", as_of),
        "lon": vo(_num(j["longitude"]), "deg", src, "live", "VERIFIED", as_of),
        "alt_km": vo(_num(j["altitude"]), "km", src, "live", "VERIFIED", as_of),
        "velocity_kmh": vo(_num(j["velocity"]), "km/h", src, "live", "VERIFIED", as_of),
    }
    return pos, None


def igrf_total(pos: dict):
    """Total IGRF field (nT) at the live ISS position and time. Returns (VO, generation string)."""
    import numpy as np
    import ppigrf
    from importlib.metadata import version
    coeff = os.path.basename(ppigrf.igrf.__defaults__[0]) if ppigrf.igrf.__defaults__ else "unknown"
    gen = f"IGRF-{coeff.replace('IGRF', '').replace('.shc', '')} (ppigrf {version('ppigrf')}, {coeff})"
    t = _parse_time(pos["lat"]["as_of"]).replace(tzinfo=None)
    be, bn, bu = ppigrf.igrf(pos["lon"]["value"], pos["lat"]["value"], pos["alt_km"]["value"], t)
    b = float(np.sqrt(np.asarray(be).ravel()[0] ** 2 + np.asarray(bn).ravel()[0] ** 2 +
                      np.asarray(bu).ravel()[0] ** 2))
    v = calc(round(b, 1), "nT", [pos["lat"], pos["lon"], pos["alt_km"]],
             "|B| = sqrt(Be^2 + Bn^2 + Bu^2) from the IGRF model at geodetic lat, lon, altitude and time",
             ["iss.lat", "iss.lon", "iss.alt_km", "iss.as_of"], source=f"{gen}; inputs from wheretheiss.at",
             as_of=pos["lat"]["as_of"])
    return v, gen


# ---------------------------------------------------------------- Swarm ASM (near_live)
# Swarm L1b MAGx_LR Flags_F: see STATUS.md / server notes. Only values in NOMINAL_F count as nominal.
NOMINAL_F = {1}


def fetch_swarm():
    token = os.environ.get("VIRES_TOKEN")
    if not token:
        return None, "VIRES_TOKEN missing"
    try:
        from viresclient import SwarmRequest
        end = datetime.now(timezone.utc).replace(tzinfo=None)
        start = end - timedelta(hours=6)
        newest = None
        for coll, sat in [("SW_FAST_MAGA_LR_1B", "Swarm Alpha"), ("SW_FAST_MAGB_LR_1B", "Swarm Bravo")]:
            req = SwarmRequest(url="https://vires.services/ows", token=token)
            req.set_collection(coll)
            req.set_products(measurements=["F", "Flags_F"])
            data = req.get_between(start, end, show_progress=False)
            df = data.as_dataframe()
            if df.empty:
                continue
            df = df[df["Flags_F"].isin(NOMINAL_F)]
            if df.empty:
                continue
            row_t = df.index.max()
            row = df.loc[row_t]
            if newest is None or row_t > newest[0]:
                newest = (row_t, row, sat, coll)
        if newest is None:
            return None, "Swarm ASM: no nominal F sample in the last 6 hours"
        t, row, sat, coll = newest
        as_of = _iso(t.to_pydatetime().replace(tzinfo=timezone.utc))
        src = f"ESA Swarm {coll} via VirES (https://vires.services/ows)"
        return {
            "f_nT": vo(float(row["F"]), "nT", src, "near_live", "VERIFIED", as_of),
            "satellite": sat,
            "lat": vo(float(row["Latitude"]), "deg", src, "near_live", "VERIFIED", as_of),
            "lon": vo(float(row["Longitude"]), "deg", src, "near_live", "VERIFIED", as_of),
            "alt_km": vo(round(float(row["Radius"]) / 1000.0 - 6371.2, 1), "km", src, "near_live", "VERIFIED",
                         as_of, "altitude = Radius - 6371.2 km (mean Earth radius used by IGRF)"),
        }, None
    except Exception as e:
        return None, f"Swarm ASM {type(e).__name__}: {e}"


# ---------------------------------------------------------------- locations and OPM readiness
def published_fields():
    """Measured published fields for locations with no live feed (data/published_fields.json, curated
    with citations). Missing entries stay NOT_STATED."""
    return read_json(DATA / "published_fields.json", {}).get("fields", {})


LABELS = {"iss": "ISS (low Earth orbit)", "gateway": "Lunar Gateway (near-rectilinear halo orbit)",
          "lunar_base": "Lunar surface base", "mars_transit": "Mars transit (interplanetary)",
          "mars_surface": "Mars surface"}


def locations(iss_b, l1):
    pub = published_fields()
    out = []
    for loc in LOCATION_IDS:
        if loc == "iss":
            amb = iss_b or missing("nT", "IGRF at the live ISS position", "calculated", "NOT_YET_EXTRACTED",
                                   "ISS position or IGRF unavailable this cycle")
            kind = "model"
        elif loc == "mars_transit":
            if l1:
                b = dict(l1["bt_nT"])
                b["note"] = ((b.get("note") + "; ") if b.get("note") else "") + (
                    "measured at L1, about 1.5 million km from Earth; used as the interplanetary field for transit.")
                amb = b
            else:
                amb = missing("nT", "NOAA SWPC L1", "live", "NOT_YET_EXTRACTED", "L1 feed unavailable this cycle")
            kind = "live_feed"
        elif loc in pub and pub[loc].get("value") is not None:
            amb, kind = pub[loc], "published"
        else:
            amb = pub.get(loc) or missing("nT", "no cited measured value", "published_spec", "NOT_STATED")
            kind = "none"
        out.append({"id": loc, "label": LABELS[loc], "ambient_field_nT": amb, "field_kind": kind})
    return out


def opm_readiness(locs):
    rng = vo(5, "nT", QUSPIN, "datasheet", "VERIFIED", None,
             "QZFM dynamic range ±5 nT (specs.opm.dynamic_range). QuSpin also states the field at the sensor "
             "must be reduced to about 50 nT or below; built-in coils cancel residual fields up to 50 nT.")
    out = {}
    for loc in locs:
        amb = loc["ambient_field_nT"]
        if amb["value"] is None:
            sf = calc(None, "×", [amb, rng], "ambient_nT / opm_range_nT", [f"{loc['id']}.ambient_field_nT",
                                                                          "specs.opm.dynamic_range"])
            within = None
        else:
            sf = calc(round(amb["value"] / 5.0, 2), "×", [amb, rng], "ambient_nT / opm_range_nT",
                      [f"{loc['id']}.ambient_field_nT", "specs.opm.dynamic_range"], as_of=amb.get("as_of"))
            within = bool(amb["value"] <= 5.0)
        sf["note"] = sf["note"] + ". " + OPM_RANGE_NOTE
        out[loc["id"]] = {"ambient_nT": amb, "opm_range_nT": rng, "shielding_factor": sf, "within_range": within}
    return out


# ---------------------------------------------------------------- state updates and one full cycle
def update_l1(state: dict) -> None:
    l1, err, url, _ = fetch_l1()
    if l1 is not None or "l1" not in state:
        state["l1"] = l1
    elif state.get("l1") and feed_age_exceeded(state["l1"]["bt_nT"], L1_STALE):
        state["l1"] = None  # keep the last sample only while it is not stale
    state["l1_url"] = url
    state["errors"]["l1"] = err


def update_iss(state: dict) -> None:
    pos, err = fetch_iss()
    if err:
        state["errors"]["iss"] = err
        if state.get("iss") and feed_age_exceeded(state["iss"]["lat"], ISS_STALE):
            state["iss"] = None
        return
    try:
        b, gen = igrf_total(pos)
        state["iss"] = {**pos, "b_total_nT": b, "igrf_generation": gen}
        state["errors"]["iss"] = None
    except Exception as e:
        state["iss"] = {**pos, "b_total_nT": missing("nT", "IGRF", "calculated", "NOT_YET_EXTRACTED", str(e)),
                        "igrf_generation": "unavailable"}
        state["errors"]["iss"] = f"IGRF {type(e).__name__}: {e}"


def update_swarm(state: dict) -> None:
    swarm, err = fetch_swarm()
    state["swarm_asm"] = swarm
    state["errors"]["swarm_asm"] = err


def feed_age_exceeded(v: dict, limit: timedelta) -> bool:
    return not v.get("as_of") or datetime.now(timezone.utc) - _parse_time(v["as_of"]) > limit


def compose(state: dict) -> dict:
    """Build the /api/live response from the current state."""
    iss, l1 = state.get("iss"), state.get("l1")
    cabin = state.get("iss_cabin")
    locs = locations(iss["b_total_nT"] if iss else None, l1)
    state["locations"] = locs
    resp = {
        "fetched_at": now_iso(),
        "iss": iss, "l1": l1, "swarm_asm": state.get("swarm_asm"), "iss_cabin": cabin,
        "opm_readiness": opm_readiness(locs),
        "errors": [e for e in state["errors"].values() if e],
    }
    state["response"] = resp
    return resp


def new_state() -> dict:
    return {"errors": {"l1": None, "iss": None, "swarm_asm": None, "iss_cabin": None}}


def cycle(state: dict | None = None) -> dict:
    """Run one full live cycle (all feeds once)."""
    state = state if state is not None else new_state()
    update_l1(state)
    update_iss(state)
    update_swarm(state)
    return compose(state)


def write_outputs(resp: dict, locs: list) -> None:
    """Write live_snapshot.json and locations.json (atomic). Only after a cycle with L1 or ISS data."""
    if resp.get("l1") is None and resp.get("iss") is None:
        return
    sources = [s for s in ["NOAA SWPC L1 magnetometer", "wheretheiss.at ISS position",
                           "IGRF via ppigrf" if resp.get("iss") else None,
                           "ESA Swarm ASM via VirES" if resp.get("swarm_asm") else None] if s]
    write_json(DATA / "live_snapshot.json", {"meta": meta(False, sources), **resp})
    pub_sources = [l["ambient_field_nT"]["source"] for l in locs if l["field_kind"] == "published"]
    write_json(DATA / "locations.json", {"meta": meta(False, sources + pub_sources), "locations": locs})


def feed_health(resp: dict) -> dict:
    now = datetime.now(timezone.utc)

    def age_state(v, limit):
        if not v or v.get("as_of") is None:
            return "error"
        return "stale" if now - _parse_time(v["as_of"]) > limit else "ok"

    return {
        "l1": age_state((resp.get("l1") or {}).get("bt_nT"), L1_STALE),
        "iss": age_state((resp.get("iss") or {}).get("lat"), ISS_STALE),
        "igrf": "ok" if (resp.get("iss") or {}).get("b_total_nT", {}).get("value") is not None else "error",
        "swarm_asm": age_state((resp.get("swarm_asm") or {}).get("f_nT"), SWARM_STALE),
        "iss_cabin": "ok" if resp.get("iss_cabin") else "error",
    }


if __name__ == "__main__":
    import json
    st = new_state()
    r = cycle(st)
    write_outputs(r, st["locations"])
    print(json.dumps({"errors": r["errors"], "l1_url": st.get("l1_url"),
                      "l1_bt": (r["l1"] or {}).get("bt_nT"), "iss_b": (r["iss"] or {}).get("b_total_nT"),
                      "health": feed_health(r)}, indent=1, ensure_ascii=False))
