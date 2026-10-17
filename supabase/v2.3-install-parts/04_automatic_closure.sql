-- Casa Verde de Banaderos HOA / v2.3 part 4: cron close function and service-role access
-- Back up Supabase first. Apply to a test project, then your Production database.
-- Run the COMPLETE file; do NOT highlight individual PL/pgSQL lines.
-- No voter, ballot, candidate, election or participation records are deleted.

begin;

-- Called every minute by Cloudflare Cron, using the secret service role.
-- Also available for a deliberate closure check before opening another election.
create or replace function public.hoa_close_expired_elections()
returns integer language plpgsql security definer set search_path=public
as $hoa_close_expired_elections$
declare affected integer;
begin
  update public.elections
  set status='closed',
      closed_at=coalesce(closed_at,voting_ends_at,clock_timestamp()),
      updated_at=clock_timestamp()
  where status='open'
    and (voting_ends_at is null or voting_ends_at <= clock_timestamp());
  get diagnostics affected = row_count;
  return affected;
end;
$hoa_close_expired_elections$;

revoke execute on function public.hoa_close_expired_elections() from public, anon, authenticated;
grant execute on function public.hoa_close_expired_elections() to service_role;

notify pgrst, 'reload schema';
commit;
select 'PASS 2.3-4: cron close function and service-role access' as status;
