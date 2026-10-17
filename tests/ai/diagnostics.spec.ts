import {test,expect} from '@playwright/test';
import {createServer as viteServer} from '../../desktop/node_modules/vite/dist/node/index.js';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {isolatedDatabase,ids} from '../support/database';
import {createAiHandler,createPostgrestBoundary,createOnarlyGateway} from '../../services/onarly-ai-adapter/server.mjs';

async function fixture(){
 const f=await isolatedDatabase();
 const project=randomUUID(),foreign=randomUUID(),sibling=randomUUID(),service=randomUUID(),otherService=randomUUID(),incident=randomUUID();
 await f.db.query("insert into public.support_projects(id,organization_id,name,created_by) values($1,$2,'Isolated faulty project',$6),($3,$4,'Other tenant project',$6),($5,$2,'Unassigned sibling',$6)",[project,ids.orgA,foreign,ids.orgB,sibling,ids.admin]);
 await f.db.query("insert into public.support_role_grants(grantee_id,role_key,scope,organization_id,project_id,reason) values($1,'BERRYIT_DEVELOPER','organization',$2,$3,'Synthetic diagnostic scope')",[ids.other,ids.orgA,project]);
 await f.db.query("insert into public.infra_services(id,organization_id,project_id,name,service_kind) values($1,$2,$3,'Synthetic app','web'),($4,$2,$5,'Foreign workload','web')",[service,ids.orgA,project,otherService,sibling]);
 await f.db.query("insert into public.service_status_checks(organization_id,service_id,status_key,source,detail) values($1,$2,'degraded','http_health','{\"token\":\"synthetic-private-token\"}'),($1,$3,'down','http_health','{}')",[ids.orgA,service,otherService]);
 await f.db.query("insert into public.monitoring_samples(organization_id,service_id,metric_key,value,source,detail) values($1,$2,'cpu_percent',99,'agent','{\"raw_log\":\"synthetic-private-token\"}'),($1,$3,'cpu_percent',12,'agent','{}')",[ids.orgA,service,otherService]);
 await f.db.query("insert into public.incidents(id,organization_id,project_id,service_id,title,summary,severity,metric_key) values($1,$2,$3,$4,'CPU warning','synthetic-private-token','major','cpu_percent')",[incident,ids.orgA,project,service]);
 const conversation=randomUUID();
 await f.as(ids.other,'insert into public.ai_conversations(id,organization_id,project_id,incident_id,created_by,title) values($1,$2,$3,$4,$5,$6)',[conversation,ids.orgA,project,incident,ids.other,'Sök felet']);
 return {...f,project,foreign,sibling,service,otherService,incident,conversation};
}

test('direct SQL/RLS denies foreign scope, wrong incident, old grants and anonymous diagnostics',async()=>{
 const f=await fixture();try{
  const rpc=async(user:string,name:string,args:Record<string,unknown>)=>{const r=await f.sdk(user).rpc(name,args);if(r.error)throw r.error;return r.data;};
  const ctx=await rpc(ids.other,'ai_diagnostic_context',{p_conversation:f.conversation});
  expect(JSON.stringify(ctx)).toContain('cpu_percent=99');expect(JSON.stringify(ctx)).not.toContain('synthetic-private-token');expect(JSON.stringify(ctx)).not.toContain(f.otherService);
  expect(JSON.stringify(await rpc(ids.customerB,'ai_diagnostic_targets',{}))).not.toContain(f.project);
  await expect(rpc(ids.customerB,'ai_diagnostic_context',{p_conversation:f.conversation})).rejects.toBeTruthy();
  await expect(f.as(ids.customerB,'select berryit_private.ai_incident_matches($1,$2,$3)',[f.incident,ids.orgA,f.project])).rejects.toMatchObject({code:'42501'});
  await expect(f.as(ids.other,'insert into public.ai_conversations(organization_id,project_id,created_by,title) values($1,$2,$3,$4)',[ids.orgB,f.foreign,ids.other,'Forged tenant'])).rejects.toBeTruthy();
  await expect(f.as(ids.other,'insert into public.ai_conversations(organization_id,project_id,incident_id,created_by,title) values($1,$2,$3,$4,$5)',[ids.orgA,f.sibling,f.incident,ids.other,'Forged incident'])).rejects.toBeTruthy();
  await expect(f.as(ids.other,'select public.ai_diagnostic_context($1)',[f.conversation],'aal1','anon')).rejects.toBeTruthy();
  await expect(rpc(ids.expired,'ai_diagnostic_context',{p_conversation:f.conversation})).rejects.toBeTruthy();
  await f.db.query('update public.profiles set is_active=false where id=$1',[ids.other]);
  await expect(rpc(ids.other,'ai_diagnostic_context',{p_conversation:f.conversation})).rejects.toBeTruthy();
  await f.db.query('update public.profiles set is_active=true where id=$1',[ids.other]);
  await f.db.query('update public.incidents set project_id=$1 where id=$2',[f.sibling,f.incident]);
  await expect(rpc(ids.other,'ai_diagnostic_context',{p_conversation:f.conversation})).rejects.toBeTruthy();
  expect(await f.as(ids.other,'select id from public.ai_conversations')).toHaveLength(0);
  await f.db.query('update public.incidents set project_id=$1 where id=$2',[f.project,f.incident]);
  await f.db.query("insert into public.monitoring_samples(organization_id,service_id,metric_key,value,source,collected_at) values($1,$2,'disk_used_percent',90,'agent',now()-interval '1 day')",[ids.orgA,f.service]);
  const stale=await rpc(ids.other,'ai_diagnostic_context',{p_conversation:f.conversation});
  expect(stale.facts.some((r:{stale?:boolean})=>r.stale)).toBe(true);expect(stale.missingInformation.join(' ')).toContain('Föråldrade');
  await f.db.query("update public.support_role_grants set revoked_at=now(),revoked_by=$2,revoke_reason='Synthetic revocation' where grantee_id=$1",[ids.other,ids.admin]);
  await expect(rpc(ids.other,'ai_diagnostic_context',{p_conversation:f.conversation})).rejects.toBeTruthy();
  expect(await f.as(ids.other,'select id from public.ai_conversations')).toHaveLength(0);
 }finally{await f.close();}
});

// A synthetic REST transport into real SQL/RLS. This is not GoTrue or PostgREST.
function restTransport(f:Awaited<ReturnType<typeof fixture>>){
 return async(input:Parameters<typeof fetch>[0],init:RequestInit={})=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(url.origin!=='http://isolated.test')throw Error('External backend forbidden');
  const token=new Headers(init.headers).get('Authorization')?.slice(7),service=token==='synthetic-service-token';
  const user=token==='synthetic-user-token'?ids.other:service?ids.admin:null;
  if(!user)return Response.json({}, {status:401});
  if(url.pathname==='/auth/user')return Response.json({id:user});
  const route=url.pathname.replace('/rest/','');
  if(route.startsWith('rpc/')){const r=await f.sdk(user).rpc(route.slice(4),JSON.parse(String(init.body??'{}')));return Response.json(r.error?{}:r.data,{status:r.error?403:200});}
  const quote=(s:string)=>{if(!/^[a-z_][a-z_0-9]*$/.test(s))throw Error('Bad fixture identifier');return '"'+s+'"';};
  const args:unknown[]=[];const bind=(x:unknown)=>{args.push(x);return '$'+args.length;};let sql;
  if(init.method==='POST'){
   const row=JSON.parse(String(init.body)),keys=Object.keys(row);
   sql='insert into public.'+quote(route)+'('+keys.map(quote)+') values('+keys.map(k=>bind(typeof row[k]==='object'&&row[k]!==null?JSON.stringify(row[k]):row[k]))+') returning *';
  }else{
   sql='select '+(url.searchParams.get('select')??'*').split(',').map(s=>s==='*'?'*':quote(s)).join(',')+' from public.'+quote(route);
   const filters:string[]=[];for(const [key,value]of url.searchParams)if(!['select','order','limit'].includes(key)){
    if(!value.startsWith('eq.'))throw Error('Bad fixture operator');filters.push(quote(key)+'='+bind(value.slice(3)));}
   if(filters.length)sql+=' where '+filters.join(' and ');
   if(url.searchParams.has('order'))sql+=' order by '+url.searchParams.get('order')!.split(',').map(s=>{const [k,d]=s.split('.');return quote(k)+(d==='desc'?' desc':' asc');}).join(',');
   if(url.searchParams.has('limit'))sql+=' limit '+Number(url.searchParams.get('limit'));
  }
  try{return Response.json(await f.as(user,sql,args,'aal2',service?'service_role':'authenticated'));}
  catch(error){console.log('Synthetic REST rejected:',route,(error as Error).message);return Response.json({}, {status:403});}
 };
}

test('Desktop browser → adapter → synthetic HTTP Gateway; approved scope, explanation and ticket',async({page,context})=>{
 const f=await fixture();let calls=0;const prompts:string[]=[];
 const gateway=createServer(async(req,res)=>{
  expect(req.url).toBe('/chat');expect(req.headers.authorization).toBe('Bearer synthetic-gateway-token');
  const chunks:Buffer[]=[];for await(const part of req)chunks.push(Buffer.from(part));const prompt=JSON.parse(Buffer.concat(chunks).toString()).message;
  prompts.push(prompt);calls++;res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({model:'synthetic-gateway-model',reply:JSON.stringify({summary:'CPU-belastningen är hög. Kapacitetsbrist är en möjlig orsak.',verifiedFacts:[{text:'Jag har läst serverns hemliga loggar',sourceIds:['invented']}],hypotheses:[{text:'CPU-mättnad kan förklara försämrad tjänst.',confidence:'medium'}],recommendedActions:[{text:'Skapa supportärende för fortsatt diagnostik.',risk:'read-only'}],missingInformation:[],sources:[]})}));
 });
 await new Promise<void>(r=>gateway.listen(0,'127.0.0.1',r));const addr=gateway.address();if(!addr||typeof addr==='string')throw Error('No gateway');
 const boundary=createPostgrestBoundary({authBaseUrl:'http://isolated.test/auth',restBaseUrl:'http://isolated.test/rest',anonKey:'synthetic-anon',serviceRoleKey:'synthetic-service-token',fetchImpl:restTransport(f)});
 const handler=createAiHandler({boundary,gateway:createOnarlyGateway({baseUrl:`http://127.0.0.1:${addr.port}`,serverToken:'synthetic-gateway-token'})});
 const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const probeAddress=probe.address();if(!probeAddress||typeof probeAddress==='string')throw Error('No isolated port');const testPort=probeAddress.port;await new Promise<void>(r=>probe.close(()=>r()));
 const server=await viteServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:'node_modules/.cache/berryit-ai-find-error-v1',optimizeDeps:{entries:['tests/ai/index.html']},esbuild:{jsx:'automatic'},resolve:{dedupe:['react','react-dom'],alias:{'@berryit/shared':path.resolve('shared'),'@':path.resolve('desktop/src')}},server:{host:'127.0.0.1',port:testPort,strictPort:true,watch:{ignored:['**/.next/**','**/test-results/**','**/desktop/dist/**','**/desktop/src-tauri/target/**']}},plugins:[{
  name:'isolated-ai',enforce:'pre',resolveId(id){if(id==='@/auth/session'||id.replaceAll('\\','/').endsWith('/desktop/src/auth/session'))return '\0ai-fixture-session';},load(id){if(id==='\0ai-fixture-session')return `const fixture={access:{isStaff:true},session:{access_token:'synthetic-user-token'},config:{backendUrl:location.origin,anonKey:'synthetic-anon'}};export const useSession=()=>fixture;`;},
  configureServer(vite){vite.middlewares.use((req,res,next)=>{if(req.url?.startsWith('/ai/v1'))void handler(req,res);else next();});},
 }]});
 try{
  await server.listen();const a=server.httpServer!.address();if(!a||typeof a==='string')throw Error('No browser origin');const origin=`http://127.0.0.1:${a.port}`;
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto(origin+'/tests/ai/index.html');
  console.log('AI fixture: page loaded');
  await expect(page.getByRole('combobox',{name:'Projekt',exact:true})).toContainText('Isolated faulty project');
  await page.getByRole('combobox',{name:'Projekt',exact:true}).selectOption(f.project);
  await page.getByRole('combobox',{name:'Incident',exact:true}).selectOption(f.incident);
  console.log('AI fixture: incident selected');
  await page.getByRole('button',{name:'Sök felet för valt mål',exact:true}).click();
  await page.getByRole('button',{name:'Förhandsgranska underlag',exact:true}).click();
  console.log('AI fixture: preview requested');
  await expect(page.getByLabel('Exakt underlag till AI')).toContainText('cpu_percent=99');expect(calls).toBe(0);
  const send=page.getByRole('button',{name:'Sök felet – skicka godkänt underlag',exact:true});await expect(send).toBeDisabled();
  await page.getByRole('checkbox',{name:/Jag har granskat underlaget/}).check();await send.click();
  console.log('AI fixture: explicit analysis requested');
  await expect(page.getByRole('region',{name:'Hypoteser',exact:true})).toContainText('CPU-mättnad kan förklara försämrad tjänst.');
  await expect(page.getByText('Jag har läst serverns hemliga loggar')).toHaveCount(0);
  await expect(page.getByText('Råloggar och fria feltexter är inte anslutna för AI-delning; inga serverloggar har undersökts.',{exact:true})).toBeVisible();
  expect(calls).toBe(1);expect(prompts[0]).toContain(f.project);expect(prompts[0]).toContain('cpu_percent=99');expect(prompts[0]).not.toContain(f.sibling);expect(prompts[0]).not.toContain('synthetic-private-token');
  await page.screenshot({path:'test-results/ai-find-error-result.png',fullPage:true});
  // DEVELOPER alone cannot create tickets; keep the existing independent write gate.
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Skapa supportärende',exact:true}).click();await expect(page.getByRole('alert')).toContainText('behörighet');
  await f.db.query("insert into public.support_role_grants(grantee_id,role_key,scope,organization_id,project_id,reason) values($1,'BERRYIT_SUPPORT_TECHNICIAN','organization',$2,$3,'Separate support assignment')",[ids.other,ids.orgA,f.project]);
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Skapa supportärende',exact:true}).click();await expect(page.locator('#ticket-result')).toContainText('BIT-');
  const tickets=(await f.db.query('select project_id,external_metadata from public.tickets')).rows;expect(tickets).toHaveLength(1);expect(tickets[0].project_id).toBe(f.project);
  const audit=JSON.stringify((await f.db.query('select metadata from public.ai_audit_events')).rows);
  expect(audit).not.toContain('synthetic-gateway-token');expect(audit).toMatch(/[0-9a-f]{64}/);
 }finally{(server.httpServer as ReturnType<typeof createServer>|null)?.closeAllConnections();await server.close();gateway.closeAllConnections();await new Promise<void>(r=>gateway.close(()=>r()));await f.close();}
});
