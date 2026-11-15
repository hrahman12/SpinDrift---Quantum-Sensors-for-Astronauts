"""Build data/quantum_constants.json: every constant the quantum-level scenes (ui/scale/q_*.js) draw or compute.

Each entry is a value object with an exact citation (document, table/figure/equation, page, edition). Derived numbers
are tagged "calculated" with their formula and inputs. Nothing is approximated or invented: where a source does not
give a value (the renin dot's material and size, the patch dots' lattice fringes) the entry is null with status
NOT_STATED or NOT_YET_EXTRACTED, and the scenes do not draw it.

Values were checked on 2026-11-15 against:
- Steck, "Rubidium 87 D Line Data", revision 2.3.4 (8 August 2025), PDF text of Tables 2, 4, 5, 6, Fig. 3, Eq. 23;
- NIST CODATA 2022 pages for the electron g factor, the electron gyromagnetic ratio and mu_B/h;
- Holloway et al. 1991 abstract (diamond lattice constant) and two Crystallography Open Database CIFs;
- the COD CIF of Trucano & Chen 1975 (graphite);
- Barry et al. 2020 (arXiv 1903.08176v2) Sec. I, Eqs. 2, 6; Sulai et al. (arXiv 1906.03227) Sec. III and App. B;
- the Mantina et al. 2009 abstract (Europe PMC record) for the Rb van der Waals radius;
- the periodictable package's transcription of Cordero et al. 2008 (covalent radii; the article is paywalled).
A Wolfram Language run (recorded below in WOLFRAM) cross-checks the derived numbers; this script recomputes each one
and stops if Python and Wolfram disagree.
"""
import json
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.common import DATA, RECORDED, calc, log_status, meta, missing, read_json, vo, write_json  # noqa: E402

OUT = DATA / "quantum_constants.json"
ACCESSED = "2026-11-15"

# ---------------------------------------------------------------------------------------------------- sources
STECK = "Daniel A. Steck, 'Rubidium 87 D Line Data', revision 2.3.4, 8 August 2025, http://steck.us/alkalidata"
CODATA = "CODATA 2022 recommended values, NIST (https://physics.nist.gov/cuu/Constants/, accessed 2026-11-15)"
HOLLOWAY = ("Holloway, Hass, Tamor, Anthony & Banholzer, 'Isotopic dependence of the lattice constant of diamond', "
            "Phys. Rev. B 44, 7123 (1991), doi:10.1103/PhysRevB.44.7123, abstract")
COD_RILEY = "Crystallography Open Database entry 9011575 (Riley, Nature 153, 587 (1944))"
COD_HOUBEN = ("Crystallography Open Database entry 2300702 (Houben et al., J. Appl. Cryst. 56, 633 (2023), "
              "doi:10.1107/S1600576723002819)")
COD_GRAPHITE = ("Crystallography Open Database entry 9011577 (Trucano & Chen, 'Structure of graphite by neutron "
                "diffraction', Nature 258, 136 (1975), doi:10.1038/258136a0)")
BARRY = ("Barry et al., 'Sensitivity optimization for NV-diamond magnetometry', Rev. Mod. Phys. 92, 015004 (2020), "
         "arXiv 1903.08176v2")
CORDERO = ("Cordero et al., 'Covalent radii revisited', Dalton Trans. 2008, 2832-2838, doi:10.1039/b801115j, "
           "covalent-radius table")
MANTINA = ("Mantina, Chamberlin, Valero, Cramer & Truhlar, 'Consistent van der Waals radii for the whole main group', "
           "J. Phys. Chem. A 113, 5806-5812 (2009), doi:10.1021/jp8111556, abstract")
SULAI = ("Sulai et al., 'Characterizing atomic magnetic gradiometers for fetal magnetocardiography', "
         "arXiv 1906.03227 (2019)")
QUSPIN_TECH = "QuSpin technology page, 'How the QZFM works', https://quspin.com/technology/ (accessed 2026-11-15)"
GRIFFITHS = ("Griffiths & Schroeter, Introduction to Quantum Mechanics, 3rd ed. (Cambridge University Press, 2018), "
             "Sec. 2.2, the infinite square well")
LONG = ("Long, Zhang, Zhang, Zhang, 'Single quantum dot based nanosensor for renin assay', Anal. Chem. 84(20), "
        "8846-8852 (2012), doi:10.1021/ac302284s, abstract")
TABATABAEE = ("Tabatabaee, Naghdi, Peyravian, Kiani, Golmohammadi, 'An Invisible Dermal Nanotattoo-Based Smart "
              "Wearable Sensor for eDiagnostics of Jaundice', ACS Nano 18(41), 28012-28025 (2024), "
              "doi:10.1021/acsnano.4c06191")
PERIODICTABLE = ("values as transcribed in the periodictable Python package, periodictable/covalent_radius.py "
                 "(https://sources.debian.org/src/python-periodictable/2.0.2-1/periodictable/covalent_radius.py)")

# Wolfram Language cross-check, run through the Wolfram MCP connector (WolframLanguageEvaluator) on 2026-11-15.
WOLFRAM_CODE = (
    "w = {wx, wy, wz}; z = {0, 0, 1}; P = (z + Cross[w, z] + (w . z) w)/(1 + w . w);\n"
    "sx = {{0,1,0},{1,0,1},{0,1,0}}/Sqrt[2]; sy = {{0,-I,0},{I,0,-I},{0,I,0}}/Sqrt[2]; sz = DiagonalMatrix[{1,0,-1}];\n"
    "psi = {Exp[-I ph], 1, 0}/Sqrt[2];  (* basis m = +1, 0, -1 *)\n"
    "ex[m_] := FullSimplify[Conjugate[psi] . m . psi, Element[ph, Reals]];\n"
    "a = 3.56715; gJ = 2.002331070; gI = -0.0009951414;\n"
    "gF[F_] := gJ (F(F+1) - 15/4 + 3/4)/(2F(F+1)) + gI (F(F+1) + 15/4 - 3/4)/(2F(F+1));\n"
    "<| steady_state_residual -> FullSimplify[z - P + Cross[w, P]], spin1_expectation_S -> {ex[sx], ex[sy], ex[sz]},\n"
    "   spin_tilt_deg -> ArcCos[(1/2)/Sqrt[3/4]]/Degree, spin_length -> Sqrt[3/4], diamond_bond_A -> Sqrt[3]/4 a,\n"
    "   tetrahedral_angle_deg -> ArcCos[-1/3]/Degree, gF2 -> gF[2], gF1 -> gF[1], zeeman_F2_Hz_per_nT -> gF[2] 13.9962449171,\n"
    "   gamma_barry_MHz_per_mT -> 2.003 13.9962449171, gamma_vs_codata -> (28.025 - 28.0249513861)/28.0249513861,\n"
    "   hfs_2A_GHz -> 2 3.417341305452145, rb_spacing_nm -> (10^14)^(-1/3) 10^7,\n"
    "   fret_inverse -> (1/{0.461, 0.502, 0.55, 0.621, 0.685} - 1)^(1/6), gslac_mT -> 2870/28.025,\n"
    "   graphite -> {6.711/2, 2.464/Sqrt[3], 2.464 Sqrt[3]/2} |>")
WOLFRAM = {
    "steady_state_residual": "{0, 0, 0}",
    "spin1_expectation_S": "{Cos[ph]/Sqrt[2], Sin[ph]/Sqrt[2], 1/2}",
    "spin_tilt_deg": 54.73561031724534,
    "spin_length": 0.8660254037844386,
    "diamond_bond_A": 1.54462125955483,
    "tetrahedral_angle_deg": 109.47122063449069,
    "gF2": 0.49983641144999996,
    "gF1": -0.5018266942499999,
    "zeeman_F2_Hz_per_nT": 6.995832833138566,
    "gamma_barry_MHz_per_mT": 28.034478568951304,
    "gamma_vs_codata": 1.734664918027145e-06,
    "hfs_2A_GHz": 6.83468261090429,
    "rb_spacing_nm": 215.44346900318837,
    "fret_inverse": [1.026395265227141, 0.9986675480589213, 0.9671079886163778, 0.9209964049617906,
                     0.8785571085573246],
    "gslac_mT": 102.4085637823372,
    "graphite": [3.3555, 1.4225910632832381, 2.133886594924857],
}


def rnd(x, n=10):
    return float(f"{x:.{n}g}")


def _frac(x):
    """1/6 -> '1/6' for the Steck matrix-element labels."""
    for d in (2, 3, 4, 6, 12):
        if math.isclose(x * d, round(x * d)):
            return f"{round(x * d)}/{d}"
    return repr(x)


def agree(name, mine, theirs, rel=1e-9):
    if isinstance(theirs, list):
        for m, t in zip(mine, theirs):
            agree(name, m, t, rel)
        return
    if not math.isclose(mine, theirs, rel_tol=rel, abs_tol=1e-12):
        raise SystemExit(f"{name}: python {mine!r} != wolfram {theirs!r}")


def main():
    physics = read_json(DATA / "physics.json")
    palette = read_json(DATA / "palette.json")
    specs = read_json(DATA / "specs.json")
    fret_rec = read_json(RECORDED / "qd_fret_figshare5468838.json")
    if not (physics and palette and specs and fret_rec):
        raise SystemExit("physics.json, palette.json, specs.json and recorded/qd_fret_figshare5468838.json are needed")

    # ------------------------------------------------------------------ electron (CODATA 2022)
    g_e = vo(-2.00231930436092, "", f"{CODATA}, 'electron g factor', -2.002 319 304 360 92(36)")
    gamma_e = vo(28024.9513861, "MHz/T", f"{CODATA}, 'electron gyromagnetic ratio in MHz/T' (gamma_e/2pi), "
                 "28 024.951 3861(87) MHz T^-1")
    mub_h = vo(1.39962449171e10, "Hz/T", f"{CODATA}, 'Bohr magneton in Hz/T', 1.399 624 491 71(44) x 10^10 Hz T^-1")
    gamma_e_mT = calc(rnd(gamma_e["value"] / 1000, 12), "MHz/mT", [gamma_e], "gamma_e/2pi [MHz/T] / 1000",
                      ["electron.gyromagnetic_ratio_over_2pi"])
    electron = {"g_factor": g_e, "gyromagnetic_ratio_over_2pi": gamma_e, "gyromagnetic_ratio_over_2pi_per_mT": gamma_e_mT,
                "bohr_magneton_over_h": mub_h}

    # ------------------------------------------------------------------ diamond
    a_d = vo(3.56715, "Å", f"{HOLLOWAY}: a0(C, 25 °C, x) = 3.567 15 - 0.000 53 x Å, x = atom fraction of 13C",
             note="value at x = 0; the 13C term changes a by at most 0.000 53 Å (pure 13C), below the 3.567 Å "
                  "shown. Cross-checks: COD 9011575 gives 3.56679 Å at 291.15 K and COD 2300702 gives 3.566636(7) Å "
                  "at 293 K, all within 0.0006 Å.")
    a_riley = vo(3.56679, "Å", f"{COD_RILEY}: diamond, Fd-3m, _cell_length_a, _diffrn_ambient_temperature 291.15 K")
    a_houben = vo(3.566636, "Å", f"{COD_HOUBEN}: diamond, Fd-3m, _cell_length_a 3.566636(7) at 293 K")
    structure = vo("diamond cubic, space group Fd-3m (No. 227); two interpenetrating face-centred cubic lattices offset "
                   "by a/4 (1,1,1); 8 atoms per conventional cubic cell", "",
                   f"{COD_HOUBEN}: _space_group_name_H-M_alt 'F d -3 m :2', _cell_formula_units_Z 8, C1 at 8a")
    bond = calc(rnd(math.sqrt(3) / 4 * a_d["value"]), "Å", [a_d], "d = sqrt(3) a / 4 (nearest-neighbour distance)",
                ["diamond.lattice_constant"],
                note_extra="COD 2300702 lists C1-C1 1.5444 Å for its 3.566636 Å cell; same formula")
    angle = calc(rnd(math.degrees(math.acos(-1 / 3))), "°", [structure], "theta = arccos(-1/3) (tetrahedral)",
                 ["diamond.structure"], note_extra="COD 2300702 lists 109.471°")
    diamond = {"lattice_constant": a_d, "lattice_constant_cod_riley_1944": a_riley,
               "lattice_constant_cod_houben_2023": a_houben, "structure": structure, "cc_bond_length": bond,
               "bond_angle": angle}

    # ------------------------------------------------------------------ NV centre
    ph = physics["nv_odmr_lines"]
    D_nv, gamma_nv = ph["inputs"][0], ph["inputs"][1]
    geometry = vo("a substitutional nitrogen adjacent to a lattice vacancy; the NV symmetry axis lies along one of the "
                  "four <111> crystallographic directions", "",
                  f"{BARRY}, Sec. I.A, p. 2 and Fig. 1a ('a substitutional nitrogen fixed adjacent to a vacancy "
                  "within the rigid carbon lattice')")
    n_v = calc(bond["value"], "Å", [bond, geometry], "N-V distance = C-C bond length (ideal, unrelaxed lattice sites)",
               ["diamond.cc_bond_length", "nv.geometry"],
               note_extra="relaxation of the atoms around the vacancy is not modelled, so it is not drawn")
    g_nv = vo(2.003, "", f"{BARRY}, Sec. I.C, Eq. (2), p. 4 ('g_e ≈ 2.003 is the NV electronic g-factor')")
    gamma_barry = calc(rnd(g_nv["value"] * mub_h["value"] / 1e9, 8), "MHz/mT", [g_nv, mub_h],
                       "gamma = g_NV mu_B / h", ["nv.g_factor_barry", "electron.bohr_magneton_over_h"],
                       note_extra="Barry's g ≈ 2.003 gives 28.03 MHz/mT; physics.json uses 28.025 MHz/mT, the "
                                  "free-electron value (CODATA 2022 gamma_e/2pi = 28.02495 MHz/mT)")
    gamma_vs_codata = calc(rnd((gamma_nv["value"] - gamma_e_mT["value"]) / gamma_e_mT["value"], 6), "",
                           [gamma_nv, gamma_e_mT], "(gamma_physics - gamma_e/2pi) / (gamma_e/2pi)",
                           ["nv.gamma", "electron.gyromagnetic_ratio_over_2pi_per_mT"],
                           note_extra="physics.json's 28.025 MHz/mT is the CODATA free-electron value rounded to 5 "
                                      "digits; its TO_CONFIRM status is inherited")
    gslac = calc(rnd(D_nv["value"] / gamma_nv["value"]), "mT", [D_nv, gamma_nv],
                 "B = D / gamma (m_s = -1 meets m_s = 0, field along the axis)", ["nv.D", "nv.gamma"],
                 note_extra="the scene's field control stops at 5 mT, far below this crossing")
    levels = vo("nu± = D ± (g_e mu_B / h) B_z: m_s = 0 at 0, m_s = ±1 at D ± gamma B for a field along the NV axis",
                "", f"{BARRY}, Sec. I.C, Eqs. (5)-(6), p. 5")
    ramsey = vo("Ramsey on the {|0>, |+1>} pair: pi/2 pulse, free precession for tau, pi/2 pulse; phase "
                "phi = gamma_e B tau with gamma_e = g_e mu_B / hbar, i.e. phi = 2 pi gamma B tau with gamma in Hz/T",
                "", f"{BARRY}, Sec. I.D, pp. 5-6, and Sec. I.E, p. 6")
    spin_ops = vo("spin-1 operators S_x = [[0,1,0],[1,0,1],[0,1,0]]/sqrt2, S_y = [[0,-i,0],[i,0,-i],[0,i,0]]/sqrt2, "
                  "S_z = diag(1,0,-1)", "", "standard spin-1 matrices, as used for the NV Hamiltonian H = D S_z^2 + "
                  "gamma B.S in data/math_checks.json (Barry et al. Eq. 2)")
    s_tilt = calc(rnd(math.degrees(math.acos(0.5 / math.sqrt(0.75)))), "°", [spin_ops, ramsey],
                  "<S> of (|0> + e^{i phi}|+1>)/sqrt2 is (cos phi/sqrt2, sin phi/sqrt2, 1/2); tilt = arccos(<S_z>/|<S>|)",
                  ["nv.spin_operators", "nv.ramsey"],
                  note_extra="= arccos(1/sqrt3); expectation values checked symbolically in Wolfram Language")
    s_len = calc(rnd(math.sqrt(0.75)), "", [spin_ops, ramsey], "|<S>| = sqrt(1/2 + 1/4) (units of hbar)",
                 ["nv.spin_operators", "nv.ramsey"])
    nv = {"geometry": geometry, "n_v_distance": n_v, "D": D_nv, "gamma": gamma_nv, "g_factor_barry": g_nv,
          "gamma_from_barry_g": gamma_barry, "gamma_vs_codata_relative": gamma_vs_codata, "gslac_field": gslac,
          "levels": levels, "ramsey": ramsey, "spin_operators": spin_ops, "superposition_spin_tilt": s_tilt,
          "superposition_spin_length": s_len}

    # ------------------------------------------------------------------ 87Rb (Steck rev. 2.3.4)
    I_rb = vo(1.5, "", f"{STECK}, Table 2 (Rubidium 87 Physical Properties), p. 17: nuclear spin I = 3/2")
    lam_d1 = vo(794.978851156, "nm", f"{STECK}, Table 4 (Rubidium 87 D1 (5²S1/2 -> 5²P1/2) Transition Optical "
                "Properties), p. 18: wavelength (vacuum) 794.978 851 156(23) nm")
    lam_d1_air = vo(794.7664776, "nm", f"{STECK}, Table 4, p. 18: wavelength (air) 794.766 477 6(79) nm")
    nu_d1 = vo(377.107463380, "THz", f"{STECK}, Table 4, p. 18: frequency omega_0 = 2 pi x 377.107 463 380(11) THz")
    A_s = vo(3.417341305452145, "GHz", f"{STECK}, Table 5 (D Transition Hyperfine Structure Constants), p. 19: "
             "A(5²S1/2) = h x 3.417 341 305 452 145(45) GHz")
    hfs = vo(6.834682610904290, "GHz", f"{STECK}, Fig. 3 (D1 transition hyperfine structure), p. 27: "
             "6.834 682 610 904 290(90) GHz between F = 1 and F = 2")
    hfs_check = calc(rnd(2 * A_s["value"], 16), "GHz", [A_s], "Delta E_hfs = A (I + 1/2) = 2A for J = 1/2, I = 3/2",
                     ["rb87.ground_hfs_constant_A"], note_extra="equals the Fig. 3 value")
    A_p = vo(407.25, "MHz", f"{STECK}, Table 5, p. 19: A(5²P1/2) = h x 407.25(63) MHz")
    hfs_p = vo(814.5, "MHz", f"{STECK}, Fig. 3, p. 27: 814.5(13) MHz between F' = 1 and F' = 2 of 5²P1/2")
    gJ = vo(2.002331070, "", f"{STECK}, Table 6 (Magnetic and Electric Field Interaction Parameters), p. 19: "
            "g_J(5²S1/2) = 2.002 331 070(26)")
    gI = vo(-0.0009951414, "", f"{STECK}, Table 6, p. 19: g_I = -0.000 995 141 4(10)")
    gF2 = vo(0.5, "", f"{STECK}, Fig. 3, p. 27: 5²S1/2 F = 2, g_F = 1/2 (0.70 MHz/G)",
             note="approximate value from Eq. (23) without the nuclear term, as printed in the figure")
    gF1 = vo(-0.5, "", f"{STECK}, Fig. 3, p. 27: 5²S1/2 F = 1, g_F = -1/2 (-0.70 MHz/G)",
             note="approximate value from Eq. (23) without the nuclear term, as printed in the figure")
    gF2p = vo(1 / 6, "", f"{STECK}, Fig. 3, p. 27: 5²P1/2 F' = 2, g_F = 1/6 (0.23 MHz/G)")
    gF1p = vo(-1 / 6, "", f"{STECK}, Fig. 3, p. 27: 5²P1/2 F' = 1, g_F = -1/6 (-0.23 MHz/G)")

    def gf(F, g_j, g_i, I=1.5, J=0.5):
        k = F * (F + 1)
        return g_j * (k - I * (I + 1) + J * (J + 1)) / (2 * k) + g_i * (k + I * (I + 1) - J * (J + 1)) / (2 * k)

    eq23 = f"{STECK}, Eq. (23), p. 7: g_F = g_J [F(F+1) - I(I+1) + J(J+1)]/[2F(F+1)] + g_I [F(F+1) + I(I+1) - J(J+1)]/[2F(F+1)]"
    gF2x = calc(rnd(gf(2, gJ["value"], gI["value"]), 12), "", [gJ, gI, I_rb], "Steck Eq. (23) with the nuclear term, F = 2",
                ["rb87.g_J_ground", "rb87.g_I", "rb87.nuclear_spin"], source=eq23)
    gF1x = calc(rnd(gf(1, gJ["value"], gI["value"]), 12), "", [gJ, gI, I_rb], "Steck Eq. (23) with the nuclear term, F = 1",
                ["rb87.g_J_ground", "rb87.g_I", "rb87.nuclear_spin"], source=eq23)
    zee2 = calc(rnd(gF2x["value"] * mub_h["value"] * 1e-9, 10), "Hz/nT", [gF2x, mub_h],
                "Delta nu between adjacent m_F = g_F mu_B B / h (Steck Eq. 24)", ["rb87.g_F_F2_exact",
                "electron.bohr_magneton_over_h"], note_extra="Steck Fig. 3 prints 0.70 MHz/G = 7.0 Hz/nT")
    zee_range = calc(rnd(zee2["value"] * 5, 6), "Hz", [zee2], "adjacent-sublevel splitting at the QZFM's 5 nT range "
                     "limit", ["rb87.zeeman_F2_per_nT"], note_extra="5 nT = QuSpin QZFM Gen-3 dynamic range (specs.json); "
                     "far too small to show on the level diagram, so the sublevels are drawn unshifted")
    dark_table = vo("no sigma+ entry for F = 2, m_F = +2", "", f"{STECK}, Table 15, p. 23 (the m_F = 2 column is empty "
                    "for both F' = 2 and F' = 1)")
    dark = calc("F = 2, m_F = +2", "", [I_rb, hfs_p, dark_table],
                "sigma+ light drives m_F -> m_F + 1; 5²P1/2 has F' = 1, 2 only, so from m_F = +2 there is no "
                "m_F' = +3 to reach: the stretched state is dark to sigma+ D1 light",
                ["rb87.nuclear_spin", "rb87.p12_hfs_splitting", "rb87.dark_state_table"],
                note_extra="levels from Steck Fig. 3; QuSpin: at zero field the atoms 'become largely transparent'")
    # relative sigma+ D1 line strengths |<F mF| er |F' mF+1>|^2 in units of |<J=1/2||er||J'=1/2>|^2
    strengths = []
    for F, table, rows in ((2, "Table 15", {2: [1 / 6, 1 / 4, 1 / 4, 1 / 6, None], 1: [1 / 2, 1 / 4, 1 / 12, None, None]}),
                           (1, "Table 18", {2: [1 / 12, 1 / 4, 1 / 2], 1: [1 / 12, 1 / 12, None]})):
        for Fp, vals in rows.items():
            for m, val in zip(range(-F, F + 1), vals):
                if val is None:
                    continue
                strengths.append({"F": F, "mF": m, "Fp": Fp, "mFp": m + 1, "strength": vo(
                    rnd(val, 12), "|<J=1/2||er||J'=1/2>|^2", f"{STECK}, {table} (D1 sigma+ hyperfine dipole matrix "
                    f"elements, F = {F}), p. {23 if F == 2 else 24}: element sqrt({_frac(val)}) squared", tag="calculated")})
    r_vdw = vo(3.03, "Å", f"{MANTINA}: 'The newly determined radii (in Å) are ... Rb, 3.03'",
               note="van der Waals radius on Bondi's scale; drawn as the atom's size. A free atom has no sharp edge.")
    r_vdw_nm = calc(0.303, "nm", [r_vdw], "3.03 Å = 0.303 nm", ["rb87.vdw_radius"])
    rb87 = {"nuclear_spin": I_rb, "d1_wavelength_vacuum": lam_d1, "d1_wavelength_air": lam_d1_air, "d1_frequency": nu_d1,
            "ground_hfs_constant_A": A_s, "ground_hfs_splitting": hfs, "ground_hfs_splitting_check": hfs_check,
            "p12_hfs_constant_A": A_p, "p12_hfs_splitting": hfs_p, "g_J_ground": gJ, "g_I": gI,
            "g_F_F2": gF2, "g_F_F1": gF1, "g_F_P12_F2": gF2p, "g_F_P12_F1": gF1p,
            "g_F_F2_exact": gF2x, "g_F_F1_exact": gF1x, "zeeman_F2_per_nT": zee2, "zeeman_F2_at_5nT": zee_range,
            "d1_sigma_plus_strengths": strengths, "dark_state_table": dark_table, "dark_state": dark,
            "vdw_radius": r_vdw, "vdw_radius_nm": r_vdw_nm}

    # ------------------------------------------------------------------ OPM spin model (Sulai et al.)
    b1 = vo("2 d<F>/dt = R (s - <P>) + Omega x <P> - Gamma <P>", "", f"{SULAI}, Appendix B, Eq. (B1), p. 10: R optical "
            "pumping rate, s photon spin vector, Omega = gamma B, Gamma total spin relaxation rate")
    b2 = vo("<P> = R / (Gamma'(Gamma'^2 + Omega^2)) [Gamma' Omega_y + Omega_z Omega_x, -Gamma' Omega_x + Omega_y Omega_z, "
            "Gamma'^2 + Omega_z^2], Gamma' = Gamma + R", "", f"{SULAI}, Appendix B, Eq. (B2), p. 10",
            note="arXiv v1 prints -Gamma'^2 in the z component; +Gamma'^2 is the sign that solves Eq. (B1) "
                 "(Lean theorem opm_steady_state; Wolfram check below)")
    dimless = vo("with s = z, w = Omega/Gamma' and P in units of R/Gamma': dP/dtau = z - P + w x P; steady state "
                 "P* = (z + w x z + (w.z) w) / (1 + |w|^2)", "", f"{SULAI}, Eqs. (B1)-(B2), rescaled",
                 tag="calculated",
                 note="tau is dimensionless time. The left side of (B1) is 2 d<F>/dt and the paper does not give how "
                      "<F> follows <P>, so tau is not converted to seconds; the steady state does not depend on it.")
    t_cell = vo(150, "°C", f"{SULAI}, Sec. III, p. 2 ('We heat the cells up to a temperature of 150 °C')",
                note=f"QuSpin states the QZFM cell 'runs at ~150 °C' ({QUSPIN_TECH})")
    n_cell = vo(1e14, "cm^-3", f"{SULAI}, Sec. III, p. 2 ('the equilibrium density is n = 10^14 cm^-3')",
                note="Sulai's cell holds rubidium (isotope not stated) with about 200 Torr N2 and Ne buffer gas")
    spacing = calc(rnd((n_cell["value"] * 1e6) ** (-1 / 3) * 1e9), "nm", [n_cell], "mean spacing n^(-1/3)",
                   ["opm_model.cell_density"], note_extra="neighbouring atoms lie this far apart on average: far outside "
                   "the scene, which shows one atom")
    pump = vo("circularly polarised light resonant with the Rb D1 line at 795 nm polarises the atoms along z", "",
              f"{SULAI}, Sec. III, p. 2", note="QuSpin does not state the QZFM's laser line; the QZFM is single-beam "
              f"('based on zero-field resonance with a single laser beam', {QUSPIN_TECH})")
    species = vo("rubidium", "", f"{QUSPIN_TECH}; specs.json opm.atomic_species",
                 note="QuSpin does not state the isotope; the scene uses 87Rb constants from Steck")
    opm_model = {"bloch_equation": b1, "steady_state": b2, "dimensionless_form": dimless, "cell_temperature": t_cell,
                 "cell_density": n_cell, "mean_atom_spacing": spacing, "pump": pump, "qzfm_species": species}

    # ------------------------------------------------------------------ quantum dot (renin sensor)
    qd_sp = specs["qd_renin"]
    fret_in = physics["qd_fret_vs_distance"]["inputs"][0]
    fret_eq2 = vo("E = R0^6 / (R0^6 + r^6)", "", fret_in["source"])
    fret_eq3 = vo("E = n_A R0^6 / (n_A R0^6 + r^6) for n_A acceptors at distance r", "",
                  fret_in["source"].replace("Eq. (2)", "Eq. (3)"))
    pib = vo("E_n = n^2 h^2 / (8 m L^2), psi_n(x) = sqrt(2/L) sin(n pi x / L), n = 1, 2, 3, ...", "", GRIFFITHS,
             note="a one-dimensional model of confinement, used here without units")
    dot_material = missing("", f"{LONG}; specs.json qd_renin.qd_model_and_emission",
                           note="the abstract states neither the dot's material nor its size, so the box has no "
                                "length or energy unit")
    r0 = missing("nm", LONG, note="the Förster radius for the paper's dot and Cy5 is not stated: distances stay in "
                                  "units of R0")
    n_acc = missing("", f"{LONG} (abstract: 'multiple' Cy5-labelled substrates per dot)",
                    note="the count per dot is not stated, so n is a dimensionless explorer")
    probe = qd_sp["probe"]
    eff = next(s for s in fret_rec["series"] if s["name"] == "FRET efficiency")
    rec_src = (f"{fret_rec['meta']['sources'][0]}; {fret_rec['meta']['paper']}; {fret_rec['meta']['label']}")
    points = []
    for p, e in zip(fret_rec["x"]["values"], eff["values"]):
        e_vo = vo(e, "%", rec_src, tag="recorded")
        r_vo = calc(rnd((1 / (e / 100) - 1) ** (1 / 6), 8), "r/R0", [e_vo], "r/R0 = (1/E - 1)^(1/6) (Eq. 2 inverted, "
                    "one acceptor; Lean fret_inverse)", ["recorded.qd_fret_figshare5468838 FRET efficiency"])
        points.append({"pressure_GPa": p, "E": e_vo, "r_over_R0": r_vo})
    qd = {"fret_eq2": fret_eq2, "fret_eq3": fret_eq3, "particle_in_a_box": pib, "dot_material_and_size": dot_material,
          "forster_radius": r0, "acceptors_per_dot": n_acc, "probe": probe, "figshare_points": points}

    # ------------------------------------------------------------------ graphite / carbon dot
    a_g = vo(2.464, "Å", f"{COD_GRAPHITE}: _cell_length_a 2.464", note="natural crystals (COD title note); the CIF "
             "gives no measurement temperature")
    c_g = vo(6.711, "Å", f"{COD_GRAPHITE}: _cell_length_c 6.711")
    g_struct = vo("hexagonal, P6_3/mmc (No. 194), AB (Bernal) stacking: C1 at (0, 0, 1/4), C2 at (1/3, 2/3, 1/4) and "
                  "their symmetry copies; Z = 4", "", f"{COD_GRAPHITE}: _space_group_IT_number 194, atom sites")
    d002 = calc(rnd(c_g["value"] / 2), "Å", [c_g], "layer spacing d(002) = c/2", ["graphite.c"])
    cc_g = calc(rnd(a_g["value"] / math.sqrt(3)), "Å", [a_g, g_struct], "in-plane C-C = a / sqrt3", ["graphite.a",
                "graphite.structure"])
    d100 = calc(rnd(a_g["value"] * math.sqrt(3) / 2), "Å", [a_g], "d(100) = a sqrt3 / 2 (hexagonal d_hk0)",
                ["graphite.a"], note_extra="the in-plane fringe spacing often reported in TEM of carbon dots; here it is "
                "graphite's value, not a measurement on the patch's dots")
    fringe = missing("Å", f"{TABATABAEE} (abstract)", status="NOT_YET_EXTRACTED",
                     note="the abstract gives no TEM lattice fringes or dot size; the full text and SI are paywalled "
                          "(SI request returned HTTP 403 on 2026-11-15). The scene uses graphite's lattice instead.")
    dot_size = missing("nm", f"{TABATABAEE} (abstract)", status="NOT_YET_EXTRACTED",
                       note="not in the abstract; the drawn fragment's extent is a display choice")
    graphite = {"a": a_g, "c": c_g, "structure": g_struct, "layer_spacing_d002": d002, "cc_in_plane": cc_g,
                "d100": d100, "patch_dot_lattice_fringe": fringe, "patch_dot_size": dot_size}

    pal = next(c for c in palette["colours"] if c["device"] == "cqd_patch" and c["wavelength"]["value"] == 439)
    q = physics["cqd_quenching"]
    cqd = {
        "mechanism": vo("selective recovery of quenched fluorescence of the carbon-quantum-dot tattoo upon the blue light "
                        "used for jaundice phototherapy, used for bilirubin sensing", "", f"{TABATABAEE}, abstract"),
        "quenching_model": missing("", f"physics.json cqd_quenching: {'; '.join(q['missing_inputs'])}",
                                   note="not public, so quenching and recovery are shown only as on/off states"),
        "physics_label": specs["cqd_patch"]["physics_label"],
        "emission_wavelength": pal["wavelength"], "emission_colour": pal["colour"],
    }

    # ------------------------------------------------------------------ atom radii drawn
    radii = {
        "carbon_sp3": vo(0.76, "Å", f"{CORDERO}; {PERIODICTABLE}: 'Csp3 0.76 (uncertainty 0.01)'", status="TO_CONFIRM",
                         note="checked against the package's transcription, not the paywalled article"),
        "carbon_sp2": vo(0.73, "Å", f"{CORDERO}; {PERIODICTABLE}: 'Csp2 0.73 (uncertainty 0.02)'", status="TO_CONFIRM",
                         note="checked against the package's transcription, not the paywalled article"),
        "nitrogen": vo(0.71, "Å", f"{CORDERO}; {PERIODICTABLE}: 'N 0.71 (uncertainty 0.01)'", status="TO_CONFIRM",
                       note="checked against the package's transcription, not the paywalled article"),
        "oxygen": vo(0.66, "Å", f"{CORDERO}; {PERIODICTABLE}: 'O 0.66 (uncertainty 0.02)'", status="TO_CONFIRM",
                     note="checked against the package's transcription, not the paywalled article"),
        "hydrogen": vo(0.31, "Å", f"{CORDERO}; {PERIODICTABLE}: 'H 0.31 (uncertainty 0.05)'", status="TO_CONFIRM",
                       note="checked against the package's transcription, not the paywalled article"),
        "rubidium_vdw": r_vdw,
    }
    jmol = ("Jmol element colours (CPK), https://jmol.sourceforge.net/jscolors/jmol_constants.js, 'as defined in "
            "JmolConstants.java (rev. 14469, Jmol 12.1.15)', elemParams")
    cpk = {el: vo(f"#{hexv.lower()}", "sRGB hex", f"{jmol}[{z}] = ['{el}', '{hexv}', ...]", note="a display convention")
           for el, z, hexv in (("H", 1, "FFFFFF"), ("C", 6, "909090"), ("N", 7, "3050F8"), ("O", 8, "FF0D0D"),
                               ("Rb", 37, "702EB0"))}
    theme = vo({"ink": "#e1e5d6", "muted": "#8e9684", "accent": "#a9d48c", "background": "#23271f"}, "sRGB hex",
               "SpinDrift UI theme from the project brief; ink, muted and accent equal ui/style.css --ink, --muted, --acc",
               note="used only for diagrams, axes, labels and for elements whose emission colour is not cited; never "
                    "as a wavelength colour")

    # ------------------------------------------------------------------ self-checks (Python vs Wolfram, physics)
    rng = random.Random(2026)
    worst = 0.0
    for _ in range(2000):
        w = [rng.uniform(-5, 5) for _ in range(3)]
        n2 = sum(x * x for x in w)
        P = [(w[1] + w[2] * w[0]) / (1 + n2), (-w[0] + w[1] * w[2]) / (1 + n2), (1 + w[2] ** 2) / (1 + n2)]
        wxp = [w[1] * P[2] - w[2] * P[1], w[2] * P[0] - w[0] * P[2], w[0] * P[1] - w[1] * P[0]]
        res = [(0, 0, 1)[i] - P[i] + wxp[i] for i in range(3)]
        worst = max(worst, max(abs(x) for x in res))
    if worst > 1e-12:
        raise SystemExit(f"steady state fails the Bloch equation: residual {worst}")
    split_worst = 0.0
    for B in [i * 0.01 for i in range(501)]:
        up, dn = D_nv["value"] + gamma_nv["value"] * B, D_nv["value"] - gamma_nv["value"] * B
        split_worst = max(split_worst, abs((up - dn) - 2 * gamma_nv["value"] * B), abs((up + dn) / 2 - D_nv["value"]))
    if split_worst > 1e-9:
        raise SystemExit(f"level splitting check failed: {split_worst}")
    agree("diamond_bond_A", bond["value"], WOLFRAM["diamond_bond_A"])
    agree("tetrahedral_angle_deg", angle["value"], WOLFRAM["tetrahedral_angle_deg"])
    agree("spin_tilt_deg", s_tilt["value"], WOLFRAM["spin_tilt_deg"])
    agree("spin_length", s_len["value"], WOLFRAM["spin_length"])
    agree("gF2", gF2x["value"], WOLFRAM["gF2"])
    agree("gF1", gF1x["value"], WOLFRAM["gF1"])
    agree("zeeman_F2_Hz_per_nT", zee2["value"], WOLFRAM["zeeman_F2_Hz_per_nT"])
    agree("gamma_barry_MHz_per_mT", gamma_barry["value"], WOLFRAM["gamma_barry_MHz_per_mT"], rel=1e-7)
    agree("gamma_vs_codata", gamma_vs_codata["value"], WOLFRAM["gamma_vs_codata"], rel=1e-5)
    agree("hfs_2A_GHz", hfs_check["value"], WOLFRAM["hfs_2A_GHz"])
    agree("hfs_fig3", hfs["value"], WOLFRAM["hfs_2A_GHz"], rel=1e-14)
    agree("rb_spacing_nm", spacing["value"], WOLFRAM["rb_spacing_nm"])
    agree("fret_inverse", [p["r_over_R0"]["value"] for p in points], WOLFRAM["fret_inverse"], rel=1e-7)
    agree("gslac_mT", gslac["value"], WOLFRAM["gslac_mT"])
    agree("graphite", [d002["value"], cc_g["value"], d100["value"]], WOLFRAM["graphite"])
    checks = {
        "tool": "Wolfram Language (WolframLanguageEvaluator via the Wolfram MCP connector), run 2026-11-15",
        "code": WOLFRAM_CODE, "wolfram_output": WOLFRAM,
        "python_agrees": True,
        "bloch_steady_state": {"what": "|z - P* + w x P*| for 2000 random w in [-5, 5]^3", "max_residual": worst,
                               "symbolic": WOLFRAM["steady_state_residual"]},
        "nv_splitting": {"what": "|(nu+ - nu-) - 2 gamma B| and |(nu+ + nu-)/2 - D| for B = 0 to 5 mT in 0.01 mT steps",
                         "max_residual_MHz": split_worst, "lean": ["nv_splitting", "nv_centre"]},
        "tag": "calculated",
    }

    obj = {
        "meta": meta(False, [STECK, CODATA, HOLLOWAY, COD_RILEY, COD_HOUBEN, COD_GRAPHITE, BARRY, SULAI, MANTINA,
                             CORDERO, GRIFFITHS, LONG, TABATABAEE, QUSPIN_TECH, fret_in["source"],
                             fret_rec["meta"]["sources"][0]],
                     accessed=ACCESSED, used_by=["ui/scale/q_nv.js", "ui/scale/q_rb.js", "ui/scale/q_qd.js",
                                                 "ui/scale/q_cqd.js"]),
        "electron": electron, "diamond": diamond, "nv": nv, "rb87": rb87, "opm_model": opm_model, "qd": qd,
        "graphite": graphite, "cqd": cqd, "radii": radii, "cpk_colours": cpk, "theme_colours": theme, "checks": checks,
        "note": "Values with tag calculated carry their formula and inputs. Display choices made by the scenes (slow-down "
                "factors, magnified level spacings, sphere-size fractions, arrow lengths) are not constants and are "
                "stated in each scene's info panel.",
    }
    write_json(OUT, obj)
    n_vo = sum(1 for _ in _walk(obj))
    print(f"wrote {OUT.relative_to(DATA.parent)}: {n_vo} value objects")
    print(f"  diamond a = {a_d['value']} Å, C-C = {bond['value']} Å; NV D = {D_nv['value']} MHz, gamma = "
          f"{gamma_nv['value']} MHz/mT (CODATA gamma_e/2pi = {gamma_e_mT['value']} MHz/mT)")
    print(f"  87Rb D1 {lam_d1['value']} nm, HFS {hfs['value']} GHz, g_F(2) {gF2x['value']}, g_F(1) {gF1x['value']}, "
          f"r_vdW {r_vdw['value']} Å, spacing at 1e14 cm^-3 {spacing['value']} nm")
    print(f"  graphite a {a_g['value']} c {c_g['value']} -> d002 {d002['value']} C-C {cc_g['value']} d100 {d100['value']} Å")
    print(f"  checks: Bloch residual max {worst:.2e}; splitting residual max {split_worst:.2e} MHz; Python = Wolfram")
    log_status("data/quantum_constants.json", "done", f"{n_vo} value objects for the quantum scenes (Steck rev 2.3.4, "
               "CODATA 2022, Holloway 1991, COD graphite/diamond, Barry, Sulai, Mantina); Bloch residual "
               f"{worst:.1e}, Python = Wolfram")


def _walk(o):
    if isinstance(o, dict):
        if {"value", "unit", "source", "tag", "status"} <= set(o):
            yield o
            return
        for v in o.values():
            yield from _walk(v)
    elif isinstance(o, list):
        for v in o:
            yield from _walk(v)


if __name__ == "__main__":
    main()
