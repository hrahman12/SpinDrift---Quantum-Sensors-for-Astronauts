"""Check data/*.json against the contract: parses, no NaN, value objects well-formed."""
import json, math, sys
from pathlib import Path
DATA = Path(__file__).resolve().parent.parent / "data"
TAGS = {"datasheet", "published_spec", "calculated", "replay", "live", "near_live", "recorded", "simulated", "literature_anchor"}
STATUS = {"VERIFIED", "NOT_STATED", "NOT_YET_EXTRACTED", "TO_CONFIRM"}
problems = []

def walk(path, node):
    if isinstance(node, float) and (math.isnan(node) or math.isinf(node)):
        problems.append(f"{path}: NaN/Inf")
    if isinstance(node, dict):
        if {"value", "tag", "status"} <= node.keys():
            if node["tag"] not in TAGS: problems.append(f"{path}: bad tag {node['tag']}")
            if node["status"] not in STATUS: problems.append(f"{path}: bad status {node['status']}")
            if node["value"] is None and node["status"] == "VERIFIED": problems.append(f"{path}: VERIFIED but value null")
        for k, x in node.items(): walk(f"{path}.{k}", x)
    elif isinstance(node, list):
        for i, x in enumerate(node): walk(f"{path}[{i}]", x)

for f in sorted(DATA.glob("*.json")):
    try:
        obj = json.loads(f.read_text(encoding="utf-8"))
    except Exception as e:
        problems.append(f"{f.name}: does not parse ({e})"); continue
    walk(f.name, obj)
    print(f"ok  {f.name}")
print("problems:", problems or "none")
sys.exit(1 if problems else 0)
