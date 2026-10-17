-- HOA SECURE VOTE v2.2.0 / Part 6 - atomic_admin_setup
-- BACK UP SUPABASE FIRST. Apply to a non-production copy before Production.
-- Execute this COMPLETE file, not a selected snippet.

begin;

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
revoke execute on function public.hoa_bootstrap_admin(text,text,text) from public, anon, authenticated;
grant execute on function public.hoa_bootstrap_admin(text,text,text) to service_role;


notify pgrst, 'reload schema';
commit;
select 'PASS Security Upgrade Part 6' as status;
