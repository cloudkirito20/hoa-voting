/* Offline v2.5.1 regression: QR-only printing must never reset credentials;
   legacy reissue is restricted, confirmed, encrypted, bounded and atomic via SQL. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
const workerSource=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const source=workerSource.replace('import { createClient } from "@supabase/supabase-js";','')
  .replace('export default {','globalThis.__worker = {');
let actor={id:9,role:'admin',username:'ADMIN123',full_name:'Admin Test',active:true},
    voters=[
      {id:31,role:'voter',username:'HOA-TEST123',full_name:'Initial Voter',block:'1',lot:'2',must_change_password:true,active:true},
      {id:32,role:'voter',username:'HOA-TEST124',full_name:'Changed Voter',block:'1',lot:'3',must_change_password:false,active:true},
      {id:33,role:'voter',username:'HOA-TEST125',full_name:'Archived Voter',block:'1',lot:'4',must_change_password:true,active:true},
      {id:34,role:'voter',username:'HOA-TEST126',full_name:'Disabled Voter',block:'1',lot:'5',must_change_password:true,active:false}
    ],
    archives=[{voter_id:33}], open=false, audit=[], issued=[], rpcCalls=[], attemptCount=0;
const session={token_hash:'hash',user_id:9,csrf_token:'csrf',expires_at:new Date(Date.now()+3600000).toISOString()};
class Query {
  constructor(table){this.table=table;this.filters={};this.ids=null;this.limitSize=null;this.mutation=null;}
  select(){return this}
  eq(k,v){this.filters[k]=v;return this}
  in(k,v){this.ids={key:k,values:v};return this}
  gte(){return this}
  order(){return this}
  limit(n){this.limitSize=n;return this}
  async maybeSingle(){return {data:this.table==='sessions'?session:this.table==='users'?actor:null,error:null}}
  insert(record){if(this.table==='audit_log')audit.push(record);if(this.table==='login_attempts')attemptCount++;return Promise.resolve({error:null})}
  delete(){this.mutation='delete';return this}
  then(resolve,reject){
    if(this.mutation==='delete'){
      if(this.table==='login_attempts')attemptCount=0;
      return Promise.resolve({data:null,error:null}).then(resolve,reject);
    }
    let data=[];
    if(this.table==='users')data=voters.filter(u=>Object.entries(this.filters).every(([k,v])=>u[k]===v));
    if(this.table==='voter_vouchers')data=archives;
    if(this.table==='elections')data=open?[{id:1,status:'open'}]:[];
    if(this.ids)data=data.filter(x=>this.ids.values.includes(x[this.ids.key]));
    if(this.limitSize!=null)data=data.slice(0,this.limitSize);
    return Promise.resolve({data,count:this.table==='login_attempts'?attemptCount:data.length,error:null}).then(resolve,reject);
  }
}
const fakeDb={from(name){return new Query(name)},async rpc(name,payload){rpcCalls.push({name,payload});
  if(name==='hoa_verify_login')return {data:payload.p_password==='test-admin-password'?[actor]:[],error:null};
  if(name==='hoa_reissue_legacy_vouchers'){
    issued.push(...payload.p_voters);
    for(const item of payload.p_voters)archives.push({voter_id:item.voterId});
    return {data:payload.p_voters.length,error:null};
  }
  throw new Error('Unexpected RPC '+name);
}};
const context=vm.createContext({createClient:()=>fakeDb,crypto:webcrypto,console,TextEncoder,TextDecoder,
  Headers,Response,Request,URL,Date,Uint8Array,Uint32Array,Math});
vm.runInContext(source,context,{timeout:5000});
const worker=context.__worker;
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'testing-only',VOUCHER_ENCRYPTION_KEY:'ab'.repeat(32)};
function req(path,body={},csrf='csrf'){return new Request('https://hoa.test'+path,{method:'POST',headers:{cookie:'hoa_session=a','x-csrf-token':csrf,'content-type':'application/json'},body:JSON.stringify(body)})}
async function call(path,body={},role='admin',csrf='csrf',cfg=env){actor.role=role;const r=await worker.fetch(req(path,body,csrf),cfg);return {status:r.status,data:await r.json()}}
const qr='/api/admin/vouchers/qr-slips';
const legacy='/api/admin/vouchers/reissue-legacy';
let r=await call(qr,{},'voter');
assert.equal(r.status,403);
r=await call(qr,{},'admin','badcsrf');
assert.equal(r.status,403);
r=await call(qr);
assert.equal(r.status,200);
assert.equal(r.data.passwordsUnchanged,true);
assert.equal(r.data.passwordIncluded,false);
assert.equal(r.data.voters.length,3);
assert.ok(r.data.voters.every(v=>!('password' in v)));
assert.equal(issued.length,0);
assert.equal(audit.at(-1).action,'voter.qr_slips_print');
assert.ok(!JSON.stringify(audit).includes('test-admin-password'));

r=await call(legacy,{voterIds:[31],adminPassword:'test-admin-password'});
assert.equal(r.status,400); // Require explicit confirmation.
r=await call(legacy,{voterIds:[31],adminPassword:'bad',confirm:'REISSUE'});
assert.equal(r.status,403);
r=await call(legacy,{voterIds:[31],adminPassword:'test-admin-password',confirm:'REISSUE'},'voter');
assert.equal(r.status,403);
r=await call(legacy,{voterIds:[31],adminPassword:'test-admin-password',confirm:'REISSUE'},'admin','wrong');
assert.equal(r.status,403);
r=await call(legacy,{voterIds:[32],adminPassword:'test-admin-password',confirm:'REISSUE'});
assert.equal(r.status,409); // Personalized password cannot be bulk reset.
r=await call(legacy,{voterIds:[33],adminPassword:'test-admin-password',confirm:'REISSUE'});
assert.equal(r.status,409); // Already archived: reprint unchanged.
r=await call(legacy,{voterIds:[34],adminPassword:'test-admin-password',confirm:'REISSUE'});
assert.equal(r.status,409); // Disabled account cannot be reset.
open=true;
r=await call(legacy,{voterIds:[31],adminPassword:'test-admin-password',confirm:'REISSUE'});
assert.equal(r.status,409);
open=false;
r=await call(legacy,{voterIds:[31],adminPassword:'test-admin-password',confirm:'REISSUE'});
assert.equal(r.status,200);
assert.equal(r.data.passwordsReplaced,true);
assert.equal(r.data.count,1);
assert.equal(r.data.voters[0].username,'HOA-TEST123');
assert.match(r.data.voters[0].password,/^.{12}$/);
assert.ok(!('voucherCiphertext' in r.data.voters[0]));
assert.equal(issued.length,1);
assert.match(issued[0].voucherNonce,/^[0-9a-f]{24}$/);
assert.ok(issued[0].voucherCiphertext.length>=48);
assert.ok(!JSON.stringify(audit).includes(r.data.voters[0].password));
r=await call(legacy,{voterIds:[31],adminPassword:'test-admin-password',confirm:'REISSUE'});
assert.equal(r.status,409); // Cannot reissue twice; unchanged archive is reprintable.
assert.ok(rpcCalls.filter(x=>x.name==='hoa_reissue_legacy_vouchers').length===1);

const sql=readFileSync(new URL('../supabase/v2.5.1-install-parts/01_bulk_legacy_voucher_reissue.sql',import.meta.url),'utf8');
for(const phrase of [
  'pg_advisory_xact_lock(73014902)',
  "where status='open'",
  'and role=\'voter\' for update',
  'not existing_user.must_change_password',
  'from public.voter_vouchers where voter_id=v_voter_id',
  'public.hoa_reset_password_with_voucher(',
  "'voter.legacy_credential_reissue'",
  'from public,anon,authenticated',
  'to service_role'
])assert.ok(sql.includes(phrase),`SQL should contain ${phrase}`);
assert.ok(!sql.includes('delete from public.voter_participation'));
assert.ok(!sql.includes('delete from public.ballots'));
assert.ok(!sql.includes('delete from public.users'));

const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
assert.ok(ui.includes('id="printAllQrSlips"'));
assert.ok(ui.includes('id="issueLegacyQrVouchers"'));
assert.ok(ui.includes('qrOnly?\'Use your existing password\''));
assert.ok(ui.includes('confirmation!==\'REISSUE\''));
console.log('PASS legacy vouchers: QR print without credential mutation, admin auth and CSRF, no changed-password bulk resets, no archived overwrites, election lock, AES archive, SQL transaction guards');
