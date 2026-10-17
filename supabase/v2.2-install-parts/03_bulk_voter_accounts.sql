-- HOA SECURE VOTE v2.2.0 / Part 3 - bulk_voter_accounts
-- BACK UP SUPABASE FIRST. Apply to a non-production copy before Production.
-- Execute this COMPLETE file, not a selected snippet.

begin;

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
revoke execute on function public.hoa_bulk_create_voters(jsonb) from public, anon, authenticated;
grant execute on function public.hoa_bulk_create_voters(jsonb) to service_role;


notify pgrst, 'reload schema';
commit;
select 'PASS Security Upgrade Part 3' as status;
