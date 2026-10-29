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

shopt -s nullglob
files=("$migrations_dir"/*.sql)
[ "${#files[@]}" -gt 0 ] || { echo "inga migrationsfiler" >&2; exit 1; }
for file in "${files[@]}"; do
  version="$(basename "$file")"
  [[ "$version" =~ ^[0-9]{14}_[a-z0-9_]+\.sql$ ]] || { echo "ogiltigt migrationsfilnamn" >&2; exit 1; }
done

psql() { docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U "$db_user" -d postgres "$@"; }

psql -q -c "
  create table if not exists public.schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
  );
  alter table public.schema_migrations enable row level security;
  revoke all on public.schema_migrations from public, anon, authenticated;
"

applied=0
for file in "${files[@]}"; do
  version="$(basename "$file")"
  if [ -n "$(psql -tAc "select 1 from public.schema_migrations where version = '$version'")" ]; then
    echo "  hoppar över $version (redan applicerad)"
    continue
  fi
  echo "  applicerar $version"
  # SQL and ledger entry must commit together. A crash between two transactions
  # must not cause a non-idempotent migration to be replayed.
  # --single-transaction also wraps SQL read from stdin (verified psql 16/17), so
  # a migration's SET LOCAL lock_timeout/statement_timeout applies to all of it.
  if ! {
    cat "$file"
    printf "\ninsert into public.schema_migrations (version) values ('%s');\n" "$version"
  } | docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U "$db_user" -d postgres --single-transaction; then
    echo "  $version avbröts och rullades tillbaka – ingenting av den är applicerat." >&2
    echo "  Vid 'lock timeout': se README.md, avsnittet \"Migrering med låsgräns\", och kör migrate.sh igen." >&2
    exit 1
  fi
  applied=$((applied + 1))
done

echo "klart: $applied nya migrationer applicerade"
