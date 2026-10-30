#!/usr/bin/env bash
# MASTER PASS 1 — starts the repo's own self-hosted Support Desk stack
# (deploy/berryit-support/compose.yaml: supabase/postgres, GoTrue, PostgREST,
# Storage, Caddy gateway, ONARLY AI adapter) on a THROWAWAY CI runner, applies
# the migrations with the repo's migrate.sh and seeds synthetic accounts.
#
# Refuses to run anywhere except a GitHub-hosted runner. Secrets are generated
# fresh by deploy/berryit-support/generate-secrets.sh and die with the runner.
set -euo pipefail

[[ "${GITHUB_ACTIONS:-}" == "true" && "${RUNNER_ENVIRONMENT:-}" == "github-hosted" ]] || {
  echo "stack-up.sh körs endast på en GitHub-hostad engångsrunner" >&2; exit 1; }

repo="$(cd "$(dirname "$0")/../.." && pwd)"
here="$repo/deploy/berryit-support"
export MP1_DIR="${MP1_DIR:?}" MP1_REPO="$repo"
mkdir -p "$MP1_DIR/stub"
chmod 777 "$MP1_DIR/stub"
echo ok > "$MP1_DIR/stub/mode.txt"
: > "$MP1_DIR/stub/requests.jsonl"; chmod 666 "$MP1_DIR/stub/requests.jsonl" "$MP1_DIR/stub/mode.txt"

"$here/generate-secrets.sh"
env_file="$here/secrets/stack.env"
set -a; . "$env_file"; set +a
export MP1_GATEWAY_TOKEN="sim-gateway-$(openssl rand -hex 16)"
export BERRYIT_ANON_KEY="$ANON_KEY" BERRYIT_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
for value in "$ANON_KEY" "$SERVICE_ROLE_KEY" "$POSTGRES_PASSWORD" "$JWT_SECRET" "$MP1_GATEWAY_TOKEN"; do echo "::add-mask::$value"; done

docker build -q -t berryit-onarly-ai-adapter:mp1 "$repo/services/onarly-ai-adapter" >/dev/null
dc() { docker compose --project-directory "$here" --env-file "$env_file" -f "$here/compose.yaml" -f "$repo/tests/masterpass1/compose.override.yaml" --profile onarly-ai "$@"; }
dc pull --quiet --ignore-pull-failures || true
dc up -d

sql() { docker exec -i berryit-support-db psql -v ON_ERROR_STOP=1 -tA -U supabase_admin -d postgres "$@"; }
for i in $(seq 1 90); do
  ready=$(sql -c "select (to_regclass('auth.users') is not null and to_regclass('auth.sessions') is not null and to_regclass('auth.mfa_factors') is not null and to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null)::text" 2>/dev/null || true)
  [[ "$ready" == "true" ]] && break
  sleep 2
done
[[ "$ready" == "true" ]] || { dc ps; dc logs --tail 60 auth storage db; echo "GoTrue/Storage-scheman blev aldrig klara" >&2; exit 1; }
# GoTrue/Storage run their own migrations after the schema appears; give them
# a moment and wait for the HTTP health of the gateway routes.
for i in $(seq 1 60); do
  a=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8700/auth/v1/health || true)
  g=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8700/health || true)
  [[ "$a" == 200 && "$g" == 200 ]] && break
  sleep 2
done

# MASTER PASS 3: a second adapter from the same image with NO gateway configured,
# exactly the production default of compose.yaml (ONARLY_AI_GATEWAY_URL/TOKEN empty,
# the ONARLY AI Gateway source does not exist). Used for the "AI not available" journey.
docker rm -f berryit-ai-adapter-nogw >/dev/null 2>&1 || true
docker run -d --name berryit-ai-adapter-nogw --network berryit-support-net -p 127.0.0.1:8798:8788 \
  -e PORT=8788 -e BERRYIT_AUTH_BASE_URL=http://auth:9999 -e BERRYIT_REST_BASE_URL=http://rest:3000 \
  -e BERRYIT_ANON_KEY -e BERRYIT_SERVICE_ROLE_KEY -e ONARLY_AI_GATEWAY_URL= -e ONARLY_AI_GATEWAY_TOKEN= \
  berryit-onarly-ai-adapter:mp1 >/dev/null
for i in $(seq 1 30); do
  [[ "$(curl -s http://127.0.0.1:8798/ai/v1/health || true)" == *disabled* ]] && break
  sleep 1
done

"$here/migrate.sh" "$repo/supabase/migrations"
sql -c "notify pgrst, 'reload schema';" >/dev/null
sleep 3

# --- synthetic fixture -------------------------------------------------------
admin() { curl -sS -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" "$@"; }
pw="Mp1-$(openssl rand -hex 12)!"
echo "::add-mask::$pw"
declare -A uid
for name in saweb saapi techa custa custb; do
  body=$(printf '{"email":"%s@mp1.example.test","password":"%s","email_confirm":true,"user_metadata":{"full_name":"MP1 %s"}}' "$name" "$pw" "$name")
  uid[$name]=$(admin -X POST http://127.0.0.1:8700/auth/v1/admin/users -d "$body" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
done
orga=$(sql -c "insert into public.organizations(name) values('MP1 Kund A AB') returning id" | head -1)
orgb=$(sql -c "insert into public.organizations(name) values('MP1 Kund B AB') returning id" | head -1)
sql <<SQL >/dev/null
update public.profiles set role='admin' where id in ('${uid[saweb]}','${uid[saapi]}');
update public.profiles set role='technician' where id='${uid[techa]}';
update public.profiles set organization_id='$orga' where id='${uid[custa]}';
update public.profiles set organization_id='$orgb' where id='${uid[custb]}';
insert into public.support_role_grants(grantee_id,role_key,scope,reason) values
 ('${uid[saweb]}','BERRYIT_SUPPORT_SUPER_ADMIN','global','MP1 syntetisk ägarbeslut (CI-runner)'),
 ('${uid[saapi]}','BERRYIT_SUPPORT_SUPER_ADMIN','global','MP1 syntetisk ägarbeslut (CI-runner)');
insert into public.support_role_grants(grantee_id,role_key,scope,organization_id,reason) values
 ('${uid[techa]}','BERRYIT_SUPPORT_TECHNICIAN','organization','$orga','MP1 syntetisk scoped tekniker');
SQL

python3 - "$MP1_DIR/fixture.json" <<PY
import json, sys
json.dump({
  "gateway": "http://127.0.0.1:8700", "aiDisabled": "http://127.0.0.1:8798", "web": "http://localhost:3501", "password": "$pw",
  "anonKey": "$ANON_KEY", "serviceKey": "$SERVICE_ROLE_KEY",
  "users": {"saweb": "${uid[saweb]}", "saapi": "${uid[saapi]}", "techa": "${uid[techa]}", "custa": "${uid[custa]}", "custb": "${uid[custb]}"},
  "orgs": {"a": "$orga", "b": "$orgb"},
}, open(sys.argv[1], "w"))
PY
chmod 600 "$MP1_DIR/fixture.json"
{
  echo "MP1_ANON_KEY=$ANON_KEY"
  echo "MP1_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY"
} >> "$GITHUB_ENV"
dc ps --format '{{.Service}} {{.Image}} {{.State}}' > "$MP1_DIR/stack-ps.txt"
images=$(tr '\n' ';' < "$MP1_DIR/stack-ps.txt")
migs=$(sql -c "select count(*) from public.schema_migrations")
nogw=$(curl -s http://127.0.0.1:8798/ai/v1/health || echo unreachable)
echo "::notice title=stack-up::REAL stack uppe på runnern (${images}) – ${migs} migrationer applicerade via migrate.sh, 5 syntetiska konton, 2 organisationer; adapter utan gateway (produktionsstandard) på :8798 health=${nogw}"
