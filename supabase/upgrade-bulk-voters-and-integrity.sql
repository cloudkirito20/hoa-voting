-- HOA Secure Vote v2.1 migration. Run AFTER schema.sql on an existing or new project.
-- Back up your Supabase database and review duplicate existing voter units first.
-- This migration NEVER creates voter accounts or issues passwords by itself.
-- One voting account per Block + Lot is enforced; confirm that this matches HOA rules.

begin;

-- A duplicate block+lot now fails loudly rather than allowing two ballot accounts.
-- Existing duplicates must be reconciled manually before this index can be built.
create unique index if not exists users_voter_unit_uq
on public.users ((lower(btrim(block))), (lower(btrim(lot))))
where role = 'voter';

create index if not exists idx_login_attempts_ip_user_time
on public.login_attempts (ip, username, attempted_at);

-- The original exact ballots.submitted_at timestamp was recorded in the same
-- transaction as voter_participation.voted_at. A database operator could match
-- those exact timestamps and infer who cast a particular ballot. Remove the
-- exact timestamp from the anonymous ballots table. Identity-linked participation
-- timestamps remain available for the participation report.
-- IMPORTANT: This removes the old ballot timestamps, including historical values.
drop index if exists public.idx_ballots_election;
alter table public.ballots drop column if exists submitted_at;
create index if not exists idx_ballots_election on public.ballots(election_id);

-- Guard both single-voter and bulk-voter registration after an election opens.
create or replace function public.hoa_create_user(
  p_username text, p_password text, p_role text, p_full_name text,
  p_block text default null, p_lot text default null
) returns bigint
language plpgsql security definer set search_path = public, extensions
as $$
declare new_id bigint;
begin
  if p_role not in ('admin','voter') then raise exception 'Invalid user role.'; end if;
  if length(coalesce(p_password,'')) < 8 then raise exception 'Password is too short.'; end if;
  if p_role = 'voter' and exists(select 1 from public.elections where status='open') then
    raise exception 'Voter registration is locked while an election is open.';
  end if;
  insert into public.users(username,password_hash,role,full_name,block,lot,active)
  values(btrim(p_username), crypt(p_password,gen_salt('bf',10)), p_role,
    btrim(p_full_name), nullif(btrim(p_block),''), nullif(btrim(p_lot),''), true)
  returning id into new_id;
  return new_id;
end;
$$;

-- Batch transaction: either every account in the chunk is created, or none are.
-- Passwords are sent only by the trusted Worker and are NEVER persisted in plaintext.
create or replace function public.hoa_bulk_create_voters(p_voters jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v jsonb; v_name text; v_block text; v_lot text; v_username text; v_password text;
  new_id bigint; results jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_voters) is distinct from 'array' then
    raise exception 'Expected an array of voters.';
  end if;
  if jsonb_array_length(p_voters) < 1 or jsonb_array_length(p_voters) > 20 then
    raise exception 'Bulk requests must contain between 1 and 20 voters.';
  end if;
  if exists(select 1 from public.elections where status='open') then
    raise exception 'Voter registration is locked while an election is open.';
  end if;

  for v in select value from jsonb_array_elements(p_voters)
  loop
    v_name := btrim(coalesce(v->>'fullName',''));
    v_block := btrim(coalesce(v->>'block',''));
    v_lot := btrim(coalesce(v->>'lot',''));
    v_username := btrim(coalesce(v->>'username',''));
    v_password := coalesce(v->>'password','');
    if length(v_name) < 1 or length(v_name) > 100
       or length(v_block) < 1 or length(v_block) > 40
       or length(v_lot) < 1 or length(v_lot) > 40 then
      raise exception 'Name/Block/Lot is missing or too long.';
    end if;
    if v_username !~ '^HOA-[A-HJ-NP-Z2-9]{8}$' or length(v_password) < 12 then
      raise exception 'Invalid generated credentials.';
    end if;
    insert into public.users(username,password_hash,role,full_name,block,lot,active)
    values (v_username,crypt(v_password,gen_salt('bf',10)),'voter',v_name,v_block,v_lot,true)
    returning id into new_id;
    results := results || jsonb_build_array(jsonb_build_object(
      'id',new_id,'username',v_username,'fullName',v_name,'block',v_block,'lot',v_lot));
  end loop;
  return results;
end;
$$;

-- Freeze the state of the election row while submitting a ballot. Closing the
-- election cannot commit between the open-state check and ballot insertion.
create or replace function public.hoa_submit_ballot(
  p_user_id bigint, p_election_id bigint, p_ballot_id uuid,
  p_receipt_code text, p_selections jsonb
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  entry record; pos_id bigint; allowed_seats integer; selected_count integer;
  distinct_count integer; valid_count integer; total_selected integer := 0;
begin
  if not exists(select 1 from public.users where id=p_user_id and role='voter' and active=true) then
    raise exception 'Voter account is not active.';
  end if;
  perform 1 from public.elections where id=p_election_id and status='open' for share;
  if not found then raise exception 'This election is not open.'; end if;
  if exists(select 1 from public.voter_participation where user_id=p_user_id and election_id=p_election_id) then
    raise exception 'This voter account has already submitted a ballot.';
  end if;
  if jsonb_typeof(p_selections) <> 'object' then raise exception 'Invalid ballot.'; end if;
  for entry in select * from jsonb_each(p_selections)
  loop
    if entry.key !~ '^[0-9]+$' or jsonb_typeof(entry.value) <> 'array' then
      raise exception 'Ballot contains an invalid position.';
    end if;
    pos_id := entry.key::bigint;
    select seats into allowed_seats from public.positions where id=pos_id and election_id=p_election_id;
    if allowed_seats is null then raise exception 'Ballot contains an invalid position.'; end if;
    selected_count := jsonb_array_length(entry.value);
    if selected_count > allowed_seats then raise exception 'Too many selections for a position.'; end if;
    if selected_count = 0 then continue; end if;
    select count(*),count(distinct v::bigint) into selected_count,distinct_count
    from jsonb_array_elements_text(entry.value) as x(v) where v ~ '^[0-9]+$';
    if selected_count <> jsonb_array_length(entry.value) or distinct_count <> selected_count then
      raise exception 'Ballot contains invalid or duplicate candidate selections.';
    end if;
    select count(*) into valid_count from public.candidates c
    where c.position_id=pos_id and c.id in
      (select v::bigint from jsonb_array_elements_text(entry.value) as x(v));
    if valid_count <> selected_count then raise exception 'Ballot contains an invalid candidate selection.'; end if;
    total_selected := total_selected + selected_count;
  end loop;
  if total_selected < 1 then raise exception 'Select at least one candidate before submitting.'; end if;
  insert into public.voter_participation(user_id,election_id,receipt_code)
  values(p_user_id,p_election_id,p_receipt_code);
  insert into public.ballots(id,election_id) values(p_ballot_id,p_election_id);
  for entry in select * from jsonb_each(p_selections)
  loop
    pos_id := entry.key::bigint;
    insert into public.ballot_votes(ballot_id,election_id,position_id,candidate_id)
    select p_ballot_id,p_election_id,pos_id,v::bigint
    from jsonb_array_elements_text(entry.value) as x(v);
  end loop;
  return p_receipt_code;
exception
  when unique_violation then
    raise exception 'This voter account has already submitted a ballot.';
end;
$$;

-- Do not let an administrator delete an election once any ballot has been cast.
-- Keep audit logs even when an unused/draft election is removed.
create or replace function public.hoa_delete_election(p_election_id bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
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
$$;

-- Aggregate inside PostgreSQL. PostgREST otherwise truncates raw vote rows
-- (often at 1,000 rows), silently undercounting multi-position HOA elections.
create or replace function public.hoa_candidate_vote_totals(p_election_id bigint)
returns table(candidate_id bigint, votes bigint)
language sql stable security definer set search_path = public
as $$
  select bv.candidate_id, count(*)::bigint as votes
  from public.ballot_votes bv
  where bv.election_id = p_election_id
  group by bv.candidate_id;
$$;
revoke execute on function public.hoa_candidate_vote_totals(bigint) from public, anon, authenticated;
grant execute on function public.hoa_candidate_vote_totals(bigint) to service_role;

revoke execute on function public.hoa_bulk_create_voters(jsonb) from public, anon, authenticated;
grant execute on function public.hoa_bulk_create_voters(jsonb) to service_role;
revoke execute on function public.hoa_create_user(text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.hoa_create_user(text,text,text,text,text,text) to service_role;
revoke execute on function public.hoa_submit_ballot(bigint,bigint,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.hoa_submit_ballot(bigint,bigint,uuid,text,jsonb) to service_role;
revoke execute on function public.hoa_delete_election(bigint) from public, anon, authenticated;
grant execute on function public.hoa_delete_election(bigint) to service_role;

notify pgrst, 'reload schema';
commit;
