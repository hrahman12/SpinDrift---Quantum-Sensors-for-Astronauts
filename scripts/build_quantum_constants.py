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

Nuclei (ui/scale/q_nucleus.js), the one part of this script that uses the network: the root-mean-square charge radii
of 87Rb and 14N are read at build time from the IAEA Nuclear Data Section's nuclear charge radii database
(https://www-nds.iaea.org/radii/charge_radii.csv; Angeli & Marinova, At. Data Nucl. Data Tables 99, 69 (2013)) and
cross-checked against the IAEA Live Chart of Nuclides API, whose guide names Angeli & Marinova 2013 as the source of
its charge-radius field; the 14N spin is the API's J-pi (ENSDF). The 2.16 MHz 14N hyperfine splitting of the NV
centre is checked as a quote in the arXiv full texts of Omar et al. and Barry et al. The SHA256 of every file received
is recorded. If a fetch fails, the values of the last successful run are kept as they were (with their own SHA256 and
fetch time); if there is none, the entry is null and the nucleus scene draws nothing.
"""
import csv
import hashlib
import html
import io
import json
import math
import random
import re
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.common import DATA, RECORDED, calc, log_status, meta, missing, now_iso, read_json, vo, write_json  # noqa: E402

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
ANGELI = ("Angeli & Marinova, 'Table of experimental nuclear ground state charge radii: An update', At. Data Nucl. "
          "Data Tables 99, 69-95 (2013), doi:10.1016/j.adt.2011.12.006")
IAEA_RADII = "IAEA Nuclear Data Section, nuclear charge radii database, https://www-nds.iaea.org/radii/"
IAEA_RADII_CSV = "https://www-nds.iaea.org/radii/charge_radii.csv"
IAEA_LIVECHART = "https://nds.iaea.org/relnsd/v1/data?fields=ground_states&nuclides={}"
IAEA_GUIDE = "https://www-nds.iaea.org/relnsd/vcharthtml/api_v0_guide.html"
IAEA_UA = "Livechart/1.0"   # the user agent the IAEA API guide tells automated clients to send
OMAR_HTML = "https://arxiv.org/html/2601.18843v1"
BARRY_HTML = "https://arxiv.org/html/1903.08176v2"
NUCLIDES = {
    "rb87": {"z": 37, "a": 87, "symbol": "Rb", "api": "87rb", "name": "rubidium-87", "site": "brain"},
    "n14": {"z": 7, "a": 14, "symbol": "N", "api": "14n", "name": "nitrogen-14", "site": "heart"},
}

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
# Second Wolfram Language run (same connector, 2026-11-15) for the nucleus scene. Its inputs are the radii the IAEA
# file gave on that day; if a later fetch returns other radii the ratios are recomputed here and marked as not
# cross-checked.
WOLFRAM_NUCLEI_CODE = (
    "rRb = 4.1989; rN = 2.5582; a = 3.56715; tilt[i_] := ArcCos[i/Sqrt[i (i + 1)]]/Degree;\n"
    "<| rb87_vdw_over_rms -> (3.03*10^5)/rRb, n14_covalent_over_rms -> (0.71*10^5)/rN,\n"
    "   n14_nv_distance_over_rms -> (Sqrt[3]/4 a 10^5)/rN, spin_tilt_I_3_2_deg -> N[tilt[3/2], 16],\n"
    "   spin_length_I_3_2 -> N[Sqrt[(3/2)(5/2)], 16], spin_tilt_I_1_deg -> N[tilt[1], 16],\n"
    "   spin_length_I_1 -> N[Sqrt[2], 16], n14_hyperfine_lines -> 2*1 + 1 |>")
WOLFRAM_NUCLEI_INPUTS = {"rb87": 4.1989, "n14": 2.5582}
# Third Wolfram Language run (same connector, 2026-11-15) for the motion and light values; inputs are the values the
# fetched files gave on that day (checked only while they are unchanged).
WOLFRAM_MOTION_CODE = (
    "hbar = 6.62607015*^-34/(2 Pi); kB = 1.380649*^-23; u = 1.66053906892*^-27;\n"
    "w = w /. FindRoot[hbar/(2 12 u w) Coth[hbar w/(2 kB 293)] == 0.00171*^-20, {w, 1.5*^14}, WorkingPrecision -> 30];\n"
    "nstar = Sqrt[10973731.568157/100/33690.80480]; a0 = 5.29177210544*^-11;\n"
    "<| diamond_einstein_THz -> w/(2 Pi)/10^12, n_star -> nstar, r_mp_nm -> nstar^2 a0 10^9,\n"
    "   r_mean_nm -> nstar (2 nstar + 1)/2 a0 10^9, v_mean_ms -> Sqrt[8 kB (150 + 273.15)/(Pi 1.44316089500*^-25)],\n"
    "   n14_larmor_MHz_T -> 0.403573 7.6225932188, rb87_larmor_mu_MHz_T -> 2.75129/1.5 7.6225932188,\n"
    "   rb87_larmor_gI_MHz_T -> 0.0009951414 13996.2449171, hc_eV_nm -> 6.62607015*^-34 299792458/1.602176634*^-19 10^9 |>")
WOLFRAM_MOTION_INPUTS = {"diamond_u_iso": 0.00171, "diamond_temperature": 293.0, "ionization_limit": 33690.8048,
                         "rydberg": 10973731.568157, "bohr_radius": 5.29177210544e-11, "atomic_mass_kg": 1.44316089500e-25,
                         "atomic_mass_constant": 1.66053906892e-27, "n14_mu": 0.403573, "rb87_mu": 2.75129,
                         "nuclear_magneton_over_h": 7.6225932188}
WOLFRAM_MOTION = {"diamond_einstein_THz": 25.408173782846, "n_star": 1.8047683805871455, "r_mp_nm": 0.1723630140321242,
                  "r_mean_nm": 0.22011512889798007, "v_mean_ms": 321.07130622778715,
                  "n14_larmor_MHz_T": 3.0762728130907724, "rb87_larmor_mu_MHz_T": 13.981309664634834,
                  "rb87_larmor_gI_MHz_T": 13.92824276154578, "hc_eV_nm": 1239.8419843320025}
WOLFRAM_NUCLEI = {
    "rb87_vdw_over_rms": 72161.75665055134,
    "n14_covalent_over_rms": 27753.889453522013,
    "n14_nv_distance_over_rms": 60379.22209189392,
    "spin_tilt_I_3_2_deg": 39.23152048359226,
    "spin_length_I_3_2": 1.9364916731037085,
    "spin_tilt_I_1_deg": 45.0,
    "spin_length_I_1": 1.4142135623730951,
    "n14_hyperfine_lines": 3,
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


# ---------------------------------------------------------------------------------------------------- downloads
FETCHED = {}        # url -> {"sha256", "fetched", "bytes"} of the bytes received in this run
FETCH_ERRORS = {}   # url -> error text
RAW = {}            # url -> bytes received in this run (so a page is read once)


def fetch(url, user_agent=None, timeout=90):
    """One GET. Returns the bytes, or None after recording the error. A refusal is recorded, never worked around."""
    if url in RAW:
        return RAW[url]
    headers = {"User-Agent": user_agent} if user_agent else {}
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as r:
            body = r.read()
    except Exception as e:  # noqa: BLE001 - a failed fetch keeps the last verified values or leaves the entry null
        FETCH_ERRORS[url] = f"{type(e).__name__}: {e}"
        return None
    FETCHED[url] = {"sha256": hashlib.sha256(body).hexdigest(), "fetched": now_iso(), "bytes": len(body)}
    RAW[url] = body
    return body


def plain(raw):
    """Readable text of an HTML page: scripts, styles, TeX annotations and tags removed, whitespace collapsed."""
    t = raw.decode("utf-8", "replace")
    t = re.sub(r"(?is)<annotation-xml\b.*?</annotation-xml>", " ", t)
    t = re.sub(r"(?is)<(script|style|annotation)\b.*?</\1>", " ", t)
    t = re.sub(r"(?s)<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", html.unescape(t))


def at(url):
    f = FETCHED[url]
    return f"{url} (SHA256 {f['sha256']}, fetched {f['fetched']})"


def spin_from_jp(jp):
    """'3/2-' -> 1.5, '1+' -> 1.0 (ENSDF J-pi of a firmly assigned ground state)."""
    m = re.fullmatch(r"(\d+)(?:/(\d+))?[+-]", (jp or "").strip())
    return int(m.group(1)) / int(m.group(2) or 1) if m else None


def verified(v):
    return isinstance(v, dict) and v.get("status") == "VERIFIED" and v.get("value") is not None


# ---------------------------------------------------------------------------------------------- motion and light
# Sources read at build time for the moving parts of the deepest scenes (thermal vibration, Larmor precession, the
# rubidium valence electron, the NV optical cycle, the OPM's resonance width). Each value is parsed from the file
# received; a failed fetch keeps the last verified value, else the entry is null and the scene does not animate it.
NIST_URL = "https://physics.nist.gov/cgi-bin/cuu/Value?{}"
WEB_UA = "Mozilla/5.0 (compatible; SpinDrift data build script)"
STECK_PDF = "https://steck.us/alkalidata/rubidium87numbers.pdf"
COD_CIF = "https://www.crystallography.net/cod/{}.cif"
QUSPIN_URL = "https://quspin.com/technology/"
H_SI, K_SI, E_SI, C_SI = 6.62607015e-34, 1.380649e-23, 1.602176634e-19, 299792458.0
SI_EXACT = ("SI defining constants, exact since 20 May 2019 (BIPM, The International System of Units, 9th ed., 2019): "
            "h = 6.626 070 15 x 10^-34 J s, k = 1.380 649 x 10^-23 J/K, e = 1.602 176 634 x 10^-19 C, "
            "c = 299 792 458 m/s")
BATES = ("Bates & Damgaard, 'The calculation of the absolute strengths of spectral lines', Phil. Trans. R. Soc. "
         "Lond. A 242, 101-122 (1949), doi:10.1098/rsta.1949.0006 (Coulomb approximation)")
KEPT = []           # entries kept from the last successful run because a fetch failed


def keep_or_missing(prev, key, unit, source, why):
    if verified(prev):
        KEPT.append(key)
        return prev
    return missing(unit, source, status="NOT_YET_EXTRACTED", note=f"not read in this run ({why}); not drawn")


def nist_value(prev, key, code, name, unit):
    url = NIST_URL.format(code)
    raw = fetch(url, WEB_UA)
    m = re.search(r"Numerical value\s+([0-9][0-9 ]*(?:\.[0-9 ]*)?)(\.\.\.)?\s*(?:x\s*10\s*(-?\s*\d+))?\s+(.{1,24}?)\s+"
                  r"Standard uncertainty\s+(\(exact\)|[0-9][0-9 .]*)", plain(raw)) if raw else None
    if not m:
        return keep_or_missing(prev, f"codata.{key}", unit, f"{CODATA}, '{name}', {url}",
                               FETCH_ERRORS.get(url, "value not found on the page"))
    val = float(m.group(1).replace(" ", "")) * 10 ** int((m.group(3) or "0").replace(" ", ""))
    return vo(float(f"{val:.15g}"), unit, f"{CODATA}, '{name}': '{re.sub(r'\s+', ' ', m.group(0))}', {at(url)}",
              note="exact by definition" if m.group(5) == "(exact)" else None)


def einstein_omega(u2_m2, mass_kg, T):
    """Angular frequency of a quantum harmonic oscillator whose mean-square displacement per direction is u2 at T:
    <u^2> = hbar / (2 m w) coth(hbar w / (2 k T)), solved by bisection (the right side falls with w)."""
    hbar = H_SI / (2 * math.pi)
    f = lambda w: hbar / (2 * mass_kg * w) / math.tanh(hbar * w / (2 * K_SI * T)) - u2_m2  # noqa: E731
    lo, hi = 1e10, 1e16
    for _ in range(200):
        mid = math.sqrt(lo * hi)
        lo, hi = (mid, hi) if f(mid) > 0 else (lo, mid)
    return math.sqrt(lo * hi)


def build_extra(prev, rb87, opm_model, specs):
    """New blocks: codata (more constants), si (exact), motion (thermal vibration), rb87 additions (valence electron,
    thermal speed), opm_model additions (resonance width), nv_optics (the NV optical cycle)."""
    prev = prev or {}
    pc, pr, po, pm, pn = (prev.get(k) or {} for k in ("codata", "rb87", "opm_model", "motion", "nv_optics"))
    # ------------------------------------------------------------------ CODATA 2022 (NIST pages) and exact SI values
    codata = {
        "nuclear_magneton_over_h": nist_value(pc.get("nuclear_magneton_over_h"), "nuclear_magneton_over_h", "munshhz",
                                              "nuclear magneton in MHz/T", "MHz/T"),
        "rydberg": nist_value(pc.get("rydberg"), "rydberg", "ryd", "Rydberg constant", "m^-1"),
        "bohr_radius": nist_value(pc.get("bohr_radius"), "bohr_radius", "bohrrada0", "Bohr radius", "m"),
        "atomic_mass_constant": nist_value(pc.get("atomic_mass_constant"), "atomic_mass_constant", "ukg",
                                           "atomic mass constant", "kg"),
    }
    si = {"h": vo(H_SI, "J s", SI_EXACT, note="exact"), "k": vo(K_SI, "J/K", SI_EXACT, note="exact"),
          "e": vo(E_SI, "C", SI_EXACT, note="exact"), "c": vo(C_SI, "m/s", SI_EXACT, note="exact")}
    si["hc_eV_nm"] = calc(rnd(H_SI * C_SI / E_SI * 1e9, 15), "eV nm", [si["h"], si["c"], si["e"]],
                          "h c / e (photon energy in eV = this / wavelength in nm)", ["si.h", "si.c", "si.e"])

    # ------------------------------------------------------------------ Steck rev. 2.3.4 PDF: ionization limit, mass
    raw = fetch(STECK_PDF)
    text = ""
    if raw:
        try:
            import pypdf  # noqa: PLC0415 - only this step needs it
            pdf = pypdf.PdfReader(io.BytesIO(raw))
            text = re.sub(r"\s+", " ", " ".join((p.extract_text() or "") for p in pdf.pages[:30]))
        except Exception as e:  # noqa: BLE001
            FETCH_ERRORS[STECK_PDF] = f"PDF text not read: {type(e).__name__}: {e}"
    m_ei = re.search(r"Ionization Limit EI ([\d ]+\.[\d ]+)\(\d+\) cm−1", text)
    m_ma = re.search(r"Atomic Mass m ([\d ]+\.[\d ]+)\(\d+\) u ([\d ]+\.[\d ]+)\(\d+\) × 10−25 kg", text)
    why = FETCH_ERRORS.get(STECK_PDF, "the quote was not found in the PDF text")
    E_I = (vo(float(m_ei.group(1).replace(" ", "")), "cm^-1", f"{STECK}, Table 2 (Rubidium 87 Physical Properties): "
              f"'{m_ei.group(0)}', read from {at(STECK_PDF)}") if m_ei else
           keep_or_missing(pr.get("ionization_limit"), "rb87.ionization_limit", "cm^-1", f"{STECK}, Table 2", why))
    mass = (vo(float(m_ma.group(2).replace(" ", "")) * 1e-25, "kg", f"{STECK}, Table 2: '{m_ma.group(0)}', read from "
               f"{at(STECK_PDF)}") if m_ma else
            keep_or_missing(pr.get("atomic_mass_kg"), "rb87.atomic_mass_kg", "kg", f"{STECK}, Table 2", why))
    rb_add = {"ionization_limit": E_I, "atomic_mass_kg": mass}
    # the valence 5s electron in the Coulomb approximation: radial density r^2 R(r)^2 ∝ r^(2 n*) e^(-2 r / (n* a0))
    R_inf, a0 = codata["rydberg"], codata["bohr_radius"]
    ok = all(v["value"] is not None for v in (E_I, R_inf, a0))
    n_star = math.sqrt(R_inf["value"] / 100 / E_I["value"]) if ok else None
    rb_add["valence_n_star"] = calc(rnd(n_star) if ok else None, "", [R_inf, E_I],
                                    "effective principal quantum number n* = sqrt(R_inf / E_I), both in cm^-1",
                                    ["codata.rydberg", "rb87.ionization_limit"],
                                    note_extra="the reduced-mass Rydberg of 87Rb differs from R_inf by 6 parts per "
                                               "million, which changes n* by 3 ppm (not applied)")
    rb_add["valence_density_model"] = vo(
        "radial probability density of the 5s valence electron, P(r) ∝ r^(2n*) exp(-2r / (n* a0)): the leading term "
        "of the Coulomb-approximation wavefunction outside the ion core", "", BATES, tag="calculated",
        note="the core region (36 inner electrons, inner nodes of the 5s orbital) is not modelled; spherically "
             "symmetric (an s state)")
    rb_add["valence_r_most_probable"] = calc(rnd(n_star ** 2 * a0["value"] * 1e9) if ok else None, "nm",
                                             [rb_add["valence_n_star"], a0], "peak of P(r): r = n*^2 a0",
                                             ["rb87.valence_n_star", "codata.bohr_radius"])
    rb_add["valence_r_mean"] = calc(rnd(n_star * (2 * n_star + 1) / 2 * a0["value"] * 1e9) if ok else None, "nm",
                                    [rb_add["valence_n_star"], a0], "mean of P(r): <r> = n*(2n* + 1)/2 a0",
                                    ["rb87.valence_n_star", "codata.bohr_radius"])
    T_cell = opm_model["cell_temperature"]
    okv = mass["value"] is not None
    rb_add["thermal_mean_speed"] = calc(
        rnd(math.sqrt(8 * K_SI * (T_cell["value"] + 273.15) / (math.pi * mass["value"]))) if okv else None, "m/s",
        [si["k"], T_cell, mass], "mean speed of a vapour atom sqrt(8 k T / (pi m)) at the cell temperature",
        ["si.k", "opm_model.cell_temperature", "rb87.atomic_mass_kg"],
        note_extra="Maxwell-Boltzmann mean speed; in the buffer gas the atom changes direction at every collision")

    # ------------------------------------------------------------------ QuSpin: zero-field resonance width
    raw = fetch(QUSPIN_URL, WEB_UA)
    qt = plain(raw) if raw else ""
    m_w = re.search(r"FWHM ≈ (\d+) nT", qt)
    m_t = re.search(r"typically about \d+ nT wide", qt)
    m_p = re.search(r"a perpendicular field changes the cell’s transparency", qt)
    if m_w:
        fwhm = vo(float(m_w.group(1)), "nT", f"{QUSPIN_TECH}: figure label 'ZF resonance (photodetector output) "
                  f"{m_w.group(0)}'{'; text: ' + repr(m_t.group(0)) if m_t else ''}; read from {at(QUSPIN_URL)}",
                  tag="datasheet", note="full width at half maximum of the zero-field resonance (Lorentzian)")
    else:
        fwhm = keep_or_missing(po.get("zero_field_fwhm"), "opm_model.zero_field_fwhm", "nT", QUSPIN_TECH,
                               FETCH_ERRORS.get(QUSPIN_URL, "'FWHM ≈ … nT' not found on the page"))
    opm_add = {"zero_field_fwhm": fwhm,
               "zero_field_hwhm": calc(fwhm["value"] / 2 if fwhm["value"] is not None else None, "nT", [fwhm],
                                       "half width = FWHM / 2 (Lorentzian)", ["opm_model.zero_field_fwhm"],
                                       note_extra="the field scale of Sulai's dimensionless w = Omega/Gamma' "
                                                  "(Lean opm_half_width: the resonance is at half height at w = 1)"),
               "transparency": (vo("a perpendicular field changes the cell's transparency", "", f"{QUSPIN_TECH}, "
                                   f"figure text; read from {at(QUSPIN_URL)}", tag="datasheet") if m_p else
                                keep_or_missing(po.get("transparency"), "opm_model.transparency", "", QUSPIN_TECH,
                                                "the sentence was not found on the page"))}

    # ------------------------------------------------------------------ thermal vibration (COD CIFs)
    motion = {}
    url_d = COD_CIF.format("2300702")
    raw = fetch(url_d, WEB_UA)
    t = raw.decode("utf-8", "replace") if raw else ""
    m_u = re.search(r"^C1\s+C\s+0\.12500\s+0\.12500\s+0\.12500\s+1\.000\s+Uiso\s+([\d.]+)\((\d+)\)", t, re.M)
    m_T = re.search(r"_diffrn_ambient_temperature\s+([\d.]+)", t)
    if m_u and m_T:
        motion["diamond_u_iso"] = vo(float(m_u.group(1)), "Å^2", f"{COD_HOUBEN}: atom site C1, "
                                     f"'{m_u.group(0)}', '_diffrn_ambient_temperature {m_T.group(1)}', {at(url_d)}",
                                     note=f"isotropic mean-square displacement per direction at {m_T.group(1)} K "
                                          f"(± 0.00000{m_u.group(2)} Å²)")
        motion["diamond_temperature"] = vo(float(m_T.group(1)), "K", f"{COD_HOUBEN}, {at(url_d)}")
    else:
        motion["diamond_u_iso"] = keep_or_missing(pm.get("diamond_u_iso"), "motion.diamond_u_iso", "Å^2", COD_HOUBEN,
                                                  FETCH_ERRORS.get(url_d, "Uiso not found in the CIF"))
        motion["diamond_temperature"] = keep_or_missing(pm.get("diamond_temperature"), "motion.diamond_temperature",
                                                        "K", COD_HOUBEN, "not found")
    U, Td, mu = motion["diamond_u_iso"], motion["diamond_temperature"], codata["atomic_mass_constant"]
    okd = all(v["value"] is not None for v in (U, Td, mu))
    motion["diamond_rms_displacement"] = calc(rnd(math.sqrt(U["value"])) if okd else None, "Å", [U],
                                              "root-mean-square displacement per direction = sqrt(Uiso)",
                                              ["motion.diamond_u_iso"])
    w_e = einstein_omega(U["value"] * 1e-20, 12 * mu["value"], Td["value"]) if okd else None
    motion["diamond_einstein_frequency"] = calc(
        rnd(w_e / (2 * math.pi) / 1e12) if okd else None, "THz", [U, Td, mu, si["h"], si["k"]],
        "frequency nu = omega / 2pi of a carbon-12 atom (12 u) vibrating as a quantum harmonic oscillator whose "
        "mean-square displacement hbar/(2 m omega) coth(hbar omega/(2 k T)) equals the measured Uiso at the measured T",
        ["motion.diamond_u_iso", "motion.diamond_temperature", "codata.atomic_mass_constant", "si.h", "si.k"],
        note_extra="Einstein model: one frequency for every atom; the real crystal vibrates in many modes. The scenes "
                   "use it as the rate of the drawn jiggle and keep the measured amplitude")
    url_g = COD_CIF.format("9011577")
    raw = fetch(url_g, WEB_UA)
    t = raw.decode("utf-8", "replace") if raw else ""
    rows = re.findall(r"^(C[12])\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*$", t, re.M)
    if rows:
        motion["graphite_u_aniso"] = vo({r[0]: {"U11": float(r[1]), "U22": float(r[2]), "U33": float(r[3]),
                                                "U12": float(r[4]), "U13": float(r[5]), "U23": float(r[6])} for r in rows},
                                        "Å^2", f"{COD_GRAPHITE}: _atom_site_aniso_U_11 ... _U_23 rows "
                                        f"{'; '.join(' '.join(r) for r in rows)}, {at(url_g)}",
                                        note="anisotropic displacement parameters: U33 is along c (out of the layers)")
        has_T = re.search(r"_(?:diffrn_ambient|cell_measurement)_temperature\s+([\d.]+)", t)
        motion["graphite_temperature"] = (vo(float(has_T.group(1)), "K", f"{COD_GRAPHITE}, {at(url_g)}") if has_T else
                                          missing("K", f"{COD_GRAPHITE}, {at(url_g)}", note="the CIF states no "
                                                  "measurement temperature, so no vibration frequency can be calculated "
                                                  "from these amplitudes: the graphite atoms are drawn at rest"))
    else:
        motion["graphite_u_aniso"] = keep_or_missing(pm.get("graphite_u_aniso"), "motion.graphite_u_aniso", "Å^2",
                                                     COD_GRAPHITE, FETCH_ERRORS.get(url_g, "U rows not found"))
        motion["graphite_temperature"] = pm.get("graphite_temperature") or missing("K", COD_GRAPHITE)

    # ------------------------------------------------------------------ the NV optical cycle (Barry; Omar)
    bt, ot = plain(RAW[BARRY_HTML]) if BARRY_HTML in RAW else "", plain(RAW[OMAR_HTML]) if OMAR_HTML in RAW else ""

    def quote(prev_v, key, txt, url, pattern, value, unit, where, note=None):
        m = re.search(pattern, txt)
        if m:
            return vo(value(m) if callable(value) else value, unit, f"{where}: '{m.group(0)}' (found in {at(url)})",
                      note=note)
        return keep_or_missing(prev_v, f"nv_optics.{key}", unit, where, FETCH_ERRORS.get(url, "quote not found"))
    nvo = {
        "green_excitation": quote(pn.get("green_excitation"), "green_excitation", bt, BARRY_HTML,
                                  r"a single free-running 532 nm solid-state laser is sufficient", 532, "nm",
                                  f"{BARRY}, Sec. I", note="the usual green pump; Omar et al. do not state the "
                                  "wavelength of the heart builds' lasers"),
        "zpl": quote(pn.get("zpl"), "zpl", bt, BARRY_HTML, r"zero phonon line \(ZPL\) at 637 nm", 637, "nm",
                     f"{BARRY}, Sec. on readout", note="the NV- zero-phonon line; the red glow spreads to longer "
                     "wavelengths (the ZAQuant build filters above 695 nm, palette.json)"),
        "singlet_ir": quote(pn.get("singlet_ir"), "singlet_ir", bt, BARRY_HTML, r"1 E ↔ 1 A 1 transition at 1042 nm",
                            1042, "nm", f"{BARRY}, Sec. on infrared absorption readout"),
        "singlet_lifetime": quote(pn.get("singlet_lifetime"), "singlet_lifetime", bt, BARRY_HTML,
                                  r"lifetime ∼ 140 − 220 ns at room temperature", "140–220", "ns",
                                  f"{BARRY}, Sec. on infrared absorption readout", note="lifetime of the 1E singlet"),
        "isc": quote(pn.get("isc"), "isc", bt, BARRY_HTML,
                     r"spin-state-dependent intersystem crossing \[[^\]]*\] produces both spin-state-dependent "
                     r"fluorescence contrast and optical spin initialization into the NV - center’s m s = 0 ground state",
                     "the spin-dependent intersystem crossing gives both the fluorescence contrast and the optical "
                     "initialization into m_s = 0", "", f"{BARRY}, Sec. I"),
        "zaquant_linewidth": quote(pn.get("zaquant_linewidth"), "zaquant_linewidth", ot, OMAR_HTML,
                                   r"magnetic resonance linewidth \(ZAQuant sensor: ∼ 200 kHz\)", 200, "kHz",
                                   "Omar et al., arXiv 2601.18843v1, Sec. 2", note="about 200 kHz; JGU and Q.ANT "
                                   "linewidths are not stated"),
    }
    hc = si["hc_eV_nm"]
    for key in ("green_excitation", "zpl", "singlet_ir"):
        v = nvo[key]
        nvo[f"{key}_eV"] = calc(rnd(hc["value"] / v["value"], 6) if v["value"] is not None else None, "eV", [hc, v],
                                "photon energy = hc / wavelength", ["si.hc_eV_nm", f"nv_optics.{key}"])
    return {"codata": codata, "si": si, "rb87": rb_add, "opm_model": opm_add, "motion": motion, "nv_optics": nvo}


def build_nuclei(prev, rb87, radii, n_v, specs):
    """The 87Rb and 14N nuclei for ui/scale/q_nucleus.js, plus the NV centre's 14N hyperfine entries.

    Returns (nuclei block, entries to add under "nv", checks). Nothing here is typed in except the 2.16 MHz that the
    project's NV data already cites, and that value is VERIFIED only if its quote is found in the fetched paper.
    """
    prev_n = (prev or {}).get("nuclei") or {}
    prev_nv = (prev or {}).get("nv") or {}
    kept = []

    # ------------------------------------------------------------------ IAEA: charge radii file, API guide
    raw_csv = fetch(IAEA_RADII_CSV, IAEA_UA)
    rows = list(csv.DictReader(io.StringIO(raw_csv.decode("utf-8-sig", "replace")))) if raw_csv else []
    raw_guide = fetch(IAEA_GUIDE, IAEA_UA)
    provenance = {"what": "the Live Chart API guide names the source of the API's charge-radius field", "guide": IAEA_GUIDE,
                  "radius_field_source_code": None, "source_code_AM": None, "checked": bool(raw_guide)}
    if raw_guide:
        g = raw_guide.decode("utf-8", "replace")
        f_m = re.search(r"var gs_fields\s*=\s*\((.*?)\)\.split", g, re.S)
        s_m = re.search(r"var gs_src\s*=\s*\[(.*?)\]", g, re.S)
        if f_m and s_m:
            fields = [x.strip() for x in "".join(re.findall(r'"([^"]*)"', f_m.group(1))).split(",")]
            srcs = re.findall(r"'([^']*)'", s_m.group(1))
            if "radius" in fields and fields.index("radius") < len(srcs):
                provenance["radius_field_source_code"] = srcs[fields.index("radius")]
            codes, last = {}, ""
            for fld, s in zip(fields, srcs):        # the guide marks "same source as above" with a ditto sign
                s = html.unescape(s).strip()
                last = last if s in ("”", '"') else s
                codes[fld] = last
            provenance["field_sources"] = codes
        am = re.search(r"AM: I\.Angeli, K\.P\. Marinova, Atomic Data and Nuclear Data Tables 99 \(2013\) DOI:\S+", plain(raw_guide))
        provenance["source_code_AM"] = am.group(0) if am else None
        ns = re.search(r"NS: Table of Recommended Nuclear Magnetic Dipole Moments.{0,400}?indc-nds-0833", plain(raw_guide))
        provenance["source_code_NS"] = ns.group(0) if ns else None
    guide_ok = provenance["radius_field_source_code"] == "AM" and bool(provenance["source_code_AM"])

    # ------------------------------------------------------------------ NV 14N hyperfine: quotes in the arXiv full texts
    jgu_src = specs["nv"]["jgu"]["microwave"]["source"]
    quote = ("The central microwave frequency at 2.87 GHz was mixed with a 2.16 MHz radio frequency signal to address "
             "all hyperfine level")
    raw_omar = fetch(OMAR_HTML)
    omar_found = bool(raw_omar and re.search(r"2\.87\s*GHz was mixed with a\s+2\.16\s*MHz radio frequency signal to "
                                             r"address all hyperfine level", plain(raw_omar)))
    hfs_note = ("the three 14N hyperfine lines (m_I = -1, 0, +1) of an NV resonance lie this far apart, so mixing the "
                "microwave with this frequency drives all three; the same statement is the 'microwave drive' fact in "
                "data/combined_sensor.json and data/runs.json")
    if omar_found:
        n14_hfs = vo(2.16, "MHz", f"{jgu_src}, JGU sensor: '{quote}'; quote found in {at(OMAR_HTML)}", note=hfs_note)
    elif verified(prev_nv.get("n14_hyperfine_splitting")):
        n14_hfs = prev_nv["n14_hyperfine_splitting"]
        kept.append("nv.n14_hyperfine_splitting")
    else:
        why = FETCH_ERRORS.get(OMAR_HTML, "the quote was not found in the fetched text")
        n14_hfs = vo(2.16, "MHz", f"{jgu_src}, JGU sensor: '{quote}'", status="TO_CONFIRM",
                     note=f"{hfs_note}; not checked against the paper in this run ({why})")

    raw_barry = fetch(BARRY_HTML)
    barry_text = plain(raw_barry) if raw_barry else ""
    row_m = re.search(r"14\s*N axial magnetic hyperfine constant\s*(.*?)\s*15\s*N axial magnetic hyperfine constant", barry_text)
    entries = re.findall(r"([±−+-]?)\s*(\d+\.\d+)\s*±\s*(\d+\.\d+)\s*MHz", row_m.group(1)) if row_m else []
    a_par = "; ".join(f"{s}{v} ± {u}" for s, v, u in entries)
    if entries and ("−", "2.162", "0.002") in entries:
        n14_apar = vo(a_par, "MHz", f"{BARRY}, Table 16 of the arXiv version ('Compiled constants for the electronic "
                      f"ground state of the NV- center in diamond'), row '14N axial magnetic hyperfine constant' "
                      f"(A_parallel); read from {at(BARRY_HTML)}",
                      note="the values the table compiles from five references, in the table's order and with its signs; "
                           "the most precise, −2.162 ± 0.002 MHz, has the magnitude 2.16 MHz that the JGU sensor mixes in")
    elif verified(prev_nv.get("n14_axial_hyperfine_constants")):
        n14_apar = prev_nv["n14_axial_hyperfine_constants"]
        kept.append("nv.n14_axial_hyperfine_constants")
    else:
        n14_apar = missing("MHz", f"{BARRY}, table of NV ground-state constants", status="NOT_YET_EXTRACTED",
                           note=f"not read in this run ({FETCH_ERRORS.get(BARRY_HTML, 'the table row was not found')})")
    barry_spin = bool(re.search(r"14\s*N nuclear spin I\s*=\s*1\b", barry_text))

    # ------------------------------------------------------------------ one block per nuclide
    out, ratios = {}, {}
    for key, nd in NUCLIDES.items():
        row = next((r for r in rows if r.get("z") == str(nd["z"]) and r.get("a") == str(nd["a"])), None)
        api_url = IAEA_LIVECHART.format(nd["api"])
        raw_api = fetch(api_url, IAEA_UA)
        api = next(iter(csv.DictReader(io.StringIO(raw_api.decode("latin-1")))), None) if raw_api else None
        ok_row = bool(row) and row.get("symbol") == nd["symbol"] and row.get("n") == str(nd["a"] - nd["z"])
        try:
            R, dR = (float(row["radius_val"]), float(row["radius_unc"])) if ok_row else (None, None)
        except (TypeError, ValueError):
            R = dR = None
        if not (R and R > 0 and dR and dR > 0):
            if verified((prev_n.get(key) or {}).get("rms_charge_radius")):
                out[key] = prev_n[key]                       # last successful run, with its own SHA256 and fetch time
                kept.append(f"nuclei.{key}")
                continue
            why = FETCH_ERRORS.get(IAEA_RADII_CSV, f"no usable row for z={nd['z']}, a={nd['a']} in the file")
            gone = missing("fm", f"{ANGELI}; {IAEA_RADII}", status="NOT_YET_EXTRACTED",
                           note=f"not fetched ({why}); the scene draws no sphere without this value")
            out[key] = {"id": key, "name": nd["name"], "symbol": nd["symbol"], "site": nd["site"],
                        "rms_charge_radius": gone}
            continue

        csv_src = (f"{ANGELI}, as served by the {IAEA_RADII}: file {at(IAEA_RADII_CSV)}, row z={row['z']}, "
                   f"symbol={row['symbol']}, n={row['n']}, a={row['a']}: radius_val={row['radius_val']}, "
                   f"radius_unc={row['radius_unc']}")
        api_same = None
        if api and (api.get("radius") or "").strip():
            api_same = (api["z"] == row["z"] and api["n"] == row["n"] and float(api["radius"]) == R
                        and float(api["unc_r"]) == dR)
            if not api_same:
                raise SystemExit(f"{key}: IAEA radii file ({R} ± {dR} fm) and Live Chart API ({api['radius']} ± "
                                 f"{api['unc_r']} fm) disagree")
        status = "VERIFIED" if api_same else "TO_CONFIRM"
        cross = (f"cross-check: the IAEA Live Chart of Nuclides API, {at(api_url)}, gives radius {api['radius']} ± "
                 f"{api['unc_r']} fm for z={api['z']}, n={api['n']}"
                 + (f", and its guide ({IAEA_GUIDE}) gives the source of that field as '{provenance['source_code_AM']}'"
                    if guide_ok else "")
                 if api_same else f"cross-check with the Live Chart API not done ({FETCH_ERRORS.get(api_url, 'no radius in its answer')})")
        R_vo = vo(R, "fm", csv_src, status=status,
                  note=f"root-mean-square nuclear charge radius R = <r^2>^(1/2), ± {row['radius_unc']} fm; {cross}. "
                       "The database's HTML page answers automated requests with a browser check; it was not read and "
                       "the check was not bypassed. The nucleus has no sharp surface: this is the rms radius of its "
                       "charge distribution.")
        dR_vo = vo(dR, "fm", csv_src, status=status, note="uncertainty of the rms charge radius as tabulated (radius_unc)")
        Z = vo(int(row["z"]), "", csv_src, note="number of protons")
        N = vo(int(row["n"]), "", csv_src, note="number of neutrons")
        A = vo(int(row["a"]), "", csv_src, note="mass number A = Z + N")

        jp = ((api or {}).get("jp") or "").strip()
        if jp:
            jp_src = (f"IAEA Live Chart of Nuclides API, {at(api_url)}, field jp = '{jp}' (J-pi; source ENSDF per "
                      f"{IAEA_GUIDE}); ENSDF evaluation by {api.get('ENSDFauthors', '?')}, publication cut-off "
                      f"{api.get('ENSDFpublicationcut-off', '?')}, as stated in the row")
            jp_vo = vo(jp, "", jp_src, note="ground-state spin and parity")
        else:
            jp_vo = missing("", f"IAEA Live Chart of Nuclides API, {api_url}", status="NOT_YET_EXTRACTED",
                            note=f"not fetched ({FETCH_ERRORS.get(api_url, 'no jp in its answer')})")
        if key == "rb87":
            I = rb87["nuclear_spin"]                         # Steck Table 2
            if jp and spin_from_jp(jp) != I["value"]:
                raise SystemExit(f"87Rb: Steck I = {I['value']} but ENSDF J-pi = {jp}")
        elif jp and spin_from_jp(jp) is not None:
            I = vo(spin_from_jp(jp), "", jp_src,
                   note=f"nuclear spin I read from the ground-state J-pi = {jp}"
                        + (f"; also {BARRY}, Fig. 12 caption of the arXiv version: 'The three peaks arise from hyperfine "
                           f"interactions associated with the NV- center's 14N nuclear spin I = 1' (found in "
                           f"{at(BARRY_HTML)})" if barry_spin else ""))
        else:
            I = missing("", f"IAEA Live Chart of Nuclides API, {api_url}", status="NOT_YET_EXTRACTED",
                        note="the J-pi of the ground state was not fetched")
        i = I["value"]
        tilt = calc(rnd(math.degrees(math.acos(i / math.sqrt(i * (i + 1))))) if i else None, "°", [I],
                    "vector model of the state m_I = I: tilt from the axis = arccos(I / sqrt(I(I+1)))",
                    [f"nuclei.{key}.nuclear_spin"], note_extra="a semiclassical picture; the scene's arrow uses it")
        length = calc(rnd(math.sqrt(i * (i + 1))) if i else None, "", [I], "|I| = sqrt(I(I+1)) (units of hbar)",
                      [f"nuclei.{key}.nuclear_spin"])
        block = {"id": key, "name": nd["name"], "symbol": nd["symbol"], "site": nd["site"], "protons": Z, "neutrons": N,
                 "mass_number": A, "rms_charge_radius": R_vo, "rms_charge_radius_uncertainty": dR_vo,
                 "spin_parity": jp_vo, "nuclear_spin": I, "spin_tilt": tilt, "spin_length": length}
        # measured moments, from the same Live Chart row (the guide names their sources)
        fsrc = provenance.get("field_sources") or {}
        for fld, unc, unit, what in (("magnetic_dipole", "unc_md", "μN", "nuclear magnetic dipole moment, in nuclear magnetons"),
                                     ("electric_quadrupole", "unc_eq", "b", "spectroscopic electric quadrupole moment, in barn")):
            val = ((api or {}).get(fld) or "").strip()
            try:
                num_val = float(val)
            except ValueError:
                num_val = None
            if num_val is not None:
                block[fld] = vo(num_val, unit, f"IAEA Live Chart of Nuclides API, {at(api_url)}, field {fld} = {val} ± "
                                f"{(api.get(unc) or '?').strip()} (source code '{fsrc.get(fld, '?')}' in the API guide"
                                + (f": {provenance['source_code_NS']}" if provenance.get("source_code_NS") else "") + ")",
                                note=what)
            else:
                block[fld] = missing(unit, f"IAEA Live Chart of Nuclides API, {api_url}", status="NOT_YET_EXTRACTED",
                                     note=f"{what}: not fetched")
        if key == "rb87":
            ratios["rb87_vdw_over_rms"] = rnd(rb87["vdw_radius"]["value"] * 1e5 / R)
            block["atom_over_nucleus"] = calc(
                ratios["rb87_vdw_over_rms"], "", [rb87["vdw_radius"], R_vo],
                "van der Waals radius / rms charge radius, with 1 Å = 1e5 fm", ["rb87.vdw_radius", "nuclei.rb87.rms_charge_radius"],
                note_extra="how many times larger the atom drawn in q_rb is than this sphere")
            block["hyperfine"] = {
                "what": "coupling of the nuclear spin I to the spin of the outer electron (J = 1/2) in the 5²S1/2 ground state",
                "splitting": rb87["ground_hfs_splitting"], "constant_A": rb87["ground_hfs_constant_A"],
                "levels": calc("F = 1 and F = 2", "", [I], "F runs from |I - J| to I + J with J = 1/2",
                               ["rb87.nuclear_spin"], note_extra="the two ground levels of Steck Fig. 3"),
            }
        else:
            ratios["n14_covalent_over_rms"] = rnd(radii["nitrogen"]["value"] * 1e5 / R)
            ratios["n14_nv_distance_over_rms"] = rnd(n_v["value"] * 1e5 / R)
            block["atom_over_nucleus"] = calc(
                ratios["n14_covalent_over_rms"], "", [radii["nitrogen"], R_vo],
                "covalent radius / rms charge radius, with 1 Å = 1e5 fm", ["radii.nitrogen", "nuclei.n14.rms_charge_radius"],
                note_extra="how many times larger the nitrogen atom's covalent radius (q_nv) is than this sphere")
            block["nv_distance_over_nucleus"] = calc(
                ratios["n14_nv_distance_over_rms"], "", [n_v, R_vo],
                "N-V distance (ideal lattice sites) / rms charge radius, with 1 Å = 1e5 fm",
                ["nv.n_v_distance", "nuclei.n14.rms_charge_radius"])
            block["hyperfine"] = {
                "what": "coupling of the 14N nuclear spin to the NV centre's electron spin (ground state)",
                "splitting": n14_hfs, "axial_constants": n14_apar,
                "lines": calc(int(2 * i + 1) if i else None, "", [I], "2I + 1 values of m_I", ["nuclei.n14.nuclear_spin"],
                              note_extra="each NV resonance splits into this many lines"),
            }
        out[key] = block

    # ------------------------------------------------------------------ Python against the recorded Wolfram run
    checked, skipped = [], []
    for key in NUCLIDES:
        b = out[key]
        if f"nuclei.{key}" in kept or not b.get("spin_tilt"):
            continue
        suffix = "I_3_2" if key == "rb87" else "I_1"
        if b["spin_tilt"]["value"] is not None:
            agree(f"spin_tilt_{suffix}_deg", b["spin_tilt"]["value"], WOLFRAM_NUCLEI[f"spin_tilt_{suffix}_deg"])
            agree(f"spin_length_{suffix}", b["spin_length"]["value"], WOLFRAM_NUCLEI[f"spin_length_{suffix}"])
            checked += [f"spin_tilt_{suffix}_deg", f"spin_length_{suffix}"]
        names = [n for n in ratios if n.startswith(key)]
        if b["rms_charge_radius"]["value"] == WOLFRAM_NUCLEI_INPUTS[key]:
            for n in names:
                agree(n, ratios[n], WOLFRAM_NUCLEI[n])
            checked += names
        else:
            skipped += names                                 # the IAEA value changed since the Wolfram run
    lines = ((out.get("n14") or {}).get("hyperfine") or {}).get("lines")
    if lines and lines["value"] is not None:
        agree("n14_hyperfine_lines", lines["value"], WOLFRAM_NUCLEI["n14_hyperfine_lines"])
        checked.append("n14_hyperfine_lines")

    used = [IAEA_RADII_CSV, IAEA_GUIDE, OMAR_HTML, BARRY_HTML] + [IAEA_LIVECHART.format(nd["api"]) for nd in NUCLIDES.values()]
    files = {u: FETCHED[u] for u in used if u in FETCHED}
    for u, f in (prev_n.get("source_files") or {}).items():   # files behind values kept from the last successful run
        if kept and u not in files:
            files[u] = dict(f, kept_from_previous_run=True)
    out["source_files"] = files
    out["fetch_errors"] = {u: e for u, e in FETCH_ERRORS.items() if u in used}
    out["kept_from_previous_run"] = kept
    out["provenance"] = provenance
    out["not_drawn"] = ("Individual protons and neutrons are not drawn: their arrangement inside a nucleus is not a "
                        "measured geometry. The scene draws one sphere at the rms charge radius.")
    checks = {"tool": "Wolfram Language (WolframLanguageEvaluator via the Wolfram MCP connector), run 2026-11-15",
              "code": WOLFRAM_NUCLEI_CODE, "wolfram_inputs_fm": WOLFRAM_NUCLEI_INPUTS, "wolfram_output": WOLFRAM_NUCLEI,
              "python_agrees_on": checked, "not_cross_checked": skipped, "tag": "calculated"}
    return out, {"n14_hyperfine_splitting": n14_hfs, "n14_axial_hyperfine_constants": n14_apar}, checks


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

    # ------------------------------------------------------------------ nuclei (fetched: IAEA charge radii, ENSDF spin)
    prev_all = read_json(OUT)
    nuclei, nv_n14, nuclei_checks = build_nuclei(prev_all, rb87, radii, n_v, specs)
    nv.update(nv_n14)
    # ------------------------------------------------------------------ motion, light and more constants (fetched)
    extra = build_extra(prev_all, rb87, opm_model, specs)
    rb87.update(extra["rb87"])
    opm_model.update(extra["opm_model"])
    codata_more, si_exact, motion, nv_optics = extra["codata"], extra["si"], extra["motion"], extra["nv_optics"]
    # Larmor frequencies of the two nuclei (the rate a field turns a nuclear spin)
    muN = codata_more["nuclear_magneton_over_h"]
    for key in NUCLIDES:
        b = nuclei[key]
        if "magnetic_dipole" not in b:
            continue
        mu, I_n = b["magnetic_dipole"], b["nuclear_spin"]
        okl = mu["value"] is not None and I_n["value"] and muN["value"] is not None
        b["larmor_free_nucleus"] = calc(rnd(abs(mu["value"]) / I_n["value"] * muN["value"]) if okl else None, "MHz/T",
                                        [mu, I_n, muN], "gamma/2pi = |mu| / (I h) = |mu / mu_N| / I x mu_N/h",
                                        [f"nuclei.{key}.magnetic_dipole", f"nuclei.{key}.nuclear_spin",
                                         "codata.nuclear_magneton_over_h"],
                                        note_extra="a bare nucleus; in an atom or crystal the electrons change what it "
                                                   "feels (see the scene)")
    nuclei["rb87"]["larmor_with_electron_F2"] = rb87["zeeman_F2_per_nT"]   # in the atom the nucleus turns with F = 2
    nuclei["rb87"]["larmor_steck_gI"] = calc(rnd(abs(gI["value"]) * mub_h["value"] / 1e6), "MHz/T", [gI, mub_h],
                                             "|g_I| mu_B / h (Steck's g_I, which is given for the nucleus in the atom)",
                                             ["rb87.g_I", "electron.bohr_magneton_over_h"])

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
    # motion and light: Python against the recorded Wolfram run, while the fetched inputs are the ones it used
    now_in = {"diamond_u_iso": motion["diamond_u_iso"]["value"], "diamond_temperature": motion["diamond_temperature"]["value"],
              "ionization_limit": rb87["ionization_limit"]["value"], "rydberg": codata_more["rydberg"]["value"],
              "bohr_radius": codata_more["bohr_radius"]["value"], "atomic_mass_kg": rb87["atomic_mass_kg"]["value"],
              "atomic_mass_constant": codata_more["atomic_mass_constant"]["value"],
              "n14_mu": nuclei["n14"].get("magnetic_dipole", {}).get("value"),
              "rb87_mu": nuclei["rb87"].get("magnetic_dipole", {}).get("value"),
              "nuclear_magneton_over_h": muN["value"]}
    motion_same = all(now_in[k] is not None and math.isclose(now_in[k], v, rel_tol=1e-12) for k, v in WOLFRAM_MOTION_INPUTS.items())
    if motion_same:
        agree("diamond_einstein_THz", motion["diamond_einstein_frequency"]["value"], WOLFRAM_MOTION["diamond_einstein_THz"], rel=1e-8)
        agree("n_star", rb87["valence_n_star"]["value"], WOLFRAM_MOTION["n_star"])
        agree("r_mp_nm", rb87["valence_r_most_probable"]["value"], WOLFRAM_MOTION["r_mp_nm"])
        agree("r_mean_nm", rb87["valence_r_mean"]["value"], WOLFRAM_MOTION["r_mean_nm"])
        agree("v_mean_ms", rb87["thermal_mean_speed"]["value"], WOLFRAM_MOTION["v_mean_ms"])
        agree("n14_larmor_MHz_T", nuclei["n14"]["larmor_free_nucleus"]["value"], WOLFRAM_MOTION["n14_larmor_MHz_T"])
        agree("rb87_larmor_mu_MHz_T", nuclei["rb87"]["larmor_free_nucleus"]["value"], WOLFRAM_MOTION["rb87_larmor_mu_MHz_T"])
        agree("rb87_larmor_gI_MHz_T", nuclei["rb87"]["larmor_steck_gI"]["value"], WOLFRAM_MOTION["rb87_larmor_gI_MHz_T"])
        agree("hc_eV_nm", si_exact["hc_eV_nm"]["value"], WOLFRAM_MOTION["hc_eV_nm"], rel=1e-12)
    checks_motion = {"tool": "Wolfram Language (WolframLanguageEvaluator via the Wolfram MCP connector), run 2026-11-15",
                     "code": WOLFRAM_MOTION_CODE, "wolfram_inputs": WOLFRAM_MOTION_INPUTS, "wolfram_output": WOLFRAM_MOTION,
                     "python_agrees": motion_same, "tag": "calculated",
                     "note": None if motion_same else "a fetched input changed since the Wolfram run: not cross-checked"}
    checks = {
        "motion": checks_motion,
        "tool": "Wolfram Language (WolframLanguageEvaluator via the Wolfram MCP connector), run 2026-11-15",
        "code": WOLFRAM_CODE, "wolfram_output": WOLFRAM,
        "python_agrees": True,
        "bloch_steady_state": {"what": "|z - P* + w x P*| for 2000 random w in [-5, 5]^3", "max_residual": worst,
                               "symbolic": WOLFRAM["steady_state_residual"]},
        "nv_splitting": {"what": "|(nu+ - nu-) - 2 gamma B| and |(nu+ + nu-)/2 - D| for B = 0 to 5 mT in 0.01 mT steps",
                         "max_residual_MHz": split_worst, "lean": ["nv_splitting", "nv_centre"]},
        "nuclei": nuclei_checks,
        "tag": "calculated",
    }

    files = {**nuclei["source_files"], **{u: dict(f) for u, f in FETCHED.items()}}
    nuclei["fetch_errors"] = dict(FETCH_ERRORS)
    nuclei["kept_from_previous_run"] = nuclei["kept_from_previous_run"] + KEPT
    obj = {
        "meta": meta(False, [STECK, CODATA, HOLLOWAY, COD_RILEY, COD_HOUBEN, COD_GRAPHITE, BARRY, SULAI, MANTINA,
                             CORDERO, GRIFFITHS, LONG, TABATABAEE, QUSPIN_TECH, fret_in["source"],
                             fret_rec["meta"]["sources"][0],
                             f"{ANGELI}, from the {IAEA_RADII} (file {IAEA_RADII_CSV})",
                             f"IAEA Live Chart of Nuclides API, {IAEA_LIVECHART.format('<nuclide>')} (guide: {IAEA_GUIDE})",
                             specs["nv"]["jgu"]["microwave"]["source"].split(" (Section")[0] + f", full text {OMAR_HTML}",
                             f"{STECK} (PDF {STECK_PDF})", f"{CODATA}: {NIST_URL.format('<code>')}",
                             f"{COD_HOUBEN} and {COD_GRAPHITE}: CIF files {COD_CIF.format('<id>')}",
                             f"{QUSPIN_TECH}", BATES, SI_EXACT],
                     accessed=ACCESSED, used_by=["ui/scale/q_nv.js", "ui/scale/q_rb.js", "ui/scale/q_qd.js",
                                                 "ui/scale/q_cqd.js", "ui/scale/q_nucleus.js"],
                     sha256={u: f["sha256"] for u, f in files.items()}, fetched={u: f["fetched"] for u, f in files.items()},
                     fetch_errors=nuclei["fetch_errors"]),
        "electron": electron, "diamond": diamond, "nv": nv, "rb87": rb87, "opm_model": opm_model, "qd": qd,
        "graphite": graphite, "cqd": cqd, "radii": radii, "cpk_colours": cpk, "theme_colours": theme, "nuclei": nuclei,
        "codata": codata_more, "si": si_exact, "motion": motion, "nv_optics": nv_optics,
        "checks": checks,
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
    nuc_txt = []
    for key in NUCLIDES:
        r, s = nuclei[key]["rms_charge_radius"], nuclei[key].get("nuclear_spin") or {}
        nuc_txt.append(f"{key} R = {r['value']} fm ({r['status']}), I = {s.get('value')}")
    hfs14 = nv["n14_hyperfine_splitting"]
    print(f"  nuclei (IAEA charge radii, Angeli & Marinova 2013): {'; '.join(nuc_txt)}; NV 14N hyperfine "
          f"{hfs14['value']} MHz ({hfs14['status']})")
    if nuclei["kept_from_previous_run"]:
        print(f"  kept from the last successful run (fetch failed): {', '.join(nuclei['kept_from_previous_run'])}")
    for u, e in nuclei["fetch_errors"].items():
        print(f"  fetch failed: {u}: {e}")
    log_status("data/quantum_constants.json", "done", f"{n_vo} value objects for the quantum scenes (Steck rev 2.3.4, "
               "CODATA 2022, Holloway 1991, COD graphite/diamond, Barry, Sulai, Mantina); Bloch residual "
               f"{worst:.1e}, Python = Wolfram; nuclei from the IAEA charge radii file: {'; '.join(nuc_txt)}"
               + (f"; fetch errors: {len(nuclei['fetch_errors'])}" if nuclei["fetch_errors"] else ""))


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
