#!/usr/bin/env bash
# MASTER PASS 2 — rehearsal of supabase/migrations/20261029090000_registration_gotrue_metadata.sql on a THROWAWAY
# GitHub-hosted runner, on the repo's own production stack definition (deploy/berryit-support/compose.yaml:
# supabase/postgres 17.6.1.136, GoTrue v2.196.0, PostgREST v14.12, Storage v1.60.4, Caddy) with freshly generated keys.
#
#   berryit-ci.sh stack|seed|baseline|locks|up|verify-up|down|verify-down|reup
#
# MP2_CANDIDATE = the UP sql to rehearse (installed as 20261029090000_registration_gotrue_metadata.sql),
# MP2_DOWN = its rollback file, MP2_DIR = scratch dir. Results go to stdout and to ::notice lines.
set -uo pipefail
[[ "${GITHUB_ACTIONS:-}" == "true" && "${RUNNER_ENVIRONMENT:-}" == "github-hosted" ]] || { echo "runs only on a GitHub-hosted throwaway runner" >&2; exit 1; }
repo="$GITHUB_WORKSPACE"; here="$repo/deploy/berryit-support"; H="$repo/tests/masterpass2/migration-rehearsal"
: "${MP2_DIR:?}" "${MP2_CANDIDATE:?}" "${MP2_DOWN:?}"
V=20261029090000_registration_gotrue_metadata.sql
E="$MP2_DIR/evidence"; mkdir -p "$E"
export MP2_PSQL='["docker","exec","-i","berryit-support-db","psql","-U","supabase_admin","-d","postgres"]'
sql() { docker exec -i berryit-support-db psql -v ON_ERROR_STOP=1 -tA -U supabase_admin -d postgres "$@"; }
dc() { docker compose --project-directory "$here" --env-file "$here/secrets/stack.env" -f "$here/compose.yaml" "$@"; }
esc() { sed ':a;N;$!ba;s/%/%25/g;s/\r//g;s/\n/%0A/g' | cut -c1-3800; }
note() { local t="$1"; shift; printf '::notice title=%s::%s\n' "$t" "$(printf '%s' "$*" | esc)"; }
dump() {
  docker exec berryit-support-db pg_dump -U supabase_admin -d postgres --schema-only --restrict-key=mp2rehearsal > "$1.raw" 2>/dev/null \
    || docker exec berryit-support-db pg_dump -U supabase_admin -d postgres --schema-only > "$1.raw"
  sed '/^\\\(un\)\?restrict /d' "$1.raw" > "$1"; rm -f "$1.raw"
}
checksum() { python3 -I "$H/bi_rehearsal.py" checksum "$MP2_DIR/ids.json" > "$1"; }
mig_dirs() {
  rm -rf "$MP2_DIR/mig-base" "$MP2_DIR/mig-all"; mkdir -p "$MP2_DIR/mig-base" "$MP2_DIR/mig-all"
  for f in "$repo"/supabase/migrations/*.sql; do [ "$(basename "$f")" = "$V" ] || cp "$f" "$MP2_DIR/mig-base/"; done
  cp "$MP2_DIR"/mig-base/*.sql "$MP2_DIR/mig-all/"; cp "$repo/$MP2_CANDIDATE" "$MP2_DIR/mig-all/$V"
}
gotrue_login_cmd() { # a REAL GoTrue password login of custB, printed as "<http> <seconds>"
  local email pw; email=$(python3 -c 'import json,sys;f=json.load(open(sys.argv[1]));print(f["emails"]["custB"])' "$MP2_DIR/fixture.json")
  pw=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["password"])' "$MP2_DIR/fixture.json")
  printf "curl -s -o /dev/null -w '%%{http_code} %%{time_total}s' -m 30 -X POST 'http://127.0.0.1:8700/auth/v1/token?grant_type=password' -H 'apikey: %s' -H 'Content-Type: application/json' -d '{\"email\":\"%s\",\"password\":\"%s\"}'" "$MP2_ANON_KEY" "$email" "$pw"
}

case "$1" in
stack)
  "$here/generate-secrets.sh" >/dev/null
  set -a; . "$here/secrets/stack.env"; set +a
  for v in "$ANON_KEY" "$SERVICE_ROLE_KEY" "$POSTGRES_PASSWORD" "$JWT_SECRET"; do echo "::add-mask::$v"; done
  { echo "MP2_ANON_KEY=$ANON_KEY"; echo "MP2_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY"; } >> "$GITHUB_ENV"
  dc pull --quiet >/dev/null 2>&1; dc up -d 2>&1 | tail -3
  for i in $(seq 1 90); do
    ready=$(sql -c "select (to_regclass('auth.users') is not null and to_regclass('auth.sessions') is not null and to_regclass('auth.mfa_factors') is not null and to_regclass('storage.objects') is not null)::text" 2>/dev/null || true)
    [ "$ready" = true ] && break; sleep 2
  done
  for i in $(seq 1 60); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8700/auth/v1/health)" = 200 ] && [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8700/health)" = 200 ] && break; sleep 2
  done
  sql -c "alter system set track_functions = 'pl'" -c "select pg_reload_conf()" >/dev/null
  mig_dirs
  "$here/migrate.sh" "$MP2_DIR/mig-base" > "$E/migrate-base.log" 2>&1; rc=$?
  sql -c "notify pgrst, 'reload schema'" >/dev/null; sleep 3
  imgs=$(dc ps --format '{{.Service}}={{.Image}}' | tr '\n' ' ')
  note "stack (REAL, base schema)" "rc=$rc; $imgs; $(tail -1 "$E/migrate-base.log"); ledger rows: $(sql -c 'select count(*) from public.schema_migrations'); last: $(sql -c 'select max(version) from public.schema_migrations'); server $(sql -c 'show server_version')"
  exit $rc ;;
seed)
  node "$H/verify-berryit.mjs" seed ;;
baseline)
  python3 -I "$H/bi_rehearsal.py" precheck | tee "$E/precheck.txt"
  dump "$E/schema-0-baseline.sql"; checksum "$E/checksum-0-baseline.txt"
  python3 -I "$H/bi_rehearsal.py" rowhash "$MP2_DIR/ids.json" > "$E/rows-0-baseline.txt"
  note "pre-checks (runbook SQL on the seeded base)" "$(cat "$E/precheck.txt")"
  note "baseline" "pg_dump --schema-only: $(wc -l < "$E/schema-0-baseline.sql") lines; checksums:%0A$(cat "$E/checksum-0-baseline.txt")" ;;
locks)
  ca=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["users"]["custA"])' "$MP2_DIR/ids.json")
  cb=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["users"]["custB"])' "$MP2_DIR/ids.json")
  python3 -I "$H/lockprobe.py" "$repo/$MP2_CANDIDATE" --victim "update auth.users set last_sign_in_at = now() where id = '$cb'" > "$E/locks-up.txt" 2>&1
  note "UP locks (rolled-back probe)" "$(grep -E 'own-lock|victim|up-start|up-end' "$E/locks-up.txt")"
  login=$(gotrue_login_cmd)
  pre=$(eval "$login")
  { echo "baseline REAL GoTrue login with nothing blocking: $pre"
    python3 -I "$H/lockqueue.py" "$repo/$MP2_CANDIDATE" "update auth.users set updated_at = now() where id = '$ca'" "sh:$login"
    python3 -I "$H/lockqueue.py" "$repo/$MP2_CANDIDATE" "update auth.users set updated_at = now() where id = '$ca'" "sh:$login" 2s; } > "$E/lockqueue-up.txt" 2>&1
  note "M2 lock queue: A open writer tx, B migration, C REAL GoTrue login" "$(cat "$E/lockqueue-up.txt")" ;;
up)
  mig_dirs
  checksum "$E/checksum-0b-just-before-up.txt"
  t0=$(date +%s%N); "$here/migrate.sh" "$MP2_DIR/mig-all" > "$E/up-1.log" 2>&1; rc=$?; t1=$(date +%s%N)
  "$here/migrate.sh" "$MP2_DIR/mig-all" > "$E/up-2.log" 2>&1; rc2=$?
  dump "$E/schema-1-after-up.sql"; checksum "$E/checksum-1-after-up.txt"
  t2=$(date +%s%N); sql -f - < "$repo/$MP2_CANDIDATE" > "$E/up-3-raw.log" 2>&1; rc3=$?; t3=$(date +%s%N)
  dump "$E/schema-2-after-up-twice.sql"
  d12=$(diff "$E/schema-1-after-up.sql" "$E/schema-2-after-up-twice.sql" | grep -c '^[<>]')
  diff "$E/schema-0-baseline.sql" "$E/schema-1-after-up.sql" > "$E/schema-diff-baseline-vs-up.diff"
  dchk=$(diff "$E/checksum-0b-just-before-up.txt" "$E/checksum-1-after-up.txt" > /dev/null && echo "identical to the checksum taken just before UP" || echo "DIFFERENT from just before UP: $(diff "$E/checksum-0b-just-before-up.txt" "$E/checksum-1-after-up.txt" | tr '\n' ' ')")
  dchk="$dchk; vs baseline (before the lock probes' REAL logins): $(diff "$E/checksum-0-baseline.txt" "$E/checksum-0b-just-before-up.txt" | grep '^[<>]' | tr '\n' ' ')"
  note "UP via migrate.sh (REAL)" "run 1 rc=$rc in $(( (t1 - t0) / 1000000 )) ms wall (docker exec + psql + commit): $(grep -E 'applicerar|klart' "$E/up-1.log" | tr '\n' ' ')%0Arun 2 rc=$rc2: $(grep -E 'hoppar.*20261029|klart' "$E/up-2.log" | tr '\n' ' ')%0Araw SQL a 2nd time without ledger rc=$rc3 in $(( (t3 - t2) / 1000000 )) ms: $(tr '\n' ' ' < "$E/up-3-raw.log" | cut -c1-300)%0Aschema diff after UP vs after 2nd UP: $d12 lines; baseline vs UP: $(grep -c '^[<>]' "$E/schema-diff-baseline-vs-up.diff") lines: $(grep -E '^> (CREATE|REVOKE|GRANT|ALTER)' "$E/schema-diff-baseline-vs-up.diff" | cut -c1-160 | tr '\n' ' ')%0Adata checksum after UP: $dchk"
  owner=$(sql -c "select proowner::regrole || ' acl=' || coalesce(proacl::text,'default') || ' md5=' || md5(prosrc) from pg_proc where proname = 'handle_auth_user_registration_metadata'")
  note "UP result objects" "function: $owner; trigger: $(sql -c "select pg_get_triggerdef(oid) from pg_trigger where tgname = 'auth_user_registration_metadata'")"
  [ $rc -eq 0 ] && [ $rc2 -eq 0 ] && [ $rc3 -eq 0 ] && [ "$d12" = 0 ] ;;
verify-up|verify-reup)
  ph=${1#verify-}
  node "$H/verify-berryit.mjs" "$ph" | tee "$E/verify-$ph.txt"; rc=${PIPESTATUS[0]}
  python3 -I "$H/bi_rehearsal.py" verify "$MP2_DIR/ids.json" "SIM cases on the real image ($ph)" > "$E/verify-sim-$ph.txt" 2>&1; rs=$?
  note "REAL GoTrue verification ($ph)" "$(grep -E '^(PASS|FAIL|FINDING)|: [0-9]+ PASS' "$E/verify-$ph.txt" | cut -c1-600)"
  note "SIM cases on real supabase/postgres + supabase_auth_admin ($ph)" "$(grep -E '^FAIL|pass$' "$E/verify-sim-$ph.txt" | cut -c1-400)"
  [ $rc -eq 0 ] ;;
down)
  checksum "$E/checksum-2-before-down.txt"
  ca=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["users"]["custA"])' "$MP2_DIR/ids.json")
  grep -v -E '^(begin|commit);$|^\\set ON_ERROR_STOP' "$repo/$MP2_DOWN" > "$MP2_DIR/down-probe.sql"
  login=$(gotrue_login_cmd)
  python3 -I "$H/lockprobe.py" "$MP2_DIR/down-probe.sql" --victim "select id from auth.users where email = 'mp2.custb@example.test'" > "$E/locks-down.txt" 2>&1
  python3 -I "$H/lockqueue.py" "$MP2_DIR/down-probe.sql" "update auth.users set updated_at = now() where id = '$ca'" "sh:$login" > "$E/lockqueue-down.txt" 2>&1
  note "DOWN locks + lock queue with REAL GoTrue login (rolled back)" "$(grep -E 'own-lock relation auth|victim' "$E/locks-down.txt")%0A$(cat "$E/lockqueue-down.txt")"
  # Probe only: as the non-superuser postgres role, inside a transaction that is always rolled back.
  { echo '\set ON_ERROR_STOP 1'; echo 'begin;'; cat "$MP2_DIR/down-probe.sql"; echo 'rollback;'; } | docker exec -i berryit-support-db psql -U postgres -d postgres -f - > "$E/down-as-postgres.log" 2>&1; rp=$?
  checksum "$E/checksum-2b-just-before-down.txt"
  t0=$(date +%s%N); sql -f - < "$repo/$MP2_DOWN" > "$E/down-1.log" 2>&1; rc=$?; t1=$(date +%s%N)
  sql -f - < "$repo/$MP2_DOWN" > "$E/down-2.log" 2>&1; rc2=$?
  dump "$E/schema-3-after-down.sql"; checksum "$E/checksum-3-after-down.txt"
  diff "$E/schema-0-baseline.sql" "$E/schema-3-after-down.sql" > "$E/schema-diff-baseline-vs-down.diff"; nd=$(grep -c '^[<>]' "$E/schema-diff-baseline-vs-down.diff")
  same=$(diff "$E/checksum-2b-just-before-down.txt" "$E/checksum-3-after-down.txt" >/dev/null && echo "DOWN changed no data (checksum just before DOWN == after DOWN)" || echo "DOWN CHANGED DATA: $(diff "$E/checksum-2b-just-before-down.txt" "$E/checksum-3-after-down.txt" | tr '\n' ' ')")
  python3 -I "$H/bi_rehearsal.py" rowhash "$MP2_DIR/ids.json" > "$E/rows-3-after-down.txt"
  rows=$(diff "$E/rows-0-baseline.txt" "$E/rows-3-after-down.txt" | grep '^>' | cut -d' ' -f2,3 | tr '\n' ',')
  same="$same%0Apre-existing accounts whose row differs from the baseline after UP+verification+DOWN: ${rows:-none}"
  vsb=$(diff "$E/checksum-0-baseline.txt" "$E/checksum-3-after-down.txt" | grep '^[<>]' | tr '\n' ' ')
  note "DOWN (REAL)" "as postgres (non-superuser in this image) rc=$rp: $(grep -E 'ERROR|NOTICE: +ROLLBACK' "$E/down-as-postgres.log" | head -2 | tr '\n' ' ' | cut -c1-300)%0Aas supabase_admin (migrate.sh role) rc=$rc in $(( (t1 - t0) / 1000000 )) ms: $(grep -E 'NOTICE|ERROR' "$E/down-1.log" | tr '\n' ' ' | cut -c1-300)%0Asecond run rc=$rc2%0Aschema diff baseline vs after DOWN: $nd lines $(head -c 600 "$E/schema-diff-baseline-vs-down.diff" | tr '\n' ' ')%0A$same%0Avs pre-UP baseline (rows created/changed by the verification): $vsb%0Aledger row present: $(sql -c "select count(*) from public.schema_migrations where version = '$V'")"
  [ $rc -eq 0 ] && [ $rc2 -eq 0 ] && [ "$nd" = 0 ] ;;
verify-down)
  node "$H/verify-berryit.mjs" down | tee "$E/verify-down.txt"; rc=${PIPESTATUS[0]}
  python3 -I "$H/bi_rehearsal.py" verify "$MP2_DIR/ids.json" "SIM cases on the real image (down)" > "$E/verify-sim-down.txt" 2>&1
  note "REAL GoTrue verification (after DOWN)" "$(grep -E '^(PASS|FAIL|FINDING)' "$E/verify-down.txt" | cut -c1-600)%0ASIM cases after DOWN (base behaviour expected): $(tail -1 "$E/verify-sim-down.txt")"
  [ $rc -eq 0 ] ;;
reup)
  t0=$(date +%s%N); "$here/migrate.sh" "$MP2_DIR/mig-all" > "$E/reup.log" 2>&1; rc=$?; t1=$(date +%s%N)
  dump "$E/schema-4-after-reup.sql"
  d=$(diff "$E/schema-1-after-up.sql" "$E/schema-4-after-reup.sql" | grep -c '^[<>]')
  note "RE-UP via migrate.sh (REAL)" "rc=$rc in $(( (t1 - t0) / 1000000 )) ms: $(grep -E 'applicerar|klart' "$E/reup.log" | tr '\n' ' ')%0Aschema diff after first UP vs after re-UP: $d lines"
  [ $rc -eq 0 ] && [ "$d" = 0 ] ;;
*) echo "unknown step $1" >&2; exit 2 ;;
esac
