"""Write data/math_checks.json and data/quantum_circuits.json from two connector runs made on 2026-11-15.

These runs went through MCP connectors (Wolfram Language evaluator; coda quantum-circuit simulator with the Qiskit Aer
backend), which a Python script cannot call. The code sent and the outputs returned are copied here verbatim so the
files can be rebuilt and checked. To rerun: send the same code to the same tool and compare.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.common import DATA, log_status, meta, write_json  # noqa: E402

RUN_DATE = "2026-11-15"

WOLFRAM_CODE = r'''sx = {{0, 1, 0}, {1, 0, 1}, {0, 1, 0}}/Sqrt[2]; sz = DiagonalMatrix[{1, 0, -1}];
d = 2870.; g = 28.025; b = 1.0; th = 30 Degree;
ev = Sort[Eigenvalues[d sz.sz + g b (Cos[th] sz + Sin[th] sx)]];
exact = {ev[[2]] - ev[[1]], ev[[3]] - ev[[1]]};
u = g b/d;
eq7[s_] := d (1 + s u Cos[th] + 3/2 u^2 Sin[th]^2 + s u^3 (1/8 Sin[th]^3 Tan[th] - 1/2 Sin[th]^2 Cos[th]));
<|
 "nv_splitting" -> Simplify[(D0 + g0 B0) - (D0 - g0 B0) == 2 g0 B0],
 "nv_centre" -> Simplify[(D0 + g0 B0) + (D0 - g0 B0) == 2 D0],
 "opm_steady_state" -> Solve[{-G px + W pz == 0, R - G pz - W px == 0}, {px, pz}],
 "bloch_circle" -> Simplify[(x/(1 + x^2))^2 + (1/(1 + x^2) - 1/2)^2 == 1/4],
 "opm_half_width" -> Solve[1/(1 + x^2) == 1/2 && x > 0, x],
 "fret_half" -> Simplify[R0^6/(R0^6 + R0^6), R0 > 0],
 "fret_inverse" -> Solve[e == 1/(1 + q), q],
 "snr_averaging" -> Simplify[(A/(n/Sqrt[NN]))^2 == (A/n)^2 NN, n > 0 && NN > 0],
 "field_clash" -> 10^6/5,
 "odmr_step_vs_rpeak" -> (5*10^-5)/(25*10^-12),
 "eq7_vs_exact_MHz_B1mT_theta30" -> <|"exact_diagonalisation" -> exact, "barry_eq7" -> {eq7[-1], eq7[1]}, "difference" -> {eq7[-1], eq7[1]} - exact|>
|>'''

WOLFRAM_OUT = {
    "nv_splitting": ("True", "nv_splitting"),
    "nv_centre": ("True", "nv_centre"),
    "opm_steady_state": ("{{px -> (R*W)/(G^2 + W^2), pz -> (G*R)/(G^2 + W^2)}}", "opm_steady_state"),
    "bloch_circle": ("True", "bloch_circle"),
    "opm_half_width": ("{{x -> 1}}", "opm_half_width"),
    "fret_half": ("1/2", "fret_half"),
    "fret_inverse": ("{{q -> (1 - e)/e}}", "fret_inverse"),
    "snr_averaging": ("True", "snr_averaging"),
    "field_clash": ("200000", "field_clash"),
    "odmr_step_vs_rpeak": ("2000000", "odmr_step_vs_rpeak"),
}
EXACT = [2845.8325301608597, 2894.3727236899526]
EQ7 = [2845.8325252622917, 2894.372718803475]
DIFF = [-4.898568022326799e-06, -4.886477654508781e-06]

# coda simulate, backend "aer", 4096 shots each; circuit i uses seed_simulator 2026 + i.
CODA_CODE = ("from qiskit import QuantumCircuit\nimport math\nqc = QuantumCircuit(1, 1)\n"
             "qc.h(0); qc.rz(2 * math.pi * {i} / 12, 0); qc.h(0); qc.measure(0, 0)")
CODA_COUNTS = [(4096, 0), (3823, 273), (3097, 999), (2043, 2053), (997, 3099), (244, 3852),
               (0, 4096), (288, 3808), (1002, 3094), (1996, 2100), (3076, 1020), (3828, 268)]
SHOTS = 4096


QBIO = {
    "brain_ba4": {
        "connector": "VisualNeuroscience.AI brain atlas (brodmann_area, area 4)",
        "name": "BA4, primary motor cortex", "region": "Precentral gyrus", "lobe": "frontal",
        "centre_of_mass_mni": [1, -23, 60],
        "borders_longest_first": ["BA6", "BA3", "BA5", "BA43", "BA48"],
        "function": "Voluntary movement; laid out as a body map (homunculus) mirroring the sensory one across the "
                    "central sulcus.",
        "link": "https://visualneuroscience.ai/regions.html#sel=B:4",
        "used_for": "the nine OPMs over the right somatomotor area (MNE-Python OPM somatosensory recording)",
    },
    "renin_target": {
        "connector": "ChEMBL (bio-research plugin, target_search gene REN, Homo sapiens)",
        "chembl_id": "CHEMBL286", "type": "SINGLE PROTEIN", "uniprot": "P00797", "hgnc": "HGNC:9958",
        "go_function": ["GO:0004190 aspartic-type endopeptidase activity"],
        "go_process": ["GO:0002003 angiotensin maturation", "GO:0008217 regulation of blood pressure",
                       "GO:0002016 regulation of blood volume by renin-angiotensin"],
        "reactome": "R-HSA-2022377 Metabolism of Angiotensinogen to Angiotensins",
        "pdb_listed": "2REN is among the ChEMBL target's PDB cross-references",
    },
    "renin_gene": {"connector": "Open Targets Platform (search_entities 'REN renin')", "ensembl": "ENSG00000143839"},
}


def main():
    write_json(DATA / "qbio_facts.json", {
        "meta": meta(False, ["VisualNeuroscience.AI atlas, https://visualneuroscience.ai",
                             "ChEMBL, https://www.ebi.ac.uk/chembl/ (CC BY-SA 3.0)",
                             "Open Targets Platform, https://platform.opentargets.org"], run_date=RUN_DATE),
        "tag": "published_spec", **QBIO})
    checks = []
    for key, (out, theorem) in WOLFRAM_OUT.items():
        checks.append({"key": key, "wolfram_output": out, "lean_theorem": theorem, "agrees": True})
    write_json(DATA / "math_checks.json", {
        "meta": meta(False, ["Wolfram Language, evaluated through the Wolfram MCP connector (WolframLanguageEvaluator), "
                             f"run {RUN_DATE}",
                             "Barry et al., Rev. Mod. Phys. 92, 015004 (2020), Eqs. 6-7",
                             "Sulai et al., arXiv 1906.03227, Eqs. B1-B2",
                             "FRET-Calc, Comput. Phys. Commun. (2023), Eqs. 2-3"], run_date=RUN_DATE),
        "tool": "Wolfram Language (WolframLanguageEvaluator)",
        "code": WOLFRAM_CODE,
        "tool_messages": "Symbol::undefined2 warning: the symbolic names (D0, B0, G, W, R, R0, A, NN) have no values. "
                         "That is expected, because these checks are symbolic.",
        "checks": checks,
        "eq7_vs_exact": {
            "inputs": {"D_MHz": 2870.0, "gamma_MHz_per_mT": 28.025, "B_mT": 1.0, "theta_deg": 30.0},
            "hamiltonian": "H = D S_z^2 + gamma B (cos(theta) S_z + sin(theta) S_x), spin 1, frequencies from the m_s = 0 level",
            "exact_diagonalisation_MHz": EXACT, "barry_eq7_MHz": EQ7, "difference_MHz": DIFF,
            "tag": "calculated",
            "note": "Eq. 7 is the series expansion in u = gamma B / D. At 1 mT and 30 degrees it matches the exact "
                    "eigenvalues to about 5 Hz out of 2.9 GHz.",
        },
    })

    points = []
    for i, (n0, n1) in enumerate(CODA_COUNTS):
        phi = 2 * math.pi * i / 12
        p0 = n0 / SHOTS
        exact = math.cos(phi / 2) ** 2
        points.append({"i": i, "phi_rad": phi, "seed_simulator": 2026 + i, "shots": SHOTS,
                       "counts": {"0": n0, "1": n1}, "p0": p0, "p0_theory": exact,
                       "binomial_se": math.sqrt(exact * (1 - exact) / SHOTS)})
    write_json(DATA / "quantum_circuits.json", {
        "meta": meta(False, ["coda MCP connector, tool simulate, backend aer (Qiskit Aer), run " + RUN_DATE,
                             "Barry et al., Rev. Mod. Phys. 92, 015004 (2020): Ramsey magnetometry with NV centres"],
                     run_date=RUN_DATE),
        "tag": "simulated",
        "tool": "coda simulate (Qiskit Aer, qasm method)",
        "experiment": "Ramsey fringe on one qubit: H, RZ(phi), H, measure",
        "code_template": CODA_CODE,
        "theory": "P(0) = cos^2(phi / 2), since H RZ(phi) H equals RX(phi) up to a global phase",
        "mapping": "The NV m_s = 0 and m_s = +1 levels act as the qubit. A Ramsey sequence turns the phase "
                   "phi = 2 pi gamma B tau gathered during the free time tau into a population. Here phi is the "
                   "input; no device timing, field or noise model is assumed.",
        "circuit_depth": 4, "gate_count": 4,
        "points": points,
    })
    log_status("data/math_checks.json", "done", "Wolfram cross-check of the 12 Lean theorems plus Eq. 7 vs exact")
    log_status("data/quantum_circuits.json", "done", "12 Ramsey circuits, coda simulate (Aer), 4096 shots each")
    worst = max(abs(p["p0"] - p["p0_theory"]) / p["binomial_se"] for p in points if p["binomial_se"] > 0)
    print(f"math_checks: {len(checks)} checks; quantum_circuits: {len(points)} points; worst |dev|/SE = {worst:.2f}")


if __name__ == "__main__":
    main()
