// v2.5.2 offline regression checks; NO live Supabase calls or data changes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const backend = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const frontend = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../supabase/v2.5.2-install-parts/01_test_election_mode.sql', import.meta.url), 'utf8');
const sqlCheck = readFileSync(new URL('../supabase/v2.5.2-install-parts/02_verify_test_election_mode.sql', import.meta.url), 'utf8');

assert.match(frontend, /name="isTest" value="yes"/);
assert.match(frontend, /isTest:f\.has\('isTest'\)/);
assert.match(frontend, /Unchecked = OFFICIAL/);
assert.match(frontend, /d\.election\.isTest\?'TEST'/);
assert.match(frontend, /TEST \/ PRACTICE - Not an official election/);
assert.match(frontend, /PRACTICE DATA - NOT FOR CERTIFICATION/);
assert.match(frontend, /PRACTICE ONLY|TEST ONLY/);
assert.match(frontend, /Delete TEST election/);
assert.match(frontend, /DELETE TEST/);
for (const snippet of [
  'ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false',
  'OR item.status IS DISTINCT FROM \'closed\'',
  "OR ballots_n<>1 OR participation_n<>1 OR votes_n<>2",
  "OR positions_n<>1 OR candidates_n<>4 OR committee_n<>2",
  'trg_hoa_guard_election_type_immutable',
  "Election type (Official/Test) is permanent",
  'trg_hoa_guard_election_delete_mode',
  'IF NOT OLD.is_test',
  'IF OLD.status = \'open\'',
  'IF current_setting(\'hoa.allow_test_election_delete\',true)',
  'hoa_delete_test_election',
  'p_confirm_title IS DISTINCT FROM e.title',
  'FOR UPDATE',
  'pg_advisory_xact_lock(73014902)',
  "'election.test_deleted'",
  "DELETE FROM public.elections WHERE id=e.id",
  'REVOKE EXECUTE ON FUNCTION public.hoa_delete_election(bigint)',
  'GRANT EXECUTE ON FUNCTION public.hoa_delete_test_election'
]) assert.ok(sql.includes(snippet), `Missing safeguard: ${snippet}`);
assert.match(sqlCheck,/anon_cannot_delete_test/);
assert.match(sqlCheck,/legacy_delete_rpc_disabled/);

let election = null;
const inserts=[];
const calls=[];
const sb = {
  from(table) {
    assert.equal(table,'elections');
    return {
      insert(data) {
        inserts.push(data);
        return {select: () => ({single: async () => ({data: {id: 42}, error: null})})};
      },
      select(columns) {
        assert.equal(columns,'id,title,status,is_test');
        return {
          eq(col,id) {
            assert.equal(col,'id'); assert.equal(id,2);
            return {maybeSingle: async () => ({data: election, error: null})};
          }
        };
      }
    };
  },
  async rpc(name,args) {
    calls.push({name,args});
    return {data: {deleted: true, id: 2}, error: null};
  }
};
const context=vm.createContext({
  db:()=>sb,
  readJson:async req=>req.body,
  clean:input=>String(input||'').trim(),
  validateTimeframe:()=>({voting_ends_at:'2026-10-18T10:00:00.000Z'}),
  json:(data,status=200)=>({status,data}),
  assertDb:error=>{if(error)throw error},
  audit:async()=>{},
  electionCandidatePhotoPaths:async()=>[],
  removeCandidatePhotoObjects:async()=>{},
});
const source = backend.slice(backend.indexOf('async function createElection('),backend.indexOf('async function getElection('));
vm.runInContext(source,context,{timeout:3000});
const create = input=>vm.runInContext('createElection',context)({body:input}, {}, {id:7});
const del = input=>vm.runInContext('deleteElection',context)({body:input}, {}, {id:7},2);
let result=await create({title:'Official',description:''});
assert.equal(result.status,201);
assert.equal(inserts.at(-1).is_test,false);
result=await create({title:'Practice',isTest:true});
assert.equal(result.status,201);
assert.equal(inserts.at(-1).is_test,true);
result=await create({title:'Invalid',isTest:'true'});
assert.equal(result.status,400);
assert.equal(inserts.length,2);
const request={confirmTitle:'Mock Vote',confirmPhrase:'DELETE TEST'};
election={id:2,title:'Mock Vote',status:'closed',is_test:false};
result=await del(request);
assert.equal(result.status,409);
assert.equal(calls.length,0);
election={...election,is_test:true,status:'open'};
result=await del(request);
assert.equal(result.status,409);
assert.equal(calls.length,0);
election={...election,status:'closed'};
result=await del({confirmTitle:'Mock Vote',confirmPhrase:'not confirmed'});
assert.equal(result.status,400);
assert.equal(calls.length,0);
result=await del(request);
assert.equal(result.status,200);
assert.equal(calls.length,1);
assert.equal(calls[0].name,'hoa_delete_test_election');
assert.equal(calls[0].args.p_admin_id,7);
assert.equal(calls[0].args.p_confirm_title,'Mock Vote');
console.log('PASS test election modes: default OFFICIAL, checkbox TEST, no official deletion, no open-test deletion, double confirm, guarded SQL RPC, preserved v2.5.1 voucher functions');
