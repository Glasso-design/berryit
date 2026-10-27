import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { sealBackup,openBackup } from '../../providers/backup.mjs';
const exec=promisify(execFile);
export async function snapshotSyntheticDatabase(cluster,space,identity,objects){
 const owner=await cluster.client(space.owner);try{
  const origin=(await owner.query('select * from public.factory_origin')).rows[0];
  if(origin.run_id!==cluster.meta.runId||origin.instance_id!==identity.instanceId||origin.job_id!==space.jobId)throw Error('Unknown backup source refused');
 }finally{await owner.end();}
 // Existing local tools only. Dump stays in memory until encrypted. No .env,
 // production connection or unencrypted database file is created.
 let stdout;try{({stdout}=await exec(path.join(cluster.meta.pgBin,'pg_dump.exe'),['--host=127.0.0.1','--port='+cluster.meta.port,'--username='+space.owner.user,'--dbname='+space.database,'--format=custom','--exclude-table=public.factory_origin','--no-owner','--enable-row-security','--inserts'],{encoding:'buffer',maxBuffer:32*1024*1024,windowsHide:true,env:{...process.env,PGPASSWORD:space.owner.password,PGOPTIONS:'-c drive.platform=on'}}));}catch(error){throw Error('Synthetic pg_dump failed with exit '+error.code+'; raw dump and credentials withheld');}
 // Runtime encryption/hash keys are recovery material. They are included ONLY
 // inside the encrypted configuration part, never in a report/plaintext file.
 const configuration={classification:'synthetic-only',version:identity.version,externalProviders:'off',hashKey:space.hashKey,dataKey:space.dataKey,tenant:space.tenant,productUserId:space.productUserId,email:space.email};
 const key=randomBytes(32),archive=sealBackup({...identity,parts:{database:stdout,objects:Buffer.from(JSON.stringify(objects)),configuration:Buffer.from(JSON.stringify(configuration))}},key);
 return {archive,key};
}
export async function restoreSyntheticDatabase(cluster,backup,identity,targetId,jobId){
 // Validate ALL parts before creating a target database. Never restore in place.
 const parts=openBackup(backup.archive,backup.key,identity),objects=JSON.parse(parts.objects),config=JSON.parse(parts.configuration);
 if(config.classification!=='synthetic-only'||config.version!==identity.version||!Array.isArray(objects)||!config.hashKey||!config.dataKey||!config.email?.endsWith('@factory.example.test'))throw Error('Invalid synthetic restore payload');
 if(targetId===identity.instanceId||cluster.spaces.has(targetId))throw Error('Existing restore target refused');
 const target=await cluster.createSpace(targetId,jobId);
 const {spawn}=await import('node:child_process');
 await new Promise((resolve,reject)=>{
  const child=spawn(path.join(cluster.meta.pgBin,'pg_restore.exe'),['--host=127.0.0.1','--port='+cluster.meta.port,'--username='+target.owner.user,'--dbname='+target.database,'--no-owner','--exit-on-error'],{windowsHide:true,env:{...process.env,PGPASSWORD:target.owner.password},stdio:['pipe','ignore','pipe']});
  child.stderr.resume();child.on('error',()=>reject(Error('Local restore process failed')));child.on('exit',code=>code===0?resolve():reject(Error('Local restore failed with exit '+code+'; new target retained for review')));child.stdin.end(parts.database);
 });
 const c=await cluster.client(target.owner);try{
  await c.query('begin');await c.query('create table public.factory_restored_objects(id uuid primary key,owner_instance_id uuid not null,body bytea not null)');
  for(const object of objects)await c.query('insert into public.factory_restored_objects values($1,$2,$3)',[object.id,target.instanceId,Buffer.from(object.body,'base64')]);
  await c.query('commit');
 }catch(error){await c.query('rollback');throw error;}finally{await c.end();}
 Object.assign(target,{hashKey:config.hashKey,dataKey:config.dataKey,tenant:config.tenant,productUserId:config.productUserId,email:config.email,recoveryOf:identity.instanceId});await cluster.persist();
 return {target,objects,config};
}
