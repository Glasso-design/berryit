// Actual unmodified production App + SessionProvider + Supabase client.
// Only HTTP responses are synthetic. No real login, MFA or server writes.
import {test,expect,type Page} from '@playwright/test';
import {createServer,type Server} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';

const userId='11111111-1111-4111-8111-111111111111';
const customerId='22222222-2222-4222-8222-222222222222';
const orgId='33333333-3333-4333-8333-333333333333';
const projectId='44444444-4444-4444-8444-444444444444';
const ticketId='55555555-5555-4555-8555-555555555555';
const factorId='66666666-6666-4666-8666-666666666666';
const at='2026-10-17T10:00:00Z';
const permissions=['tickets.read','tickets.write','projects.read','projects.manage','roles.manage','roles.grant','organizations.manage','connectors.manage','infrastructure.read','ai.use'];
const authority={isStaff:true,isSuperAdmin:false,accountActive:true,requiresMfa:true,permissions,roles:['ADMIN']};
const organization={id:orgId,name:'Synthetic render organization',org_no:null,is_internal:true};
const project={id:projectId,organization_id:orgId,name:'Synthetic render project',description:'Render fixture',status:'active',environment:'development',website_url:null,repository_url:null,contact_id:null,archived_at:null,source:'manual',revision:1};
const ticket={id:ticketId,reference:'BIT-2026-9001',subject:'Synthetic render ticket',description:'Render fixture',requester_id:customerId,organization_id:orgId,project_id:projectId,assignee_id:null,status_key:'mottaget',priority_key:'normal',category_key:'ovrigt',contact_name:null,contact_email:null,contact_phone:null,created_at:at,updated_at:at,resolved_at:null,closed_at:null};
const user={id:userId,email:'render@example.test',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email',providers:['email']},user_metadata:{},identities:[],created_at:at,factors:[{id:factorId,factor_type:'totp',status:'verified',friendly_name:'Synthetic TOTP',created_at:at,updated_at:at}]};
function session(aal:'aal1'|'aal2'){
 const now=Math.floor(Date.now()/1000);
 const jwt=[{alg:'HS256',typ:'JWT'},{sub:userId,role:'authenticated',aud:'authenticated',aal,iat:now,exp:now+3600,session_id:userId},'synthetic-test-signature'].map((p,n)=>n<2?Buffer.from(JSON.stringify(p)).toString('base64url'):p).join('.');
 return {access_token:jwt,refresh_token:'synthetic-refresh-token',expires_in:3600,expires_at:now+3600,token_type:'bearer',user};
}
let server:Server,origin:string;
test.beforeAll(async()=>{
 const root=resolve('desktop/dist');
 server=createServer(async(req,res)=>{
  const pathname=new URL(req.url??'/','http://fixture.test').pathname;
  const file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
  try{const body=await readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'} as Record<string,string>)[extname(file)]??'application/octet-stream');res.end(body);}
  catch{res.writeHead(404).end();}
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const addr=server.address();if(!addr||typeof addr==='string')throw Error('No production frontend port');origin=`http://127.0.0.1:${addr.port}`;
});
test.afterAll(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});

async function login(page:Page){
 const unexpected:string[]=[],errors:string[]=[];let mfaVerified=false;
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&/Invalid hook|reading 'use|react\.dev\/errors/.test(m.text()))errors.push(m.text());});
 await page.addInitScript(()=>{localStorage.setItem('berryit-desktop-config',JSON.stringify({backendUrl:'http://127.0.0.1:8700',anonKey:'sb_publishable_synthetic_render_only'}));});
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin===origin)return route.continue();
  if(url.origin!=='http://127.0.0.1:8700'){unexpected.push(url.origin+url.pathname);return route.abort();}
  const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,HEAD,OPTIONS','Access-Control-Expose-Headers':'content-range'};
  const json=(value:unknown)=>route.fulfill({json:value,headers});
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(url.pathname==='/auth/v1/health')return json({name:'Synthetic Auth'});
  if(url.pathname==='/auth/v1/token'&&req.method()==='POST')return json(session('aal1'));
  if(url.pathname==='/auth/v1/user')return json(user);
  if(url.pathname===`/auth/v1/factors/${factorId}/challenge`)return json({id:factorId,type:'totp',expires_at:Math.floor(Date.now()/1000)+300});
  if(url.pathname===`/auth/v1/factors/${factorId}/verify`){expect(req.postDataJSON().code).toBe('123456');mfaVerified=true;return json(session('aal2'));}
  if(url.pathname.startsWith('/rest/v1/')){
   const token=req.headers().authorization??'';
   if(!token.startsWith('Bearer ey')){unexpected.push('Missing synthetic session');return route.fulfill({status:401,json:{},headers});}
   const table=url.pathname.slice('/rest/v1/'.length);
   if(table.startsWith('rpc/')){
    const rpc=table.slice(4);
    if(rpc==='support_access_context')return json(authority);
    if(['can_register_support_customer','can_manage_connectors','can_work_ticket'].includes(rpc))return json(mfaVerified);
    if(['project_registry_status','support_ticket_technicians','support_ticket_people'].includes(rpc))return json([]);
    // Ticket detail asks whether the caller may reassign (same check as the DB guard); the fixture is an ADMIN.
    if(rpc==='has_resource_permission'){expect(req.postDataJSON().p_permission).toBe('tickets.reassign');return json(mfaVerified);}
    if(rpc==='project_access_details')return json({assignments:[],activity:[],reviews:[]});
    unexpected.push('RPC '+rpc);return route.fulfill({status:403,json:{message:'Unexpected fixture RPC'},headers});
   }
   const customer={id:customerId,role:'customer',full_name:'Synthetic render customer',email:'customer@example.test',phone:null,organization_id:orgId,is_active:true,login_activation_pending:false};
   const tables:Record<string,Record<string,unknown>[]>={
    profiles:[{...user,role:'admin',full_name:'Synthetic render admin',organization_id:null,is_org_admin:false,is_active:true,login_activation_pending:false},customer],
    organizations:[organization],tickets:[ticket],support_projects:[project],
    ticket_statuses:[{key:'mottaget',label:'Mottaget',is_active:true,sort_order:1}],ticket_categories:[{key:'ovrigt',label:'Övrigt',is_active:true,sort_order:1}],ticket_priorities:[{key:'normal',label:'Normal'}],
    support_role_grants:[],support_roles:[],support_permissions:[],support_role_permissions:[],
    infra_nodes:[],infra_services:[],connector_integrations:[],project_external_identities:[],support_admin_audit:[],service_status_checks:[],
    monitoring_metric_kinds:[],monitoring_samples:[],monitoring_thresholds:[],incidents:[],
    ticket_messages:[],ticket_internal_notes:[],ticket_attachments:[],ticket_events:[],
    onarly_desk_devices:[],onarly_desk_sessions:[],onarly_desk_session_events:[],onarly_support_entitlements:[],
   };
   if(!(table in tables)||!['GET','HEAD'].includes(req.method())){unexpected.push(req.method()+' '+table);return route.fulfill({status:403,json:{message:'Unexpected fixture query'},headers});}
   let rows=tables[table];
   for(const [key,value]of url.searchParams){if(value.startsWith('eq.'))rows=rows.filter(r=>String(r[key])===value.slice(3));else if(value.startsWith('gt.'))rows=rows.filter(r=>String(r[key])>value.slice(3));}
   const offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??1000);rows=rows.slice(offset,offset+limit);
   if(req.method()==='HEAD')return route.fulfill({status:200,headers:{...headers,'Content-Range':`0-0/${rows.length}`}});
   if(req.headers().accept?.includes('application/vnd.pgrst.object+json'))return json(rows[0]??null);
   return json(rows);
  }
  if(url.pathname==='/ai/v1/context')return json({organizations:[organization],projects:[project],incidents:[],services:[],gateway:{available:false,verified:false,reason:'Synthetic disconnected Gateway'}});
  if(url.pathname==='/ai/v1/conversations')return json({conversations:[]});
  unexpected.push(req.method()+' '+url.pathname);return route.fulfill({status:403,json:{error:'Unexpected fixture request'},headers});
 });
 await page.goto(origin);
 await expect(page.getByRole('heading',{name:'Logga in',exact:true})).toBeVisible();
 await page.getByRole('textbox',{name:'E-post',exact:true}).fill('render@example.test');
 await page.getByLabel('Lösenord',{exact:true}).fill('synthetic-password-only');
 await page.getByRole('button',{name:'Logga in',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Tvåfaktor krävs',exact:true})).toBeVisible();
 await page.getByLabel('Engångskod',{exact:true}).fill('123456');
 await page.getByRole('button',{name:/Bekräfta|Verifiera/}).click();
 await expect(page.getByRole('heading',{name:'Översikt',exact:true})).toBeVisible();
 expect(mfaVerified).toBe(true);
 return {errors,unexpected};
}

for(const [module,heading]of [['Kunder','Kunder'],['Projekt','Projekt och åtkomst'],['Support Desk','Support Desk'],['Dashboard','Översikt'],['Integrationer','Integrationer'],['Monitoring','Monitoring'],['Ask ONARLY AI','Ask ONARLY AI']]){
 test(`production cold start, synthetic login/MFA and navigation: ${module}`,async({page},info)=>{
  const evidence=await login(page);const nav=page.getByRole('navigation',{name:'Huvudmeny'});
  try{
   for(let n=0;n<2;n++){
    await nav.getByRole('button',{name:module,exact:true}).click();
    await expect(page.getByRole('heading',{name:heading,exact:true,level:1})).toBeVisible();
    if(module==='Kunder')await expect(page.getByRole('cell',{name:'Synthetic render customer',exact:true})).toBeVisible();
    if(module==='Projekt')await expect(page.getByRole('button',{name:/Synthetic render project/})).toBeVisible();
    if(module==='Support Desk'){
     await expect(page.getByRole('cell',{name:'Synthetic render ticket',exact:true})).toBeVisible();
     await page.getByRole('button',{name:ticket.reference,exact:true}).click();
     await expect(page.getByRole('heading',{name:`${ticket.reference} · ${ticket.subject}`,exact:true})).toBeVisible();
    }
    if(module==='Ask ONARLY AI')await expect(page.getByText('Gateway ej ansluten',{exact:true})).toBeVisible();
    expect(evidence.errors).toEqual([]);expect(evidence.unexpected).toEqual([]);
    await page.screenshot({path:`test-results/desktop-react/${module.replaceAll(' ','-')}-${n}.png`});
    await nav.getByRole('button',{name:'Dashboard',exact:true}).click();await expect(page.getByRole('heading',{name:'Översikt',exact:true})).toBeVisible();
   }
  }finally{
   await mkdir('test-results/desktop-react',{recursive:true});
   await writeFile(`test-results/desktop-react/${module.replaceAll(' ','-')}-evidence.json`,JSON.stringify(evidence,null,2));
   await info.attach('production-render-evidence',{body:JSON.stringify(evidence),contentType:'application/json'});
  }
 });
}
