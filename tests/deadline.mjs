// Static and pure-function regression, not a live PostgreSQL concurrency test.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const src=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')
  .replace('import { createClient } from "@supabase/supabase-js";','')
  .replace('export default {','globalThis.__worker = {');
const ctx=vm.createContext({console,TextEncoder,TextDecoder,Date,Math,URL,Headers,Response,Request});
vm.runInContext(src,ctx,{timeout:5000});
const f=vm.runInContext('({validateTimeframe,isExpiredElection,rankElectionPosition})',ctx);
const future=new Date(Date.now()+3600_000).toISOString();
const past=new Date(Date.now()-3600_000).toISOString();
assert.equal(f.validateTimeframe({votingEndsAt:future}).voting_ends_at,future);
assert.ok(f.validateTimeframe({votingEndsAt:past}).error);
assert.ok(f.validateTimeframe({votingEndsAt:'2026-10-30T20:30'}).error,'timezone mandatory');
assert.ok(f.validateTimeframe({votingStartsAt:future,votingEndsAt:future}).error);
assert.equal(f.isExpiredElection({status:'open',voting_ends_at:past}),true);
assert.equal(f.isExpiredElection({status:'open',voting_ends_at:future}),false);
assert.equal(f.isExpiredElection({status:'open',voting_ends_at:null}),true);
assert.equal(f.isExpiredElection({status:'closed',voting_ends_at:past}),false);
const tally=f.rankElectionPosition({title:'Board',seats:1,totalVotes:7,candidates:[
  {id:1,full_name:'A',votes:3},{id:2,full_name:'B',votes:3},{id:3,full_name:'C',votes:1}
]});
assert.equal(tally.cutoffTie,true);
assert.equal(tally.rows[0].rank,1);
assert.equal(tally.rows[1].rank,1);
assert.match(tally.rows[0].result,/TIE/);
assert.ok(!tally.rows.some(x=>/proclaimed/i.test(x.result)));
const testDir='../supabase/v2.3-install-parts/';
const file=(filename)=>readFileSync(new URL(testDir+filename,import.meta.url),'utf8');
assert.match(file('03_ballot_cutoff_guards.sql'),/clock_timestamp\(\)/);
assert.match(file('03_ballot_cutoff_guards.sql'),/insert into public.voter_participation/);
assert.match(file('04_automatic_closure.sql'),/update public.elections/);
assert.match(file('04_automatic_closure.sql'),/status='closed'/);
const conf=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
assert.ok(conf.triggers.crons.includes('* * * * *'));
assert.match(src,/dhsudFinalElectionReport/);
assert.match(src,/data.election.status !== "closed"/);
assert.match(src,/committeeMembers:/);
const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
assert.match(ui,/function openCommitteeEditor/);
assert.match(ui,/function printDhsudExport/);
assert.match(ui,/System-generated DHSUD-aligned ELECOM worksheet/);
assert.match(ui,/Philippine time UTC\+8/);
console.log('PASS deadline/report: database cutoff, cron, server-side tied ranking, certification caution, committee names, Philippine-time UI');
