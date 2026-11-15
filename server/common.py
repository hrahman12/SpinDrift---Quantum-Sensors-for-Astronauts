"""Shared helpers for SpinDrift data scripts and the server (contract v10).

Every number or fact is a value object (VO). Nothing here creates data values:
helpers only wrap values that a caller read from a source.
"""
from __future__ import annotations

import json
import math
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RECORDED = DATA / "recorded"
STATUS_FILE = ROOT / "STATUS.md"
AGENT = "claude-code"

TAGS = {"live", "near_live", "recorded", "datasheet", "published_spec", "calculated", "simulated"}
STATUSES = {"VERIFIED", "NOT_STATED", "NOT_YET_EXTRACTED", "TO_CONFIRM"}
LOCATION_IDS = ["iss", "gateway", "lunar_base", "mars_transit", "mars_surface"]
DEVICES = ["opm", "nv", "qd_renin", "cqd_patch"]
RECORDED_IDS = ["opm_brain_mne", "opm_heart_kiel", "nv_odmr_zenodo10629041",
                "qd_fret_figshare5468838", "cqd_pl_mendeley_cmfbrvrb8y"]

FOOTER = ("Live: space magnetic-field feeds (NOAA L1 magnetometer; ISS position with the IGRF model). "
          "Near-live: an optically pumped magnetometer in orbit (ESA Swarm). Recorded: real OPM brain and "
          "heart data, NV, quantum-dot and carbon-dot lab data, and Inspiration4 astronaut lab data from NASA "
          "OSDR. Simulated: online simulators, labelled. No public live feed exists from these sensors on a "
          "human in space. Not diagnostic.")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def vo(value, unit="", source="", tag="published_spec", status="VERIFIED", as_of=None, note=None) -> dict:
    """Wrap one sourced value. Raises if the combination breaks the contract."""
    if tag not in TAGS:
        raise ValueError(f"bad tag {tag}")
    if status not in STATUSES:
        raise ValueError(f"bad status {status}")
    if status in ("NOT_STATED", "NOT_YET_EXTRACTED") and value is not None:
        raise ValueError(f"{status} must carry value null (got {value!r})")
    if status == "VERIFIED" and value is None:
        raise ValueError("VERIFIED value cannot be null")
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        raise ValueError("NaN/Inf value")
    if tag in ("live", "near_live") and value is not None and not as_of:
        raise ValueError("live/near_live needs as_of")
    return {"value": value, "unit": unit, "source": source, "tag": tag, "status": status,
            "as_of": as_of, "note": note}


def missing(unit="", source="", tag="published_spec", status="NOT_STATED", note=None) -> dict:
    """A value that the source does not give (NOT_STATED) or that is not extracted yet."""
    return vo(None, unit, source, tag, status, None, note)


def calc(value, unit, inputs: list[dict], formula: str, input_ids: list[str], source="SpinDrift calculation",
         note_extra: str | None = None, as_of=None) -> dict:
    """A calculated VO. Status inherits the weakest input status (TO_CONFIRM beats VERIFIED);
    if any input is null the result is null and NOT_YET_EXTRACTED."""
    statuses = [i["status"] for i in inputs]
    note = f"formula: {formula}; inputs: {', '.join(input_ids)}"
    if note_extra:
        note += f"; {note_extra}"
    if value is None or any(i["value"] is None for i in inputs):
        return vo(None, unit, source, "calculated", "NOT_YET_EXTRACTED", None, note)
    status = "TO_CONFIRM" if "TO_CONFIRM" in statuses else "VERIFIED"
    return vo(value, unit, source, "calculated", status, as_of, note)


def meta(fixture: bool, sources: list[str], **extra) -> dict:
    m = {"fixture": fixture, "generated_at": now_iso(), "sources": sources}
    m.update(extra)
    return m


def write_json(path: Path, obj) -> None:
    """Atomic write: temp file in the same folder, then replace."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, indent=2, ensure_ascii=False, allow_nan=False)
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def read_json(path: Path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def log_status(target: str, outcome: str, note: str) -> None:
    """Append one line to /STATUS.md: <ISO time> <agent> <file or feed> <done|failed|changed> <note>."""
    if outcome not in ("done", "failed", "changed"):
        raise ValueError(outcome)
    line = f"{now_iso()} {AGENT} {target} {outcome} {note}".replace("\n", " ")
    with open(STATUS_FILE, "a", encoding="utf-8") as fh:
        fh.write(line + "\n")
