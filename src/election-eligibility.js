// Verify ELECOM eligibility decisions independently of anonymous ballots.
// Historical opening counts, participation, and vote selections are immutable.
export function resolveElectionEligibility({ election, currentActive, correction, revisions = [], cast, ballotRows, selections }) {
  const atOpen = Number.isSafeInteger(election?.eligible_voters_at_open)
    ? election.eligible_voters_at_open : null;
  const original = {
    eligibleVoters: atOpen ?? Number(currentActive || 0),
    eligibilitySource: atOpen === null ? "current_active_unverified" : "captured_at_open",
    openingRegisteredVoters: atOpen,
    excludedFromCertifiedRoll: 0,
    eligibilityCorrectionRecordedAt: null,
    supersededEligibleVoters: null,
    restoredAccounts: 0,
    eligibilityRevisionRecordedAt: null,
    eligibilityEvidenceStatus: null
  };
  if (!correction && (!Array.isArray(revisions) || revisions.length === 0)) return original;
  if (!correction || !Array.isArray(revisions))
    throw new Error("ELECOM eligibility reconciliation history is incomplete.");

  const fields = ["election_id", "original_voters_at_open", "qualified_voters_final",
    "excluded_accounts", "participants_at_confirmation", "ballots_at_confirmation",
    "selections_at_confirmation"];
  const correctionValid = fields.every(k => Number.isSafeInteger(correction[k]) && correction[k] >= 0) &&
    election.status === "closed" && !election.is_test && atOpen !== null &&
    correction.election_id === election.id &&
    correction.original_voters_at_open === atOpen &&
    correction.qualified_voters_final > 0 &&
    atOpen - correction.qualified_voters_final === correction.excluded_accounts &&
    correction.qualified_voters_final >= cast && cast === ballotRows &&
    correction.participants_at_confirmation === cast &&
    correction.ballots_at_confirmation === ballotRows &&
    correction.selections_at_confirmation === selections &&
    typeof correction.recorded_at === "string" &&
    !Number.isNaN(Date.parse(correction.recorded_at));
  if (!correctionValid) throw new Error("ELECOM eligibility reconciliation failed report checks.");

  let result = {
    ...original,
    eligibleVoters: correction.qualified_voters_final,
    eligibilitySource: "reconciled_from_elecom_masterlist",
    excludedFromCertifiedRoll: correction.excluded_accounts,
    eligibilityCorrectionRecordedAt: correction.recorded_at
  };
  let lastRevisionId = 0;
  let lastRecordedAt = Date.parse(correction.recorded_at);
  for (const revision of revisions) {
    const integers = ["revision_id", "election_id", "superseded_qualified_voters",
      "qualified_voters_final", "restored_accounts", "opening_registered_accounts",
      "participants_at_revision", "ballots_at_revision", "selections_at_revision"];
    const recordedAt = Date.parse(revision?.created_at);
    const valid = revision && integers.every(k => Number.isSafeInteger(revision[k]) && revision[k] >= 0) &&
      revision.revision_id > lastRevisionId &&
      revision.election_id === election.id &&
      revision.opening_registered_accounts === atOpen &&
      revision.superseded_qualified_voters === result.eligibleVoters &&
      revision.restored_accounts > 0 &&
      revision.restored_accounts <= result.excludedFromCertifiedRoll &&
      revision.qualified_voters_final === result.eligibleVoters + revision.restored_accounts &&
      revision.qualified_voters_final <= atOpen &&
      revision.qualified_voters_final >= cast &&
      revision.participants_at_revision === cast &&
      revision.ballots_at_revision === ballotRows &&
      revision.selections_at_revision === selections &&
      ["elecom_member_asserted_pending_roster_certification", "certified_secretary_treasurer"].includes(revision.eligibility_evidence_status) &&
      typeof revision.created_at === "string" &&
      Number.isFinite(recordedAt) && recordedAt >= lastRecordedAt;
    if (!valid) throw new Error("ELECOM eligibility revision failed report checks.");
    result = {
      ...result,
      eligibleVoters: revision.qualified_voters_final,
      eligibilitySource: "reconciled_from_elecom_revision",
      excludedFromCertifiedRoll: atOpen - revision.qualified_voters_final,
      supersededEligibleVoters: result.eligibleVoters,
      restoredAccounts: (result.restoredAccounts || 0) + revision.restored_accounts,
      eligibilityRevisionRecordedAt: revision.created_at,
      eligibilityEvidenceStatus: revision.eligibility_evidence_status
    };
    lastRevisionId = revision.revision_id;
    lastRecordedAt = recordedAt;
  }
  return result;
}
