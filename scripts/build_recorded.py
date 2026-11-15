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
KIEL_SUBJECT, KIEL_TRIAL = 1, 3
# The first second of every preprocessed trace holds the start-up transient of the dataset's filters
# (up to ~130 pT); the 60 s window starts at 2 s to leave it out.
KIEL_WINDOW_S = (2.0, 62.0)


def kiel_select_note():
    return (f"subject {KIEL_SUBJECT}, trial {KIEL_TRIAL}: chosen among subject {KIEL_SUBJECT}'s 25 preprocessed trials "
            "as the one with the most prominent QRS (largest ratio of the 99.5th percentile of |B| to the median |B| "
            "on any channel), computed on the 2-62 s window so the filter start-up transient in the first second "
            "does not drive the choice")


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
                     licence="no licence stated (MNE dataset docs; the OSF host project 'MNE' has no licence set)",
                     credited="dataset added to MNE 0.17 by Rasmus Zetter and Eric Larson (MNE changelog); "
                              "recording lab not stated",
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


def md5_of(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def fetch_md5(url: str, dest: Path, md5: str) -> Path:
    fetch(url, dest)
    if md5_of(dest) != md5:
        dest.unlink()
        raise ValueError(f"md5 mismatch for {dest.name}")
    return dest


# ---------------------------------------------------------------- Zenodo 10629041 (NV ODMR spectra)
ZEN_URL = "https://zenodo.org/api/records/10629041/files/Raw_data.txt/content"
ZEN_MD5 = "623c6b254112b98839f8c501871f5799"
ZEN_POSITIONS = [1, 24, 47]  # first, middle and last of the 47 positions (fixed rule, not hand-picked)


def build_zenodo_odmr():
    p = fetch_md5(ZEN_URL, CACHE / "zenodo-10629041" / "Raw_data.txt", ZEN_MD5)
    lines = [l for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
    header = lines[0].lstrip("#").split("\t")
    rows = np.array([[float(v) for v in l.split("\t")] for l in lines[1:]])
    if rows.shape[1] != 48 or header[0].strip() != "MW frequency (GHz)":
        raise ValueError(f"unexpected Raw_data.txt layout: {rows.shape}, {header[0]!r}")
    f_mhz = np.round(rows[:, 0] * 1000.0, 1)
    cols = {pos: rows[:, pos] for pos in ZEN_POSITIONS}
    mean = np.mean(np.stack([cols[pos] for pos in ZEN_POSITIONS]), axis=0)
    obj = {
        "meta": meta(False, ["Zenodo 10629041, doi:10.5281/zenodo.10629041"],
                     dataset="Data for 'Determining Strain Components in a Diamond Waveguide from Zero-Field ODMR "
                             "Spectra of NV- Center Ensembles' (Alam et al.), Zenodo 10629041",
                     doi_or_url="https://doi.org/10.5281/zenodo.10629041", licence="CC BY 4.0",
                     accessed=now_iso(), device_type="nv",
                     label="Real NV-diamond ODMR spectra (lab sample, not the heart sensor).",
                     paper="Phys. Rev. Applied 22, 024055 (2024), doi:10.1103/PhysRevApplied.22.024055",
                     file="Raw_data.txt", md5=ZEN_MD5,
                     selection=f"positions {ZEN_POSITIONS} of 47 (first, middle, last) and their mean",
                     measurement="zero-field ODMR: photoluminescence counts versus microwave frequency, NV- "
                                 "ensembles at 47 positions in a laser-written diamond waveguide",
                     processing="frequency converted GHz -> MHz and rounded to 0.1 MHz (the file has float "
                                "artefacts such as 2.8209999999999997); counts unchanged; mean calculated"),
        "x": {"name": "microwave frequency", "unit": "MHz", "values": [float(v) for v in f_mhz]},
        "series": [{"name": f"position {pos}", "unit": "counts", "values": r3(cols[pos])} for pos in ZEN_POSITIONS]
                  + [{"name": f"mean of positions {', '.join(map(str, ZEN_POSITIONS))} (calculated)", "unit": "counts",
                      "values": r3(mean)}],
    }
    write_json(RECORDED / "nv_odmr_zenodo10629041.json", obj)
    log_status("data/recorded/nv_odmr_zenodo10629041.json", "done",
               f"Raw_data.txt md5 verified; {len(f_mhz)} frequencies {f_mhz[0]}-{f_mhz[-1]} MHz; positions "
               f"{ZEN_POSITIONS} + mean; CC BY 4.0")
    return obj


# ---------------------------------------------------------------- figshare c.5468838 (QD -> Rh101 FRET)
FIG_URL = "https://ndownloader.figshare.com/files/29041080"  # article 15067392 v1, part of collection v1
FIG_MD5 = "a496c01c51071bbf4323a2e4f1d6c2ed"
ATM_GPA = 101325e-9  # 1 atm in GPa (exact by definition)


def build_figshare_fret():
    import pymupdf
    p = fetch_md5(FIG_URL, CACHE / "figshare-c5468838" / "5362541_v1.pdf", FIG_MD5)
    doc = pymupdf.open(p)
    text = next(pg.get_text() for pg in doc if "Table S1" in pg.get_text() and "FRET efficiency (%)" in pg.get_text())
    tail = text.split("FRET efficiency (%)", 1)[1].split()
    rows = []
    i = 0
    while i + 3 < len(tail) and len(rows) < 5:
        tok = tail[i]
        if tok == "1" and tail[i + 1] == "atm":
            press, i = ATM_GPA, i + 2
        else:
            try:
                press, i = float(tok), i + 1
            except ValueError:
                break
        rows.append((press, float(tail[i]), float(tail[i + 1]), float(tail[i + 2])))
        i += 3
    if len(rows) != 5:
        raise ValueError(f"Table S1 parse found {len(rows)} rows, expected 5")
    press, qd, qdrh, eff = (list(c) for c in zip(*rows))
    obj = {
        "meta": meta(False, ["figshare collection doi:10.6084/m9.figshare.c.5468838.v1 (Supplement 1, Table S1)"],
                     dataset="Li et al., 'Förster resonance energy transfer outpaces Auger recombination in CdTe/CdS "
                             "quantum dots-rhodamine101 molecules system upon compression', supplementary document",
                     doi_or_url="https://doi.org/10.6084/m9.figshare.c.5468838.v1",
                     licence="CC BY 4.0 (figshare article 15067392; also on the paper's cover page)",
                     accessed=now_iso(), device_type="qd",
                     label="CdTe/CdS quantum dots, not the renin sensor.",
                     paper="Optics Express 29(17), 27171 (2021), doi:10.1364/OE.434341",
                     file="5362541.pdf (article 15067392 v1)", md5=FIG_MD5,
                     source_table="Table S1, p. 5: emission intensity of QDs alone and of QDs-Rh101 complexes, and "
                                  "FRET efficiency, in aqueous solution at different pressures",
                     note="The deposit holds no spectra or decay curves as numbers, only this table and Table S2 "
                          "(lifetimes). Intensity units are not stated in the source. 1 atm is written as "
                          "0.000101325 GPa. The supplement gives E = 1 - F_DA/F_D."),
        "x": {"name": "pressure", "unit": "GPa", "values": press},
        "series": [{"name": "emission intensity, QDs alone", "unit": "a.u. (unit not stated)", "values": qd},
                   {"name": "emission intensity, QDs-Rh101 complexes", "unit": "a.u. (unit not stated)",
                    "values": qdrh},
                   {"name": "FRET efficiency", "unit": "%", "values": eff}],
    }
    write_json(RECORDED / "qd_fret_figshare5468838.json", obj)
    log_status("data/recorded/qd_fret_figshare5468838.json", "done",
               "deposit has no numeric spectra/decay curves; used the published Table S1 (5 pressures: QD and "
               "QD-Rh101 emission intensity, FRET efficiency) from the CC BY 4.0 supplement, md5 verified")
    return obj


# ---------------------------------------------------------------- Mendeley cmfbrvrb8y (carbon-dot PL)
MEN_URL = ("https://data.mendeley.com/public-files/datasets/cmfbrvrb8y/files/"
           "8d46db78-b236-4b19-b562-fffa08a17223/file_downloaded")
MEN_SHA256 = "423928a92aea8a2074c50273d85b3206077d2058821d0449d2a2eaa1bca99617"
MEN_CSV = "data/external_validation/external_measurement_level_records.csv"


def build_mendeley_cqd():
    import csv
    import io
    import zipfile
    p = fetch(MEN_URL, CACHE / "mendeley-cmfbrvrb8y" / "Supplementary_Public_Data_and_Code_for_Carbon_Dot_PL_Prediction.zip",
              MEN_SHA256)
    z = zipfile.ZipFile(p)
    name = next(n for n in z.namelist() if n.endswith(MEN_CSV))
    rows = list(csv.DictReader(io.TextIOWrapper(z.open(name), encoding="utf-8-sig")))
    kept = [r for r in rows if r["is_no_emission"] == "False" and r["excitation_nm"] and r["measured_emission_nm"]]
    obj = {
        "meta": meta(False, ["Mendeley Data doi:10.17632/cmfbrvrb8y.1"],
                     dataset="Cui, 'Public data and representative code for literature-reconstructed carbon-dot "
                             "photoluminescence prediction' (Mendeley Data, v1, July 2026), "
                             "external_measurement_level_records.csv",
                     doi_or_url="https://doi.org/10.17632/cmfbrvrb8y.1", licence="CC BY 4.0",
                     accessed=now_iso(), device_type="cqd",
                     label="General carbon-dot data, not the patch.",
                     file=name, zip_sha256=MEN_SHA256, plot_hint="scatter",
                     note=f"The deposit has no photoluminescence spectra. These are the authors' own validation "
                          f"syntheses (180 °C, 6 h, 10 mL water): excitation wavelength and measured emission "
                          f"maximum per record, in file order. {len(rows) - len(kept)} of {len(rows)} records report "
                          f"no emission and are left out. The literature-mined demo table (emission maxima only, "
                          f"sources redacted) is not used."),
        "x": {"name": "excitation wavelength", "unit": "nm", "values": [float(r["excitation_nm"]) for r in kept]},
        "series": [{"name": "measured emission maximum", "unit": "nm",
                    "values": [float(r["measured_emission_nm"]) for r in kept]}],
    }
    write_json(RECORDED / "cqd_pl_mendeley_cmfbrvrb8y.json", obj)
    log_status("data/recorded/cqd_pl_mendeley_cmfbrvrb8y.json", "done",
               f"zip sha256 verified; deposit has no PL spectra, so used the {len(kept)} first-hand external "
               f"measurement records (excitation nm vs measured emission max nm); CC BY 4.0")
    return obj


BUILDERS = {"opm_heart_kiel": build_kiel, "opm_brain_mne": build_mne_opm,
            "nv_odmr_zenodo10629041": build_zenodo_odmr, "qd_fret_figshare5468838": build_figshare_fret,
            "cqd_pl_mendeley_cmfbrvrb8y": build_mendeley_cqd}


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
