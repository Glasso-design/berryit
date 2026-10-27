import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {assertIsolatedPgliteEnvironment} from '../../supabase/tests/isolated-environment.mjs';
import {target,PCC_MIGRATION,reviewedSource,buildReview,transactionBody,writeReview} from './isolated-review.mjs';
assertIsolatedPgliteEnvironment(process.argv.slice(2),process.env);
const source=reviewedSource();
function proof(){return {classification:'isolated-synthetic-pcc',productionData:false,host:target.host,database:target.database,container:{Id:target.containerId,Name:'/'+target.container,State:{Status:'running'},Mounts:[
 {Type:'volume',Name:target.volume,Source:`/var/lib/docker/volumes/${target.volume}/_data`,Destination:'/var/lib/postgresql/data',RW:true},
 ...['roles','jwt'].map(n=>({Type:'bind',Source:target.stackRoot+'/db/init/'+n+'.sql',Destination:'/docker-entrypoint-initdb.d/init-scripts/'+n+'.sql',RW:false})),
 ]},schema:{database:'postgres',ledger:source.ledger,factorySchema:true,collisions:[],permissionCollisions:[],liveFactoryApproved:false,otherActiveTransactions:0}};}
test('review package cannot claim execution or human approval',()=>{
 const r=buildReview(proof());assert.equal(r.manifest.status,'REVIEW_ONLY_NOT_EXECUTED');assert.equal(r.manifest.requiresSeparateHumanApproval,true);assert.equal(r.manifest.automaticCleanup,false);assert.equal(r.manifest.automaticRollback,false);assert.equal(r.manifest.adds.tables.length,9);assert.ok(r.sql.endsWith('commit;\n'));assert.equal((r.sql.match(/^begin;/gm)||[]).length,1);
});
for(const [name,change]of Object.entries({production:p=>p.productionData=true,unknown:p=>p.classification='unknown',prodNode:p=>p.host='prod-node-01',wrongContainer:p=>p.container.Id='unknown',wrongDatabase:p=>p.database='production',sharedVolume:p=>p.container.Mounts[0].Name='shared-prod',foreignBind:p=>p.container.Mounts[1].Source='/home/glasso/other-project/roles.sql',writableBind:p=>p.container.Mounts[1].RW=true,changedLedger:p=>p.schema.ledger=[...source.ledger,'unknown.sql'],partialSchema:p=>p.schema.collisions=['project_tasks'],permissionCollision:p=>p.schema.permissionCollisions=['tasks.read'],liveFactory:p=>p.schema.liveFactoryApproved=true,activeClient:p=>p.schema.otherActiveTransactions=1}))test(name+' is rejected before producing a package',()=>{const p=proof();change(p);assert.throws(()=>buildReview(p));});
test('outputs are restricted to new ignored workspace directories and cannot overwrite a review',()=>{
 assert.throws(()=>writeReview(proof(),'C:/projects/not-this-repository'),/WORKSPACE/);
 const output='test-results/project-control-20261025/review-unit-'+randomUUID();writeReview(proof(),output);
 const before=readFileSync(output+'/review.sql','utf8');assert.throws(()=>writeReview(proof(),output),/NO_OVERWRITE/);assert.equal(readFileSync(output+'/review.sql','utf8'),before);
});
test('CLI refuses execute mode and never prints invalid proof contents',()=>{
 const output='test-results/project-control-20261025/review-cli-'+randomUUID();mkdirSync(output,{recursive:true});const proofFile=output+'/invalid.json';writeFileSync(proofFile,'synthetic-password-sentinel NOT JSON');
 for(const args of [['--execute'],['--proof='+proofFile,'--out='+output+'/out']]){
  assert.throws(()=>execFileSync(process.execPath,['tests/project-control/isolated-review.mjs',...args],{stdio:'pipe'}),e=>!String(e.stdout).includes('synthetic-password-sentinel')&&!String(e.stderr).includes('synthetic-password-sentinel'));
 }
});
test('transaction envelope cannot be bypassed by a different SQL source',()=>{
 assert.throws(()=>transactionBody('select 1;'),/TRANSACTION/);
 assert.throws(()=>transactionBody('begin;\ncommit;\nselect 1;\ncommit;'),/NESTED/);
});
test('review package applies once in synthetic SQL and a second attempt cannot alter rows',async()=>{
 const db=await PGlite.create({extensions:{pgcrypto}});const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
 try{
  await db.exec(read('supabase/tests/local_bootstrap.sql'));
  await db.exec('create table public.schema_migrations(version text primary key);alter table public.schema_migrations enable row level security');
  for(const [i,name]of source.ledger.entries()){
   await db.exec(read('supabase/migrations/'+name));if(i===0)await db.exec(read('supabase/tests/local_storage_bootstrap.sql'));
   await db.query('insert into public.schema_migrations(version) values($1)',[name]);
  }
  await db.exec("set factory.install_environment='isolated-test'");await db.exec(read('services/platform-factory/db/001_factory.sql'));await db.exec(read('services/platform-factory/db/002_provider_broker.sql'));
  const review=buildReview(proof());
  await db.exec("begin; insert into public.support_permissions(key,description,requires_mfa) values('tasks.read','Unexpected pre-existing permission',true)");
  await assert.rejects(db.exec(review.sql),/permission collision/);await db.exec('rollback');
  assert.equal((await db.query("select to_regclass('public.project_tasks') object")).rows[0].object,null);
  await db.exec(review.sql);
  assert.equal((await db.query('select count(*) n from public.schema_migrations where version=$1',[PCC_MIGRATION])).rows[0].n,1);
  await assert.rejects(db.exec(review.sql),/ledger mismatch|collision/);await db.exec('rollback');
  assert.equal((await db.query('select count(*) n from public.schema_migrations')).rows[0].n,source.ledger.length+1);
 }finally{await db.close();}
});
