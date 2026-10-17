-- Casa Verde de Banaderos HOA / v2.3 part 1: election deadline columns
-- Back up Supabase first. Apply to a test project, then your Production database.
-- Run the COMPLETE file; do NOT highlight individual PL/pgSQL lines.
-- No voter, ballot, candidate, election or participation records are deleted.

begin;

-- Existing/legacy elections are preserved. Missing deadlines on older OPEN
-- elections are treated as expired by the new voting guard.
alter table public.elections add column if not exists voting_starts_at timestamptz;
alter table public.elections add column if not exists voting_ends_at timestamptz;

do $hoa_time_constraint$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.elections'::regclass and conname='hoa_voting_timeframe_order_ck') then
    alter table public.elections add constraint hoa_voting_timeframe_order_ck
      check (voting_starts_at is null or voting_ends_at is null or voting_ends_at > voting_starts_at);
  end if;
end;
$hoa_time_constraint$;

create index if not exists idx_hoa_open_vote_deadline
on public.elections (voting_ends_at) where status='open';

notify pgrst, 'reload schema';
commit;
select 'PASS 2.3-1: election deadline columns' as status;
