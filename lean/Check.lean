import SpinDrift
-- Physics bricks (SpinDrift/Physics.lean)
#print axioms SpinDrift.nv_splitting
#print axioms SpinDrift.nv_centre
#print axioms SpinDrift.nv_zero_field
#print axioms SpinDrift.opm_steady_state
#print axioms SpinDrift.bloch_circle
#print axioms SpinDrift.opm_half_width
#print axioms SpinDrift.fret_half
#print axioms SpinDrift.fret_one_acceptor
#print axioms SpinDrift.fret_inverse
#print axioms SpinDrift.snr_averaging
#print axioms SpinDrift.field_clash
#print axioms SpinDrift.odmr_step_vs_rpeak
-- Measurability checker (SpinDrift/Checker.lean, proofs in SpinDrift/Soundness.lean)
-- factors and exact products
#print axioms SpinDrift.usable_eq_some_iff
#print axioms SpinDrift.usable_eq_none_iff
#print axioms SpinDrift.prod_eq_some_iff
#print axioms SpinDrift.prod_eq_none_iff
#print axioms SpinDrift.Denotes.den_pos
-- one requirement: holds, violated, missing
#print axioms SpinDrift.holds_true_iff
#print axioms SpinDrift.holds_false_iff
#print axioms SpinDrift.holds_none_iff
#print axioms SpinDrift.missing_never_decides
#print axioms SpinDrift.zero_den_never_decides
#print axioms SpinDrift.holds_violated_exclusive
#print axioms SpinDrift.missing_never_passes_or_fails
-- the three verdicts
#print axioms SpinDrift.verdict_met_iff
#print axioms SpinDrift.verdict_notMet_iff
#print axioms SpinDrift.verdict_needInfo_iff
#print axioms SpinDrift.verdict_notMet_sound
#print axioms SpinDrift.verdict_needInfo_sound
-- verdicts against the independent specification
#print axioms SpinDrift.verdict_met_spec
#print axioms SpinDrift.verdict_notMet_spec
#print axioms SpinDrift.verdict_notMet_complete
#print axioms SpinDrift.verdict_needInfo_spec
#print axioms SpinDrift.missing_blocks_met
#print axioms SpinDrift.verdict_append_notMet
#print axioms SpinDrift.verdict_nil
-- exact arithmetic
#print axioms SpinDrift.Q.le_scale_left
#print axioms SpinDrift.Q.le_scale_right
#print axioms SpinDrift.Q.le_mul_self_iff
#print axioms SpinDrift.Q.le_trans
#print axioms SpinDrift.Q.mul_comm
#print axioms SpinDrift.Q.mul_le_mul_right
#print axioms SpinDrift.Q.mul_le_mul_left
-- using a datasheet bound
#print axioms SpinDrift.Denotes.unique
#print axioms SpinDrift.Denotes.replace_le
#print axioms SpinDrift.holds_mono_lhs
-- worked examples decided by the kernel
#print axioms SpinDrift.demo_met
#print axioms SpinDrift.demo_notMet
#print axioms SpinDrift.demo_needInfo
#print axioms SpinDrift.demo_notMet_beats_missing
