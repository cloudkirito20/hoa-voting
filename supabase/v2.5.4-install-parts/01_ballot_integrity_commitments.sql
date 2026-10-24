-- HOA Voting v2.5.4: anonymous ballot selection-count commitments.
-- Staging-test and back up FIRST. No existing ballots/voters/vote records are modified.
-- One new nullable metadata column is deliberately left NULL for historical ballots:
-- historical records cannot be retrospectively certified by inferring their prior choices.
-- Run the COMPLETE file once after prior v2.3-v2.5.2 migrations.
BEGIN;

ALTER TABLE public.ballots
  ADD COLUMN IF NOT EXISTS expected_position_counts jsonb;

-- Keep legacy rows unverified; do not backfill from potentially incomplete tally data.
DO $hoa_check_column$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.ballots'::regclass AND conname='hoa_ballots_expected_position_counts_object'
  ) THEN
    ALTER TABLE public.ballots ADD CONSTRAINT hoa_ballots_expected_position_counts_object
      CHECK (expected_position_counts IS NULL OR jsonb_typeof(expected_position_counts) = 'object');
  END IF;
END;
$hoa_check_column$;

-- Preserve the ballot commitment against later correction/tampering. No voter ID is
-- added to ballots. This does NOT prevent a database superuser from altering data.
CREATE OR REPLACE FUNCTION public.hoa_guard_ballot_commitment()
RETURNS trigger LANGUAGE plpgsql SET search_path=public
AS $hoa_guard_ballot_commitment$
BEGIN
  IF NEW.expected_position_counts IS DISTINCT FROM OLD.expected_position_counts THEN
    RAISE EXCEPTION 'An anonymous ballot selection commitment cannot be changed after submission.';
  END IF;
  RETURN NEW;
END;
$hoa_guard_ballot_commitment$;

DROP TRIGGER IF EXISTS trg_hoa_ballot_commitment_immutable ON public.ballots;
CREATE TRIGGER trg_hoa_ballot_commitment_immutable
  BEFORE UPDATE OF expected_position_counts ON public.ballots
  FOR EACH ROW EXECUTE FUNCTION public.hoa_guard_ballot_commitment();

-- Preserve existing v2.3 safeguards: row locks, first-login, database deadline,
-- one-voter-one-ballot, validated candidate IDs, and atomic transaction.
CREATE OR REPLACE FUNCTION public.hoa_submit_ballot(
  p_user_id bigint, p_election_id bigint, p_ballot_id uuid,
  p_receipt_code text, p_selections jsonb
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $hoa_submit_ballot$
DECLARE
  entry record; pos_id bigint; allowed_seats integer; selected_count integer;
  distinct_count integer; valid_count integer; total_selected integer := 0;
  position_commitment jsonb := '{}'::jsonb;
BEGIN
  PERFORM 1 FROM public.users
  WHERE id=p_user_id AND role='voter' AND active=true AND must_change_password=false
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voter account is inactive or initial password change is required.';
  END IF;
  PERFORM 1 FROM public.elections
  WHERE id=p_election_id AND status='open' AND voting_ends_at > clock_timestamp()
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Voting is closed or the deadline has passed.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.voter_participation
    WHERE user_id=p_user_id AND election_id=p_election_id
  ) THEN RAISE EXCEPTION 'This voter account has already submitted a ballot.'; END IF;
  IF jsonb_typeof(p_selections) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid ballot.';
  END IF;

  FOR entry IN SELECT * FROM jsonb_each(p_selections)
  LOOP
    IF entry.key !~ '^[0-9]+$' OR jsonb_typeof(entry.value) <> 'array' THEN
      RAISE EXCEPTION 'Ballot contains an invalid position.';
    END IF;
    pos_id := entry.key::bigint;
    SELECT seats INTO allowed_seats
    FROM public.positions WHERE id=pos_id AND election_id=p_election_id;
    IF allowed_seats IS NULL THEN RAISE EXCEPTION 'Ballot contains an invalid position.'; END IF;
    selected_count := jsonb_array_length(entry.value);
    IF selected_count > allowed_seats THEN
      RAISE EXCEPTION 'Too many selections for a position.';
    END IF;
    IF selected_count = 0 THEN CONTINUE; END IF;

    SELECT count(*), count(DISTINCT v::bigint)
      INTO selected_count, distinct_count
    FROM jsonb_array_elements_text(entry.value) AS x(v)
    WHERE v ~ '^[0-9]+$';
    IF selected_count <> jsonb_array_length(entry.value)
       OR distinct_count <> selected_count THEN
      RAISE EXCEPTION 'Ballot contains invalid or duplicate candidate selections.';
    END IF;
    SELECT count(*) INTO valid_count FROM public.candidates c
    WHERE c.position_id=pos_id AND c.id IN (
      SELECT v::bigint FROM jsonb_array_elements_text(entry.value) AS x(v)
    );
    IF valid_count <> selected_count THEN
      RAISE EXCEPTION 'Ballot contains an invalid candidate selection.';
    END IF;
    total_selected := total_selected + selected_count;
    position_commitment := position_commitment || jsonb_build_object(entry.key, selected_count);
  END LOOP;
  IF total_selected < 1 THEN RAISE EXCEPTION 'Select at least one candidate before submitting.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.elections WHERE id=p_election_id
    AND status='open' AND voting_ends_at > clock_timestamp()
  ) THEN RAISE EXCEPTION 'Voting deadline has passed.'; END IF;

  INSERT INTO public.voter_participation(user_id,election_id,receipt_code)
  VALUES(p_user_id,p_election_id,p_receipt_code);
  INSERT INTO public.ballots(id,election_id,expected_position_counts)
  VALUES(p_ballot_id,p_election_id,position_commitment);
  FOR entry IN SELECT * FROM jsonb_each(p_selections)
  LOOP
    pos_id := entry.key::bigint;
    INSERT INTO public.ballot_votes(ballot_id,election_id,position_id,candidate_id)
    SELECT p_ballot_id,p_election_id,pos_id,v::bigint
    FROM jsonb_array_elements_text(entry.value) AS x(v);
  END LOOP;
  RETURN p_receipt_code;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This voter account has already submitted a ballot.';
END;
$hoa_submit_ballot$;

-- Returns ONLY aggregated metadata: NEVER voter IDs, timestamps or choices.
-- Per-position counts can detect a missing selection even for partial ballots,
-- and can catch a vote shifted to another position.
CREATE OR REPLACE FUNCTION public.hoa_ballot_integrity_summary(p_election_id bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $hoa_ballot_integrity_summary$
WITH election_ballots AS (
  SELECT id, election_id, expected_position_counts
  FROM public.ballots WHERE election_id=p_election_id
),
position_votes AS (
  SELECT bv.ballot_id, bv.position_id::text AS position_key,
         count(*)::bigint AS row_count,
         count(*) FILTER (WHERE bv.election_id <> b.election_id
           OR p.election_id IS DISTINCT FROM b.election_id
           OR c.position_id IS DISTINCT FROM bv.position_id)::bigint AS invalid_rows
  FROM public.ballot_votes bv
  JOIN election_ballots b ON b.id=bv.ballot_id
  LEFT JOIN public.positions p ON p.id=bv.position_id
  LEFT JOIN public.candidates c ON c.id=bv.candidate_id
  GROUP BY bv.ballot_id, bv.position_id
),
per_ballot AS (
  SELECT ballot_id,
         jsonb_object_agg(position_key,row_count) AS actual_position_counts,
         sum(row_count)::bigint AS actual_count,
         sum(invalid_rows)::bigint AS invalid_rows
  FROM position_votes GROUP BY ballot_id
),
compared AS (
  SELECT b.id, b.expected_position_counts,
         coalesce(v.actual_position_counts,'{}'::jsonb) AS actual_position_counts,
         coalesce(v.actual_count,0)::bigint AS actual_count,
         coalesce(v.invalid_rows,0)::bigint AS invalid_rows,
         coalesce((SELECT sum(value::bigint)
                   FROM jsonb_each_text(b.expected_position_counts)),0)::bigint AS expected_count
  FROM election_ballots b LEFT JOIN per_ballot v ON v.ballot_id=b.id
),
aggregated AS (
  SELECT count(*)::bigint AS ballot_rows,
         count(*) FILTER (WHERE expected_position_counts IS NOT NULL)::bigint AS committed_ballots,
         count(*) FILTER (WHERE expected_position_counts IS NULL)::bigint AS legacy_ballots,
         count(*) FILTER (WHERE expected_position_counts IS NOT NULL
           AND expected_position_counts IS DISTINCT FROM actual_position_counts)::bigint AS mismatched_ballots,
         coalesce(sum(expected_count),0)::bigint AS expected_selections,
         coalesce(sum(actual_count),0)::bigint AS actual_selections,
         coalesce(sum(invalid_rows),0)::bigint AS invalid_vote_rows
  FROM compared
),
-- A row attributed to this election but attached to a ballot from a different
-- election is also invalid, even though it is not part of election_ballots.
cross_election AS (
  SELECT count(*)::bigint AS invalid_rows
  FROM public.ballot_votes bv JOIN public.ballots b ON b.id=bv.ballot_id
  WHERE bv.election_id=p_election_id AND b.election_id <> p_election_id
)
SELECT jsonb_build_object(
  'ballotRows',a.ballot_rows,
  'committedBallots',a.committed_ballots,
  'legacyBallots',a.legacy_ballots,
  'mismatchedBallots',a.mismatched_ballots,
  'expectedSelections',a.expected_selections,
  'actualSelections',a.actual_selections,
  'invalidVoteRows',a.invalid_vote_rows,
  'crossElectionVoteRows',x.invalid_rows
)
FROM aggregated a CROSS JOIN cross_election x;
$hoa_ballot_integrity_summary$;

REVOKE EXECUTE ON FUNCTION public.hoa_submit_ballot(bigint,bigint,uuid,text,jsonb)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hoa_submit_ballot(bigint,bigint,uuid,text,jsonb)
  TO service_role;
REVOKE EXECUTE ON FUNCTION public.hoa_ballot_integrity_summary(bigint)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hoa_ballot_integrity_summary(bigint)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'v2.5.4 anonymous ballot commitments installed (historical ballots remain unverified)' AS status;
