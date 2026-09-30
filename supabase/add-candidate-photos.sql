-- HOA Secure Vote - candidate photo migration
-- Run once in Supabase Dashboard -> SQL Editor for an existing installation.
-- This does not modify or delete existing candidates, ballots, voters, or results.

alter table public.candidates
  add column if not exists photo_path text;

-- Keep candidate photos private. The Cloudflare Worker accesses this bucket with the
-- Supabase secret/service-role key and serves images only to authenticated app users.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'candidate-photos',
  'candidate-photos',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp']::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
