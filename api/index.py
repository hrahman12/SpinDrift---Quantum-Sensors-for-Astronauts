"""Public serverless API for the SpinDrift web page on Vercel.

The full server (server/main.py) also keeps live feeds running in the background and records new runs to disk. A
serverless function can do neither, so this app serves what a visitor needs from the same code and the same data:

- POST /api/verdict            Lean decides (the spindrift-check binary is built during the Vercel build,
                               scripts/vercel_build.sh); Python only builds the input, as on the local server
- GET  /api/locations[/{id}]   the 34 spots of data/locations.json as built (no in-memory live refresh here)
- GET  /api/runs, /api/combined  the stored runs and the all-in-one sensor, with the Lean summary of every run
- GET  /api/live, /api/health  the last saved snapshot, marked public
- POST /api/run                not available here: a run reads the local recordings and writes the run store

Nothing here creates a data value.
"""
import sys
from pathlib import Path
from typing import Literal

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from pydantic import BaseModel, Field, field_validator  # noqa: E402

from server import locations as loc_engine  # noqa: E402
from server.common import DATA, now_iso, read_json  # noqa: E402

app = FastAPI(title="SpinDrift public API", docs_url=None, redoc_url=None)
PUBLIC_NOTE = ("Public site: places, runs and the all-in-one are served as stored when this version was deployed; "
               "Lean checks every request live. New runs and live feeds run on the local server.")


class VerdictInputs(BaseModel):   # the same inputs as server/main.py
    shielding_factor: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    beats_averaged: int | None = Field(default=None, ge=1)
    snr_required: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    target: Literal["r_peak", "q_wave"] | None = None
    renin: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    bilirubin_isf: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    bandwidth_hz: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    brain_signal_fT: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    brain_trials: int | None = Field(default=None, ge=1)
    nv_bandwidth_hz: float | None = Field(default=None, gt=0, allow_inf_nan=False)

    @field_validator("brain_signal_fT", "brain_trials", "nv_bandwidth_hz", mode="before")
    @classmethod
    def _a_number(cls, v):
        if isinstance(v, (bool, str)):
            raise ValueError("not a number")
        return v


class VerdictRequest(BaseModel):
    location: str | None = None
    inputs: VerdictInputs = Field(default_factory=VerdictInputs)


def _snapshot() -> dict:
    snap = read_json(DATA / "live_snapshot.json", {}) or {}
    return {**snap, "public": True, "note": PUBLIC_NOTE}


def _place(location: str) -> dict:
    sp = loc_engine.get(None, location)
    if sp is None:
        raise HTTPException(422, "location must be a sub-place id from /api/locations (for example iss.destiny) "
                                 f"or one of the five older ids {list(loc_engine.LEGACY_IDS)}")
    return sp


@app.get("/api/health")
def health():
    return {"ok": True, "public": True, "note": PUBLIC_NOTE, "served_at": now_iso()}


@app.get("/api/live")
def get_live():
    return _snapshot()


@app.get("/api/locations")
def get_locations():
    doc = loc_engine.current(None)
    if doc is None:
        raise HTTPException(503, "data/locations.json is not built")
    doc["served"] = {**(doc.get("served") or {}), "public": True, "note": PUBLIC_NOTE}
    return doc


@app.get("/api/locations/{location_id}")
def get_location(location_id: str):
    sp = loc_engine.get(None, location_id)
    if sp is None:
        raise HTTPException(404, f"unknown location id {location_id!r}")
    return {**sp, "requested_id": location_id, "served_at": now_iso()}


@app.get("/api/runs")
def get_runs():
    return read_json(DATA / "runs.json", {})


@app.get("/api/combined")
def combined():
    from server.summary import lean_summary
    comb = read_json(DATA / "combined_sensor.json", {}) or {}
    comb["lean_summary"] = lean_summary((read_json(DATA / "runs.json", {}) or {}).get("runs", []))
    return comb


@app.post("/api/run")
def post_run():
    return JSONResponse({"error": "Runs are recorded by the local SpinDrift server (they read the real recordings and "
                                  "write the run store). The public site shows the stored runs."}, status_code=503)


@app.post("/api/verdict")
def post_verdict(body: VerdictRequest):
    location = body.location or "iss"
    place = _place(location)
    from server import verdict
    try:
        return verdict.build(location, body.inputs.model_dump(), _snapshot(),
                             location_origin="user_input" if body.location else "app_default", place=place)
    except verdict.LeanUnavailable as e:
        return JSONResponse({"error": str(e), "verdicts": None}, status_code=503)
