"""Lean-decided measurability verdicts for POST /api/verdict (CryoLean pattern).

Python builds one requirement set per sensor and body signal from sourced SpinDrift data and the request's inputs,
converts every number to an exact fraction (fractions.Fraction, from the decimal text) and runs the compiled Lean
checker lean/.lake/build/bin/spindrift-check (lean/Main.lean, definitions in lean/SpinDrift/Checker.lean, proofs in
lean/SpinDrift/Soundness.lean). Python never decides pass or fail: every `holds` value and every verdict in the
response is copied from Lean's output. If the binary is missing or fails, LeanUnavailable is raised and no verdict is
returned.

Rules at the Python -> Lean boundary
- Only a VERIFIED value that is a number is sent. null, NOT_STATED, NOT_YET_EXTRACTED and TO_CONFIRM values are sent as
  `?` (missing), so missing or unconfirmed data never becomes a pass or a fail (Lean: missing_never_decides).
- A datasheet bound such as "<15" is sent as its bound (15) and labelled. Using the upper bound of a noise density is
  safe for REQUIREMENTS_MET (Lean: holds_mono_lhs); NOT_MET then means "not met at the bound".
- Units are converted only by exact SI prefixes (1 pT = 1000 fT). Nothing that would need an unsourced number is
  converted: renin is asked for in pM, the unit of the paper's detection limit.
- User inputs carry origin "user_input" (or "app_default" for the no-shield default) and the contract tag "user_input"
  (added to the contract for values a person types: a what-if value, not a measurement).
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import subprocess
from dataclasses import dataclass, field
from decimal import Decimal, localcontext
from fractions import Fraction
from pathlib import Path

from server.common import DATA, RECORDED, ROOT, calc, missing, now_iso, read_json, vo

LEAN_DIR = ROOT / "lean"
BIN_DIR = LEAN_DIR / ".lake" / "build" / "bin"
BIN_NAMES = ("spindrift-check.exe", "spindrift-check")
PROOFS_FILE = DATA / "lean_proofs.json"
VERDICTS = ("REQUIREMENTS_MET", "NOT_MET", "NEED_MORE_INFORMATION")
STANDARD_AXIOMS = ["Classical.choice", "Quot.sound", "propext"]
CHECK_IDS = ["opm_brain", "opm_heart", "nv_heart_jgu", "nv_heart_zaquant", "nv_heart_qant", "qd_blood", "cqd_skin"]
NV_BUILDS = {"nv_heart_jgu": ("jgu", "JGU"), "nv_heart_zaquant": ("zaquant", "ZAQuant"),
             "nv_heart_qant": ("qant", "Q.ANT")}
USER_TAG = "user_input"
INPUT_NAMES = ["shielding_factor", "beats_averaged", "snr_required", "target", "renin", "bilirubin_isf", "bandwidth_hz"]
OMAR = "Omar et al., arXiv 2601.18843 (2026)"

# Theorems cited on the cards (full names; statements and axioms come from data/lean_proofs.json).
VERDICT_THEOREMS = {
    "REQUIREMENTS_MET": ["SpinDrift.verdict_met_iff", "SpinDrift.verdict_met_spec", "SpinDrift.holds_true_iff"],
    "NOT_MET": ["SpinDrift.verdict_notMet_sound", "SpinDrift.verdict_notMet_spec", "SpinDrift.holds_false_iff"],
    "NEED_MORE_INFORMATION": ["SpinDrift.verdict_needInfo_sound", "SpinDrift.verdict_needInfo_spec",
                              "SpinDrift.holds_none_iff", "SpinDrift.missing_never_decides"],
}
SNR_THEOREMS = ["SpinDrift.Q.le_mul_self_iff", "SpinDrift.snr_averaging"]
BOUND_THEOREMS = ["SpinDrift.holds_mono_lhs"]


class LeanUnavailable(RuntimeError):
    """The Lean checker could not produce verdicts (binary missing, crashed, refused the input or answered oddly)."""


# ----------------------------------------------------------------------------------------------- exact numbers
_DEC = re.compile(r"^[+]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$")
_BOUND = re.compile(r"^\s*(<|≤|<=)\s*(\d+(?:\.\d+)?)\s*$")


def exact(x) -> Fraction:
    """The exact value of a number as written (floats via their shortest decimal text, which is what json wrote)."""
    if isinstance(x, bool):
        raise ValueError("a boolean is not a number")
    if isinstance(x, int):
        return Fraction(x)
    if isinstance(x, float):
        if not math.isfinite(x):
            raise ValueError("non-finite number")
        return Fraction(repr(x))
    if isinstance(x, Decimal):
        return Fraction(x)
    if isinstance(x, str) and _DEC.match(x.strip()):
        return Fraction(x.strip())
    raise ValueError(f"not a plain number: {x!r}")


def plain(fr: Fraction):
    """A VO value for an exact fraction: an int when whole, otherwise the nearest float (display only)."""
    return int(fr) if fr.denominator == 1 else float(fr)


def decimal_text(fr: Fraction) -> str:
    """Six significant digits, for display only; Lean decided on the exact fraction."""
    if fr.denominator == 1:
        return str(fr.numerator)
    with localcontext() as ctx:
        ctx.prec = 40
        return format(Decimal(fr.numerator) / Decimal(fr.denominator), ".6g")


def _unit_ok(unit: str, expect: str) -> bool:
    return (unit or "").split(" (")[0].strip() == expect


# ----------------------------------------------------------------------------------------------- factors
@dataclass
class Factor:
    id: str                     # key path of the value, e.g. specs.opm.sensitivity_dual_axis
    symbol: str                 # its symbol in the formula
    vo: dict                    # the value object as sourced (or the user's input)
    value: Fraction | None      # exact value sent to Lean; None is sent as ? (missing)
    unit: str                   # unit of the value sent to Lean
    origin: str                 # spindrift_source | user_input | app_default
    read_as: str                # how the value was read, or why it counts as missing
    extra: dict = field(default_factory=dict)

    @property
    def token(self) -> str:
        if self.value is None:
            return "?"
        if self.value < 0:
            raise ValueError(f"{self.id}: the checker takes non-negative numbers only")
        return f"{self.value.numerator}/{self.value.denominator}"

    def entry(self) -> dict:
        return {**self.vo, "id": self.id, "symbol": self.symbol, "origin": self.origin, "lean_factor": self.token,
                "lean_unit": self.unit, "read_as": self.read_as, **self.extra}


def source_factor(id_: str, symbol: str, v: dict | None, expect_unit: str, bound_ok: bool = False,
                  scale: Fraction = Fraction(1), unit: str | None = None, absolute: bool = False,
                  how: str | None = None, extra: dict | None = None) -> Factor:
    """A factor read from a sourced VO. Only a VERIFIED number is used; anything else is sent as missing."""
    unit = unit or expect_unit
    if v is None:
        v = missing(expect_unit, f"{id_}: not in the SpinDrift data", "published_spec", "NOT_YET_EXTRACTED")
        return Factor(id_, symbol, v, None, unit, "spindrift_source", "not in the data: counted as missing", extra or {})
    status, val = v.get("status"), v.get("value")
    if status != "VERIFIED":
        return Factor(id_, symbol, v, None, unit, "spindrift_source", f"status {status}: counted as missing", extra or {})
    if val is None:
        return Factor(id_, symbol, v, None, unit, "spindrift_source", "value null: counted as missing", extra or {})
    if not _unit_ok(v.get("unit", ""), expect_unit):
        return Factor(id_, symbol, v, None, unit, "spindrift_source",
                      f"unit '{v.get('unit')}' is not '{expect_unit}'; not converted, counted as missing", extra or {})
    read = how or "read as written"
    if isinstance(val, str):
        m = _BOUND.match(val)
        if m and bound_ok:
            fr = Fraction(m.group(2))
            read = f"datasheet upper bound '{val}' read as {m.group(2)} (the largest value the datasheet allows)"
        else:
            try:
                fr = exact(val)
            except ValueError:
                return Factor(id_, symbol, v, None, unit, "spindrift_source",
                              f"value '{val}' is not a single number: counted as missing", extra or {})
    else:
        fr = exact(val)
    if absolute:
        fr = abs(fr)
    fr = fr * scale
    return Factor(id_, symbol, v, fr, unit, "spindrift_source", read, extra or {})


def user_factor(name: str, symbol: str, value, unit: str, note: str | None = None,
                default=None, default_note: str | None = None) -> Factor:
    """A factor typed by the user (or the stated app default). A value that is not given is missing."""
    id_ = f"inputs.{name}"
    if value is None and default is not None:
        v = vo(default, unit, f"SpinDrift app default ({default_note})", USER_TAG, "VERIFIED", None, default_note)
        return Factor(id_, symbol, v, exact(default), unit, "app_default", f"app default: {default_note}")
    if value is None:
        v = missing(unit, f"user input (POST /api/verdict inputs.{name}): not given", USER_TAG, "NOT_STATED", note)
        return Factor(id_, symbol, v, None, unit, "user_input", "not given: counted as missing")
    fr = exact(value)
    v = vo(plain(fr), unit, f"user input (POST /api/verdict inputs.{name})", USER_TAG, "VERIFIED", None, note)
    return Factor(id_, symbol, v, fr, unit, "user_input", "read as entered")


# ----------------------------------------------------------------------------------------------- requirements
@dataclass
class Requirement:
    id: str
    text: str
    formula: str
    lhs: list[Factor]
    rhs: list[Factor]
    unit: str
    note: str | None = None
    theorems: list[str] = field(default_factory=list)

    def line(self) -> str:
        return " ".join(["req", self.id, *[f.token for f in self.lhs], "<=", *[f.token for f in self.rhs]])

    def factors(self) -> list[Factor]:
        seen, out = set(), []
        for f in self.lhs + self.rhs:
            if f.id not in seen:
                seen.add(f.id)
                out.append(f)
        return out


def snr_requirement(rid: str, text: str, snr: Factor, eta: Factor, bw: Factor, amp: Factor, n: Factor, unit: str,
                    note: str, bound: bool) -> Requirement:
    return Requirement(rid, text, "snr² · η² · BW ≤ A² · N  (the averaged SNR A·√N / (η·√BW) is at least snr)",
                       [snr, snr, eta, eta, bw], [amp, amp, n], unit, note,
                       SNR_THEOREMS + (BOUND_THEOREMS if bound else []))


# ----------------------------------------------------------------------------------------------- sourced signals
_BRAIN_CACHE: dict = {}


def brain_signal() -> tuple[dict, dict, dict]:
    """Peak |evoked field| after the stimulus in the real MNE OPM recording, and its number of averaged epochs."""
    path = RECORDED / "opm_brain_mne.json"
    src = "data/recorded/opm_brain_mne.json (MNE-Python OPM sample dataset, OPM_SEF_raw.fif; evoked average)"
    try:
        mtime = path.stat().st_mtime
    except FileNotFoundError:
        mtime = None
    if mtime is not None and _BRAIN_CACHE.get("mtime") == mtime:
        return _BRAIN_CACHE["value"]
    rec = read_json(path, {}) or {}
    ev = rec.get("evoked") or {}
    xs = (ev.get("x") or {}).get("values") or []
    best = None
    for s in ev.get("series") or []:
        vals = s.get("values") or []
        if len(vals) != len(xs) or s.get("unit") != "fT":
            continue
        for t, v in zip(xs, vals):
            if v is None or t is None or t <= 0:
                continue
            if best is None or abs(v) > abs(best[0]):
                best = (v, s.get("name"), t)
    if best is None:
        amp = missing("fT", src, "calculated", "NOT_YET_EXTRACTED", "no evoked series in the recording file")
        info = {}
    else:
        name = (best[1] or "").replace(" evoked", "")
        amp = calc(abs(best[0]), "fT", [], "max over channels and samples at t > 0 s of |evoked B|",
                   ["recorded/opm_brain_mne.json evoked.series (8 OPM channels)", "evoked.x"], source=src,
                   note_extra=f"peak on channel {name} at {best[2]} s after the median-nerve stimulus; "
                              f"recorded {rec.get('meta', {}).get('recorded')} on Earth, not an astronaut")
        info = {"channel": name, "latency_s": best[2], "signed_value_fT": best[0]}
    n_ep = ev.get("n_epochs")
    if isinstance(n_ep, int) and n_ep > 0:
        n = vo(n_ep, "epochs", "data/recorded/opm_brain_mne.json evoked.n_epochs", "calculated", "VERIFIED", None,
               "formula: count of stimulus-locked epochs that passed rejection, averaged into the evoked response; "
               "inputs: recorded/opm_brain_mne.json")
    else:
        n = missing("epochs", "data/recorded/opm_brain_mne.json evoked.n_epochs", "calculated", "NOT_YET_EXTRACTED")
    out = (amp, n, info)
    if mtime is not None:
        _BRAIN_CACHE.update({"mtime": mtime, "value": out})
    return out


# ----------------------------------------------------------------------------------------------- the Lean checker
def binary_path() -> Path | None:
    for name in BIN_NAMES:
        p = BIN_DIR / name
        if p.is_file():
            return p
    return None


def trusted_sources() -> list[Path]:
    """The Lean files whose definitions and proofs the verdicts rest on."""
    files = [LEAN_DIR / "SpinDrift.lean", LEAN_DIR / "Main.lean", *(LEAN_DIR / "SpinDrift").glob("*.lean")]
    return sorted((p for p in files if p.is_file()), key=lambda p: p.relative_to(LEAN_DIR).as_posix())


def source_sha256() -> str:
    """SHA-256 over the trusted Lean sources (relative path and bytes of each, in path order)."""
    h = hashlib.sha256()
    for p in trusted_sources():
        h.update(p.relative_to(LEAN_DIR).as_posix().encode("utf-8"))
        h.update(b"\0")
        h.update(p.read_bytes())
        h.update(b"\0")
    return h.hexdigest()


def file_sha256(p: Path | None) -> str | None:
    return hashlib.sha256(p.read_bytes()).hexdigest() if p and p.is_file() else None


def run_checker(text: str, timeout: float = 60) -> dict:
    b = binary_path()
    if b is None:
        raise LeanUnavailable("Lean checker binary not found under lean/.lake/build/bin/; run `cd lean && lake build`")
    kw = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
    try:
        p = subprocess.run([str(b)], input=text, capture_output=True, text=True, encoding="utf-8", timeout=timeout,
                           **kw)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise LeanUnavailable(f"Lean checker failed to run: {type(e).__name__}: {e}")
    try:
        out = json.loads(p.stdout.strip().splitlines()[-1])
    except (json.JSONDecodeError, IndexError):
        raise LeanUnavailable(f"Lean checker output unreadable (exit {p.returncode}): "
                              f"{p.stdout[:300]!r} {p.stderr[:300]!r}")
    if p.returncode != 0 or out.get("error") or not isinstance(out.get("checks"), list):
        raise LeanUnavailable(f"Lean checker refused the input (exit {p.returncode}): {out.get('error')} "
                              f"(line {out.get('line')})")
    return out


def _validate(out: dict, checks: dict[str, list[Requirement]]) -> dict[str, dict]:
    """Lean's answer must cover exactly the checks and requirements that were sent, in order."""
    got = {c.get("id"): c for c in out["checks"]}
    if [c.get("id") for c in out["checks"]] != list(checks):
        raise LeanUnavailable("Lean checker answered for different checks than were sent")
    for cid, reqs in checks.items():
        c = got[cid]
        if c.get("verdict") not in VERDICTS:
            raise LeanUnavailable(f"unexpected verdict {c.get('verdict')!r} for {cid}")
        if [r.get("id") for r in c.get("requirements", [])] != [r.id for r in reqs]:
            raise LeanUnavailable(f"Lean checker answered for different requirements in {cid}")
        if any(r.get("holds") not in (True, False, None) for r in c["requirements"]):
            raise LeanUnavailable(f"unexpected holds value in {cid}")
    return got


def proofs_audit() -> tuple[dict, dict]:
    """Theorem statements and axioms from data/lean_proofs.json (written by scripts/build_lean.py), and whether that
    audit still matches the current Lean sources and binary."""
    proofs = read_json(PROOFS_FILE, {}) or {}
    by_name = {}
    for t in proofs.get("theorems", []):
        full = t.get("full_name") or f"SpinDrift.{t.get('name')}"
        by_name[full] = t
    chk = proofs.get("checker") or {}
    if not chk:
        status = "missing"
    elif chk.get("source_sha256") == source_sha256() and chk.get("binary_sha256") == file_sha256(binary_path()):
        status = "current"
    else:
        status = "stale"
    return by_name, {"status": status, "file": "data/lean_proofs.json",
                     "generated_at": (proofs.get("meta") or {}).get("generated_at"),
                     "selftest": chk.get("selftest"),
                     "how_to_check": "cd lean && lake build && lake env lean Check.lean && "
                                     ".lake/build/bin/spindrift-check --selftest"}


# ----------------------------------------------------------------------------------------------- requirement sets
def _ambient(location: str, live: dict) -> Factor:
    ready = (live or {}).get("opm_readiness") or {}
    amb = (ready.get(location) or {}).get("ambient_nT")
    return source_factor(f"live_snapshot.opm_readiness.{location}.ambient_nT", "B_ambient", amb, "nT")


def _compensation(specs: dict) -> Factor:
    opm = specs.get("opm") or {}
    key = next((k for k in opm if "compensation" in k.lower()), None)
    if key is None:
        v = missing("nT", "specs.opm: no on-board field-compensation key", "datasheet", "NOT_YET_EXTRACTED",
                    "specs.json has no QZFM Gen-3 field-compensation limit. QuSpin's statement about the built-in "
                    "coils appears only as note text (data/live_snapshot.json opm_readiness.*.opm_range_nT.note) and "
                    "in data/build_log.json, not as a specs.json value, so it is not used.")
        return Factor("specs.opm.<field_compensation_limit>", "B_comp", v, None, "nT", "spindrift_source",
                      "not in specs.json: counted as missing")
    return source_factor(f"specs.opm.{key}", "B_comp", opm[key], "nT")


def _heart_amp(nvh: dict, target: str, to_fT: bool) -> Factor:
    key = "q_wave_pT" if target == "q_wave" else "r_peak_pT"
    v = (nvh.get("averaged_beat") or {}).get(key)
    if to_fT:
        return source_factor(f"nv_heart_derived.averaged_beat.{key}", "A", v, "pT", scale=Fraction(1000), unit="fT",
                             absolute=True, how="|value| in pT × 1000 fT/pT (exact SI prefix)")
    return source_factor(f"nv_heart_derived.averaged_beat.{key}", "A", v, "pT", absolute=True,
                         how="|value| in pT (amplitude of the averaged beat)")


def build_checks(location: str, inp: dict, live: dict) -> tuple[dict[str, list[Requirement]], dict]:
    specs = read_json(DATA / "specs.json", {}) or {}
    nvh = read_json(DATA / "nv_heart_derived.json", {}) or {}
    target = inp.get("target") or "r_peak"
    sig_name = "Q wave" if target == "q_wave" else "R-peak"

    shield = user_factor("shielding_factor", "S", inp.get("shielding_factor"), "×",
                         "field outside the sensor divided by the field at the sensor",
                         default=1, default_note="no shield, shielding factor 1")
    snr = user_factor("snr_required", "snr", inp.get("snr_required"), "",
                      "signal-to-noise ratio (amplitude) the measurement must reach")
    n_beats = user_factor("beats_averaged", "N", inp.get("beats_averaged"), "beats", "heartbeats averaged")
    opm = specs.get("opm") or {}
    eta_opm = source_factor("specs.opm.sensitivity_dual_axis", "η", opm.get("sensitivity_dual_axis"), "fT/√Hz",
                            bound_ok=True)
    if inp.get("bandwidth_hz") is not None:
        bw_opm = user_factor("bandwidth_hz", "BW", inp.get("bandwidth_hz"), "Hz", "measurement bandwidth")
    else:
        bw_opm = source_factor("specs.opm.bandwidth_serf_class", "BW", opm.get("bandwidth_serf_class"), "Hz")
        bw_opm.read_as += "; enter inputs.bandwidth_hz"

    field_note = ("B_ambient is the field outside the spacecraft or habitat (live_snapshot opm_readiness); fields "
                  "inside a cabin are larger. The QZFM ±5 nT dynamic range (specs.opm.dynamic_range) is the "
                  "operating range after nulling, not the compensation limit. Checked as B_ambient ≤ B_comp × S, "
                  "the same as B_ambient / S ≤ B_comp for S > 0.")
    field_req = lambda: Requirement(  # noqa: E731
        "opm_field_nulled", "The field at the sensor can be nulled by the OPM's on-board coils: ambient field ÷ "
        "shielding factor must not exceed the on-board field-compensation limit.",
        "B_ambient ≤ B_comp × S", [_ambient(location, live)], [_compensation(specs), shield], "nT", field_note)
    opm_noise_note = ("η: the QZFM Gen-3 datasheet states the dual-axis sensitivity as '<15 fT/√Hz (3–100 Hz)'; the "
                      "bound is used, so REQUIREMENTS_MET holds for any lower noise (holds_mono_lhs) and NOT_MET means "
                      "not met at the bound. The noise density is stated for 3–100 Hz, so BW should lie in that band. "
                      "BW: specs.opm.bandwidth_serf_class is a TO_CONFIRM class figure (not the Gen-3 datasheet), so "
                      "BW comes from inputs.bandwidth_hz.")

    amp_b, n_b, info_b = brain_signal()
    amp_brain = source_factor("recorded.opm_brain_mne.evoked.peak_abs_fT", "A", amp_b, "fT", extra=info_b)
    n_brain = source_factor("recorded.opm_brain_mne.evoked.n_epochs", "N", n_b, "epochs")

    checks: dict[str, list[Requirement]] = {
        "opm_brain": [field_req(), snr_requirement(
            "opm_snr_brain", "The averaged evoked brain field reaches the required SNR at the datasheet noise bound.",
            snr, eta_opm, bw_opm, amp_brain, n_brain, "fT²",
            "A: peak |evoked field| after the stimulus in the MNE OPM recording (Earth, QuSpin OPMs), N its averaged "
            "epochs. " + opm_noise_note, bound=True)],
        "opm_heart": [field_req(), snr_requirement(
            "opm_snr_heart", f"The averaged heart {sig_name} reaches the required SNR at the datasheet noise bound.",
            snr, eta_opm, bw_opm, _heart_amp(nvh, target, to_fT=True), n_beats, "fT²",
            f"A: |{sig_name}| of the averaged beat from the Kiel OPM heart recording (nv_heart_derived), converted "
            "exactly from pT to fT; N: inputs.beats_averaged. " + opm_noise_note, bound=True)],
    }
    nv = specs.get("nv") or {}
    bw_nv = source_factor("specs.nv.headline.bandwidth_assumed", "BW", (nv.get("headline") or {}).get("bandwidth_assumed"),
                          "Hz")
    for cid, (key, label) in NV_BUILDS.items():
        build = nv.get(key) or {}
        paper_n = (build.get("beats_averaged") or {}).get("value")
        checks[cid] = [snr_requirement(
            "nv_snr", f"The averaged heart {sig_name} reaches the required SNR with the {label} build's published "
                      "noise density.",
            snr, source_factor(f"specs.nv.{key}.sensitivity", "η", build.get("sensitivity"), "pT/√Hz"), bw_nv,
            _heart_amp(nvh, target, to_fT=False), n_beats, "pT²",
            f"η: {OMAR}, Table 2. BW: the paper's 'approximately 30 Hz' (specs.nv.headline.bandwidth_assumed). A: "
            f"|{sig_name}| of the averaged beat from the Kiel OPM heart recording (a different person and geometry "
            "from the NV studies; the paper reports average R-peaks in specs.nv.headline.r_peak_average). N: "
            f"inputs.beats_averaged (the paper averaged {paper_n} beats for this build, "
            f"specs.nv.{key}.beats_averaged).", bound=False)]

    qd = specs.get("qd_renin") or {}
    lod_qd = source_factor("specs.qd_renin.detection_limit", "LOD", qd.get("detection_limit"), "pM")
    renin = user_factor("renin", "c_renin", inp.get("renin"), "pM", "renin concentration in pM")
    checks["qd_blood"] = [Requirement(
        "qd_renin_above_lod", "The renin concentration is at or above the nanosensor's stated detection limit.",
        "LOD ≤ c_renin", [lod_qd], [renin], "pM",
        "Enter renin in pM, the unit of the detection limit in Long et al. (2012). SpinDrift does not convert from mass "
        "or activity units: that would need a molar mass or specific activity that is not in its sources. The linear "
        "range (specs.qd_renin.linear_range) is not yet extracted.")]

    cqd = specs.get("cqd_patch") or {}
    bili_unit = "" if (cqd.get("range") or {}).get("status") != "VERIFIED" else (cqd["range"].get("unit") or "")
    bili = user_factor("bilirubin_isf", "c_bilirubin", inp.get("bilirubin_isf"), bili_unit,
                       "bilirubin in skin interstitial fluid, in the unit of the patch's stated range")
    rng, lod = cqd.get("range"), cqd.get("detection_limit")
    lo = hi = None
    if rng and rng.get("status") == "VERIFIED" and isinstance(rng.get("value"), str):
        m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\s*$", rng["value"])
        if m:
            lo, hi = m.group(1), m.group(2)
    cqd_note = ("Tabatabaee et al. (2024): the detection range and limit of detection are not yet extracted "
                "(paywalled full text), so Lean cannot decide; enter bilirubin_isf in the unit of the range once it is "
                "extracted. No conversion is made.")
    if lo is not None:
        r_unit = rng.get("unit") or ""
        lo_f = Factor("specs.cqd_patch.range (low end)", "range_low", rng, Fraction(lo), r_unit, "spindrift_source",
                      f"low end of '{rng['value']}'")
        hi_f = Factor("specs.cqd_patch.range (high end)", "range_high", rng, Fraction(hi), r_unit, "spindrift_source",
                      f"high end of '{rng['value']}'")
        cqd_reqs = [Requirement("cqd_range_low", "Bilirubin is at or above the low end of the patch's stated range.",
                                "range_low ≤ c_bilirubin", [lo_f], [bili], r_unit),
                    Requirement("cqd_range_high", "Bilirubin is at or below the high end of the patch's stated range.",
                                "c_bilirubin ≤ range_high", [bili], [hi_f], r_unit)]
    elif lod and lod.get("status") == "VERIFIED" and lod.get("value") is not None:
        cqd_reqs = [Requirement("cqd_above_lod", "Bilirubin is at or above the patch's stated limit of detection.",
                                "LOD ≤ c_bilirubin",
                                [source_factor("specs.cqd_patch.detection_limit", "LOD", lod, lod.get("unit") or "")],
                                [bili], lod.get("unit") or "")]
    else:
        lo_f = source_factor("specs.cqd_patch.range", "range_low", rng, "")
        hi_f = source_factor("specs.cqd_patch.range", "range_high", rng, "")
        lod_f = source_factor("specs.cqd_patch.detection_limit", "LOD", lod, "")
        cqd_reqs = [Requirement("cqd_range_low", "Bilirubin is at or above the low end of the patch's stated detection "
                                "range (or its limit of detection).", "range_low ≤ c_bilirubin",
                                [lo_f], [bili], "", cqd_note + " The limit of detection is also not extracted: "
                                + lod_f.read_as + "."),
                    Requirement("cqd_range_high", "Bilirubin is at or below the high end of the patch's stated "
                                "detection range.", "c_bilirubin ≤ range_high", [bili], [hi_f], "", cqd_note)]
    checks["cqd_skin"] = cqd_reqs

    inputs_used = {
        "shielding_factor": {**shield.vo, "origin": shield.origin},
        "beats_averaged": {**n_beats.vo, "origin": n_beats.origin},
        "snr_required": {**snr.vo, "origin": snr.origin},
        "target": {"value": target, "origin": "user_input" if inp.get("target") else "app_default",
                   "allowed": ["r_peak", "q_wave"]},
        "renin": {**renin.vo, "origin": renin.origin},
        "bilirubin_isf": {**bili.vo, "origin": bili.origin},
        "bandwidth_hz": ({**bw_opm.vo, "origin": bw_opm.origin} if inp.get("bandwidth_hz") is not None else
                         {**missing("Hz", "user input (POST /api/verdict inputs.bandwidth_hz): not given", USER_TAG,
                                    "NOT_STATED", "the OPM cards need it; the NV cards use the paper's bandwidth"),
                          "origin": "user_input"}),
    }
    return checks, inputs_used


# ----------------------------------------------------------------------------------------------- response
def _side(frac_text: str | None, unit: str) -> dict | None:
    if frac_text is None:
        return None
    fr = Fraction(frac_text)
    return {"exact": frac_text, "decimal": decimal_text(fr), "unit": unit,
            "note": "exact value computed by Lean; decimal rounded to 6 significant digits for display"}


def _missing_list(req: Requirement) -> list[dict]:
    return [{"symbol": f.symbol, "id": f.id, "why": f.read_as} for f in req.factors() if f.value is None]


def _reason(verdict: str, reqs: list[dict]) -> str:
    def side(s):
        return f"{s['decimal']} {s['unit']}".strip() if s else "missing"
    if verdict == "NOT_MET":
        bad = [r for r in reqs if r["holds"] is False]
        return ("Lean found a requirement violated with every input present: " + "; ".join(
            f"{r['id']}: {r['formula'].split('  (')[0]} gives {side(r['lhs'])} > {side(r['rhs'])}" for r in bad) + ".")
    if verdict == "NEED_MORE_INFORMATION":
        und = [r for r in reqs if r["holds"] is None]
        return ("Lean found no violated requirement, but " + ("this requirement lacks" if len(und) == 1 else
                "these requirements lack") + " an input: " + "; ".join(
            f"{r['id']} (missing: {', '.join(m['symbol'] + ' from ' + m['id'] for m in r['missing'])})" for r in und) +
            ". Missing or unconfirmed values never count as a pass or a fail.")
    return ("Lean checked every requirement and each one holds: " + "; ".join(
        f"{r['id']}: {side(r['lhs'])} ≤ {side(r['rhs'])}" for r in reqs) + ".")


CARD_INFO = {
    "opm_brain": ("QuSpin QZFM Gen-3 optically pumped magnetometer", "brain: somatosensory evoked field"),
    "opm_heart": ("QuSpin QZFM Gen-3 optically pumped magnetometer", "heart: magnetocardiogram"),
    "nv_heart_jgu": ("NV-diamond magnetometer, JGU build (Omar et al. 2026)", "heart: magnetocardiogram"),
    "nv_heart_zaquant": ("NV-diamond magnetometer, ZAQuant build (Omar et al. 2026)", "heart: magnetocardiogram"),
    "nv_heart_qant": ("NV-diamond magnetometer, Q.ANT build (Omar et al. 2026)", "heart: magnetocardiogram"),
    "qd_blood": ("quantum-dot renin nanosensor (Long et al. 2012)", "blood: renin concentration"),
    "cqd_skin": ("carbon-dot microneedle bilirubin patch (Tabatabaee et al. 2024)",
                 "skin: bilirubin in interstitial fluid"),
}


def build(location: str, inputs: dict, live: dict | None = None, location_origin: str = "user_input") -> dict:
    """Run every check through Lean and return the verdict cards."""
    inp = {k: inputs.get(k) for k in INPUT_NAMES}
    if live is None:
        live = read_json(DATA / "live_snapshot.json", {}) or {}
    checks, inputs_used = build_checks(location, inp, live)
    if list(checks) != CHECK_IDS:
        raise RuntimeError(f"requirement sets built for {list(checks)}, expected {CHECK_IDS}")
    text ="# SpinDrift measurability checks, generated by server/verdict.py\n" + "\n".join(
        f"check {cid}\n" + "\n".join(r.line() for r in reqs) for cid, reqs in checks.items()) + "\n"
    got = _validate(run_checker(text), checks)
    by_name, audit = proofs_audit()

    def thm(name):
        t = by_name.get(name) or {}
        return {"name": name, "statement": t.get("statement"), "axioms": t.get("axioms"), "file": t.get("file")}

    cards, cited = {}, []
    for cid, reqs in checks.items():
        lean_c = got[cid]
        out_reqs = []
        for req, lr in zip(reqs, lean_c["requirements"]):
            out_reqs.append({
                "id": req.id, "text": req.text, "formula": req.formula, "holds": lr["holds"],
                "lhs": _side(lr["lhs"], req.unit), "rhs": _side(lr["rhs"], req.unit),
                "inputs": [f.entry() for f in req.factors()], "missing": _missing_list(req),
                "lean_line": req.line(), "note": req.note})
        names = list(dict.fromkeys(VERDICT_THEOREMS[lean_c["verdict"]] + [t for r in reqs for t in r.theorems]))
        cited += names
        sensor, signal = CARD_INFO[cid]
        cards[cid] = {"sensor": sensor, "signal": signal, "verdict": lean_c["verdict"],
                      "decided_by": "Lean: SpinDrift.verdict (lean/SpinDrift/Checker.lean) run by spindrift-check",
                      "reason": _reason(lean_c["verdict"], out_reqs), "requirements": out_reqs,
                      "theorems": [thm(n) for n in names]}
    b = binary_path()
    axioms = {n: (by_name.get(n) or {}).get("axioms") for n in dict.fromkeys(cited)}
    src_files = trusted_sources()
    return {
        "as_of": now_iso(),
        "location": {"value": location, "origin": location_origin},
        "verdicts": cards,
        "lean": {
            "toolchain": (LEAN_DIR / "lean-toolchain").read_text(encoding="utf-8").strip(),
            "checker": "SpinDrift.verdict",
            "binary": b.relative_to(ROOT).as_posix() if b else None,
            "binary_sha256": file_sha256(b),
            "binary_newer_than_sources": bool(b) and all(b.stat().st_mtime >= p.stat().st_mtime for p in src_files),
            "source_sha256": source_sha256(),
            "source_files": [p.relative_to(ROOT).as_posix() for p in src_files],
            "axioms": axioms,
            "standard_axioms": STANDARD_AXIOMS,
            "axioms_all_standard": all(a is not None and set(a) <= set(STANDARD_AXIOMS) for a in axioms.values()),
            "audit": audit,
        },
        "inputs_used": inputs_used,
        "input_units": {
            "shielding_factor": "× (field outside ÷ field at the sensor); default 1, no shield",
            "beats_averaged": "heartbeats averaged (OPM heart and NV cards)",
            "snr_required": "amplitude signal-to-noise ratio the measurement must reach",
            "target": "r_peak or q_wave (heart cards; default r_peak)",
            "renin": "pM, the unit of the detection limit in Long et al. (2012); no conversion is made",
            "bilirubin_isf": "unit of the patch's detection range, which is not yet extracted from Tabatabaee et al. "
                             "(2024); no conversion is made",
            "bandwidth_hz": "Hz, measurement bandwidth for the OPM cards (within 3–100 Hz, where the datasheet states "
                            "the noise density); the NV cards use the paper's bandwidth",
        },
        "notes": ["Every holds value and verdict is Lean's output; Python only builds the input and formats the reply.",
                  "Measurability check only: not diagnostic and not medical advice."],
    }
