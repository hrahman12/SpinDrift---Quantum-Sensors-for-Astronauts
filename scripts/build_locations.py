"""Build data/locations.json: 10 places (5 today, 5 tomorrow), each with sub-places.

For every sub-place: the background magnetic field (value object + retrieved_utc), its vector and frame, a radiation
context with its source, and three calculated fields the sensors read (OPM range check |B| <= 5 nT, NV Zeeman shift
28.025 MHz/mT x |B|, ratio to the IGRF field at Johnson Space Center). A number that has no source is null with
NOT_STATED or TO_CONFIRM; nothing is guessed.

Sources read at build time (official APIs and download links; SHA256 recorded for every downloaded file):
- wheretheiss.at (ISS position) and ppigrf (IGRF-14) for the ISS;
- CelesTrak two-line elements propagated with SGP4 for Tiangong (NORAD 48274) and for the ISS track of the next 24 h
  (lowest IGRF |B| = South Atlantic Anomaly pass, highest |latitude|, next equator crossing);
- NOAA SWPC real-time solar wind magnetometer at L1 and the GOES magnetometer (geostationary orbit);
- NASA CDAWeb through cdasws: the most recent ARTEMIS (THEMIS-B/C) lunar-orbit magnetometer file, and the OMNI
  1-minute file of May 2024 (10-11 May 2024 storm);
- the lunar surface field grid of Ravat, Purucker & Olsen (2020) and, as a cross-check, the Tsunakawa et al. (2015)
  model in spherical harmonics; the Mars crustal field model of Langlais et al. (2019);
- NASA/JPL rover position files for Perseverance (Jezero) and Curiosity (Gale).
Published coordinates and statements read from web pages are constants below, each with its page and the date it
was checked (CHECKED), as in scripts/build_specs.py.

Run:  python scripts/build_locations.py        (called from build_all.py)
Raw downloads are cached in SPINDRIFT_CACHE (default ~/.spindrift_cache)/locations.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import math
import os
import sys
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server import live  # noqa: E402
from server import locations as L  # noqa: E402
from server.common import DATA, log_status, meta, missing, now_iso, vo, write_json  # noqa: E402

CACHE = Path(os.environ.get("SPINDRIFT_CACHE", Path.home() / ".spindrift_cache")) / "locations"
UA = {"User-Agent": "SpinDrift-data-pipeline/10 (research prototype)"}
CHECKED = "2026-11-15"   # the day every page-based constant below was read from its source

# ---------------------------------------------------------------- published sources (text constants)
GEORGE24 = ("George et al. (2024), 'Space radiation measurements during the Artemis I lunar mission', Nature 634, "
            "48-52, doi:10.1038/s41586-024-07927-7 (abstract)")
GOLIGHTLY01 = ("Golightly, Weyland, Johnson & Semones (2001), 'Twenty Years of Radiation Measurements in Low-Earth "
               "Orbit', NASA JSC-CN-6928, https://ntrs.nasa.gov/citations/20100029831 (abstract)")
STASS15 = ("Stassinopoulos, Xapsos & Stauffer (2015), 'Forty-Year Drift and Change of the SAA', NASA/TM-2015-217547, "
           "https://ntrs.nasa.gov/citations/20160003393")
NASA_RAD = ("NASA, 'Why Space Radiation Matters', https://www.nasa.gov/missions/analog-field-testing/"
            f"why-space-radiation-matters/ (accessed {CHECKED})")
ZHANG20 = ("Zhang et al. (2020), 'First measurements of the radiation dose on the lunar surface', Science Advances 6, "
           "eaaz1334, doi:10.1126/sciadv.aaz1334 (abstract)")
ZEITLIN13 = ("Zeitlin et al. (2013), 'Measurements of energetic particle radiation in transit to Mars on the Mars "
             "Science Laboratory', Science 340, 1080-1084, doi:10.1126/science.1235989 (abstract)")
JPL_CRUISE = ("NASA/JPL news, 'Data From NASA Rover's Voyage to Mars Aids Planning' (30 May 2013), https://www.jpl."
              f"nasa.gov/news/data-from-nasa-rovers-voyage-to-mars-aids-planning (accessed {CHECKED})")
JPL_SURFACE = ("NASA/JPL news, 'NASA Curiosity: First Mars Age Measurement and Human Exploration Help' (9 Dec 2013), "
               "https://www.jpl.nasa.gov/news/nasa-curiosity-first-mars-age-measurement-and-human-exploration-help "
               f"(accessed {CHECKED}); paper: Hassler et al. (2014), Science 343, 1244797, "
               "doi:10.1126/science.1244797")
COLAPRETE10 = ("Colaprete et al. (2010), 'Detection of Water in the LCROSS Ejecta Plume', Science 330, 463-468, "
               "doi:10.1126/science.1186986 (abstract)")
DANDOURAS23 = ("Dandouras et al. (2023), 'Space plasma physics science opportunities for the lunar orbital platform "
               "- Gateway', Front. Astron. Space Sci. 10:1120302, doi:10.3389/fspas.2023.1120302 (Section 1)")
SWPC_MAGNETOSPHERE = (f"NOAA SWPC, 'Earth's magnetosphere', https://www.swpc.noaa.gov/phenomena/earths-magnetosphere "
                      f"(accessed {CHECKED})")
NRHO_LEE19 = ("Lee (2019), 'White Paper: Gateway Destination Orbit Model: A Continuous 15 Year NRHO Reference "
              "Trajectory', NASA JSC-E-DAA-TN72594, https://ntrs.nasa.gov/citations/20190030294 (full text sha256 "
              "8f1bee585dab1464655411f24bcb9fea035f4910576c04f08e97e7713535daa8)")
NRHO_ESA19 = ("ESA, 'Angelic halo orbit chosen for humankind's first lunar outpost' (18 July 2019), https://www.esa."
              "int/Enabling_Support/Operations/Angelic_halo_orbit_chosen_for_humankind_s_first_lunar_outpost "
              f"(accessed {CHECKED})")
ARTEMIS3_LIST = ("NASA release 24-136, 'NASA Provides Update on Artemis III Moon Landing Regions' (28 Oct 2024), "
                 "https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/ "
                 f"(accessed {CHECKED})")
NSSDC_LCROSS = ("NASA NSSDCA master catalog, LCROSS (2009-031B), https://nssdc.gsfc.nasa.gov/nmc/spacecraft/"
                f"display.action?id=2009-031B (accessed {CHECKED})")
SPA_NASA = ("NASA Science, 'What is the South Pole-Aitken Basin?', https://science.nasa.gov/moon/lunar-craters/"
            f"what-is-the-south-pole-aitken-basin/ (accessed {CHECKED})")
TSUNAKAWA15 = ("Tsunakawa et al. (2015), 'Surface vector mapping of magnetic anomalies over the Moon using Kaguya and "
               "Lunar Prospector observations', J. Geophys. Res. Planets 120, 1160-1185, doi:10.1002/2014JE004785")
RAVAT20 = ("Ravat, Purucker & Olsen (2020), 'Lunar Magnetic Field Models From Lunar Prospector and SELENE/Kaguya "
           "Along-Track Magnetic Field Gradients', J. Geophys. Res. Planets 125, e2019JE006187, "
           "doi:10.1029/2019JE006187; dataset 'New Magnetic Field Models of the Moon', University of Kentucky "
           "Libraries, doi:10.13023/9wpe-tt68 (CC0)")
LANGLAIS19 = ("Langlais et al. (2019), 'A New Model of the Crustal Magnetic Field of Mars Using MGS and MAVEN', "
              "J. Geophys. Res. Planets 124, 1542-1569, doi:10.1029/2018JE005854; coefficients "
              "doi:10.5281/zenodo.3876714 (CC BY 4.0)")
GOLOMBEK20 = ("Golombek et al. (2020), 'Location and Setting of the Mars InSight Lander, Instruments, and Landing "
              "Site', Earth and Space Science 7, e2020EA001248, doi:10.1029/2020EA001248 (abstract)")
OSCAR_NOTE = ("OSCAR-QUBE measured inside the station, where equipment caused interference (data/specs.json "
              "space_heritage.oscar_qube.measurement_location)")


def gazetteer(fid: int) -> str:
    return (f"IAU/USGS Gazetteer of Planetary Nomenclature, feature {fid}, https://planetarynames.wr.usgs.gov/"
            f"Feature/{fid} (accessed {CHECKED})")


# IAU/USGS Gazetteer: feature id -> (name, centre latitude, centre longitude east, diameter km)
MOON_FEATURES = {
    5450: ("Shackleton", -89.67, 129.78, 20.92), 4987: ("Reiner Gamma", 7.39, -58.96, 73.44),
    119: ("Aitken", -16.44, 172.96, 129.69), 8058: ("Cabeus B", -82.26, -54.58, 59.62),
    14502: ("Haworth", -87.45, -5.17, 51.42), 16338: ("Mons Malapert", -85.98, -1.67, 67.0),
    16070: ("Mons Mouton", -84.60, 31.00, 130.0), 4321: ("Nobile", -85.28, 53.27, 79.27),
    1439: ("de Gerlache", -88.48, -88.34, 32.71), 15325: ("Slater", -88.08, 111.29, 25.12),
}
MARS_FEATURES = {14300: ("Jezero", 18.41, 77.69, 47.52), 2071: ("Gale", -5.37, 137.81, 154.08),
                 5930: ("Terra Cimmeria", -32.68, 147.75, 5855.87)}
# NASA's nine Artemis III candidate regions (release 24-136, in its order) and the IAU feature each is named after
ARTEMIS3_REGIONS = [("Peak near Cabeus B", 8058), ("Haworth", 14502), ("Malapert Massif", 16338),
                    ("Mons Mouton Plateau", 16070), ("Mons Mouton", 16070), ("Nobile Rim 1", 4321),
                    ("Nobile Rim 2", 4321), ("de Gerlache Rim 2", 1439), ("Slater Plain", 15325)]

# Earth sites: published coordinates (decimal degrees as converted from the published figures)
SITES = {
    "concordia": dict(
        lat=-(75 + 6 / 60), lon=123 + 21 / 60, alt_km=3.233,
        source=(f"Institut polaire français, 'Concordia station', https://institut-polaire.fr/antarctica/concordia-"
                f"station/ (accessed {CHECKED})"),
        note="published as 75°06'S, 123°21'E, on a plateau at an altitude of 3,233 metres"),
    "haughton": dict(
        lat=75 + 26 / 60, lon=-(89 + 52 / 60), alt_km=None,
        source=f"Mars Institute, 'Haughton-Mars Project (HMP)', https://www.marsinstitute.no/hmp (accessed {CHECKED})",
        note="HMP Research Station, published as 75° 26' N, 89° 52' W, in the area of the 20 km Haughton impact "
             "crater on Devon Island; the page gives no elevation"),
    "aquarius": dict(
        lat=24.9502, lon=-80.4534, alt_km=-0.014,
        source=("Florida International University, 'FIU@Home: Explore Aquarius Reef Base' (1 Feb 2021), https://case."
                "fiu.edu/education-outreach/fiuhome/explore/your-world/2021/explore-aquarius-reef-base.html; depth: "
                "FIU Aquarius Reef Base fact sheet 2019, https://environment.fiu.edu/aquarius/working-with-aquarius/"
                "_assets/arb_factsheet_2019.pdf (sha256 99a5ab985eaf1a92497bedc8378e982c087f8bf16cd7ddf90257966028"
                f"fee5e3) (both accessed {CHECKED})"),
        note="Conch Reef, published as 24.9502° N, 80.4534° W; height -0.014 km is the published hatch and storage "
             "depth of 14 m (46 fsw); the bottom directly below Aquarius is at 18 m (60 fsw)"),
    "jsc": dict(
        lat=29.559177, lon=-95.097897, alt_km=None,
        source=("NASA Open Data Portal, 'NASA Facilities' dataset, https://data.nasa.gov/dataset/nasa-facilities, "
                "file https://data.nasa.gov/docs/legacy/NASA_Facilities/NASA_Facilities_rows.csv (sha256 dc10864a161"
                f"c48d49f71f028ce1ae6b1fcf888ac1f8307c82400444e792cf4cf, accessed {CHECKED})"),
        note="every Johnson Space Center row of the file gives Location 77058 (29.559177, -95.097897), Houston TX; "
             "the file gives no elevation"),
    "baikonur": dict(
        lat=46.0, lon=63.6, alt_km=None,
        source=("NASA/JPL image PIA16292, 'Baikonur Cosmodrome, Kazakhstan' (28 Sept 2012), https://www.jpl.nasa.gov/"
                f"images/pia16292-baikonur-cosmodrome-kazakhstan (accessed {CHECKED})"),
        note="the ASTER image of the cosmodrome is published as located at 46 degrees north latitude, 63.6 degrees "
             "east longitude (coordinates to 0.1 degree); the page gives no elevation"),
}
MDRS_UTM = dict(zone=12, easting=518231.0, northing=4250723.0,
                source=("The Mars Society, Mars Desert Research Station mission archive, Crew 119 EVA report of "
                        "12 Dec 2012, https://sites.google.com/a/marssociety.org/mdrs2012/mission-archive/crew-119-"
                        f"phoenix-one/1212-evareport (accessed {CHECKED})"))

RAD_EARTH = {"text": "Earth's surface: life on Earth is protected from the full impact of solar and cosmic radiation "
                     "by the planet's magnetic field and atmosphere (NASA).",
             "source": NASA_RAD}
RAD_LEO = {"text": "Low Earth orbit: the published radiation data from the International Space Station come from an "
                   "orbit protected by heavy shielding and Earth's magnetic field (George et al. 2024). Trapped-proton "
                   "exposure in low Earth orbit is modelled in the South Atlantic Anomaly region (Golightly et al. "
                   "2001). The live GOES proton flux and NOAA storm level are in /api/live (radiation).",
           "source": f"{GEORGE24}; {GOLIGHTLY01}"}
RAD_DEEP = {"text": "Beyond low Earth orbit, outside the protection of Earth's magnetic field: NASA states that space "
                    "radiation there may place astronauts at significant risk. On the Artemis I lunar mission, "
                    "interplanetary cosmic-ray dose equivalent rates inside the heavily shielded Orion were as much as "
                    "60% lower than earlier observations (George et al. 2024).",
            "source": f"{NASA_RAD}; {GEORGE24}"}
RAD_MOON = {"text": "Lunar surface: chronic galactic cosmic rays, sporadic solar particle events, and neutrons and "
                    "gamma rays from the soil. The Chang'E 4 lander measured an average total absorbed dose rate in "
                    "silicon of 13.2 ± 1 µGy/hour and a neutral-particle dose rate of 3.1 ± 0.5 µGy/hour on the lunar "
                    "surface (Zhang et al. 2020); that is a measurement at the Chang'E 4 site, not at this sub-place.",
            "source": ZHANG20}
RAD_TRANSIT = {"text": "Interplanetary cruise: inside the Mars Science Laboratory spacecraft the RAD instrument "
                       "recorded an average of 1.8 millisieverts of galactic cosmic rays per day on the way to Mars "
                       "(NASA/JPL); the dose equivalent for even the shortest round trip with comparable shielding is "
                       "0.66 ± 0.12 sievert (Zeitlin et al. 2013).",
               "source": f"{JPL_CRUISE}; {ZEITLIN13}"}
RAD_MARS = {"text": "Mars surface: Curiosity's RAD instrument measured an average of 0.67 millisieverts per day at "
                    "Gale crater from August 2012 to June 2013 (NASA/JPL; Hassler et al. 2014). Mars has no active "
                    "global magnetic field today (Langlais et al. 2019). The measurement is from Gale crater.",
            "source": f"{JPL_SURFACE}; {LANGLAIS19}"}
RAD_BELTS = {"text": "The outbound path crosses the trapped-particle (Van Allen) belts. On Artemis I, dose rates inside "
                     "Orion differed fourfold between shielding locations during the proton-belt passes, and a change "
                     "of spacecraft orientation during the proton-belt transit reduced dose rates by around 50% "
                     "(George et al. 2024). Beyond the magnetosphere the exposure is that of interplanetary space.",
             "source": GEORGE24}


# ---------------------------------------------------------------- small helpers
def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class Build:
    def __init__(self):
        self.now = datetime.now(timezone.utc).replace(microsecond=0)
        self.errors: list[str] = []
        self.downloads: list[dict] = []
        self.gen = L.igrf_generation()
        self.l1: dict | None = None

    def fail(self, what: str, e) -> None:
        msg = f"{what}: {type(e).__name__}: {e}" if isinstance(e, Exception) else f"{what}: {e}"
        self.errors.append(msg)
        print("  ! " + msg)


def cached(build: Build, url: str, rel: str, sha256: str | None = None, md5: str | None = None,
           used_for: str = "", timeout: int = 300) -> tuple[Path, dict]:
    """Download once into the cache, verify the checksum, record the file. Raises if it cannot be fetched."""
    dest = CACHE / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        last = None
        for _ in range(2):
            try:
                r = requests.get(url, headers=UA, timeout=timeout)
                r.raise_for_status()
                tmp = dest.with_name(dest.name + ".part")
                tmp.write_bytes(r.content)
                tmp.replace(dest)
                last = None
                break
            except Exception as e:  # network error: one more try, then give up
                last = e
        if last is not None:
            raise last
    raw = dest.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if sha256 and digest != sha256:
        dest.unlink()
        raise ValueError(f"sha256 mismatch for {dest.name}: got {digest}")
    if md5 and hashlib.md5(raw).hexdigest() != md5:
        dest.unlink()
        raise ValueError(f"md5 mismatch for {dest.name}")
    info = {"file": rel, "url": url, "sha256": digest, "bytes": len(raw), "used_for": used_for,
            "retrieved_utc": iso(datetime.fromtimestamp(dest.stat().st_mtime, tz=timezone.utc))}
    if not any(d["file"] == rel for d in build.downloads):
        build.downloads.append(info)
    return dest, info


def sub(place: dict, key: str, name: str, coords, b_total: dict, b_vector: dict, radiation: dict, notes: str,
        refresh: str, live_source: str | None = None, **extra) -> dict:
    """One sub-place in the order of the brief; the three calculated fields are filled by L.derive()."""
    sp = {"id": f"{place['id']}.{key}", "group": place["group"], "place_id": place["id"], "place": place["name"],
          "sub_place": name, "coords": coords, "body": place["body"], "B_total_nT": b_total, "B_vector_nT": b_vector,
          "radiation_context": radiation, "opm_in_range": None, "opm_note": None, "nv_zeeman_shift_MHz": None,
          "ratio_to_earth_surface": None, "notes": notes, "refresh": refresh, "live_source": live_source}
    sp.update(extra)
    return sp


def not_yet(unit: str, source: str, why: str, tag: str = "calculated") -> dict:
    return {**missing(unit, source, tag, "NOT_YET_EXTRACTED", why), "retrieved_utc": None}


def utm_to_latlon(zone: int, easting: float, northing: float) -> tuple[float, float]:
    """Northern-hemisphere UTM -> geodetic latitude, longitude on WGS84 (Snyder 1987, USGS PP 1395, eqs 8-17 ff.)."""
    a, f, k0 = 6378137.0, 1 / 298.257223563, 0.9996
    e2 = f * (2 - f)
    ep2 = e2 / (1 - e2)
    x, m = easting - 500000.0, northing / k0
    mu = m / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256))
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    p1 = (mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32)
          * math.sin(4 * mu) + (151 * e1 ** 3 / 96) * math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * math.sin(8 * mu))
    n1 = a / math.sqrt(1 - e2 * math.sin(p1) ** 2)
    t1, c1 = math.tan(p1) ** 2, ep2 * math.cos(p1) ** 2
    r1 = a * (1 - e2) / (1 - e2 * math.sin(p1) ** 2) ** 1.5
    d = x / (n1 * k0)
    lat = p1 - (n1 * math.tan(p1) / r1) * (d ** 2 / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) * d ** 4 / 24
                                           + (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2 - 3 * c1 ** 2)
                                           * d ** 6 / 720)
    lon = (d - (1 + 2 * t1 + c1) * d ** 3 / 6 + (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2 + 24 * t1 ** 2)
           * d ** 5 / 120) / math.cos(p1)
    return math.degrees(lat), (zone - 1) * 6 - 180 + 3 + math.degrees(lon)


# ---------------------------------------------------------------- IGRF at a fixed Earth site
def earth_site(build: Build, sid: str, lat: float, lon: float, alt_km: float | None, source: str, note: str):
    """coords, B_total (IGRF at the build date) and NED vector for a published Earth location."""
    h = 0.0 if alt_km is None else alt_km
    be, bn, bu = L.igrf_enu(lat, lon, h, build.now)
    total = math.sqrt(be * be + bn * bn + bu * bu)
    as_of = iso(build.now)
    coords = {"lat": round(lat, 6), "lon": round(lon, 6), "alt_km": alt_km, "tag": "published_spec", "source": source,
              "as_of": None, "note": note}
    extra = None
    if alt_km is None:
        up = L.igrf_enu(lat, lon, 1.0, build.now)
        slope = math.sqrt(sum(c * c for c in up)) - total
        extra = (f"the source gives no elevation, so the model is evaluated at height 0 km on the WGS84 ellipsoid; "
                 f"here IGRF |B| changes by {slope:.1f} nT per km of height")
    b = L.derived(round(total, 1), "nT", [],
                  "|B| = sqrt(Be^2 + Bn^2 + Bu^2) from the IGRF model at geodetic lat, lon, height and date",
                  [f"{sid}.coords", f"date {as_of}"], source=f"{build.gen}; coordinates: {source}", as_of=as_of,
                  extra=extra)
    b["retrieved_utc"] = as_of
    return coords, b, L.ned_vector(be, bn, bu, build.gen, as_of)


# ---------------------------------------------------------------- spherical-harmonic synthesis (crustal models)
def schmidt(nmax: int, theta: float):
    """Schmidt semi-normalised P_n^m(cos theta) (no Condon-Shortley phase) and d/dtheta, for 0 <= m <= n <= nmax."""
    import numpy as np
    from scipy.special import sph_legendre_p_all
    y, dy = sph_legendre_p_all(nmax, nmax, theta, diff_n=1)
    n = np.arange(nmax + 1)[:, None]
    m = np.arange(nmax + 1)[None, :]
    fac = np.sqrt(4 * np.pi / (2 * n + 1)) * np.where(m == 0, 1.0, np.sqrt(2.0)) * (-1.0) ** m
    return fac * y[:, :nmax + 1], fac * dy[:, :nmax + 1]


def sh_field(g, h, a_km: float, r_km: float, lat: float, lon: float) -> tuple[float, float, float]:
    """(B_r, B_theta, B_phi) of an internal potential field given Schmidt semi-normalised g, h (IGRF convention).
    Checked against ppigrf.igrf_gc with the IGRF-14 coefficients (agreement to 0.01 nT)."""
    import numpy as np
    nmax = g.shape[0] - 1
    theta, phi = math.radians(90.0 - lat), math.radians(lon)
    s, ds = schmidt(nmax, theta)
    n = np.arange(nmax + 1)[:, None]
    m = np.arange(nmax + 1)[None, :]
    rr = (a_km / r_km) ** (n + 2)
    c, sn = np.cos(m * phi), np.sin(m * phi)
    gc = g * c + h * sn
    br = float(np.sum((n + 1) * rr * gc * s))
    bt = float(-np.sum(rr * gc * ds))
    bp = float(np.sum(rr * m * (g * sn - h * c) * s) / math.sin(theta))
    return br, bt, bp


def body_vector(br: float, bt: float, bp: float, source: str, tag: str, digits: int) -> dict:
    return {"x": round(-bt, digits), "y": round(bp, digits), "z": round(-br, digits), "frame": "body-fixed",
            "axes": "x north (-B_theta), y east (B_phi), z down (-B_r), planetocentric", "unit": "nT", "tag": tag,
            "source": source, "as_of": None}


# ---------------------------------------------------------------- Moon: published crustal field models
RAVAT_URL = "https://uknowledge.uky.edu/context/ees_data/article/1001/type/native/viewcontent"
RAVAT_ZIP = "ravat2020/Ravatetal_JGR2020_LunarL1MagneticModelFields_LPgrad.dat.zip"
RAVAT_SHA = "15f11237b432dafde6fabc99f67215769a39814c8c78d69b29b2607bc12df0f8"
RAVAT_MEMBER = "Ravatetal_JGR2020_LunarL1MagneticModelFields_LPgrad.dat"
T2015_URL = "https://zenodo.org/api/records/3873648/files/T2015_449.sh.gz/content"
T2015_SHA = "4db0b77b3863f38d6fb6e62c5c1116bf7123b77c5aad65df7dae598714edd655"
T2015_MD5 = "a332b1210761855b9bbf85215ff28a41"   # checksum listed by the Zenodo record
T2015_SRC = ("spherical-harmonic expansion (degree 449) of the Tsunakawa et al. (2015) surface map by Wieczorek "
             "(2018), doi:10.5281/zenodo.3873648 (CC BY 4.0)")


def grid_node(lon: float, lat: float) -> tuple[int, int]:
    """Nearest node of the 0.1-degree grid (longitude 0..360 in 3601 columns, latitude -90..90 in 1801 rows)."""
    return int(round((lon % 360.0) / 0.1)) % 3601, int(round((lat + 90.0) / 0.1))


def ravat_rows(build: Build, points: dict[str, tuple[float, float]]) -> dict[str, dict]:
    """Surface field of the Ravat et al. (2020) global grid at the node nearest each (lon, lat). The 88 MB archive is
    downloaded once; rows already read are kept in a small cache file next to it."""
    path, info = cached(build, RAVAT_URL, RAVAT_ZIP, sha256=RAVAT_SHA, timeout=900,
                        used_for="lunar crustal field at the surface (Ravat et al. 2020 global grid)")
    store = path.with_name("grid_rows_" + RAVAT_SHA[:12] + ".json")
    rows = json.loads(store.read_text(encoding="utf-8")) if store.exists() else {}
    nodes = {k: grid_node(lon, lat) for k, (lon, lat) in points.items()}
    need = {i * 1801 + j: f"{i},{j}" for i, j in nodes.values() if f"{i},{j}" not in rows}
    if need:
        last = max(need)
        with zipfile.ZipFile(path) as z, z.open(RAVAT_MEMBER) as fh:
            for n, raw in enumerate(fh):
                if n in need:
                    rows[need[n]] = [float(x) for x in raw.split()]
                if n >= last:
                    break
        store.write_text(json.dumps(rows), encoding="utf-8")
    out = {}
    for k, (i, j) in nodes.items():
        lon_n, lat_n, br, bt, bp, tot = rows[f"{i},{j}"]
        if abs(lon_n - i * 0.1) > 1e-6 or abs(lat_n - (j * 0.1 - 90.0)) > 1e-6:
            raise ValueError(f"grid row for {k} is not the expected node: {lon_n}, {lat_n}")
        out[k] = {"lon": lon_n, "lat": lat_n, "br": br, "bt": bt, "bp": bp, "total": tot, "file": info}
    return out


def t2015_model(build: Build):
    import numpy as np
    path, info = cached(build, T2015_URL, "tsunakawa2015/T2015_449.sh.gz", sha256=T2015_SHA, md5=T2015_MD5,
                        used_for="cross-check of the lunar crustal field (Tsunakawa et al. 2015 in spherical harmonics)")
    lines = gzip.decompress(path.read_bytes()).decode("ascii").splitlines()
    r0, nmax = lines[0].split(",")
    nmax = int(nmax)
    g, h = np.zeros((nmax + 1, nmax + 1)), np.zeros((nmax + 1, nmax + 1))
    for ln in lines[1:]:
        p = ln.split()
        if len(p) == 4:   # coefficients are in tesla
            g[int(p[0]), int(p[1])], h[int(p[0]), int(p[1])] = float(p[2]) * 1e9, float(p[3]) * 1e9
    return g, h, float(r0) / 1000.0, info


def moon_crustal(build: Build, points: dict[str, tuple[float, float, str]]) -> dict[str, dict]:
    """For each key -> (lat, lon, coordinate source): the crustal field value object (Ravat grid), its body-fixed
    vector and a cross-check sentence from the Tsunakawa model. A model that cannot be read is reported, not
    replaced by a number."""
    out = {k: {"vo": None, "vector": None, "cross": None} for k in points}
    try:
        rows = ravat_rows(build, {k: (lon, lat) for k, (lat, lon, _) in points.items()})
        for k, r in rows.items():
            src = (f"{RAVAT20}, file {RAVAT_MEMBER} (sha256 {r['file']['sha256'][:16]}..., "
                   f"{RAVAT_URL}): surface field on a 0.1 degree grid")
            out[k]["vo"] = vo(r["total"], "nT", src, "published_spec", "VERIFIED", None,
                              f"total field of the grid node nearest the published coordinates (node longitude "
                              f"{r['lon']:.1f} E, latitude {r['lat']:.1f}); the grid is on the lunar ellipsoid "
                              "(equatorial radius 1738.1 km, polar radius 1736.0 km); model from Lunar Prospector "
                              "along-track gradients, resolved to wavelengths of roughly 25-30 km only over strong "
                              "anomalies")
            out[k]["vector"] = body_vector(r["br"], r["bt"], r["bp"], src, "published_spec", 3)
    except Exception as e:
        build.fail("Ravat et al. (2020) lunar grid", e)
    try:
        g, h, r0, _ = t2015_model(build)
        for k, (lat, lon, _) in points.items():
            if abs(lat) < 89.999:
                b = sh_field(g, h, r0, r0, lat, lon)
                out[k]["cross"] = (f"Cross-check with a second published model, the {T2015_SRC}, evaluated here at "
                                   f"radius {r0:.1f} km: {math.sqrt(sum(c * c for c in b)):.1f} nT.")
                out[k]["t2015"] = math.sqrt(sum(c * c for c in b))
    except Exception as e:
        build.fail("Tsunakawa et al. (2015) lunar model", e)
    return out


LUNAR_RANGE_NOTE = ("Published range of lunar surface fields: the Tsunakawa et al. (2015) surface map reaches 718 nT "
                    "(Crisium antipodal region); the Apollo surface magnetometers measured 3.4 to 327 nT (Dyal, "
                    "Parkin & Daily 1973).")


def crustal_missing() -> dict:
    return vo(None, "nT", f"{RAVAT20}; {TSUNAKAWA15}", "published_spec", "TO_CONFIRM", None,
              "the model files could not be read at this build. " + LUNAR_RANGE_NOTE)


# ---------------------------------------------------------------- Mars: Langlais et al. (2019)
LANGLAIS_URL = "https://zenodo.org/api/records/3876714/files/Langlais2019.sh.gz/content"
LANGLAIS_SHA = "3cad9e268f0673be1702f1df504a4cbcb8dba4480c7b3f629921911488fe247b"
LANGLAIS_MD5 = "39245feef66555366108aecb6d5c0f67"   # checksum listed by the Zenodo record
MARS_REF_KM = 3393.5
ROVER_URLS = {"jezero": ("Perseverance", "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints_current.json"),
              "gale": ("Curiosity", "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints_current.json")}


def langlais_model(build: Build):
    import numpy as np
    path, info = cached(build, LANGLAIS_URL, "langlais2019/Langlais2019.sh.gz", sha256=LANGLAIS_SHA, md5=LANGLAIS_MD5,
                        used_for="Mars crustal field at the surface (Langlais et al. 2019, degree 134)")
    lines = gzip.decompress(path.read_bytes()).decode("ascii", "replace").splitlines()
    nmax = int(lines[0].split()[1])
    if "3393.5" not in lines[1]:
        raise ValueError("reference radius 3393.5 km not found in the model header")
    g, h = np.zeros((nmax + 1, nmax + 1)), np.zeros((nmax + 1, nmax + 1))
    for ln in lines[4:]:
        p = ln.split()
        if len(p) >= 3:
            g[int(p[0]), int(p[1])] = float(p[2])
            if len(p) >= 4:
                h[int(p[0]), int(p[1])] = float(p[3])
    return g, h, info


def rover_position(build: Build, key: str):
    """Current rover position from the NASA/JPL waypoint file: (lat, lon, elevation km, source, note) or None."""
    name, url = ROVER_URLS[key]
    try:
        r = requests.get(url, headers=UA, timeout=60)
        r.raise_for_status()
        props = r.json()["features"][0]["properties"]
        lat, lon = float(props["lat"]), float(props["lon"])
        elev = props.get("elev_geoid")
        digest = hashlib.sha256(r.content).hexdigest()
        build.downloads.append({"file": url.rsplit("/", 1)[1], "url": url, "sha256": digest, "bytes": len(r.content),
                                "used_for": f"{name} rover position", "retrieved_utc": now_iso()})
        src = f"NASA/JPL {name} rover waypoint file (current position), {url} (sha256 {digest[:16]}...)"
        note = (f"{name} rover position at sol {props.get('sol')} (planetocentric latitude, east longitude; height = "
                "elevation relative to the Mars areoid, elev_geoid)")
        return lat, lon, (round(float(elev) / 1000.0, 4) if isinstance(elev, (int, float)) else None), src, note
    except Exception as e:
        build.fail(f"{name} rover position file", e)
        return None


# ---------------------------------------------------------------- interplanetary and lunar-orbit field
def artemis_latest(build: Build):
    """Last good spin-resolution sample of the most recent ARTEMIS (THEMIS-B or THEMIS-C) L2 FGM file on CDAWeb.
    Returns (total value object, GSE vector, sentence about the file) or None."""
    try:
        import cdflib
        import numpy as np
        from cdasws import CdasWs
        cdas = CdasWs()
        start, end = iso(build.now - timedelta(days=60)), iso(build.now)
        best = None
        for ds in ("THB_L2_FGM", "THC_L2_FGM"):
            _, files = cdas.get_original_files(ds, start, end)
            for f in files or []:
                if best is None or f["StartTime"] > best[1]["StartTime"]:
                    best = (ds, f)
        if best is None:
            raise ValueError("no ARTEMIS L2 FGM file listed for the last 60 days")
        ds, f = best
        probe = ds[:3].lower()
        name = f["Name"].rsplit("/", 1)[1]
        path, info = cached(build, f["Name"], f"artemis/{name}",
                            used_for="ambient field in lunar orbit (ARTEMIS fluxgate magnetometer, most recent file)")
        cdf = cdflib.CDF(str(path))
        bt = np.asarray(cdf.varget(f"{probe}_fgs_btotal"), dtype=float)
        gse = np.asarray(cdf.varget(f"{probe}_fgs_gse"), dtype=float)
        t = np.asarray(cdf.varget(f"{probe}_fgs_time"), dtype=float)
        q = np.asarray(cdf.varget(f"{probe}_fgm_fgs_quality"))
        ok = np.isfinite(bt) & (bt >= 0) & (bt < 25000) & (q == 0) & np.isfinite(t) & (t > 0)
        if not ok.any():
            raise ValueError(f"{name} has no good-quality spin-resolution sample")
        i = int(np.where(ok)[0][-1])
        when = datetime.fromtimestamp(float(t[i]), tz=timezone.utc)
        label = {"thb": "THEMIS-B (ARTEMIS P1)", "thc": "THEMIS-C (ARTEMIS P2)"}[probe]
        src = (f"NASA CDAWeb dataset {ds} ({label} fluxgate magnetometer, spin-resolution FGS), file {name} "
               f"(sha256 {info['sha256'][:16]}..., {f['Name']}), listed through cdasws")
        stats = (f"the file holds {int(ok.sum())} good samples from {iso(datetime.fromtimestamp(float(t[ok][0]), tz=timezone.utc))} to "
                 f"{iso(datetime.fromtimestamp(float(t[ok][-1]), tz=timezone.utc))} with |B| between {bt[ok].min():.2f} and "
                 f"{bt[ok].max():.2f} nT (median {float(np.median(bt[ok])):.2f} nT)")
        where = None
        try:
            _, pos = cdas.get_data(f"{probe.upper()}_OR_SSC", ["XYZ_GSE", "RADIUS"], iso(when - timedelta(minutes=2)),
                                   iso(when + timedelta(minutes=2)))
            k = int(np.argmin(np.abs(pos["Epoch"].values - np.datetime64(when.replace(tzinfo=None)))))
            x, y, z = (float(v) for v in pos["XYZ_GSE"].values[k])
            side = ("sunward of Earth (GSE x positive), so not in the magnetotail" if x > 0 else
                    "on the night side of Earth (GSE x negative), where the magnetotail lies")
            where = (f"at that time the probe was {float(pos['RADIUS'].values[k]):.1f} Earth radii from Earth at GSE "
                     f"({x:.1f}, {y:.1f}, {z:.1f}) Earth radii (CDAWeb dataset {probe.upper()}_OR_SSC), {side}")
        except Exception as e:
            build.fail("ARTEMIS probe position (CDAWeb SSC orbit data)", e)
        total = vo(round(float(bt[i]), 3), "nT", src, "recorded", "VERIFIED", iso(when),
                   "last good-quality spin-resolution sample of the most recent file; " + stats
                   + (f"; {where}" if where else ""))
        total["retrieved_utc"] = info["retrieved_utc"]
        vec = {"x": round(float(gse[i][0]), 3), "y": round(float(gse[i][1]), 3), "z": round(float(gse[i][2]), 3),
               "frame": "GSE", "axes": "geocentric solar ecliptic: x toward the Sun, z toward ecliptic north",
               "unit": "nT", "tag": "recorded", "source": src, "as_of": iso(when)}
        return total, vec, label
    except Exception as e:
        build.fail("ARTEMIS lunar-orbit magnetometer (CDAWeb)", e)
        return None


OMNI_URL = "https://cdaweb.gsfc.nasa.gov/sp_phys/data/omni/hro2_1min/2024/omni_hro2_1min_20240501_v01.cdf"
OMNI_SHA = "838f9d951ddd70d60c28ce3ac498b39c943a0f4ab9919a32bb7790bb72e127c3"
STORM_START, STORM_END = "2024-05-10T00:00:00", "2024-05-12T00:00:00"


def omni_storm(build: Build):
    """Peak 1-minute interplanetary field of the 10-11 May 2024 storm from the OMNI archive (CDAWeb)."""
    import cdflib
    import numpy as np
    url = OMNI_URL
    try:
        from cdasws import CdasWs
        _, files = CdasWs().get_original_files("OMNI_HRO2_1MIN", "2024-05-10T00:00:00Z", "2024-05-11T23:59:00Z")
        url = next(f["Name"] for f in files if "20240501" in f["Name"])
    except Exception as e:
        build.fail("CDAWeb file listing for OMNI_HRO2_1MIN (using the known file URL)", e)
    path, info = cached(build, url, "omni/" + url.rsplit("/", 1)[1], sha256=OMNI_SHA,
                        used_for="10-11 May 2024 storm: peak interplanetary field (OMNI 1-minute data)")
    cdf = cdflib.CDF(str(path))
    t = np.asarray(cdflib.cdfepoch.to_datetime(cdf.varget("Epoch"))).astype("datetime64[s]")
    f = np.asarray(cdf.varget("F"), dtype=float)
    sel = (t >= np.datetime64(STORM_START)) & (t < np.datetime64(STORM_END)) & (f < 9000)
    if not sel.any():
        raise ValueError("no valid OMNI field sample in the storm interval")
    i = int(np.argmax(np.where(sel, f, -1.0)))
    when = str(t[i]) + "Z"
    comps = [float(np.asarray(cdf.varget(k), dtype=float)[i]) for k in ("BX_GSE", "BY_GSE", "BZ_GSE")]
    src = (f"NASA CDAWeb dataset OMNI_HRO2_1MIN (OMNI 1-minute interplanetary field, time-shifted to Earth's bow shock "
           f"nose), file {path.name} (sha256 {info['sha256'][:16]}..., {url}), variable F")
    n_all = int(((t >= np.datetime64(STORM_START)) & (t < np.datetime64(STORM_END))).sum())
    note = (f"largest 1-minute field magnitude between {STORM_START}Z and {STORM_END}Z ({int(sel.sum())} valid minutes "
            f"of {n_all})")
    try:
        sym = np.asarray(cdf.varget("SYM_H"), dtype=float)
        ok = (t >= np.datetime64(STORM_START)) & (t < np.datetime64(STORM_END)) & (np.abs(sym) < 90000)
        if ok.any():
            k = int(np.argmin(np.where(ok, sym, 1e9)))
            note += f"; the geomagnetic SYM-H index in the same file fell to {sym[k]:.0f} nT at {t[k]}Z"
    except Exception:
        pass
    total = vo(round(float(f[i]), 2), "nT", src, "recorded", "VERIFIED", when, note)
    total["retrieved_utc"] = info["retrieved_utc"]
    vec = (L.no_vector("GSE", "GSE components missing at the peak minute", "recorded") if any(abs(c) > 9000 for c in comps)
           else {"x": round(comps[0], 2), "y": round(comps[1], 2), "z": round(comps[2], 2), "frame": "GSE",
                 "axes": "geocentric solar ecliptic: x toward the Sun, z toward ecliptic north", "unit": "nT",
                 "tag": "recorded", "source": src, "as_of": when})
    return total, vec


# ---------------------------------------------------------------- ISS track of the next 24 hours
def iss_passes(build: Build, tle: dict) -> dict:
    """Times (UTC) on the SGP4 track of the next 24 h where IGRF |B| is lowest, |latitude| is highest, and the
    track next crosses the equator. Coarse search every 10 s, then every second around each point."""
    import numpy as np
    import ppigrf
    sat = L.satrec(tle)
    start = build.now
    times = [start + timedelta(seconds=10 * i) for i in range(8641)]
    pos = np.array([L.propagate(sat, t) for t in times])
    be, bn, bu = ppigrf.igrf(pos[:, 1], pos[:, 0], pos[:, 2], start.replace(tzinfo=None))
    b = np.sqrt(np.asarray(be) ** 2 + np.asarray(bn) ** 2 + np.asarray(bu) ** 2).ravel()

    def fine(center: datetime, score):
        cands = [center + timedelta(seconds=s) for s in range(-10, 11)]
        cands = [t for t in cands if start <= t <= times[-1]]
        return min(cands, key=score)

    def field_at(t: datetime) -> float:
        lat, lon, alt = L.propagate(sat, t)
        return math.sqrt(sum(c * c for c in L.igrf_enu(lat, lon, alt, t)))

    out = {"window": (iso(start), iso(times[-1]))}
    out["saa"] = fine(times[int(np.argmin(b))], field_at)
    out["high_latitude"] = fine(times[int(np.argmax(np.abs(pos[:, 0])))], lambda t: -abs(L.propagate(sat, t)[0]))
    sign = np.sign(pos[:, 0])
    cross = np.where(sign[:-1] * sign[1:] < 0)[0]
    if len(cross):
        c = [times[int(cross[0])] + timedelta(seconds=s) for s in range(0, 11)]
        out["equatorial"] = min(c, key=lambda t: abs(L.propagate(sat, t)[0]))
    return out


# ---------------------------------------------------------------- the ten places
def place(pid: str, group: str, name: str, body: str) -> dict:
    return {"id": pid, "group": group, "name": name, "body": body, "sub_places": []}


def build_iss(build: Build) -> dict:
    p = place("iss", "today", "International Space Station", "Earth")
    pos, err = live.fetch_iss()
    st = None
    if err:
        build.fail("ISS position (wheretheiss.at)", err)
    else:
        try:
            b, _ = live.igrf_total(pos)
            st = {**pos, "b_total_nT": b}
        except Exception as e:
            build.fail("IGRF at the ISS position", e)
    for key, name in (("destiny", "Destiny"), ("columbus", "Columbus"), ("kibo", "Kibo"), ("zvezda", "Zvezda"),
                      ("cupola", "Cupola")):
        sp = sub(p, key, name, None,
                 not_yet("nT", "IGRF at the live ISS position", "ISS position or IGRF unavailable at this build"),
                 L.no_vector("NED", "ISS position unavailable at this build"), RAD_LEO,
                 f"All ISS modules share one station position, so {name} carries the same value as the others: the "
                 "IGRF-14 core field at the station's live position (wheretheiss.at), which is the field outside the "
                 "hull. The field inside the module (hull, equipment, currents) is not stated in any open source: see "
                 f"B_inside_module_nT (NOT_STATED). {OSCAR_NOTE}.",
                 "live_5s", "iss",
                 B_inside_module_nT=missing("nT", f"no open measurement of the magnetic field inside {name}",
                                            "recorded", "NOT_STATED",
                                            "module-level fields inside the hull are not published"))
        L.apply_station(sp, st)
        p["sub_places"].append(sp)
    return p


def build_tiangong(build: Build, tle: dict | None) -> dict:
    p = place("tiangong", "today", "Tiangong space station", "Earth")
    st = None
    if tle is not None:
        try:
            st = L.station_from_tle(tle, build.now, "tiangong")
        except Exception as e:
            build.fail("Tiangong SGP4/IGRF", e)
    incl = f" The element set gives an orbital inclination of {float(tle['line2'][8:16]):.2f} degrees." if tle else ""
    for key, name in (("tianhe", "Tianhe"), ("wentian", "Wentian"), ("mengtian", "Mengtian")):
        sp = sub(p, key, name, None,
                 not_yet("nT", "IGRF at the Tiangong position from SGP4", "CelesTrak TLE unavailable at this build"),
                 L.no_vector("NED", "Tiangong position unavailable at this build"), RAD_LEO,
                 f"All Tiangong modules share one station position, so {name} carries the same value as the others: "
                 "the IGRF-14 core field at the position given by SGP4 propagation of the CelesTrak element set for "
                 f"NORAD 48274 (CSS Tianhe), which is the field outside the hull.{incl} The field inside the module is "
                 "not stated in any open source: see B_inside_module_nT (NOT_STATED). The running server propagates "
                 "the same element set again every 60 s.",
                 "on_build", "tiangong",
                 B_inside_module_nT=missing("nT", f"no open measurement of the magnetic field inside {name}",
                                            "recorded", "NOT_STATED",
                                            "module-level fields inside the hull are not published"))
        L.apply_station(sp, st)
        p["sub_places"].append(sp)
    return p


def build_hotspots(build: Build, tle: dict | None) -> dict:
    p = place("iss_hotspots", "today", "ISS orbit hotspots", "Earth")
    passes = {}
    if tle is not None:
        try:
            passes = iss_passes(build, tle)
        except Exception as e:
            build.fail("ISS track of the next 24 h", e)
    window = passes.get("window", (None, None))
    incl = f"{float(tle['line2'][8:16]):.2f}" if tle else None
    specs = [
        ("saa", "South Atlantic Anomaly pass", "lowest IGRF |B| on the track",
         {"text": "South Atlantic Anomaly: a local depression of Earth's magnetic field (Stassinopoulos, Xapsos & "
                  "Stauffer 2015). The NASA memorandum studies it in relation to the trapped Van Allen belt proton "
                  "population and maps the integral proton flux contours and the peak proton flux position inside "
                  "it; trapped-proton exposure in low Earth orbit is modelled in this region (Golightly et al. 2001).",
          "source": f"{STASS15}; {GOLIGHTLY01}"},
         "This is the real upcoming point of the ISS track where the IGRF field is weakest: the track's pass through "
         "the South Atlantic Anomaly, the region of enhanced trapped-proton flux in low Earth orbit."),
        ("high_latitude", "High-latitude (polar/auroral) pass", "highest |latitude| on the track",
         {"text": "Highest-latitude part of the orbit. Outside the South Atlantic Anomaly, exposure in low Earth orbit "
                  "comes from galactic cosmic rays, which Earth's magnetic field partly screens (geomagnetic "
                  "cutoff); NASA crew-exposure projections use galactic-cosmic-ray flux and dynamic geomagnetic "
                  "cutoff models (Golightly et al. 2001).",
          "source": f"{GOLIGHTLY01}; {GEORGE24}"},
         "This is the real upcoming point of the ISS track with the highest latitude"
         + (f"; the element set gives an inclination of {incl} degrees, which bounds the latitude the station "
            "reaches, so it does not pass over the geographic poles" if incl else "") + "."),
        ("equatorial", "Equatorial pass", "next equator crossing of the track",
         RAD_LEO,
         "This is the real upcoming equator crossing of the ISS track (the second at which |latitude| is smallest)."),
    ]
    for key, name, criterion, rad, text in specs:
        sp = sub(p, key, name, None,
                 not_yet("nT", "IGRF on the ISS track", "CelesTrak TLE or track unavailable at this build"),
                 L.no_vector("NED", "ISS track unavailable at this build"), rad,
                 text + " Position: SGP4 propagation of the CelesTrak element set for NORAD 25544; field: IGRF-14 at "
                 f"that position and time. Search window: {window[0]} to {window[1]} (24 h from the build); the pass "
                 "time is in the future when built and is not refreshed by the server, so rebuild to get the next one.",
                 "on_build")
        when = passes.get(key)
        if when is not None:
            try:
                L.apply_station(sp, L.station_from_tle(tle, when, f"iss_hotspots.{key}"))
                sp["pass"] = {"time_utc": iso(when), "criterion": criterion, "window_start_utc": window[0],
                              "window_end_utc": window[1], "tle_epoch_utc": tle["epoch_utc"],
                              "source": tle["source"]}
            except Exception as e:
                build.fail(f"iss_hotspots.{key}", e)
        p["sub_places"].append(sp)
    return p


def build_analog(build: Build) -> dict:
    p = place("earth_analog", "today", "Earth analog sites", "Earth")
    lat, lon = utm_to_latlon(MDRS_UTM["zone"], MDRS_UTM["easting"], MDRS_UTM["northing"])
    mdrs = dict(lat=lat, lon=lon, alt_km=None, source=MDRS_UTM["source"],
                note=("habitat waypoint published as UTM 12S 0518231 4250723 (zone 12, latitude band S), converted "
                      "here to latitude and longitude on WGS84; the report states no datum (WGS84 against NAD27 "
                      "moves the point by about 0.2 km) and no elevation"))
    rows = [("concordia", "Concordia station (Antarctica)", SITES["concordia"],
             "French-Italian station on the Antarctic plateau (Dome C)."),
            ("haughton", "Haughton Crater (Devon Island)", SITES["haughton"],
             "Haughton-Mars Project Research Station at the Haughton impact crater, Devon Island, High Arctic."),
            ("mdrs", "Mars Desert Research Station (Utah)", mdrs,
             "Mars Society analog station near Hanksville, Utah."),
            ("aquarius", "NEEMO Aquarius (Florida Keys)", SITES["aquarius"],
             "Aquarius Reef Base undersea habitat on Conch Reef, used by NASA's NEEMO missions.")]
    for key, name, s, what in rows:
        coords, b, vec = earth_site(build, f"earth_analog.{key}", s["lat"], s["lon"], s["alt_km"], s["source"], s["note"])
        p["sub_places"].append(sub(p, key, name, coords, b, vec, RAD_EARTH,
                                   f"{what} Field: IGRF-14 core field at the published coordinates on the build date; "
                                   "local crustal and man-made fields are not included.", "on_build"))
    return p


def build_flight(build: Build) -> tuple[dict, dict]:
    p = place("earth_flight", "today", "Pre/post-flight on Earth", "Earth")
    reference = None
    for key, name, what in (("jsc", "Johnson Space Center (Houston)",
                             "NASA's crew training and mission control centre; its IGRF field is the reference for "
                             "ratio_to_earth_surface in every sub-place."),
                            ("baikonur", "Baikonur Cosmodrome (Kazakhstan)", "Launch site of crewed Soyuz flights.")):
        s = SITES[key]
        coords, b, vec = earth_site(build, f"earth_flight.{key}", s["lat"], s["lon"], s["alt_km"], s["source"], s["note"])
        if key == "jsc":
            reference = L.bare(b)
        p["sub_places"].append(sub(p, key, name, coords, b, vec, RAD_EARTH,
                                   f"{what} Field: IGRF-14 core field at the published coordinates on the build date; "
                                   "local crustal and man-made fields are not included.", "on_build"))
    why = ("no published coordinates: SpaceX and NASA reported the Inspiration4 splashdown (18 Sept 2021) only as in "
           "the Atlantic Ocean off the coast of Florida, so IGRF is not evaluated")
    b = vo(None, "nT", "IGRF-14 at the splashdown point (coordinates not published)", "calculated", "TO_CONFIRM",
           None, why)
    b["retrieved_utc"] = None
    p["sub_places"].append(sub(
        p, "i4_splashdown", "Inspiration4 splashdown (Atlantic Ocean)", None, b,
        L.no_vector("NED", "splashdown coordinates not published"),
        {"text": "Sea level on Earth after a three-day orbital flight. The Inspiration4 crew's blood was drawn on the "
                 "ground before and after the flight; the released total bilirubin values are in data/nasa_i4.json "
                 "(NASA OSDR OSD-575).",
         "source": "NASA OSDR OSD-575 (data/nasa_i4.json); " + NASA_RAD},
        "Field TO_CONFIRM: " + why + ". With published coordinates the value would be the IGRF surface field, as for "
        "the other Earth sub-places. This sub-place links the recorded Inspiration4 lab data to a location.",
        "static", linked_data={"file": "data/nasa_i4.json", "accession": "OSD-575",
                               "what": "Inspiration4 total bilirubin before and after flight (recorded)"}))
    return p, reference


def ambient_field(build: Build, l1: dict | None):
    """The interplanetary / lunar-orbit ambient field used for the Gateway and the Moon: the most recent ARTEMIS
    file when CDAWeb is reachable (recorded), otherwise the NOAA L1 feed (near_live)."""
    art = artemis_latest(build)
    if art is not None:
        total, vec, label = art
        return total, vec, None, label
    total = L.l1_total(l1)
    if total is not None:
        return total, L.l1_vector(l1), "noaa_l1", "NOAA L1"
    return (not_yet("nT", "ARTEMIS (CDAWeb) and NOAA L1", "neither source was reachable at this build", "near_live"),
            L.no_vector("GSE", "no ambient field sample at this build", "near_live"), "noaa_l1", None)


def l1_context(l1: dict | None) -> dict:
    v = L.l1_total(l1) or not_yet("nT", "NOAA SWPC L1 magnetometer", "L1 feed unavailable at this build", "near_live")
    return {**v, "feed": "noaa_l1"}


TAIL_NOTE = ("During most of its orbit the Moon is directly exposed to the solar wind, but for 5-6 days every orbit it "
             "crosses the tail of Earth's magnetosphere (Dandouras et al. 2023); NOAA describes the tail as stretching "
             "well beyond the Moon's orbit at 60 Earth radii. Inside the tail an L1 solar-wind value does not apply.")


def build_gateway(build: Build, amb) -> dict:
    p = place("gateway", "tomorrow", "Lunar Gateway", "Moon")
    total, vec, feed, label = amb
    how = (f"the last good sample of the most recent {label} lunar-orbit magnetometer file on NASA CDAWeb (recorded)"
           if feed is None else "the newest NOAA SWPC L1 magnetometer sample (near_live), because the ARTEMIS file on "
           "CDAWeb could not be read at this build")
    base = ("There is no direct magnetometer measurement at the Gateway; the field there is the solar wind or, part "
            f"of each month, Earth's magnetotail. B_total_nT is {how}. {TAIL_NOTE} context.interplanetary_L1_nT is "
            "the upstream solar-wind field at L1, refreshed every 60 s by the server.")
    peri = vo(3366, "km", NRHO_LEE19, "published_spec", "VERIFIED", None,
              "perilune radius from the Moon's centre in the 15-year reference trajectory: average 3366 km, varying "
              "from 3196 to 3557 km; average orbit period 6.562 days (9:2 lunar synodic resonance)")
    apo = vo(70000, "km", NRHO_ESA19, "published_spec", "VERIFIED", None,
             "ESA: at its furthest the Gateway is 70 000 km from the lunar surface (and 3000 km at its closest); the "
             "NASA white paper (Lee 2019) gives the perilune radius but no apolune figure")
    rows = [("halo", "HALO (Habitation and Logistics Outpost)",
             "HALO and PPE are modules of one station and share its position; the field inside the module is not "
             "stated in any source.", None),
            ("ppe", "PPE (Power and Propulsion Element)",
             "HALO and PPE are modules of one station and share its position; the field at the module is not "
             "stated in any source.", None),
            ("nrho_perilune", "NRHO perilune", "Closest point of the near-rectilinear halo orbit to the Moon "
             "(context.distance_from_moon). The Moon has no global field, so the ambient field is the same "
             "interplanetary or magnetotail field.", peri),
            ("nrho_apolune", "NRHO apolune", "Farthest point of the near-rectilinear halo orbit from the Moon "
             "(context.distance_from_moon).", apo)]
    for key, name, text, dist in rows:
        ctx = {"interplanetary_L1_nT": l1_context(build.l1)}
        if dist is not None:
            ctx["distance_from_moon"] = dist
        p["sub_places"].append(sub(p, key, name, None, dict(total), dict(vec), RAD_DEEP, f"{text} {base}",
                                   "on_build", feed, context=ctx))
    return p


def lunar_sub(build: Build, p: dict, key: str, name: str, coords, crustal: dict, vector, amb, text: str,
              cross: str | None, context: dict | None = None, **extra) -> dict:
    total, _, feed, label = amb
    ambient = {**total, "feed": feed} if feed else dict(total)
    sid = f"{p['id']}.{key}"
    b = L.upper_bound(sid, crustal, ambient, now_iso())
    amb_text = (f"the most recent {label} lunar-orbit magnetometer sample (recorded)" if feed is None else
                "the newest NOAA L1 sample (near_live)")
    notes = (f"{text} The Moon has no global magnetic field; B_total_nT is an upper bound: the crustal field of a "
             f"published model (components.crustal_nT) plus the ambient field (components.ambient_nT, {amb_text}), "
             "because the two vectors are in different frames. B_vector_nT is the crustal part only. "
             + (cross + " " if cross else "") + LUNAR_RANGE_NOTE + " " + TAIL_NOTE)
    ctx = {"interplanetary_L1_nT": l1_context(build.l1)}
    ctx.update(context or {})
    return sub(p, key, name, coords, b, vector or L.no_vector("body-fixed", "crustal model unavailable at this build",
                                                              "published_spec"),
               RAD_MOON, notes, "on_build", None, components={"crustal_nT": crustal, "ambient_nT": ambient},
               context=ctx, **extra)


def feature_coords(fid: int, table: dict, note: str) -> dict:
    name, lat, lon, _ = table[fid]
    return {"lat": lat, "lon": lon, "alt_km": None, "tag": "published_spec", "source": gazetteer(fid),
            "as_of": None, "note": f"{name}: {note}"}


def build_moon(build: Build, amb) -> tuple[dict, dict]:
    south = place("moon_south_pole", "tomorrow", "Moon south pole", "Moon")
    anomalies = place("lunar_anomalies", "tomorrow", "Lunar crustal anomalies", "Moon")
    lcross = (-84.678, 311.275)
    points = {"shackleton": (MOON_FEATURES[5450][1], MOON_FEATURES[5450][2], gazetteer(5450)),
              "lcross": (lcross[0], lcross[1], NSSDC_LCROSS),
              "reiner_gamma": (MOON_FEATURES[4987][1], MOON_FEATURES[4987][2], gazetteer(4987)),
              "aitken": (MOON_FEATURES[119][1], MOON_FEATURES[119][2], gazetteer(119))}
    for _, fid in ARTEMIS3_REGIONS:
        points[f"f{fid}"] = (MOON_FEATURES[fid][1], MOON_FEATURES[fid][2], gazetteer(fid))
    model = moon_crustal(build, points)

    def cr(k):
        return model[k]["vo"] or crustal_missing()

    apollo = vo(38, "nT", live.DYAL73, "recorded", "VERIFIED", None,
                "Apollo 12 ALSEP lunar surface magnetometer, 38 ± 2 nT (deployed Nov 1969); the three stationary "
                "ALSEP sites gave Apollo 15: 3.4 ± 2.9, Apollo 12: 38 ± 2, Apollo 16: 234 ± 3 nT, and the measured "
                "sites range 3.4-327 nT (Apollo 16 Site 13). Measured far from the south pole; kept as the only "
                "direct surface measurements (this was the value of the older location id lunar_base).")
    south["sub_places"].append(lunar_sub(
        build, south, "shackleton_rim", "Shackleton rim",
        feature_coords(5450, MOON_FEATURES, "centre of the crater (diameter 20.92 km); the rim is about half a "
                       "diameter from this point, well inside one cell of the field model's resolution"),
        cr("shackleton"), model["shackleton"]["vector"], amb,
        "Rim of Shackleton crater at the lunar south pole (coordinates: IAU crater centre).",
        model["shackleton"]["cross"], context={"apollo_surface_measurement_nT": apollo}))
    south["sub_places"].append(lunar_sub(
        build, south, "psr_crater", "Permanently shadowed crater (Cabeus, LCROSS impact site)",
        {"lat": lcross[0], "lon": lcross[1], "alt_km": None, "tag": "published_spec", "source": NSSDC_LCROSS,
         "as_of": None, "note": "LCROSS Centaur impact point of 9 October 2009, published as 84.678 S, 311.275 E, in "
                                "the persistently shadowed region within Cabeus crater (Colaprete et al. 2010)"},
        cr("lcross"), model["lcross"]["vector"], amb,
        "Persistently shadowed region inside Cabeus crater, where the LCROSS impact found water ice in the regolith "
        f"({COLAPRETE10}).", model["lcross"]["cross"]))
    # Artemis III: NASA published nine region names and a map, no coordinates
    regions, values = [], []
    for name, fid in ARTEMIS3_REGIONS:
        m = model[f"f{fid}"]
        regions.append({"name": name, "proxy_feature": f"{MOON_FEATURES[fid][0]} (IAU feature {fid})",
                        "coords": feature_coords(fid, MOON_FEATURES, "centre of the IAU feature this region is named "
                                                 "after (NASA published no coordinates for the region)"),
                        "crustal_nT": m["vo"] or crustal_missing(), "cross_check": m["cross"]})
        if m["vo"] is not None:
            values.append(m["vo"]["value"])
    if values:
        crust = vo(max(values), "nT", f"{RAVAT20}; region list: {ARTEMIS3_LIST}", "published_spec", "TO_CONFIRM", None,
                   f"largest of the model values at the centres of the IAU features the nine regions are named after "
                   f"(values from {min(values):.3f} to {max(values):.3f} nT, listed in regions[]). NASA published the "
                   "region names and a map but no coordinates, so each centre is a stand-in that may lie tens of km "
                   "from its region: to confirm when region coordinates are published.")
    else:
        crust = crustal_missing()
    south["sub_places"].append(lunar_sub(
        build, south, "artemis3_regions", "Artemis III candidate regions", None, crust, None, amb,
        "NASA's nine candidate landing regions for Artemis III (release 24-136, 28 Oct 2024): "
        + ", ".join(n for n, _ in ARTEMIS3_REGIONS) + ". Field TO_CONFIRM: NASA published no coordinates for the "
        "regions, so the crustal value is the largest model value at the centres of the features they are named "
        "after.", None, regions=regions))
    anomalies["sub_places"].append(lunar_sub(
        build, anomalies, "reiner_gamma", "Reiner Gamma",
        feature_coords(4987, MOON_FEATURES, "centre of the Reiner Gamma albedo feature (diameter 73.44 km)"),
        cr("reiner_gamma"), model["reiner_gamma"]["vector"], amb,
        "Reiner Gamma swirl in Oceanus Procellarum, a strong crustal magnetic anomaly; Tsunakawa et al. (2015) find "
        "the near-surface field structure there correlated with the high-albedo markings. The value is the model "
        "field at the feature's centre, not the peak of the anomaly.", model["reiner_gamma"]["cross"]))
    anomalies["sub_places"].append(lunar_sub(
        build, anomalies, "spa_basin", "South Pole-Aitken basin anomaly (Aitken crater)",
        feature_coords(119, MOON_FEATURES, "centre of Aitken crater (diameter 129.69 km)"),
        cr("aitken"), model["aitken"]["vector"], amb,
        "Aitken crater, the northern end of the South Pole-Aitken basin (the basin spans the territory from Aitken "
        f"crater to the south pole: {SPA_NASA}). Tsunakawa et al. (2015) list a well-isolated central magnetic "
        "anomaly at Aitken crater. The value is the model field at the crater's centre.", model["aitken"]["cross"]))
    return south, anomalies


def build_transit(build: Build, goes: dict | None) -> dict:
    p = place("mars_transit", "tomorrow", "Mars transit", "interplanetary")
    standoff = vo(10, "Earth radii", SWPC_MAGNETOSPHERE, "published_spec", "VERIFIED", None,
                  "NOAA: on the dayside the magnetic field is confined to within about 10 Earth radii; on the night "
                  "side it is stretched out to hundreds of Earth radii. The distance moves with solar-wind pressure.")
    total = L.goes_total(goes) or not_yet("nT", "NOAA SWPC GOES magnetometer", "GOES magnetometer feed unavailable "
                                          "at this build", "near_live")
    p["sub_places"].append(sub(
        p, "leaving_magnetosphere", "Leaving Earth's magnetosphere", None, total, L.goes_vector(goes), RAD_BELTS,
        "On the way out, the IGRF model (Earth's internal field only) stops being valid past a few Earth radii: the "
        "field is shaped by the solar wind and ends at the magnetopause, about 10 Earth radii sunward of Earth "
        "(context.magnetopause_standoff). B_total_nT is not IGRF: it is the field measured now by the GOES "
        "magnetometer in geostationary orbit, about 6.6 Earth radii from Earth's centre, inside the magnetosphere. "
        "No live magnetometer sits at the magnetopause itself, and no source gives a single field value there. "
        "Beyond it the field is the interplanetary field (context.interplanetary_L1_nT, and sub-place "
        "mars_transit.cruise). NOAA notes that strong solar wind can push the magnetopause inside geostationary "
        "orbit.", "on_build", "goes_mag",
        context={"magnetopause_standoff": standoff, "interplanetary_L1_nT": l1_context(build.l1)}))
    cruise = L.l1_total(build.l1) or not_yet("nT", "NOAA SWPC L1 magnetometer", "L1 feed unavailable at this build",
                                             "near_live")
    p["sub_places"].append(sub(
        p, "cruise", "Interplanetary cruise", None, cruise, L.l1_vector(build.l1), RAD_TRANSIT,
        "Interplanetary magnetic field measured by the NOAA real-time solar wind magnetometer at L1, refreshed every "
        "60 s by the server. It stands for the field a vehicle meets in the solar wind near 1 AU; no open live "
        "magnetometer feed exists from an Earth-Mars transfer orbit.", "on_build", "noaa_l1"))
    try:
        storm, vec = omni_storm(build)
    except Exception as e:
        build.fail("OMNI storm interval (CDAWeb)", e)
        storm = vo(None, "nT", "NASA CDAWeb dataset OMNI_HRO2_1MIN", "recorded", "TO_CONFIRM", None,
                   "the OMNI file could not be read at this build")
        storm["retrieved_utc"] = None
        vec = L.no_vector("GSE", "OMNI file unavailable at this build", "recorded")
    p["sub_places"].append(sub(
        p, "solar_storm", "Solar storm (10-11 May 2024, recorded)", None, storm, vec,
        {"text": "Solar storm conditions. Space radiation comes from galactic cosmic rays, the trapped-particle belts "
                 "and solar-particle events (George et al. 2024); solar-particle events are sporadic (Zhang et al. "
                 "2020). The live GOES proton flux and NOAA storm level are in /api/live (radiation).",
         "source": f"{GEORGE24}; {ZHANG20}"},
        "A real recorded storm from the OMNI archive: the interplanetary field in front of Earth during the 10-11 May "
        "2024 geomagnetic storm. B_total_nT is the largest 1-minute field magnitude of the interval and B_vector_nT "
        "the field vector in that minute. It shows what the interplanetary field can reach during a storm; it is "
        "not a forecast.", "static",
        event={"start_utc": STORM_START + "Z", "end_utc": STORM_END + "Z", "peak_utc": storm.get("as_of"),
               "dataset": "OMNI_HRO2_1MIN (NASA CDAWeb)"}))
    return p


def build_mars(build: Build) -> dict:
    p = place("mars_surface", "tomorrow", "Mars surface", "Mars")
    no_dynamo = ("Mars has no global dynamo field today; it has a remanent crustal field that may reach several "
                 "thousand nT locally (Langlais et al. 2019).")
    model = None
    try:
        model = langlais_model(build)
    except Exception as e:
        build.fail("Langlais et al. (2019) Mars model", e)

    def crust(sid: str, lat: float, lon: float):
        if model is None:
            v = vo(None, "nT", LANGLAIS19, "calculated", "TO_CONFIRM", None,
                   "the model file could not be read at this build; published range: the remanent field may reach "
                   "several thousand nT locally (Langlais et al. 2019)")
            v["retrieved_utc"] = None
            return v, L.no_vector("body-fixed", "Mars model unavailable at this build"), None
        g, h, info = model
        br, bt, bp = sh_field(g, h, MARS_REF_KM, MARS_REF_KM, lat, lon)
        src = f"{LANGLAIS19}, file Langlais2019.sh.gz (sha256 {info['sha256'][:16]}..., {LANGLAIS_URL})"
        v = L.derived(round(math.sqrt(br * br + bt * bt + bp * bp), 1), "nT", [],
                      "|B| = sqrt(Br^2 + Btheta^2 + Bphi^2), spherical-harmonic synthesis of the degree-134 internal "
                      "potential at radius 3393.5 km (the model's reference surface)", [f"{sid}.coords"], source=src,
                      extra="orbital model with a spatial resolution of about 160 km at the surface; the site's own "
                            "radius differs from 3393.5 km by a few km, which is not corrected")
        v["retrieved_utc"] = info["retrieved_utc"]
        return v, body_vector(br, bt, bp, src, "calculated", 1), math.sqrt(br * br + bt * bt + bp * bp)

    caveat = ("At the InSight site the measured surface field (2013 nT) is several times the value this orbital model "
              "gives there, so the true surface field at this site may also be larger than the model value.")
    for key, name, fid, what in (("jezero", "Jezero crater", 14300, "Perseverance rover"),
                                 ("gale", "Gale crater", 2071, "Curiosity rover")):
        pos = rover_position(build, key)
        if pos is not None:
            lat, lon, elev, src, note = pos
            coords = {"lat": lat, "lon": lon, "alt_km": elev, "tag": "recorded", "source": src, "as_of": None,
                      "note": note}
            where = f"the current position of the {what} (NASA/JPL waypoint file)"
        else:
            coords = feature_coords(fid, MARS_FEATURES, "centre of the crater (rover position file unavailable at this "
                                    "build)")
            lat, lon = coords["lat"], coords["lon"]
            where = "the IAU centre of the crater (the rover position file was unavailable at this build)"
        b, vec, _ = crust(f"mars_surface.{key}", lat, lon)
        p["sub_places"].append(sub(p, key, name, coords, b, vec, RAD_MARS,
                                   f"{no_dynamo} B_total_nT is the crustal field of the Langlais et al. (2019) MGS + "
                                   f"MAVEN model evaluated at {where}. {caveat}", "on_build"))
    coords = feature_coords(5930, MARS_FEATURES, "centre of the region (diameter 5855.87 km)")
    b, vec, _ = crust("mars_surface.terra_cimmeria", coords["lat"], coords["lon"])
    p["sub_places"].append(sub(p, "terra_cimmeria", "Terra Cimmeria", coords, b, vec, RAD_MARS,
                               f"{no_dynamo} B_total_nT is the Langlais et al. (2019) MGS + MAVEN model evaluated "
                               "at the IAU centre of the Terra Cimmeria region, not at the region's strongest point. "
                               f"{caveat}", "static"))
    insight = vo(2013, "nT", live.JOHNSON20, "recorded", "VERIFIED", None,
                 "InSight lander magnetometer, average surface field 2,013 ± 53 nT (mean over sols 14-299, "
                 "20:00-04:00 local time); about ten times stronger than predicted from orbit.")
    insight["retrieved_utc"] = None
    try:
        from server.runs import INSIGHT_ENU
        east, north, up = INSIGHT_ENU
        ivec = {"x": north, "y": east, "z": -up, "frame": "NED", "axes": "x north, y east, z down at the lander",
                "unit": "nT", "tag": "recorded", "source": live.JOHNSON20 + " (Table 1; components as held in "
                "server/runs.py INSIGHT_ENU)", "as_of": None}
    except Exception as e:
        build.fail("InSight field components", e)
        ivec = L.no_vector("NED", "components unavailable", "recorded")
    _, _, model_here = crust("mars_surface.insight", 4.502384, 135.623447)
    extra = (f" For comparison, the Langlais et al. (2019) orbital model evaluated at the lander gives "
             f"{model_here:.0f} nT." if model_here else "")
    p["sub_places"].append(sub(
        p, "insight", "InSight landing site (Elysium Planitia)",
        {"lat": 4.502384, "lon": 135.623447, "alt_km": -2.613426, "tag": "published_spec", "source": GOLOMBEK20,
         "as_of": None, "note": "lander at 4.502384°N, 135.623447°E, elevation -2,613.426 m with respect to the geoid "
                                "(planetocentric, positive east)"},
        insight, ivec, RAD_MARS,
        f"{no_dynamo} B_total_nT is the mean surface field measured on the Martian surface by the InSight lander's "
        f"magnetometer.{extra}", "static"))
    return p


# ---------------------------------------------------------------- assemble, check, write
def summary_rows(places: list[dict]):
    for pl in places:
        for sp in pl["sub_places"]:
            b = sp["B_total_nT"]
            yield sp["id"], b.get("value"), b.get("tag"), b.get("status"), sp.get("refresh"), (b.get("source") or "")


def main() -> int:
    build = Build()
    print(f"locations build at {iso(build.now)} ({build.gen})")
    build.l1, err, _, _ = live.fetch_l1()
    if err:
        build.fail("NOAA L1 magnetometer", err)
    goes, err = live.fetch_goes_mag()
    if err:
        build.fail("NOAA GOES magnetometer", err)
    tles = {}
    for key, norad in (("iss", live.ISS_NORAD), ("tiangong", live.TIANGONG_NORAD)):
        tle, err = live.fetch_tle(norad)
        if err:
            build.fail(f"CelesTrak TLE {norad}", err)
        else:
            tles[key] = tle
    flight, reference = build_flight(build)
    amb = ambient_field(build, build.l1)
    south, anomalies = build_moon(build, amb)
    places = [build_iss(build), build_tiangong(build, tles.get("tiangong")), build_hotspots(build, tles.get("iss")),
              build_analog(build), flight, build_gateway(build, amb), south, anomalies, build_transit(build, goes),
              build_mars(build)]
    if [p["id"] for p in places] != L.PLACE_IDS:
        raise SystemExit("place order does not match server/locations.py PLACE_IDS")
    for pl in places:
        for sp in pl["sub_places"]:
            L.derive(sp, reference)
    sources = []
    for pl in places:
        for sp in pl["sub_places"]:
            for s in (sp["B_total_nT"].get("source"), (sp.get("coords") or {}).get("source"),
                      sp["radiation_context"].get("source")):
                for part in (s or "").split("; "):
                    if part and part not in sources:
                        sources.append(part)
    n_sub = sum(len(pl["sub_places"]) for pl in places)
    obj = {
        "meta": meta(False, sources,
                     schema="locations v2: places[{id, group, name, body, sub_places[...]}]; see contract/schema.md",
                     built_by="scripts/build_locations.py", places=len(places), sub_places=n_sub,
                     igrf=build.gen,
                     reference={"earth_surface_nT": reference,
                                "earth_surface_id": "earth_flight.jsc",
                                "opm_dynamic_range_nT": L.opm_range_vo(),
                                "nv_gyromagnetic_ratio_MHz_per_mT": vo(L.GAMMA_NV, "MHz/mT", L.GAMMA_SOURCE,
                                                                        "published_spec", "VERIFIED"),
                                "formulas": {"opm_in_range": L.OPM_FORMULA, "nv_zeeman_shift_MHz": L.NV_FORMULA,
                                             "ratio_to_earth_surface": L.RATIO_FORMULA,
                                             "lunar_upper_bound": L.BOUND_FORMULA}},
                     legacy_ids=L.LEGACY_IDS, tles=tles,
                     refresh={"live_5s": "ISS sub-places: position polled every 5 s by the running server",
                              "on_build": "computed when this file is built; sub-places with live_source tiangong, "
                                          "noaa_l1 or goes_mag are also recomputed in memory every 60 s by the "
                                          "running server and served by GET /api/locations",
                              "static": "published or recorded value that does not change between builds",
                              "period_s": L.PERIOD_S},
                     downloads=build.downloads, errors=build.errors),
        "places": places,
    }
    write_json(DATA / "locations.json", obj)
    for sid, val, tag, status, refresh, src in summary_rows(places):
        print(f"  {sid:38s} {str(val):>10s} nT  {tag:14s} {status:18s} {refresh:9s} {src[:70]}")
    verified = sum(1 for r in summary_rows(places) if r[3] == "VERIFIED")
    log_status("data/locations.json", "done",
               f"{len(places)} places, {n_sub} sub-places ({verified} VERIFIED fields, {n_sub - verified} not), "
               f"{len(build.downloads)} downloads with sha256, {len(build.errors)} source errors"
               + (": " + " | ".join(build.errors) if build.errors else ""))
    print(f"built   data/locations.json: {len(places)} places, {n_sub} sub-places, errors: {build.errors or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
