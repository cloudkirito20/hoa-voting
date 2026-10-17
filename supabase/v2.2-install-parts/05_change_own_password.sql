-- HOA SECURE VOTE v2.2.0 / Part 5 - change_own_password
-- BACK UP SUPABASE FIRST. Apply to a non-production copy before Production.
-- Execute this COMPLETE file, not a selected snippet.

begin;

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
revoke execute on function public.hoa_change_own_password(bigint,text,text) from public, anon, authenticated;
grant execute on function public.hoa_change_own_password(bigint,text,text) to service_role;


notify pgrst, 'reload schema';
commit;
select 'PASS Security Upgrade Part 5' as status;
