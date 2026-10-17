# HOA Election System v2.5.0 — Source Security Audit

**Audit date:** 2026-10-17  
**Scope:** Code-level review of uploaded `HOA Voting System(2).zip`, patched
Cloudflare Worker/HTML, Supabase SQL migrations, offline tests and sample A4
printed output. **Not** a live penetration test or independent election audit.
No live Cloudflare account, Supabase production records, voter credentials,
GitHub branch settings, or real election logs were accessed.

## Confirmed defenses (source-level)

- A voter participation record has database primary key `(user_id,election_id)`.
  It cannot be inserted twice for the same account/election. Votes and
  participation are committed in the `hoa_submit_ballot` SQL transaction.
  Therefore refresh, relogin, different browser, and concurrent submissions
  should not create a second accepted vote for an already-used account.
- Server checks user session/role, HttpOnly Secure SameSite cookie, CSRF token
  on writes, cryptographically generated session tokens, login throttling,
  and hashed passwords; authorization is enforced in the Worker, not only UI.
- The first-login password change is checked in both Worker and SQL before
  voting, and revokes pre-change sessions.
- Deadlines are enforced in the SQL insertion transaction using database time
  (`clock_timestamp()`), not just a browser countdown; Cron updates the
  visible election status once per minute.
- Database constraints/guards protect candidate lists and prohibit deletion of
  elections that already have ballots. One normalized homeowner name account
  uniqueness was added by the earlier v2.2 migration.
- SQL vote totals are aggregated in the database to avoid default REST row
  pagination limits, and new ELECOM tallies do not auto-proclaim tied seats.
- Reprint requests require administrator role, CSRF, administrator password
  re-verification, audit logging and encrypted voucher availability. **Reprint
  never changes passwords**; no voter personal password is recoverable.

## Findings and remaining exposure

| Priority | Issue / recommendation | State |
|---|---|---|
| Critical | Same account voting twice, including concurrent requests | Database composite PK and atomic RPC mitigate; live concurrency test remains required |
| High | Same homeowner can be entered under different spellings/aliases | Name-normalization index and roster review only; **human verified roster/unique member ID** still required |
| High | Anyone with compromised Supabase service-role key / Worker admin deployment may affect elections | Keep service key secret, protect Cloudflare/GitHub/Supabase with MFA and least privilege; independent operational controls needed |
| High | Printed vouchers are sensitive and encrypted archive is decryptable by the privileged Worker | AES-256-GCM in separate private table and Cloudflare key, admin password re-verification, audit log, purge on password change; retain key securely |
| High | Admin resetting or disabling a voter during live voting could affect election integrity | New Worker + SQL guard freeze admin-origin voter updates when an election is Open; test races in staging |
| Medium | Existing/pre-upgrade vouchers are not retrievable from one-way password hashes | Explicitly skipped, never guessed or silently reset |
| Medium | Administrator accounts lack in-app MFA / hardware-backed key | Recommend a separate MFA identity provider, and strong Cloudflare/GitHub/Supabase admin MFA |
| Medium | Live per-candidate results view can show totals before polls close | Recommend delaying full tallies until closure if election rules require secrecy |
| Medium | Report denominator reflects database account count at opening, not independently certified membership list | ELECOM must reconcile qualified voters, proxies and multi-property ownership; include signed voter-roll attachment |
| Medium | First-time admin bootstrap uses the SETUP_TOKEN secret | Remove/disable setup endpoint after admin creation if desired, rotate token and limit admin permissions |
| Medium | Logs and timestamps can still reveal sensitive participation patterns | Do not log candidate selections, avoid precise anonymity linking, and minimize participation timestamp exposure |
| Medium | SQL functions run with security definer privileges | Restrict to `service_role` and check Supabase grants after applying every migration; no browser-visible service key |

## Test evidence, limitations

`npm run check`: syntax passed.  
`npm test`: tests for parser, HTML escaping, voucher sheet A4, QR address,
role/CSRF/password-change API restrictions, AES-GCM wrong-key detection,
admin reprint without password mutations, audit log, election deadlines,
and cutoff ties passed in mock runtime.

Sample A4 sheets rendered to PDF and visually inspected. QR image decodes to
`https://hoa-voting.casa-verde-de-banaderos.workers.dev/`.

**No evidence of a live two-browser/double-submit or SQL load test** is claimed.
Before using for an official election: run all migrations in staging,
check RLS grants and RPC permissions in Supabase, test replay/relogin/direct
API submissions and simultaneous transactions against actual PostgreSQL,
complete a data protection impact review, and conduct an independent
security assessment.

## Election Commission documentation

DHSUD 2024 Revised IRR of RA 9904 (Department Circular 2024-018), Sec. 101,
calls for election reports and associated records. This system creates
DHSUD-aligned A4 worksheets, **not certified DHSUD forms**. ELECOM must sign,
settle ties, certify the qualified-voter count, notarize required documents and
submit within the applicable 15-day window.
