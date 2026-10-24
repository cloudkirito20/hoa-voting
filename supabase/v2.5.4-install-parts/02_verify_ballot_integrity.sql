-- v2.5.4 READ-ONLY checks. Do not change real election data.
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='ballots'
            AND column_name='expected_position_counts') AS commitments_column_found,
  to_regprocedure('public.hoa_submit_ballot(bigint,bigint,uuid,text,jsonb)') IS NOT NULL AS ballot_rpc_found,
  to_regprocedure('public.hoa_ballot_integrity_summary(bigint)') IS NOT NULL AS integrity_rpc_found,
  EXISTS (SELECT 1 FROM pg_trigger
          WHERE tgrelid='public.ballots'::regclass
            AND tgname='trg_hoa_ballot_commitment_immutable' AND NOT tgisinternal) AS immutability_guard_found;

-- Replace 0 with a staging election ID; execute SELECT only (no writes).
-- For new 200-voter 7-seat full-ballot staging tests expect: 200/200 ballot rows,
-- committedBallots=200, legacyBallots=0, mismatchedBallots=0,
-- expectedSelections=actualSelections, invalidVoteRows=0, crossElectionVoteRows=0.
-- SELECT public.hoa_ballot_integrity_summary(0);

-- Find historic elections that cannot be retroactively verified. Do NOT backfill.
SELECT b.election_id,
       count(*) AS anonymous_ballots,
       count(*) FILTER (WHERE b.expected_position_counts IS NULL) AS historical_unverified_ballots
FROM public.ballots b
GROUP BY b.election_id
ORDER BY b.election_id;
