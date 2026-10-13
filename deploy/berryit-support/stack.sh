#!/usr/bin/env bash
# Enda vägen in till BERRYiT-stacken på prod-node-01.
#
#   ./stack.sh up | down | ps | logs [tjänst] | pull | psql | resources
#
# Rör aldrig andra compose-projekt. Alla kommandon är scopeade till
# compose-projektet berryit-support.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
env_file="$here/secrets/stack.env"
compose_file="$here/compose.yaml"

[ -f "$env_file" ] || { echo "saknar secrets/stack.env – kör ./generate-secrets.sh" >&2; exit 1; }

dc() { docker compose --project-directory "$here" --env-file "$env_file" -f "$compose_file" "$@"; }

case "${1:-}" in
  up)
    dc pull --quiet
    dc up -d
    dc ps
    ;;
  down)   dc down ;;                      # behåller volymer
  ps)     dc ps ;;
  logs)   shift; dc logs --tail 80 "$@" ;;
  pull)   dc pull ;;
  psql)   shift; docker exec -i berryit-support-db psql -U "${PGUSER:-supabase_admin}" -d postgres "$@" ;;
  resources)
    docker stats --no-stream \
      --format "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" \
      $(dc ps -q | tr '\n' ' ') 2>/dev/null
    ;;
  *)
    echo "användning: $0 {up|down|ps|logs|pull|psql|resources}" >&2
    exit 2
    ;;
esac
