"""
Extract SpinDrift organ values from the NASA OSDR differential-expression tables.

Inputs (download first; these are not stored in the repo):
  OSD-580  GLDS-573_rna_seq_differential_expression_GLbulkRNAseq.csv  (~218 MB)
    https://osdr.nasa.gov/geode-py/ws/studies/OSD-580/download?source=datamanager&file=GLDS-573_rna_seq_differential_expression_GLbulkRNAseq.csv
  OSD-352  GLDS-352_rna_seq_differential_expression_GLbulkRNAseq.csv  (~16 MB)
    https://osdr.nasa.gov/geode-py/ws/studies/OSD-352/download?source=datamanager&file=GLDS-352_rna_seq_differential_expression_GLbulkRNAseq.csv

Usage:
  python scripts/extract_osdr.py <folder containing the two CSVs>

Writes data/heart_data.json, data/brain_data.json, data/ras_data.json.
Contrasts used (spaceflight vs ground control):
  heart: Ground Control (12 wk, Earth) vs Space Flight (12 wk, ISS)
  brain: Ground Control vs Space Flight
EDA-only: EEG (ds004902) is NOT included here; brain_data.json marks it PENDING.
"""

import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data"

HEART_FILE = "GLDS-573_rna_seq_differential_expression_GLbulkRNAseq.csv"
BRAIN_FILE = "GLDS-352_rna_seq_differential_expression_GLbulkRNAseq.csv"
HEART_LFC = "Log2fc_(Ground Control & 12 week & On Earth)v(Space Flight & 12 week & On ISS)"
HEART_PADJ = "Adj.p.value_(Ground Control & 12 week & On Earth)v(Space Flight & 12 week & On ISS)"
BRAIN_LFC = "Log2fc_(Ground Control)v(Space Flight)"
BRAIN_PADJ = "Adj.p.value_(Ground Control)v(Space Flight)"

HEART_GENES = ["NPPA", "NPPB", "MYH6", "MYH7", "ACTC1", "SCN5A", "KCNQ1", "RYR2",
               "ACE", "ACE2", "AGT", "REN", "AGTR1"]
BRAIN_GENES = ["BDNF", "TUBB3", "MAP2", "MAPT", "GRIN1", "ARC", "FOS"]
RAS_GENES = ["ACE", "ACE2", "AGT", "REN", "AGTR1", "AGTR2", "MAS1"]


def load(path, lfc_col, padj_col):
    rows = {}
    with open(path, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            sym = (r.get("SYMBOL") or "").strip()
            if not sym or sym == "NA":
                continue
            try:
                lfc, padj = float(r[lfc_col]), float(r[padj_col])
            except (ValueError, TypeError, KeyError):
                continue
            # keep first occurrence per symbol
            rows.setdefault(sym.upper(), {"symbol": sym, "log2fc": lfc, "padj": padj})
    return rows


def gene_table(rows, genes):
    out = {}
    for g in genes:
        r = rows.get(g)
        out[g] = None if r is None else {"log2fc": round(r["log2fc"], 3), "padj": float(f"{r['padj']:.3g}")}
    return out


def main(folder):
    folder = Path(folder)
    heart = load(folder / HEART_FILE, HEART_LFC, HEART_PADJ)
    brain = load(folder / BRAIN_FILE, BRAIN_LFC, BRAIN_PADJ)

    sig_h = [r for r in heart.values() if r["padj"] < 0.05]
    top30 = sorted(sig_h, key=lambda r: -abs(r["log2fc"]))[:30]
    heart_out = {
        "status": "OK — OSD-580 (GLDS-573) spaceflight vs ground control, 12 wk",
        "source": "NASA OSDR OSD-580",
        "sensor": "heart_opm",
        "contrast": HEART_LFC,
        "genes_tested": len(heart),
        "degs_padj_lt_0_05": len(sig_h),
        "degs_up": sum(r["log2fc"] > 0 for r in sig_h),
        "degs_down": sum(r["log2fc"] < 0 for r in sig_h),
        "top30_by_abs_log2fc": [
            {"symbol": r["symbol"], "log2fc": round(r["log2fc"], 3), "padj": float(f"{r['padj']:.3g}")}
            for r in top30],
        "caveat": "Top 30 are dominated by liver, lung and plasma genes (Alb, Fga, Sftpc, Scgb1a1). "
                  "The table may mix tissues or the heart samples may be contaminated. Verify before use.",
        "published_reference": {
            "citation": "Veliz et al. 2023, Biomolecules, PMID 36830740, DOI 10.3390/biom13020371",
            "url": "https://doi.org/10.3390/biom13020371",
            "transcripts_reported": 1147,
            "note": "The paper's count (1147) differs from this contrast (1374). The paper used its own pipeline and "
                    "contrast; its design is 3 flight vs 3 ground female mice after 30 days on ISS.",
        },
        "required_genes": gene_table(heart, HEART_GENES),
        "pathways": "NOT COMPUTED — MAPK / PI3K-Akt / GPCR claims in the spec need a pathway enrichment run",
    }

    sig_b = [r for r in brain.values() if r["padj"] < 0.05]
    brain_out = {
        "status": "PARTIAL — OSD-352 gene values OK; EEG (ds004902) PENDING",
        "sources": ["NASA OSDR OSD-352 (GLDS-352)", "OpenNeuro ds004902 (pending)"],
        "sensor": "brain_meg",
        "contrast": BRAIN_LFC,
        "genes_tested": len(brain),
        "degs_padj_lt_0_05": len(sig_b),
        "caveat": "Only a few genes pass padj<0.05 in this contrast, so most brain gene values are not significant.",
        "required_genes": gene_table(brain, BRAIN_GENES),
        "eeg": {"status": "PENDING", "dataset": "ds004902", "subjects": 71,
                "note": "Full dataset is ~8.9 GB. A 5-subject subset is ~0.6 GB and still needs PSD and drift-score code."},
        "drift_score": None,
    }

    ras_out = {
        "status": "PARTIAL — heart values from OSD-580; REN and AGTR1 absent from table",
        "sensor": "finger_nv",
        "source": "NASA OSDR OSD-580 (heart) and OSD-352 (brain)",
        "genes": {
            "heart": gene_table(heart, RAS_GENES),
            "brain": gene_table(brain, RAS_GENES),
        },
        "published_astronaut_values": "NOT INCLUDED — renin 4.88x, plasma volume -12%, RNFL +8.5% and "
                                      "choroid +2.8% from the spec are unverified; add only with a checked citation.",
    }

    OUT.mkdir(exist_ok=True)
    for name, obj in [("heart_data.json", heart_out), ("brain_data.json", brain_out), ("ras_data.json", ras_out)]:
        (OUT / name).write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"wrote {name}")
    print(f"heart: {len(sig_h)} DEGs at padj<0.05 (spec said 1147)")
    print(f"brain: {len(sig_b)} DEGs at padj<0.05")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python scripts/extract_osdr.py <folder with the two OSDR CSVs>")
    main(sys.argv[1])
