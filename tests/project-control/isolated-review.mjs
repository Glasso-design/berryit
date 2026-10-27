// REVIEW ONLY: no SSH, network, database connection, execution or cleanup.
import {readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const PCC_MIGRATION='20261025112940_project_control_center.sql';
export const target=Object.freeze({host:'core-node-01',database:'postgres',container:'berryit-iso-83a2f62f-db',
 containerId:'1ea52edd800810ecb1e48aa743a99ceaf95a09b3a3da45a4ae4fcd490722988b',
 stackRoot:'/home/glasso/berryit-iso-83a2f62f',volume:'berryit-iso-83a2f62f-db-data'});
const root=fileURLToPath(new URL('../../',import.meta.url));
const hash=value=>createHash('sha256').update(value).digest('hex');
const refuse=code=>{throw Error(code);};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function reviewedSource(){
 const review=JSON.parse(readFileSync(new URL('../../docs/project-control-center-migrations.json',import.meta.url),'utf8'));
 if(review.status!=='local-only-not-approved-for-production'||review.entries.at(-1)?.name!==PCC_MIGRATION)refuse('UNREVIEWED_MIGRATION_CHAIN');
 const sql=readFileSync(new URL('../../supabase/migrations/'+PCC_MIGRATION,import.meta.url),'utf8');
 if(hash(sql)!==review.entries.at(-1).sha256)refuse('MIGRATION_HASH_CHANGED');
 for(const entry of review.entries){if(!/^\d{14}_[a-z0-9_]+\.sql$/.test(entry.name)||hash(readFileSync(new URL('../../supabase/migrations/'+entry.name,import.meta.url)))!==entry.sha256)refuse('HISTORICAL_MIGRATION_CHANGED');}
 return {sql,sha256:hash(sql),ledger:review.entries.slice(0,-1).map(e=>e.name)};
}
export function assertTarget(proof,ledger){
 if(proof?.classification!=='isolated-synthetic-pcc'||proof.productionData!==false||proof.host!==target.host||proof.database!==target.database
 ||proof.container?.Id!==target.containerId||proof.container.Name!=='/'+target.container||proof.container.State?.Status!=='running')refuse('ISOLATED_TARGET_NOT_VERIFIED');
 const mounts=proof.container.Mounts;
 if(!Array.isArray(mounts)||mounts.length!==3)refuse('UNEXPECTED_TEST_MOUNTS');
 const data=mounts.filter(m=>m.Destination==='/var/lib/postgresql/data');
 if(data.length!==1||data[0].Type!=='volume'||data[0].Name!==target.volume||data[0].Source!==`/var/lib/docker/volumes/${target.volume}/_data`||data[0].RW!==true)refuse('SHARED_OR_UNKNOWN_DATA_VOLUME');
 for(const m of mounts.filter(m=>m!==data[0]))if(m.Type!=='bind'||m.RW!==false||!m.Source?.startsWith(target.stackRoot+'/')||!m.Destination?.startsWith('/docker-entrypoint-initdb.d/init-scripts/'))refuse('FOREIGN_OR_WRITABLE_BIND');
 if(proof.schema?.database!==target.database||!equal(proof.schema.ledger,ledger)||proof.schema.factorySchema!==true
 ||!Array.isArray(proof.schema.collisions)||proof.schema.collisions.length||!Array.isArray(proof.schema.permissionCollisions)||proof.schema.permissionCollisions.length
 ||proof.schema.liveFactoryApproved!==false||proof.schema.otherActiveTransactions!==0)refuse('SCHEMA_OR_CONCURRENCY_BASELINE_CHANGED');
}
export function transactionBody(sql){
 const lines=sql.split(/\r?\n/),first=lines.findIndex(s=>s.trim()&&!s.trimStart().startsWith('--'));
 let last=lines.length-1;while(last>=0&&!lines[last].trim())last--;
 if(!/^begin;$/i.test(lines[first]?.trim())||!/^commit;$/i.test(lines[last]?.trim()))refuse('UNEXPECTED_TRANSACTION_ENVELOPE');
 const body=lines.slice(first+1,last).join('\n');
 if(/^\s*(?:begin|commit|rollback)\s*;/im.test(body))refuse('NESTED_TRANSACTION_CONTROL');
 return body;
}
export function buildReview(proof){
 const source=reviewedSource();assertTarget(proof,source.ledger);
 const body=transactionBody(source.sql);
 const tables=[...source.sql.matchAll(/create table public\.([a-z_]+)/g)].map(m=>m[1]);
 const functions=[...source.sql.matchAll(/create function public\.([a-z_]+)/g)].map(m=>m[1]);
 const permissionBlock=source.sql.match(/insert into public\.support_permissions[\s\S]*?on conflict/i)?.[0]??'';
 const permissions=[...permissionBlock.matchAll(/\('([a-z][a-z0-9_.]+)',/g)].map(m=>m[1]);
 if(permissions.length!==8)refuse('UNREVIEWED_PERMISSION_REGISTRY');
 const array=items=>'array['+items.map(s=>"'"+s+"'").join(',')+']::text[]';
 const sql=`-- REVIEW ONLY. Human approval and fresh independent Docker/host proof required.
-- Source SHA-256: ${source.sha256}
-- Fixed target: ${target.host}/${target.container}/${target.database}
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(hashtextextended('berryit-isolated-pcc-review',0));
do $$ begin
 if current_database()<>'postgres' or to_regnamespace('factory') is null
 or to_regprocedure('public.has_resource_permission(text,uuid,uuid)') is null
 or to_regprocedure('public.session_is_live()') is null then raise exception 'PCC dependency baseline mismatch';end if;
 if exists(select 1 from factory.instances where execution_mode<>'MOCK') or exists(select 1 from factory.adapters where live_approved) then raise exception 'Non-synthetic Factory state; abort';end if;
 if (select array_agg(version::text order by version) from public.schema_migrations) is distinct from ${array(source.ledger)} then raise exception 'PCC migration ledger mismatch';end if;
 if exists(select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and backend_type='client backend' and state is distinct from 'idle') then raise exception 'Other active test clients; abort';end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(${array(tables)}))
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(${array(functions)})) then raise exception 'PCC object collision; do not rerun';end if;
 if exists(select 1 from public.support_permissions where key=any(${array(permissions)})) then raise exception 'PCC permission collision; review required';end if;
end $$;
${body}
insert into public.schema_migrations(version) values('${PCC_MIGRATION}');
notify pgrst,'reload schema';
commit;
`;
 return {sql,manifest:{status:'REVIEW_ONLY_NOT_EXECUTED',requiresSeparateHumanApproval:true,target,source:{name:PCC_MIGRATION,sha256:source.sha256},packageSha256:hash(sql),expectedLedger:source.ledger,adds:{tables,functions,permissions},backupRequired:true,automaticCleanup:false,automaticRollback:false}};
}
function insideResults(value){
 const base=path.resolve(root,'test-results'),resolved=path.resolve(value),relative=path.relative(base,resolved);
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative))refuse('WORKSPACE_TEST_RESULTS_PATH_REQUIRED');
 let existing=resolved;while(!existsSync(existing))existing=path.dirname(existing);
 const actual=path.relative(realpathSync(base),realpathSync(existing));if(actual.startsWith('..')||path.isAbsolute(actual))refuse('SYMLINK_OUTSIDE_TEST_RESULTS');
 return resolved;
}
export function writeReview(proof,out){
 const result=buildReview(proof),destination=insideResults(out);if(existsSync(destination))refuse('OUTPUT_EXISTS_NO_OVERWRITE');
 mkdirSync(destination,{recursive:true});
 writeFileSync(path.join(destination,'review.sql'),result.sql,{flag:'wx'});
 writeFileSync(path.join(destination,'manifest.json'),JSON.stringify(result.manifest,null,2)+'\n',{flag:'wx'});
 return result.manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2);
  if(args.length!==2||!args[0].startsWith('--proof=')||!args[1].startsWith('--out='))refuse('REVIEW_ONLY_NO_EXECUTION');
  const proof=JSON.parse(readFileSync(insideResults(args[0].slice(8)),'utf8'));
  console.log(JSON.stringify(writeReview(proof,args[1].slice(6))));
 }catch(error){console.error(/^[A-Z_]+$/.test(error.message)?error.message:'REVIEW_PREPARATION_REFUSED');process.exitCode=1;}
}
