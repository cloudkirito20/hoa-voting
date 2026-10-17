-- Casa Verde de Banaderos HOA / v2.3 part 2: schedule immutability and opening guards
-- Back up Supabase first. Apply to a test project, then your Production database.
-- Run the COMPLETE file; do NOT highlight individual PL/pgSQL lines.
-- No voter, ballot, candidate, election or participation records are deleted.

begin;

create or replace function public.hoa_guard_election_timeframe()
returns trigger language plpgsql set search_path=public
as $hoa_guard_election_timeframe$
begin
  if TG_OP = 'INSERT' then
    if NEW.voting_ends_at is null then
      raise exception 'New elections must have a voting deadline.';
    end if;
  else
    if OLD.status = 'closed' and NEW.status <> 'closed' then
      raise exception 'A closed election cannot be reopened.';
    end if;
    if OLD.status = 'open' and NEW.status = 'draft' then
      raise exception 'An open election cannot return to Draft.';
    end if;
    if OLD.status <> 'draft' and
      (OLD.voting_starts_at is distinct from NEW.voting_starts_at or
       OLD.voting_ends_at is distinct from NEW.voting_ends_at) then
      raise exception 'Voting schedule is locked once the election is opened.';
    end if;
  end if;
  if NEW.voting_starts_at is not null and NEW.voting_ends_at is not null
     and NEW.voting_ends_at <= NEW.voting_starts_at then
    raise exception 'Election deadline must be after earliest opening time.';
  end if;
  if NEW.status = 'open' then
    if NEW.voting_ends_at is null or NEW.voting_ends_at <= clock_timestamp() then
      raise exception 'Cannot open an election without a future voting deadline.';
    end if;
    if NEW.voting_starts_at is not null and NEW.voting_starts_at > clock_timestamp() then
      raise exception 'Election earliest opening time has not arrived.';
    end if;
  end if;
  if NEW.status = 'closed' and NEW.closed_at is null then
    NEW.closed_at = clock_timestamp();
  end if;
  return NEW;
end;
$hoa_guard_election_timeframe$;

drop trigger if exists trg_hoa_guard_election_timeframe on public.elections;
create trigger trg_hoa_guard_election_timeframe
before insert or update on public.elections
for each row execute function public.hoa_guard_election_timeframe();

notify pgrst, 'reload schema';
commit;
select 'PASS 2.3-2: schedule immutability and opening guards' as status;
