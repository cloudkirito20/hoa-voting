-- HOA Secure Vote migration: allow confirmed permanent deletion of OPEN elections.
-- Safe to run on an existing installation. This migration does not delete data by itself.
-- It only updates the database guard/delete functions used by the admin delete action.

-- Keep position changes locked after voting starts, except while the controlled
-- hoa_delete_election() transaction is intentionally cascading a whole election delete.
create or replace function public.hoa_guard_position_changes()
returns trigger language plpgsql set search_path=public as $$
declare eid bigint;
begin
  if TG_OP = 'DELETE' then eid := OLD.election_id; else eid := NEW.election_id; end if;
  if coalesce(current_setting('hoa.allow_election_delete', true), '') <> 'on'
     and exists(select 1 from public.elections where id=eid and status <> 'draft') then
    raise exception 'Positions are locked once voting opens.';
  end if;
  if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
end; $$;

-- Same protection for candidates.
create or replace function public.hoa_guard_candidate_changes()
returns trigger language plpgsql set search_path=public as $$
declare pid bigint; eid bigint;
begin
  if TG_OP = 'DELETE' then pid := OLD.position_id; else pid := NEW.position_id; end if;
  select election_id into eid from public.positions where id=pid;
  if coalesce(current_setting('hoa.allow_election_delete', true), '') <> 'on'
     and exists(select 1 from public.elections where id=eid and status <> 'draft') then
    raise exception 'Candidates are locked once voting opens.';
  end if;
  if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
end; $$;

-- Permanently delete an election in any status (Draft, Open, or Closed) together
-- with its election-scoped positions, candidates, participation, ballots, votes,
-- and related audit entries. Registered voter accounts are intentionally retained.
create or replace function public.hoa_delete_election(p_election_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.elections%rowtype;
  position_ids bigint[];
  candidate_ids bigint[];
begin
  select * into e from public.elections where id=p_election_id;
  if not found then raise exception 'Election not found.'; end if;

  select coalesce(array_agg(id), '{}'::bigint[]) into position_ids
  from public.positions where election_id=p_election_id;

  select coalesce(array_agg(c.id), '{}'::bigint[]) into candidate_ids
  from public.candidates c
  join public.positions p on p.id=c.position_id
  where p.election_id=p_election_id;

  delete from public.audit_log
  where (entity_type='election' and entity_id=p_election_id::text)
     or (entity_type='position' and entity_id in (select x::text from unnest(position_ids) as t(x)))
     or (entity_type='candidate' and entity_id in (select x::text from unnest(candidate_ids) as t(x)))
     or details->>'electionId'=p_election_id::text;

  -- Local to this transaction. This lets ON DELETE CASCADE remove locked ballot
  -- configuration without weakening the normal post-open edit restrictions.
  perform set_config('hoa.allow_election_delete','on',true);
  delete from public.elections where id=p_election_id;

  return jsonb_build_object(
    'id',e.id,
    'title',e.title,
    'status',e.status,
    'deleted',true
  );
end;
$$;

revoke execute on function public.hoa_delete_election(bigint) from public, anon, authenticated;
grant execute on function public.hoa_delete_election(bigint) to service_role;
