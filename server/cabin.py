"""ISS cabin telemetry (optional live feed, contract v10 Section 2.5).

Lightstreamer server https://push.lightstreamer.com, adapter set ISSLIVE (DEFAULT data adapter), MERGE mode,
fields TimeStamp and Value, as used by the ISS-Mimic project (github.com/ISS-Mimic/Mimic, Pi/iss_telemetry.py
L129-137). Item IDs from ISS-Mimic Pi/telemetry_ids.py and Telemetry/ISS_Public_Telemetry.xlsx.

Label: ISS vehicle telemetry, not crew data. Units are TO_CONFIRM: the ISS-Mimic spreadsheet lists PSI/PSIA/CNT
while the ISS-Mimic app labels cabin pressure in Torr and temperature in deg C, and the live magnitudes
(~757, ~23) fit Torr and deg C. TimeStamp is hours since the start of the UTC year. Values are pushed only
when they change, so each reading carries its own as_of. If nothing at all arrives for 10 minutes, the feed
is reported as null with an error.
"""
from __future__ import annotations

import asyncio
import threading
import time
from datetime import datetime, timedelta, timezone

from server.common import vo

SERVER, ADAPTER_SET = "https://push.lightstreamer.com", "ISSLIVE"
SIGNAL_ITEM = "TIME_000001"
ITEMS = {
    "USLAB000058": ("Cabin pressure (US Lab)", "Torr", "ISS-Mimic app label 'Cabin Pressure (Torr)'; spreadsheet says PSI"),
    "USLAB000059": ("Cabin temperature (US Lab CCAA inlet)", "deg C", "ISS-Mimic app label 'Cabin Temperature (deg C)'; "
                                                                      "spreadsheet says CNT"),
    "USLAB000053": ("ppO2 (US Lab MCA)", "mmHg", "no app label; spreadsheet says PSIA; magnitude fits mmHg"),
    "USLAB000055": ("ppCO2 (US Lab MCA)", "mmHg", "no app label; spreadsheet says PSIA; magnitude fits mmHg"),
}
SILENCE = 600  # seconds
SRC = ("NASA ISS Live telemetry via Lightstreamer (push.lightstreamer.com, adapter set ISSLIVE); item IDs from "
       "ISS-Mimic (github.com/ISS-Mimic/Mimic)")

_latest: dict = {}
_signal: dict = {}
_last_any = [0.0]
_lock = threading.Lock()


def hours_to_iso(hours: float) -> str | None:
    """ISS Live TimeStamp -> ISO-8601. ISS-Mimic computes it as day-of-year x 24 + UTC hour with day-of-year
    counted from 1 (Telemetry/iss_telemetry_all.js L85-90), so 1 January 00:00 UTC is 24.0."""
    try:
        h = float(hours) - 24.0
    except (TypeError, ValueError):
        return None
    now = datetime.now(timezone.utc)
    t = datetime(now.year, 1, 1, tzinfo=timezone.utc) + timedelta(hours=h)
    if t > now + timedelta(hours=1):  # value from the previous year (early January)
        t = datetime(now.year - 1, 1, 1, tzinfo=timezone.utc) + timedelta(hours=h)
    return t.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _start_client():
    from lightstreamer.client import LightstreamerClient, Subscription, SubscriptionListener

    class Listener(SubscriptionListener):
        def onItemUpdate(self, update):
            item = update.getItemName()
            with _lock:
                _last_any[0] = time.time()
                if item == SIGNAL_ITEM:
                    _signal.update({"class": update.getValue("Status.Class"),
                                    "timestamp": update.getValue("TimeStamp")})
                else:
                    _latest[item] = {"value": update.getValue("Value"), "timestamp": update.getValue("TimeStamp")}

    client = LightstreamerClient(SERVER, ADAPTER_SET)
    client.connect()
    sub = Subscription("MERGE", list(ITEMS), ["TimeStamp", "Value"])
    sub.addListener(Listener())
    client.subscribe(sub)
    sig = Subscription("MERGE", [SIGNAL_ITEM], ["TimeStamp", "Value", "Status.Class", "Status.Indicator"])
    sig.addListener(Listener())
    client.subscribe(sig)
    return client


def readings() -> list | None:
    with _lock:
        if not _latest:
            return None
        out = []
        for item, (name, unit, why) in ITEMS.items():
            r = _latest.get(item)
            if not r:
                continue
            try:
                val = round(float(r["value"]), 3)
            except (TypeError, ValueError):
                continue
            as_of = hours_to_iso(r["timestamp"])
            if as_of is None:
                continue
            note = (f"ISS vehicle telemetry, not crew data. Item {item}. Unit to confirm: {why}. Values are pushed only "
                    f"when they change. Signal class at last update: {_signal.get('class')} ('24' = signal acquired per "
                    f"ISS-Mimic).")
            out.append({"name": name, "reading": vo(val, unit, SRC, "live", "TO_CONFIRM", as_of, note)})
        return out or None


def snapshot(timeout_s: float = 20.0) -> list | None:
    """One-shot read for the build script: connect, wait for the items, disconnect."""
    client = _start_client()
    t0 = time.time()
    try:
        while time.time() - t0 < timeout_s and len(_latest) < len(ITEMS):
            time.sleep(0.5)
        return readings()
    finally:
        try:
            client.disconnect()
        except Exception:
            pass


async def run(state: dict) -> None:
    """Start the Lightstreamer client and keep state['iss_cabin'] current."""
    try:
        await asyncio.to_thread(_start_client)
    except Exception as e:
        state["errors"]["iss_cabin"] = f"ISS cabin telemetry {type(e).__name__}: {e}"
        return
    while True:
        silent = _last_any[0] == 0.0 or time.time() - _last_any[0] > SILENCE
        if silent and _last_any[0] != 0.0:
            state["iss_cabin"] = None
            state["errors"]["iss_cabin"] = "ISS cabin telemetry silent for more than 10 min"
        else:
            state["iss_cabin"] = readings()
            state["errors"]["iss_cabin"] = None if state["iss_cabin"] else "ISS cabin telemetry: no readings yet"
        await asyncio.sleep(15)
