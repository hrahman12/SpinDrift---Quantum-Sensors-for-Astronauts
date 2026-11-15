"""Build data/bio/*.json: the real data behind the cell and molecule zoom levels (ui/scale/cell_*.js, mol_*.js).

- genes.json      REN, SCN5A and UGT1A1 from the Ensembl REST API (GRCh38): gene, canonical (MANE Select) transcript,
                  exon coordinates, translation; protein function from UniProt.
- neuron_<id>.json NeuroMorpho.Org neuron 107146, a human neocortical layer 2/3 pyramidal cell (Tamas lab; Molnar et al.,
                  eLife 2016, Figure 1B). Standardised (CNG) SWC samples in micrometres with type codes and parent links.
- nav15_<pdb>.json RCSB PDB 8VYJ, full-length human Nav1.5 (electron microscopy): C-alpha trace in the shape of
                  data/molecules/renin_2ren.json, plus UniProt Q14524 repeats, membrane segments and pore loops.
- cells.json      cardiomyocyte, red-blood-cell (Evans and Fung 1972) and skin-layer values as value objects. Each literature
                  value is checked against the downloaded source text; a value that cannot be found there is TO_CONFIRM.
                  Red-cell crowding uses the Inspiration4 complete blood count (NASA OSDR OSD-569).
- elements.json   van der Waals radii and CPK colours for H, C, N, O from the PubChem periodic table.

Only official endpoints are used (Ensembl, UniProt, RCSB, NeuroMorpho.Org API, NCBI E-utilities, Europe PMC, PMC,
NASA OSDR, PubChem). The SHA256 of every download is recorded in each file's meta.
"""
import hashlib
import html
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
from server.common import DATA, calc, log_status, meta, missing, vo, write_json  # noqa: E402
from build_molecules import THREE, parse_pdb, secondary  # noqa: E402  (same PDB parser as renin_2ren.json)

OUT = DATA / "bio"
UA = {"User-Agent": "SpinDrift-build/1.0 (data build script)"}
SHA = {}          # url -> sha256 of the bytes received
FAILED = {}       # url -> error text

ENSEMBL = "https://rest.ensembl.org"
EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&tool=SpinDrift-build&id="
EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/{}/fullTextXML"
PMC_PAGE = "https://pmc.ncbi.nlm.nih.gov/articles/{}/"
UNIPROT = "https://rest.uniprot.org/uniprotkb/{}.json"

GENES = {
    "REN": {"uniprot": "P00797", "site": "blood", "why": "renin, the enzyme the quantum-dot sensor reports on"},
    "SCN5A": {"uniprot": "Q14524", "site": "heart", "why": "Nav1.5, the cardiac sodium channel"},
    "UGT1A1": {"uniprot": "P22309", "site": "skin", "why": "the enzyme that conjugates bilirubin, the carbon-dot patch's analyte"},
}
NMO_ID = 107146
PDB_ID = "8VYJ"
OSDR_CBC_FILE = "LSDS-7_Complete_Blood_Count_CBC.upload_SUBMITTED.csv"
OSDR_CBC = f"https://osdr.nasa.gov/geode-py/ws/studies/OSD-569/download?source=datamanager&file={OSDR_CBC_FILE}"
OSDR_STUDY = "https://osdr.nasa.gov/bio/repo/data/studies/OSD-569"
OSDR_TERMS = ("NASA OSDR terms (https://science.nasa.gov/reference/osdr-help-terms-and-conditions/): open access under NASA's "
              "Science Information Policy; cite the study. Acknowledgement: 'Data are courtesy of the NASA Open Science Data "
              "Repository (https://osdr.nasa.gov/bio/repo)'.")
CBC_SUBJECT, CBC_TIMEPOINT = "C001", "R+1"   # first return-day sample of crew C001
PUBCHEM_PT = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/periodictable/JSON"

# PubMed records used here (citations are built from the fetched records, not typed by hand)
PMIDS = {
    "gerdes1992": "1638711", "ohler2009": "20224636", "manandhar2026": "42530239", "evans1972": "4635577",
    "dodson2010": "21044588", "hosseini2012": "22828326", "sandby2003": "14690333", "wang2025": "40606357",
    "neymotin2020": "31967544", "bosma1994": "8027054", "tabatabaee2024": "39356285", "molnar2016": "27536876",
    "biswas2025": "40366698", "tecuatl2024": "38974113", "sraj2010": "20721060", "cells2022": "35741070",
}
CHALLENGED = set()   # pages that answered with a browser check instead of the article (not retried, never bypassed)


# ------------------------------------------------------------------ downloads
def get(url, accept=None, tries=3):
    headers = dict(UA)
    if accept:
        headers["Accept"] = accept
    last = None
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=120) as r:
                body = r.read()
            SHA[url] = hashlib.sha256(body).hexdigest()
            return body
        except Exception as e:  # noqa: BLE001 - network errors are recorded, then retried
            last = e
            time.sleep(1.5 * (k + 1))
    FAILED[url] = f"{type(last).__name__}: {last}"
    raise last


def get_json(url):
    return json.loads(get(url, accept="application/json"))


def write_compact(path, obj):
    """Like server.common.write_json (atomic temp file + replace) but without indentation: the neuron's 22,892 samples
    take ~2.5 MB indented and ~1 MB compact."""
    path = Path(path)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    tmp.replace(path)


def plain(raw: bytes) -> str:
    """Markup to plain text: tags removed, entities decoded, whitespace collapsed."""
    t = raw.decode("utf-8", "replace")
    t = re.sub(r"<(script|style)\b.*?</\1>", " ", t, flags=re.S | re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", html.unescape(t)).strip()


TEXT = {}   # url -> plain text (or None if the fetch failed)


def text_at(url, tries=3):
    if url not in TEXT:
        try:
            t = plain(get(url, tries=tries))
            if "Checking your browser" in t[:400]:      # a bot check, not the article: give up on this source
                CHALLENGED.add(url)
                SHA.pop(url, None)
                t = None
            TEXT[url] = t
        except Exception:  # noqa: BLE001
            TEXT[url] = None
    return TEXT[url]


def find(url, pattern, tries=3):
    """Return the matched quote from the source text, or None."""
    t = text_at(url, tries)
    if not t:
        return None
    m = re.search(pattern, t)
    return m.group(0) if m else None


# ------------------------------------------------------------------ PubMed records -> citations
PUB = {}


def load_pubmed():
    url = EFETCH + ",".join(PMIDS.values())
    root = ET.fromstring(get(url))
    for art in root.findall(".//PubmedArticle"):
        pmid = art.findtext(".//MedlineCitation/PMID")
        a = art.find(".//MedlineCitation/Article")
        authors = []
        for au in a.findall("./AuthorList/Author"):
            if au.findtext("CollectiveName"):
                authors.append(au.findtext("CollectiveName"))
            elif au.findtext("LastName"):
                authors.append(f"{au.findtext('LastName')} {au.findtext('Initials') or ''}".strip())
        ji = a.find("./Journal/JournalIssue")
        year = ji.findtext("./PubDate/Year") or (ji.findtext("./PubDate/MedlineDate") or "")[:4]
        ids = {i.get("IdType"): i.text for i in art.findall(".//PubmedData/ArticleIdList/ArticleId")}
        abstract = " ".join("".join(x.itertext()) for x in a.findall("./Abstract/AbstractText"))
        PUB[pmid] = {
            "pmid": pmid, "title": "".join(a.find("ArticleTitle").itertext()).strip().rstrip("."),
            "authors": authors, "journal": a.findtext("./Journal/ISOAbbreviation") or a.findtext("./Journal/Title"),
            "year": year, "volume": ji.findtext("Volume"), "issue": ji.findtext("Issue"),
            "pages": a.findtext("./Pagination/MedlinePgn") or a.findtext("./ELocationID"),
            "doi": ids.get("doi"), "pmc": ids.get("pmc"), "abstract": re.sub(r"\s+", " ", abstract).strip(),
        }
    return url


def cite(key, extra=""):
    p = PUB.get(PMIDS[key])
    if not p:
        return f"PubMed {PMIDS[key]}{extra}"
    au = p["authors"]
    names = ", ".join(au[:3]) + (", et al" if len(au) > 3 else "")
    vol = f";{p['volume']}" if p["volume"] else ""
    iss = f"({p['issue']})" if p["issue"] else ""
    pg = f":{p['pages']}" if p["pages"] else ""
    ids = [f"doi:{p['doi']}"] if p["doi"] else []
    ids.append(f"PubMed {p['pmid']}")
    if p["pmc"]:
        ids.append(p["pmc"])
    return f"{names}. {p['title']}. {p['journal']} {p['year']}{vol}{iss}{pg}. {', '.join(ids)}{extra}"


def abstract_find(key, pattern):
    p = PUB.get(PMIDS[key])
    if not p:
        return None
    m = re.search(pattern, p["abstract"])
    return m.group(0) if m else None


def checked(value, unit, key, where, quote, tag="published_spec", note=None, src_url=None):
    """A literature value: VERIFIED only if its quote was found in the downloaded source text."""
    src = cite(key, f" ({where})")
    q = f"quote found in {src_url or 'the PubMed record'}: “{quote}”" if quote else None
    if quote:
        return vo(value, unit, src, tag, "VERIFIED", None, "; ".join(x for x in [note, q] if x))
    return vo(value, unit, src, tag, "TO_CONFIRM", None,
              "; ".join(x for x in [note, f"the value could not be found in the downloaded text of {src_url or 'the PubMed record'}"] if x))


# ------------------------------------------------------------------ UniProt
UNI = {}


def uniprot(acc):
    if acc not in UNI:
        UNI[acc] = get_json(UNIPROT.format(acc))
    return UNI[acc]


def function_text(acc, keyword=None):
    d = uniprot(acc)
    texts = [t["value"] for c in d.get("comments", []) if c.get("commentType") == "FUNCTION" for t in c.get("texts", [])]
    if not texts:
        return None
    if keyword is None:
        return re.sub(r"\s*\(PubMed:[^)]*\)", "", texts[0])
    for t in texts:
        for s in re.split(r"(?<=\.)\s+", t):
            if keyword.lower() in s.lower():
                return re.sub(r"\s*\(PubMed:[^)]*\)", "", s)
    return None


def subcellular(acc):
    d = uniprot(acc)
    for c in d.get("comments", []):
        if c.get("commentType") == "SUBCELLULAR LOCATION":
            locs = [s["location"]["value"] for s in c.get("subcellularLocations", [])]
            note = " ".join(t["value"] for t in (c.get("note") or {}).get("texts", []))
            return {"locations": locs, "note": re.sub(r"\s*\(PubMed:[^)]*\)", "", note)}
    return None


# ------------------------------------------------------------------ genes (Ensembl)
def genes():
    info_url = f"{ENSEMBL}/info/data/?content-type=application/json"
    asm_url = f"{ENSEMBL}/info/assembly/homo_sapiens?content-type=application/json"
    release = get_json(info_url)["releases"][0]
    asm = get_json(asm_url)
    out = {}
    for sym, g0 in GENES.items():
        gurl = f"{ENSEMBL}/lookup/symbol/homo_sapiens/{sym}?content-type=application/json"
        g = get_json(gurl)
        tid = g["canonical_transcript"].split(".")[0]
        turl = f"{ENSEMBL}/lookup/id/{tid}?expand=1;utr=1;mane=1;content-type=application/json"
        t = get_json(turl)
        strand = t["strand"]
        ex = sorted(t["Exon"], key=lambda e: e["start"], reverse=(strand < 0))   # transcript order, 5' to 3'
        exons = [{"rank": i + 1, "id": e["id"], "start": e["start"], "end": e["end"], "length_bp": e["end"] - e["start"] + 1}
                 for i, e in enumerate(ex)]
        mane = [{"type": m.get("type"), "refseq": m.get("refseq_match")} for m in t.get("MANE", [])]
        tr = t.get("Translation") or {}
        utr = [{"type": u["type"], "start": u["start"], "end": u["end"]} for u in t.get("UTR", [])]
        acc = g0["uniprot"]
        u = uniprot(acc)
        func = function_text(acc, "bilirubin" if sym == "UGT1A1" else None)
        out[sym] = {
            "symbol": sym, "description": g.get("description"), "biotype": g.get("biotype"),
            "ensembl_gene_id": g["id"], "gene_version": g.get("version"), "chrom": g["seq_region_name"],
            "start": g["start"], "end": g["end"], "strand": g["strand"], "assembly": g.get("assembly_name"),
            "canonical_transcript": g["canonical_transcript"], "transcript_name": t.get("display_name"),
            "transcript_start": t["start"], "transcript_end": t["end"], "transcript_length_bp": t.get("length"),
            "is_canonical": bool(t.get("is_canonical")), "mane": mane,
            "translation": {"id": tr.get("id"), "start": tr.get("start"), "end": tr.get("end"), "length_aa": tr.get("length")},
            "n_exons": len(exons), "exons": exons,
            "exon_coords": sorted([[e["start"], e["end"]] for e in exons]),
            "utr": utr,
            "uniprot": acc, "protein": u["proteinDescription"]["recommendedName"]["fullName"]["value"],
            "protein_length_aa": u["sequence"]["length"],
            "function": (vo(func, "", f"UniProt {acc} FUNCTION comment, {UNIPROT.format(acc)} (CC BY 4.0)", "published_spec",
                            "VERIFIED") if func else missing("", f"UniProt {acc}", "published_spec", "NOT_STATED")),
            "isoform_note": (None if tr.get("length") == u["sequence"]["length"] else
                             f"the canonical transcript's translation is {tr.get('length')} aa; the UniProt {acc} canonical "
                             f"sequence (used for structure numbering) is {u['sequence']['length']} aa"),
            "role_in_spindrift": g0["why"], "site": g0["site"],
            "urls": {"gene_lookup": gurl, "transcript_lookup": turl,
                     "ensembl_page": f"https://www.ensembl.org/Homo_sapiens/Gene/Summary?g={g['id']}",
                     "uniprot": f"https://www.uniprot.org/uniprotkb/{acc}/entry"},
        }
    # UGT1A1 conjugates bilirubin: UniProt sentence plus the primary paper
    q = abstract_find("bosma1994", r"B-UGT1 is the only physiologically relevant isoform in bilirubin glucuronidation")
    out["UGT1A1"]["bilirubin_conjugation"] = checked(
        "UGT1A1 (bilirubin UDP-glucuronosyltransferase 1) is the only physiologically relevant isoform in bilirubin "
        "glucuronidation", "", "bosma1994", "abstract", q, note="B-UGT1 is UGT1A1 (UniProt P22309)")
    urls = [info_url, asm_url] + [v["urls"]["gene_lookup"] for v in out.values()] + \
           [v["urls"]["transcript_lookup"] for v in out.values()] + [UNIPROT.format(g["uniprot"]) for g in GENES.values()]
    write_json(OUT / "genes.json", {
        "meta": meta(False, [f"Ensembl REST API {ENSEMBL} (release {release}, {asm.get('assembly_name')})",
                             "UniProt REST API (CC BY 4.0)", cite("bosma1994")],
                     sha256={u: SHA.get(u) for u in urls}, ensembl_release=release),
        "tag": "recorded", "assembly": asm.get("assembly_name"), "assembly_default": asm.get("default_coord_system_version"),
        "ensembl_release": release, "genes": out,
        "note": "Coordinates are 1-based, inclusive, on the GRCh38 primary assembly as served by Ensembl. 'exons' are in "
                "transcript order (5' to 3'); 'exon_coords' are sorted by genomic position for drawing.",
    })
    return release, asm.get("assembly_name"), out


# ------------------------------------------------------------------ neuron (NeuroMorpho.Org)
def neuron():
    rec_url = f"https://neuromorpho.org/api/neuron/id/{NMO_ID}"
    mor_url = f"https://neuromorpho.org/api/morphometry/id/{NMO_ID}"
    rec = get_json(rec_url)
    mor = get_json(mor_url)
    swc_url = ("https://neuromorpho.org/dableFiles/" + urllib.parse.quote(rec["archive"].lower()) + "/CNG%20version/"
               + urllib.parse.quote(rec["neuron_name"]) + ".CNG.swc")
    swc = get(swc_url).decode("utf-8", "replace")
    rows = [ln.split() for ln in swc.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]
    a = np.array([[float(x) for x in r[:7]] for r in rows])
    ids, typ, par = a[:, 0].astype(int), a[:, 1].astype(int), a[:, 6].astype(int)
    idx = {i: k for k, i in enumerate(ids)}
    assert (par == -1).sum() == 1, "SWC must have one root"
    assert all(p == -1 or p in idx for p in par), "dangling parent"
    xyz = a[:, 2:5]
    soma = xyz[typ == 1].mean(axis=0) if (typ == 1).any() else xyz[0]
    seglen = {}
    for k in range(len(a)):
        if par[k] != -1:
            seglen[int(typ[k])] = seglen.get(int(typ[k]), 0.0) + float(np.linalg.norm(xyz[k] - xyz[idx[par[k]]]))
    children = {}
    for p in par:
        children[p] = children.get(p, 0) + 1
    tips = {t: int(sum(1 for k in range(len(a)) if typ[k] == t and children.get(ids[k], 0) == 0)) for t in (2, 3, 4)}
    apical = xyz[typ == 4]
    axis = (apical.mean(axis=0) - soma) if len(apical) else np.array([0.0, 1.0, 0.0])
    axis = axis / (np.linalg.norm(axis) or 1)
    names = {1: "soma", 2: "axon", 3: "basal dendrite", 4: "apical dendrite"}
    ref = {"pmid": (rec.get("reference_pmid") or [None])[0], "doi": (rec.get("reference_doi") or [None])[0],
           "citation": cite("molnar2016")}
    soma_r = float(a[typ == 1, 5].max()) if (typ == 1).any() else None
    write_compact(OUT / f"neuron_{NMO_ID}.json", {
        "meta": meta(False, [f"NeuroMorpho.Org neuron {NMO_ID}, {rec_url}", f"standardised SWC, {swc_url}",
                             f"morphometry, {mor_url}"],
                     sha256={rec_url: SHA.get(rec_url), mor_url: SHA.get(mor_url), swc_url: SHA.get(swc_url)},
                     licence="NeuroMorpho.Org content is licensed CC BY 4.0 (https://neuromorpho.org/useterm.jsp). Cite: the "
                             "original paper; NeuroMorpho.Org (RRID:SCR_002145); and " + cite("tecuatl2024") + ".",
                     terms_url="https://neuromorpho.org/useterm.jsp"),
        "tag": "recorded", "neuromorpho_id": NMO_ID, "neuron_name": rec["neuron_name"], "archive": rec["archive"],
        "species": rec.get("species"), "brain_region": rec.get("brain_region"), "cell_type": rec.get("cell_type"),
        "age_classification": rec.get("age_classification"), "age": rec.get("min_age"), "age_scale": rec.get("age_scale"),
        "gender": rec.get("gender"), "experiment_condition": rec.get("experiment_condition"), "stain": rec.get("stain"),
        "protocol": rec.get("protocol"), "reconstruction_software": rec.get("reconstruction_software"),
        "objective": rec.get("objective_type"), "magnification": rec.get("magnification"),
        "slicing_thickness_um": rec.get("slicing_thickness"), "physical_integrity": rec.get("physical_Integrity"),
        "domain": rec.get("domain"), "shrinkage_reported": rec.get("shrinkage_reported"),
        "shrinkage_corrected": rec.get("shrinkage_corrected") or None,
        "reference": ref, "citation_resource": "NeuroMorpho.Org (RRID:SCR_002145)", "citation_neuromorpho": cite("tecuatl2024"),
        "type_codes": {str(k): v for k, v in names.items()},
        "n_samples": int(len(a)), "counts_by_type": {names[t]: int((typ == t).sum()) for t in names},
        "tips_by_type": {names[t]: tips[t] for t in (2, 3, 4)},
        "bifurcations": int(sum(1 for i, c in children.items() if i != -1 and c >= 2)),
        "soma_um": [round(float(v), 3) for v in soma], "soma_radius_um": soma_r,
        "extent_um": {ax: [round(float(xyz[:, i].min()), 2), round(float(xyz[:, i].max()), 2)] for i, ax in enumerate("xyz")},
        "length_um_by_type": {names[t]: round(v, 1) for t, v in sorted(seglen.items())},
        "length_um_total": round(sum(seglen.values()), 1),
        "apical_axis": [round(float(v), 4) for v in axis],
        "apical_axis_note": "calculated: unit vector from the soma centre to the mean of all apical-dendrite samples; the scene "
                            "turns the cell so this points up (a rotation only, no geometry change)",
        "morphometry_neuromorpho": {k: mor.get(k) for k in ("width", "height", "depth", "length", "n_stems", "n_bifs",
                                                           "n_branch", "soma_Surface", "eucDistance", "pathDistance")},
        "samples": [[int(r[0]), int(r[1]), round(float(r[2]), 3), round(float(r[3]), 3), round(float(r[4]), 3),
                     round(float(r[5]), 3), int(r[6])] for r in a],
        "sample_columns": ["id", "type", "x_um", "y_um", "z_um", "radius_um", "parent"],
        "note": "Coordinates and radii in micrometres as standardised by NeuroMorpho.Org (CNG version); shrinkage not "
                "corrected. Type codes follow the SWC convention. Lengths, tips, bifurcations and the apical axis are calculated "
                "here from the samples.",
    })
    return rec, a, seglen, soma_r


# ------------------------------------------------------------------ Nav1.5 (RCSB + UniProt)
def nav15():
    pdb_url = f"https://files.rcsb.org/download/{PDB_ID}.pdb"
    entry_url = f"https://data.rcsb.org/rest/v1/core/entry/{PDB_ID}"
    acc = "Q14524"
    raw = get(pdb_url)
    info, ca, helices, sheets = parse_pdb(raw.decode("latin-1"))
    secondary(ca, helices, sheets)
    entry = get_json(entry_url)
    uni = uniprot(acc)
    seq = uni["sequence"]["value"]
    # numbering check: the PDB residue number should index the UniProt canonical sequence
    same = sum(1 for c in ca if 1 <= c["res"] <= len(seq) and THREE.get(c["name"]) == seq[c["res"] - 1])
    numbering_ok = same == len(ca)
    pos = [c["res"] for c in ca]            # UniProt positions (numbering checked above)
    feats = uni.get("features", [])

    def ranges(ftype):
        return [(f["location"]["start"]["value"], f["location"]["end"]["value"], f.get("description") or "")
                for f in feats if f.get("type") == ftype]

    repeats = ranges("Repeat")
    tms = ranges("Transmembrane")
    pores = ranges("Intramembrane")
    topo = ranges("Topological domain")
    roman = {"I": "1", "II": "2", "III": "3", "IV": "4"}
    rep_str, top_str = [], []
    for p in pos:
        r = next((roman.get(d.strip(), "-") for s, e, d in repeats if s <= p <= e), "-")
        rep_str.append(r)
        if any(s <= p <= e for s, e, _ in tms):
            top_str.append("M")
        elif any(s <= p <= e for s, e, _ in pores):
            top_str.append("P")
        else:
            d = next((d for s, e, d in topo if s <= p <= e), "")
            top_str.append("C" if d.startswith("Cytoplasmic") else "X" if d.startswith("Extracellular") else "-")
    xyz = np.array([[c["x"], c["y"], c["z"]] for c in ca])
    at = {p: i for i, p in enumerate(pos)}

    def side_before(s):
        d = next((d for a, b, d in topo if a <= s - 1 <= b), "")
        return "C" if d.startswith("Cytoplasmic") else "X" if d.startswith("Extracellular") else None

    vecs, tm_idx = [], []
    for s, e, d in tms:
        inside = [at[p] for p in range(s, e + 1) if p in at]
        tm_idx += inside
        if len(inside) < 4:
            continue
        v = xyz[inside[-1]] - xyz[inside[0]]
        sb = side_before(s)
        if sb == "X":
            v = -v
        elif sb != "C":
            continue
        vecs.append(v / np.linalg.norm(v))
    normal = np.mean(vecs, axis=0)
    normal /= np.linalg.norm(normal)
    tm_centre = xyz[tm_idx].mean(axis=0)
    proj = (xyz[tm_idx] - tm_centre) @ normal
    # fast-inactivation IFM motif, defined in Biswas et al. 2025 as lying in the DIII-DIV linker: search that UniProt linker
    s6_3 = next(e for s, e, d in tms if "S6 of repeat III" in d)
    s1_4 = next(s for s, e, d in tms if "S1 of repeat IV" in d)
    link = seq[s6_3:s1_4 - 1]
    hits = [m.start() + s6_3 + 1 for m in re.finditer("IFM", link)]
    sites = []
    if len(hits) == 1:
        p = hits[0]
        idxs = [at.get(p + k) for k in range(3)]
        sites.append({"name": "IFM motif", "uniprot_positions": [p, p + 1, p + 2], "residues": "Ile-Phe-Met",
                      "index": [i for i in idxs if i is not None], "modeled": all(i is not None for i in idxs),
                      "definition": "Biswas et al. 2025: 'the Isoleucine-Phenylalanine-Methionine (IFM) motif in the linker "
                                    "between D III and D IV ... crucial for fast inactivation'; located here by sequence "
                                    f"search of UniProt Q14524 between S6 of repeat III (ends {s6_3}) and S1 of repeat IV "
                                    f"(starts {s1_4})", "source": cite("biswas2025")})
    biswas_quote = find(EPMC.format("PMC12107192"), r"Isoleucine-Phenylalanine-Methionine \(IFM\) motif in the linker between D III and D IV")
    cit = entry.get("rcsb_primary_citation", {})
    res = (entry.get("rcsb_entry_info") or {}).get("resolution_combined") or [info["resolution_A"]]
    centre = xyz.mean(axis=0)
    write_json(OUT / f"nav15_{PDB_ID.lower()}.json", {
        "meta": meta(False, [f"RCSB PDB {PDB_ID}, {pdb_url} (CC0 1.0)", f"RCSB entry API, {entry_url} (CC0 1.0)",
                             f"UniProt {acc}, {UNIPROT.format(acc)} (CC BY 4.0)", cite("biswas2025")],
                     sha256={pdb_url: SHA.get(pdb_url), entry_url: SHA.get(entry_url), UNIPROT.format(acc): SHA.get(UNIPROT.format(acc))}),
        "tag": "recorded", "pdb_id": PDB_ID, "protein": uni["proteinDescription"]["recommendedName"]["fullName"]["value"],
        "gene": "SCN5A", "uniprot": acc, "organism": "Homo sapiens", "method": info["method"],
        "resolution_A": res[0] if res else None, "deposited": info["deposited"], "title": entry.get("struct", {}).get("title"),
        "authors": ", ".join(cit.get("rcsb_authors", [])), "journal": info["journal"],
        "citation": {"title": cit.get("title"), "journal": cit.get("journal_abbrev"), "year": cit.get("year"),
                     "volume": cit.get("journal_volume"), "page": cit.get("page_first"), "doi": cit.get("pdbx_database_id_DOI"),
                     "pubmed": cit.get("pdbx_database_id_PubMed"), "full": cite("biswas2025")},
        "state_reported": "open state (Biswas et al. 2025: 'Our native, untruncated structures of hNav1.5 are captured in the open state')",
        "n_residues": len(ca), "sequence_length": len(seq), "chains": sorted({c["chain"] for c in ca}),
        "helix_residues": sum(1 for c in ca if c["ss"] == "H"), "strand_residues": sum(1 for c in ca if c["ss"] == "E"),
        "centre_A": [float(v) for v in centre],
        "numbering": {"pdb_matches_uniprot": numbering_ok, "matching_residues": same, "of": len(ca)},
        "active_sites": [],
        "active_sites_note": "Nav1.5 is a channel, not an enzyme: UniProt Q14524 lists no active site.",
        "sites": sites, "ifm_definition_quote_found": bool(biswas_quote),
        "repeats": [{"name": d, "uniprot_start": s, "uniprot_end": e,
                     "modeled_ca": sum(1 for p in pos if s <= p <= e)} for s, e, d in repeats],
        "transmembrane": [{"name": d, "uniprot_start": s, "uniprot_end": e} for s, e, d in tms],
        "pore_loops": [{"name": d, "uniprot_start": s, "uniprot_end": e} for s, e, d in pores],
        "topology_domains": [{"side": d, "uniprot_start": s, "uniprot_end": e} for s, e, d in topo],
        "ca": [[c["chain"], c["res"], c["name"], round(c["x"], 3), round(c["y"], 3), round(c["z"], 3), c["ss"], round(c["b"], 1)]
               for c in ca],
        "ca_columns": ["chain", "residue", "name", "x_A", "y_A", "z_A", "secondary", "b_factor"],
        "ca_repeat": "".join(rep_str), "ca_repeat_key": {"1": "I", "2": "II", "3": "III", "4": "IV", "-": "outside the repeats"},
        "ca_topology": "".join(top_str),
        "ca_topology_key": {"M": "transmembrane helix", "P": "pore-forming intramembrane loop", "C": "cytoplasmic",
                            "X": "extracellular", "-": "not annotated"},
        "membrane_normal": [round(float(v), 4) for v in normal],
        "membrane_normal_note": "calculated: mean unit vector along the 24 UniProt transmembrane segments, each oriented from "
                                "its cytoplasmic end to its extracellular end using the UniProt topological domain before it; "
                                f"{len(vecs)} segments used. Points to the extracellular side.",
        "tm_centre_A": [round(float(v), 3) for v in tm_centre],
        "tm_span_A": [round(float(proj.min()), 2), round(float(proj.max()), 2)],
        "tm_span_note": "calculated: extent of the C-alpha atoms of UniProt-annotated transmembrane residues along the normal. "
                        "This is the span of those residues, not a measured membrane thickness.",
        "note": "C-alpha positions in angstrom as deposited (model I of Biswas et al. 2025). Secondary structure from the file's "
                "HELIX and SHEET records. Repeats, membrane segments and topology from UniProt by residue number (numbering "
                "checked against the UniProt canonical sequence). Unmodelled regions are gaps.",
    })
    return len(ca), info, res, numbering_ok, sites, normal


# ------------------------------------------------------------------ cells: cardiomyocyte, red blood cell, skin
def rbc_shape(R0, C0, C2, C4, n=200001):
    """Evans-Fung biconcave disc: half-thickness z(r) = 1/2 sqrt(1-(r/R0)^2) (C0 + C2 (r/R0)^2 + C4 (r/R0)^4)."""
    th = np.linspace(0.0, math.pi / 2, n)           # r = R0 sin(th) removes the rim singularity
    s, c = np.sin(th), np.cos(th)
    r = R0 * s
    poly = C0 + C2 * s ** 2 + C4 * s ** 4
    z = 0.5 * c * poly                                # half thickness
    dr = R0 * c
    dz = 0.5 * (-s * poly + c * (2 * C2 * s * c + 4 * C4 * s ** 3 * c))
    trap = getattr(np, "trapezoid", None) or np.trapz
    area = 2 * trap(2 * math.pi * r * np.sqrt(dr ** 2 + dz ** 2), th)      # both faces
    vol = trap(2 * z * 2 * math.pi * r * dr, th)
    k = int(np.argmax(2 * z))
    return {"area": float(area), "volume": float(vol), "t_max": float(2 * z[k]), "r_at_t_max": float(r[k]),
            "t_centre": float(2 * z[0])}


def cbc():
    raw = get(OSDR_CBC)
    lines = raw.decode("utf-8-sig", "replace").splitlines()
    head = [h.strip() for h in lines[0].split(",")]
    rows = [dict(zip(head, [x.strip() for x in ln.split(",")])) for ln in lines[1:] if ln.strip()]
    want = {"RED BLOOD CELL COUNT": "rbc_count", "HEMATOCRIT": "hematocrit", "MCV": "mcv", "HEMOGLOBIN": "hemoglobin"}
    series = {}
    for r in rows:
        if r.get("SUBJECT_ID") != CBC_SUBJECT or r.get("ANALYTE") not in want:
            continue
        key = want[r["ANALYTE"]]
        try:
            v = float(r["VALUE"])
        except ValueError:
            v = None
        series.setdefault(key, []).append({"timepoint": r["TEST_DATE"], "value": v, "unit": r["UNITS"],
                                           "range": [r.get("RANGE_MIN"), r.get("RANGE_MAX")]})
    return series


def series_vos(series):
    """The crew series as value objects (one per timepoint)."""
    src = f"NASA OSDR OSD-569 (SpaceX Inspiration4), {OSDR_CBC_FILE}, crew {CBC_SUBJECT}"
    out = {}
    for key, pts in series.items():
        out[key] = [{"timepoint": p["timepoint"],
                     "value": (vo(p["value"], p["unit"], src, "recorded", "VERIFIED", None,
                                  f"reference range {p['range'][0]}-{p['range'][1]} {p['unit']} (as released); timepoint is "
                                  "days from launch (L-) or return (R+)") if p["value"] is not None else
                               missing(p["unit"], src, "recorded", "NOT_STATED", note=f"value not numeric in source"))}
                    for p in pts]
    return out


def at_tp(series, key, tp):
    return next((p for p in series.get(key, []) if p["timepoint"] == tp), None)


def cells():
    out = {}
    # ---- cardiomyocyte
    q_len = abstract_find("gerdes1992", r"197 \+/- 8 versus 141 \+/- 9 microns")
    q_ratio = abstract_find("gerdes1992", r"11\.2 \+/- 0\.9 versus 7\.5 \+/- 0\.6")
    length = checked(141.0, "µm", "gerdes1992", "abstract", q_len,
                     note="mean myocyte length, left-ventricular myocytes isolated from 3 nonfailing donor hearts "
                          "(normal coronary arteries); ± 9 µm as reported")
    ratio = checked(7.5, "", "gerdes1992", "abstract", q_ratio, note="cell length/width ratio, nonfailing donor hearts, ± 0.6")
    width = calc(round(141.0 / 7.5, 1), "µm", [length, ratio], "width = length / (length/width ratio)",
                 ["cardiomyocyte.length", "cardiomyocyte.length_width_ratio"],
                 note_extra="ratio of the two reported means; the paper's own mean width is not in the abstract")
    sl_url = EPMC.format("PMC2833295")
    q_sl = find(sl_url, r"1\.899\s*±\s*0\.011\s*[μµ]\s*m versus 1\.917")
    sl = checked(1.899, "µm", "ohler2009", "Results and Fig. 3(d); CC BY 3.0", q_sl, src_url=sl_url,
                 note="mean resting sarcomere length from transmitted-light images, ventricular myocytes from non-failing "
                      "human hearts (11 cells, 2 hearts), ± 0.011 µm SEM")
    mm_url = EPMC.format("PMC13653500")
    q_mm = find(mm_url, r"MMIC diameter of 15\.70\s*±\s*2\.7\s*[μµ]m")
    thick = checked(15.70, "µm", "manandhar2026", "Results; CC BY-NC 4.0", q_mm, src_url=mm_url,
                    note="myocyte maximum inscribed circle diameter of transverse profiles, H&E sections of mid left-ventricular "
                         "free wall, 202 non-failing donor hearts, ± 2.7 µm; used here as the cell's thickness (the smaller "
                         "transverse dimension), fixed tissue")
    nsar = calc(round(141.0 / 1.899, 2), "", [length, sl], "length / sarcomere length",
                ["cardiomyocyte.length", "cardiomyocyte.sarcomere_length"])
    nav_loc = subcellular("Q14524")
    out["cardiomyocyte"] = {
        "length": length, "length_width_ratio": ratio, "width": width, "thickness": thick, "sarcomere_length": sl,
        "sarcomeres_along_length": nsar,
        "nav15_location": vo(f"{'; '.join(nav_loc['locations'])}. {nav_loc['note']}" if nav_loc else None, "",
                             f"UniProt Q14524 SUBCELLULAR LOCATION, {UNIPROT.format('Q14524')} (CC BY 4.0)", "published_spec",
                             "VERIFIED" if nav_loc else "NOT_STATED") if nav_loc else missing(),
        "not_drawn": ["nuclei, mitochondria, T-tubules and myofibrils (no sourced dimensions used)",
                      "stepped and branched cell ends (the cell is drawn as an elliptic cylinder of the sourced length, width and thickness)"],
        "conduction_velocity": missing("m/s", "no sourced human ventricular conduction velocity used", "published_spec",
                                       "NOT_YET_EXTRACTED", note="the scene's excitation sweep uses illustrative timing"),
    }
    # ---- red blood cell (Evans and Fung 1972)
    # Verification chain (the 1972 paper is paywalled): open-access full texts read through the Europe PMC API carry
    # (a) the Evans-Fung mean diameter, 7.82 um, in a table citing Evans and Fung, and (b) the dimensionless coefficients
    # attributed to Evans and Fung; c x R0 then gives the dimensional coefficients. Two Biophys J papers that quote the
    # values directly are read from PMC when PMC serves the article (it sometimes answers with a browser check instead,
    # which is never bypassed or retried).
    sraj_url, cells_url = EPMC.format("PMC3408928"), EPMC.format("PMC9222013")
    q_dimless = find(sraj_url, r"Evans and Fung \[\s*\d+\s*\] developed:.{0,240}?C\s*0\s*=\s*0\.207161,\s*C\s*1\s*=\s*2\.002558\s*"
                               r"and\s*C\s*2\s*=\s*[−–-]\s*1\.122762")
    q_diam = find(cells_url, r"saline 50 1 donor face-on interference holography 7\.82 0\.62 \[ 1 \]")
    q_ref1 = find(cells_url, r"Evans E\.?\s*Fung Y\.?\s*C\.?\s*Improved Measurements of the Erythrocyte Geometry")
    q_plasma = find(cells_url, r"plasma 4882 8 donors face-on distribution of transmittance 8\.123 0\.425 this work")
    ef_url, hf_url = PMC_PAGE.format("PMC2966011"), PMC_PAGE.format("PMC3388224")
    q_ef = find(ef_url, r"R\s*0\s*=\s*3\.91\s*[μµ]\s*m,\s*C\s*0\s*[=–—−-]\s*0\.81\s*[μµ]\s*m,\s*"
                        r"C\s*2\s*[=–—−-]\s*7\.83\s*[μµ]\s*m,\s*and\s*C\s*4\s*=\s*[−–-]\s*4\.39\s*[μµ]\s*m", tries=1)
    q_eq = find(ef_url, r"Evans and Fung \(\s*\d+\s*\) gave an empirical equation to describe the half-thickness", tries=1)
    q_hf = find(hf_url, r"R\s*0\s*=\s*3\.91\s*[μµ]\s*m is the cell radius on the central plane,\s*c\s*0\s*=\s*0\.207161,\s*"
                        r"c\s*1\s*=\s*2\.002558,\s*and\s*c\s*2\s*=\s*[−–-]\s*1\.122762", tries=1)
    r0_ok = bool(q_diam and q_ref1) or bool(q_ef) or bool(q_hf)
    coef_ok = (bool(q_dimless) and r0_ok) or bool(q_ef)
    ef_src = cite("evans1972", "")
    dimless = {"C0": 0.207161, "C2": 2.002558, "C4": -1.122762}
    found = []
    if q_diam and q_ref1:
        found.append(f"Evans-Fung mean diameter 7.82 um (SD 0.62 um, 50 cells, one donor, interference holography, saline) in "
                     f"{cite('cells2022', ', Table 1')}: “{q_diam}”, reference [1] = Evans and Fung 1972")
    if q_dimless:
        m = re.search(r"C\s*0\s*=\s*0\.207161.*", q_dimless)
        found.append(f"dimensionless coefficients attributed to Evans and Fung in {cite('sraj2010', ', Eq. 9')}: "
                     f"“{m.group(0) if m else q_dimless[-60:]}”")
    if q_ef:
        found.append(f"dimensional values quoted for 300 mOsm in {cite('dodson2010', ', Eq. 1')}: “{q_ef}”")
    if q_hf:
        found.append(f"R0 with the dimensionless set in {cite('hosseini2012', ', Eq. 1')}: “{q_hf[:60]}…”")
    skipped = [u for u in (ef_url, hf_url) if u in CHALLENGED]
    trail = "; ".join(found) + (f"; not read this run (PMC answered with a browser check): {', '.join(skipped)}" if skipped else "")

    def ef(value, name, extra, ok):
        return vo(value, "µm", f"{ef_src} (Evans-Fung shape: {name})", "published_spec",
                  "VERIFIED" if ok else "TO_CONFIRM", None, f"{extra}; {trail}" if trail else extra)

    R0 = ef(3.91, "R0", "cell radius on the central plane, half the Evans-Fung mean diameter 7.82 um", r0_ok)
    C0 = ef(0.81, "C0", f"thickness at the centre; = c0 x R0 = {dimless['C0']} x 3.91 = {dimless['C0'] * 3.91:.5f} um", coef_ok)
    C2 = ef(7.83, "C2", f"coefficient of (r/R0)^2; = c1 x R0 = {dimless['C2']} x 3.91 = {dimless['C2'] * 3.91:.5f} um", coef_ok)
    C4 = ef(-4.39, "C4", f"coefficient of (r/R0)^4; = c2 x R0 = {dimless['C4']} x 3.91 = {dimless['C4'] * 3.91:.5f} um", coef_ok)
    plasma_d = checked(8.123, "µm", "cells2022", "Table 1, this work", q_plasma, src_url=cells_url,
                       note="mean diameter of red cells in autologous plasma, 4882 cells from 8 donors, SD 0.425 um; context "
                            "only: the drawn shape is Evans and Fung's (cells in buffered saline)")
    sh = rbc_shape(3.91, 0.81, 7.83, -4.39)
    ins, ids = [R0, C0, C2, C4], ["rbc.R0", "rbc.C0", "rbc.C2", "rbc.C4"]
    series = cbc()
    p_rbc, p_mcv, p_hct = (at_tp(series, k, CBC_TIMEPOINT) for k in ("rbc_count", "mcv", "hematocrit"))
    osdr_src = f"NASA OSDR OSD-569 (SpaceX Inspiration4), {OSDR_CBC_FILE}, crew {CBC_SUBJECT} at {CBC_TIMEPOINT}"

    def rec(p, unit):
        if not p or p["value"] is None:
            return missing(unit, osdr_src, "recorded", "NOT_STATED")
        return vo(p["value"], unit, osdr_src, "recorded", "VERIFIED", None,
                  f"reference range {p['range'][0]}-{p['range'][1]} {p['unit']} (as released); timepoint is days from return (R+)")

    rbc_count = rec(p_rbc, "million/µL")
    mcv = rec(p_mcv, "fL")
    hct = rec(p_hct, "%")
    n_per_um3 = (p_rbc["value"] * 1e6 / 1e9) if p_rbc and p_rbc["value"] else None
    vol_per = round(1.0 / n_per_um3, 1) if n_per_um3 else None
    out["rbc"] = {
        "equation": "half-thickness z(r) = ± 1/2 · sqrt(1 - (r/R0)^2) · (C0 + C2 (r/R0)^2 + C4 (r/R0)^4)",
        "equation_source": ef_src, "equation_quote_found": bool(q_eq or q_dimless),
        "R0": R0, "C0": C0, "C2": C2, "C4": C4, "dimensionless": dimless,
        "diameter_in_autologous_plasma": plasma_d,
        "diameter": calc(round(2 * 3.91, 2), "µm", [R0], "2 R0", ["rbc.R0"]),
        "thickness_centre": calc(round(sh["t_centre"], 3), "µm", ins, "2 z(0) = C0", ids),
        "thickness_max": calc(round(sh["t_max"], 3), "µm", ins, "max over r of 2 z(r)", ids,
                              note_extra=f"at r = {sh['r_at_t_max']:.3f} µm"),
        "r_at_thickness_max": calc(round(sh["r_at_t_max"], 3), "µm", ins, "argmax of 2 z(r)", ids),
        "volume": calc(round(sh["volume"], 1), "µm³", ins, "integral of 2 z(r) 2 pi r dr from 0 to R0 (numerical)", ids),
        "area": calc(round(sh["area"], 1), "µm²", ins, "surface of revolution of both faces (numerical)", ids),
        "crew": {"subject": CBC_SUBJECT, "timepoint": CBC_TIMEPOINT, "rbc_count": rbc_count, "mcv": mcv, "hematocrit": hct,
                 "series": series_vos(series), "study": OSDR_STUDY, "terms": OSDR_TERMS},
        "blood_volume_per_cell": calc(vol_per, "µm³", [rbc_count], "1 / RBC count (1 µL = 1e9 µm³)",
                                      ["rbc.crew.rbc_count"]),
        "cube_side": calc(round(vol_per ** (1 / 3), 3) if vol_per else None, "µm", [rbc_count],
                          "(blood volume per cell)^(1/3)", ["rbc.blood_volume_per_cell"]),
        "evans_fung_volume_fraction": calc(round(100 * n_per_um3 * sh["volume"], 1) if n_per_um3 else None, "%",
                                           [rbc_count] + ins, "RBC count x Evans-Fung volume",
                                           ["rbc.crew.rbc_count", "rbc.volume"],
                                           note_extra="compare the recorded haematocrit"),
        "plasma_role": vo(function_text("P00797"), "", f"UniProt P00797 FUNCTION comment, {UNIPROT.format('P00797')} (CC BY 4.0)",
                          "published_spec", "VERIFIED"),
        "layout_note": "Cell positions and orientations in the scene are illustrative and sparser than blood; the crowding is "
                       "shown by the per-cell volume cube.",
    }
    # ---- skin at the patch site (forearm)
    q_sc = abstract_find("sandby2003", r"18\.3 \(4\.9\) microm at the dorsal aspect of the forearm")
    q_ep = abstract_find("sandby2003", r"cellular epidermis were 56\.6 \(11\.5\) microm")
    wang_url = EPMC.format("PMC12209672")
    q_der = find(wang_url, r"Right forearm 0\.1178\s*±\s*0\.0185 0\.1132\s*±\s*0\.0189 1\.496 0\.137 1\.6138\s*±\s*0\.4217")
    q_site = find(wang_url, r"5: forearm \(dorsal\)")
    q_tab3 = find(wang_url, r"Comparison of skin thickness measured by VHFUS in different sections")
    sc = checked(18.3, "µm", "sandby2003", "abstract", q_sc,
                 note="stratum corneum, dorsal forearm, biopsies of 71 volunteers measured microscopically, SD 4.9 µm")
    ep = checked(56.6, "µm", "sandby2003", "abstract", q_ep,
                 note="cellular (viable) epidermis, dorsal forearm, same biopsies, SD 11.5 µm")
    der_ok = bool(q_der and q_site and q_tab3)
    der = vo(1613.8, "µm", cite("wang2025", " (Table 3, right forearm, dorsal; 50 MHz ultrasound, longitudinal section)"),
             "published_spec", "VERIFIED" if der_ok else "TO_CONFIRM", None,
             "dermis 1.6138 ± 0.4217 mm, 74 healthy Chinese adults; a different study and method (ultrasound) from the "
             "epidermal values (biopsy)" + (f"; quote found in {wang_url}: “{q_der}”" if der_ok else
                                           f"; the table row could not be found in {wang_url}"))
    q_tab = abstract_find("tabatabaee2024", r"dissolving/hydrogel microneedles loaded with fluorescent carbon quantum dots")
    tab_abs = (PUB.get(PMIDS["tabatabaee2024"]) or {}).get("abstract", "")
    has_len = bool(re.search(r"\d\s*(µm|μm|um|micrometer|mm)\b", tab_abs))
    out["skin"] = {
        "site": "dorsal forearm (the scene's patch site is the right forearm)",
        "stratum_corneum": sc, "cellular_epidermis": ep, "dermis": der,
        "total_drawn": calc(round(18.3 + 56.6 + 1613.8, 1), "µm", [sc, ep, der], "sum of the three layers",
                            ["skin.stratum_corneum", "skin.cellular_epidermis", "skin.dermis"],
                            note_extra="layers from two different studies"),
        "patch_microneedles": vo("dissolving/hydrogel microneedles loaded with fluorescent carbon quantum dots", "",
                                 cite("tabatabaee2024", " (abstract)"), "published_spec", "VERIFIED" if q_tab else "TO_CONFIRM",
                                 None, None),
        "microneedle_geometry": missing("µm", cite("tabatabaee2024"), "published_spec", "NOT_YET_EXTRACTED",
                                        note="needle height, base width, tip, pitch and array size are not in the abstract "
                                             f"(abstract has length values: {has_len}); the full text and supporting information "
                                             "are paywalled (publisher returns HTTP 403 to automated access), so the needles are "
                                             "not drawn"),
        "dermal_epidermal_junction": "drawn flat; its undulation is not drawn (no sourced geometry used)",
    }
    # ---- neuron: why the OPM sees it
    hnn_url = EPMC.format("PMC7018509")
    q_hnn = find(hnn_url, r"the net intracellular current flow in the apical dendrites of pyramidal neurons")
    out["neuron"] = {
        "meg_source": checked("MEG/EEG primary currents: the net intracellular current flow in the apical dendrites of "
                              "pyramidal neurons", "", "neymotin2020", "CC BY 4.0", q_hnn, src_url=hnn_url),
        "conduction_velocity": missing("m/s", "no sourced conduction velocity for this cell type used", "published_spec",
                                       "NOT_YET_EXTRACTED", note="impulses in the scene use illustrative timing"),
    }
    texts = [u for u in TEXT]
    write_json(OUT / "cells.json", {
        "meta": meta(False, [cite(k) for k in ("gerdes1992", "ohler2009", "manandhar2026", "evans1972", "cells2022",
                                               "sraj2010", "dodson2010", "hosseini2012", "sandby2003", "wang2025",
                                               "tabatabaee2024", "neymotin2020")]
                     + [f"NASA OSDR OSD-569, {OSDR_CBC}", f"UniProt P00797 and Q14524, {UNIPROT.format('P00797')}"],
                     sha256={u: SHA.get(u) for u in texts + [OSDR_CBC, EFETCH + ",".join(PMIDS.values())] if u in SHA},
                     verification="each literature value carries the quote found in the downloaded text; VERIFIED only if found",
                     browser_check_not_read=sorted(CHALLENGED)),
        **out,
    })
    return out, sh


# ------------------------------------------------------------------ elements (PubChem periodic table)
def elements():
    d = get_json(PUBCHEM_PT)
    cols = d["Table"]["Columns"]["Column"]
    rows = [dict(zip(cols, r["Cell"])) for r in d["Table"]["Row"]]
    want = {"H", "C", "N", "O", "S"}
    els = {r["Symbol"]: {"name": r["Name"], "atomic_number": int(r["AtomicNumber"]),
                         "vdw_radius_A": vo(float(r["AtomicRadius"]) / 100.0, "Å",
                                            f"PubChem periodic table, {PUBCHEM_PT} (AtomicRadius, van der Waals, pm / 100)",
                                            "published_spec", "VERIFIED"),
                         "cpk": "#" + r["CPKHexColor"].lower()}
           for r in rows if r["Symbol"] in want and r.get("AtomicRadius")}
    write_json(OUT / "elements.json", {
        "meta": meta(False, [f"PubChem periodic table, {PUBCHEM_PT}"], sha256={PUBCHEM_PT: SHA.get(PUBCHEM_PT)}),
        "tag": "published_spec", "elements": els,
        "note": "van der Waals radii in angstrom (PubChem gives pm); CPK colours as PubChem lists them.",
    })
    return els


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    load_pubmed()
    release, assembly, gs = genes()
    print(f"Ensembl release {release}, {assembly}")
    for s, g in gs.items():
        print(f"  {s:7s} {g['ensembl_gene_id']} chr{g['chrom']}:{g['start']:,}-{g['end']:,} strand {g['strand']:+d} "
              f"{g['canonical_transcript']} ({', '.join(m['refseq'] or '' for m in g['mane'])}) {g['n_exons']} exons, "
              f"protein {g['translation']['length_aa']} aa")
    rec, a, seglen, soma_r = neuron()
    ext = {ax: (float(a[:, 2 + i].min()), float(a[:, 2 + i].max())) for i, ax in enumerate("xyz")}
    print(f"neuron NeuroMorpho {NMO_ID} {rec['neuron_name']} ({rec['archive']}; {', '.join(rec['brain_region'])}; "
          f"{rec['physical_Integrity']}): {len(a)} samples, extent "
          + ", ".join(f"{k} {v[0]:.0f}..{v[1]:.0f} ({v[1] - v[0]:.0f}) µm" for k, v in ext.items())
          + f", total length {sum(seglen.values()):.0f} µm, soma radius {soma_r} µm")
    n, info, res, numbering_ok, sites, normal = nav15()
    print(f"Nav1.5 {PDB_ID}: {n} C-alpha, {info['method']}, {res[0]} A, numbering matches UniProt: {numbering_ok}, "
          f"sites {[(s['name'], s['uniprot_positions'], s['modeled']) for s in sites]}, membrane normal {np.round(normal, 3)}")
    out, sh = cells()
    for part in ("cardiomyocyte", "rbc", "skin"):
        for k, v in out[part].items():
            if isinstance(v, dict) and "status" in v and "value" in v:
                print(f"  {part}.{k}: {v['value']} {v['unit']} [{v['tag']}, {v['status']}] - {v['source'][:110]}")
    crew = out["rbc"]["crew"]
    for k in ("rbc_count", "mcv", "hematocrit"):
        v = crew[k]
        print(f"  rbc.crew.{k}: {v['value']} {v['unit']} [{v['tag']}, {v['status']}]")
    els = elements()
    print("elements:", {k: v["vdw_radius_A"]["value"] for k, v in els.items()})
    if FAILED:
        print("FAILED downloads:", json.dumps(FAILED, indent=1))
    statuses = [v["status"] for p in ("cardiomyocyte", "rbc", "skin", "neuron") for v in out[p].values()
                if isinstance(v, dict) and "status" in v]
    note = (f"genes REN/SCN5A/UGT1A1 (Ensembl {release}), neuron NMO {NMO_ID} ({len(a)} samples), Nav1.5 {PDB_ID} ({n} C-alpha), "
            f"cells.json ({statuses.count('VERIFIED')} VERIFIED, {statuses.count('TO_CONFIRM')} TO_CONFIRM, "
            f"{statuses.count('NOT_YET_EXTRACTED')} NOT_YET_EXTRACTED)")
    log_status("data/bio", "done" if not FAILED else "changed", note + (f"; failed: {list(FAILED)}" if FAILED else ""))


if __name__ == "__main__":
    main()
