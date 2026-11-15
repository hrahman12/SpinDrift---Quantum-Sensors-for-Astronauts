"""SpinDrift data server, contract v10.

Run from the repo root:  uvicorn server.main:app --port 8000

Background loops: L1 field every 60 s, ISS position every 10 s (wheretheiss.at allows one call per 5 s),
Swarm ASM every 10 min (only with VIRES_TOKEN). After each good L1 cycle the server writes
data/live_snapshot.json and data/locations.json (atomic). If no live cycle has finished yet, /api/live
serves the last snapshot and says so in errors.
"""
from __future__ import annotations

import asyncio
import json
import os
import threading
import time
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from server import devices, live
from server.common import (DATA, DEVICES, RECORDED, RECORDED_IDS, LOCATION_IDS, ROOT, now_iso, read_json,
                           write_json)

STATE = live.new_state()
STREAMABLE = {"opm_brain_mne", "opm_heart_kiel"}
L1_PERIOD, ISS_PERIOD, SWARM_PERIOD, GOES_PERIOD = 60, 10, 600, 300


async def _loop(fn, period, write=False):
    while True:
        try:
            await asyncio.to_thread(fn, STATE)
            resp = live.compose(STATE)
            if write:
                await asyncio.to_thread(live.write_outputs, resp, STATE["locations"])
        except Exception as e:  # keep the loop alive; the error is reported by /api/live
            STATE["errors"][fn.__name__] = f"{fn.__name__} {type(e).__name__}: {e}"
        await asyncio.sleep(period)


@asynccontextmanager
async def lifespan(app):
    tasks = []
    if os.environ.get("SPINDRIFT_NO_POLL") != "1":
        # One full cycle first, so the first snapshot is written with every feed's latest state.
        try:
            await asyncio.to_thread(live.cycle, STATE)
            await asyncio.to_thread(live.write_outputs, STATE["response"], STATE["locations"])
        except Exception as e:
            STATE["errors"]["startup"] = f"first live cycle {type(e).__name__}: {e}"
        tasks = [asyncio.create_task(_loop(live.update_l1, L1_PERIOD, write=True)),
                 asyncio.create_task(_loop(live.update_iss, ISS_PERIOD)),
                 asyncio.create_task(_loop(live.update_swarm, SWARM_PERIOD)),
                 asyncio.create_task(_loop(live.update_goes, GOES_PERIOD))]
        try:
            from server import cabin
            tasks.append(asyncio.create_task(cabin.run(STATE)))
        except ImportError:
            STATE["errors"]["iss_cabin"] = "ISS cabin telemetry not configured"
    yield
    for t in tasks:
        t.cancel()


app = FastAPI(title="SpinDrift data server", version="10.1", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
                   allow_methods=["*"], allow_headers=["*"])


def current_live() -> dict:
    resp = STATE.get("response")
    if resp is not None and (resp.get("l1") or resp.get("iss")):
        return resp
    snap = read_json(DATA / "live_snapshot.json", {})
    snap = {k: v for k, v in snap.items() if k != "meta"}
    snap.setdefault("errors", [])
    snap["errors"] = snap["errors"] + ["no live cycle finished yet; serving the last snapshot"]
    return snap


@app.get("/api/live")
def get_live():
    return current_live()


@app.get("/api/health")
def health():
    resp = STATE.get("response") or {}
    feeds = live.feed_health(resp)
    return {"ok": feeds["l1"] == "ok" and feeds["iss"] == "ok", "feeds": feeds}


@app.get("/api/stream/{recorded_id}")
async def stream(recorded_id: str):
    if recorded_id not in RECORDED_IDS:
        raise HTTPException(404, "unknown recorded id")
    if recorded_id not in STREAMABLE:
        raise HTTPException(404, "only opm_brain_mne and opm_heart_kiel are streamed")
    rec = read_json(RECORDED / f"{recorded_id}.json", {})
    xs = rec.get("x", {}).get("values", [])
    series = [s for s in rec.get("series", []) if len(s.get("values", [])) == len(xs)]
    if not xs or not series:
        raise HTTPException(503, f"{recorded_id} has no recorded samples yet (fixture)")
    fs = rec["meta"].get("sample_rate_hz") or (len(xs) - 1) / (xs[-1] - xs[0])
    step = max(1, round(fs * 0.1))  # 0.1 s of samples per event, paced at the recording's own rate
    unit = series[0]["unit"]
    dataset = rec["meta"].get("dataset", recorded_id)

    async def events():
        i = 0
        while True:
            j = min(i + step, len(xs))
            payload = {"x": xs[i:j], "series": [{"name": s["name"], "values": s["values"][i:j]} for s in series],
                       "unit": unit, "dataset": dataset, "tag": "recorded"}
            yield f"data: {json.dumps(payload)}\n\n"
            await asyncio.sleep((j - i) / fs)
            i = 0 if j >= len(xs) else j  # loop

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class Pasted(BaseModel):
    tool: str
    inputs_used: dict
    outputs: dict


@app.post("/api/simulators/{device}")
def paste_result(device: str, body: Pasted):
    if device not in DEVICES:
        raise HTTPException(404, "unknown device")
    sims = read_json(DATA / "simulators.json", {})
    entry = next((e for e in sims.get(device, []) if e["tool"] == body.tool), None)
    if entry is None:
        tools = [e["tool"] for e in sims.get(device, [])]
        raise HTTPException(404, f"tool {body.tool!r} is not listed for {device}; listed: {tools}")
    entry["results"].append({"run_at": now_iso(), "via": "pasted",
                             "outputs": {"inputs_used": body.inputs_used, **body.outputs}})
    sims["meta"]["generated_at"] = now_iso()
    write_json(DATA / "simulators.json", sims)
    return entry


class RunRequest(BaseModel):
    location: str
    role: str


@app.post("/api/run")
def post_run(body: RunRequest):
    """One real run: next real Kiel recording, one ODMR-Lab simulator call, next rows of the real QD, carbon-dot and
    Inspiration4 data; new facts are stacked onto the combined sensor."""
    if body.location not in LOCATION_IDS:
        raise HTTPException(422, f"location must be one of {LOCATION_IDS}")
    from server import runs
    return runs.execute(body.location, body.role, current_live())


@app.get("/api/runs")
def get_runs():
    return read_json(DATA / "runs.json", {})


@app.get("/api/devices/live")
def devices_live(location: str = "iss"):
    if location not in LOCATION_IDS:
        raise HTTPException(422, f"location must be one of {LOCATION_IDS}")
    if not STATE.get("response"):
        STATE["response"] = current_live()
    return devices.panels(STATE, location)


@app.get("/api/sensors/live")
def sensors_live():
    """Physical-instrument slot (app/LIVE_INSTRUMENT_CONTRACT.md). connected is true only while a real instrument
    posts readings; none is connected today."""
    return devices.sensors_live()


class Ingest(BaseModel):
    instrument_id: str
    location: str
    readings: dict


@app.post("/api/sensors/{device}/ingest")
def sensors_ingest(device: str, body: Ingest, x_spindrift_key: str | None = Header(default=None)):
    code, payload = devices.ingest(device, body.model_dump(), x_spindrift_key)
    return JSONResponse(payload, status_code=code)


@app.get("/api/combined")
def combined():
    return read_json(DATA / "combined_sensor.json", {})


class OdmrRequest(BaseModel):
    bx: float = 0.0
    by: float = 0.0
    bz: float = 0.0


_SIM_LOCK = threading.Lock()
_LAST_SIM = [0.0]


@app.post("/api/simulate/odmr")
def simulate_odmr(body: OdmrRequest):
    """One real call to the ODMR-Lab online simulator at a field chosen in the UI (mT, each component -4..4).
    Output is tagged simulated and recorded in simulators.json. One call at a time, at least 8 s apart."""
    b = (body.bx, body.by, body.bz)
    if any(not -4.0 <= v <= 4.0 for v in b):
        raise HTTPException(422, "each field component must be between -4 and 4 mT (the simulator's range)")
    if not _SIM_LOCK.acquire(blocking=False):
        raise HTTPException(429, "a simulator call is already running")
    try:
        if time.time() - _LAST_SIM[0] < 8:
            raise HTTPException(429, "please wait a few seconds between simulator calls")
        from server import odmr
        res = odmr.solve(b, "odmr_lab_ui_latest")
        _LAST_SIM[0] = time.time()
        sims = read_json(DATA / "simulators.json", {})
        entry = next((e for e in sims.get("nv", []) if e["tool"] == "ODMR-Lab"), None)
        if entry is not None:
            entry["results"].append({"run_at": now_iso(), "via": "api", "outputs": {
                "run": "ui", "label": "UI request", "inputs_used": {"bx": b[0], "by": b[1], "bz": b[2], **res["settings"]},
                "table": res["table"], "note": res["note"], "plot_file": res["plot_file"], "tag": "simulated",
                "caveat": res["caveat"]}})
            write_json(DATA / "simulators.json", sims)
        return res
    finally:
        _SIM_LOCK.release()


class VerdictInputs(BaseModel):
    shielding_factor: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    beats_averaged: int | None = Field(default=None, ge=1)
    snr_required: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    target: Literal["r_peak", "q_wave"] | None = None
    renin: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    bilirubin_isf: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    bandwidth_hz: float | None = Field(default=None, gt=0, allow_inf_nan=False)


class VerdictRequest(BaseModel):
    location: str | None = None
    inputs: VerdictInputs = Field(default_factory=VerdictInputs)


@app.post("/api/verdict")
def post_verdict(body: VerdictRequest):
    """Lean decides, for each sensor and body signal, whether it can be measured under the current conditions
    (REQUIREMENTS_MET / NOT_MET / NEED_MORE_INFORMATION). Python only builds the input; see server/verdict.py."""
    location = body.location or "iss"
    if location not in LOCATION_IDS:
        raise HTTPException(422, f"location must be one of {LOCATION_IDS}")
    from server import verdict
    try:
        return verdict.build(location, body.inputs.model_dump(), current_live(),
                             location_origin="user_input" if body.location else "app_default")
    except verdict.LeanUnavailable as e:
        return JSONResponse({"error": str(e), "verdicts": None}, status_code=503)


@app.get("/")
def root():
    return RedirectResponse("/ui/")


app.mount("/data", StaticFiles(directory=str(DATA)), name="data")
if (ROOT / "ui").exists():
    app.mount("/ui", StaticFiles(directory=str(ROOT / "ui"), html=True), name="ui")
