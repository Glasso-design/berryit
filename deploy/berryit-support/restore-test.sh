#!/usr/bin/env bash
# Restore-test: återställer senaste backupen till en TILLFÄLLIG databas och
# kontrollerar att schema, policies och data kom med. Rör aldrig den riktiga
# databasen (postgres) och lämnar inget kvar efteråt.
#
#   ./restore-test.sh [dumpfil]
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
backup_dir="${BACKUP_DIR:-$here/backups}"
dump="${1:-$(ls -1t "$backup_dir"/berryit-support-db-*.dump 2>/dev/null | head -1)}"
run_id="$(python3 -c 'import uuid; print(uuid.uuid4().hex)')"
test_db="berryit_restore_test_$run_id"
owner_marker="berryit_restore_test:$run_id"

[ -n "$dump" ] && [ -f "$dump" ] || { echo "hittar ingen dumpfil" >&2; exit 1; }
echo "testar återställning av $(basename "$dump") till databasen $test_db"

db_user="${PGUSER:-supabase_admin}"
psql_admin() { docker exec -i berryit-support-db psql -v ON_ERROR_STOP=1 -U "$db_user" -d postgres "$@"; }
psql_test() { docker exec -i berryit-support-db psql -v ON_ERROR_STOP=1 -U "$db_user" -d "$test_db" "$@"; }

cleanup() {
  local actual_owner
  actual_owner=$(psql_admin -tA -c "select shobj_description(oid, 'pg_database') from pg_database where datname = '$test_db'") || return 1
  [ "$actual_owner" = "$owner_marker" ] || {
    echo "Databasens ägarskap kunde inte verifieras; ingen cleanup" >&2
    return 1
  }
  psql_admin -q -c "drop database \"$test_db\" with (force)" >/dev/null
}

psql_admin -q -c "create database \"$test_db\""
psql_admin -q -c "comment on database \"$test_db\" is '$owner_marker'"
# Trap installeras först efter lyckad skapning och ägarmärkning. En kollision
# eller ett fel före dess får aldrig radera en redan existerande databas.
trap cleanup EXIT
# The database is new and owned by this run. Never clean an existing schema,
# and never turn a partial/failed restore into a successful readiness check.
docker exec -i berryit-support-db pg_restore -U "$db_user" -d "$test_db" --no-owner < "$dump" >/dev/null

tables=$(psql_test -tAc "select count(*) from pg_tables where schemaname = 'public'")
policies=$(psql_test -tAc "select count(*) from pg_policies where schemaname = 'public'")
rls_off=$(psql_test -tAc "select count(*) from pg_tables where schemaname = 'public' and not rowsecurity")
tickets=$(psql_test -tAc "select count(*) from public.tickets")
audit=$(psql_test -tAc "select count(*) from public.support_admin_audit")

echo "  tabeller i public:      $tables"
echo "  RLS-policies:           $policies"
echo "  tabeller utan RLS:      $rls_off"
echo "  ärenden i återställningen: $tickets"
echo "  revisionsrader:         $audit"

fail=0
[ "$tables" -ge 17 ] || { echo "FAIL: för få tabeller"; fail=1; }
[ "$policies" -ge 38 ] || { echo "FAIL: för få policies"; fail=1; }
[ "$rls_off" -eq 0 ] || { echo "FAIL: tabeller utan RLS efter restore"; fail=1; }

if [ "$fail" -eq 0 ]; then
  echo "RESTORE-TEST: PASS"
else
  echo "RESTORE-TEST: FAIL"
fi
exit "$fail"
