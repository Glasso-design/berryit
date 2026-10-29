#!/usr/bin/env python3
"""MASTER PASS 2 - BERRYIT migration rehearsal driver (20261029090000_registration_gotrue_metadata), LOCAL part.

Real PostgreSQL 16 + the repo's auth stub. GoTrue itself is SIMULATED: every "GoTrue" call below is the statement
sequence of GoTrue v2.196.0 (admin.go adminUserCreate: INSERT users -> UPDATE role -> UPDATE raw_app_meta_data ->
UPDATE banned_until, one transaction), run as the GoTrue DB role supabase_auth_admin. The REAL GoTrue run is in CI.

  seed     <ids.json>          pre-state through the OLD path (base dabecfe): incl. half-registered accounts (COMMITTED)
  checksum [<ids.json>]         data checksum of the affected tables (+ pre-existing rows only)
  precheck                      runbook pre-check queries
  verify   <ids.json> <label>   cases, each in its own ROLLED BACK transaction
"""
import json, os, subprocess, sys, uuid

PSQL = json.loads(os.environ.get('MP2_PSQL', '["psql","-h","/home/claude/scratch-pg-migration-rehearsal","-p","55493","-U","postgres","-d","bi_rehearsal"]'))
APP = '{"provider":"email","providers":["email"]}'


def psql(sql, end='commit'):
    script = f"\\set ON_ERROR_STOP 1\n\\set VERBOSITY verbose\nbegin;\n{sql.rstrip().rstrip(';')};\n{end};\n"
    p = subprocess.run(PSQL + ['-At', '-q', '-X', '-f', '-'], input=script, capture_output=True, text=True)
    err = next((l.split('ERROR:', 1)[1].strip() for l in p.stderr.splitlines() if 'ERROR:' in l), None)
    notices = [l.split('NOTICE:', 1)[1].strip() for l in p.stderr.splitlines() if 'NOTICE:' in l]
    return p.returncode, p.stdout.strip(), err, notices


def must(sql):
    rc, out, err, _ = psql(sql)
    if rc != 0:
        raise SystemExit(f'step failed: {err}\n{sql[:500]}')
    return out.splitlines()[-1] if out else ''


def gotrue_create(uid, email, full_name, app_metadata=None, ban=True, confirm=False):
    """GoTrue v2.196.0 adminUserCreate statement order, as supabase_auth_admin (SIM)."""
    s = (f"set local role supabase_auth_admin;\n"
         f"insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, role, created_at, updated_at) values "
         f"('{uid}', '{email}', '{json.dumps({'full_name': full_name, 'phone': '070-000 00 00'})}', '{APP}', '', now(), now());\n"
         f"update auth.users set role = 'authenticated', updated_at = now() where id = '{uid}';\n")
    if app_metadata is not None:
        s += f"update auth.users set raw_app_meta_data = raw_app_meta_data || '{json.dumps(app_metadata)}'::jsonb, updated_at = now() where id = '{uid}';\n"
    if confirm:
        s += f"update auth.users set email_confirmed_at = now(), updated_at = now() where id = '{uid}';\n"
    if ban:
        s += f"update auth.users set banned_until = now() + interval '876000 hours', updated_at = now() where id = '{uid}';\n"
    return s + "reset role;\n"


def marker(I, actor='sa', session='sa_aal2', org='A'):
    return {'berryit_manual_customer': {'actor_id': I['users'][actor], 'session_id': I['sessions'][session],
                                       'organization_id': I['orgs'][org] if org else None}}


def seed(path):
    I = {'users': {}, 'orgs': {}, 'sessions': {}}
    for k in ('A', 'B', 'C_empty'):
        I['orgs'][k] = must(f"insert into public.organizations (name) values ('MP2 Kund {k} AB') returning id")
    for k in ('sa', 'admin2', 'tech', 'custA', 'custB', 'custPriv', 'regOld', 'halfA', 'halfPriv'):
        I['users'][k] = str(uuid.uuid4())
    U = I['users']
    # Staff and ordinary customers: created by GoTrue admin-create without a marker, roles/orgs set by the owner (SQL),
    # exactly like the pass-1 stack-up fixture.
    for k in ('sa', 'admin2', 'tech', 'custA', 'custB', 'custPriv'):
        must(gotrue_create(U[k], f'mp2.{k.lower()}@example.test', f'MP2 {k}', ban=False, confirm=True))
    must(f"""update public.profiles set role = 'admin' where id in ('{U['sa']}', '{U['admin2']}');
update public.profiles set role = 'technician' where id = '{U['tech']}';
update public.profiles set organization_id = '{I['orgs']['A']}' where id = '{U['custA']}';
update public.profiles set organization_id = '{I['orgs']['B']}' where id = '{U['custB']}';
insert into public.support_role_grants (grantee_id, role_key, scope, reason) values ('{U['sa']}', 'BERRYIT_SUPPORT_SUPER_ADMIN', 'global', 'MP2 rehearsal owner decision');
insert into public.support_role_grants (grantee_id, role_key, scope, organization_id, reason) values ('{U['tech']}', 'BERRYIT_SUPPORT_TECHNICIAN', 'organization', '{I['orgs']['A']}', 'MP2 rehearsal scoped technician')""")
    for k, who, aal in (('sa_aal2', 'sa', 'aal2'), ('sa_aal1', 'sa', 'aal1'), ('admin2_aal2', 'admin2', 'aal2')):
        I['sessions'][k] = str(uuid.uuid4())
        must(f"insert into auth.sessions (id, user_id, aal) values ('{I['sessions'][k]}', '{U[who]}', '{aal}')")
    # Correct registration through the single-INSERT path (marker already in INSERT: PGlite fixtures / older GoTrue).
    must(f"set local role supabase_auth_admin; insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, role, banned_until) values "
         f"('{U['regOld']}', 'mp2.regold@example.test', '{{\"full_name\":\"MP2 regOld\"}}', '{json.dumps(dict(json.loads(APP), **marker(I)))}', 'authenticated', now() + interval '876000 hours')")
    # Half-registered accounts: the pass-1 bug. Real GoTrue order on the base schema -> plain profile, marker in app_metadata.
    must(gotrue_create(U['halfA'], 'mp2.halfa@example.test', 'MP2 halfA', marker(I)))
    must(gotrue_create(U['halfPriv'], 'mp2.halfpriv@example.test', 'MP2 halfPriv', marker(I, org=None)))
    # Everything above is "existing" data: created a day before the migration.
    must("update auth.users set created_at = created_at - interval '1 day'; update public.profiles set created_at = created_at - interval '1 day'")
    json.dump(I, open(path, 'w'), indent=1)
    print('seeded: ' + must("select string_agg(x, '; ') from (select 'profiles ' || role || '=' || count(*) x from public.profiles group by role "
                            "union all select 'orgs=' || count(*) from public.organizations union all select 'sessions=' || count(*) from auth.sessions "
                            "union all select 'audit=' || count(*) from public.support_admin_audit) s"))
    print('half-registered (marker in app_metadata, plain profile): ' + must(
        "select string_agg(u.email || ' org=' || coalesce(p.organization_id::text,'null') || ' pending=' || p.login_activation_pending || ' registered_by=' || coalesce(p.registered_by::text,'null'), ' | ') "
        "from auth.users u join public.profiles p on p.id = u.id where u.raw_app_meta_data ? 'berryit_manual_customer' and p.registered_by is null"))


TABLES = {
    'auth.users': "select id, email, raw_user_meta_data, raw_app_meta_data, role, banned_until, created_at from auth.users",
    'auth.sessions': "select * from auth.sessions",
    'public.profiles': "select * from public.profiles",
    'public.organizations': "select * from public.organizations",
    'public.support_admin_audit': "select * from public.support_admin_audit",
    'public.support_role_grants': "select * from public.support_role_grants",
}


def checksum(path=None):
    I = json.load(open(path)) if path else None
    for name, q in TABLES.items():
        rc, out, err, _ = psql(f"select count(*) || ' ' || coalesce(md5(string_agg(t::text, '|' order by t::text)), '-') from ({q}) t", end='rollback')
        print(f'{name}: ' + (out.splitlines()[-1] if rc == 0 else f'ERR {err}'))
    if I:
        ids = ','.join(f"'{v}'" for v in I['users'].values())
        for name, q in (('auth.users', TABLES['auth.users']), ('public.profiles', TABLES['public.profiles'])):
            rc, out, err, _ = psql(f"select count(*) || ' ' || md5(string_agg(t::text, '|' order by t::text)) from ({q}) t where id in ({ids})", end='rollback')
            print(f'{name}[seeded rows]: ' + (out.splitlines()[-1] if rc == 0 else f'ERR {err}'))


PRECHECK = {
    'half_registered_accounts (marker in app_metadata, profile never registered)':
        "select count(*) || ': ' || coalesce(string_agg(u.email, ', '), '-') from auth.users u join public.profiles p on p.id = u.id "
        "where u.raw_app_meta_data ? 'berryit_manual_customer' and p.registered_by is null and not p.login_activation_pending",
    'registered_accounts (INSERT path, untouched by the migration)':
        "select count(*) from auth.users u join public.profiles p on p.id = u.id where u.raw_app_meta_data ? 'berryit_manual_customer' and p.registered_by is not null",
    'auth_users_without_profile': "select count(*) from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)",
    'name_collision (trigger/function already present)':
        "select count(*) from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'auth_user_registration_metadata' "
        "union all select count(*) from pg_proc where proname = 'handle_auth_user_registration_metadata'",
    'auth.users owner / migration role / superuser / TRIGGER privilege':
        "select relowner::regrole || ' / ' || current_user || ' / ' || (select rolsuper from pg_roles where rolname = current_user) || ' / ' || has_table_privilege('auth.users', 'TRIGGER') from pg_class where oid = 'auth.users'::regclass",
    'open transactions holding locks on auth.users (must be 0 before UP)':
        "select count(*) from pg_locks l join pg_stat_activity a on a.pid = l.pid where l.relation = 'auth.users'::regclass and a.pid <> pg_backend_pid()",
    'ledger (migrate.sh public.schema_migrations): last version / 20261029090000 present':
        "select max(version) || ' / ' || bool_or(version = '20261029090000_registration_gotrue_metadata.sql') from public.schema_migrations",
}


def precheck():
    for name, q in PRECHECK.items():
        rc, out, err, _ = psql(q, end='rollback')
        print(f'{name}: ' + (' | '.join(out.splitlines()) if rc == 0 else f'ERR {err}'))


AUDIT = lambda uid: (f"(select coalesce(string_agg(action || '(' || coalesce(actor_id::text, 'NULL') || ')', ', ' order by id), 'none') "
                     f"from public.support_admin_audit where target_id = '{uid}' and created_at = now())")  # rows written by THIS transaction
CALLS = ("(select coalesce(sum(calls), 0) from pg_stat_xact_user_functions where funcname = 'handle_auth_user_registration_metadata')")


def verify(path, label):
    I = json.load(open(path))
    U = I['users']
    R = []

    def case(name, sql, expect='ok', check=None):
        rc, out, err, notices = psql("set local track_functions = 'pl';\n" + sql, end='rollback')
        code = err.split(':', 1)[0] if err else None
        last = out.splitlines()[-1].strip() if out else ''
        good = (rc == 0) if expect == 'ok' else (code == expect)
        if good and check is not None:
            good = check(last)
        R.append((good, name, expect, code or 'ok', last[:300] if not err else err[:200]))

    new = lambda: str(uuid.uuid4())
    # 1. Registration through the GoTrue order now works, exactly once, all audit rows counted (M1).
    n1 = new()
    case('org registration (GoTrue order): org/pending/registered_by set; ALL audit rows listed',
         gotrue_create(n1, f'mp2.n1.{n1[:8]}@example.test', 'MP2 ny kund', marker(I)) +
         f"select p.organization_id = '{I['orgs']['A']}' and p.login_activation_pending and p.registered_by = '{U['sa']}' and p.role = 'customer', "
         f"{AUDIT(n1)} from public.profiles p where p.id = '{n1}'",
         check=lambda o: o.startswith('t|'))
    n1b = new()
    case('M1 check: ONE registration writes exactly ONE audit row in total (any action, any actor)',
         gotrue_create(n1b, f'mp2.m1.{n1b[:8]}@example.test', 'MP2 M1', marker(I)) +
         f"select (select count(*) from public.support_admin_audit where target_id = '{n1b}' and created_at = now()), {AUDIT(n1b)}",
         check=lambda o: o.startswith('1|'))
    n2 = new()
    case('private registration (org null) -> scope global',
         gotrue_create(n2, f'mp2.n2.{n2[:8]}@example.test', 'MP2 privat', marker(I, org=None)) +
         f"select p.organization_id is null and p.login_activation_pending, (select scope from public.support_admin_audit where target_id = '{n2}' and action = 'customer_registered'), {AUDIT(n2)} from public.profiles p where p.id = '{n2}'",
         check=lambda o: o.startswith('t|global|'))
    n3 = new()
    case('exactly once: later GoTrue writes (provider merge, email change, recovery, password, ban lift, sign-in, aal2 session) add no audit row',
         gotrue_create(n3, f'mp2.n3.{n3[:8]}@example.test', 'MP2 en gang', marker(I)) +
         f"select set_config('mp2.before', ({AUDIT(n3)}), true), set_config('mp2.calls', {CALLS}::text, true);\n"
         f"set local role supabase_auth_admin;\n"
         f"update auth.users set raw_app_meta_data = raw_app_meta_data || '{{\"providers\":[\"email\",\"email\"]}}'::jsonb, updated_at = now() where id = '{n3}';\n"
         f"update auth.users set email_change = 'mp2.n3.ny@example.test', updated_at = now() where id = '{n3}';\n"
         f"update auth.users set email = email_change, email_change = '', updated_at = now() where id = '{n3}';\n"
         f"update auth.users set recovery_token = 'x', recovery_sent_at = now() where id = '{n3}';\n"
         f"update auth.users set encrypted_password = 'y', recovery_token = '', updated_at = now() where id = '{n3}';\n"
         f"update auth.users set banned_until = null, email_confirmed_at = now() where id = '{n3}';\n"
         f"update auth.users set last_sign_in_at = now() where id = '{n3}';\n"
         f"insert into auth.sessions (id, user_id, aal) values ('{new()}', '{n3}', 'aal1');\n"
         f"update auth.sessions set aal = 'aal2' where user_id = '{n3}';\n"
         f"update auth.users set raw_app_meta_data = raw_app_meta_data || '{{\"mfa\":true}}'::jsonb where id = '{n3}';\n"
         f"reset role;\nselect ({AUDIT(n3)}) = current_setting('mp2.before'), {CALLS} - current_setting('mp2.calls')::int, {AUDIT(n3)}",
         check=lambda o: o.startswith('t|2|'))
    # 2. A normal user cannot escalate through their own metadata.
    case('customer edits own user_metadata (GoTrue PUT /user data) with marker + role + org: profile unchanged, function not called',
         f"select set_config('mp2.p', (select row(p.*)::text from public.profiles p where id = '{U['custPriv']}'), true);\n"
         f"set local role supabase_auth_admin;\nupdate auth.users set raw_user_meta_data = raw_user_meta_data || '{json.dumps(dict(marker(I), role='admin', organization_id=I['orgs']['A']))}'::jsonb where id = '{U['custPriv']}';\nreset role;\n"
         f"select (select row(p.*)::text from public.profiles p where id = '{U['custPriv']}') = current_setting('mp2.p'), {CALLS}, {AUDIT(U['custPriv'])}",
         check=lambda o: o.startswith('t|0|'))
    case('customer PATCHes own profile via PostgREST (role/org/pending/registered_by): silently kept',
         f"select set_config('request.jwt.claims', '{json.dumps({'sub': U['custPriv'], 'role': 'authenticated'})}', true), set_config('request.jwt.claim.sub', '{U['custPriv']}', true);\n"
         f"set local role authenticated;\nupdate public.profiles set role = 'admin', organization_id = '{I['orgs']['A']}', login_activation_pending = true, registered_by = '{U['sa']}' where id = '{U['custPriv']}';\nreset role;\n"
         f"select role, organization_id is null, login_activation_pending, registered_by is null from public.profiles where id = '{U['custPriv']}'",
         check=lambda o: o == 'customer|t|f|t')
    case('customer cannot write auth.users at all (PostgREST role)',
         f"set local role authenticated;\nupdate auth.users set raw_app_meta_data = '{json.dumps(marker(I))}' where id = '{U['custPriv']}'", expect='42501')
    case('admin API sets marker on an EXISTING account (valid live aal2 session): refused, whole GoTrue tx aborts',
         f"set local role supabase_auth_admin;\nupdate auth.users set raw_app_meta_data = raw_app_meta_data || '{json.dumps(marker(I))}'::jsonb where id = '{U['custPriv']}'", expect='42501')
    # 3. Fail-closed registrar checks leave no account behind (checked inside the same transaction via a subtransaction).
    for nm, mk, code in (('registrar only aal1', marker(I, session='sa_aal1'), '42501'),
                         ('registrar session deleted (logged out)', marker(I, session='sa_aal2'), '42501'),
                         ('admin without SUPER_ADMIN grant (aal2)', marker(I, actor='admin2', session='admin2_aal2'), '42501'),
                         ('unknown organisation', {'berryit_manual_customer': dict(marker(I)['berryit_manual_customer'], organization_id=str(uuid.uuid4()))}, '23503')):
        nid = new()
        pre = f"delete from auth.sessions where id = '{I['sessions']['sa_aal2']}';\n" if 'deleted' in nm else ''
        body = gotrue_create(nid, f'mp2.deny.{nid[:8]}@example.test', 'MP2 nekad', mk).replace("'", "''")
        case(f'refused: {nm} -> SQLSTATE {code}, 0 auth.users rows',
             pre + f"do $$ begin execute '{body}'; raise exception 'NOT REFUSED'; exception when sqlstate '{code}' then null; end $$;\n"
             f"reset role; select count(*) from auth.users where id = '{nid}'", check=lambda o: o == '0')
    # 4. Existing accounts.
    case('half-registered account: admin app_metadata update -> no error, NOT repaired (still org null, not pending), no audit',
         f"set local role supabase_auth_admin;\nupdate auth.users set raw_app_meta_data = raw_app_meta_data || '{{\"note\":\"x\"}}'::jsonb where id = '{U['halfA']}';\nreset role;\n"
         f"select organization_id is null, login_activation_pending, registered_by is null, {AUDIT(U['halfA'])} from public.profiles where id = '{U['halfA']}'",
         check=lambda o: o == 't|f|t|none')
    case('INSERT-path registered account: later admin update + ban lift is a no-op (no new audit row)',
         f"set local role supabase_auth_admin;\nupdate auth.users set raw_app_meta_data = raw_app_meta_data || '{{\"note\":\"x\"}}'::jsonb, banned_until = null where id = '{U['regOld']}';\nreset role;\n"
         f"select {AUDIT(U['regOld'])}", check=lambda o: o == 'none')
    case('single-INSERT registration path unchanged (marker in INSERT)',
         f"set local role supabase_auth_admin;\ninsert into auth.users (id, email, raw_app_meta_data) values ('{n1}', 'mp2.ins@example.test', '{json.dumps(dict(json.loads(APP), **marker(I)))}');\nreset role;\n"
         f"select login_activation_pending, registered_by = '{U['sa']}', {AUDIT(n1)} from public.profiles where id = '{n1}'", check=lambda o: o.startswith('t|t|'))
    passed = sum(r[0] for r in R)
    for good, name, expect, got, detail in R:
        print(('PASS  ' if good else 'FAIL  ') + f'{name}  [expect {expect}, got {got}]  -> {detail}')
    print(f'\n{label}: {passed}/{len(R)} pass')
    return passed == len(R)


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'seed':
        seed(sys.argv[2])
    elif cmd == 'checksum':
        checksum(sys.argv[2] if len(sys.argv) > 2 else None)
    elif cmd == 'precheck':
        precheck()
    elif cmd == 'verify':
        sys.exit(0 if verify(sys.argv[2], sys.argv[3]) else 1)
