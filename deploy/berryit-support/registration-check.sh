#!/usr/bin/env bash
# Skrivskyddad kontroll av halvregistrerade kundkonton (MASTER PASS 2, M4).
#
#   ./registration-check.sh
#
# Kör checks/half-registered-customers.sql i en READ ONLY-transaktion med
# default_transaction_read_only=on. Ändrar ingenting och reparerar ingenting.
#   exit 0  inga träffar
#   exit 3  träffar finns: hantera dem manuellt enligt
#           ../../docs/masterpass2-registration-check.md
#   annat   kontrollen kunde inte köras
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
container="${BERRYIT_DB_CONTAINER:-berryit-support-db}"
db_user="${PGUSER:-supabase_admin}"

# A psql failure must never look like "findings" (psql itself exits 3 on a script error).
if ! out="$(docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' "$container" \
  psql -v ON_ERROR_STOP=1 -X -U "$db_user" -d postgres < "$here/checks/half-registered-customers.sql" 2>&1)"; then
  printf '%s\n' "$out" >&2
  echo "kontrollen kunde inte köras" >&2
  exit 1
fi
printf '%s\n' "$out"

count="$(printf '%s\n' "$out" | sed -n 's/.*MP2-REGISTRATION-CHECK: \([0-9][0-9]*\) konto.*/\1/p' | head -1)"
[ -n "$count" ] || { echo "kontrollen gav ingen sammanfattning" >&2; exit 1; }
if [ "$count" -gt 0 ]; then
  echo "$count konto(n) behöver manuell granskning – se docs/masterpass2-registration-check.md" >&2
  exit 3
fi
echo "inga halvregistrerade kundkonton"
