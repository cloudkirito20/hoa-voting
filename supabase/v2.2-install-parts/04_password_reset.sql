-- HOA SECURE VOTE v2.2.0 / Part 4 - password_reset
-- BACK UP SUPABASE FIRST. Apply to a non-production copy before Production.
-- Execute this COMPLETE file, not a selected snippet.

begin;

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
revoke execute on function public.hoa_reset_password(bigint,text) from public, anon, authenticated;
grant execute on function public.hoa_reset_password(bigint,text) to service_role;


notify pgrst, 'reload schema';
commit;
select 'PASS Security Upgrade Part 4' as status;
