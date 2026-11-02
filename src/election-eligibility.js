// ELECOM masterlist-based eligibility correction. Ballots, selections and the
// historic opening registration snapshot must never be modified to change turnout.
export function resolveElectionEligibility({ election, currentActive, correction, cast, ballotRows, selections }) {
  const atOpen = Number.isSafeInteger(election.eligible_voters_at_open)
    ? election.eligible_voters_at_open : null;
  const original = {
    eligibleVoters: atOpen ?? Number(currentActive || 0),
    eligibilitySource: atOpen === null ? "current_active_unverified" : "captured_at_open",
    openingRegisteredVoters: atOpen,
    excludedFromCertifiedRoll: 0,
    eligibilityCorrectionRecordedAt: null
  };
  if (!correction) return original;
  const fields = ["election_id","original_voters_at_open","qualified_voters_final",
    "excluded_accounts","participants_at_confirmation","ballots_at_confirmation",
    "selections_at_confirmation"];
  const correct = fields.every(k => Number.isSafeInteger(correction[k]) && correction[k] >= 0) &&
    election.status === "closed" && !election.is_test && atOpen !== null &&
    correction.election_id === election.id &&
    correction.original_voters_at_open === atOpen &&
    correction.qualified_voters_final > 0 &&
    atOpen - correction.qualified_voters_final === correction.excluded_accounts &&
    correction.qualified_voters_final >= cast &&
    cast === ballotRows &&
    correction.participants_at_confirmation === cast &&
    correction.ballots_at_confirmation === ballotRows &&
    correction.selections_at_confirmation === selections &&
    typeof correction.recorded_at === "string" &&
    !Number.isNaN(Date.parse(correction.recorded_at));
  if (!correct) throw new Error("ELECOM eligibility reconciliation failed report checks.");
  return {
    eligibleVoters: correction.qualified_voters_final,
    eligibilitySource: "reconciled_from_elecom_masterlist",
    openingRegisteredVoters: atOpen,
    excludedFromCertifiedRoll: correction.excluded_accounts,
    eligibilityCorrectionRecordedAt: correction.recorded_at
  };
}
