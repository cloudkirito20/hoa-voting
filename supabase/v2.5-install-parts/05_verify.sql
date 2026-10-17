-- HOA Voting v2.5 / 5 of 5: read-only verification.
select
  (to_regclass('public.voter_vouchers') is not null) as encrypted_vouchers_table,
  (to_regclass('public.election_committee_members') is not null) as committee_table,
  (select count(*)=2 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('voter_vouchers','election_committee_members') and c.relrowsecurity) as new_tables_rls,
  to_regprocedure('public.hoa_create_voter_with_voucher(text,text,text,text,text,text,text)') is not null as create_voter_atomic,
  to_regprocedure('public.hoa_bulk_create_voters_with_vouchers(jsonb)') is not null as bulk_voters_atomic,
  to_regprocedure('public.hoa_reset_password_with_voucher(bigint,text,text,text)') is not null as reset_voter_atomic,
  to_regprocedure('public.hoa_replace_election_committee(bigint,jsonb)') is not null as committee_update_atomic,
  exists(select 1 from pg_trigger where tgname='trg_hoa_purge_stale_voucher' and not tgisinternal) as purge_on_change,
  exists(select 1 from pg_trigger where tgname='trg_hoa_guard_live_voter_mutations' and not tgisinternal) as freeze_admin_changes_while_open;
