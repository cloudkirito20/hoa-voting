-- HOA election database Step 2, PART 2 of 6
-- Add login verification and voter password-reset functions.
-- Run this file as a WHOLE in a NEW Supabase SQL Editor query.
-- Use only on the NEW project where Step 1 Tables/RLS completed.
-- Confirm the last line is SELECT 'PART 2 OF 6 COMPLETE'.
-- STOP if this query reports an error; do not proceed to the next part.

begin;

create or replace function public.hoa_verify_login(p_username text, p_password text)
returns table(id bigint, username text, role text, full_name text, block text, lot text, active boolean)
language sql
security definer
set search_path = public, extensions
as $hoa_verify_login$
  select u.id,u.username,u.role,u.full_name,u.block,u.lot,u.active
  from public.users u
  where lower(u.username)=lower(trim(p_username))
    and u.active=true
    and u.password_hash = crypt(p_password,u.password_hash)
  limit 1;
$hoa_verify_login$;

create or replace function public.hoa_reset_password(p_user_id bigint, p_password text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $hoa_reset_password$
begin
  if length(coalesce(p_password,'')) < 8 then raise exception 'Password is too short.'; end if;
  update public.users
  set password_hash=crypt(p_password,gen_salt('bf',10)), updated_at=now()
  where id=p_user_id and role='voter';
  if not found then return false; end if;
  delete from public.sessions where user_id=p_user_id;
  return true;
end;
$hoa_reset_password$;

-- These functions are for the server-side Cloudflare Worker only.
revoke execute on function public.hoa_verify_login(text,text) from public, anon, authenticated;
grant execute on function public.hoa_verify_login(text,text) to service_role;
revoke execute on function public.hoa_reset_password(bigint,text) from public, anon, authenticated;
grant execute on function public.hoa_reset_password(bigint,text) to service_role;

commit;

select 'PART 2 OF 6 COMPLETE' as status;
