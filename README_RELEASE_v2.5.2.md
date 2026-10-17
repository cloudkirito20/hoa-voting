# Casa Verde de Bañaderos HOA — v2.5.2: Test vs Official Elections

**Status:** Prepared and offline regression-tested. **Not yet applied to Supabase or deployed to Cloudflare.** Use a staging database with synthetic voter accounts before production.

## New feature: election type at creation

The **Create election** form now contains a checkbox:

- **Unchecked (default) — OFFICIAL.** Real election. Permanently protected against deletion through the application and guarded database deletion workflows, even while in Draft and even when it has no ballots.
- **Checked — TEST / PRACTICE.** For rehearsal/mock elections only. Clearly labeled across admin elections, dashboards, voter ballot, and A4 reports. An administrator can delete a Draft or Closed test election, **including test ballots and participation records**, after typing the exact election title and `DELETE TEST`. Open test elections must be closed before deletion.

The chosen type is **immutable after creation**. Only the narrowly checked, previously verified legacy mock election **ID 2** is reclassified during the migration, if its title, creation time, status, and exact data counts still match the prior read-only preflight.

## Safety and data integrity

1. The SQL migration adds `elections.is_test BOOLEAN NOT NULL DEFAULT FALSE`. All earlier elections stay Official except the previously verified ID 2 (when the preflight fingerprint matches).
2. A database trigger disallows changing the type once created; another trigger blocks deletion of all Official elections and enforces the test-only workflow.
3. A new restricted `hoa_delete_test_election` SQL function independently verifies an active administrator, an exact title match, that the election is Test and not Open, and uses a row lock and audit entry. Foreign-key cascades remove only the selected test election's candidates, positions, ballots, votes, participation, and committee roster. **It does not delete voter accounts or passwords** or alter other elections.
4. The legacy `hoa_delete_election(bigint)` RPC loses its execution permission for `service_role`, so old Worker code cannot bypass the new workflow. Only `service_role` may execute the new function; `anon` and `authenticated` cannot.
5. Pre-existing voucher reprint, temporary-password generation, password changes, one-vote enforcement, deadlines, and Cron behavior from v2.5.1 remain unchanged.
6. Test tally/final report views and printed worksheets are explicitly marked Practice/Not for certification.

**Irreversibility warning:** Deleting a test election destroys its practice ballots and participation records. Keep a tested offsite backup. Do not mark an election Test if you intend its votes or reports to serve as official evidence.

## Installation order

1. Freeze voting, obtain an offsite Supabase backup, and save your current GitHub deployment commit. Clone production to staging first.
2. In staging SQL Editor, run `supabase/v2.5.2-install-parts/01_test_election_mode.sql` in its entirety. Expected: `PASS 2.5.2-1: immutable Official/Test classification and guarded deletion`.
3. Run the read-only `supabase/v2.5.2-install-parts/02_verify_test_election_mode.sql`. All returned Boolean checks should be true **while legacy ID 2 still exists**. If it has already been deleted, `verified_old_mock_id2_is_test` may be NULL; verify that absence separately.
4. Test creating both types, keeping Official immutable, deleting a Draft Test and a Closed Test with mock ballots. Confirm the latter does not affect users, voter credentials or other elections. **Do not perform these destructive tests against live production data.**
5. Run `npm ci`, `npm run check`, and `npm test` against this package. Stage-deploy the Cloudflare Worker with this source and verify its user interface with synthetic data.
6. Repeat SQL Part 1 and Part 2 in Production when staging tests pass, **then** update the GitHub branch connected to Cloudflare Production. Confirm the deployment succeeds. Do not change existing Cloudflare secrets or the Cron schedule.
7. Once deployed: Admin → Election Setup → New election. Select Test only for practice elections. For the previously verified `2026 Hoa Election` (ID 2), confirm it is now labeled TEST. If you want to remove it, click **Delete TEST election**, type its exact title and `DELETE TEST`; all mock votes for that election are removed.

## Legacy mock election ID 2 fingerprint (fail closed)

`title='2026 Hoa Election'`, `status='closed'`, Manila creation date/time `2026-10-17 16:14`; 1 ballot, 1 participation, 2 candidate-vote records, 1 position, 4 candidates, 2 ELECOM members. If any fingerprint value no longer matches, **Part 1 aborts and rolls back** instead of reclassifying a potentially different election. Send the SQL error and run a fresh read-only preflight before doing anything else. **Do not loosen these checks or enable direct deletion.**

## Regression status

The package has been checked with Node syntax validation and these six offline suites: `smoke`, `security`, `deadline`, `voucher-archive`, `legacy-vouchers`, and `election-modes`. Static/mocked checks cannot prove live PostgreSQL cascades, access rules, Cloudflare deployment status, or adversarial security: staged database and end-to-end tests are mandatory.
