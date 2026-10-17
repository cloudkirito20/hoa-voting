-- Read-only: do not share credentials. All true expected after v2.4 part 1.
select
  exists(select 1 from information_schema.columns
     where table_schema='public' and table_name='elections'
       and column_name='eligible_voters_at_open') as opening_snapshot_column,
  exists(select 1 from pg_trigger
     where tgrelid='public.elections'::regclass
       and tgname='trg_hoa_capture_opening_voter_count' and not tgisinternal) as opening_snapshot_trigger,
  exists(select 1 from pg_trigger
     where tgrelid='public.voter_participation'::regclass
       and tgname='trg_hoa_guard_participation_deadline' and not tgisinternal) as database_deadline_guard,
  to_regprocedure('public.hoa_candidate_vote_totals(bigint)') is not null as database_vote_tally,
  not has_function_privilege('anon','public.hoa_candidate_vote_totals(bigint)','EXECUTE') as public_vote_tally_denied,
  (select count(*) from public.elections where status in ('open','closed')
     and eligible_voters_at_open is null) as older_elections_requiring_elecom_voter_count_check;
