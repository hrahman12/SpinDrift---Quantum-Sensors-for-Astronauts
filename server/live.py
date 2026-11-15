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
    # NWS Service Change Notice 26-21 (2 Mar 2026) removed the /products/solar-wind/ files on or about
    # 30 Apr 2026; the official replacement is /json/rtsw/. Both old URLs are still tried first, as the
    # brief asks, and the VO note records that the replacement was used.
    "https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json",
]
SCN_26_21 = ("NWS SCN 26-21 (https://www.weather.gov/media/notification/pdf_2026/"
             "scn26-21_Data_Format_Changes_Impacting_SWPC_Products.pdf)")
GOES_URL = "https://services.swpc.noaa.gov/json/goes/primary/integral-protons-6-hour.json"
GOES_STALE = timedelta(minutes=30)
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
            ("brief URLs failed (" + "; ".join(errors) + "); they were retired by " + SCN_26_21 +
             " and replaced by this official /json/rtsw/ file; newest row with active=true") if errors else None)
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
        rows = r.json()
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
                      _iso(_parse_time(newest["time_tag"])), "5-minute average")
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


# ---------------------------------------------------------------- locations and OPM readiness
DYAL73 = ("Dyal, Parkin & Daily (1973), 'Surface magnetometer experiments: Internal lunar properties', Proc. Lunar "
          "Sci. Conf. 4th, 2925-2945, Table 2 p. 2930 (1 gamma = 1 nT); cross-check Dyal, Parkin & Daily (1974), "
          "Rev. Geophys. 12, 568, doi:10.1029/RG012i004p00568 (abstract)")
JOHNSON20 = ("Johnson et al. (2020), 'Crustal and time-varying magnetic fields at the InSight landing site on Mars', "
             "Nature Geoscience 13, 199-204, doi:10.1038/s41561-020-0537-x, p. 200 and Table 1")


def published_fields():
    """Measured, published ambient fields for locations with no live feed. No value without a citation."""
    return {
        "lunar_base": vo(38, "nT", DYAL73, "recorded", "VERIFIED", None,
                         "Apollo 12 ALSEP lunar surface magnetometer, 38 ± 2 nT (deployed Nov 1969). Rule: median of the "
                         "three stationary ALSEP sites (Apollo 15: 3.4 ± 2.9, Apollo 12: 38 ± 2, Apollo 16: 234 ± 3 nT). "
                         "Measured sites range 3.4-327 nT (Apollo 16 Site 13); planned south-polar bases have no surface "
                         "measurement."),
        "mars_surface": vo(2013, "nT", JOHNSON20, "recorded", "VERIFIED", None,
                           "InSight lander magnetometer, average surface field 2,013 ± 53 nT (mean over sols 14-299, "
                           "20:00-04:00 local time); about ten times stronger than predicted from orbit."),
        "gateway": missing("nT", "no measurement from a near-rectilinear halo orbit", "recorded", "NOT_STATED",
                           "No magnetometer has measured an NRHO (CAPSTONE carried none). Nearest published: ARTEMIS "
                           "lunar-orbit magnetotail-lobe average about 10 nT (Kamaletdinov et al., JGR Space Physics 129, "
                           "e2023JA032130, Fig. 5f); the Gateway is in the solar wind most of each orbit and in the "
                           "magnetotail 5-6 days per lunar orbit (Dandouras et al. 2023, Front. Astron. Space Sci. "
                           "10:1120302)."),
    }


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
            amb = pub.get(loc) or missing("nT", "no cited measured value", "recorded", "NOT_STATED")
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


def update_goes(state: dict) -> None:
    goes, err = fetch_goes()
    if goes is not None or not state.get("radiation") or feed_age_exceeded(
            state["radiation"]["flux_ge10MeV_pfu"], GOES_STALE):
        state["radiation"] = goes
    state["errors"]["radiation"] = err


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
        "radiation": state.get("radiation"),
        "errors": [e for e in state["errors"].values() if e],
    }
    state["response"] = resp
    return resp


def new_state() -> dict:
    return {"errors": {"l1": None, "iss": None, "swarm_asm": None, "iss_cabin": None, "radiation": None}}


def cycle(state: dict | None = None) -> dict:
    """Run one full live cycle (all feeds once)."""
    state = state if state is not None else new_state()
    update_l1(state)
    update_iss(state)
    update_swarm(state)
    update_goes(state)
    return compose(state)


def write_outputs(resp: dict, locs: list) -> None:
    """Write live_snapshot.json and locations.json (atomic) after a good cycle: L1 and ISS both present.
    Otherwise the last good snapshot stays in place as the offline fallback."""
    if resp.get("l1") is None or resp.get("iss") is None:
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
        "radiation": age_state((resp.get("radiation") or {}).get("flux_ge10MeV_pfu"), GOES_STALE),
    }


if __name__ == "__main__":
    import json
    st = new_state()
    r = cycle(st)
    write_outputs(r, st["locations"])
    print(json.dumps({"errors": r["errors"], "l1_url": st.get("l1_url"),
                      "l1_bt": (r["l1"] or {}).get("bt_nT"), "iss_b": (r["iss"] or {}).get("b_total_nT"),
                      "health": feed_health(r)}, indent=1, ensure_ascii=False))
