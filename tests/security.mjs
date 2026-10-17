/* Security regression checks for the Worker routes and SQL source.
   Not a replacement for a live PostgreSQL integration / concurrency test. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const workerSrc=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const uiSrc=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const sqlRoot=new URL('../supabase/',import.meta.url);
const querySql=(f)=>readFileSync(new URL(f,sqlRoot),'utf8');
const voteSql=querySql('v2.2-install-parts/07_ballot_change_guard.sql');
const ownerSql=querySql('v2.2-install-parts/08_one_homeowner_one_account.sql');
const passwordSql=querySql('v2.2-install-parts/05_change_own_password.sql');
const columnsSql=querySql('v2.2-install-parts/01_password_columns.sql');
const voterDataSql=querySql('v2.2-install-parts/03_bulk_voter_accounts.sql');
assert.ok(querySql('v2.2-install-parts/04_password_reset.sql').includes('must_change_password=true'));
assert.ok(voteSql.includes('must_change_password=false'));
assert.ok(voteSql.includes('insert into public.voter_participation(user_id,election_id,receipt_code)'));
assert.ok(columnsSql.includes('must_change_password boolean not null default false'));
assert.ok(passwordSql.includes('crypt(p_current_password,existing_hash)'));
assert.ok(passwordSql.includes('p_new_password,gen_salt'));
assert.ok(passwordSql.includes('delete from public.sessions where user_id=p_user_id'));
assert.ok(voterDataSql.includes('must_change_password'));
assert.ok(ownerSql.includes('create unique index if not exists users_one_voter_per_normalized_homeowner_uq'));
assert.ok(ownerSql.includes('raise exception'));
assert.ok(querySql('v2.2-install-parts/10_open_election_race_guards.sql').includes('pg_advisory_xact_lock(73014902)'));
assert.ok(querySql('v2.2-install-parts/06_atomic_admin_setup.sql').includes('pg_advisory_xact_lock'));
const schema=querySql('schema.sql');
assert.ok(schema.includes('primary key(user_id,election_id)'));
assert.ok(workerSrc.includes('path === "/api/voter/change-password"'));
assert.ok(workerSrc.includes('content-security-policy'));
assert.ok(querySql('v2.2-install-parts/09_verify_installation.sql').includes('one_ballot_per_voter_primary_key'));
assert.ok(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8').includes('\"run_worker_first\": true'));
assert.ok(workerSrc.includes('if (auth.user.role === "voter" && auth.user.must_change_password)'));
assert.ok(uiSrc.includes('function renderVoterPasswordChange()'));
assert.ok(uiSrc.includes('currentPassword,newPassword'));
assert.ok(uiSrc.includes('confirmPassword'));
assert.ok(uiSrc.includes('renderVoterPasswordChange();'));
assert.ok(uiSrc.includes('r.errors.push(\'Duplicate homeowner in CSV: one account allowed\')'));

let state={ user: { id:1001,username:'HOA-DEMO01',role:'voter',full_name:'Test Voter',block:'2',lot:'4',active:true,must_change_password:true }, session: {token_hash:'hash',user_id:1001,csrf_token:'test-csrf',expires_at:new Date(Date.now()+300000).toISOString()}, rpcCalls:[],attempts:0};
class FakeQuery {
  constructor(table) { this.table=table;this.filters={}; }
  select(){return this} eq(k,v){this.filters[k]=v;return this} gte(){return this} gt(){return this} lt(){return this} lte(){return this}
  maybeSingle(){return Promise.resolve({data: this.table==='sessions'?state.session:this.table==='users'?state.user:null,error:null});}
  single(){return this.maybeSingle()}
  then(resolve,reject){return Promise.resolve({data:[], count:state.attempts,error:null}).then(resolve,reject)}
  insert(){state.attempts++;return Promise.resolve({data:null,error:null})}
  delete(){return this}
}
const fakeClient={
  from(table){return new FakeQuery(table)},
  async rpc(name, payload){state.rpcCalls.push({name,payload});
    if(name==='hoa_change_own_password'){
      if(payload.p_current_password!=='issued-old-password')return {data:null,error:{message:'Current password is incorrect.'}};
      state.session=null;
      return {data:true,error:null};
    }
    return {data:null,error:{message:'Unexpected RPC '+name}};
  }
};
const src=workerSrc.replace('import { createClient } from "@supabase/supabase-js";','')
  .replace('export default {','globalThis.__worker = {');
const ctx=vm.createContext({createClient(){return fakeClient},crypto:webcrypto,console,TextEncoder,TextDecoder,Headers,Response,Request,URL,Date,Uint8Array,Uint32Array,Math});
vm.runInContext(src,ctx,{timeout:3000});
const worker=ctx.__worker;
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'only-in-test'};
function request(path,method='GET',body){return new Request(`https://hoa.test${path}`,{method,headers:{cookie:'hoa_session=test-cookie','x-csrf-token':'test-csrf',...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined})}
async function call(path,method='GET',body){const res=await worker.fetch(request(path,method,body),env);return {status:res.status, data:await res.json(), cookie:res.headers.get('set-cookie')};}

let res=await call('/api/voter/ballot');
assert.equal(res.status,403); assert.equal(res.data.code,'PASSWORD_CHANGE_REQUIRED');
res=await call('/api/voter/vote','POST',{electionId:1,selections:{"1":[1]}});
assert.equal(res.status,403); assert.equal(res.data.code,'PASSWORD_CHANGE_REQUIRED');
// A giant forged JSON vote must be rejected before buffering it all.
res=await call('/api/voter/change-password','POST',{currentPassword:'x'.repeat(270000),newPassword:'a'.repeat(16)});
assert.equal(res.status,400);
res=await call('/api/me');
assert.equal(res.status,200); assert.equal(res.data.user.mustChangePassword,true);
res=await call('/api/voter/change-password','POST',{currentPassword:'incorrect-password',newPassword:'new-long-passphrase-123'});
assert.equal(res.status,401); assert.equal(state.attempts,1);assert.ok(state.session);
res=await call('/api/voter/change-password','POST',{currentPassword:'issued-old-password',newPassword:'new-long-passphrase-123'});
assert.equal(res.status,200);assert.equal(res.data.signedOut,true);assert.match(res.cookie,/Max-Age=0/);
assert.deepEqual(Object.keys(state.rpcCalls.at(-1).payload).sort(),['p_current_password','p_new_password','p_user_id']);
assert.equal(state.rpcCalls.at(-1).payload.p_user_id,1001);
res=await call('/api/voter/vote','POST',{electionId:1,selections:{"1":[1]}});
assert.equal(res.status,401); // Password change invalidated all sessions.

console.log('PASS security: forced change is server-side, direct voting blocked, verified current password, expired sessions, one-user guard SQL, duplicate-owner index, atomic admin bootstrap');
