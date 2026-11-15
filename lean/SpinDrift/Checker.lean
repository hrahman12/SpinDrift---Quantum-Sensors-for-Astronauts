/-
SpinDrift measurability checker (missing data never decides), Lean 4 core only, no Mathlib.

Lean, not Python, decides whether a sensor can measure a body signal under the current conditions. Each
requirement is one exact comparison `∏ lhs ≤ ∏ rhs` of non-negative rationals written as natural-number fractions
`num / den`. Any factor may be missing. The compiled `spindrift-check` binary (`lean/Main.lean`) runs exactly these
definitions; `SpinDrift.Soundness` proves what each of the three verdicts means.
-/
namespace SpinDrift

/-- A non-negative rational number `num / den` with natural-number numerator and denominator. It is well formed when
`den > 0`; the checker treats a zero denominator like a missing value. -/
structure Q where
  num : Nat
  den : Nat
deriving Repr, DecidableEq, Inhabited

/-- The number one, `1 / 1`. -/
def Q.one : Q := ⟨1, 1⟩

/-- Exact product: `(a / b) · (c / d) = (a · c) / (b · d)`. -/
def Q.mul (a b : Q) : Q := ⟨a.num * b.num, a.den * b.den⟩

/-- Exact order by cross-multiplication: `a / b ≤ c / d` iff `a · d ≤ c · b` (for positive denominators). -/
def Q.le (a b : Q) : Prop := a.num * b.den ≤ b.num * a.den

instance (a b : Q) : Decidable (Q.le a b) := inferInstanceAs (Decidable (a.num * b.den ≤ b.num * a.den))

/-- The value of a factor that the checker may use: present, with a positive denominator. Anything else is missing. -/
def usable : Option Q → Option Q
  | some q => if 0 < q.den then some q else none
  | none   => none

/-- Exact product of a list of factors; `none` as soon as one factor is missing or has a zero denominator. -/
def prod : List (Option Q) → Option Q
  | []      => some Q.one
  | f :: fs =>
    match usable f, prod fs with
    | some a, some b => some (Q.mul a b)
    | _, _           => none

/-- One requirement: the product of the `lhs` factors must not exceed the product of the `rhs` factors. -/
structure Req where
  id  : String
  lhs : List (Option Q)
  rhs : List (Option Q)
deriving Repr, Inhabited

/-- Three-valued result of one requirement: `some true` (holds), `some false` (violated, every input present) or
`none` (an input is missing, so Lean does not decide it). -/
def holds (r : Req) : Option Bool :=
  match prod r.lhs, prod r.rhs with
  | some a, some b => some (decide (Q.le a b))
  | _, _           => none

/-- The three verdicts. -/
inductive Verdict where
  /-- REQUIREMENTS_MET -/
  | met
  /-- NOT_MET -/
  | notMet
  /-- NEED_MORE_INFORMATION -/
  | needInfo
deriving Repr, DecidableEq, Inhabited

/-- The label printed by the checker binary. -/
def Verdict.label : Verdict → String
  | .met      => "REQUIREMENTS_MET"
  | .notMet   => "NOT_MET"
  | .needInfo => "NEED_MORE_INFORMATION"

/-- The verdict for one sensor and body signal: NOT_MET if some requirement with every input present is violated;
otherwise NEED_MORE_INFORMATION if some requirement has a missing input; otherwise REQUIREMENTS_MET. -/
def verdict (rs : List Req) : Verdict :=
  if ∃ r ∈ rs, holds r = some false then .notMet
  else if ∃ r ∈ rs, holds r = none then .needInfo
  else .met

end SpinDrift
