"""Real-data helpers shared by the run engine: fetch with checksum, Kiel Cardio Database records.

Kiel Cardio Database v1.0.0 (PhysioNet, doi:10.13026/q6r2-zz68, CC BY-SA 4.0): 7 subjects x 25 one-minute
trials, four QuSpin QZFM Gen 1 OPMs (8 channels), 200 Hz, pT. Each record is fetched from PhysioNet on first
use and checked against the published SHA256SUMS.txt. Processing only: a 2-62 s window (the first second of
each preprocessed trace holds the dataset filters' start-up transient), channel choice, R-peak detection,
beat averaging.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path

import numpy as np
import requests

CACHE = Path(os.environ.get("SPINDRIFT_CACHE", Path.home() / ".spindrift_cache"))
UA = {"User-Agent": "SpinDrift-data-pipeline/10 (research prototype)"}
KIEL_BASE = "https://physionet.org/files/kiel-cardio/1.0.0/"
KIEL_DIR = CACHE / "kiel-cardio-1.0.0"
N_SUBJECTS, N_TRIALS = 7, 25


def fetch(url: str, dest: Path, sha256: str | None = None) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        r = requests.get(url, headers=UA, timeout=120)
        r.raise_for_status()
        tmp = dest.with_suffix(dest.suffix + ".part")
        tmp.write_bytes(r.content)
        tmp.replace(dest)
    if sha256 and hashlib.sha256(dest.read_bytes()).hexdigest() != sha256:
        dest.unlink()
        raise ValueError(f"sha256 mismatch for {dest.name}")
    return dest


def kiel_sums() -> dict:
    p = fetch(KIEL_BASE + "SHA256SUMS.txt", KIEL_DIR / "SHA256SUMS.txt")
    out = {}
    for line in p.read_text().splitlines():
        if line.strip():
            digest, name = line.split(None, 1)
            out[name.strip()] = digest
    return out


def kiel_slice(n: int) -> tuple[int, int]:
    """Run number n (0-based) -> (subject, trial): walks through all 175 recordings in order."""
    n = n % (N_SUBJECTS * N_TRIALS)
    return n // N_TRIALS + 1, n % N_TRIALS + 1


Q_RULE = ("SpinDrift rule on the averaged beat, polarity set so R is positive: Q = minimum 10-80 ms before R, "
          "S = minimum 10-80 ms after R; the Kiel database has no annotations, so this is not a clinical reading")


def qrs_points(avg: np.ndarray, pre: int, fs: float) -> dict:
    """Q, R, S on a real averaged beat whose R-peak sits at index `pre`."""
    pol = 1.0 if avg[pre] >= 0 else -1.0
    a = pol * avg
    q0, q1 = pre - int(0.08 * fs), pre - int(0.01 * fs)
    s0, s1 = pre + int(0.01 * fs), pre + int(0.08 * fs)
    qi = q0 + int(np.argmin(a[q0:q1 + 1]))
    si = s0 + int(np.argmin(a[s0:s1 + 1]))
    return {"q_pT": round(float(avg[qi]), 2), "q_ms_before_r": round((pre - qi) / fs * 1000, 1),
            "r_pT": round(float(avg[pre]), 2), "s_pT": round(float(avg[si]), 2),
            "qrs_ms": round((si - qi) / fs * 1000, 1), "rule": Q_RULE}


def kiel_beat(subject: int, trial: int) -> dict:
    import wfdb
    from scipy.signal import find_peaks
    sums = kiel_sums()
    name = f"data/subject{subject}_preprocessed_trial{trial:02d}"
    for ext in (".hea", ".dat"):
        fetch(KIEL_BASE + name + ext, KIEL_DIR / (name + ext), sums[name + ext])
    rec = wfdb.rdrecord(str(KIEL_DIR / name))
    fs = int(rec.fs)
    x = rec.p_signal[2 * fs:62 * fs]
    prom = np.percentile(np.abs(x), 99.5, axis=0) / np.median(np.abs(x), axis=0)
    ch = int(np.argmax(prom))
    v = x[:, ch]
    pol = 1.0 if np.percentile(v, 99.9) >= -np.percentile(v, 0.1) else -1.0
    peaks, _ = find_peaks(pol * v, height=0.5 * np.percentile(pol * v, 99.9), distance=int(0.4 * fs))
    pre, post = int(0.3 * fs), int(0.5 * fs)
    peaks = [p for p in peaks if p - pre >= 0 and p + post < len(v)]
    if not peaks:
        raise ValueError(f"no R-peaks found in {name}")
    avg = np.stack([v[p - pre:p + post + 1] for p in peaks]).mean(axis=0)
    sensor = int(rec.sig_name[ch].split()[1])
    pos = next((c.split(":", 1)[1].strip() for c in rec.comments if c.startswith(f"<position sensor {sensor}")), None)
    return {"record": name, "channel": f"ch{ch} {rec.sig_name[ch].replace('  ', ' ')}", "beats": len(peaks),
            "r_peak_pT": round(float(avg[pre]), 2), "median_rr_s": round(float(np.median(np.diff(peaks)) / fs), 3),
            "sensor_position_cm": pos, "sha256": sums[name + ".dat"], "prominence": round(float(prom[ch]), 1),
            "qrs": qrs_points(avg, pre, fs)}
