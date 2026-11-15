"""Build data/lean_proofs.json from the Lean 4 project in /lean.

Runs `lake build` (the proofs are checked by Lean's kernel and the `spindrift-check` binary is compiled), then
`lake env lean Check.lean`, which prints the axioms each theorem depends on, then `spindrift-check --selftest`.
Theorem names, statements, doc comments and section headers are read from every .lean file under lean/SpinDrift/
(Physics.lean first, then the others in name order). Nothing is written if the build fails, the self-test fails or any
proof uses `sorry`.

Requires elan (https://github.com/leanprover/elan); the toolchain is pinned in lean/lean-toolchain.
"""
import hashlib
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.common import DATA, ROOT, log_status, meta, write_json  # noqa: E402
from server.verdict import binary_path, file_sha256, source_sha256, trusted_sources  # noqa: E402

LEAN = ROOT / "lean"
SRC_DIR = LEAN / "SpinDrift"
SRC = SRC_DIR / "Physics.lean"
STANDARD = {"propext", "Classical.choice", "Quot.sound"}

# Where each theorem is used in the app, and which Wolfram cross-check (data/math_checks.json) matches it.
USAGE = {
    "nv_splitting": ("NV console: field from the ODMR splitting", "nv_splitting"),
    "nv_centre": ("NV console: line pair centred on D", "nv_centre"),
    "nv_zero_field": ("NV console: both lines at 2870 MHz at zero field", None),
    "opm_steady_state": ("OPM console: Bloch steady state P_x, P_z", "opm_steady_state"),
    "bloch_circle": ("OPM console: polarisation tip on a circle (Bloch sphere view)", "bloch_circle"),
    "opm_half_width": ("OPM console: resonance half width at x = 1", "opm_half_width"),
    "fret_half": ("Quantum-dot console: E = 1/2 at r = R0", "fret_half"),
    "fret_one_acceptor": ("Quantum-dot console: n = 1 acceptor form", None),
    "fret_inverse": ("Quantum-dot console: distance from measured efficiency", "fret_inverse"),
    "snr_averaging": ("NV console: SNR grows as the square root of beats averaged", "snr_averaging"),
    "field_clash": ("Tower: NV bias versus OPM range", "field_clash"),
    "odmr_step_vs_rpeak": ("NV console: simulator step versus heartbeat R-peak", "odmr_step_vs_rpeak"),
    # measurability checker (POST /api/verdict)
    "verdict_met_iff": ("Verdict cards: REQUIREMENTS_MET exactly when every requirement holds", None),
    "verdict_notMet_sound": ("Verdict cards: NOT_MET names a requirement violated with every input present", None),
    "verdict_needInfo_sound": ("Verdict cards: NEED_MORE_INFORMATION means nothing violated and an input missing",
                               None),
    "verdict_met_spec": ("Verdict cards: REQUIREMENTS_MET against the independent specification", None),
    "verdict_notMet_spec": ("Verdict cards: NOT_MET implies a documented violation", None),
    "verdict_needInfo_spec": ("Verdict cards: NEED_MORE_INFORMATION against the independent specification", None),
    "holds_true_iff": ("Verdict cards: a requirement's holds = true", None),
    "holds_false_iff": ("Verdict cards: a requirement's holds = false", None),
    "holds_none_iff": ("Verdict cards: a requirement's holds = null (missing input)", None),
    "missing_never_decides": ("Verdict cards: missing, NOT_STATED and TO_CONFIRM inputs are sent as ? and never pass "
                              "or fail", None),
    "Q.le_mul_self_iff": ("Verdict cards: SNR requirements are checked in squared form, without square roots", None),
    "holds_mono_lhs": ("Verdict cards: the OPM SNR uses the datasheet noise bound (<15 fT/√Hz)", None),
    "verdict_nil": ("spindrift-check refuses a check with no requirements", None),
}
CHECKER_FILES = ("Checker.lean", "Soundness.lean")


def lake():
    exe = shutil.which("lake") or str(Path.home() / ".elan" / "bin" / "lake")
    return exe


def run(args, cwd=LEAN):
    p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def code_only(text):
    """Lean source without comments (for the sorry / admit / axiom scan)."""
    text = re.sub(r"/-.*?-/", " ", text, flags=re.S)
    return re.sub(r"--[^\n]*", " ", text)


def parse_source(text):
    """Theorems in file order with the doc comment directly above, statement, first proof line and section."""
    sections = [(m.start(), m.group(1).strip()) for m in re.finditer(r"/-!\s*##\s*([^\n]*?)\s*(?:-/|\n)", text)]
    out = []
    for m in re.finditer(r"^theorem\s+([\w.']+)", text, re.M):
        before = text[:m.start()].rstrip()
        doc = None
        if before.endswith("-/"):
            start = before.rfind("/--")
            if start != -1 and "-/" not in before[start + 3:-2]:
                doc = " ".join(before[start + 3:-2].split())
        rest = text[m.end():]
        i = rest.find(":=")
        stmt = " ".join(rest[:i].split())
        after = rest[i + 2:]
        mb = re.match(r"[ \t]*by\b[ \t]*\n?[ \t]*([^\n]*)", after)
        if mb:
            tactics = mb.group(1).strip()
        else:
            tactics = "term: " + after.strip().splitlines()[0].strip() if after.strip() else "term"
        section = next((s for pos, s in reversed(sections) if pos < m.start()), None)
        out.append({"name": m.group(1), "doc": doc, "statement": stmt, "tactics": tactics, "section": section})
    return out


def main():
    code, log = run([lake(), "build"])
    if code != 0:
        log_status("data/lean_proofs.json", "failed", "lake build failed")
        print(log)
        sys.exit(1)
    build_warnings = len(re.findall(r"^warning:", log, re.M))
    code, ax_log = run([lake(), "env", "lean", "Check.lean"])
    if code != 0:
        print(ax_log)
        sys.exit(1)
    axioms = {}
    for line in ax_log.splitlines():
        m = re.match(r"'SpinDrift\.([\w.']+)' depends on axioms: \[(.*)\]", line.strip())
        if m:
            axioms[m.group(1)] = [a.strip() for a in m.group(2).split(",") if a.strip()]
        m = re.match(r"'SpinDrift\.([\w.']+)' does not depend on any axioms", line.strip())
        if m:
            axioms[m.group(1)] = []

    files = [SRC] + sorted((p for p in SRC_DIR.glob("*.lean") if p != SRC), key=lambda p: p.name)
    texts = {p: p.read_text(encoding="utf-8") for p in files}
    markers = {k: sum(len(re.findall(pat, code_only(t), re.M)) for t in texts.values())
               for k, pat in (("sorry", r"\bsorry\b"), ("admit", r"\badmit\b"), ("native_decide", r"\bnative_decide\b"),
                              ("axiom", r"^\s*axiom\b"))}
    sorry_count = markers["sorry"]
    if sorry_count or markers["admit"] or markers["axiom"]:
        print(f"unproved or unsafe markers found {markers}; nothing written")
        sys.exit(1)

    b = binary_path()
    if b is None:
        log_status("data/lean_proofs.json", "failed", "spindrift-check binary missing after lake build")
        print("spindrift-check binary not found under lean/.lake/build/bin/")
        sys.exit(1)
    code, st_log = run([str(b), "--selftest"])
    selftest_ok = code == 0 and "all examples produced the expected result" in st_log
    if not selftest_ok:
        log_status("data/lean_proofs.json", "failed", "spindrift-check --selftest failed")
        print(st_log)
        sys.exit(1)

    theorems, per_file = [], []
    for p in files:
        rel = p.relative_to(ROOT).as_posix()
        names = []
        for t in parse_source(texts[p]):
            used, check = USAGE.get(t["name"], (None, None))
            if used is None and p.name in CHECKER_FILES:
                used = "Checker soundness (proved about SpinDrift.verdict, run by spindrift-check)"
            ax = axioms.get(t["name"])
            theorems.append({**t, "axioms": ax, "standard_axioms_only": ax is not None and set(ax) <= STANDARD,
                             "kernel_checked": ax is not None, "used_in": used, "wolfram_check": check,
                             "file": rel, "full_name": f"SpinDrift.{t['name']}", "module": f"SpinDrift.{p.stem}"})
            names.append(t["name"])
        per_file.append({"file": rel, "sha256": hashlib.sha256(p.read_bytes()).hexdigest(), "theorems": len(names)})
    not_audited = [t["name"] for t in theorems if not t["kernel_checked"]]
    if not_audited:
        print(f"theorems without a #print axioms line in Check.lean: {not_audited}")
    checker_names = [t["name"] for t in theorems if Path(t["file"]).name in CHECKER_FILES]

    toolchain = (LEAN / "lean-toolchain").read_text().strip()
    _, ver = run([lake(), "env", "lean", "--version"])
    write_json(DATA / "lean_proofs.json", {
        "meta": meta(False, ["Lean 4 theorem prover, https://lean-lang.org (core library only, no Mathlib)",
                             *[f"{p.relative_to(ROOT).as_posix()} (this repository)" for p in files],
                             "lean/Main.lean (this repository): the spindrift-check command-line checker"]),
        "toolchain": toolchain, "lean_version": ver.strip(),
        "file": "lean/SpinDrift/Physics.lean",
        "file_sha256": hashlib.sha256(SRC.read_bytes()).hexdigest(),
        "files": per_file,
        "sorry_count": sorry_count,
        "unsafe_markers": markers,
        "build": "lake build: success",
        "build_warnings": build_warnings,
        "how_to_check": "cd lean && lake build && lake env lean Check.lean && .lake/build/bin/spindrift-check --selftest",
        "note": "Each theorem is proved for any field (or commutative ring) of characteristic 0, so it holds for the "
                "real numbers. Lean checks the algebra of the formulas; it does not check measured values. That note is "
                "about the physics theorems (lean/SpinDrift/Physics.lean). The checker theorems (Checker.lean, "
                "Soundness.lean) prove what the three verdicts of SpinDrift.verdict mean for exact natural-number "
                "fractions; the compiled spindrift-check binary runs those definitions for POST /api/verdict.",
        "checker": {
            "definition": "SpinDrift.verdict in lean/SpinDrift/Checker.lean",
            "rule": "NOT_MET if some requirement with every input present is violated; otherwise "
                    "NEED_MORE_INFORMATION if some requirement has a missing input; otherwise REQUIREMENTS_MET",
            "requirement": "prod lhs <= prod rhs over non-negative fractions num/den (den > 0), decided by "
                           "cross-multiplication in Nat; a missing factor (?) or a zero denominator leaves it undecided",
            "binary": b.relative_to(ROOT).as_posix(),
            "binary_sha256": file_sha256(b),
            "source_files": [p.relative_to(ROOT).as_posix() for p in trusted_sources()],
            "source_sha256": source_sha256(),
            "selftest": "pass" if selftest_ok else "fail",
            "input_format": "lines 'check <id>' and 'req <id> <factors> <= <factors>'; factor n/d, n or ?",
            "theorems": checker_names,
        },
        "theorems": theorems,
    })
    n_phys = sum(1 for t in theorems if t["file"].endswith("Physics.lean"))
    log_status("data/lean_proofs.json", "done",
               f"{len(theorems)} theorems ({n_phys} physics, {len(checker_names)} checker), 0 sorry, kernel-checked, "
               f"all standard axioms: {all(t['standard_axioms_only'] for t in theorems)}; spindrift-check selftest pass")
    print(f"lean_proofs.json: {len(theorems)} theorems ({n_phys} physics, {len(checker_names)} checker); "
          f"axioms parsed for {len(axioms)}; build warnings {build_warnings}; selftest pass")


if __name__ == "__main__":
    main()
