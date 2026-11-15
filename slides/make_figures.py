"""Figures for the SpinDrift demo slides, drawn only from the project's own data and the running Lean checker.

Run from the repository root while the server is on http://127.0.0.1:8001 (needed for the Lean verdict matrix):
    python slides/make_figures.py
Writes slides/figures/*.png (and .svg). Every number comes from data/*.json or from POST /api/verdict; formulas are
the ones Lean checks (snr^2 * eta^2 * BW <= A^2 * N; B_ambient <= B_comp * S) or textbook physics stated on the figure
(NV lines D +/- gamma*B*cos(theta); Forster E = 1/(1+(r/R0)^6)). Styling follows unslop (CC BY 4.0, Damir Sokolovsky,
https://github.com/heydamir/unslop): neutral graphite ramp, one accent, muted grid, sentence-case labels, no glow.
"""
from __future__ import annotations

import json
import math
import urllib.request
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib import font_manager  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DATA, OUT = ROOT / "data", ROOT / "slides" / "figures"
OUT.mkdir(parents=True, exist_ok=True)
API = "http://127.0.0.1:8001"

# ---------------------------------------------------------------- look (unslop: graphite ramp, one accent)
BG, SURF, LINE = "#121417", "#1a1d22", "#2a2e35"
INK, INK2, MUTED = "#e9ebee", "#b4b9c2", "#7d838d"
ACC = "#6fd0c2"                       # instrument teal: the one accent
OK, BAD, MISS = "#8fc27a", "#e0705f", "#d9a944"   # Lean verdict colours, toned down
GREYS = ["#c9ced6", "#9aa1ab", "#6e7580"]
have = {f.name for f in font_manager.fontManager.ttflist}
SANS = next((f for f in ("Segoe UI", "Manrope", "Inter", "DejaVu Sans") if f in have), "DejaVu Sans")
MONO = next((f for f in ("JetBrains Mono", "Consolas", "DejaVu Sans Mono") if f in have), "DejaVu Sans Mono")
plt.rcParams.update({
    "figure.facecolor": BG, "axes.facecolor": BG, "savefig.facecolor": BG, "text.color": INK, "axes.labelcolor": INK2,
    "axes.edgecolor": LINE, "xtick.color": MUTED, "ytick.color": MUTED, "grid.color": LINE, "grid.linewidth": 0.6,
    "font.family": SANS, "font.size": 11, "axes.titlesize": 14, "axes.titleweight": "regular", "axes.titlelocation": "left",
    "axes.spines.top": False, "axes.spines.right": False, "legend.frameon": False, "axes.titlepad": 12,
})


def mono(ax):
    for lab in ax.get_xticklabels() + ax.get_yticklabels():
        lab.set_fontfamily(MONO); lab.set_fontsize(9)


def save(fig, name, note):
    fig.text(0.01, -0.03, note, fontsize=8, color=MUTED, fontfamily=MONO, ha="left", va="top")   # below the axes, kept by bbox 'tight'
    for ext in ("png", "svg"):
        fig.savefig(OUT / f"{name}.{ext}", dpi=200, bbox_inches="tight", pad_inches=0.25)
    plt.close(fig)
    print("wrote", name)


def read(rel):
    return json.loads((DATA / rel).read_text(encoding="utf-8"))


def post(path, body):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


# ---------------------------------------------------------------- shared data
LOC = read("locations.json")
AREAS = [  # same grouping as ui/areas.js
    ("Space station", ["iss.", "tiangong."]), ("Spacewalk in orbit", ["iss_hotspots."]),
    ("Launch and splashdown", ["earth_flight.baikonur", "earth_flight.i4_splashdown"]), ("Training on Earth", ["earth_flight.jsc"]),
    ("Antarctic station", ["earth_analog.concordia"]), ("Arctic and desert camps", ["earth_analog.haughton", "earth_analog.mdrs"]),
    ("Undersea habitat", ["earth_analog.aquarius"]), ("Deep space", ["gateway.", "mars_transit."]),
    ("Moon surface", ["moon_south_pole.", "lunar_anomalies."]), ("Mars surface", ["mars_surface."]),
]
SUBS = [s | {"place_name": p["name"]} for p in LOC["places"] for s in p["sub_places"]]


def in_area(sid, pats):
    return any(sid.startswith(p) if p.endswith(".") else sid == p for p in pats)


ORDERED = [(a, s) for a, pats in AREAS for s in SUBS if in_area(s["id"], pats)]
SPECS = read("specs.json")
B_COMP = SPECS["opm"]["field_compensation_max"]["value"]   # 50 nT, QuSpin
HEART = read("nv_heart_derived.json")
AB = HEART["averaged_beat"]


def short(s):
    name = s["sub_place"].split(" (")[0]
    return {"International Space Station": "ISS", "Tiangong space station": "Tiangong"}.get(s["place_name"], "") + (" · " if s["place_name"] in ("International Space Station", "Tiangong space station") else "") + name


# ---------------------------------------------------------------- 1. the field at 34 real spots
def fig_field():
    fig, ax = plt.subplots(figsize=(7.8, 9.6))
    ys, labels, area_rows = [], [], []
    y = 0
    for i, (area, s) in enumerate(ORDERED):
        if i == 0 or ORDERED[i - 1][0] != area:            # the area's name as a small heading above its spots
            y += 0.5 if i else 0
            ax.text(1.0, y, area, transform=ax.get_yaxis_transform(), ha="left", va="center", fontsize=9, color=INK)
            ax.text(-0.012, y, area, transform=ax.get_yaxis_transform(), ha="right", va="center", fontsize=9, color=INK, alpha=0)
            y += 0.9
        b = s["B_total_nT"].get("value")
        if isinstance(b, (int, float)):
            ax.barh(y, b, height=0.62, color=ACC if b <= B_COMP else GREYS[1], zorder=3)
            ax.text(b * 1.15, y, f"{b:,.0f} nT" if b >= 100 else f"{b:.3g} nT", va="center", fontsize=8, color=INK2, fontfamily=MONO)
        else:
            ax.text(1.2, y, "no published coordinates, so no value", va="center", fontsize=8, color=MUTED, fontfamily=MONO)
        ys.append(y); labels.append(short(s)); area_rows.append((area, y)); y += 1
    ax.set_xscale("log"); ax.set_xlim(1, 3e5); ax.set_ylim(y + 0.6, -0.8)
    ax.set_yticks(ys, labels, fontsize=8.5)
    ax.axvline(B_COMP, color=ACC, lw=1.2, zorder=4)
    ax.text(B_COMP * 1.1, y + 0.2, "the brain sensor's coils cancel up to 50 nT", color=ACC, fontsize=9, va="center")
    ax.grid(axis="x", which="major", zorder=0)
    # area headings sit in the left margin, above each group of spots
    for t in list(ax.texts):
        if t.get_alpha() == 0:
            t.set_alpha(1); t.set_color(INK); t.set_fontweight("semibold")
        elif t.get_position()[0] == 1.0 and t.get_transform() is not ax.transData:
            t.remove()
    top = ax.secondary_xaxis("top", functions=(lambda b: b / B_COMP, lambda s_: s_ * B_COMP))
    top.set_xlabel("shield needed for the brain sensor (×)", color=MUTED, fontsize=9); mono(top)
    ax.set_xlabel("background magnetic field (nT, log scale)")
    ax.set_title("The same brain sensor works on the Moon and fails in Earth orbit", color=INK)
    mono(ax)
    save(fig, "f1_field_at_34_spots", "Fields: data/locations.json (IGRF-14, NOAA L1/GOES, ARTEMIS, Ravat 2020, Langlais 2019, Johnson 2020). Coil limit: QuSpin QZFM Gen-3 (50 nT).")


# ---------------------------------------------------------------- 2. Lean's verdicts at every spot
CHECKS = [("opm_brain", "Brain\nOPM"), ("opm_heart", "Heart\nOPM"), ("nv_heart_jgu", "Heart\nNV JGU"), ("nv_heart_zaquant", "Heart\nNV ZAQuant"),
          ("nv_heart_qant", "Heart\nNV Q.ANT"), ("qd_blood", "Blood\nquantum dot"), ("cqd_skin", "Skin\ncarbon dots")]


def fig_matrix():
    inputs = {"shielding_factor": 1, "beats_averaged": 47, "snr_required": 3, "build": "jgu", "target": "r_peak", "bandwidth_hz": 30}
    rows = []
    for area, s in ORDERED:
        r = post("/api/verdict", {"location": s["id"], "inputs": inputs})
        rows.append((short(s), [r["verdicts"][k]["verdict"] for k, _ in CHECKS]))
    code = {"REQUIREMENTS_MET": 0, "NOT_MET": 1, "NEED_MORE_INFORMATION": 2}
    col = [OK, BAD, MISS]
    fig, ax = plt.subplots(figsize=(7.0, 9.4))
    for i, (name, vs) in enumerate(rows):
        for j, v in enumerate(vs):
            ax.add_patch(plt.Rectangle((j + 0.06, i + 0.08), 0.88, 0.84, color=col[code[v]], lw=0))
    ax.set_xlim(0, len(CHECKS)); ax.set_ylim(len(rows), 0)
    ax.set_xticks([j + 0.5 for j in range(len(CHECKS))], [c[1] for c in CHECKS], fontsize=8.5)
    ax.xaxis.tick_top(); ax.tick_params(length=0)
    ax.set_yticks([i + 0.5 for i in range(len(rows))], [r[0] for r in rows], fontsize=8.5)
    for sp in ax.spines.values():
        sp.set_visible(False)
    counts = {k: sum(v == k for _, vs in rows for v in vs) for k in code}
    ax.set_title(f"Lean's verdict at 34 real spots: {counts['REQUIREMENTS_MET']} work, {counts['NOT_MET']} do not, {counts['NEED_MORE_INFORMATION']} need a number", color=INK, pad=60)
    for k, (lab, c) in enumerate([("works", OK), ("does not work", BAD), ("a number is missing", MISS)]):
        ax.add_patch(plt.Rectangle((k * 2.35, len(rows) + 0.7), 0.4, 0.4, color=c, clip_on=False))
        ax.text(k * 2.35 + 0.55, len(rows) + 0.9, lab, va="center", fontsize=9, color=INK2)
    save(fig, "f2_lean_verdict_matrix", "Each cell is the output of SpinDrift.verdict (Lean 4) from POST /api/verdict, no shield, 47 heartbeats, signal÷noise 3, 30 Hz.")
    return rows


# ---------------------------------------------------------------- 3. the real heartbeat against each diamond's noise
def fig_heartbeat():
    t = np.array(AB["t_s"]) * 1000
    sign = -1 if AB["r_peak_pT"]["value"] < 0 else 1
    v = sign * np.array(AB["pT"])
    n, bw = AB["beats_averaged"]["value"], 30
    fig, ax = plt.subplots(figsize=(10, 5))
    builds = [("qant", "Q.ANT", GREYS[2]), ("jgu", "JGU", ACC), ("zaquant", "ZAQuant", GREYS[0])]
    for key, name, c in builds:
        eta = SPECS["nv"][key]["sensitivity"]["value"]
        sig = eta * math.sqrt(bw) / math.sqrt(n)
        if key == "jgu":
            ax.fill_between(t, -sig, sig, color=ACC, alpha=0.18, lw=0, zorder=1)
        ax.plot(t, np.full_like(t, sig), color=c, lw=0.9, ls=(0, (3, 3)) if key != "jgu" else "-", zorder=2)
        ax.text(t[-1] + 8, sig, f"{name} noise ±{sig:.1f} pT", va="center", fontsize=8.5, color=c, fontfamily=MONO)
    ax.plot(t, v, color=INK, lw=1.8, zorder=4)
    ir = int(np.argmax(v)); qt = -AB["q_wave_ms_before_r"]
    iq = int(np.argmin(np.abs(t - (t[ir] + qt))))
    ax.annotate(f"R {v[ir]:.1f} pT", (t[ir], v[ir]), (t[ir] + 40, v[ir] - 4), color=INK, fontsize=9, arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.8))
    ax.scatter([t[iq]], [v[iq]], s=26, color=MISS, zorder=5)
    ax.annotate(f"Q wave {HEART['averaged_beat']['q_wave_pT']['value']:.2f} pT: inside the JGU noise", (t[iq], v[iq]), (t[0] + 10, 17), color=MISS, fontsize=9, arrowprops=dict(arrowstyle="-", color=MISS, lw=0.8))
    ax.set_xlim(t[0], t[-1] + 150); ax.grid(True, zorder=0)
    ax.set_xlabel("time from the R peak (ms)"); ax.set_ylabel("magnetic field at the chest (pT)")
    ax.set_title(f"A real heartbeat ({n} beats averaged) against each diamond sensor's noise", color=INK)
    mono(ax)
    save(fig, "f3_heartbeat_vs_noise", "Beat: Kiel Cardio Database v1.0.0 (PhysioNet), OPM chest sensor, averaged. Noise = η·√BW/√N with η from Omar et al. (arXiv 2601.18843) Table 2, BW 30 Hz.")


# ---------------------------------------------------------------- 4. heartbeats each build needs (Lean's inequality)
def fig_beats():
    A_r, A_q, bw, snr = abs(AB["r_peak_pT"]["value"]), AB["q_wave_pT"]["value"], 30, 3
    N = np.logspace(0, 4.3, 400)
    fig, ax = plt.subplots(figsize=(10, 5.6))
    slots = {("zaquant", "R"): 24, ("jgu", "R"): 12, ("qant", "R"): 6.2, ("zaquant", "Q"): 1.45, ("jgu", "Q"): 0.75, ("qant", "Q"): 0.38}
    for key, name, c in [("jgu", "JGU", ACC), ("zaquant", "ZAQuant", GREYS[0]), ("qant", "Q.ANT", GREYS[2])]:
        eta = SPECS["nv"][key]["sensitivity"]["value"]
        for A, ls, lab in [(A_r, "-", "R"), (A_q, (0, (4, 3)), "Q")]:
            s = A * np.sqrt(N) / (eta * math.sqrt(bw))
            ax.plot(N, s, color=c, lw=1.8 if lab == "R" else 1.2, ls=ls)
            n_need = math.ceil((snr * eta * math.sqrt(bw) / A) ** 2)
            if n_need <= N[-1]:
                ax.scatter([n_need], [snr], s=22, color=c, zorder=5)
                ax.annotate(f"{name}, {'R peak' if lab == 'R' else 'Q wave'}: {n_need:,} beats", (n_need, snr), (n_need * 0.55, slots[(key, lab)]),
                            fontsize=8.5, color=c, fontfamily=MONO, ha="right", arrowprops=dict(arrowstyle="-", color=c, lw=0.7, shrinkA=2, shrinkB=3))
    ax.text(N[-1], 0.045, "solid: the big spike (R) · dashed: the small dip (Q)", ha="right", fontsize=8.5, color=MUTED)
    ax.axhline(snr, color=INK2, lw=0.9); ax.text(1.05, snr * 1.06, "needed: signal ÷ noise ≥ 3", fontsize=9, color=INK2)
    ax.set_xscale("log"); ax.set_yscale("log"); ax.set_xlim(1, N[-1]); ax.set_ylim(0.03, 60); ax.grid(True, which="major")
    ax.set_xlabel("heartbeats averaged, N"); ax.set_ylabel("signal ÷ noise = A·√N / (η·√BW)")
    ax.set_title("How many heartbeats each diamond sensor must average (the rule Lean checks)", color=INK)
    mono(ax)
    save(fig, "f4_heartbeats_needed", "Lean requirement nv_snr: snr²·η²·BW ≤ A²·N. A from the averaged Kiel beat (R 43.14 pT, Q 5.24 pT); η JGU 13, ZAQuant 7, Q.ANT 26 pT/√Hz; BW 30 Hz.")


# ---------------------------------------------------------------- 5. the same rule as a 3D surface
def fig_surface3d():
    A, bw, snr = abs(AB["r_peak_pT"]["value"]), 30, 3
    lnN = np.linspace(0, 4, 80); eta = np.linspace(4, 30, 80)
    X, Y = np.meshgrid(lnN, eta)
    Z = np.log10(A * np.sqrt(10 ** X) / (Y * math.sqrt(bw)))
    fig = plt.figure(figsize=(9, 7)); ax = fig.add_subplot(projection="3d")
    ax.set_facecolor(BG)
    ax.plot_surface(X, Y, Z, cmap="Greys_r", alpha=0.55, linewidth=0, antialiased=True, vmin=-1.5, vmax=2.5)
    ax.plot_surface(X, Y, np.full_like(Z, math.log10(snr)), color=ACC, alpha=0.12, linewidth=0)
    e_b = np.linspace(4, 30, 200); n_b = np.log10((snr * e_b * math.sqrt(bw) / A) ** 2)
    ax.plot(n_b, e_b, np.full_like(e_b, math.log10(snr)), color=ACC, lw=2.2)
    for key, name in [("jgu", "JGU"), ("zaquant", "ZAQuant"), ("qant", "Q.ANT")]:
        e = SPECS["nv"][key]["sensitivity"]["value"]; z = np.log10(A * np.sqrt(10 ** lnN) / (e * math.sqrt(bw)))
        ax.plot(lnN, np.full_like(lnN, e), z, color=INK, lw=1.1)
        ax.text(lnN[-1], e, z[-1] + 0.12, name, color=INK, fontsize=9)
    ax.set_xlabel("heartbeats averaged (log₁₀ N)", color=INK2, labelpad=8); ax.set_ylabel("sensor noise η (pT/√Hz)", color=INK2, labelpad=8)
    ax.set_zlabel("log₁₀ signal ÷ noise", color=INK2, labelpad=6)
    for a in (ax.xaxis, ax.yaxis, ax.zaxis):
        a.set_pane_color((0.07, 0.08, 0.09, 1)); a._axinfo["grid"]["color"] = LINE
    ax.tick_params(colors=MUTED, labelsize=8); ax.view_init(elev=24, azim=-128)
    ax.set_title("Where Lean's heart rule flips: the teal line is signal ÷ noise = 3", color=INK, loc="left")
    save(fig, "f5_heart_rule_surface_3d", "Surface: log₁₀(A·√N/(η·√BW)), A = 43.14 pT (averaged Kiel R peak), BW = 30 Hz. Lines: the three NV builds' η (Omar et al. Table 2).")


# ---------------------------------------------------------------- 6. the diamond's two lines at every spot (3D)
def fig_odmr3d():
    q = read("quantum_constants.json")["nv"]
    D, g = q["D"]["value"], q["gamma"]["value"] / 1000            # MHz, MHz per µT
    B = np.linspace(0, 70, 60); th = np.linspace(0, 90, 60)
    X, Y = np.meshgrid(B, th); C = np.cos(np.radians(Y))
    fig = plt.figure(figsize=(9, 7)); ax = fig.add_subplot(projection="3d"); ax.set_facecolor(BG)
    for sgn, shade in ((1, "#c9ced6"), (-1, "#6e7580")):
        ax.plot_surface(X, Y, D + sgn * g * X * C, color=shade, alpha=0.45, linewidth=0, shade=True)
        ax.plot(B, np.zeros_like(B), D + sgn * g * B, color=shade, lw=1.2)          # the edge at θ = 0, where the dots sit
    named = {"earth_analog.concordia": "Concordia, Antarctica (62 µT)"}
    for _, s in ORDERED:
        b = s["B_total_nT"].get("value")
        if isinstance(b, (int, float)) and b / 1000 <= 70:
            for sgn in (1, -1):
                ax.scatter([b / 1000], [0], [D + sgn * g * b / 1000], color=ACC if b <= B_COMP else INK, s=12, depthshade=False)
            if s["id"] in named:
                ax.text(b / 1000, -4, D + g * b / 1000 + 0.12, named[s["id"]], color=INK2, fontsize=8)
    ax.text(-2, -6, D - 0.9, "Moon, Gateway, cruise:\nthe two lines almost meet", color=ACC, fontsize=8, ha="right")
    ax.set_xlabel("background field (µT)", color=INK2, labelpad=8); ax.set_ylabel("angle to the NV axis (°)", color=INK2, labelpad=8)
    ax.set_zlabel("resonance (MHz)", color=INK2, labelpad=10)
    for a in (ax.xaxis, ax.yaxis, ax.zaxis):
        a.set_pane_color((0.07, 0.08, 0.09, 1)); a._axinfo["grid"]["color"] = LINE
    ax.tick_params(colors=MUTED, labelsize=8); ax.view_init(elev=14, azim=-38)
    ax.set_title("Each place moves the diamond's two quantum lines apart: D ± γB·cos θ", color=INK, loc="left")
    save(fig, "f6_nv_lines_3d", f"D = {D:g} MHz, γ = {q['gamma']['value']} MHz/mT (Barry et al., Rev. Mod. Phys. 92, 015004). Dots: the spots of data/locations.json at θ = 0; teal: fields ≤ 50 nT.")


# ---------------------------------------------------------------- 7. FRET, the blood sensor's quantum hop
def fig_fret():
    r = read("recorded/qd_fret_figshare5468838.json")
    P = r["x"]["values"]; E = next(s["values"] for s in r["series"] if s["name"].startswith("FRET"))
    x = np.linspace(0.4, 2.0, 300)
    fig, (ax, bx) = plt.subplots(1, 2, figsize=(11, 4.6), gridspec_kw={"width_ratios": [1.6, 1]})
    ax.plot(x, 100 / (1 + x ** 6), color=INK2, lw=1.6)
    for p, e in zip(P, E):
        rr = (100 / e - 1) ** (1 / 6)
        ax.scatter([rr], [e], s=30, color=ACC, zorder=5)
        ax.annotate(f"{p:g} GPa" if p >= 0.1 else "1 atm", (rr, e), (rr + 0.06, e + 4), fontsize=8.5, color=ACC, fontfamily=MONO)
    ax.set_xlabel("donor–acceptor distance r / R₀"); ax.set_ylabel("energy passed on without light, E (%)"); ax.grid(True)
    ax.set_title("FRET: E = 1 / (1 + (r/R₀)⁶)", color=INK)
    bx.plot(P, E, color=ACC, lw=1.6, marker="o", ms=4); bx.set_xlabel("pressure (GPa)"); bx.set_ylabel("measured E (%)"); bx.grid(True)
    bx.set_title("Squeezing brings them closer", color=INK)
    mono(ax); mono(bx)
    save(fig, "f7_fret_hop", "Measured: Li et al., CdTe/CdS quantum dots–rhodamine 101 (figshare 5468838), not the renin sensor. r/R₀ placed on the Förster curve from each measured E.")


# ---------------------------------------------------------------- 8. the dive: exact fields of view
LADDER = {
    "Brain · OPM": [(2, "astronaut"), (0.03, "sensor on the scalp"), (0.005, "glass cell"), (600e-6, "brain cell"), (1e-6, "one branch"), (10e-9, "one atom"), (2.5e-9, "a tiny compass"), (500e-12, "the spin"), (10e-15, "the nucleus")],
    "Heart · NV": [(2, "astronaut"), (0.03, "sensor at the chest"), (0.005, "the diamond"), (600e-6, "heart cell"), (1e-6, "tiny engines"), (10e-9, "the gate (Nav1.5)"), (2.5e-9, "inside the diamond"), (500e-12, "the spin"), (10e-15, "N-14 nucleus")],
    "Blood · quantum dot": [(2, "astronaut"), (0.03, "blood sample"), (0.005, "a drop"), (600e-6, "red cells"), (1e-6, "plasma"), (10e-9, "renin"), (2.5e-9, "dye tag")],
    "Skin · carbon dots": [(2, "astronaut"), (0.03, "patch on the arm"), (0.005, "skin layers"), (600e-6, "top layers"), (1e-6, "glowing specks"), (10e-9, "dot meets bilirubin"), (2.5e-9, "carbon sheets"), (500e-12, "electrons jump")],
}


def fig_ladder():
    fig, ax = plt.subplots(figsize=(12, 4.4))
    for i, (row, levels) in enumerate(LADDER.items()):
        xs = [math.log10(f) for f, _ in levels]
        ax.plot(xs, [i] * len(xs), color=LINE, lw=1, zorder=1)
        ax.scatter(xs, [i] * len(xs), s=[22] * (len(xs) - 1) + [44], color=[GREYS[1]] * (len(xs) - 1) + [ACC], zorder=3)
        for k, (x, (_, name)) in enumerate(zip(xs, levels)):
            if k == len(xs) - 1:                         # the deepest level: to the right of its dot
                ax.text(x - 0.18, i, name, ha="left", va="center", fontsize=8, color=ACC)
            else:
                ax.text(x, i - 0.22 if k % 2 else i + 0.3, name, ha="center", fontsize=7.5, color=INK2)
    ax.set_yticks(range(len(LADDER)), list(LADDER), fontsize=9.5); ax.set_ylim(len(LADDER) - 0.4, -0.6)
    ticks = [(0.30103, "2.00 m"), (-1.5229, "3.00 cm"), (-2.30103, "\n5.00 mm"), (-3.2218, "600 µm"), (-6, "1.00 µm"), (-8, "10.0 nm"), (-8.602, "\n2.50 nm"), (-9.301, "500 pm"), (-14, "10.0 fm")]
    ax.set_xticks([t for t, _ in ticks], [l for _, l in ticks], rotation=0)
    ax.invert_xaxis(); ax.grid(axis="x"); ax.tick_params(axis="y", length=0)
    ax.set_title("Scroll from the astronaut to the quantum level at exact fields of view: 14 orders of magnitude", color=INK)
    mono(ax)
    save(fig, "f8_dive_ladder", "Fields of view as in ui/story.js; the first seven follow Qubit Descent (2.00 m to 2.50 nm), SpinDrift adds 500 pm and 10.0 fm.")


# ---------------------------------------------------------------- 9. the real brain response and the OPM noise
def fig_brain():
    j = read("recorded/opm_brain_mne.json"); ev = j["evoked"]
    t = np.array(ev["x"]["values"]) * 1000
    fig, ax = plt.subplots(figsize=(10, 4.8))
    peaks = [max(abs(v) for v in s["values"]) for s in ev["series"]]
    best = int(np.argmax(peaks))
    for k, s in enumerate(ev["series"]):
        ax.plot(t, s["values"], color=ACC if k == best else GREYS[2], lw=1.8 if k == best else 0.9, zorder=3 if k == best else 2)
    eta, bw, n = 15, 30, ev["n_epochs"]
    sig = eta * math.sqrt(bw) / math.sqrt(n)
    ax.fill_between(t, -sig, sig, color=INK2, alpha=0.15, lw=0)
    ax.annotate(f"OPM noise after {n} responses: ±{sig:.1f} fT\n(the grey band on the zero line, too thin to see)", (t[-1] * 0.9, 0), (t[-1], -1050), ha="right",
                fontsize=8.5, color=INK2, fontfamily=MONO, arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.7))
    iss = next(s for s in SUBS if s["id"] == "iss.destiny")["B_total_nT"]["value"]
    ratio = iss * 1e6 / max(peaks)
    ax.set_title(f"A real brain response peaks at {max(peaks):,.0f} fT; the ISS background is {ratio / 1e6:,.0f} million times larger", color=INK)
    ax.set_xlabel("time after a touch to the wrist (ms)"); ax.set_ylabel("magnetic field at the scalp (fT)"); ax.grid(True)
    mono(ax)
    save(fig, "f9_brain_response", "Response: MNE-Python OPM sample (QuSpin sensors, 8 channels, median-nerve stimulus). Noise: QZFM Gen-3 '<15 fT/√Hz' (upper bound), BW 30 Hz. ISS field: IGRF-14 at the live ISS position.")


if __name__ == "__main__":
    fig_field(); fig_matrix(); fig_heartbeat(); fig_beats(); fig_surface3d(); fig_odmr3d(); fig_fret(); fig_ladder(); fig_brain()
