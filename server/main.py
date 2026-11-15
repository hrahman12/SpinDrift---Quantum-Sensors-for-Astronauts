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
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from server import live
from server.common import DATA, DEVICES, RECORDED, RECORDED_IDS, LOCATION_IDS, now_iso, read_json, write_json

STATE = live.new_state()
STREAMABLE = {"opm_brain_mne", "opm_heart_kiel"}
L1_PERIOD, ISS_PERIOD, SWARM_PERIOD = 60, 10, 600


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
        tasks = [asyncio.create_task(_loop(live.update_l1, L1_PERIOD, write=True)),
                 asyncio.create_task(_loop(live.update_iss, ISS_PERIOD)),
                 asyncio.create_task(_loop(live.update_swarm, SWARM_PERIOD))]
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
    if body.location not in LOCATION_IDS:
        raise HTTPException(422, f"location must be one of {LOCATION_IDS}")
    from server import runs
    return runs.execute(body.location, body.role, current_live())


@app.get("/api/combined")
def combined():
    return read_json(DATA / "combined_sensor.json", {})
