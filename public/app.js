const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
let state = { user:null, csrfToken:null, adminTab:'dashboard', elections:[], selectedElectionId:null, reportType:'results', bulkPreview:[], bulkCredentials:[], bulkAcknowledged:false, bulkBusy:false };

const esc = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt = d => d ? new Date(d).toLocaleString() : '—';
const phDateTime = iso => iso ? new Intl.DateTimeFormat('en-PH', {timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(iso))+' PHT' : 'Not set';
function phLocalToIso(value){
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value||'')))return null;
  const date=new Date(`${value}:00+08:00`);
  return Number.isFinite(date.getTime())?date.toISOString():null;
}
function phIsoToInput(iso){
  if(!iso)return '';
  const date=new Date(iso);
  return Number.isFinite(date.getTime())?new Date(date.getTime()+8*3600000).toISOString().slice(0,16):'';
}
const BRAND_NAME = 'Casa Verde de Bañaderos HOA';
const brandLogo = (subtitle='') => `<div class="brand brand-with-logo"><img src="/hoa-logo.png" alt="${BRAND_NAME} logo" class="brand-logo"><div><div class="brand-title">${BRAND_NAME}</div>${subtitle?`<small class="brand-subtitle">${subtitle}</small>`:''}</div></div>`;
const initials = name => String(name||'?').trim().split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()||'').join('')||'?';
// Profile-style placeholder supplied by the HOA; no uploaded photo is required.
// It stays underneath uploaded portraits so failed/removed image requests also
// fall back to the same silhouette, never a broken image or candidate initials.
const candidatePhoto = (c,size='') => `<span class="candidate-photo ${size} ${c.has_photo?'':'candidate-no-photo'}"><img class="candidate-placeholder" src="/candidate-no-photo.png" alt="${c.has_photo?'':'Default profile image: no candidate photo'}" ${c.has_photo?'aria-hidden="true"':''} loading="lazy">${c.has_photo?`<img data-candidate-photo src="/api/candidates/${Number(c.id)}/photo" alt="Photo of ${esc(c.full_name)}" loading="lazy">`:''}</span>`;
document.addEventListener('error',e=>{if(e.target?.matches?.('img[data-candidate-photo]'))e.target.classList.add('photo-error')},true);

const uiIcons = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  elections: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 15l2 2 5-5"/>',
  voters: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  reports: '<path d="M3 3v18h18M7 15l4-4 4 2 5-7"/><path d="M16 6h4v4"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  printer: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6zM18 12h.01"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 11v6m0-10h.01"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  check: '<path d="m5 12 4 4L19 6"/>'
};
const uiIcon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" class="ui-icon" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${uiIcons[name]||uiIcons.info}</svg>`;
const statusLabel = status => ({draft:'Draft',open:'Voting open',closed:'Closed'})[status] || String(status||'');
const electionBadge = e => e.status==='draft' && e.voting_starts_at
  ? `<span class="badge ${Date.parse(e.voting_starts_at)<=Date.now()?'badge-schedule-due':'badge-scheduled'}">${Date.parse(e.voting_starts_at)<=Date.now()?'Opening due':'Scheduled'}</span>`
  : `<span class="badge badge-${esc(e.status)}">${esc(statusLabel(e.status))}</span>`;

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
  if(r.status===401 && !path.includes('/auth/login') && !path.includes('/voter/change-password')){ state.user=null; state.csrfToken=null; location.pathname==='/admin'?renderLogin('admin'):renderLogin('voter'); throw new Error('Session expired'); }
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
  if(state.user?.role==='voter' && state.user?.mustChangePassword) return renderVoterPasswordChange();
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
function renderVoterPasswordChange(){
  // The server also blocks ballot GET/POST and the SQL transaction itself
  // rejects an unchanged issued password. This form is not the security gate.
  app.innerHTML=`<div class="auth-wrap"><section class="auth-card">${brandLogo('Secure election portal')}<div class="auth-eyebrow">ACCOUNT SECURITY · FIRST SIGN IN</div><h1>Create your private password</h1><p class="sub">Before you can view or submit a ballot, replace the temporary password printed on your HOA login voucher.</p><form id="voterChangePasswordForm" autocomplete="on"><div class="field"><label for="voterCurrentPassword">Current password from voucher</label><input id="voterCurrentPassword" name="currentPassword" type="password" autocomplete="current-password" required maxlength="128"></div><div class="field"><label for="voterNewPassword">New password</label><input id="voterNewPassword" name="newPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="72" aria-describedby="newPasswordHint"><small id="newPasswordHint" class="tiny muted">Use at least 12 characters, with a maximum of 72 UTF-8 bytes. A unique passphrase is recommended.</small></div><div class="field"><label for="voterConfirmPassword">Confirm new password</label><input id="voterConfirmPassword" name="confirmPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="72"></div><button id="updateVoterPassword" type="submit" class="btn btn-primary btn-block">Save password and sign in again</button><button id="changePasswordLogout" type="button" class="btn btn-ghost btn-block" style="margin-top:12px">Log out</button></form><p class="tiny muted" style="margin-top:16px">The administrator cannot retrieve your new password. If you forget it, request a new temporary password.</p></section></div>`;
  enhancePasswordToggles(app);
  document.querySelector('#changePasswordLogout').onclick=doLogout;
  document.querySelector('#voterChangePasswordForm').onsubmit=async e=>{
    e.preventDefault();
    const form=e.currentTarget;
    const currentPassword=String(form.elements.namedItem('currentPassword').value||'');
    const newPassword=String(form.elements.namedItem('newPassword').value||'');
    const confirmPassword=String(form.elements.namedItem('confirmPassword').value||'');
    if(newPassword.length<12 || new TextEncoder().encode(newPassword).length>72){toast('Use at least 12 characters and no more than 72 UTF-8 bytes.',true);return;}
    if(newPassword!==confirmPassword){toast('The new passwords do not match.',true);return;}
    if(newPassword===currentPassword){toast('Choose a different password from the one on your voucher.',true);return;}
    const submit=document.querySelector('#updateVoterPassword');
    submit.disabled=true;
    submit.textContent='Updating password…';
    try{
      await api('/api/voter/change-password',{method:'POST',body:JSON.stringify({currentPassword,newPassword})});
      // The database deleted all of this voter's sessions. Do not retain their
      // old CSRF token or assume the account is still logged in.
      state.user=null;state.csrfToken=null;
      renderLogin('voter');
      toast('Password changed. Sign in again with your new password.');
    }catch(err){
      toast(err.message,true);
      submit.disabled=false;submit.textContent='Save password and sign in again';
    }
  };
}

function renderLogin(expectedRole=null){
  const admin=expectedRole==='admin';
  app.innerHTML=`<div class="auth-wrap"><section class="auth-card">${brandLogo('Secure election portal')}<div class="auth-eyebrow">${admin?'ADMINISTRATOR ACCESS':'WELCOME HOMEOWNERS'}</div><h1>${admin?'Administrator sign in':'Sign in to vote'}</h1><p class="sub">${admin?'Sign in with your administrator account to manage elections, voters, and reports.':'Sign in using the credentials issued by your HOA election administrator.'}</p><form id="loginForm"><div class="field"><label>Username</label><input name="username" required autocomplete="username" autocapitalize="none"></div><div class="field"><label>Password</label><input name="password" type="password" required autocomplete="current-password"></div><button class="btn btn-primary btn-block">Sign in securely</button></form><p class="tiny muted" style="margin-top:18px">${admin?'Administrator access only.':'For election security, a voter account can be signed in on only one device at a time. Please log out before moving to another device.'}</p>${admin?'':'<details class="auth-help"><summary>First time voting? Start here</summary><ol><li>Sign in with your private voucher.</li><li>Choose a new password if prompted.</li><li>Pick candidates and review before submitting.</li></ol></details><p class="tiny muted">Your ballot choices are stored separately from your voter registration record.</p>'}</section></div>`;
  enhancePasswordToggles(app);
  document.querySelector('#loginForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const d=await api('/api/auth/login',{method:'POST',body:JSON.stringify(Object.fromEntries(f))});if(expectedRole && d.user.role!==expectedRole){ state.user=d.user; state.csrfToken=d.csrfToken; await doLogout(); throw new Error(`This account belongs to the ${d.user.role} portal.`); } state.user=d.user;state.csrfToken=d.csrfToken;routeHome();}catch(err){toast(err.message,true)}};
}
async function doLogout(){if(state.bulkBusy){toast('Wait for voter import to finish before logging out.',true);return}if(state.bulkCredentials.length&&!confirm('Your new voter passwords have not been cleared. Print the A4 vouchers before logging out. Log out and permanently clear them?'))return;try{await api('/api/auth/logout',{method:'POST'});}catch{} clearBulkSecrets();state.user=null;state.csrfToken=null;location.pathname==='/admin'?renderLogin('admin'):renderLogin('voter');}

function adminShell(content){
  if(state.adminTab!=='voters') clearBulkSecrets();
  const tabs=[['dashboard','Overview','dashboard'],['elections','Elections','elections'],['voters','Voters & vouchers','voters'],['reports','Reports','reports']];
  app.innerHTML=`<div class="shell admin-shell">
    <header class="topbar site-header">
      ${brandLogo('ELECTION MANAGEMENT')}
      <div class="user-chip"><div class="avatar" aria-hidden="true">${esc(state.user.fullName?.[0]||'A')}</div><div class="user-meta"><strong>${esc(state.user.fullName)}</strong><small>Administrator</small></div><button class="btn btn-ghost btn-sm no-print" id="logoutBtn">Log out</button></div>
    </header>
    <div class="admin-layout">
      <nav class="sidebar no-print" aria-label="Admin navigation">
        <div class="sidebar-heading">WORKSPACE</div>
        <div class="sidebar-links">${tabs.map(([id,label,icon])=>`<button type="button" class="nav-btn ${state.adminTab===id?'active':''}" aria-current="${state.adminTab===id?'page':'false'}" data-tab="${id}">${uiIcon(icon)}<span>${label}</span></button>`).join('')}</div>
        <div class="sidebar-security">${uiIcon('shield')}<div><strong>Protected voting</strong><small>Election activity is recorded securely.</small></div></div>
      </nav>
      <section class="content" aria-label="Administration content">${content}</section>
    </div>
  </div>`;
  document.querySelector('#logoutBtn')?.addEventListener('click',doLogout);
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{
    if(b.dataset.tab!==state.adminTab){
      if(state.bulkBusy){toast('Wait for voter import to finish.',true);return}
      if(state.bulkCredentials.length&&!confirm('Print the issued credential vouchers before leaving this page. Leave and clear them from this tab?'))return;
    }
    state.adminTab=b.dataset.tab;renderAdmin();
  });
}

async function renderAdmin(){
  if(state.adminTab==='dashboard') return renderDashboard();
  if(state.adminTab==='elections') return renderElections();
  if(state.adminTab==='voters') return renderVoters();
  return renderReports();
}
async function renderDashboard(){
  adminShell(`<div class="page-head"><div><div class="page-kicker">ADMIN WORKSPACE</div><h1>Overview</h1><p>Everything you need to manage your HOA election.</p></div><button type="button" class="btn btn-primary" id="goElectionsTop">${uiIcon('elections')}Manage elections</button></div><div id="dashLoading" class="card" role="status">Loading dashboard…</div>`);
  document.querySelector('#goElectionsTop')?.addEventListener('click',()=>{state.adminTab='elections';renderAdmin()});
  try{
    const [o,e]=await Promise.all([api('/api/admin/overview'),api('/api/admin/elections')]);state.elections=e.elections;
    const holder=document.querySelector('#dashLoading');if(!holder)return;
    holder.outerHTML=`<section class="stats-grid" aria-label="Election statistics">
      <div class="card stat-card"><div class="stat-label">Registered voters</div><div class="stat-value">${o.voters}</div><div class="stat-foot">Active accounts</div></div>
      <div class="card stat-card"><div class="stat-label">All elections</div><div class="stat-value">${o.elections}</div><div class="stat-foot">Official and test</div></div>
      <div class="card stat-card"><div class="stat-label">Voting open now</div><div class="stat-value">${o.openElections}</div><div class="stat-foot">Accepting ballots</div></div>
      <div class="card stat-card"><div class="stat-label">Voters participated</div><div class="stat-value">${o.votersEverParticipated}</div><div class="stat-foot">Includes test elections</div></div>
    </section>
    <div class="dashboard-columns">
      <section class="card"><div class="section-title"><div><div class="page-kicker">QUICK START</div><h2>Three steps to a ready election</h2></div></div>
        <div class="quick-step"><span class="step-number">1</span><div><strong>Set up the election</strong><p>Choose Official or Test, set a deadline, and add candidates.</p></div><button class="btn btn-secondary btn-sm" data-goto="elections">Open ${uiIcon('arrow')}</button></div>
        <div class="quick-step"><span class="step-number">2</span><div><strong>Prepare voter accounts</strong><p>Register eligible homeowners and print private vouchers.</p></div><button class="btn btn-secondary btn-sm" data-goto="voters">Open ${uiIcon('arrow')}</button></div>
        <div class="quick-step"><span class="step-number">3</span><div><strong>Check reports</strong><p>After voting, review turnout and prepare ELECOM reports.</p></div><button class="btn btn-secondary btn-sm" data-goto="reports">Open ${uiIcon('arrow')}</button></div>
      </section>
      <section class="card"><div class="section-title"><div><div class="page-kicker">RECENT ACTIVITY</div><h2>Recent elections</h2></div><button type="button" class="btn btn-ghost btn-sm" data-goto="elections">View all</button></div>
        ${e.elections.length?e.elections.slice(0,5).map(x=>electionItem(x)).join(''):'<div class="empty"><strong>No elections yet</strong><p>Create a test election to try the voting process, or an official election when you are ready.</p></div>'}
      </section>
    </div>`;
    document.querySelectorAll('[data-goto]').forEach(b=>b.onclick=()=>{state.adminTab=b.dataset.goto;renderAdmin()});
  }catch(err){const holder=document.querySelector('#dashLoading');if(holder)holder.textContent='Could not load dashboard. Please try again.';toast(err.message,true)}
}

function electionItem(x){return `<div class="election-item"><div><h3>${esc(x.title)}</h3><p><span class="type-inline ${x.is_test?'type-test':'type-official'}">${x.is_test?'Test':'Official'}</span><span>${Number(x.position_count)||0} positions · ${Number(x.ballots)||0} ballots</span></p></div>${electionBadge(x)}</div>`}

async function renderElections(){
  adminShell(`<div class="page-head"><div><div class="page-kicker">SETUP & VOTING</div><h1>Elections</h1><p>Set the start date and time, add candidates, and voting opens automatically at the scheduled time.</p></div><button class="btn btn-primary" id="newElection">+ Create election</button></div>
    <div class="workflow-strip" aria-label="Election setup sequence"><span><b>1</b> Create election</span><span><b>2</b> Add candidates</span><span><b>3</b> Automatic start</span></div>
    <div id="electionArea" class="card">Loading elections…</div>`);
  document.querySelector('#newElection').onclick=openNewElection;
  try{
    const d=await api('/api/admin/elections');state.elections=d.elections;
    if(!d.elections.some(x=>Number(x.id)===Number(state.selectedElectionId)))state.selectedElectionId=d.elections[0]?.id||null;
    drawElectionList();
  }catch(err){const el=document.querySelector('#electionArea');if(el)el.textContent='Unable to load elections.';toast(err.message,true)}
}

function drawElectionList(){
  const el=document.querySelector('#electionArea');if(!el)return;
  if(!state.elections.length){el.innerHTML='<div class="empty empty-onboarding"><strong>No elections yet</strong><p>Create a Test election for practice or an Official election when you are ready.</p><button class="btn btn-primary" id="createFirstElection">+ Create election</button></div>';el.querySelector('#createFirstElection').onclick=openNewElection;return;}
  el.innerHTML=`<div class="election-workspace">
    <div class="election-picker"><div class="section-title"><h2>Your elections</h2><span class="count-pill">${state.elections.length}</span></div>
      <div class="election-list">${state.elections.map(x=>`<button type="button" class="election-select ${Number(state.selectedElectionId)===Number(x.id)?'active':''}" data-election="${Number(x.id)}" aria-current="${Number(state.selectedElectionId)===Number(x.id)?'true':'false'}"><span class="election-select-title">${esc(x.title)}</span><span class="election-select-meta"><span class="type-inline ${x.is_test?'type-test':'type-official'}">${x.is_test?'Test':'Official'}</span>${electionBadge(x)}</span></button>`).join('')}</div>
    </div><div id="electionDetail" class="election-detail" aria-live="polite">Select an election.</div>
  </div>`;
  el.querySelectorAll('[data-election]').forEach(b=>b.onclick=()=>{state.selectedElectionId=Number(b.dataset.election);drawElectionList();loadElectionDetail()});
  loadElectionDetail();
}

async function loadElectionDetail(){
  if(!state.selectedElectionId)return;
  const box=document.querySelector('#electionDetail');if(!box)return;box.innerHTML='<div class="loading-note" role="status">Loading election details…</div>';
  const requested=Number(state.selectedElectionId);
  try{
    const d=await api(`/api/admin/elections/${requested}`);if(Number(state.selectedElectionId)!==requested)return;
    const e=d.election;
    const readyToOpen=d.positions.length>0 && d.positions.every(p=>Array.isArray(p.candidates)&&p.candidates.length>0);
    box.innerHTML=`<div class="election-detail-head">
      <div><div class="page-kicker">ELECTION DETAILS</div><h2>${esc(e.title)}</h2><div class="detail-badges">${electionBadge(e)}<span class="election-type-label ${e.is_test?'test':'official'}">${e.is_test?'TEST / PRACTICE':'OFFICIAL'}</span></div></div>
      <div class="actions">${e.status==='draft'&&!e.voting_starts_at?`<button class="btn btn-primary btn-sm" id="openVote" ${readyToOpen?'':'disabled title="Add at least one candidate to each position before opening voting"'}>Open voting</button>`:''}${e.status==='open'?'<button class="btn btn-danger btn-sm" id="closeVote">Close voting</button>':''}</div>
    </div>
    ${e.description?`<p class="muted detail-description">${esc(e.description)}</p>`:''}
    <div class="election-schedule"><div class="section-title"><h3>Voting schedule</h3>${e.status==='draft'?'<button type="button" id="editElectionDeadline" class="btn btn-ghost btn-sm">Edit dates</button>':''}</div>
      <div class="schedule-values"><div><small>Automatic start (Philippine time)</small><strong>${esc(phDateTime(e.voting_starts_at))}</strong></div><div><small>Voting deadline · PHT</small><strong>${esc(phDateTime(e.voting_ends_at))}</strong></div></div>
      <p class="tiny muted">${e.voting_starts_at
        ? `Voting opens automatically on ${esc(phDateTime(e.voting_starts_at))}. You do not need to click Open voting.${e.status==='draft'&&!readyToOpen?' Add a candidate to EVERY position before the scheduled start; otherwise automatic opening is blocked.':''}`
        : 'No start time set: an administrator must open voting manually. Voting closes automatically at the deadline.'}</p>
    </div>
    <div class="election-detail-actions"><details class="disclosure compact-disclosure"><summary>${uiIcon('voters')} Election committee <span class="disclosure-sub">ELECOM report signatories</span></summary><div class="disclosure-body"><p class="tiny muted">Saved signatories appear on printed tally and final election reports.</p>${e.status==='open'?'<p class="tiny muted">Locked while voting is open.</p>':'<button class="btn btn-secondary btn-sm" id="manageElecom">Edit ELECOM members</button>'}</div></details>
      ${e.is_test&&e.status!=='open'?`<details class="disclosure compact-disclosure danger-disclosure"><summary>Delete TEST election <span class="disclosure-sub">Permanent removal of practice data</span></summary><div class="disclosure-body"><p class="tiny muted">Only for practice elections. Voter accounts and other elections are not deleted.</p><button class="btn btn-danger btn-sm" id="deleteElection">Delete TEST election</button></div></details>`:''}
    </div>
    <div class="section-title positions-title"><div><div class="page-kicker">BALLOT SETUP</div><h2>Positions & candidates</h2></div>${e.status==='draft'?'<button class="btn btn-secondary btn-sm" id="addPos">+ Add position</button>':''}</div>
    ${d.positions.length?d.positions.map(p=>positionCard(p,e.status)).join(''):'<div class="empty empty-inline"><strong>Start with a position</strong><p>Add a position such as President or Board Member, then add the candidates.</p></div>'}
    ${e.status==='draft'&&!readyToOpen?'<p class="tiny muted">Add at least one candidate to every position before voting can open.</p>':''}${e.status!=='draft'?'<p class="tiny muted">Candidate details are locked after voting opens.</p>':''}`;
    document.querySelector('#manageElecom')?.addEventListener('click',()=>openCommitteeEditor(e));
    document.querySelector('#editElectionDeadline')?.addEventListener('click',()=>openElectionDeadline(e));
    document.querySelector('#addPos')?.addEventListener('click',()=>openAddPosition(e.id));
    document.querySelector('#openVote')?.addEventListener('click',()=>changeStatus(e.id,'open'));
    document.querySelector('#closeVote')?.addEventListener('click',()=>changeStatus(e.id,'closed'));
    document.querySelector('#deleteElection')?.addEventListener('click',()=>openDeleteElection(e));
    document.querySelectorAll('[data-addcand]').forEach(b=>b.onclick=()=>openAddCandidate(Number(b.dataset.addcand)));
    document.querySelectorAll('[data-delpos]').forEach(b=>b.onclick=()=>removePosition(Number(b.dataset.delpos)));
    document.querySelectorAll('[data-delcand]').forEach(b=>b.onclick=()=>removeCandidate(Number(b.dataset.delcand)));
    document.querySelectorAll('[data-photocand]').forEach(b=>b.onclick=()=>openCandidatePhoto(Number(b.dataset.photocand)));
    document.querySelectorAll('[data-delphoto]').forEach(b=>b.onclick=()=>removeCandidatePhoto(Number(b.dataset.delphoto)));
  }catch(err){if(document.querySelector('#electionDetail')===box)box.innerHTML=`<div class="empty">${esc(err.message)}</div>`}
}

function positionCard(p,status){return `<div class="position-card"><div class="position-head"><div><h3>${esc(p.title)}</h3><div class="tiny muted">${p.seats} seat${p.seats!==1?'s':''} · voter may select up to ${p.seats}</div></div>${status==='draft'?`<div class="actions"><button class="btn btn-secondary btn-sm" data-addcand="${p.id}">+ Candidate</button><button class="btn btn-danger btn-sm" data-delpos="${p.id}">Delete</button></div>`:''}</div>${p.candidates.length?p.candidates.map(c=>`<div class="candidate-row"><div class="candidate-admin-main">${candidatePhoto(c,'candidate-photo-sm')}<div><strong>${esc(c.full_name)}</strong><small>${esc(c.statement||'No statement')}</small><small>${c.has_photo?'Photo uploaded':'Default profile photo'}</small></div></div>${status==='draft'?`<div class="actions candidate-actions"><button class="btn btn-secondary btn-sm" data-photocand="${c.id}">${c.has_photo?'Change photo':'Upload photo'}</button>${c.has_photo?`<button class="btn btn-ghost btn-sm" data-delphoto="${c.id}">Remove photo</button>`:''}<button class="btn btn-ghost btn-sm" data-delcand="${c.id}">Remove</button></div>`:''}</div>`).join(''):'<div class="empty" style="padding:18px">No candidates yet.</div>'}</div>`}
function electionDeadlineFields(startValue='',endValue=''){
  return `<div class="field"><label>Automatic voting start (Philippine time UTC+8)</label><input name="votingStartsInput" type="datetime-local" value="${esc(startValue)}"><small class="tiny muted">Set a start date and time to open voting automatically. Leave blank only if you prefer manual opening.</small></div><div class="field"><label>Voting deadline (required, Philippine time UTC+8)</label><input name="votingEndsInput" type="datetime-local" value="${esc(endValue)}" required><small class="tiny muted">Votes submitted at or after this moment are refused by the database, even after refresh or relogin.</small></div>`;
}
function validateDeadlineForm(f){
  const votingEndsAt=phLocalToIso(f.get('votingEndsInput'));
  const votingStartsAt=f.get('votingStartsInput')?phLocalToIso(f.get('votingStartsInput')):null;
  if(!votingEndsAt || Date.parse(votingEndsAt)<=Date.now())throw new Error('Enter a future voting deadline in Philippine time.');
  if(f.get('votingStartsInput')&&!votingStartsAt)throw new Error('Enter a valid earliest opening date.');
  if(votingStartsAt&&Date.parse(votingStartsAt)>=Date.parse(votingEndsAt))throw new Error('Deadline must be later than the earliest opening.');
  return {votingStartsAt,votingEndsAt};
}
async function openCommitteeEditor(e){
  let data;
  try{data=await api(`/api/admin/elections/${e.id}/committee`)}catch(err){toast(err.message,true);return}
  const roles=['Chairperson','Vice Chairperson','Secretary','Member','Canvasser'];
  const members=data.members?.length?data.members:[{role:'Chairperson',fullName:''}];
  modal(`<h2>Election Committee Signatories</h2><p class="muted">Edit names for the ${esc(e.title)} tally and final election report. No signatures are generated automatically.</p><form id="elecomForm"><div id="elecomRows"></div><div class="row" style="margin:14px 0"><button type="button" id="elecomAdd" class="btn btn-secondary btn-sm">+ Add signatory</button></div><button class="btn btn-primary btn-block" type="submit">Save Election Committee</button></form>`,()=>{
    const list=document.querySelector('#elecomRows');
    const add=(role='Member',name='')=>{
      if(list.children.length>=12){toast('Maximum of 12 committee members.',true);return}
      const row=document.createElement('div');row.className='row elecom-row';row.style='margin-bottom:9px';
      row.innerHTML=`<select class="elecom-role" aria-label="Committee role" style="padding:10px;border:1px solid var(--line);border-radius:10px">${roles.map(r=>`<option value="${esc(r)}" ${r===role?'selected':''}>${esc(r)}</option>`).join('')}</select><input class="elecom-name" aria-label="Committee member name" placeholder="Full name" maxlength="100" required style="flex:1;min-width:135px;padding:10px;border:1px solid var(--line);border-radius:10px" value="${esc(name)}"><button class="btn btn-ghost btn-sm" type="button" aria-label="Remove signatory">Remove</button>`;
      row.querySelector('button').onclick=()=>row.remove();list.appendChild(row);
    };
    members.forEach(x=>add(x.role,x.fullName));
    document.querySelector('#elecomAdd').onclick=()=>add();
    document.querySelector('#elecomForm').onsubmit=async ev=>{
      ev.preventDefault();const entries=Array.from(list.querySelectorAll('.elecom-row')).map(x=>({role:x.querySelector('.elecom-role').value,fullName:x.querySelector('.elecom-name').value.trim()}));
      if(entries.some(x=>x.fullName.length<2)){toast('Enter every committee member full name.',true);return}
      try{await api(`/api/admin/elections/${e.id}/committee`,{method:'PUT',body:JSON.stringify({members:entries})});closeModal();toast('Election Committee saved.');loadElectionDetail()}catch(err){toast(err.message,true)}
    };
  });
}
function openNewElection(){
  modal(`<div class="modal-kicker">NEW ELECTION</div><h2>Create an election</h2><p class="muted">Start with a name and closing date. You can add positions and candidates after saving.</p>
    <form id="newElectionForm"><div class="field"><label for="newElectionTitle">Election name</label><input id="newElectionTitle" name="title" required maxlength="120" placeholder="2026 HOA Board Election"></div>
      <div class="field"><label for="newElectionDescription">Description <span class="optional">Optional</span></label><textarea id="newElectionDescription" name="description" rows="2" maxlength="500" placeholder="A short explanation for residents"></textarea></div>
      <fieldset class="election-mode-option"><legend>Election type</legend><label><input type="checkbox" name="isTest" value="yes"> <span><strong>Use TEST / PRACTICE mode</strong><small>For training or mock voting. You can delete a Test election after closing it.</small></span></label><small>Unchecked = OFFICIAL election. Official elections cannot be deleted. The type cannot be changed later.</small></fieldset>
      <div class="form-section-label">Voting dates <span>Philippine time (PHT)</span></div>${electionDeadlineFields()}
      <button class="btn btn-primary btn-block" type="submit">Create draft election ${uiIcon('arrow')}</button>
    </form>`,()=>{
    document.querySelector('#newElectionForm').onsubmit=async ev=>{
      ev.preventDefault();const f=new FormData(ev.currentTarget);
      try{const data={title:f.get('title'),description:f.get('description'),isTest:f.has('isTest'),...validateDeadlineForm(f)};
        const d=await api('/api/admin/elections',{method:'POST',body:JSON.stringify(data)});
        closeModal();state.selectedElectionId=d.id;renderElections();toast('Draft election created. Next, add positions and candidates.');
      }catch(err){toast(err.message,true)}
    };
  });
}

function openElectionDeadline(e){
  if(e.status!=='draft')return toast('Voting dates are locked once an election has opened.',true);
  modal(`<h2>Edit voting deadline</h2><p class="muted">Philippine Standard Time (UTC+8). The deadline cannot be changed after opening voting.</p><form id="scheduleEditForm">${electionDeadlineFields(phIsoToInput(e.voting_starts_at),phIsoToInput(e.voting_ends_at))}<button class="btn btn-primary btn-block">Save schedule</button></form>`,()=>{
    document.querySelector('#scheduleEditForm').onsubmit=async ev=>{
      ev.preventDefault();try{
        await api(`/api/admin/elections/${e.id}/schedule`,{method:'PUT',body:JSON.stringify(validateDeadlineForm(new FormData(ev.currentTarget)))});
        closeModal();loadElectionDetail();toast('Voting schedule updated.');
      }catch(err){toast(err.message,true)}
    };
  });
}
function openAddPosition(eid){modal(`<h2>Add position</h2><form id="posForm"><div class="field"><label>Position name</label><input name="title" required placeholder="President"></div><div class="field"><label>Number of seats / winners</label><input name="seats" type="number" min="1" max="50" value="1" required><small class="muted">Example: President = 1; Board Member = 5.</small></div><button class="btn btn-primary btn-block">Add position</button></form>`,()=>{document.querySelector('#posForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api(`/api/admin/elections/${eid}/positions`,{method:'POST',body:JSON.stringify(Object.fromEntries(f))});closeModal();loadElectionDetail();}catch(err){toast(err.message,true)}}});}
function openAddCandidate(pid){modal(`<h2>Add candidate</h2><form id="candForm"><div class="field"><label>Candidate name</label><input name="fullName" required maxlength="100"></div><div class="field"><label>Candidate photo (optional)</label><input id="newCandidatePhoto" name="photo" type="file" accept="image/jpeg,image/png,image/webp"><small class="muted">JPEG, PNG, or WebP · maximum 5 MB. The photo will be shown on the voter ballot to help residents verify the candidate.</small></div><div id="newCandidatePhotoPreview" class="photo-upload-preview hidden"></div><div class="field"><label>Short statement (optional)</label><textarea name="statement" rows="3" maxlength="400"></textarea></div><button class="btn btn-primary btn-block">Add candidate</button></form>`,()=>{const input=document.querySelector('#newCandidatePhoto');input.onchange=()=>showPhotoPreview(input,document.querySelector('#newCandidatePhotoPreview'));document.querySelector('#candForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api(`/api/admin/positions/${pid}/candidates`,{method:'POST',body:f});closeModal();loadElectionDetail();}catch(err){toast(err.message,true)}}});}
function openCandidatePhoto(candidateId){modal(`<h2>Upload candidate photo</h2><p class="muted">This image will appear beside the candidate on the voter ballot.</p><form id="candidatePhotoForm"><div class="field"><label>Candidate photo</label><input id="candidatePhotoFile" name="photo" type="file" accept="image/jpeg,image/png,image/webp" required><small class="muted">JPEG, PNG, or WebP · maximum 5 MB.</small></div><div id="candidatePhotoPreview" class="photo-upload-preview hidden"></div><button class="btn btn-primary btn-block">Save photo</button></form>`,()=>{const input=document.querySelector('#candidatePhotoFile');input.onchange=()=>showPhotoPreview(input,document.querySelector('#candidatePhotoPreview'));document.querySelector('#candidatePhotoForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api(`/api/admin/candidates/${candidateId}/photo`,{method:'PUT',body:f});closeModal();toast('Candidate photo saved.');loadElectionDetail();}catch(err){toast(err.message,true)}}});}
function showPhotoPreview(input,box){const file=input.files?.[0];if(!file){box.classList.add('hidden');box.innerHTML='';return}const url=URL.createObjectURL(file);box.classList.remove('hidden');box.innerHTML=`<img src="${url}" alt="Selected candidate photo preview"><div><strong>${esc(file.name)}</strong><small>${Math.max(1,Math.round(file.size/1024))} KB</small></div>`;box.querySelector('img').onload=()=>URL.revokeObjectURL(url)}
async function removeCandidatePhoto(id){if(!confirm('Remove this candidate photo? The candidate will remain on the ballot.'))return;try{await api(`/api/admin/candidates/${id}/photo`,{method:'DELETE'});toast('Candidate photo removed.');loadElectionDetail()}catch(err){toast(err.message,true)}}
async function removePosition(id){if(!confirm('Delete this position and its candidates?'))return;try{await api(`/api/admin/positions/${id}`,{method:'DELETE'});loadElectionDetail()}catch(err){toast(err.message,true)}}
async function removeCandidate(id){if(!confirm('Remove this candidate?'))return;try{await api(`/api/admin/candidates/${id}`,{method:'DELETE'});loadElectionDetail()}catch(err){toast(err.message,true)}}
async function changeStatus(id,status){const q=status==='open'?'Open voting now? Positions and candidates will be locked.':'Close voting? No more ballots will be accepted and this cannot be reopened.';if(!confirm(q))return;try{await api(`/api/admin/elections/${id}/status`,{method:'PUT',body:JSON.stringify({status})});toast(`Election ${status}.`);renderElections()}catch(err){toast(err.message,true)}}
function openDeleteElection(election){
  if(!election.is_test)return toast('Official elections cannot be deleted.',true);
  if(election.status==='open')return toast('Close test voting before deleting the mock election.',true);
  const title=String(election.title||'');
  modal(`<h2>Delete TEST election and ALL test votes?</h2><div class="danger-note"><strong>This cannot be undone.</strong><p>This election was created as a <b>TEST / PRACTICE</b> election. Deletion permanently removes its test ballots, participation records, candidate selections, committee members and election setup. Registered homeowners, passwords and other elections stay unchanged.</p><p>OFFICIAL elections can never be deleted through this action.</p></div><p class="muted">Type the exact election title:</p><div class="confirm-title">${esc(title)}</div><div class="field"><label>Test election title</label><input id="deleteElectionTitle" autocomplete="off" spellcheck="false"></div><div class="field"><label>Type DELETE TEST to confirm permanent removal</label><input id="deleteElectionPhrase" autocomplete="off" spellcheck="false"></div><button class="btn btn-danger btn-block" id="confirmDeleteElection" disabled>Delete test election permanently</button>`,()=>{
    const input=document.querySelector('#deleteElectionTitle');
    const phrase=document.querySelector('#deleteElectionPhrase');
    const button=document.querySelector('#confirmDeleteElection');
    const validate=()=>{button.disabled=input.value!==title||phrase.value!=='DELETE TEST'};
    input.oninput=validate;phrase.oninput=validate;
    button.onclick=async()=>{
      if(input.value!==title||phrase.value!=='DELETE TEST')return;
      button.disabled=true;button.textContent='Deleting test…';
      try{
        await api(`/api/admin/elections/${election.id}`,{method:'DELETE',body:JSON.stringify({confirmTitle:title,confirmPhrase:'DELETE TEST'})});
        closeModal();state.selectedElectionId=null;toast('Test election and mock votes deleted; voter accounts were preserved.');renderElections();
      }catch(err){button.disabled=false;button.textContent='Delete test election permanently';toast(err.message,true)}
    };
    input.focus();
  });
}

async function renderVoters(){
  adminShell(`<div class="page-head"><div><div class="page-kicker">HOMEOWNER ACCOUNTS</div><h1>Voters & vouchers</h1><p>Manage eligible homeowners and their private login vouchers.</p></div><button class="btn btn-primary" id="addVoter">+ Register voter</button></div>
    <div id="bulkIssued" aria-live="polite"></div>
    <section class="card voucher-action-card no-print">
      <div class="section-title"><div><div class="page-kicker">PRINTING</div><h2>Login vouchers</h2><p class="muted tiny">Print from the encrypted archive without changing passwords.</p></div>${uiIcon('printer')}</div>
      <div class="voucher-actions"><button class="btn btn-primary" id="printAllVouchers">${uiIcon('printer')}Print all available vouchers</button><button class="btn btn-secondary" id="printSelectedVouchers">Print selected vouchers</button><button class="btn btn-ghost" id="printAllQrSlips">QR-only login slips</button></div>
      <p class="tiny muted">Complete vouchers include the stored original temporary password and QR. QR-only slips have no password.</p>
      <details class="disclosure advanced-disclosure"><summary>Credential recovery <span class="disclosure-sub">Only when original passwords are unavailable</span></summary><div class="disclosure-body"><p class="tiny muted">This issues NEW temporary passwords for eligible legacy accounts. Previous passwords stop working; an open election blocks the operation.</p><button class="btn btn-danger btn-sm" id="issueLegacyQrVouchers">Issue replacement credentials</button></div></details>
    </section>
    <section class="card directory-card"><div class="section-title"><div><div class="page-kicker">DIRECTORY</div><h2>Registered homeowners</h2></div><span id="voterSummary" class="count-pill" aria-live="polite">Loading…</span></div>
      <div class="directory-filters"><label class="filter-search">Search voters<input id="voterSearch" type="search" placeholder="Name, username, block or lot" autocomplete="off"></label><label>Voting status for<select id="voterElection"><option value="">All accounts</option></select></label></div>
      <div id="voterTable" aria-live="polite">Loading voters…</div>
    </section>
    <section class="card bulk-card no-print"><details id="bulkPanel" class="disclosure disclosure-large"><summary>${uiIcon('upload')} Import voters from CSV <span class="disclosure-sub">Optional · for registering many homeowners</span></summary>
      <div class="disclosure-body"><p class="muted tiny">Upload a CSV, review duplicates and eligibility, then create accounts in batches of 20.</p><button class="btn btn-secondary btn-sm" id="bulkTemplate">Download CSV template</button>
      <div class="field"><label for="bulkCsvFile">Choose CSV file</label><input id="bulkCsvFile" type="file" accept=".csv,text/csv"><small>Required columns: fullName, block, lot. Optional: approved, reviewNotes.</small></div>
      <div id="bulkPreview" aria-live="polite"></div></div>
    </details></section>`);
  document.querySelector('#addVoter').onclick=openAddVoter;
  document.querySelector('#bulkTemplate').onclick=()=>downloadCsv([['fullName','block','lot','approved','reviewNotes']],'hoa-voter-import-template.csv');
  document.querySelector('#bulkCsvFile').onchange=e=>{document.querySelector('#bulkPanel').open=true;readBulkCsv(e)};
  document.querySelector('#printSelectedVouchers').onclick=()=>reprintVoterSelection(false);
  document.querySelector('#printAllVouchers').onclick=()=>reprintVoterSelection(true);
  document.querySelector('#printAllQrSlips').onclick=printAllQrSlips;
  document.querySelector('#issueLegacyQrVouchers').onclick=openLegacyReissue;
  renderBulkIssued();
  try{
    const e=await api('/api/admin/elections');state.elections=e.elections;
    const electionSelect=document.querySelector('#voterElection');const searchInput=document.querySelector('#voterSearch');
    if(!electionSelect||!searchInput)return;
    electionSelect.innerHTML='<option value="">All accounts</option>'+e.elections.map(x=>`<option value="${x.id}">${x.is_test?'[TEST]':'[OFFICIAL]'} ${esc(x.title)}</option>`).join('');
    let timer;searchInput.oninput=()=>{clearTimeout(timer);timer=setTimeout(loadVoters,240)};
    electionSelect.onchange=loadVoters;
    await loadVoters();
  }catch(err){toast(err.message,true)}
}

async function loadVoters(){
  const requestId=++voterDirectoryRequest;
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
    if(!currentBox||requestId!==voterDirectoryRequest)return;
    const summary=document.querySelector('#voterSummary');if(summary)summary.textContent=`${d.voters.length} shown`;
    currentBox.innerHTML=d.voters.length?`<div class="table-wrap"><table class="table voter-table"><thead><tr><th><input id="selectAllVouchers" type="checkbox" aria-label="Select all printable vouchers"></th><th>Homeowner</th><th>Block / Lot</th><th>Username</th>${eid?'<th>Voted?</th>':''}<th>Account</th><th>Manage</th></tr></thead><tbody>${d.voters.map(v=>`<tr><td data-label="Select"><input type="checkbox" class="voucher-pick" value="${Number(v.id)}" ${v.voucherAvailable?'':'disabled'} aria-label="Select voucher for ${esc(v.full_name)}"></td><td data-label="Homeowner"><div class="table-name"><strong>${esc(v.full_name)}</strong><small class="${v.voucherAvailable?'voucher-ready':'muted'}">${v.voucherAvailable?'Voucher printable':'No original voucher in archive'}</small></div></td><td data-label="Property">Block ${esc(v.block||'—')} · Lot ${esc(v.lot||'—')}</td><td data-label="Username"><code>${esc(v.username)}</code></td>${eid?`<td data-label="Voted?"><span class="badge ${v.voted?'badge-voted':'badge-not'}">${v.voted?'Voted':'Not voted'}</span></td>`:''}<td data-label="Account"><span class="badge ${v.active?'badge-open':'badge-off'}">${v.active?'Active':'Disabled'}</span></td><td data-label="Actions"><details class="row-menu"><summary aria-label="Manage ${esc(v.full_name)}">Manage</summary><div class="row-menu-content"><button class="btn btn-ghost btn-sm" data-reset="${v.id}">Reset password</button><button class="btn btn-ghost btn-sm" data-toggle="${v.id}" data-active="${v.active?0:1}">${v.active?'Disable account':'Enable account'}</button><button class="btn btn-danger btn-sm" data-delete-voter="${v.id}">Delete account</button></div></details></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty"><strong>No matching homeowners</strong><p>Try a different name, username, or property number.</p></div>';
    currentBox.querySelector('#selectAllVouchers')?.addEventListener('change',e=>currentBox.querySelectorAll('.voucher-pick:not(:disabled)').forEach(x=>x.checked=e.target.checked));




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
function credentialView(v){return `<h2>Voter account created</h2><p class="muted">Print or deliver these credentials securely. Until this voter changes the temporary password, admins may reprint the SAME initial password from the encrypted voucher archive. Reprinting never resets credentials.</p><div class="credential" id="credentialCard"><strong>${esc(v.fullName)}</strong><div class="tiny muted">${v.block||v.lot?`Block ${esc(v.block||'—')} · Lot ${esc(v.lot||'—')}`:'Password reset'}</div><div class="credential-grid" style="margin-top:14px"><div><small>Username</small><div class="code">${esc(v.username)}</div></div><div><small>Password</small><div class="code">${esc(v.password)}</div></div></div></div><div class="actions" style="margin-top:14px"><button class="btn btn-primary" id="copyCred">Copy credentials</button><button class="btn btn-secondary" id="printCred">Print</button><button class="btn btn-ghost" id="doneCred">Done</button></div>`}
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
    const existingOwners=new Set(existing.voters.map(x=>String(x.full_name||'').trim().replace(/\s+/g,' ').toLowerCase()));
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
      if(units.has(k))r.errors.push('Block/Lot already registered');
      if(existingOwners.has(r.fullName.toLowerCase().replace(/\s+/g,' ')))r.errors.push('Homeowner already has a voter account');
      if(nameCounts.get(r.fullName.toLowerCase().replace(/\s+/g,' '))>1)r.errors.push('Duplicate homeowner in CSV: one account allowed');
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
  box.innerHTML=`<div class="bulk-summary"><strong>${rows.length} CSV rows</strong><span>${selected} selected</span><span>${hard} blocked</span><span>${warnings} need review</span></div><div class="actions" style="margin:12px 0"><button id="bulkSelectClear" class="btn btn-secondary btn-sm" ${state.bulkBusy?'disabled':''}>Select all clear rows</button><button id="bulkClearSelection" class="btn btn-ghost btn-sm" ${state.bulkBusy?'disabled':''}>Unselect all</button></div><div class="bulk-table-wrap"><table class="table"><thead><tr><th>Import</th><th>CSV line</th><th>Homeowner</th><th>Block</th><th>Lot</th><th>Review</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td><input type="checkbox" class="bulk-include" data-bulk-index="${i}" ${r.selected?'checked':''} ${r.errors.length||r.imported||state.bulkBusy?'disabled':''} aria-label="Import ${esc(r.fullName)}"></td><td>${r.line}</td><td>${esc(r.fullName)}</td><td>${esc(r.block)}</td><td>${esc(r.lot)}</td><td>${r.imported?'<span class="badge badge-voted">Created</span>':r.errors.length?`<span class="bulk-error">${esc(r.errors.join('; '))}</span>`:r.warnings.length?`<span class="bulk-warning">${esc(r.warnings.join('; '))}</span>`:'Clear'}</td></tr>`).join('')}</tbody></table></div><label class="bulk-confirm"><input id="bulkEligibility" type="checkbox" ${state.bulkAcknowledged?'checked':''} ${state.bulkBusy?'disabled':''}><span>I confirm that each selected homeowner is eligible for exactly one voting account, even if they own several Block/Lot units, and that the flagged entries have been resolved.</span></label><div class="actions"><button id="bulkImportNow" class="btn btn-primary" ${!selected||!state.bulkAcknowledged||state.bulkBusy?'disabled':''}>Generate ${selected} account${selected===1?'':'s'} + vouchers</button><span id="bulkProgress" class="tiny muted"></span></div><p class="tiny muted">Do not import a second account for a homeowner or unit that already exists. Passwords are displayed only once; print the vouchers before refreshing or closing the page.</p>`;
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
  box.innerHTML=`<div class="bulk-issued"><div><strong>${state.bulkCredentials.length} credential${state.bulkCredentials.length===1?'':'s'} issued</strong><p class="tiny">For immediate printing these credentials remain in this browser tab. Their encrypted original vouchers can later be reprinted unchanged until the voter changes the initial password. No password reset is required for reprinting.</p></div><div class="actions"><button class="btn btn-primary" id="bulkPrint">Print ${state.bulkCredentials.length} vouchers on A4</button><button class="btn btn-ghost btn-sm" id="bulkDiscard">Clear passwords</button></div></div>`;
  box.querySelector('#bulkPrint').onclick=()=>printVoucherSheet(state.bulkCredentials);
  box.querySelector('#bulkDiscard').onclick=()=>{if(!confirm('Clear one-time plaintext passwords from this tab? Archived initial vouchers remain reprintable without changing passwords until voters change their own passwords.'))return;state.bulkCredentials=[];renderBulkIssued()};
}
const PUBLIC_VOTING_ADDRESS = 'https://hoa-voting.casa-verde-de-banaderos.workers.dev/';
function printVoucherSheet(voters, existingWindow=null, qrOnly=false){
  if (!qrOnly && voters.some(v => typeof v.password !== "string" || !v.password)) return toast("A credential voucher needs a valid temporary password. Print QR-only slips instead.",true);
  if(!voters?.length)return toast('No printable original vouchers are available.',true);
  const w=existingWindow || window.open('','_blank','width=980,height=820');
  if(!w)return toast('Allow popups to print vouchers.',true);
  w.opener=null;
  const portal=PUBLIC_VOTING_ADDRESS;
  const qr=location.origin+'/voting-qr.png';
  const sheets=[];
  for(let i=0;i<voters.length;i+=8){
    const cards=voters.slice(i,i+8).map((v,j)=>`<article class="voucher"><header><b>CASA VERDE DE BAÑADEROS HOA</b><small>${qrOnly?'QR LOGIN SLIP • NO PASSWORD INCLUDED':'OFFICIAL ELECTION LOGIN VOUCHER • PRIVATE'}</small></header><h2>${esc(v.fullName)}</h2><div class="lot">Block ${esc(v.block||'-')} | Lot ${esc(v.lot||'-')}</div><div class="loginrow"><div class="cred"><label>USERNAME</label><div>${esc(v.username)}</div><label>${qrOnly?'PASSWORD':'INITIAL PASSWORD'}</label><div class="${qrOnly?'no-password':''}">${qrOnly?'Use your existing password':esc(v.password)}</div></div><img alt="Scan to open HOA voting website" class="qr" src="${esc(qr)}"></div><footer><div><strong>${esc(portal)}</strong></div><span>${qrOnly?'Scan QR to open the voting site; it does not sign you in. If you do not know your password, contact the HOA administrator for a separately authorized replacement.':'Scan QR to open voting site. Change your initial password at first login. Never share this voucher. One account = one vote per election.'}</span></footer><small class="num">Voucher ${i+j+1} of ${voters.length}</small></article>`).join('');
    sheets.push(`<section class="sheet">${cards}</section>`);
  }
  w.document.write(`<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>${qrOnly?'HOA A4 QR Login Slips':'HOA A4 Voter Vouchers'}</title><style>@page{size:A4 portrait;margin:9mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#182c2b}.sheet{width:192mm;height:279mm;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(4,minmax(0,1fr));gap:2mm;break-after:page;page-break-after:always}.sheet:last-child{break-after:auto;page-break-after:auto}.voucher{position:relative;border:1px dashed #7c9190;border-radius:2mm;padding:3.2mm;display:flex;flex-direction:column;overflow:hidden;break-inside:avoid;page-break-inside:avoid}.voucher header{border-bottom:1px solid #bbd0ce;padding-bottom:1.5mm}.voucher header b{font-size:7.7pt;letter-spacing:.15px}.voucher header small{display:block;font-size:6pt;color:#486661;margin-top:1mm}.voucher h2{font-size:11pt;margin:2.2mm 0 1mm;line-height:1.12;overflow-wrap:anywhere}.lot{font-size:7.5pt;color:#42545a}.loginrow{display:flex;align-items:center;gap:1.5mm;margin:2mm 0}.cred{flex:1;min-width:0;display:grid;gap:0.5mm}.cred label{font-size:6.4pt;color:#4a6362;font-weight:700}.cred div{font-family:Consolas,monospace;font-weight:800;font-size:11pt;letter-spacing:.15px;overflow-wrap:anywhere}.cred div.no-password{font-family:Arial,sans-serif;font-weight:500;font-size:8pt}.qr{width:20mm;height:20mm;object-fit:contain;flex:none}.voucher footer{margin-top:auto;font-size:6.3pt;display:grid;gap:.8mm}.voucher footer strong{overflow-wrap:anywhere;font-size:6.2pt}.voucher footer span{color:#526967;line-height:1.16}.num{display:block;text-align:right;margin-top:1mm;color:#667b7c;font-size:6pt}@media screen{body{background:#e8eeee;padding:10px}.sheet{background:white;margin:0 auto 12px;box-shadow:0 5px 20px #888}}@media print{body{padding:0}.sheet{box-shadow:none}}</style></head><body>${sheets.join('')}</body></html>`);
  w.document.close();
  // Wait briefly for the QR image to load; never print a missing/remote QR.
  const images=Array.from(w.document.images||[]);
  Promise.all(images.map(im=>im.complete?Promise.resolve(im.naturalWidth>0):new Promise(done=>{im.onload=()=>done(true);im.onerror=()=>done(false)})))
    .then(loaded=>{
      if(!loaded.every(Boolean)){
        alert('The QR image did not load. Check that /voting-qr.png is deployed, then try printing again.');
        return;
      }
      try{w.focus?.();w.print?.()}catch{}
    });
}
async function printAllQrSlips(){
  // Open on the actual click, before fetching, to avoid popup blockers.
  const w=window.open('','_blank','width=980,height=820');
  if(!w)return toast('Please allow popups to print QR slips.',true);
  try{
    const d=await api('/api/admin/vouchers/qr-slips',{method:'POST',body:'{}'});
    if(!d.voters?.length){w.close();return toast('No active voter accounts were found.',true)}
    printVoucherSheet(d.voters,w,true);
    toast(`Printing QR slips for ${d.voters.length} active voters. No passwords changed.`);
  }catch(err){w.close();toast(err.message,true)}
}

async function openLegacyReissue(){
  if(state.bulkBusy){toast('Another credential operation is still running.',true);return}
  if(state.bulkCredentials.length){
    alert('Please print and clear the credentials already issued in this tab before starting another operation.');
    return;
  }
  let eligible=[];
  try{
    const d=await api('/api/admin/voters');
    eligible=(d.voters||[]).filter(v=>v.active && v.must_change_password && !v.voucherAvailable);
  }catch(err){toast(err.message,true);return}
  if(!eligible.length)return toast('No eligible legacy accounts need fresh initial vouchers. Use Reprint Available or Print ALL QR Slips.');
  modal(`<h2>Issue replacement QR credential vouchers</h2><div class="danger-note"><strong>This is NOT a reprint.</strong><p>You are about to replace the existing passwords of <strong>${eligible.length}</strong> legacy voter accounts with NEW random temporary passwords.</p><p>Old credentials and active sessions will stop working. Existing usernames, registered properties and voting records will remain unchanged. Voters who have changed their personal password are excluded.</p><p>Do not proceed during an election or unless you can securely distribute the replacement vouchers.</p></div><div class="field"><label>Your administrator password</label><input id="reissueAdminPassword" type="password" autocomplete="current-password" maxlength="256" required></div><div class="field"><label>Type REISSUE to confirm the password changes</label><input id="reissueConfirm" autocomplete="off" spellcheck="false" required></div><div id="reissueProgress" class="tiny muted">${eligible.length} eligible legacy accounts · 20 per transaction</div><button class="btn btn-danger btn-block" id="confirmLegacyReissue">Issue NEW passwords and A4 QR vouchers</button>`,()=>{
    enhancePasswordToggles(document.querySelector('#modalBackdrop'));
    const button=document.querySelector('#confirmLegacyReissue');
    button.onclick=async()=>{
      const adminPassword=document.querySelector('#reissueAdminPassword').value;
      const confirmation=document.querySelector('#reissueConfirm').value;
      if(!adminPassword || confirmation!=='REISSUE')return toast('Enter your admin password and type REISSUE exactly.',true);
      if(!confirm(`Replace the passwords of ${eligible.length} legacy voters? Previous passwords will stop working. This cannot be undone.`))return;
      button.disabled=true;
      const progress=document.querySelector('#reissueProgress');
      // Open now; password-issuing requests can take multiple seconds.
      const popup=window.open('','_blank','width=980,height=820');
      state.bulkBusy=true;
      let issued=0;
      try{
        for(let i=0;i<eligible.length;i+=20){
          const ids=eligible.slice(i,i+20).map(v=>Number(v.id));
          progress.textContent=`Issuing replacements: ${issued} of ${eligible.length} completed…`;
          const d=await api('/api/admin/vouchers/reissue-legacy',{method:'POST',body:JSON.stringify({voterIds:ids,adminPassword,confirm:'REISSUE'})});
          state.bulkCredentials.push(...d.voters);
          issued+=d.voters.length;
        }
        document.querySelector('#reissueAdminPassword').value='';
        closeModal();
        renderBulkIssued();
        if(popup)printVoucherSheet(state.bulkCredentials,popup);
        else alert('Popups are blocked. Use the Print A4 vouchers button under Bulk Registration; the issued credentials are still in this tab.');
        toast(`${issued} new QR credential vouchers ready to print.`);
        await loadVoters();
      }catch(err){
        popup?.close();
        progress.textContent=`Stopped: ${issued} account(s) were successfully reissued. Print them from the issued vouchers panel.`;
        alert(`Credential reissue stopped after ${issued} successful account(s). Do not retry blindly: completed credentials are saved in this tab and encrypted in Supabase for unchanged reprint. Print the successful vouchers, refresh the voter list, and resolve the error.\n\n${err.message}`);
        renderBulkIssued();
        await loadVoters();
      }finally{state.bulkBusy=false;button.disabled=false}
    };
  });
}

async function reprintVoterSelection(all){
  const ids=Array.from(document.querySelectorAll('#voterTable .voucher-pick:checked:not(:disabled)'))
    .map(x=>Number(x.value));
  if(!all&&!ids.length){toast('Select one or more reprintable voters first.',true);return}
  modal(`<h2>Reprint existing vouchers</h2><p class="muted">${all?'Print all available original vouchers':'Print '+ids.length+' selected original voucher(s)'}. This is PRINT ONLY. No username, password, session, or vote is changed.</p><div class="field"><label>Confirm your administrator password</label><input id="reprintAdminPassword" type="password" autocomplete="current-password" required></div><p class="tiny muted">Voters who already changed their initial password cannot have their personal password printed. Accounts created before the archive was enabled also cannot be recovered.</p><button id="confirmVoucherReprint" class="btn btn-primary btn-block">Print unchanged vouchers</button>`,()=>{
    enhancePasswordToggles(document.querySelector('#modalBackdrop'));
    document.querySelector('#confirmVoucherReprint').onclick=async()=>{
      const password=document.querySelector('#reprintAdminPassword').value;
      if(!password){toast('Enter your administrator password.',true);return}
      const button=document.querySelector('#confirmVoucherReprint');button.disabled=true;button.textContent='Retrieving encrypted archive…';
      // Popup must be opened inside a direct click to avoid popup blockers.
      const w=window.open('','_blank','width=980,height=820');
      try{
        const d=await api('/api/admin/vouchers/reprint',{method:'POST',body:JSON.stringify({all,voterIds:ids,adminPassword:password})});
        document.querySelector('#reprintAdminPassword').value='';
        if(!d.voters?.length){w?.close();closeModal();toast('No original temporary vouchers are reprintable. No passwords were changed.',true);return}
        closeModal();
        printVoucherSheet(d.voters,w);
        if(d.skipped?.length)alert(`${d.skipped.length} voter(s) skipped: password was changed, account disabled, or original voucher unavailable. No passwords were changed.`);
      }catch(err){w?.close();button.disabled=false;button.textContent='Print unchanged vouchers';toast(err.message,true)}
    };
  });
}

function printCredential(v){printVoucherSheet([v]);}

async function renderReports(){
  adminShell(`<div class="page-head"><div><div class="page-kicker">ELECTION RECORDS</div><h1>Reports</h1><p>Review turnout, participation, and final election results.</p></div><button class="btn btn-primary" id="printDhsudFinal">${uiIcon('printer')}Print final ELECOM report</button></div>
    <section class="card report-controls no-print"><div class="report-toolbar"><label for="reportElection">Election<select id="reportElection"></select></label><div class="report-tabs" role="group" aria-label="Report view"><button class="${state.reportType==='results'?'active':''}" data-report="results" aria-pressed="${state.reportType==='results'}">Results</button><button class="${state.reportType==='participation'?'active':''}" data-report="participation" aria-pressed="${state.reportType==='participation'}">Participation</button></div></div>
      <div class="report-availability tiny muted" id="reportAvailability" aria-live="polite"></div><details class="disclosure report-extra"><summary>Other print and export options <span class="disclosure-sub">CSV, tally sheet and current view</span></summary><div class="disclosure-body actions"><button class="btn btn-secondary btn-sm" id="printDhsudTally">Print ELECOM tally sheet (A4)</button><button class="btn btn-ghost btn-sm" id="exportCsv">Export CSV</button><button class="btn btn-ghost btn-sm" id="printA4">Print current view</button></div></details>
    </section><div id="reportArea" class="card report-content">Loading report…</div>`);
  document.querySelector('#printA4').onclick=()=>window.print();
  document.querySelector('#printDhsudTally').onclick=()=>printDhsudExport('tally');
  document.querySelector('#printDhsudFinal').onclick=()=>printDhsudExport('final');
  document.querySelector('#exportCsv').onclick=exportCurrentCsv;
  try{
    const e=await api('/api/admin/elections');state.elections=e.elections;
    if(!e.elections.some(x=>Number(x.id)===Number(state.selectedElectionId)))state.selectedElectionId=e.elections[0]?.id||null;
    const sel=document.querySelector('#reportElection');if(!sel)return;
    sel.innerHTML=e.elections.map(x=>`<option value="${x.id}" ${Number(x.id)===Number(state.selectedElectionId)?'selected':''}>${x.is_test?'[TEST]':'[OFFICIAL]'} ${esc(x.title)}</option>`).join('')||'<option value="">No elections</option>';
    const syncExports=()=>{
      const selected=e.elections.find(x=>Number(x.id)===Number(state.selectedElectionId));
      const closed=selected?.status==='closed';
      ['printDhsudFinal','printDhsudTally'].forEach(id=>{const button=document.getElementById(id);if(button){button.disabled=!closed;button.title=closed?'Print the approved report worksheet':'Available after the election is closed';}});
      const msg=document.querySelector('#reportAvailability');if(msg)msg.textContent=closed?'This election is closed. Final ELECOM worksheets are available.':'Final ELECOM worksheets can be printed once the election is closed.';
    };
    sel.onchange=()=>{state.selectedElectionId=Number(sel.value);syncExports();loadReport()};
    syncExports();
    document.querySelectorAll('[data-report]').forEach(b=>b.onclick=()=>{state.reportType=b.dataset.report;renderReports()});
    loadReport();
  }catch(err){toast(err.message,true)}
}

async function loadReport(){if(!state.selectedElectionId){document.querySelector('#reportArea').innerHTML='<div class="empty">No election selected.</div>';return}try{if(state.reportType==='results')drawResults(await api(`/api/admin/elections/${state.selectedElectionId}/results`));else drawParticipation(await api(`/api/admin/elections/${state.selectedElectionId}/participation`));}catch(err){toast(err.message,true)}}
// Data and winner/tie logic come exclusively from a closed election backend
// response. These are DHSUD-aligned ELECOM worksheets, not government-issued forms.
async function printDhsudExport(kind){
  if(!state.selectedElectionId)return toast('Choose a closed election first.',true);
  // Open popup within the click event to avoid blocking.
  const popup=window.open('','_blank','width=1060,height=860');
  if(!popup)return toast('Please allow print popups.',true);
  popup.opener=null;
  try{
    const d=await api(`/api/admin/elections/${state.selectedElectionId}/dhsud-final`);
    const rows=d.positions.map(p=>`<section class="position"><h2>${esc(p.title)} · ${p.seats} seat(s)</h2><table><thead><tr><th>Rank</th><th>Candidate</th><th>Valid votes</th><th>Tabulation</th></tr></thead><tbody>${p.rows.map(v=>`<tr><td>${v.rank}</td><td>${esc(v.candidateName)}</td><td>${v.votes}</td><td>${esc(v.result)}</td></tr>`).join('')}</tbody></table>${p.cutoffTie?'<p class="warning">A tie affects seat allocation. ELECOM must document its decision under applicable bylaws and election rules.</p>':''}</section>`).join('');
    const committee=d.committeeMembers?.length?d.committeeMembers.map(x=>`<div class="signature"><div class="line"></div><strong>${esc(x.fullName)}</strong><div>${esc(x.role)} · ELECOM</div></div>`).join(''):`<div class="signature"><div class="line"></div><strong>________________________</strong><div>ELECOM Chairperson</div></div><div class="signature"><div class="line"></div><strong>________________________</strong><div>ELECOM Member / Secretary</div></div>`;
    const title=(d.election.isTest?'MOCK / PRACTICE - ':'')+(kind==='tally'?'ELECTION TALLY SHEET':'FINAL ELECTION REPORT');
    const disclaimer='System-generated DHSUD-aligned ELECOM worksheet, not a government-issued or certified form. Review, print, sign, and notarize supporting documents where applicable.';
    const verification=d.voteRecordIntegrityOk?'<p class="note">Selection integrity: verified against anonymous ballot commitments. Election committee review is still required.</p>':`<p class="warning">STOP - NOT VERIFIED (${esc(d.integrityStatus||'unknown')}). Anonymous ballot selection counts may be missing, mismatched or unverifiable. Do not certify or proclaim results before reconciliation.${d.integrityDetails?` Expected selections: ${d.integrityDetails.expectedSelections}; recorded: ${d.integrityDetails.actualSelections}; mismatched ballots: ${d.integrityDetails.mismatchedBallots}; legacy unverified: ${d.integrityDetails.legacyBallots}.`:''}</p>`;
    const body=`<header><img src="${esc(location.origin+'/hoa-logo.png')}" alt="Association logo"><div><b>${esc(d.associationName)}</b><h1>${title}</h1><p>Election: ${esc(d.election.title)} · Election ID ${d.election.id}</p></div></header><p class="disclaimer">${disclaimer}</p>${d.election.isTest?'<p class="warning">TEST ONLY - Practice data. Not an official election result and NOT FOR FILING, CERTIFICATION OR PROCLAMATION.</p>':''}<table class="stats"><tbody><tr><th>Qualified voters (ELECOM to verify against certified roll)</th><td>${d.eligibleVoters}</td><th>Ballots cast</th><td>${d.ballotsCast}</td></tr><tr><th>Turnout</th><td>${d.turnoutPercentage}%</td><th>Anonymous ballots recorded</th><td>${d.anonymousBallots}</td></tr><tr><th>Poll opening</th><td>${esc(phDateTime(d.election.openedAt))}</td><th>Voting deadline</th><td>${esc(phDateTime(d.election.votingEndsAt))}</td></tr><tr><th>Poll closure</th><td>${esc(phDateTime(d.election.closedAt))}</td><th>Issued ballots / spoiled ballots</th><td>ELECOM to complete</td></tr></tbody></table><p class="note">Voter-count basis: ${esc(d.eligibleCountBasis)}</p>${verification}<h2>${kind==='tally'?'Candidate vote tally':'Election canvass and results'}</h2>${rows}<section class="extra"><h2>${kind==='final'?'ELECOM declarations and supporting records':'Canvass verification'}</h2><p>Protests / incidents / unresolved ties: ________________________________________________</p><p>Quorum basis / relevant bylaw provision: _____________________________________________</p>${kind==='final'?'<p>Attachments for Section 101 filing: notice of election and posting/service proofs; certified qualified-voter list; attendance/participation records; signed election minutes; certified tally/returns; other required records and information sheet.</p>':''}<p>Certification date: ____________________ &nbsp;&nbsp; Place: ____________________</p></section><h2>Election Committee – signatures</h2><div class="signatures">${committee}</div><footer>Prepared by the Election Committee for review and signature. Exported ${esc(phDateTime(d.exportGeneratedAt))}. Reference: 2024 Revised IRR of RA 9904, §101. Filing obligations remain with the ELECOM.</footer>`;
    popup.document.write(`<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>${title} - ${esc(d.election.title)}</title><style>@page{size:A4;margin:15mm 13mm}*{box-sizing:border-box}body{font:10pt Arial,sans-serif;color:#172b2e;margin:0}header{display:flex;align-items:center;gap:12px;border-bottom:3px solid #0f766e;padding-bottom:12px;margin-bottom:12px}header img{height:56px;width:56px;object-fit:contain}header b{font-size:9pt}h1{font-size:17pt;margin:2px 0}h2{font-size:11pt;margin:18px 0 8px}.disclaimer{font-size:8pt;color:#465b5e;line-height:1.4}.note{font-size:8pt;color:#52666a}table{border-collapse:collapse;width:100%;margin:10px 0;table-layout:fixed}th,td{border:1px solid #9aadae;padding:7px 8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#e8f2f0}.stats th{width:33%}.stats td{width:17%;font-weight:700}.position{break-inside:avoid;page-break-inside:avoid}.position table th:first-child{width:12%}.position table th:nth-child(3){width:19%}.position table th:last-child{width:33%}.warning{padding:9px;background:#fff1ed;border:1px solid #b54708;font-weight:700}.extra{page-break-inside:avoid}.extra p{line-height:1.55}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:24px;break-inside:avoid}.signature{text-align:center;padding:24px 10px 5px;font-size:8.5pt}.signature .line{height:1px;background:#394e50;width:85%;margin:4px auto 9px}.signature strong{display:block;font-size:9pt;margin:4px}footer{margin-top:25px;border-top:1px solid #b4c8c6;padding-top:10px;font-size:8pt;color:#667b7c}@media screen{body{max-width:210mm;margin:20px auto;background:#fff;box-shadow:0 0 20px #ddd;padding:15mm}}</style></head><body>${body}</body></html>`);
    popup.document.close();
    const images=Array.from(popup.document.images||[]);
    Promise.all(images.map(im=>im.complete?Promise.resolve():new Promise(done=>{im.onload=done;im.onerror=done}))).then(()=>{popup.focus();popup.print()});
  }catch(err){popup.close();toast(err.message,true)}
}
function reportHead(title,status,isTest=false){return `<div class="report-header"><h1>${esc(title)} ${isTest?'[TEST / PRACTICE]':'[OFFICIAL]'}</h1><p>HOA Election Report · Status: ${esc(status)} · ${isTest?'PRACTICE DATA - NOT FOR CERTIFICATION':'Official election records'} · Generated ${esc(new Date().toLocaleString())}</p></div>`}
function drawResults(d){const box=document.querySelector('#reportArea');box.dataset.csv=JSON.stringify({type:'results',data:d});const integrityNote=d.voteRecordIntegrityOk?'<div class="tiny muted">Anonymous ballot selection counts verified. ELECOM review is still required.</div>':`<div class="danger-note"><strong>NOT VERIFIED (${esc(d.integrityStatus||'unknown')})</strong> - ballot records or candidate selections may be incomplete, or historical records lack verification metadata. Do not certify results until reconciled.</div>`;box.innerHTML=`${reportHead(d.election.title,d.election.status,d.election.is_test||d.election.isTest)}${integrityNote}<div class="section-title"><div><h2>${esc(d.election.title)}</h2><span class="badge badge-${d.election.status}">${d.election.status}</span></div></div><div class="grid grid-4" style="margin-bottom:22px"><div><div class="stat-label">Eligible voters</div><div class="stat-value">${d.eligibleVoters}</div></div><div><div class="stat-label">Ballots cast</div><div class="stat-value">${d.ballotsCast}</div></div><div><div class="stat-label">Turnout</div><div class="stat-value">${d.turnoutPercentage}%</div></div><div><div class="stat-label">Positions</div><div class="stat-value">${d.positions.length}</div></div></div>${d.positions.map(p=>`<section class="result-position"><div class="section-title"><div><h2>${esc(p.title)}</h2><div class="tiny muted">${p.seats} seat${p.seats!==1?'s':''} · ${p.totalVotes} selection${p.totalVotes!==1?'s':''}</div></div></div>${p.candidates.length?p.candidates.map((c,i)=>`<div class="result-row"><div><strong>${esc(c.full_name)}</strong></div><div class="bar"><i style="width:${Math.min(100,c.voterSupportPercentage)}%"></i></div><div class="result-count">${c.votes}</div><div class="result-pct" title="Support among voters who cast a ballot; share of all selections: ${c.percentage}%">${c.voterSupportPercentage}% voters</div></div>`).join(''):'<div class="empty">No candidates.</div>'}</section>`).join('')}`;}
function drawParticipation(d){const box=document.querySelector('#reportArea');box.dataset.csv=JSON.stringify({type:'participation',data:d});box.innerHTML=`${reportHead(d.election.title,d.election.status,d.election.is_test||d.election.isTest)}<div class="section-title"><div><h2>Voter Participation</h2><div class="tiny muted">${esc(d.election.title)}</div></div></div><div class="grid grid-4" style="margin-bottom:18px"><div><div class="stat-label">Registered</div><div class="stat-value">${d.voters.length}</div></div><div><div class="stat-label">Voted</div><div class="stat-value">${d.votedCount}</div></div><div><div class="stat-label">Not voted</div><div class="stat-value">${d.notVotedCount}</div></div><div><div class="stat-label">Status</div><div style="margin-top:10px"><span class="badge badge-${d.election.status}">${d.election.status}</span></div></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Block</th><th>Lot</th><th>Username</th><th>Status</th><th>Voted at</th></tr></thead><tbody>${d.voters.map(v=>`<tr><td>${esc(v.full_name)}</td><td>${esc(v.block||'—')}</td><td>${esc(v.lot||'—')}</td><td>${esc(v.username)}</td><td><span class="badge ${v.voted?'badge-voted':'badge-not'}">${v.voted?'Voted':'Not Voted'}</span></td><td>${v.voted?esc(fmt(v.voted_at)):'—'}</td></tr>`).join('')}</tbody></table></div><p class="tiny muted" style="margin-top:12px">Participation records show whether a resident voted. They do not reveal the resident’s ballot choices.</p>`;}
function exportCurrentCsv(){const box=document.querySelector('#reportArea');if(!box?.dataset.csv)return;const x=JSON.parse(box.dataset.csv);let rows=[];if(x.type==='results'){rows.push(['Election',x.data.election.title],['Status',x.data.election.status],['Eligible Voters',x.data.eligibleVoters],['Ballots Cast',x.data.ballotsCast],['Turnout',`${x.data.turnoutPercentage}%`],['Selection integrity',x.data.integrityStatus||'unverified'],[]);for(const p of x.data.positions){rows.push([p.title,`Seats: ${p.seats}`],['Candidate','Votes','Support among voters','Share of selections']);for(const c of p.candidates)rows.push([c.full_name,c.votes,`${c.voterSupportPercentage}%`,`${c.percentage}%`]);rows.push([])}}else{rows.push(['Election',x.data.election.title],['Name','Block','Lot','Username','Status','Voted At']);for(const v of x.data.voters)rows.push([v.full_name,v.block,v.lot,v.username,v.voted?'Voted':'Not Voted',v.voted_at||''])}downloadCsv(rows,`${slug(x.data.election.title)}-${x.type}.csv`)}
function downloadCsv(rows,name){const csv=rows.map(r=>r.map(v=>{let x=String(v??''); if(/^[\s]*[=+@-]/.test(x))x="'"+x;return `"${x.replaceAll('\"','\"\"')}"`}).join(',')).join('\r\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}function slug(s){return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'hoa-election'}

async function renderVoter(){
  app.innerHTML=`<div class="ballot-shell"><header class="topbar">${brandLogo('Secure election portal')}<div class="user-chip"><div class="avatar">${esc(state.user.fullName?.[0]||'V')}</div><div class="user-meta"><strong>${esc(state.user.fullName)}</strong><small>Block ${esc(state.user.block||'—')} · Lot ${esc(state.user.lot||'—')}</small></div><button class="btn btn-ghost btn-sm" id="logoutBtn">Logout</button></div></header><div id="ballotArea"><div class="card">Loading election…</div></div></div>`;document.querySelector('#logoutBtn').onclick=doLogout;
  try{const d=await api('/api/voter/ballot');drawBallot(d)}catch(err){toast(err.message,true)}
}
function drawBallot(d){const box=document.querySelector('#ballotArea');if(!d.election){box.innerHTML=`<div class="card empty"><h2>No open election</h2><p>${esc(d.message||'Please check back later.')}</p>${d.upcomingElection?`<p class="scheduled-voter-notice"><strong>${esc(d.upcomingElection.title)}</strong> starts automatically on ${esc(phDateTime(d.upcomingElection.voting_starts_at))}. Refresh at that time to begin voting.</p>`:''}</div>`;return}if(d.voted){box.innerHTML=`<div class="thankyou-card"><div class="thankyou-icon">✓</div><div class="thankyou-kicker">Ballot successfully recorded</div><h1>Thank you for Voting!</h1><blockquote>“Your voice matters. Thank you for helping shape the future of our community.”</blockquote><p class="thankyou-election">${d.election.isTest?'<strong>TEST / PRACTICE BALLOT - not an official vote.</strong> ':''}Your ballot for <strong>${esc(d.election.title)}</strong> has already been submitted and cannot be submitted again.</p><div class="thankyou-meta"><span>Submitted: ${esc(fmt(d.votedAt))}</span></div><div class="credential receipt-card"><small>Ballot receipt</small><div class="code">${esc(d.receiptCode)}</div><p class="tiny muted">Keep this receipt for your records. It confirms submission without revealing your selections.</p></div></div>`;return}
  box.innerHTML=`<div class="ballot-progress"><span class="active">1. Choose candidates</span><span>2. Review and submit</span></div><div class="hero">${d.election.isTest?'<div class="election-type-label test">TEST / PRACTICE - Not an official election</div>':''}<h1>${esc(d.election.title)}</h1><p>${esc(d.election.description||'Select your preferred candidates for each position.')}</p><p class="tiny">Voting closes: ${esc(phDateTime(d.election.voting_ends_at))}</p></div><form id="ballotForm">${d.positions.map(p=>`<section class="ballot-position" data-position="${p.id}" data-seats="${p.seats}"><h2>${esc(p.title)}</h2><p class="instruction">Choose up to ${p.seats} candidate${p.seats!==1?'s':''}. Tap a name to select or unselect it.</p><div class="selection-hint" aria-live="polite">0 of ${p.seats} selected</div>${p.candidates.map(c=>`<label class="candidate-option"><input type="checkbox" name="p-${p.id}" value="${c.id}">${candidatePhoto(c,'candidate-photo-ballot')}<span class="candidate-copy"><strong>${esc(c.full_name)}</strong>${c.statement?`<p>${esc(c.statement)}</p>`:''}${!c.has_photo?'<span class="tiny muted">Default profile photo</span>':''}</span></label>`).join('')}</section>`).join('')}<div class="ballot-footer"><div><strong id="selectionCount">0 selections</strong><div class="tiny muted">You can review choices before final submission.</div></div><button class="btn btn-primary" type="submit">Review & Submit</button></div></form>`;
  document.querySelectorAll('.candidate-option input').forEach(cb=>cb.onchange=e=>{const section=e.target.closest('.ballot-position');const max=Number(section.dataset.seats);const checked=[...section.querySelectorAll('input:checked')];if(checked.length>max){e.target.checked=false;toast(`You may select up to ${max} candidate${max!==1?'s':''} for this position.`,true)}section.querySelector('.selection-hint').textContent=`${[...section.querySelectorAll('input:checked')].length} of ${max} selected`;document.querySelectorAll('.candidate-option').forEach(l=>l.classList.toggle('selected',l.querySelector('input').checked));const total=document.querySelectorAll('.candidate-option input:checked').length;document.querySelector('#selectionCount').textContent=`${total} selection${total!==1?'s':''}`});
  document.querySelector('#ballotForm').onsubmit=e=>{e.preventDefault();const selections={};d.positions.forEach(p=>selections[p.id]=[...document.querySelectorAll(`input[name="p-${p.id}"]:checked`)].map(x=>Number(x.value)));if(!Object.values(selections).some(a=>a.length)){toast('Select at least one candidate.',true);return}openBallotReview(d,selections)};
}
function openBallotReview(d,selections){const lines=d.positions.map(p=>{const chosen=p.candidates.filter(c=>selections[p.id].includes(Number(c.id)));return `<div class="review-position"><strong>${esc(p.title)}</strong><div class="review-candidates">${chosen.length?chosen.map(c=>`<div class="review-candidate">${candidatePhoto(c,'candidate-photo-review')}<span>${esc(c.full_name)}</span></div>`).join(''):'<span class="muted">No selection</span>'}</div></div>`}).join('');modal(`<div class="modal-kicker">STEP 2 OF 2 · FINAL CHECK</div><h2>Review your ${d.election.isTest?'TEST':''} ballot</h2>${d.election.isTest?'<p class="tiny">This is a PRACTICE election. The practice ballot may be deleted when the test is closed.</p>':''}<p class="muted">Confirm the candidate names and photos below. Once submitted, your vote cannot be changed.</p>${lines}<label style="display:flex;gap:10px;align-items:flex-start;margin:16px 0"><input id="confirmVote" type="checkbox" style="margin-top:4px"><span>I confirm these are my selections and I am ready to submit my ballot.</span></label><button class="btn btn-primary btn-block" id="finalSubmit" disabled>Submit final ballot</button>`,()=>{document.querySelector('#confirmVote').onchange=e=>document.querySelector('#finalSubmit').disabled=!e.target.checked;document.querySelector('#finalSubmit').onclick=async()=>{const b=document.querySelector('#finalSubmit');b.disabled=true;b.textContent='Submitting…';try{const r=await api('/api/voter/vote',{method:'POST',body:JSON.stringify({electionId:d.election.id,selections})});closeModal();toast('Your vote has been recorded.');drawBallot({...d,voted:true,votedAt:new Date().toISOString(),receiptCode:r.receiptCode});}catch(err){if(/already submitted|already.*ballot/i.test(err.message)){closeModal();try{const latest=await api('/api/voter/ballot');drawBallot(latest);}catch{}toast('Your ballot was already submitted.');return}b.disabled=false;b.textContent='Submit final ballot';toast(err.message,true)}}});}

let previousModalFocus=null;
let voterDirectoryRequest=0;
function modal(html,onOpen){
  if(document.querySelector('#modalBackdrop'))closeModal();
  previousModalFocus=document.activeElement;
  document.body.insertAdjacentHTML('beforeend',`<div class="modal-backdrop" id="modalBackdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="HOA election dialog"><button class="btn btn-ghost btn-sm close" id="modalClose" type="button" aria-label="Close dialog">✕</button><div id="modalContent">${html}</div></div></div>`);
  document.body.classList.add('modal-open');
  document.querySelector('#modalClose').onclick=closeModal;
  document.querySelector('#modalBackdrop').onclick=e=>{if(e.target.id==='modalBackdrop')closeModal()};
  onOpen?.();
  const first=document.querySelector('#modalBackdrop input:not([type="hidden"]), #modalBackdrop select, #modalBackdrop textarea, #modalBackdrop button:not(#modalClose)');
  (first||document.querySelector('#modalClose'))?.focus?.({preventScroll:true});
}
function closeModal(){
  document.querySelector('#modalBackdrop')?.remove();document.body.classList.remove('modal-open');
  if(previousModalFocus?.isConnected)previousModalFocus.focus({preventScroll:true});previousModalFocus=null;
}
document.addEventListener('keydown',e=>{
  const backdrop=document.querySelector('#modalBackdrop');if(!backdrop)return;
  if(e.key==='Escape'){e.preventDefault();closeModal();return}
  if(e.key!=='Tab')return;
  const controls=[...backdrop.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],summary')].filter(el=>el.getClientRects().length);
  if(!controls.length)return;
  const first=controls[0],last=controls[controls.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
});

init();
