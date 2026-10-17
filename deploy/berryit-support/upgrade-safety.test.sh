#!/usr/bin/env bash
# Pure shell mocks: never calls a real Docker daemon or database.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
task_dir=$(mktemp -d)
# Keep synthetic evidence; no automatic delete or server cleanup.
export BERRYIT_UPGRADE_MOCK_DIR="$task_dir"
mkdir "$task_dir/migrations"
printf 'select 1;\n' > "$task_dir/migrations/20261016000001_fixture.sql"
printf 'select 2;\n' > "$task_dir/migrations/20261016000002_fixture.sql"
printf 'synthetic dump; never restored\n' > "$task_dir/fixture.dump"
docker() {
  printf '%s\n' "$*" >> "$BERRYIT_UPGRADE_MOCK_DIR/calls"
  if [[ "$*" == *'pg_restore'* ]]; then return 37; fi
  if [[ "$*" == *'pg_dump'* ]]; then
    printf 'umask=%s\n' "$(umask)" >> "$BERRYIT_UPGRADE_MOCK_DIR/permissions"
    printf 'synthetic dump only\n'; return 0
  fi
  if [[ "$1" == 'run' ]]; then
    for arg in "$@"; do
      if [[ "$arg" == /backup/*.tar.gz ]]; then printf 'synthetic storage only\n' > "$BACKUP_DIR/${arg##*/}"; fi
    done
    return 0
  fi
  if [[ "$*" == *'--single-transaction'* ]]; then
    cat >> "$BERRYIT_UPGRADE_MOCK_DIR/atomic-sql"
    return 0
  fi
  if [[ "$*" == *'comment on database'* ]]; then
    printf '%s\n' "$*" | grep -oE 'berryit_restore_test:[a-f0-9]+' > "$BERRYIT_UPGRADE_MOCK_DIR/owner"
  fi
  if [[ "$*" == *'shobj_description'* ]]; then cat "$BERRYIT_UPGRADE_MOCK_DIR/owner"; fi
  return 0
}
export -f docker
chmod() {
  printf 'chmod %s\n' "$*" >> "$BERRYIT_UPGRADE_MOCK_DIR/permissions"
  command chmod "$@"
}
export -f chmod
bash "$here/migrate.sh" "$task_dir/migrations" > "$task_dir/migrate-output"
[[ $(grep -c '^insert into public.schema_migrations' "$task_dir/atomic-sql") -eq 2 ]]
grep -q 'select 1' "$task_dir/atomic-sql"
grep -q 'select 2' "$task_dir/atomic-sql"
if grep -E 'psql.*-c insert into public.schema_migrations' "$task_dir/calls"; then exit 1; fi
grep -q 'enable row level security' "$task_dir/calls"
if bash "$here/restore-test.sh" "$task_dir/fixture.dump" > "$task_dir/restore-output" 2>&1; then
  echo 'FAIL: failed pg_restore reported success' >&2; exit 1
fi
if grep -q 'RESTORE-TEST: PASS' "$task_dir/restore-output"; then exit 1; fi
if grep -q -- '--clean' "$task_dir/calls"; then exit 1; fi
grep -q 'drop database' "$task_dir/calls" # Only the synthetic owned-database trap.
export BACKUP_DIR="$task_dir/backups"
mkdir "$BACKUP_DIR"
printf 'retained old synthetic backup\n' > "$BACKUP_DIR/berryit-support-retained.dump"
touch -d '60 days ago' "$BACKUP_DIR/berryit-support-retained.dump"
bash "$here/backup.sh" > "$task_dir/backup-output"
test -f "$BACKUP_DIR/berryit-support-retained.dump"
(cd "$BACKUP_DIR" && sha256sum -c ./*.sha256) > "$task_dir/checksum-output"
grep -q 'umask=0077' "$task_dir/permissions"
grep -q '^chmod 600 .*\.sha256' "$task_dir/permissions"
grep -q '^chmod 600 .*\.dump .*\.tar.gz' "$task_dir/permissions"
case "$(uname -s)" in
  MINGW*|MSYS*) echo 'Windows: verified umask/chmod commands; native POSIX mode enforcement belongs to the Linux gate.' ;;
  *) for file in "$BACKUP_DIR"/*.sha256 "$BACKUP_DIR"/*.tar.gz; do [[ $(stat -c %a "$file") == 600 ]]; done ;;
esac
mkdir "$task_dir/invalid"
printf 'select 1;\n' > "$task_dir/invalid/unreviewed.sql"
before_calls=$(wc -l < "$task_dir/calls")
if bash "$here/migrate.sh" "$task_dir/invalid" > /dev/null 2>&1; then exit 1; fi
[[ $(wc -l < "$task_dir/calls") -eq $before_calls ]]
echo "PASS: atomic/protected ledger, restore failure aborts, backup checksums and no retention deletion; mocks only. Evidence: $task_dir"
