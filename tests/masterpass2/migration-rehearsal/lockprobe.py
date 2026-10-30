#!/usr/bin/env python3
"""MASTER PASS 2 - lock probe for a migration file (works locally and inside a CI db container).

  lockprobe.py <migration.sql> [--blocker "<sql held open in a 3rd session>"] [--victim "<sql run while UP is open>"]

1. Session UP: begin; <migration>; list its own locks; pg_sleep(4); ROLLBACK (nothing is applied).
2. Session OBSERVER (separate connection, 1.5 s later): pg_locks of the UP backend, as another session sees them.
3. Optional --victim: while UP holds its locks, a 3rd session runs <sql> with lock_timeout=1500ms -> blocked or not.
4. Optional --blocker: a 3rd session holds <sql> in an open transaction first; UP then runs with lock_timeout=1500ms.
psql command: MP2_PSQL (JSON array), same as the drivers. Prints one block per probe.
"""
import json, os, subprocess, sys, time

PSQL = json.loads(os.environ['MP2_PSQL'])
mig = open(sys.argv[1]).read()
args = sys.argv[2:]
victim = args[args.index('--victim') + 1] if '--victim' in args else None
blocker = args[args.index('--blocker') + 1] if '--blocker' in args else None

OWN = """select locktype || ' ' || coalesce(relation::regclass::text, case when classid is not null then pg_describe_object(classid, objid, objsubid) end, virtualxid, transactionid::text, '') || ' ' || mode || case when granted then '' else ' (WAITING)' end
  from pg_locks where pid = pg_backend_pid() and locktype <> 'virtualxid' order by 1"""


def run(script, wait=True):
    p = subprocess.Popen(PSQL + ['-At', '-X', '-f', '-'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    p.stdin.write(script); p.stdin.close()
    if wait:
        out, err = p.stdout.read(), p.stderr.read(); p.wait()
        return out, err
    return p


def up_script(app, sleep=4, timeout=None):
    return (f"set application_name = '{app}';\n" + (f"set lock_timeout = '{timeout}';\n" if timeout else '') +
            "\\set ON_ERROR_STOP 1\nbegin;\nselect 'up-start ' || clock_timestamp();\n" + mig +
            f"\nselect 'own-lock ' || x from ({OWN}) s(x);\nselect 'up-end ' || clock_timestamp();\nselect pg_sleep({sleep});\nrollback;\n")


print('== 1+2: locks held by the UP transaction (rolled back afterwards)')
p = run(up_script('mp2-up-probe'), wait=False)
time.sleep(1.5)
obs, oerr = run("""select 'observer ' || l.locktype || ' ' || coalesce(l.relation::regclass::text, case when l.classid is not null then pg_describe_object(l.classid, l.objid, l.objsubid) end, l.transactionid::text, '') || ' ' || l.mode || ' granted=' || l.granted
  from pg_locks l join pg_stat_activity a on a.pid = l.pid where a.application_name = 'mp2-up-probe' and l.locktype <> 'virtualxid' order by 1;""")
out, err = p.stdout.read(), p.stderr.read(); p.wait()
print('\n'.join(l for l in out.splitlines() if l.startswith(('up-', 'own-lock'))))
print(obs.strip() or f'observer: no rows {oerr.strip()}')
if err.strip():
    print('UP stderr: ' + ' | '.join(l for l in err.splitlines() if 'NOTICE' not in l)[:600])

if victim:
    print('\n== 3: victim statement while UP is open (lock_timeout 1500ms)')
    p = run(up_script('mp2-up-holder', sleep=5), wait=False)
    time.sleep(1.5)
    t0 = time.time()
    vout, verr = run(f"set application_name='mp2-victim';\nset lock_timeout = '1500ms';\n\\set ON_ERROR_STOP 1\nbegin;\n{victim};\nrollback;\n")
    dt = time.time() - t0
    verdict = 'BLOCKED (lock_timeout)' if 'lock timeout' in verr else ('ERROR ' + verr.strip()[:300] if 'ERROR' in verr else 'not blocked')
    print(f'victim: {verdict} after {dt:.2f}s; output: {vout.strip()[:200]}')
    p.stdout.read(); p.stderr.read(); p.wait()

if blocker:
    print('\n== 4: UP while another transaction is open (lock_timeout 1500ms on UP)')
    b = run(f"set application_name='mp2-blocker';\nbegin;\n{blocker};\nselect pg_sleep(6);\nrollback;\n", wait=False)
    time.sleep(1.5)
    t0 = time.time()
    out, err = run(up_script('mp2-up-after-blocker', sleep=0, timeout='1500ms'))
    dt = time.time() - t0
    verdict = 'UP BLOCKED (lock_timeout)' if 'lock timeout' in err else ('UP ERROR ' + err.strip()[:300] if 'ERROR' in err else 'UP not blocked')
    print(f'{verdict} after {dt:.2f}s')
    b.stdout.read(); b.stderr.read(); b.wait()
