-- HOA Voting v2.5 / 1 of 5: encrypted temporary-voucher archive.
-- Back up your Supabase database; apply to a staging project first.
-- Only ciphertext is stored. Requires VOUCHER_ENCRYPTION_KEY in Cloudflare.
-- Does not recover passwords issued before this feature.
begin;
create table if not exists public.voter_vouchers (
  voter_id bigint primary key references public.users(id) on delete cascade,
  nonce_hex text not null check (nonce_hex ~ '^[0-9a-f]{24}$'),
  ciphertext_hex text not null check (ciphertext_hex ~ '^[0-9a-f]+$' and length(ciphertext_hex) between 48 and 2048),
  created_at timestamptz not null default now()
);
alter table public.voter_vouchers enable row level security;
revoke all on public.voter_vouchers from public, anon, authenticated;
grant select, insert, update, delete on public.voter_vouchers to service_role;
commit;
select 'PASS 2.5-1: private encrypted voucher table' as status;
