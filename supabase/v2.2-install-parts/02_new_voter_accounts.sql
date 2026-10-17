-- HOA SECURE VOTE v2.2.0 / Part 2 - new_voter_accounts
-- BACK UP SUPABASE FIRST. Apply to a non-production copy before Production.
-- Execute this COMPLETE file, not a selected snippet.

begin;

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
revoke execute on function public.hoa_create_user(text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.hoa_create_user(text,text,text,text,text,text) to service_role;


notify pgrst, 'reload schema';
commit;
select 'PASS Security Upgrade Part 2' as status;
