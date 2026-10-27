import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { FactoryError } from '../../contract.mjs';

export const quoted=name=>{if(!/^[a-z][a-z0-9_]{1,62}$/.test(name))throw Error('Invalid generated test identifier');return '"'+name+'"';};
export async function connectCluster(metadataFile,sourceRoot) {
 const workspace=path.resolve(new URL('../../../../',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
 const filename=path.resolve(metadataFile);
 if(!filename.toLowerCase().startsWith(path.resolve(workspace,'test-results').toLowerCase()+path.sep))throw Error('Metadata must be in this workspace test-results');
 const meta=JSON.parse(await fs.readFile(filename,'utf8'));
 if(meta.classification!=='isolated-synthetic-factory'||meta.host!=='127.0.0.1'||meta.port<19000||meta.port>25000||!meta.runId||meta.user!=='factory_admin')throw Error('Unknown or production-classified database refused');
 const require=createRequire(path.resolve(sourceRoot,'services/drive-core/package.json'));
 const {Client}=require('pg');
 const base={host:meta.host,port:meta.port,user:meta.user,password:meta.password,database:'postgres',connectionTimeoutMillis:5000,application_name:'factory-isolated-test'};
 const admin=new Client(base);await admin.connect();
 if((await admin.query("select current_setting('factory.test_run_id',true) marker")).rows[0].marker!==meta.runId){await admin.end();throw Error('Isolated cluster marker mismatch');}
 await admin.query('revoke connect on database postgres,template1 from public');
 await admin.query("do $$ begin if not exists(select 1 from pg_roles where rolname='drive_app') then create role drive_app nologin nosuperuser nocreatedb nocreaterole nobypassrls; end if; end $$");
 const prefix='pf_'+meta.runId.replaceAll('-','').slice(0,8)+'_';const spaces=new Map();
 const manifestFile=path.join(meta.root,'spaces.local.json');
 try {const saved=JSON.parse(await fs.readFile(manifestFile,'utf8'));if(saved.runId!==meta.runId)throw Error('Foreign spaces manifest');for(const row of saved.spaces)spaces.set(row.instanceId,row);}catch(error){if(error.code!=='ENOENT')throw error;}
 const persist=()=>fs.writeFile(manifestFile,JSON.stringify({runId:meta.runId,spaces:[...spaces.values()]},null,2)+'\n');
 const client=async config=>{const value=new Client({...base,...config});await value.connect();return value;};
 const url=s=>{const u=new URL('postgresql://127.0.0.1');u.port=String(meta.port);u.username=s.user;u.password=s.password;u.pathname='/'+s.database;return u.href;};
 async function createSpace(instanceId,jobId) {
  if(!/^[a-f0-9-]{36}$/.test(instanceId)||!/^[a-f0-9-]{36}$/.test(jobId))throw Error('Invalid new test resource');
  const existing=spaces.get(instanceId);
  if(existing) {
   if(existing.jobId!==jobId)throw new FactoryError('RESOURCE_OWNERSHIP_MISMATCH','Annat jobb äger databasen.');
   const c=await client(existing.owner);try {const row=(await c.query('select instance_id,job_id from public.factory_origin')).rows[0];if(row?.instance_id!==instanceId||row.job_id!==jobId)throw Error('Origin mismatch');}finally{await c.end();}return existing;
  }
  const suffix=instanceId.replaceAll('-',''),database=prefix+suffix;
  if((await admin.query('select 1 from pg_database where datname=$1',[database])).rowCount)throw new FactoryError('MANUAL_RECOVERY','Databas finns redan utan verifierad ägarkoppling; lämnas orörd.');
  const ownerName='po_'+suffix,appName='pa_'+suffix;
  const ownerPassword=randomBytes(32).toString('hex'),appPassword=randomBytes(32).toString('hex');
  // All interpolated identifiers/passwords are generated locally and checked.
  await admin.query(`create role ${quoted(ownerName)} login nosuperuser nocreatedb nocreaterole nobypassrls password '${ownerPassword}'`);
  await admin.query(`create role ${quoted(appName)} login nosuperuser nocreatedb nocreaterole nobypassrls inherit in role drive_app password '${appPassword}'`);
  await admin.query(`create database ${quoted(database)} owner ${quoted(ownerName)}`);
  await admin.query(`revoke all on database ${quoted(database)} from public`);
  await admin.query(`grant connect on database ${quoted(database)} to ${quoted(appName)}`);
  const space={instanceId,jobId,database,owner:{database,user:ownerName,password:ownerPassword},app:{database,user:appName,password:appPassword},tenant:'pf-'+suffix,hashKey:randomBytes(32).toString('base64'),dataKey:randomBytes(32).toString('base64')};
  const c=await client(space.owner);try {await c.query('create table public.factory_origin(instance_id uuid primary key,job_id uuid not null,run_id uuid not null)');await c.query('insert into public.factory_origin values($1,$2,$3)',[instanceId,jobId,meta.runId]);}finally{await c.end();}
  spaces.set(instanceId,space);await persist();return space;
 }
 return {meta,admin,client,url,createSpace,spaces,persist,prefix,close:()=>admin.end()};
}
