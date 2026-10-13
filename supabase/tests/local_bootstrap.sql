-- Endast för lokal validering mot ren PostgreSQL (PGlite), utan Supabase-plattformen.
--
-- Skapar det som GoTrue annars äger: schemat auth, tabellen auth.users och
-- tabellen auth.sessions (som sessionskontrollen läser).
-- Roller och auth.uid()/auth.jwt() skapas av den riktiga migrationen
-- 20261013080000_platform_bootstrap.sql och dupliceras därför INTE här.
--
-- Körs ALDRIG mot Supabase eller mot den självhostade stacken – där finns
-- auth.users redan, skapad av GoTrue:s egna migrationer.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- GoTrue:s sessionsregister. Raden tas bort vid utloggning, vilket är det
-- databasen använder för att se om en session fortfarande lever. Endast de
-- kolumner som BERRYiT läser finns med här.
create table if not exists auth.sessions (
  id uuid primary key,
  user_id uuid not null,
  aal text,
  not_after timestamptz,
  created_at timestamptz not null default now()
);
