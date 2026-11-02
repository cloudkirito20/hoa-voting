import assert from "node:assert/strict";
import { resolveElectionEligibility } from "../src/election-eligibility.js";
const election={id:3,status:"closed",is_test:false,eligible_voters_at_open:157};
const correction={election_id:3,original_voters_at_open:157,qualified_voters_final:118,
 excluded_accounts:39,participants_at_confirmation:72,ballots_at_confirmation:72,
 selections_at_confirmation:418,recorded_at:"2026-11-02T04:36:15Z"};
const args={election,currentActive:118,correction,cast:72,ballotRows:72,selections:418};
const revised=resolveElectionEligibility(args);
assert.equal(revised.eligibleVoters,118);
assert.equal(revised.openingRegisteredVoters,157);
assert.equal(revised.excludedFromCertifiedRoll,39);
assert.equal(revised.eligibilitySource,"reconciled_from_elecom_masterlist");
assert.equal(Number(((72/118)*100).toFixed(2)),61.02);
assert.equal(resolveElectionEligibility({...args,correction:null}).eligibleVoters,157);
assert.throws(()=>resolveElectionEligibility({...args,correction:{...correction,selections_at_confirmation:419}}));
assert.throws(()=>resolveElectionEligibility({...args,cast:73}));
assert.throws(()=>resolveElectionEligibility({...args,election:{...election,status:"open"}}));
assert.throws(()=>resolveElectionEligibility({...args,correction:{...correction,original_voters_at_open:156}}));
console.log("PASS ELECOM masterlist reconciliation: 118 qualified; 72 ballots; 418 choices; 157 historic; fail-closed checks");
