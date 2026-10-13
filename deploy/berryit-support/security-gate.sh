#!/usr/bin/env bash
# Säkerhetsgrind mot den KÖRANDE stacken: GoTrue → PostgREST → Storage.
# Verifierar det som ren SQL inte kan bevisa: JWT-validering, RLS via API,
# kundisolering, signed URLs och MFA.
#
#   ./security-gate.sh
#
# Använder endast syntetiska konton (@example.test) och städar upp efter sig.
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
set -a; . "$here/secrets/stack.env"; set +a
base="http://127.0.0.1:${GATEWAY_PORT:-8700}"
pass=0; fail=0
ok()   { echo "  PASS  $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL  $1 ${2:-}"; fail=$((fail+1)); }
json() { # json "['nyckel']" – läser JSON från stdin, tyst vid fel
  python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    v = eval('d' + sys.argv[1])
except Exception:
    sys.exit(0)
print(v if isinstance(v, str) else json.dumps(v))
" "$1"; }

admin() { curl -s -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" "$@"; }
sql()   { docker exec -i berryit-support-db psql -tA -U "${PGUSER:-supabase_admin}" -d postgres -c "$1"; }

stamp=$(date +%s)
mail_a="kund.a.$stamp@example.test"
mail_b="kund.b.$stamp@example.test"
pw="Syntetiskt-Test-$stamp!"

cleanup() {
  for m in "$mail_a" "$mail_b"; do
    id=$(sql "select id from auth.users where email = '$m'" | head -1)
    [ -n "$id" ] && admin -X DELETE "$base/auth/v1/admin/users/$id" >/dev/null
  done
  sql "delete from public.tickets where subject like 'E2E-test%'" >/dev/null
}
trap cleanup EXIT

echo "1. Auth (GoTrue)"
create_a=$(admin -X POST "$base/auth/v1/admin/users" -H "Content-Type: application/json" \
  -d "{\"email\":\"$mail_a\",\"password\":\"$pw\",\"email_confirm\":true}")
uid_a=$(printf '%s' "$create_a" | json "['id']")
[ -n "$uid_a" ] && ok "användare skapas via admin-API" || bad "kunde inte skapa användare" "$create_a"

create_b=$(admin -X POST "$base/auth/v1/admin/users" -H "Content-Type: application/json" \
  -d "{\"email\":\"$mail_b\",\"password\":\"$pw\",\"email_confirm\":true}")
uid_b=$(printf '%s' "$create_b" | json "['id']")

prof=$(sql "select count(*) from public.profiles where id = '$uid_a' and role = 'customer'")
[ "$prof" = "1" ] && ok "profil skapas automatiskt med rollen customer" || bad "ingen profil skapades"

signup=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$base/auth/v1/signup" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"oinbjuden.$stamp@example.test\",\"password\":\"$pw\"}")
[ "$signup" != "200" ] && ok "publik självregistrering är avstängd (HTTP $signup)" || bad "signup tillåts trots DISABLE_SIGNUP"

tok_a=$(curl -s -X POST "$base/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" -d "{\"email\":\"$mail_a\",\"password\":\"$pw\"}" | json "['access_token']")
tok_b=$(curl -s -X POST "$base/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" -d "{\"email\":\"$mail_b\",\"password\":\"$pw\"}" | json "['access_token']")
[ -n "$tok_a" ] && ok "inloggning ger JWT" || bad "ingen access_token"

echo "2. JWT och RLS via PostgREST"
as_user() { curl -s -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" "${@:2}"; }

empty=$(as_user "$tok_a" "$base/rest/v1/tickets?select=id")
[ "$empty" = "[]" ] && ok "ny kund ser noll ärenden" || bad "oväntat svar" "$empty"

created=$(as_user "$tok_a" -X POST "$base/rest/v1/tickets" -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{\"requester_id\":\"$uid_a\",\"subject\":\"E2E-test ärende\",\"description\":\"Syntetiskt testärende via API.\",\"category_key\":\"dator\"}")
tid=$(printf '%s' "$created" | json "[0]['id']")
ref=$(printf '%s' "$created" | json "[0]['reference']")
[ -n "$tid" ] && ok "kund kan skapa ärende via API (id $ref)" || bad "kunde inte skapa ärende" "$created"

mine=$(as_user "$tok_a" "$base/rest/v1/tickets?select=id" | grep -c "$tid")
[ "$mine" = "1" ] && ok "kund ser sitt eget ärende" || bad "ser inte sitt eget ärende"

other=$(as_user "$tok_b" "$base/rest/v1/tickets?id=eq.$tid&select=id")
[ "$other" = "[]" ] && ok "annan kund ser INTE ärendet (IDOR via API)" || bad "läckage mellan kunder" "$other"

noauth=$(curl -s -H "apikey: $ANON_KEY" "$base/rest/v1/tickets?select=id")
if [ "$noauth" = "[]" ] || printf '%s' "$noauth" | grep -q "permission denied"; then
  ok "utan inloggning nås inga ärenden"
else
  bad "anon ser data" "$noauth"
fi

forged=$(curl -s -o /dev/null -w "%{http_code}" -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.forged" \
  "$base/rest/v1/tickets?select=id")
[ "$forged" = "401" ] && ok "förfalskad JWT avvisas (HTTP 401)" || bad "förfalskad JWT accepterades (HTTP $forged)"

notes=$(as_user "$tok_a" "$base/rest/v1/ticket_internal_notes?select=id")
[ "$notes" = "[]" ] && ok "kund når inga interna anteckningar via API" || bad "interna anteckningar exponerade" "$notes"

audit=$(as_user "$tok_a" "$base/rest/v1/support_admin_audit?select=id")
[ "$audit" = "[]" ] && ok "kund når ingen revisionslogg via API" || bad "revisionslogg exponerad" "$audit"

echo "3. Storage"
bucket=$(sql "select count(*) from storage.buckets where id = 'ticket-attachments' and public = false")
[ "$bucket" = "1" ] && ok "privat bucket finns" || bad "bucket saknas eller är publik"

up=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$base/storage/v1/object/ticket-attachments/tickets/$tid/e2e.txt" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $tok_a" -H "Content-Type: text/plain" \
  --data-binary "syntetisk testfil")
[ "$up" = "200" ] && ok "kund kan ladda upp till sitt eget ärende" || bad "uppladdning misslyckades (HTTP $up)"

up_other=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$base/storage/v1/object/ticket-attachments/tickets/$tid/intrang.txt" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $tok_b" -H "Content-Type: text/plain" \
  --data-binary "ska nekas")
[ "$up_other" != "200" ] && ok "annan kund nekas uppladdning till ärendet (HTTP $up_other)" || bad "fel kund fick ladda upp"

# Filen maste registreras som kundsynlig bilaga: storage-policyn visar bara
# filer som hor till ett arende anvandaren far se. Detta ar appens riktiga flode.
reg=$(as_user "$tok_a" -X POST "$base/rest/v1/ticket_attachments" -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{\"ticket_id\":\"$tid\",\"uploaded_by\":\"$uid_a\",\"storage_path\":\"tickets/$tid/e2e.txt\",\"file_name\":\"e2e.txt\",\"mime_type\":\"text/plain\",\"size_bytes\":17}")
printf '%s' "$reg" | grep -q "storage_path" && ok "bilagan registreras pa arendet via API" || bad "kunde inte registrera bilaga" "$reg"

osign=$(as_user "$tok_b" -X POST "$base/storage/v1/object/sign/ticket-attachments/tickets/$tid/e2e.txt" -H "Content-Type: application/json" -d '{"expiresIn":60}')
printf '%s' "$osign" | grep -q "signedURL" && bad "annan kund kunde signera filen" || ok "annan kund kan inte signera filen"

signed=$(curl -s -X POST "$base/storage/v1/object/sign/ticket-attachments/tickets/$tid/e2e.txt" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $tok_a" -H "Content-Type: application/json" \
  -d '{"expiresIn":60}' | json "['signedURL']")
[ -n "$signed" ] && ok "signed URL skapas" || bad "ingen signed URL"

if [ -n "$signed" ]; then
  code=$(curl -s -o /dev/null -w "%{http_code}" "$base/storage/v1${signed}")
  [ "$code" = "200" ] && ok "signed URL ger åtkomst till filen" || bad "signed URL fungerar inte (HTTP $code)"
  nosig=$(curl -s -o /dev/null -w "%{http_code}" "$base/storage/v1/object/ticket-attachments/tickets/$tid/e2e.txt")
  [ "$nosig" != "200" ] && ok "filen är inte publikt åtkomlig utan signatur (HTTP $nosig)" || bad "filen är publik"
fi

echo "4. MFA (TOTP)"
factor=$(curl -s -X POST "$base/auth/v1/factors" -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $tok_a" -H "Content-Type: application/json" \
  -d '{"factor_type":"totp","friendly_name":"e2e"}')
secret=$(printf '%s' "$factor" | json "['totp']['secret']")
[ -n "$secret" ] && ok "TOTP-enrollment är aktiverad och ger en hemlighet" || bad "MFA ej aktiverad" "$factor"

echo
echo "$pass godkända, $fail underkända"
exit $([ "$fail" -eq 0 ] && echo 0 || echo 1)
