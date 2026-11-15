"""SpinDrift server, contract v10. STUB: serves the /data fixtures as they are.

Run from the repo root: uvicorn server.main:app --port 8000
"""
import asyncio
import json

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from server.common import DATA, DEVICES, RECORDED, RECORDED_IDS, now_iso, read_json, write_json

app = FastAPI(title="SpinDrift data server (stub)", version="10.0-stub")
app.add_middleware(CORSMiddleware, allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
                   allow_methods=["*"], allow_headers=["*"])


@app.get("/api/live")
def live():
    return read_json(DATA / "live_snapshot.json", {})


@app.get("/api/health")
def health():
    snap = read_json(DATA / "live_snapshot.json", {})
    feeds = {f: "error" for f in ["l1", "iss", "swarm_asm", "iss_cabin"]}
    return {"ok": False, "feeds": feeds, "note": "stub server" if snap.get("meta", {}).get("fixture") else None}


@app.get("/api/stream/{recorded_id}")
async def stream(recorded_id: str):
    if recorded_id not in RECORDED_IDS:
        raise HTTPException(404, "unknown recorded id")
    rec = read_json(RECORDED / f"{recorded_id}.json", {})

    async def events():
        payload = {"x": rec.get("x", {}).get("values", []),
                   "series": [{"name": s["name"], "values": s["values"]} for s in rec.get("series", [])],
                   "unit": rec.get("series", [{}])[0].get("unit", "") if rec.get("series") else "",
                   "dataset": rec.get("meta", {}).get("dataset", recorded_id), "tag": "recorded"}
        while True:
            yield f"data: {json.dumps(payload)}\n\n"
            await asyncio.sleep(1.0)

    return StreamingResponse(events(), media_type="text/event-stream")


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
        raise HTTPException(404, f"tool {body.tool!r} not listed for {device}")
    entry["results"].append({"run_at": now_iso(), "via": "pasted",
                             "outputs": {"inputs_used": body.inputs_used, **body.outputs}})
    write_json(DATA / "simulators.json", sims)
    return entry


class RunRequest(BaseModel):
    location: str
    role: str


@app.post("/api/run")
def run(body: RunRequest):
    raise HTTPException(503, "stub server: runs not implemented yet")


@app.get("/api/combined")
def combined():
    return read_json(DATA / "combined_sensor.json", {})
