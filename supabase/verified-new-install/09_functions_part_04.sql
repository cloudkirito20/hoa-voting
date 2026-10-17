-- HOA election database Step 2, PART 4 of 6
-- Add the one-ballot-per-voter atomic vote submission function.
-- Run this file as a WHOLE in a NEW Supabase SQL Editor query.
-- Use only on the NEW project where Step 1 Tables/RLS completed.
-- Confirm the last line is SELECT 'PART 4 OF 6 COMPLETE'.
-- STOP if this query reports an error; do not proceed to the next part.

begin;

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
  if not exists(select 1 from public.users where id=p_user_id and role='voter' and active=true) then
    raise exception 'Voter account is not active.';
  end if;
  perform 1 from public.elections where id=p_election_id and status='open' for share;
  if not found then raise exception 'This election is not open.'; end if;
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

-- These functions are for the server-side Cloudflare Worker only.
revoke execute on function public.hoa_submit_ballot(bigint,bigint,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.hoa_submit_ballot(bigint,bigint,uuid,text,jsonb) to service_role;

commit;

select 'PART 4 OF 6 COMPLETE' as status;
