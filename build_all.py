"""Rebuild every SpinDrift data file from real sources, then validate.

    python build_all.py

Order: fixtures for anything missing -> specs -> one live cycle (NOAA L1, ISS + IGRF, GOES, Swarm if VIRES_TOKEN,
ISS cabin one-shot) -> recorded datasets -> EEG -> NASA (Inspiration4, HRP) -> calculated files -> simulators
(ODMR-Lab runs A and B only if missing) -> UI data (device map, palette, images) -> validate.
A failed step is logged in STATUS.md and the build moves on; nothing is substituted.
Raw downloads are cached in SPINDRIFT_CACHE (default ~/.spindrift_cache).
"""
import runpy
import subprocess
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))


def live_cycle():
    from server import live
    st = live.new_state()
    resp = live.cycle(st)
    try:
        from server import cabin
        st["iss_cabin"] = cabin.snapshot(20)
        resp = live.compose(st)
    except Exception as e:  # optional feed
        print(f"  ISS cabin one-shot failed: {type(e).__name__}: {e}")
    live.write_outputs(resp, st["locations"])
    import json
    import os
    from server.realdata import CACHE
    CACHE.mkdir(parents=True, exist_ok=True)
    p = CACHE / "build_live.json"
    p.write_text(json.dumps({"meta": {"fixture": False}, **resp}, ensure_ascii=False), encoding="utf-8")
    os.environ["SPINDRIFT_LIVE_JSON"] = str(p)
    print("  live errors:", resp["errors"])


STEPS = [
    ("fixtures for missing files", lambda: runpy.run_path(str(ROOT / "scripts/make_fixtures.py"), run_name="__main__")),
    ("specs", lambda: runpy.run_path(str(ROOT / "scripts/build_specs.py"), run_name="__main__")),
    ("live cycle", live_cycle),
    ("recorded datasets", lambda: runpy.run_path(str(ROOT / "scripts/build_recorded.py"), run_name="__main__")),
    ("EEG (ds004902)", lambda: runpy.run_path(str(ROOT / "scripts/build_eeg.py"), run_name="__main__")),
    ("NASA data", lambda: runpy.run_path(str(ROOT / "scripts/build_nasa.py"), run_name="__main__")),
    ("calculated files", lambda: runpy.run_path(str(ROOT / "scripts/build_calculated.py"), run_name="__main__")),
    ("simulators", lambda: runpy.run_path(str(ROOT / "scripts/build_simulators.py"), run_name="__main__")),
    ("UI data", lambda: runpy.run_path(str(ROOT / "scripts/build_ui_data.py"), run_name="__main__")),
]


def main():
    failed = []
    for name, fn in STEPS:
        print(f"== {name}")
        try:
            fn()
        except SystemExit as e:
            if e.code not in (0, None):
                failed.append(name)
        except Exception:
            traceback.print_exc()
            failed.append(name)
    print("== validate")
    code = subprocess.call([sys.executable, str(ROOT / "scripts/validate.py")])
    print("failed steps:", failed or "none")
    sys.exit(1 if code or failed else 0)


if __name__ == "__main__":
    main()
