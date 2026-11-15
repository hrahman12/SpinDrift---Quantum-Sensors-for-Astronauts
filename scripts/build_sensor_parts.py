"""Build data/sensor_parts/<id>.json: the documented parts of the four SpinDrift sensors, for the 3D sensor tabs.

Rule (from CryoLean): draw only parts whose size is documented, to scale (millimetres; nanometres for the
quantum-dot probe), with labels. Parts without a documented size or position are listed, not drawn.

Every number is a value object (server.common.vo) whose source names the page, figure or table it came from,
or is calculated from such values (tag "calculated", formula in the note). Sources are fetched from their
official locations (QuSpin, arXiv, RCSB PDB, PubChem, NCBI PMC, figshare, ams-OSRAM) and the SHA256 of every
file used is recorded. Quoted phrases are re-checked in the fetched text (PDFs through PyMuPDF): a value whose
quote is missing from a source that did load is downgraded to TO_CONFIRM. Values read off QuSpin's drawings
are pinned to the SHA256 of the drawing files they were read from on 2026-11-15. QuSpin's Gen-3.0 3D mock-up
(STL) is used for measurements only; its mesh is not copied into SpinDrift.

    python scripts/build_sensor_parts.py            # uses the download cache (SPINDRIFT_CACHE/sensor-parts)
    python scripts/build_sensor_parts.py --refresh  # downloads every source again
"""
from __future__ import annotations

import argparse
import hashlib
import html as htmllib
import json
import math
import os
import re
import struct
import sys
import unicodedata
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.common import DATA, calc, meta, missing, vo, write_json  # noqa: E402

try:  # PyMuPDF (requirements.txt: pymupdf)
    import pymupdf
except ImportError:  # older installs expose the same API as fitz
    import fitz as pymupdf  # type: ignore

OUT = DATA / "sensor_parts"
CACHE = Path(os.environ.get("SPINDRIFT_CACHE", Path.home() / ".spindrift_cache")) / "sensor-parts"
UA = {"User-Agent": "SpinDrift-build/1.0 (data build script)"}
READ_ON = "2026-11-15"   # the day the values below were read from the sources

# ---------------------------------------------------------------------------------------------------- sources
DRIVE_ID = "1tjZzhkYcjyAdH-u13VSJVo4PDJy0ZyOW"
SOURCES = {
    "qs_prod": ("https://quspin.com/products-qzfm/", "html", "products-qzfm.html",
                "QuSpin QZFM Gen-3 product page, https://quspin.com/products-qzfm/", None),
    "qs_dims": ("https://quspin.com/qzfm-dimensions/", "html", "qzfm-dimensions.html",
                "QuSpin 'QZFM Dimensions' page, https://quspin.com/qzfm-dimensions/", None),
    "qs_draw3": ("https://quspin.com/images/guides/qzfm-dimensions/Gen-3-mockup-Dec2022.jpg", "bin",
                 "Gen-3-mockup-Dec2022.jpg",
                 "QuSpin Gen-3.0 QZFM dimensioned drawing ('Updated December 6th, 2022'; 'FOR REFERENCE ONLY, UNITS: "
                 "mm'), https://quspin.com/images/guides/qzfm-dimensions/Gen-3-mockup-Dec2022.jpg, linked from "
                 "https://quspin.com/qzfm-dimensions/",
                 "38aa6dd30f6c08e2dda9e7edebaaa742965fc9722a697484184627e67de69b64"),
    "qs_draw2": ("https://quspin.com/images/guides/qzfm-dimensions/Slide1.jpg", "bin", "Gen-2-Slide1.jpg",
                 "QuSpin Gen-2.0 QZFM dimensioned drawing ('Updated February 4, 2021'), "
                 "https://quspin.com/images/guides/qzfm-dimensions/Slide1.jpg, linked from "
                 "https://quspin.com/qzfm-dimensions/",
                 "c3ae9b9e8e38df3e1b8cc4dd410e05ea6f3ac651b77fb3a440a3da384b0c5c92"),
    "qs_neuro": ("https://quspin.com/images/guides/qzfm-dimensions/Gen-3-3-mockup-Feb2025_edited.png", "bin",
                 "Neuro-1.0-mockup-Feb2025.png",
                 "QuSpin Neuro-1.0 QZFM dimensioned drawing ('Updated February 12th, 2025'), "
                 "https://quspin.com/images/guides/qzfm-dimensions/Gen-3-3-mockup-Feb2025_edited.png, linked from "
                 "https://quspin.com/qzfm-dimensions/",
                 "03659f51ce13868b1655c30364f85758b7c681ed0f3d0ff2cc8deb279b7348b2"),
    "qs_stl3": (f"https://drive.usercontent.google.com/download?id={DRIVE_ID}&export=download", "bin",
                "Gen-3.0-Mockup.stl",
                f"QuSpin Gen-3.0 QZFM 3D mock-up 'Gen 3.0 Mockup.stl' (Google Drive file {DRIVE_ID}, linked as "
                "'Download the 3D file' from https://quspin.com/qzfm-dimensions/); measured here, mesh not copied",
                "2d2c03ae4fab780cc81c3ba2eb1073bac79a85f3b4ce80cbcdd69e68a624d108"),
    "qs_gen3": ("https://quspin.com/qzfm-gen-3", "html", "qzfm-gen-3.html",
                "QuSpin 'QZFM Gen-3' announcement (20 June 2021), https://quspin.com/qzfm-gen-3", None),
    "tucan": ("https://arxiv.org/pdf/2408.02941v3", "pdf", "arxiv-2408.02941v3.pdf",
              "Zhao, Mammei & Fujimoto, 'QuSpin Zero-Field Magnetometer Characterization for the TUCAN Experiment', "
              "arXiv 2408.02941v3 (2024)", None),
    "nv": ("https://arxiv.org/pdf/2601.18843v1", "pdf", "arxiv-2601.18843v1.pdf",
           "Omar et al., 'Human Cardiac Measurements with Diamond Magnetometers', arXiv 2601.18843v1 (2026), CC BY 4.0",
           None),
    "nv_ol": ("https://arxiv.org/pdf/2301.06583v1", "pdf", "arxiv-2301.06583v1.pdf",
              "Omar et al., 'Diamond-optic enhanced photon collection efficiency for sensing with nitrogen-vacancy "
              "centers', arXiv 2301.06583v1 = Optics Letters 48, 2512 (2023); ref. [22] of arXiv 2601.18843 (the JGU "
              "sensing diamond)", None),
    "nv_zulf": ("https://arxiv.org/pdf/2512.05776v3", "pdf", "arxiv-2512.05776v3.pdf",
                "Omar et al., 'Zero- to low-field J-spectroscopy with a diamond magnetometer', arXiv 2512.05776v3; "
                "ref. [20] of arXiv 2601.18843 (the JGU endoscopic sensor head, 'described in detail in [20]')", None),
    "pdb": ("https://files.rcsb.org/download/1STP.pdb", "pdb", "1STP.pdb",
            "RCSB PDB 1STP, Weber et al., 'Structural origins of high-affinity biotin binding to streptavidin', "
            "Science 243, 85 (1989); https://files.rcsb.org/download/1STP.pdb (CC0 1.0)", None),
    "cy5_3d": ("https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/17758493/JSON?record_type=3d", "json",
               "pubchem-17758493-3d.json",
               "PubChem CID 17758493 (name 'Cy5') computed 3D conformer, "
               "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/17758493/JSON?record_type=3d", None),
    "cy5_props": ("https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/17758493/property/"
                  "Title,MolecularFormula,MolecularWeight,IUPACName,HeavyAtomCount/JSON", "json",
                  "pubchem-17758493-props.json", "PubChem CID 17758493 properties (PUG REST)", None),
    "radii": ("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=3658832&retmode=xml", "xml",
              "pmc3658832.xml",
              "Mantina, Chamberlin, Valero, Cramer & Truhlar, 'Consistent van der Waals Radii for the Whole Main "
              "Group', J. Phys. Chem. A 113, 5806 (2009), PMC3658832, Table 12 (Bondi radii; H from Rowland & "
              "Taylor), fetched through NCBI E-utilities", None),
    "cqd_si": ("https://ndownloader.figshare.com/files/49568629", "pdf", "nn4c06191_si_001.pdf",
               "Tabatabaee et al., ACS Nano 18, 28012 (2024), Supporting Information nn4c06191_si_001.pdf "
               "(doi:10.1021/acsnano.4c06191.s001, figshare article 27153931, CC BY-NC 4.0)", None),
    "as7341": ("https://ams-osram.com/products/sensor-solutions/ambient-light-color-spectral-proximity-sensors/"
               "ams-as7341-11-channel-spectral-color-sensor", "html", "ams-as7341.html",
               "ams-OSRAM AS7341 product page, https://ams-osram.com/products/sensor-solutions/ambient-light-color-"
               "spectral-proximity-sensors/ams-as7341-11-channel-spectral-color-sensor", None),
}
LONG = ("Long, Zhang, Zhang & Zhang, 'Single quantum dot based nanosensor for renin assay', Anal. Chem. 84, 8846 "
        "(2012), doi:10.1021/ac302284s, PubMed 23003565 (abstract)")
CQD_PAPER = ("Tabatabaee, Naghdi, Peyravian, Kiani & Golmohammadi, 'An Invisible Dermal Nanotattoo-Based Smart "
             "Wearable Sensor for eDiagnostics of Jaundice', ACS Nano 18, 28012 (2024), doi:10.1021/acsnano.4c06191")


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    for a, b in (("×", "x"), ("✕", "x"), ("µ", "u"), ("μ", "u"), ("≈", "~"), ("∼", "~"), ("’", "'"),
                 ("‘", "'"), ("“", '"'), ("”", '"'), ("–", "-"), ("—", "-"), ("−", "-"), ("­", "")):
        s = s.replace(a, b)
    return s.lower()


def variants(text: str) -> tuple[str, ...]:
    t = norm(text)
    return (re.sub(r"\s+", " ", re.sub(r"-\s*\n\s*", "", t)),    # hyphenated line breaks joined
            re.sub(r"\s+", " ", re.sub(r"-\s*\n\s*", "-", t)),   # ... keeping the hyphen
            re.sub(r"\s+", " ", t))


class Source:
    def __init__(self, key):
        self.key = key
        self.url, self.kind, self.fname, self.title, self.pin = SOURCES[key]
        self.raw = self.sha256 = self.error = self.fetched = None
        self.pages: list[tuple[str, ...]] = []

    def load(self, refresh: bool):
        dest = CACHE / self.fname
        try:
            if refresh or not dest.exists():
                with urllib.request.urlopen(urllib.request.Request(self.url, headers=UA), timeout=180) as r:
                    body = r.read()
                dest.parent.mkdir(parents=True, exist_ok=True)
                tmp = dest.with_suffix(dest.suffix + ".part")
                tmp.write_bytes(body)
                tmp.replace(dest)
            self.raw = dest.read_bytes()
            self.sha256 = hashlib.sha256(self.raw).hexdigest()
            self.fetched = datetime.fromtimestamp(dest.stat().st_mtime, timezone.utc).replace(microsecond=0) \
                .isoformat().replace("+00:00", "Z")
            if self.kind == "pdf":
                doc = pymupdf.open(stream=self.raw, filetype="pdf")
                self.pages = [variants(p.get_text()) for p in doc]
            elif self.kind in ("html", "xml"):
                t = self.raw.decode("utf-8", "replace")
                t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", t, flags=re.S)
                self.pages = [variants(htmllib.unescape(re.sub(r"<[^>]+>", " ", t)))]
        except Exception as e:  # recorded and reported; nothing is substituted
            self.error = f"{type(e).__name__}: {e}"

    def find(self, quote: str):
        """1-based pages where the quote occurs ([1] for HTML), None if absent, 'unavailable' if not loaded.
        For HTML the raw markup is searched too, so link targets (src/href) can be checked."""
        if self.raw is None:
            return "unavailable"
        q = re.sub(r"\s+", " ", norm(quote)).strip()
        pages = [i + 1 for i, page in enumerate(self.pages) if any(q in v for v in page)]
        if pages:
            return pages
        if self.kind in ("html", "xml") and q in re.sub(r"\s+", " ", norm(self.raw.decode("utf-8", "replace"))):
            return [1]
        return None


SRC: dict[str, Source] = {}
CHECKS: list[dict] = []


def check(key: str, quote: str) -> str:
    s = SRC[key]
    res = s.find(quote)
    if res == "unavailable":
        out = "source unavailable"
    elif res is None:
        out = "not found"
    else:
        out = (f"found on PDF page{'s' if len(res) > 1 else ''} {', '.join(map(str, res))}" if s.kind == "pdf"
               else "found")
    CHECKS.append({"source": key, "quote": quote, "result": out})
    return out


def sv(value, unit, key, where, quote=None, tag="published_spec", status="VERIFIED", note=None):
    """A sourced value: the source string names the document and where in it the value is."""
    s = SRC[key]
    notes = [note] if note else []
    if quote:
        res = check(key, quote)
        if res == "not found" and status == "VERIFIED":
            status = "TO_CONFIRM"
            notes.append(f"build check: quote '{quote}' not found in the fetched source")
        elif res == "source unavailable":
            notes.append(f"build check: source not fetched ({s.error}); value as read on {READ_ON}")
    if s.pin:
        if s.sha256 is None:
            notes.append(f"build check: file not fetched ({s.error}); value as read on {READ_ON}")
        elif s.sha256 != s.pin:
            if status == "VERIFIED":
                status = "TO_CONFIRM"
            notes.append(f"build check: the file's SHA256 changed since it was read on {READ_ON}; re-read it")
    return vo(value, unit, f"{s.title}, {where}" if where else s.title, tag, status, None,
              "; ".join(notes) or None)


def c(value, unit, inputs, formula, ids, note=None):
    if isinstance(value, (float, np.floating)):
        value = round(float(value), 4)
    elif isinstance(value, np.integer):
        value = int(value)
    return calc(value, unit, inputs, formula, ids, note_extra=note)


def ns(unit, where, note=None, key=None, text=None):
    """NOT_STATED: the source does not give this value."""
    return missing(unit, f"{SRC[key].title}, {where}" if key else text, "published_spec", "NOT_STATED", note)


def dims(*pairs):
    return [{"label": label, "vo": v} for label, v in pairs if v is not None]


def sources_meta(keys, extra=None):
    used = [SRC[k] for k in keys]
    m = meta(False, [s.title for s in used] + list(extra or []),
             sha256={s.url: s.sha256 for s in used if s.sha256},
             fetched={s.url: s.fetched for s in used if s.fetched},
             fetch_errors={s.url: s.error for s in used if s.error},
             values_read_on=READ_ON)
    return m


# ---------------------------------------------------------------------------------------------------- OPM
def stl_measure(raw: bytes) -> dict:
    """Measurements of QuSpin's Gen-3.0 mock-up in its own frame (mm). Its z axis is the drawing's Z+ (towards the
    skin face), its -y face carries the raised label plate (front face), and the flex ribbon leaves the top."""
    n = struct.unpack("<I", raw[80:84])[0]
    if len(raw) != 84 + 50 * n:
        raise ValueError("not a binary STL of the expected size")
    dt = np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
    v = np.frombuffer(raw, dtype=dt, count=n, offset=84)["v"].reshape(-1, 3).astype(float)
    mid = v[(v[:, 2] > -19.0) & (v[:, 2] < 5.0)]               # straight walls, clear of top and bottom fillets
    walls = mid[mid[:, 1] >= -7.36]
    plate = v[v[:, 1] < -7.36]                                  # raised label plate on the front face
    ribbon = v[v[:, 2] < -20.5]                                 # flex ribbon above the housing
    not_ribbon = v[~((v[:, 1] > -6.96) & (v[:, 1] < -6.84) & (v[:, 2] < -20.0))]
    m = {"triangles": int(n),
         "x_min": walls[:, 0].min(), "x_max": walls[:, 0].max(), "y_min": walls[:, 1].min(), "y_max": walls[:, 1].max(),
         "z_top": not_ribbon[:, 2].min(), "z_bottom": v[:, 2].max(),
         "plate_x_min": plate[:, 0].min(), "plate_x_max": plate[:, 0].max(), "plate_y_min": plate[:, 1].min(),
         "plate_z_min": plate[:, 2].min(), "plate_z_max": plate[:, 2].max(),
         "rib_x_min": ribbon[:, 0].min(), "rib_x_max": ribbon[:, 0].max(), "rib_y_min": ribbon[:, 1].min(),
         "rib_y_max": ribbon[:, 1].max(), "rib_z_top": ribbon[:, 2].min()}
    return {k: (round(float(x), 4) if not isinstance(x, int) else x) for k, x in m.items()}


def build_opm():
    D3, P = "qs_draw3", "qs_prod"
    conflict_h = ("QuSpin's Gen-3.0 drawing gives 26.4 mm and its Gen-3.0 3D mock-up measures 26.37 mm (calculated "
                  "below), but the product page lists 12.4 × 16.6 × 24.4 mm. 24.40 mm is the height on QuSpin's Gen-2.0 "
                  "drawing, and QuSpin's 2021 Gen-3 announcement says the Gen-3 dimensions are the same as Gen-2. The "
                  "Gen-3.0-specific drawing value is drawn; which height applies to a given unit is to be confirmed")
    W = sv(16.6, "mm", D3, "front view, overall width '16.6'", tag="datasheet",
           note="same value on the product page (12.4 × 16.6 × 24.4 mm)")
    H = sv(26.4, "mm", D3, "front view, overall height '26.4'", tag="datasheet", status="TO_CONFIRM", note=conflict_h)
    Z = sv(12.4, "mm", D3, "side view, overall depth '12.4'", tag="datasheet",
           note="same value on the product page (12.4 × 16.6 × 24.4 mm)")
    H_prod = sv(24.4, "mm", P, "Overview and Specifications, 'Sensor head 12.4 × 16.6 × 24.4 mm'",
                quote="Sensor head 12.4 × 16.6 × 24.4 mm", tag="datasheet", status="TO_CONFIRM",
                note="conflicts with the Gen-3.0 drawing (26.4 mm); equals the Gen-2.0 drawing height (24.40 mm)")
    H_gen2 = sv(24.4, "mm", "qs_draw2", "front view, height '24.40'", tag="datasheet",
                note="Gen-2.0 sensor head, listed only to explain the product-page figure")
    gen3_same = sv("The dimensions of the Gen-3 sensor (both dual and triaxial variants) are the same as the Gen-2 sensor.",
                   "", "qs_gen3", "Gen-3 section",
                   quote="The dimensions of the Gen-3 sensor (both dual and triaxial variants) are the same as the Gen-2 sensor",
                   tag="datasheet")
    dims_page = sv("QuSpin's dimensions page links the Gen-3.0 drawing and 3D file used here", "", "qs_dims",
                   "'Gen-3.0 QZFM dimensions' section", quote="Gen-3.0 QZFM dimensions", tag="datasheet")
    for token in ("Gen-3-mockup-Dec2022.jpg", DRIVE_ID):
        check("qs_dims", token)

    # vapour cell: centre position from the Gen-3.0 drawing, size from Zhao et al. (TUCAN)
    from_left = sv(6.25, "mm", D3, "front view, cell centre to the left side '6.25' (CENTER OF CELL)", tag="datasheet",
                   note="QuSpin's Neuro-1.0 drawing (12 Feb 2025) repeats (6.25) as a reference dimension")
    from_bottom = sv(6.20, "mm", D3, "front view, cell centre above the bottom (skin) face '6.20'", tag="datasheet",
                     status="TO_CONFIRM",
                     note="the product page says '6.5 mm from vapor-cell center to housing' (6.50 on the Gen-2.0 "
                          "drawing); the Gen-3.0 drawing and QuSpin's Neuro-1.0 drawing give 6.20")
    from_front = sv(5.15, "mm", D3, "side view, cell centre behind the front (label) face '5.15'", tag="datasheet",
                    note="QuSpin's Neuro-1.0 drawing repeats (5.15)")
    neuro = sv("cell centre (6.25) from the left side, (6.20) above the bottom face, (5.15) behind the front face", "",
               "qs_neuro", "front and side views, reference dimensions in parentheses", tag="datasheet",
               note="QuSpin's later Neuro-1.0 head (41.5 mm tall, different housing) keeps the Gen-3.0 cell offsets")
    standoff_prod = sv(6.5, "mm", P, "Specifications, 'Standoff 6.5 mm from vapor-cell center to housing'",
                       quote="6.5 mm from vapor-cell center to housing", tag="datasheet", status="TO_CONFIRM",
                       note="conflicts with the Gen-3.0 drawing (6.20 mm above the bottom face); equals the Gen-2.0 "
                            "drawing value (6.50)")
    cell_edge = sv(3.0, "mm", "tucan", "p. 3: 'Internal optics reflects the light into a 3 × 3 × 3 mm cell containing "
                   "87Rb vapor'", quote="Internal optics reflects the light into a 3 × 3 × 3 mm cell", status="TO_CONFIRM",
                   note="QuSpin does not state the Gen-3 cell size; Zhao et al. characterise two '3rd generation "
                        "tri-axial' QZFMs (p. 2) but cite this sentence to Shah et al., SPIE 2018 (the original QZFM). "
                        "Inner or outer size not stated; cell orientation not stated (drawn axis-aligned)")
    gen3_tucan = sv("two 3rd generation tri-axial QZFMs characterised", "", "tucan", "p. 2",
                    quote="two 3rd generation tri-axial QuSpin Zero-Field", tag="published_spec")
    laser_nm = sv(795, "nm", "tucan", "p. 3: 'a circularly polarized 795 nm laser resonant with the D1 transition'",
                  quote="circularly polarized 795 nm laser")

    # flex ribbon cable: width and thickness from the drawing, length on drawing and product page
    rib_w = sv(6.5, "mm", D3, "front view, ribbon width '6.5'", tag="datasheet")
    rib_t = sv(0.20, "mm", D3, "label 'FLEX RIBBON CABLE 2 FT LENGTH 0.20mm THICK'", tag="datasheet")
    rib_ft = sv(2, "ft", D3, "label 'FLEX RIBBON CABLE 2 FT LENGTH'", tag="datasheet",
                note="product page: '2 ft flexible FPC at the sensor end, then 6.5 m round cable'")
    check(P, "2 ft flexible FPC at the sensor end, then 6.5 m round cable")
    rib_len = c(2 * 304.8, "mm", [rib_ft], "length = 2 ft × 304.8 mm/ft", ["flex ribbon length (ft)"])

    # 3D mock-up measurements (calculated from the official file; mesh not copied)
    stl = SRC["qs_stl3"]
    m = None
    if stl.raw is not None:
        try:
            m = stl_measure(stl.raw)
        except Exception as e:
            stl.error = f"measurement failed: {type(e).__name__}: {e}"
    stl_in = sv("QuSpin Gen-3.0 3D mock-up", "", "qs_stl3", None, tag="datasheet")

    def g(k):
        return None if m is None else m[k]

    def sub(a, b):
        return None if a is None or b is None else a - b

    mw = c(sub(g("x_max"), g("x_min")), "mm", [stl_in], "x_max − x_min of the mock-up's straight walls", ["mock-up"])
    mz = c(sub(g("y_max"), g("y_min")), "mm", [stl_in], "y_max − y_min of the walls (front face to back face)", ["mock-up"])
    mh = c(sub(g("z_bottom"), g("z_top")), "mm", [stl_in], "bottom face z − top z (excluding the ribbon)", ["mock-up"])
    plate_w = c(sub(g("plate_x_max"), g("plate_x_min")), "mm", [stl_in], "x extent of the raised label plate", ["mock-up"])
    plate_h = c(sub(g("plate_z_max"), g("plate_z_min")), "mm", [stl_in], "vertical extent of the label plate", ["mock-up"])
    plate_t = c(sub(g("y_min"), g("plate_y_min")), "mm", [stl_in], "front face y − plate outer y", ["mock-up"])
    plate_top = c(sub(g("plate_z_min"), g("z_top")), "mm", [stl_in], "housing top to the plate's upper edge", ["mock-up"])
    rib_draw = c(sub(g("z_top"), g("rib_z_top")), "mm", [stl_in],
                 "housing top − top of the ribbon stub in the mock-up (the length QuSpin's own model shows)", ["mock-up"])
    rib_mid = None if m is None else (m["rib_x_min"] + m["rib_x_max"]) / 2
    house_mid = None if m is None else (m["x_min"] + m["x_max"]) / 2
    rib_off = c(sub(rib_mid, house_mid), "mm", [stl_in], "ribbon centre x − housing centre x in the mock-up frame",
                ["mock-up"], "+x of the mock-up is the left side of the drawing's front view (the ribbon sits left of "
                "centre in that view, and the mock-up's front face is its −y face)")
    rib_inset = c(None if m is None else (m["rib_y_min"] + m["rib_y_max"]) / 2 - m["y_min"], "mm", [stl_in],
                  "ribbon mid-plane y − front face y (how far behind the front face the ribbon runs)", ["mock-up"],
                  "the mock-up models the ribbon 0.10 mm thick; the drawing's 0.20 mm is drawn on the same mid-plane")

    # scene frame: origin at the housing centre, +y up (skin face at −H/2), +z out of the front face, +x to the right
    # when looking at the front face (so the drawing's 'left side' is at x = −W/2)
    cx = c(-W["value"] / 2 + from_left["value"], "mm", [W, from_left], "x = −W/2 + 6.25", ["housing width", "cell from left"])
    cy = c(-H["value"] / 2 + from_bottom["value"], "mm", [H, from_bottom], "y = −H/2 + 6.20",
           ["housing height", "cell above bottom face"])
    cz = c(Z["value"] / 2 - from_front["value"], "mm", [Z, from_front], "z = D/2 − 5.15", ["housing depth", "cell behind front"])
    py = c(None if plate_top["value"] is None or plate_h["value"] is None else
           H["value"] / 2 - plate_top["value"] - plate_h["value"] / 2, "mm", [H, plate_top, plate_h],
           "y = H/2 − (top to plate) − plate height/2", ["housing height", "plate offset", "plate height"])
    pz = c(None if plate_t["value"] is None else Z["value"] / 2 + plate_t["value"] / 2, "mm", [Z, plate_t],
           "z = D/2 + plate thickness/2", ["housing depth", "plate thickness"])
    rx = c(None if rib_off["value"] is None else -rib_off["value"], "mm", [rib_off],
           "x = −(mock-up offset): the mock-up's +x is the scene's −x", ["ribbon offset"])
    rz = c(None if rib_inset["value"] is None else Z["value"] / 2 - rib_inset["value"], "mm", [Z, rib_inset],
           "z = D/2 − ribbon inset", ["housing depth", "ribbon inset"])
    ry0 = c(H["value"] / 2, "mm", [H], "ribbon starts at the top face, y = H/2", ["housing height"])

    comps = {
        "housing": {
            "name": "Sensor-head housing", "drawn": True, "shape": "box",
            "size": {"x": W, "y": H, "z": Z}, "centre": None,
            "dims": dims(("width (x)", W), ("height (y)", H), ("depth (z)", Z), ("height on product page", H_prod),
                         ("width, 3D mock-up", mw), ("height, 3D mock-up", mh), ("depth, 3D mock-up", mz)),
            "note": "Outer envelope of the Gen-3.0 head. QuSpin's 3D mock-up has rounded edges whose radii are not "
                    "dimensioned, so the box is drawn with square edges.",
        },
        "label_plate": {
            "name": "Raised label plate (front face)", "drawn": m is not None, "shape": "box",
            "size": {"x": plate_w, "y": plate_h, "z": plate_t},
            "centre": {"x": vo(0, "mm", stl_in["source"], "calculated", "VERIFIED", None,
                               "formula: plate x-centre − housing x-centre in the mock-up (|Δ| < 0.001 mm); inputs: mock-up"),
                       "y": py, "z": pz},
            "dims": dims(("width", plate_w), ("height", plate_h), ("thickness", plate_t), ("below top face", plate_top)),
            "note": "The plate marks the front face, the face the drawing's 5.15 mm cell offset is measured from.",
        },
        "cable": {
            "name": "Flex ribbon cable", "drawn": m is not None, "shape": "ribbon",
            "size": {"x": rib_w, "z": rib_t, "length": rib_len, "drawn_length": rib_draw},
            "centre": {"x": rx, "z": rz, "y_start": ry0},
            "dims": dims(("width", rib_w), ("thickness", rib_t), ("full length", rib_len), ("drawn length", rib_draw)),
            "note": "Drawn cut at the length shown in QuSpin's own 3D mock-up; the full ribbon is 2 ft (609.6 mm), "
                    "then a 6.5 m round cable.",
        },
        "cell": {
            "name": "Rubidium vapour cell", "drawn": True, "shape": "box", "optical": "opm",
            "size": {"x": cell_edge, "y": cell_edge, "z": cell_edge},
            "centre": {"x": cx, "y": cy, "z": cz},
            "dims": dims(("edge", cell_edge), ("centre from left side", from_left),
                         ("centre above skin face", from_bottom), ("centre behind front face", from_front),
                         ("product-page standoff", standoff_prod)),
            "note": "Centre from QuSpin's Gen-3.0 drawing ('CENTER OF CELL'). Size 3 × 3 × 3 mm from Zhao et al. "
                    "(TUCAN), who cite the original QZFM paper; QuSpin does not publish the Gen-3 cell size (to "
                    "confirm). Colour: rubidium D1 795 nm from data/palette.json.",
        },
    }
    undocumented = [
        {"name": "Laser", "reason": "a semiconductor laser (795 nm per Zhao et al., p. 3) pumps the cell; its size and "
                                    "position in the head are not published"},
        {"name": "Photodetector", "reason": "named on QuSpin's technology page; size and position not published"},
        {"name": "Internal optics (prisms; beam splitter in the triaxial variant)",
         "reason": "mentioned by Zhao et al. (p. 3) and QuSpin; no sizes or positions published"},
        {"name": "Three-axis field-nulling and modulation coils",
         "reason": "the product page states 'internal field-nulling coils'; no dimensions published"},
        {"name": "Cell heater", "reason": "QuSpin states the cell runs at about 150 °C; heater size and position not "
                                          "published"},
        {"name": "Head electronics (circuit board)", "reason": "not described by QuSpin"},
        {"name": "Round cable", "reason": "length 6.5 m (spec table; '20 ft' in the package list); diameter not stated"},
        {"name": "Electronics unit", "reason": "3.1 × 11.0 × 16.5 cm (product page) but it sits at the far end of the "
                                               "cable; its placement relative to the head is not documented, so it is not "
                                               "drawn with the head"},
    ]
    check(P, "Electronics dimensions 3.1 × 11.0 × 16.5 cm")
    check(P, "internal field-nulling coils")
    out = {
        "meta": sources_meta(["qs_draw3", "qs_stl3", "qs_dims", "qs_prod", "qs_draw2", "qs_neuro", "qs_gen3", "tucan"]),
        "id": "opm", "title": "QuSpin QZFM Gen-3", "unit": "mm",
        "frame": "Millimetres. Origin at the housing centre; +y up along the long axis (cable end up, skin face down at "
                 "y = −H/2); +z out of the front face (the face with the label plate); +x to the right when looking at "
                 "the front face, so the drawing's 'left side' is at x = −W/2. QuSpin's drawing axis Z+ points down, "
                 "towards the skin face.",
        "components": comps,
        "conflicts": [
            {"item": "housing height", "drawn": H, "other": [H_prod, H_gen2, gen3_same]},
            {"item": "cell centre above the skin face", "drawn": from_bottom, "other": [standoff_prod, neuro]},
        ],
        "info": {"laser_wavelength": laser_nm, "generation_note": gen3_tucan, "dimensions_page": dims_page},
        "stl_measurements_mm": m,
        "undocumented": undocumented,
    }
    return out


# ---------------------------------------------------------------------------------------------------- NV
def build_nv():
    N, OL, ZU = "nv", "nv_ol", "nv_zulf"
    base = sv(0.5, "mm", N, "p. 4: 'a truncated pyramid with 0.18 mm height and a 0.5 mm x 0.5 mm base'; Table 2 (p. 15)",
              quote="truncated pyramid with 0.18 mm height and a 0.5 mm x 0.5 mm base")
    height = sv(0.18, "mm", N, "p. 4 (same sentence); Table 2 (p. 15): '0.5 × 0.5 × 0.18 mm3'",
                quote="0.5 × 0.5 × 0.18 mm3")
    top = sv(0.15, "mm", OL, "p. 2: 'the upper square surface being 0.15 mm on the side'",
             quote="the upper square surface being 0.15 mm on the side",
             note="same paper, p. 2: back surface 0.5 mm square, height 0.18 mm; base angle close to 45°")
    check(OL, "back surface being a square 0.5 mm on the side, a height of 0.18 mm")
    head_d = sv(12, "mm", N, "p. 14: 'aluminum housing (sensor head diameter: 12 mm)'; Fig. 1 a.1 and Fig. 2c ('12 mm')",
                quote="sensor head diameter: 12 mm")
    pcb_t = sv(0.150, "mm", ZU, "Appendix A, p. 9: 'The flexible PCB for the MW delivery has a thickness of ≈150 µm'",
               quote="has a thickness of ≈150 µm", note="approximate value as stated (≈)")
    protr = sv(0.100, "mm", ZU, "Appendix A, p. 9: 'a center hole for the sensing diamond to stick out by approximately "
               "≈100 µm'", quote="center hole for the sensing diamond to stick out by approximately ≈100 µm",
               note="approximate value as stated (≈)")
    beam = sv(0.300, "mm", ZU, "Section II C, p. 4: 'producing a beam of 300 µm in diameter'",
              quote="producing a beam of 300 µm in diameter")
    standoff_j = sv(1, "cm", N, "p. 4: 'positioned approximately 1 cm away from a seated subject's chest'",
                    quote="positioned approximately 1 cm away from a seated subject")
    standoff_z = sv(1, "cm", N, "p. 6: 'the subject was sitting ∼1 cm away from the sensor head'",
                    quote="sitting ∼1 cm away from the sensor head")
    z_ = vo(0, "mm", "frame definition", "calculated", "VERIFIED", None,
            "formula: on the head axis (Fig. 2c of arXiv 2601.18843; Fig. 1 a.1 photo); inputs: frame")
    zc_base = c(-height["value"] / 2, "mm", [height], "z = −h/2 (envelope centred at the origin)", ["diamond height"])
    zc_top = c(height["value"] / 2, "mm", [height], "z = +h/2", ["diamond height"])
    face_z = c(height["value"] / 2 - protr["value"], "mm", [height, protr],
               "z = top face − protrusion (the PCB front surface; the PCB covers the head's front face, Fig. 1 a.1)",
               ["diamond height", "diamond protrusion"])
    jgu = {
        "title": "JGU Mainz: zero-field fibre-coupled endoscope head",
        "components": {
            "diamond": {
                "name": "Sensing diamond (NV)", "drawn": True, "shape": "truncated_square_pyramid", "optical": "nv",
                "size": {"base": base, "top": top, "height": height},
                "centre": {"x": z_, "y": z_, "z_base": zc_base, "z_top": zc_top},
                "dims": dims(("base edge", base), ("top edge", top), ("height", height)),
                "note": "Base (0.5 mm square) at the back, glued to the diamond anvil; the 0.15 mm top faces the subject "
                        "(+z). Colour: NV fluorescence band edge 695 nm from data/palette.json.",
            },
            "head_face": {
                "name": "Aluminium head, front face", "drawn": True, "shape": "disc",
                "size": {"diameter": head_d}, "centre": {"x": z_, "y": z_, "z": face_z},
                "dims": dims(("diameter", head_d), ("microwave flex-PCB thickness", pcb_t),
                             ("diamond protrusion beyond the PCB", protr)),
                "note": "Only the 12 mm diameter of the head is published, not its length, so the head is drawn as its "
                        "front-face outline, in the plane of the microwave flex-PCB the diamond sticks out of.",
            },
        },
        "info": {"standoff_mcg": standoff_j, "pump_beam_diameter": beam,
                 "sensitivity": sv(13, "pT/√Hz", N, "Table 2 (p. 15)", quote="13 pT/")},
        "undocumented": [
            {"name": "Diamond anvil (Dutch Diamond Technologies)",
             "reason": "cone-shaped; Fig. 1a of arXiv 2301.06583 gives one length (2.5 mm) and its Fig. 2 a 45° opening "
                       "angle, but not its diameter, tip or back-surface curvature"},
            {"name": "Polycrystalline diamond plate (Medidia Tec)", "reason": "size not stated (arXiv 2512.05776, p. 9)"},
            {"name": "Aluminium housing body", "reason": "only the 12 mm diameter is published; the length is not"},
            {"name": "Microwave flex-PCB outline", "reason": "only its ≈150 µm thickness and the ≈100 µm diamond "
                                                             "protrusion are published"},
            {"name": "Modulation field coil", "reason": "visible in Fig. 1 a.1; size not stated"},
            {"name": "Lens, dichroic mirror, polarizing beam splitter, beam sampler",
             "reason": "named in Fig. 2c and arXiv 2512.05776; sizes and positions not stated"},
            {"name": "Photodiodes (Hamamatsu S13228-01) on their circuit board",
             "reason": "part number in arXiv 2512.05776 (p. 4); positions in the head not stated"},
            {"name": "Fibre output coupler, titanium fibre holder, aluminium optics-holder rod",
             "reason": "named in arXiv 2512.05776 (pp. 4, 9); sizes not stated"},
            {"name": "High-power single-mode fibre (OZ Optics HPUCO-TA3AHPC-532-P-11AS)",
             "reason": "part number stated; routing and length not stated"},
            {"name": "Pump beam (300 µm)", "reason": "diameter stated, path length to the diamond not stated"},
        ],
    }
    zq_d = sv(0.5, "mm", N, "Table 2 (p. 15): '0.5 × 0.5 × 0.5 mm3' (w × l × h); p. 14: 'a pyramidal diamond mounted on "
              "a compound parabolic concentrator (CPC)'", quote="0.5 × 0.5 × 0.5 mm3")
    check(N, "pyramidal diamond mounted on a compound parabolic concentrator")
    zaquant = {
        "title": "ZAQuant Stuttgart: bias-field head with compound parabolic concentrator",
        "components": {
            "diamond": {
                "name": "Sensing diamond (NV), w × l × h envelope", "drawn": True, "shape": "envelope_box", "optical": "nv",
                "size": {"x": zq_d, "y": zq_d, "z": zq_d}, "centre": {"x": z_, "y": z_, "z": z_},
                "dims": dims(("width", zq_d), ("length", zq_d), ("height", zq_d)),
                "note": "'Pyramidal' (p. 14); whether the apex is truncated is not stated, so the documented "
                        "w × l × h envelope (Table 2) is drawn, translucent.",
            },
        },
        "info": {"standoff_mcg": standoff_z,
                 "gradiometer_baseline": sv(78, "mm", N, "p. 8: 'two NV sensor heads separated by 78 mm'; Fig. 3a inset",
                                            quote="two NV sensor heads separated by 78 mm"),
                 "bias_field": sv(1, "mT", N, "p. 15: 'A static magnetic field of approximately 1 mT was applied by a "
                                  "permanent magnet'", quote="A static magnetic field of approximately 1 mT was applied by a"),
                 "longpass_filter": sv(695, "nm", N, "p. 15: '695 nm long-pass filter'", quote="695 nm long-pass filter"),
                 "sensitivity": sv(7, "pT/√Hz", N, "Table 2 (p. 15)", quote="7 pT/")},
        "undocumented": [
            {"name": "Compound parabolic concentrator (CPC)", "reason": "named (p. 14); size not stated"},
            {"name": "Glass rod", "reason": "named (p. 14); size not stated"},
            {"name": "Dichroic cube, 695 nm long-pass filter, balanced photodetectors",
             "reason": "named (pp. 14–15); sizes and positions not stated"},
            {"name": "Permanent magnet (≈1 mT)", "reason": "field stated, size and position not stated"},
            {"name": "Loop antenna", "reason": "named (p. 15); size not stated"},
            {"name": "Sensor-head housing", "reason": "size not stated (Fig. 1 b.1 is an unscaled rendering)"},
        ],
    }
    qa_xy = sv(1.0, "mm", N, "p. 14: 'a diamond (1 mm × 1 mm × 500 µm) with a truncated pyramid geometry'; Table 2 "
               "(p. 15) '1 × 1 × 0.5 mm3'", quote="1 mm × 1 mm × 500 µm) with a truncated pyramid geometry")
    qa_h = sv(0.5, "mm", N, "p. 14 (same sentence); Table 2 (p. 15)", quote="1 × 1 × 0.5 mm3")
    qant = {
        "title": "Q.ANT Stuttgart: unshielded bias-field head",
        "components": {
            "diamond": {
                "name": "Sensing diamond (NV), w × l × h envelope", "drawn": True, "shape": "envelope_box", "optical": "nv",
                "size": {"x": qa_xy, "y": qa_xy, "z": qa_h}, "centre": {"x": z_, "y": z_, "z": z_},
                "dims": dims(("width", qa_xy), ("length", qa_xy), ("height", qa_h)),
                "note": "A truncated pyramid (p. 14) whose top face is not stated, so the documented w × l × h envelope "
                        "is drawn, translucent. About 1.7 ppm NV⁻ (EPR).",
            },
        },
        "info": {"head_volume": sv(1, "dm³", N, "p. 14: 'a sensor head volume of 1 dm3'", quote="a sensor head volume of 1 dm3"),
                 "bias_field": sv(1, "mT", N, "p. 14: 'a bias field of approximately 1 mT was applied via a in-house "
                                  "fabricated Halbach ring'", quote="fabricated Halbach ring"),
                 "sensitivity": sv(26, "pT/√Hz", N, "Table 2 (p. 15)", quote="26 pT/")},
        "undocumented": [
            {"name": "Sensor head (1 dm³)", "reason": "only its volume is stated; a volume does not fix a shape"},
            {"name": "Halbach ring (≈1 mT)", "reason": "field stated, size not stated"},
            {"name": "Fibre-coupled Coherent OBIS laser (100 mW at the fibre)", "reason": "no geometry stated"},
            {"name": "Low-noise balanced photodiode board, collection optics (≈40 % efficiency)",
             "reason": "sizes and positions not stated"},
            {"name": "FPGA controller with USB-C", "reason": "no geometry stated"},
        ],
    }
    out = {
        "meta": sources_meta(["nv", "nv_ol", "nv_zulf"]),
        "id": "nv", "title": "NV-diamond magnetometers of Omar et al. (arXiv 2601.18843)", "unit": "mm",
        "frame": "Millimetres. Origin at the centre of the diamond's documented envelope; +z points towards the subject "
                 "(the sensing direction), +y up.",
        "headline": {"sensing_volume": sv("<0.5", "mm³", N, "abstract (p. 2): 'active sensing volumes below 0.5 mm3'",
                                          quote="active sensing volumes below 0.5 mm3")},
        "builds": {"jgu": jgu, "zaquant": zaquant, "qant": qant},
    }
    return out


# ---------------------------------------------------------------------------------------------------- QD probe
def parse_pdb(text: str):
    atoms, btn, biomt, info = [], [], {}, {"resolution_A": None, "seqres_len": None}
    for line in text.splitlines():
        rec = line[:6]
        if rec in ("ATOM  ", "HETATM") and line[16] in (" ", "A"):
            name, resn, resi = line[12:16].strip(), line[17:20].strip(), int(line[22:26])
            x, y, z = float(line[30:38]), float(line[38:46]), float(line[46:54])
            el = (line[76:78].strip() or re.sub(r"[^A-Z]", "", name)[:1]).capitalize()
            if rec == "ATOM  ":
                atoms.append([el, round(x, 3), round(y, 3), round(z, 3), resn, resi, name])
            elif resn == "BTN":
                btn.append([el, round(x, 3), round(y, 3), round(z, 3), name])
        elif line.startswith("REMARK 350   BIOMT"):
            p = line.split()
            biomt.setdefault(int(p[3]), [None, None, None])[int(p[2][-1]) - 1] = [float(t) for t in p[4:8]]
        elif line.startswith("REMARK   2 RESOLUTION."):
            info["resolution_A"] = float(line.split("RESOLUTION.")[1].split()[0])
        elif rec == "SEQRES" and info["seqres_len"] is None:
            info["seqres_len"] = int(line[13:17])
        elif rec == "ENDMDL":
            break
    return atoms, btn, [biomt[k] for k in sorted(biomt)], info


def apply_op(op, xyz):
    r = np.array([row[:3] for row in op])
    t = np.array([row[3] for row in op])
    return xyz @ r.T + t


def parse_table12(src: Source) -> dict:
    t = src.raw.decode("utf-8", "replace")
    for blk in re.findall(r"<table-wrap[^>]*>.*?</table-wrap>", t, flags=re.S):
        s = re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", blk)))
        if "TABLE 12" in s.upper() and "Consistent van der Waals Radii" in s:
            return {el: float(v) for el, v in re.findall(r"\b([A-Z][a-z]?) (\d\.\d\d)\b", s)}
    raise ValueError("Table 12 not found")


def build_qd():
    pdb, s3, sp, rad = SRC["pdb"], SRC["cy5_3d"], SRC["cy5_props"], SRC["radii"]
    radii, radii_vo = {}, {}
    try:
        table = parse_table12(rad)
    except Exception as e:
        table, rad.error = {}, rad.error or f"{type(e).__name__}: {e}"
    for el in ("H", "C", "N", "O", "S"):
        val = table.get(el)
        origin = "Rowland & Taylor" if el == "H" else "Bondi"
        radii_vo[el] = (vo(val, "Å", f"{rad.title}; value from {origin}", "published_spec", "VERIFIED", None, None)
                        if val is not None else missing("Å", rad.title, "published_spec", "NOT_YET_EXTRACTED",
                                                         f"Table 12 not parsed: {rad.error}"))
        radii[el] = val

    atoms, btn, ops, info = parse_pdb(pdb.raw.decode("latin-1")) if pdb.raw else ([], [], [], {})
    res_vo = (sv(info["resolution_A"], "Å", "pdb", "REMARK 2 RESOLUTION") if info.get("resolution_A") else None)
    strep = {"au_atoms": len(atoms), "biomt_operators": len(ops)}
    comps, extents = {}, {}
    if atoms and ops and all(radii.values()):
        xyz = np.array([[a[1], a[2], a[3]] for a in atoms])
        r_at = np.array([radii[a[0]] for a in atoms])  # KeyError if an element has no radius
        bxyz = np.array([[a[1], a[2], a[3]] for a in btn])
        r_bt = np.array([radii[a[0]] for a in btn])
        tet = np.vstack([apply_op(op, xyz) for op in ops])
        tet_r = np.tile(r_at, len(ops))
        bio = np.vstack([apply_op(op, bxyz) for op in ops])
        bio_r = np.tile(r_bt, len(ops))
        centroid = tet.mean(axis=0)
        lo = (tet - tet_r[:, None]).min(0)          # protein atoms only (the biotins are their own component)
        hi = (tet + tet_r[:, None]).max(0)
        R_strep = max(float(np.max(np.linalg.norm(tet, axis=1) + tet_r)), float(np.max(np.linalg.norm(bio, axis=1) + bio_r)))
        extents = {"x": (hi[0] - lo[0]) / 10, "y": (hi[1] - lo[1]) / 10, "z": (hi[2] - lo[2]) / 10}
        strep.update({"centroid_A": [round(float(v), 4) for v in centroid], "radius_nm": round(R_strep / 10, 4)})
    pdb_in = sv("1STP coordinates, BIOMT operators", "", "pdb", "ATOM, HETATM BTN and REMARK 350 records")
    rad_in = [radii_vo[e] for e in radii_vo]

    def ext(axis):
        return c(extents.get(axis), "nm", [pdb_in] + rad_in,
                 f"{axis}-extent of the protein tetramer (BIOMT 1–4 applied to chain A), atom centres ± van der Waals "
                 "radius, Å ÷ 10", ["1STP", "vdW radii"])

    resolved = [min(a[5] for a in atoms), max(a[5] for a in atoms)] if atoms else None
    comps["streptavidin"] = {
        "name": "Streptavidin tetramer (QD coating)", "drawn": bool(atoms and ops), "shape": "atoms",
        "dims": dims(("extent x", ext("x")), ("extent y", ext("y")), ("extent z", ext("z")),
                     ("X-ray resolution", res_vo)),
        "note": f"PDB 1STP (2.6 Å X-ray, CC0): chain A residues {resolved[0]}–{resolved[1]} of {info.get('seqres_len')} "
                f"as deposited, made into the tetramer with the file's four BIOMT operators. Heavy atoms only (an X-ray "
                f"structure has no hydrogen positions), van der Waals spheres in CPK colours. The abstract of Long et al. "
                f"names a streptavidin-coated QD; how many streptavidins coat one dot is not stated."
        if atoms else "PDB 1STP could not be loaded",
    }
    comps["biotin"] = {
        "name": "Biotin (as bound in 1STP, one per subunit)", "drawn": bool(btn and ops), "shape": "atoms",
        "dims": dims(("atoms per biotin", c(len(btn) or None, "atoms", [pdb_in], "count of HETATM BTN records", ["1STP"]))),
        "note": "The biotin end of the probe's biotinylated peptide binds here. Shown as deposited: free biotin in the "
                "binding pocket, not the peptide-linked form.",
    }

    # Cy5 (PubChem 3D conformer)
    cy5 = None
    if s3.raw and sp.raw:
        rec = json.loads(s3.raw)["PC_Compounds"][0]
        props = json.loads(sp.raw)["PropertyTable"]["Properties"][0]
        conf = rec["coords"][0]["conformers"][0]
        Z = {1: "H", 6: "C", 7: "N", 8: "O", 16: "S"}
        aid = rec["atoms"]["aid"]
        els = [Z.get(z, str(z)) for z in rec["atoms"]["element"]]
        at = [[els[i], round(conf["x"][i], 4), round(conf["y"][i], 4), round(conf["z"][i], 4)] for i in range(len(aid))]
        idx = {a: i for i, a in enumerate(aid)}
        b = rec["bonds"]
        bonds = [[idx[a1], idx[a2], o] for a1, a2, o in zip(b["aid1"], b["aid2"], b["order"])]
        cxyz = np.array([[a[1], a[2], a[3]] for a in at])
        cen = cxyz.mean(0)
        cr = np.array([radii[a[0]] for a in at]) if all(radii.values()) else None
        R_cy5 = float(np.max(np.linalg.norm(cxyz - cen, axis=1) + cr)) if cr is not None else None
        cy5 = {"cid": 17758493, "title": props.get("Title"), "formula": props.get("MolecularFormula"),
               "molecular_weight": props.get("MolecularWeight"), "iupac_name": props.get("IUPACName"),
               "atoms": at, "atom_columns": ["element", "x_A", "y_A", "z_A"], "bonds": bonds,
               "bond_columns": ["atom_i", "atom_j", "order"], "centroid_A": [round(float(v), 4) for v in cen],
               "radius_nm": None if R_cy5 is None else round(R_cy5 / 10, 4)}
        cy5_in = sv("PubChem CID 17758493 conformer", "", "cy5_3d", None, tag="calculated",
                    note="PubChem's computed conformer (a model geometry, not a measured structure)")
        span = c(float(np.max(cxyz.max(0) - cxyz.min(0))) / 10, "nm", [cy5_in],
                 "largest x/y/z extent of the conformer's atom centres, Å ÷ 10", ["CID 17758493"])
        offset = c(None if R_cy5 is None or not strep.get("radius_nm") else strep["radius_nm"] + R_cy5 / 10, "nm",
                   [pdb_in, cy5_in] + rad_in,
                   "display distance = streptavidin bounding radius + Cy5 bounding radius (spheres just touching)",
                   ["1STP", "CID 17758493", "vdW radii"],
                   "a display layout only: the peptide that joins Cy5 to the biotin is not documented, so the real "
                   "Cy5 position is unknown")
        comps["cy5"] = {
            "name": "Cy5 acceptor dye (PubChem 3D conformer)", "drawn": True, "shape": "atoms",
            "display_offset_x": offset,
            "dims": dims(("atoms (with H)", c(len(at), "atoms", [cy5_in], "count of conformer atoms", ["CID 17758493"])),
                         ("largest extent", span)),
            "note": "PubChem compound named 'Cy5' (CID 17758493, C33H40N2O8S2, the dye's free acid). Which Cy5 "
                    "derivative Long et al. coupled to the peptide is not stated in the abstract. Placed beside the "
                    "streptavidin at a display distance, not at a documented position.",
        }
    out = {
        "meta": sources_meta(["pdb", "cy5_3d", "cy5_props", "radii"], [LONG]),
        "id": "qd", "title": "Single-QD renin nanosensor probe (Long et al., Anal. Chem. 2012)", "unit": "nm",
        "frame": "Nanometres. Origin at the streptavidin tetramer centre, which is the 1STP crystal origin (the four "
                 "BIOMT operators are two-fold rotations through it); axes as deposited. Coordinates below are stored "
                 "in ångström as deposited and divided by 10 when drawn.",
        "probe": {"description": vo("streptavidin-coated quantum dot + multiple biotinylated, Cy5-labelled peptide "
                                    "substrates; renin cuts the substrate and Cy5 leaves", "", LONG, "published_spec",
                                    "VERIFIED", None, None)},
        "radii_A": radii_vo,
        "structures": {
            "streptavidin": {"pdb_id": "1STP", **strep, "resolution_A": info.get("resolution_A"),
                             "seqres_length": info.get("seqres_len"), "residues_resolved": resolved,
                             "biomt": ops, "biomt_columns": "3 rows of [r1, r2, r3, t] per operator (Å)",
                             "atoms_au": atoms, "atom_columns": ["element", "x_A", "y_A", "z_A", "residue", "number", "name"]},
            "biotin": {"het": "BTN", "atoms_au": btn, "atom_columns": ["element", "x_A", "y_A", "z_A", "name"]},
            "cy5": cy5,
        },
        "components": comps,
        "undocumented": [
            {"name": "Quantum dot (semiconductor nanocrystal)",
             "reason": "the abstract of Long et al. names a streptavidin-coated QD but not its product, emission or size; "
                       "the full text and Supporting Information are paywalled (pubs.acs.org returned HTTP 403 to this "
                       "build; OpenAlex lists no open copy)"},
            {"name": "Biotinylated, Cy5-labelled peptide substrate",
             "reason": "sequence and length are not in the abstract, so the peptide is not drawn and Cy5 is shown beside "
                       "the streptavidin, not at its real distance"},
            {"name": "Linkers joining biotin, peptide and Cy5", "reason": "chemistry not given in the abstract"},
            {"name": "Number of substrates per dot", "reason": "the abstract says 'multiple'; no number"},
            {"name": "Hydrogen atoms of streptavidin and biotin",
             "reason": "the 2.6 Å X-ray structure has no hydrogen positions; only deposited atoms are drawn"},
            {"name": "Unresolved streptavidin residues",
             "reason": f"SEQRES lists {info.get('seqres_len')} residues; only {resolved[0]}–{resolved[1]} are resolved "
                       "in 1STP" if resolved else "1STP not loaded"},
        ],
    }
    return out


# ---------------------------------------------------------------------------------------------------- CQD patch
def build_cqd():
    S = "cqd_si"
    ch = sv("440, 470, 510", "nm", S, "Figure S10 caption (p. S9): 'at 440 nm, 470 nm, and 510 nm reader's optical "
            "channels'", quote="at 440 nm, 470 nm, and 510 nm reader’s optical channels")
    led = sv("390 and 470", "nm", S, "Table S3 (p. S11): 'SMD LED chip 390 nm', 'SMD LED chip 470 nm'",
             quote="SMD LED chip 390 nm")
    check(S, "SMD LED chip 470 nm")
    parts = sv("multi-spectral sensor AS7341; AVR microcontroller ATmega328; Bluetooth module; SMD LED chips 390 and "
               "470 nm; rechargeable Li-ion polymer battery (×2); battery charging module; quartz glass; plastic "
               "materials (ABS)", "", S, "Table S3 (p. S11), 'Smart optoelectronic reader components'",
               quote="Smart optoelectronic reader components")
    for q in ("multi-spectral sensor AS7341", "AVR microcontroller ATmega328", "quartz glass", "plastic materials (ABS)",
              "rechargeable Li-ion polymer battery"):
        check(S, q)
    material = sv("GelMA hydrogel (gelatin, methacrylic anhydride, Irgacure) with citric-acid/ethylenediamine carbon "
                  "dots", "", S, "Table S2 (p. S11) and Figure S3 caption (p. S5)",
                  quote="The optical microscope images of the fabricated MN patches at different concentrations of GelMA")
    check(S, "methacrylic anhydride")
    as_dims = [sv(v, "mm", "as7341", f"package dimension '{lbl}'", quote=f"{v:.1f} mm", tag="datasheet",
                  note="the part named in Table S3; its position inside the reader is not documented")
               for v, lbl in ((3.1, "Length 3.1 mm"), (2.0, "Width 2.0 mm"), (1.0, "Height 1.0 mm"))]
    check("as7341", "OLGA")
    not_stated = ns("mm", "", text=f"{CQD_PAPER}: main text not accessible (pubs.acs.org returned HTTP 403 to this build; "
                    "OpenAlex: closed access); not given in the open Supporting Information")
    out = {
        "meta": sources_meta(["cqd_si", "as7341"], [CQD_PAPER]),
        "id": "cqd", "title": "Carbon-dot microneedle tattoo patch and reader (Tabatabaee et al., ACS Nano 2024)",
        "unit": "mm",
        "frame": "Millimetres (micrometre features as decimals). Nothing is drawn: no dimension of the patch or the reader "
                 "is available from an accessible source.",
        "components": {},
        "documented": {"reader_channels": ch, "reader_leds": led, "reader_parts": parts, "needle_material": material,
                       "as7341_package": {"length": as_dims[0], "width": as_dims[1], "height": as_dims[2]},
                       "cqd_size": sv("DLS diameter histogram 1–12 nm; HRTEM lattice fringes labelled 0.3 nm", "", S,
                                      "Figure S1 (p. S4): '(A and B) HRTEM images, (C) FL spectra (excitation at 365 nm), "
                                      "and (D) DLS analysis of the synthesized CQDs'",
                                      quote="(D) DLS analysis of the synthesized CQDs",
                                      note="nanometre scale; not drawable in the millimetre patch view and no mean size is "
                                           "stated in the text")},
        "needle_geometry": {"count": not_stated, "height": not_stated, "base_width": not_stated, "pitch": not_stated,
                            "patch_size": not_stated, "backing_layer": not_stated},
        "undocumented": [
            {"name": "Microneedles (count, shape, height, base width, pitch)",
             "reason": "in the paywalled main text; the open Supporting Information shows microscope images with 500 µm "
                       "scale bars (Fig. S3) but states no dimension, and sizes are not measured off images"},
            {"name": "Patch outline and backing layer", "reason": "not stated in an accessible source"},
            {"name": "Carbon quantum dots", "reason": "nanometre-sized (Fig. S1); no stated mean size, and not drawable at "
                                                       "the patch's millimetre scale"},
            {"name": "Wearable reader housing (ABS) and quartz-glass window", "reason": "materials listed in Table S3; no "
                                                                                        "dimensions"},
            {"name": "AS7341 multispectral sensor", "reason": "package 3.1 × 2.0 × 1.0 mm (ams-OSRAM), but its position "
                                                             "in the reader is not documented"},
            {"name": "390 nm and 470 nm SMD LEDs", "reason": "wavelengths listed (Table S3); packages and positions not "
                                                             "stated"},
            {"name": "ATmega328 microcontroller, Bluetooth module, charging module, two Li-ion polymer batteries",
             "reason": "listed in Table S3; packages, sizes and layout not stated"},
        ],
    }
    return out


# ---------------------------------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--refresh", action="store_true", help="download every source again")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    for key in SOURCES:
        SRC[key] = Source(key)
        SRC[key].load(args.refresh)
        s = SRC[key]
        pin = "" if not s.pin else (" pin ok" if s.sha256 == s.pin else " PIN MISMATCH")
        print(f"  {key:10s} {'ok ' if s.raw else 'ERR'} {len(s.raw or b''):>9d} B  {(s.sha256 or s.error)[:64]}{pin}")
    files = {"opm": build_opm, "nv": build_nv, "qd": build_qd, "cqd": build_cqd}
    failed = []
    for sid, fn in files.items():
        n0 = len(CHECKS)
        try:
            obj = fn()
        except Exception:
            import traceback
            traceback.print_exc()
            failed.append(sid)
            continue
        obj["checks"] = CHECKS[n0:]
        write_json(OUT / f"{sid}.json", obj)
        if sid == "nv":
            drawn = {b: [k for k, v in obj["builds"][b]["components"].items() if v.get("drawn")] for b in obj["builds"]}
            n_und = sum(len(b["undocumented"]) for b in obj["builds"].values())
        else:
            drawn = [k for k, v in obj["components"].items() if v.get("drawn")]
            n_und = len(obj["undocumented"])
        print(f"{sid}: drawn {drawn}; listed as undocumented: {n_und}")
    bad = [ch for ch in CHECKS if not ch["result"].startswith("found")]
    print(f"quote checks: {len(CHECKS) - len(bad)} found, {len(bad)} not found or unavailable")
    for ch in bad:
        print(f"  - [{ch['source']}] {ch['result']}: {ch['quote']}")
    errs = {k: s.error for k, s in SRC.items() if s.error}
    if errs:
        print("fetch errors:", json.dumps(errs, indent=1))
    if failed:
        print("failed builds:", failed)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
