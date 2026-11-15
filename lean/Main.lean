import SpinDrift.Checker
/-!
# `spindrift-check`: the compiled SpinDrift checker

Reads requirements on stdin and prints one JSON object on stdout. Lean decides every `holds` value and every verdict
with `SpinDrift.holds` and `SpinDrift.verdict`; the Python server only writes the input from sourced data and reads the
output.

Input, one item per line (blank lines and lines starting with `#` are ignored):

    check <check-id>
    req <req-id> <lhs factors> <= <rhs factors>

Each factor is `n/d` or `n` (decimal natural numbers, `d > 0`) or `?` for a missing input. A requirement means
`∏ lhs ≤ ∏ rhs`; an empty side is the empty product 1. `req` lines belong to the latest `check`. Ids use letters,
digits, `_`, `-` and `.`.

Output: `{"checker": "SpinDrift.verdict", "checks": [{"id", "verdict", "requirements": [{"id", "holds", "lhs",
"rhs"}]}]}`. `verdict` is REQUIREMENTS_MET, NOT_MET or NEED_MORE_INFORMATION; `holds` is `true`, `false` or `null` (an
input is missing); `lhs` and `rhs` are the exact products as reduced fractions `"n/d"`, or `null` when a factor on that
side is missing.

Exit code 0: verdicts printed. Exit code 2: the input was refused and `{"error": ..., "line": n, "checks": null}` is
printed; nothing is guessed. Refused: malformed lines or factors, a zero denominator, a requirement before any check,
duplicate ids, and a check with no requirements (it would be vacuously met, see `SpinDrift.verdict_nil`).
`spindrift-check --selftest` runs the built-in examples.
-/
namespace SpinDrift.CLI

/-- Whitespace-separated tokens of a line. -/
def tokens (s : String) : List String :=
  let step : List String × List Char → Char → List String × List Char := fun (acc, cur) c =>
    if c.isWhitespace then
      (if cur.isEmpty then (acc, []) else (String.ofList cur.reverse :: acc, []))
    else (acc, c :: cur)
  let (acc, cur) := s.toList.foldl step ([], [])
  (if cur.isEmpty then acc else String.ofList cur.reverse :: acc).reverse

/-- A natural number written with decimal digits only (no sign, no separator, no decimal point). -/
def digits (s : String) : Option Nat :=
  let cs := s.toList
  if cs.isEmpty || !(cs.all Char.isDigit) then none
  else some (cs.foldl (fun n c => 10 * n + (c.toNat - '0'.toNat)) 0)

/-- Check and requirement ids: letters, digits, `_`, `-` and `.`. -/
def validId (s : String) : Bool :=
  !s.isEmpty && s.toList.all (fun c => c.isAlphanum || c == '_' || c == '-' || c == '.')

/-- One factor: `?` (missing), `n` or `n/d` with `d > 0`. Anything else is refused. -/
def parseFactor (t : String) : Except String (Option Q) :=
  if t == "?" then .ok none
  else match t.splitOn "/" with
    | [n] =>
      match digits n with
      | some a => .ok (some ⟨a, 1⟩)
      | none => .error s!"bad factor '{t}' (expected n/d, n or ?)"
    | [n, d] =>
      match digits n, digits d with
      | some a, some b => if b = 0 then .error s!"zero denominator in '{t}'" else .ok (some ⟨a, b⟩)
      | _, _ => .error s!"bad factor '{t}' (expected n/d, n or ?)"
    | _ => .error s!"bad factor '{t}' (expected n/d, n or ?)"

/-- Split the factor tokens at the single `<=`. -/
def splitLe (ts : List String) : Option (List String × List String) :=
  match ts.span (· != "<=") with
  | (l, "<=" :: r) => if r.contains "<=" then none else some (l, r)
  | _ => none

/-- One parsed input line. -/
inductive Line where
  | skip
  | check (id : String)
  | req (r : Req)

/-- Parse one line. -/
def parseLine (raw : String) : Except String Line :=
  match tokens raw with
  | [] => .ok .skip
  | t :: rest =>
    if t.toList.head? == some '#' then .ok .skip
    else match t, rest with
      | "check", [id] => if validId id then .ok (.check id) else .error s!"bad check id '{id}'"
      | "req", id :: fs =>
        if !validId id then .error s!"bad requirement id '{id}'"
        else match splitLe fs with
          | none => .error "a requirement needs exactly one '<='"
          | some (l, r) => do
            let lf ← l.mapM parseFactor
            let rf ← r.mapM parseFactor
            pure (.req ⟨id, lf, rf⟩)
      | _, _ => .error "expected 'check <id>' or 'req <id> <factors> <= <factors>'"

/-- One check: an id and its requirements, in input order. -/
structure Check where
  id : String
  reqs : List Req

/-- Parse the whole input; errors carry the line number. -/
def parseInput (input : String) : Except (Nat × String) (List Check) := do
  let mut out : Array Check := #[]
  let mut cur : Option (String × Array Req) := none
  let mut n := 0
  for raw in input.splitOn "\n" do
    n := n + 1
    match parseLine raw with
    | .error e => throw (n, e)
    | .ok .skip => pure ()
    | .ok (.check id) =>
      if let some (cid, rs) := cur then
        if rs.isEmpty then throw (n, s!"check '{cid}' has no requirements")
        out := out.push ⟨cid, rs.toList⟩
      if out.any (·.id == id) then throw (n, s!"duplicate check id '{id}'")
      cur := some (id, #[])
    | .ok (.req r) =>
      match cur with
      | none => throw (n, "a requirement must follow a 'check <id>' line")
      | some (cid, rs) =>
        if rs.any (·.id == r.id) then throw (n, s!"duplicate requirement id '{r.id}' in check '{cid}'")
        cur := some (cid, rs.push r)
  match cur with
  | none => throw (n, "no checks in the input")
  | some (cid, rs) =>
    if rs.isEmpty then throw (n, s!"check '{cid}' has no requirements")
    out := out.push ⟨cid, rs.toList⟩
  return out.toList

/-! ## JSON output (ids are restricted by `validId`, so they need no escaping) -/

/-- A JSON string literal (used for error messages, which may quote input). -/
def jsonString (s : String) : String :=
  "\"" ++ String.ofList (s.toList.flatMap fun c =>
    if c == '"' then ['\\', '"'] else if c == '\\' then ['\\', '\\'] else if c.toNat < 32 then [' '] else [c]) ++ "\""

/-- An exact product as a reduced fraction `"n/d"`. -/
def fracStr (q : Q) : String :=
  let g := Nat.gcd q.num q.den
  if g = 0 then s!"{q.num}/{q.den}" else s!"{q.num / g}/{q.den / g}"

def optFrac : Option Q → String
  | some q => "\"" ++ fracStr q ++ "\""
  | none => "null"

def holdsStr : Option Bool → String
  | some true => "true"
  | some false => "false"
  | none => "null"

def reqJson (r : Req) : String :=
  "{\"id\":\"" ++ r.id ++ "\",\"holds\":" ++ holdsStr (holds r) ++ ",\"lhs\":" ++ optFrac (prod r.lhs) ++
    ",\"rhs\":" ++ optFrac (prod r.rhs) ++ "}"

def checkJson (c : Check) : String :=
  "{\"id\":\"" ++ c.id ++ "\",\"verdict\":\"" ++ (verdict c.reqs).label ++ "\",\"requirements\":[" ++
    ",".intercalate (c.reqs.map reqJson) ++ "]}"

def outputJson (cs : List Check) : String :=
  "{\"checker\":\"SpinDrift.verdict\",\"checks\":[" ++ ",".intercalate (cs.map checkJson) ++ "]}"

def errorJson (n : Nat) (msg : String) : String :=
  "{\"error\":" ++ jsonString msg ++ ",\"line\":" ++ toString n ++ ",\"checks\":null}"

/-! ## Self-test -/

/-- Inputs with the verdicts they must produce. -/
def selftestOk : List (String × String × List String) :=
  [("met: 1/2 <= 2/3", "check a\nreq r 1/2 <= 2/3", ["REQUIREMENTS_MET"]),
   ("not met: 3 <= 2", "check a\nreq r 3 <= 2", ["NOT_MET"]),
   ("need info: ? <= 2", "check a\nreq r ? <= 2\nreq s 1 <= 2", ["NEED_MORE_INFORMATION"]),
   ("violation beats missing", "check a\nreq r ? <= 2\nreq s 3 <= 2", ["NOT_MET"]),
   ("squared SNR form", "check a\nreq snr 5 5 13 13 30 <= 4314/100 4314/100 12000", ["REQUIREMENTS_MET"]),
   ("empty side is 1", "check a\nreq r <= 1", ["REQUIREMENTS_MET"]),
   ("two checks", "# comment\ncheck a\nreq r 1 <= 1\n\ncheck b\nreq r 2 <= 1\r\n", ["REQUIREMENTS_MET", "NOT_MET"])]

/-- Inputs that must be refused. -/
def selftestRefused : List (String × String) :=
  [("zero denominator", "check a\nreq r 1/0 <= 1"),
   ("requirement before check", "req r 1 <= 1"),
   ("no <=", "check a\nreq r 1 1"),
   ("two <=", "check a\nreq r 1 <= 1 <= 1"),
   ("empty check", "check a\ncheck b\nreq r 1 <= 1"),
   ("duplicate check id", "check a\nreq r 1 <= 1\ncheck a\nreq s 1 <= 1"),
   ("duplicate requirement id", "check a\nreq r 1 <= 1\nreq r 1 <= 2"),
   ("negative number", "check a\nreq r -1 <= 1"),
   ("decimal point", "check a\nreq r 1.5 <= 2"),
   ("bad id", "check a\"b\nreq r 1 <= 1"),
   ("empty input", "")]

def selftest : IO UInt32 := do
  let mut failures := 0
  for (name, input, expected) in selftestOk do
    match parseInput input with
    | .error (n, e) =>
      IO.println s!"[FAIL] {name}: refused at line {n}: {e}"
      failures := failures + 1
    | .ok cs =>
      let got := cs.map (fun c => (verdict c.reqs).label)
      if got == expected then
        IO.println s!"[ok] {name} -> {got}"
      else
        IO.println s!"[FAIL] {name}: got {got}, expected {expected}"
        failures := failures + 1
  for (name, input) in selftestRefused do
    match parseInput input with
    | .error (n, e) => IO.println s!"[ok] refused ({name}) at line {n}: {e}"
    | .ok _ =>
      IO.println s!"[FAIL] accepted a malformed input ({name})"
      failures := failures + 1
  if failures == 0 then
    IO.println "selftest: all examples produced the expected result"
    pure 0
  else
    IO.println s!"selftest: {failures} failure(s)"
    pure 1

/-- Read the whole stream. -/
partial def readAll (s : IO.FS.Stream) (acc : String) : IO String := do
  let line ← s.getLine
  if line.isEmpty then pure acc else readAll s (acc ++ line)

end SpinDrift.CLI

open SpinDrift.CLI in
def main (args : List String) : IO UInt32 := do
  match args with
  | ["--selftest"] => selftest
  | [] =>
    let input ← readAll (← IO.getStdin) ""
    match parseInput input with
    | .error (n, e) =>
      IO.println (errorJson n e)
      pure 2
    | .ok cs =>
      IO.println (outputJson cs)
      pure 0
  | _ =>
    IO.println (errorJson 0 "usage: spindrift-check < input, or spindrift-check --selftest")
    pure 2
