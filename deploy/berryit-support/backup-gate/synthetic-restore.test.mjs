// Local synthetic rehearsal only. NOT a production backup/restore executor.
// Existing GPG + tar + PGlite; no network, Docker, external database or cleanup.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {DEPLOYED_BASELINE} from '../../../supabase/upgrade-plan.mjs';
import {assertIsolatedPgliteEnvironment} from '../../../supabase/tests/isolated-environment.mjs';

assertIsolatedPgliteEnvironment(process.argv.slice(2),process.env);
const repository=fileURLToPath(new URL('../../../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sql=name=>readFileSync(path.join(repository,'supabase',name),'utf8');
const gpg=process.platform==='win32'?'C:\\Program Files\\Git\\usr\\bin\\gpg.exe':'gpg';
const tar=process.platform==='win32'?'C:\\Windows\\System32\\tar.exe':'tar';
// The existing Git GPG is an MSYS executable and needs /c/... paths.
const gpgPath=value=>process.platform==='win32'&&/^[a-z]:[\\/]/iu.test(value)?'/'+value[0].toLowerCase()+value.slice(2).replaceAll('\\','/'):value;
const run=(command,args,options={})=>{
 const result=spawnSync(command,args,{encoding:'utf8',timeout:120000,windowsHide:true,...options});
 // Do not publish command stderr: an operational failure can contain paths/data.
 if(result.error||result.status!==0){
  if(command===gpg)writeFileSync(path.join(repository,'test-results','pass3b','synthetic-gpg-diagnostic.txt'),result.stderr??'',{mode:0o600});
  throw new Error(`${path.basename(command)} failed; exit=${result.status}, code=${result.error?.code??'none'}`);
 }
 return result.stdout;
};
const contained=(root,destination)=>{
 const relative=path.relative(root,destination);
 assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'destination outside owned run');
};

test('encrypted DB + Storage + configuration rehearsal; synthetic local PGlite only',async t=>{
 const runId=randomUUID();
 // Keep the MSYS agent socket below its Unix-domain socket path limit.
 const root=path.join(repository,'test-results','pass3b','sb-'+runId.slice(0,12));
 assert.ok(!existsSync(root));mkdirSync(root,{recursive:true,mode:0o700});
 if(process.platform==='win32'){
  const sid=run('whoami',['/user','/fo','csv','/nh']).match(/S-1-[\d-]+/u)?.[0];assert.ok(sid);
  run('icacls',[root,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`]);
 }
 writeFileSync(path.join(root,'owner.json'),JSON.stringify({runId,purpose:'synthetic-local-backup-rehearsal'}),{flag:'wx',mode:0o600});
 const protectedDir=name=>{const dir=path.join(root,name);contained(root,dir);mkdirSync(dir,{mode:0o700});return dir;};
 const home=protectedDir('gpg-source');
 const wrongHome=protectedDir('gpg-wrong-recipient');
 const stage=protectedDir('protected-source');
 const offsite=protectedDir('offsite-SIMULATION-local-only');
 const gp=(homedir,args,options)=>run(gpg,['--no-options','--homedir',gpgPath(homedir),'--batch','--no-tty',...args.map(gpgPath)],options);
 const source=await PGlite.create({extensions:{pgcrypto}});
 let restored;
 try{
  gp(home,['--generate-key'],{input:'Key-Type: RSA\nKey-Length: 2048\nKey-Usage: sign,encrypt\nName-Real: Synthetic BerryIT Backup Rehearsal\nName-Email: backup@example.test\nExpire-Date: 1d\n%no-protection\n%commit\n'});
  const fingerprint=gp(home,['--with-colons','--list-keys']).split(/\r?\n/u).find(line=>line.startsWith('fpr:'))?.split(':')[9];
  assert.match(fingerprint??'',/^[A-F0-9]{40}$/u);
  await source.exec(sql('tests/local_bootstrap.sql'));
  for(const [index,file]of DEPLOYED_BASELINE.entries()){
   await source.exec(sql('migrations/'+file));
   if(index===0)await source.exec(sql('tests/local_storage_bootstrap.sql'));
  }
  await source.exec(sql('tests/fixtures/deployed-baseline.sql'));
  const fixture=Buffer.from('Synthetic storage object '+runId);
  const config=Buffer.from('SYNTHETIC_ONLY=1\nSYNTHETIC_SECRET='+randomBytes(32).toString('hex')+'\n');
  const ticket=(await source.query('select id from public.tickets order by id limit 1')).rows[0].id;
  const blobName='tickets/'+ticket+'/synthetic.txt';
  await source.query("insert into storage.objects(bucket_id,name)values('ticket-attachments',$1)",[blobName]);
  await source.query("insert into public.ticket_attachments(ticket_id,uploaded_by,storage_path,file_name,mime_type,size_bytes)values($1,'10000000-0000-0000-0000-000000000001',$2,'synthetic.txt','text/plain',$3)",[ticket,blobName,fixture.length]);
  const tables=['public.profiles','public.tickets','public.ticket_events','public.support_role_grants','public.support_admin_audit','public.ticket_attachments','storage.objects'];
  const before={};
  for(const table of tables)before[table]=(await source.query(`select to_jsonb(r) value from ${table} r order by id`)).rows;
  const dbBytes=Buffer.from(await (await source.dumpDataDir('gzip')).arrayBuffer());
  const files={'database.pglite.tar.gz':dbBytes,'storage-object.bin':fixture,'configuration.env':config};
  const inner={format:'berryit-synthetic-rehearsal-v1',databaseFormat:'PGlite-data-directory-NOT-pg_dump',runId,blobName,files:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,{sha256:sha(bytes),bytes:bytes.length}]))};
  for(const [name,bytes]of Object.entries(files))writeFileSync(path.join(stage,name),bytes,{flag:'wx',mode:0o600});
  writeFileSync(path.join(stage,'manifest.json'),JSON.stringify(inner),{flag:'wx',mode:0o600});
  const allowed=[...Object.keys(files),'manifest.json'].sort();
  const bundle=path.join(stage,'bundle.tar');
  run(tar,['-cf',bundle,'-C',stage,...allowed]);
  const cipher=path.join(offsite,'bundle.tar.gpg');
  gp(home,['--trust-model','always','--recipient',fingerprint,'--output',cipher,'--encrypt',bundle]);
  // A signature from the approved signer authenticates the checksum/ciphertext.
  const signature=cipher+'.sig';
  gp(home,['--local-user',fingerprint,'--output',signature,'--detach-sign',cipher]);
  const expectedHash=sha(readFileSync(cipher));
  writeFileSync(cipher+'.sha256',expectedHash+'  bundle.tar.gpg\n',{flag:'wx',mode:0o600});
  const verifyCipher=(input,expected,homedir=home)=>{
   assert.equal(sha(readFileSync(input)),expected,'ciphertext checksum mismatch');
   const status=gp(homedir,['--status-fd','1','--verify',signature,input]);
   assert.ok(status.includes('[GNUPG:] VALIDSIG '+fingerprint+' '),'unapproved signer');
  };
  const validateComponents=destination=>{
   const manifest=JSON.parse(readFileSync(path.join(destination,'manifest.json'),'utf8'));
   assert.equal(manifest.runId,runId);assert.equal(manifest.databaseFormat,'PGlite-data-directory-NOT-pg_dump');
   assert.deepEqual(Object.keys(manifest.files).sort(),Object.keys(files).sort());
   for(const [name,metadata]of Object.entries(manifest.files)){
    const bytes=readFileSync(path.join(destination,name));assert.equal(bytes.length,metadata.bytes,'component size mismatch');assert.equal(sha(bytes),metadata.sha256,'component checksum mismatch');
   }
   return manifest;
  };
  const unpack=(archive,destination)=>{
   contained(root,destination);assert.ok(!existsSync(destination),'restore destination must be NEW');
   const entries=run(tar,['-tf',archive]).trim().split(/\r?\n/u).sort();
   assert.deepEqual(entries,allowed,'archive members must match exact regular-file allowlist');
   const listing=run(tar,['-tvf',archive]).trim().split(/\r?\n/u);
   assert.ok(listing.every(line=>line.startsWith('-')),'links/directories/devices forbidden');
   mkdirSync(destination,{mode:0o700});run(tar,['-xf',archive,'-C',destination]);
   return validateComponents(destination);
  };
  const decrypted=path.join(root,'protected-decrypted.tar');
  await t.test('only encrypted payload, signature and ciphertext checksum enter simulated offsite directory',()=>{
   assert.deepEqual(readdirSync(offsite).sort(),['bundle.tar.gpg','bundle.tar.gpg.sha256','bundle.tar.gpg.sig']);
   assert.equal(readFileSync(cipher).includes(config),false);
   verifyCipher(cipher,expectedHash);
  });
  await t.test('truncated or modified ciphertext is rejected before decryption',()=>{
   const bytes=Buffer.from(readFileSync(cipher));bytes[Math.floor(bytes.length/2)]^=1;
   const damaged=path.join(root,'damaged.gpg');writeFileSync(damaged,bytes,{flag:'wx',mode:0o600});
   assert.throws(()=>verifyCipher(damaged,expectedHash),/checksum mismatch/);
   assert.throws(()=>verifyCipher(damaged,sha(bytes)),/failed/); // Recomputed hash cannot forge signature.
  });
  await t.test('missing private recipient key cannot decrypt',()=>{
   assert.throws(()=>gp(wrongHome,['--output',path.join(root,'wrong-recipient.tar'),'--decrypt',cipher]),/failed/);
  });
  await t.test('encrypted bundle decrypts into a new protected restore location',()=>{
   verifyCipher(cipher,expectedHash);gp(home,['--output',decrypted,'--decrypt',cipher]);
   unpack(decrypted,path.join(root,'protected-restore'));
  });
  const destination=path.join(root,'protected-restore');
  await t.test('restore refuses existing or outside-run destinations',()=>{
   assert.throws(()=>unpack(decrypted,destination),/must be NEW/);
   assert.throws(()=>unpack(decrypted,path.join(repository,'must-not-write')),/outside owned run/);
  });
  await t.test('missing component, path traversal and symbolic links are rejected before extraction',()=>{
   const missing=path.join(root,'missing.tar');run(tar,['-cf',missing,'-C',stage,'manifest.json']);
   assert.throws(()=>unpack(missing,path.join(root,'missing-restore')),/allowlist/);
   // Construct single-entry tar headers directly; no unsafe file or link is created.
   for(const [name,type]of [['../outside','0'],['configuration.env','2']]){
    const header=Buffer.alloc(512);header.write(name);header.write('0000600\0',100);header.write('0000000\0',108);header.write('0000000\0',116);header.write('00000000000\0',124);header.write('00000000000\0',136);header.fill(32,148,156);header.write(type,156);header.write('ustar\0',257);header.write('00',263);
    const sum=header.reduce((n,b)=>n+b,0);header.write(sum.toString(8).padStart(6,'0')+'\0 ',148);
    const invalid=path.join(root,type==='2'?'link.tar':'traversal.tar');writeFileSync(invalid,Buffer.concat([header,Buffer.alloc(1024)]),{flag:'wx',mode:0o600});
    assert.throws(()=>unpack(invalid,path.join(root,'rejected-'+type)),/allowlist|forbidden/);
   }
  });
  await t.test('DB snapshot restores rows, audit, RLS and anonymous function ACLs',async()=>{
   restored=await PGlite.create({extensions:{pgcrypto},loadDataDir:new Blob([readFileSync(path.join(destination,'database.pglite.tar.gz'))])});
   for(const table of tables)assert.deepEqual((await restored.query(`select to_jsonb(r) value from ${table} r order by id`)).rows,before[table]);
   assert.equal((await restored.query("select count(*) n from pg_tables where schemaname='public'and not rowsecurity")).rows[0].n,0);
   // Exact old baseline vulnerability is retained by a faithful restore, not silently repaired.
   assert.equal((await restored.query("select has_function_privilege('anon','public.active_support_grants(uuid)','execute') ok")).rows[0].ok,true);
   await restored.exec("begin;set local role anon");
   try{await assert.rejects(restored.query('select count(*) n from public.tickets'),error=>error.code==='42501');}
   finally{await restored.exec('rollback');}
  });
  await t.test('Storage blob hash, database reference and configuration are restored together',async()=>{
   assert.deepEqual(readFileSync(path.join(destination,'storage-object.bin')),fixture);
   assert.deepEqual(readFileSync(path.join(destination,'configuration.env')),config);
   assert.equal((await restored.query('select count(*) n from storage.objects where name=$1',[blobName])).rows[0].n,1);
   assert.equal((await restored.query('select count(*) n from public.ticket_attachments where storage_path=$1',[blobName])).rows[0].n,1);
  });
  await t.test('manifest detects a modified component; source fixture and failed-run evidence remain',()=>{
   const check=path.join(root,'component-drift');unpack(decrypted,check);
   writeFileSync(path.join(check,'storage-object.bin'),'synthetic tamper');
   assert.throws(()=>validateComponents(check),/component (size|checksum) mismatch/);
   assert.deepEqual(readFileSync(path.join(stage,'storage-object.bin')),fixture);
   assert.ok(existsSync(path.join(root,'damaged.gpg'))); // No automatic cleanup, even on errors.
  });
  writeFileSync(path.join(root,'result.json'),JSON.stringify({runId,syntheticOnly:true,database:'PGlite',offsite:'LOCAL SIMULATION',actualPostgresRestore:'BLOCKED',actualSupabaseHttpMfa:'BLOCKED',recipientFingerprint:fingerprint,cipherSha256:expectedHash}),{flag:'wx',mode:0o600});
 }finally{
  await source.close();if(restored)await restored.close();
  // Stop only agents belonging to these new, run-specific LOCAL keyrings.
  const gpgconf=process.platform==='win32'?'C:\\Program Files\\Git\\usr\\bin\\gpgconf.exe':'gpgconf';
  for(const homedir of [home,wrongHome])spawnSync(gpgconf,['--homedir',gpgPath(homedir),'--kill','gpg-agent'],{windowsHide:true,timeout:10000});
 }
});
