#!/usr/bin/env node
/** Dependency-free QA of the actual Worker report builder and final report.
 * Usage: node tests/integrity-report-13fields.mjs [path-to-Worker-js]
 * All calls use fake PostgreSQL data; no network, accounts or votes.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { resolve } from 'node:path';

const candidateCounts = new Map(Object.entries({100:59,101:95,102:73,103:121,104:67,105:49,106:84,107:118,108:39,109:67,110:111}));
const ledger13 = {
  ballotRows:200,committedBallots:200,legacyBallots:0,mismatchedBallots:0,
  expectedSelections:883,actualSelections:883,invalidVoteRows:0,
  crossElectionVoteRows:0,choiceLedgerRows:883,baselineChoiceRows:0,
  capturedAtVoteRows:883,choiceMismatchRows:0,choiceMismatchBallots:0
};
const workerPath = process.argv[2]
  ? resolve(process.argv[2])
  : new URL('../src/index.js', import.meta.url);
const source = readFileSync(workerPath,'utf8');
assert.ok(source.includes('function assessElectionIntegrity('),'Expected new integrity report helper');
assert.ok(source.includes('integrityDetails: data.integrityDetails'),'Final report must propagate details');
assert.ok(source.includes('dhsudFinalElectionReport(env,'),'DHSUD final endpoint must be present');
assert.ok(source.includes('electionResults(env,'),'Admin results endpoint must be present');
const compiled = source.replace('import { createClient } from "@supabase/supabase-js";','')
  .replace('export default {','globalThis.__worker = {');
let scenario={...ledger13};
const election={id:11,title:'HTTP QA 2026-10-30 624d5fe6 - REAL HTTP 200 VOTER PRACTICE',
  status:'closed',is_test:true,eligible_voters_at_open:200,voting_ends_at:'2026-10-30T13:50:00Z'};
class FakeQuery {
  constructor(table){this.table=table;}
  select(){return this;}
  eq(){return this;}
  in(){return this;}
  order(){return this;}
  maybeSingle(){return Promise.resolve({data:this.table==='elections'?election:null,error:null});}
  then(resolve,reject){
    const data = this.table==='positions'
      ? [{id:17,title:'Board Member',seats:7,sort_order:1}]
      : this.table==='candidates'
      ? [...candidateCounts.keys()].map((id,i)=>({id:Number(id),position_id:17,full_name:'Candidate '+String.fromCharCode(65+i),sort_order:i+1,statement:'Mock only',photo_path:null}))
      : [];
    return Promise.resolve({data,error:null,count:this.table==='users'||this.table==='ballots'||this.table==='voter_participation'?200:null}).then(resolve,reject);
  }
}
const sb={
  from(table){return new FakeQuery(table);},
  async rpc(name){
    if(name==='hoa_candidate_vote_totals')return {data:[...candidateCounts].map(([candidate_id,votes])=>({candidate_id:Number(candidate_id),votes})),error:null};
    if(name==='hoa_ballot_integrity_summary') return {data:scenario,error:null};
    throw new Error('Unexpected RPC '+name);
  }
};
const context=vm.createContext({createClient:()=>sb,crypto:webcrypto,console,TextEncoder,TextDecoder,Headers,Response,Request,URL,Date,Math});
vm.runInContext(compiled,context,{timeout:10000});
context.__env={SUPABASE_URL:'https://offline-fixture.example',SUPABASE_SECRET_KEY:'not-a-secret'};
async function getResults(){return JSON.parse(JSON.stringify(await vm.runInContext('buildElectionResults(__env,11)',context)));}
async function getFinal(){return (await vm.runInContext('dhsudFinalElectionReport(__env,11)',context)).json();}
function setCase(integrity){scenario=integrity;}

setCase({...ledger13});
let res=await getResults();let final=await getFinal();
assert.equal(res.integrityStatus,'verified');
assert.equal(final.integrityStatus,'verified');
assert.equal(res.integrityDetails.choiceLedgerRows,883);
assert.equal(final.integrityDetails.capturedAtVoteRows,883);
assert.equal(Object.keys(res.integrityDetails).length,13);
assert.equal(Object.keys(final.integrityDetails).length,13);
assert.equal(res.ballotsCast,200);
assert.equal(res.positions[0].candidates.length,11);
assert.equal(final.positions.length,1);
assert.equal(final.hasUnresolvedSeatTies,true);

setCase(Object.fromEntries(Object.entries(ledger13).slice(0,8))); // old 8-field format
res=await getResults();final=await getFinal();
assert.equal(res.integrityStatus,'unverified');
assert.equal(res.integrityDetails,null);
assert.equal(res.voteRecordIntegrityOk,false);
assert.equal(final.integrityStatus,'unverified');

setCase({...ledger13,choiceMismatchRows:2,choiceMismatchBallots:1,mismatchedBallots:1});
res=await getResults();final=await getFinal();
assert.equal(res.integrityStatus,'mismatch');
assert.equal(final.integrityStatus,'mismatch');
assert.equal(res.voteRecordIntegrityOk,false);

setCase({...ledger13,baselineChoiceRows:883,capturedAtVoteRows:0});
res=await getResults();final=await getFinal();
assert.equal(res.integrityStatus,'legacy_unverifiable');
assert.equal(final.integrityStatus,'legacy_unverifiable');
assert.equal(res.voteRecordIntegrityOk,false);

setCase({...ledger13,choiceLedgerRows:882});
assert.equal((await getResults()).integrityStatus,'mismatch');
setCase({...ledger13,ballotRows:201});
assert.equal((await getResults()).integrityStatus,'mismatch');
setCase({...ledger13,actualSelections:882});
assert.equal((await getResults()).integrityStatus,'mismatch');
setCase({...ledger13,choiceMismatchRows:undefined});
assert.equal((await getResults()).integrityStatus,'unverified');
setCase({...ledger13,choiceMismatchRows:-1});
assert.equal((await getResults()).integrityStatus,'unverified');
setCase({...ledger13,choiceMismatchRows:0.3});
assert.equal((await getResults()).integrityStatus,'unverified');
setCase({...ledger13,choiceMismatchRows:'0'});
assert.equal((await getResults()).integrityStatus,'verified');
setCase({...ledger13,choiceMismatchRows:'000'});
assert.equal((await getResults()).integrityStatus,'unverified');
console.log('PASS: real Worker builder and final report preserve all 13 fields; 200/883 verified; fail closed on missing/invalid ledger fields; tampering and baseline not certified. All offline.');
