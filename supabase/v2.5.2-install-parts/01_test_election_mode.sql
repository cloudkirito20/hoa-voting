-- Casa Verde de Banaderos HOA v2.5.2: Explicit TEST vs OFFICIAL elections.
-- Run after verifying v2.2-v2.5.1, on a BACKUP/STAGING CLONE first.
-- Existing elections DEFAULT TO OFFICIAL. The single previously verified mock
-- election ID 2 is labeled TEST only if its exact prior preflight still matches.
-- This script DOES NOT delete any elections, votes, voters, or passwords.
-- CLOSED TEST elections may later be deleted by the NEW guarded admin RPC.
-- OFFICIAL elections are never deletable through that RPC, even as drafts.
BEGIN;

ALTER TABLE public.elections
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.elections.is_test IS
  'Immutable classification set at creation. FALSE=OFFICIAL protected election; TRUE=deletable test/practice election after voting closes.';

-- Only the historically confirmed mock election may be reclassified here.
-- A changed title, status, creation minute or record count makes the entire
-- migration abort without changing classification. Do not weaken these checks.
DO $legacy_mock_reclassification$
DECLARE
  item record;
  ballots_n bigint;
  participation_n bigint;
  votes_n bigint;
  positions_n bigint;
  candidates_n bigint;
  committee_n bigint;
BEGIN
  SELECT id,title,status,created_at,is_test INTO item
    FROM public.elections WHERE id=2 FOR UPDATE;
  IF item.id IS NOT NULL AND NOT item.is_test THEN
    SELECT count(*) INTO ballots_n FROM public.ballots WHERE election_id=2;
    SELECT count(*) INTO participation_n FROM public.voter_participation WHERE election_id=2;
    SELECT count(*) INTO votes_n FROM public.ballot_votes WHERE election_id=2;
    SELECT count(*) INTO positions_n FROM public.positions WHERE election_id=2;
    SELECT count(*) INTO candidates_n FROM public.candidates c
      JOIN public.positions p ON c.position_id=p.id WHERE p.election_id=2;
    SELECT count(*) INTO committee_n FROM public.election_committee_members WHERE election_id=2;

    IF item.title IS DISTINCT FROM '2026 Hoa Election'
       OR item.status IS DISTINCT FROM 'closed'
       OR to_char(item.created_at AT TIME ZONE 'Asia/Manila','YYYY-MM-DD HH24:MI')
            IS DISTINCT FROM '2026-10-17 16:14'
       OR ballots_n<>1 OR participation_n<>1 OR votes_n<>2
       OR positions_n<>1 OR candidates_n<>4 OR committee_n<>2 THEN
      RAISE EXCEPTION 'Election ID 2 differs from the verified mock preflight; no election types changed. Reinspect ID 2 before installing v2.5.2.';
    END IF;

    UPDATE public.elections SET is_test=true WHERE id=2;
    INSERT INTO public.audit_log(action,entity_type,entity_id,details)
    VALUES ('election.legacy_mock_tagged','election','2',
       jsonb_build_object('title',item.title,'createdAt',item.created_at,
                          'previouslyVerifiedAsMock',true,'byMigration','v2.5.2'));
  END IF;
END;
$legacy_mock_reclassification$;

-- Classification must not be switched by the UI, Worker or direct API update.
CREATE OR REPLACE FUNCTION public.hoa_guard_election_type_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path=public
AS $hoa_guard_election_type_immutable$
BEGIN
  IF NEW.is_test IS DISTINCT FROM OLD.is_test THEN
    RAISE EXCEPTION 'Election type (Official/Test) is permanent after creation.';
  END IF;
  RETURN NEW;
END;
$hoa_guard_election_type_immutable$;

DROP TRIGGER IF EXISTS trg_hoa_guard_election_type_immutable ON public.elections;
CREATE TRIGGER trg_hoa_guard_election_type_immutable
BEFORE UPDATE OF is_test ON public.elections
FOR EACH ROW EXECUTE FUNCTION public.hoa_guard_election_type_immutable();

-- Direct table deletion remains blocked. Only the guarded RPC for closed/draft
-- TEST elections can set the transaction-local authorization marker.
CREATE OR REPLACE FUNCTION public.hoa_guard_election_delete_mode()
RETURNS trigger LANGUAGE plpgsql SET search_path=public
AS $hoa_guard_election_delete_mode$
BEGIN
  IF NOT OLD.is_test THEN
    RAISE EXCEPTION 'Official elections cannot be deleted.';
  END IF;
  IF OLD.status = 'open' THEN
    RAISE EXCEPTION 'Close test voting before deleting the test election.';
  END IF;
  IF current_setting('hoa.allow_test_election_delete',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Use the confirmed test-election deletion workflow.';
  END IF;
  RETURN OLD;
END;
$hoa_guard_election_delete_mode$;

DROP TRIGGER IF EXISTS trg_hoa_guard_election_delete_mode ON public.elections;
CREATE TRIGGER trg_hoa_guard_election_delete_mode
BEFORE DELETE ON public.elections
FOR EACH ROW EXECUTE FUNCTION public.hoa_guard_election_delete_mode();

-- New, auditable, restricted RPC. It never changes or deletes user records.
CREATE OR REPLACE FUNCTION public.hoa_delete_test_election(
  p_election_id bigint, p_admin_id bigint, p_confirm_title text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $hoa_delete_test_election$
DECLARE
  e public.elections%ROWTYPE;
  n_ballots bigint;
  n_participation bigint;
  n_votes bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(73014902);
  IF NOT EXISTS (SELECT 1 FROM public.users
                 WHERE id=p_admin_id AND role='admin' AND active=true) THEN
    RAISE EXCEPTION 'Active administrator required.';
  END IF;
  SELECT * INTO e FROM public.elections WHERE id=p_election_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Election not found.'; END IF;
  IF e.is_test IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Official elections cannot be deleted.';
  END IF;
  IF e.status='open' THEN
    RAISE EXCEPTION 'Close test voting before deleting the test election.';
  END IF;
  IF p_confirm_title IS DISTINCT FROM e.title THEN
    RAISE EXCEPTION 'Type the exact test election title to confirm deletion.';
  END IF;
  SELECT count(*) INTO n_ballots FROM public.ballots WHERE election_id=p_election_id;
  SELECT count(*) INTO n_participation FROM public.voter_participation WHERE election_id=p_election_id;
  SELECT count(*) INTO n_votes FROM public.ballot_votes WHERE election_id=p_election_id;

  -- Keep the audit record after the test election is removed.
  INSERT INTO public.audit_log(admin_user_id,action,entity_type,entity_id,details)
  VALUES(p_admin_id,'election.test_deleted','election',e.id::text,
    jsonb_build_object('title',e.title,'wasTest',true,'status',e.status,
      'ballotsDeleted',n_ballots,'participationDeleted',n_participation,
      'candidateVotesDeleted',n_votes));

  -- Position/candidate locks already support this transaction-local flag.
  PERFORM set_config('hoa.allow_election_delete','on',true);
  PERFORM set_config('hoa.allow_test_election_delete','on',true);
  DELETE FROM public.elections WHERE id=e.id;
  RETURN jsonb_build_object('id',e.id,'title',e.title,'isTest',true,
    'deleted',true,'ballotsDeleted',n_ballots,
    'participationDeleted',n_participation);
END;
$hoa_delete_test_election$;

-- The legacy RPC bypasses neither the new trigger nor the new classification.
-- Revoking it also prevents an older deployed Worker from deleting elections.
REVOKE EXECUTE ON FUNCTION public.hoa_delete_election(bigint)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.hoa_delete_test_election(bigint,bigint,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hoa_delete_test_election(bigint,bigint,text)
  TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
SELECT 'PASS 2.5.2-1: immutable Official/Test classification and guarded deletion' AS status;
