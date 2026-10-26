import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
const backend=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/v2.5.5-install-parts/01_scheduled_auto_start.sql',import.meta.url),'utf8');
assert.match(backend,/async scheduled\(_controller, env\)[\s\S]*?await reconcileElectionSchedule\(env\)/);
assert.match(backend,/rpc\("hoa_open_scheduled_elections"\)/);
assert.ok((backend.match(/await reconcileElectionSchedule\(env\)/g)||[]).length>=5);
for(const condition of [
  "e.status = 'draft'",'e.voting_starts_at IS NOT NULL',
  'e.voting_starts_at <= clock_timestamp()',
  'e.voting_ends_at > clock_timestamp()',
  "other.status='open'",'NOT EXISTS(SELECT 1 FROM public.candidates',
  "u.role='voter' AND u.active=true",'FOR UPDATE SKIP LOCKED',
  "election.auto_open",'hoa_close_expired_elections()',
  "'hoa-voting-election-schedule'", "'* * * * *'"
]) assert.ok(sql.includes(condition),`Missing opening safeguard ${condition}`);
assert.match(sql,/REVOKE EXECUTE ON FUNCTION public.hoa_open_scheduled_elections\(\)/);
assert.match(sql,/FROM PUBLIC, anon, authenticated/);
assert.match(sql,/GRANT EXECUTE ON FUNCTION public.hoa_open_scheduled_elections\(\) TO service_role/);
assert.ok(existsSync(new URL('../public/candidate-no-photo.png',import.meta.url)));
assert.match(ui,/candidate-placeholder/);
assert.match(ui,/candidate-no-photo\.png/);
assert.match(ui,/Default profile image: no candidate photo/);
assert.match(ui,/Set a start date and time to open voting automatically/);
assert.match(ui,/e\.status==='draft'&&!e\.voting_starts_at/);
assert.match(ui,/electionBadge\(e\)/);
// Probe the actual rendered candidate card HTML with/without an uploaded photo.
const source=ui.replace(/\ninit\(\);\s*$/,'');
const ctx=vm.createContext({console,URL,Date,
  location:{origin:'https://hoa.test'},navigator:{},window:{addEventListener(){}},
  document:{querySelector(){return{}},addEventListener(){},querySelectorAll(){return[]}}});
vm.runInContext(source,ctx,{timeout:5000});
const noPhoto=vm.runInContext('candidatePhoto({id:1,full_name:"Sample One",has_photo:false},"candidate-photo-ballot")',ctx);
const withPhoto=vm.runInContext('candidatePhoto({id:2,full_name:"Sample Two",has_photo:true},"candidate-photo-ballot")',ctx);
assert.ok(noPhoto.includes('/candidate-no-photo.png'));
assert.ok(noPhoto.includes('candidate-no-photo'));
assert.ok(!noPhoto.includes('/api/candidates/'));
assert.ok(!noPhoto.includes('candidate-initials'));
assert.ok(withPhoto.includes('/candidate-no-photo.png'));
assert.ok(withPhoto.includes('/api/candidates/2/photo'));
assert.ok(!withPhoto.includes('candidate-initials'));
console.log('PASS v2.5.5: scheduled automatic start safeguards, independent cron job, backend sync and fallback candidate photos');
