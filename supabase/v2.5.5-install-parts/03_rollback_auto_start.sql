-- EMERGENCY ROLLBACK: disable automatic opening while retaining historical logs
-- and all existing elections/votes/candidates. Does not reopen any election.
-- Run ONLY when intentionally cancelling automatic scheduling, not routinely.
BEGIN;
SELECT cron.unschedule(jobid) FROM cron.job
 WHERE jobname='hoa-voting-election-schedule';
REVOKE EXECUTE ON FUNCTION public.hoa_open_scheduled_elections() FROM service_role;
COMMIT;
