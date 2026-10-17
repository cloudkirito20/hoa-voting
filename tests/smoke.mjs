// Offline tests: use DOM and popup stubs; no live database, network, or passwords.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/\ninit\(\);\s*$/,'\n');
let popupHtml='';
const popup={document:{write(html){popupHtml+=html},close(){}},opener:null};
const ctx=vm.createContext({
  console,URL,location:{origin:'https://hoa.test'},navigator:{},setTimeout:()=>0,
  window:{addEventListener(){},open(){popupHtml='';return popup}},
  document:{querySelector(){return {innerHTML:'',textContent:''}},addEventListener(){},querySelectorAll(){return []}},
  confirm:()=>true,alert:()=>{}
});
vm.runInContext(source,ctx,{timeout:5000});
function check(expr){return vm.runInContext(expr,ctx,{timeout:5000})}

const data=check(`parseCsv('\ufefffullName,block,lot\\r\\n"Last, First",01,002\\r\\n"A ""quoted"" name",1,3\\r\\n')`);
assert.equal(data.length,3);
assert.equal(data[1][0],'Last, First');
assert.equal(data[2][0],'A "quoted" name');
assert.equal(check("normalUnit('003')"),'3');
assert.equal(check("normalUnit(' A01 ')"),'A01');

const vouchers=Array.from({length:159},(_,i)=>({fullName:`Demo Resident ${i+1}`,block:String(Math.floor(i/50)+1),lot:String(i+1),username:`DEMO-${i+1}`,password:'NOT-A-REAL-PASSWORD'}));
ctx.vouchers=vouchers;
check('printVoucherSheet(vouchers)');
assert.equal((popupHtml.match(/class="sheet"/g)||[]).length,20);
assert.equal((popupHtml.match(/class="voucher"/g)||[]).length,159);
assert.ok(popupHtml.includes('size:A4 portrait'));
assert.ok(popupHtml.includes('https://hoa-voting.casa-verde-de-banaderos.workers.dev/'));
assert.ok(popupHtml.includes('/voting-qr.png'));
assert.ok(popupHtml.includes('INITIAL PASSWORD'));
assert.ok(popupHtml.includes('Change your initial password at first login'));

ctx.qrVoters=vouchers.map(({password,...v})=>v);
check('printVoucherSheet(qrVoters,null,true)');
assert.equal((popupHtml.match(/class="voucher"/g)||[]).length,159);
assert.equal((popupHtml.match(/class="sheet"/g)||[]).length,20);
assert.ok(popupHtml.includes('QR LOGIN SLIP • NO PASSWORD INCLUDED'));
assert.ok(popupHtml.includes('Use your existing password'));
assert.ok(popupHtml.includes('/voting-qr.png'));
assert.ok(!popupHtml.includes('NOT-A-REAL-PASSWORD'));


ctx.vouchers=[{...vouchers[0],fullName:'<script>alert(1)</script>'}];
check('printVoucherSheet(vouchers)');
assert.ok(popupHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));

const backend=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const start=backend.indexOf('function strongVoterPassword()');
const stop=backend.indexOf('function timingSafeEqual(',start);
assert.ok(start>0 && stop>start);
const cryptFns=backend.slice(start,stop);
const cryptoCtx=vm.createContext({crypto:webcrypto,Uint32Array,Math});
vm.runInContext(cryptFns,cryptoCtx,{timeout:3000});
const passwords=vm.runInContext('Array.from({length:150},()=>strongVoterPassword())',cryptoCtx,{timeout:5000});
assert.ok(passwords.every(s=>s.length===12));
assert.equal(new Set(passwords).size,passwords.length);
assert.ok(passwords.every(s=>/[A-Z]/.test(s)&&/[a-z]/.test(s)&&/[2-9]/.test(s)));
assert.ok(backend.includes('path === "/api/admin/voters/bulk"'));
assert.ok(backend.includes('voterRegistrationLock(sb)'));

// Admin setup uses separate forms and a deliberate clipboard paste action, rather
// than exposing two password fields to browser autofill on the same screen.
assert.ok(source.includes('id="setupDetailsForm"'));
assert.ok(source.includes('id="setupTokenForm"'));
assert.ok(source.includes('id="pasteSetupToken"'));
assert.ok(source.includes('navigator.clipboard.readText()'));
assert.ok(source.includes('setupToken===details.password'));
assert.ok(source.includes('64 characters entered'));
assert.ok(!source.includes('<form id="setupForm"'));

console.log('PASS: CSV quoting, numeric unit normalization, 159 vouchers on 20 A4 sheets, HTML escaping, 12-character password strength, bulk route.');
