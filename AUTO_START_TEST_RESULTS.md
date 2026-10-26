# HOA Voting System v2.5.5 — Validation Log

Date: 2026-10-26 (Asia/Manila). All names/data in staging tests synthetic.

## Offline application checks
- Eight existing regression test scripts PASS (including the 200-voter, 11-candidate, 7-seat audit, 902 synthetic selections in the offline fixture).
- New scheduled-start & photo-fallback regression PASS.
- Worker and browser JavaScript syntax checks PASS.

## Actual Supabase staging — HOA Voting Staging
- Added staging-parity election columns and opening voter-count trigger without deleting prior test ballots.
- Installed and enabled `pg_cron` and `hoa_open_scheduled_elections()`.
- Future-start Draft election remained Draft; incomplete election remained Draft.
- After moving **only the staging test election** start to the past, opening function returned 1; status changed to Open.
- Automatic opening snapshot recorded 200 eligible active synthetic voters, opened_at populated, and audit log recorded exactly one `election.auto_open` event.
- Repeat call returned 0 (idempotent), incomplete election stayed Draft.
- Pre-existing 200 synthetic ballots and 800 candidate selections remained intact.

## Production — HOA Voting Online (2026 HOA Election ID 3)
- Installed independent Supabase Cron job `hoa-voting-election-schedule`, every minute.
- Cron job ACTIVE; at least one execution observed SUCCEEDED on 2026-10-26 at 06:23 UTC.
- RPC privileges verified: anon and authenticated DENIED; service_role ALLOWED.
- Before scheduled start, manual read-only test of open function returned 0; Production election remained Draft.
- Existing start unchanged: October 31, 2026 at 00:00 Philippine time. End unchanged: October 31 at 16:00 Philippine time.
- Existing 10 candidates, 1 position, 157 active voters, 0 ballots preserved.
- **Cloudflare Worker and static assets not deployed in this session.** To show the new label/photo on the live website, deploy the v2.5.5 ZIP after confirming secrets and the production Worker target.

## Remaining limitations
- Stage had a voting-focused schema, not every production feature. Full end-to-end voter logins, Cloudflare requests/concurrency and emergency outage testing remain incomplete.
- One-minute schedule tick may activate shortly after the minute boundary if the database is under load. The updated Worker calls the same SQL function on demand.
- An incomplete election or overlap with an already-Open election is intentionally not opened automatically.
- The no-photo asset is an unchanged copy of the supplied PNG (160 x 187), rather than an image generation or upload.
- Production remains Draft until the scheduled opening time; no actual vote was cast during this update.
