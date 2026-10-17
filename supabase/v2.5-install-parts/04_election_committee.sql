-- HOA Voting v2.5 / 4 of 5: Election Committee signature roster.
-- Members are configurable before voting, or after closing for the final report.
-- Changes are audit-logged by the Worker; no changes while ballots are open.
begin;
create table if not exists public.election_committee_members (
  id bigint generated always as identity primary key,
  election_id bigint not null references public.elections(id) on delete cascade,
  committee_role text not null check (committee_role in ('Chairperson','Vice Chairperson','Secretary','Member','Canvasser')),
  full_name text not null check (length(btrim(full_name)) between 2 and 100),
  display_order integer not null check (display_order between 1 and 12),
  created_at timestamptz not null default now(),
  unique (election_id,display_order)
);
alter table public.election_committee_members enable row level security;
revoke all on public.election_committee_members from public,anon,authenticated;
grant select,insert,update,delete on public.election_committee_members to service_role;
grant usage,select on sequence public.election_committee_members_id_seq to service_role;

create or replace function public.hoa_replace_election_committee(
 p_election_id bigint, p_members jsonb
) returns integer language plpgsql security definer set search_path=public
as $hoa_replace_election_committee$
declare e_status text; member jsonb; i integer := 0; chairs integer := 0; r text; n text;
begin
  select status into e_status from public.elections
  where id=p_election_id for update;
  if e_status is null then raise exception 'Election not found.'; end if;
  if e_status='open' then raise exception 'Committee cannot change while voting is open.'; end if;
  if jsonb_typeof(p_members) is distinct from 'array'
    or jsonb_array_length(p_members) > 12 then
    raise exception 'Committee must be an array with up to 12 people.';
  end if;
  -- Validate every member BEFORE modifying the existing roster.
  for member in select value from jsonb_array_elements(p_members) loop
    n:=btrim(coalesce(member->>'fullName',''));
    r:=coalesce(member->>'role','');
    if length(n)<2 or length(n)>100 or
      r not in ('Chairperson','Vice Chairperson','Secretary','Member','Canvasser') then
      raise exception 'Invalid committee member name or role.';
    end if;
    if r='Chairperson' then chairs:=chairs+1; end if;
  end loop;
  if chairs > 1 then raise exception 'Only one Chairperson is allowed.'; end if;
  delete from public.election_committee_members where election_id=p_election_id;
  for member in select value from jsonb_array_elements(p_members) loop
    i:=i+1;
    insert into public.election_committee_members(election_id,committee_role,full_name,display_order)
      values(p_election_id,member->>'role',btrim(member->>'fullName'),i);
  end loop;
  return i;
end;
$hoa_replace_election_committee$;
revoke execute on function public.hoa_replace_election_committee(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.hoa_replace_election_committee(bigint,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
select 'PASS 2.5-4: configurable ELECOM signatories' as status;
