"""Fetch live ambient-field samples. Writes data/live_ambient.json and data/iss_position.json.
Sources: NOAA SWPC real-time solar wind (DSCOVR at L1), wheretheiss.at (ISS position)."""
import json, urllib.request
from datetime import datetime, timezone
from pathlib import Path
OUT = Path(__file__).resolve().parent.parent / "data"
NOW = datetime.now(timezone.utc).isoformat(timespec="seconds")

def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)

rows = sorted(get("https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json"), key=lambda r: r["time_tag"])
samples = [{"t": r["time_tag"], "bt_nT": r.get("bt"), "bx_gsm_nT": r.get("bx_gsm"),
            "by_gsm_nT": r.get("by_gsm"), "bz_gsm_nT": r.get("bz_gsm")} for r in rows[-60:]]
(OUT / "live_ambient.json").write_text(json.dumps({
    "meta": {"accessed": NOW, "tag": "live", "fixture": False,
             "source": "NOAA SWPC real-time solar wind magnetometer (DSCOVR at L1)",
             "url": "https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json",
             "note": "Spec URL services.swpc.noaa.gov/products/solar-wind/mag-5-minute.json returns 404 (checked 2026-11-15)."},
    "samples": samples}, indent=2), encoding="utf-8")

iss = get("https://api.wheretheiss.at/v1/satellites/25544")
(OUT / "iss_position.json").write_text(json.dumps({
    "meta": {"accessed": NOW, "tag": "live", "fixture": False, "source": "wheretheiss.at ISS position",
             "url": "https://api.wheretheiss.at/v1/satellites/25544", "field_model": "NOT YET (IGRF step pending)"},
    "samples": [{"t": iss["timestamp"], "lat": iss["latitude"], "lon": iss["longitude"], "alt_km": iss["altitude"]}]}, indent=2), encoding="utf-8")
print("live_ambient samples:", len(samples), "latest bt_nT:", samples[-1]["bt_nT"], "at", samples[-1]["t"])
print("ISS lat/lon/alt:", round(iss["latitude"], 2), round(iss["longitude"], 2), round(iss["altitude"], 1))
