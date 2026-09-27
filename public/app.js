const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
let state = { user:null, csrfToken:null, adminTab:'dashboard', elections:[], selectedElectionId:null, reportType:'results' };

const esc = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt = d => d ? new Date(d).toLocaleString() : '—';
const BRAND_NAME = 'Casa Verde de Bañaderos HOA';
const brandLogo = (subtitle='') => `<div class="brand brand-with-logo"><img src="/hoa-logo.png" alt="${BRAND_NAME} logo" class="brand-logo"><div><div class="brand-title">${BRAND_NAME}</div>${subtitle?`<small class="brand-subtitle">${subtitle}</small>`:''}</div></div>`;

function toast(msg, error=false){ toastEl.textContent=msg; toastEl.className='toast show'+(error?' error':''); setTimeout(()=>toastEl.className='toast',2800); }
async function api(path, options={}){
  const headers = new Headers(options.headers||{}); if(options.body && !headers.has('content-type')) headers.set('content-type','application/json');
  if(state.csrfToken && (options.method||'GET').toUpperCase()!=='GET') headers.set('x-csrf-token',state.csrfToken);
  const r=await fetch(path,{...options,headers,credentials:'same-origin'}); let data={}; try{data=await r.json()}catch{}
  if(r.status===401 && !path.includes('/auth/login')){ state.user=null; state.csrfToken=null; location.pathname==='/admin'?renderLogin('admin'):renderLogin('voter'); throw new Error('Session expired'); }
  if(!r.ok) throw new Error(data.error||'Request failed'); return data;
}

async function init(){
  try{ const me=await api('/api/me'); state.user=me.user; state.csrfToken=me.csrfToken; routeHome(); }
  catch{
    const bs=await fetch('/api/bootstrap-status').then(r=>r.json()).catch(()=>({needsSetup:false}));
    if(location.pathname==='/admin'){
      if(bs.needsSetup) return renderSetup();
      return renderLogin('admin');
    }
    // Public entry points always show the voter login. The admin portal is intentionally
    // available only by navigating directly to /admin.
    return renderLogin('voter');
  }
}
window.addEventListener('popstate',()=>init());
function routeHome(){
  const target=state.user?.role==='admin'?'/admin':'/vote';
  if(location.pathname!==target) history.replaceState({},'',target);
  state.user?.role==='admin'?renderAdmin():renderVoter();
}

function renderSetup(){
  app.innerHTML=`<div class="auth-wrap"><section class="auth-card">${brandLogo('Secure election portal')}<h1>First-time admin setup</h1><p class="sub">Create the administrator account using the private SETUP_TOKEN configured in Cloudflare.</p><form id="setupForm"><div class="field"><label>Administrator full name</label><input name="fullName" required maxlength="100"></div><div class="field"><label>Admin username</label><input name="username" required minlength="4" maxlength="40" autocomplete="username"></div><div class="field"><label>Admin password</label><input name="password" type="password" required minlength="10" autocomplete="new-password"></div><div class="field"><label>Cloudflare setup token</label><input name="setupToken" type="password" required></div><button class="btn btn-primary btn-block">Create administrator</button></form></section></div>`;
  document.querySelector('#setupForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/api/setup',{method:'POST',body:JSON.stringify(Object.fromEntries(f))});toast('Administrator created. Please sign in.');renderLogin('admin');}catch(err){toast(err.message,true)}};
}
function renderLogin(expectedRole=null){
  const admin=expectedRole==='admin';
  app.innerHTML=`<div class="auth-wrap"><section class="auth-card">${brandLogo('Secure election portal')}<h1>${admin?'Admin Portal':'Voter Portal'}</h1><p class="sub">${admin?'Sign in with your administrator account to manage elections, voters, and reports.':'Sign in using the credentials issued by your HOA election administrator.'}</p><form id="loginForm"><div class="field"><label>Username</label><input name="username" required autocomplete="username" autocapitalize="none"></div><div class="field"><label>Password</label><input name="password" type="password" required autocomplete="current-password"></div><button class="btn btn-primary btn-block">Sign in securely</button></form><p class="tiny muted" style="margin-top:18px">${admin?'Administrator access only.':'For election security, a voter account can be signed in on only one device at a time. Please log out before moving to another device.'}</p>${admin?'':'<p class="tiny muted">Your ballot choices are stored separately from your voter registration record.</p>'}</section></div>`;
  document.querySelector('#loginForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const d=await api('/api/auth/login',{method:'POST',body:JSON.stringify(Object.fromEntries(f))});if(expectedRole && d.user.role!==expectedRole){ state.user=d.user; state.csrfToken=d.csrfToken; await doLogout(); throw new Error(`This account belongs to the ${d.user.role} portal.`); } state.user=d.user;state.csrfToken=d.csrfToken;routeHome();}catch(err){toast(err.message,true)}};
}
async function doLogout(){try{await api('/api/auth/logout',{method:'POST'});}catch{} state.user=null;state.csrfToken=null;location.pathname==='/admin'?renderLogin('admin'):renderLogin('voter');}

function adminShell(content){
  const tabs=[['dashboard','Dashboard'],['elections','Election Setup'],['voters','Voter Registration'],['reports','Results & Reports']];
  app.innerHTML=`<div class="shell"><header class="topbar">${brandLogo('Administrator dashboard')}<div class="user-chip"><div class="avatar">${esc(state.user.fullName?.[0]||'A')}</div><div class="user-meta"><strong>${esc(state.user.fullName)}</strong><small>Administrator</small></div><button class="btn btn-ghost btn-sm no-print" id="logoutBtn">Logout</button></div></header><div class="admin-layout"><aside class="sidebar no-print">${tabs.map(([id,label])=>`<button class="nav-btn ${state.adminTab===id?'active':''}" data-tab="${id}">${label}</button>`).join('')}</aside><section class="content">${content}</section></div></div>`;
  document.querySelector('#logoutBtn')?.addEventListener('click',doLogout);
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.adminTab=b.dataset.tab;renderAdmin()});
}
async function renderAdmin(){
  if(state.adminTab==='dashboard') return renderDashboard();
  if(state.adminTab==='elections') return renderElections();
  if(state.adminTab==='voters') return renderVoters();
  return renderReports();
}
async function renderDashboard(){
  adminShell(`<div class="page-head"><div><h1>Dashboard</h1><p>Election activity at a glance.</p></div></div><div id="dashLoading" class="card">Loading…</div>`);
  try{const [o,e]=await Promise.all([api('/api/admin/overview'),api('/api/admin/elections')]);state.elections=e.elections;
    document.querySelector('#dashLoading').outerHTML=`<div class="grid grid-4"><div class="card"><div class="stat-label">Registered voters</div><div class="stat-value">${o.voters}</div><div class="stat-foot">Active voter accounts</div></div><div class="card"><div class="stat-label">Elections</div><div class="stat-value">${o.elections}</div><div class="stat-foot">All election records</div></div><div class="card"><div class="stat-label">Open now</div><div class="stat-value">${o.openElections}</div><div class="stat-foot">Currently accepting ballots</div></div><div class="card"><div class="stat-label">Ever participated</div><div class="stat-value">${o.votersEverParticipated}</div><div class="stat-foot">Unique voter accounts</div></div></div><div class="card" style="margin-top:16px"><div class="section-title"><h2>Recent elections</h2><button class="btn btn-secondary btn-sm" id="goElections">Manage elections</button></div>${e.elections.length?e.elections.slice(0,5).map(x=>electionItem(x)).join(''):'<div class="empty">No elections yet.</div>'}</div>`;
    document.querySelector('#goElections')?.addEventListener('click',()=>{state.adminTab='elections';renderAdmin()});
  }catch(err){toast(err.message,true)}
}
function electionItem(x){return `<div class="election-item"><div><h3>${esc(x.title)}</h3><p>${x.position_count} position(s) · ${x.ballots} ballot(s)</p></div><span class="badge badge-${x.status}">${esc(x.status)}</span></div>`}

async function renderElections(){
  adminShell(`<div class="page-head"><div><h1>Election Setup</h1><p>Create positions, configure seats, and add candidates.</p></div><button class="btn btn-primary" id="newElection">+ New election</button></div><div id="electionArea" class="card">Loading…</div>`);
  try{const d=await api('/api/admin/elections');state.elections=d.elections;if(!state.selectedElectionId&&d.elections[0])state.selectedElectionId=d.elections[0].id;drawElectionList();document.querySelector('#newElection').onclick=openNewElection;}catch(err){toast(err.message,true)}
}
function drawElectionList(){
  const el=document.querySelector('#electionArea');
  if(!state.elections.length){el.innerHTML='<div class="empty">Create your first HOA election.</div>';return;}
  el.innerHTML=`<div class="grid grid-2"><div><div class="section-title"><h2>Elections</h2></div>${state.elections.map(x=>`<button class="nav-btn ${Number(state.selectedElectionId)===Number(x.id)?'active':''}" data-election="${x.id}">${esc(x.title)} <span class="badge badge-${x.status}" style="float:right">${x.status}</span></button>`).join('')}</div><div id="electionDetail">Select an election.</div></div>`;
  el.querySelectorAll('[data-election]').forEach(b=>b.onclick=()=>{state.selectedElectionId=Number(b.dataset.election);drawElectionList();loadElectionDetail()});loadElectionDetail();
}
async function loadElectionDetail(){
  if(!state.selectedElectionId)return; const box=document.querySelector('#electionDetail');if(!box)return;box.innerHTML='Loading…';
  try{const d=await api(`/api/admin/elections/${state.selectedElectionId}`);const e=d.election;box.innerHTML=`<div class="section-title"><div><h2>${esc(e.title)}</h2><span class="badge badge-${e.status}">${e.status}</span></div><div class="actions">${e.status==='draft'?'<button class="btn btn-primary btn-sm" id="openVote">Open voting</button>':''}${e.status==='open'?'<button class="btn btn-danger btn-sm" id="closeVote">Close voting</button>':''}<button class="btn btn-danger btn-sm" id="deleteElection">Delete election</button></div></div><p class="muted">${esc(e.description||'No description')}</p>${e.status!=='draft'?'<p class="tiny muted">Ballot configuration is locked because voting has started.</p>':''}<div class="divider"></div><div class="section-title"><h2>Positions</h2>${e.status==='draft'?'<button class="btn btn-secondary btn-sm" id="addPos">+ Position</button>':''}</div>${d.positions.length?d.positions.map(p=>positionCard(p,e.status)).join(''):'<div class="empty">No positions yet.</div>'}`;
    document.querySelector('#addPos')?.addEventListener('click',()=>openAddPosition(e.id));document.querySelector('#openVote')?.addEventListener('click',()=>changeStatus(e.id,'open'));document.querySelector('#closeVote')?.addEventListener('click',()=>changeStatus(e.id,'closed'));document.querySelector('#deleteElection')?.addEventListener('click',()=>openDeleteElection(e));
    document.querySelectorAll('[data-addcand]').forEach(b=>b.onclick=()=>openAddCandidate(Number(b.dataset.addcand)));document.querySelectorAll('[data-delpos]').forEach(b=>b.onclick=()=>removePosition(Number(b.dataset.delpos)));document.querySelectorAll('[data-delcand]').forEach(b=>b.onclick=()=>removeCandidate(Number(b.dataset.delcand)));
  }catch(err){box.innerHTML=`<div class="empty">${esc(err.message)}</div>`}
}
function positionCard(p,status){return `<div class="position-card"><div class="position-head"><div><h3>${esc(p.title)}</h3><div class="tiny muted">${p.seats} seat${p.seats!==1?'s':''} · voter may select up to ${p.seats}</div></div>${status==='draft'?`<div class="actions"><button class="btn btn-secondary btn-sm" data-addcand="${p.id}">+ Candidate</button><button class="btn btn-danger btn-sm" data-delpos="${p.id}">Delete</button></div>`:''}</div>${p.candidates.length?p.candidates.map(c=>`<div class="candidate-row"><div><strong>${esc(c.full_name)}</strong><small>${esc(c.statement||'No statement')}</small></div>${status==='draft'?`<button class="btn btn-ghost btn-sm" data-delcand="${c.id}">Remove</button>`:''}</div>`).join(''):'<div class="empty" style="padding:18px">No candidates yet.</div>'}</div>`}
function openNewElection(){modal(`<h2>Create election</h2><p class="muted">Start in Draft so you can add positions and candidates.</p><form id="newElectionForm"><div class="field"><label>Election title</label><input name="title" required maxlength="120" placeholder="2026 HOA Officers Election"></div><div class="field"><label>Description</label><textarea name="description" rows="3" maxlength="500"></textarea></div><button class="btn btn-primary btn-block">Create election</button></form>`,()=>{document.querySelector('#newElectionForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const d=await api('/api/admin/elections',{method:'POST',body:JSON.stringify(Object.fromEntries(f))});closeModal();state.selectedElectionId=d.id;renderElections();}catch(err){toast(err.message,true)}}});}
function openAddPosition(eid){modal(`<h2>Add position</h2><form id="posForm"><div class="field"><label>Position name</label><input name="title" required placeholder="President"></div><div class="field"><label>Number of seats / winners</label><input name="seats" type="number" min="1" max="50" value="1" required><small class="muted">Example: President = 1; Board Member = 5.</small></div><button class="btn btn-primary btn-block">Add position</button></form>`,()=>{document.querySelector('#posForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api(`/api/admin/elections/${eid}/positions`,{method:'POST',body:JSON.stringify(Object.fromEntries(f))});closeModal();loadElectionDetail();}catch(err){toast(err.message,true)}}});}
function openAddCandidate(pid){modal(`<h2>Add candidate</h2><form id="candForm"><div class="field"><label>Candidate name</label><input name="fullName" required></div><div class="field"><label>Short statement (optional)</label><textarea name="statement" rows="3" maxlength="400"></textarea></div><button class="btn btn-primary btn-block">Add candidate</button></form>`,()=>{document.querySelector('#candForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api(`/api/admin/positions/${pid}/candidates`,{method:'POST',body:JSON.stringify(Object.fromEntries(f))});closeModal();loadElectionDetail();}catch(err){toast(err.message,true)}}});}
async function removePosition(id){if(!confirm('Delete this position and its candidates?'))return;try{await api(`/api/admin/positions/${id}`,{method:'DELETE'});loadElectionDetail()}catch(err){toast(err.message,true)}}
async function removeCandidate(id){if(!confirm('Remove this candidate?'))return;try{await api(`/api/admin/candidates/${id}`,{method:'DELETE'});loadElectionDetail()}catch(err){toast(err.message,true)}}
async function changeStatus(id,status){const q=status==='open'?'Open voting now? Positions and candidates will be locked.':'Close voting? No more ballots will be accepted and this cannot be reopened.';if(!confirm(q))return;try{await api(`/api/admin/elections/${id}/status`,{method:'PUT',body:JSON.stringify({status})});toast(`Election ${status}.`);renderElections()}catch(err){toast(err.message,true)}}
function openDeleteElection(election){
  const title=String(election.title||'');
  const openWarning=election.status==='open'?'<p><strong>This election is currently OPEN.</strong> Deleting it will stop voting immediately and permanently erase ballots already submitted for this election.</p>':'';
  modal(`<h2>Delete election permanently?</h2><div class="danger-note"><strong>This cannot be undone.</strong>${openWarning}<p>Deleting this election removes its positions, candidates, participation records, ballots, vote totals, and test results. Registered voter accounts will remain.</p></div><p class="muted">To confirm, type the exact election title:</p><div class="confirm-title">${esc(title)}</div><div class="field"><label>Election title</label><input id="deleteElectionTitle" autocomplete="off" spellcheck="false"></div><button class="btn btn-danger btn-block" id="confirmDeleteElection" disabled>Delete election permanently</button>`,()=>{
    const input=document.querySelector('#deleteElectionTitle');
    const button=document.querySelector('#confirmDeleteElection');
    input.oninput=()=>{button.disabled=input.value!==title};
    button.onclick=async()=>{
      if(input.value!==title)return;
      button.disabled=true;button.textContent='Deleting…';
      try{
        await api(`/api/admin/elections/${election.id}`,{method:'DELETE',body:JSON.stringify({confirmTitle:title})});
        closeModal();state.selectedElectionId=null;toast('Election and its test data were permanently deleted.');renderElections();
      }catch(err){button.disabled=false;button.textContent='Delete election permanently';toast(err.message,true)}
    };
    input.focus();
  });
}

async function renderVoters(){
  adminShell(`<div class="page-head"><div><h1>Voter Registration</h1><p>Create voter accounts and track Block/Lot participation.</p></div><button class="btn btn-primary" id="addVoter">+ Register voter</button></div><div class="card"><div class="row" style="margin-bottom:12px"><input id="voterSearch" placeholder="Search name, username, block or lot" style="flex:1;min-width:220px;padding:11px;border:1px solid var(--line);border-radius:12px"><select id="voterElection" style="padding:11px;border:1px solid var(--line);border-radius:12px"><option value="">No election status</option></select></div><div id="voterTable">Loading…</div></div>`);
  const addButton=document.querySelector('#addVoter');
  if(addButton)addButton.onclick=openAddVoter;
  try{
    const e=await api('/api/admin/elections');
    state.elections=e.elections;
    const electionSelect=document.querySelector('#voterElection');
    const searchInput=document.querySelector('#voterSearch');
    // The admin may have navigated to a different section while the request was running.
    if(!electionSelect||!searchInput)return;
    electionSelect.innerHTML='<option value="">No election status</option>'+e.elections.map(x=>`<option value="${x.id}">${esc(x.title)}</option>`).join('');
    let timer;
    searchInput.oninput=()=>{clearTimeout(timer);timer=setTimeout(loadVoters,200)};
    electionSelect.onchange=loadVoters;
    await loadVoters();
  }catch(err){toast(err.message,true)}
}
async function loadVoters(){
  const searchInput=document.querySelector('#voterSearch');
  const electionSelect=document.querySelector('#voterElection');
  const box=document.querySelector('#voterTable');
  if(!box)return;
  const q=encodeURIComponent(searchInput?.value||'');
  const eid=electionSelect?.value||'';
  try{
    const d=await api(`/api/admin/voters?search=${q}${eid?`&electionId=${eid}`:''}`);
    // Ignore a stale response if the user left Voter Registration while it was loading.
    const currentBox=document.querySelector('#voterTable');
    if(!currentBox)return;
    currentBox.innerHTML=d.voters.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Block</th><th>Lot</th><th>Username</th>${eid?'<th>Voting</th>':''}<th>Account</th><th>Actions</th></tr></thead><tbody>${d.voters.map(v=>`<tr><td><strong>${esc(v.full_name)}</strong></td><td>${esc(v.block||'—')}</td><td>${esc(v.lot||'—')}</td><td><code>${esc(v.username)}</code></td>${eid?`<td><span class="badge ${v.voted?'badge-voted':'badge-not'}">${v.voted?'Voted':'Not Voted'}</span></td>`:''}<td><span class="badge ${v.active?'badge-open':'badge-off'}">${v.active?'Active':'Disabled'}</span></td><td><div class="actions"><button class="btn btn-ghost btn-sm" data-reset="${v.id}">Reset password</button><button class="btn ${v.active?'btn-danger':'btn-secondary'} btn-sm" data-toggle="${v.id}" data-active="${v.active?0:1}">${v.active?'Disable':'Enable'}</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No voters found.</div>';
    currentBox.querySelectorAll('[data-reset]').forEach(b=>b.onclick=()=>resetPass(Number(b.dataset.reset)));
    currentBox.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>toggleVoter(Number(b.dataset.toggle),Number(b.dataset.active)));
  }catch(err){toast(err.message,true)}
}
function openAddVoter(){
  modal(`<h2>Register voter</h2><p class="muted">The system will generate a random username and 8-character password.</p><form id="voterForm"><div class="field"><label>Full name</label><input name="fullName" required maxlength="100"></div><div class="form-grid"><div class="field"><label>Block</label><input name="block" required maxlength="40"></div><div class="field"><label>Lot</label><input name="lot" required maxlength="40"></div></div><button class="btn btn-primary btn-block" style="margin-top:14px">Generate voter account</button></form>`,()=>{
    const form=document.querySelector('#voterForm');
    if(!form)return;
    form.onsubmit=async e=>{
      e.preventDefault();
      const submit=form.querySelector('button[type="submit"],button:not([type])');
      const originalText=submit?.textContent||'Generate voter account';
      if(submit){submit.disabled=true;submit.textContent='Creating account…'}
      const f=new FormData(e.currentTarget);
      try{
        const d=await api('/api/admin/voters',{method:'POST',body:JSON.stringify(Object.fromEntries(f))});
        showCredentials(d.voter);
        loadVoters();
      }catch(err){
        if(submit){submit.disabled=false;submit.textContent=originalText}
        toast(err.message,true)
      }
    };
  });
}
function credentialView(v){return `<h2>Voter account created</h2><p class="muted">Copy or print these credentials now. The password cannot be viewed again.</p><div class="credential" id="credentialCard"><strong>${esc(v.fullName)}</strong><div class="tiny muted">${v.block||v.lot?`Block ${esc(v.block||'—')} · Lot ${esc(v.lot||'—')}`:'Password reset'}</div><div class="credential-grid" style="margin-top:14px"><div><small>Username</small><div class="code">${esc(v.username)}</div></div><div><small>Password</small><div class="code">${esc(v.password)}</div></div></div></div><div class="actions" style="margin-top:14px"><button class="btn btn-primary" id="copyCred">Copy credentials</button><button class="btn btn-secondary" id="printCred">Print</button><button class="btn btn-ghost" id="doneCred">Done</button></div>`}
function showCredentials(v){
  // Open a fresh credential modal rather than assuming the registration modal still exists.
  closeModal();
  modal(credentialView(v),()=>{
    const copy=document.querySelector('#copyCred');
    const print=document.querySelector('#printCred');
    const done=document.querySelector('#doneCred');
    if(copy)copy.onclick=()=>navigator.clipboard.writeText(`HOA Voting Credentials\nName: ${v.fullName}\nBlock: ${v.block||''}\nLot: ${v.lot||''}\nUsername: ${v.username}\nPassword: ${v.password}`).then(()=>toast('Credentials copied.')).catch(()=>toast('Copy failed. Please copy the credentials manually.',true));
    if(print)print.onclick=()=>printCredential(v);
    if(done)done.onclick=closeModal;
  });
}
async function resetPass(id){if(!confirm('Generate a new 8-character password? The old password will stop working.'))return;try{const d=await api(`/api/admin/voters/${id}/reset-password`,{method:'POST'});showCredentials({fullName:d.fullName,block:'',lot:'',username:d.username,password:d.password});}catch(err){toast(err.message,true)}}
async function toggleVoter(id,active){try{await api(`/api/admin/voters/${id}/active`,{method:'PUT',body:JSON.stringify({active:!!active})});loadVoters()}catch(err){toast(err.message,true)}}
function printCredential(v){const w=window.open('','_blank','width=700,height=600');w.document.write(`<!doctype html><title>Voter Credentials</title><style>@page{size:A4;margin:20mm}body{font-family:Arial;padding:20px}.card{border:2px dashed #777;padding:28px;border-radius:18px;max-width:520px}.code{font:700 24px monospace;margin:6px 0 16px}small{color:#666}</style><div class="card"><h2>HOA Voting Credentials</h2><p><strong>${esc(v.fullName)}</strong></p>${v.block||v.lot?`<p>Block ${esc(v.block)} · Lot ${esc(v.lot)}</p>`:''}<small>Username</small><div class="code">${esc(v.username)}</div><small>Password</small><div class="code">${esc(v.password)}</div><p><small>Keep these credentials private. This password will not be displayed again.</small></p></div><script>window.onload=()=>window.print()<\/script>`);w.document.close();}

async function renderReports(){
  adminShell(`<div class="page-head"><div><h1>Results & Reports</h1><p>Live/final totals and Block/Lot participation reporting.</p></div><div class="actions"><button class="btn btn-secondary" id="exportCsv">Export CSV</button><button class="btn btn-primary" id="printA4">Print / Save PDF (A4)</button></div></div><div class="card no-print" style="margin-bottom:14px"><div class="row"><select id="reportElection" style="padding:11px;border:1px solid var(--line);border-radius:12px;min-width:240px"></select><button class="btn btn-ghost ${state.reportType==='results'?'active':''}" data-report="results">Election Results</button><button class="btn btn-ghost ${state.reportType==='participation'?'active':''}" data-report="participation">Voter Participation</button></div></div><div id="reportArea" class="card">Loading…</div>`);
  try{const e=await api('/api/admin/elections');state.elections=e.elections;if(!state.selectedElectionId&&e.elections[0])state.selectedElectionId=e.elections[0].id;const sel=document.querySelector('#reportElection');sel.innerHTML=e.elections.map(x=>`<option value="${x.id}" ${Number(x.id)===Number(state.selectedElectionId)?'selected':''}>${esc(x.title)}</option>`).join('')||'<option>No elections</option>';sel.onchange=()=>{state.selectedElectionId=Number(sel.value);loadReport()};document.querySelectorAll('[data-report]').forEach(b=>b.onclick=()=>{state.reportType=b.dataset.report;renderReports()});document.querySelector('#printA4').onclick=()=>window.print();document.querySelector('#exportCsv').onclick=exportCurrentCsv;loadReport();}catch(err){toast(err.message,true)}
}
async function loadReport(){if(!state.selectedElectionId){document.querySelector('#reportArea').innerHTML='<div class="empty">No election selected.</div>';return}try{if(state.reportType==='results')drawResults(await api(`/api/admin/elections/${state.selectedElectionId}/results`));else drawParticipation(await api(`/api/admin/elections/${state.selectedElectionId}/participation`));}catch(err){toast(err.message,true)}}
function reportHead(title,status){return `<div class="report-header"><h1>${esc(title)}</h1><p>HOA Election Report · Status: ${esc(status)} · Generated ${esc(new Date().toLocaleString())}</p></div>`}
function drawResults(d){const box=document.querySelector('#reportArea');box.dataset.csv=JSON.stringify({type:'results',data:d});box.innerHTML=`${reportHead(d.election.title,d.election.status)}<div class="section-title"><div><h2>${esc(d.election.title)}</h2><span class="badge badge-${d.election.status}">${d.election.status}</span></div></div><div class="grid grid-4" style="margin-bottom:22px"><div><div class="stat-label">Eligible voters</div><div class="stat-value">${d.eligibleVoters}</div></div><div><div class="stat-label">Ballots cast</div><div class="stat-value">${d.ballotsCast}</div></div><div><div class="stat-label">Turnout</div><div class="stat-value">${d.turnoutPercentage}%</div></div><div><div class="stat-label">Positions</div><div class="stat-value">${d.positions.length}</div></div></div>${d.positions.map(p=>`<section class="result-position"><div class="section-title"><div><h2>${esc(p.title)}</h2><div class="tiny muted">${p.seats} seat${p.seats!==1?'s':''} · ${p.totalVotes} selection${p.totalVotes!==1?'s':''}</div></div></div>${p.candidates.length?p.candidates.map((c,i)=>`<div class="result-row"><div><strong>${esc(c.full_name)}</strong></div><div class="bar"><i style="width:${Math.min(100,c.percentage)}%"></i></div><div class="result-count">${c.votes}</div><div class="result-pct">${c.percentage}%</div></div>`).join(''):'<div class="empty">No candidates.</div>'}</section>`).join('')}`;}
function drawParticipation(d){const box=document.querySelector('#reportArea');box.dataset.csv=JSON.stringify({type:'participation',data:d});box.innerHTML=`${reportHead(d.election.title,d.election.status)}<div class="section-title"><div><h2>Voter Participation</h2><div class="tiny muted">${esc(d.election.title)}</div></div></div><div class="grid grid-4" style="margin-bottom:18px"><div><div class="stat-label">Registered</div><div class="stat-value">${d.voters.length}</div></div><div><div class="stat-label">Voted</div><div class="stat-value">${d.votedCount}</div></div><div><div class="stat-label">Not voted</div><div class="stat-value">${d.notVotedCount}</div></div><div><div class="stat-label">Status</div><div style="margin-top:10px"><span class="badge badge-${d.election.status}">${d.election.status}</span></div></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Block</th><th>Lot</th><th>Username</th><th>Status</th><th>Voted at</th></tr></thead><tbody>${d.voters.map(v=>`<tr><td>${esc(v.full_name)}</td><td>${esc(v.block||'—')}</td><td>${esc(v.lot||'—')}</td><td>${esc(v.username)}</td><td><span class="badge ${v.voted?'badge-voted':'badge-not'}">${v.voted?'Voted':'Not Voted'}</span></td><td>${v.voted?esc(fmt(v.voted_at)):'—'}</td></tr>`).join('')}</tbody></table></div><p class="tiny muted" style="margin-top:12px">Participation records show whether a resident voted. They do not reveal the resident’s ballot choices.</p>`;}
function exportCurrentCsv(){const box=document.querySelector('#reportArea');if(!box?.dataset.csv)return;const x=JSON.parse(box.dataset.csv);let rows=[];if(x.type==='results'){rows.push(['Election',x.data.election.title],['Status',x.data.election.status],['Eligible Voters',x.data.eligibleVoters],['Ballots Cast',x.data.ballotsCast],['Turnout',`${x.data.turnoutPercentage}%`],[]);for(const p of x.data.positions){rows.push([p.title,`Seats: ${p.seats}`],['Candidate','Votes','Percentage']);for(const c of p.candidates)rows.push([c.full_name,c.votes,`${c.percentage}%`]);rows.push([])}}else{rows.push(['Election',x.data.election.title],['Name','Block','Lot','Username','Status','Voted At']);for(const v of x.data.voters)rows.push([v.full_name,v.block,v.lot,v.username,v.voted?'Voted':'Not Voted',v.voted_at||''])}downloadCsv(rows,`${slug(x.data.election.title)}-${x.type}.csv`)}
function downloadCsv(rows,name){const csv=rows.map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\r\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}function slug(s){return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'hoa-election'}

async function renderVoter(){
  app.innerHTML=`<div class="ballot-shell"><header class="topbar">${brandLogo('Secure election portal')}<div class="user-chip"><div class="avatar">${esc(state.user.fullName?.[0]||'V')}</div><div class="user-meta"><strong>${esc(state.user.fullName)}</strong><small>Block ${esc(state.user.block||'—')} · Lot ${esc(state.user.lot||'—')}</small></div><button class="btn btn-ghost btn-sm" id="logoutBtn">Logout</button></div></header><div id="ballotArea"><div class="card">Loading election…</div></div></div>`;document.querySelector('#logoutBtn').onclick=doLogout;
  try{const d=await api('/api/voter/ballot');drawBallot(d)}catch(err){toast(err.message,true)}
}
function drawBallot(d){const box=document.querySelector('#ballotArea');if(!d.election){box.innerHTML=`<div class="card empty"><h2>No open election</h2><p>${esc(d.message||'Please check back later.')}</p></div>`;return}if(d.voted){box.innerHTML=`<div class="thankyou-card"><div class="thankyou-icon">✓</div><div class="thankyou-kicker">Ballot successfully recorded</div><h1>Thank you for Voting!</h1><blockquote>“Your voice matters. Thank you for helping shape the future of our community.”</blockquote><p class="thankyou-election">Your ballot for <strong>${esc(d.election.title)}</strong> has already been submitted and cannot be submitted again.</p><div class="thankyou-meta"><span>Submitted: ${esc(fmt(d.votedAt))}</span></div><div class="credential receipt-card"><small>Ballot receipt</small><div class="code">${esc(d.receiptCode)}</div><p class="tiny muted">Keep this receipt for your records. It confirms submission without revealing your selections.</p></div></div>`;return}
  box.innerHTML=`<div class="hero"><h1>${esc(d.election.title)}</h1><p>${esc(d.election.description||'Select your preferred candidates for each position.')}</p></div><form id="ballotForm">${d.positions.map(p=>`<section class="ballot-position" data-position="${p.id}" data-seats="${p.seats}"><h2>${esc(p.title)}</h2><p class="instruction">Select up to ${p.seats} candidate${p.seats!==1?'s':''}.</p>${p.candidates.map(c=>`<label class="candidate-option"><input type="checkbox" name="p-${p.id}" value="${c.id}"><span><strong>${esc(c.full_name)}</strong>${c.statement?`<p>${esc(c.statement)}</p>`:''}</span></label>`).join('')}</section>`).join('')}<div class="ballot-footer"><div><strong id="selectionCount">0 selections</strong><div class="tiny muted">Review carefully before submitting.</div></div><button class="btn btn-primary" type="submit">Review & Submit</button></div></form>`;
  document.querySelectorAll('.candidate-option input').forEach(cb=>cb.onchange=e=>{const section=e.target.closest('.ballot-position');const max=Number(section.dataset.seats);const checked=[...section.querySelectorAll('input:checked')];if(checked.length>max){e.target.checked=false;toast(`You may select up to ${max} candidate${max!==1?'s':''} for this position.`,true)}document.querySelectorAll('.candidate-option').forEach(l=>l.classList.toggle('selected',l.querySelector('input').checked));const total=document.querySelectorAll('.candidate-option input:checked').length;document.querySelector('#selectionCount').textContent=`${total} selection${total!==1?'s':''}`});
  document.querySelector('#ballotForm').onsubmit=e=>{e.preventDefault();const selections={};d.positions.forEach(p=>selections[p.id]=[...document.querySelectorAll(`input[name="p-${p.id}"]:checked`)].map(x=>Number(x.value)));if(!Object.values(selections).some(a=>a.length)){toast('Select at least one candidate.',true);return}openBallotReview(d,selections)};
}
function openBallotReview(d,selections){const lines=d.positions.map(p=>{const names=p.candidates.filter(c=>selections[p.id].includes(Number(c.id))).map(c=>c.full_name);return `<div style="padding:10px 0;border-bottom:1px solid var(--line)"><strong>${esc(p.title)}</strong><div class="muted">${names.length?names.map(esc).join(', '):'No selection'}</div></div>`}).join('');modal(`<h2>Review your ballot</h2><p class="muted">Once submitted, your vote cannot be changed.</p>${lines}<label style="display:flex;gap:10px;align-items:flex-start;margin:16px 0"><input id="confirmVote" type="checkbox" style="margin-top:4px"><span>I confirm these are my selections and I am ready to submit my ballot.</span></label><button class="btn btn-primary btn-block" id="finalSubmit" disabled>Submit final ballot</button>`,()=>{document.querySelector('#confirmVote').onchange=e=>document.querySelector('#finalSubmit').disabled=!e.target.checked;document.querySelector('#finalSubmit').onclick=async()=>{const b=document.querySelector('#finalSubmit');b.disabled=true;b.textContent='Submitting…';try{const r=await api('/api/voter/vote',{method:'POST',body:JSON.stringify({electionId:d.election.id,selections})});closeModal();toast('Your vote has been recorded.');drawBallot({...d,voted:true,votedAt:new Date().toISOString(),receiptCode:r.receiptCode});}catch(err){if(/already submitted|already.*ballot/i.test(err.message)){closeModal();try{const latest=await api('/api/voter/ballot');drawBallot(latest);}catch{}toast('Your ballot was already submitted.');return}b.disabled=false;b.textContent='Submit final ballot';toast(err.message,true)}}});}

function modal(html,onOpen){document.body.insertAdjacentHTML('beforeend',`<div class="modal-backdrop" id="modalBackdrop"><div class="modal"><button class="btn btn-ghost btn-sm close" id="modalClose">✕</button><div id="modalContent">${html}</div></div></div>`);document.querySelector('#modalClose').onclick=closeModal;document.querySelector('#modalBackdrop').onclick=e=>{if(e.target.id==='modalBackdrop')closeModal()};onOpen?.()}
function closeModal(){document.querySelector('#modalBackdrop')?.remove()}

init();
