-- READ-ONLY verification. No elections, voters, or ballots modified.
select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='elections'
      and column_name in ('voting_starts_at','voting_ends_at'))=2 as timeframe_columns_present,
  (select count(*) from pg_trigger
    where tgrelid='public.elections'::regclass and tgname='trg_hoa_guard_election_timeframe'
      and not tgisinternal)=1 as election_schedule_guard_present,
  (select count(*) from pg_trigger
    where tgrelid='public.voter_participation'::regclass and tgname='trg_hoa_guard_participation_deadline'
      and not tgisinternal)=1 as ballot_cutoff_guard_present,
  to_regprocedure('public.hoa_close_expired_elections()') is not null as close_expired_rpc_present,
  not has_function_privilege('anon','public.hoa_close_expired_elections()','EXECUTE') as close_rpc_private_from_anon,
  not has_function_privilege('authenticated','public.hoa_close_expired_elections()','EXECUTE') as close_rpc_private_from_authenticated,
  has_function_privilege('service_role','public.hoa_close_expired_elections()','EXECUTE') as close_rpc_service_role,
  (select count(*) from public.elections where status='open' and
    (voting_ends_at is null or voting_ends_at <= clock_timestamp())) as expired_open_elections_needing_close,
  (select count(*) from public.elections where status='draft' and voting_ends_at is null) as legacy_drafts_needing_deadline;
