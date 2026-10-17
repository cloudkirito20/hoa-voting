-- CASA VERDE HOA / Security Upgrade v2.2.0 - PART 2
-- One account per unique homeowner name, not one account per property.
-- SAFETY: Do NOT guess that two similar names are the same resident.
-- Verify identities using the approved homeowner registry, not name alone.
-- Namesakes with identical normalized names need a reviewed stable owner ID
-- before using a name-based unique index.
-- This migration deliberately FAILS if ambiguous duplicate names already exist.
-- Back up, test on a clone, and do not delete participation or ballots to fix duplicates.

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

commit;

select 'PASS: ONE ACCOUNT PER NORMALIZED HOMEOWNER NAME (REVIEW NAMESAKES)' as status;
