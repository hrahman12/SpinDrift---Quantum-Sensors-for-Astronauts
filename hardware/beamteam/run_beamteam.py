"""Trace and verify a BEAMTEAM design file offline. No Gemini calls.

BEAMTEAM: https://github.com/elevenarms/beamteam (MIT), commit 7b7aafd on main.
Usage:
    BEAMTEAM_BACKEND=/path/to/beamteam/backend python hardware/beamteam/run_beamteam.py hardware/beamteam/opm_795_bench.json
"""
import json
import os
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
backend = os.environ.get("BEAMTEAM_BACKEND")
if not backend:
    sys.exit("set BEAMTEAM_BACKEND to the backend/ folder of a BEAMTEAM checkout")
sys.path.insert(0, backend)

from optics.bom import build_bom  # noqa: E402
from optics.ir import Design  # noqa: E402
from optics.trace import trace  # noqa: E402
from optics.verify import verify  # noqa: E402

design = Design.model_validate(json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")))
tr = trace(design)
rep = verify(design, tr)
print(f"design={design.name} passed={rep.passed} score={rep.score}")
print("metrics:", json.dumps(rep.metrics, sort_keys=True))
for c in rep.checks:
    print(f"  [{c.severity}] {c.id} element={c.element_id} segment={c.segment_id} value={c.value} limit={c.limit} :: {c.message}")
print("placed elements:")
for p in tr.elements:
    print(f"  {p.id} ({p.type}) placed={p.placed} position={p.position} power_out_mw={p.power_out_mw} error={p.error}")
print("branches:", tr.branches)
bom = build_bom(design, tr)
print("bom keys:", sorted(bom.keys()))
print(json.dumps(bom, indent=1, default=str))
