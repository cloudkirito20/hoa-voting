-- HOA Secure Vote v2.4 Part 1 - immutable technical voter-count snapshot.
-- Apply only after v2.2 and v2.3 migrations. Non-destructive for existing elections.
-- Does NOT certify member eligibility or change one-homeowner-one-account rules.
-- Previously opened/closed elections are intentionally not backfilled.
begin;

alter table public.elections
  add column if not exists eligible_voters_at_open integer;

create or replace function public.hoa_capture_opening_voter_count()
returns trigger language plpgsql set search_path = public
as $hoa_capture_opening_voter_count$
declare n integer;
begin
  if OLD.status='draft' and NEW.status='open' then
    -- This is the same lock used by the live-registration guard. Opening the
    -- polls and creating a new voter account cannot race past each other.
    perform pg_advisory_xact_lock(73014902);
    if NEW.eligible_voters_at_open is distinct from OLD.eligible_voters_at_open then
      raise exception 'The voter count at opening is managed by the database.';
    end if;
    select count(*)::integer into n from public.users
      where role='voter' and active=true;
    if n < 1 then raise exception 'Cannot open voting without registered active voter accounts.'; end if;
    NEW.eligible_voters_at_open := n;
  elsif OLD.status <> 'draft' and
    NEW.eligible_voters_at_open is distinct from OLD.eligible_voters_at_open then
    raise exception 'The voter count at opening is immutable.';
  end if;
  return NEW;
end;
$hoa_capture_opening_voter_count$;

drop trigger if exists trg_hoa_capture_opening_voter_count on public.elections;
create trigger trg_hoa_capture_opening_voter_count
before update of status, eligible_voters_at_open on public.elections
for each row execute function public.hoa_capture_opening_voter_count();

notify pgrst, 'reload schema';
commit;
select 'PASS 2.4-1: voter count snapshot at opening; historical elections untouched' as status;
