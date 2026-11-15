"""NASA data (contract v10, Section 4): data/nasa_i4.json and data/hrp.json.

nasa_i4.json: openly released, processed Inspiration4 clinical chemistry from NASA OSDR OSD-575
(Comprehensive Metabolic Panel, Quest Diagnostics). Total bilirubin for the carbon-dot tab; renin and
aldosterone are not measured in the open I4 files and go to `not_found`. Crew codes and timepoint labels
are kept exactly as released. No attempt is made to identify anyone; the SEX column is not read.

hrp.json: NASA's five hazards of human spaceflight, quoted word for word from https://www.nasa.gov/hrp/hazards/.
If a fetch fails, the fixture stays and STATUS.md says why. Nothing is substituted.
"""
import csv
import hashlib
import html
import io
import os
import re
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.common import DATA, log_status, meta, now_iso, vo, write_json  # noqa: E402

CACHE = Path(os.environ.get("SPINDRIFT_CACHE", Path.home() / ".spindrift_cache"))
UA = {"User-Agent": "SpinDrift-data-pipeline/10 (research prototype)"}

CMP_FILE = "LSDS-8_Comprehensive_Metabolic_Panel_CMP.upload_SUBMITTED.csv"
CMP_URL = f"https://osdr.nasa.gov/geode-py/ws/studies/OSD-575/download?source=datamanager&file={CMP_FILE}"
CMP_SHA256 = "dab247eb794edab59aaaa683c85fd1f2dbf4ae3684872739338e10ead4192a0c"
META_URL = "https://osdr.nasa.gov/osdr/data/osd/meta/575"
STUDY_URL = "https://osdr.nasa.gov/bio/repo/data/studies/OSD-575"
TIMEPOINTS = ["L-92", "L-44", "L-3", "R+1", "R+45", "R+82", "R+194"]
OSDR_TERMS = ("NASA OSDR terms (https://science.nasa.gov/reference/osdr-help-terms-and-conditions/): distributed under "
              "NASA Science Mission Directorate's Science Information Policy, open access; cite the study. No specific "
              "licence is named. Acknowledgement: 'Data are courtesy of the NASA Open Science Data Repository "
              "(https://osdr.nasa.gov/bio/repo)'.")
I4_STUDIES = ["OSD-569", "OSD-570", "OSD-571", "OSD-572", "OSD-573", "OSD-574", "OSD-575", "OSD-630", "OSD-656",
              "OSD-687"]
HRP_URL = "https://www.nasa.gov/hrp/hazards/"
HRP_HEADINGS = {"Space Radiation", "Isolation and Confinement", "Distance from Earth", "Gravity Fields",
                "Hostile/Closed Environments"}
RISKS_URL = "https://www.nasa.gov/hrp/risks/"
RISKS_WANTED = {"Risk of Radiation-Induced Cancers", "Risk of Hypoxia",
                "Risk of Reduced Cardiorespiratory and Musculoskeletal Fitness", "Risk of Cardiovascular Adaptations",
                "Risk of Inadequate Sleep and Irregular Schedules"}


def build_i4():
    dest = CACHE / "osdr-575" / CMP_FILE
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        r = requests.get(CMP_URL, headers=UA, timeout=120)
        r.raise_for_status()
        dest.write_bytes(r.content)
    raw = dest.read_bytes()
    if hashlib.sha256(raw).hexdigest() != CMP_SHA256:
        dest.unlink()
        raise ValueError("sha256 mismatch for the OSD-575 CMP file")
    title = None
    try:
        m = requests.get(META_URL, headers=UA, timeout=60).json()
        studies = m.get("study") or {}
        st = next(iter(studies.values()))
        title = st["studies"][0]["title"]
    except Exception as e:  # the title is cosmetic; the data come from the verified file
        log_status("OSDR meta OSD-575", "failed", f"title lookup {type(e).__name__}: {e}")
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
    bil = [r for r in rows if r["ANALYTE"] == "BILIRUBIN; TOTAL"]
    src = f"NASA OSDR OSD-575, {CMP_FILE}"
    variables = []
    for crew in sorted({r["SUBJECT_ID"] for r in bil}):
        by_tp = {r["timepoint"]: r for r in bil if r["SUBJECT_ID"] == crew}
        points = []
        for tp in TIMEPOINTS + sorted(set(by_tp) - set(TIMEPOINTS)):
            if tp not in by_tp:
                continue
            r = by_tp[tp]
            rng = f"reference range {r['RANGE_MIN']}-{r['RANGE_MAX']} {r['UNITS']} (as released)"
            try:
                val = float(r["VALUE"])
                v = vo(val, r["UNITS"], src, "recorded", "VERIFIED", None,
                       f"{rng}; collection date not released (timepoint is days from launch L- or return R+)")
            except ValueError:
                v = vo(None, r["UNITS"], src, "recorded", "NOT_STATED", None, f"value '{r['VALUE']}' in source; {rng}")
            points.append({"timepoint": tp, "value": v})
        variables.append({"name": f"Total bilirubin, crew {crew}", "unit": "mg/dL", "points": points})
    n_num = sum(1 for v in variables for p in v["points"] if p["value"]["value"] is not None)
    obj = {
        "meta": meta(False, [src, STUDY_URL], licence=OSDR_TERMS, accessed=now_iso(), file_sha256=CMP_SHA256,
                     i4_studies_on_osdr=I4_STUDIES,
                     note="Inspiration4 (SpaceX, Sept 2021, 3 days in orbit) blood was drawn on the ground before and "
                          "after flight. Analyte 'BILIRUBIN; TOTAL' from the CMP (Quest Diagnostics; Beckman Coulter "
                          "AU5800 per the ISA assay table). Crew codes and timepoint labels are as released."),
        "datasets": [{"accession": "OSD-575", "title": title or "SpaceX Inspiration4 Blood Serum Metabolic Panel and "
                                                                "Immune/Cardiac Cytokine Arrays",
                      "url": STUDY_URL, "variables": variables}],
        "not_found": [
            "renin: not measured in any open Inspiration4 file checked (OSD-575 CMP and cytokine arrays, OSD-569 CBC, "
            "OSD-656 urine panel, OSD-571 plasma/EVP proteomics and metabolomics); only the (pro)renin receptor "
            "ATP6AP2 appears in proteomics",
            "aldosterone: not measured in the same files (appears only in GO annotation text)",
        ],
    }
    write_json(DATA / "nasa_i4.json", obj)
    log_status("data/nasa_i4.json", "done", f"OSD-575 CMP sha256 verified; total bilirubin {n_num} numeric values "
               f"for {len(variables)} crew codes; renin and aldosterone not found in open I4 data")
    return obj


def build_hrp():
    r = requests.get(HRP_URL, headers=UA, timeout=60)
    r.raise_for_status()
    page = r.text
    i = page.find("Explore the Five Hazards")
    if i < 0:
        raise ValueError("section 'Explore the Five Hazards of Human Spaceflight' not found")
    sec = page[i:]
    j = sec.find("Watch Videos")
    sec = sec[:j] if j > 0 else sec
    strip = lambda s: html.unescape(re.sub(r"<[^>]+>", "", s)).strip()  # noqa: E731
    items = [(strip(h), strip(p)) for h, p in re.findall(r"<h2[^>]*>(.*?)</h2>.*?<p[^>]*>(.*?)</p>", sec, flags=re.S)]
    if len(items) != 5 or {h for h, _ in items} != HRP_HEADINGS:
        raise ValueError(f"unexpected hazard list: {[h for h, _ in items]}")
    src = f"{HRP_URL} (section 'Explore the Five Hazards of Human Spaceflight', accessed {now_iso()[:10]})"
    risks = []
    try:
        rp = requests.get(RISKS_URL, headers=UA, timeout=60)
        rp.raise_for_status()
        heads = [(m.end(), strip(m.group(1))) for m in re.finditer(r"<h[2-4][^>]*>(.*?)</h[2-4]>", rp.text, flags=re.S)]
        for end, h in heads:
            if h in RISKS_WANTED:
                pm = re.search(r"<p[^>]*>(.*?)</p>", rp.text[end:end + 6000], flags=re.S)
                if pm:
                    risks.append({"heading": h, "text": strip(pm.group(1)),
                                  "source": f"{RISKS_URL} (accessed {now_iso()[:10]})"})
    except Exception as e:
        log_status("NASA HRP risks page", "failed", f"{type(e).__name__}: {e}")
    obj = {"meta": meta(False, [HRP_URL, RISKS_URL], note="verbatim quotes: 'heading' is the hazard or risk name and "
                                                          "'text' the sentence(s) under it, both exactly as on the page"),
           "hazards": [{"heading": h, "text": p, "source": src} for h, p in items],
           "risks": risks}
    write_json(DATA / "hrp.json", obj)
    log_status("data/hrp.json", "done", "five hazards quoted word for word from " + HRP_URL)
    return obj


def main():
    for name, fn in (("nasa_i4", build_i4), ("hrp", build_hrp)):
        try:
            fn()
            print(f"built   {name}")
        except Exception as e:
            log_status(f"data/{name}.json", "failed", f"{type(e).__name__}: {e}; fixture kept")
            print(f"FAILED  {name}: {type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
