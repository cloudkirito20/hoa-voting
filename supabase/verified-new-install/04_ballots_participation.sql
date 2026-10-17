-- HOA ELECTION: STEP 1D / 5: VOTER PARTICIPATION + BALLOTS + VOTES
-- Run after 03_Elections_Candidates.sql. No ballot records are deleted.

create table if not exists public.voter_participation (
  user_id bigint not null references public.users(id) on delete restrict,
  election_id bigint not null references public.elections(id) on delete cascade,
  voted_at timestamptz not null default now(),
  receipt_code text not null unique,
  primary key(user_id,election_id)
);
alter table public.voter_participation enable row level security;
revoke all on table public.voter_participation from anon, authenticated;
grant select, insert, update, delete on table public.voter_participation to service_role;
create index if not exists idx_participation_election on public.voter_participation(election_id,voted_at);

-- Ballots deliberately do NOT contain a submission timestamp: ballot anonymity.
create table if not exists public.ballots (
  id uuid primary key,
  election_id bigint not null references public.elections(id) on delete cascade
);
alter table public.ballots enable row level security;
revoke all on table public.ballots from anon, authenticated;
grant select, insert, update, delete on table public.ballots to service_role;
create index if not exists idx_ballots_election on public.ballots(election_id);

create table if not exists public.ballot_votes (
  ballot_id uuid not null references public.ballots(id) on delete cascade,
  election_id bigint not null references public.elections(id) on delete cascade,
  position_id bigint not null references public.positions(id) on delete cascade,
  candidate_id bigint not null references public.candidates(id) on delete cascade,
  primary key(ballot_id,candidate_id)
);
alter table public.ballot_votes enable row level security;
revoke all on table public.ballot_votes from anon, authenticated;
grant select, insert, update, delete on table public.ballot_votes to service_role;
create index if not exists idx_ballot_votes_results on public.ballot_votes(election_id,position_id,candidate_id);

select case when
  (select count(*) from pg_class where oid in
    (to_regclass('public.voter_participation'),to_regclass('public.ballots'),to_regclass('public.ballot_votes'))
    and relrowsecurity)=3
  then 'PASS 1D: participation + ballots + ballot_votes created with RLS'
  else 'FAIL 1D: check tables and RLS' end as step_result;
