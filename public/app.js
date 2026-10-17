const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
let state = { user:null, csrfToken:null, adminTab:'dashboard', elections:[], selectedElectionId:null, reportType:'results', bulkPreview:[], bulkCredentials:[], bulkAcknowledged:false, bulkBusy:false };

const esc = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt = d => d ? new Date(d).toLocaleString() : '—';
const BRAND_NAME = 'Casa Verde de Bañaderos HOA';
const brandLogo = (subtitle='') => `<div class="brand brand-with-logo"><img src="/hoa-logo.png" alt="${BRAND_NAME} logo" class="brand-logo"><div><div class="brand-title">${BRAND_NAME}</div>${subtitle?`<small class="brand-subtitle">${subtitle}</small>`:''}</div></div>`;
const initials = name => String(name||'?').trim().split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()||'').join('')||'?';
const candidatePhoto = (c,size='') => `<span class="candidate-photo ${size}"><span class="candidate-initials">${esc(initials(c.full_name))}</span>${c.has_photo?`<img data-candidate-photo src="/api/candidates/${Number(c.id)}/photo" alt="Photo of ${esc(c.full_name)}" loading="lazy">`:''}</span>`;
document.addEventListener('error',e=>{if(e.target?.matches?.('img[data-candidate-photo]'))e.target.classList.add('photo-error')},true);

const passwordEyeIcon = visible => visible
  ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.2A10.7 10.7 0 0 1 12 4c5.2 0 9 4.4 10 6.1.3.5.3 1.2 0 1.8a18.8 18.8 0 0 1-3 3.7M6.2 6.3A18 18 0 0 0 2 10.1c-.3.5-.3 1.2 0 1.8C3 13.6 6.8 18 12 18c1.2 0 2.3-.2 3.3-.6"/></svg>`
  : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>`;
function enhancePasswordToggles(root=document){
  root.querySelectorAll('input[type="password"]:not([data-password-toggle])').forEach(input=>{
    input.dataset.passwordToggle='1';
    const wrap=document.createElement('div');wrap.className='password-control';
    input.parentNode.insertBefore(wrap,input);wrap.appendChild(input);
    const btn=document.createElement('button');btn.type='button';btn.className='password-toggle';btn.setAttribute('aria-label','Show password');btn.setAttribute('aria-pressed','false');btn.title='Show password';btn.innerHTML=passwordEyeIcon(false);
    btn.onclick=()=>{const showing=input.type==='text';input.type=showing?'password':'text';btn.setAttribute('aria-pressed',String(!showing));btn.setAttribute('aria-label',showing?'Show password':'Hide password');btn.title=showing?'Show password':'Hide password';btn.innerHTML=passwordEyeIcon(!showing);input.focus({preventScroll:true});};
    wrap.appendChild(btn);
  });
}

function toast(msg, error=false){ toastEl.textContent=msg; toastEl.className='toast show'+(error?' error':''); setTimeout(()=>toastEl.className='toast',2800); }
async function api(path, options={}){
  const headers = new Headers(options.headers||{}); const isForm=typeof FormData!=='undefined' && options.body instanceof FormData; if(options.body && !isForm && !headers.has('content-type')) headers.set('content-type','application/json');
  if(state.csrfToken && (options.method||'GET').toUpperCase()!=='GET') headers.set('x-csrf-token',state.csrfToken);
  const r=await fetch(path,{...options,headers,credentials:'same-origin'}); let data={}; try{data=await r.json()}catch{}
  if(r.status===401 && !path.includes('/auth/login')){ state.user=null; state.csrfToken=null; location.pathname==='/admin'?renderLogin('admin'):renderLogin('voter'); throw new Error('Session expired'); }
  if(!r.ok) throw new Error(data.error||'Request failed'); return data;
}

async function init(){
  // During first-time setup, check bootstrap status before /api/me. A 401 from
  // /api/me is normal before login, but should not interrupt the setup flow.
  if(location.pathname==='/admin'){
    try{
      const response=await fetch('/api/bootstrap-status',{credentials:'same-origin',cache:'no-store'});
      if(response.ok){
        const bootstrap=await response.json();
        if(bootstrap.needsSetup) return renderSetup();
      }
    }catch{}
  }
  try{ const me=await api('/api/me'); state.user=me.user; state.csrfToken=me.csrfToken; routeHome(); }
  catch{ return renderLogin(location.pathname==='/admin'?'admin':'voter'); }
}
window.addEventListener('popstate',()=>init());
window.addEventListener('beforeunload',e=>{if(state.bulkBusy||state.bulkCredentials?.length){e.preventDefault();e.returnValue='';}});
function routeHome(){
  const target=state.user?.role==='admin'?'/admin':'/vote';
  if(location.pathname!==target) history.replaceState({},'',target);
  state.user?.role==='admin'?renderAdmin():renderVoter();
}

// The setup token is collected on a separate page so password managers are
// much less likely to autofill the administrator password into that field.
function renderSetup(prefill={}){
  app.innerHTML=`<div class="auth-wrap"><section class="auth-card">${brandLogo('Secure election portal')}<h1>First-time admin setup</h1><p class="sub">Step 1 of 2: create your administrator login. The separate Cloudflare setup token is requested on the next screen.</p><form id="setupDetailsForm" autocomplete="off"><div class="field"><label for="adminFullName">Administrator full name</label><input id="adminFullName" name="fullName" required maxlength="100" autocomplete="name"></div><div class="field"><label for="adminUsername">Admin username</label><input id="adminUsername" name="username" required minlength="4" maxlength="40" autocomplete="username" autocapitalize="none"></div><div class="field"><label for="adminPassword">Admin password</label><input id="adminPassword" name="password" type="password" required minlength="10" autocomplete="new-password"></div><button class="btn btn-primary btn-block" type="submit">Continue to setup token</button></form></section></div>`;
  enhancePasswordToggles(app);
  const form=document.querySelector('#setupDetailsForm');
  for(const name of ['fullName','username','password']){
    const field=form.elements.namedItem(name);
    if(field && prefill[name]) field.value=String(prefill[name]);
  }
  form.onsubmit=e=>{
    e.preventDefault();
    if(!form.reportValidity())return;
    const f=new FormData(form);
    renderSetupTokenStep({
      fullName:String(f.get('fullName')||'').trim(),
      username:String(f.get('username')||'').trim(),
      password:String(f.get('password')||'')
    });
  };
}
function renderSetupTokenStep(details){
  app.innerHTML=`<div class="auth-wrap"><section class="auth-card">${brandLogo('Secure election portal')}<h1>Verify administrator setup</h1><p class="sub">Step 2 of 2: paste your <strong>Cloudflare SETUP_TOKEN</strong>. This is NOT the administrator password.</p><p class="tiny muted" style="margin:0 0 18px">Administrator username: <strong>${esc(details.username)}</strong></p><form id="setupTokenForm" autocomplete="off"><div class="field"><label for="setupTokenEntry">Cloudflare setup token</label><input id="setupTokenEntry" name="setupToken" type="password" required maxlength="256" autocomplete="one-time-code" autocapitalize="none" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" aria-describedby="setupTokenStatus"><small id="setupTokenStatus" class="tiny muted" aria-live="polite">0 characters entered. The PowerShell token generated earlier has 64 characters.</small></div><button type="button" class="btn btn-secondary btn-block" id="pasteSetupToken" style="margin-bottom:10px">Paste setup token from clipboard</button><button class="btn btn-primary btn-block" id="finishSetup" type="submit">Create administrator</button><button class="btn btn-ghost btn-block" style="margin-top:10px" id="setupBack" type="button">Back to admin details</button></form><p id="setupTokenError" class="tiny muted" aria-live="polite" style="margin-top:14px"></p></section></div>`;
  enhancePasswordToggles(app);
  const form=document.querySelector('#setupTokenForm');
  const input=document.querySelector('#setupTokenEntry');
  const status=document.querySelector('#setupTokenStatus');
  const errorBox=document.querySelector('#setupTokenError');
  const submit=document.querySelector('#finishSetup');
  const update=()=>{
    const token=input.value.trim();
    const isPassword=!!token && token===details.password;
    const count=token.length;
    if(isPassword){
      status.textContent=`${count} characters. This matches your administrator password. Use the separate Cloudflare token.`;
      status.style.color='#b42318';
    }else if(count===64){
      status.textContent='64 characters entered. Length verified; Cloudflare will verify the value.';
      status.style.color='#067647';
    }else{
      status.textContent=`${count} characters entered. If you generated the PowerShell token, enter all 64 characters.`;
      status.style.color='';
    }
    errorBox.textContent='';
  };
  input.value='';
  input.addEventListener('input',update);
  input.addEventListener('change',update);
  document.querySelector('#pasteSetupToken').onclick=async()=>{
    try{
      if(!navigator.clipboard?.readText) throw new Error('clipboard unavailable');
      const pasted=(await navigator.clipboard.readText()).trim();
      if(!pasted){toast('Your clipboard is empty. Copy the token from PowerShell first.',true);return;}
      input.value=pasted;
      update();
      input.focus({preventScroll:true});
    }catch{
      toast('Clipboard access was blocked. Click the token field and press Ctrl+V instead.',true);
      input.focus({preventScroll:true});
    }
  };
  document.querySelector('#setupBack').onclick=()=>renderSetup(details);
  form.onsubmit=async e=>{
    e.preventDefault();
    const setupToken=input.value.trim();
    if(!setupToken){toast('Enter your Cloudflare setup token.',true);return;}
    if(setupToken===details.password){
      update();
      toast('The setup token must not be your administrator password.',true);
      return;
    }
    submit.disabled=true;
    submit.textContent='Verifying token…';
    try{
      await api('/api/setup',{method:'POST',body:JSON.stringify({...details,setupToken})});
      toast('Administrator created. Please sign in.');
      renderLogin('admin');
    }catch(err){
      if(err.message==='Invalid setup token.'){
        errorBox.textContent='Cloudflare rejected the token. Check that the Production SETUP_TOKEN on the active hoa-voting Worker matches what you entered. No SQL changes are needed.';
      }else{
        errorBox.textContent=err.message;
      }
      toast(err.message,true);
      submit.disabled=false;
      submit.textContent='Create administrator';
    }
  };
}
function renderLogin(expectedRole=null){
  const admin=expectedRole==='admin';
  app.innerHTML=`<div class="auth-wrap"><section class="auth-card">${brandLogo('Secure election portal')}<h1>${admin?'Admin Portal':'Voter Portal'}</h1><p class="sub">${admin?'Sign in with your administrator account to manage elections, voters, and reports.':'Sign in using the credentials issued by your HOA election administrator.'}</p><form id="loginForm"><div class="field"><label>Username</label><input name="username" required autocomplete="username" autocapitalize="none"></div><div class="field"><label>Password</label><input name="password" type="password" required autocomplete="current-password"></div><button class="btn btn-primary btn-block">Sign in securely</button></form><p class="tiny muted" style="margin-top:18px">${admin?'Administrator access only.':'For election security, a voter account can be signed in on only one device at a time. Please log out before moving to another device.'}</p>${admin?'':'<p class="tiny muted">Your ballot choices are stored separately from your voter registration record.</p>'}</section></div>`;
  enhancePasswordToggles(app);
  document.querySelector('#loginForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const d=await api('/api/auth/login',{method:'POST',body:JSON.stringify(Object.fromEntries(f))});if(expectedRole && d.user.role!==expectedRole){ state.user=d.user; state.csrfToken=d.csrfToken; await doLogout(); throw new Error(`This account belongs to the ${d.user.role} portal.`); } state.user=d.user;state.csrfToken=d.csrfToken;routeHome();}catch(err){toast(err.message,true)}};
}
async function doLogout(){if(state.bulkBusy){toast('Wait for voter import to finish before logging out.',true);return}if(state.bulkCredentials.length&&!confirm('Your new voter passwords have not been cleared. Print the A4 vouchers before logging out. Log out and permanently clear them?'))return;try{await api('/api/auth/logout',{method:'POST'});}catch{} clearBulkSecrets();state.user=null;state.csrfToken=null;location.pathname==='/admin'?renderLogin('admin'):renderLogin('voter');}

function adminShell(content){
  if(state.adminTab!=='voters') clearBulkSecrets();
  const tabs=[['dashboard','Dashboard'],['elections','Election Setup'],['voters','Voter Registration'],['reports','Results & Reports']];
  app.innerHTML=`<div class="shell"><header class="topbar">${brandLogo('Administrator dashboard')}<div class="user-chip"><div class="avatar">${esc(state.user.fullName?.[0]||'A')}</div><div class="user-meta"><strong>${esc(state.user.fullName)}</strong><small>Administrator</small></div><button class="btn btn-ghost btn-sm no-print" id="logoutBtn">Logout</button></div></header><div class="admin-layout"><aside class="sidebar no-print">${tabs.map(([id,label])=>`<button class="nav-btn ${state.adminTab===id?'active':''}" data-tab="${id}">${label}</button>`).join('')}</aside><section class="content">${content}</section></div></div>`;
  document.querySelector('#logoutBtn')?.addEventListener('click',doLogout);
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{if(b.dataset.tab!==state.adminTab){if(state.bulkBusy){toast('Wait for the voter import to finish.',true);return}if(state.bulkCredentials.length&&!confirm('New voter passwords are only visible now. Print the A4 vouchers before leaving this page. Leave and discard them?'))return;}state.adminTab=b.dataset.tab;renderAdmin()});
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
    document.querySelectorAll('[data-addcand]').forEach(b=>b.onclick=()=>openAddCandidate(Number(b.dataset.addcand)));document.querySelectorAll('[data-delpos]').forEach(b=>b.onclick=()=>removePosition(Number(b.dataset.delpos)));document.querySelectorAll('[data-delcand]').forEach(b=>b.onclick=()=>removeCandidate(Number(b.dataset.delcand)));document.querySelectorAll('[data-photocand]').forEach(b=>b.onclick=()=>openCandidatePhoto(Number(b.dataset.photocand)));document.querySelectorAll('[data-delphoto]').forEach(b=>b.onclick=()=>removeCandidatePhoto(Number(b.dataset.delphoto)));
  }catch(err){box.innerHTML=`<div class="empty">${esc(err.message)}</div>`}
}
function positionCard(p,status){return `<div class="position-card"><div class="position-head"><div><h3>${esc(p.title)}</h3><div class="tiny muted">${p.seats} seat${p.seats!==1?'s':''} · voter may select up to ${p.seats}</div></div>${status==='draft'?`<div class="actions"><button class="btn btn-secondary btn-sm" data-addcand="${p.id}">+ Candidate</button><button class="btn btn-danger btn-sm" data-delpos="${p.id}">Delete</button></div>`:''}</div>${p.candidates.length?p.candidates.map(c=>`<div class="candidate-row"><div class="candidate-admin-main">${candidatePhoto(c,'candidate-photo-sm')}<div><strong>${esc(c.full_name)}</strong><small>${esc(c.statement||'No statement')}</small><small>${c.has_photo?'Photo uploaded':'No photo uploaded'}</small></div></div>${status==='draft'?`<div class="actions candidate-actions"><button class="btn btn-secondary btn-sm" data-photocand="${c.id}">${c.has_photo?'Change photo':'Upload photo'}</button>${c.has_photo?`<button class="btn btn-ghost btn-sm" data-delphoto="${c.id}">Remove photo</button>`:''}<button class="btn btn-ghost btn-sm" data-delcand="${c.id}">Remove</button></div>`:''}</div>`).join(''):'<div class="empty" style="padding:18px">No candidates yet.</div>'}</div>`}
function openNewElection(){modal(`<h2>Create election</h2><p class="muted">Start in Draft so you can add positions and candidates.</p><form id="newElectionForm"><div class="field"><label>Election title</label><input name="title" required maxlength="120" placeholder="2026 HOA Officers Election"></div><div class="field"><label>Description</label><textarea name="description" rows="3" maxlength="500"></textarea></div><button class="btn btn-primary btn-block">Create election</button></form>`,()=>{document.querySelector('#newElectionForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const d=await api('/api/admin/elections',{method:'POST',body:JSON.stringify(Object.fromEntries(f))});closeModal();state.selectedElectionId=d.id;renderElections();}catch(err){toast(err.message,true)}}});}
function openAddPosition(eid){modal(`<h2>Add position</h2><form id="posForm"><div class="field"><label>Position name</label><input name="title" required placeholder="President"></div><div class="field"><label>Number of seats / winners</label><input name="seats" type="number" min="1" max="50" value="1" required><small class="muted">Example: President = 1; Board Member = 5.</small></div><button class="btn btn-primary btn-block">Add position</button></form>`,()=>{document.querySelector('#posForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api(`/api/admin/elections/${eid}/positions`,{method:'POST',body:JSON.stringify(Object.fromEntries(f))});closeModal();loadElectionDetail();}catch(err){toast(err.message,true)}}});}
function openAddCandidate(pid){modal(`<h2>Add candidate</h2><form id="candForm"><div class="field"><label>Candidate name</label><input name="fullName" required maxlength="100"></div><div class="field"><label>Candidate photo (optional)</label><input id="newCandidatePhoto" name="photo" type="file" accept="image/jpeg,image/png,image/webp"><small class="muted">JPEG, PNG, or WebP · maximum 5 MB. The photo will be shown on the voter ballot to help residents verify the candidate.</small></div><div id="newCandidatePhotoPreview" class="photo-upload-preview hidden"></div><div class="field"><label>Short statement (optional)</label><textarea name="statement" rows="3" maxlength="400"></textarea></div><button class="btn btn-primary btn-block">Add candidate</button></form>`,()=>{const input=document.querySelector('#newCandidatePhoto');input.onchange=()=>showPhotoPreview(input,document.querySelector('#newCandidatePhotoPreview'));document.querySelector('#candForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api(`/api/admin/positions/${pid}/candidates`,{method:'POST',body:f});closeModal();loadElectionDetail();}catch(err){toast(err.message,true)}}});}
function openCandidatePhoto(candidateId){modal(`<h2>Upload candidate photo</h2><p class="muted">This image will appear beside the candidate on the voter ballot.</p><form id="candidatePhotoForm"><div class="field"><label>Candidate photo</label><input id="candidatePhotoFile" name="photo" type="file" accept="image/jpeg,image/png,image/webp" required><small class="muted">JPEG, PNG, or WebP · maximum 5 MB.</small></div><div id="candidatePhotoPreview" class="photo-upload-preview hidden"></div><button class="btn btn-primary btn-block">Save photo</button></form>`,()=>{const input=document.querySelector('#candidatePhotoFile');input.onchange=()=>showPhotoPreview(input,document.querySelector('#candidatePhotoPreview'));document.querySelector('#candidatePhotoForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api(`/api/admin/candidates/${candidateId}/photo`,{method:'PUT',body:f});closeModal();toast('Candidate photo saved.');loadElectionDetail();}catch(err){toast(err.message,true)}}});}
function showPhotoPreview(input,box){const file=input.files?.[0];if(!file){box.classList.add('hidden');box.innerHTML='';return}const url=URL.createObjectURL(file);box.classList.remove('hidden');box.innerHTML=`<img src="${url}" alt="Selected candidate photo preview"><div><strong>${esc(file.name)}</strong><small>${Math.max(1,Math.round(file.size/1024))} KB</small></div>`;box.querySelector('img').onload=()=>URL.revokeObjectURL(url)}
async function removeCandidatePhoto(id){if(!confirm('Remove this candidate photo? The candidate will remain on the ballot.'))return;try{await api(`/api/admin/candidates/${id}/photo`,{method:'DELETE'});toast('Candidate photo removed.');loadElectionDetail()}catch(err){toast(err.message,true)}}
async function removePosition(id){if(!confirm('Delete this position and its candidates?'))return;try{await api(`/api/admin/positions/${id}`,{method:'DELETE'});loadElectionDetail()}catch(err){toast(err.message,true)}}
async function removeCandidate(id){if(!confirm('Remove this candidate?'))return;try{await api(`/api/admin/candidates/${id}`,{method:'DELETE'});loadElectionDetail()}catch(err){toast(err.message,true)}}
async function changeStatus(id,status){const q=status==='open'?'Open voting now? Positions and candidates will be locked.':'Close voting? No more ballots will be accepted and this cannot be reopened.';if(!confirm(q))return;try{await api(`/api/admin/elections/${id}/status`,{method:'PUT',body:JSON.stringify({status})});toast(`Election ${status}.`);renderElections()}catch(err){toast(err.message,true)}}
function openDeleteElection(election){
  const title=String(election.title||'');
  const openWarning=election.status==='open'?'<p><strong>This election is currently OPEN.</strong> Only elections with no submitted ballots can be deleted. Confirm that this draft/test election should be discarded.</p>':'';
  modal(`<h2>Delete election permanently?</h2><div class="danger-note"><strong>This cannot be undone.</strong>${openWarning}<p><strong>Submitted ballots are protected:</strong> any election containing a submitted ballot or participation history cannot be deleted. For a no-vote test or draft election, deleting it removes its candidates, positions and settings. Registered voter accounts remain.</p></div><p class="muted">To confirm, type the exact election title:</p><div class="confirm-title">${esc(title)}</div><div class="field"><label>Election title</label><input id="deleteElectionTitle" autocomplete="off" spellcheck="false"></div><button class="btn btn-danger btn-block" id="confirmDeleteElection" disabled>Delete election permanently</button>`,()=>{
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
  adminShell(`<div class="page-head"><div><h1>Voter Registration</h1><p>Create, manage, and remove voter accounts while preserving election history.</p></div><button class="btn btn-primary" id="addVoter">+ Register voter</button></div><section class="card bulk-card no-print"><div class="section-title"><div><h2>Bulk Registration + A4 Vouchers</h2><p class="muted tiny">Upload a CSV saved from Excel. Verify eligibility, preview unit duplicates, then issue accounts in batches of 20.</p></div><button class="btn btn-secondary btn-sm" id="bulkTemplate">Download CSV Template</button></div><div class="row bulk-uploader"><label class="field" style="margin:0;flex:1"><span class="tiny">Choose voter CSV (fullName, block, lot; optional approved, reviewNotes)</span><input id="bulkCsvFile" type="file" accept=".csv,text/csv"></label></div><div id="bulkIssued"></div><div id="bulkPreview"></div></section><div class="card"><div class="row" style="margin-bottom:12px"><input id="voterSearch" placeholder="Search name, username, block or lot" style="flex:1;min-width:220px;padding:11px;border:1px solid var(--line);border-radius:12px"><select id="voterElection" style="padding:11px;border:1px solid var(--line);border-radius:12px"><option value="">No election status</option></select></div><div id="voterTable">Loading…</div></div>`);
  const addButton=document.querySelector('#addVoter');
  if(addButton)addButton.onclick=openAddVoter;
  document.querySelector('#bulkTemplate').onclick=()=>downloadCsv([['fullName','block','lot','approved','reviewNotes']], 'hoa-voter-import-template.csv');
  document.querySelector('#bulkCsvFile').onchange=readBulkCsv;
  renderBulkIssued();
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
    currentBox.innerHTML=d.voters.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Block</th><th>Lot</th><th>Username</th>${eid?'<th>Voting</th>':''}<th>Account</th><th>Actions</th></tr></thead><tbody>${d.voters.map(v=>`<tr><td><strong>${esc(v.full_name)}</strong></td><td>${esc(v.block||'—')}</td><td>${esc(v.lot||'—')}</td><td><code>${esc(v.username)}</code></td>${eid?`<td><span class="badge ${v.voted?'badge-voted':'badge-not'}">${v.voted?'Voted':'Not Voted'}</span></td>`:''}<td><span class="badge ${v.active?'badge-open':'badge-off'}">${v.active?'Active':'Disabled'}</span></td><td><div class="actions"><button class="btn btn-ghost btn-sm" data-reset="${v.id}">Reset password</button><button class="btn ${v.active?'btn-danger':'btn-secondary'} btn-sm" data-toggle="${v.id}" data-active="${v.active?0:1}">${v.active?'Disable':'Enable'}</button><button class="btn btn-danger btn-sm" data-delete-voter="${v.id}">Delete</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No voters found.</div>';
    currentBox.querySelectorAll('[data-reset]').forEach(b=>b.onclick=()=>resetPass(Number(b.dataset.reset)));
    currentBox.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>toggleVoter(Number(b.dataset.toggle),Number(b.dataset.active)));
    currentBox.querySelectorAll('[data-delete-voter]').forEach(b=>{
      const voter=d.voters.find(v=>Number(v.id)===Number(b.dataset.deleteVoter));
      b.onclick=()=>openDeleteVoter(voter);
    });
  }catch(err){toast(err.message,true)}
}
function openAddVoter(){
  modal(`<h2>Register voter</h2><p class="muted">The system will generate a random username and 12-character password.</p><form id="voterForm"><div class="field"><label>Full name</label><input name="fullName" required maxlength="100"></div><div class="form-grid"><div class="field"><label>Block</label><input name="block" required maxlength="40"></div><div class="field"><label>Lot</label><input name="lot" required maxlength="40"></div></div><button class="btn btn-primary btn-block" style="margin-top:14px">Generate voter account</button></form>`,()=>{
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
async function resetPass(id){if(!confirm('Generate a new 12-character password? The old password will stop working.'))return;try{const d=await api(`/api/admin/voters/${id}/reset-password`,{method:'POST'});showCredentials({fullName:d.fullName,block:d.block,lot:d.lot,username:d.username,password:d.password});}catch(err){toast(err.message,true)}}
async function toggleVoter(id,active){try{await api(`/api/admin/voters/${id}/active`,{method:'PUT',body:JSON.stringify({active:!!active})});loadVoters()}catch(err){toast(err.message,true)}}
function openDeleteVoter(voter){
  if(!voter)return;
  const username=String(voter.username||'');
  modal(`<h2>Delete voter permanently?</h2><div class="danger-note"><strong>This cannot be undone.</strong><p>This permanently removes the voter account and immediately ends any active login session.</p><p><strong>Election protection:</strong> if this voter has already voted in any election, permanent deletion will be blocked. Use <em>Disable</em> instead so turnout and participation records remain intact.</p></div><p class="muted">To confirm deletion of <strong>${esc(voter.full_name)}</strong>, type the exact username:</p><div class="confirm-title">${esc(username)}</div><div class="field"><label>Voter username</label><input id="deleteVoterUsername" autocomplete="off" spellcheck="false"></div><button class="btn btn-danger btn-block" id="confirmDeleteVoter" disabled>Delete voter permanently</button>`,()=>{
    const input=document.querySelector('#deleteVoterUsername');
    const button=document.querySelector('#confirmDeleteVoter');
    input.oninput=()=>{button.disabled=input.value!==username};
    button.onclick=async()=>{
      if(input.value!==username)return;
      button.disabled=true;button.textContent='Deleting…';
      try{
        await api(`/api/admin/voters/${Number(voter.id)}`,{method:'DELETE'});
        closeModal();toast('Voter account permanently deleted.');loadVoters();
      }catch(err){button.disabled=false;button.textContent='Delete voter permanently';toast(err.message,true)}
    };
    input.focus();
  });
}


function clearBulkSecrets(){
  state.bulkPreview=[];
  state.bulkCredentials=[];
  state.bulkAcknowledged=false;
  state.bulkBusy=false;
}
function normalUnit(value){
  const v=String(value??'').trim();
  return /^0*[0-9]+$/.test(v)?v.replace(/^0+(?=\d)/,''):v;
}
function parseCsv(text){
  text=String(text||'').replace(/^\ufeff/,'');
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){
      if(quoted&&text[i+1]==='"'){cell+='"';i++}else if(!quoted&&cell===''){quoted=true}
      else if(quoted){quoted=false}else{cell+='"'}
    }else if(c===','&&!quoted){row.push(cell);cell=''}
    else if((c==='\r'||c==='\n')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell=''}
    else{cell+=c}
  }
  if(quoted)throw new Error('CSV has an unmatched quotation mark.');
  row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
  return rows;
}
async function readBulkCsv(e){
  const file=e.target.files?.[0];
  if(!file)return;
  if(file.size>2*1024*1024){toast('CSV exceeds 2 MB.',true);return}
  if(state.bulkCredentials.length&&!confirm('Print the previous batch vouchers before loading a new file. Clear the current one-time passwords?')){e.target.value='';return}
  state.bulkCredentials=[];
  state.bulkPreview=[];
  state.bulkAcknowledged=false;
  renderBulkIssued();
  const box=document.querySelector('#bulkPreview');
  box.textContent='Checking voter CSV...';
  try{
    const rows=parseCsv(await file.text());
    if(rows.length<2||rows.length>505)throw new Error('CSV needs a header and 1–500 voter rows.');
    // Excel exports the styled review workbook with three title/notes rows
    // before its real header. Locate the real header rather than guessing row 1.
    const headerAt=rows.findIndex(r=>{
      const fields=r.map(h=>h.toLowerCase().replace(/[^a-z0-9]/g,''));
      return ['fullname','buyersname','name','residentname'].some(h=>fields.includes(h))&&
        ['block','blk'].some(h=>fields.includes(h))&&fields.includes('lot');
    });
    if(headerAt<0)throw new Error('Required CSV columns: fullName, block, lot.');
    const keys=rows[headerAt].map(h=>h.toLowerCase().replace(/[^a-z0-9]/g,''));
    const col=(...aliases)=>aliases.map(x=>keys.indexOf(x)).find(i=>i>=0)??-1;
    const nc=col('fullname','buyersname','name','residentname'),bc=col('block','blk'),lc=col('lot'),ac=col('approved','eligible','import'),rc=col('reviewnotes','notes','flag');
    const entries=rows.slice(headerAt+1).map((r,index)=>({
      line:index+headerAt+2,fullName:String(r[nc]||'').trim(),block:normalUnit(r[bc]),lot:normalUnit(r[lc]),
      approved:String(r[ac]||'').trim().toUpperCase(),reviewNotes:String(r[rc]||'').trim(),
      selected:false,imported:false,errors:[],warnings:[]
    }));
    if(entries.length<1||entries.length>500)throw new Error('CSV must contain 1–500 voter rows.');
    const existing=await api('/api/admin/voters');
    const units=new Set(existing.voters.map(x=>`${normalUnit(x.block).toLowerCase()}|${normalUnit(x.lot).toLowerCase()}`));
    const unitCounts=new Map(),nameCounts=new Map();
    for(const r of entries){
      const k=`${r.block.toLowerCase()}|${r.lot.toLowerCase()}`;
      unitCounts.set(k,(unitCounts.get(k)||0)+1);
      const n=r.fullName.toLowerCase().replace(/\s+/g,' ');nameCounts.set(n,(nameCounts.get(n)||0)+1);
    }
    for(const r of entries){
      const k=`${r.block.toLowerCase()}|${r.lot.toLowerCase()}`;
      if(!r.fullName||!r.block||!r.lot)r.errors.push('Missing name, block or lot');
      if(r.fullName.length>100||r.block.length>40||r.lot.length>40)r.errors.push('Field too long');
      if(unitCounts.get(k)>1)r.errors.push('Duplicate Block/Lot in CSV');
      if(units.has(k))r.errors.push('Already registered');
      if(nameCounts.get(r.fullName.toLowerCase().replace(/\s+/g,' '))>1)r.warnings.push('Same owner appears on multiple units');
      if(r.reviewNotes)r.warnings.push(r.reviewNotes);
      r.selected=(!r.errors.length&&!r.warnings.length&&['YES','TRUE','1'].includes(r.approved));
    }
    state.bulkPreview=entries;
    renderBulkPreview();
  }catch(err){box.innerHTML=`<div class="danger-note">${esc(err.message)}</div>`;toast(err.message,true)}
}
function renderBulkPreview(){
  const box=document.querySelector('#bulkPreview');
  if(!box)return;
  const rows=state.bulkPreview;
  if(!rows.length){box.innerHTML='';return}
  const hard=rows.filter(x=>x.errors.length).length;
  const warnings=rows.filter(x=>!x.errors.length&&x.warnings.length).length;
  const selected=rows.filter(x=>x.selected&&!x.imported&&!x.errors.length).length;
  box.innerHTML=`<div class="bulk-summary"><strong>${rows.length} CSV rows</strong><span>${selected} selected</span><span>${hard} blocked</span><span>${warnings} need review</span></div><div class="actions" style="margin:12px 0"><button id="bulkSelectClear" class="btn btn-secondary btn-sm" ${state.bulkBusy?'disabled':''}>Select all clear rows</button><button id="bulkClearSelection" class="btn btn-ghost btn-sm" ${state.bulkBusy?'disabled':''}>Unselect all</button></div><div class="bulk-table-wrap"><table class="table"><thead><tr><th>Import</th><th>CSV line</th><th>Homeowner</th><th>Block</th><th>Lot</th><th>Review</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td><input type="checkbox" class="bulk-include" data-bulk-index="${i}" ${r.selected?'checked':''} ${r.errors.length||r.imported||state.bulkBusy?'disabled':''} aria-label="Import ${esc(r.fullName)}"></td><td>${r.line}</td><td>${esc(r.fullName)}</td><td>${esc(r.block)}</td><td>${esc(r.lot)}</td><td>${r.imported?'<span class="badge badge-voted">Created</span>':r.errors.length?`<span class="bulk-error">${esc(r.errors.join('; '))}</span>`:r.warnings.length?`<span class="bulk-warning">${esc(r.warnings.join('; '))}</span>`:'Clear'}</td></tr>`).join('')}</tbody></table></div><label class="bulk-confirm"><input id="bulkEligibility" type="checkbox" ${state.bulkAcknowledged?'checked':''} ${state.bulkBusy?'disabled':''}><span>I confirm that each selected Block/Lot is entitled to one voting account under our HOA election rules, and I have resolved the flagged entries.</span></label><div class="actions"><button id="bulkImportNow" class="btn btn-primary" ${!selected||!state.bulkAcknowledged||state.bulkBusy?'disabled':''}>Generate ${selected} account${selected===1?'':'s'} + vouchers</button><span id="bulkProgress" class="tiny muted"></span></div><p class="tiny muted">Do not import a second account for a lot that already exists. Passwords are displayed only once; print the vouchers before refreshing or closing the page.</p>`;
  box.querySelectorAll('.bulk-include').forEach(input=>input.onchange=()=>{
    const r=rows[Number(input.dataset.bulkIndex)];r.selected=input.checked;renderBulkPreview();
  });
  box.querySelector('#bulkEligibility').onchange=e=>{state.bulkAcknowledged=e.target.checked;renderBulkPreview()};
  box.querySelector('#bulkSelectClear').onclick=()=>{
    if(!confirm('Select all unflagged, unregistered rows? Confirm the voter eligibility of these residents first.'))return;
    rows.forEach(r=>{if(!r.imported&&!r.errors.length&&!r.warnings.length)r.selected=true});renderBulkPreview();
  };
  box.querySelector('#bulkClearSelection').onclick=()=>{rows.forEach(r=>r.selected=false);renderBulkPreview()};
  box.querySelector('#bulkImportNow').onclick=runBulkImport;
}
async function runBulkImport(){
  const selected=state.bulkPreview.filter(x=>x.selected&&!x.imported&&!x.errors.length);
  if(!selected.length||!state.bulkAcknowledged||state.bulkBusy)return;
  if(!confirm(`Create ${selected.length} voter accounts now? This issues real credentials that must be printed or privately distributed.`))return;
  state.bulkBusy=true;
  renderBulkPreview();
  const progress=document.querySelector('#bulkProgress');
  let imported=0;
  try{
    for(let i=0;i<selected.length;i+=20){
      const batch=selected.slice(i,i+20);
      const result=await api('/api/admin/voters/bulk',{method:'POST',body:JSON.stringify({voters:batch.map(x=>({fullName:x.fullName,block:x.block,lot:x.lot}))})});
      if(result.voters.length!==batch.length)throw new Error('Database returned an unexpected number of accounts. Stop and reconcile before retrying.');
      state.bulkCredentials.push(...result.voters);
      if(result.auditWarning)alert('Accounts were created, but the audit-log write failed. Print credentials and have the election administrator inspect database audit logs.');
      batch.forEach(x=>{x.imported=true;x.selected=false});
      imported+=batch.length;
      if(progress)progress.textContent=`Created ${imported} of ${selected.length} accounts...`;
      renderBulkIssued();
    }
    toast(`Generated ${imported} accounts. Print A4 vouchers now.`);
  }catch(err){
    toast(`Stopped after ${imported} accounts: ${err.message}`,true);
    alert(`Bulk import stopped. ${imported} accounts were created in this run. Previously successful batches remain registered. Print their vouchers now, refresh the voter list, and reconcile the failed batch before retrying.\n\n${err.message}`);
  }finally{
    state.bulkBusy=false;
    renderBulkPreview();
    renderBulkIssued();
    await loadVoters();
  }
}
function renderBulkIssued(){
  const box=document.querySelector('#bulkIssued');if(!box)return;
  if(!state.bulkCredentials.length){box.innerHTML='';return}
  box.innerHTML=`<div class="bulk-issued"><div><strong>${state.bulkCredentials.length} credential${state.bulkCredentials.length===1?'':'s'} issued</strong><p class="tiny">Passwords are only held in this browser tab until you clear them, refresh, leave this page, or log out. They cannot be retrieved later without resetting each password.</p></div><div class="actions"><button class="btn btn-primary" id="bulkPrint">Print ${state.bulkCredentials.length} vouchers on A4</button><button class="btn btn-ghost btn-sm" id="bulkDiscard">Clear passwords</button></div></div>`;
  box.querySelector('#bulkPrint').onclick=()=>printVoucherSheet(state.bulkCredentials);
  box.querySelector('#bulkDiscard').onclick=()=>{if(!confirm('Clear these one-time passwords? You will have to reset passwords to reprint.'))return;state.bulkCredentials=[];renderBulkIssued()};
}
function printVoucherSheet(voters){
  if(!voters?.length)return toast('No newly issued credentials to print.',true);
  const w=window.open('','_blank','width=980,height=820');
  if(!w)return toast('Allow popups to print the voucher sheet.',true);
  w.opener=null;
  const portal=new URL('/vote',location.origin).href;
  const sheets=[];
  for(let i=0;i<voters.length;i+=8){
    const cards=voters.slice(i,i+8).map((v,j)=>`<article class="voucher"><header><b>CASA VERDE DE BAÑADEROS</b><small>HOA ELECTION - PRIVATE LOGIN</small></header><h2>${esc(v.fullName)}</h2><div class="lot">Block ${esc(v.block||'-')} &nbsp;|&nbsp; Lot ${esc(v.lot||'-')}</div><div class="cred"><label>USERNAME</label><div>${esc(v.username)}</div><label>PASSWORD</label><div>${esc(v.password)}</div></div><footer><strong>${esc(portal)}</strong><span>Private: do not share or photograph. One account, one ballot.</span></footer><small class="num">Voucher ${i+j+1} of ${voters.length}</small></article>`).join('');
    sheets.push(`<section class="sheet">${cards}</section>`);
  }
  w.document.write(`<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>HOA Private A4 Voter Vouchers</title><style>@page{size:A4 portrait;margin:9mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#182c2b}.sheet{width:192mm;height:279mm;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(4,minmax(0,1fr));gap:2mm;break-after:page;page-break-after:always}.sheet:last-child{break-after:auto;page-break-after:auto}.voucher{position:relative;border:1px dashed #7c9190;border-radius:2mm;padding:3.3mm;display:flex;flex-direction:column;overflow:hidden;break-inside:avoid;page-break-inside:avoid}.voucher header{border-bottom:1px solid #bbd0ce;padding-bottom:1.5mm}.voucher header b{font-size:8pt;letter-spacing:.2px}.voucher header small{display:block;font-size:6.5pt;color:#486661;margin-top:1mm}.voucher h2{font-size:11pt;margin:2.5mm 0 1mm;line-height:1.12;overflow-wrap:anywhere}.lot{font-size:8pt;color:#42545a}.cred{display:grid;grid-template-columns:25mm 1fr;align-items:center;gap:1.1mm 1mm;margin:3mm 0 2mm}.cred label{font-size:7pt;color:#4a6362;font-weight:700}.cred div{font-family:Consolas,monospace;font-weight:800;font-size:13pt;letter-spacing:.35px;overflow-wrap:anywhere}.voucher footer{margin-top:auto;padding-top:1mm;font-size:7pt;display:grid;gap:1mm}.voucher footer strong{overflow-wrap:anywhere}.voucher footer span{color:#526967;font-size:6.7pt}.num{display:block;text-align:right;margin-top:1.5mm;color:#667b7c;font-size:6.5pt}@media screen{body{background:#e8eeee;padding:10px}.sheet{background:white;margin:0 auto 12px;box-shadow:0 5px 20px #888}}@media print{body{padding:0}.sheet{box-shadow:none}}</style></head><body>${sheets.join('')}<script>window.addEventListener('load',()=>window.print())<\/script></body></html>`);
  w.document.close();
}

function printCredential(v){printVoucherSheet([v]);}

async function renderReports(){
  adminShell(`<div class="page-head"><div><h1>Results & Reports</h1><p>Live/final totals and Block/Lot participation reporting.</p></div><div class="actions"><button class="btn btn-secondary" id="exportCsv">Export CSV</button><button class="btn btn-primary" id="printA4">Print / Save PDF (A4)</button></div></div><div class="card no-print" style="margin-bottom:14px"><div class="row"><select id="reportElection" style="padding:11px;border:1px solid var(--line);border-radius:12px;min-width:240px"></select><button class="btn btn-ghost ${state.reportType==='results'?'active':''}" data-report="results">Election Results</button><button class="btn btn-ghost ${state.reportType==='participation'?'active':''}" data-report="participation">Voter Participation</button></div></div><div id="reportArea" class="card">Loading…</div>`);
  try{const e=await api('/api/admin/elections');state.elections=e.elections;if(!state.selectedElectionId&&e.elections[0])state.selectedElectionId=e.elections[0].id;const sel=document.querySelector('#reportElection');sel.innerHTML=e.elections.map(x=>`<option value="${x.id}" ${Number(x.id)===Number(state.selectedElectionId)?'selected':''}>${esc(x.title)}</option>`).join('')||'<option>No elections</option>';sel.onchange=()=>{state.selectedElectionId=Number(sel.value);loadReport()};document.querySelectorAll('[data-report]').forEach(b=>b.onclick=()=>{state.reportType=b.dataset.report;renderReports()});document.querySelector('#printA4').onclick=()=>window.print();document.querySelector('#exportCsv').onclick=exportCurrentCsv;loadReport();}catch(err){toast(err.message,true)}
}
async function loadReport(){if(!state.selectedElectionId){document.querySelector('#reportArea').innerHTML='<div class="empty">No election selected.</div>';return}try{if(state.reportType==='results')drawResults(await api(`/api/admin/elections/${state.selectedElectionId}/results`));else drawParticipation(await api(`/api/admin/elections/${state.selectedElectionId}/participation`));}catch(err){toast(err.message,true)}}
function reportHead(title,status){return `<div class="report-header"><h1>${esc(title)}</h1><p>HOA Election Report · Status: ${esc(status)} · Generated ${esc(new Date().toLocaleString())}</p></div>`}
function drawResults(d){const box=document.querySelector('#reportArea');box.dataset.csv=JSON.stringify({type:'results',data:d});box.innerHTML=`${reportHead(d.election.title,d.election.status)}<div class="section-title"><div><h2>${esc(d.election.title)}</h2><span class="badge badge-${d.election.status}">${d.election.status}</span></div></div><div class="grid grid-4" style="margin-bottom:22px"><div><div class="stat-label">Eligible voters</div><div class="stat-value">${d.eligibleVoters}</div></div><div><div class="stat-label">Ballots cast</div><div class="stat-value">${d.ballotsCast}</div></div><div><div class="stat-label">Turnout</div><div class="stat-value">${d.turnoutPercentage}%</div></div><div><div class="stat-label">Positions</div><div class="stat-value">${d.positions.length}</div></div></div>${d.positions.map(p=>`<section class="result-position"><div class="section-title"><div><h2>${esc(p.title)}</h2><div class="tiny muted">${p.seats} seat${p.seats!==1?'s':''} · ${p.totalVotes} selection${p.totalVotes!==1?'s':''}</div></div></div>${p.candidates.length?p.candidates.map((c,i)=>`<div class="result-row"><div><strong>${esc(c.full_name)}</strong></div><div class="bar"><i style="width:${Math.min(100,c.percentage)}%"></i></div><div class="result-count">${c.votes}</div><div class="result-pct">${c.percentage}%</div></div>`).join(''):'<div class="empty">No candidates.</div>'}</section>`).join('')}`;}
function drawParticipation(d){const box=document.querySelector('#reportArea');box.dataset.csv=JSON.stringify({type:'participation',data:d});box.innerHTML=`${reportHead(d.election.title,d.election.status)}<div class="section-title"><div><h2>Voter Participation</h2><div class="tiny muted">${esc(d.election.title)}</div></div></div><div class="grid grid-4" style="margin-bottom:18px"><div><div class="stat-label">Registered</div><div class="stat-value">${d.voters.length}</div></div><div><div class="stat-label">Voted</div><div class="stat-value">${d.votedCount}</div></div><div><div class="stat-label">Not voted</div><div class="stat-value">${d.notVotedCount}</div></div><div><div class="stat-label">Status</div><div style="margin-top:10px"><span class="badge badge-${d.election.status}">${d.election.status}</span></div></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Block</th><th>Lot</th><th>Username</th><th>Status</th><th>Voted at</th></tr></thead><tbody>${d.voters.map(v=>`<tr><td>${esc(v.full_name)}</td><td>${esc(v.block||'—')}</td><td>${esc(v.lot||'—')}</td><td>${esc(v.username)}</td><td><span class="badge ${v.voted?'badge-voted':'badge-not'}">${v.voted?'Voted':'Not Voted'}</span></td><td>${v.voted?esc(fmt(v.voted_at)):'—'}</td></tr>`).join('')}</tbody></table></div><p class="tiny muted" style="margin-top:12px">Participation records show whether a resident voted. They do not reveal the resident’s ballot choices.</p>`;}
function exportCurrentCsv(){const box=document.querySelector('#reportArea');if(!box?.dataset.csv)return;const x=JSON.parse(box.dataset.csv);let rows=[];if(x.type==='results'){rows.push(['Election',x.data.election.title],['Status',x.data.election.status],['Eligible Voters',x.data.eligibleVoters],['Ballots Cast',x.data.ballotsCast],['Turnout',`${x.data.turnoutPercentage}%`],[]);for(const p of x.data.positions){rows.push([p.title,`Seats: ${p.seats}`],['Candidate','Votes','Percentage']);for(const c of p.candidates)rows.push([c.full_name,c.votes,`${c.percentage}%`]);rows.push([])}}else{rows.push(['Election',x.data.election.title],['Name','Block','Lot','Username','Status','Voted At']);for(const v of x.data.voters)rows.push([v.full_name,v.block,v.lot,v.username,v.voted?'Voted':'Not Voted',v.voted_at||''])}downloadCsv(rows,`${slug(x.data.election.title)}-${x.type}.csv`)}
function downloadCsv(rows,name){const csv=rows.map(r=>r.map(v=>{let x=String(v??''); if(/^[\s]*[=+@-]/.test(x))x="'"+x;return `"${x.replaceAll('\"','\"\"')}"`}).join(',')).join('\r\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}function slug(s){return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'hoa-election'}

async function renderVoter(){
  app.innerHTML=`<div class="ballot-shell"><header class="topbar">${brandLogo('Secure election portal')}<div class="user-chip"><div class="avatar">${esc(state.user.fullName?.[0]||'V')}</div><div class="user-meta"><strong>${esc(state.user.fullName)}</strong><small>Block ${esc(state.user.block||'—')} · Lot ${esc(state.user.lot||'—')}</small></div><button class="btn btn-ghost btn-sm" id="logoutBtn">Logout</button></div></header><div id="ballotArea"><div class="card">Loading election…</div></div></div>`;document.querySelector('#logoutBtn').onclick=doLogout;
  try{const d=await api('/api/voter/ballot');drawBallot(d)}catch(err){toast(err.message,true)}
}
function drawBallot(d){const box=document.querySelector('#ballotArea');if(!d.election){box.innerHTML=`<div class="card empty"><h2>No open election</h2><p>${esc(d.message||'Please check back later.')}</p></div>`;return}if(d.voted){box.innerHTML=`<div class="thankyou-card"><div class="thankyou-icon">✓</div><div class="thankyou-kicker">Ballot successfully recorded</div><h1>Thank you for Voting!</h1><blockquote>“Your voice matters. Thank you for helping shape the future of our community.”</blockquote><p class="thankyou-election">Your ballot for <strong>${esc(d.election.title)}</strong> has already been submitted and cannot be submitted again.</p><div class="thankyou-meta"><span>Submitted: ${esc(fmt(d.votedAt))}</span></div><div class="credential receipt-card"><small>Ballot receipt</small><div class="code">${esc(d.receiptCode)}</div><p class="tiny muted">Keep this receipt for your records. It confirms submission without revealing your selections.</p></div></div>`;return}
  box.innerHTML=`<div class="hero"><h1>${esc(d.election.title)}</h1><p>${esc(d.election.description||'Select your preferred candidates for each position.')}</p></div><form id="ballotForm">${d.positions.map(p=>`<section class="ballot-position" data-position="${p.id}" data-seats="${p.seats}"><h2>${esc(p.title)}</h2><p class="instruction">Select up to ${p.seats} candidate${p.seats!==1?'s':''}. Candidate photos are shown to help you verify your selection.</p>${p.candidates.map(c=>`<label class="candidate-option"><input type="checkbox" name="p-${p.id}" value="${c.id}">${candidatePhoto(c,'candidate-photo-ballot')}<span class="candidate-copy"><strong>${esc(c.full_name)}</strong>${c.statement?`<p>${esc(c.statement)}</p>`:''}${!c.has_photo?'<span class="tiny muted">Photo not provided</span>':''}</span></label>`).join('')}</section>`).join('')}<div class="ballot-footer"><div><strong id="selectionCount">0 selections</strong><div class="tiny muted">Review carefully before submitting.</div></div><button class="btn btn-primary" type="submit">Review & Submit</button></div></form>`;
  document.querySelectorAll('.candidate-option input').forEach(cb=>cb.onchange=e=>{const section=e.target.closest('.ballot-position');const max=Number(section.dataset.seats);const checked=[...section.querySelectorAll('input:checked')];if(checked.length>max){e.target.checked=false;toast(`You may select up to ${max} candidate${max!==1?'s':''} for this position.`,true)}document.querySelectorAll('.candidate-option').forEach(l=>l.classList.toggle('selected',l.querySelector('input').checked));const total=document.querySelectorAll('.candidate-option input:checked').length;document.querySelector('#selectionCount').textContent=`${total} selection${total!==1?'s':''}`});
  document.querySelector('#ballotForm').onsubmit=e=>{e.preventDefault();const selections={};d.positions.forEach(p=>selections[p.id]=[...document.querySelectorAll(`input[name="p-${p.id}"]:checked`)].map(x=>Number(x.value)));if(!Object.values(selections).some(a=>a.length)){toast('Select at least one candidate.',true);return}openBallotReview(d,selections)};
}
function openBallotReview(d,selections){const lines=d.positions.map(p=>{const chosen=p.candidates.filter(c=>selections[p.id].includes(Number(c.id)));return `<div class="review-position"><strong>${esc(p.title)}</strong><div class="review-candidates">${chosen.length?chosen.map(c=>`<div class="review-candidate">${candidatePhoto(c,'candidate-photo-review')}<span>${esc(c.full_name)}</span></div>`).join(''):'<span class="muted">No selection</span>'}</div></div>`}).join('');modal(`<h2>Review your ballot</h2><p class="muted">Confirm the candidate names and photos below. Once submitted, your vote cannot be changed.</p>${lines}<label style="display:flex;gap:10px;align-items:flex-start;margin:16px 0"><input id="confirmVote" type="checkbox" style="margin-top:4px"><span>I confirm these are my selections and I am ready to submit my ballot.</span></label><button class="btn btn-primary btn-block" id="finalSubmit" disabled>Submit final ballot</button>`,()=>{document.querySelector('#confirmVote').onchange=e=>document.querySelector('#finalSubmit').disabled=!e.target.checked;document.querySelector('#finalSubmit').onclick=async()=>{const b=document.querySelector('#finalSubmit');b.disabled=true;b.textContent='Submitting…';try{const r=await api('/api/voter/vote',{method:'POST',body:JSON.stringify({electionId:d.election.id,selections})});closeModal();toast('Your vote has been recorded.');drawBallot({...d,voted:true,votedAt:new Date().toISOString(),receiptCode:r.receiptCode});}catch(err){if(/already submitted|already.*ballot/i.test(err.message)){closeModal();try{const latest=await api('/api/voter/ballot');drawBallot(latest);}catch{}toast('Your ballot was already submitted.');return}b.disabled=false;b.textContent='Submit final ballot';toast(err.message,true)}}});}

function modal(html,onOpen){document.body.insertAdjacentHTML('beforeend',`<div class="modal-backdrop" id="modalBackdrop"><div class="modal"><button class="btn btn-ghost btn-sm close" id="modalClose">✕</button><div id="modalContent">${html}</div></div></div>`);document.querySelector('#modalClose').onclick=closeModal;document.querySelector('#modalBackdrop').onclick=e=>{if(e.target.id==='modalBackdrop')closeModal()};onOpen?.()}
function closeModal(){document.querySelector('#modalBackdrop')?.remove()}

init();
