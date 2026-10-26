-- HOA Voting v2.5.5: automatic start for scheduled Draft elections.
-- IMPORTANT: Test in staging FIRST. Production deployment must be approved.
-- No existing election's schedule, votes, candidates, status, or eligibility is
-- changed by INSTALLATION. The existing scheduled draft WILL automatically open
-- when its start time arrives, as requested by the election administrator.
-- A NULL voting_starts_at keeps legacy manual-opening behavior.
-- The database's existing opening trigger captures eligible_voters_at_open.
BEGIN;

-- The existing HOA 2.3 automatic closure function must already be installed.
DO $check_required$
BEGIN
  IF to_regprocedure('public.hoa_close_expired_elections()') IS NULL THEN
    RAISE EXCEPTION 'Install the v2.3 automatic-closure migration first.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='elections' AND column_name='voting_starts_at') THEN
    RAISE EXCEPTION 'The election start/end time migration is missing.';
  END IF;
  IF to_regclass('public.audit_log') IS NULL THEN
    RAISE EXCEPTION 'The HOA audit-log table is missing.';
  END IF;
END $check_required$;

CREATE OR REPLACE FUNCTION public.hoa_open_scheduled_elections()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $hoa_open_scheduled_elections$
DECLARE
  entry record;
  affected integer := 0;
BEGIN
  -- Expired open elections are closed first. This releases the existing
  -- one_open_election_uq constraint before any new scheduled election opens.
  PERFORM public.hoa_close_expired_elections();

  -- Never override a different election that remains genuinely open.
  IF EXISTS (SELECT 1 FROM public.elections WHERE status = 'open') THEN
    RETURN 0;
  END IF;

  -- Earlier scheduled election wins if multiple elections are due; others
  -- remain Draft until the open one closes, if their deadline has not passed.
  FOR entry IN
    SELECT e.id,e.voting_starts_at
    FROM public.elections e
    WHERE e.status = 'draft'
      AND e.voting_starts_at IS NOT NULL
      AND e.voting_starts_at <= clock_timestamp()
      AND e.voting_ends_at > clock_timestamp()
    ORDER BY e.voting_starts_at,e.id
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Do not open an unfinished ballot. ALL positions need candidates.
    IF NOT EXISTS(SELECT 1 FROM public.positions p WHERE p.election_id=entry.id)
       OR EXISTS(SELECT 1 FROM public.positions p
                 WHERE p.election_id=entry.id
                   AND NOT EXISTS(SELECT 1 FROM public.candidates c WHERE c.position_id=p.id))
       OR NOT EXISTS(SELECT 1 FROM public.users u WHERE u.role='voter' AND u.active=true)
    THEN
      CONTINUE;
    END IF;
    BEGIN
      UPDATE public.elections e
      SET status = 'open',
          opened_at = coalesce(e.opened_at, clock_timestamp()),
          updated_at = clock_timestamp()
      WHERE e.id=entry.id AND e.status='draft'
        AND e.voting_starts_at IS NOT NULL
        AND e.voting_starts_at <= clock_timestamp()
        AND e.voting_ends_at > clock_timestamp()
        AND NOT EXISTS(SELECT 1 FROM public.elections other
                       WHERE other.id <> e.id AND other.status='open');
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected > 0 THEN
        -- System actor: no voter identity or ballot selection is logged here.
        INSERT INTO public.audit_log(admin_user_id,action,entity_type,entity_id,details)
        VALUES(NULL,'election.auto_open','election',entry.id::text,
          jsonb_build_object('scheduledStartAt',entry.voting_starts_at,
                             'actualOpenedAt',clock_timestamp(),
                             'mode','automatic'));
        RETURN affected;
      END IF;
    EXCEPTION WHEN unique_violation THEN
      -- Concurrent manual/automatic activation already opened an election.
      -- The statement and any trigger changes roll back atomically.
      RETURN 0;
    END;
  END LOOP;
  RETURN 0;
END;
$hoa_open_scheduled_elections$;

REVOKE EXECUTE ON FUNCTION public.hoa_open_scheduled_elections()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hoa_open_scheduled_elections() TO service_role;

-- Independent database scheduler, not dependent on Cloudflare Worker requests.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
  'hoa-voting-election-schedule',
  '* * * * *',
  'SELECT public.hoa_open_scheduled_elections()'
);

NOTIFY pgrst, 'reload schema';
COMMIT;
