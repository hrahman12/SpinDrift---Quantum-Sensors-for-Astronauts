"""Build data/molecules/*.json: real 3D structures for the two analytes the quantum sensors detect.

- Renin, the enzyme the quantum-dot FRET sensor reports on: crystal structure PDB 2REN from RCSB (CC0 1.0).
  C-alpha trace, secondary structure from the file's HELIX/SHEET records, and the two catalytic aspartates from
  UniProt P00797 (CC BY 4.0), mapped onto the PDB chain by matching sequence context.
- Bilirubin, the analyte the carbon-dot patch reports on: PubChem CID 5280352 3D conformer (computed by PubChem,
  not a crystal structure), with atoms and bonds.

Only official download endpoints are used. The SHA256 of every downloaded file is recorded.
"""
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.common import DATA, log_status, meta, write_json  # noqa: E402

OUT = DATA / "molecules"
UA = {"User-Agent": "SpinDrift-build/1.0 (data build script)"}
PDB_ID = "2REN"
PDB_URL = f"https://files.rcsb.org/download/{PDB_ID}.pdb"
UNIPROT_URL = "https://rest.uniprot.org/uniprotkb/P00797.json"
CID = 5280352
PUBCHEM_3D = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{CID}/JSON?record_type=3d"
PUBCHEM_PROPS = (f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{CID}/property/"
                 "Title,MolecularFormula,MolecularWeight,IUPACName/JSON")
THREE = {"ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C", "GLN": "Q", "GLU": "E", "GLY": "G",
         "HIS": "H", "ILE": "I", "LEU": "L", "LYS": "K", "MET": "M", "PHE": "F", "PRO": "P", "SER": "S",
         "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V"}
ELEMENTS = {1: "H", 6: "C", 7: "N", 8: "O"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        body = r.read()
    return body, hashlib.sha256(body).hexdigest()


def parse_pdb(text):
    info = {"title": [], "authors": [], "journal": [], "resolution_A": None, "method": None, "deposited": None}
    ca, helices, sheets = [], [], []
    for line in text.splitlines():
        rec = line[:6].strip()
        if rec == "HEADER":
            info["header"] = line[10:50].strip()
            info["deposited"] = line[50:59].strip()
        elif rec == "TITLE":
            info["title"].append(line[10:80].strip())
        elif rec == "EXPDTA":
            info["method"] = line[10:80].strip()
        elif rec == "AUTHOR":
            info["authors"].append(line[10:80].strip())
        elif rec == "JRNL" and line[12:16].strip() in ("TITL", "REF", "AUTH", "REFN", "DOI", "PMID"):
            info["journal"].append(line[12:80].rstrip())
        elif rec == "REMARK" and line[7:10] == "  2" and "RESOLUTION." in line:
            try:
                info["resolution_A"] = float(line.split("RESOLUTION.")[1].split()[0])
            except (IndexError, ValueError):
                pass
        elif rec == "HELIX":
            helices.append({"chain": line[19], "start": int(line[21:25]), "end": int(line[33:37])})
        elif rec == "SHEET":
            sheets.append({"chain": line[21], "start": int(line[22:26]), "end": int(line[33:37])})
        elif rec == "ATOM" and line[12:16].strip() == "CA" and line[16] in (" ", "A"):
            ca.append({"chain": line[21], "res": int(line[22:26]), "icode": line[26].strip(),
                       "name": line[17:20], "x": float(line[30:38]), "y": float(line[38:46]),
                       "z": float(line[46:54]), "b": float(line[60:66])})
        elif rec == "ENDMDL":
            break
    info["title"] = " ".join(info["title"])
    info["authors"] = " ".join(info["authors"])
    return info, ca, helices, sheets


def secondary(ca, helices, sheets):
    for a in ca:
        a["ss"] = "C"
        for h in helices:
            if h["chain"] == a["chain"] and h["start"] <= a["res"] <= h["end"]:
                a["ss"] = "H"
        for s in sheets:
            if s["chain"] == a["chain"] and s["start"] <= a["res"] <= s["end"]:
                a["ss"] = "E"


def map_active_sites(ca, uni):
    seq = uni["sequence"]["value"]
    pdb_seq = "".join(THREE.get(a["name"], "X") for a in ca)
    sites = []
    for f in uni.get("features", []):
        if f.get("type") != "Active site":
            continue
        pos = f["location"]["start"]["value"]  # 1-based in the UniProt precursor sequence
        found = None
        for k in (6, 5, 4, 3):
            ctx = seq[pos - 1 - k:pos + k]
            idx = pdb_seq.find(ctx)
            if idx >= 0 and pdb_seq.count(ctx) == 1:
                found = idx + k
                break
        if found is None:
            continue
        a = ca[found]
        sites.append({"uniprot_position": pos, "uniprot_residue": seq[pos - 1], "pdb_chain": a["chain"],
                      "pdb_residue": a["res"], "pdb_name": a["name"], "index": found,
                      "description": f.get("description") or "Active site",
                      "evidence": [e.get("evidenceCode") for e in f.get("evidences", [])]})
    return sites


def renin():
    raw, sha = get(PDB_URL)
    info, ca, helices, sheets = parse_pdb(raw.decode("latin-1"))
    secondary(ca, helices, sheets)
    uraw, usha = get(UNIPROT_URL)
    uni = json.loads(uraw)
    sites = map_active_sites(ca, uni)
    name = uni.get("proteinDescription", {}).get("recommendedName", {}).get("fullName", {}).get("value")
    xs = [a["x"] for a in ca]
    ys = [a["y"] for a in ca]
    zs = [a["z"] for a in ca]
    centre = [sum(xs) / len(xs), sum(ys) / len(ys), sum(zs) / len(zs)]
    write_json(OUT / "renin_2ren.json", {
        "meta": meta(False, [f"RCSB PDB {PDB_ID}, {PDB_URL} (CC0 1.0)", f"UniProt P00797, {UNIPROT_URL} (CC BY 4.0)"],
                     sha256={PDB_URL: sha, UNIPROT_URL: usha}),
        "tag": "recorded", "pdb_id": PDB_ID, "protein": name, "uniprot": "P00797", "organism": "Homo sapiens",
        "method": info["method"], "resolution_A": info["resolution_A"], "deposited": info["deposited"],
        "title": info["title"], "authors": info["authors"], "journal": info["journal"],
        "n_residues": len(ca), "chains": sorted({a["chain"] for a in ca}),
        "helix_residues": sum(1 for a in ca if a["ss"] == "H"), "strand_residues": sum(1 for a in ca if a["ss"] == "E"),
        "centre_A": centre,
        "active_sites": sites,
        "ca": [[a["chain"], a["res"], a["name"], round(a["x"], 3), round(a["y"], 3), round(a["z"], 3), a["ss"],
                round(a["b"], 1)] for a in ca],
        "ca_columns": ["chain", "residue", "name", "x_A", "y_A", "z_A", "secondary", "b_factor"],
        "note": "C-alpha positions in angstrom as deposited. Secondary structure from the file's HELIX and SHEET "
                "records. Active sites from UniProt, matched to the PDB chain by sequence context.",
    })
    return len(ca), sites, info


def bilirubin():
    raw, sha = get(PUBCHEM_3D)
    rec = json.loads(raw)["PC_Compounds"][0]
    praw, psha = get(PUBCHEM_PROPS)
    props = json.loads(praw)["PropertyTable"]["Properties"][0]
    conf = rec["coords"][0]["conformers"][0]
    aids = rec["atoms"]["aid"]
    elements = [ELEMENTS.get(z, str(z)) for z in rec["atoms"]["element"]]
    atoms = [[elements[i], round(conf["x"][i], 4), round(conf["y"][i], 4), round(conf["z"][i], 4)]
             for i in range(len(aids))]
    index = {aid: i for i, aid in enumerate(aids)}
    b = rec["bonds"]
    bonds = [[index[a1], index[a2], o] for a1, a2, o in zip(b["aid1"], b["aid2"], b["order"])]
    write_json(OUT / "bilirubin_cid5280352.json", {
        "meta": meta(False, [f"PubChem CID {CID}, {PUBCHEM_3D}", f"PubChem properties, {PUBCHEM_PROPS}"],
                     sha256={PUBCHEM_3D: sha, PUBCHEM_PROPS: psha}),
        "tag": "calculated", "cid": CID, "name": props.get("Title"), "formula": props.get("MolecularFormula"),
        "molecular_weight": props.get("MolecularWeight"), "iupac_name": props.get("IUPACName"),
        "n_atoms": len(atoms), "n_bonds": len(bonds),
        "atoms": atoms, "atom_columns": ["element", "x_A", "y_A", "z_A"],
        "bonds": bonds, "bond_columns": ["atom_i", "atom_j", "order"],
        "note": "PubChem's computed 3D conformer (a model geometry), not a crystal structure. Coordinates in angstrom.",
    })
    return len(atoms), props


def main():
    n, sites, info = renin()
    print(f"renin {PDB_ID}: {n} C-alpha, {info['method']}, {info['resolution_A']} A, active sites "
          f"{[(s['pdb_name'], s['pdb_residue'], s['uniprot_position']) for s in sites]}")
    na, props = bilirubin()
    print(f"bilirubin CID {CID}: {na} atoms, {props.get('MolecularFormula')}")
    log_status("data/molecules", "done", f"renin {PDB_ID} ({n} C-alpha), bilirubin CID {CID} ({na} atoms)")


if __name__ == "__main__":
    main()
