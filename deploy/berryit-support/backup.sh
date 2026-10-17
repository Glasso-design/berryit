#!/usr/bin/env bash
# Backup av BERRYiT Support Desk: databas (pg_dump -Fc) + filstorage (tar).
#
#   ./backup.sh            # skriver till ./backups
#
# Offsite-kopiering är AVSIKTLIGT inte implementerad – destinationen är inte
# beslutad. Backupen ligger därför på samma värd som databasen, vilket inte
# räcker för produktion. Se README.
set -euo pipefail
umask 077

here="$(cd "$(dirname "$0")" && pwd)"
backup_dir="${BACKUP_DIR:-$here/backups}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

db_file="$backup_dir/berryit-support-db-$stamp.dump"
storage_file="$backup_dir/berryit-support-storage-$stamp.tar.gz"

echo "databas → $(basename "$db_file")"
docker exec berryit-support-db pg_dump -U "${PGUSER:-supabase_admin}" -d postgres -Fc > "$db_file"
[ -s "$db_file" ] || { echo "pg_dump gav en tom fil" >&2; exit 1; }

echo "storage → $(basename "$storage_file")"
docker run --rm --user "$(id -u):$(id -g)" \
  -v berryit-support-storage-data:/data:ro \
  -v "$backup_dir":/backup \
  alpine:3.20 tar czf "/backup/$(basename "$storage_file")" -C /data .

chmod 600 "$db_file" "$storage_file"

# No implicit retention/deletion during a release gate. Retention is a separate
# reviewed operation, never a side effect of creating a backup.
checksum_file="$backup_dir/berryit-support-$stamp.sha256"
(cd "$backup_dir" && sha256sum -- "$(basename "$db_file")" "$(basename "$storage_file")") > "$checksum_file"
chmod 600 "$checksum_file"

echo "klart:"
ls -lh "$db_file" "$storage_file" | awk '{print "  " $5, $NF}'
echo "OBS: ingen offsite-kopia – backupen finns bara på denna värd."
