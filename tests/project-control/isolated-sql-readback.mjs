// Only called with real synthetic actors by the explicitly gated HTTP runner.
// Fixed existing container; RLS read-only and one stale-write attempt rolled back.
import {spawnSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
const uuid=s=>{if(!/^[a-f0-9-]{36}$/i.test(s??''))throw Error('SYNTHETIC_UUID_REQUIRED');return s;};
const literal=s=>"'"+s.replaceAll("'","''")+"'";
function query(sql){
 const python=`import json,subprocess,socket,sys,base64
assert socket.gethostname()=='core-node-01'
c=json.loads(subprocess.check_output(['docker','inspect','berryit-iso-83a2f62f-db']))[0]
assert c['Id']=='1ea52edd800810ecb1e48aa743a99ceaf95a09b3a3da45a4ae4fcd490722988b' and c['State']['Status']=='running'
v=[m for m in c['Mounts'] if m['Destination']=='/var/lib/postgresql/data']
assert len(v)==1 and v[0].get('Name')=='berryit-iso-83a2f62f-db-data'
p=subprocess.run(['docker','exec','-i','berryit-iso-83a2f62f-db','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],input=base64.b64decode('${Buffer.from(sql).toString('base64')}'),capture_output=True,timeout=20)
if p.returncode:sys.exit(42)
sys.stdout.buffer.write(p.stdout)
`;
 const r=spawnSync('ssh',['-i',join(homedir(),'.ssh','onarly_core_node'),'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','UpdateHostKeys=no','-o','ConnectTimeout=8','glasso@192.168.1.24','python3 -'],{input:python,encoding:'utf8',windowsHide:true,timeout:30000});
 if(r.status!==0)throw Error('ISOLATED_SQL_CHECK_FAILED');return JSON.parse(r.stdout.trim());
}
async function verifiedClaims(client){
 const user=await client.auth.getUser(),session=await client.auth.getSession();if(user.error||session.error||!session.data.session)throw Error('LIVE_TEST_IDENTITY_REQUIRED');
 const c=JSON.parse(Buffer.from(session.data.session.access_token.split('.')[1],'base64url'));
 if(c.sub!==user.data.user.id||c.aal!=='aal2'||c.role!=='authenticated')throw Error('CURRENT_REAL_MFA_REQUIRED');
 return literal(JSON.stringify({sub:uuid(c.sub),role:'authenticated',aal:'aal2',session_id:uuid(c.session_id)}));
}
export async function verifySql(c){
 const {A,B,projectA,projectB,task,rpc,check,must}=c;
 await check('sql.actual_live_identity_rls_and_rpc_acl',async()=>{
  const own=await rpc(B.client,'save_project_task',{p_id:null,p_project:projectB,p_values:{title:'Synthetic SQL scope task'},p_revision:null,p_reason:'Approved isolated real RLS verification'});c.created.tasks.push(own);
  const claims=await verifiedClaims(B.client),r=query(`begin read only;set local role authenticated;do $$begin perform set_config('request.jwt.claims',${claims},true);end $$;
select json_build_object('own',(select count(*) from public.project_tasks where id='${uuid(own)}'),'foreign',(select count(*) from public.project_tasks where project_id='${uuid(projectA)}'),'directWrite',has_table_privilege('authenticated','public.project_tasks','UPDATE'),'anonRpc',has_function_privilege('anon','public.project_control_overview(uuid)','EXECUTE'),'clientImport',has_function_privilege('authenticated','public.import_project_github_issues(uuid,uuid,uuid,uuid,jsonb)','EXECUTE'));rollback;`);
  must(r.own===1&&r.foreign===0&&!r.directWrite&&!r.anonRpc&&!r.clientImport,'SQL_RLS_OR_EXECUTE_FAILED');return r;
 });
 await check('sql.stale_revision_denied_and_transaction_rolled_back',async()=>{
  const claims=await verifiedClaims(A.client),r=query(`begin;set local role authenticated;do $$begin perform set_config('request.jwt.claims',${claims},true);end $$;
do $$begin perform public.save_project_task('${uuid(task)}','${uuid(projectA)}','{}'::jsonb,0,'Approved synthetic stale guard');raise exception 'Stale revision accepted';exception when sqlstate '40001' then null;end $$;select 'true'::json;rollback;`);must(r===true,'STALE_SQL_GUARD_FAILED');
 });
}
