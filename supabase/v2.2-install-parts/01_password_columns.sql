-- HOA SECURE VOTE v2.2.0 / Part 1 - password_columns
-- BACK UP SUPABASE FIRST. Apply to a non-production copy before Production.
-- Execute this COMPLETE file, not a selected snippet.

begin;

alter table public.users add column if not exists must_change_password boolean not null default false;
alter table public.users add column if not exists password_changed_at timestamptz;
-- Existing voucher passwords must be replaced at first login.
update public.users set must_change_password=true
where role='voter' and password_changed_at is null and must_change_password=false;

notify pgrst, 'reload schema';
commit;
select 'PASS Security Upgrade Part 1' as status;
