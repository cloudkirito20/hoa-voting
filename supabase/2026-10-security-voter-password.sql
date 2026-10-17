-- CASA VERDE HOA / Security Upgrade v2.2.0 - PART 1
-- IMPORTANT: BACK UP THE DATABASE AND TRY ON A CLONE FIRST.
-- Run this file only once the 10 tables and Step 2 voting functions have passed verification.
-- No DROP TABLE, no vote deletion, no logged passwords. This file is idempotent.
-- Apply the SQL BEFORE deploying the v2.2.0 Worker code.
-- All existing voter accounts are forced to change their issued passwords.

begin;

alter table public.users add column if not exists must_change_password boolean not null default false;
alter table public.users add column if not exists password_changed_at timestamptz;
update public.users set must_change_password=true
where role='voter' and password_changed_at is null and must_change_password=false;

-- Every newly issued voter account requires a password change.
create or replace function public.hoa_create_user(
  p_username text, p_password text, p_role text, p_full_name text,
  p_block text default null, p_lot text default null
) returns bigint
language plpgsql security definer set search_path = public, extensions
as $hoa_create_user$
declare new_id bigint;
begin
  if p_role not in ('admin','voter') then raise exception 'Invalid user role.'; end if;
  if length(coalesce(p_password,'')) < 8 then raise exception 'Password is too short.'; end if;
  if p_role = 'voter' and exists(select 1 from public.elections where status='open') then
    raise exception 'Voter registration is locked while an election is open.';
  end if;
  insert into public.users(username,password_hash,role,full_name,block,lot,active,must_change_password)
  values(btrim(p_username), crypt(p_password,gen_salt('bf',10)), p_role,
    btrim(p_full_name), nullif(btrim(p_block),''), nullif(btrim(p_lot),''), true, p_role = 'voter')
  returning id into new_id;
  return new_id;
end;
$hoa_create_user$;

-- Batch registration also sets the mandatory change flag.
create or replace function public.hoa_bulk_create_voters(p_voters jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $hoa_bulk_create_voters$
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
    insert into public.users(username,password_hash,role,full_name,block,lot,active,must_change_password)
    values (v_username,crypt(v_password,gen_salt('bf',10)),'voter',v_name,v_block,v_lot,true,true)
    returning id into new_id;
    results := results || jsonb_build_array(jsonb_build_object(
      'id',new_id,'username',v_username,'fullName',v_name,'block',v_block,'lot',v_lot));
  end loop;
  return results;
end;
$hoa_bulk_create_voters$;

-- Admin resets re-issue a temporary password, reset the flag,
-- and invalidate every existing session in the same transaction.
create or replace function public.hoa_reset_password(p_user_id bigint, p_password text)
returns boolean language plpgsql security definer set search_path=public,extensions
as $hoa_reset_password_secure$
begin
  if length(coalesce(p_password,'')) < 12 then raise exception 'Password is too short.'; end if;
  update public.users
  set password_hash=crypt(p_password,gen_salt('bf',10)), must_change_password=true,
      password_changed_at=null, updated_at=now()
  where id=p_user_id and role='voter';
  if not found then return false; end if;
  delete from public.sessions where user_id=p_user_id;
  return true;
end;
$hoa_reset_password_secure$;

-- Voters must present their CURRENT password, choose a DIFFERENT new password,
-- and can modify only the account bound to their authenticated session.
-- The Worker obtains p_user_id from the HttpOnly server-side session.
create or replace function public.hoa_change_own_password(
  p_user_id bigint, p_current_password text, p_new_password text
) returns boolean
language plpgsql security definer set search_path=public,extensions
as $hoa_change_own_password$
declare existing_hash text;
begin
  select password_hash into existing_hash from public.users
  where id=p_user_id and role='voter' and active=true for update;
  if not found then raise exception 'Voter account is not active.'; end if;
  if p_current_password is null or existing_hash is distinct from crypt(p_current_password,existing_hash) then
    raise exception 'Current password is incorrect.';
  end if;
  if length(coalesce(p_new_password,'')) < 12 or octet_length(p_new_password) > 72 then
    raise exception 'New password must contain at least 12 characters and at most 72 UTF-8 bytes.';
  end if;
  if existing_hash = crypt(p_new_password,existing_hash) then
    raise exception 'New password must differ from your current password.';
  end if;
  update public.users
  set password_hash=crypt(p_new_password,gen_salt('bf',10)),
      must_change_password=false, password_changed_at=now(), updated_at=now()
  where id=p_user_id and role='voter';
  -- An issued or captured session becomes unusable immediately after changing
  -- the password. Client is required to sign in again with its new password.
  delete from public.sessions where user_id=p_user_id;
  return true;
end;
$hoa_change_own_password$;

-- Race-free initial administrator setup: two requests cannot both create the
-- initial administrator even if both know SETUP_TOKEN.
create or replace function public.hoa_bootstrap_admin(
  p_username text, p_password text, p_full_name text
) returns bigint language plpgsql security definer set search_path=public,extensions
as $hoa_bootstrap_admin$
declare new_id bigint;
begin
  perform pg_advisory_xact_lock(73014901);
  if exists(select 1 from public.users where role='admin') then
    raise exception 'Administrator is already configured.';
  end if;
  if length(btrim(coalesce(p_username,''))) < 4 or length(btrim(p_username)) > 40
    or length(btrim(coalesce(p_full_name,''))) < 1 or length(btrim(p_full_name)) > 100
    or length(coalesce(p_password,'')) < 10 or octet_length(p_password) > 72 then
    raise exception 'Invalid administrator account details.';
  end if;
  insert into public.users(username,password_hash,role,full_name,active,must_change_password)
  values(btrim(p_username), crypt(p_password,gen_salt('bf',10)),'admin',btrim(p_full_name),true,false)
  returning id into new_id;
  return new_id;
end;
$hoa_bootstrap_admin$;

-- Critical: the database independently rejects voting with an unchanged issued password.
create or replace function public.hoa_submit_ballot(
  p_user_id bigint, p_election_id bigint, p_ballot_id uuid,
  p_receipt_code text, p_selections jsonb
) returns text
language plpgsql security definer set search_path = public
as $hoa_submit_ballot$
declare
  entry record; pos_id bigint; allowed_seats integer; selected_count integer;
  distinct_count integer; valid_count integer; total_selected integer := 0;
begin
  -- Lock the user row so a simultaneous credential reset/disable cannot race
  -- between authorization and participation insertion.
  perform 1 from public.users
  where id=p_user_id and role='voter' and active=true and must_change_password=false
  for share;
  if not found then raise exception 'Voter account is inactive or initial password change is required.'; end if;
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
$hoa_submit_ballot$;

-- Restrict sensitive RPC functions; they must only be invoked by the Worker.
revoke execute on function public.hoa_change_own_password(bigint,text,text) from public, anon, authenticated;
grant execute on function public.hoa_change_own_password(bigint,text,text) to service_role;
revoke execute on function public.hoa_bootstrap_admin(text,text,text) from public, anon, authenticated;
grant execute on function public.hoa_bootstrap_admin(text,text,text) to service_role;
revoke execute on function public.hoa_create_user(text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.hoa_create_user(text,text,text,text,text,text) to service_role;
revoke execute on function public.hoa_bulk_create_voters(jsonb) from public, anon, authenticated;
grant execute on function public.hoa_bulk_create_voters(jsonb) to service_role;
revoke execute on function public.hoa_reset_password(bigint,text) from public, anon, authenticated;
grant execute on function public.hoa_reset_password(bigint,text) to service_role;
revoke execute on function public.hoa_submit_ballot(bigint,bigint,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.hoa_submit_ballot(bigint,bigint,uuid,text,jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
select 'PASS: VOTER PASSWORD + BALLOT SECURITY v2.2' as status;
