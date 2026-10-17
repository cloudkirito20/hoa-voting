# Casa Verde de Bañaderos HOA Voting — v2.5.1 QR Voucher Fix

**Status:** Prepared and offline regression-tested. **Not live-deployed or independently security-certified.** Test with a staging Supabase project and synthetic voters first.

## Why `Original password not printable` appears

Older accounts issued before the AES-encrypted `voter_vouchers` archive was installed cannot have their original temporary passwords recovered from salted password hashes. Voters who changed their temporary passwords also do not have printable credentials. **No software patch can reconstruct these lost passwords.** The QR code contains the public HOA voting portal link, not a login token.

## New buttons under Admin → Voter Registration

**Print ALL QR login slips:** Prints ALL active registered voters (ignores search filters) on A4, eight per sheet, with homeowner name, block/lot, username, and the portal QR code. No passwords are printed or changed; voters must already know their password. Does not need a new SQL migration. Prints up to 500 active users; handle larger electorates separately.

**Issue NEW credential vouchers for legacy accounts:** Strongly confirmed bulk issuing of new encrypted passwords to active accounts that STILL have `must_change_password=true` and have **no archived voucher**. It does not touch voters who already changed a personal password, or those whose original encrypted vouchers can still be reprinted. This is NOT a reprint; prior passwords and login sessions are invalidated. It operates in transactions of 1–20 voters and shows progress, then prints A4 vouchers with QR and NEW passwords. Each completed batch is auditable and recoverably reprintable (until the voter changes the password). Election participation and ballots are NOT deleted or modified. It refuses to run during an open election.

The pre-existing **Reprint selected / Reprint all available** buttons remain unchanged and do not reset credentials.

## Deployment sequence

1. **Keep live voting paused.** Take a verified Supabase backup and a GitHub commit/branch snapshot. Verify that v2.2, v2.3, v2.4, and v2.5 database migrations all passed (as previously reported).
2. In a **staging Supabase project**, run the complete file `supabase/v2.5.1-install-parts/01_bulk_legacy_voucher_reissue.sql` in SQL Editor. Expected result: `PASS 2.5.1-1: guarded legacy voucher reissue`. It creates one secured RPC; no voter passwords change by running this migration.
3. Run the read-only `supabase/v2.5.1-install-parts/02_verify_legacy_reissue.sql` and check all booleans. `safe_to_reissue_now` is `false` if any election is open: this is an intentional block, **not** necessarily a failed migration.
4. In Cloudflare Production, **keep your existing** `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SETUP_TOKEN` and especially `VOUCHER_ENCRYPTION_KEY` secrets intact. Never rotate the voucher encryption key while archives exist. Never put secret values in GitHub or share them in screenshots.
5. Replace the project's source files from this v2.5.1 ZIP in the GitHub-connected repository, preserving directories. Run `npm ci`, `npm run check`, and `npm test`, then commit and push the Production-connected branch. Cloudflare should show a successful Production deployment; verify `public/voting-qr.png` loads. `wrangler.jsonc` retains the one-minute Cron schedule.
6. Before opening voting, test with synthetic staging accounts: a legacy first-login voter (can reissue), a voter who has changed their initial password (must be excluded from bulk reissue), a voter with an existing archive (can reprint unchanged), and a disabled voter (excluded). Confirm QR-only printing does not modify passwords or accounts. Then test a newly issued password, mandated first-login change, unchanged reprint, and a double-ballot rejection.
7. Only after staging testing, install v2.5.1 migration in Production and deploy the exact same tested code. **Do not press the reissue button until you have decided to invalidate existing legacy passwords and can distribute the replacements securely.**

## Emergency considerations

- Printing QR-only slips is safe for users who already know a valid password; a QR code alone cannot authorize voting.
- If the homeowner no longer knows a pre-archive password and needs a complete credential voucher, use the explicitly confirmed legacy reissue **only when eligible**, or use the existing per-voter emergency reset with appropriate authorization outside a live election.
- After any reissue, promptly print and privately distribute the A4 vouchers. If a batch times out, do not reissue it blindly; inspect which archived vouchers became available and use **Reprint all available** to retrieve the unchanged newly issued passwords.
- The QR points to `https://hoa-voting.casa-verde-de-banaderos.workers.dev/`. No passwords are included in URLs, and QR scanning alone never signs anyone in.
- No real voter or secret data is embedded in the ZIP.
- These offline tests do not replace live Supabase transactions, concurrent vote tests, or a professional security review.
