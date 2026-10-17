-- HOA election database Step 2, PART 1 of 6
-- Create the one-session trigger and voter/admin user creation.
-- Run this file as a WHOLE in a NEW Supabase SQL Editor query.
-- Use only on the NEW project where Step 1 Tables/RLS completed.
-- Confirm the last line is SELECT 'PART 1 OF 6 COMPLETE'.
-- STOP if this query reports an error; do not proceed to the next part.

begin;

create or replace function public.hoa_enforce_single_voter_session()
returns trigger
language plpgsql
set search_path = public
as $hoa_enforce_single_voter_session$
declare
  account_role text;
begin
  select role into account_role
  from public.users
  where id = NEW.user_id
  for update;

  if account_role is null then
    raise exception 'User account not found.';
  end if;

  -- Remove this user's expired sessions before checking for an active one.
  delete from public.sessions
  where user_id = NEW.user_id
    and expires_at <= now();

  if account_role = 'voter' and exists (
    select 1 from public.sessions
    where user_id = NEW.user_id
      and expires_at > now()
  ) then
    raise exception 'This voter account is already signed in on another device. Please log out there first before signing in here.';
  end if;

  return NEW;
end;
$hoa_enforce_single_voter_session$;

drop trigger if exists trg_single_voter_session on public.sessions;
create trigger trg_single_voter_session
before insert on public.sessions
for each row execute function public.hoa_enforce_single_voter_session();

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
  insert into public.users(username,password_hash,role,full_name,block,lot,active)
  values(btrim(p_username), crypt(p_password,gen_salt('bf',10)), p_role,
    btrim(p_full_name), nullif(btrim(p_block),''), nullif(btrim(p_lot),''), true)
  returning id into new_id;
  return new_id;
end;
$hoa_create_user$;

-- These functions are for the server-side Cloudflare Worker only.
revoke execute on function public.hoa_create_user(text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.hoa_create_user(text,text,text,text,text,text) to service_role;

commit;

select 'PART 1 OF 6 COMPLETE' as status;
