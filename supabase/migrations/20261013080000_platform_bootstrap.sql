-- BERRYiT Support Desk – plattformsbootstrap (körs FÖRST).
--
-- Supabase Cloud tillhandahåller rollerna och auth-hjälpfunktionerna. Vid
-- självhostning finns rollerna i supabase/postgres-imagen, men auth.uid() och
-- auth.jwt() skapas INTE automatiskt – de måste provisioneras av projektet.
-- (Samma mönster används redan av aurorapark-production på prod-node-01.)
--
-- Migrationen är idempotent och rör aldrig auth.users: den tabellen ägs av
-- GoTrue, som kör sina egna migrationer. Lokalt (PGlite) skapas en attrapp av
-- supabase/tests/local_bootstrap.sql.

-- Roller: finns redan i Supabase och i supabase/postgres-imagen.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

create schema if not exists auth;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

-- Identiteten ur den JWT som PostgREST har verifierat. Stödjer både det äldre
-- formatet (request.jwt.claim.sub) och det nuvarande (request.jwt.claims).
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ),
    ''
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
    ),
    ''
  );
$$;

create or replace function auth.email()
returns text
language sql
stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.email', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'
    ),
    ''
  );
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

grant execute on function auth.uid(), auth.role(), auth.email(), auth.jwt()
  to anon, authenticated, service_role;
