"""Build data/anatomy/ (real 3D anatomy) and data/bio/asctb.json (cells and genes) from the Human Reference Atlas.

Source: Human Reference Atlas (HRA) of the HuBMAP Common Coordinate Framework, release discovered from the HRA API.
- 3D Reference Object Library, Visible Human Male set (CC BY 4.0): whole-body skin, heart, lungs, left and right
  kidney, brain (Allen human brain reference atlas, mirrored and resized by HRA to fit the Visible Human Male) and
  the blood vasculature (under 25 MB, so it is downloaded and listed as an optional load).
- ASCT+B tables (anatomical structures, cell types, biomarkers; CC BY 4.0), latest released version per organ.

Placement: the official HRA API scene for the male reference body (GET /v1/scene?sex=Male) gives one
transformMatrix per reference organ. For every male organ used here it is the identity: the GLB coordinates already
are the VHMale body frame (metres, y up, +x = body's left, +z = anterior). Cross-checks recorded in the manifest:
each organ's CCF "global placement" relative to #VHMale (graph.jsonld) equals its GLB bounding-box minimum, and the
HRA "united" male assembly (GLB JSON chunk read by HTTP range request). The only change for the app frame is a
translation in y that puts the lowest skin vertex (the soles) at y = 0.

Mount points are computed on the real meshes with numpy (closest point on triangles, Moller-Trumbore ray casting,
barycentric interpolation of the files' own vertex normals). ASCT+B rows are selected by ontology ID and copied
as they appear in the tables. Every download is SHA256-hashed and listed in the manifest.

Usage: python -I scripts/build_anatomy.py [--reuse-local] [--no-status]
  --reuse-local  do not re-download GLB files that already exist in data/anatomy (their SHA256 is recomputed and
                 the manifest says the local copy was reused). Default: download everything fresh.
  --no-status    do not append the result lines to STATUS.md (test runs).
"""
import argparse
import csv
import hashlib
import io
import json
import os
import re
import struct
import sys
import tempfile
import urllib.request
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.common import DATA, ROOT, log_status, meta, now_iso, write_json  # noqa: E402

OUT = DATA / "anatomy"
ASCTB_OUT = DATA / "bio" / "asctb.json"
UA = {"User-Agent": "SpinDrift-build/1.0 (data build script)"}
API = "https://apps.humanatlas.io/api/v1"
REF_ORGANS_URL = f"{API}/reference-organs"
SCENE_URL = f"{API}/scene?sex=Male"
ASCTB_CONFIG_URL = f"{API}/asctb-sheet-config"
PURL_REF = "https://purl.humanatlas.io/ref-organ/"
BODY_IRI = "https://purl.humanatlas.io/graph/hra-ccf-body#VHMale"
UNITED_BASE = "https://cdn.humanatlas.io/digital-objects/ref-organ/united-male/v1.10"
UNITED_GLB = f"{UNITED_BASE}/assets/3d-vh-m-united.glb"
OLS_URL = "https://www.ebi.ac.uk/ols4/api/ontologies/{ont}/terms?iri=http://purl.obolibrary.org/obo/{term}"
CROSSREF_URL = "https://api.crossref.org/works/{doi}"
HRA_PAPERS = {"hra_3d": "10.1038/s41592-024-02563-5", "asctb": "10.1038/s41556-021-00788-6"}
VASCULATURE_LIMIT = 25_000_000
GRID_SPACING = 0.025          # m, requested sensor spacing
GRID_RAY_START = 0.08         # m outside the scalp, where grid rays start
COMPRESSION_EXTS = ("KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_meshopt_compression",
                    "KHR_mesh_quantization")

# key, HRA reference-organ slug, role, load
MODELS = [
    ("skin", "skin-male", "skin", "default"),
    ("heart", "heart-male", "organ", "default"),
    ("lungs", "lung-male", "organ", "default"),
    ("kidney_left", "kidney-male-left", "organ", "default"),
    ("kidney_right", "kidney-male-right", "organ", "default"),
    ("brain", "brain-male", "organ", "default"),
    ("blood_vasculature", "blood-vasculature-male", "organ", "optional"),
]
# ontology terms used by the mount and ASCT+B selection rules; their labels are looked up on EBI OLS
TERMS = ["UBERON:0002703", "UBERON:0002812", "UBERON:0002067", "UBERON:0001384", "UBERON:0000956",
         "UBERON:0002421", "CL:0000746", "CL:0000648", "CL:0000232", "CL:0000764"]

DOWNLOADS = []


# ------------------------------------------------------------------ downloads (official endpoints only)
def _rel(p):
    return Path(p).resolve().relative_to(ROOT).as_posix()


def _record(url, n, sha, status, **extra):
    rec = {"url": url, "bytes": n, "sha256": sha, "http_status": status, "fetched_at": now_iso()}
    rec.update({k: v for k, v in extra.items() if v is not None})
    DOWNLOADS.append(rec)


def get(url, note=None):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
        body = r.read()
        status = r.status
    sha = hashlib.sha256(body).hexdigest()
    _record(url, len(body), sha, status, note=note)
    return body, sha


def get_json(url, note=None):
    body, sha = get(url, note)
    return json.loads(body), sha


def get_range(url, start, end, note):
    """HTTP range request; reads at most end-start+1 bytes and requires a 206 answer."""
    req = urllib.request.Request(url, headers={**UA, "Range": f"bytes={start}-{end}"})
    with urllib.request.urlopen(req, timeout=180) as r:
        if r.status != 206:
            raise IOError(f"{url}: range request answered {r.status}")
        body = r.read(end - start + 1)
    sha = hashlib.sha256(body).hexdigest()
    _record(url, len(body), sha, 206, byte_range=f"{start}-{end}", note=note)
    return body


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url, dest, reuse=False):
    if reuse and dest.exists():
        sha, n = sha256_file(dest), dest.stat().st_size
        _record(url, n, sha, None, saved_as=_rel(dest),
                note="local copy of an earlier download of this URL reused (--reuse-local); SHA256 recomputed")
        return sha, n, {"reused_local_copy": True}
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=dest.parent, prefix=dest.name, suffix=".tmp")
    h, n = hashlib.sha256(), 0
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r, \
                os.fdopen(fd, "wb") as fh:
            status = r.status
            hdr = {"content_length": r.headers.get("Content-Length"), "content_type": r.headers.get("Content-Type"),
                   "last_modified": r.headers.get("Last-Modified"), "etag": r.headers.get("ETag")}
            for chunk in iter(lambda: r.read(1 << 20), b""):
                h.update(chunk)
                fh.write(chunk)
                n += len(chunk)
        if hdr["content_length"] and int(hdr["content_length"]) != n:
            raise IOError(f"{url}: received {n} bytes, Content-Length {hdr['content_length']}")
        os.replace(tmp, dest)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    sha = h.hexdigest()
    _record(url, n, sha, status, saved_as=_rel(dest))
    return sha, n, hdr


def clean(s):
    return re.sub(r"\s+", " ", s).strip() if isinstance(s, str) else s


def landing(base):
    """The digital object's landing page carries schema.org JSON-LD: citation, DOI, licence, creators."""
    url = f"{base}/index.html"
    body, sha = get(url)
    m = re.search(rb'<script type="application/ld\+json">(.*?)</script>', body, re.S)
    if not m:
        raise ValueError(f"no JSON-LD in {url}")
    d = json.loads(m.group(1).decode("utf-8", errors="replace"))
    b = d.get("isBasedOn") or {}
    desc = b.get("description") or ""
    biblio = [clean(x[2:]) for x in desc.split("**Bibliography:**")[-1].splitlines()
              if x.strip().startswith("* ")] if "**Bibliography:**" in desc else []
    dois = [i for i in b.get("identifier", []) if str(i).startswith("https://doi.org/")]
    return {"landing_page": url, "landing_page_sha256": sha, "name": b.get("name"),
            "citation": clean(b.get("citation")), "doi": dois[0] if dois else None, "licence_url": b.get("license"),
            "creators": [c.get("name") for c in b.get("creator", []) if c.get("name")],
            "description": clean(desc.split("**Bibliography:**")[0]), "bibliography": biblio,
            "distribution": [x.get("contentUrl") for x in b.get("distribution", [])],
            "lod": d.get("@id"), "graph_date_created": d.get("dateCreated")}


def crosswalk(url):
    body, _ = get(url)
    rows = csv.DictReader(io.StringIO(body.decode("utf-8-sig")))
    return {r["node_name"].strip(): {"id": r["OntologyID"].strip(), "label": r["label"].strip()}
            for r in rows if (r.get("node_name") or "").strip()}


def placements(graph_url, primary_iri):
    g, _ = get_json(graph_url)
    out = {}
    for n in g.get("@graph", []):
        for kind in ("global", "obj"):
            if n.get("@id") == f"{primary_iri}_{kind}_placement":
                out[kind] = {
                    "relative_to": n["ccf:placement_relative_to"]["@id"],
                    "translation": [float(n[f"ccf:{a}_translation"]) for a in "xyz"],
                    "translation_unit": n.get("ccf:translation_unit"),
                    "rotation_deg": [float(n[f"ccf:{a}_rotation"]) for a in "xyz"],
                    "scaling": [float(n[f"ccf:{a}_scaling"]) for a in "xyz"]}
    return out


def ols_label(curie):
    ont, num = curie.split(":")
    d, _ = get_json(OLS_URL.format(ont=ont.lower(), term=f"{ont}_{num}"))
    t = d["_embedded"]["terms"][0]
    return {"id": t["obo_id"], "label": t["label"], "source": "EBI OLS4, " + OLS_URL.format(
        ont=ont.lower(), term=f"{ont}_{num}")}


def crossref(doi):
    d, _ = get_json(CROSSREF_URL.format(doi=doi))
    m = d["message"]
    authors = m.get("author", [])
    first = authors[0].get("family") if authors else None
    year = (m.get("issued", {}).get("date-parts") or [[None]])[0][0]
    return {"doi": f"https://doi.org/{doi}", "title": (m.get("title") or [None])[0],
            "journal": (m.get("container-title") or [None])[0], "volume": m.get("volume"), "pages": m.get("page"),
            "year": year, "first_author": first, "n_authors": len(authors),
            "text": f"{first} et al. ({year}). {(m.get('title') or [''])[0]}. {(m.get('container-title') or [''])[0]} "
                    f"{m.get('volume')}, {m.get('page')}. https://doi.org/{doi}",
            "source": "Crossref, " + CROSSREF_URL.format(doi=doi)}


# ------------------------------------------------------------------ GLB reader (uncompressed glTF 2.0 binary)
CTYPES = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_glb(path):
    b = Path(path).read_bytes()
    magic, version, length = struct.unpack_from("<4sII", b, 0)
    if magic != b"glTF" or version != 2:
        raise ValueError(f"{path}: not a glTF 2.0 binary")
    off, js, binc = 12, None, None
    while off < length:
        clen, ctype = struct.unpack_from("<I4s", b, off)
        if ctype == b"JSON":
            js = json.loads(b[off + 8:off + 8 + clen])
        elif ctype == b"BIN\x00":
            binc = b[off + 8:off + 8 + clen]
        off += 8 + clen
    return js, binc


def accessor(g, binc, i):
    a = g["accessors"][i]
    if "sparse" in a or "bufferView" not in a:
        raise ValueError("sparse or bufferless accessor not supported")
    bv = g["bufferViews"][a["bufferView"]]
    dt = np.dtype(CTYPES[a["componentType"]])
    nc = NCOMP[a["type"]]
    stride = bv.get("byteStride") or dt.itemsize * nc
    arr = np.ndarray((a["count"], nc), dt, buffer=binc, offset=bv.get("byteOffset", 0) + a.get("byteOffset", 0),
                     strides=(stride, dt.itemsize))
    return arr.astype(np.float64 if dt.kind == "f" else np.int64)


def local_matrix(n):
    if "matrix" in n:
        return np.array(n["matrix"], float).reshape(4, 4).T          # glTF stores column-major
    x, y, z, w = n.get("rotation", [0, 0, 0, 1])
    r = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    m = np.eye(4)
    m[:3, :3] = r @ np.diag(n.get("scale", [1, 1, 1]))
    m[:3, 3] = n.get("translation", [0, 0, 0])
    return m


class Model:
    """All triangles of one GLB, in the app frame: V (vertices), N (file normals), F (faces), owner (node per face)."""

    def __init__(self, path, to_app):
        g, binc = read_glb(path)
        exts = sorted(set(g.get("extensionsUsed", []) + g.get("extensionsRequired", [])))
        comp = [e for e in exts if e in COMPRESSION_EXTS]
        if comp:
            raise SystemExit(f"{path.name} uses {comp}; this numpy reader does not decode compressed meshes")
        nodes = g.get("nodes", [])
        self.zero_normals = 0
        self.node_names, self.node_paths, self.node_has_transform = [], [], []
        Vs, Ns, Fs, owner = [], [], [], []
        attrs, index_types, offset = set(), set(), 0

        def walk(i, parent, path):
            nonlocal offset
            n = nodes[i]
            world = parent @ local_matrix(n)
            name = n.get("name") or f"node{i}"
            here = path + [name]
            if "mesh" in n:
                k = len(self.node_names)
                self.node_names.append(name)
                self.node_paths.append(here)
                self.node_has_transform.append(any(t in n for t in ("matrix", "translation", "rotation", "scale")))
                full = to_app @ world
                lin, nlin = full[:3, :3], np.linalg.inv(full[:3, :3]).T
                for pr in g["meshes"][n["mesh"]]["primitives"]:
                    if pr.get("mode", 4) != 4:
                        raise ValueError(f"{path}: primitive mode {pr.get('mode')} is not TRIANGLES")
                    attrs.update(pr["attributes"].keys())
                    pos = accessor(g, binc, pr["attributes"]["POSITION"])
                    nrm = (accessor(g, binc, pr["attributes"]["NORMAL"]) if "NORMAL" in pr["attributes"]
                           else np.full_like(pos, np.nan))
                    if "indices" in pr:
                        index_types.add(g["accessors"][pr["indices"]]["componentType"])
                        idx = accessor(g, binc, pr["indices"]).reshape(-1, 3)
                    else:
                        idx = np.arange(len(pos)).reshape(-1, 3)
                    v = pos @ lin.T + full[:3, 3]
                    nn = nrm @ nlin.T
                    ln = np.linalg.norm(nn, axis=1, keepdims=True)
                    # some files hold zero-length normals; those vertices fall back to the face normal later
                    nn = np.divide(nn, ln, out=np.full_like(nn, np.nan), where=ln > 1e-12)
                    self.zero_normals += int((ln[:, 0] <= 1e-12).sum())
                    Vs.append(v)
                    Ns.append(nn)
                    Fs.append(idx + offset)
                    owner.append(np.full(len(idx), k, np.int32))
                    offset += len(v)
            for c in n.get("children", []):
                walk(c, world, here)

        for root in g["scenes"][g.get("scene", 0)]["nodes"]:
            walk(root, np.eye(4), [])
        self.V, self.N = np.vstack(Vs), np.vstack(Ns)
        self.F, self.owner = np.vstack(Fs), np.concatenate(owner)
        self.root = nodes[g["scenes"][g.get("scene", 0)]["nodes"][0]].get("name")
        mats = g.get("materials", [])
        self.info = {
            "generator": g.get("asset", {}).get("generator"),
            "extensions_used": exts,
            "compression": "none" if not comp else comp,
            "vertex_attributes": sorted(attrs),
            "index_component_types": sorted({{5121: "uint8", 5123: "uint16", 5125: "uint32"}[t]
                                             for t in index_types}),
            "nodes": len(nodes), "meshes": len(g.get("meshes", [])), "mesh_nodes": len(self.node_names),
            "triangles": int(len(self.F)), "vertices": int(len(self.V)),
            "textures": len(g.get("textures", [])), "images": len(g.get("images", [])),
            "materials": [{"name": m.get("name"),
                           "base_color_factor": m.get("pbrMetallicRoughness", {}).get("baseColorFactor"),
                           "metallic_factor": m.get("pbrMetallicRoughness", {}).get("metallicFactor"),
                           "roughness_factor": m.get("pbrMetallicRoughness", {}).get("roughnessFactor"),
                           "alpha_mode": m.get("alphaMode", "OPAQUE")} for m in mats],
            "nodes_with_own_transform": int(sum(self.node_has_transform)),
            "zero_length_normals": self.zero_normals,
        }

    def faces_of(self, names):
        ids = [i for i, n in enumerate(self.node_names) if n in set(names)]
        return self.F[np.isin(self.owner, ids)]

    def faces_under(self, group_name):
        ids = [i for i, p in enumerate(self.node_paths) if group_name in p]
        return self.F[np.isin(self.owner, ids)]


# ------------------------------------------------------------------ geometry
def surface_centroid(V, F):
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    return (area[:, None] * (a + b + c) / 3).sum(0) / area.sum(), float(area.sum())


def bbox(V, F=None):
    P = V if F is None else V[np.unique(F)]
    return P.min(0), P.max(0)


def long_axis(V, F):
    """Principal axis of the area-weighted triangle centroids (the gyrus' long direction)."""
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    w = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    cen = (a + b + c) / 3
    mu = (w[:, None] * cen).sum(0) / w.sum()
    cov = ((cen - mu).T * w) @ (cen - mu) / w.sum()
    vals, vecs = np.linalg.eigh(cov)
    return vecs[:, -1], vals[::-1]


def unit(v):
    return v / np.linalg.norm(v)


class Tris:
    """A triangle set for ray casting and closest-point queries, carrying the file's vertex normals."""

    def __init__(self, V, N, F, owner=None):
        self.V, self.N, self.F, self.owner = V, N, F, owner
        self.a = V[F[:, 0]]
        self.e1 = V[F[:, 1]] - self.a
        self.e2 = V[F[:, 2]] - self.a

    def cast(self, o, d):
        """Moller-Trumbore, vectorised. Returns hit face indices sorted by distance, with t, u, v."""
        p = np.cross(d, self.e2)
        det = np.einsum("ij,ij->i", self.e1, p)
        ok = np.abs(det) > 1e-20
        inv = np.zeros_like(det)
        inv[ok] = 1.0 / det[ok]
        s = o - self.a
        u = np.einsum("ij,ij->i", s, p) * inv
        q = np.cross(s, self.e1)
        v = (q @ d) * inv
        t = np.einsum("ij,ij->i", q, self.e2) * inv
        k = np.nonzero(ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 1e-9))[0]
        order = np.argsort(t[k])
        return k[order], t[k][order], u[k][order], v[k][order]

    def normal(self, k, u, v):
        f = self.F[k]
        n = (1 - u - v) * self.N[f[0]] + u * self.N[f[1]] + v * self.N[f[2]]
        if not np.all(np.isfinite(n)):
            n = np.cross(self.e1[k], self.e2[k])
        return unit(n)

    def face_normal(self, k):
        return unit(np.cross(self.e1[k], self.e2[k]))

    def closest(self, p):
        """Closest point on the triangle set to p (Ericson, Real-Time Collision Detection 5.1.5, vectorised)."""
        a, ab, ac = self.a, self.e1, self.e2
        b, c = a + ab, a + ac
        ap, bp, cp = p - a, p - b, p - c
        d1, d2 = np.einsum("ij,ij->i", ab, ap), np.einsum("ij,ij->i", ac, ap)
        d3, d4 = np.einsum("ij,ij->i", ab, bp), np.einsum("ij,ij->i", ac, bp)
        d5, d6 = np.einsum("ij,ij->i", ab, cp), np.einsum("ij,ij->i", ac, cp)
        va, vb, vc = d3 * d6 - d5 * d4, d5 * d2 - d1 * d6, d1 * d4 - d3 * d2
        out, done = np.empty_like(a), np.zeros(len(a), bool)
        with np.errstate(divide="ignore", invalid="ignore"):
            cases = [((d1 <= 0) & (d2 <= 0), lambda: a),
                     ((d3 >= 0) & (d4 <= d3), lambda: b),
                     ((vc <= 0) & (d1 >= 0) & (d3 <= 0), lambda: a + (d1 / (d1 - d3))[:, None] * ab),
                     ((d6 >= 0) & (d5 <= d6), lambda: c),
                     ((vb <= 0) & (d2 >= 0) & (d6 <= 0), lambda: a + (d2 / (d2 - d6))[:, None] * ac),
                     ((va <= 0) & (d4 - d3 >= 0) & (d5 - d6 >= 0),
                      lambda: b + ((d4 - d3) / ((d4 - d3) + (d5 - d6)))[:, None] * (c - b)),
                     (np.ones(len(a), bool),
                      lambda: a + ab * (vb / (va + vb + vc))[:, None] + ac * (vc / (va + vb + vc))[:, None])]
            for mask, value in cases:
                m = mask & ~done
                if m.any():
                    out[m] = value()[m]
                    done |= m
        dist = np.linalg.norm(out - p, axis=1)
        k = int(np.argmin(dist))
        q = out[k]
        # barycentric coordinates of q in face k, to interpolate the file normals
        e1, e2, w = self.e1[k], self.e2[k], q - self.a[k]
        d00, d01, d11, d20, d21 = e1 @ e1, e1 @ e2, e2 @ e2, w @ e1, w @ e2
        den = d00 * d11 - d01 * d01
        u, v = (d11 * d20 - d01 * d21) / den, (d00 * d21 - d01 * d20) / den
        return k, q, float(dist[k]), u, v


def inside(tris, p):
    """Parity of ray crossings along six slightly skewed directions; inside when at least four rays agree."""
    dirs = [unit(np.array(d)) for d in ([1, 1e-3, 2e-3], [-1, 2e-3, 1e-3], [1e-3, 1, 2e-3], [2e-3, -1, 1e-3],
                                        [1e-3, 2e-3, 1], [2e-3, 1e-3, -1])]
    counts = [len(tris.cast(p, d)[0]) for d in dirs]
    return sum(c % 2 for c in counts) >= 4, counts


def side_label_check(model):
    """Compare mesh-node side labels with the side of the node's centroid (+x = body's left); |x| < 5 mm is not
    judged. Two kinds: the HRA paired-structure suffix _L/_R (a body side), and the words left/right inside a
    name, which can also mean an organ's own side (left hepatic artery, right ventricle), so those are a review
    list only."""
    out = {"suffix_L_R": {"checked": 0, "mismatched": []}, "left_right_words": {"checked": 0, "mismatched": []}}
    for i, name in enumerate(model.node_names):
        low = name.lower()
        m = re.search(r"_([lr])$", low)
        words = set(re.split(r"[_\W]+", low)) & {"left", "right"}
        kind, side = (("suffix_L_R", m.group(1).upper()) if m else
                      ("left_right_words", "L" if words == {"left"} else "R") if len(words) == 1 else (None, None))
        if kind is None:
            continue
        x = surface_centroid(model.V, model.F[model.owner == i])[0][0]
        if abs(x) < 0.005:
            continue
        out[kind]["checked"] += 1
        if (side == "L") != (x > 0):
            out[kind]["mismatched"].append(name)
    for v in out.values():
        v["mismatched_count"] = len(v["mismatched"])
        v["mismatched"] = v["mismatched"][:40]
    out["rule"] = ("L/left expects the node centroid at x > 0 (body's left), R/right at x < 0; |x| < 5 mm not "
                   "judged. A suffix mismatch is a file label that disagrees with the body frame. A word mismatch "
                   "only asks for review: the word may name the organ's own side. Reported, never renamed.")
    return out


def r6(v):
    return [round(float(x), 6) for x in v]


def r5(v):
    return [round(float(x), 5) for x in v]


# ------------------------------------------------------------------ mounts
UPPER_LIMB = re.compile(r"humer|radius|ulna|forearm|upper_limb|upper limb|carp|_hand|hand_|brachial_|radial_|"
                        r"(?<!brachio)cephalic_vein|basilic|antebrach|cubital|elbow|wrist", re.I)


def compute_mounts(models, cw, terms, evidence):
    skin, brain, heart = models["skin"], models["brain"], models["heart"]
    out = {"frame": "app (metres, y up, feet at y = 0, +z anterior, body's right = -x)", "tag": "calculated"}

    # laterality of the HRA body frame, from paired and unpaired organs whose geometry is not mirrored
    def cen(model, names=None, group=None):
        F = model.faces_of(names) if names else model.faces_under(group) if group else model.F
        return surface_centroid(model.V, F)[0]

    lat = {
        "kidney_left_centroid_x": round(float(cen(models["kidney_left"])[0]), 5),
        "kidney_right_centroid_x": round(float(cen(models["kidney_right"])[0]), 5),
        "lung_L_centroid_x": round(float(cen(models["lungs"], group="VH_M_lungs_L")[0]), 5),
        "lung_R_centroid_x": round(float(cen(models["lungs"], group="VH_M_lungs_R")[0]), 5),
        "lung_R_has_middle_lobe_hilum": "VH_M_hilum_middle_R" in models["lungs"].node_names,
        "heart_left_ventricle_centroid_x": round(float(cen(heart, ["VH_M_heart_left_ventricle"])[0]), 5),
        "heart_right_atrium_centroid_x": round(float(cen(heart, ["VH_M_right_cardiac_atrium"])[0]), 5),
        "brain_Hemisphere_L_centroid_x": round(float(cen(brain, group="Allen_brain_Hemisphere_L")[0]), 5),
        "brain_Hemisphere_R_centroid_x": round(float(cen(brain, group="Allen_brain_Hemisphere_R")[0]), 5),
        "brain_Hemisphere_L_crosswalk": cw["brain"].get("Allen_brain_Hemisphere_L"),
    }
    body_right_is_minus_x = (lat["kidney_right_centroid_x"] < 0 < lat["kidney_left_centroid_x"]
                             and lat["lung_R_centroid_x"] < 0 < lat["lung_L_centroid_x"]
                             and lat["heart_left_ventricle_centroid_x"] > lat["heart_right_atrium_centroid_x"])
    brain_labels_mirrored = lat["brain_Hemisphere_L_centroid_x"] < 0 < lat["brain_Hemisphere_R_centroid_x"]
    lat["body_right_is_minus_x"] = bool(body_right_is_minus_x)
    lat["brain_file_L_R_opposite_to_body_frame"] = bool(body_right_is_minus_x and brain_labels_mirrored)
    out["laterality_evidence"] = lat

    # (a) scalp grid over the precentral gyrus on the body's right side
    pg_nodes = sorted(n for n, v in cw["brain"].items() if v["id"] == "UBERON:0002703" and n in brain.node_names)
    pg = {n: cen(brain, [n]) for n in pg_nodes}
    target = min(pg, key=lambda n: pg[n][0])                    # the one at -x = body's right
    other = max(pg, key=lambda n: pg[n][0])
    Fg = brain.faces_of([target])
    G, gyr_area = surface_centroid(brain.V, Fg)
    gmin, gmax = bbox(brain.V, Fg)
    axis, eig = long_axis(brain.V, Fg)
    bmin, _ = bbox(brain.V)
    head = skin.F[(skin.V[skin.F][:, :, 1] > bmin[1] - 0.02).all(1)]
    head_tris = Tris(skin.V, skin.N, head)
    brain_tris = Tris(brain.V, brain.N, brain.F, brain.owner)
    gyr_tris = Tris(brain.V, brain.N, Fg)

    def scalp_center(point):
        k, C, dist, u, v = head_tris.closest(point)
        n = head_tris.normal(k, u, v)
        flipped = bool(n @ (C - point) < 0)
        return C, (-n if flipped else n), dist, flipped

    def under(P, n):
        k, t, _, _ = brain_tris.cast(P, -n)
        if not len(k):
            return None
        node = brain.node_names[brain_tris.owner[k[0]]]
        c = cw["brain"].get(node, {})
        return {"node": node, "uberon": c.get("id"), "label": c.get("label"), "depth_m": round(float(t[0]), 5)}

    C, n0, cdist, flipped = scalp_center(G)
    t1 = unit(axis - (axis @ n0) * n0)
    if t1[1] < 0:
        t1 = -t1                                                  # along the gyrus, pointing superior
    t2 = unit(np.cross(n0, t1))
    if t2[2] < 0:
        t2 = -t2                                                  # across the gyrus, pointing anterior
    gk, gt, _, _ = gyr_tris.cast(C, -n0)
    points, grid = [], {}
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            Q = C + GRID_SPACING * (i * t1 + j * t2)
            o = Q + GRID_RAY_START * n0
            k, t, u, v = head_tris.cast(o, -n0)
            if not len(k):
                raise SystemExit(f"grid ray ({i},{j}) missed the scalp")
            P = o - t[0] * n0
            n = head_tris.normal(k[0], u[0], v[0])
            nflip = bool(n @ n0 < 0)
            n = -n if nflip else n
            grid[(i, j)] = P
            points.append({"id": f"opm_{i + 2}{j + 2}", "row_along_gyrus": i, "col_across_gyrus": j,
                           "position": r6(P), "normal": r6(n), "file_normal_flipped": nflip,
                           "facing_ray_origin": bool(head_tris.face_normal(k[0]) @ n0 > 0),
                           "underlying_brain_structure": under(P, n)})
    pairs = [((i, j), (i + di, j + dj)) for i in (-1, 0, 1) for j in (-1, 0, 1) for di, dj in ((1, 0), (0, 1))
             if (i + di, j + dj) in grid]
    sp = [float(np.linalg.norm(grid[a] - grid[b])) for a, b in pairs]
    alt_C, alt_n, alt_d, _ = scalp_center(cen(brain, [other]))
    out["scalp_right_precentral_gyrus"] = {
        "method": ("Precentral gyrus mesh chosen by the HRA crosswalk ID UBERON:0002703 ('" +
                   terms["UBERON:0002703"]["label"] + "' on EBI OLS); of its two meshes, the one at -x (body's "
                   "right). Gyrus centroid G = area-weighted mean of its triangle centroids. Grid centre C = closest "
                   "point of the skin mesh (head region) to G; normal = the skin file's vertex normals interpolated "
                   "at C (barycentric), oriented away from G. Grid axes: t1 = the gyrus' principal axis (area-weighted "
                   "PCA of its triangles) projected on the tangent plane at C, pointing superior; t2 = n x t1, "
                   "pointing anterior. Each of the 9 points: the target C + 0.025 m (i t1 + j t2) is projected onto "
                   "the scalp by a ray along -n from 0.08 m outside (Moller-Trumbore on the skin triangles); the "
                   "normal there is interpolated the same way. Underlying structure: first brain mesh hit by a ray "
                   "from each point along -normal."),
        "target_mesh": {"file_node": target, "uberon": cw["brain"][target]["id"],
                        "crosswalk_label": cw["brain"][target]["label"],
                        "ols_label": terms["UBERON:0002703"]["label"], "side_in_body_frame": "right (-x)",
                        "parent_hemisphere_node": "Allen_brain_Hemisphere_L" if target.endswith("_L") else
                        "Allen_brain_Hemisphere_R",
                        "label_conflict": (
                            f"The HRA brain file labels this mesh '{target}' and its hemisphere "
                            f"'{cw['brain'].get('Allen_brain_Hemisphere_L', {}).get('label')}', yet it lies at -x, "
                            "which is the body's right in the HRA VHMale frame (right kidney, right lung with its "
                            "middle lobe, and the heart's right atrium are at -x; the left ventricle is at +x). HRA "
                            "built this brain by mirroring one Allen hemisphere, so the two sides are mirror copies "
                            "and the geometry cannot settle laterality. The body frame is used; the file label is "
                            "reported, not changed.") if lat["brain_file_L_R_opposite_to_body_frame"] else None,
                        "centroid": r6(G), "bbox": {"min": r6(gmin), "max": r6(gmax)},
                        "surface_area_m2": round(gyr_area, 7), "long_axis": r6(axis),
                        "long_axis_extent_sd_m": round(float(np.sqrt(eig[0])), 5)},
        "center": {"position": r6(C), "normal": r6(n0), "distance_to_gyrus_centroid_m": round(cdist, 5),
                   "file_normal_flipped": flipped,
                   "scalp_to_precentral_surface_along_normal_m": round(float(gt[0]), 5) if len(gt) else None,
                   "underlying_brain_structure": under(C, n0)},
        "axes": {"t1_along_gyrus_superior": r6(t1), "t2_across_gyrus_anterior": r6(t2), "normal": r6(n0)},
        "grid": {"rows": 3, "cols": 3, "target_spacing_m": GRID_SPACING,
                 "neighbour_spacing_m": {"min": round(min(sp), 5), "max": round(max(sp), 5),
                                         "mean": round(float(np.mean(sp)), 5), "pairs": len(sp)}},
        "points": points,
        "file_label_R_alternative": {
            "note": f"The same construction for '{other}' (HRA file label R), which lies at +x = body's left.",
            "file_node": other, "center": r6(alt_C), "normal": r6(alt_n), "distance_to_gyrus_centroid_m":
                round(alt_d, 5)},
    }

    # (b) anterior chest skin point over the heart centroid
    H, _ = surface_centroid(heart.V, heart.F)
    hmin, hmax = bbox(heart.V)
    torso = skin.F[((skin.V[skin.F][:, :, 1] > hmin[1] - 0.15) & (skin.V[skin.F][:, :, 1] < hmax[1] + 0.15)).all(1)]
    torso_tris = Tris(skin.V, skin.N, torso)
    zdir = np.array([0.0, 0.0, 1.0])
    k, t, u, v = torso_tris.cast(H, zdir)
    if not len(k):
        raise SystemExit("anterior ray from the heart centroid missed the skin")
    P = H + t[0] * zdir
    n = torso_tris.normal(k[0], u[0], v[0])
    cflip = bool(n @ zdir < 0)
    n = -n if cflip else n
    out["chest_over_heart"] = {
        "method": ("Heart centroid H = area-weighted mean of the triangle centroids of all heart meshes (HRA heart "
                   "v1.3). Ray from H along +z (anterior in the HRA body frame); the first skin intersection "
                   "(Moller-Trumbore) is the mount point. Normal = the skin file's vertex normals interpolated at the "
                   "hit, oriented outward (+z side)."),
        "heart_centroid": r6(H), "position": r6(P), "normal": r6(n), "heart_centroid_to_skin_m": round(float(t[0]), 5),
        "file_normal_flipped": cflip, "angle_normal_to_ray_deg": round(float(np.degrees(np.arccos(min(1, n @ zdir)))), 2),
        "skin_hits_along_ray": int(len(k))}

    # (c) right volar forearm: needs real landmarks (bones, vessels); search every HRA source used here for them
    vasc = models.get("blood_vasculature")
    arm_ref = [x["label"] for x in evidence["ref_organs"] if UPPER_LIMB.search(x.get("label", ""))
               or UPPER_LIMB.search(x["object"].get("file_subpath", ""))]
    arm_vasc = [n for n in (vasc.node_names if vasc else []) if UPPER_LIMB.search(n)]
    arm_united = evidence["united"].get("upper_limb_nodes")
    found = bool(arm_ref or arm_vasc or arm_united)
    out["forearm_right_volar"] = {
        "available": False, "position": None, "normal": None,
        "searched_for": UPPER_LIMB.pattern,
        "evidence": {
            "hra_reference_organs_matching": arm_ref,
            "blood_vasculature_nodes_matching": arm_vasc,
            "blood_vasculature_x_extent_m": r5([vasc.V[:, 0].min(), vasc.V[:, 0].max()]) if vasc else None,
            "skin_x_extent_m": r5([skin.V[:, 0].min(), skin.V[:, 0].max()]),
            "united_male_nodes_matching": arm_united,
            "united_male_skeletal_system_children": evidence["united"].get("skeletal_system_children")},
        "reason": ("No upper-limb bone, vessel or landmark exists in the HRA male set (none of the reference organs, "
                   "blood vasculature nodes or united male assembly nodes match; the vasculature stays within the "
                   "trunk and head). The skin alone has no landmarks, so no point is given."
                   if not found else "Upper-limb structures were found; a landmark method still has to be written "
                   "before a point is given.")}
    return out


# ------------------------------------------------------------------ ASCT+B
def asctb_load(text):
    rows = list(csv.reader(io.StringIO(text)))
    hi = next(i for i, r in enumerate(rows) if r and r[0].strip() == "AS/1")
    info = {}
    for r in rows[:hi]:
        if r and r[0].strip():
            key = r[0].strip().rstrip(":")
            info[key] = r[1].strip() if len(r) > 1 else ""
    title = rows[0][0].strip() if rows and rows[0] else None
    header = [h.strip() for h in rows[hi]]
    data = [(hi + 2 + k, r) for k, r in enumerate(rows[hi + 1:]) if any(c.strip() for c in r)]
    return title, info, header, data


def asctb_groups(header, row, prefix, keys=("LABEL", "ID")):
    out = []
    for i, h in enumerate(header):
        m = re.fullmatch(prefix + r"/(\d+)", h)
        if not m:
            continue
        num, vals = m.group(1), {}
        for j in range(i + 1, min(i + 6, len(header))):
            for key in keys:
                if header[j] == f"{prefix}/{num}/{key}" and j < len(row) and key not in vals:
                    vals[key] = row[j].strip()
        name = row[i].strip() if i < len(row) else ""
        if name or any(vals.values()):
            out.append({"name": name, **{k.lower(): vals.get(k, "") for k in keys}})
    return out


def asctb_row(header, line, row):
    refs = []
    for g in asctb_groups(header, row, "REF", keys=("ID", "DOI")):
        for val in (g["name"], g["id"], g["doi"]):
            # split lists of identifiers, but keep free-text citations whole
            for part in re.split(r";\s*|,\s*(?=(?:PMID|PMCID|DOI|doi|https?://))|\s+(?=https?://)", val or ""):
                part = part.strip()
                if part and part not in refs:
                    refs.append(part)
    genes = asctb_groups(header, row, "BGene")
    prots = asctb_groups(header, row, "BProtein")
    return {"csv_line": line,
            "anatomical_structures": asctb_groups(header, row, "AS"),
            "cell_types": asctb_groups(header, row, "CT"),
            "genes": [{"symbol": g["name"], "name": g["label"], "id": g["id"]} for g in genes],
            "proteins": [{"name": g["name"], "label": g["label"], "id": g["id"]} for g in prots],
            "references": refs}


def asctb_summary(rows):
    cts, genes, prots, quirks = {}, {}, {}, []
    for r in rows:
        for c in r["cell_types"]:
            key = (c["label"] or c["name"], c["id"])
            cts[key] = cts.get(key, 0) + 1
        for g in r["genes"]:
            genes.setdefault(g["symbol"], {"ids": [], "rows": 0})
            genes[g["symbol"]]["rows"] += 1
            if g["id"] not in genes[g["symbol"]]["ids"]:
                genes[g["symbol"]]["ids"].append(g["id"])
        for p in r["proteins"]:
            prots.setdefault(p["name"], {"ids": [], "rows": 0})
            prots[p["name"]]["rows"] += 1
            if p["id"] not in prots[p["name"]]["ids"]:
                prots[p["name"]]["ids"].append(p["id"])
    for kind, table in (("gene", genes), ("protein", prots)):
        odd = []
        for sym, v in table.items():
            if len(v["ids"]) > 1:
                quirks.append(f"{kind} {sym!r} carries more than one ID in the selected rows: {v['ids']}")
            odd += [f"{sym} ({i!r})" for i in v["ids"] if not re.fullmatch(r"HGNC:\d+", i or "")]
        if odd:
            quirks.append(f"{len(odd)} {kind} entries have an empty or non-HGNC ID (copied as given): "
                          + ", ".join(sorted(odd)))
    looks_like_id = sorted({f"{x['name']!r}/{x['label']!r}" for r in rows for x in r["anatomical_structures"]
                            + r["cell_types"] if re.fullmatch(r"[A-Z]+:\d+", x["name"] or "")
                            or re.fullmatch(r"[A-Z]+:\d+", x["label"] or "")})
    if looks_like_id:
        quirks.append("structure or cell-type name/label cells holding an ontology ID instead of a name "
                      f"(copied as given): {looks_like_id}")
    by_id = {}
    for sym, v in genes.items():
        for i in v["ids"]:
            if re.fullmatch(r"HGNC:\d+", i or ""):
                by_id.setdefault(i, set()).add(sym)
    for i, syms in by_id.items():
        if len(syms) > 1:
            quirks.append(f"HGNC ID {i} is given for more than one symbol in the selected rows: {sorted(syms)}")
    leaves = {}
    for r in rows:
        if r["anatomical_structures"]:
            a = r["anatomical_structures"][-1]
            key = (a["label"] or a["name"], a["id"])
            leaves[key] = leaves.get(key, 0) + 1
    return ({"anatomical_structures": [{"label": k[0], "id": k[1], "rows": n} for k, n in sorted(leaves.items())],
             "cell_types": [{"label": k[0], "id": k[1], "rows": n} for k, n in sorted(cts.items())],
             "genes": [{"symbol": s, "ids": v["ids"], "rows": v["rows"]} for s, v in sorted(genes.items())],
             "proteins": [{"name": s, "ids": v["ids"], "rows": v["rows"]} for s, v in sorted(prots.items())]},
            quirks)


def has_ct(r, ids):
    return any(c["id"] in ids for c in r["cell_types"])


def as_ids(r):
    return {a["id"] for a in r["anatomical_structures"]}


GLUT = re.compile(r"glutamatergic|excitatory|pyramidal", re.I)
ASCTB_SELECT = {
    "heart": ("Heart", "a cell type with ID CL:0000746 (cardiac muscle cell)",
              lambda r: has_ct(r, {"CL:0000746"})),
    "kidney": ("Kidney", "a cell type with ID CL:0000648 (kidney granular cell, the juxtaglomerular renin cell)",
               lambda r: has_ct(r, {"CL:0000648"})),
    "skin": ("Skin", "anatomical path contains UBERON:0002067 (dermis) and the row names a cell type",
             lambda r: "UBERON:0002067" in as_ids(r) and bool(r["cell_types"])),
    "brain": ("Brain", "anatomical path contains UBERON:0000956 (cerebral cortex) but not UBERON:0002421 "
                       "(hippocampal formation), a cell type name or label contains 'glutamatergic', 'excitatory' "
                       "or 'pyramidal', and no cell type label names the amygdala",
              lambda r: "UBERON:0000956" in as_ids(r) and "UBERON:0002421" not in as_ids(r) and any(
                  GLUT.search(f"{c['name']} {c['label']}") for c in r["cell_types"]) and not any(
                  "amygdala" in f"{c['name']} {c['label']}".lower() for c in r["cell_types"])),
    "blood": ("Blood", "a cell type with ID CL:0000232 (erythrocyte)", lambda r: has_ct(r, {"CL:0000232"})),
    "bone_marrow_erythroid": ("Bone_Marrow", "a cell type with ID CL:0000764 (erythroid lineage cell)",
                              lambda r: has_ct(r, {"CL:0000764"})),
}


def version_key(v):
    return tuple(int(x) for x in re.findall(r"\d+", v))


def build_asctb(terms, papers):
    first = len(DOWNLOADS)
    cfg, _ = get_json(ASCTB_CONFIG_URL)
    organs, sources, sha = {}, [], {}
    for key, (sheet, rule, select) in ASCTB_SELECT.items():
        versions = [v for s in cfg if s.get("name") == sheet for v in s.get("version", [])
                    if (v.get("csvUrl") or "").startswith("https://cdn.humanatlas.io/")
                    and "DRAFT" not in (v.get("viewValue") or "")]
        if not versions:
            organs[key] = {"present": False, "rule": rule, "note": f"no released {sheet} table in the HRA config"}
            continue
        v = max(versions, key=lambda x: version_key(x["viewValue"]))
        body, csv_sha = get(v["csvUrl"])
        title, info, header, data = asctb_load(body.decode("utf-8-sig"))
        page = landing(v["csvUrl"].split("/assets/")[0])
        if not (title or "").startswith("Anatomical Structures"):
            title = page["name"]
        rows = [asctb_row(header, line, r) for line, r in data]
        chosen = [r for r in rows if select(r)]
        summary, quirks = asctb_summary(chosen)
        bad_chars = body.decode("utf-8-sig").count("�")
        if bad_chars:
            quirks.append(f"the published CSV itself contains {bad_chars} U+FFFD replacement characters (mostly in "
                          "reference text, where quotes and dashes were lost upstream); copied as published")
        sources.append(f"HRA ASCT+B {sheet} {v['viewValue']}, {v['csvUrl']} (CC BY 4.0)")
        sha[v["csvUrl"]] = csv_sha
        organs[key] = {
            "present": bool(chosen), "rule": rule,
            "table": {"name": title, "sheet": sheet, "version": info.get("Version Number") or v["viewValue"],
                      "hra_release": v.get("hraVersion"), "csv_url": v["csvUrl"], "purl": v.get("link"),
                      "sha256": csv_sha, "data_doi": info.get("Data DOI"), "date": info.get("Date"),
                      "authors": info.get("Author Name(s)"), "reviewers": info.get("Reviewer(s)"),
                      "general_publications": info.get("General Publication(s)"),
                      "licence": "CC BY 4.0", "licence_url": page["licence_url"], "citation": page["citation"],
                      "landing_page": page["landing_page"], "rows_in_table": len(rows)},
            "n_rows": len(chosen), "summary": summary, "quirks": quirks, "rows": chosen,
            "biomarker_note": (None if any(r["genes"] for r in chosen) or not chosen else
                               "This table lists protein biomarkers (BProtein columns, identified by HGNC gene IDs); "
                               "it has no BGene columns."),
        }
    organs["blood"]["note"] = (
        "Erythrocyte (CL:0000232) does not occur in the HRA Blood table, nor in the bone marrow or blood vasculature "
        "tables checked; the Blood table lists leukocytes only. The bone marrow erythroid lineage rows "
        "(CL:0000764) are given separately under bone_marrow_erythroid.") if not organs["blood"].get("present") else None
    downloads = DOWNLOADS[first:] + [d for d in DOWNLOADS[:first] if d["url"].startswith(
        ("https://www.ebi.ac.uk/ols4/", "https://api.crossref.org/"))]
    write_json(ASCTB_OUT, {
        "meta": meta(False, sources + ["EBI OLS4 term labels", "Crossref (paper metadata)"], sha256=sha),
        "tag": "published_spec",
        "title": "Human Reference Atlas ASCT+B extracts for SpinDrift (heart, kidney, skin, brain, blood)",
        "licence": "CC BY 4.0 (HRA ASCT+B tables)",
        "citation": papers["asctb"]["text"], "hra_citation": papers["hra_3d"]["text"],
        "selection_terms": {t: terms[t] for t in TERMS},
        "note": ("Rows are copied as they appear in the released HRA tables, selected only by the rule shown for "
                 "each organ. Gene symbols and IDs are given as written in the table (quirks are listed, not "
                 "corrected). Reference data about cell types and their markers; not a measurement of any person."),
        "organs": organs,
        "downloads": downloads})
    return organs


def united_check(root_names):
    """HRA united male assembly: world transform of each model root, from the GLB JSON chunk only (HTTP range
    requests; the 241 MB file itself is not downloaded). A cross-check, recorded but not applied."""
    out = {"url": UNITED_GLB, "landing_page": None, "citation": None, "roots": {}, "note": None}
    try:
        page = landing(UNITED_BASE)
        out["landing_page"], out["citation"], out["doi"] = page["landing_page"], page["citation"], page["doi"]
        hdr = get_range(UNITED_GLB, 0, 19, "GLB header only")
        _, _, total, clen, _ = struct.unpack_from("<4sIII4s", hdr, 0)
        js = json.loads(get_range(UNITED_GLB, 20, 20 + clen - 1, "GLB JSON chunk only"))
        out["glb_total_bytes"] = total
        nodes = js.get("nodes", [])
        parent = {c: i for i, n in enumerate(nodes) for c in n.get("children", [])}
        has_tr = lambda n: any(t in n for t in ("matrix", "translation", "rotation", "scale"))  # noqa: E731
        for i, n in enumerate(nodes):
            if n.get("name") not in root_names:
                continue
            chain, j = [], i
            while j is not None:
                chain.append(j)
                j = parent.get(j)
            world = np.eye(4)
            for j in reversed(chain):
                world = world @ local_matrix(nodes[j])
            desc, stack = [], list(n.get("children", []))
            while stack:
                d = stack.pop()
                if has_tr(nodes[d]):
                    desc.append(nodes[d].get("name"))
                stack.extend(nodes[d].get("children", []))
            out["roots"][n["name"]] = {"world_translation_m": r6(world[:3, 3]),
                                       "world_linear_is_identity": bool(np.allclose(world[:3, :3], np.eye(3))),
                                       "descendants_with_own_transform": desc}
        skel = [i for i, n in enumerate(nodes) if n.get("name") == "VH_M_skeletal_system"]
        out["skeletal_system_children"] = ([nodes[c].get("name") for c in nodes[skel[0]].get("children", [])]
                                           if skel else None)
        out["upper_limb_nodes"] = sorted({n.get("name") for n in nodes if UPPER_LIMB.search(n.get("name") or "")})
        out["node_count"] = len(nodes)
        moved = {k: v["world_translation_m"] for k, v in out["roots"].items()
                 if any(abs(x) > 0 for x in v["world_translation_m"]) or not v["world_linear_is_identity"]
                 or v["descendants_with_own_transform"]}
        out["note"] = ("In the HRA united male assembly the roots of the models used here carry no transform"
                       + (" except " + "; ".join(f"{k} translated by {[round(x * 1000, 3) for x in v]} mm"
                                                  for k, v in moved.items()) if moved else "") +
                       ". The HRA API scene, used for the app frame, places every one of them with the identity, "
                       "so the difference is reported, not applied.")
    except Exception as ex:  # noqa: BLE001  (a cross-check only)
        out["note"] = f"united male cross-check not available: {ex}"
    return out


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reuse-local", action="store_true")
    ap.add_argument("--no-status", action="store_true", help="do not append to STATUS.md (test runs)")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    ref_organs, _ = get_json(REF_ORGANS_URL)
    scene, _ = get_json(SCENE_URL)
    scene_tm = {n["reference_organ"]: n.get("transformMatrix") for n in scene
                if n.get("reference_organ") and n.get("sex") == "Male" and n.get("scenegraph")}
    terms = {t: ols_label(t) for t in TERMS}
    papers = {k: crossref(doi) for k, doi in HRA_PAPERS.items()}

    entries = {}
    for key, slug, role, load in MODELS:
        e = [x for x in ref_organs if x["@id"].startswith(f"{PURL_REF}{slug}/") and x.get("sex") == "Male"]
        if len(e) != 1:
            raise SystemExit(f"HRA reference-organs list has {len(e)} entries for {slug}")
        entries[key] = (e[0], role, load)

    # app frame: HRA scene transform, then a y translation that puts the lowest skin vertex at y = 0
    def scene_matrix(entry):
        tm = scene_tm.get(entry["@id"])
        if tm is None:
            raise SystemExit(f"HRA scene has no transform for {entry['@id']}")
        return np.array(tm, float).reshape(4, 4).T, tm             # HRA API matrices are column-major

    models, records, cws = {}, {}, {}
    sizes = {}
    for key, (e, role, load) in entries.items():
        url = e["object"]["file"]
        head = urllib.request.urlopen(urllib.request.Request(url, headers=UA, method="HEAD"), timeout=60)
        sizes[key] = int(head.headers.get("Content-Length") or 0)
        head.close()
    if sizes["blood_vasculature"] > VASCULATURE_LIMIT:
        entries.pop("blood_vasculature")
    for key, (e, role, load) in entries.items():
        url = e["object"]["file"]
        base = url.split("/assets/")[0]
        page = landing(base)
        if url not in page["distribution"]:
            raise SystemExit(f"{url} is not in its landing page distribution")
        cws[key] = crosswalk(f"{base}/assets/crosswalk.csv")
        pl = placements(f"{base}/graph.jsonld", e["@id"])
        dest = OUT / Path(url).name
        sha, n, hdr = download(url, dest, args.reuse_local)
        records[key] = {"entry": e, "role": role, "load": load, "page": page, "placement": pl, "sha256": sha,
                        "bytes": n, "http": hdr, "dest": dest}

    # the skin fixes the y shift: its lowest vertex (after the HRA scene transform) goes to y = 0
    S_skin, _ = scene_matrix(entries["skin"][0])
    models["skin"] = Model(records["skin"]["dest"], S_skin)
    ty = -float(models["skin"].V[:, 1].min())
    models["skin"].V[:, 1] += ty
    A = np.eye(4)
    A[1, 3] = ty
    for key, rec in records.items():
        S, tm = scene_matrix(rec["entry"])
        rec["scene_tm"] = tm
        if key != "skin":
            models[key] = Model(rec["dest"], A @ S)
        inv = np.linalg.inv(A @ S)                                  # back to native GLB coordinates
        native = models[key].V @ inv[:3, :3].T + inv[:3, 3]
        gp = rec["placement"].get("global")
        rec["ccf_check_mm"] = (float(np.abs(native.min(0) * 1000.0 - np.array(gp["translation"])).max())
                               if gp and gp["relative_to"] == BODY_IRI and gp["translation_unit"] == "millimeter"
                               and not any(gp["rotation_deg"]) and gp["scaling"] == [1.0, 1.0, 1.0] else None)

    united = united_check({models[k].root for k in models})

    skin = models["skin"]
    skin_tris = Tris(skin.V, skin.N, skin.F)
    body_min, body_max = bbox(skin.V)
    mounts = compute_mounts(models, cws, terms, {"ref_organs": [x for x in ref_organs if x.get("sex") == "Male"],
                                                 "united": united})

    out_models, credits = {}, []
    credits.append("Anatomy: Human Reference Atlas (HRA), HuBMAP, 3D Reference Object Library, Visible Human Male "
                   "set, CC BY 4.0. " + papers["hra_3d"]["text"])
    bibl = []
    for key, rec in records.items():
        e, mdl, page = rec["entry"], models[key], rec["page"]
        c, area = surface_centroid(mdl.V, mdl.F)
        mn, mx = bbox(mdl.V)
        ins = inside(skin_tris, c) if key != "skin" else (None, None)
        parts = []
        root_children = sorted({p[1] for p in mdl.node_paths if len(p) > 1}, key=lambda s: s)
        for ch in root_children:
            Fp = mdl.faces_under(ch)
            if len(Fp):
                pc, _ = surface_centroid(mdl.V, Fp)
                pmn, pmx = bbox(mdl.V, Fp)
                parts.append({"node": ch, "uberon": cws[key].get(ch), "centroid": r5(pc),
                              "bbox": {"min": r5(pmn), "max": r5(pmx)}, "triangles": int(len(Fp))})
        nodes = []
        for i, name in enumerate(mdl.node_names):
            Fn = mdl.F[mdl.owner == i]
            nodes.append({"node": name, "centroid": r5(surface_centroid(mdl.V, Fn)[0]), "triangles": int(len(Fn))})
        mapped = sum(1 for nd in mdl.node_names if nd in cws[key])
        gp = rec["placement"].get("global")
        version = re.search(r"/(v[\d.]+)#", e["@id"]).group(1)
        out_models[key] = {
            "file": rec["dest"].name, "url": f"/data/anatomy/{rec['dest'].name}", "role": rec["role"],
            "load": rec["load"], "organ": e.get("label"), "uberon": e.get("representation_of", "").replace(
                "http://purl.obolibrary.org/obo/", "").replace("_", ":"),
            "sex": e.get("sex"), "version": version, "reference_organ": e["@id"], "hra_creation_date":
                e.get("creation_date"), "licence": "CC BY 4.0", "licence_url": page["licence_url"],
            "source": e["object"]["file"], "landing_page": page["landing_page"], "doi": page["doi"],
            "citation": page["citation"], "creators": page["creators"], "description": page["description"],
            "bibliography": page["bibliography"], "sha256": rec["sha256"], "bytes": rec["bytes"],
            "http": rec["http"], "glb": mdl.info,
            "hra_dimensions_mm": [e.get("x_dimension"), e.get("y_dimension"), e.get("z_dimension")],
            "placement": {
                "body_frame": BODY_IRI,
                "hra_scene_transform_column_major": rec["scene_tm"],
                "hra_scene_transform_is_identity": bool(np.allclose(np.array(rec["scene_tm"], float),
                                                                    np.eye(4).T.ravel())),
                "ccf_global_placement": gp, "ccf_object_placement": rec["placement"].get("obj"),
                "ccf_global_translation_vs_glb_bbox_min_max_abs_diff_mm": (
                    round(rec["ccf_check_mm"], 6) if rec["ccf_check_mm"] is not None else None),
                "united_male_assembly": united["roots"].get(mdl.root),
                "applied_to_app": "app = (HRA scene transform) then translate y by frame.hra_to_app.translation_m"},
            "bbox_app": {"min": r6(mn), "max": r6(mx)}, "size_m": r6(mx - mn),
            "centroid_app": r6(c),
            "centroid_method": "area-weighted mean of triangle centroids over all meshes of the file",
            "surface_area_m2": round(area, 6),
            "centroid_inside_skin": ins[0], "inside_test_ray_crossings": ins[1],
            "parts": parts, "nodes": nodes, "crosswalk": cws[key],
            "crosswalk_coverage": {"mesh_nodes": len(mdl.node_names), "mesh_nodes_with_ontology_id": mapped,
                                   "note": "crosswalk.csv of this digital object: node name -> Uberon/FMA ID; "
                                           "meshes HRA has not mapped keep their file name only"},
            "side_label_check": side_label_check(mdl),
        }
        credits.append(f"{page['citation']} Licence: CC BY 4.0. Source: {e['object']['file']}")
        for b in page["bibliography"]:
            if b not in bibl:
                bibl.append(b)
    credits.append("Underlying data cited by the HRA objects: " + " | ".join(bibl))

    default_bytes = sum(r["bytes"] for r in records.values() if r["load"] == "default")
    optional_bytes = sum(r["bytes"] for r in records.values() if r["load"] == "optional")
    brain_gyri = sorted({v["label"] for v in cws["brain"].values() if "gyr" in v["label"].lower()}
                        | {terms["UBERON:0002703"]["label"]})
    file_gyri = sorted({re.sub(r"^Allen_|_[LR]$", "", n) for n in models["brain"].node_names
                        if re.search(r"gyr|lobule|cortex|pole|cuneus|insula|operculum|planum", n)})
    manifest = {
        "meta": meta(False, [f"HRA API {REF_ORGANS_URL}", f"HRA API {SCENE_URL}",
                             "HRA CDN digital objects (GLB, crosswalk.csv, graph.jsonld, landing pages), CC BY 4.0",
                             "EBI OLS4 (term labels)", "Crossref (paper metadata)"],
                     sha256={(d["url"] + (f"#bytes={d['byte_range']}" if d.get("byte_range") else "")): d["sha256"]
                             for d in DOWNLOADS}),
        "tag": "recorded",
        "title": "Human Reference Atlas 3D reference organs (Visible Human Male) in the SpinDrift app frame",
        "frame": {
            "name": "app", "units": "metre",
            "axes": {"x": "+x = body's left, so the body's right is -x", "y": "up; the lowest skin vertex is y = 0",
                     "z": "+z = anterior"},
            "source_frame": {"iri": BODY_IRI, "via": SCENE_URL,
                             "axes": "metres, y up, +x body's left, +z anterior (see laterality_evidence)"},
            "hra_to_app": {
                "translation_m": [0.0, ty, 0.0], "rotation": "none", "scale": 1.0,
                "matrix_column_major": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.0, ty, 0.0, 1],
                "why": ("The HRA VHMale body frame already has the app's axes (metres, y up, +z anterior, body's "
                        "right at -x), so no rotation or scaling is applied. Its origin is near mid-body (the skin "
                        "spans y from -0.913 m to +0.911 m), so y is shifted by the lowest skin vertex to put the "
                        "soles at y = 0. x and z keep the HRA origin.")},
            "body_height_m": round(float(body_max[1] - body_min[1]), 6),
            "body_bbox_app": {"min": r6(body_min), "max": r6(body_max)},
            "laterality_evidence": mounts["laterality_evidence"],
            "cross_checks": {
                "ccf_global_placements": ("Each organ's CCF global placement relative to #VHMale (graph.jsonld) "
                                          "has no rotation, unit scale, and a translation equal to the GLB "
                                          "bounding-box minimum in mm (max difference per model in "
                                          "models.*.placement)."),
                "united_male": united},
        },
        "load": {"default": [k for k, r in records.items() if r["load"] == "default"],
                 "optional": [k for k, r in records.items() if r["load"] == "optional"],
                 "default_bytes": default_bytes, "optional_bytes": optional_bytes,
                 "total_bytes": default_bytes + optional_bytes,
                 "note": ("All files are uncompressed GLB (no Draco, no meshopt); three.js GLTFLoader alone loads "
                          "them. The blood vasculature is under 25 MB and is downloaded, but loaded only on request "
                          "to keep the default load near 50 MB.")},
        "materials": ("The app replaces each file material with a plain MeshStandardMaterial that keeps the file's "
                      "base colour, roughness and metalness; the skin gets a translucent neutral material. The files "
                      "hold no textures."),
        "brain_named_structures": {
            "mesh_nodes": len(models["brain"].node_names),
            "crosswalk_entries": len(cws["brain"]),
            "gyri_with_ontology_id": brain_gyri,
            "cortical_meshes_by_file_name": file_gyri,
            "precentral_gyrus_nodes": [n for n, v in cws["brain"].items() if v["id"] == "UBERON:0002703"],
            "note": ("The HRA crosswalk maps the meshes Allen_primary_motor_cortex_L/R to UBERON:0002703, which EBI "
                     "OLS labels 'precentral gyrus' (the crosswalk's own label reads 'primary motor cortex'). "
                     "Cortical meshes without an ontology ID in the crosswalk keep their Allen file names.")},
        "models": out_models,
        "mounts": {k: v for k, v in mounts.items() if k != "laterality_evidence"},
        "credits": credits,
        "papers": papers,
        "terms": terms,
        "downloads": DOWNLOADS,
        "not_available": [
            "Right volar forearm mount: no real landmark in the HRA male set (see mounts.forearm_right_volar).",
            "Upper-limb bones and vessels: no HRA reference organ, vasculature node or united-assembly node matches "
            "(searched as in mounts.forearm_right_volar)."],
    }
    write_json(OUT / "manifest.json", manifest)

    organs = build_asctb(terms, papers)
    manifest["meta"]["sha256"] = {(d["url"] + (f"#bytes={d['byte_range']}" if d.get("byte_range") else "")):
                                  d["sha256"] for d in DOWNLOADS}
    manifest["downloads"] = DOWNLOADS
    write_json(OUT / "manifest.json", manifest)

    # ------------------------------------------------------------ summary
    print(f"body height {manifest['frame']['body_height_m']:.4f} m; HRA->app translation y = {ty:.6f} m")
    for k, m in out_models.items():
        sl = m["side_label_check"]
        print(f"{k:18s} side suffix _L/_R: {sl['suffix_L_R']['checked']:3d} checked, "
              f"{sl['suffix_L_R']['mismatched_count']:3d} mismatched | left/right words: "
              f"{sl['left_right_words']['checked']:2d} checked, review {sl['left_right_words']['mismatched']}")
    for k, m in out_models.items():
        print(f"{k:18s} {m['version']:5s} {m['bytes'] / 1e6:6.2f} MB  tris {m['glb']['triangles']:7d}  "
              f"compression {m['glb']['compression']}  centroid {m['centroid_app']}  inside skin "
              f"{m['centroid_inside_skin']}  ccf diff {m['placement']['ccf_global_translation_vs_glb_bbox_min_max_abs_diff_mm']} mm")
    print(f"default load {default_bytes / 1e6:.2f} MB, optional {optional_bytes / 1e6:.2f} MB")
    sc = manifest["mounts"]["scalp_right_precentral_gyrus"]
    print(f"scalp centre {sc['center']['position']} normal {sc['center']['normal']} "
          f"(gyrus {sc['target_mesh']['file_node']}, side {sc['target_mesh']['side_in_body_frame']})")
    for p in sc["points"]:
        u = p["underlying_brain_structure"] or {}
        print(f"  {p['id']} {p['position']} n {p['normal']} over {u.get('label') or u.get('node')} "
              f"depth {u.get('depth_m')}")
    print(f"  spacing {sc['grid']['neighbour_spacing_m']}")
    ch = manifest["mounts"]["chest_over_heart"]
    print(f"chest {ch['position']} normal {ch['normal']} depth {ch['heart_centroid_to_skin_m']} m")
    print(f"forearm available: {manifest['mounts']['forearm_right_volar']['available']}")
    print("laterality:", manifest["frame"]["laterality_evidence"])
    print("united:", united["note"])
    for k, o in organs.items():
        print(f"ASCT+B {k:22s} rows {o.get('n_rows', 0):3d}  {(o.get('table') or {}).get('version')}  "
              f"genes {[g['symbol'] for g in (o.get('summary') or {}).get('genes', [])][:12]}")
    if args.no_status:
        return
    log_status("data/anatomy", "done",
               f"HRA VH male skin+heart+lungs+kidneys+brain (+vasculature optional), "
               f"{(default_bytes + optional_bytes) / 1e6:.1f} MB, body {manifest['frame']['body_height_m']:.3f} m, "
               f"mounts scalp 3x3 + chest; forearm not available")
    log_status("data/bio/asctb.json", "done",
               "HRA ASCT+B rows: " + ", ".join(f"{k} {o.get('n_rows', 0)}" for k, o in organs.items()))


if __name__ == "__main__":
    main()
