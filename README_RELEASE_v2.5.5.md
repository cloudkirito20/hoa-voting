# HOA Voting System v2.5.5 — Scheduled Auto-Start and Default Candidate Photo

## Included
- An election in **Draft** with `voting_starts_at` set opens automatically when the server reaches that time, provided it has a future deadline, at least one eligible active voter, at least one position and at least one candidate in **every** position, and no other election is open.
- An election with **no start date** remains a manual-open Draft election.
- Existing immutable election deadlines, one-open-election unique index, opening voter-count snapshot, and database submission cutoff remain in force.
- The existing Cloudflare cron continues to run every minute; the independent **Supabase pg_cron job** guarantees opening even if there are no Worker requests. API requests also reconcile overdue statuses on demand.
- Automatically opened elections are recorded as `election.auto_open` in the system audit log, with no voter-identifying information.
- The gray round silhouette image supplied by the user appears if a candidate has no photo, or if an uploaded photo fails to load. It is stored locally in `public/candidate-no-photo.png` (not uploaded to Supabase).

## Existing official election (production)
The already-existing `2026 HOA Election` (ID 3) was **Draft**, with start `2026-10-30 16:00:00 UTC` = **Oct 31, 2026 12:00 AM Philippine time**, and end `2026-10-31 08:00:00 UTC` = **Oct 31, 2026 4:00 PM Philippine time**. This migration does not alter either date or the status at installation. At the published start, the database job changes Draft to Open, and the opening-snapshot trigger records the number of eligible active voters.

## Installation sequence
1. Back up your Production database and keep an administrator monitoring the Supabase Cron job history.
2. Test the migration with a disposable scheduled election in the isolated staging project. **Never point staging Worker at Production database.**
3. Execute `supabase/v2.5.5-install-parts/01_scheduled_auto_start.sql` in Production Supabase SQL Editor (or use your migration pipeline).
4. Verify with `02_verify_auto_start.sql` and confirm job `hoa-voting-election-schedule` is active. Refresh the admin panel.
5. Deploy this v2.5.5 Worker/assets with Cloudflare Wrangler **only after** SQL verification; the new Worker expects `hoa_open_scheduled_elections()` to exist.
6. Keep existing `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, other secrets and site hostname unchanged. Never paste service keys into public code.

## Monitor and emergency stop
- Supabase Dashboard → Integrations → Cron → Jobs → `hoa-voting-election-schedule` → History. Run history is also available in `cron.job_run_details`.
- To stop **future** automatic opening in an emergency, run `03_rollback_auto_start.sql` while the election is still Draft. Disabling the job does not close an election already opened. For emergency suspension once open, follow your ELECOM procedure and the app's irreversible Close Voting action.
- Installing SQL does NOT deploy the Worker; the Supabase cron job alone will open scheduled Draft elections, but the user-facing scheduled labels and no-photo design require v2.5.5 frontend deployment.
- Do not manually modify voting timestamps, votes, or participation records.

## Limits
- The Cron job runs once a minute. Most elections start at minute boundaries. The v2.5.5 Worker also synchronizes on access so the first eligible request after the scheduled time does not depend on a Cron tick.
- If the election has no candidates/active voters or another election remains open, the scheduler deliberately leaves it Draft; investigate and resolve before the deadline.
- This is not a production election certification; end-to-end Cloudflare staging and external concurrency/failure testing remain required.
