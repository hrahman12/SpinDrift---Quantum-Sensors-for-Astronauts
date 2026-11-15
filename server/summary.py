"""Summary of every stored run's Lean result, as served by GET /api/combined: per sensor check, where Lean said it
works, does not work or needs a number, and the strictest condition seen. Kept free of heavy imports so the public
serverless API (api/index.py) can serve it; server/runs.py imports it from here."""
from __future__ import annotations

from server.common import DEVICES, calc, now_iso

VERDICT_LISTS = {"REQUIREMENTS_MET": "works", "NOT_MET": "does_not_work", "NEED_MORE_INFORMATION": "needs_a_number"}


def lean_summary(all_runs: list[dict]) -> dict:
    """Across every run with a Lean result: per sensor check, the places where Lean said it works, does not work or
    needs a number (latest verdict at each place), and the strictest condition seen (largest OPM shielding factor
    needed; most NV heartbeats needed), as a calculated value object."""
    from server.verdict import CARD_INFO, CHECK_IDS, DECIDING_RULE, DEVICE_OF
    checks = {cid: {"device": DEVICE_OF[cid], "sensor": CARD_INFO[cid][0], "signal": CARD_INFO[cid][1],
                    "works": [], "does_not_work": [], "needs_a_number": [], "by_location": {}, "strictest": None}
              for cid in CHECK_IDS}
    best, counted = {}, 0
    for run in all_runs:
        lean = run.get("lean") or {}
        if not lean.get("checks"):
            continue
        counted += 1
        loc, env = run.get("location_id"), run.get("environment") or {}
        for cid, c in lean["checks"].items():
            if cid not in checks:
                continue
            bl = checks[cid]["by_location"].setdefault(loc, {"place": env.get("place"), "sub_place": env.get("sub_place"),
                                                             "runs": 0, "verdicts_seen": {}})
            bl["runs"] += 1
            bl["verdicts_seen"][c["verdict"]] = bl["verdicts_seen"].get(c["verdict"], 0) + 1
            dec = c.get("deciding_requirement") or {}
            bl.update({"latest_verdict": c["verdict"], "latest_run": run.get("run_id"),
                       "latest_at": lean.get("decided_at"), "deciding_requirement": dec.get("id"),
                       "missing": [{"symbol": m.get("symbol"), "id": m.get("id")} for m in dec.get("missing", [])]})
            for key, cond in (c.get("conditions") or {}).items():
                val = (cond or {}).get("value")
                if isinstance(val, (int, float)) and not isinstance(val, bool):
                    if cid not in best or val > best[cid][0]["value"]:
                        best[cid] = (cond, key, loc, run.get("run_id"))
    for cid, e in checks.items():
        for loc, bl in e["by_location"].items():
            e[VERDICT_LISTS[bl["latest_verdict"]]].append(loc)
        if cid in best:
            cond, key, loc, rid = best[cid]
            e["strictest"] = {
                "condition": key, "location_id": loc, "run_id": rid,
                "value": calc(cond["value"], cond["unit"], [cond], f"largest {key} over the runs with a Lean result",
                              [f"runs.{rid}.lean.checks.{cid}.conditions.{key}"], source=cond.get("source"),
                              note_extra=f"seen at {loc} in {rid}; that value: {cond.get('note')}",
                              as_of=cond.get("as_of"))}
    return {"generated_at": now_iso(), "runs_total": len(all_runs), "runs_with_lean": counted,
            "legend": {"works": "REQUIREMENTS_MET", "does_not_work": "NOT_MET",
                       "needs_a_number": "NEED_MORE_INFORMATION (a number is missing or unconfirmed)"},
            "lists_use": "the latest Lean verdict at each place", "rule": DECIDING_RULE,
            "by_device": {d: [cid for cid in CHECK_IDS if DEVICE_OF[cid] == d] for d in DEVICES},
            "checks": checks}
