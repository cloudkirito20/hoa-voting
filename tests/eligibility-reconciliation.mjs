import assert from "node:assert/strict";
import { resolveElectionEligibility } from "../src/election-eligibility.js";
const election={id:3,status:"closed",is_test:false,eligible_voters_at_open:157};
const correction={election_id:3,original_voters_at_open:157,qualified_voters_final:118,
 excluded_accounts:39,participants_at_confirmation:72,ballots_at_confirmation:72,
 selections_at_confirmation:418,recorded_at:"2026-11-02T04:36:15Z"};
const revision={revision_id:1,election_id:3,superseded_qualified_voters:118,
 qualified_voters_final:157,restored_accounts:39,opening_registered_accounts:157,
 participants_at_revision:72,ballots_at_revision:72,selections_at_revision:418,
 reconciliation_basis:"ELECOM reconciliation; documentary certification pending",
 eligibility_evidence_status:"elecom_member_asserted_pending_roster_certification",
 created_at:"2026-11-02T10:07:28Z"};
const args={election,currentActive:157,correction,revisions:[revision],cast:72,ballotRows:72,selections:418};
const original=resolveElectionEligibility({...args,revisions:[]});
assert.equal(original.eligibleVoters,118);
assert.equal(original.openingRegisteredVoters,157);
assert.equal(original.excludedFromCertifiedRoll,39);
const revised=resolveElectionEligibility(args);
assert.equal(revised.eligibleVoters,157);
assert.equal(revised.supersededEligibleVoters,118);
assert.equal(revised.restoredAccounts,39);
assert.equal(revised.excludedFromCertifiedRoll,0);
assert.equal(revised.eligibilitySource,"reconciled_from_elecom_revision");
assert.equal(revised.eligibilityEvidenceStatus,"elecom_member_asserted_pending_roster_certification");
assert.equal(Number(((72/157)*100).toFixed(2)),45.86);
assert.equal(resolveElectionEligibility({...args,correction:null,revisions:[]}).eligibleVoters,157);
assert.throws(()=>resolveElectionEligibility({...args,correction:null}));
for (const bad of [
  {...revision,qualified_voters_final:156},
  {...revision,restored_accounts:38},
  {...revision,participants_at_revision:73},
  {...revision,ballots_at_revision:73},
  {...revision,selections_at_revision:419},
  {...revision,opening_registered_accounts:156},
  {...revision,superseded_qualified_voters:119},
  {...revision,eligibility_evidence_status:"certified_without_evidence"},
  {...revision,created_at:"invalid"}
]) assert.throws(()=>resolveElectionEligibility({...args,revisions:[bad]}));
assert.throws(()=>resolveElectionEligibility({...args,cast:73}));
assert.throws(()=>resolveElectionEligibility({...args,election:{...election,status:"open"}}));
assert.throws(()=>resolveElectionEligibility({...args,revisions:[revision,revision]}));
console.log("PASS: 157 qualified, 39 restored, 72 ballots, 418 selections, 45.86% turnout; invalid revisions fail closed");
