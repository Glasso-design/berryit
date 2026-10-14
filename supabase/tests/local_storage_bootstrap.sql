-- Synthetic Storage catalogue only, for a new in-memory PGlite database.
-- Not a Storage HTTP server; signed-URL validation still needs an isolated stack.
create schema storage;
create table storage.buckets (
  id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text,
  unique (bucket_id, name)
);
create function storage.foldername(text) returns text[] language sql immutable as $$
  select (string_to_array($1, '/'))[1:array_length(string_to_array($1, '/'), 1)-1];
$$;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, anon, service_role;
grant select, insert, delete on storage.objects to authenticated;
grant all on storage.objects, storage.buckets to service_role;
