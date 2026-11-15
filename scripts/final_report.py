"""Print the v10 final report and append it to STATUS.md (brief Section 7)."""
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.common import DATA, DEVICES, ROOT, STATUS_FILE, now_iso, read_json  # noqa: E402


def vos(n, path=""):
    if isinstance(n, dict):
        if {"value", "tag", "status"} <= n.keys():
            yield path, n
            return
        for k, v in n.items():
            yield from vos(v, f"{path}.{k}")
    elif isinstance(n, list):
        for i, v in enumerate(n):
            yield from vos(v, f"{path}[{i}]")


def main():
    files = sorted(str(p.relative_to(DATA)).replace("\\", "/") for p in DATA.rglob("*.json")
                   if "legacy" not in p.parts)
    contract = {"specs.json", "locations.json", "nv_heart_derived.json", "physics.json", "nasa_i4.json",
                "published_points.json", "hrp.json", "simulators.json", "clinical_card.json", "build_log.json",
                "live_snapshot.json", "runs.json", "combined_sensor.json", "palette.json", "assets.json",
                "device_map.json"}
    out = [f"## Final report ({now_iso()})", "", "### Files and value objects by tag/status"]
    for f in files:
        if f not in contract and not f.startswith("recorded/"):
            continue
        obj = read_json(DATA / f, {})
        c = Counter(f"{v['tag']}/{v['status']}" for _, v in vos(obj))
        fx = " (fixture)" if obj.get("meta", {}).get("fixture") else ""
        out.append(f"- {f}{fx}: " + (", ".join(f"{k} {n}" for k, n in sorted(c.items())) or "no value objects"))
    out += ["", "### TO_CONFIRM items (specs, physics, palette, simulators)"]
    for f in ("specs.json", "physics.json", "palette.json", "simulators.json"):
        for path, v in vos(read_json(DATA / f, {})):
            if v["status"] == "TO_CONFIRM":
                out.append(f"- {f}{path}: {v['value']!r} {v['unit']}: {(v.get('note') or '')[:150]}")
    status_lines = STATUS_FILE.read_text(encoding="utf-8").splitlines()
    out += ["", "### Upgraded or corrected from primary sources"]
    out += [f"- {l.split(' ', 2)[2]}" for l in status_lines if " claude-code data/specs.json changed " in l]
    snap = read_json(DATA / "live_snapshot.json", {})
    out += ["", "### Feeds (latest snapshot " + str(snap.get("fetched_at")) + ")"]
    out.append(f"- NOAA L1: {'ok, ' + str(snap['l1']['bt_nT']['value']) + ' nT from ' + str(snap['l1'].get('spacecraft')) if snap.get('l1') else 'error'}"
               " (brief URLs retired by NWS SCN 26-21; /json/rtsw/ replacement used)")
    out.append(f"- ISS position + IGRF-14: {'ok, ' + str(snap['iss']['b_total_nT']['value']) + ' nT' if snap.get('iss') else 'error'}")
    out.append(f"- GOES protons: {'ok, ' + str(snap['radiation']['flux_ge10MeV_pfu']['value']) + ' pfu (' + str(snap['radiation']['noaa_s_scale']['value']) + ')' if snap.get('radiation') else 'not in snapshot'}")
    out.append(f"- ISS cabin (Lightstreamer ISSLIVE): {'ok, ' + str(len(snap['iss_cabin'])) + ' items' if snap.get('iss_cabin') else 'not in snapshot'}")
    out.append(f"- Swarm ASM: {'ok' if snap.get('swarm_asm') else 'null: ' + '; '.join(e for e in snap.get('errors', []) if 'VIRES' in e or 'Swarm' in e)}")
    out += ["", "### Failures logged"]
    out += [f"- {l.split(' ', 2)[2]}" for l in status_lines if " failed " in l and " claude-code " in l]
    out += ["", "### Simulator results"]
    sims = read_json(DATA / "simulators.json", {})
    for d in DEVICES:
        for e in sims.get(d, []):
            out.append(f"- {d} / {e['tool']}: {len(e['results'])} result(s)"
                       + (f" ({', '.join(r['via'] for r in e['results'])})" if e["results"] else ": awaiting simulator run"))
    runs = read_json(DATA / "runs.json", {}).get("runs", [])
    comb = read_json(DATA / "combined_sensor.json", {})
    out += [f"- runs so far: {len(runs)}; combined sensor version {comb.get('version')}, "
            f"{sum(len(c['facts']) for c in comb.get('components', {}).values())} bricks"]
    out += ["", "### Still to do by a person",
            "- Swarm ASM: register free at https://vires.services, then set the environment variable VIRES_TOKEN before "
            "starting the server (never commit it).",
            "- Manual simulator runs (browser): SimOS Virtual Lab, SimuFísica Bloch Equation Generator, DRCMR Bloch "
            "Simulator, FRET-Calc, nanoHUB Quantum Dot Lab (free account), MCX Cloud; paste results through POST "
            "/api/simulators/{device}.",
            "- Published data points from the paywalled renin (doi:10.1021/ac302284s) and patch "
            "(doi:10.1021/acsnano.4c06191) papers, each with figure and page.",
            "- TO_CONFIRM items above (APS full text of the OSCAR-QUBE paper; CQD reader channels; QuSpin resonance "
            "width full vs half; ISS cabin units).",
            "- Restart the server on port 8001 (started by Codex with the old code) so it serves the new endpoints.",
            "- Real instruments: if one becomes available, set SPINDRIFT_INGEST_KEY and post readings to "
            "/api/sensors/{device}/ingest; until then every device shows 'No physical instrument connected'."]
    text = "\n".join(out)
    print(text)
    with open(STATUS_FILE, "a", encoding="utf-8") as fh:
        fh.write("\n" + text + "\n")


if __name__ == "__main__":
    main()
