"""Animated 3D columns for the deck: each sensor's board on top, its dive to the quantum level stacked below, a depth
marker stepping down, and the camera swaying. Same look as slides/make_figures.py (unslop graphite, one teal accent).
The verdict counts printed at the end come from the running Lean checker (POST /api/verdict) with the verdict matrix's
inputs; the slide states them as text under each column.

Usage:   LEAN_API=http://127.0.0.1:8001 python slides/make_3d_columns.py
Writes slides/figures/col_<sensor>.gif (and col_<sensor>.png, the first frame).
"""
from __future__ import annotations

import collections
import json
import os
import urllib.request
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.animation import FuncAnimation, PillowWriter  # noqa: E402
from mpl_toolkits.mplot3d.art3d import Poly3DCollection  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "slides" / "figures"
API = os.environ.get("LEAN_API", "http://127.0.0.1:8001")
BG, INK, INK2, MUTED, LINE = "#121417", "#e9ebee", "#b4b9c2", "#7d838d", "#2a2e35"
ACC = "#6fd0c2"
PCB, PCB_EDGE, COPPER, PART, EDGE = "#0e1a14", "#2b3d33", "#c98a3d", "#1b1f24", "#46505b"
FRAMES, FPS = 48, 12
ZB = 4.0                       # board height; depth levels at 3, 2, 1, 0
LEVEL_Z = [3.0, 2.0, 1.0, 0.0]
plt.rcParams.update({"figure.facecolor": BG, "savefig.facecolor": BG, "text.color": INK,
                     "font.family": next((f for f in ("Segoe UI", "DejaVu Sans") if f in {x.name for x in matplotlib.font_manager.fontManager.ttflist}), "DejaVu Sans")})


# ---------------------------------------------------------------- drawing helpers
def zo(z, k=0):
    """draw order: higher layers in front (the camera looks down at 22 degrees), k orders things within a layer"""
    return 10 + 10 * z + k


def rect(ax, x0, y0, w, h, z, fc, ec, alpha=1.0, lw=1.0, k=1):
    v = [[(x0, y0, z), (x0 + w, y0, z), (x0 + w, y0 + h, z), (x0, y0 + h, z)]]
    pc = Poly3DCollection(v, facecolors=fc, edgecolors=ec, linewidths=lw, alpha=alpha)
    pc.set_zorder(zo(z, k))
    ax.add_collection3d(pc)
    return pc


def poly(ax, pts, z, fc, ec, alpha=1.0, lw=1.0, k=1):
    pc = Poly3DCollection([[(x, y, z) for x, y in pts]], facecolors=fc, edgecolors=ec, linewidths=lw, alpha=alpha)
    pc.set_zorder(zo(z, k))
    ax.add_collection3d(pc)
    return pc


def line(ax, pts, z, color, lw=1.6, alpha=1.0, ls="-", k=2):
    p = np.array(pts, float)
    return ax.plot(p[:, 0], p[:, 1], np.full(len(p), z), color=color, lw=lw, alpha=alpha, ls=ls, zorder=zo(z, k))[0]


def label(ax, x, y, z, s, size=8.5, color=INK2, k=4, **kw):
    return ax.text(x, y, z, s, fontsize=size, color=color, zorder=zo(z, k),
                   bbox=dict(boxstyle="round,pad=0.15", fc=BG, ec="none", alpha=0.72), **kw)


def resample(pts, n):
    p = np.array(pts, float)
    seg = np.linalg.norm(np.diff(p, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    t = np.linspace(0, cum[-1], n)
    return np.interp(t, cum, p[:, 0]), np.interp(t, cum, p[:, 1])


class Photons:
    """dots running along a polyline on a plane, several at once, one loop per animation"""
    def __init__(self, ax, pts, z, color, count=3, size=26):
        self.x, self.y = resample(pts, 240)
        self.z, self.count = z, count
        self.sc = ax.scatter([], [], [], s=size, c=color, depthshade=False, edgecolors="none", zorder=zo(z, 3))

    def update(self, f):
        idx = [int(((f / FRAMES) + k / self.count) % 1.0 * (len(self.x) - 1)) for k in range(self.count)]
        self.sc._offsets3d = (self.x[idx], self.y[idx], np.full(len(idx), self.z))


def board_plane(ax):
    rect(ax, -2.0, -1.3, 4.0, 2.6, ZB, PCB, PCB_EDGE, lw=1.2, k=0)
    for x, y in ((-1.85, -1.15), (1.85, -1.15), (-1.85, 1.15), (1.85, 1.15)):
        ax.scatter([x], [y], [ZB], s=18, c=BG, edgecolors=PCB_EDGE, depthshade=False, zorder=zo(ZB, 1))


def level_planes(ax, names):
    texts = []
    for z, name in zip(LEVEL_Z, names):
        rect(ax, -2.0, -1.3, 4.0, 2.6, z, "#1a1d22", LINE, alpha=0.35, lw=0.9, k=0)
        texts.append(label(ax, -2.0, -1.42, z + 0.06, name, size=9, k=8))
    return texts


# ---------------------------------------------------------------- the four sensors
def brain(ax):
    board_plane(ax)
    line(ax, [(-1.6, -0.25), (-1.6, -0.9), (0.9, -0.9)], ZB, COPPER, lw=1.4)
    line(ax, [(1.42, -0.22), (1.42, -0.62)], ZB, COPPER, lw=1.4)
    rect(ax, -1.9, -0.25, 0.6, 0.5, ZB, PART, EDGE)
    rect(ax, -0.35, -0.35, 0.7, 0.7, ZB, "#4a2230", "#c8586a", lw=1.4)
    rect(ax, 1.2, -0.22, 0.45, 0.44, ZB, PART, EDGE)
    rect(ax, 0.9, -1.15, 0.9, 0.5, ZB, PART, EDGE)
    t = np.linspace(0, np.pi, 30)
    for s in (1, -1):
        ax.plot(0.62 * np.cos(t), s * (0.5 + 0.12 * np.sin(t)), np.full(30, ZB), color="#9fb3c8", lw=1.1, ls="--", zorder=zo(ZB, 2))
    line(ax, [(-1.3, 0), (1.2, 0)], ZB, "#c8586a", lw=1.2, alpha=0.6)
    label(ax, -1.95, 0.3, ZB, "795 nm laser")
    label(ax, -0.4, 0.62, ZB, "Rb-87 cell")
    label(ax, 1.1, 0.3, ZB, "detector")
    label(ax, 0.9, -1.25, ZB + 0.02, "lock-in 923 Hz")
    anim = [Photons(ax, [(-1.3, 0), (1.2, 0)], ZB, "#ff7a6a", count=4)]
    texts = level_planes(ax, ["3.00 cm · scalp", "5.00 mm · Rb-87 cell", "2.50 nm · Rb atom", "500 pm · spin precesses"])
    # 3.00 cm: the head and the sensor on it
    xs = np.linspace(-1.3, 1.3, 40)
    ax.plot(xs, -0.7 + 1.2 * (1 - (xs / 1.3) ** 2), np.full(40, 3.0), color=MUTED, lw=1.6, zorder=zo(3.0, 2))
    rect(ax, -0.18, 0.38, 0.36, 0.24, 3.0, ACC, ACC)
    # 5.00 mm: the cell, a cube, with atoms moving in it
    c = 0.45
    for a, b in [((-c, -c), (c, -c)), ((c, -c), (c, c)), ((c, c), (-c, c)), ((-c, c), (-c, -c))]:
        for zz in (2.0, 2.0 + 2 * c * 0.8):
            ax.plot([a[0], b[0]], [a[1], b[1]], [zz, zz], color="#c8586a", lw=1.3, zorder=zo(2.0, 3))
        ax.plot([a[0], a[0]], [a[1], a[1]], [2.0, 2.0 + 2 * c * 0.8], color="#c8586a", lw=1.3, zorder=zo(2.0, 3))
    rng = np.random.default_rng(3)
    base = rng.uniform(-0.35, 0.35, (9, 3))
    gas = ax.scatter([], [], [], s=10, c=INK, depthshade=False, zorder=zo(2.0, 4))
    # 2.50 nm: nucleus and an electron on its orbit
    ax.scatter([0], [0], [1.25], s=70, c=INK, depthshade=False, zorder=zo(1.0, 3))
    t = np.linspace(0, 2 * np.pi, 60)
    ax.plot(0.75 * np.cos(t), 0.75 * np.sin(t) * 0.45, 1.25 + 0.25 * np.sin(t), color=ACC, lw=1.1, zorder=zo(1.0, 2))
    el = ax.scatter([], [], [], s=22, c=ACC, depthshade=False, zorder=zo(1.0, 4))
    # 500 pm: the spin precesses about the field (dashed axis)
    ax.plot([0, 0], [0, 0], [0.0, 0.9], color=MUTED, lw=1, ls="--", zorder=zo(0.0, 2))
    holder = {"q": None}

    def update(f):
        ph = 2 * np.pi * f / FRAMES
        j = base + 0.06 * np.sin(ph * 3 + np.arange(9)[:, None])
        gas._offsets3d = (j[:, 0], j[:, 1], 2.36 + j[:, 2])
        el._offsets3d = ([0.75 * np.cos(ph * 2)], [0.75 * np.sin(ph * 2) * 0.45], [1.25 + 0.25 * np.sin(ph * 2)])
        if holder["q"] is not None:
            holder["q"].remove()
        th = np.radians(35)
        holder["q"] = ax.quiver(0, 0, 0.05, np.sin(th) * np.cos(ph), np.sin(th) * np.sin(ph), np.cos(th), length=0.85,
                                color="#8fc27a", linewidth=2.2, arrow_length_ratio=0.25, zorder=zo(0.0, 4))
    return anim, texts, update


def heart(ax):
    board_plane(ax)
    line(ax, [(1.15, 0.42), (1.15, 0.1), (1.6, 0.1)], ZB, COPPER, lw=1.4)
    rect(ax, -1.95, 0.45, 0.6, 0.35, ZB, PART, EDGE)
    rect(ax, -0.6, 0.42, 0.4, 0.4, ZB, PART, EDGE)
    line(ax, [(-0.6, 0.42), (-0.2, 0.82)], ZB, "#9fb3c8", lw=1)
    rect(ax, -0.47, -0.45, 0.14, 0.82, ZB, "#22303a", EDGE)
    poly(ax, [(-0.4, -0.55), (-0.28, -0.72), (-0.4, -0.89), (-0.52, -0.72)], ZB, "#e0705f", "#f2b0a6", lw=1.2)
    rect(ax, -0.05, -0.95, 0.35, 0.3, ZB, "#2e2a40", "#7d74a8")
    rect(ax, 0.6, -1.18, 0.85, 0.4, ZB, PART, EDGE)
    line(ax, [(0.6, -0.98), (-0.28, -0.72)], ZB, "#c9a0dc", lw=1.2, ls="--")
    rect(ax, 0.2, 0.42, 0.15, 0.4, ZB, "#3a1e22", "#c8586a")
    rect(ax, 0.62, 0.42, 0.45, 0.4, ZB, PART, EDGE)
    rect(ax, 1.3, 0.42, 0.6, 0.4, ZB, PART, EDGE)
    line(ax, [(-1.35, 0.62), (-0.4, 0.62), (-0.4, -0.7)], ZB, "#4cc46a", lw=1.1, alpha=0.5)
    line(ax, [(-0.4, -0.7), (-0.4, 0.62), (0.62, 0.62)], ZB, "#e0705f", lw=1.1, alpha=0.35)
    label(ax, -1.95, 0.9, ZB, "green laser")
    label(ax, -0.65, 0.9, ZB, "dichroic")
    label(ax, -1.25, -0.8, ZB, "diamond")
    label(ax, -0.05, -0.55, ZB, "≈1 mT")
    label(ax, 0.62, -1.28, ZB + 0.02, "2.87 GHz")
    label(ax, 0.6, 0.9, ZB, "balanced PD")
    label(ax, 1.32, 0.9, ZB, "lock-in")
    anim = [Photons(ax, [(-1.35, 0.62), (-0.4, 0.62), (-0.4, -0.7)], ZB, "#5fe07a", count=3),
            Photons(ax, [(-0.4, -0.7), (-0.4, 0.62), (0.62, 0.62)], ZB, "#ff6a55", count=3)]
    texts = level_planes(ax, ["3.00 cm · chest", "5.00 mm · diamond", "2.50 nm · NV centre", "500 pm · spin flips"])
    t = np.linspace(0, 2 * np.pi, 80)
    hx, hy = 16 * np.sin(t) ** 3, 13 * np.cos(t) - 5 * np.cos(2 * t) - 2 * np.cos(3 * t) - np.cos(4 * t)
    heart_line, = ax.plot(hx / 22, hy / 22, np.full(80, 3.0), color="#e0705f", lw=1.8, zorder=zo(3.0, 2))
    v = [(0.6, 0, 2.45), (-0.6, 0, 2.45), (0, 0.6, 2.45), (0, -0.6, 2.45), (0, 0, 2.95), (0, 0, 1.95)]
    for i, j in [(0, 2), (2, 1), (1, 3), (3, 0), (0, 4), (1, 4), (2, 4), (3, 4), (0, 5), (1, 5), (2, 5), (3, 5)]:
        ax.plot(*zip(v[i], v[j]), color="#c9d6e3", lw=1.2, zorder=zo(2.0, 3))
    g = np.array([(x, y) for x in (-0.6, 0, 0.6) for y in (-0.6, 0, 0.6) if (x, y) not in ((0, 0), (-0.6, 0))])
    ax.scatter(g[:, 0], g[:, 1], np.full(len(g), 1.0), s=26, c="#9aa1ab", depthshade=False, zorder=zo(1.0, 2))
    ax.scatter([-0.6], [0], [1.0], s=44, c="#5b8def", depthshade=False, zorder=zo(1.0, 3))
    vac = ax.scatter([0], [0], [1.0], s=60, facecolors="none", edgecolors=INK, linewidths=1.4, depthshade=False, zorder=zo(1.0, 3))
    ax.plot([-0.6, 0], [0, 0], [1.0, 1.0], color=MUTED, lw=1, ls=":", zorder=zo(1.0, 2))
    holder = {"q": None}

    def update(f):
        ph = 2 * np.pi * f / FRAMES
        k = 1 + 0.08 * np.sin(ph * 2)
        heart_line.set_data_3d(k * hx / 22, k * hy / 22, np.full(80, 3.0))
        vac.set_alpha(0.35 + 0.65 * (0.5 + 0.5 * np.cos(ph * 2)))
        if holder["q"] is not None:
            holder["q"].remove()
        up = np.cos(np.pi * np.clip((f % 24) / 24 * 2 - 0.5, 0, 1))      # flips once per half loop
        holder["q"] = ax.quiver(0, 0, 0.05 if up >= 0 else 0.5, 0, 0, 0.45 if up >= 0 else -0.45, length=1.0,
                                color="#8fc27a", linewidth=2.4, arrow_length_ratio=0.35, zorder=zo(0.0, 4))
    return anim, texts, update


def blood(ax):
    board_plane(ax)
    line(ax, [(-1.95, 0.35), (-0.8, 0.35)], ZB, "#8a2e2e", lw=4)
    rect(ax, -0.8, 0.05, 1.4, 0.6, ZB, "#15232a", EDGE)
    rect(ax, -1.6, -0.06, 3.2, 0.1, ZB, "#2b3a44", "#2b3a44")
    poly(ax, [(-0.7, -0.06), (0.7, -0.06), (0.95, -0.8), (-0.95, -0.8)], ZB, "#1b2730", EDGE)
    line(ax, [(-1.6, -1.1), (0, -0.05), (1.6, -1.1)], ZB, "#7fe3d0", lw=1.1, alpha=0.5)
    rect(ax, 1.2, 0.6, 0.7, 0.5, ZB, PART, EDGE)
    line(ax, [(0.35, 0.35), (1.2, 0.85)], ZB, "#e0503f", lw=1, alpha=0.4)
    ax.scatter([-0.4, 0.2], [0.35, 0.35], [ZB, ZB], s=40, c="#e8a33d", depthshade=False, zorder=zo(ZB, 3))
    ax.scatter([-0.2, 0.4], [0.35, 0.35], [ZB, ZB], s=24, c="#e0503f", depthshade=False, zorder=zo(ZB, 3))
    label(ax, -1.95, 0.5, ZB, "plasma in")
    label(ax, -0.8, 0.75, ZB, "QD + Cy5 probes")
    label(ax, -1.9, -1.25, ZB + 0.02, "TIRF light")
    label(ax, 1.15, 1.18, ZB, "Cy5 counts")
    anim = [Photons(ax, [(-1.6, -1.1), (0, -0.05), (1.6, -1.1)], ZB, "#9ff5e5", count=4),
            Photons(ax, [(0.35, 0.35), (1.2, 0.85)], ZB, "#ff6a55", count=2),
            Photons(ax, [(-0.4, 0.35), (-0.2, 0.35)], ZB, "#ffe7a8", count=1, size=14),
            Photons(ax, [(0.2, 0.35), (0.4, 0.35)], ZB, "#ffe7a8", count=1, size=14)]
    texts = level_planes(ax, ["3.00 cm · blood", "10.0 nm · renin cuts", "2.50 nm · Cy5 tag", "FRET · QD → Cy5"])
    rect(ax, -0.25, -0.9, 0.5, 1.8, 3.0, "none", "#c9d6e3", lw=1.4)
    rect(ax, -0.2, -0.85, 0.4, 0.9, 3.0, "#b3333a", "#b3333a", alpha=0.85)
    left, = ax.plot([-1.0, -0.12], [0, 0], [2.0, 2.0], color="#c9d6e3", lw=2.4, zorder=zo(2.0, 2))
    right, = ax.plot([0.12, 1.0], [0, 0], [2.0, 2.0], color="#c9d6e3", lw=2.4, zorder=zo(2.0, 2))
    ax.scatter([0], [0.3], [2.0], s=90, c="#d9a944", depthshade=False, zorder=zo(2.0, 3))
    cy5 = ax.scatter([0], [0], [1.0], s=120, c="#e0503f", depthshade=False, zorder=zo(1.0, 3))
    ax.scatter([-0.55], [0], [0.0], s=150, c="#e8a33d", depthshade=False, zorder=zo(0.0, 3))
    ax.scatter([0.55], [0], [0.1], s=80, c="#e0503f", depthshade=False, zorder=zo(0.0, 3))
    ax.plot([-0.55, 0.55], [0, 0], [0.0, 0.1], color=MUTED, lw=1, ls=":", zorder=zo(0.0, 2))
    hop = ax.scatter([], [], [], s=26, c="#ffe7a8", depthshade=False, zorder=zo(0.0, 4))

    def update(f):
        ph = f / FRAMES
        gap = 0.12 + 0.18 * max(0, np.sin(2 * np.pi * ph))
        left.set_data_3d([-1.0, -gap], [0, 0], [2.0, 2.0])
        right.set_data_3d([gap, 1.0], [0, 0], [2.0, 2.0])
        cy5.set_sizes([90 + 60 * (0.5 + 0.5 * np.sin(4 * np.pi * ph))])
        s = (ph * 2) % 1.0
        hop._offsets3d = ([-0.55 + 1.1 * s], [0], [0.0 + 0.1 * s])
    return anim, texts, update


def skin(ax):
    board_plane(ax)
    line(ax, [(-0.5, 0.55), (-0.2, 0.55)], ZB, COPPER, lw=1.4)
    line(ax, [(0.5, 0.55), (0.9, 0.55)], ZB, COPPER, lw=1.4)
    line(ax, [(0.15, 0.3), (0.15, -0.1), (0.8, -0.1)], ZB, COPPER, lw=1.4)
    t = np.linspace(0, 2 * np.pi, 20)
    poly(ax, list(zip(-1.75 + 0.13 * np.cos(t), 0.85 + 0.13 * np.sin(t))), ZB, "#7a3cff", "#7a3cff")
    poly(ax, list(zip(-1.75 + 0.13 * np.cos(t), 0.4 + 0.13 * np.sin(t))), ZB, "#2f6bff", "#2f6bff")
    rect(ax, -1.0, 0.35, 0.5, 0.4, ZB, PART, EDGE)
    rect(ax, -0.2, 0.3, 0.7, 0.5, ZB, PART, EDGE)
    rect(ax, 0.9, 0.4, 0.6, 0.35, ZB, PART, EDGE)
    rect(ax, 0.8, -0.3, 0.9, 0.3, ZB, "#20262c", EDGE)
    rect(ax, -1.9, -0.55, 2.3, 0.08, ZB, "#9fc9e8", "#9fc9e8", alpha=0.6)
    rect(ax, -1.9, -1.25, 2.3, 0.65, ZB, "#3a2e2a", "#3a2e2a")
    for x0 in (-1.5, -1.1, -0.7):
        poly(ax, [(x0, -0.6), (x0 + 0.08, -1.0), (x0 + 0.16, -0.6)], ZB, "#6b5a4a", "#d8cbb8")
    dots = ax.scatter([-1.3, -0.95, -0.55, -0.3], [-1.05, -0.9, -1.1, -0.85], [ZB] * 4, s=16, c="#59d9e8", depthshade=False, zorder=zo(ZB, 3))
    label(ax, -1.95, 1.08, ZB, "LEDs 390 · 470 nm")
    label(ax, -1.02, 0.83, ZB, "AS7341")
    label(ax, -0.2, 0.88, ZB, "ATmega328")
    label(ax, 0.9, 0.83, ZB, "Bluetooth")
    label(ax, 0.8, -0.42, ZB + 0.02, "Li-ion ×2")
    label(ax, 0.5, -1.0, ZB, "carbon-dot tattoo")
    anim = [Photons(ax, [(-1.75, 0.85), (-1.1, -0.95)], ZB, "#b488ff", count=2),
            Photons(ax, [(-1.75, 0.4), (-1.1, -0.95)], ZB, "#6fa0ff", count=2),
            Photons(ax, [(-0.95, -0.95), (-0.75, 0.35)], ZB, "#7ff0f5", count=3)]
    texts = level_planes(ax, ["3.00 cm · forearm", "1.00 µm · carbon dots", "10.0 nm · bilirubin", "500 pm · electron jumps"])
    xs = np.linspace(-1.4, 1.4, 40)
    ax.plot(xs, -0.5 + 0.35 * (1 - (xs / 1.4) ** 2), np.full(40, 3.0), color=MUTED, lw=1.6, zorder=zo(3.0, 2))
    rect(ax, -0.3, -0.25, 0.6, 0.3, 3.0, ACC, ACC)
    rng = np.random.default_rng(5)
    pts = rng.uniform(-1.2, 1.2, (12, 2))
    glow = ax.scatter(pts[:, 0], pts[:, 1], np.full(12, 2.0), s=30, c="#59d9e8", depthshade=False, zorder=zo(2.0, 3))
    cdot = ax.scatter([-0.4], [0], [1.0], s=160, c="#59d9e8", depthshade=False, zorder=zo(1.0, 3))
    bil, = ax.plot([], [], [], color="#e8a33d", lw=2, zorder=zo(1.0, 3))
    ax.plot([-0.9, 0.9], [0, 0], [0.0, 0.0], color=MUTED, lw=1.6, zorder=zo(0.0, 2))
    ax.plot([-0.9, 0.9], [0, 0], [0.55, 0.55], color=MUTED, lw=1.6, zorder=zo(0.0, 2))
    elec = ax.scatter([], [], [], s=40, c=ACC, depthshade=False, zorder=zo(0.0, 4))

    def update(f):
        ph = f / FRAMES
        a = 0.5 + 0.5 * np.cos(2 * np.pi * ph)
        dots.set_alpha(0.35 + 0.65 * a)
        glow.set_alpha(0.3 + 0.7 * a)
        d = 0.5 + 0.35 * np.cos(2 * np.pi * ph)          # bilirubin comes close, the dot dims, then it recovers
        zx = np.array([0, 0.1, 0.2, 0.3, 0.4]) + d
        bil.set_data_3d(zx, np.array([0, 0.12, 0, 0.12, 0]), np.full(5, 1.0))
        cdot.set_alpha(0.25 + 0.75 * np.clip((d - 0.15) / 0.7, 0, 1))
        up = (ph * 2) % 1.0 < 0.5
        elec._offsets3d = ([0], [0], [0.55 if up else 0.0])
    return anim, texts, update


SENSORS = {"brain": ("Brain · OPM", "QuSpin QZFM Gen-3", brain), "heart": ("Heart · NV diamond", "ZAQuant build", heart),
           "blood": ("Blood · quantum dot", "FRET renin sensor", blood), "skin": ("Skin · carbon dots", "microneedle patch", skin)}


def column(key):
    title, sub, draw = SENSORS[key]
    fig = plt.figure(figsize=(3.98, 5.0), dpi=100)
    fig.text(0.05, 0.955, title, fontsize=13, fontweight="bold", color=INK)
    fig.text(0.05, 0.915, sub, fontsize=9, color=MUTED)
    ax = fig.add_axes([-0.12, -0.08, 1.24, 1.02], projection="3d")
    ax.computed_zorder = False
    ax.set_axis_off()
    ax.set_facecolor(BG)
    ax.set_xlim(-2.2, 2.2); ax.set_ylim(-1.45, 1.45); ax.set_zlim(-0.2, 4.3)
    ax.set_box_aspect((4.4, 2.9, 5.2))
    anim, texts, update = draw(ax)
    gauge = ax.scatter([], [], [], s=60, c=ACC, depthshade=False, zorder=zo(ZB, 9))
    ax.plot([2.05, 2.05], [-1.3, -1.3], [0.0, ZB], color=ACC, lw=1.2, alpha=0.5, zorder=zo(ZB, 8))

    def frame(f):
        az = -62 + 14 * np.sin(2 * np.pi * f / FRAMES)
        ax.view_init(elev=22, azim=az)
        for p in anim:
            p.update(f)
        update(f)
        z = ZB - ZB * (f / (FRAMES - 1))
        gauge._offsets3d = ([2.05], [-1.3], [z])
        lvl = int(np.clip(round(ZB - z) - 1, 0, 3)) if z < ZB - 0.5 else -1
        for i, t in enumerate(texts):
            t.set_color(ACC if i == lvl else INK2)
        return []

    frame(0)
    fig.savefig(OUT / f"col_{key}.png")
    FuncAnimation(fig, frame, frames=FRAMES, interval=1000 / FPS).save(OUT / f"col_{key}.gif", writer=PillowWriter(fps=FPS))
    plt.close(fig)
    print("wrote", f"col_{key}.gif")


def verdicts():
    """Lean's verdict counts at every place with the verdict matrix's inputs and the published references"""
    call = lambda p, b=None: json.loads(urllib.request.urlopen(urllib.request.Request(
        API + p, data=None if b is None else json.dumps(b).encode(), headers={"Content-Type": "application/json"} if b else {}), timeout=120).read())
    inputs = {"shielding_factor": 1, "beats_averaged": 47, "snr_required": 3, "build": "jgu", "target": "r_peak",
              "bandwidth_hz": 30, "renin": 2.0, "bilirubin_isf": 1.3}
    counts = collections.defaultdict(collections.Counter)
    for p in call("/api/locations")["places"]:
        for s in p["sub_places"]:
            for k, v in call("/api/verdict", {"location": s["id"], "inputs": inputs})["verdicts"].items():
                counts[k][v["verdict"]] += 1
    for k in ("opm_brain", "nv_heart_jgu", "nv_heart_zaquant", "nv_heart_qant", "qd_blood", "cqd_skin"):
        print(k, dict(counts[k]))


if __name__ == "__main__":
    for k in SENSORS:
        column(k)
    verdicts()
