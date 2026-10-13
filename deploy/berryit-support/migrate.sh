#!/usr/bin/env bash
# Applicerar supabase/migrations i filnamnsordning mot BERRYiT-databasen.
#
#   ./migrate.sh /sökväg/till/supabase/migrations
#
# Varje migration körs i en transaktion (ON_ERROR_STOP) och loggas i tabellen
# public.schema_migrations, så att samma fil inte körs två gånger.
set -euo pipefail

migrations_dir="${1:?ange katalogen med migrations}"
container="berryit-support-db"
# supabase/postgres degraderar "postgres"; superanvändaren i imagen är supabase_admin.
db_user="${PGUSER:-supabase_admin}"

psql() { docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U "$db_user" -d postgres "$@"; }

psql -q -c "
  create table if not exists public.schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
  );
"

applied=0
for file in $(ls -1 "$migrations_dir"/*.sql | sort); do
  version="$(basename "$file")"
  if [ -n "$(psql -tAc "select 1 from public.schema_migrations where version = '$version'")" ]; then
    echo "  hoppar över $version (redan applicerad)"
    continue
  fi
  echo "  applicerar $version"
  docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U "$db_user" -d postgres --single-transaction < "$file"
  psql -q -c "insert into public.schema_migrations (version) values ('$version')"
  applied=$((applied + 1))
done

echo "klart: $applied nya migrationer applicerade"
