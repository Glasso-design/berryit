#!/usr/bin/env python3
"""PASS 3C synthetic rehearsal in the EXISTING core-node-01 BerryIT stack.
No production connection, installs, containers, service changes or deletion.
Leaves protected evidence and a NEW run-owned restore DB. Never drops anything.
"""
import argparse,datetime,hashlib,json,os,pathlib,re,socket,subprocess,time,uuid

parser=argparse.ArgumentParser()
parser.add_argument('--environment',required=True,choices=['existing-berryit-isolated-synthetic'])
args=parser.parse_args()
assert socket.gethostname()=='core-node-01','Wrong host; STOP'
assert not any(os.environ.get(k)for k in ('DATABASE_URL','PGHOST','SUPABASE_DB_URL','SUPABASE_URL')),'External DB environment; STOP'
PREFIX='berryit-iso-83a2f62f'
DB=PREFIX+'-db'
STORAGE=PREFIX+'-storage'
ROOT=pathlib.Path('/home/glasso')/PREFIX
EXPECTED_DB='1ea52edd800810ecb1e48aa743a99ceaf95a09b3a3da45a4ae4fcd490722988b'
GATEWAY='http://127.0.0.1:8750'
os.umask(0o077)

def run(command,data=None,check=True,timeout=90):
 p=subprocess.run(command,input=data,capture_output=True,timeout=timeout)
 if check and p.returncode:
  # This is synthetic data, but stderr can still contain Auth/config payloads.
  raise RuntimeError(command[0]+' failed, exit '+str(p.returncode)+'; raw output suppressed')
 return p
def sql(query,database='postgres'):
 assert database=='postgres'or re.fullmatch(r'berryit_3c_[a-f0-9]{16}',database)
 return run(['docker','exec','-i',DB,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',database],query.encode()).stdout.decode().strip()
def inspect():
 names=run(['docker','ps','-a','--format','{{.Names}}']).stdout.decode().splitlines()
 return json.loads(run(['docker','inspect',*names]).stdout)
def states(rows):
 return {c['Name'].lstrip('/'):{'id':c['Id'],'state':c['State']['Status'],'start':c['State']['StartedAt'],'restartCount':c['RestartCount']}for c in rows}
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
before=inspect()
db=next(c for c in before if c['Name']=='/'+DB)
assert db['Id']==EXPECTED_DB and db['State']['Status']=='running','Changed test container; STOP'
assert db['Config']['Labels'].get('com.docker.compose.project')==PREFIX
assert set(db['NetworkSettings']['Networks'])=={PREFIX+'-net'}
assert all(m['Type']=='volume'or m['Source'].startswith(str(ROOT)+'/')for m in db['Mounts'])
assert ROOT.is_dir() and (ROOT/'compose.yaml').is_file()
# This known stack was created for synthetic verification. Recheck its users
# without printing identities; refuse any unclassified account or active writer.
eligibility=json.loads(sql("""begin read only;
select json_build_object('unclassified',(select count(*)from auth.users where email is null or not(email like '%@example.test'or email like '%@example.com'or email like '%@berryit.test'or email like '%.invalid')),
'activeOtherQueries',(select count(*)from pg_stat_activity where datname=current_database()and pid<>pg_backend_pid()and state='active'),
'ledgerCount',(select count(*)from public.schema_migrations))::text;rollback;"""))
assert eligibility=={'unclassified':0,'activeOtherQueries':0,'ledgerCount':16},'Synthetic/quiescent source cannot be verified; STOP'
source_namespaces=sql("begin read only;select string_agg(nspname,','order by nspname)from pg_namespace where nspname in('auth','storage','public');rollback;")
assert source_namespaces=='auth,public,storage'

run_id=uuid.uuid4().hex
target='berryit_3c_'+run_id[:16]
assert sql("select count(*)from pg_database where datname='"+target+"'")=='0','Restore DB collision; STOP'
work=ROOT/('recovery-'+run_id)
assert not work.exists()
work.mkdir(mode=0o700)
(work/'owner.json').write_text(json.dumps({'runId':run_id,'syntheticOnly':True,'targetDatabase':target}))
home=work/'gpg';home.mkdir(mode=0o700)
def gp(arguments,check=True):
 return run(['gpg','--no-options','--homedir',str(home),'--batch','--no-tty',*arguments],check=check)
checks=[]
def passed(name):checks.append({'name':name,'status':'PASS'})
timing={}
result={'runId':run_id,'host':'core-node-01','source':PREFIX,'syntheticOnly':True,'workDirectory':str(work),'restoreDatabase':target,'checks':checks,'timingSeconds':timing,'productionDataTransferred':False,'deletedFiles':False,'createdContainers':False,'restoredHttpServices':False}
try:
 started=time.monotonic()
 # Ephemeral TEST key, never a production recovery recipient.
 parameters=b'Key-Type: RSA\nKey-Length: 2048\nKey-Usage: sign,encrypt\nName-Real: BerryIT Synthetic Recovery\nName-Email: recovery@example.test\nExpire-Date: 1d\n%no-protection\n%commit\n'
 run(['gpg','--no-options','--homedir',str(home),'--batch','--no-tty','--generate-key'],parameters)
 fingerprint=next(line.split(':')[9]for line in gp(['--with-colons','--list-keys']).stdout.decode().splitlines()if line.startswith('fpr:'))
 assert re.fullmatch('[A-F0-9]{40}',fingerprint)
 timing['keyPreparation']=round(time.monotonic()-started,3)
 source_begin=time.monotonic()
 dump=work/'database.dump'
 dump.write_bytes(run(['docker','exec',DB,'pg_dump','-U','supabase_admin','-d','postgres','--format=custom']).stdout)
 assert dump.stat().st_size>0
 (work/'globals.sql').write_bytes(run(['docker','exec',DB,'pg_dumpall','-U','supabase_admin','--globals-only','--no-role-passwords']).stdout)
 storage=work/'storage.tar'
 storage.write_bytes(run(['docker','exec',STORAGE,'tar','-cf','-','-C','/var/lib/storage','.']).stdout)
 assert storage.stat().st_size>0
 storage_members=run(['tar','-tf',str(storage)]).stdout.decode().splitlines()
 assert all(not p.startswith('/')and'..'not in pathlib.PurePosixPath(p).parts for p in storage_members)
 listing=run(['tar','-tvf',str(storage)]).stdout.decode().splitlines()
 assert all(line.startswith(('-','d'))for line in listing),'Unsafe Storage member type; STOP'
 # Only synthetic configuration is captured. No production file or credential.
 config=work/'configuration';config.mkdir(mode=0o700)
 for relative in ('compose.yaml','gateway/Caddyfile','db/init/00-berryit-roles.sql','db/init/99-berryit-jwt.sql'):
  source=ROOT/relative
  assert source.is_file()and not source.is_symlink()
  destination=config/relative;destination.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  destination.write_bytes(source.read_bytes())
 # Rehearse secret preservation with a newly generated synthetic secret. This
 # is NOT a claim that the source stack's real secrets were fully restored.
 (config/'synthetic-secrets.env').write_text('SYNTHETIC_ONLY=1\nSYNTHETIC_SECRET='+uuid.uuid4().hex+'\n')
 archive=work/'configuration.tar'
 run(['tar','-cf',str(archive),'-C',str(config),'.'])
 components=['database.dump','globals.sql','storage.tar','configuration.tar']
 manifest={name:{'bytes':(work/name).stat().st_size,'sha256':digest(work/name)}for name in components}
 (work/'manifest.json').write_text(json.dumps({'runId':run_id,'syntheticOnly':True,'components':manifest}))
 payload=work/'payload.tar'
 run(['tar','-cf',str(payload),'-C',str(work),*components,'manifest.json'])
 cipher=work/'payload.tar.gpg'
 gp(['--trust-model','always','--recipient',fingerprint,'--output',str(cipher),'--encrypt',str(payload)])
 signature=work/'payload.tar.gpg.sig'
 gp(['--local-user',fingerprint,'--output',str(signature),'--detach-sign',str(cipher)])
 cipher_hash=digest(cipher)
 (work/'payload.tar.gpg.sha256').write_text(cipher_hash+'  payload.tar.gpg\n')
 timing['backupAndEncryption']=round(time.monotonic()-source_begin,3)
 result['sizes']={**{name:meta['bytes']for name,meta in manifest.items()},'encryptedBundle':cipher.stat().st_size}
 passed('real pg_dump custom format + Storage files + configuration encrypted with GPG')

 # An actual failing transport subprocess emits only half of the ciphertext.
 # It never creates a completion marker or overwrites a committed backup.
 incoming=work/'incoming';incoming.mkdir(mode=0o700)
 partial=incoming/'interrupted.partial'
 with partial.open('xb')as stream:
  transfer=subprocess.run(['python3','-c','import pathlib,sys;p=pathlib.Path(sys.argv[1]).read_bytes();sys.stdout.buffer.write(p[:len(p)//2]);sys.stdout.flush();sys.exit(23)',str(cipher)],stdout=stream,stderr=subprocess.PIPE)
 assert transfer.returncode==23 and 0<partial.stat().st_size<cipher.stat().st_size
 assert digest(partial)!=cipher_hash and not(incoming/'COMPLETE').exists()and digest(cipher)==cipher_hash
 passed('interrupted synthetic transfer: exit 23, partial rejected, good ciphertext unchanged')
 damaged=work/'tampered.gpg'
 content=bytearray(cipher.read_bytes());content[len(content)//2]^=1;damaged.write_bytes(content)
 assert gp(['--verify',str(signature),str(damaged)],check=False).returncode!=0
 passed('tampered encrypted payload cannot pass signature verification')

 restore_begin=time.monotonic()
 status=gp(['--status-fd','1','--verify',str(signature),str(cipher)]).stdout.decode()
 assert '[GNUPG:] VALIDSIG '+fingerprint+' 'in status and digest(cipher)==cipher_hash
 decrypted=work/'decrypted.tar'
 gp(['--output',str(decrypted),'--decrypt',str(cipher)])
 assert sorted(run(['tar','-tf',str(decrypted)]).stdout.decode().splitlines())==sorted(components+['manifest.json'])
 assert all(line.startswith('-')for line in run(['tar','-tvf',str(decrypted)]).stdout.decode().splitlines())
 restore=work/'restored';restore.mkdir(mode=0o700)
 run(['tar','-xf',str(decrypted),'-C',str(restore)])
 for name,metadata in manifest.items():assert digest(restore/name)==metadata['sha256']and(restore/name).stat().st_size==metadata['bytes']
 passed('ciphertext, approved signer and all component checksums verified before restore')

 # A new database within the existing isolated cluster; no service points to it.
 sql('create database "'+target+'" template template0')
 sql("comment on database \""+target+"\" is 'berryit-pass3c-synthetic:"+run_id+"'")
 assert sql("select shobj_description(oid,'pg_database')from pg_database where datname='"+target+"'")=='berryit-pass3c-synthetic:'+run_id
 db_restore_start=time.monotonic()
 run(['docker','exec','-i',DB,'pg_restore','-U','supabase_admin','-d',target,'--exit-on-error','--single-transaction'],(restore/'database.dump').read_bytes())
 timing['pgRestore']=round(time.monotonic()-db_restore_start,3)
 tables=sql("begin read only;select json_agg(format('%I.%I',schemaname,tablename)order by schemaname,tablename)from pg_tables where schemaname in('public','auth','storage');rollback;")
 for table in json.loads(tables):
  query='begin read only;select md5(coalesce(string_agg(value,E\'\\n\'order by value),\'\'))from(select to_jsonb(r)::text value from '+table+' r)x;rollback;'
  assert sql(query)==sql(query,target),'Source changed or table mismatch; STOP'
 result['verifiedTables']=len(json.loads(tables))
 security="""begin read only;select json_build_object('policies',(select json_agg(x order by x.schemaname,x.tablename,x.policyname)from(select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname in('public','auth','storage'))x),
'rls',(select json_agg(x order by x.tablename)from(select tablename,rowsecurity from pg_tables where schemaname='public')x),
'anonymousHelperExecute',has_function_privilege('anon','public.active_support_grants(uuid)','execute'),
'helperMd5',(select md5(prosrc)from pg_proc where oid='public.active_support_grants(uuid)'::regprocedure))::text;rollback;"""
 assert json.loads(sql(security))==json.loads(sql(security,target))
 passed('pg_restore exit 0: all public/Auth/Storage tables, ledger, audit, RLS and helper ACL match')
 blobs=restore/'storage-files';blobs.mkdir(mode=0o700)
 run(['tar','-xf',str(restore/'storage.tar'),'-C',str(blobs),'--no-same-owner'])
 blob_hashes={str(p.relative_to(blobs)):digest(p)for p in blobs.rglob('*')if p.is_file()}
 # Read the same existing synthetic Storage tree again without modifying it.
 storage_after=work/'storage-after.tar'
 storage_after.write_bytes(run(['docker','exec',STORAGE,'tar','-cf','-','-C','/var/lib/storage','.']).stdout)
 assert digest(storage_after)==manifest['storage.tar']['sha256'],'Storage changed during capture; STOP'
 restored_config=restore/'configuration-files';restored_config.mkdir(mode=0o700)
 run(['tar','-xf',str(restore/'configuration.tar'),'-C',str(restored_config),'--no-same-owner'])
 for p in config.rglob('*'):
  if p.is_file():assert digest(p)==digest(restored_config/p.relative_to(config))
 result['verifiedStorageFiles']=len(blob_hashes)
 timing['restoreAndVerification']=round(time.monotonic()-restore_begin,3)
 passed('Storage archive stable; actual files, configuration and synthetic secret restored byte-for-byte')
 assert states(inspect())==states(before),'Existing container state/start/restart changed; STOP'
 passed('all existing containers retain IDs, state, start times and restart counts')
 result['status']='PASS_FOR_SYNTHETIC_OFFLINE_COMPONENT_RESTORE'
 result['notVerified']=['Restic/Borg not installed or exercised','prod-to-core backup identity/transport','append-only deletion protection','independent globals/role restoration into a fresh cluster','complete Auth signing/config secrets restoration','HTTP login/MFA/Storage against restored database','actual production backup and restore','independent offsite copy after loss of core-node-01']
finally:
 run(['gpgconf','--homedir',str(home),'--kill','gpg-agent'],check=False,timeout=10)
 result['completedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
 result['containerStatesUnchanged']=states(inspect())==states(before)
 (work/'result.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
