"""Per-device live panels and the physical-instrument slot.

GET /api/devices/live?location=<id>: for each of the four devices, everything live or near-live that is real
and relevant, each item tagged honestly: the ambient field at the location, OPM readiness, the Swarm ASM (a
real optically pumped magnetometer in orbit), the NV bias against the live field, the live-driven ODMR-Lab
simulation, ISS cabin conditions (vehicle telemetry) and GOES proton flux. Environmental feeds are labelled as
environment, never as body signals.

GET /api/sensors/live: the instrument slot the app polls (app/LIVE_INSTRUMENT_CONTRACT.md). `connected` is
true only while a physical instrument is posting readings to POST /api/sensors/{device}/ingest, which needs
the key in env SPINDRIFT_INGEST_KEY. No instrument is connected today, so every device reports
connected: false with empty readings.
"""
from __future__ import annotations

import hmac
import os
import threading
from datetime import datetime, timezone

from server import locations as loc_engine
from server.common import DATA, DEVICES, now_iso, read_json, vo

MAX_AGE_S = 30
_ingest: dict = {d: None for d in DEVICES}
_lock = threading.Lock()

NO_LIVE = {
    "opm": "No public live feed exists from an OPM on a person. The Swarm ASM is a real optically pumped "
           "magnetometer, but it measures Earth's field from orbit.",
    "nv": "No public live feed exists from an NV-diamond magnetometer on a person; the NV studies' data are "
          "available on request only. The NV spectrum here comes from the latest real run of the ODMR-Lab online "
          "simulator (simulated, not measured).",
    "qd_renin": "No live or open renin measurement exists: the assay is read on a TIRF microscope, and renin is "
                "not in the open Inspiration4 data. Live items here describe the cabin environment, not renin.",
    "cqd_patch": "No live bilirubin feed exists; the patch's reader has no public endpoint. Astronaut bilirubin "
                 "comes from Inspiration4 (recorded). Live items here describe the cabin environment.",
}
RECORDED_BY_DEVICE = {"opm": ["opm_brain_mne", "opm_heart_kiel"], "nv": ["nv_odmr_zenodo10629041"],
                      "qd_renin": ["qd_fret_figshare5468838"], "cqd_patch": ["cqd_pl_mendeley_cmfbrvrb8y"]}
STREAMED = {"opm_brain_mne", "opm_heart_kiel"}


def _item(label, reading, kind):
    return {"label": label, "reading": reading, "kind": kind}


def _sim_status(sims, device):
    out = []
    for e in sims.get(device, []):
        latest = e["results"][-1] if e.get("results") else None
        out.append({"tool": e["tool"], "url": e["url"], "access": e["access"],
                    "status": "result available" if latest else "awaiting simulator run",
                    "latest": latest})
    return out


def panels(state: dict, location: str, place: dict | None = None) -> dict:
    """`location` is the id as sent; `place` its sub-place from data/locations.json (refreshed)."""
    resp = state.get("response") or {}
    place = place or loc_engine.get(state, location)
    rd = loc_engine.readiness(place) if place else (resp.get("opm_readiness") or {}).get(location) or {}
    amb = rd.get("ambient_nT")
    sims = read_json(DATA / "simulators.json", {})
    on_iss = bool(place) and place.get("place_id") == "iss"
    cabin = resp.get("iss_cabin") if on_iss else None
    rad = resp.get("radiation")
    env = []
    if cabin:
        env += [_item(f"ISS cabin: {c['name']}", c["reading"], "environment (ISS vehicle telemetry, not crew data)")
                for c in cabin]
    elif on_iss:
        env.append(_item("ISS cabin telemetry", None, "unavailable: " + str(state["errors"].get("iss_cabin"))))
    else:
        env.append(_item("Cabin telemetry", None, "no public live cabin telemetry for this location"))
    if rad:
        env += [_item(f"Proton flux {k.split('_')[1].replace('ge', '≥').replace('MeV', ' MeV')} ({rad['satellite']}, "
                      "geostationary orbit)", rad[k], "environment (space radiation)")
                for k in ("flux_ge10MeV_pfu", "flux_ge100MeV_pfu")]
        env.append(_item("NOAA solar radiation storm level", rad["noaa_s_scale"], "environment (space radiation)"))
    ctx = (place or {}).get("radiation_context") or {}
    if ctx.get("text"):
        env.append(_item("Radiation context at this location",
                         vo(ctx["text"], "", ctx.get("source") or "", "published_spec", "VERIFIED"),
                         "environment (published context, not a measurement at the crew)"))

    opm_live = []
    if amb:
        opm_live.append(_item("Ambient magnetic field at this location", amb, f"field ({amb['tag']})"))
        opm_live.append(_item("Field reduction the OPM needs (ambient ÷ ±5 nT)", rd["shielding_factor"], "calculated"))
    if resp.get("swarm_asm"):
        s = resp["swarm_asm"]
        opm_live.append(_item(f"Optically pumped magnetometer in orbit ({s['satellite']} ASM): field strength",
                              s["f_nT"], "near_live instrument (Earth's field, not a person)"))
    else:
        opm_live.append(_item("Swarm ASM (optically pumped magnetometer in orbit)", None,
                              "unavailable: " + str(state["errors"].get("swarm_asm"))))

    nv_live = []
    if place and (place.get("nv_zeeman_shift_MHz") or {}).get("value") is not None:
        nv_live.append(_item("NV line shift caused by the background field here (28.025 MHz/mT × |B|)",
                             loc_engine.bare(place["nv_zeeman_shift_MHz"]), "calculated"))
    if amb and amb.get("value"):
        nv_live.append(_item("NV bias (~1 mT) against the ambient field here",
                             {"value": round(1e6 / amb["value"], 1), "unit": "×", "source": "calculated from the "
                              "published NV bias and the ambient field", "tag": "calculated",
                              "status": amb["status"] if amb["status"] == "TO_CONFIRM" else "VERIFIED",
                              "as_of": amb.get("as_of"), "note": "formula: 1 mT / ambient field"}, "calculated"))
    last = next((r for r in reversed(read_json(DATA / "runs.json", {}).get("runs", []))
                 if (r.get("real_work") or {}).get("odmr_lab")), None)
    nv_sim = {"status": "result available" if last else "no run yet: press Run",
              "run_id": last["run_id"] if last else None, "location": last["location"] if last else None,
              "latest": last["real_work"]["odmr_lab"] if last else None}

    def rec(device):
        return [{"id": rid, "stream": f"/api/stream/{rid}" if rid in STREAMED else None,
                 "file": f"data/recorded/{rid}.json", "tag": "recorded"} for rid in RECORDED_BY_DEVICE[device]]

    return {
        "fetched_at": now_iso(), "location": location,
        "location_id": (place or {}).get("id"), "place": (place or {}).get("place"),
        "sub_place": (place or {}).get("sub_place"),
        "devices": {
            "opm": {"live": opm_live, "environment": env, "simulators": _sim_status(sims, "opm"),
                    "recorded": rec("opm"), "no_live_source": NO_LIVE["opm"]},
            "nv": {"live": nv_live, "latest_run_simulation": nv_sim, "environment": env,
                   "simulators": _sim_status(sims, "nv"), "recorded": rec("nv"), "no_live_source": NO_LIVE["nv"]},
            "qd_renin": {"live": [], "environment": env, "simulators": _sim_status(sims, "qd_renin"),
                         "recorded": rec("qd_renin"), "no_live_source": NO_LIVE["qd_renin"]},
            "cqd_patch": {"live": [], "environment": env, "simulators": _sim_status(sims, "cqd_patch"),
                          "recorded": rec("cqd_patch"), "no_live_source": NO_LIVE["cqd_patch"]},
        },
        "errors": resp.get("errors", []),
    }


# ---------------------------------------------------------------- physical instrument slot
def _ts_ok(s) -> bool:
    try:
        t = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return False
    return t.tzinfo is not None


def ingest(device: str, body: dict, key: str | None) -> tuple[int, dict]:
    expected = os.environ.get("SPINDRIFT_INGEST_KEY")
    if not expected:
        return 503, {"detail": "instrument ingest disabled: set SPINDRIFT_INGEST_KEY on the server"}
    if not key or not hmac.compare_digest(key, expected):
        return 401, {"detail": "bad or missing X-SpinDrift-Key"}
    if device not in DEVICES:
        return 404, {"detail": "unknown device"}
    inst, loc, readings = body.get("instrument_id"), body.get("location"), body.get("readings")
    if not inst or not loc or not isinstance(readings, dict) or not readings:
        return 422, {"detail": "instrument_id, location and a non-empty readings object are required"}
    for k, v in readings.items():
        ok = (isinstance(v, dict) and v.get("tag") == "live" and v.get("status") == "VERIFIED"
              and isinstance(v.get("value"), (int, float)) and v.get("unit") and v.get("source")
              and _ts_ok(v.get("as_of")))
        if not ok:
            return 422, {"detail": f"reading {k!r} must be a VO with tag live, status VERIFIED, numeric value, unit, "
                                   "source and a timezone-aware as_of"}
    with _lock:
        _ingest[device] = {"instrument_id": inst, "location": loc, "readings": readings,
                           "received": datetime.now(timezone.utc)}
    return 200, {"ok": True, "device": device}


def sensors_live() -> dict:
    now = datetime.now(timezone.utc)
    out = {}
    with _lock:
        for d in DEVICES:
            e = _ingest[d]
            connected = bool(e) and (now - e["received"]).total_seconds() <= MAX_AGE_S
            out[d] = {"device": d, "connected": connected,
                      "instrument_id": e["instrument_id"] if connected else None,
                      "location": e["location"] if connected else None,
                      "readings": e["readings"] if connected else {},
                      "note": None if connected else "No physical instrument connected."}
    return {"fetched_at": now_iso(), "sensors": out}
