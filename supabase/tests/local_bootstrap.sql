-- Endast för lokal validering mot ren PostgreSQL (PGlite), utan Supabase-plattformen.
--
-- Skapar det som GoTrue annars äger: schemat auth och tabellen auth.users.
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
