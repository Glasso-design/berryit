#!/usr/bin/env bash
# Pure shell mocks: no Docker daemon, gateway, database or service keys are used.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/security-gate-safety.sh"

test_keys=$(mktemp)
calls=$(mktemp)
dummy_dump=$(mktemp)
trap 'rm -f "$test_keys" "$calls" "$dummy_dump"' EXIT
: > "$calls"

BERRYIT_TEST_ENV=isolated
BERRYIT_TEST_PROJECT=berryit-support-test-fixture
BERRYIT_TEST_STACK_ID=11111111-1111-4111-8111-111111111111
BERRYIT_TEST_GATEWAY_PORT=18700
BERRYIT_TEST_SECRETS_FILE="$test_keys"
fixture_marker="isolated|$BERRYIT_TEST_STACK_ID"
fail=0
base="http://127.0.0.1:18700"

docker() {
  case "$1" in
    inspect) printf '%s\n' "$BERRYIT_TEST_PROJECT" ;;
    port) printf '127.0.0.1:%s\n' "$BERRYIT_TEST_GATEWAY_PORT" ;;
    *) echo 'unexpected Docker call' >&2; return 1 ;;
  esac
}

set_fixture() {
  run_id="$1"; uid_a="$2"; uid_b="$3"; tid="$4"
  mail_a="kund.a.$run_id@example.test"
  mail_b="kund.b.$run_id@example.test"
  run_subject="E2E-test $run_id"
  fixture_tid="$tid"
}

sql() {
  local query="$1"
  printf '%s\n' "$query" >> "$calls"
  if [[ "$query" == *"current_setting('berryit.test_environment'"* ]]; then
    printf '%s\n' "$fixture_marker"
  elif [[ "$query" == 'select count(*) from public.tickets'* ]]; then
    if [[ "$query" == *"t.id = '$fixture_tid'"* && "$query" == *"t.subject = '$run_subject'"* &&
          "$query" == *"a.email = '$mail_a'"* && "$query" == *"b.email = '$mail_b'"* ]]; then
      echo 1
    else
      echo 0
    fi
  elif [[ "$query" == 'delete from public.tickets'* ]]; then
    [[ "$query" == *"t.id = '$fixture_tid'"* && "$query" == *"t.subject = '$run_subject'"* &&
       "$query" == *"t.requester_id = '$uid_a'"* ]] || return 1
    printf '%s\n' "$tid"
  elif [[ "$query" == 'select id from auth.users'* ]]; then
    if [[ "$query" == *"id = '$uid_a'"* && "$query" == *"email = '$mail_a'"* ]]; then echo "$uid_a"
    elif [[ "$query" == *"id = '$uid_b'"* && "$query" == *"email = '$mail_b'"* ]]; then echo "$uid_b"
    else return 1; fi
  else
    echo 'unexpected SQL' >&2; return 1
  fi
}

admin() {
  printf 'admin %s\n' "$*" >> "$calls"
  echo 204
}

expect_reject() {
  if "$@" >/dev/null 2>&1; then echo 'FAIL: unsafe operation accepted' >&2; exit 1; fi
}
expect_no_delete() {
  if grep -Eiq 'delete from|admin .*DELETE|drop database' "$calls"; then
    echo 'FAIL: cleanup was attempted' >&2; exit 1
  fi
}

set_fixture aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb cccccccc-cccc-4ccc-8ccc-cccccccccccc dddddddd-dddd-4ddd-8ddd-dddddddddddd
sg_require_isolated_target

# Unknown database, production environment and production stack all fail
# before any test write or cleanup.
fixture_marker=''
: > "$calls"; expect_reject sg_require_isolated_target; expect_no_delete
fixture_marker="isolated|$BERRYIT_TEST_STACK_ID"
BERRYIT_TEST_ENV=production
: > "$calls"; expect_reject sg_require_isolated_target; expect_no_delete
BERRYIT_TEST_ENV=isolated
BERRYIT_TEST_PROJECT=berryit-support
: > "$calls"; expect_reject sg_require_isolated_target; expect_no_delete
BERRYIT_TEST_PROJECT=berryit-support-test-fixture
BERRYIT_TEST_GATEWAY_PORT=8700
: > "$calls"; expect_reject sg_require_isolated_target; expect_no_delete
BERRYIT_TEST_GATEWAY_PORT=18700

# Missing or forged created IDs fail before a DELETE. A failed test never
# starts cleanup, including when the shell exits unexpectedly.
saved_tid="$tid"; tid=''
: > "$calls"; expect_reject sg_cleanup_owned_fixture; expect_no_delete
tid=eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee
: > "$calls"; expect_reject sg_cleanup_owned_fixture; expect_no_delete
tid="$saved_tid"
fail=1
: > "$calls"; expect_reject sg_cleanup_owned_fixture; expect_no_delete
fail=0

# A legitimate E2E-test subject and an earlier run have other IDs. The only
# DELETE that can be formed is the current ticket ID plus ownership predicates.
legitimate_tid=66666666-6666-4666-8666-666666666666
previous_tid=ffffffff-ffff-4fff-8fff-ffffffffffff
: > "$calls"; sg_cleanup_owned_fixture
grep -Fq "t.id = '$saved_tid'" "$calls"
grep -Fq "t.subject = '$run_subject'" "$calls"
if grep -Eiq 'subject[[:space:]]+like|E2E-test%' "$calls"; then exit 1; fi
if grep -Fq "$legitimate_tid" "$calls" || grep -Fq "$previous_tid" "$calls"; then exit 1; fi

# Concurrent runs have disjoint IDs and subjects, even with identical labels.
first_tid="$tid"
set_fixture 22222222-2222-4222-8222-222222222222 33333333-3333-4333-8333-333333333333 44444444-4444-4444-8444-444444444444 55555555-5555-4555-8555-555555555555
: > "$calls"; sg_cleanup_owned_fixture
grep -Fq "t.id = '$tid'" "$calls"
if grep -Fq "$first_tid" "$calls"; then exit 1; fi

# Never execute the live-stack entry point in this suite, even on a rejection
# path. Exercise the sourced guard above with mocks; verify its entry ordering
# structurally here. Fail on any change to the executable prelude, so a write
# inserted before the guard cannot silently escape the negative tests.
node - "$here/security-gate.sh" <<'JS'
const assert = require('node:assert/strict');
const source = require('node:fs').readFileSync(process.argv[2], 'utf8');
const lines = source.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
const expected = [
    'set -euo pipefail',
    'here="$(cd "$(dirname "$0")" && pwd)"',
    '. "$here/security-gate-safety.sh"',
    'sql() { docker exec -i "$BERRYIT_TEST_PROJECT-db" psql -tA -U "${PGUSER:-supabase_admin}" -d postgres -c "$1"; }',
    'sg_require_isolated_target || exit 1',
];
assert.deepEqual(lines.slice(0, expected.length), expected, 'Gate must reject unknown targets before any effects');
assert.equal(lines[expected.length], 'set -a; . "$BERRYIT_TEST_SECRETS_FILE"; set +a');
assert.ok(!source.includes('trap '), 'The gate must never register an exit cleanup');
assert.ok(!source.toLowerCase().includes('subject like'), 'Broad cleanup is forbidden');
JS

# The restore trap is not armed when CREATE DATABASE fails. Docker is a shell
# mock here; no database, dump, restore or real container is accessed.
docker() {
  printf 'docker %s\n' "$*" >> "$calls"
  [[ "$*" == *'create database'* ]] && return 1
  return 0
}
export -f docker
export calls
: > "$calls"
if bash "$here/restore-test.sh" "$dummy_dump" >/dev/null 2>&1; then exit 1; fi
if grep -Eiq 'drop database' "$calls"; then echo 'FAIL: restore trap deleted an unowned database' >&2; exit 1; fi

echo 'PASS: isolated target, exact owned IDs, failure paths, concurrent runs and restore collision'
