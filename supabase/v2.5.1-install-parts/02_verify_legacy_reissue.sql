-- HOA Voting v2.5.1 read-only verification. No changes to any account.
select
  to_regprocedure('public.hoa_reissue_legacy_vouchers(bigint,jsonb)') is not null as legacy_reissue_rpc_found,
  has_function_privilege('service_role', 'public.hoa_reissue_legacy_vouchers(bigint,jsonb)', 'EXECUTE') as service_role_may_reissue,
  not has_function_privilege('anon', 'public.hoa_reissue_legacy_vouchers(bigint,jsonb)', 'EXECUTE') as anon_cannot_reissue,
  not has_function_privilege('authenticated', 'public.hoa_reissue_legacy_vouchers(bigint,jsonb)', 'EXECUTE') as authenticated_cannot_reissue,
  exists(select 1 from pg_trigger where tgname='trg_hoa_purge_stale_voucher' and not tgisinternal) as stale_voucher_purge_trigger,
  exists(select 1 from pg_trigger where tgname='trg_hoa_guard_live_voter_mutations' and not tgisinternal) as live_election_mutation_guard,
  not exists(select 1 from public.elections where status='open') as safe_to_reissue_now;
