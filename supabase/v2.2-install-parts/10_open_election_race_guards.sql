-- HOA SECURE VOTE v2.2 / Part 10 - optional recommended race hardening
-- Apply after parts 01..08 and before deploying the new Worker.
-- No ballots or voter accounts are deleted.

begin;

-- Common advisory lock serializes voter creation/activation with opening polls.
-- These triggers protect even against a future Worker implementation mistake.
create or replace function public.hoa_guard_live_voter_registration()
returns trigger language plpgsql set search_path=public
as $hoa_guard_live_voter_registration$
declare needs_check boolean := false;
begin
  if TG_OP = 'INSERT' then
    needs_check := NEW.role = 'voter';
  elsif TG_OP = 'UPDATE' then
    needs_check := NEW.role = 'voter' and NEW.active and not OLD.active;
  end if;
  if needs_check then
    perform pg_advisory_xact_lock(73014902);
    if exists(select 1 from public.elections where status='open') then
      raise exception 'Voter registration and activation are locked while an election is open.';
    end if;
  end if;
  return NEW;
end;
$hoa_guard_live_voter_registration$;

drop trigger if exists trg_guard_live_voter_registration on public.users;
create trigger trg_guard_live_voter_registration
before insert or update on public.users
for each row execute function public.hoa_guard_live_voter_registration();

create or replace function public.hoa_guard_election_status_change()
returns trigger language plpgsql set search_path=public
as $hoa_guard_election_status_change$
begin
  if OLD.status = 'closed' and NEW.status <> 'closed' then
    raise exception 'A closed election cannot be reopened.';
  end if;
  if OLD.status = 'open' and NEW.status = 'draft' then
    raise exception 'An opened election cannot return to draft.';
  end if;
  if OLD.status <> 'open' and NEW.status='open' then
    perform pg_advisory_xact_lock(73014902);
  end if;
  return NEW;
end;
$hoa_guard_election_status_change$;

drop trigger if exists trg_guard_election_status_change on public.elections;
create trigger trg_guard_election_status_change
before update of status on public.elections
for each row execute function public.hoa_guard_election_status_change();

commit;
select 'PASS Security Upgrade Part 10 - election race guards' as status;
