-- HOA election database Step 2, PART 5 of 6
-- Add candidate and position locks and election deletion protection.
-- Run this file as a WHOLE in a NEW Supabase SQL Editor query.
-- Use only on the NEW project where Step 1 Tables/RLS completed.
-- Confirm the last line is SELECT 'PART 5 OF 6 COMPLETE'.
-- STOP if this query reports an error; do not proceed to the next part.

begin;

create or replace function public.hoa_guard_position_changes()
returns trigger language plpgsql set search_path=public as $hoa_guard_position_changes$
declare eid bigint;
begin
  if TG_OP = 'DELETE' then eid := OLD.election_id; else eid := NEW.election_id; end if;
  if coalesce(current_setting('hoa.allow_election_delete', true), '') <> 'on' and exists(select 1 from public.elections where id=eid and status <> 'draft') then
    raise exception 'Positions are locked once voting opens.';
  end if;
  if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
end; $hoa_guard_position_changes$;

drop trigger if exists trg_guard_positions on public.positions;
create trigger trg_guard_positions before insert or update or delete on public.positions
for each row execute function public.hoa_guard_position_changes();

create or replace function public.hoa_guard_candidate_changes()
returns trigger language plpgsql set search_path=public as $hoa_guard_candidate_changes$
declare pid bigint; eid bigint;
begin
  if TG_OP = 'DELETE' then pid := OLD.position_id; else pid := NEW.position_id; end if;
  select election_id into eid from public.positions where id=pid;
  if coalesce(current_setting('hoa.allow_election_delete', true), '') <> 'on' and exists(select 1 from public.elections where id=eid and status <> 'draft') then
    raise exception 'Candidates are locked once voting opens.';
  end if;
  if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
end; $hoa_guard_candidate_changes$;

drop trigger if exists trg_guard_candidates on public.candidates;
create trigger trg_guard_candidates before insert or update or delete on public.candidates
for each row execute function public.hoa_guard_candidate_changes();

create or replace function public.hoa_delete_election(p_election_id bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $hoa_delete_election$
declare e public.elections%rowtype;
begin
  select * into e from public.elections where id=p_election_id for update;
  if not found then raise exception 'Election not found.'; end if;
  if exists(select 1 from public.ballots where election_id=p_election_id)
    or exists(select 1 from public.voter_participation where election_id=p_election_id) then
    raise exception 'An election with submitted ballots cannot be deleted. Preserve the election records.';
  end if;
  perform set_config('hoa.allow_election_delete','on',true);
  delete from public.elections where id=p_election_id;
  return jsonb_build_object('id',e.id,'title',e.title,'status',e.status,'deleted',true);
end;
$hoa_delete_election$;

-- These functions are for the server-side Cloudflare Worker only.
revoke execute on function public.hoa_delete_election(bigint) from public, anon, authenticated;
grant execute on function public.hoa_delete_election(bigint) to service_role;

commit;

select 'PART 5 OF 6 COMPLETE' as status;
