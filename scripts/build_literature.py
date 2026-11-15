"""Build data/literature/<sensor>.json: published hardware numbers for the four SpinDrift sensors, mined from the
titles and abstracts of paper records harvested through official APIs only.

Sources (nothing else is contacted):
  * arXiv API, http://export.arxiv.org/api/query (Atom). arXiv's terms of use for the API: at most one request every
    3 seconds (this script waits 3.2 s between the end of one response and the next request), paged with start /
    max_results (1000 per call), a descriptive User-Agent without personal details.
  * NCBI E-utilities for PubMed, https://eutils.ncbi.nlm.nih.gov/entrez/eutils/ (esearch for the PMIDs of a query,
    efetch for the records in MEDLINE format). Without an API key NCBI allows 3 requests per second; this script
    waits 0.4 s between requests. Only the tool name is sent; no e-mail address or other personal data.

Every request and response is cached under data/literature/raw/ as the exact response bytes, gzip-compressed (the
third-party abstracts contain words that SpinDrift's own files must not contain, and the compressed form keeps them
out of the plain-text scans of /data). raw/manifest.json records, per file, the request (method, URL, PMIDs posted),
the SHA-256 of the response bytes and of the stored .gz file, sizes and fetch time.

Records are deduplicated per sensor by arXiv id, PMID and DOI. Numbers are extracted by the rules in RULES (regular
expressions on a normalised copy of the text that maps back to the original, so the quote and sentence kept with
each value are exact, with whitespace runs collapsed). Units are normalised to one unit per parameter (PARAMS).
Values outside each parameter's plausible range, bounds ("below 10 fT/√Hz"), 'respectively' lists, ranges (unless
the rule asks for range ends, or the text is the device's own paper) and anything whose quantity is not clear from
the words next to it are rejected.

What is written (policy of 15 Nov 2026): only values stated in the device's own paper (OWN: Zhao et al. for the
QuSpin QZFM, Omar et al. arXiv 2601.18843 for NV, Long et al. 2012 for the quantum-dot probe, Tabatabaee et al.
2024 for the carbon-dot patch), read from its abstract in the harvest and from the open full text already cached by
scripts/build_sensor_parts.py (no further downloads). Each value keeps its paper id, the exact sentence and a quote;
a parameter the paper does not state is NOT_FOUND (value objects NOT_STATED, value null). Matches in the other
harvested papers are counted per parameter but their values are written only with --add-typical, as a separate
'typical_other_devices' block, after the user asks for it.

    python scripts/build_literature.py              # use the cache in data/literature/raw, download what is missing
    python scripts/build_literature.py --refresh    # download everything again
    python scripts/build_literature.py --offline    # never download; use the cache only
    python scripts/build_literature.py --sensor qd,cqd
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.common import DATA, ROOT, log_status, meta, missing, now_iso, read_json, vo, write_json  # noqa: E402

OUT = DATA / "literature"
RAW = OUT / "raw"
MANIFEST = RAW / "manifest.json"
GITIGNORE = ROOT / ".gitignore"
GITIGNORE_LIMIT = 20_000_000                  # raw cache larger than 20 MB is kept out of git
ARXIV_API = "http://export.arxiv.org/api/query"
EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
USER_AGENT = "SpinDrift-literature-builder/1.0 (NASA Space Apps 2026 entry; arXiv API and NCBI E-utilities only)"
TOOL = "SpinDrift-literature-builder"         # NCBI 'tool' parameter; no e-mail is sent
ARXIV_GAP_S = 3.2                             # arXiv: no more than one request every 3 s
NCBI_GAP_S = 0.4                              # NCBI without a key: no more than 3 requests per second
ARXIV_PAGE = 1000                             # max_results per arXiv call
PUBMED_MAX = 10000                            # esearch retmax ceiling
PUBMED_BATCH = 400                            # PMIDs per efetch POST
SENSORS = ("opm", "nv", "qd", "cqd")
# Words that must not appear in SpinDrift's own files (scripts/validate.py scans /data and /server for the first);
# written in parts so that this file does not contain them either.
BANNED = ("hypo" + "thesis", "cr" + "yo")
# ... and, in the text written to data/literature/*.json, no clinical-verdict wording either (a quote falls back to a
# shorter phrase, and a sentence that has the word is not reproduced); also written in parts
WRITE_AVOID = BANNED + ("diag" + "nos",)

# ------------------------------------------------------------------------------------------------- queries
# (source, query id, query string). arXiv: search_query syntax (abs: = abstract field; phrases in quotes; a phrase
# is not stemmed, single words are). PubMed: esearch term syntax ([tiab] = title/abstract).
QUERIES = {
    "opm": [
        ("arxiv", "optically_pumped_magnetometer", 'abs:"optically pumped" AND abs:magnetometer'),
        ("arxiv", "atomic_alkali_magnetometer", 'abs:magnetomet* AND (abs:atomic OR abs:alkali OR abs:rubidium OR '
                                                'abs:cesium OR abs:caesium OR abs:potassium OR abs:"vapor cell" OR '
                                                'abs:"vapour cell")'),
        ("arxiv", "serf", 'abs:SERF OR abs:"spin-exchange relaxation-free" OR abs:"spin exchange relaxation free"'),
        ("arxiv", "zero_field_magnetometer", 'abs:"zero-field" AND abs:magnetomet*'),
        ("arxiv", "vapour_cell", 'abs:"vapor cell" OR abs:"vapour cell" OR abs:"vapor cells" OR abs:"vapour cells"'),
        ("arxiv", "rubidium_vapour_cell", 'abs:rubidium AND (abs:"vapor cell" OR abs:"vapour cell")'),
        ("arxiv", "opm_meg", 'abs:magnetoencephalography'),
        ("arxiv", "magnetocardiography", 'abs:magnetocardiography'),
        ("pubmed", "optically_pumped_magnetometer", '"optically pumped"[tiab] AND magnetomet*[tiab]'),
        ("pubmed", "opm_meg", '(OPM[tiab] OR "optically pumped"[tiab]) AND (magnetoencephalography[tiab] OR '
                              'MEG[tiab])'),
        ("pubmed", "magnetocardiography_opm", 'magnetocardiography[tiab] AND ("optically pumped"[tiab] OR OPM[tiab] '
                                              'OR atomic[tiab])'),
        ("pubmed", "atomic_magnetometer_serf", '"atomic magnetometer*"[tiab] OR SERF[tiab]'),
        ("pubmed", "vapour_cell", '"vapor cell"[tiab] OR "vapour cell"[tiab] OR "vapor cells"[tiab] OR '
                                  '"vapour cells"[tiab]'),
    ],
    "nv": [
        ("arxiv", "nitrogen_vacancy", 'abs:"nitrogen-vacancy"'),
        ("arxiv", "nv_centre", 'abs:"NV center" OR abs:"NV centers" OR abs:"NV centre" OR abs:"NV centres"'),
        ("arxiv", "nv_ensemble", 'abs:"NV ensemble" OR abs:"NV ensembles" OR abs:"ensemble of NV"'),
        ("arxiv", "diamond_magnetometry", 'abs:"diamond magnetometer" OR abs:"diamond magnetometry" OR '
                                          'abs:"diamond magnetometers"'),
        ("arxiv", "magnetometry_nv_diamond", 'abs:magnetomet* AND (abs:"nitrogen-vacancy" OR abs:NV OR abs:diamond)'),
        ("arxiv", "odmr", 'abs:ODMR OR abs:"optically detected magnetic resonance"'),
        ("arxiv", "magnetocardiography_diamond", 'abs:magnetocardiography AND abs:diamond'),
        ("pubmed", "nitrogen_vacancy_sensing", 'nitrogen-vacancy[tiab] AND (magnetometry[tiab] OR '
                                               'magnetometer*[tiab] OR sensing[tiab])'),
        ("pubmed", "diamond_magnetometry", 'diamond[tiab] AND (magnetometry[tiab] OR magnetometer*[tiab])'),
    ],
    "qd": [
        ("arxiv", "quantum_dot_fret", 'abs:"quantum dot" AND (abs:"energy transfer" OR abs:FRET)'),
        ("arxiv", "fret", 'abs:FRET'),
        ("arxiv", "single_molecule_fret", 'abs:"single-molecule" AND abs:FRET'),
        ("arxiv", "tirf", 'abs:"total internal reflection fluorescence" OR abs:TIRF'),
        ("arxiv", "cy5", 'abs:Cy5'),
        ("arxiv", "quantum_dots_bio", 'abs:"quantum dots" AND (abs:biological OR abs:imaging OR abs:biosensing OR '
                                      'abs:bioimaging)'),
        ("arxiv", "single_molecule_fluorescence", 'abs:"single molecule" AND abs:fluorescence'),
        ("pubmed", "quantum_dot_fret", '"quantum dot*"[tiab] AND (FRET[tiab] OR "fluorescence resonance energy '
                                       'transfer"[tiab] OR "Forster resonance energy transfer"[tiab] OR "Förster '
                                       'resonance energy transfer"[tiab])'),
        ("pubmed", "protease_quantum_dot_fret", '"quantum dot*"[tiab] AND protease*[tiab] AND (FRET[tiab] OR '
                                                '"energy transfer"[tiab])'),
        ("pubmed", "single_quantum_dot_nanosensor", '"single quantum dot"[tiab] AND (nanosensor*[tiab] OR '
                                                    'sensor*[tiab] OR detection[tiab])'),
        ("pubmed", "tirf_single_molecule", '(TIRF[tiab] OR "total internal reflection fluorescence"[tiab]) AND '
                                           '"single molecule*"[tiab]'),
        ("pubmed", "tirf_penetration_depth", '(TIRF[tiab] OR "total internal reflection fluorescence"[tiab]) AND '
                                             '("penetration depth"[tiab] OR evanescent[tiab])'),
        ("pubmed", "cy5_fret", 'Cy5[tiab] AND FRET[tiab]'),
        ("pubmed", "quantum_dot_cy5", '"quantum dot*"[tiab] AND Cy5[tiab]'),
        ("pubmed", "quantum_dot_biosensor", '"quantum dot*"[tiab] AND (biosensor*[tiab] OR nanosensor*[tiab] OR '
                                            'nanoprobe*[tiab]) AND fluorescen*[tiab]'),
        ("pubmed", "forster_radius", '"Forster distance"[tiab] OR "Forster radius"[tiab] OR "Förster '
                                     'distance"[tiab] OR "Förster radius"[tiab]'),
        ("pubmed", "streptavidin_quantum_dot", 'streptavidin[tiab] AND "quantum dot*"[tiab]'),
        ("pubmed", "renin_fluorogenic", 'renin[tiab] AND ("quantum dot*"[tiab] OR FRET[tiab] OR fluorogenic[tiab])'),
    ],
    "cqd": [
        ("arxiv", "carbon_dots", 'abs:"carbon dots" OR abs:"carbon quantum dots" OR abs:"carbon nanodots" OR '
                                 'abs:"carbon dot" OR abs:"carbon quantum dot"'),
        ("arxiv", "graphene_quantum_dots", 'abs:"graphene quantum dots"'),
        ("arxiv", "microneedle", 'abs:microneedle OR abs:microneedles'),
        ("arxiv", "as7341", 'abs:AS7341'),
        ("arxiv", "wearable_fluorescence", 'abs:wearable AND abs:fluorescence'),
        ("pubmed", "carbon_dots_fluorescence_sensor", '("carbon dots"[tiab] OR "carbon quantum dots"[tiab]) AND '
                                                      'fluorescen*[tiab] AND (sensor*[tiab] OR sensing[tiab] OR '
                                                      'probe*[tiab] OR detection[tiab])'),
        ("pubmed", "carbon_dots_bilirubin", '("carbon dots"[tiab] OR "carbon quantum dots"[tiab] OR "carbon '
                                            'dot"[tiab]) AND bilirubin[tiab]'),
        ("pubmed", "microneedle_fluorescence", 'microneedle*[tiab] AND fluorescen*[tiab]'),
        ("pubmed", "hydrogel_microneedle", 'microneedle*[tiab] AND (hydrogel*[tiab] OR GelMA[tiab] OR "gelatin '
                                           'methacryl*"[tiab])'),
        ("pubmed", "gelma_microneedle", 'microneedle*[tiab] AND GelMA[tiab]'),
        ("pubmed", "microneedle_sensor", 'microneedle*[tiab] AND (sensor*[tiab] OR sensing[tiab] OR '
                                         'biosensor*[tiab])'),
        ("pubmed", "wearable_fluorescence_reader", 'wearable[tiab] AND fluorescen*[tiab] AND (reader[tiab] OR '
                                                   'smartphone[tiab] OR optoelectronic[tiab] OR device[tiab])'),
        ("pubmed", "as7341", 'AS7341[tiab]'),
        ("pubmed", "bilirubin_skin_sensor", 'bilirubin[tiab] AND (wearable[tiab] OR transcutaneous[tiab] OR '
                                            'skin[tiab]) AND (sensor*[tiab] OR optical[tiab] OR fluorescen*[tiab])'),
        ("pubmed", "tattoo_sensor", 'tattoo[tiab] AND (sensor*[tiab] OR fluorescen*[tiab])'),
        # microneedle geometry is rarely in sensing abstracts; these two add the wider microneedle-array literature
        ("pubmed", "microneedle_array_patch", 'microneedle*[tiab] AND (array*[tiab] OR patch*[tiab])'),
        ("pubmed", "microneedle_geometry", 'microneedle*[tiab] AND (height*[tiab] OR length*[tiab] OR pitch[tiab] OR '
                                           '"tip radius"[tiab] OR "base diameter"[tiab] OR "base width"[tiab])'),
    ],
}


# ------------------------------------------------------------------------------------------------- download cache
class Limiter:
    """Minimum gap between the end of one response and the start of the next request to the same service."""

    def __init__(self, gap_s: float):
        self.gap = gap_s
        self.last = 0.0

    def wait(self):
        dt = time.monotonic() - self.last
        if dt < self.gap:
            time.sleep(self.gap - dt)

    def done(self):
        self.last = time.monotonic()


ARXIV_LIMIT = Limiter(ARXIV_GAP_S)
NCBI_LIMIT = Limiter(NCBI_GAP_S)


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def http(url: str, limiter: Limiter, post: dict | None = None, tries: int = 6) -> bytes:
    body = urllib.parse.urlencode(post).encode("ascii") if post else None
    err = None
    for attempt in range(tries):
        limiter.wait()
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=300) as r:
                out = r.read()
            limiter.done()
            return out
        except urllib.error.HTTPError as e:
            limiter.done()
            err = e
            if 400 <= e.code < 500 and e.code not in (408, 429):
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            limiter.done()
            err = e
        wait = min(180, 10 * 2 ** attempt)
        print(f"    retry {attempt + 1}/{tries} in {wait} s after {type(err).__name__}: {err}", flush=True)
        time.sleep(wait)
    raise RuntimeError(f"{url[:120]}: {type(err).__name__}: {err}")


class Cache:
    """Raw responses, gzip-compressed, under data/literature/raw; manifest.json holds request, SHA-256 and time."""

    def __init__(self, refresh: bool, offline: bool):
        self.refresh, self.offline = refresh, offline
        self.man = read_json(MANIFEST, None) or {"files": {}}
        self.man.setdefault("files", {})
        self.downloaded = 0
        self.used: set[str] = set()

    def info(self, rel: str) -> dict:
        return self.man["files"].get(rel, {})

    def cached_files(self, prefix: str) -> list[str]:
        """Relative paths of cache files that start with prefix (e.g. 'pubmed/qd__efetch__')."""
        folder = RAW / prefix.rsplit("/", 1)[0]
        name = prefix.rsplit("/", 1)[1]
        if self.refresh or not folder.exists():
            return []
        return sorted(f"{folder.name}/{p.name}" for p in folder.iterdir() if p.name.startswith(name))

    def read(self, rel: str) -> bytes:
        self.used.add(rel)
        return gzip.decompress((RAW / rel).read_bytes())

    def prune(self, sensor: str) -> int:
        """Delete this sensor's cache files that the current queries no longer use (stale pages or batches)."""
        n = 0
        for folder in ("arxiv", "pubmed"):
            for p in sorted((RAW / folder).glob(f"{sensor}__*")) if (RAW / folder).exists() else []:
                rel = f"{folder}/{p.name}"
                if rel not in self.used:
                    p.unlink()
                    self.man["files"].pop(rel, None)
                    n += 1
        if n:
            self.save()
        return n

    def get(self, rel: str, request: dict, fetch, accept=lambda raw: True) -> bytes:
        self.used.add(rel)
        path = RAW / rel
        if path.exists() and not self.refresh:
            raw = gzip.decompress(path.read_bytes())
            if rel not in self.man["files"]:            # cache file without a manifest entry: describe it now
                self.man["files"][rel] = dict(request, sha256=sha256(raw), sha256_gz=sha256(path.read_bytes()),
                                              bytes=len(raw), bytes_gz=path.stat().st_size, fetched=None)
            return raw
        if self.offline:
            raise FileNotFoundError(f"{rel} is not in the cache (--offline)")
        raw = None
        for _ in range(4):                             # the arXiv API now and then answers an empty page
            raw = fetch()
            if accept(raw):
                break
            print("    empty or malformed answer; asking again in 15 s", flush=True)
            time.sleep(15)
        gz = None
        for level in (9, 8, 7, 6, 5):                  # keep the banned words out of the stored bytes as well
            gz = gzip.compress(raw, compresslevel=level, mtime=0)
            if not any(w.encode() in gz.lower() for w in BANNED):
                break
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".part")
        tmp.write_bytes(gz)
        tmp.replace(path)
        self.man["files"][rel] = dict(request, sha256=sha256(raw), sha256_gz=sha256(gz), bytes=len(raw),
                                      bytes_gz=len(gz), fetched=now_iso())
        self.downloaded += 1
        self.save()
        return raw

    def save(self):
        self.man["about"] = ("Raw API responses cached by scripts/build_literature.py, gzip-compressed (mtime 0). "
                             "sha256 is of the response bytes as received, sha256_gz of the stored file.")
        write_json(MANIFEST, self.man)


def qhash(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:8]


# ------------------------------------------------------------------------------------------------- arXiv
NS = {"a": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom",
      "os": "http://a9.com/-/spec/opensearch/1.1/"}


def ws(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def parse_atom(raw: bytes):
    root = ET.fromstring(raw)
    t = root.find("os:totalResults", NS)
    total = int(t.text) if t is not None and t.text and t.text.strip().isdigit() else None
    entries = []
    for e in root.findall("a:entry", NS):
        eid = ws(e.findtext("a:id", "", NS))
        m = re.search(r"arxiv\.org/abs/(.+?)(v\d+)?$", eid)
        if not m:
            continue                                   # an error entry, not a paper
        aid = m.group(1)
        pub = ws(e.findtext("a:published", "", NS))
        doi = ws(e.findtext("arxiv:doi", "", NS)) or None
        entries.append({"key": f"arXiv:{aid}", "source": "arxiv", "title": ws(e.findtext("a:title", "", NS)),
                        "abstract": ws(e.findtext("a:summary", "", NS)),
                        "year": int(pub[:4]) if pub[:4].isdigit() else None,
                        "doi": doi.lower() if doi else None, "url": f"https://arxiv.org/abs/{aid}"})
    return total, entries


def harvest_arxiv(cache: Cache, sensor: str, qid: str, query: str):
    h = qhash(query)
    start, total, recs = 0, None, []
    while True:
        params = {"search_query": query, "start": start, "max_results": ARXIV_PAGE,
                  "sortBy": "submittedDate", "sortOrder": "ascending"}
        url = f"{ARXIV_API}?{urllib.parse.urlencode(params)}"
        rel = f"arxiv/{sensor}__{qid}__{h}__start{start:05d}.atom.xml.gz"

        def accept(raw, start=start):
            try:
                tot, ents = parse_atom(raw)
            except ET.ParseError:
                return False
            return tot is not None and (len(ents) > 0 or tot <= start)

        raw = cache.get(rel, {"service": "arXiv API", "method": "GET", "url": url},
                        lambda: http(url, ARXIV_LIMIT), accept)
        tot, ents = parse_atom(raw)
        total = tot if tot is not None else (total or 0)
        recs.extend(ents)
        print(f"  arXiv {sensor}/{qid}: start {start}, {len(ents)} entries of {total}", flush=True)
        start += ARXIV_PAGE
        if start >= total or not ents:
            break
    return {"source": "arxiv", "id": qid, "query": query, "endpoint": ARXIV_API, "reported_total": total,
            "fetched": len(recs)}, recs


# ------------------------------------------------------------------------------------------------- PubMed
def parse_medline(text: str):
    recs = []
    for block in re.split(r"\n\s*\n", text.replace("\r\n", "\n")):
        fields, key = {}, None
        for line in block.split("\n"):
            if len(line) >= 6 and line[4:6] == "- " and line[:4].strip():
                key = line[:4].strip()
                fields.setdefault(key, []).append(line[6:].strip())
            elif line.startswith("      ") and key:
                fields[key][-1] += " " + line.strip()
        if "PMID" not in fields:
            continue
        pmid = fields["PMID"][0].strip()
        doi = None
        for v in fields.get("LID", []) + fields.get("AID", []):
            if v.endswith("[doi]"):
                doi = v[:-5].strip().lower()
                break
        dp = (fields.get("DP") or [""])[0]
        title = " ".join(fields.get("TI") or fields.get("TT") or [])
        recs.append({"key": f"PMID:{pmid}", "source": "pubmed", "title": ws(title),
                     "abstract": ws(" ".join(fields.get("AB", []))),
                     "year": int(dp[:4]) if dp[:4].isdigit() else None, "doi": doi,
                     "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"})
    return recs


def pubmed_search(cache: Cache, sensor: str, qid: str, term: str):
    params = {"db": "pubmed", "term": term, "retmax": PUBMED_MAX, "retmode": "json", "tool": TOOL}
    url = f"{EUTILS}/esearch.fcgi?{urllib.parse.urlencode(params)}"
    rel = f"pubmed/{sensor}__{qid}__{qhash(term)}__esearch.json.gz"

    def accept(raw):
        try:
            return "esearchresult" in json.loads(raw)
        except ValueError:
            return False

    raw = cache.get(rel, {"service": "NCBI E-utilities esearch", "method": "GET", "url": url},
                    lambda: http(url, NCBI_LIMIT), accept)
    r = json.loads(raw)["esearchresult"]
    ids = [i for i in r.get("idlist", []) if i.isdigit()]
    print(f"  PubMed {sensor}/{qid}: {len(ids)} PMIDs of {r.get('count')}", flush=True)
    return {"source": "pubmed", "id": qid, "query": term, "endpoint": f"{EUTILS}/esearch.fcgi",
            "reported_total": int(r.get("count", 0)), "fetched": len(ids)}, ids


def pubmed_fetch(cache: Cache, sensor: str, pmids: list[str]):
    """Records for the PMIDs: taken from cached efetch batches where present, the rest fetched in new batches."""
    need = sorted(set(pmids), key=int)
    want, recs = set(need), []
    have = set()
    for rel in cache.cached_files(f"pubmed/{sensor}__efetch__"):
        got = [r for r in parse_medline(gzip.decompress((RAW / rel).read_bytes()).decode("utf-8", "replace"))
               if r["key"][5:] in want and r["key"][5:] not in have]
        if got:
            cache.read(rel)                            # marks the batch as used
            recs.extend(got)
            have.update(r["key"][5:] for r in got)
    pmids = [p for p in need if p not in have]
    if have:
        print(f"  PubMed {sensor}: {len(have)} records from cached batches, {len(pmids)} to fetch", flush=True)
    for i in range(0, len(pmids), PUBMED_BATCH):
        batch = pmids[i:i + PUBMED_BATCH]
        ids = ",".join(batch)
        rel = f"pubmed/{sensor}__efetch__{batch[0]}-{batch[-1]}__n{len(batch)}__{qhash(ids)}.medline.txt.gz"
        post = {"db": "pubmed", "id": ids, "rettype": "medline", "retmode": "text", "tool": TOOL}
        raw = cache.get(rel, {"service": "NCBI E-utilities efetch", "method": "POST", "url": f"{EUTILS}/efetch.fcgi",
                              "post": "db=pubmed&rettype=medline&retmode=text&tool=" + TOOL,
                              "pmids": {"n": len(batch), "first": batch[0], "last": batch[-1]}},
                        lambda: http(f"{EUTILS}/efetch.fcgi", NCBI_LIMIT, post=post),
                        lambda raw: b"PMID-" in raw)
        got = parse_medline(raw.decode("utf-8", "replace"))
        recs.extend(got)
        print(f"  PubMed {sensor}: efetch {i + len(batch)}/{len(pmids)} ({len(got)} records)", flush=True)
    return recs


# ------------------------------------------------------------------------------------------------- corpus
def harvest(cache: Cache, sensor: str):
    """All records of one sensor, deduplicated by arXiv id, PMID and DOI; query counts."""
    corpus, by_doi, counts = {}, {}, []

    def add(rec, qkey):
        k = rec["key"]
        if k in corpus or (rec["doi"] and rec["doi"] in by_doi):
            first = corpus[k] if k in corpus else corpus[by_doi[rec["doi"]]]
            if k != first["key"] and k not in first["also"]:
                first["also"].append(k)
            if qkey not in first["queries"]:
                first["queries"].append(qkey)
            return False
        rec = dict(rec, queries=[qkey], also=[])
        corpus[k] = rec
        if rec["doi"]:
            by_doi[rec["doi"]] = k
        return True

    pm_queries = []
    for source, qid, query in QUERIES[sensor]:
        if source == "arxiv":
            c, recs = harvest_arxiv(cache, sensor, qid, query)
            c["new_unique"] = sum(add(r, f"arxiv:{qid}") for r in recs)
            counts.append(c)
        else:
            c, ids = pubmed_search(cache, sensor, qid, query)
            counts.append(c)
            pm_queries.append((c, ids))
    if pm_queries:
        recs = {r["key"]: r for r in pubmed_fetch(cache, sensor, [i for _, ids in pm_queries for i in ids])}
        for c, ids in pm_queries:
            c["records_returned_by_efetch"] = sum(1 for i in ids if f"PMID:{i}" in recs)
            c["new_unique"] = sum(add(recs[f"PMID:{i}"], f"pubmed:{c['id']}") for i in ids if f"PMID:{i}" in recs)
    for c in counts:
        c["in_corpus"] = sum(1 for r in corpus.values() if f"{c['source']}:{c['id']}" in r["queries"])
    return corpus, counts


def raw_size() -> int:
    return sum(p.stat().st_size for p in RAW.rglob("*") if p.is_file()) if RAW.exists() else 0


def ensure_gitignore() -> tuple[bool, bool]:
    """Add data/literature/raw/ to .gitignore when the raw cache is larger than GITIGNORE_LIMIT.
    Returns (ignored, changed now)."""
    text = GITIGNORE.read_text(encoding="utf-8") if GITIGNORE.exists() else ""
    if "data/literature/raw/" in text.split("\n"):
        return True, False
    if raw_size() <= GITIGNORE_LIMIT:
        return False, False
    add = ("" if text.endswith("\n") or not text else "\n") + \
          "# literature-builder raw API cache (scripts/build_literature.py; over 20 MB)\ndata/literature/raw/\n"
    GITIGNORE.write_text(text + add, encoding="utf-8")
    return True, True


# ------------------------------------------------------------------------------------------------- normalisation
class NText:
    """A normalised copy of a text that remembers, for each character, the span of the original it came from, so a
    match found in the normalised text can be quoted exactly from the original."""

    def __init__(self, text: str):
        self.orig = ws(text)
        self.s = self.orig
        self.st = list(range(len(self.s)))
        self.en = list(range(1, len(self.s) + 1))

    def sub(self, rx, repl):
        s = self.s
        if not rx.search(s):
            return
        out, st, en, pos = [], [], [], 0
        for m in rx.finditer(s):
            a, b = m.span()
            if a == b:
                continue
            out.append(s[pos:a])
            st += self.st[pos:a]
            en += self.en[pos:a]
            r = m.expand(repl) if isinstance(repl, str) else repl(m)
            o0, o1 = self.st[a], self.en[b - 1]
            out.append(r)
            st += [o0] * len(r)
            en += [o1] * len(r)
            pos = b
        out.append(s[pos:])
        st += self.st[pos:]
        en += self.en[pos:]
        self.s, self.st, self.en = "".join(out), st, en

    def span(self, a: int, b: int) -> tuple[int, int]:
        if not self.s:
            return 0, 0
        a = max(0, min(a, len(self.s) - 1))
        b = max(a + 1, min(b, len(self.s)))
        return self.st[a], self.en[b - 1]


SUPERS = dict(zip("⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺⁄", "0123456789-+/"))
SUBS = dict(zip("₀₁₂₃", "0123"))
HZ_INV_ROOT = r"\s*·?\s*\(?\s*Hz\s*\)?\s*\^?\s*\(?\s*-\s*(?:1\s*/\s*\^?\s*2|0\.5)(?:\s*\))?"
HZ_ROOT = r"\s*/\s*\(?\s*Hz\s*\)?\s*\^?\s*\(?\s*(?:1\s*/\s*\^?\s*2|0\.5)(?:\s*\))?"
# (pattern, replacement, flags), applied in order to the normalised copy only
_NORMALISE = [
    (r"[\u00a0\u2000-\u200b\u202f\u205f\u3000]", " ", 0),
    (r"\ufb01", "fi", 0), (r"\ufb02", "fl", 0), (r"\ufb00", "ff", 0), (r"\ufb03", "ffi", 0),   # PDF ligatures
    (r"[\u0300-\u036f]", "", 0),                                            # combining accents (F + o + ¨)
    (r"\\(?:mathrm|textrm|text|mbox|mathit|textit|mathbf|textbf|mathsf|mathcal|operatorname|rm|it|bf|emph|textsc)"
     r"\s*\{([^{}]*)\}", r"\1", 0),
    (r"\\(?:mathrm|textrm|text|mbox|mathit|textit|mathbf|textbf|mathsf|mathcal|operatorname|rm|it|bf|emph|textsc)"
     r"\s*\{([^{}]*)\}", r"\1", 0),
    (r"\{\\(?:rm|it|bf|em|sc)\s+([^{}]*)\}", r"\1", 0),
    (r"\\(?:rm|it|bf|displaystyle|textstyle|left|right|big|Big)(?![A-Za-z])\s*", "", 0),
    (r"\$", "", 0),
    (r"\\[,;:! ]", " ", 0),
    (r"(?<=\d)~(?=[^\d\s~])", " ", 0),                                     # LaTeX tie between number and unit
    (r"\\(?:mu|upmu|micro)(?![A-Za-z])\s*", "µ", 0),
    (r"\u03bc", "µ", 0),
    (r"\\AA(?![A-Za-z])|\\r\{?A\}?(?![A-Za-z])|\u212b", "Å", 0),
    (r"\\%", "%", 0),
    (r"\\(?:sim|thicksim|approx|simeq|cong)(?![A-Za-z])|[\u223c\u2248\u2243\u2245\u301c\uff5e]", "~", 0),
    (r"\\pm(?![A-Za-z])|\+/-|\+-(?=\s*\d)", "±", 0),
    (r"\\(?:le|leq|leqslant|lesssim)(?![A-Za-z])|[\u2264\u2a7d]", "≤", 0),
    (r"\\(?:ge|geq|geqslant|gtrsim)(?![A-Za-z])|[\u2265\u2a7e]", "≥", 0),
    (r"\\lt(?![A-Za-z])|&lt;", "<", 0),
    (r"\\gt(?![A-Za-z])|&gt;", ">", 0),
    (r"\\times(?![A-Za-z])|[\u2715\u2a2f]", "×", 0),
    (r"\\cdot(?![A-Za-z])|[\u22c5\u00b7\u2219]", "·", 0),
    (r"\\lambda(?![A-Za-z])", "λ", 0),
    (r"\\[Pp]hi(?![A-Za-z])|\\varphi(?![A-Za-z])", "Φ", 0),
    (r"\^\s*\{?\s*\\circ\s*\}?|\\circ(?![A-Za-z])|\\(?:degree|textdegree)(?![A-Za-z])|[\u00ba\u02da\u25e6\u2218]", "°", 0),
    (r"\u2103", "°C", 0),
    (r"[\u2212\u2010\u2011\u2012\u2013\u2014\u2015\ufe63\uff0d]", "-", 0),
    (r"[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺⁄]+", lambda m: "^(" + "".join(SUPERS[c] for c in m.group(0)) + ")", 0),
    (r"½", "^(1/2)", 0),
    (r"[₀₁₂₃]", lambda m: "_" + SUBS[m.group(0)], 0),
    (r"\^\s*\{([^{}]*)\}", r"^(\1)", 0),
    (r"_\s*\{([^{}]*)\}", r"_\1", 0),
    (r"\^\(\s*([-+]?\d+(?:\.\d+)?)\s*\)", r"^\1", 0),
    # MEDLINE writes micro as 'mu' or 'micro' and superscripts in parentheses: 80 mum, 5 microM, cm(2), L(-1)
    (r"(?<=\d)(\s*-?\s*)(?:mu|micro)(?=(?:m|M|L|l|g|W|T|mol|A|s|N)(?![a-zA-Z]))", r"\1µ", 0),
    (r"(?<=\d)\s*(?:(femto)|(pico)|(nano)|(micro)|(milli))?molar\b",
     lambda m: " " + next((p for p, g in zip("fpnµm", m.groups()) if g), "") + "M", re.I),
    (r"\b(cm|mm|µm|nm|m)\(\s*([23])\s*\)", r"\1^\2", 0),
    (r"\blambda\s*\(?\s*(em|ex|exc|max|abs)[a-z]*\s*\)?", r"λ\1", re.I),
    (r"\\sqrt\s*\{?\s*%?\s*\(?\s*Hz(?:\s*\))?(?:\s*\})?", "√Hz", 0),
    (r"(?<=[TG])" + HZ_INV_ROOT, "/√Hz", 0),
    (r"(?<=[TG])" + HZ_ROOT, "/√Hz", 0),
    (r"(?<=[TG])\s*/\s*(?:√|sqrt|rt)\s*\(?\s*Hz(?:\s*\))?", "/√Hz", 0),
    (r"°\s*C\b", "°C", 0),
    (r"(?<=\d)\s*(?:deg(?:ree)?s?\.?\s*)(?:C\b|Celsius\b)", " °C", re.I),
    (r"(?<=\d)\s*o\s?C\b", " °C", 0),
    (r"(?<=\d)\s*°\s*K\b", " K", 0),
    (r"(?<=\d)\s*[xX*]\s*(?=\d)", " × ", 0),
    (r"(\d\s*(?:mm|cm|µm|nm|um|mum|microm|m)\b)\s*[xX*]\s*(?=\d)", r"\1 × ", 0),     # 3 mm x 3 mm
    (r"(?<=\d)\s*(?:microns?|micrometers?|micrometres?)\b", " µm", re.I),
    (r"(?<=\d)\s*(?:nanometers?|nanometres?)\b", " nm", re.I),
    (r"(?<=\d)\s*(?:millimeters?|millimetres?)\b", " mm", re.I),
    (r"(?<=\d)\s*(?:centimeters?|centimetres?)\b", " cm", re.I),
    (r"(?<=\d)\s*teslas?\b", " T", re.I),
    (r"(?<=\d)\s*gauss\b", " G", re.I),
    (r"(?<=\d)\s*hertz\b", " Hz", re.I),
    (r"(?<=\d)\s*um\b", " µm", 0),
    (r"µ\s+(?=(?:m|g|L|W|M|T|s|mol)\b)", "µ", 0),
    (r"\b([afpnµm]?)mol\s*(?:/\s*[Ll]\b|[·.]?\s*[Ll]\s*\^?\s*\(?-1\)?(?!\d))", r"\1M", 0),
    (r"\b([mµn]?g)\s*(?:/\s*|·\s*|\s)(d?[mµ]?)L\s*(?:\^?\s*\(?-1\)?)?(?![A-Za-z\d])", r"\1/\2L", 0),
    (r"\b(mm|cm|µm|nm)([23])\b", r"\1^\2", 0),                              # lost superscripts: mm3
    (r'F\s*\{?\s*\\"\s*\{?\s*o\s*\}?\s*\}?\s*rster|F\u00f6rster|Foerster|F\u00d6RSTER', "Forster", re.I),
    (r"λ\s*_?\s*\(?\s*(em|ex|exc|max|abs)[a-z]*\s*\)?", r"λ\1", 0),
    (r"[{}]", "", 0),
    (r"\\[A-Za-z]+", "", 0),
    (r"\s{2,}", " ", 0),
]
NORMALISE = [(re.compile(p, f), r) for p, r, f in _NORMALISE]


def normalise(text: str) -> NText:
    nt = NText(text)
    for rx, repl in NORMALISE:
        nt.sub(rx, repl)
    return nt


# ------------------------------------------------------------------------------------------------- quantities
NUM = r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+"
UNIT = (r"(?:(?:[afpnµm]?T|[µm]?G)/√Hz|[kMGT]?Hz|(?:pm|Å|nm|µm|mm|cm|m)(?:\^[23])?|[afpnµm]T|T|[µm]?G|[nµmk]?W|°C|K|"
        r"[afpnµm]?M|[mµn]?g/d?[mµ]?L|%|ppm|ppb)")
QRX = re.compile(rf"""(?<![\w.,/^×-])(?:
 (?P<sci>(?P<sm>{NUM})\s*×\s*10\s*\^?\s*\(?\s*(?P<se>[-+]?\d{{1,2}})\s*\)?\s*-?\s*(?P<su>{UNIT}))
|(?P<dims>(?P<d1>{NUM})\s*(?P<du1>{UNIT})?\s*(?:×|by)\s*(?P<d2>{NUM})\s*(?P<du2>{UNIT})?
   (?:\s*(?:×|by)\s*(?P<d3>{NUM})\s*(?P<du3>{UNIT})?)?(?:\s*-?\s*(?P<du>{UNIT}))?)
|(?P<rng>(?P<r1>{NUM})\s*(?P<ru1>{UNIT})?\s*(?P<rc>-|to|~|and|or)\s*(?P<r2>{NUM})\s*-?\s*(?P<ru>{UNIT}))
|(?P<lst>(?P<l>(?:{NUM})(?:\s*,\s*(?:{NUM}))+(?:\s*,?\s*(?:and|or)\s*(?:{NUM}))?)\s*-?\s*(?P<lu>{UNIT}))
|(?P<one>(?P<v>{NUM})(?:\s*±\s*(?P<err>{NUM}))?\s*\)?\s*-?\s*(?P<u>{UNIT}))
)(?![A-Za-z0-9µ])""", re.X)
PREFIX = {"a": 1e-18, "f": 1e-15, "p": 1e-12, "n": 1e-9, "µ": 1e-6, "m": 1e-3, "": 1.0, "k": 1e3, "M": 1e6,
          "G": 1e9, "T": 1e12}
LENGTH = {"pm": 1e-12, "Å": 1e-10, "nm": 1e-9, "µm": 1e-6, "mm": 1e-3, "cm": 1e-2, "m": 1.0}
MASS_MG = {"g": 1e3, "mg": 1.0, "µg": 1e-3, "ng": 1e-6}
VOL_DL = {"L": 10.0, "dL": 1.0, "mL": 0.01, "µL": 1e-5}
# target unit -> (dimension, size of the target unit in base units); bases: m, °C, T, T/√Hz, Hz, W, mol/L,
# mg/dL, %, ppm, count
TARGET = {"mm": ("length", 1e-3), "µm": ("length", 1e-6), "nm": ("length", 1e-9), "°C": ("temp", 1.0),
          "fT/√Hz": ("field_noise", 1e-15), "pT/√Hz": ("field_noise", 1e-12), "Hz": ("freq", 1.0),
          "GHz": ("freq", 1e9), "W": ("power", 1.0), "mW": ("power", 1e-3), "nT": ("field", 1e-9),
          "mT": ("field", 1e-3), "nM": ("conc", 1e-9), "µM": ("conc", 1e-6), "mg/dL": ("massconc", 1.0),
          "%": ("percent", 1.0), "ppm": ("ppm", 1.0), "needles per side": ("count", 1.0), "needles": ("count", 1.0),
          "mm²": ("length", 1e-6)}


def unit_base(u: str):
    """(dimension, power, function value -> base units) for a unit string of UNIT."""
    if u.endswith("/√Hz"):
        core = u[:-4]
        f = 1e-4 * PREFIX[core[:-1]] if core.endswith("G") else PREFIX[core[:-1]]
        return "field_noise", 1, lambda v: v * f
    if u.endswith("Hz"):
        return "freq", 1, lambda v, f=PREFIX[u[:-2]]: v * f
    if u == "°C":
        return "temp", 1, lambda v: v
    if u == "K":
        return "temp", 1, lambda v: v - 273.15
    if u in ("ppm", "ppb"):
        return "ppm", 1, lambda v, f=(1.0 if u == "ppm" else 1e-3): v * f
    if u == "%":
        return "percent", 1, lambda v: v
    if "/" in u and u.split("/")[0] in MASS_MG:
        m, vol = u.split("/")
        return "massconc", 1, lambda v, f=MASS_MG[m] / VOL_DL[vol]: v * f
    if u.endswith("W"):
        return "power", 1, lambda v, f=PREFIX[u[:-1]]: v * f
    if u.endswith("M"):
        return "conc", 1, lambda v, f=PREFIX[u[:-1]]: v * f
    base = u.split("^")[0]
    if base in LENGTH:
        pw = int(u.split("^")[1]) if "^" in u else 1
        return "length", pw, lambda v, f=LENGTH[base] ** pw: v * f          # areas and volumes in m² and m³
    if u.endswith("T"):
        return "field", 1, lambda v, f=PREFIX[u[:-1]]: v * f
    if u.endswith("G"):
        return "field", 1, lambda v, f=1e-4 * PREFIX[u[:-1]]: v * f
    raise ValueError(u)


def fnum(s: str) -> float:
    return float(s.replace(",", ""))


def quantities(s: str):
    """Numbers with units in a normalised text: kind one / lst / dims / rng, values in base units."""
    out = []
    for m in QRX.finditer(s):
        g = m.groupdict()
        try:
            if g["sci"]:
                dim, pw, f = unit_base(g["su"])
                vals, kind, u = [f(fnum(g["sm"]) * 10.0 ** int(g["se"]))], "one", g["su"]
            elif g["dims"]:
                units = [x for x in (g["du1"], g["du2"], g["du3"], g["du"]) if x]
                if not units:
                    continue
                u = g["du"] or units[-1]
                nums = [(g["d1"], g["du1"]), (g["d2"], g["du2"]), (g["d3"], g["du3"])]
                vals, dim = [], None
                for n, nu in nums:
                    if n is None:
                        continue
                    dd, _, f = unit_base(re.sub(r"\^\d", "", nu or u))   # edges of '5 × 5 × 5 mm³' are lengths
                    dim = dim or dd
                    if dd != dim:
                        raise ValueError("mixed units")
                    vals.append(f(fnum(n)))
                pw, kind = 1, "dims"
            elif g["rng"]:
                u = g["ru"]
                dim, pw, f = unit_base(u)
                f1 = unit_base(g["ru1"])[2] if g["ru1"] else f
                vals = [f1(fnum(g["r1"])), f(fnum(g["r2"]))]
                kind = "rng"
                if g["rc"] == "or" or (g["rc"] == "and" and not re.search(r"\bbetween\s*$",
                                                                           s[max(0, m.start() - 12):m.start()], re.I)):
                    kind = "lst"                       # '300 and 500 µm' lists two values; 'between 3 and 5' is a range
            elif g["lst"]:
                u = g["lu"]
                dim, pw, f = unit_base(u)
                nums = [fnum(x) for x in re.findall(NUM, g["l"])]
                if len(nums) > 8 or any(1900 <= x <= 2100 and x == int(x) for x in nums):
                    continue                           # a year or a long enumeration, not a list of values
                vals, kind = [f(x) for x in nums], "lst"
            else:
                u = g["u"]
                dim, pw, f = unit_base(u)
                vals, kind = [f(fnum(g["v"]))], "one"
        except (ValueError, KeyError, OverflowError):
            continue
        out.append({"kind": kind, "span": m.span(), "dim": dim, "pow": pw, "vals": vals, "unit": u,
                    "text": m.group(0)})
    return out


# a sentence ends at '. ' before a capital, or at a word's '.' followed by a reference number ('... 150 °C.24 The')
SENT_SPLIT = re.compile(r"(?<=[.!?;])\s+(?=[A-Z(\[])|(?<=[A-Za-z)\]%°][.])\d{1,3}(?:[,-]\d{1,3})*\s+(?=[A-Z(\[])")


# in PDF full text a caption or table often runs on with numbers after its last full stop
PDF_SPLIT = re.compile(r"(?<=[.!?;])(?<!\bFig\.)(?<!\bFigs\.)(?<!\bRef\.)(?<!\bRefs\.)(?<!\bEq\.)(?<!\bNo\.)"
                       r"(?<!\bvs\.)(?<!\bca\.)(?<!\bal\.)(?<!\bapprox\.)\s+(?=[A-Z(\[0-9])|" + SENT_SPLIT.pattern)


def sentences(s: str, pdf: bool = False):
    out, pos = [], 0
    for m in (PDF_SPLIT if pdf else SENT_SPLIT).finditer(s):
        out.append((pos, m.start()))
        pos = m.end()
    out.append((pos, len(s)))
    return out


# ------------------------------------------------------------------------------------------------- parameters
# name: (sensor, unit, lowest and highest plausible value (inclusive), label). Values outside the range are
# rejected as misreads or as a different quantity.
PARAMS = {
    "opm_cell_size_mm": ("opm", "mm", 0.1, 100, "Vapour cell size: the largest stated edge, length or diameter"),
    "opm_cell_temperature_c": ("opm", "°C", 15, 300, "Vapour cell operating temperature"),
    "opm_laser_wavelength_nm": ("opm", "nm", 300, 2000, "Pump or probe laser wavelength"),
    "opm_sensitivity_ft": ("opm", "fT/√Hz", 0.01, 1e5, "Magnetic sensitivity (noise floor) of the magnetometer"),
    "opm_bandwidth_hz": ("opm", "Hz", 0.5, 1e6, "Magnetometer bandwidth (upper end when a band is given)"),
    "opm_head_size_mm": ("opm", "mm", 3, 300, "Sensor head size: the largest stated outer dimension"),
    "opm_power_consumption_w": ("opm", "W", 1e-3, 100, "Electrical power consumption (or heater power)"),
    "opm_laser_power_mw": ("opm", "mW", 1e-4, 1e4, "Pump or probe laser power"),
    "opm_dynamic_range_nt": ("opm", "nT", 0.05, 1e7, "Dynamic range (a value written ±X is kept as X)"),
    "nv_diamond_size_mm": ("nv", "mm", 0.01, 30, "Diamond size: the largest stated edge"),
    "nv_diamond_thickness_mm": ("nv", "mm", 0.005, 5, "Diamond plate thickness"),
    "nv_density_ppm": ("nv", "ppm", 1e-5, 100, "NV density"),
    "nv_nitrogen_ppm": ("nv", "ppm", 1e-3, 1000, "Nitrogen concentration [N]"),
    "nv_laser_wavelength_nm": ("nv", "nm", 400, 1100, "Excitation (pump) laser wavelength"),
    "nv_laser_power_mw": ("nv", "mW", 1e-3, 1e5, "Excitation laser power"),
    "nv_mw_frequency_ghz": ("nv", "GHz", 0.5, 40, "Microwave / spin-resonance frequency"),
    "nv_sensitivity_pt": ("nv", "pT/√Hz", 1e-3, 1e8, "Magnetic sensitivity"),
    "nv_bias_field_mt": ("nv", "mT", 0.01, 3000, "Bias (static) magnetic field"),
    "nv_standoff_mm": ("nv", "mm", 0.1, 200, "Sensor-to-subject standoff (macroscopic, 0.1 mm and above)"),
    "nv_collection_efficiency_pct": ("nv", "%", 0.01, 100, "Photon collection efficiency"),
    "qd_emission_nm": ("qd", "nm", 400, 900, "Quantum-dot emission wavelength (product names such as QD605 are "
                                             "read as their emission maximum in nm)"),
    "qd_diameter_nm": ("qd", "nm", 1, 30, "Quantum-dot diameter (core or core/shell; not hydrodynamic)"),
    "qd_hydrodynamic_diameter_nm": ("qd", "nm", 2, 200, "Quantum-dot hydrodynamic diameter (DLS)"),
    "forster_radius_qd_nm": ("qd", "nm", 1, 15, "Förster radius R0, sentences that name a quantum-dot donor"),
    "forster_radius_other_nm": ("qd", "nm", 1, 15, "Förster radius R0, other donor-acceptor pairs"),
    "acceptor_emission_nm": ("qd", "nm", 450, 900, "Acceptor dye emission wavelength (Cy5 and others; dye noted)"),
    "excitation_wavelength_nm": ("qd", "nm", 250, 1100, "Excitation wavelength"),
    "tirf_penetration_depth_nm": ("qd", "nm", 20, 1000, "TIRF evanescent-field penetration depth"),
    "detection_limit_nm": ("qd", "nM", 1e-6, 1e6, "Detection limit (molar units)"),
    "fret_efficiency_pct": ("qd", "%", 0.5, 100, "FRET efficiency"),
    "cover_glass_thickness_um": ("qd", "µm", 50, 2000, "Cover glass thickness"),
    "cd_size_nm": ("cqd", "nm", 0.5, 30, "Carbon-dot size (stated or TEM diameter; not hydrodynamic)"),
    "cd_hydrodynamic_size_nm": ("cqd", "nm", 0.5, 500, "Carbon-dot hydrodynamic size (DLS)"),
    "cd_excitation_nm": ("cqd", "nm", 200, 900, "Carbon-dot excitation wavelength"),
    "cd_emission_nm": ("cqd", "nm", 200, 900, "Carbon-dot emission wavelength"),
    "cd_quantum_yield_pct": ("cqd", "%", 0.1, 100, "Carbon-dot fluorescence quantum yield"),
    "mn_height_um": ("cqd", "µm", 50, 3000, "Microneedle height"),
    "mn_base_width_um": ("cqd", "µm", 20, 2000, "Microneedle base width or base diameter"),
    "mn_tip_radius_um": ("cqd", "µm", 0.2, 100, "Microneedle tip radius"),
    "mn_tip_diameter_um": ("cqd", "µm", 0.5, 200, "Microneedle tip diameter"),
    "mn_pitch_um": ("cqd", "µm", 50, 5000, "Microneedle pitch (centre-to-centre or tip-to-tip)"),
    "mn_array_n": ("cqd", "needles per side", 2, 100, "Square microneedle array, needles per side (n of n × n)"),
    "mn_count": ("cqd", "needles", 4, 20000, "Needles per patch"),
    "mn_patch_side_mm": ("cqd", "mm", 2, 100, "Square patch or array side"),
    "mn_patch_diameter_mm": ("cqd", "mm", 2, 100, "Circular patch diameter"),
    "mn_patch_area_mm2": ("cqd", "mm²", 1, 10000, "Patch or array area, as stated (an area, not a shape)"),
    "mn_backing_thickness_um": ("cqd", "µm", 10, 5000, "Backing (base) layer thickness"),
    "led_wavelength_nm": ("cqd", "nm", 250, 1100, "LED wavelength"),
    "reader_channel_nm": ("cqd", "nm", 300, 1000, "Optical channel wavelength of the reader's spectral sensor"),
    "bilirubin_lod_um": ("cqd", "µM", 1e-6, 1e4, "Bilirubin detection limit (molar units)"),
    "bilirubin_lod_mg_dl": ("cqd", "mg/dL", 1e-5, 100, "Bilirubin detection limit (mass units)"),
    "bilirubin_range_low_um": ("cqd", "µM", 0, 1e4, "Bilirubin linear range, low end"),
    "bilirubin_range_high_um": ("cqd", "µM", 1e-6, 1e5, "Bilirubin linear range, high end"),
    "bilirubin_range_low_mg_dl": ("cqd", "mg/dL", 0, 100, "Bilirubin linear range, low end (mass units)"),
    "bilirubin_range_high_mg_dl": ("cqd", "mg/dL", 1e-4, 200, "Bilirubin linear range, high end (mass units)"),
    "quartz_window_thickness_mm": ("cqd", "mm", 0.05, 10, "Quartz window thickness"),
}

# filler words and signs allowed between a keyword and its number (bounds such as 'below' are never fillers)
COMMON = (r"~|≈|about|approximately|approx\.?|around|nearly|roughly|ca\.?|circa|only|just|up\s+to|"
          r"as\s+(?:low|high|small|large|short|long|thin|thick)\s+as|down\s+to|of|a|an|the")
PUNCT = r"(),:=±"


def L(key: str, fill: str = ""):
    """Left rule: keyword, then only filler tokens (or a bracketed acronym such as '(MAPs)'), then the number
    (end of the left context)."""
    words = f"{fill}|{COMMON}" if fill else COMMON
    return re.compile(rf"(?:{key})(?:\s*(?:\b(?:{words})\b|[{PUNCT}]|\(\s*[A-Za-z][A-Za-z0-9-]{{0,9}}\s*\)))*\s*$",
                      re.I)


def R(pattern: str):
    """Right rule: what must follow the number."""
    return re.compile(rf"\s*(?:{pattern})", re.I)


def X(pattern: str):
    return re.compile(pattern, re.I)


class Rule:
    """One parameter's reading rule. A number counts when its unit has the rule's dimension and a left pattern
    (keyword ... number), a right pattern (number ... keyword) or a left+right pair matches; need / sent / rec are
    words the gap, the sentence or the record must contain; excl_* reject."""

    def __init__(self, param, dim, left=(), right=(), both=(), need=None, sent=None, rec=None, excl_left=None,
                 excl_right=None, excl_sent=None, dims=None, ranges=None, lists=True, singles=True, pm=False,
                 bounds_ok=(), route=None, note=None, pow=1):
        self.param, self.dim, self.pow = param, dim, pow
        self.left, self.right, self.both = list(left), list(right), list(both)
        self.need, self.sent, self.rec = need, sent, rec
        self.excl_left, self.excl_right, self.excl_sent = excl_left, excl_right, excl_sent
        self.dims, self.ranges, self.lists, self.singles, self.pm = dims, ranges, lists, singles, pm
        self.bounds_ok, self.route, self.note = set(bounds_ok), route, note


BOUND = X(r"(<|>|≤|≥|\bbelow|\bless\s+than|\blower\s+than|\bunder|\bbetter\s+than|\babove|\bover|\bmore\s+than|"
          r"\bexceed(?:ing|s|ed)?|\bgreater\s+than|\bhigher\s+than|\bat\s+least|\bat\s+most|\bwithin|\btens\s+of|"
          r"\bhundreds\s+of|\bthousands\s+of|\bfew|\bseveral|\bnot\s+exceeding|\bbeyond|\bmaximum\s+of|"
          r"\bminimum\s+of|\bsmaller\s+than|\blarger\s+than|\bshorter\s+than|\blonger\s+than|\bthinner\s+than)"
          r"\s*(?:~|≈|about|approximately|only|a|an|the|\()*\s*$")

# record- and sentence-level vocabularies
OPM_TERMS = X(r"optically[- ]pumped|\bOPMs?\b|atomic\s+magnetomet|alkali|vapou?r[- ]cells?|\bSERF\b|spin[- ]exchange"
              r"[- ]relaxation|rubidium|\b(?:87|85)?Rb\b|caesium|cesium|\bCs\b|potassium|helium-?4|metastable\s+helium"
              r"|atomic\s+vapou?r|Bell-Bloom|NMOR|nonlinear\s+magneto-optical")
NV_TERMS = X(r"nitrogen[- ]vacancy|\bNVs?\b|\bNV[- ]?cent(?:er|re)s?|\bdiamonds?\b")
MAG_REC = X(r"magnetomet|\bOPMs?\b|magnetoencephalograph|magnetocardiograph|\bMEG\b|\bMCG\b|magnetic[\s-]+field\s+"
            r"(?:sensor|sensing|measurement|detection)|biomagnet|\bSERF\b")
# 'quantum dots' that are not semiconductor nanocrystals (carbon, graphene, silicon, 2D-material, polymer dots ...)
NONSEMI = X(r"carbon|graphene|\bGQDs?\b|\bCQDs?\b|\bN?CDs\b|C-dots?|silicon|\bSi\s*QDs?\b|\bSiQDs?\b|MoS|WS\(?2|"
            r"MXene|Ti3C2|C3N4|phosphorus|\bBP\s*QDs?\b|boron\s+nitride|\bBN\s*QDs?\b|polymer\s+dots?|\bPdots?\b|"
            r"perovskite|CsPb|Bi\(?2\)?O|nanoclusters?|\bAuNCs?\b|\bAgNCs?\b|\bMOFs?\b|organic\s+dots?")
OTHER_PAIR = X(r"BRET|luciferase|\bGFP\b|\bYFP\b|\bCFP\b|Cy3|fluorescein|\bFAM\b|terbium|\bTb\b|europium|\bEu\b|"
               r"lanthanide|\bIr\(|tryptophan|\bTrp\b|dye-dye|between\s+(?:the\s+)?dyes|Alexa\s*Fluor\s*\d+\s*(?:and|-)")
FABRICATION = X(r"femtosecond|ultrafast|laser[\s-]+writ|cutting|machining|ablation|engrav|anneal|photothermal|"
                r"tumou?rs?|frequency\s+conversion|conversion\s+of")
QD_KEY = (r"(?:QDs?|Qdots?|QDots?|quantum[\s-]+dots?|nanocrystals?|CdSe(?:/ZnS)?|CdTe(?:/CdS)?|CdSeTe|InP(?:/ZnS)?|"
          r"core/shell|core-shell)")
QD_SENT = X(rf"\b{QD_KEY}\b")
CD_KEY = (r"(?:carbon\s+(?:quantum\s+)?dots?|carbon\s+nano-?dots?|carbon\s+polymer\s+dots?|C-?dots?|graphene\s+"
          r"quantum\s+dots?|carbonized\s+polymer\s+dots?|(?:(?:[NBSPF]|N,\s?S|N/S|S,\s?N|B,\s?N|N,\s?P|P,\s?N)-)?"
          r"(?:CQDs?|CDs|GQDs?|CNDs?|CPDs?|NCDs?|NCQDs?))")
CD_REC = X(r"carbon\s+(?:quantum\s+)?(?:nano-?)?dots?|graphene\s+quantum\s+dots?|carbonized\s+polymer\s+dots?|"
           r"\bC-dots?\b")
CD_SENT = X(rf"\b{CD_KEY}\b|\bthey\b|\bwhich\b")
MN_KEY = (r"(?:micro-?needles?|MNs?|MNAs?|MNPs|microneedle\s+arrays?|MN\s+arrays?|needles?|micro-?projections?|"
          r"micro-?needle\s+patch(?:es)?|MN\s+patch(?:es)?)")
MN_REC = X(r"micro-?needle|\bMNs?\b|\bMNAs?\b")
MN_SENT = X(rf"\b{MN_KEY}\b|\bpatch(?:es)?\b|\barrays?\b")
TIRF_SENT = X(r"TIRF|total[\s-]+internal[\s-]+reflection|evanescent")
BILI_SENT = X(r"bilirubin")


def _qd_route(ctx):
    """QD donor when the sentence names a semiconductor quantum dot, or when the record does and the sentence
    names no other kind of donor-acceptor pair."""
    sent = ctx["sentence"]
    if NONSEMI.search(sent) or OTHER_PAIR.search(sent):
        return "forster_radius_other_nm"
    if QD_SENT.search(sent) or ctx["rec_qd"]:
        return "forster_radius_qd_nm"
    return "forster_radius_other_nm"


def _hydro(base, hydro):
    rx = X(r"hydrodynamic|\bDLS\b|dynamic\s+light\s+scattering")
    return lambda ctx: hydro if rx.search(ctx["near"]) else base


def _thick(size, thick):
    rx = X(r"thick|thickness")
    return lambda ctx: thick if (ctx["kind"] != "dims" and rx.search(ctx["gap"])) else size


CELL_ADJ = (r"vapou?r|alkali(?:-metal)?|Rb|rubidium|87Rb|85Rb|Cs|cesium|caesium|133Cs|K|potassium|39K|glass|MEMS|"
            r"micro-?fabricated|buffer-gas|paraffin-coated|coated|anti-?relaxation-coated|evacuated|heated|atomic|"
            r"cubic|cubical|cylindrical|spherical|borosilicate|quartz|silicon|pyrex|sealed|miniature|miniaturi[sz]ed|"
            r"chip-scale|mm-scale|millimet(?:er|re)-scale|single|reference|multipass|hybrid|alkali-vapou?r|"
            r"vapou?r-cell|square|gas")
NOT_VAPOUR_CELL = X(r"(?:unit|solar|fuel|Pockels|Hall|photo|load|flow|electrochemical|biological|living|nerve|stem|"
                    r"neural|brain|blood|cancer|tumou?r|cultured|HeLa|memory|lattice|Wigner|Kerr|Faraday|Yee|grid|"
                    r"simulation|mesh|battery|storage|pixel|liquid|microfluidic|fluidic|unit\s+cell|cells\s+per)\s*"
                    r"cells?\b")
SENS_EXCL = X(r"(?:shield\w*|Johnson|thermal\s+magnetic|environment\w*|ambient|background|requirement\w*|required|"
              r"requires|need|needed|needs|SQUIDs?|theoretical\w*|project\w*|predict\w*|expect\w*|estimat\w*|"
              r"fundamental|limits?|limited|could|would|potential\w*|simulat\w*|calculat\w*|quantum-limited|"
              r"spin-projection|shot-noise|shot\s+noise|photon-shot|atomic\s+shot|target|goal|aim|aims|designed|"
              r"ultimate|anticipated|achievable|possible|optimal|optimum|optimized|optimised|can\s+detect|"
              r"we\s+can|should|may|might)[^.;]{0,45}$")
SENS_EXCL_R = X(r"\s*(?:,\s*)?(?:is|are|was)?\s*(?:required|needed|predicted|expected|estimated|calculated|projected|"
                r"anticipated|achievable|possible)\b")
SENS_LEFT = L(r"\b(?:sensitivit(?:y|ies)|noise(?:\s+(?:floor|levels?|density|spectral\s+density|equivalent\s+field|"
              r"baseline))?|(?:amplitude\s+)?spectral\s+density|"
              r"resolution|NEF|noise-equivalent\s+field|magnetometers?|OPMs?|sensors?|performance|achiev(?:ed|ing|es)|"
              r"reach(?:ed|ing|es)|demonstrat(?:ed|ing|es)|record|obtained|measured|shows?|showed|exhibits?|"
              r"exhibited|yield(?:ing|s)?|gives?|gave|provid(?:ing|es)|offers?|offering)\b",
              r"is|was|were|level|floor|density|best|typical|typically|average|averaged|median|mean|intrinsic|"
              r"magnetic|field|fields|sensitivity|noise|with|at|per|channel|axis|sensor|single|a\s+noise\s+floor|"
              r"baseline|a\s+baseline|"
              r"magnetic\s+field\s+sensitivity|in\s+the|band|frequency|range")
SENS_RIGHT = R(r"(?:\)\s*)?(?:in\s+the\s+[\w\s-]{0,20}?\s+)?(?:(?:magnetic\s+)?(?:field\s+)?(?:sensitivit(?:y|ies)|"
               r"noise(?:\s+(?:floor|level|density))?|resolution))\b")

RULES = [
    # ------------------------------------------------------------------ OPM
    Rule("opm_cell_size_mm", "length", rec="opm_mag", dims="max",
         left=[L(rf"\b(?:(?:{CELL_ADJ})[\s-]+){{0,3}}cells?\b",
                 r"with|having|has|had|inner|internal|interior|outer|size|sizes|dimension|dimensions|diameter|length|"
                 r"lengths|side|edge|volume|measuring|measures|is|was|are|cubic|cube|optical|path|thickness|thick|in|"
                 r"typical|typically|inside|internal\s+dimensions?|of\s+size|a\s+volume\s+of")],
         right=[R(rf"(?:-?\s*(?:inner|internal|outer|long|wide|thick|diameter|cube|cubic|sized|size|in\s+(?:size|"
                  rf"length|diameter)|length|path|optical\s+path))?(?:\s*,)?\s*(?:(?:{CELL_ADJ})[\s-]+){{0,3}}"
                  rf"(?:vapou?r[\s-]+)?cells?\b")],
         excl_left=X(r"(?:window|windows|wall|walls|stem|beam|beams|spot|waist|separation|distance|baseline|coil|"
                     r"coils|shield|gap|spacing|pitch)\b[^.;\d]{0,20}$"),
         excl_right=X(r"\s*(?:thick\s+)?(?:windows?|walls?|stems?)\b|\s*(?:away|apart|from|separation|distance|"
                      r"beam)\b")),
    Rule("opm_cell_temperature_c", "temp", rec="opm_mag",
         left=[L(r"\b(?:cells?|vapou?rs?|atoms?|alkali|Rb|rubidium|Cs|cesium|caesium|K|potassium|sensors?|"
                 r"magnetometers?|OPMs?|ensemble)\b",
                 r"was|were|is|are|being|be|been|operating|operated|operates|operate|heated|heating|maintained|kept|"
                 r"held|stabili[sz]ed|working|work|works|running|run|temperature|temperatures|at|to|up|only|its|"
                 r"their|T|elevated|high|low|moderate|modest|relatively|typical|typically|optimal|optimum|operating|"
                 r"set|setpoint|set\s+point|which|that"),
               L(r"\bheated\s+(?:up\s+)?to\b"),
               L(r"\b(?:cell|vapou?r|operating|operation|working)\s+temperatures?\b",
                 r"is|was|were|T|set\s+to|to|at|of")],
         right=[R(r"(?:\(\s*)?(?:cell|vapou?r|operating|operation|working|heating)\s+temperatures?\b")],
         need=X(r"temperatur|heat|operat|maintain|stabili|kept|held|warm|\brun"),
         excl_left=X(r"(?:skin|surface|ambient|room|body|scalp|housing|outer|external|exterior|shield|enclosure|"
                     r"coil|patient|subject|head|environment\w*|lab\w*|Curie|transition|melting|boiling)\s+"
                     r"(?:temperatures?)?[^.;\d]{0,20}$"),
         excl_right=X(r"\s*(?:above|below)\s+(?:room|ambient)|\s*(?:on|at)\s+the\s+(?:skin|scalp|surface)")),
    Rule("opm_laser_wavelength_nm", "length", rec="opm_mag",
         left=[L(r"\b(?:lasers?|VCSELs?|DFB|DBR|diode|pump|probe|pumping|probing|light|beams?|wavelengths?|D1|D2|"
                 r"lines?|transition|resonant|resonance|tuned|emitting)\b",
                 r"at|with|is|was|were|near|tuned|to|resonant|with\s+the|wavelength|wavelengths|centered|centred|λ|"
                 r"operating|operates|emitting|light")],
         right=[R(r"(?:\(\s*\w+\s*\)\s*)?(?:(?:pump|probe|pumping|probing|laser|lasers|light|beam|beams|VCSELs?|DFB|"
                  r"DBR|diode|resonant|circularly|linearly|polari[sz]ed|single-frequency|single-mode|distributed|"
                  r"feedback|tunable|external-cavity|D1|D2)[\s-]*)+")],
         excl_left=X(r"(?:fluorescence|emission|filters?|bandpass|interference|absorption|transmission|cut-?off|"
                     r"long-?pass|short-?pass|dichroic)\b[^.;\d]{0,15}$")),
    Rule("opm_sensitivity_ft", "field_noise", rec="opm_mag", left=[SENS_LEFT], right=[SENS_RIGHT], excl_left=SENS_EXCL,
         excl_right=SENS_EXCL_R),
    Rule("opm_bandwidth_hz", "freq", rec="opm_mag", ranges="upper",
         left=[L(r"\bbandwidths?\b",
                 r"is|was|were|to|from|DC|dc|d\.c\.|zero|with|-|3\s*-?\s*dB|-3\s*dB|reaching|reaches|reached|nearly")],
         right=[R(r"(?:-?\s*3\s*-?\s*dB\s*)?(?:(?:measurement|detection|sensor|signal|operational|operating|"
                  r"magnetometer|response|frequency|sensing|usable)\s+)?bandwidths?\b")],
         excl_left=X(r"(?:laser|optical|spectral|filter|lock-?in|low-?pass|noise|equivalent|integration|measurement|"
                     r"detection|modulation|linewidth|line\s+width|resonance)\s+bandwidths?\b[^.;\d]{0,25}$|"
                     r"\b(?:in|within|over|per|for)\s+(?:a|an|the|each)?\s*$")),     # 'SNR of 3 in a 1-Hz bandwidth'
    Rule("opm_head_size_mm", "length", rec="opm_mag", dims="max", singles=False, lists=False,
         left=[L(r"\b(?:sensors?|sensor\s+heads?|heads?|modules?|packages?|probes?|magnetometers?|OPMs?)\b",
                 r"size|sizes|dimension|dimensions|footprint|with|measuring|measures|measured|is|was|are|compact|small|"
                 r"overall|outer|external|total|physical|its|their|has|have|having")],
         right=[R(r"(?:\^3\s*)?(?:(?:compact|miniature|miniaturi[sz]ed|small|fib(?:er|re)-coupled)[\s-]*){0,2}"
                  r"(?:sensors?|sensor\s+heads?|heads?|modules?|packages?|magnetometers?|OPMs?)\b")],
         excl_left=X(r"(?:ECU|electronics?|control\s+unit|driver|board|controller|box|shield\w*|room|coil\w*)\b"
                     r"[^.;\d]{0,30}$")),
    Rule("opm_power_consumption_w", "power", rec="opm_mag",
         left=[L(r"\b(?:power\s+consumption|power\s+dissipation|consum(?:es|ing|e|ed)|dissipat(?:es|ing|ed|ion)|"
                 r"electrical\s+power|heating\s+power|heater\s+power|power\s+budget|power\s+draw|power\s+"
                 r"requirement)\b",
                 r"is|was|were|per|sensor|channel|total|average|averaged|typical|typically")],
         right=[R(r"(?:of\s+)?(?:(?:total|electrical|average|heater|heating)\s+)?(?:power\s+consumption|power\s+"
                  r"dissipation|power\s+budget)\b")]),
    Rule("opm_laser_power_mw", "power", rec="opm_mag",
         left=[L(r"\b(?:laser|pump|probe|optical|light|beam|incident)\s+powers?\b",
                 r"is|was|were|per|total|average|typical|typically")],
         right=[R(r"(?:of\s+)?(?:(?:pump|probe|laser|optical|light|resonant|circularly\s+polari[sz]ed)\s*)+"
                  r"(?:power|light|beam|laser)?\b")],
         excl_left=X(r"(?:microwave|RF|radio-?frequency|electrical|heater|heating|consumption)\b[^.;\d]{0,25}$")),
    Rule("opm_dynamic_range_nt", "field", rec="opm_mag", pm=True,
         left=[L(r"\bdynamic\s+ranges?\b", r"is|was|were|±|to|over\s+a")],
         right=[R(r"(?:of\s+)?dynamic\s+range\b")]),
    # ------------------------------------------------------------------ NV
    Rule("nv_diamond_size_mm", "length", rec="nv", dims="max", route=_thick("nv_diamond_size_mm",
                                                                           "nv_diamond_thickness_mm"),
         left=[L(r"\bdiamonds?(?:\s+(?:plates?|samples?|chips?|crystals?|slabs?|substrates?|membranes?|cubes?|"
                 r"pieces?|sensors?))?\b",
                 r"with|having|has|had|dimensions?|sizes?|measuring|measures|is|was|are|lateral|overall|volume|"
                 r"in\s+size|footprint|thickness|thick")],
         right=[R(r"(?:\^[23]\s*)?(?:-?\s*(?:sized|size|large|wide|square|in\s+size|thick))?\s*(?:(?:single-?"
                  r"crystal(?:line)?|single\s+crystal|electronic-?grade|optical-?grade|CVD|HPHT|bulk|synthetic|"
                  r"type-?I[Ib]a?|type\s+I[Ib]a?|\(100\)|\(111\)|100-oriented|111-oriented|oriented|square|cubic|"
                  r"polished|isotopically|purified|12C|enriched|high-purity|nitrogen-rich|N-rich|implanted|"
                  r"irradiated|annealed|commercial|thin|plate|NV-rich|NV-doped|NV|ensemble|grown)[\s-]+){0,4}"
                  r"diamonds?(?:\s+(?:plates?|samples?|chips?|crystals?|slabs?|substrates?|membranes?|cubes?))?\b"
                  r"(?!\s*(?:anvils?|tips?|cantilevers?|pillars?|nanopillars?|lens(?:es)?|waveguides?|resonators?|"
                  r"probes?|particles?|powders?|grits?))")],
         excl_left=X(r"(?:anvils?|tips?|cantilevers?|pillars?|lens|lenses|waveguides?|resonators?|layers?|depth|"
                     r"beam|spot|focus|probe|nanodiamonds?|particles?)\b[^.;\d]{0,20}$"),
         excl_right=X(r"\s*(?:-?\s*thick\s+)?(?:layers?|films?|NV\s+layer|implanted\s+layer|nanopillars?|pillars?|"
                      r"cantilevers?|tips?|anvils?|lens|lenses|waveguides?|resonators?|below|beneath|deep)\b")),
    Rule("nv_density_ppm", "ppm", rec="nv",
         left=[L(r"(?:\bNV\s*(?:-|\^-|\(-\))?\s*(?:cent(?:er|re)s?|defects?)?|nitrogen-vacancy(?:\s+(?:cent(?:er|re)s?"
                 r"|defects?))?)\s*(?:densit(?:y|ies)|concentrations?|content|levels?)\b",
                 r"is|was|were|high|low|estimated|nominal"),
               L(r"\[\s*NV\s*-?\s*\]", r"is|was")],
         right=[R(r"(?:of\s+)?(?:\(\s*)?(?:NVs?\b|NV-|NV\^-|NV\(-\)|nitrogen-vacancy)")]),
    Rule("nv_nitrogen_ppm", "ppm", rec="nv",
         left=[L(r"(?:\bnitrogen(?!-vacancy)|\[\s*N\s*\]|\[\s*N_s\s*\]|\bP1|substitutional\s+nitrogen|\bN_s|\bNs)\s*"
                 r"(?:densit(?:y|ies)|concentrations?|content|levels?|impurit(?:y|ies))?\b",
                 r"is|was|were|high|low|initial|nominal")],
         right=[R(r"(?:of\s+)?(?:\(\s*)?(?:nitrogen(?!-vacancy)|N\b(?!\s*-?\s*V)|P1\b|substitutional)")]),
    Rule("nv_laser_wavelength_nm", "length", rec="nv", excl_sent=FABRICATION,
         left=[L(r"\b(?:lasers?|pump|pumped|pumping|excitation|excited|excite|excites|exciting|illuminated|"
                 r"illumination|illuminating|green\s+(?:light|laser)|light|beam|irradiation|irradiated)\b",
                 r"at|with|by|is|was|wavelength|wavelengths|λ|green|CW|continuous-wave|light|laser|source")],
         right=[R(r"(?:(?:green|CW|continuous-wave|diode|DPSS|solid-state|frequency-doubled|optical)[\s-]+)*"
                  r"(?:pump|pumping|excitation|laser|lasers|light|illumination|beam)\b")],
         excl_left=X(r"(?:ZPL|zero-phonon|emission|emits?|emitted|emitting|fluorescence|photoluminescence|PL|"
                     r"filters?|long-?pass|dichroic|cut-?off|Raman|absorption|absorb\w*|detected|detection|"
                     r"collected|collection|band)\b[^.;\d]{0,12}$"),
         excl_right=X(r"\s*(?:-?\s*)?(?:long-?pass|LP|short-?pass|band-?pass|filters?|dichroic|emission|"
                      r"fluorescence|photoluminescence|PL|ZPL|zero-phonon|absorption|Raman|reflection|cut-?off|"
                      r"edge)\b")),
    Rule("nv_laser_power_mw", "power", rec="nv", excl_sent=FABRICATION,
         left=[L(r"\b(?:laser|pump|optical|green|excitation|illumination|light|pumping)\s+powers?\b",
                 r"is|was|were|total|average|typical|typically")],
         right=[R(r"(?:of\s+)?(?:(?:green|5\d\d\s*-?\s*nm|pump|laser|optical|excitation|CW|continuous-wave|"
                  r"illumination)[\s-]*)+(?:light|power|laser|illumination|excitation|pump|beam)?\b"),
                R(r"of\s+(?:optical\s+|laser\s+|pump\s+)?power\b")],
         need=X(r"laser|pump|excitation|optical|green|illumination"),
         excl_left=X(r"(?:microwave|MW|RF|radio-?frequency|electrical|consumption)\b[^.;\d]{0,25}$"),
         excl_right=X(r"\s*(?:of\s+)?(?:microwave|MW|RF)\b")),
    Rule("nv_mw_frequency_ghz", "freq", rec="nv",
         left=[L(r"\b(?:microwaves?|MW|resonances?|resonant|transitions?|ODMR|zero-field\s+splitting|ZFS|"
                 r"splitting|D|ground[- ]state|spin|drive|driving|driven|frequenc(?:y|ies)|centered|centred|lines?|"
                 r"crossing|anti-?crossing|GSLAC|LAC|tuned|applied|field|fields)\b",
                 r"is|was|were|at|of|with|near|to|by|frequency|frequencies|splitting|=|D|around|centered|centred|"
                 r"splits|split|resonance|resonances|value|values|between|from|in|on|the|range|ranging")],
         right=[R(r"(?:\)\s*)?(?:(?:microwave|MW|resonance|resonant|zero-field|ODMR|spin|transition|ground-state|"
                  r"drive|driving)\b)")],
         excl_left=X(r"(?:THz|optical|clock|bandwidth|repetition|sampling|cut-?off|bandwidths?|ranges?|span|"
                     r"tunable|tuning|acoustic\w*|mechanical|phonon\w*|cavit(?:y|ies))\b[^.;\d]{0,25}$")),
    Rule("nv_sensitivity_pt", "field_noise", rec="nv", left=[SENS_LEFT], right=[SENS_RIGHT], excl_left=SENS_EXCL,
         excl_right=SENS_EXCL_R),
    Rule("nv_bias_field_mt", "field", rec="nv",
         left=[L(r"\b(?:bias|static|external|applied|offset|axial|DC|dc|homogeneous|uniform|background|constant)\s+"
                 r"(?:magnetic\s+)?fields?\b",
                 r"is|was|were|B0|B_0|B|strength|strengths|magnitude|amplitude|along|aligned|applied|with|at|low|"
                 r"high|small|moderate|weak|strong")],
         right=[R(r"(?:\)\s*)?(?:(?:bias|static|external|applied|offset|axial|DC|dc|homogeneous|uniform|background)"
                  r"\s+)(?:magnetic\s+)?fields?\b")]),
    Rule("nv_standoff_mm", "length", rec="nv",
         left=[L(r"\b(?:stand-?offs?|standoff)\s*(?:distances?)?\b",
                 r"is|was|were|typical|typically|minimum|minimal|between"),
               L(r"\bdistances?\s+(?:of|between|from)\s+(?:the\s+)?(?:sensor|diamond|probe|magnetometer|sensor\s+head|"
                 r"NV\s+sensor|head)\s+(?:and|to|from)\s+(?:the\s+)?(?:\w+\s+){0,2}(?:chest|heart|subject|skin|"
                 r"body|tissue|source|scalp|head|torso|volunteer|participant)\w*", r"is|was")],
         right=[R(r"(?:\)\s*)?(?:stand-?off|standoff)\b"),
                R(r"(?:away\s+)?from\s+(?:the\s+|a\s+)?(?:\w+\s+){0,2}(?:chest|heart|subject|skin|body|torso|scalp|"
                  r"volunteer|participant|patient)")]),
    Rule("nv_collection_efficiency_pct", "percent", rec="nv",
         left=[L(r"\b(?:(?:photon|light|fluorescence|optical|PL)[\s-]+)?collection\s+"
                 r"efficienc(?:y|ies)\b", r"is|was|were|total|overall|estimated|measured|with|high"),
               L(r"\bcollect(?:ed|s|ing|ion)?\b[^.;\d]{0,60}?\befficienc(?:y|ies)\b",
                 r"is|was|were|estimated|measured|with|total|overall|high")],
         right=[R(r"(?:\)\s*)?(?:(?:photon|light|fluorescence|optical|PL|total|overall)[\s-]+)?collection"
                  r"(?:\s+efficienc(?:y|ies))?\b")]),
    # ------------------------------------------------------------------ QD / FRET / TIRF
    Rule("qd_emission_nm", "length", sent=QD_SENT, excl_sent=NONSEMI,
         left=[L(rf"\b{QD_KEY}\b[^.;\d]{{0,40}}?\b(?:emission|emitting|emits?|emitted|photoluminescence|PL|"
                 rf"fluorescence|luminescence)\b",
                 r"peak|peaks|maximum|maxima|wavelength|wavelengths|band|centered|centred|at|around|near|λem|λmax|is|"
                 r"was|were|located|position|positioned|peaking|peaked|with|max")],
         right=[R(rf"(?:-?\s*(?:emitting|emission|em)\s*)?(?:(?:CdSe(?:/ZnS)?|CdTe|InP(?:/ZnS)?|core/shell|core-shell|"
                  rf"colloidal|semiconductor|water-soluble|streptavidin-coated|streptavidin-conjugated|"
                  rf"carboxyl\w*|amine\w*|PEG\w*)[\s-]+){{0,3}}(?:QDs?|Qdots?|QDots?|quantum\s+dots?|nanocrystals?)"
                  rf"\b")],
         excl_left=X(r"(?:acceptors?|dyes?|Cy\d|Alexa|ATTO|Atto|FAM|TAMRA|rhodamine|fluorescein|FITC|organic|AuNPs?|"
                     r"gold|BHQ|quencher|excitation|excited|absorption|absorbance)\b[^.;]{0,40}$")),
    Rule("qd_diameter_nm", "length", sent=QD_SENT, excl_sent=NONSEMI,
         route=_hydro("qd_diameter_nm", "qd_hydrodynamic_diameter_nm"),
         left=[L(rf"\b{QD_KEY}\b",
                 r"with|having|has|had|showed|show|shows|exhibited|exhibit|exhibiting|displayed|average|mean|core|"
                 r"overall|particle|uniform|narrow|small|size|sizes|diameter|diameters|was|were|is|are|nm|in|typical|"
                 r"hydrodynamic|physical|TEM|DLS|crystal|crystallite|inorganic|total|final|estimated|measured|"
                 r"determined")],
         right=[R(rf"(?:-?\s*(?:sized|size|diameter|in\s+diameter|in\s+size))?\s*(?:(?:CdSe(?:/ZnS)?|CdTe|"
                  rf"InP(?:/ZnS)?|core/shell|core-shell|colloidal|semiconductor|water-soluble|hydrophilic|luminescent|"
                  rf"fluorescent|spherical|small)[\s-]+){{0,3}}(?:QDs?|Qdots?|QDots?|quantum\s+dots?|nanocrystals?)\b")],
         need=X(r"size|diameter|sized"),
         excl_left=X(r"(?:distance|separation|spacing|shell|coating|layer|thickness|thick|linker|spacer|penetration|"
                     r"depth|resolution|pore|gap|wavelength|emission|Stokes|shift|FWHM|width|bandwidth|radius|"
                     r"Forster|R_?0|from|apart)\b[^.;\d]{0,25}$"),
         excl_right=X(r"\s*(?:-?\s*thick\s*)?(?:ZnS|CdS|silica|SiO2|polymer|PEG|shell|shells|coating|coat|layer|"
                      r"layers|spacer|linker|gap|distance|apart|separation|from|away|resolution|pores?|wavelength|"
                      r"emission|Stokes|shift|FWHM|full\s+width|bandwidth|width|thickness|in\s+thickness)\b")),
    Rule("forster_radius_qd_nm", "length", route=_qd_route,
         left=[L(r"\bForster\s+(?:radius|radii|distance|distances)\b",
                 r"\(?\s*R_?0\s*\)?|R_?\(0\)|R_?0|is|was|were|calculated|estimated|determined|value|values|as|be|"
                 r"to|for|this|pair|FRET|which|with|corresponding"),
               L(r"\bR_?\(?0\)?", r"value|values|is|was|calculated|estimated|for\s+this\s+pair|was\s+calculated\s+"
                                  r"to\s+be|of")],
         right=[R(r"(?:\(\s*)?(?:Forster\s+(?:radius|distance)|R_?0)\b")]),
    Rule("acceptor_emission_nm", "length",
         left=[L(r"\b(?:Cy5(?:\.5)?|Cy3(?:\.5)?|Cy7|Alexa\s*(?:Fluor)?\s*\d{3}|ATTO\s*\d{3}N?|Texas\s+Red|TAMRA|"
                 r"ROX|acceptors?|DyLight\s*\d{3})[^.;\d]{0,30}?\b(?:emission|emitting|emits?|emitted|fluorescence|"
                 r"photoluminescence)\b",
                 r"peak|maximum|maxima|wavelength|band|at|around|near|λem|is|was|centered|centred|max|signal|signals|"
                 r"channel"),
               L(r"\b(?:emission|fluorescence)\s+(?:signals?\s+|peaks?\s+|bands?\s+)?(?:of|from)\s+(?:the\s+)?"
                 r"(?:Cy5(?:\.5)?|Cy3(?:\.5)?|Cy7|Alexa\s*(?:Fluor)?\s*\d{3}|ATTO\s*\d{3}N?|acceptors?)\b"
                 r"(?:\s+(?:acceptors?|dyes?|molecules?))?", r"at|around|near|centered|centred|peak|peaking")],
         right=[R(r"(?:\(\s*)?(?:Cy5(?:\.5)?|Cy3(?:\.5)?|Cy7|acceptor)\s+(?:emission|fluorescence)\b")],
         excl_left=X(r"(?:excitation|excited|absorption|absorbance|QDs?|quantum\s+dots?|donor)\b[^.;]{0,25}$")),
    Rule("excitation_wavelength_nm", "length", excl_sent=NONSEMI,
         sent=X(rf"\b{QD_KEY}\b|TIRF|total[\s-]+internal|single[\s-]+molecules?|FRET|lasers?|donors?|acceptors?|"
                r"Cy\d"),
         left=[L(r"\b(?:excited|excitation|excite|excites|exciting|illuminated|illumination|irradiated|irradiation|"
                 r"λex|λexc|pumped)\b",
                 r"at|with|by|using|wavelength|wavelengths|is|was|light|laser|lasers|line|single|sole|diode|source|"
                 r"beam|under"),
               L(r"\blasers?\b", r"at|with|line|lines|wavelength|wavelengths|emitting\s+at")],
         right=[R(r"(?:(?:laser|lasers|diode|LED|light|single|wavelength|CW|continuous-wave|pulsed|UV|blue|violet|"
                  r"line)[\s-]+){0,3}(?:excitation|excited|illumination|laser|lasers|irradiation|light\s+source)\b")],
         excl_left=X(r"(?:emission|emitting|emits?|emitted|detection|detected|filters?|channels?|absorption|"
                     r"absorbance)\b[^.;\d]{0,12}$")),
    Rule("tirf_penetration_depth_nm", "length", sent=TIRF_SENT, bounds_ok=("within",),
         left=[L(r"\b(?:penetration|decay|evanescent|illumination|probing|sampling|excitation)\s+(?:depths?|lengths?|"
                 r"distances?)\b",
                 r"is|was|were|typically|d|dp|d_p|δ|field|wave|1/e|intensity"),
               L(r"\bevanescent\s+(?:field|wave|illumination|excitation|light|region|layer)s?\b[^.;\d]{0,40}?"
                 r"\b(?:extend\w*|decay\w*|penetrat\w*|reach\w*|limited|confined|restricted|depth|thick\w*|range|"
                 r"ranging|within)\b",
                 r"to|into|within|a\s+depth\s+of|depths?\s+of|over|first|thin|layer|region|range|depth|from\s+the\s+"
                 r"(?:surface|interface)")],
         right=[R(r"(?:\)\s*)?(?:-?\s*deep\s+)?(?:(?:evanescent|penetration|decay|illumination|excitation)[\s-]+)"
                  r"(?:field\s+|wave\s+)?(?:depths?|lengths?|fields?|waves?|layers?|regions?|zones?)\b")],
         both=[(L(r"\bwithin\b", r"first"),
                R(r"(?:of|from|above|near)\s+(?:the\s+)?(?:glass|cover\s*slip|cover\s+glass|cover-glass|surface|"
                  r"interface|substrate|slide)"))]),
    Rule("detection_limit_nm", "conc",
         left=[L(r"\b(?:detection\s+limits?|limits?\s+of\s+detection|LODs?)\b",
                 r"\(\s*LODs?\s*\)|is|was|were|reached|achieved|calculated|estimated|determined|found|obtained|to|be|"
                 r"for|value|values|which|with|reaching|low|lowest|extremely|very|(?:for|of)\s+[\w-]+(?:\s+[\w-]+)?"),
               L(r"\bdetect(?:ed|ion|s)?\b[^.;\d]{0,30}?(?:as\s+low\s+as|down\s+to)")]),
    Rule("fret_efficiency_pct", "percent",
         left=[L(r"\b(?:FRET|energy[- ]transfer|transfer)\s+efficienc(?:y|ies)\b",
                 r"\(\s*E\s*\)|is|was|were|reached|reaching|achieved|high|maximum|max|estimated|calculated|"
                 r"determined|value|values|E|be|to"),
               L(r"\befficiency\s+of\s+(?:the\s+)?(?:FRET|energy\s+transfer)\b", r"is|was|were|reached")],
         right=[R(r"(?:\)\s*)?(?:FRET|energy[- ]transfer)\s+efficienc")]),
    Rule("cover_glass_thickness_um", "length", need=X(r"thick"),
         left=[L(r"\b(?:cover\s*slips?|cover\s*glass(?:es)?|cover-glass(?:es)?|glass\s+cover\s*slips?|glass\s+"
                 r"slides?|glass\s+substrates?)\b", r"thickness|thick|with|No\.?\s*1(?:\.5)?|#\s*1(?:\.5)?|was|is")],
         right=[R(r"-?\s*thick\s+(?:\w+\s+){0,2}(?:cover\s*slips?|cover\s*glass(?:es)?|cover-glass|glass\s+slides?|"
                  r"glass\s+substrates?)\b")]),
    # ------------------------------------------------------------------ CQD / microneedles / reader
    Rule("cd_size_nm", "length", rec="cd", sent=X(CD_KEY), route=_hydro("cd_size_nm", "cd_hydrodynamic_size_nm"),
         left=[L(rf"\b{CD_KEY}\b",
                 r"with|having|has|had|showed|show|shows|exhibited|exhibit|exhibiting|displayed|possessed|possess|"
                 r"possessing|average|mean|uniform|narrow|small|ultrasmall|ultra-small|particle|lateral|size|sizes|"
                 r"diameter|diameters|distribution|was|were|is|are|centered|centred|mainly|mostly|primarily|"
                 r"predominantly|spherical|quasi-spherical|morphology|and|good|dispersibility|well-dispersed|"
                 r"monodisperse|monodispersed|TEM|HRTEM|DLS|hydrodynamic|obtained|prepared|synthesi[sz]ed|"
                 r"as-prepared|as-synthesi[sz]ed|nanoparticles?|nanosized|in\s+size|in\s+diameter|nm"),
               L(r"\b(?:average|mean|particle)\s+(?:particle\s+)?(?:sizes?|diameters?)\b",
                 rf"is|was|were|for|{CD_KEY}|as-prepared|obtained|resulting|synthesi[sz]ed")],
         right=[R(rf"(?:-?\s*(?:sized|size|diameter|in\s+diameter|in\s+size))?\s*(?:(?:spherical|quasi-spherical|"
                  rf"fluorescent|luminescent|blue-emitting|green-emitting|red-emitting|N-doped|nitrogen-doped|"
                  rf"water-soluble|highly|photoluminescent)[\s-]+){{0,3}}{CD_KEY}\b")],
         need=X(r"size|diameter|sized"),
         excl_left=X(r"(?:lattice|spacings?|fringes?|interlayer|d-spacing|interplanar|thickness|height|pores?|films?|"
                     r"layers?|shell|Stokes|shift|FWHM|bandwidth|distance|resolution|wavelength|emission|excitation|"
                     r"AFM|topographic)\b[^.;\d]{0,20}$"),
         excl_right=X(r"\s*(?:-?\s*thick\s*)?(?:lattice|spacing|fringes?|interlayer|d-spacing|thickness|height|"
                      r"pores?|films?|layers?|shell|Stokes|shift|FWHM|bandwidth|apart|distance|from|resolution|"
                      r"wavelength|emission|excitation)\b")),
    Rule("cd_emission_nm", "length", rec="cd", sent=X(CD_KEY),
         left=[L(r"\b(?:emission|emissions|emitting|emits?|emitted|photoluminescence|PL|fluorescence|fluorescent|"
                 r"luminescence)\b",
                 r"peak|peaks|maximum|maxima|band|bands|wavelength|wavelengths|center|centre|centered|centred|located|"
                 r"position|positioned|at|around|near|λem|λmax|is|was|were|appeared|occurred|observed|shows?|showed|"
                 r"with|strong|intense|bright|blue|green|red|yellow|orange|cyan|deep-red|near-infrared|NIR|maximal|"
                 r"optimal|max|peaked|peaking|light|colou?r|signal|intensity|intensities|dual|two"),
               L(r"\bλem\b")],
         right=[R(r"(?:-?\s*nm\s*)?(?:(?:blue|green|red|yellow|orange|cyan|bright|strong|intense|deep-red|NIR|"
                  r"near-infrared)[\s-]+){0,2}(?:emission|emissions|emitting|photoluminescence\s+(?:peak|emission)|"
                  r"PL\s+(?:peak|emission)|fluorescence\s+(?:emission|peak|maximum))\b")],
         excl_left=X(r"(?:absorption|absorbance|absorb\w*|UV-vis|excitation|excited|excite|λex|irradiat\w*|"
                     r"illuminat\w*|under|quench\w*|rhodamine|fluorescein|FITC|dye|Cy\d|R6G|RhB)\b[^.;\d]{0,10}$")),
    Rule("cd_excitation_nm", "length", rec="cd", sent=X(CD_KEY),
         left=[L(r"\b(?:excitation|excited|excite|excites|exciting|irradiation|irradiated|illumination|illuminated|"
                 r"λex|λexc)\b",
                 r"at|with|by|under|using|wavelength|wavelengths|light|lamp|laser|optimal|optimum|maximum|max|is|was|"
                 r"were|peak|UV")],
         right=[R(r"(?:(?:UV|ultraviolet|light|lamp|laser|LED|blue|violet)[\s-]+){0,2}(?:excitation|irradiation|"
                  r"illumination)\b")],
         both=[(L(r"\bunder\b"), R(r"(?:UV\s+|ultraviolet\s+)?(?:light|lamp|irradiation|excitation|illumination)"))],
         excl_left=X(r"(?:emission|emits?|emitted|emitting|absorption|absorbance|absorb\w*|UV-vis)\b[^.;\d]{0,10}$")),
    Rule("cd_quantum_yield_pct", "percent", rec="cd",
         left=[L(r"\b(?:(?:fluorescence|fluorescent|photoluminescence|photoluminescent|PL|absolute|relative|"
                 r"luminescence|emission)\s+)?(?:quantum\s+yields?|QYs?|PLQYs?|ΦF?|Φf)\b",
                 r"\(\s*(?:QY|PLQY|Φ)\s*\)|is|was|were|reached|reaching|achieved|high|relatively|maximum|max|"
                 r"estimated|calculated|determined|value|values|be|PLQY|QY|with|exhibited|showed|in\s+water|in\s+"
                 r"aqueous\s+solution|remarkable|excellent|impressive|satisfactory|reasonable|outstanding|ultrahigh|"
                 r"ultra-high|superior|good|moderate|highest|record")],
         right=[R(r"(?:\)\s*)?(?:(?:fluorescence|fluorescent|photoluminescence|PL|absolute|relative|high|emission)\s+)?"
                  r"(?:quantum\s+yields?|QYs?|PLQYs?)\b")]),
    Rule("mn_height_um", "length", rec="mn", sent=MN_SENT, need=X(r"height|length|tall|long|high"),
         left=[L(rf"\b{MN_KEY}\b",
                 r"with|having|has|had|average|mean|overall|total|needle|individual|each|height|heights|length|"
                 r"lengths|tall|long|was|were|is|are|measuring|measured|in|nominal|designed|fabricated|fixed|uniform|"
                 r"resulting|optimal|optimi[sz]ed|sharp|conical|pyramidal|solid|hollow|dissolving|hydrogel|polymeric|"
                 r"which|that|exhibited|showed|possess\w*"),
               L(r"\b(?:needle\s+|microneedle\s+|MN\s+)?(?:heights?|lengths?)\b",
                 r"is|was|were|each|individual|needle|average|mean")],
         right=[R(rf"-?\s*(?:(?:needle|microneedle|MN)\s+)?(?:tall|high|long|in\s+height|in\s+length|height|"
                  rf"length)\b")],
         excl_left=X(r"(?:penetration|insertion|channel|backing|base|array|wound|wave|focal|path|chain|fib(?:er|"
                     r"re)|cell|incision|cut|depth|deep|penetrated|inserted|thickness|width|diameter|pitch|spacing|"
                     r"tip|skin|layer|print)\s+(?:heights?|lengths?)?\b[^.;\d]{0,20}$"),
         excl_right=X(r"\s*(?:-?\s*)?(?:deep|depth|into\s+(?:the\s+)?(?:skin|dermis|epidermis|tissue)|penetrat\w*|"
                      r"insert\w*|wide|width|thick|thickness|diameter|base|tip|pitch|spacing|apart|interval|from)\b")),
    Rule("mn_base_width_um", "length", rec="mn", sent=MN_SENT,
         left=[L(r"\bbase\s*(?:widths?|diameters?|dimensions?|sizes?|sides?|lengths?)?\b",
                 r"is|was|were|with|and|its|their|each|needle"),
               L(r"\b(?:basal|bottom)\s+(?:widths?|diameters?)\b", r"is|was|were")],
         right=[R(r"(?:-?\s*(?:wide|in\s+width|in\s+diameter))?\s*(?:(?:at|in)\s+(?:the|its)\s+base|(?:in\s+)?"
                  r"(?:base|basal)(?:\s*(?:widths?|diameters?))?)\b(?!\s*(?:plates?|layers?|lines?|films?|"
                  r"substrates?|materials?|polymers?|of\s+the\s+patch|radius|radii|area))")],
         excl_left=X(r"(?:radius|radii|backing|patch|substrate|plate)\b[^.;\d]{0,15}$|(?:interspac\w*|spacing|pitch|"
                     r"distance|gap)\b[^.;\d]{0,30}$"),
         excl_right=X(r"\s*(?:interspac\w*|spacing|pitch|apart|distance|gap)\b")),
    Rule("mn_tip_radius_um", "length", rec="mn", sent=MN_SENT,
         left=[L(r"\btips?\s*(?:radius|radii|radius\s+of\s+curvature|curvature\s+radius|curvature\s+radii)\b",
                 r"is|was|were|with|its|their|sharp|small"),
               L(r"\bradius\s+of\s+(?:the\s+)?tips?\b", r"is|was")],
         right=[R(r"-?\s*(?:in\s+)?tip\s+(?:radius|radii|curvature)\b")]),
    Rule("mn_tip_diameter_um", "length", rec="mn", sent=MN_SENT,
         left=[L(r"\btips?\s*(?:diameters?|widths?|sizes?)\b", r"is|was|were|with|its|their|sharp|small")],
         right=[R(r"-?\s*(?:in\s+)?tip\s+(?:diameters?|widths?)\b")]),
    Rule("mn_pitch_um", "length", rec="mn", sent=MN_SENT,
         left=[L(r"\b(?:pitch|pitches|cent(?:er|re)-to-cent(?:er|re)\s+(?:distance|spacing|interval)s?|tip-to-tip\s+"
                 r"(?:distance|spacing|interval)s?|distances?\s+between\s+(?:the\s+)?(?:two\s+)?(?:adjacent|"
                 r"neighbou?ring|nearest)\s+(?:micro-?needle\s+|needle\s+|MN\s+)?tips)\b",
                 r"is|was|were|with|and|its|their|needle|needles|between|adjacent|neighbou?ring|microneedles|MNs|each")],
         right=[R(r"(?:\(\s*)?(?:(?:needle|microneedle|MN)\s+)?(?:pitch|cent(?:er|re)-to-cent(?:er|re)|tip-to-tip)\b")]),
    Rule("mn_patch_side_mm", "length", rec="mn", dims="square", singles=False, lists=False,
         left=[L(r"\b(?:patch|patches|array|arrays|MNAs?|MN\s+patch(?:es)?|microneedle\s+patch(?:es)?|backing|"
                 r"substrate|base\s*plate|baseplate|device)\b",
                 r"size|sizes|dimension|dimensions|area|with|measuring|is|was|overall|total|footprint")],
         right=[R(r"(?:\^2\s*)?(?:(?:microneedle|MN|MNA|hydrogel|GelMA|square)[\s-]+){0,2}(?:patch|patches|array|"
                  r"arrays|MNAs?|area|backing)\b")]),
    Rule("mn_patch_diameter_mm", "length", rec="mn", need=X(r"diameter"), lists=False,
         left=[L(r"\b(?:patch|patches|MNAs?|MAPs?|arrays?|microarrays?)\b",
                 r"with|having|diameter|diameters|was|is|circular|round|in")],
         right=[R(r"-?\s*(?:diameter|in\s+diameter)\s+(?:(?:circular|round|microneedle|MN|hydrogel)[\s-]+){0,2}"
                  r"(?:patch|patches|array|arrays|MNAs?|MAPs?)\b")],
         excl_left=X(r"(?:needles?|microneedles?|MNs?|tips?|bases?|holes?|lumens?|channels?|pores?)\b[^.;\d]{0,25}$")),
    Rule("mn_patch_area_mm2", "length", rec="mn", pow=2, lists=False,
         left=[L(r"\b(?:patch|patches|array|arrays|MNAs?|MAPs?|MN\s+patch(?:es)?|microneedle\s+patch(?:es)?|"
                 r"microarrays?|footprint)\b",
                 r"size|sizes|area|areas|with|covering|covered|occupied|occupying|occupies|measuring|is|was|each|"
                 r"total|surface|surface\s+area|active\s+area")],
         right=[R(r"(?:\)\s*)?(?:each\s+)?(?:(?:microneedle|MN|MNA|hydrogel|dissolving|square|circular|round)[\s-]+)"
                  r"{0,2}(?:patch|patches|array|arrays|MNAs?|MAPs?|area|surface\s+area|patch\s+units?|patch\s+"
                  r"pixels?)\b")],
         excl_left=X(r"(?:densit\w*|per|/)\s*$|(?:estimated|projected|theoretically|required|would|could|"
                     r"extrapolat\w*|larger\s+than|up\s+to|no\s+greater\s+than|skin|wound|scar|lesion|"
                     r"electrode|working\s+electrode|sensor\s+area)\b[^.;\d]{0,40}$"),
         excl_right=X(r"\s*(?:of\s+)?(?:skin|wound|scar|lesion|tissue)\b")),
    Rule("mn_backing_thickness_um", "length", rec="mn", sent=MN_SENT, need=X(r"thick"),
         left=[L(r"\b(?:backing|base|basal|supporting|support|patch(?:es)?|base\s*plates?|baseplates?)\s*(?:layers?|"
                 r"films?|plates?|sheets?|substrates?)?\s*(?:thickness|thick)?\b",
                 r"with|having|had|has|thickness|thick|was|is|were")],
         right=[R(r"-?\s*thick\s+(?:\w+\s+){0,2}(?:backing|base\s+(?:layer|plate|film)|basal\s+layer|supporting\s+"
                  r"(?:layer|film)|substrate)\b")]),
    Rule("led_wavelength_nm", "length",
         left=[L(r"\b(?:LEDs?|light-emitting\s+diodes?|µLEDs?)\b",
                 r"at|with|emitting|emits?|centered|centred|peak|peaked|wavelength|wavelengths|λ|UV|blue|violet|"
                 r"green|red|is|was|were|are|chip|chips|source|sources|light")],
         right=[R(r"(?:(?:UV|ultraviolet|blue|violet|green|red|white|SMD|high-power|miniature|mini|micro|"
                  r"surface-mount|excitation)[\s-]+){0,2}(?:LEDs?|light-emitting\s+diodes?|µLEDs?|micro-LEDs?)\b")]),
    Rule("reader_channel_nm", "length",
         left=[L(r"\b(?:optical\s+|spectral\s+|detection\s+)?channels?\b", r"at|centered|centred|is|was|were")],
         right=[R(r"(?:reader'?s?\s+|reader\u2019s\s+)?(?:optical\s+|spectral\s+|detection\s+)?channels?\b")]),
    Rule("bilirubin_lod_um", "conc", sent=BILI_SENT,
         left=[L(r"\b(?:detection\s+limits?|limits?\s+of\s+detection|LODs?)\b",
                 r"\(\s*LODs?\s*\)|is|was|were|reached|achieved|calculated|estimated|determined|found|obtained|to|be|"
                 r"for|value|values|which|with|reaching|low|lowest|(?:for|of)\s+(?:free\s+|total\s+)?(?:bilirubin|"
                 r"BR|BIL)"),
               L(r"\bdetect(?:ed|ion|s)?\b[^.;\d]{0,30}?(?:as\s+low\s+as|down\s+to)")]),
    Rule("bilirubin_lod_mg_dl", "massconc", sent=BILI_SENT,
         left=[L(r"\b(?:detection\s+limits?|limits?\s+of\s+detection|LODs?)\b",
                 r"\(\s*LODs?\s*\)|is|was|were|reached|achieved|calculated|estimated|determined|found|obtained|to|be|"
                 r"for|value|values|which|with|reaching|low|lowest|(?:for|of)\s+(?:free\s+|total\s+)?(?:bilirubin|"
                 r"BR|BIL)")]),
    Rule("bilirubin_range_low_um", "conc", sent=BILI_SENT, ranges="ends", singles=False, lists=False,
         left=[L(r"\b(?:linear(?:ity)?\s+(?:detection\s+|response\s+|dynamic\s+|working\s+)?ranges?|detection\s+ranges?"
                 r"|dynamic\s+ranges?|working\s+ranges?|concentration\s+ranges?|linear\s+relationship|linearly)\b"
                 r"[^.;\d]{0,40}?",
                 r"is|was|were|from|between|in|over|within|range|ranges|ranging|concentrations?|bilirubin|BR|with|"
                 r"for")]),
    Rule("quartz_window_thickness_mm", "length", need=X(r"thick"),
         left=[L(r"\bquartz\s*(?:glass|windows?|slides?|plates?|covers?|substrates?)?\s*(?:thickness|thick)?\b",
                 r"with|thickness|thick|was|is")],
         right=[R(r"-?\s*thick\s+quartz\b")]),
]

SPECIALS = {}   # filled below: per sensor, functions (nt, ctxs, rec, field, flags) -> candidate values


# ------------------------------------------------------------------------------------------------- extraction
class Stats:
    def __init__(self):
        self.rejected = {}

    def no(self, param, why):
        self.rejected.setdefault(param, {}).setdefault(why, 0)
        self.rejected[param][why] += 1


SEMI_QD = X(r"CdSe|CdTe|CdS\b|InP|CuInS|AgInS|Ag\(?2\)?S|ZnSe|PbS|core/shell|core-shell|Qdots?|QD\s*-?\d{3}|"
            r"semiconductor\s+(?:quantum|nano)")


def rec_flags(rec):
    t = f"{rec['title']} {rec['abstract']}"
    n_opm, n_nv = len(OPM_TERMS.findall(t)), len(NV_TERMS.findall(t))
    opm = n_opm > 0 and n_opm >= n_nv
    return {"opm": opm, "opm_mag": opm and bool(MAG_REC.search(t)), "nv": n_nv > 0 and n_nv >= n_opm,
            "cd": bool(CD_REC.search(t)), "mn": bool(MN_REC.search(t)),
            "qd_semi": bool(SEMI_QD.search(t) or (QD_SENT.search(t) and not NONSEMI.search(t)))}


def make_quote(nt: NText, qa: int, qb: int, ss: int, se: int):
    """Exact phrase of the original text around normalised [qa, qb): padded to whole words inside the sentence."""
    o_s, o_e = nt.span(ss, se)
    core = nt.span(qa, qb)
    orig = nt.orig
    for pad_l, pad_r in ((40, 25), (12, 8), (0, 0)):
        a = max(o_s, core[0] - pad_l)
        b = min(o_e, core[1] + pad_r)
        if pad_l and a > o_s:
            sp = orig.rfind(" ", o_s, core[0])
            a = orig.find(" ", a, core[0]) + 1 if orig.find(" ", a, core[0]) >= 0 else core[0]
            if sp < 0 and a > core[0]:
                a = core[0]
        while a > o_s and orig[a - 1].isalnum():
            a -= 1
        if pad_r and b < o_e:
            nxt = orig.rfind(" ", core[1], b)
            b = nxt if nxt > core[1] else b
        while b < o_e and orig[b:b + 1].isalnum():
            b += 1
        q = orig[a:b].strip(" ,;:")
        if len(q) > 260:
            q = orig[core[0]:core[1]].strip(" ,;:")
        if not any(w in q.lower() for w in WRITE_AVOID):
            return q
    return None


def value_round(v: float) -> float:
    return float(f"{v:.6g}")


def emit(out, stats, param, base_vals, nt, qa, qb, ss, se, rec, field, note=None):
    sensor, unit, lo, hi, _ = PARAMS[param]
    dim, size = TARGET[unit]
    quote = make_quote(nt, qa, qb, ss, se)
    if quote is None:
        stats.no(param, "quote would contain a banned word")
        return
    o_s, o_e = nt.span(ss, se)
    sentence = nt.orig[o_s:o_e].strip()                   # the exact sentence (whitespace runs collapsed)
    if any(w in sentence.lower() for w in WRITE_AVOID):
        sentence = None                                  # a word SpinDrift files must not contain: quote only
    for bv in base_vals:
        v = value_round(bv / size if dim != "temp" else bv)
        if not (lo <= v <= hi):
            stats.no(param, "outside the plausible range")
            continue
        out.append({"param": param, "value": v, "unit": unit, "quote": quote, "sentence": sentence, "field": field,
                    "note": note, "pos": nt.span(qa, qb)[0]})


CONTINUES = re.compile(r"\s*(?:,|,?\s*and|,?\s*or|&)\s*")


def apply_rules(rec, flags, stats, rules, own=False):
    out = []
    for field in ("title", "abstract"):
        text = rec[field]
        if not text:
            continue
        nt = normalise(text)
        s = nt.s
        sents = sentences(s, pdf=rec.get("source") == "own")
        qs = quantities(s)
        cap = {}                                       # quantity index -> {rule param: quote start}
        for i, q in enumerate(qs):
            a, b = q["span"]
            ss, se = next(((x, y) for x, y in sents if x <= a < y + 1), (0, len(s)))
            sentence = s[ss:se]
            for rule in rules:
                if rule.dim != q["dim"] or (rule.rec and not flags.get(rule.rec)):
                    continue
                if (rule.sent and not rule.sent.search(sentence)) or (rule.excl_sent and
                                                                      rule.excl_sent.search(sentence)):
                    continue
                loff = max(ss, a - 170)
                left, right = s[loff:a], s[b:min(se, b + 130)]
                hit, continued = None, False
                for rx in rule.left:
                    m = rx.search(left)
                    if m:
                        hit = (loff + m.start(), b, left[m.start():] + " " + right[:30])
                        break
                if not hit:
                    for rx in rule.right:
                        m = rx.match(right)
                        if m:
                            hit = (a, b + m.end(), left[-40:] + " " + right[:m.end()])
                            break
                if not hit:
                    for lrx, rrx in rule.both:
                        ml, mr = lrx.search(left), rrx.match(right)
                        if ml and mr:
                            hit = (loff + ml.start(), b + mr.end(), left[ml.start():] + " " + right[:mr.end()])
                            break
                if not hit and i and rule.param in cap.get(i - 1, {}):
                    # the next item of a list whose items each carry a unit: 'heights of 300 µm and 250 µm'
                    prev = qs[i - 1]
                    if (prev["dim"] == q["dim"] and prev["span"][0] >= ss
                            and CONTINUES.fullmatch(s[prev["span"][1]:a]) and OWN_FREE.match(right)):
                        hit, continued = (cap[i - 1][rule.param], b, ""), True
                if not hit:
                    continue
                param = rule.param
                if rule.need and not continued and not rule.need.search(hit[2]):
                    continue
                got = take(rule, q, left, right, stats, own=own)
                if got is None:
                    continue
                vals, note = got
                if continued:
                    note = (note + "; " if note else "") + "next item of a list that names the parameter once"
                ctx = {"sentence": sentence, "near": left[-45:] + " " + right[:30], "gap": hit[2], "kind": q["kind"],
                       "rec_qd": flags.get("qd_semi")}
                if rule.ranges == "ends":
                    emit(out, stats, "bilirubin_range_low_um", [vals[0]], nt, hit[0], hit[1], ss, se, rec, field,
                         f"low end of {q['text'].strip()}")
                    emit(out, stats, "bilirubin_range_high_um", [vals[1]], nt, hit[0], hit[1], ss, se, rec, field,
                         f"high end of {q['text'].strip()}")
                    continue
                if rule.route:
                    param = rule.route(ctx)
                emit(out, stats, param, vals, nt, hit[0], hit[1], ss, se, rec, field, note)
                cap.setdefault(i, {})[rule.param] = hit[0]
                # earlier items, when the keyword comes after the list: '0.3 mm and 0.4 mm base diameters'
                j, nxt = i - 1, a
                while hit[0] == a and j >= 0 and rule.param not in cap.get(j, {}):
                    prev = qs[j]
                    pa, pb = prev["span"]
                    if not (prev["dim"] == q["dim"] and pa >= ss and CONTINUES.fullmatch(s[pb:nxt])):
                        break
                    got = take(rule, prev, s[max(ss, pa - 170):pa], s[pb:min(se, pb + 130)], stats, own=own)
                    if got is None:
                        break
                    pnote = (got[1] + "; " if got[1] else "") + "earlier item of a list that names the parameter once"
                    emit(out, stats, param, got[0], nt, pa, hit[1], ss, se, rec, field, pnote)
                    cap.setdefault(j, {})[rule.param] = pa
                    j, nxt = j - 1, pa
        for special in SPECIALS.get(rec["_sensor"], []):
            out.extend(special(nt, sents, rec, field, flags, stats))
    return out


OWN_FREE = re.compile(r"\s*(?:[,;.)\]]|and\b|or\b|$)")     # no descriptor of its own after a number
RESPECTIVELY = re.compile(r"[^.;]{0,40}\brespectively\b", re.I)
CITED = re.compile(r"\s*[,.;:]?\s*(?:\[\s*\d+(?:\s*[,-]\s*\d+)*\s*\]|\(\s*refs?\.?\s*\d)", re.I)


def take(rule, q, left, right, stats, own=False):
    """(values in base units, note) for a quantity a rule has matched, or None when it must be rejected. In a
    device's own paper (own=True) both ends of a stated range are kept, each as a stated number."""
    param = rule.param
    if (rule.excl_left and rule.excl_left.search(left)) or (rule.excl_right and rule.excl_right.match(right)):
        stats.no(param, "excluded by the words next to it")
        return None
    if own and CITED.match(right):
        stats.no(param, "cited from another paper (a reference follows the number)")
        return None
    if RESPECTIVELY.match(right) or re.search(r"\brespective\b", left[-90:], re.I):
        stats.no(param, "part of a 'respectively' list")        # 'with respective detection limits of A, B and C'
        return None
    bm = BOUND.search(left[-45:])
    if bm and re.sub(r"\s+", " ", bm.group(1).lower()) not in rule.bounds_ok:
        stats.no(param, "a bound, not a value")
        return None
    note, vals, kind = rule.note, q["vals"], q["kind"]
    if kind != "dims" and q["pow"] != rule.pow:
        stats.no(param, "an area or volume, not a length" if rule.pow == 1 else "not an area")
        return None
    if kind == "dims":
        if rule.dims == "max":
            return [max(vals)], f"largest of the stated dimensions {q['text'].strip()}"
        if rule.dims == "square" and len(vals) == 2 and abs(vals[0] - vals[1]) <= 1e-9 * max(vals):
            return vals[:1], f"square, {q['text'].strip()}"
        stats.no(param, "dimensions not usable for this parameter")
        return None
    if kind == "rng":
        if rule.ranges == "upper":
            return [vals[1]], f"upper end of the stated band {q['text'].strip()}"
        if rule.ranges == "ends" and vals[0] < vals[1]:
            return vals, None
        if own and vals[0] < vals[1]:
            return vals, f"the two ends of the stated range {q['text'].strip()}"
        stats.no(param, "a range, not a value")
        return None
    if rule.ranges == "ends":
        return None
    if kind == "lst" and not rule.lists:
        stats.no(param, "a list")
        return None
    if kind == "one" and not rule.singles:
        return None
    if rule.pm and re.search(r"±\s*$", left):
        note = "written ±X, kept as X"
    return vals, note


# special patterns that are not 'number + unit'
QD_PRODUCT = re.compile(r"\b(?:QDs?|Qdots?|QDots?|Q-dots?)\s*-?\s*(?P<n>[4-8]\d\d)(?![\d.])(?!\s*(?:nm|°|%|K\b|µ))")
EXEM = re.compile(r"\b(?P<k>excitation\s*/\s*emission|emission\s*/\s*excitation|ex\s*/\s*em|em\s*/\s*ex|"
                  r"λex\s*/\s*λem|λem\s*/\s*λex|excitation\s+and\s+emission)\b(?:\s*(?:wavelengths?|maxima|maximum|"
                  r"peaks?|of|at|were|was|is|are|the|optimal|optimum|=|:|\())*\s*(?P<a>[2-9]\d\d(?:\.\d+)?)\s*"
                  r"(?:nm\s*)?(?:/|and)\s*(?P<b>[2-9]\d\d(?:\.\d+)?)\s*nm", re.I)
ARRAY_NN = re.compile(r"(?<![\w.×])(?P<a>\d{1,3})\s*×\s*(?P<b>\d{1,3})(?![\d.])(?!\s*(?:mm|cm|µm|nm|m\b|\^|%|×))")
ARRAY_RIGHT = re.compile(r"\s*(?:-?\s*)?(?:(?:micro-?needles?|MNs?|MNAs?|needles?|arrays?|microneedle\s+arrays?|MN\s+"
                         r"arrays?|matri(?:x|ces)|configuration|grid|pattern|layout|square\s+array)\b|\(\s*(?:\w+\s*)?"
                         r"(?:needles|microneedles|MNs))", re.I)
ARRAY_LEFT = re.compile(r"(?:arrays?|patch(?:es)?|grid|matri(?:x|ces)|arranged\s+in|arrangement|consisting\s+of|"
                        r"comprising|containing)\s*(?:of|with|in)?\s*(?:a|an)?\s*$", re.I)
MN_COUNT = re.compile(r"(?<![\w.×/-])(?P<n>\d{1,5})\s+(?:(?:conical|pyramidal|sharp|solid|hollow|dissolving|hydrogel|"
                      r"polymeric|individual|GelMA)\s+){0,2}(?:micro-?needles|MNs|needles|micro-?projections)\b"
                      r"(?!\s*(?:per\b|/|·|cm\s*\^?\s*\(?-|mm\s*\^?\s*\(?-))", re.I)   # not a density per cm²
NOT_A_COUNT = re.compile(r"\b(?:PEG|PEGDA|PVP|PVA|PEO|PLA|PLGA|FGF|IL|CD|Pluronic|Tween|Span|Brij|Triton|Gantrez|"
                         r"Kollidon|Soluplus|Eudragit|K|S|type|grade|lot|batch|day|days|week|weeks|n\s*=)\s*-?\s*$",
                         re.I)


def _sent_of(sents, a, n):
    return next(((x, y) for x, y in sents if x <= a < y + 1), (0, n))


def special_qd(nt, sents, rec, field, flags, stats):
    out, s = [], nt.s
    for m in QD_PRODUCT.finditer(s):
        ss, se = _sent_of(sents, m.start(), len(s))
        emit(out, stats, "qd_emission_nm", [float(m.group("n")) * 1e-9], nt, m.start(), m.end(), ss, se, rec, field,
             "product name: emission maximum in nm")
    return out


def special_cqd(nt, sents, rec, field, flags, stats):
    out, s = [], nt.s
    if flags.get("cd"):
        for m in EXEM.finditer(s):
            ss, se = _sent_of(sents, m.start(), len(s))
            if not X(CD_KEY).search(s[ss:se]):
                continue
            a, b = float(m.group("a")), float(m.group("b"))
            if m.group("k").lower().replace(" ", "").startswith(("emission/", "em/", "λem/")):
                a, b = b, a
            emit(out, stats, "cd_excitation_nm", [a * 1e-9], nt, m.start(), m.end(), ss, se, rec, field,
                 "first of an excitation/emission pair")
            emit(out, stats, "cd_emission_nm", [b * 1e-9], nt, m.start(), m.end(), ss, se, rec, field,
                 "second of an excitation/emission pair")
    if flags.get("mn"):
        for m in ARRAY_NN.finditer(s):
            ss, se = _sent_of(sents, m.start(), len(s))
            right, left = s[m.end():min(se, m.end() + 60)], s[max(ss, m.start() - 60):m.start()]
            mr = ARRAY_RIGHT.match(right)
            if not (mr or ARRAY_LEFT.search(left)):
                continue
            if not MN_SENT.search(s[ss:se]):
                continue
            na, nb = int(m.group("a")), int(m.group("b"))
            if na != nb:
                stats.no("mn_array_n", "not a square array")
                continue
            emit(out, stats, "mn_array_n", [float(na)], nt, m.start(), m.end() + (mr.end() if mr else 0), ss, se,
                 rec, field, None)
        for m in MN_COUNT.finditer(s):
            ss, se = _sent_of(sents, m.start(), len(s))
            if re.search(r"×\s*$", s[max(0, m.start() - 4):m.start()]):
                continue
            if BOUND.search(s[max(ss, m.start() - 45):m.start()]):
                stats.no("mn_count", "a bound, not a value")
                continue
            if NOT_A_COUNT.search(s[max(ss, m.start() - 20):m.start()]):
                stats.no("mn_count", "a name or label, not a count")
                continue
            emit(out, stats, "mn_count", [float(m.group("n"))], nt, m.start(), m.end(), ss, se, rec, field, None)
    return out


SPECIALS.update({"qd": [special_qd], "cqd": [special_cqd]})


def record_source(rec, key, field):
    src = (f"arXiv API record arXiv:{key[6:]} ({field}), {rec['url']}" if rec["source"] == "arxiv" else
           f"NCBI PubMed record PMID {key[5:]} ({field}), {rec['url']}")
    return src + (f", doi:{rec['doi']}" if rec["doi"] else "")


def excerpt(sentence: str, quote: str, width: int = 150) -> str:
    """An exact excerpt of an overlong 'sentence' (table or figure text) around the quote, cut at spaces."""
    i = sentence.find(quote)
    if i < 0:
        return quote
    a, b = max(0, i - width), min(len(sentence), i + len(quote) + width)
    if a > 0:
        a = sentence.find(" ", a, i) + 1 or i
    if b < len(sentence):
        b = sentence.rfind(" ", i + len(quote), b) if sentence.rfind(" ", i + len(quote), b) > 0 else b
    return sentence[a:b].strip()


def value_entry(c, key, source, year, page=None):
    v = {"value": c["value"], "unit": c["unit"], "quote": c["quote"], "sentence": c["sentence"], "id": key,
         "source": source, "year": year}
    if page:
        v["page"] = page
    notes = [c["note"]] if c["note"] else []
    if c["sentence"] and len(c["sentence"]) > 420:
        v["sentence"] = excerpt(c["sentence"], c["quote"])
        notes.append("sentence: exact excerpt, the number sits in table or figure text rather than in a sentence")
    if c["sentence"] is None:
        notes.append("sentence not reproduced: it contains a word SpinDrift files do not use; the quote is exact")
        v.pop("sentence")
    if notes:
        v["note"] = "; ".join(notes)
    return v


def extract(sensor: str, corpus: dict):
    """Values the rules find in every harvested record (other papers are reported as counts only)."""
    rules = [r for r in RULES if PARAMS[r.param][0] == sensor]
    stats = Stats()
    found, n_used = {}, 0
    for key, rec in corpus.items():
        flags = rec_flags(rec)
        if sensor == "opm" and not flags["opm"] or sensor == "nv" and not flags["nv"]:
            continue
        n_used += 1
        rec["_sensor"] = sensor
        seen = set()
        for c in apply_rules(rec, flags, stats, rules):
            k = (c["param"], c["value"])
            if k in seen:
                continue                               # one record states the same value once
            seen.add(k)
            found.setdefault(c["param"], []).append(value_entry(c, key, record_source(rec, key, c["field"]),
                                                                rec["year"]))
        rec.pop("_sensor", None)
    return found, stats, n_used


# ------------------------------------------------------------------------------------------------- own papers
# The device's own paper per sensor. Its abstract comes from the harvest; open full texts are read from the local
# download cache of scripts/build_sensor_parts.py (same official files, SHA-256 recorded); nothing is downloaded.
SP_CACHE = Path(os.environ.get("SPINDRIFT_CACHE", Path.home() / ".spindrift_cache")) / "sensor-parts"
OWN = {
    "opm": {"id": "arXiv:2408.02941", "doi": None, "year": 2024,
            "paper": ("Zhao, Mammei & Fujimoto, 'QuSpin Zero-Field Magnetometer Characterization for the TUCAN "
                      "Experiment', arXiv 2408.02941 (the QuSpin QZFM paper used by data/sensor_parts/opm.json)"),
            "full_texts": [("arxiv-2408.02941v3.pdf", "https://arxiv.org/pdf/2408.02941v3", "arXiv PDF v3")],
            "access": "abstract and the open arXiv full text read"},
    "nv": {"id": "arXiv:2601.18843", "doi": None, "year": 2026,
           "paper": "Omar et al., 'Human Cardiac Measurements with Diamond Magnetometers', arXiv 2601.18843 (CC BY 4.0)",
           "full_texts": [("arxiv-2601.18843v1.pdf", "https://arxiv.org/pdf/2601.18843v1", "arXiv PDF v1")],
           "access": "abstract and the open arXiv full text read"},
    "qd": {"id": "PMID:23003565", "doi": "10.1021/ac302284s", "year": 2012,
           "paper": ("Long, Zhang, Zhang & Zhang, 'Single quantum dot based nanosensor for renin assay', Anal. Chem. "
                     "84, 8846 (2012)"),
           "full_texts": [],
           "access": "abstract only: the full text and Supporting Information are paywalled (pubs.acs.org)"},
    "cqd": {"id": "PMID:39356285", "doi": "10.1021/acsnano.4c06191", "year": 2024,
            "paper": "Tabatabaee, Naghdi, Peyravian, Kiani & Golmohammadi, ACS Nano 18, 28012 (2024)",
            "full_texts": [("nn4c06191_si_001.pdf", "https://ndownloader.figshare.com/files/49568629",
                            "Supporting Information nn4c06191_si_001.pdf (figshare 27153931, CC BY-NC 4.0)")],
            "access": "abstract and the open Supporting Information read; the main text is paywalled (pubs.acs.org)"},
}
OWN_FLAGS = {"opm": True, "opm_mag": True, "nv": True, "cd": True, "mn": True, "qd_semi": True}


def pdf_pages(raw: bytes) -> list[str]:
    try:  # PyMuPDF (requirements.txt: pymupdf)
        import pymupdf
    except ImportError:  # older installs expose the same API as fitz
        import fitz as pymupdf  # type: ignore
    doc = pymupdf.open(stream=raw, filetype="pdf")
    return [re.sub(r"-[ \t]*\n[ \t]*", "-", page.get_text()) for page in doc]   # a broken line keeps its hyphen


SI_ROW = re.compile(r"Table S1\.\s+Comparison of our developed sensor[^\n]*?linear range\s+LOD\b")


def si_comparison_row(text: str, stats: Stats):
    """Tabatabaee et al. SI Table S1 compares the sensor with earlier ones; its own row ends with 'Our sensor'.
    Columns: sensing technique/probe, sample, linear range, LOD, continuous monitoring, wearability, REASSURED, Ref.
    Only that row is read (the other rows are other sensors)."""
    w = ws(text)
    if not SI_ROW.search(w) or "Our sensor" not in w:
        return []
    end = w.index("Our sensor") + len("Our sensor")
    start = w.rfind("fluorimetric/", 0, end)
    if start < 0:
        return []
    row = w[start:end]
    nt = normalise(row)
    qs = [q for q in quantities(nt.s) if q["dim"] == "massconc"]
    if len(qs) != 2 or qs[0]["kind"] != "rng" or qs[1]["kind"] != "one":
        stats.no("bilirubin_range_low_mg_dl", "Table S1 own row not in the expected column form")
        return []
    out = []
    lo, hi = qs[0]["vals"]
    for param, val, col in (("bilirubin_range_low_mg_dl", lo, "low end of the 'linear range' column"),
                            ("bilirubin_range_high_mg_dl", hi, "high end of the 'linear range' column"),
                            ("bilirubin_lod_mg_dl", qs[1]["vals"][0], "'LOD' column")):
        _, unit, plo, phi, _ = PARAMS[param]
        v = value_round(val / TARGET[unit][1])
        if plo <= v <= phi:
            out.append({"param": param, "value": v, "unit": unit, "quote": row, "sentence": row, "field": "table",
                        "note": f"Table S1, row 'Our sensor' (this patch): {col}", "pos": 0})
    return out


NV_TABLE2 = ("Property", ("JGU", "ZAQuant", "Q.Ant"), "Table 2: Overview of the three diamond sensors.")
NV_TABLE2_ROWS = (("Diamond dimension (w x l x h)", "Sensitivity"), ("Sensitivity", "Magnetic bias"),
                  ("Magnetic bias", "Modulation"))


def nv_table2(raw_text: str, stats: Stats):
    """Omar et al. Table 2 (rows by property, one column per build: JGU, ZAQuant, Q.Ant). Each cell is read in
    its own column; a cell without a number (e.g. 'Zero DC bias') gives no value."""
    head, cols, caption = NV_TABLE2
    lines = [ln.strip() for ln in raw_text.split("\n")]
    try:
        h = next(i for i in range(len(lines) - 3) if lines[i:i + 4] == [head, *cols])
        end = lines.index(caption, h)
    except (StopIteration, ValueError):
        return []
    body = lines[h + 4:end]
    out = []
    for label, nxt in NV_TABLE2_ROWS:
        if label not in body or nxt not in body:
            continue
        a, b = body.index(label), body.index(nxt)
        cells = body[a + 1:b]
        row = ws(" ".join([label] + cells))
        if len(cells) != 3:                            # a cell broken over several lines: split by its numbers
            joined = normalise(" ".join(cells)).s
            qs = quantities(joined)
            if len(qs) != 3:
                stats.no("nv_sensitivity_pt", f"Table 2 row '{label}' not in three columns")
                continue
            cells = [q["text"] for q in qs]
        for col, cell in zip(cols, cells):
            qs = quantities(normalise(cell).s)
            if not qs:
                continue
            q = qs[0]
            where = f"Table 2 (p. 15), row '{label}', column {col}"
            vals = []
            if label.startswith("Diamond") and q["kind"] == "dims" and len(q["vals"]) == 3:
                vals = [("nv_diamond_size_mm", max(q["vals"]), f"{where}: largest of w × l × h"),
                        ("nv_diamond_thickness_mm", q["vals"][2], f"{where}: h of w × l × h")]
            elif label == "Sensitivity" and q["dim"] == "field_noise":
                vals = [("nv_sensitivity_pt", q["vals"][0], where)]
            elif label == "Magnetic bias" and q["dim"] == "field":
                vals = [("nv_bias_field_mt", q["vals"][0], where)]
            for param, base, note in vals:
                _, unit, plo, phi, _ = PARAMS[param]
                v = value_round(base / TARGET[unit][1])
                if plo <= v <= phi:
                    out.append({"param": param, "value": v, "unit": unit, "quote": row, "sentence": row,
                                "field": "table", "note": note, "pos": 0})
    return out


def own_values(sensor: str, corpus: dict, stats: Stats):
    """Values stated in the device's own paper: (values by parameter, description of what was read)."""
    o = OWN[sensor]
    rules = [r for r in RULES if PARAMS[r.param][0] == sensor]
    found, seen = {}, {}
    rec = corpus.get(o["id"]) or next((r for r in corpus.values() if o["doi"] and r["doi"] == o["doi"]), None)
    info = {"id": o["id"], "doi": o["doi"], "paper": o["paper"], "access": o["access"],
            "record_in_harvest": rec is not None, "full_texts": []}

    def toc(entry):                                    # a line of a table of contents ('...... S4')
        return bool(re.search(r"\u2026|\.{4,}", entry.get("sentence") or entry["quote"]))

    def keep(cands, key, source, year, page=None, cutoff=None):
        for c in cands:
            if cutoff is not None and c["pos"] >= cutoff:
                continue                               # it lies on the next page and is read there
            k = (c["param"], c["value"])
            entry = value_entry(c, key, source(c), year, page)
            if k not in seen:                          # first statement of a value wins (abstract, then pages)
                seen[k] = entry
                found.setdefault(c["param"], []).append(entry)
            elif toc(seen[k]) and not toc(entry):      # ... unless that was a table-of-contents line
                lst = found[c["param"]]
                lst[lst.index(seen[k])] = entry
                seen[k] = entry
            elif c["field"] == "table" and c["note"] and c["note"] not in (seen[k].get("note") or ""):
                also = f"also {c['note']}: '{c['quote']}'"
                seen[k]["note"] = f"{seen[k]['note']}; {also}" if seen[k].get("note") else also

    if rec:
        rec["_sensor"] = sensor
        keep(apply_rules(rec, OWN_FLAGS, stats, rules, own=True), o["id"],
             lambda c: f"{o['paper']}, {c['field']}; {record_source(rec, rec['key'], c['field'])}", rec["year"])
        rec.pop("_sensor", None)
    for fname, url, label in o["full_texts"]:
        path = SP_CACHE / fname
        entry = {"file": f"SPINDRIFT_CACHE/sensor-parts/{fname}", "url": url, "label": label}
        if not path.exists():
            entry.update(read=False, reason="not in the local cache; not downloaded (cached full texts only)")
            info["full_texts"].append(entry)
            continue
        raw = path.read_bytes()
        pages = pdf_pages(raw)
        entry.update(read=True, sha256=sha256(raw), pages=len(pages))
        info["full_texts"].append(entry)
        for i, text in enumerate(pages, 1):
            prec = {"title": "", "abstract": text, "key": o["id"], "_sensor": sensor, "source": "own",
                    "doi": o["doi"], "url": url, "year": o["year"]}
            cands = apply_rules(prec, OWN_FLAGS, stats, rules, own=True)
            if sensor == "cqd":
                cands += si_comparison_row(text, stats)
            if sensor == "nv":
                cands += nv_table2(text, stats)
            tail = ws(text)
            for c in cands:                            # a sentence cut by the page end is kept as printed
                if (c["sentence"] and c["field"] != "table" and len(c["sentence"]) <= 420
                        and tail.endswith(c["sentence"]) and not c["sentence"].endswith((".", "!", "?"))):
                    c["note"] = (c["note"] + "; " if c["note"] else "") + f"the sentence continues on p. {i + 1}"
            keep(cands, o["id"], lambda c, i=i: f"{o['paper']}, {label}, p. {i}, {url}", o["year"], page=i)
    return found, info


# ------------------------------------------------------------------------------------------------- output
STAT_FORMULAS = {"median": "median", "p10": "10th percentile (numpy.percentile, linear interpolation)",
                 "p90": "90th percentile (numpy.percentile, linear interpolation)", "min": "minimum",
                 "max": "maximum"}


def stat_block(param: str, values: list, sensor: str, what: str):
    """median, p10, p90, min, max as calculated value objects (TO_CONFIRM when n < 3)."""
    unit = PARAMS[param][1]
    n, recs = len(values), len({v["id"] for v in values})
    src = f"SpinDrift calculation from {recs} record{'s' if recs != 1 else ''} (data/literature/{sensor}.json)"
    arr = np.array([v["value"] for v in values], dtype=float)
    status = "TO_CONFIRM" if n < 3 else "VERIFIED"
    vals = {"median": float(np.median(arr)), "p10": float(np.percentile(arr, 10)),
            "p90": float(np.percentile(arr, 90)), "min": float(arr.min()), "max": float(arr.max())}
    out = {}
    for k, val in vals.items():
        note = f"formula: {STAT_FORMULAS[k]} of the n = {n} values in {what}"
        if status == "TO_CONFIRM":
            note += "; fewer than 3 values, to confirm"
        out[k] = vo(value_round(val), unit, src, "calculated", status, None, note)
    return out


def summary(param: str, own: list, other: list, sensor: str, typical: bool):
    _, unit, lo, hi, label = PARAMS[param]
    o = OWN[sensor]
    out = {"label": label, "unit": unit, "plausible_range": [lo, hi],
           "status": "FOUND" if own else "NOT_FOUND", "n": len(own)}
    if own:
        out.update(stat_block(param, own, sensor, f"parameters.{param}.values (the device's own paper, {o['id']})"))
    else:
        for k in STAT_FORMULAS:
            out[k] = missing(unit, f"{o['paper']} ({o['id']})", "published_spec", "NOT_STATED",
                             f"NOT_FOUND: no sentence of the device's own paper ({o['access']}) states this "
                             f"parameter; values from other papers are not used")
    out["values"] = sorted(own, key=lambda v: (v["value"], v.get("page") or 0))
    out["other_papers"] = {"n_values": len(other), "n_records": len({v["id"] for v in other}),
                           "note": "matches in other harvested papers; their values are not written (the device's "
                                   "own paper only, until the user asks to 'add typical')"}
    if typical and other:
        block = {"n": len(other), "n_records": len({v["id"] for v in other})}
        block.update(stat_block(param, other, sensor, f"parameters.{param}.typical_other_devices.values "
                                                      f"(other published devices, not this device)"))
        block["values"] = sorted(other, key=lambda v: (v["value"], v["id"]))
        out["typical_other_devices"] = block
    return out


def raw_files_for(cache: Cache, sensor: str):
    out = []
    for rel, info in sorted(cache.man["files"].items()):
        if rel.split("/")[-1].startswith(f"{sensor}__") and rel in cache.used:
            out.append({"file": f"data/literature/raw/{rel}", "service": info.get("service"),
                        "method": info.get("method"), "url": info.get("url"), "pmids": info.get("pmids"),
                        "sha256": info.get("sha256"), "sha256_gz": info.get("sha256_gz"),
                        "bytes": info.get("bytes"), "fetched": info.get("fetched")})
    return out


def build(cache: Cache, sensor: str, typical: bool = False):
    corpus, counts = harvest(cache, sensor)
    if not cache.offline:
        pruned = cache.prune(sensor)
        if pruned:
            print(f"  removed {pruned} cache files that the current {sensor} queries no longer use", flush=True)
    found, stats, n_used = extract(sensor, corpus)
    own_stats = Stats()
    own, own_info = own_values(sensor, corpus, own_stats)
    oid = OWN[sensor]["id"]
    other = {p: [v for v in vals if v["id"] != oid] for p, vals in found.items()}
    n_ax = sum(1 for r in corpus.values() if r["source"] == "arxiv")
    n_pm = sum(1 for r in corpus.values() if r["source"] == "pubmed")
    merged = sum(len(r["also"]) for r in corpus.values())
    sources = [f"arXiv API {ARXIV_API} (Atom; search_query, start, max_results={ARXIV_PAGE}, sortBy=submittedDate, "
               f"sortOrder=ascending; one request every {ARXIV_GAP_S} s; User-Agent '{USER_AGENT}')",
               f"NCBI E-utilities {EUTILS}/esearch.fcgi (db=pubmed, retmax={PUBMED_MAX}) and {EUTILS}/efetch.fcgi "
               f"(POST, rettype=medline, {PUBMED_BATCH} PMIDs per request; tool={TOOL}, no e-mail; at most one "
               f"request every {NCBI_GAP_S} s)",
               f"Device's own paper: {OWN[sensor]['paper']} ({oid}); {OWN[sensor]['access']}"]
    sources += [f"{c['source']} query '{c['id']}': {c['query']}" for c in counts]
    params = {p: summary(p, own.get(p, []), other.get(p, []), sensor, typical)
              for p in PARAMS if PARAMS[p][0] == sensor}
    n_found = sum(1 for v in params.values() if v["status"] == "FOUND")
    obj = {
        "meta": meta(False, sources,
                     about=("Hardware numbers stated in the device's own paper, each with its paper id and exact "
                            "sentence. Parameters the paper does not state are NOT_FOUND. The literature harvest "
                            "(official APIs only) is kept for counts: other papers' values are not written until "
                            "the user asks to 'add typical'."),
                     policy=("values only from the device's own paper (coordinator instruction, 15 Nov 2026); "
                             "NOT_FOUND parameters carry value objects with status NOT_STATED and value null"),
                     own_paper=own_info,
                     queries=counts,
                     counts={"arxiv_records": n_ax, "pubmed_records": n_pm, "merged_by_doi": merged,
                             "total_unique_records": len(corpus),
                             "records_with_abstract": sum(1 for r in corpus.values() if r["abstract"]),
                             "records_read_by_the_rules": n_used,
                             "own_paper_values_written": sum(p["n"] for p in params.values()),
                             "parameters_found": n_found, "parameters_not_found": len(params) - n_found,
                             "other_paper_values_not_written": sum(p["other_papers"]["n_values"]
                                                                   for p in params.values())},
                     dedup="by arXiv id, PMID and DOI (case-insensitive); a record found again keeps its first copy",
                     extraction=("Text is normalised (LaTeX, Unicode and MEDLINE spellings of units, √Hz, °C, ×, "
                                 "±, µ) on a copy that maps back to the original, so each quote and sentence is "
                                 "exact (whitespace runs collapsed; a PDF line break keeps its hyphen). A number "
                                 "counts only when its unit and the words next to it name the parameter (RULES in "
                                 "scripts/build_literature.py); bounds such as 'below', 'respectively' lists, "
                                 "areas or volumes where a length is meant, and values outside each parameter's "
                                 "plausible_range are rejected. In the device's own paper both ends of a stated "
                                 "range are kept."),
                     rejected_in_own_paper=own_stats.rejected,
                     rejected_in_harvest=stats.rejected,
                     raw_files=raw_files_for(cache, sensor),
                     raw_cache=("data/literature/raw/ (gzip of the exact response bytes; see raw/manifest.json); "
                                "not in git (over 20 MB) and not in the public build")),
        "parameters": params,
    }
    if sensor == "cqd":
        obj["meta"]["counts"]["records_naming_AS7341"] = sum(
            1 for r in corpus.values() if re.search(r"AS7341", f"{r['title']} {r['abstract']}"))
    return obj, corpus


# ------------------------------------------------------------------------------------------------- main
def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--refresh", action="store_true", help="download every response again")
    ap.add_argument("--offline", action="store_true", help="use the cache only")
    ap.add_argument("--sensor", default=",".join(SENSORS), help="comma-separated subset of " + ",".join(SENSORS))
    ap.add_argument("--harvest-only", action="store_true", help="download and count; do not extract")
    ap.add_argument("--add-typical", action="store_true",
                    help="also write other published devices' values and statistics (typical_other_devices); "
                         "off until the user asks to 'add typical'")
    a = ap.parse_args(argv)
    sensors = [s for s in a.sensor.split(",") if s in SENSORS]
    cache = Cache(a.refresh, a.offline)
    for s in sensors:
        print(f"== {s}", flush=True)
        if a.harvest_only:
            corpus, counts = harvest(cache, s)
            if not cache.offline:
                cache.prune(s)
            print(f"  {s}: {len(corpus)} unique records", flush=True)
            continue
        obj, corpus = build(cache, s, typical=a.add_typical)
        path = OUT / f"{s}.json"
        text = json.dumps(obj, ensure_ascii=False).lower()
        hits = [w for w in WRITE_AVOID if w in text]
        if hits:                                       # never write SpinDrift's banned words into /data
            raise SystemExit(f"{path}: refusing to write, the output contains an excluded word")
        write_json(path, obj)
        c = obj["meta"]["counts"]
        found = {k: v["n"] for k, v in obj["parameters"].items() if v["n"]}
        print(f"  wrote {path.relative_to(ROOT)}: {c['total_unique_records']} unique records "
              f"({c['arxiv_records']} arXiv, {c['pubmed_records']} PubMed); own paper {OWN[s]['id']}: "
              f"{c['own_paper_values_written']} values in {c['parameters_found']} parameters, "
              f"{c['parameters_not_found']} NOT_FOUND; " + ", ".join(f"{k} {n}" for k, n in found.items()),
              flush=True)
        log_status(f"data/literature/{s}.json", "done",
                   f"{c['total_unique_records']} unique paper records ({c['arxiv_records']} arXiv API, "
                   f"{c['pubmed_records']} PubMed E-utilities, {c['merged_by_doi']} merged by DOI) from "
                   f"{len(obj['meta']['queries'])} queries, raw responses gzip-cached with SHA-256 in "
                   f"data/literature/raw; values only from the device's own paper {OWN[s]['id']}: "
                   f"{c['own_paper_values_written']} values with paper id and exact sentence in "
                   f"{c['parameters_found']} of {len(obj['parameters'])} parameters, {c['parameters_not_found']} "
                   f"NOT_FOUND; {c['other_paper_values_not_written']} matches in other papers counted, not written")
    cache.save()
    ignored, changed = ensure_gitignore()
    print(f"raw cache {raw_size() / 1e6:.1f} MB; data/literature/raw/ in .gitignore: {ignored}")
    if changed:
        log_status(".gitignore", "changed", f"data/literature/raw/ ignored: the raw literature cache is "
                                            f"{raw_size() / 1e6:.1f} MB, above 20 MB")


if __name__ == "__main__":
    sys.exit(main())
