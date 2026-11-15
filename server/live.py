"""Live feeds for /api/live (contract v10, Section 2 of the brief).

Feeds: NOAA SWPC L1 magnetometer (live), ISS position from wheretheiss.at (live), the IGRF field at the
ISS position (calculated), the Tiangong position from a CelesTrak TLE propagated with SGP4 plus IGRF
(calculated), the NOAA GOES magnetometer in geostationary orbit (near_live), ESA Swarm ASM via VirES
(near_live, needs VIRES_TOKEN), ISS cabin telemetry via Lightstreamer (optional, live). A feed that fails
returns None plus an error string; nothing is filled in.

The per-location fields come from data/locations.json through server/locations.py: this module only refreshes
the live inputs in memory. It no longer writes data/locations.json.
"""
from __future__ import annotations

import hashlib
import math
import os
from datetime import datetime, timedelta, timezone

import requests

from server import locations as loc_engine
from server.common import DATA, calc, meta, missing, now_iso, vo, write_json

UA = {"User-Agent": "SpinDrift-data-server/10 (research prototype)"}
TIMEOUT = 15

NOAA_URLS = [
    "https://services.swpc.noaa.gov/products/solar-wind/mag-5-minute.json",
    "https://services.swpc.noaa.gov/products/solar-wind/mag-2-hour.json",
    # NWS Service Change Notice 26-21 (2 Mar 2026) removed the /products/solar-wind/ files on or about
    # 30 Apr 2026; the official replacement is /json/rtsw/. Both old URLs are still tried first, as the
    # brief asks, and the VO note records that the replacement was used.
    "https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json",
]
SCN_26_21 = ("NWS SCN 26-21 (https://www.weather.gov/media/notification/pdf_2026/"
             "scn26-21_Data_Format_Changes_Impacting_SWPC_Products.pdf)")
GOES_URL = "https://services.swpc.noaa.gov/json/goes/primary/integral-protons-6-hour.json"
GOES_STALE = timedelta(minutes=30)
GOES_MAG_URL = "https://services.swpc.noaa.gov/json/goes/primary/magnetometers-6-hour.json"
GOES_MAG_PAGE = "NOAA SWPC, GOES Magnetometer, https://www.swpc.noaa.gov/products/goes-magnetometer"
CELESTRAK_URL = "https://celestrak.org/NORAD/elements/gp.php?CATNR={norad_id}&FORMAT=TLE"
TIANGONG_NORAD, ISS_NORAD = "48274", "25544"
TLE_REFRESH = timedelta(hours=2)   # CelesTrak updates GP data about every 2 hours and asks clients not to poll faster
TIANGONG_STALE = timedelta(minutes=5)
ISS_URL = "https://api.wheretheiss.at/v1/satellites/25544"
L1_STALE = timedelta(minutes=15)
ISS_STALE = timedelta(minutes=2)
SWARM_STALE = timedelta(hours=12)
OPM_RANGE_NOTE, QUSPIN = loc_engine.OPM_RANGE_NOTE, loc_engine.QUSPIN


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse_time(s: str) -> datetime:
    s = s.strip().replace(" ", "T")
    if s.endswith("Z"):
        s = s[:-1]
    dt = datetime.fromisoformat(s.split(".")[0])
    return dt.replace(tzinfo=timezone.utc)


def _json(r):
    """Parse a NOAA JSON response. Some SWPC files arrive as the complete JSON array followed by NUL padding
    (seen on 2026-11-15); the padding is ignored and reported. Returns (object, note or None)."""
    text = r.text
    stripped = text.rstrip("\x00 \t\r\n")
    pad = len(text) - len(stripped)
    import json as _j
    obj = _j.loads(stripped)
    return obj, (f"the file had {pad} trailing padding bytes (NUL) after the complete JSON array; they were ignored"
                 if pad and "\x00" in text[len(stripped):] else None)


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
            rows, pad_note = _json(r)
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
            ("brief URLs failed (" + "; ".join(errors) + "); they were retired by " + SCN_26_21 +
             " and replaced by this official /json/rtsw/ file; newest row with active=true") if errors else None)
        if pad_note:
            note = f"{note}; {pad_note}" if note else pad_note
        out = {
            "bt_nT": vo(_num(newest["bt"]), "nT", src, "live", "VERIFIED", as_of, note),
            "bx_gsm_nT": _vo_or_missing(newest.get("bx_gsm"), src, as_of),
            "by_gsm_nT": _vo_or_missing(newest.get("by_gsm"), src, as_of),
            "bz_gsm_nT": _vo_or_missing(newest.get("bz_gsm"), src, as_of),
            "bx_gse_nT": _vo_or_missing(newest.get("bx_gse"), src, as_of),
            "by_gse_nT": _vo_or_missing(newest.get("by_gse"), src, as_of),
            "bz_gse_nT": _vo_or_missing(newest.get("bz_gse"), src, as_of),
            "spacecraft": spacecraft,
            "retrieved_utc": now_iso(),
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
        "retrieved_utc": now_iso(),
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
    be, bn, bu = (float(np.asarray(c).ravel()[0]) for c in
                  ppigrf.igrf(pos["lon"]["value"], pos["lat"]["value"], pos["alt_km"]["value"], t))
    b = float(np.sqrt(be ** 2 + bn ** 2 + bu ** 2))
    v = calc(round(b, 1), "nT", [pos["lat"], pos["lon"], pos["alt_km"]],
             "|B| = sqrt(Be^2 + Bn^2 + Bu^2) from the IGRF model at geodetic lat, lon, altitude and time",
             ["iss.lat", "iss.lon", "iss.alt_km", "iss.as_of"], source=f"{gen}; inputs from wheretheiss.at",
             as_of=pos["lat"]["as_of"])
    v["components_enu_nT"] = [round(be, 1), round(bn, 1), round(bu, 1)]
    return v, gen


# ---------------------------------------------------------------- GOES proton flux (live radiation)
def fetch_goes():
    """Newest GOES primary integral proton flux at >=10 MeV and >=100 MeV (NOAA SWPC, 5-min averages)."""
    try:
        r = requests.get(GOES_URL, headers=UA, timeout=TIMEOUT)
        if r.status_code != 200:
            return None, f"GOES protons HTTP {r.status_code}"
        rows, pad_note = _json(r)
    except Exception as e:
        return None, f"GOES protons {type(e).__name__}: {e}"
    src = f"NOAA SWPC GOES primary integral protons, {GOES_URL}"
    out = {}
    for energy, key in ((">=10 MeV", "flux_ge10MeV_pfu"), (">=100 MeV", "flux_ge100MeV_pfu")):
        recs = [x for x in rows if x.get("energy") == energy and _num(x.get("flux")) is not None]
        if not recs:
            return None, f"GOES protons: no {energy} rows"
        newest = max(recs, key=lambda x: _parse_time(x["time_tag"]))
        out[key] = vo(round(_num(newest["flux"]), 4), "pfu (protons cm^-2 s^-1 sr^-1)", src, "live", "VERIFIED",
                      _iso(_parse_time(newest["time_tag"])),
                      "5-minute average" + (f"; {pad_note}" if pad_note else ""))
        out["satellite"] = f"GOES-{newest.get('satellite')}"
    f10 = out["flux_ge10MeV_pfu"]
    level = 0
    for i, thr in enumerate((10, 100, 1000, 10000, 100000), start=1):
        if f10["value"] >= thr:
            level = i
    out["noaa_s_scale"] = calc(f"S{level}" if level else "below S1", "", [f10],
                               "S-level from >=10 MeV flux thresholds 10, 100, 1000, 10000, 100000 pfu",
                               ["radiation.flux_ge10MeV_pfu"], source="NOAA SWPC, https://www.swpc.noaa.gov/products/"
                               "goes-proton-flux", as_of=f10["as_of"])
    return out, None


# ---------------------------------------------------------------- GOES magnetometer (near_live, geostationary orbit)
def fetch_goes_mag():
    """Newest 1-minute GOES primary magnetometer sample: total field and the Hp, He, Hn components."""
    try:
        r = requests.get(GOES_MAG_URL, headers=UA, timeout=TIMEOUT)
        if r.status_code != 200:
            return None, f"GOES magnetometer HTTP {r.status_code}"
        rows, pad_note = _json(r)
    except Exception as e:
        return None, f"GOES magnetometer {type(e).__name__}: {e}"
    recs = [x for x in rows if _num(x.get("total")) is not None and x.get("time_tag")
            and x.get("arcjet_flag") in (False, None, "false", 0)]
    if not recs:
        return None, "GOES magnetometer: no row with a numeric total field and no arcjet firing"
    newest = max(recs, key=lambda x: _parse_time(x["time_tag"]))
    as_of = _iso(_parse_time(newest["time_tag"]))
    sat = f"GOES-{newest.get('satellite')}"
    src = f"NOAA SWPC GOES primary magnetometer ({sat}), {GOES_MAG_URL}"
    where = ("1-minute sample in geostationary orbit, in Earth's geographic equatorial plane about 6.6 Earth radii "
             f"from Earth's centre ({GOES_MAG_PAGE})")

    def comp(key, what):
        v = _num(newest.get(key))
        if v is None:
            return missing("nT", src, "near_live", "NOT_STATED", f"{key} missing in the newest row")
        return vo(round(v, 2), "nT", src, "near_live", "VERIFIED", as_of, what)
    return {
        "total_nT": vo(round(_num(newest["total"]), 2), "nT", src, "near_live", "VERIFIED", as_of,
                       "total field Ht; " + where + (f"; {pad_note}" if pad_note else "")),
        "hp_nT": comp("Hp", "Hp: northward, perpendicular to the orbit plane"),
        "he_nT": comp("He", "He: earthward"),
        "hn_nT": comp("Hn", "Hn: eastward"),
        "satellite": sat, "retrieved_utc": now_iso(),
    }, None


# ---------------------------------------------------------------- two-line elements (CelesTrak) for SGP4
def fetch_tle(norad_id: str):
    """Newest CelesTrak GP element set for one object, as a tagged dict (three text lines: name, line 1, line 2)."""
    url = CELESTRAK_URL.format(norad_id=norad_id)
    try:
        r = requests.get(url, headers=UA, timeout=TIMEOUT)
        if r.status_code != 200:
            return None, f"CelesTrak TLE {norad_id} HTTP {r.status_code}"
        lines = [ln.rstrip() for ln in r.text.splitlines() if ln.strip()]
        if len(lines) < 3 or not lines[1].startswith("1 ") or not lines[2].startswith("2 "):
            return None, f"CelesTrak TLE {norad_id}: unexpected reply {r.text[:80]!r}"
        tle = {"norad_id": str(norad_id), "name": lines[0].strip(), "line1": lines[1], "line2": lines[2],
               "url": url, "retrieved_utc": now_iso(), "sha256": hashlib.sha256(r.content).hexdigest(),
               "tag": "recorded", "source": f"CelesTrak GP element set (TLE) for NORAD {norad_id}, {url}"}
        tle["epoch_utc"] = loc_engine.tle_epoch_iso(tle)
        return tle, None
    except Exception as e:
        return None, f"CelesTrak TLE {norad_id} {type(e).__name__}: {e}"


# ---------------------------------------------------------------- Swarm ASM (near_live)
# Swarm L1b Product Definition SW-RS-DSC-SY-0007 Issue 5.27, Table 6-2: Flags_F = 0 is "ASM nominal,
# scalar mode"; 1 = vector mode; 2..64 flag outliers, gaps, restarts or ASM/VFM disagreement; 255 = no F.
NOMINAL_F = {0}


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


# ---------------------------------------------------------------- published surface measurements (sources)
# The per-location field values live in data/locations.json (scripts/build_locations.py); these two source strings
# are kept here because the builder and the run engine cite them.
DYAL73 = ("Dyal, Parkin & Daily (1973), 'Surface magnetometer experiments: Internal lunar properties', Proc. Lunar "
          "Sci. Conf. 4th, 2925-2945, Table 2 p. 2930 (1 gamma = 1 nT); cross-check Dyal, Parkin & Daily (1974), "
          "Rev. Geophys. 12, 568, doi:10.1029/RG012i004p00568 (abstract)")
JOHNSON20 = ("Johnson et al. (2020), 'Crustal and time-varying magnetic fields at the InSight landing site on Mars', "
             "Nature Geoscience 13, 199-204, doi:10.1038/s41561-020-0537-x, p. 200 and Table 1")


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


def update_tiangong(state: dict) -> None:
    """Tiangong position now: SGP4 on the stored CelesTrak TLE (the one in data/locations.json, or a newer one
    fetched at most every TLE_REFRESH), then IGRF at that position."""
    tles = state.setdefault("tles", {})
    tle = tles.get("tiangong")
    if tle is None:
        doc = loc_engine.load() or {}
        tle = ((doc.get("meta") or {}).get("tles") or {}).get("tiangong")
    now = datetime.now(timezone.utc)
    err = None
    if tle is None or now - _parse_time(tle["retrieved_utc"]) > TLE_REFRESH:
        last_try = state.get("tle_last_try")
        if last_try is None or now - last_try > timedelta(minutes=10):
            state["tle_last_try"] = now
            fresh, err = fetch_tle(TIANGONG_NORAD)
            tle = fresh or tle
    if tle is None:
        state["tiangong"] = None
        state["errors"]["tiangong"] = err or "no TLE for Tiangong (CelesTrak unreachable and none in locations.json)"
        return
    tles["tiangong"] = tle
    try:
        state["tiangong"] = loc_engine.station_from_tle(tle, now, "tiangong")
        state["errors"]["tiangong"] = err
    except Exception as e:
        state["tiangong"] = None
        state["errors"]["tiangong"] = f"Tiangong SGP4/IGRF {type(e).__name__}: {e}"


def update_goes_mag(state: dict) -> None:
    goes, err = fetch_goes_mag()
    if goes is not None or not state.get("goes_mag") or feed_age_exceeded(state["goes_mag"]["total_nT"], GOES_STALE):
        state["goes_mag"] = goes
    state["errors"]["goes_mag"] = err


def update_swarm(state: dict) -> None:
    swarm, err = fetch_swarm()
    state["swarm_asm"] = swarm
    state["errors"]["swarm_asm"] = err


def update_goes(state: dict) -> None:
    goes, err = fetch_goes()
    if goes is not None or not state.get("radiation") or feed_age_exceeded(
            state["radiation"]["flux_ge10MeV_pfu"], GOES_STALE):
        state["radiation"] = goes
    state["errors"]["radiation"] = err


def feed_age_exceeded(v: dict, limit: timedelta) -> bool:
    return not v.get("as_of") or datetime.now(timezone.utc) - _parse_time(v["as_of"]) > limit


def compose(state: dict) -> dict:
    """Build the /api/live response from the current state. opm_readiness keeps its five older location ids; each
    is read from its sub-place in data/locations.json (server/locations.py LEGACY_IDS), refreshed from this state."""
    iss, l1 = state.get("iss"), state.get("l1")
    cabin = state.get("iss_cabin")
    resp = {
        "fetched_at": now_iso(),
        "iss": iss, "l1": l1, "swarm_asm": state.get("swarm_asm"), "iss_cabin": cabin,
        "opm_readiness": loc_engine.legacy_readiness(state),
        "radiation": state.get("radiation"),
        "tiangong": state.get("tiangong"), "goes_mag": state.get("goes_mag"),
        "errors": [e for e in state["errors"].values() if e],
    }
    state["response"] = resp
    return resp


def new_state() -> dict:
    return {"errors": {"l1": None, "iss": None, "swarm_asm": None, "iss_cabin": None, "radiation": None,
                       "tiangong": None, "goes_mag": None}}


def cycle(state: dict | None = None) -> dict:
    """Run one full live cycle (all feeds once)."""
    state = state if state is not None else new_state()
    update_l1(state)
    update_iss(state)
    update_tiangong(state)
    update_goes_mag(state)
    update_swarm(state)
    update_goes(state)
    return compose(state)


def write_outputs(resp: dict, locs=None) -> None:
    """Write live_snapshot.json (atomic) after a good cycle: L1 and ISS both present. Otherwise the last good
    snapshot stays in place as the offline fallback. data/locations.json is not written here any more: it is built
    by scripts/build_locations.py and its live entries are refreshed in memory (server/locations.py). `locs` is
    accepted and ignored so older callers keep working."""
    if resp.get("l1") is None or resp.get("iss") is None:
        return
    sources = [s for s in ["NOAA SWPC L1 magnetometer", "wheretheiss.at ISS position",
                           "IGRF via ppigrf" if resp.get("iss") else None,
                           "ESA Swarm ASM via VirES" if resp.get("swarm_asm") else None,
                           "data/locations.json (opm_readiness)"] if s]
    write_json(DATA / "live_snapshot.json", {"meta": meta(False, sources), **resp})


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
        "radiation": age_state((resp.get("radiation") or {}).get("flux_ge10MeV_pfu"), GOES_STALE),
        "tiangong": age_state((resp.get("tiangong") or {}).get("lat"), TIANGONG_STALE),
        "goes_mag": age_state((resp.get("goes_mag") or {}).get("total_nT"), GOES_STALE),
    }


if __name__ == "__main__":
    import json
    st = new_state()
    r = cycle(st)
    write_outputs(r)
    print(json.dumps({"errors": r["errors"], "l1_url": st.get("l1_url"),
                      "l1_bt": (r["l1"] or {}).get("bt_nT"), "iss_b": (r["iss"] or {}).get("b_total_nT"),
                      "health": feed_health(r)}, indent=1, ensure_ascii=False))
