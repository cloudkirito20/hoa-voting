-- HOA SECURE VOTE v2.2.0 / Part 8 - one_homeowner_one_account
-- BACK UP SUPABASE FIRST. Apply to a non-production copy before Production.
-- Execute this COMPLETE file, not a selected snippet.

begin;

do $hoa_owner_precheck$
begin
  if exists (
    select 1 from public.users
    where role='voter'
    group by lower(regexp_replace(btrim(full_name), '[[:space:]]+', ' ', 'g'))
    having count(*) > 1
  ) then
    raise exception 'Duplicate homeowner names exist. Reconcile each existing voter account before enforcing one-homeowner-one-vote; no data was changed.';
  end if;
end;
$hoa_owner_precheck$;

create unique index if not exists users_one_voter_per_normalized_homeowner_uq
on public.users ((lower(regexp_replace(btrim(full_name), '[[:space:]]+', ' ', 'g'))))
where role='voter';


notify pgrst, 'reload schema';
commit;
select 'PASS Security Upgrade Part 8' as status;
