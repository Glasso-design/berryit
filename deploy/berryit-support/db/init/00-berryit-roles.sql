-- Körs en gång när databasvolymen skapas (docker-entrypoint-initdb.d).
--
-- supabase/postgres-imagen innehåller redan rollerna. Här sätts lösenord för de
-- roller som tjänsterna loggar in som, och scheman som GoTrue/Storage äger
-- skapas med rätt ägare. Ingen applikationsdata rörs.

\set pwd `echo "$POSTGRES_PASSWORD"`

alter user authenticator with password :'pwd';
alter user supabase_auth_admin with password :'pwd';
alter user supabase_storage_admin with password :'pwd';

-- GoTrue respektive Storage kör sina egna migrationer i dessa scheman.
create schema if not exists auth authorization supabase_auth_admin;
create schema if not exists storage authorization supabase_storage_admin;

grant create, usage on schema auth to supabase_auth_admin;
grant create, usage on schema storage to supabase_storage_admin;

-- authenticator byter till rätt roll per anrop (PostgREST).
grant anon, authenticated, service_role to authenticator;
