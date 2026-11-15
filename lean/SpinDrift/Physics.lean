/-
SpinDrift physics bricks, machine-checked by Lean 4 (core only, no Mathlib).
Every theorem holds in any field (or commutative ring) of characteristic 0, so in particular for the real numbers.
Each one backs a formula the SpinDrift app uses; the app shows a "Lean-checked" mark next to it.
-/
namespace SpinDrift
open Lean.Grind

/-! ## NV centre in diamond: optically detected magnetic resonance (Barry et al., Rev. Mod. Phys. 92, 015004, Eq. 6) -/

/-- Upper ODMR line for a field `B` along the NV axis: `ν₊ = D + γB`. -/
def nuPlus {α : Type} [CommRing α] (D γ B : α) : α := D + γ * B
/-- Lower ODMR line: `ν₋ = D − γB`. -/
def nuMinus {α : Type} [CommRing α] (D γ B : α) : α := D - γ * B

/-- The two lines split by `2γB`: the field is read from the splitting. -/
theorem nv_splitting {α : Type} [CommRing α] (D γ B : α) :
    nuPlus D γ B - nuMinus D γ B = 2 * (γ * B) := by
  unfold nuPlus nuMinus; grind

/-- The pair stays centred on the zero-field splitting `D`. -/
theorem nv_centre {α : Type} [CommRing α] (D γ B : α) :
    nuPlus D γ B + nuMinus D γ B = 2 * D := by
  unfold nuPlus nuMinus; grind

/-- At zero field both lines sit at `D` (2870 MHz). -/
theorem nv_zero_field {α : Type} [CommRing α] (D γ : α) :
    nuPlus D γ 0 = D ∧ nuMinus D γ 0 = D := by
  unfold nuPlus nuMinus; grind

/-! ## Optically pumped magnetometer: Bloch steady state (Sulai et al., arXiv 1906.03227, Eqs. B1-B2)
With pumping rate `R` along z, total relaxation `Γ` (Γ' in the paper) and a transverse field `Ω = γB_y`, the
steady state of `dP/dt = R(ẑ − P) + Ω × P − Γ_rel P` has the two component equations below. -/

/-- Sulai's Eq. B2 (transverse field only) solves the steady-state Bloch equations:
`P_x = RΩ/(Γ² + Ω²)`, `P_z = RΓ/(Γ² + Ω²)`. This also fixes the sign of the `P_z` numerator (`+Γ²`). -/
theorem opm_steady_state {α : Type} [Field α] (R Γ Ω : α) (h : Γ ^ 2 + Ω ^ 2 ≠ 0) :
    -Γ * (R * Ω / (Γ ^ 2 + Ω ^ 2)) + Ω * (R * Γ / (Γ ^ 2 + Ω ^ 2)) = 0 ∧
    R - Γ * (R * Γ / (Γ ^ 2 + Ω ^ 2)) - Ω * (R * Ω / (Γ ^ 2 + Ω ^ 2)) = 0 := by
  constructor <;> grind

/-- In units of the half width (`x = Ω/Γ`), the tip of the polarisation traces a circle of radius ½ centred at
`(0, ½)`: `p_x² + (p_z − ½)² = ¼` with `p_x = x/(1+x²)`, `p_z = 1/(1+x²)`. -/
theorem bloch_circle {α : Type} [Field α] [IsCharP α 0] (x : α) (h : 1 + x ^ 2 ≠ 0) :
    (x / (1 + x ^ 2)) ^ 2 + (1 / (1 + x ^ 2) - 1 / 2) ^ 2 = 1 / 4 := by
  grind

/-- The Lorentzian `1/(1+x²)` falls to half its peak at `x = 1`, so `ΔB = Γ/γ` is the half width at half maximum. -/
theorem opm_half_width {α : Type} [Field α] [IsCharP α 0] :
    (1 : α) / (1 + 1 ^ 2) = (1 / (1 + 0 ^ 2)) / 2 := by
  grind

/-! ## Quantum-dot FRET (FRET-Calc, Comput. Phys. Commun. 2023, Eqs. 2-3) -/

/-- Förster efficiency is exactly ½ at the Förster radius (`r = R₀`). -/
theorem fret_half {α : Type} [Field α] [IsCharP α 0] (R₀ : α) (_h : R₀ ^ 6 ≠ 0) :
    R₀ ^ 6 / (R₀ ^ 6 + R₀ ^ 6) = 1 / 2 := by
  grind

/-- The multi-acceptor form (Eq. 3) reduces to Eq. 2 for one acceptor. -/
theorem fret_one_acceptor {α : Type} [Field α] (R₀ r : α) :
    (1 * R₀ ^ 6) / (1 * R₀ ^ 6 + r ^ 6) = R₀ ^ 6 / (R₀ ^ 6 + r ^ 6) := by
  grind

/-- Inversion used for the measured points: if `E = 1/(1+q)` with `q = (r/R₀)⁶`, then `q = 1/E − 1`. -/
theorem fret_inverse {α : Type} [Field α] (q : α) (_h : 1 + q ≠ 0) :
    q = 1 / (1 / (1 + q)) - 1 := by
  grind

/-! ## NV heartbeat averaging (arXiv 2601.18843 inputs) -/

/-- Averaging law without square roots: if the averaged noise `a` satisfies `a²·N = n²` (that is `a = n/√N`), then the
averaged SNR satisfies `(A/a)² = (A/n)²·N`, i.e. SNR grows as √N. -/
theorem snr_averaging {α : Type} [Field α] (A a n N : α) (ha : a ≠ 0) (hn : n ≠ 0) (h : a ^ 2 * N = n ^ 2) :
    (A / a) ^ 2 = (A / n) ^ 2 * N := by
  grind

/-! ## Numbers in the build log -/

/-- Field clash: the NV bias (1 mT = 1 000 000 nT) over the OPM range (5 nT) is 200 000. -/
theorem field_clash : (1000000 : Nat) / 5 = 200000 := by decide

/-- ODMR-Lab's field step (0.05 mT = 50 000 000 pT) over a 25 pT heartbeat R-peak is 2 000 000. -/
theorem odmr_step_vs_rpeak : (50000000 : Nat) / 25 = 2000000 := by decide

end SpinDrift
