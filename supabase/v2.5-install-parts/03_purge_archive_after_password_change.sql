-- HOA Voting v2.5 / 3 of 5: never retain changed personal passwords.
-- Changing the password invalidates the old temporary voucher immediately.
begin;
create or replace function public.hoa_purge_stale_voucher()
returns trigger language plpgsql security definer set search_path=public
as $hoa_purge_stale_voucher$
begin
  if NEW.role='voter' and (OLD.password_hash is distinct from NEW.password_hash
      or (OLD.must_change_password and not NEW.must_change_password)) then
    delete from public.voter_vouchers where voter_id=NEW.id;
  end if;
  return NEW;
end;
$hoa_purge_stale_voucher$;
drop trigger if exists trg_hoa_purge_stale_voucher on public.users;
create trigger trg_hoa_purge_stale_voucher
  after update of password_hash,must_change_password on public.users
  for each row execute function public.hoa_purge_stale_voucher();

-- Administrator-origin credential resets and enabling/disabling voters are
-- frozen while an election is live. A voter changing their INITIAL password
-- (true -> false) is allowed so they can enter the ballot.
create or replace function public.hoa_guard_live_voter_mutations()
returns trigger language plpgsql set search_path=public
as $hoa_guard_live_voter_mutations$
begin
  if NEW.role='voter' and (
      NEW.active is distinct from OLD.active or
      (NEW.password_hash is distinct from OLD.password_hash and NEW.must_change_password)
    ) then
    perform pg_advisory_xact_lock(73014902);
    if exists(select 1 from public.elections where status='open') then
      raise exception 'Administrator voter changes are frozen while an election is open.';
    end if;
  end if;
  return NEW;
end;
$hoa_guard_live_voter_mutations$;
drop trigger if exists trg_hoa_guard_live_voter_mutations on public.users;
create trigger trg_hoa_guard_live_voter_mutations
  before update of active,password_hash on public.users
  for each row execute function public.hoa_guard_live_voter_mutations();

commit;
select 'PASS 2.5-3: encrypted voucher removed after password change' as status;
