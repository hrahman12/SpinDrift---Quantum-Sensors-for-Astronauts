"""Location engine: data/locations.json (10 places, each with sub-places) and what the server does with it.

The file is built by scripts/build_locations.py and is the single source for the environment of every location:
background magnetic field (value object), field vector, radiation context and the three calculated fields the
sensors read (OPM range check, NV Zeeman shift, ratio to Earth's surface field).

The server never rewrites the file. Entries that follow a live feed (ISS position every 5 s, Tiangong every 60 s,
NOAA magnetometers every 60 s) are refreshed in memory from the live state and served by GET /api/locations.
Location ids: the sub-place ids of the file ("<place>.<sub>") and the five older ids, mapped by LEGACY_IDS.
Nothing here creates a data value: helpers wrap, copy or combine values that came from a source.
"""
from __future__ import annotations

import copy
import math
import threading
from datetime import datetime, timezone

from server.common import DATA, calc, missing, now_iso, read_json, vo

FILE = DATA / "locations.json"
LEGACY_IDS = {"iss": "iss.destiny", "gateway": "gateway.halo", "lunar_base": "moon_south_pole.shackleton_rim",
              "mars_transit": "mars_transit.cruise", "mars_surface": "mars_surface.insight"}
PLACE_IDS = ["iss", "tiangong", "iss_hotspots", "earth_analog", "earth_flight", "gateway", "moon_south_pole",
             "lunar_anomalies", "mars_transit", "mars_surface"]
REFRESH = ("live_5s", "on_build", "static")
FRAMES = ("NED", "body-fixed", "GSE")
PERIOD_S = {"iss": 5, "tiangong": 60, "noaa_l1": 60, "goes_mag": 60}

# ---------------------------------------------------------------- calculated fields (formulas of the brief)
GAMMA_NV = 28.025  # MHz per mT
NV_FORMULA = "28.025 MHz/mT x |B|"
GAMMA_SOURCE = ("SpinDrift calculation; 28.025 MHz/mT is the electron gyromagnetic ratio gamma_e/2pi (CODATA 2022, "
                "28 024.951 3861 MHz/T, rounded to five digits; data/quantum_constants.json "
                "electron.gyromagnetic_ratio_over_2pi)")
OPM_RANGE_NT = 5.0
QUSPIN = "QuSpin QZFM Gen-3 product page, https://quspin.com/products-qzfm/"
OPM_FORMULA = "|B| <= 5 nT"
OPM_NOTE_OUT = ("requires magnetic shielding / field nulling coils (QuSpin operates in a shielded or compensated "
                "environment)")
OPM_NOTE_IN = ("the background field magnitude is inside the QZFM ±5 nT dynamic range at this time; this is the field "
               "outside any vehicle or habitat and does not show that the OPM runs unshielded: QuSpin operates in a "
               "shielded or compensated environment, and the field at the sensor is not measured here")
OPM_NOTE_NONE = ("no sourced field value for this sub-place, so the range check is not decided; QuSpin operates in a "
                 "shielded or compensated environment")
OPM_RANGE_NOTE = ("Uses the external field. Fields inside a spacecraft cabin are larger; OSCAR-QUBE reported "
                  "interference from station equipment.")
RATIO_FORMULA = "|B| / IGRF |B| at Johnson Space Center"
BOUND_FORMULA = ("|B| <= |B_crustal| + |B_ambient| (upper bound from the triangle inequality; the crustal vector is "
                 "body-fixed and the ambient vector is GSE, so the two are not added as vectors)")


def sig(x: float, n: int = 6) -> float:
    """x rounded to n significant digits."""
    return 0.0 if x == 0 else float(f"{x:.{n}g}")


def is_number(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def derived(value, unit, inputs: list[dict], formula: str, ids: list[str], source="SpinDrift calculation",
            as_of=None, extra: str | None = None) -> dict:
    """A calculated value object. Like common.calc, except that a null result keeps the status of the null input
    (an input that its source does not state stays NOT_STATED instead of becoming NOT_YET_EXTRACTED)."""
    note = f"formula: {formula}; inputs: {', '.join(ids)}" + (f"; {extra}" if extra else "")
    nulls = [i for i in inputs if i.get("value") is None]
    if value is None or nulls:
        status = nulls[0].get("status") if nulls else "NOT_YET_EXTRACTED"
        return vo(None, unit, source, "calculated", "NOT_YET_EXTRACTED" if status in (None, "VERIFIED") else status,
                  None, note)
    status = "TO_CONFIRM" if any(i.get("status") == "TO_CONFIRM" for i in inputs) else "VERIFIED"
    return vo(value, unit, source, "calculated", status, as_of, note)


def derive(sp: dict, reference: dict | None) -> dict:
    """Set the three calculated fields of a sub-place from its B_total_nT: opm_in_range (+ opm_note),
    nv_zeeman_shift_MHz and ratio_to_earth_surface. `reference` is the IGRF |B| value object at Johnson Space Center."""
    b = sp["B_total_nT"]
    val = b.get("value") if is_number(b.get("value")) else None
    sid = sp["id"]
    if val is None:
        sp["opm_in_range"], sp["opm_note"] = None, OPM_NOTE_NONE
    else:
        sp["opm_in_range"] = bool(abs(val) <= OPM_RANGE_NT)
        sp["opm_note"] = OPM_NOTE_IN if sp["opm_in_range"] else OPM_NOTE_OUT
    nv = derived(None if val is None else round(GAMMA_NV * abs(val) * 1e-6, 9), "MHz", [b], NV_FORMULA,
                 [f"{sid}.B_total_nT"], source=GAMMA_SOURCE, as_of=b.get("as_of"),
                 extra="|B| in mT = nT x 1e-6; shift of one NV resonance line for a field along the NV axis (the two "
                       "lines separate by twice this)")
    nv["formula"] = NV_FORMULA
    sp["nv_zeeman_shift_MHz"] = nv
    ref = reference or missing("nT", "IGRF at Johnson Space Center", "calculated", "NOT_YET_EXTRACTED")
    ref_val = ref.get("value") if is_number(ref.get("value")) else None
    sp["ratio_to_earth_surface"] = derived(
        None if val is None or not ref_val else sig(abs(val) / ref_val), "×", [b, ref], RATIO_FORMULA,
        [f"{sid}.B_total_nT", "meta.reference.earth_surface_nT (earth_flight.jsc)"], as_of=b.get("as_of"))
    return sp


def upper_bound(sid: str, crustal: dict, ambient: dict, retrieved_utc: str | None = None) -> dict:
    """Background field of a lunar surface site: published crustal model value plus the ambient interplanetary or
    magnetotail field, as an upper bound on the magnitude of their sum."""
    ok = is_number(crustal.get("value")) and is_number(ambient.get("value"))
    v = derived(round(crustal["value"] + ambient["value"], 3) if ok else None, "nT", [crustal, ambient], BOUND_FORMULA,
                [f"{sid}.components.crustal_nT", f"{sid}.components.ambient_nT"],
                source=f"SpinDrift calculation from (1) {crustal.get('source')} and (2) {ambient.get('source')}",
                as_of=ambient.get("as_of"))
    v["retrieved_utc"] = retrieved_utc or ambient.get("retrieved_utc") or now_iso()
    return v


# ---------------------------------------------------------------- orbit and IGRF
WGS84_A_KM, WGS84_F = 6378.137, 1 / 298.257223563


def igrf_generation() -> str:
    import os
    from importlib.metadata import version

    import ppigrf
    coeff = os.path.basename(ppigrf.igrf.__defaults__[0]) if ppigrf.igrf.__defaults__ else "unknown"
    return f"IGRF-{coeff.replace('IGRF', '').replace('.shc', '')} (ppigrf {version('ppigrf')}, {coeff})"


def igrf_enu(lat: float, lon: float, alt_km: float, when: datetime) -> tuple[float, float, float]:
    """IGRF field (east, north, up) in nT at geodetic latitude, longitude, height above the WGS84 ellipsoid."""
    import numpy as np
    import ppigrf
    t = when.astimezone(timezone.utc).replace(tzinfo=None) if when.tzinfo else when
    be, bn, bu = (float(np.asarray(c).ravel()[0]) for c in ppigrf.igrf(lon, lat, alt_km, t))
    return be, bn, bu


def ned_vector(be: float, bn: float, bu: float, source: str, as_of: str | None, tag="calculated") -> dict:
    return {"x": round(bn, 1), "y": round(be, 1), "z": round(-bu, 1), "frame": "NED",
            "axes": "x north, y east, z down (local geodetic)", "unit": "nT", "tag": tag, "source": source,
            "as_of": as_of}


def no_vector(frame: str, why: str, tag="calculated") -> dict:
    return {"x": None, "y": None, "z": None, "frame": frame, "axes": None, "unit": "nT", "tag": tag,
            "source": why, "as_of": None}


def gmst_rad(when: datetime) -> float:
    """Greenwich mean sidereal time (IAU 1982 expression, as in Vallado; UT1 taken as UTC)."""
    from sgp4.api import jday
    jd, fr = jday(when.year, when.month, when.day, when.hour, when.minute, when.second + when.microsecond * 1e-6)
    t = ((jd - 2451545.0) + fr) / 36525.0
    s = 67310.54841 + (876600.0 * 3600 + 8640184.812866) * t + 0.093104 * t * t - 6.2e-6 * t ** 3
    return math.radians((s % 86400.0) / 240.0)


def teme_to_geodetic(r_km, when: datetime) -> tuple[float, float, float]:
    """TEME position (km) -> geodetic latitude, longitude (deg) and height (km) on WGS84. The rotation uses GMST
    only (no polar motion); checked against astropy's TEME -> ITRS: agreement better than 0.1 km."""
    g = gmst_rad(when)
    x = math.cos(g) * r_km[0] + math.sin(g) * r_km[1]
    y = -math.sin(g) * r_km[0] + math.cos(g) * r_km[1]
    z = r_km[2]
    e2 = WGS84_F * (2 - WGS84_F)
    p = math.hypot(x, y)
    lat = math.atan2(z, p * (1 - e2))
    for _ in range(8):
        n = WGS84_A_KM / math.sqrt(1 - e2 * math.sin(lat) ** 2)
        h = p / math.cos(lat) - n
        lat = math.atan2(z, p * (1 - e2 * n / (n + h)))
    n = WGS84_A_KM / math.sqrt(1 - e2 * math.sin(lat) ** 2)
    return math.degrees(lat), math.degrees(math.atan2(y, x)), p / math.cos(lat) - n


def satrec(tle: dict):
    from sgp4.api import Satrec
    return Satrec.twoline2rv(tle["line1"], tle["line2"])


def propagate(sat, when: datetime) -> tuple[float, float, float]:
    """Geodetic (lat, lon, height km) of a satellite at a UTC time, by SGP4."""
    from sgp4.api import jday
    when = when.astimezone(timezone.utc)
    jd, fr = jday(when.year, when.month, when.day, when.hour, when.minute, when.second + when.microsecond * 1e-6)
    err, r, _ = sat.sgp4(jd, fr)
    if err != 0:
        raise RuntimeError(f"SGP4 error code {err}")
    return teme_to_geodetic(r, when)


def tle_epoch_iso(tle: dict) -> str:
    from sgp4.api import Satrec
    from sgp4.conveniences import sat_epoch_datetime
    return sat_epoch_datetime(Satrec.twoline2rv(tle["line1"], tle["line2"])).replace(microsecond=0).isoformat() \
        .replace("+00:00", "Z")


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def station_from_tle(tle: dict, when: datetime, label: str) -> dict:
    """Position (SGP4 on a stored TLE) and IGRF field of a station, in the same shape as the live ISS state."""
    from importlib.metadata import version
    when = when.astimezone(timezone.utc).replace(microsecond=0)
    lat, lon, alt = propagate(satrec(tle), when)
    as_of = _iso(when)
    src = (f"SGP4 (python sgp4 {version('sgp4')}) propagation of the CelesTrak TLE for NORAD {tle['norad_id']} "
           f"({tle['name']}), TLE epoch {tle['epoch_utc']}, {tle['url']}")
    note = ("formula: SGP4 propagation to as_of, then TEME -> Earth-fixed by GMST and WGS84 geodetic conversion; "
            f"inputs: {label}.tle (retrieved {tle['retrieved_utc']}, sha256 {tle['sha256'][:12]}...)")
    pos = {"lat": vo(round(lat, 4), "deg", src, "calculated", "VERIFIED", as_of, note),
           "lon": vo(round(lon, 4), "deg", src, "calculated", "VERIFIED", as_of, note),
           "alt_km": vo(round(alt, 2), "km", src, "calculated", "VERIFIED", as_of, note)}
    gen = igrf_generation()
    be, bn, bu = igrf_enu(lat, lon, alt, when)
    b = calc(round(math.sqrt(be * be + bn * bn + bu * bu), 1), "nT", [pos["lat"], pos["lon"], pos["alt_km"]],
             "|B| = sqrt(Be^2 + Bn^2 + Bu^2) from the IGRF model at geodetic lat, lon, altitude and time",
             [f"{label}.lat", f"{label}.lon", f"{label}.alt_km", f"{label}.as_of"],
             source=f"{gen}; position from SGP4 on the CelesTrak TLE for NORAD {tle['norad_id']}", as_of=as_of)
    b["components_enu_nT"] = [round(be, 1), round(bn, 1), round(bu, 1)]
    return {**pos, "b_total_nT": b, "igrf_generation": gen, "retrieved_utc": now_iso(),
            "tle_epoch_utc": tle["epoch_utc"], "tle_retrieved_utc": tle["retrieved_utc"]}


# ---------------------------------------------------------------- sub-place fields from a feed
def apply_station(sp: dict, st: dict | None) -> bool:
    """Position and IGRF field of a station sub-place from a live-state dict (ISS or Tiangong)."""
    if not st or not st.get("lat") or st["lat"].get("value") is None:
        return False
    lat = st["lat"]
    sp["coords"] = {"lat": lat["value"], "lon": st["lon"]["value"], "alt_km": st["alt_km"]["value"],
                    "tag": lat["tag"], "source": lat["source"], "as_of": lat["as_of"], "note": lat.get("note")}
    b = dict(st.get("b_total_nT") or missing("nT", "IGRF", "calculated", "NOT_YET_EXTRACTED"))
    enu = b.pop("components_enu_nT", None)
    b["retrieved_utc"] = st.get("retrieved_utc") or now_iso()
    sp["B_total_nT"] = b
    sp["B_vector_nT"] = (ned_vector(enu[0], enu[1], enu[2], b["source"], b.get("as_of")) if enu and b.get("value")
                         is not None else no_vector("NED", "IGRF vector unavailable this cycle"))
    return True


L1_NOTE = ("measured at the Sun-Earth L1 point, about 1.5 million km sunward of Earth; used as the interplanetary "
           "field near 1 AU")


def l1_total(l1: dict | None) -> dict | None:
    """NOAA L1 total field as a locations value object (tag near_live), or None when the feed has no sample."""
    if not l1 or not l1.get("bt_nT") or l1["bt_nT"].get("value") is None:
        return None
    src = l1["bt_nT"]
    note = "; ".join(x for x in (src.get("note"), L1_NOTE, f"spacecraft {l1.get('spacecraft')}"
                                 if l1.get("spacecraft") else None) if x)
    v = vo(src["value"], "nT", src["source"], "near_live", "VERIFIED", src["as_of"], note)
    v["retrieved_utc"] = l1.get("retrieved_utc") or now_iso()
    return v


def l1_vector(l1: dict | None) -> dict:
    comps = [(l1 or {}).get(k) for k in ("bx_gse_nT", "by_gse_nT", "bz_gse_nT")]
    if not all(c and c.get("value") is not None for c in comps):
        return no_vector("GSE", "GSE components missing in the newest NOAA L1 row", "near_live")
    return {"x": comps[0]["value"], "y": comps[1]["value"], "z": comps[2]["value"], "frame": "GSE",
            "axes": "geocentric solar ecliptic: x toward the Sun, z toward ecliptic north", "unit": "nT",
            "tag": "near_live", "source": comps[0]["source"], "as_of": comps[0]["as_of"]}


def goes_total(goes: dict | None) -> dict | None:
    if not goes or not goes.get("total_nT") or goes["total_nT"].get("value") is None:
        return None
    v = dict(goes["total_nT"])
    v["retrieved_utc"] = goes.get("retrieved_utc") or now_iso()
    return v


def goes_vector(goes: dict | None) -> dict:
    comps = [(goes or {}).get(k) for k in ("hp_nT", "hn_nT", "he_nT")]
    if not all(c and c.get("value") is not None for c in comps):
        return no_vector("NED", "GOES magnetometer components missing", "near_live")
    return {"x": comps[0]["value"], "y": comps[1]["value"], "z": comps[2]["value"], "frame": "NED",
            "axes": "at the satellite: x = Hp (northward, perpendicular to the orbit plane), y = Hn (eastward), "
                    "z = He (earthward)", "unit": "nT", "tag": "near_live", "source": comps[0]["source"],
            "as_of": comps[0]["as_of"]}


def apply_feeds(sp: dict, feeds: dict, reference: dict | None) -> None:
    """Refresh one sub-place from the feeds it follows (sp['live_source'], and 'feed' keys on its components and
    context value objects), then recompute its calculated fields. A feed with no sample leaves the built value."""
    src = sp.get("live_source")
    changed = False
    if src in ("iss", "tiangong"):
        changed = apply_station(sp, feeds.get(src))
    elif src == "noaa_l1":
        v = l1_total(feeds.get("l1"))
        if v:
            sp["B_total_nT"], sp["B_vector_nT"], changed = v, l1_vector(feeds.get("l1")), True
    elif src == "goes_mag":
        v = goes_total(feeds.get("goes_mag"))
        if v:
            sp["B_total_nT"], sp["B_vector_nT"], changed = v, goes_vector(feeds.get("goes_mag")), True
    for group in ("components", "context"):
        for key, item in (sp.get(group) or {}).items():
            feed = item.get("feed") if isinstance(item, dict) else None
            v = l1_total(feeds.get("l1")) if feed == "noaa_l1" else goes_total(feeds.get("goes_mag")) \
                if feed == "goes_mag" else None
            if v:
                sp[group][key] = {**v, "feed": feed}
                changed = changed or group == "components"
    comp = sp.get("components") or {}
    if "crustal_nT" in comp and "ambient_nT" in comp and comp["ambient_nT"].get("feed"):
        sp["B_total_nT"] = upper_bound(sp["id"], comp["crustal_nT"], comp["ambient_nT"])
    if changed:
        derive(sp, reference)


# ---------------------------------------------------------------- the file, ids and the refreshed view
_CACHE: dict = {"mtime": None, "doc": None}
_LOCK = threading.Lock()


def is_built(doc) -> bool:
    return (isinstance(doc, dict) and isinstance(doc.get("places"), list) and bool(doc["places"])
            and not (doc.get("meta") or {}).get("fixture"))


def load() -> dict | None:
    """The built locations file, or None if it was never built. If the file on disk stops being in this shape
    (for example an older server process rewrote it), the last good copy read by this process is kept."""
    try:
        mtime = FILE.stat().st_mtime
    except OSError:
        mtime = None
    with _LOCK:
        if mtime is not None and mtime != _CACHE["mtime"]:
            doc = read_json(FILE, None)
            _CACHE["mtime"] = mtime
            if is_built(doc):
                _CACHE["doc"] = doc
        return _CACHE["doc"]


def sub_places(doc: dict | None):
    for place in (doc or {}).get("places", []):
        for sp in place.get("sub_places", []):
            yield sp


def sub_ids(doc: dict | None = None) -> list[str]:
    return [sp["id"] for sp in sub_places(doc if doc is not None else load())]


def resolve(location_id: str) -> str | None:
    """The sub-place id for a location id: a sub-place id as is, or one of the five older ids through LEGACY_IDS.
    Before the file is built, the five older ids still resolve (their field is then missing)."""
    doc = load()
    if doc is None:
        return LEGACY_IDS.get(location_id)
    ids = set(sub_ids(doc))
    if location_id in ids:
        return location_id
    mapped = LEGACY_IDS.get(location_id)
    return mapped if mapped in ids else None


def accepted_ids() -> list[str]:
    return list(LEGACY_IDS) + sub_ids()


def reference(doc: dict | None = None) -> dict | None:
    doc = doc if doc is not None else load()
    return ((doc or {}).get("meta") or {}).get("reference", {}).get("earth_surface_nT")


def feeds_of(state: dict | None) -> dict:
    state = state or {}
    return {"iss": state.get("iss"), "tiangong": state.get("tiangong"), "l1": state.get("l1"),
            "goes_mag": state.get("goes_mag")}


def _placeholder(sub_id: str) -> dict:
    place = sub_id.split(".")[0]
    sp = {"id": sub_id, "group": None, "place_id": place, "place": place, "sub_place": sub_id.split(".")[-1],
          "body": None, "coords": None,
          "B_total_nT": {**missing("nT", "data/locations.json is not built (run scripts/build_locations.py)",
                                   "calculated", "NOT_YET_EXTRACTED"), "retrieved_utc": None},
          "B_vector_nT": no_vector("NED", "data/locations.json is not built"),
          "radiation_context": {"text": None, "source": None}, "notes": "data/locations.json is not built.",
          "refresh": "static", "live_source": None}
    return derive(sp, None)


def current(state: dict | None = None) -> dict | None:
    """The whole file with every live entry refreshed from the server's live state."""
    doc = load()
    if doc is None:
        return None
    doc = copy.deepcopy(doc)
    feeds, ref = feeds_of(state), reference(doc)
    for sp in sub_places(doc):
        apply_feeds(sp, feeds, ref)

    def as_of(v):
        return (v or {}).get("as_of")
    doc["served"] = {
        "at": now_iso(),
        "refreshed_as_of": {"iss": as_of((feeds["iss"] or {}).get("lat")),
                            "tiangong": as_of((feeds["tiangong"] or {}).get("lat")),
                            "noaa_l1": as_of((feeds["l1"] or {}).get("bt_nT")),
                            "goes_mag": as_of((feeds["goes_mag"] or {}).get("total_nT"))},
        "period_s": PERIOD_S,
        "note": "live_source iss, tiangong, noaa_l1 and goes_mag entries are refreshed in memory by the server; "
                "every other entry is as built (meta.generated_at). The file on disk is not rewritten.",
        "errors": [e for e in ((state or {}).get("errors") or {}).values() if e],
    }
    return doc


def get(state: dict | None, location_id: str) -> dict | None:
    """One sub-place (refreshed) for a sub-place id or one of the five older ids; None if the id is unknown."""
    sub_id = resolve(location_id)
    if sub_id is None:
        return None
    doc = load()
    if doc is None:
        return _placeholder(sub_id)
    sp = copy.deepcopy(next(s for s in sub_places(doc) if s["id"] == sub_id))
    apply_feeds(sp, feeds_of(state), reference(doc))
    return sp


# ---------------------------------------------------------------- what the sensors read
def bare(v: dict) -> dict:
    """The seven value-object keys only."""
    return {k: v.get(k) for k in ("value", "unit", "source", "tag", "status", "as_of", "note")}


def opm_range_vo() -> dict:
    return vo(5, "nT", QUSPIN, "datasheet", "VERIFIED", None,
              "QZFM dynamic range ±5 nT (specs.opm.dynamic_range). QuSpin also states the field at the sensor "
              "must be reduced to about 50 nT or below; built-in coils cancel residual fields up to 50 nT.")


def readiness(sp: dict) -> dict:
    """The /api/live opm_readiness entry for a sub-place: ambient field, OPM range, reduction needed, in range."""
    amb, rng = bare(sp["B_total_nT"]), opm_range_vo()
    ids = [f"locations.{sp['id']}.B_total_nT", "specs.opm.dynamic_range"]
    if is_number(amb.get("value")):
        sf = calc(round(amb["value"] / OPM_RANGE_NT, 2), "×", [amb, rng], "ambient_nT / opm_range_nT", ids,
                  as_of=amb.get("as_of"))
        within = bool(amb["value"] <= OPM_RANGE_NT)
    else:
        sf, within = calc(None, "×", [amb, rng], "ambient_nT / opm_range_nT", ids), None
    sf["note"] = sf["note"] + ". " + OPM_RANGE_NOTE
    return {"ambient_nT": amb, "opm_range_nT": rng, "shielding_factor": sf, "within_range": within,
            "location_id": sp["id"]}


def legacy_readiness(state: dict | None) -> dict:
    """opm_readiness for the five older location ids, each read from its mapped sub-place."""
    out = {}
    for old in LEGACY_IDS:
        sp = get(state, old)
        if sp is not None:
            out[old] = readiness(sp)
    return out


def values_for_run(sp: dict) -> dict:
    """The location's value objects as stored in a run record."""
    return {k: sp.get(k) for k in ("id", "group", "place", "sub_place", "body", "coords", "B_total_nT", "B_vector_nT",
                                   "radiation_context", "opm_in_range", "opm_note", "nv_zeeman_shift_MHz",
                                   "ratio_to_earth_surface", "refresh", "live_source") if k in sp} | {
        k: sp[k] for k in ("components", "pass") if k in sp}


def environment(sp: dict, shield: dict) -> dict:
    """The environment object of POST /api/verdict: what the location hands to the four sensors.
    `shield` is the shielding-factor value object (user input, or the stated app default 1)."""
    b = sp["B_total_nT"]
    s = shield.get("value")
    at_sensor = derived(sig(b["value"] / s) if is_number(b.get("value")) and is_number(s) and s > 0 else None, "nT",
                        [b, shield], "B_at_sensor = |B| / shielding_factor",
                        [f"locations.{sp['id']}.B_total_nT", "inputs.shielding_factor"], as_of=b.get("as_of"),
                        extra="field left at the sensor after the stated shield; the OPM requirement checks it "
                              "against the on-board compensation limit")
    return {
        "location_id": sp["id"], "place": sp.get("place"), "sub_place": sp.get("sub_place"), "body": sp.get("body"),
        "B_total_nT": b, "shielding_factor": shield, "B_at_sensor_nT": at_sensor,
        "nv_zeeman_shift_MHz": sp.get("nv_zeeman_shift_MHz"), "opm_in_range": sp.get("opm_in_range"),
        "opm_note": sp.get("opm_note"), "ratio_to_earth_surface": sp.get("ratio_to_earth_surface"),
        "radiation_context": sp.get("radiation_context"), "refresh": sp.get("refresh"),
        "coords": sp.get("coords"), "B_vector_nT": sp.get("B_vector_nT"),
        "used_by": {
            "opm": "B_total_nT is B_ambient in the opm_field_nulled requirement (a null or non-VERIFIED field is "
                   "sent to Lean as missing)",
            "nv": "nv_zeeman_shift_MHz: the line shift this background field alone causes; no Lean requirement "
                  "uses it",
            "qd_renin": "radiation_context only: no sourced requirement links the location to the renin sensor",
            "cqd_patch": "radiation_context only: no sourced requirement links the location to the bilirubin patch",
        },
    }
