"""Real EEG for the main card's brain row: OpenNeuro ds004902, 'A Resting-state EEG Dataset for Sleep
Deprivation' (Xiang, Fan, Bai, Lv, Lei), CC0, doi:10.18112/openneuro.ds004902.v1.0.8. Brain Products 61-channel
EEG, 500 Hz, reference FCz, 300 s eyes closed. Session 1 = normal sleep (NS), session 2 = sleep deprivation (SD).

Writes data/recorded/eeg_brain_ds004902.json: a 60 s window of four posterior channels (NS session, band-pass
1-40 Hz, resampled to 250 Hz, microvolts) plus the occipital power spectrum of both sessions (Welch, whole 300 s)
and the mean alpha-band (8-12 Hz) power per session. Conventional EEG electrodes, not a quantum sensor, not an
astronaut. mne only loads and processes the recording; nothing is simulated.
"""
import hashlib
import os
import sys
from pathlib import Path

import numpy as np
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.common import RECORDED, log_status, meta, now_iso, write_json  # noqa: E402

CACHE = Path(os.environ.get("SPINDRIFT_CACHE", Path.home() / ".spindrift_cache")) / "openneuro-ds004902"
BASE = "https://s3.amazonaws.com/openneuro.org/ds004902/"
UA = {"User-Agent": "SpinDrift-data-pipeline/10 (research prototype)"}
SUBJECT = "sub-01"
SESSIONS = {"ses-1": "normal sleep (NS)", "ses-2": "sleep deprivation (SD)"}
WINDOW_CH = ["O1", "Oz", "O2", "Pz"]
OCCIPITAL = ["O1", "Oz", "O2"]


def fetch_s3(key: str) -> Path:
    dest = CACHE / key
    dest.parent.mkdir(parents=True, exist_ok=True)
    head = requests.head(BASE + key, headers=UA, timeout=60)
    head.raise_for_status()
    etag = head.headers.get("ETag", "").strip('"')
    if not dest.exists():
        r = requests.get(BASE + key, headers=UA, timeout=600)
        r.raise_for_status()
        dest.write_bytes(r.content)
    if etag and "-" not in etag and hashlib.md5(dest.read_bytes()).hexdigest() != etag:
        dest.unlink()
        raise ValueError(f"md5/ETag mismatch for {key}")
    return dest


def load(session: str):
    import mne
    stem = f"{SUBJECT}/{session}/eeg/{SUBJECT}_{session}_task-eyesclosed_eeg"
    fetch_s3(stem + ".fdt")
    raw = mne.io.read_raw_eeglab(fetch_s3(stem + ".set"), preload=True, verbose=False)
    raw.filter(1.0, 40.0, verbose=False)
    return raw


def main():
    from scipy.signal import welch
    raws = {s: load(s) for s in SESSIONS}
    psd, alpha = {}, {}
    for s, raw in raws.items():
        picks = [c for c in OCCIPITAL if c in raw.ch_names]
        x = raw.get_data(picks=picks) * 1e6  # V -> uV
        f, p = welch(x, fs=raw.info["sfreq"], nperseg=int(4 * raw.info["sfreq"]), axis=-1)
        pm = p.mean(axis=0)
        band = (f >= 8) & (f <= 12)
        alpha[s] = float(pm[band].mean())
        keep = (f >= 1) & (f <= 30)
        psd[s] = (f[keep], pm[keep], picks)
    ns = raws["ses-1"].copy()
    win = ns.crop(tmin=0.0, tmax=60.0, include_tmax=False).pick([c for c in WINDOW_CH if c in ns.ch_names])
    win.resample(250, verbose=False)
    data = win.get_data() * 1e6
    f_ns = psd["ses-1"][0]
    obj = {
        "meta": meta(False, ["OpenNeuro ds004902 v1.0.8, doi:10.18112/openneuro.ds004902.v1.0.8"],
                     dataset="A Resting-state EEG Dataset for Sleep Deprivation (Xiang, Fan, Bai, Lv, Lei), "
                             f"OpenNeuro ds004902, {SUBJECT}, eyes closed",
                     doi_or_url="https://doi.org/10.18112/openneuro.ds004902.v1.0.8", licence="CC0",
                     accessed=now_iso(), device_type="eeg",
                     label="Recorded on Earth with conventional EEG electrodes (not a quantum sensor). Not an astronaut.",
                     sample_rate_hz=250.0, original_sample_rate_hz=500.0, channels=win.ch_names,
                     sessions=SESSIONS, reference="FCz", system="Brain Products, 61 electrodes (dataset README)",
                     processing="band-pass 1-40 Hz, first 60 s of the normal-sleep session, MNE resampling to 250 Hz, "
                                "V converted to uV; spectra: Welch, 4 s segments, whole 300 s, mean of O1/Oz/O2"),
        "x": {"name": "time", "unit": "s", "values": [round(float(v), 4) for v in win.times]},
        "series": [{"name": f"{c} ({SESSIONS['ses-1']})", "unit": "uV", "values": [round(float(v), 3) for v in data[i]]}
                   for i, c in enumerate(win.ch_names)],
        "psd": {"x": {"name": "frequency", "unit": "Hz", "values": [round(float(v), 3) for v in f_ns]},
                "series": [{"name": f"occipital mean, {SESSIONS[s]}", "unit": "uV^2/Hz",
                            "values": [round(float(v), 4) for v in psd[s][1]]} for s in SESSIONS]},
        "alpha_8_12Hz_uV2_per_Hz": {SESSIONS[s]: round(alpha[s], 4) for s in SESSIONS},
    }
    write_json(RECORDED / "eeg_brain_ds004902.json", obj)
    log_status("data/recorded/eeg_brain_ds004902.json", "done",
               f"ds004902 {SUBJECT} eyes-closed EEG, NS and SD sessions (CC0, md5 ETag verified); alpha 8-12 Hz power "
               f"NS {alpha['ses-1']:.3f}, SD {alpha['ses-2']:.3f} uV^2/Hz (occipital mean)")
    print("wrote eeg_brain_ds004902.json", {SESSIONS[s]: round(alpha[s], 4) for s in SESSIONS})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log_status("data/recorded/eeg_brain_ds004902.json", "failed", f"{type(e).__name__}: {e}")
        raise
