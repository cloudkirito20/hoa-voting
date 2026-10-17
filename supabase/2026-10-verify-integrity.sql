-- READ-ONLY checks. Run after both upgrade SQL parts. Does NOT cast votes.
select
  (select count(*) from information_schema.columns where table_schema='public' and table_name='users' and column_name in ('must_change_password','password_changed_at')) as password_columns_found,
  to_regprocedure('public.hoa_change_own_password(bigint,text,text)') is not null as password_change_rpc_found,
  to_regprocedure('public.hoa_submit_ballot(bigint,bigint,uuid,text,jsonb)') is not null as vote_rpc_found,
  to_regprocedure('public.hoa_bootstrap_admin(text,text,text)') is not null as bootstrap_rpc_found,
  (select count(*) from pg_indexes where schemaname='public' and tablename='users' and indexname='users_one_voter_per_normalized_homeowner_uq') = 1 as homeowner_unique_index,
  (select count(*) from public.users where role='voter' and password_changed_at is null and must_change_password=false) = 0 as unverified_initial_passwords_none,
  not has_function_privilege('anon','public.hoa_change_own_password(bigint,text,text)','EXECUTE') as anon_cannot_change_password,
  not has_function_privilege('authenticated','public.hoa_change_own_password(bigint,text,text)','EXECUTE') as authenticated_cannot_call_rpc;
