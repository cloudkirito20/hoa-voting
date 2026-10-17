-- HOA election database Step 2, PART 6 of 6
-- Add server-side results counting and recheck all RPC permissions.
-- Run this file as a WHOLE in a NEW Supabase SQL Editor query.
-- Use only on the NEW project where Step 1 Tables/RLS completed.
-- Confirm the last line is SELECT 'PART 6 OF 6 COMPLETE'.
-- STOP if this query reports an error; do not proceed to the next part.

begin;

create or replace function public.hoa_candidate_vote_totals(p_election_id bigint)
returns table(candidate_id bigint, votes bigint)
language sql stable security definer set search_path = public
as $hoa_candidate_vote_totals$
  select bv.candidate_id, count(*)::bigint as votes
  from public.ballot_votes bv
  where bv.election_id = p_election_id
  group by bv.candidate_id;
$hoa_candidate_vote_totals$;

-- These functions are for the server-side Cloudflare Worker only.
revoke execute on function public.hoa_create_user(text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.hoa_create_user(text,text,text,text,text,text) to service_role;
revoke execute on function public.hoa_verify_login(text,text) from public, anon, authenticated;
grant execute on function public.hoa_verify_login(text,text) to service_role;
revoke execute on function public.hoa_reset_password(bigint,text) from public, anon, authenticated;
grant execute on function public.hoa_reset_password(bigint,text) to service_role;
revoke execute on function public.hoa_bulk_create_voters(jsonb) from public, anon, authenticated;
grant execute on function public.hoa_bulk_create_voters(jsonb) to service_role;
revoke execute on function public.hoa_submit_ballot(bigint,bigint,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.hoa_submit_ballot(bigint,bigint,uuid,text,jsonb) to service_role;
revoke execute on function public.hoa_delete_election(bigint) from public, anon, authenticated;
grant execute on function public.hoa_delete_election(bigint) to service_role;
revoke execute on function public.hoa_candidate_vote_totals(bigint) from public, anon, authenticated;
grant execute on function public.hoa_candidate_vote_totals(bigint) to service_role;

-- Ask Supabase PostgREST to load the new RPC signatures.
notify pgrst, 'reload schema';

commit;

select 'PART 6 OF 6 COMPLETE' as status;
