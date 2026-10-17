-- Casa Verde de Banaderos HOA / v2.3 part 3: atomic vote cutoff and participation guard
-- Back up Supabase first. Apply to a test project, then your Production database.
-- Run the COMPLETE file; do NOT highlight individual PL/pgSQL lines.
-- No voter, ballot, candidate, election or participation records are deleted.

begin;

-- A direct database/API insert also cannot bypass the ballot deadline.
create or replace function public.hoa_guard_participation_deadline()
returns trigger language plpgsql set search_path=public
as $hoa_guard_participation_deadline$
begin
  perform 1 from public.elections
  where id=NEW.election_id and status='open' and voting_ends_at > clock_timestamp()
  for share;
  if not found then raise exception 'Voting is closed or the deadline has passed.'; end if;
  return NEW;
end;
$hoa_guard_participation_deadline$;

drop trigger if exists trg_hoa_guard_participation_deadline on public.voter_participation;
create trigger trg_hoa_guard_participation_deadline
before insert on public.voter_participation
for each row execute function public.hoa_guard_participation_deadline();

-- Reinstall atomic ballot RPC with deadline validation and first-login rule.
create or replace function public.hoa_submit_ballot(
  p_user_id bigint, p_election_id bigint, p_ballot_id uuid,
  p_receipt_code text, p_selections jsonb
) returns text
language plpgsql security definer set search_path = public
as $hoa_submit_ballot$
declare
  entry record; pos_id bigint; allowed_seats integer; selected_count integer;
  distinct_count integer; valid_count integer; total_selected integer := 0;
begin
  -- Lock the user row so a simultaneous credential reset/disable cannot race
  -- between authorization and participation insertion.
  perform 1 from public.users
  where id=p_user_id and role='voter' and active=true and must_change_password=false
  for share;
  if not found then raise exception 'Voter account is inactive or initial password change is required.'; end if;
  perform 1 from public.elections
  where id=p_election_id and status='open' and voting_ends_at > clock_timestamp()
  for share;
  if not found then raise exception 'Voting is closed or the deadline has passed.'; end if;
  if exists(select 1 from public.voter_participation where user_id=p_user_id and election_id=p_election_id) then
    raise exception 'This voter account has already submitted a ballot.';
  end if;
  if jsonb_typeof(p_selections) <> 'object' then raise exception 'Invalid ballot.'; end if;
  for entry in select * from jsonb_each(p_selections)
  loop
    if entry.key !~ '^[0-9]+$' or jsonb_typeof(entry.value) <> 'array' then
      raise exception 'Ballot contains an invalid position.';
    end if;
    pos_id := entry.key::bigint;
    select seats into allowed_seats from public.positions where id=pos_id and election_id=p_election_id;
    if allowed_seats is null then raise exception 'Ballot contains an invalid position.'; end if;
    selected_count := jsonb_array_length(entry.value);
    if selected_count > allowed_seats then raise exception 'Too many selections for a position.'; end if;
    if selected_count = 0 then continue; end if;
    select count(*),count(distinct v::bigint) into selected_count,distinct_count
    from jsonb_array_elements_text(entry.value) as x(v) where v ~ '^[0-9]+$';
    if selected_count <> jsonb_array_length(entry.value) or distinct_count <> selected_count then
      raise exception 'Ballot contains invalid or duplicate candidate selections.';
    end if;
    select count(*) into valid_count from public.candidates c
    where c.position_id=pos_id and c.id in
      (select v::bigint from jsonb_array_elements_text(entry.value) as x(v));
    if valid_count <> selected_count then raise exception 'Ballot contains an invalid candidate selection.'; end if;
    total_selected := total_selected + selected_count;
  end loop;
  if total_selected < 1 then raise exception 'Select at least one candidate before submitting.'; end if;
  -- Check at insertion time, not only when the request began. This prevents
  -- delayed submissions that started just before the deadline.
  if not exists (select 1 from public.elections where id=p_election_id
    and status='open' and voting_ends_at > clock_timestamp()) then
    raise exception 'Voting deadline has passed.';
  end if;
  insert into public.voter_participation(user_id,election_id,receipt_code)
  values(p_user_id,p_election_id,p_receipt_code);
  insert into public.ballots(id,election_id) values(p_ballot_id,p_election_id);
  for entry in select * from jsonb_each(p_selections)
  loop
    pos_id := entry.key::bigint;
    insert into public.ballot_votes(ballot_id,election_id,position_id,candidate_id)
    select p_ballot_id,p_election_id,pos_id,v::bigint
    from jsonb_array_elements_text(entry.value) as x(v);
  end loop;
  return p_receipt_code;
exception
  when unique_violation then
    raise exception 'This voter account has already submitted a ballot.';
end;
$hoa_submit_ballot$;

revoke execute on function public.hoa_submit_ballot(bigint,bigint,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.hoa_submit_ballot(bigint,bigint,uuid,text,jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
select 'PASS 2.3-3: atomic vote cutoff and participation guard' as status;
