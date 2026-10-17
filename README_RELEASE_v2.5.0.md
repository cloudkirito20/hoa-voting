# Casa Verde de Bañaderos HOA Election System — v2.5.0

**Release status: offline-tested candidate, NOT deployed or independently security-certified.**
This release was prepared from `HOA Voting System(2).zip` plus the previously
verified v2.2/v2.3/v2.4 work. Back up and test against a *staging Supabase project*
before using for a real election. Do not operate live elections during upgrades.

## Included changes

1. **Double-vote prevention:** PostgreSQL participation PK `(user_id,election_id)`
   plus the atomic `hoa_submit_ballot` transaction rejects the second ballot for
   the same account across refresh, logout/login and parallel requests.
2. **First-login password change:** the issued temporary password must be
   confirmed and changed to a different password before voting. API + SQL gate
   blocks direct bypass. Old sessions are invalidated on change.
3. **Election deadline:** admin enters a date/time in Philippine Standard Time
   (UTC+8). Admin opens voting manually; at or after end time the SQL rejects
   ballots. Cloudflare Cron marks the election closed every minute.
4. **ELECOM roster:** admin sets Chairperson, Secretary, Member, etc. Names and
   signature lines automatically populate DHSUD-aligned Election Tally and
   Final Election Report print sheets (A4) after election close.
5. **Reprint *without* resetting passwords:** admins select voters or all
   eligible archived vouchers, re-enter their own admin password, and print
   the **same original temporary credential**. QR opens:
   `https://hoa-voting.casa-verde-de-banaderos.workers.dev/`.
6. **Encrypted credential archive:** on issue, only AES-256-GCM ciphertext and
   a unique nonce are stored in the private `voter_vouchers` table. The AES key
   is a separate secret in Cloudflare, not in Supabase. Archive entries are
   purged automatically when a voter changes the temporary password. Reprints
   have mandatory admin authentication, CSRF, request limits and audit logs.
7. **Live-election freezes:** administrators cannot register, reset, delete,
   disable or re-enable voter accounts while polls are open. First-login
   password changes remain allowed for voters themselves.

## Required database and Worker setup (do this in order)

1. Export a verified **offsite database backup** and photograph/record your
   existing Cloudflare Worker production configuration (but **never** expose
   secrets in GitHub, screenshots or chat).
2. Test on a staging clone. You previously installed and verified the initial
   10-table Supabase baseline. Install applicable upgrades:
   - `supabase/v2.2-install-parts/01_...` through `08_...`, then `09_...`
     verification, plus `10_open_election_race_guards.sql`.
   - `supabase/v2.3-install-parts/01_...` through `04_...`, then `05_...`
     verification.
   - `supabase/v2.4-install-parts/01_electorate_snapshot.sql`, then
     `02_verify_dhsud_report.sql`.
   - `supabase/v2.5-install-parts/01_...` through `04_...` in order, then
     `05_verify.sql` (read-only).
   **Run each complete SQL file individually in Supabase SQL Editor.**
   Avoid selecting/executing only pieces of functions. Stop at the first error.
   Schema changes are not applied by GitHub/Cloudflare deploys.
3. Add one NEW Production Worker secret **`VOUCHER_ENCRYPTION_KEY`**. Keep the
   existing `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SETUP_TOKEN` unchanged.
   The encryption key must be **32 random bytes as 64 hexadecimal characters**,
   *different* from every other secret. Use PowerShell on Windows:

   ```powershell
   $bytes = New-Object byte[] 32
   $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
   $rng.GetBytes($bytes)
   $rng.Dispose()
   [BitConverter]::ToString($bytes).Replace('-', '') | Set-Clipboard
   ```

   Paste the copied value into Cloudflare → `hoa-voting` → **Production** →
   Variables and Secrets, Type `Secret`, Name `VOUCHER_ENCRYPTION_KEY`. Save
   the same value to your password manager/offline backup. **Do not rotate or
   lose this key** while archived vouchers exist; doing so makes them
   undecryptable. Never put it into `.dev.vars.example` or GitHub.
4. Replace the source files in the connected GitHub repository using this ZIP,
   especially `src/index.js`, `public/app.js`, `public/index.html`,
   `public/voting-qr.png`, `wrangler.jsonc`, `package.json` and SQL files. Push
   to the branch that Cloudflare Production deploys; confirm **Deployments**
   shows success. `wrangler.jsonc` includes a one-minute Cron trigger.
5. Verify `/api/health`, sign in with the admin account, create a **staging
   test election** with deadlines, add ELECOM members, register test voters,
   reprint selected/all unchanged vouchers, and test the mandatory first login
   password change. Exercise two simultaneous ballot submissions and a ballot
   exactly after the deadline. Close the test election and verify both A4
   reports. Archive the test results and record actual evidence.

## Reprint semantics — READ THIS

- **Reprint means unchanged password.** Reprint endpoint performs no reset,
  reissue, change-password or session update.
- **After the first personal password change, no password is printable.**
  The old temporary voucher stops working, and the encrypted archive is
  deleted. Reprinting that credential would be misleading and unsafe.
- **Pre-upgrade credentials cannot be recovered from database hashes.** If
  original paper/PDF vouchers were securely saved, reprint those documents.
  Otherwise issue a new temporary credential only through a separately
  authorized password-reset workflow (not through the Reprint button).
- Archived vouchers are sensitive; print only in a controlled setting, deliver
  privately, and destroy spoiled copies. Restrict admin accounts, enable MFA
  on Cloudflare/GitHub/Supabase, and retain the encrypted-key backup separately.
- If a voter has already voted, printing their original account credentials
  **does not** allow another vote in the same election: the unique DB
  participation key still blocks it.

## DHSUD aligned reports

The two A4 printable worksheets include eligible account count at opening,
turnout, recorded ballot totals, candidate votes/ranks, unresolved cutoff ties,
opening/closing times, incident/certification placeholders, plus saved Election
Committee names/roles with blank signature lines. They are marked **"DHSUD-
aligned ELECOM worksheet"**, not a verified government-issued form.

Reference: 2024 Revised IRR of RA 9904, DHSUD Department Circular 2024-018,
Section 101. The ELECOM must review the eligible voter roll, finalize
proclamation/tie procedures, sign and complete all accompanying reports and
minutes; forms, notarization and submission requirements may vary by Regional
Office. In general, Section 101 requires submission within 15 days.

## Safety review and testing

Run `npm install`, `npm run check`, and `npm test` before pushing. The tests
verify mock behavior and source-level invariants; they do NOT replace a live
PostgreSQL concurrency test, production authorization review, or a formal
penetration test. Full findings in `SECURITY_AUDIT_v2.5.0.md`.
