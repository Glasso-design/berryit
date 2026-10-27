// PCC R1: real PostgreSQL semantics in isolated PGlite only. No HTTP server.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from '../../services/platform-factory/tests/fixture.mjs';
import {assertIsolatedPgliteEnvironment} from './isolated-environment.mjs';

assertIsolatedPgliteEnvironment(process.argv.slice(2),process.env);

const values=(title='Synthetic concurrent edit')=>JSON.stringify({title,description:'R1 synthetic task',status:'in_progress',priority:'normal',visibility:'internal',assignee_id:null,due_at:null,checklist:[]});
const save=(f,user,id,revision,value=values())=>f.rpc(user,'save_project_task',[id,f.ids.projectA,value,revision,'PCC R1 isolated test']);

test('PCC R1 conflict and AI-context regression suite',async t=>{
 const f=await fixture();
 try{
 await t.test('stale revision is a PT409 conflict and never writes stale data',async()=>{
  const id=await save(f,f.ids.adminA,null,null,values('Synthetic original'));
  const before=(await f.db.query('select title,revision,updated_at from public.project_tasks where id=$1',[id])).rows[0];
  await assert.rejects(save(f,f.ids.adminA,id,0,values('Synthetic stale overwrite')),error=>error.code==='PT409');
  const after=(await f.db.query('select title,revision,updated_at from public.project_tasks where id=$1',[id])).rows[0];
  assert.deepEqual(after,before);
 });

 await t.test('competing edits from the same revision allow one advance and reject the stale writer',async()=>{
  const id=await save(f,f.ids.adminA,null,null,values('Synthetic race base'));
  const revision=(await f.db.query('select revision from public.project_tasks where id=$1',[id])).rows[0].revision;
  await save(f,f.ids.adminA,id,revision,values('Synthetic race first'));
  await assert.rejects(save(f,f.ids.adminA,id,revision,values('Synthetic race second')),error=>error.code==='PT409');
  const row=(await f.db.query('select title,revision from public.project_tasks where id=$1',[id])).rows[0];
  assert.equal(Number(row.revision),Number(revision)+1);assert.equal(row.title,'Synthetic race first');
 });

 await t.test('preserves authorization before conflict checks',async()=>{
  const id=await save(f,f.ids.adminA,null,null);
  await assert.rejects(save(f,f.ids.customerA,id,1),error=>error.code==='42501');
  const row=(await f.db.query('select revision from public.project_tasks where id=$1',[id])).rows[0];assert.equal(Number(row.revision),1);
 });

 await t.test('AI context includes only scope-authorized, non-secret project facts',async()=>{
  const integration=randomUUID(),service=randomUUID();
  await f.db.query("insert into public.connector_integrations(id,organization_id,project_id,scope_kind,connector_key,display_name,access_mode,is_enabled,status,config,secret_ref) values($1,$2,$3,'project','github','Synthetic R1 repository','read_only',true,'connected',$4,$5)",[integration,f.ids.orgA,f.ids.projectA,JSON.stringify({repository:'Synthetic-PCC/r1',provider_project_id:'42'}),'SYNTHETIC_SECRET_REFERENCE']);
  await f.db.query("insert into public.infra_services(id,organization_id,project_id,name,service_kind,environment,url) values($1,$2,$3,'Synthetic R1 API','api','staging','https://user:secret@example.invalid/private')",[service,f.ids.orgA,f.ids.projectA]);
  await f.db.query("insert into public.service_status_checks(organization_id,service_id,status_key,source,detail) values($1,$2,'degraded','github',$3)",[f.ids.orgA,service,JSON.stringify({token:'MUST_NOT_LEAK'})]);
  const context=await f.rpc(f.ids.adminA,'project_control_ai_context',[f.ids.projectA]);
  const repeated=await f.rpc(f.ids.adminA,'project_control_ai_context',[f.ids.projectA]);
  const text=JSON.stringify(context);
  assert.deepEqual(context.scope,{project_id:f.ids.projectA,organization_id:f.ids.orgA,project_name:'Factory A'});
  assert.match(text,/Synthetic-PCC\/r1/);assert.match(text,/Synthetic R1 API/);assert.match(text,/recorded_status=degraded/);
  assert.doesNotMatch(text,/SYNTHETIC_SECRET_REFERENCE|user:secret|MUST_NOT_LEAK/);
  assert.deepEqual(repeated,context,'unchanged context must keep the approved AI preview valid');
  await assert.rejects(f.rpc(f.ids.adminB,'project_control_ai_context',[f.ids.projectA]),error=>error.code==='42501');
 });
 }finally{await f.db.close();}
});
