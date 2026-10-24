# HOA Voting v2.5.4 - Integration and Safety Checklist

**Scope:** Cloudflare Worker + Supabase PostgreSQL. This release fixes the false-positive ballot-integrity indicator found in v2.5.3 and includes a 200-voter randomized 11-candidate / 7-seat Board Member regression test.

**Status:** Application tests passed in an **offline mock Supabase database**. SQL migration and live Cloudflare/Supabase transactions have **not** been tested here; staging verification is still required. This is not a certification of election readiness.

## Exactly what changed

- `src/index.js`: calls new `hoa_ballot_integrity_summary` RPC in admin results; verifies that participants/anonymous ballots, per-ballot expected selections, actual vote rows and aggregate tallies agree. Missing SQL => `migration_required` (never VERIFIED); older ballots => `legacy_unverifiable`; damaged vote rows => `mismatch`.
- `supabase/v2.5.4-install-parts/01_ballot_integrity_commitments.sql`: **additive** ballot metadata column; updated atomic `hoa_submit_ballot` writes per-position selection-count commitments; immutability trigger; server-only aggregate RPC. The RPC does not return voter identities or ballot choices.
- `supabase/v2.5.4-install-parts/02_verify_ballot_integrity.sql`: READ-ONLY migration/legacy verification queries.
- `public/app.js`, `public/styles.css`, `public/index.html`: alert visibly in results and print exports whenever not verified, and distinguish `% voters` from `% selections` in multi-seat tallies.
- `tests/audit-200-random-7seat.mjs`: reproducible mock-based randomized election scenario, vote replay and concurrent-duplicate checks, overvote/invalid ballots, deadline, missed acknowledgement, cutoff ties, induced missing vote row, and historical legacy records.
- `package.json` and lockfile: version 2.5.4; the full audit test is included in `npm test`.

## Before integrating

1. **Do not test on a live official election.** If an official election is open, schedule a maintenance window after voting closes. Back up the original deployment, Supabase schema and election data.
2. Create a **separate Supabase staging project or a safe cloned environment** using exactly the current production migrations through v2.5.2. Verify existing Supabase API secrets are stored only as Cloudflare secrets, never in ZIP/public files.
3. From this folder run: `npm ci`, `npm run check`, `npm test`. No live account or database is contacted by the bundled audit test. The audit-generated CSV and JSON files are written to `audit-results/`.
4. In the **STAGING** Supabase SQL Editor, run **the entire** `supabase/v2.5.4-install-parts/01_ballot_integrity_commitments.sql` file. It uses one transaction and does NOT delete or backfill existing ballots.
5. Run the READ-ONLY `supabase/v2.5.4-install-parts/02_verify_ballot_integrity.sql` query. All four installation booleans should read `true`.
6. Deploy **STAGING Worker** with its staging Supabase URL and secret. Verify one voter can select fewer than 7 candidates and a second voter all 7. Final/realtime API result should contain `integrityStatus: "verified"` and `voteRecordIntegrityOk: true` for newly submitted staging ballots.
7. On a **disposable staging election only**, import 200 synthetic eligible voters and set 1 Board Member position, 7 seats, 11 candidates. Submit a variety of 1-7 choices through the staging API/UI, then verify every vote independently. Use read-only verification SQL to confirm zero mismatched/legacy rows and expectedSelections equals actualSelections. Test double-clicks, network retries, deadlines and the 7th/8th tie. Do **not** use the offline test's mock throughput as a performance benchmark.
8. Only after complete staging sign-off, run the SQL migration on the backed-up production Supabase (during a scheduled safe window), verify the RPC/permissions, then deploy the v2.5.4 Cloudflare Worker. Observe the admin results screen and logs. Run `npx wrangler deploy` **only when** the intended Cloudflare account and secrets are confirmed.

## Database verification examples (read-only)

Replace `123` with a **staging election ID**, not a production ID:

```sql
SELECT public.hoa_ballot_integrity_summary(123);
```

For a new election in which all 200 voters submit one ballot, verify `ballotRows=200`, `committedBallots=200`, `legacyBallots=0`, `mismatchedBallots=0`, `invalidVoteRows=0`, `crossElectionVoteRows=0`, and `expectedSelections=actualSelections` (both must equal the actual number of individual candidate selections, **not necessarily 1,400**). The admin report must also show 200 cast/anonymous ballots.

A 7-seat Board Member ballot lets each voter select **1 to 7 distinct candidates**. It is valid to have fewer than 7 selections. In the sampled seeded audit, 200 ballots produced 902 selections, not 1,400.

## Existing elections and limitations

- Historical `ballots.expected_position_counts` remains `NULL`: **do not backfill it from current `ballot_votes`**. That would falsely establish proof that no historic votes had already been lost. The report displays `legacy_unverifiable` until independent records/committee processes reconcile them.
- The new commitment detects **missing/extra selections and per-position count changes**, not every possible alteration (e.g., swapping one candidate ID for another within the same position while keeping vote counts equal). It is **not a cryptographic audit trail**, and cannot protect against a database superuser altering both records and commitments. Require backups, access controls, audit logs, external election observers and committee reconciliation for official use.
- The report can temporarily show a mismatch if concurrent submissions cross different database snapshot times. Recheck after voting closes on a stable snapshot before concluding data corruption.
- No voter-to-ballot link is added, preserving the existing anonymity architecture. Commitments record counts only.
- This patch **does not modify or certify** any prior election records. It does not automatically announce official winners; rankings remain provisional and unresolved cutoff ties need ELECOM review.

## Rollback and recovery

- If Worker deployment fails, redeploy the prior approved Worker build after checking the database RPC remains compatible. **Do not DROP** the new `expected_position_counts` field or roll back/delete vote records during an active election.
- The additive SQL has been designed for forward compatibility with the previous Worker call signature, but this compatibility has **not** been verified against a real database here.
- Do not manually edit anonymous ballots to make an integrity indicator turn green. Preserve evidence, restore/reconcile from backed-up records with election committee oversight.

## Reproduce the randomized audit

```
node tests/audit-200-random-7seat.mjs
```

Different reproducible synthetic voting patterns:

**Windows CMD:** `set HOA_AUDIT_SEED=20261025 && node tests/audit-200-random-7seat.mjs`

**Bash:** `HOA_AUDIT_SEED=20261025 node tests/audit-200-random-7seat.mjs`

For the main report, seed `20261024`: 200 accepted ballots, 902 candidate selections and top seven H, E, J, A, C, I, B. The attached audit evidence has results from ten independently seeded runs.
