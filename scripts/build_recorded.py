"""Build data/recorded/<id>.json from real open recordings (contract v10, Section 3).

Libraries (wfdb, mne, numpy) only load and process the recordings: windowing, unit conversion,
anti-aliased downsampling, averaging. Nothing is simulated or generated. If a source cannot be
fetched, the file keeps its fixture and STATUS.md says why.

Raw downloads go to SPINDRIFT_CACHE (default ~/.spindrift_cache), outside the repo and OneDrive.
"""
import hashlib
import os
import sys
from pathlib import Path

import numpy as np
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.common import RECORDED, log_status, meta, now_iso, read_json, write_json  # noqa: E402

CACHE = Path(os.environ.get("SPINDRIFT_CACHE", Path.home() / ".spindrift_cache"))
UA = {"User-Agent": "SpinDrift-data-pipeline/10 (research prototype)"}
LABEL_OPM = "Recorded on Earth with real QuSpin OPM sensors. Not an astronaut."


def fetch(url: str, dest: Path, sha256: str | None = None) -> Path:
    """Download url to dest once; verify sha256 when the publisher provides one."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        r = requests.get(url, headers=UA, timeout=120)
        r.raise_for_status()
        tmp = dest.with_suffix(dest.suffix + ".part")
        tmp.write_bytes(r.content)
        tmp.replace(dest)
    if sha256:
        h = hashlib.sha256(dest.read_bytes()).hexdigest()
        if h != sha256:
            dest.unlink()
            raise ValueError(f"sha256 mismatch for {dest.name}")
    return dest


def r3(a):
    return [round(float(v), 3) for v in a]


# ---------------------------------------------------------------- Kiel Cardio Database (OPM heart)
KIEL_BASE = "https://physionet.org/files/kiel-cardio/1.0.0/"
KIEL_SUBJECT, KIEL_TRIAL = 1, 13
KIEL_WINDOW_S = (0.0, 60.0)


def kiel_select_note():
    return (f"subject {KIEL_SUBJECT}, trial {KIEL_TRIAL}: chosen among subject {KIEL_SUBJECT}'s 25 preprocessed trials "
            "as the one with the most prominent QRS (largest ratio of the 99.5th percentile of |B| to the median "
            "|B| on any channel)")


def build_kiel():
    import wfdb
    folder = CACHE / "kiel-cardio-1.0.0"
    sums = fetch(KIEL_BASE + "SHA256SUMS.txt", folder / "SHA256SUMS.txt")
    table = dict(line.split(None, 1)[::-1] for line in sums.read_text().splitlines() if line.strip())
    table = {k.strip(): v for k, v in table.items()}
    name = f"data/subject{KIEL_SUBJECT}_preprocessed_trial{KIEL_TRIAL:02d}"
    for ext in (".hea", ".dat"):
        fetch(KIEL_BASE + name + ext, folder / (name + ext), table[name + ext])
    rec = wfdb.rdrecord(str(folder / name))
    fs = float(rec.fs)
    i0, i1 = int(KIEL_WINDOW_S[0] * fs), int(KIEL_WINDOW_S[1] * fs)
    sig = rec.p_signal[i0:i1]
    t = np.arange(i0, i1) / fs
    series = [{"name": f"ch{i} {rec.sig_name[i].replace('  ', ' ')}", "unit": rec.units[i], "values": r3(sig[:, i])}
              for i in range(rec.n_sig)]
    year = next((c.split(":")[1].strip() for c in rec.comments if "year of recording" in c), None)
    positions = [c for c in rec.comments if c.startswith("<position")]
    obj = {
        "meta": meta(False, ["Kiel Cardio Database v1.0.0, PhysioNet, doi:10.13026/q6r2-zz68"],
                     dataset="Kiel Cardio Database v1.0.0 (PhysioNet)",
                     doi_or_url="https://doi.org/10.13026/q6r2-zz68",
                     licence="CC BY-SA 4.0 (LICENSE.txt in the dataset)",
                     accessed=now_iso(), device_type="opm", label=LABEL_OPM,
                     record=name, sample_rate_hz=fs, window_s=list(KIEL_WINDOW_S),
                     selection=kiel_select_note(),
                     sensors="four QuSpin QZFM Gen 1 OPMs in two-axis mode, magnetically shielded chamber, "
                             "Kiel University (README)",
                     preprocessing="by the dataset authors: scaling by OPM sensitivity, 1 Hz high-pass, 100 Hz "
                                   "low-pass, 50 Hz band-stop (README); SpinDrift only cut a 60 s window",
                     recorded=f"May {year}" if year else "May 2022 (README)",
                     sensor_positions_cm=positions,
                     sha256={name + ".dat": table[name + ".dat"], name + ".hea": table[name + ".hea"]}),
        "x": {"name": "time", "unit": "s", "values": [round(float(v), 3) for v in t]},
        "series": series,
    }
    write_json(RECORDED / "opm_heart_kiel.json", obj)
    log_status("data/recorded/opm_heart_kiel.json", "done",
               f"{name}, 8 channels, {i1 - i0} samples at {fs:g} Hz, pT from the header; sha256 verified")
    return obj


# ---------------------------------------------------------------- MNE OPM sample (OPM brain)
MNE_WINDOW_S = 60.0
MNE_MAX_CH = 8
MNE_FS_OUT = 250.0


MNE_EXAMPLE = ("MNE-Python example 'Optically pumped magnetometer (OPM) data' "
               "(examples/datasets/opm_data.py): low-pass 90 Hz (10 Hz transition), 50 Hz notch, median-nerve "
               "trigger 257 on STI101, epochs -0.5 to 1 s, reject mag 2e-10 T")


def build_mne_opm():
    import mne
    root = Path(mne.datasets.opm.data_path(verbose=False))
    raw_path = root / "MEG" / "OPM" / "OPM_SEF_raw.fif"
    raw = mne.io.read_raw_fif(raw_path, preload=True, verbose=False)
    info = raw.info
    fs_in = float(info["sfreq"])
    mags = mne.pick_types(info, meg="mag", exclude="bads")
    picks = list(mags[:MNE_MAX_CH])
    names = [raw.ch_names[i] for i in picks]
    # The same filtering as MNE's published OPM example. The 90 Hz low-pass also makes the 4x
    # decimation to 250 Hz alias-free (Nyquist 125 Hz).
    raw.filter(None, 90, h_trans_bandwidth=10.0, verbose=False)
    raw.notch_filter(50.0, notch_widths=1, verbose=False)
    decim = int(round(fs_in / MNE_FS_OUT))
    # Evoked response from the whole recording: average of the real stimulus-locked epochs
    events = mne.find_events(raw, stim_channel="STI101", mask=257, mask_type="and", verbose=False)
    ep = mne.Epochs(raw, events, dict(Median=257), -0.5, 1.0, reject=dict(mag=2e-10), picks=picks, proj=False,
                    decim=decim, preload=True, verbose="error")
    ev = ep.average()
    evoked = {"x": {"name": "time from median-nerve stimulus", "unit": "s",
                    "values": [round(float(v), 4) for v in ev.times]},
              "series": [{"name": f"{n} evoked", "unit": "fT", "values": r3(ev.data[i] * 1e15)}
                         for i, n in enumerate(names)],
              "n_epochs": int(len(ep)), "n_triggers": int((events[:, 2] == 257).sum()),
              "note": "average of the stimulus-locked epochs that passed rejection, processed as in the "
                      + MNE_EXAMPLE + "; baseline -0.5 to 0 s; calculated from the recording itself"}
    # 60 s window of the continuous (filtered) recording, decimated 1000 -> 250 Hz
    win = raw.copy().crop(tmin=0.0, tmax=min(MNE_WINDOW_S, raw.times[-1]), include_tmax=False).pick(picks)
    data = win.get_data()[:, ::decim] * 1e15  # T -> fT
    t = win.times[::decim]
    obj = {
        "meta": meta(False, ["MNE-Python OPM sample dataset (mne.datasets.opm), file MEG/OPM/OPM_SEF_raw.fif"],
                     dataset="MNE-Python OPM sample dataset, OPM_SEF_raw.fif",
                     doi_or_url="https://mne.tools/stable/documentation/datasets.html",
                     licence=os.environ.get("SPINDRIFT_MNE_OPM_LICENCE", "no licence stated by MNE (see STATUS.md)"),
                     accessed=now_iso(), device_type="opm", label=LABEL_OPM,
                     sample_rate_hz=fs_in / decim, original_sample_rate_hz=fs_in,
                     channels=names, n_opm_channels_in_file=int(len(mags)),
                     sensors="nine QuSpin SERF OPMs over the right somatomotor area; electrical median-nerve "
                             "stimulation at the left wrist (MNE example text)",
                     recorded=str(info["meas_date"].date()) if info.get("meas_date") else None,
                     download="https://osf.io/download/p6ae7?version=2 (MNE-OPM-data.tar.gz, "
                              "md5 370ad1dcfd5c47e029e692c85358a374, from mne/datasets/config.py)",
                     processing="filtered as in the " + MNE_EXAMPLE + "; first 60 s; first 8 of the 9 OPM "
                                "channels; decimated 1000 -> 250 Hz after the 90 Hz low-pass; T converted to fT"),
        "x": {"name": "time", "unit": "s", "values": [round(float(v), 4) for v in t]},
        "series": [{"name": n, "unit": "fT", "values": r3(data[i])} for i, n in enumerate(names)],
        "evoked": evoked,
    }
    write_json(RECORDED / "opm_brain_mne.json", obj)
    log_status("data/recorded/opm_brain_mne.json", "done",
               f"{len(names)} of {len(mags)} OPM channels, {len(t)} samples at {fs_in / decim:g} Hz (from {fs_in:g} "
               f"Hz), fT; evoked from {evoked['n_epochs']} of {evoked['n_triggers']} median-nerve epochs")
    return obj


BUILDERS = {"opm_heart_kiel": build_kiel, "opm_brain_mne": build_mne_opm}


def main(only=None):
    for rid, fn in BUILDERS.items():
        if only and rid not in only:
            continue
        try:
            fn()
            print(f"built   {rid}")
        except Exception as e:
            log_status(f"data/recorded/{rid}.json", "failed", f"{type(e).__name__}: {e}; fixture kept")
            print(f"FAILED  {rid}: {type(e).__name__}: {e}")


if __name__ == "__main__":
    main(sys.argv[1:] or None)
