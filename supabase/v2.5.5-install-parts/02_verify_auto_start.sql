-- READ ONLY. Run in BOTH staging and production after applying Part 01.
SELECT
  to_regprocedure('public.hoa_open_scheduled_elections()') IS NOT NULL AS auto_open_rpc_found,
  has_function_privilege('service_role','public.hoa_open_scheduled_elections()','EXECUTE') AS service_role_allowed,
  NOT has_function_privilege('anon','public.hoa_open_scheduled_elections()','EXECUTE') AS anon_blocked,
  NOT has_function_privilege('authenticated','public.hoa_open_scheduled_elections()','EXECUTE') AS authenticated_blocked,
  EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') AS cron_installed;

SELECT jobid,jobname,schedule,active,command
FROM cron.job WHERE jobname='hoa-voting-election-schedule';

SELECT e.id,e.title,e.status,e.voting_starts_at,e.voting_ends_at,
  e.opened_at,e.eligible_voters_at_open,
  (SELECT count(*) FROM public.positions p WHERE p.election_id=e.id) AS positions,
  (SELECT count(*) FROM public.candidates c JOIN public.positions p ON c.position_id=p.id WHERE p.election_id=e.id) AS candidates
FROM public.elections e ORDER BY e.id;
