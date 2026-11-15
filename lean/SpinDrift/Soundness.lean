import SpinDrift.Checker
/-
What each verdict of `SpinDrift.verdict` means, proved in Lean 4 (core only, no Mathlib).

The specification below (`Denotes`, `Holds`, `Violated`, `Missing`) is written from the meaning of a requirement, not
from the executable checker; the theorems tie the two together (CryoLean pattern): `verdict_met_iff` (met iff every
requirement holds), `verdict_notMet_sound` (not met implies a requirement with every input present is violated) and
`verdict_needInfo_sound` (need more information implies nothing is violated and some input is missing). Missing data
never becomes a pass or a fail (`missing_never_decides`, `missing_never_passes_or_fails`).
-/
namespace SpinDrift

/-! ## Independent specification -/

/-- `Denotes fs q`: every factor in `fs` is present with a positive denominator and `q` is their exact product. -/
inductive Denotes : List (Option Q) → Q → Prop
  | nil : Denotes [] Q.one
  | cons {a b : Q} {fs : List (Option Q)} (ha : 0 < a.den) (hb : Denotes fs b) : Denotes (some a :: fs) (Q.mul a b)

/-- A requirement holds: both sides are exact products of present, well-formed factors and `lhs ≤ rhs`. -/
def Holds (r : Req) : Prop := ∃ a b, Denotes r.lhs a ∧ Denotes r.rhs b ∧ Q.le a b

/-- A requirement is violated: both sides are exact products of present, well-formed factors and `lhs > rhs`. -/
def Violated (r : Req) : Prop := ∃ a b, Denotes r.lhs a ∧ Denotes r.rhs b ∧ ¬ Q.le a b

/-- A factor is missing (absent) or malformed (zero denominator). -/
def MissingFactor (f : Option Q) : Prop := f = none ∨ ∃ q, f = some q ∧ q.den = 0

/-- A requirement lacks an input: some factor on either side is missing or malformed. -/
def Missing (r : Req) : Prop := ∃ f ∈ r.lhs ++ r.rhs, MissingFactor f

/-! ## Factors and exact products -/

/-- A factor is usable exactly when it is present with a positive denominator. -/
theorem usable_eq_some_iff {f : Option Q} {a : Q} : usable f = some a ↔ f = some a ∧ 0 < a.den := by
  cases f with
  | none => simp [usable]
  | some q =>
    by_cases h : 0 < q.den
    · have hu : usable (some q) = some q := by simp [usable, h]
      rw [hu]
      constructor
      · intro e; cases e; exact ⟨rfl, h⟩
      · intro ⟨e, _⟩; exact e
    · have hu : usable (some q) = none := by simp [usable, h]
      rw [hu]
      constructor
      · intro e; cases e
      · intro ⟨e, ha⟩; cases e; exact absurd ha h

/-- A factor is unusable exactly when it is missing or has a zero denominator. -/
theorem usable_eq_none_iff (f : Option Q) : usable f = none ↔ MissingFactor f := by
  cases f with
  | none => exact ⟨fun _ => .inl rfl, fun _ => rfl⟩
  | some q =>
    by_cases h : 0 < q.den
    · have hu : usable (some q) = some q := by simp [usable, h]
      rw [hu]
      constructor
      · intro e; cases e
      · intro hm
        rcases hm with e | ⟨q', e, hq⟩
        · cases e
        · cases e; omega
    · have hu : usable (some q) = none := by simp [usable, h]
      rw [hu]
      exact ⟨fun _ => .inr ⟨q, rfl, by omega⟩, fun _ => rfl⟩

/-- The executable product agrees with the specification `Denotes`. -/
theorem prod_eq_some_iff {fs : List (Option Q)} {q : Q} : prod fs = some q ↔ Denotes fs q := by
  induction fs generalizing q with
  | nil =>
    constructor
    · intro h; simp only [prod, Option.some.injEq] at h; subst h; exact .nil
    · intro h; cases h; rfl
  | cons f fs ih =>
    constructor
    · intro h
      simp only [prod] at h
      cases hu : usable f with
      | none => simp [hu] at h
      | some a =>
        cases hp : prod fs with
        | none => simp [hu, hp] at h
        | some b =>
          simp only [hu, hp, Option.some.injEq] at h
          subst h
          obtain ⟨rfl, ha⟩ := usable_eq_some_iff.1 hu
          exact .cons ha (ih.1 hp)
    · intro h
      cases h with
      | cons ha hb =>
        simp only [prod]
        rw [usable_eq_some_iff.2 ⟨rfl, ha⟩, ih.2 hb]

/-- The product is undefined exactly when some factor is missing or malformed. -/
theorem prod_eq_none_iff {fs : List (Option Q)} : prod fs = none ↔ ∃ f ∈ fs, MissingFactor f := by
  induction fs with
  | nil => simp [prod]
  | cons f fs ih =>
    simp only [prod, List.mem_cons, or_and_right, exists_or, exists_eq_left]
    cases hu : usable f with
    | none => simp [(usable_eq_none_iff f).1 hu]
    | some a =>
      have hf : ¬ MissingFactor f := fun hm => by rw [(usable_eq_none_iff f).2 hm] at hu; cases hu
      cases hp : prod fs with
      | none => simp [hf, ih.1 hp]
      | some b =>
        have hn : ¬ ∃ x ∈ fs, MissingFactor x := fun hex => by rw [ih.2 hex] at hp; cases hp
        simp only [reduceCtorEq, false_iff]
        exact fun h => h.elim hf hn

/-- Exact products of present, well-formed factors have a positive denominator. -/
theorem Denotes.den_pos {fs : List (Option Q)} {q : Q} (h : Denotes fs q) : 0 < q.den := by
  induction h with
  | nil => decide
  | cons ha _ ih => exact Nat.mul_pos ha ih

/-! ## Requirements: holds, violated, missing -/

/-- Lean says a requirement holds exactly when the specification `Holds` is true. -/
theorem holds_true_iff (r : Req) : holds r = some true ↔ Holds r := by
  simp only [Holds, ← prod_eq_some_iff]
  unfold holds
  cases prod r.lhs <;> cases prod r.rhs <;> simp

/-- Lean says a requirement is violated exactly when every input is present and `lhs > rhs` (`Violated`). -/
theorem holds_false_iff (r : Req) : holds r = some false ↔ Violated r := by
  simp only [Violated, ← prod_eq_some_iff]
  unfold holds
  cases prod r.lhs <;> cases prod r.rhs <;> simp

/-- Lean leaves a requirement undecided exactly when some input is missing or malformed (`Missing`). -/
theorem holds_none_iff (r : Req) : holds r = none ↔ Missing r := by
  unfold Missing
  simp only [List.mem_append, or_and_right, exists_or, ← prod_eq_none_iff]
  unfold holds
  cases prod r.lhs <;> cases prod r.rhs <;> simp

/-- Missing data never becomes a pass or a fail: one missing factor leaves the requirement undecided. -/
theorem missing_never_decides {r : Req} (h : none ∈ r.lhs ∨ none ∈ r.rhs) : holds r = none :=
  (holds_none_iff r).2 ⟨none, List.mem_append.2 h, .inl rfl⟩

/-- A malformed factor (zero denominator) never becomes a pass or a fail either. -/
theorem zero_den_never_decides {r : Req} {q : Q} (hq : q.den = 0) (h : some q ∈ r.lhs ∨ some q ∈ r.rhs) :
    holds r = none :=
  (holds_none_iff r).2 ⟨some q, List.mem_append.2 h, .inr ⟨q, rfl, hq⟩⟩

/-- A requirement cannot both hold and be violated. -/
theorem holds_violated_exclusive {r : Req} (h1 : Holds r) (h2 : Violated r) : False := by
  have h := (holds_true_iff r).2 h1
  rw [(holds_false_iff r).2 h2] at h
  cases h

/-- A requirement with a missing input is neither met nor violated. -/
theorem missing_never_passes_or_fails {r : Req} (h : Missing r) : ¬ Holds r ∧ ¬ Violated r := by
  have hn := (holds_none_iff r).2 h
  refine ⟨fun hh => ?_, fun hv => ?_⟩
  · rw [(holds_true_iff r).2 hh] at hn; cases hn
  · rw [(holds_false_iff r).2 hv] at hn; cases hn

/-! ## The three verdicts -/

/-- REQUIREMENTS_MET exactly when Lean says every requirement holds. -/
theorem verdict_met_iff (rs : List Req) : verdict rs = .met ↔ ∀ r ∈ rs, holds r = some true := by
  unfold verdict
  by_cases h1 : ∃ r ∈ rs, holds r = some false
  · rw [ite_eq_left h1]
    obtain ⟨r, hr, hf⟩ := h1
    constructor
    · intro h; cases h
    · intro h; rw [h r hr] at hf; cases hf
  · rw [ite_eq_right h1]
    by_cases h2 : ∃ r ∈ rs, holds r = none
    · rw [ite_eq_left h2]
      obtain ⟨r, hr, hn⟩ := h2
      constructor
      · intro h; cases h
      · intro h; rw [h r hr] at hn; cases hn
    · rw [ite_eq_right h2]
      refine ⟨fun _ r hr => ?_, fun _ => rfl⟩
      cases hr' : holds r with
      | none => exact absurd ⟨r, hr, hr'⟩ h2
      | some b =>
        cases b with
        | false => exact absurd ⟨r, hr, hr'⟩ h1
        | true => rfl

/-- NOT_MET exactly when some requirement with every input present is violated. -/
theorem verdict_notMet_iff (rs : List Req) : verdict rs = .notMet ↔ ∃ r ∈ rs, holds r = some false := by
  unfold verdict
  by_cases h1 : ∃ r ∈ rs, holds r = some false
  · rw [ite_eq_left h1]; exact ⟨fun _ => h1, fun _ => rfl⟩
  · rw [ite_eq_right h1]
    by_cases h2 : ∃ r ∈ rs, holds r = none
    · rw [ite_eq_left h2]
      constructor
      · intro h; cases h
      · intro h; exact absurd h h1
    · rw [ite_eq_right h2]
      constructor
      · intro h; cases h
      · intro h; exact absurd h h1

/-- NEED_MORE_INFORMATION exactly when no requirement is violated and some requirement has a missing input. -/
theorem verdict_needInfo_iff (rs : List Req) :
    verdict rs = .needInfo ↔ (∀ r ∈ rs, holds r ≠ some false) ∧ ∃ r ∈ rs, holds r = none := by
  unfold verdict
  by_cases h1 : ∃ r ∈ rs, holds r = some false
  · rw [ite_eq_left h1]
    obtain ⟨r, hr, hf⟩ := h1
    constructor
    · intro h; cases h
    · intro h; exact absurd hf (h.1 r hr)
  · rw [ite_eq_right h1]
    have hall : ∀ r ∈ rs, holds r ≠ some false := fun r hr hf => h1 ⟨r, hr, hf⟩
    by_cases h2 : ∃ r ∈ rs, holds r = none
    · rw [ite_eq_left h2]; exact ⟨fun _ => ⟨hall, h2⟩, fun _ => rfl⟩
    · rw [ite_eq_right h2]
      constructor
      · intro h; cases h
      · intro h; exact absurd h.2 h2

/-- NOT_MET implies a requirement with every input present is violated. -/
theorem verdict_notMet_sound {rs : List Req} (h : verdict rs = .notMet) : ∃ r ∈ rs, holds r = some false :=
  (verdict_notMet_iff rs).1 h

/-- NEED_MORE_INFORMATION implies no requirement is violated and some requirement has a missing input. -/
theorem verdict_needInfo_sound {rs : List Req} (h : verdict rs = .needInfo) :
    (∀ r ∈ rs, holds r ≠ some false) ∧ ∃ r ∈ rs, holds r = none :=
  (verdict_needInfo_iff rs).1 h

/-! ## Verdicts against the independent specification -/

/-- REQUIREMENTS_MET exactly when every requirement holds in the specification. -/
theorem verdict_met_spec (rs : List Req) : verdict rs = .met ↔ ∀ r ∈ rs, Holds r := by
  rw [verdict_met_iff]
  exact ⟨fun h r hr => (holds_true_iff r).1 (h r hr), fun h r hr => (holds_true_iff r).2 (h r hr)⟩

/-- NOT_MET implies a documented violation: every input of that requirement is present and `lhs > rhs`. -/
theorem verdict_notMet_spec {rs : List Req} (h : verdict rs = .notMet) : ∃ r ∈ rs, Violated r := by
  obtain ⟨r, hr, hf⟩ := verdict_notMet_sound h
  exact ⟨r, hr, (holds_false_iff r).1 hf⟩

/-- A documented violation always gives NOT_MET. -/
theorem verdict_notMet_complete {rs : List Req} (h : ∃ r ∈ rs, Violated r) : verdict rs = .notMet := by
  obtain ⟨r, hr, hv⟩ := h
  exact (verdict_notMet_iff rs).2 ⟨r, hr, (holds_false_iff r).2 hv⟩

/-- NEED_MORE_INFORMATION implies nothing is violated in the specification and some requirement lacks an input. -/
theorem verdict_needInfo_spec {rs : List Req} (h : verdict rs = .needInfo) :
    (∀ r ∈ rs, ¬ Violated r) ∧ ∃ r ∈ rs, Missing r := by
  obtain ⟨h1, r, hr, hn⟩ := verdict_needInfo_sound h
  exact ⟨fun r' hr' hv => h1 r' hr' ((holds_false_iff r').2 hv), r, hr, (holds_none_iff r).1 hn⟩

/-- A requirement with a missing input blocks REQUIREMENTS_MET. -/
theorem missing_blocks_met {rs : List Req} {r : Req} (hr : r ∈ rs) (h : Missing r) : verdict rs ≠ .met := by
  intro hm
  exact (missing_never_passes_or_fails h).1 ((verdict_met_spec rs).1 hm r hr)

/-- Adding requirements never turns NOT_MET into another verdict. -/
theorem verdict_append_notMet {rs more : List Req} (h : verdict rs = .notMet) : verdict (rs ++ more) = .notMet := by
  obtain ⟨r, hr, hf⟩ := verdict_notMet_sound h
  exact (verdict_notMet_iff _).2 ⟨r, List.mem_append_left _ hr, hf⟩

/-- An empty check is vacuously met; the `spindrift-check` binary therefore refuses a check with no requirements. -/
theorem verdict_nil : verdict [] = .met :=
  (verdict_met_iff []).2 (fun _ hr => by cases hr)

/-! ## Exact arithmetic -/

/-- The order does not depend on the representation of the left number (scaling by `k > 0`). -/
theorem Q.le_scale_left (a b : Q) (k : Nat) (hk : 0 < k) : Q.le ⟨a.num * k, a.den * k⟩ b ↔ Q.le a b := by
  simp only [Q.le]
  rw [Nat.mul_right_comm a.num k b.den, ← Nat.mul_assoc b.num a.den k]
  exact Nat.mul_le_mul_right_iff hk

/-- The order does not depend on the representation of the right number (scaling by `k > 0`). -/
theorem Q.le_scale_right (a b : Q) (k : Nat) (hk : 0 < k) : Q.le a ⟨b.num * k, b.den * k⟩ ↔ Q.le a b := by
  simp only [Q.le]
  rw [← Nat.mul_assoc a.num b.den k, Nat.mul_right_comm b.num k a.den]
  exact Nat.mul_le_mul_right_iff hk

/-- Comparing squares is exact for non-negative numbers: `a² ≤ b² ↔ a ≤ b`. This is why the SNR requirement can be
checked as `snr²·η²·BW ≤ A²·N` without square roots. -/
theorem Q.le_mul_self_iff (a b : Q) : Q.le (Q.mul a a) (Q.mul b b) ↔ Q.le a b := by
  simp only [Q.le, Q.mul]
  rw [Nat.mul_mul_mul_comm a.num a.num b.den b.den, Nat.mul_mul_mul_comm b.num b.num a.den a.den]
  exact Nat.mul_self_le_mul_self_iff

/-- The order is transitive through a well-formed middle number. -/
theorem Q.le_trans {a b c : Q} (hb : 0 < b.den) (h1 : Q.le a b) (h2 : Q.le b c) : Q.le a c := by
  unfold Q.le at *
  refine Nat.le_of_mul_le_mul_right ?_ hb
  calc a.num * c.den * b.den = a.num * b.den * c.den := Nat.mul_right_comm _ _ _
    _ ≤ b.num * a.den * c.den := Nat.mul_le_mul_right _ h1
    _ = b.num * c.den * a.den := Nat.mul_right_comm _ _ _
    _ ≤ c.num * b.den * a.den := Nat.mul_le_mul_right _ h2
    _ = c.num * a.den * b.den := Nat.mul_right_comm _ _ _

/-- The exact product does not depend on the order of the two numbers. -/
theorem Q.mul_comm (a b : Q) : Q.mul a b = Q.mul b a := by
  simp only [Q.mul, Nat.mul_comm a.num b.num, Nat.mul_comm a.den b.den]

/-- Multiplying both sides by the same number on the right keeps the order. -/
theorem Q.mul_le_mul_right {a b : Q} (c : Q) (h : Q.le a b) : Q.le (Q.mul a c) (Q.mul b c) := by
  simp only [Q.le, Q.mul] at *
  rw [Nat.mul_mul_mul_comm a.num c.num b.den c.den, Nat.mul_mul_mul_comm b.num c.num a.den c.den]
  exact Nat.mul_le_mul_right _ h

/-- Multiplying both sides by the same number on the left keeps the order. -/
theorem Q.mul_le_mul_left {a b : Q} (c : Q) (h : Q.le a b) : Q.le (Q.mul c a) (Q.mul c b) := by
  rw [Q.mul_comm c a, Q.mul_comm c b]
  exact Q.mul_le_mul_right c h

/-! ## Using a datasheet bound -/

/-- Exact products are unique. -/
theorem Denotes.unique {fs : List (Option Q)} {p q : Q} (hp : Denotes fs p) (hq : Denotes fs q) : p = q := by
  have h1 := prod_eq_some_iff.2 hp
  rw [prod_eq_some_iff.2 hq] at h1
  cases h1; rfl

/-- Replacing one left-hand factor by a smaller well-formed one keeps an exact product (and makes it no larger). -/
theorem Denotes.replace_le (l₁ : List (Option Q)) {l₂ : List (Option Q)} {x y p : Q}
    (h : Denotes (l₁ ++ some x :: l₂) p) (hy : 0 < y.den) (hyx : Q.le y x) :
    ∃ p', Denotes (l₁ ++ some y :: l₂) p' ∧ Q.le p' p := by
  induction l₁ generalizing p with
  | nil =>
    cases h with
    | cons _ hb => exact ⟨_, .cons hy hb, Q.mul_le_mul_right _ hyx⟩
  | cons f l₁ ih =>
    cases h with
    | cons ha hb =>
      obtain ⟨p', hp', hle⟩ := ih hb
      exact ⟨_, .cons ha hp', Q.mul_le_mul_left _ hle⟩

/-- A smaller left-hand factor never breaks a requirement that holds. This is why a datasheet upper bound (for example
a noise density stated as `< 15 fT/√Hz`) may be used for that factor: if the requirement holds at the bound, it holds
for every value below it. -/
theorem holds_mono_lhs (id : String) (l₁ : List (Option Q)) {l₂ rhs : List (Option Q)} {x y : Q}
    (h : Holds ⟨id, l₁ ++ some x :: l₂, rhs⟩) (hy : 0 < y.den) (hyx : Q.le y x) :
    Holds ⟨id, l₁ ++ some y :: l₂, rhs⟩ := by
  obtain ⟨a, b, ha, hb, hab⟩ := h
  obtain ⟨a', ha', hle⟩ := Denotes.replace_le l₁ ha hy hyx
  exact ⟨a', b, ha', hb, Q.le_trans ha.den_pos hle hab⟩

/-! ## Worked examples, decided by the kernel -/

/-- `1/2 ≤ 2/3` holds, so a one-requirement check is met. -/
theorem demo_met : verdict [⟨"demo", [some ⟨1, 2⟩], [some ⟨2, 3⟩]⟩] = .met := by decide

/-- `3 ≤ 2` is violated, so the check is not met. -/
theorem demo_notMet : verdict [⟨"demo", [some ⟨3, 1⟩], [some ⟨2, 1⟩]⟩] = .notMet := by decide

/-- One missing factor and nothing violated: Lean asks for more information. -/
theorem demo_needInfo :
    verdict [⟨"a", [none], [some ⟨2, 1⟩]⟩, ⟨"b", [some ⟨1, 1⟩], [some ⟨2, 1⟩]⟩] = .needInfo := by decide

/-- A violated requirement decides the verdict even when another one lacks an input. -/
theorem demo_notMet_beats_missing :
    verdict [⟨"a", [none], [some ⟨2, 1⟩]⟩, ⟨"b", [some ⟨3, 1⟩], [some ⟨2, 1⟩]⟩] = .notMet := by decide

end SpinDrift
