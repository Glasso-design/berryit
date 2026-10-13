#!/usr/bin/env bash
# Genererar BERRYiT Support Desks egna secrets PÅ VÄRDEN.
# Inget kopieras från ONARLY eller någon annan stack. Körs en gång.
#
#   ./generate-secrets.sh            # skapar secrets/stack.env om den saknas
#   FORCE=1 ./generate-secrets.sh    # skriver över (roterar alla nycklar)
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
secrets_dir="$here/secrets"
env_file="$secrets_dir/stack.env"

if [ -f "$env_file" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "secrets/stack.env finns redan – avbryter (FORCE=1 för att rotera)." >&2
  exit 1
fi

mkdir -p "$secrets_dir"
chmod 700 "$secrets_dir"

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

jwt() { # $1 = roll, $2 = hemlighet
  local role="$1" secret="$2" now exp header payload signing_input sig
  now=$(date +%s)
  exp=$((now + 60 * 60 * 24 * 3650)) # 10 år – servicenycklar roteras manuellt
  header=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
  payload=$(printf '{"role":"%s","iss":"berryit-support","iat":%s,"exp":%s}' "$role" "$now" "$exp" | b64url)
  signing_input="${header}.${payload}"
  sig=$(printf '%s' "$signing_input" | openssl dgst -sha256 -hmac "$secret" -binary | b64url)
  printf '%s.%s' "$signing_input" "$sig"
}

postgres_password=$(openssl rand -hex 24)
jwt_secret=$(openssl rand -hex 32) # >= 32 tecken krävs av GoTrue/PostgREST
anon_key=$(jwt anon "$jwt_secret")
service_key=$(jwt service_role "$jwt_secret")

umask 077
cat > "$env_file" <<EOF
# BERRYiT Support Desk – secrets. Genererade $(date -u +%Y-%m-%dT%H:%M:%SZ) på $(hostname).
# Får aldrig checkas in, kopieras till annan stack eller lämna servern.
POSTGRES_PASSWORD=$postgres_password
JWT_SECRET=$jwt_secret
ANON_KEY=$anon_key
SERVICE_ROLE_KEY=$service_key

# Intern bind-adress för gatewayen (ingen publik port).
GATEWAY_PORT=8700

# Används av GoTrue för länkar. Byts till https://portal.berryit.se när DNS finns.
PUBLIC_BASE_URL=http://127.0.0.1:8700
EOF

chmod 600 "$env_file"
echo "Skrev $env_file (0600 i 0700-katalog)."
