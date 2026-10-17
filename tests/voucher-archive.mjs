/* Offline regression: passwords stay unchanged on reprint and are not available
   to voters/after a password change. Supabase DB still requires live testing. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')
  .replace('import { createClient } from "@supabase/supabase-js";','')
  .replace('export default {','globalThis.__worker = {');
let admin={id:9,role:'admin',username:'ADMIN123',full_name:'System Admin',active:true},
  users=[{id:31,role:'voter',username:'HOA-TEST123',full_name:'First Voter',block:'1',lot:'2',must_change_password:true,active:true},
         {id:32,role:'voter',username:'HOA-TEST124',full_name:'Other Voter',block:'2',lot:'3',must_change_password:false,active:true}],
  vouchers=[],rpcCalls=[],auditEntries=[],failedLogins=0;
const session={token_hash:'abc',user_id:9,csrf_token:'csrf',expires_at:new Date(Date.now()+360000).toISOString()};
class FakeQuery {
  constructor(table){this.table=table;this.filters={};}
  select(){return this}
  eq(k,v){this.filters[k]=v;return this}
  gte(){return this}
  in(k,v){this.filters[k]=v;return this}
  order(){return this}
  limit(){return this}
  async maybeSingle(){return {data:this.table==='sessions'?session:this.table==='users'?admin:null,error:null}}
  async single(){return this.maybeSingle()}
  async insert(data){
    if(this.table==='audit_log')auditEntries.push(data);
    if(this.table==='login_attempts')failedLogins++;
    return {data:null,error:null};
  }
  delete(){this.mutation='delete';return this}
  then(resolve,reject){
    let data=[];
    if(this.mutation==='delete') {if(this.table==='login_attempts') failedLogins=0;return Promise.resolve({data:null,error:null}).then(resolve,reject)}
    if(this.table==='users'){
      data=users.filter(u=>u.role===this.filters.role &&(!this.filters.id||this.filters.id.includes(u.id)));
    }
    if(this.table==='voter_vouchers'){
      data=vouchers.filter(v=>(this.filters.voter_id||[]).includes(v.voter_id));
    }
    return Promise.resolve({data,count: this.table==='login_attempts'?failedLogins:data.length,error:null}).then(resolve,reject);
  }
}
const db={from(table){return new FakeQuery(table)}, async rpc(name,payload){rpcCalls.push({name,payload});
  if(name==='hoa_verify_login')return {data:payload.p_password==='test-admin-password'?[admin]:[],error:null};
  throw Error('Unexpected RPC '+name);
}};
const context=vm.createContext({createClient:()=>db,crypto:webcrypto,console,TextEncoder,TextDecoder,
  Headers,Response,Request,URL,Date,Uint8Array,Uint32Array,Math});
vm.runInContext(source,context,{timeout:5000});
const fns=vm.runInContext('({archiveVoucher,recoverVoucher})',context);
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'testing-only',VOUCHER_ENCRYPTION_KEY:'ab'.repeat(32)};
const archived=await fns.archiveVoucher(env,'HOA-TEST123','original-unchanged-credential');
assert.match(archived.voucherNonce,/^[a-f0-9]{24}$/);
assert.ok(archived.voucherCiphertext.length>=48);
assert.equal(await fns.recoverVoucher(env,'HOA-TEST123',archived.voucherNonce,archived.voucherCiphertext),'original-unchanged-credential');
await assert.rejects(fns.recoverVoucher(env,'HOA-ANOTHER',archived.voucherNonce,archived.voucherCiphertext));
await assert.rejects(fns.recoverVoucher({...env,VOUCHER_ENCRYPTION_KEY:'12'.repeat(32)},'HOA-TEST123',archived.voucherNonce,archived.voucherCiphertext));
vouchers=[{voter_id:31,nonce_hex:archived.voucherNonce,ciphertext_hex:archived.voucherCiphertext}];
const worker=context.__worker;
function req(body,csrf='csrf') {return new Request('https://hoa.test/api/admin/vouchers/reprint',{
  method:'POST',headers:{cookie:'hoa_session=a', 'x-csrf-token':csrf,'content-type':'application/json'},body:JSON.stringify(body)});}
async function call(body,role='admin',csrf='csrf',customEnv=env){admin.role=role;const r=await worker.fetch(req(body,csrf),customEnv);return {status:r.status,data:await r.json()};}
let r=await call({voterIds:[31,32],adminPassword:'wrong'});
assert.equal(r.status,403);assert.equal(auditEntries.length,0);
r=await call({voterIds:[31,32],adminPassword:'test-admin-password'},'admin','wrong');
assert.equal(r.status,403);
r=await call({voterIds:[31,32],adminPassword:'test-admin-password'},'voter');
assert.equal(r.status,403);
r=await call({voterIds:[31,32],adminPassword:'test-admin-password'});
assert.equal(r.status,200);
assert.equal(r.data.passwordsUnchanged,true);
assert.equal(r.data.voters.length,1);
assert.equal(r.data.voters[0].password,'original-unchanged-credential');
assert.equal(r.data.skipped.length,1);
assert.equal(auditEntries.length,1);
assert.equal(auditEntries[0].details.count,1);
assert.ok(!JSON.stringify(auditEntries).includes('original-unchanged-credential'));
assert.ok(rpcCalls.every(x=>x.name==='hoa_verify_login'),'Reprint MUST NOT call password reset/update');
r=await call({all:true,adminPassword:'test-admin-password'},'admin','csrf',{...env,VOUCHER_ENCRYPTION_KEY:'cd'.repeat(32)});
assert.equal(r.status,503);
assert.match(r.data.error,/No passwords were changed/i);
users[0].must_change_password=false;
r=await call({all:true,adminPassword:'test-admin-password'});
assert.equal(r.data.voters.length,0);
assert.equal(r.data.skipped.length,2);
const migration=readFileSync(new URL('../supabase/v2.5-install-parts/03_purge_archive_after_password_change.sql',import.meta.url),'utf8');
assert.match(migration,/after update of password_hash,must_change_password/i);
assert.match(migration,/delete from public.voter_vouchers/i);
assert.match(readFileSync(new URL('../supabase/v2.5-install-parts/02_atomic_voucher_issuance.sql',import.meta.url),'utf8'),/hoa_bulk_create_voters_with_vouchers/);
console.log('PASS voucher: AES-GCM AAD and key protection, admin reauth, CSRF, role, print-only, audit log, changed-password skip, missing-key failure');
