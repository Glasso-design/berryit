#!/usr/bin/env bash
# Sourced by security-gate.sh. Fail closed before any test writes or cleanup.

sg_uuid() {
  [[ "$1" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]
}

sg_require_isolated_target() {
  local project="${BERRYIT_TEST_PROJECT:-}" port="${BERRYIT_TEST_GATEWAY_PORT:-}"
  local marker db_project gateway_project mapping secret_path production_path

  [[ "${BERRYIT_TEST_ENV:-}" == isolated ]] || { echo 'Kräver BERRYIT_TEST_ENV=isolated' >&2; return 1; }
  [[ "$project" =~ ^berryit-support-test-[a-z0-9-]+$ ]] || { echo 'Okänt testprojekt' >&2; return 1; }
  sg_uuid "${BERRYIT_TEST_STACK_ID:-}" || { echo 'Saknar giltig teststack-identitet' >&2; return 1; }
  [[ "$port" =~ ^[0-9]{4,5}$ ]] && ((10#$port <= 65535)) && [[ "$port" != 8700 ]] || {
    echo 'Ogiltig eller produktionsklassad gateway-port' >&2; return 1;
  }
  [[ -n "${BERRYIT_TEST_SECRETS_FILE:-}" && -f "$BERRYIT_TEST_SECRETS_FILE" ]] || {
    echo 'Separat testnyckelfil saknas' >&2; return 1;
  }
  secret_path=$(readlink -f "$BERRYIT_TEST_SECRETS_FILE") || return 1
  production_path=$(readlink -f "$here/secrets/stack.env" 2>/dev/null || true)
  [[ "$secret_path" != "$production_path" && "$secret_path" != "$here/secrets/stack.env" ]] || {
    echo 'Produktionsstackens nyckelfil får inte användas' >&2; return 1;
  }

  db_project=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$project-db" 2>/dev/null) || return 1
  gateway_project=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$project-gateway" 2>/dev/null) || return 1
  [[ "$db_project" == "$project" && "$gateway_project" == "$project" ]] || {
    echo 'Databas och gateway hör inte till samma isolerade testprojekt' >&2; return 1;
  }
  mapping=$(docker port "$project-gateway" 8080/tcp 2>/dev/null) || return 1
  [[ "$mapping" == "127.0.0.1:$port" ]] || { echo 'Gateway-porten matchar inte testprojektet' >&2; return 1; }

  marker=$(sql "select coalesce(current_setting('berryit.test_environment', true), '') || '|' || coalesce(current_setting('berryit.test_stack_id', true), '')") || return 1
  [[ "$marker" == "isolated|$BERRYIT_TEST_STACK_ID" ]] || {
    echo 'Databasen saknar matchande isolerad testmarkör' >&2; return 1;
  }
}

sg_cleanup_owned_fixture() {
  local owned deleted id email verified code
  [[ "${fail:-1}" == 0 ]] || { echo 'Testfel: ingen automatisk cleanup' >&2; return 1; }
  sg_require_isolated_target || return 1
  for id in "$run_id" "$uid_a" "$uid_b" "$tid"; do
    sg_uuid "$id" || { echo 'Saknat eller ogiltigt skapat ID: ingen cleanup' >&2; return 1; }
  done
  [[ "$uid_a" != "$uid_b" && "$tid" != "$uid_a" && "$tid" != "$uid_b" ]] || return 1
  [[ "$mail_a" == "kund.a.$run_id@example.test" && "$mail_b" == "kund.b.$run_id@example.test" &&
     "$run_subject" == "E2E-test $run_id" ]] || return 1

  # Alla tre objekt måste finnas med exakt den här körningens ID och markörer.
  # Saknas ett objekt avbryts cleanup innan någon DELETE skickas.
  owned=$(sql "select count(*) from public.tickets t join auth.users a on a.id = t.requester_id join auth.users b on b.id = '$uid_b' where t.id = '$tid' and t.requester_id = '$uid_a' and t.subject = '$run_subject' and a.email = '$mail_a' and b.email = '$mail_b'") || return 1
  [[ "$owned" == 1 ]] || { echo 'Ägarskap kunde inte verifieras: ingen cleanup' >&2; return 1; }

  # Predikaten upprepas i DELETE för att även en förändring mellan kontroll och
  # radering ska faila stängt. Ingen subject-baserad mängdradering används.
  deleted=$(sql "delete from public.tickets t where t.id = '$tid' and t.requester_id = '$uid_a' and t.subject = '$run_subject' and exists (select 1 from auth.users a where a.id = '$uid_a' and a.email = '$mail_a') and exists (select 1 from auth.users b where b.id = '$uid_b' and b.email = '$mail_b') returning t.id") || return 1
  [[ "$deleted" == "$tid" ]] || { echo 'Ärendet raderades inte exakt: konton lämnas kvar' >&2; return 1; }

  for id in "$uid_a" "$uid_b"; do
    if [[ "$id" == "$uid_a" ]]; then email="$mail_a"; else email="$mail_b"; fi
    verified=$(sql "select id from auth.users where id = '$id' and email = '$email'") || return 1
    [[ "$verified" == "$id" ]] || { echo 'Kontots ägarskap kunde inte verifieras' >&2; return 1; }
    code=$(admin -sS -o /dev/null -w '%{http_code}' -X DELETE "$base/auth/v1/admin/users/$id") || return 1
    [[ "$code" == 200 || "$code" == 204 ]] || { echo 'Konto-cleanup misslyckades' >&2; return 1; }
  done
}
