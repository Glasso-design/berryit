#!/usr/bin/env python3
"""MASTER PASS 2 - lock-queue probe (orchestrator item M2) for a migration that locks auth.users.

  lockqueue.py <migration.sql> <A-sql> <C-sql or 'sh:<shell command>'> [<B lock_timeout, e.g. 2s>]

t=0    session A: begin; <A-sql> (e.g. an open GoTrue write on auth.users); pg_sleep(6); rollback
t=1.0  session B: begin; [set local lock_timeout]; <migration>; ROLLBACK   (migrate.sh-style, nothing persists)
t=2.0  session C: <C-sql> in psql (statement_timeout 20s)  or  'sh:...' = a real client (e.g. curl GoTrue login)
Reports when each session finished, C's latency, and the lock waits seen in pg_locks at t=2.5.
"""
import json, os, subprocess, sys, threading, time

PSQL = json.loads(os.environ['MP2_PSQL'])
mig, a_sql, c_spec = open(sys.argv[1]).read(), sys.argv[2], sys.argv[3]
b_timeout = sys.argv[4] if len(sys.argv) > 4 else None
HOLD = float(os.environ.get('MP2_A_HOLD', '6'))  # seconds session A keeps its transaction open
T0 = time.time()
res = {}


def psql(name, script):
    t = time.time()
    p = subprocess.run(PSQL + ['-At', '-X', '-f', '-'], input=script, capture_output=True, text=True)
    err = ' | '.join(l for l in p.stderr.splitlines() if 'ERROR' in l)[:240]
    res[name] = (round(t - T0, 2), round(time.time() - T0, 2), round(time.time() - t, 2), err or 'ok', p.stdout.strip().splitlines()[-1:] )


def shell(name, cmd):
    t = time.time()
    p = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    res[name] = (round(t - T0, 2), round(time.time() - T0, 2), round(time.time() - t, 2), f'exit {p.returncode}', [p.stdout.strip()[-160:]])


A = threading.Thread(target=psql, args=('A holder', f"set application_name='mp2-A';\nbegin;\n{a_sql};\nselect pg_sleep({HOLD});\nrollback;\n"))
B = threading.Thread(target=psql, args=('B migration', "set application_name='mp2-B';\n\\set ON_ERROR_STOP 1\nbegin;\n" + (f"set local lock_timeout = '{b_timeout}';\n" if b_timeout else '') + mig + "\nrollback;\n"))
if c_spec.startswith('sh:'):
    C = threading.Thread(target=shell, args=('C client', c_spec[3:]))
else:
    C = threading.Thread(target=psql, args=('C client', f"set application_name='mp2-C';\nset statement_timeout = '20s';\nbegin;\n{c_spec};\nrollback;\n"))
A.start(); time.sleep(1.0); B.start(); time.sleep(1.0); C.start(); time.sleep(0.5)
snap = subprocess.run(PSQL + ['-At', '-X', '-c', """select coalesce(a.application_name, '') || ' ' || coalesce(a.backend_type,'') || ' ' || l.mode || ' on ' || coalesce(l.relation::regclass::text, l.locktype) || case when l.granted then ' granted' else ' WAITING' end
  from pg_locks l join pg_stat_activity a on a.pid = l.pid where l.relation = 'auth.users'::regclass and a.pid <> pg_backend_pid() order by l.granted desc, 1"""], capture_output=True, text=True).stdout.strip()
for t in (A, B, C):
    t.join()
print(f"== lock queue: B lock_timeout={b_timeout or 'none (as migrate.sh)'}")
print('pg_locks on auth.users at t=2.5s:\n  ' + (snap.replace('\n', '\n  ') or '(none)'))
for k in ('A holder', 'B migration', 'C client'):
    s, e, d, st, out = res[k]
    print(f'{k}: started t={s}s finished t={e}s (took {d}s) result={st} {out}')
