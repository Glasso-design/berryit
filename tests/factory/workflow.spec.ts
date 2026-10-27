import {test,expect} from '@playwright/test';
import {createServer} from '../../desktop/node_modules/vite/dist/node/index.js';
import {fixture} from '../../services/platform-factory/tests/fixture.mjs';
import {FactoryEngine,runWorker} from '../../services/platform-factory/engine.mjs';
import {MockProvider} from '../../services/platform-factory/providers/mock.mjs';
import {publishProviderStatus} from '../../services/platform-factory/providers/status.mjs';

test('browser → synthetic RPC transport → real SQL authority → background worker → truthful checklist',async({page,context})=>{
 if(process.env.BERRYIT_WORKFLOW_TEST!=='isolated-pglite')throw Error('Explicit isolated environment required');
 const f=await fixture(),abort=new AbortController();let worker:Promise<void>|undefined;
 let serial:Promise<unknown>=Promise.resolve();
 const locked=<T,>(fn:()=>Promise<T>):Promise<T>=>{const next=serial.then(fn,fn);serial=next.catch(()=>{});return next;};
 // Synthetic authenticated transport only. No GoTrue, JWT verification or
 // production session is represented by this browser fixture.
 const transport=(p:Record<string,unknown>)=>{
  const actions:Record<string,()=>Promise<unknown>>={catalog:()=>f.rpc(f.ids.adminA,'factory_catalog'),list:()=>f.rpc(f.ids.adminA,'factory_list',[p.after??null,p.afterId??null]),create:()=>f.rpc(f.ids.adminA,'factory_create',[JSON.stringify(p.input)]),details:()=>f.rpc(f.ids.adminA,'factory_snapshot',[p.jobId]),retry:()=>f.rpc(f.ids.adminA,'factory_resume',[p.jobId]),manual:()=>f.rpc(f.ids.adminA,'factory_manual',[p.jobId,p.step,p.note])};
  if(p.action==='providerStatus')return f.rpc(f.ids.adminA,'factory_provider_status',[p.instanceId]);
  if(p.action==='approveAccountMode')return f.rpc(f.ids.adminA,'factory_approve_account_mode',[p.jobId,p.mode,p.reason]);
  const action=actions[String(p.action)];if(!action)throw Error('Unknown synthetic RPC');return action();
 };
 const engine=new FactoryEngine({store:f.store,registry:f.registry,provider:new MockProvider({db:f.db})});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const server=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:'node_modules/.cache/berryit-factory',optimizeDeps:{entries:['tests/factory/index.html']},esbuild:{jsx:'automatic'},resolve:{dedupe:['react','react-dom']},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/test-results/**','**/.next/**','**/desktop/dist/**','**/desktop/src-tauri/target/**']}},plugins:[{name:'synthetic-factory',configureServer(vite){vite.middlewares.use((req,res,next)=>{
  if(req.url!=='/synthetic/factory')return next();
  void(async()=>{try{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const input=JSON.parse(Buffer.concat(chunks).toString());const data=await locked(()=>transport(input));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data}));}catch{res.statusCode=403;res.end(JSON.stringify({error:'Synthetic request denied'}));}})();
 });}}]});
 try{
  worker=runWorker({engine:{run:(id:string)=>locked(()=>engine.run(id))},queue:()=>locked(async()=>(await f.db.query("select id from factory.jobs where state='APPROVED'")).rows.map((r:{id:string})=>r.id)),signal:abort.signal,intervalMs:100});
  await server.listen();const address=server.httpServer!.address();if(!address||typeof address==='string')throw Error('Missing test port');
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto('http://127.0.0.1:'+address.port+'/tests/factory/index.html');
  await page.getByLabel('Produkt/system').selectOption('hub');await expect(page.getByRole('button',{name:'SKAPA PLATTFORM · MOCK'})).toBeDisabled();
  await expect(page.getByText('BLOCKED: vald produkt saknar versionsgranskad adapter. Ingen annan produkt väljs automatiskt.')).toBeVisible();
  await page.getByLabel('Produkt/system').selectOption('qabgo');
  await page.getByLabel('Organisation / projekt').selectOption(f.ids.projectA);
  await page.getByLabel('Ägare (befintlig identitet)').selectOption(f.ids.customerA);
  await page.getByLabel('Plattformens namn').fill('Synthetic browser platform');await page.getByLabel('Kundnamn',{exact:true}).fill('Synthetic browser owner');
  await page.getByLabel('Önskad domän').fill('browser.example.invalid');
  await expect(page.getByLabel('Objektlagring (byte)')).toHaveValue('1000000000');
  await expect(page.getByText('Standard för nya plattformar: 1 GB (1 000 000 000 byte). Större kvot kan anges.')).toBeVisible();
  await page.getByRole('button',{name:'SKAPA PLATTFORM · MOCK'}).click();
  await expect(page.getByRole('article',{name:'Installationsdetaljer'})).toBeVisible();
  await expect.poll(()=>locked(async()=>(await f.db.query('select state from factory.jobs')).rows[0].state)).toBe('WAITING_FOR_EXTERNAL');
  const syntheticJob=await locked(async()=>(await f.db.query('select id,instance_id from factory.jobs')).rows[0]);
  const storedQuota=await locked(async()=>Number((await f.db.query('select quota_bytes from factory.instances where id=$1',[syntheticJob.instance_id])).rows[0].quota_bytes));
  expect(storedQuota).toBe(1000000000);
  await locked(()=>publishProviderStatus(f.db,syntheticJob.instance_id,{accountMode:'DEDICATED_MANAGED',capabilities:{verification:'SYNTHETIC_HTTP',capabilities:{'r2.read':'VERIFIED_READ','r2.write':'UNVERIFIED'},missingPermissions:['dns.write'],blockers:['EXTERNAL_BACKUP_AND_RESTORE_REQUIRED','ISOLATED_HTTP_MFA_SSO_GATE_REQUIRED']},dns:'SYNTHETIC',email:'SYNTHETIC',tls:'SYNTHETIC',cost:{objectBytes:1000000000}}));
  await page.getByRole('button',{name:'Hämta framsteg'}).click();
  await expect(page.getByRole('heading',{name:/Synthetic browser platform · WAITING_FOR_EXTERNAL/})).toBeVisible();
  await expect(page.getByRole('region',{name:'Providerstatus'})).toContainText('SYNTHETIC_HTTP');
  await expect(page.getByRole('region',{name:'Providerstatus'})).toContainText('dns.write');
  await page.getByText('Separat godkännande av ändrad kontomodell',{exact:true}).click();
  await page.getByLabel('Underlag / orsak (inga hemligheter)').fill('Synthetic explicit approval of resource isolation; no real provisioning.');
  await expect(page.getByRole('button',{name:'Registrera separat kontomodellsgodkännande'})).toBeDisabled();
  await page.getByLabel('Jag godkänner uttryckligen den valda kontomodellen och dess isoleringsnivå.').check();
  await page.getByRole('button',{name:'Registrera separat kontomodellsgodkännande'}).click();
  await expect(page.getByRole('region',{name:'Providerstatus'})).toContainText('MANAGED_RESOURCE_ISOLATION');
  await page.screenshot({path:'test-results/platform-factory-20261024/factory-checklist.png',fullPage:true});
  await page.getByLabel('Underlag / orsak (inga hemligheter)').fill('Synthetic manual review only; no business activation.');
  const manual=page.getByRole('button',{name:'Registrera manuellt underlag'});await manual.nth(0).click();await expect(manual.nth(1)).toBeEnabled();await manual.nth(1).click();
  await page.getByRole('button',{name:'Återuppta samma jobb'}).click();
  // Close the page: work is a server process and does not depend on rendering.
  await page.close();
  await expect.poll(()=>locked(async()=>(await f.db.query('select state from factory.jobs')).rows[0].state)).toBe('READY');
  const rows=await locked(async()=>(await f.db.query('select status,execution_mode from factory.instances')).rows);expect(rows[0]).toMatchObject({status:'SIMULATED',execution_mode:'MOCK'});expect(errors).toEqual([]);
 }finally{abort.abort();await worker;await server.close();await f.db.close();}
});
