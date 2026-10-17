-- HOA Voting v2.5 / 2 of 5: voter account and encrypted voucher committed together.
-- Only the trusted Cloudflare Worker can call these RPCs with service-role key.
begin;
create or replace function public.hoa_create_voter_with_voucher(
  p_username text, p_password text, p_full_name text, p_block text, p_lot text,
  p_ciphertext_hex text, p_nonce_hex text
) returns bigint
language plpgsql security definer set search_path=public,extensions
as $hoa_create_voter_with_voucher$
declare new_id bigint;
begin
  if p_nonce_hex !~ '^[0-9a-f]{24}$' or p_ciphertext_hex !~ '^[0-9a-f]+$'
     or length(p_ciphertext_hex) < 48 then
    raise exception 'Invalid encrypted voucher archive.';
  end if;
  new_id := public.hoa_create_user(p_username,p_password,'voter',p_full_name,p_block,p_lot);
  insert into public.voter_vouchers(voter_id,nonce_hex,ciphertext_hex)
    values(new_id,p_nonce_hex,p_ciphertext_hex);
  return new_id;
end;
$hoa_create_voter_with_voucher$;
revoke execute on function public.hoa_create_voter_with_voucher(text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.hoa_create_voter_with_voucher(text,text,text,text,text,text,text) to service_role;

create or replace function public.hoa_bulk_create_voters_with_vouchers(p_voters jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $hoa_bulk_create_voters_with_vouchers$
declare results jsonb; row jsonb; new_row jsonb; found_rows integer;
begin
  if jsonb_typeof(p_voters) is distinct from 'array' then
    raise exception 'Expected a voter array.';
  end if;
  if jsonb_array_length(p_voters) < 1 or jsonb_array_length(p_voters) > 20 then
    raise exception 'A batch must contain 1 to 20 voters.';
  end if;
  -- The existing routine inserts all accounts in the same PostgreSQL transaction.
  results := public.hoa_bulk_create_voters(p_voters);
  for new_row in select value from jsonb_array_elements(results) loop
    select value into row from jsonb_array_elements(p_voters)
      where value->>'username' = new_row->>'username';
    if not found or row->>'voucherNonce' !~ '^[0-9a-f]{24}$'
      or row->>'voucherCiphertext' !~ '^[0-9a-f]+$'
      or length(row->>'voucherCiphertext') < 48 then
      raise exception 'Unable to archive all voter vouchers atomically.';
    end if;
    insert into public.voter_vouchers(voter_id,nonce_hex,ciphertext_hex)
      values((new_row->>'id')::bigint,row->>'voucherNonce',row->>'voucherCiphertext');
  end loop;
  return results;
end;
$hoa_bulk_create_voters_with_vouchers$;
revoke execute on function public.hoa_bulk_create_voters_with_vouchers(jsonb) from public,anon,authenticated;
grant execute on function public.hoa_bulk_create_voters_with_vouchers(jsonb) to service_role;

-- Explicit emergency reset is still separate from Print/Reprint. The reset RPC
-- issues an encrypted archive for its NEW password in a single transaction.
create or replace function public.hoa_reset_password_with_voucher(
  p_user_id bigint, p_password text, p_ciphertext_hex text, p_nonce_hex text
) returns boolean language plpgsql security definer set search_path=public,extensions
as $hoa_reset_password_with_voucher$
begin
  if p_nonce_hex !~ '^[0-9a-f]{24}$' or p_ciphertext_hex !~ '^[0-9a-f]+$'
     or length(p_ciphertext_hex) < 48 then
    raise exception 'Invalid encrypted voucher archive.';
  end if;
  if not public.hoa_reset_password(p_user_id,p_password) then return false; end if;
  insert into public.voter_vouchers(voter_id,nonce_hex,ciphertext_hex)
    values(p_user_id,p_nonce_hex,p_ciphertext_hex)
    on conflict (voter_id) do update set nonce_hex=excluded.nonce_hex,
      ciphertext_hex=excluded.ciphertext_hex,created_at=now();
  return true;
end;
$hoa_reset_password_with_voucher$;
revoke execute on function public.hoa_reset_password_with_voucher(bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.hoa_reset_password_with_voucher(bigint,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
select 'PASS 2.5-2: atomic issuance and emergency reset archive' as status;
