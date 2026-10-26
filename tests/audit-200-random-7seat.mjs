/*
 * HOA Voting v2.5.4: 200 randomized synthetic voters, 11 candidates, 7 seats,
 * one Board Member position. Uses actual Worker routing/auth/validation/tally
 * with an IN-MEMORY Supabase emulator; NOT a real PostgreSQL/Cloudflare load test.
 * Seeds are reproducible and represent varied voter preferences, NOT real people.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const N=200, SEATS=7, CANDIDATES=11, EID=200, PID=501;
const candidateIds=Array.from({length:CANDIDATES},(_,i)=>601+i);
const names=candidateIds.map((_,i)=>'Candidate '+String.fromCharCode(65+i));
const clockNow=Date.now();
const after=new Date(clockNow+3600_000).toISOString();
const PASSWORD='Synthetic-Only-AccountPass';
const auditEnv={SUPABASE_URL:'https://stub.invalid',SUPABASE_SECRET_KEY:'TEST_ONLY_NOT_SECRET'};
const seedInput=Number(process.env.HOA_AUDIT_SEED||20261024)>>>0;
const outdir=process.env.HOA_AUDIT_OUTPUT_DIR || fileURLToPath(new URL('../audit-results/',import.meta.url));
mkdirSync(outdir,{recursive:true});
let assertions=0;
function equal(a,b,message){assert.deepEqual(a,b,message);assertions++}
function truth(v,message){assert.ok(v,message);assertions++}
function status(r,n,message){equal(r.status,n,`${message}: ${r.status} ${JSON.stringify(r.data)}`)}
function rng(seed){let s=seed||0x97124;return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return (s>>>0)/4294967296}}
function generateVoters(seed){
 const rand=rng(seed);
 // Not an engineered tally: four independent neighborhood/preference groups,
 // popularity biases, independent noise, short and long ballots, random order.
 const support=[1.18,.89,1.35,.65,1.62,.82,.72,1.46,.96,1.58,.79];
 const neighborhoods=[
   [1.5,.75,1.15,.55,1.1,.8,1.3,.9,1.6,.6,.7],
   [.7,1.6,.6,1.5,1.15,1.3,.8,1.2,.65,1.1,.9],
   [1.3,1.15,1.4,.85,.8,.7,1.2,1.5,.65,.85,1.2],
   [.75,.95,1.1,1.4,1.25,.75,1.3,.7,1.5,1.45,1.2]
 ];
 const outcome=[],styles=[];
 for(let i=0;i<N;i++){
  const group=Math.floor(rand()*neighborhoods.length);
  const behaviorDraw=rand();
  const style=behaviorDraw<.19?'minimal':behaviorDraw<.44?'selective':behaviorDraw<.79?'broad':'full';
  let count;
  if(style==='minimal')count=1+Math.floor(rand()*2);
  else if(style==='selective')count=2+Math.floor(rand()*3);
  else if(style==='broad')count=4+Math.floor(rand()*4);
  else count=7;
  const ranks=candidateIds.map((id,k)=>{
   const weight=support[k]*neighborhoods[group][k]*(0.75+0.5*rand());
   // Exponential race yields weighted samples WITHOUT replacement.
   return {id,score:-Math.log(Math.max(1e-12,rand()))/weight};
  }).sort((a,b)=>a.score-b.score).slice(0,count).map(x=>x.id);
  for(let k=ranks.length-1;k>0;k--){const j=Math.floor(rand()*(k+1));[ranks[j],ranks[k]]=[ranks[k],ranks[j]]}
  outcome.push(ranks);styles.push({group,style});
 }
 return {ballots:outcome,styles};
}
const {ballots:dataset,styles}=generateVoters(seedInput);
const trueCount=new Map(candidateIds.map(id=>[id,0]));
for(const choices of dataset){for(const id of choices)trueCount.set(id,trueCount.get(id)+1)}
const totals=candidateIds.map(id=>trueCount.get(id));
const sum=totals.reduce((a,b)=>a+b,0);
truth(new Set(dataset.map(r=>r.join(','))).size>145,'Ballots must show realistic variety, not repeated same slate');
truth(dataset.every(x=>x.length>=1&&x.length<=7),'All synthetic ballots in seat range');
truth(dataset.every(x=>new Set(x).size===x.length),'No repeated candidates on valid ballots');
truth(totals.every(x=>x>0&&x<N),'All eleven candidates receive votes, none receives unanimous support');
truth(new Set(dataset.map(x=>x.length)).size===7,'Ballot lengths include 1 through 7');
truth(sum<1400&&sum>300,'Partial ballot totals are below max 1400, above minimum');
const uniqueBallotPatterns=new Set(dataset.map(x=>x.join(','))).size;
const countDistribution=Object.fromEntries(Array.from({length:7},(_,i)=>[i+1,dataset.filter(x=>x.length===i+1).length]));

class MemoryDb {
 constructor(){
  this.users=Array.from({length:N},(_,i)=>({id:i+1,username:`SYN-${String(i+1).padStart(3,'0')}`,password:PASSWORD,role:'voter',full_name:`Synthetic Voter ${i+1}`,active:true,must_change_password:false,block:'1',lot:String(i+1)}));
  this.users.push({id:900,username:'AUDIT-ADMIN',password:'AuditAdminPass',role:'admin',full_name:'Audit Admin',active:true,must_change_password:false});
  this.sessions=[];this.login_attempts=[];this.audit_log=[];this.election_committee_members=[];
  this.voter_participation=[];this.ballots=[];this.ballot_votes=[];
  this.missingMigration=false;this.failAfterCommitFor=null;
  this.setElection(EID,'open',after);
 }
 setElection(id,status,deadline){
  this.elections=[{id,title:'RANDOMIZED 7-SEAT BOARD MEMBER - TEST ONLY',description:'Synthetic preferences',is_test:true,status,voting_ends_at:deadline,voting_starts_at:null,opened_at:new Date(clockNow-3000).toISOString(),eligible_voters_at_open:N}];
  this.positions=[{id:PID,election_id:id,title:'Board Member',seats:SEATS,sort_order:0}];
  this.candidates=candidateIds.map((id,k)=>({id,position_id:PID,full_name:names[k],statement:'',sort_order:k,photo_path:null}));
  this.voter_participation=[];this.ballots=[];this.ballot_votes=[];this.failAfterCommitFor=null;
 }
 from(table){return new Query(this,table)}
 async rpc(name,args={}){
  const fail=msg=>({data:null,error:{message:msg}});
  // No scheduled Draft elections in the randomized test fixture.
  if(name==='hoa_open_scheduled_elections')return {data:0,error:null};
  if(name==='hoa_verify_login'){
   const u=this.users.find(u=>u.username.toLowerCase()===args.p_username.toLowerCase()&&u.password===args.p_password&&u.active);
   return {data:u?[{...u}]:[],error:null};
  }
  if(name==='hoa_candidate_vote_totals'){
   const count=new Map();for(const v of this.ballot_votes.filter(v=>v.election_id===args.p_election_id))count.set(v.candidate_id,(count.get(v.candidate_id)||0)+1);
   return {data:[...count].map(([candidate_id,votes])=>({candidate_id,votes})),error:null};
  }
  if(name==='hoa_ballot_integrity_summary'){
   if(this.missingMigration)return fail('Could not find the function public.hoa_ballot_integrity_summary in the schema cache (PGRST202)');
   const electionBallots=this.ballots.filter(b=>b.election_id===args.p_election_id);
   let mismatched=0,legacy=0,expected=0,actual=0,invalid=0,cross=0;
   for(const b of electionBallots){
    const rows=this.ballot_votes.filter(v=>v.ballot_id===b.id);
    const actualPositions={};
    for(const v of rows){
      actualPositions[String(v.position_id)]=(actualPositions[String(v.position_id)]||0)+1;
      const pos=this.positions.find(p=>p.id===v.position_id);
      const candidate=this.candidates.find(c=>c.id===v.candidate_id);
      if(v.election_id!==b.election_id||pos?.election_id!==b.election_id||candidate?.position_id!==v.position_id)invalid++;
    }
    actual+=rows.length;
    if(b.expected_position_counts==null)legacy++;
    else{
      expected+=Object.values(b.expected_position_counts).reduce((a,c)=>a+c,0);
      if(JSON.stringify(Object.entries(b.expected_position_counts).sort())!==JSON.stringify(Object.entries(actualPositions).sort()))mismatched++;
    }
   }
   for(const v of this.ballot_votes.filter(v=>v.election_id===args.p_election_id)){
     if(this.ballots.find(b=>b.id===v.ballot_id)?.election_id!==args.p_election_id)cross++;
   }
   return {data:{ballotRows:electionBallots.length,committedBallots:electionBallots.length-legacy,
     legacyBallots:legacy,mismatchedBallots:mismatched,expectedSelections:expected,actualSelections:actual,
     invalidVoteRows:invalid,crossElectionVoteRows:cross},error:null};
  }
  if(name!=='hoa_submit_ballot')throw Error('Unexpected RPC: '+name);
  const user=this.users.find(u=>u.id===args.p_user_id);
  if(!user||!user.active||user.role!=='voter'||user.must_change_password)return fail('Voter account is inactive or initial password change is required.');
  const election=this.elections.find(e=>e.id===args.p_election_id);
  if(!election||election.status!=='open'||Date.parse(election.voting_ends_at)<=Date.now())return fail('Voting deadline has passed.');
  if(this.voter_participation.some(x=>x.user_id===user.id&&x.election_id===election.id))return fail('This voter account has already submitted a ballot.');
  const sels=args.p_selections;
  if(!sels||typeof sels!=='object'||Array.isArray(sels))return fail('Invalid ballot.');
  const changes=[],commitment={};let total=0;
  for(const [key,raw] of Object.entries(sels)){
    if(!/^\d+$/.test(key)||!Array.isArray(raw))return fail('Ballot contains an invalid position.');
    const position=this.positions.find(p=>String(p.id)===key&&p.election_id===election.id);
    if(!position)return fail('Ballot contains an invalid position.');
    if(raw.length>position.seats)return fail('Too many selections for a position.');
    const ids=[];
    for(const cid of raw){if(!/^\d+$/.test(String(cid)))return fail('Ballot contains invalid or duplicate candidate selections.');ids.push(Number(cid))}
    if(new Set(ids).size!==ids.length)return fail('Ballot contains invalid or duplicate candidate selections.');
    for(const cid of ids){
      if(!this.candidates.some(c=>c.id===cid&&c.position_id===position.id))return fail('Ballot contains an invalid candidate selection.');
      changes.push({ballot_id:args.p_ballot_id,election_id:election.id,position_id:position.id,candidate_id:cid});
    }
    if(ids.length)commitment[key]=ids.length;
    total+=ids.length;
  }
  if(total===0)return fail('Select at least one candidate before submitting.');
  if(this.voter_participation.some(p=>p.receipt_code===args.p_receipt_code))return fail('This voter account has already submitted a ballot.');
  this.voter_participation.push({user_id:user.id,election_id:election.id,receipt_code:args.p_receipt_code,voted_at:new Date().toISOString()});
  this.ballots.push({id:args.p_ballot_id,election_id:election.id,expected_position_counts:commitment});
  this.ballot_votes.push(...changes);
  if(this.failAfterCommitFor===user.id){this.failAfterCommitFor=null;return fail('Simulated dropped database response after successful commit.')}
  return {data:args.p_receipt_code,error:null};
 }
}
class Query {
 constructor(db,table){this.db=db;this.table=table;this.filters=[];this.mode='select';this.head=false;this.countMode=false;this.orderings=[];this.limitN=null;this.dataToAdd=null;this.dataToUpdate=null;}
 select(_columns,opts={}){this.head=Boolean(opts.head);this.countMode=opts.count==='exact';return this}
 eq(k,v){this.filters.push(r=>String(r[k])===String(v));return this}
 not(k,operator,v){if(operator==='is'&&v===null){this.filters.push(r=>r[k]!=null);return this}throw Error('Unexpected not operator')}
 neq(k,v){this.filters.push(r=>String(r[k])!==String(v));return this}
 gt(k,v){this.filters.push(r=>String(r[k])>String(v));return this}
 gte(k,v){this.filters.push(r=>String(r[k])>=String(v));return this}
 lt(k,v){this.filters.push(r=>String(r[k])<String(v));return this}
 lte(k,v){this.filters.push(r=>String(r[k])<=String(v));return this}
 in(k,values){this.filters.push(r=>values.map(String).includes(String(r[k])));return this}
 order(k,opts={}){this.orderings.push([k,opts.ascending!==false]);return this}
 limit(n){this.limitN=n;return this}
 delete(){this.mode='delete';return this}
 insert(v){this.mode='insert';this.dataToAdd=v;return this}
 update(v){this.mode='update';this.dataToUpdate=v;return this}
 execute(){
  const table=this.db[this.table];if(!table)throw Error('No simulated table: '+this.table);
  if(this.mode==='insert'){
   let add=Array.isArray(this.dataToAdd)?this.dataToAdd:[this.dataToAdd];
   for(let row of add){
    if(this.table==='sessions'&&table.some(x=>x.user_id===row.user_id&&x.expires_at>new Date().toISOString()&&this.db.users.find(u=>u.id===row.user_id)?.role==='voter'))return {data:null,error:{message:'This voter account is already signed in on another device.'}};
    table.push({...row});
   }
   return {data:null,error:null};
  }
  const matching=table.filter(row=>this.filters.every(fn=>fn(row)));
  if(this.mode==='delete'){
   for(const row of matching){const idx=table.indexOf(row);if(idx>=0)table.splice(idx,1)}
   return {data:null,error:null};
  }
  if(this.mode==='update'){
   for(const row of matching)Object.assign(row,this.dataToUpdate);
   return {data:null,error:null};
  }
  let rows=[...matching];
  if(this.orderings.length){rows.sort((a,b)=>{for(const [k,asc] of this.orderings){const v=a[k]>b[k]?1:a[k]<b[k]?-1:0;if(v)return asc?v:-v;}return 0})}
  const count=rows.length;
  if(this.limitN!==null)rows=rows.slice(0,this.limitN);
  return {data:this.head?null:rows.map(x=>({...x})),error:null,count:this.countMode?count:null};
 }
 maybeSingle(){const r=this.execute();return Promise.resolve({...r,data:Array.isArray(r.data)?r.data[0]||null:r.data})}
 single(){return this.maybeSingle()}
 then(resolve,reject){return Promise.resolve(this.execute()).then(resolve,reject)}
}

const db=new MemoryDb();
const workerSource=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')
  .replace('import { createClient } from "@supabase/supabase-js";','')
  .replace('export default {','globalThis.__worker = {');
const context=vm.createContext({createClient:()=>db,crypto:webcrypto,console:{log(){},error(){}},TextEncoder,TextDecoder,Headers,Response,Request,URL,Date,Uint8Array,Uint32Array,Math,setTimeout});
vm.runInContext(workerSource,context,{timeout:5000});
const worker=context.__worker;
async function call(url,{method='GET',body,auth,csrf=true}={}){
 const headers={};if(body!==undefined)headers['content-type']='application/json';
 if(auth){headers.cookie=auth.cookie;if(csrf)headers['x-csrf-token']=auth.csrf}
 const req=new Request('https://hoa.local'+url,{method,headers,body:body!==undefined?JSON.stringify(body):undefined});
 const r=await worker.fetch(req,auditEnv);
 return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')};
}
async function login(username,password,expected=200){
 const r=await call('/api/auth/login',{method:'POST',body:{username,password}});status(r,expected,'Login '+username);
 if(expected===200)return {cookie:r.cookie.split(';')[0],csrf:r.data.csrfToken,userId:r.data.user.id};
}
const vote=(auth,ids,eid=db.elections[0].id)=>call('/api/voter/vote',{
 method:'POST',auth,body:{electionId:eid,selections:{[PID]:ids}}});
const admin=await login('AUDIT-ADMIN','AuditAdminPass');
const voters=await Promise.all(db.users.filter(u=>u.role==='voter').map(u=>login(u.username,PASSWORD)));
equal(voters.length,N,'200 authenticated synthetic voters');
equal(new Set(voters.map(x=>x.cookie)).size,N,'Unique authenticated sessions');
await login('SYN-001',PASSWORD,409);
const v0=voters[0];
const preview=await call('/api/voter/ballot',{auth:v0});
status(preview,200,'Voter ballot preview');
equal(preview.data.positions.length,1,'Exactly one Board Member position');
equal(preview.data.positions[0].seats,7,'7 seats');
equal(preview.data.positions[0].candidates.length,11,'11 candidates');
const invalids=[
 ['no selections',{[PID]:[]},400],
 ['eight selections',{[PID]:candidateIds.slice(0,8)},400],
 ['same candidate repeated',{[PID]:[601,601]},400],
 ['same candidate repeated within seven',{[PID]:[601,602,603,604,605,606,606]},400],
 ['unknown candidate',{[PID]:[611,999]},400],
 ['wrong position',{999:[601]},400],
 ['empty object',{},400],
 ['negative candidate',{[PID]:[-1]},400],
 ['invalid candidate null',{[PID]:[null]},400],
 ['malformed selection',{[PID]:'wrong'},400],
 ['candidate from other election',{[PID]:[750]},400]
];
for(const [label,selections,expect] of invalids)
 status(await call('/api/voter/vote',{method:'POST',auth:v0,body:{electionId:EID,selections}}),expect,'Invalid: '+label);
status(await call('/api/voter/vote',{method:'POST',body:{electionId:EID,selections:{[PID]:dataset[0]}}}),401,'Anonymous rejected');
status(await call('/api/voter/vote',{method:'POST',auth:v0,csrf:false,body:{electionId:EID,selections:{[PID]:dataset[0]}}}),403,'Missing CSRF rejected');
status(await vote(admin,dataset[0]),403,'Admin cannot vote');
equal(db.ballots.length,0,'No invalid ballot persisted');
const t0=performance.now();
const submissions=await Promise.all(voters.map((auth,i)=>vote(auth,dataset[i])));
const mockedElapsedMs=Number((performance.now()-t0).toFixed(1));
equal(submissions.filter(x=>x.status===200).length,200,'200 votes accepted');
equal(db.voter_participation.length,200,'200 participation records');
equal(db.ballots.length,200,'200 anonymous ballots');
equal(db.ballot_votes.length,sum,'All candidate selections committed');
truth(submissions.every(r=>Boolean(r.data.receiptCode)),'200 voting receipts');
truth(db.ballots.every(b=>b.expected_position_counts[PID]===db.ballot_votes.filter(v=>v.ballot_id===b.id).length),
  'Per-ballot counts committed atomically and independently');
const preliminary=await call('/api/admin/elections/200/results',{auth:admin});status(preliminary,200,'Preliminary results');
equal(preliminary.data.ballotsCast,200,'Turnout count 200');
equal(preliminary.data.anonymousBallots,200,'Anonymous ballot count 200');
equal(preliminary.data.integrityStatus,'verified','Integrity check verifies all 200 ballots');
equal(preliminary.data.voteRecordIntegrityOk,true,'Integrity assessment is true on intact ballots');
equal(preliminary.data.integrityDetails.actualSelections,sum,'Report actual selection count');
equal(preliminary.data.integrityDetails.expectedSelections,sum,'Report committed selection count');
equal(preliminary.data.positions[0].totalVotes,sum,'Position vote sum');
for(const c of preliminary.data.positions[0].candidates){
 equal(c.votes,trueCount.get(c.id),'Independent randomized tally for '+c.full_name);
 equal(c.voterSupportPercentage,Number((100*c.votes/200).toFixed(1)),'Correct candidate voter support percentage');
 equal(c.percentage,Number((100*c.votes/sum).toFixed(1)),'Correct share of selections');
}
const electionRank=preliminary.data.positions[0].candidates.slice(0,7).map(c=>c.full_name);
const sortedCounts=preliminary.data.positions[0].candidates.map(c=>c.votes);
const cutoffTie=sortedCounts.length>7 && sortedCounts[6]===sortedCounts[7];
db.elections[0].status='closed';
const final=await call('/api/admin/elections/200/dhsud-final',{auth:admin});status(final,200,'Final election report');
equal(final.data.positions[0].seats,7,'Final has seven seats');
equal(final.data.voteRecordIntegrityOk,true,'Final report uses comprehensive integrity check');
equal(final.data.integrityStatus,'verified','Final report verified');
equal(final.data.hasUnresolvedSeatTies,cutoffTie,'Reports boundary tie correctly');
equal(final.data.positions[0].rows.filter(x=>x.result==='Within available seats - provisional').length,
 cutoffTie ? final.data.positions[0].rows.filter(x=>x.votes>sortedCounts[6]).length : 7,'Provisional winners correctly ranked');
truth(final.data.reportKind.includes('PRACTICE ONLY'),'Test election clearly identified');
const replay=await Promise.all(voters.map((auth,i)=>vote(auth,dataset[i],200)));
equal(replay.filter(r=>r.status===409).length,200,'200 vote replays rejected');
equal(db.ballot_votes.length,sum,'No duplicate votes persisted');
const receipt=await call('/api/voter/ballot',{auth:v0});
equal(receipt.data.receiptCode,submissions[0].data.receiptCode,'Receipts can be recovered');

// Two concurrent mocked submissions per account: 400 requests -> 200 votes.
db.setElection(201,'open',after);
const double=await Promise.all(voters.flatMap((auth,i)=>[vote(auth,dataset[i],201),vote(auth,dataset[i],201)]));
equal(double.filter(x=>x.status===200).length,200,'200 accepted in duplicate-submit race');
equal(double.filter(x=>x.status===409).length,200,'200 duplicates rejected in race');
equal(db.ballots.length,200,'Only 200 ballots after duplicate race');
equal(db.ballot_votes.length,sum,'No extra selections after duplicate race');
const doubleResult=await call('/api/admin/elections/201/results',{auth:admin});
equal(doubleResult.data.integrityStatus,'verified','Integrity holds under simulated double submit');

// Report detects one deliberately deleted candidate selection while ballot
// and participation counts remain 200. Prior v2.5.3 falsely reported match.
db.setElection(202,'open',after);
await Promise.all(voters.map((auth,i)=>vote(auth,dataset[i],202)));
const originalCount=db.ballot_votes.length;
const targeted=db.ballots.find(b=>b.expected_position_counts[PID]>1);
truth(Boolean(targeted),'One multi-choice ballot available for fault injection');
const removeIndex=db.ballot_votes.findIndex(v=>v.ballot_id===targeted.id);
db.ballot_votes.splice(removeIndex,1);
const corrupted=await call('/api/admin/elections/202/results',{auth:admin});
status(corrupted,200,'Integrity mismatch reported, not hidden');
equal(corrupted.data.ballotsCast,200,'Participation unchanged after corruption');
equal(corrupted.data.anonymousBallots,200,'Ballots unchanged after corruption');
equal(corrupted.data.positions[0].totalVotes,originalCount-1,'One missing candidate selection');
equal(corrupted.data.ballotRecordCountMatches,true,'Legacy count-only flag reproduces false positive');
equal(corrupted.data.voteRecordIntegrityOk,false,'New integrity verification detects missing selection');
equal(corrupted.data.integrityStatus,'mismatch','Report explicitly flags corruption');
equal(corrupted.data.integrityDetails.mismatchedBallots,1,'Exactly one ballot damaged');
db.elections[0].status='closed';
const corruptFinal=await call('/api/admin/elections/202/dhsud-final',{auth:admin});
equal(corruptFinal.data.voteRecordIntegrityOk,false,'DHSUD output must warn on corruption');
equal(corruptFinal.data.integrityStatus,'mismatch','Final mismatch status propagates');

// Old ballots with no count commitments must NEVER be auto-certified.
db.setElection(203,'open',after);
await Promise.all(voters.map((auth,i)=>vote(auth,dataset[i],203)));
db.ballots[0].expected_position_counts=null;
const legacy=await call('/api/admin/elections/203/results',{auth:admin});
equal(legacy.data.integrityStatus,'legacy_unverifiable','One historical ballot prevents verification');
equal(legacy.data.voteRecordIntegrityOk,false,'Unverifiable is NOT a success');
equal(legacy.data.integrityDetails.legacyBallots,1,'Legacy ballot counted');
// Report fails closed if SQL migration has not yet been applied.
db.missingMigration=true;
const missing=await call('/api/admin/elections/203/results',{auth:admin});
equal(missing.data.integrityStatus,'migration_required','Migration missing is visible');
equal(missing.data.voteRecordIntegrityOk,false,'Missing migration never treated as verified');
db.missingMigration=false;

// Deadline enforcement.
db.setElection(204,'open',new Date(clockNow-1000).toISOString());
const late=await Promise.all(voters.slice(0,20).map((auth,i)=>vote(auth,dataset[i],204)));
equal(late.filter(x=>x.status===409).length,20,'20 after-deadline votes blocked');
equal(db.ballots.length,0,'Expired election has no ballot records');

// Dropped response after atomic commit; voter can recover receipt.
db.setElection(205,'open',after);
db.failAfterCommitFor=1;
status(await vote(v0,dataset[0],205),500,'Injected lost confirmation');
equal(db.ballots.length,1,'Ballot committed despite lost confirmation');
equal(db.ballot_votes.length,dataset[0].length,'All original selections committed');
const recovered=await call('/api/voter/ballot',{auth:v0});
equal(recovered.data.voted,true,'Recovered voted status');
truth(recovered.data.receiptCode,'Receipt retrieved after lost confirmation');
status(await vote(v0,dataset[0],205),409,'Retry denied after committed ballot');

// Directly test rank logic for a tie at seats 7 and 8, without claiming
// these 11 fixture values came from the randomized ballot set.
const cutoffVotes=[155,140,130,120,110,95,80,80,60,50,40];
const rankFunction=vm.runInContext('rankElectionPosition',context);
const tie=rankFunction({title:'Board Member',seats:7,totalVotes:cutoffVotes.reduce((a,b)=>a+b,0),
 candidates:cutoffVotes.map((votes,i)=>({id:candidateIds[i],full_name:names[i],votes}))});
equal(tie.cutoffTie,true,'Seventh/eighth cutoff tie detected');
equal(tie.rows.filter(x=>x.result==='TIE - ELECOM decision required').length,2,'Both cutoff candidates marked tie');
equal(tie.rows.filter(x=>x.result==='Within available seats - provisional').length,6,'Six unconditional provisional winners');

// Data integrity and SQL guards present in RELEASE source; no remote SQL executed.
const sql=readFileSync(new URL('../supabase/v2.5.4-install-parts/01_ballot_integrity_commitments.sql',import.meta.url),'utf8');
truth(sql.includes('expected_position_counts')&&sql.includes('position_commitment'),'Database records per-position commitment');
truth(sql.includes('voting_ends_at > clock_timestamp()'),'Database time cutoff retained');
truth(sql.includes('FOR SHARE'),'Database locks retained');
truth(sql.includes('IF total_selected < 1')&&sql.includes('selected_count > allowed_seats'),'SQL ballot count/seat safeguards retained');
truth(sql.includes('REVOKE EXECUTE ON FUNCTION public.hoa_ballot_integrity_summary'),'RPC not exposed to unauthenticated roles');
truth(sql.includes('legacy_ballots')&&sql.includes('mismatched_ballots'),'SQL checks missing historical metadata and selection mismatch');
const report={
 testing:'Real Cloudflare Worker functions + IN-MEMORY Supabase emulation; offline only',
 appVersion:'2.5.4', seed:seedInput, voters:N, candidates:CANDIDATES, seats:SEATS, positions:1,
 candidateNames:names, voteCounts:totals, selections:sum, uniqueBallotPatterns, ballotSizeDistribution:countDistribution,
 rankedCandidates:preliminary.data.positions[0].candidates.map(x=>({name:x.full_name,votes:x.votes,supportPct:x.voterSupportPercentage})),
 provisionalTopSeven:electionRank, cutoffTie, simulatedBatchElapsedMs:mockedElapsedMs,
 outcomes:{validBallots:200,duplicateReplaysBlocked:200,concurrentRequestAttempts:400,concurrentAccepted:200,
  concurrentDuplicatesBlocked:200,invalidBallotScenarios:invalids.length,deadlineAttemptsBlocked:20,
  missingVoteDetected:true,historicalUnverifiable:true,missingMigrationFlagged:true,
  lostReceiptRecovered:true,seventhSeatTieFlagged:true},
 assertions,limitations:[
  'No real PostgreSQL writes/constraints/transactions or Supabase permissions tested',
  'No deployed Worker network, mobile browsers, realistic latency, or rate-limit measurements tested',
  'Human behavior is an approximation from seeded synthetic affinity groups, not real votes',
  'Database migration is provided for staging integration; must be tested on isolated Supabase before production',
  'Election committee certification remains a separate real-world process'
 ]
};
writeFileSync(path.join(outdir,`results_${seedInput}.json`),JSON.stringify(report,null,2)+'\n');
if(seedInput===20261024){
 writeFileSync(path.join(outdir,'randomized_ballots_200.csv'),[
  'synthetic_ballot_id,behavior_group,ballot_style,selections_count,candidate_labels',
  ...dataset.map((ids,i)=>`${i+1},${styles[i].group+1},${styles[i].style},${ids.length},"${ids.map(id=>names[candidateIds.indexOf(id)]).join('; ')}"`)
 ].join('\n')+'\n');
 writeFileSync(path.join(outdir,'randomized_candidate_tally.csv'),[
  'candidate,received_votes,percent_of_200_voters,share_of_all_selections',
  ...candidateIds.map((id,i)=>`${names[i]},${totals[i]},${(100*totals[i]/N).toFixed(1)}%,${(100*totals[i]/sum).toFixed(1)}%`)
 ].join('\n')+'\n');
}
console.log('AUDIT_RANDOM_200_11_CANDIDATE_7_SEAT_PASS',JSON.stringify({seed:seedInput,assertions,sum,totals,winners:electionRank,distribution:countDistribution}));
