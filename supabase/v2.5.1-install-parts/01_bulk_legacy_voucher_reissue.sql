-- HOA Voting v2.5.1 - Reissue new encrypted QR credentials for legacy voters only.
-- IMPORTANT: This is NOT password recovery and NOT a reprint. It issues NEW passwords.
-- Run the entire file as one query after completing and verifying v2.2-v2.5.
-- Back up your database and verify on staging before Production. Keep polls closed.
-- Existing users, usernames, property registrations, participation and ballots remain intact.
begin;

create or replace function public.hoa_reissue_legacy_vouchers(
  p_admin_id bigint, p_voters jsonb
) returns integer
language plpgsql security definer set search_path=public,extensions
as $hoa_reissue_legacy_vouchers$
declare
  entry jsonb;
  v_voter_id bigint;
  existing_user record;
  pass text;
  cipher text;
  nonce text;
  issued_ids bigint[] := array[]::bigint[];
  count_issued integer := 0;
begin
  -- Must coordinate with the election-open transaction lock. Abort ALL
  -- changes if an election is open, even when the caller prechecked.
  perform pg_advisory_xact_lock(73014902);
  if exists (select 1 from public.elections where status='open') then
    raise exception 'Cannot reissue voter credentials while an election is open.';
  end if;
  if not exists (
    select 1 from public.users
     where id=p_admin_id and role='admin' and active=true
  ) then
    raise exception 'Active administrator account is required.';
  end if;
  if jsonb_typeof(p_voters) is distinct from 'array' then
    raise exception 'Provide a JSON voter array.';
  end if;
  if jsonb_array_length(p_voters) not between 1 and 20 then
    raise exception 'Provide 1 to 20 voters per transaction.';
  end if;

  for entry in select e.value from jsonb_array_elements(p_voters) e
    order by (e.value->>'voterId')::bigint
  loop
    v_voter_id := (entry->>'voterId')::bigint;
    pass := entry->>'password';
    cipher := entry->>'voucherCiphertext';
    nonce := entry->>'voucherNonce';
    if v_voter_id is null or v_voter_id <= 0 or v_voter_id=any(issued_ids) then
      raise exception 'Invalid or duplicate voter ID in legacy issue batch.';
    end if;
    if length(coalesce(pass,'')) < 12 or octet_length(pass) > 72 then
      raise exception 'Invalid replacement credential length.';
    end if;
    if coalesce(nonce,'') !~ '^[0-9a-f]{24}$' or
       coalesce(cipher,'') !~ '^[0-9a-f]+$' or
       length(cipher) not between 48 and 2048 then
      raise exception 'Encrypted voucher data is invalid.';
    end if;

    select id,active,must_change_password into existing_user
      from public.users where id=v_voter_id and role='voter' for update;
    if not found or not existing_user.active or not existing_user.must_change_password then
      raise exception 'Legacy voter no longer eligible for reissue (voter ID %).', v_voter_id;
    end if;
    if exists (select 1 from public.voter_vouchers where voter_id=v_voter_id) then
      raise exception 'Voter ID % already has an archived voucher. Reprint instead.', v_voter_id;
    end if;

    -- Uses the previously installed RPC: password hash, session invalidation,
    -- AES-256-GCM archive and audit remain in one PostgreSQL transaction.
    if not public.hoa_reset_password_with_voucher(v_voter_id,pass,cipher,nonce) then
      raise exception 'Failed to reissue credential for voter ID %.', v_voter_id;
    end if;
    issued_ids := array_append(issued_ids,v_voter_id);
    count_issued := count_issued + 1;
  end loop;

  -- Audit must commit in the SAME transaction, without plaintext passwords.
  insert into public.audit_log(admin_user_id,action,entity_type,entity_id,details)
  values(p_admin_id,'voter.legacy_credential_reissue','voter','batch',
    jsonb_build_object('count',count_issued,'voterIds',to_jsonb(issued_ids),
                       'priorPasswordsInvalidated',true));
  return count_issued;
end;
$hoa_reissue_legacy_vouchers$;

revoke execute on function public.hoa_reissue_legacy_vouchers(bigint,jsonb)
  from public,anon,authenticated;
grant execute on function public.hoa_reissue_legacy_vouchers(bigint,jsonb)
  to service_role;

notify pgrst,'reload schema';
commit;
select 'PASS 2.5.1-1: guarded legacy voucher reissue' as status;
