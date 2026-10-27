import {test,expect} from '@playwright/test';
import {createServer} from '../../desktop/node_modules/vite/dist/node/index.js';
import {readFileSync} from 'node:fs';
import {isolatedDatabase,ids} from '../support/database';
import {executeAccessAction} from '../../shared/project-access';
import {executeProjectControlAction,uploadProjectTaskFile,type TaskAttachment} from '../../shared/project-control';
import {createQabgoAdapter} from '../../services/platform-factory/adapters/qabgo.mjs';
import {registerLocalCatalog} from '../../services/platform-factory/catalog.mjs';
import type {SupabaseClient} from '@supabase/supabase-js';

test('Chromium: project tabs → task lifecycle → history → Support/Factory links with real RLS',async({page,context})=>{
 const f=await isolatedDatabase();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await f.db.exec("alter table storage.objects add column metadata jsonb; set factory.install_environment='isolated-test'");
 for(const file of ['001_factory.sql','002_provider_broker.sql'])await f.db.exec(readFileSync('services/platform-factory/db/'+file,'utf8'));
 await registerLocalCatalog(f.db,createQabgoAdapter(JSON.parse(readFileSync('services/platform-factory/adapters/qabgo.template.json','utf8'))));
 const baseActor=f.sdk(ids.admin);
 const saved=await baseActor.rpc('save_support_project',{p_id:null,p_organization_id:ids.orgA,p_values:{name:'PCC browser SaaS',description:'Synthetic isolated browser journey'},p_reason:'Synthetic browser fixture'});
 if(saved.error)throw saved.error;const project=saved.data as string;
 await baseActor.rpc('save_project_control',{p_project:project,p_section:'profile',p_values:{project_type:'saas',factory_product_key:'qabgo'},p_reason:'Synthetic adapter mapping'});
 const assignable=await baseActor.rpc('project_task_assignees',{p_project:project});expect(assignable.error).toBeNull();expect(assignable.data.map((x:{id:string})=>x.id)).toContain(ids.admin);
 const category=(await f.db.query('select key from public.ticket_categories order by key limit 1')).rows[0].key;
 await f.db.query("insert into public.tickets(reference,organization_id,project_id,requester_id,subject,description,category_key) values('PCC-BROWSER',$1,$2,$3,'Synthetic browser support','Synthetic support description',$4)",[ids.orgA,project,ids.customerA,category]);
 let serial:Promise<unknown>=Promise.resolve();const lock=<T,>(fn:()=>Promise<T>)=>{const next=serial.then(fn,fn);serial=next.catch(()=>{});return next;};
 // Test-only Storage transport records real bytes and trusted object size.
 // Production Storage HTTP and signed URL cryptography are not simulated as PASS.
 const actor=(user:string)=>{
  const sdk=f.sdk(user);const rpc=sdk.rpc.bind(sdk);
  return {...sdk,rpc:((name:string,args:Record<string,unknown>={})=>rpc(name,name==='register_project_names'?{...args,p_names:JSON.stringify(args.p_names)}:args)),storage:{from:(bucket:string)=>{
   const transport=sdk.storage.from(bucket);return {...transport,createSignedUrl:transport.createSignedUrl.bind(transport),upload:async(path:string,file:File)=>{
    const result=await transport.upload(path,file);if(!result.error)await f.db.query('update storage.objects set metadata=$1 where bucket_id=$2 and name=$3',[JSON.stringify({size:file.size}),bucket,path]);return result;
   }};
  }}} as unknown as SupabaseClient;
 };
 const server=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:'node_modules/.cache/berryit-project-control',optimizeDeps:{entries:['tests/project-control/index.html']},esbuild:{jsx:'automatic'},resolve:{dedupe:['react','react-dom']},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/.next/**','**/test-results/**','**/desktop/dist/**','**/desktop/src-tauri/target/**']}},plugins:[{name:'isolated-project-rpc',configureServer(vite){vite.middlewares.use((req,res,next)=>{
  const routes=['/api/control/access','/api/control/project-control','/api/control/project-control/attachment','/synthetic/factory'];if(!routes.includes(req.url??''))return next();
  void lock(async()=>{try{
   const user=req.headers.cookie?.match(/(?:^|; )fixture_actor=([^;]+)/)?.[1]??ids.other,sdk=actor(user),chunks:Buffer[]=[];for await(const p of req)chunks.push(Buffer.from(p));const body=Buffer.concat(chunks);
   let data:unknown;
   if(req.url?.endsWith('/attachment')){const form=await new Response(body,{headers:{'Content-Type':String(req.headers['content-type'])}}).formData();const pending=form.get('pending');await uploadProjectTaskFile(sdk,String(form.get('task')),form.get('file') as File,pending?JSON.parse(String(pending)) as TaskAttachment:undefined);data=true;}
   else{const input=JSON.parse(body.toString());
    if(req.url==='/synthetic/factory'){
     const name=input.action==='catalog'?'factory_catalog':input.action==='list'?'factory_list':null;if(!name)throw Error('Read-only Factory navigation fixture');
     const result=await sdk.rpc(name,name==='factory_list'?{p_after:input.after??null,p_after_id:input.afterId??null}:{});if(result.error)throw result.error;data=result.data;
    }else data=req.url==='/api/control/access'?await executeAccessAction(sdk,input):await executeProjectControlAction(sdk,input);
   }
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data}));
  }catch(e){res.statusCode=403;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:e instanceof Error?e.message:(e as {message:string}).message}));}});
 });}}]});
 try{
  await server.listen();const address=server.httpServer!.address();if(!address||typeof address==='string')throw Error('Missing isolated listener');const origin='http://127.0.0.1:'+address.port;
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());await context.addCookies([{name:'fixture_actor',value:ids.admin,url:origin}]);
  await page.goto(origin+'/tests/project-control/index.html');await page.getByRole('button',{name:/PCC browser SaaS/}).click();
  await expect(page.getByRole('heading',{name:'SaaS · kundinstanser och drift'})).toBeVisible();
  const view=page.getByRole('region',{name:'Project Control Center'});await expect(view).toContainText('Ej verifierad');
  await page.screenshot({path:'test-results/project-control-20261025/overview.png',fullPage:true});
  for(const tab of ['Infrastructure','Git & Code','Releases','Support','Activity History','Platform Factory']){await view.getByRole('button',{name:tab,exact:true}).click();await expect(view.getByRole('alert')).toHaveCount(0);}
  await view.getByRole('button',{name:'Support',exact:true}).click();await view.getByRole('button',{name:'Öppna i Support Desk'}).click();await expect(page.getByRole('status').first()).toContainText('Support Desk: PCC-BROWSER');
  await view.getByRole('button',{name:'Tasks',exact:true}).click();const tasks=page.getByRole('region',{name:'Projektuppgifter'});
  await tasks.getByRole('button',{name:'+ Ny uppgift'}).click();await tasks.getByLabel('Titel',{exact:true}).fill('Browser synthetic bug');await tasks.getByLabel('Beskrivning',{exact:true}).fill('Synthetic fault, no external service examined');
  await tasks.getByRole('combobox',{name:'Ansvarig',exact:true}).selectOption(ids.admin);await tasks.getByLabel('Deadline',{exact:true}).fill('2027-01-01T12:00');await tasks.getByLabel(/Checklista ·/).fill('[ ] Inspect approved telemetry\n[x] Record synthetic test');
  await tasks.getByLabel('Orsak till taskändring').fill('Synthetic browser create');await tasks.getByRole('button',{name:'Spara uppgift',exact:true}).click();
  await expect(tasks.getByRole('article',{name:'Uppgiftsdetaljer'})).toContainText('Browser synthetic bug');
  await tasks.getByLabel('Ny taskkommentar').fill('Synthetic private investigation');await tasks.getByRole('button',{name:'Lägg till kommentar'}).click();await expect(tasks).toContainText('Synthetic private investigation');
  await tasks.getByLabel('Ladda upp taskbilaga · högst 25 MB').setInputFiles({name:'synthetic.txt',mimeType:'text/plain',buffer:Buffer.from('synthetic attachment')});await expect(tasks).toContainText('synthetic.txt');await expect(tasks).toContainText('Uppladdad');
  await tasks.getByRole('button',{name:'Begär nedladdning'}).click();await expect(tasks.getByRole('link',{name:/Öppna behörig nedladdning/})).toHaveAttribute('href',/127.0.0.1\/__synthetic_download/);
  await tasks.getByRole('button',{name:'Visa / uppdatera taskhistorik'}).click();await expect(tasks.getByRole('region',{name:'Uppgiftens ändringshistorik'})).toContainText('task.created');
  await tasks.getByRole('button',{name:'Redigera uppgift',exact:true}).click();await tasks.getByLabel('Uppgiftsstatus').selectOption('done');await tasks.getByLabel('Orsak till taskändring').fill('Synthetic browser resolution');await tasks.getByRole('button',{name:'Spara uppgift',exact:true}).click();await expect(tasks.getByRole('article',{name:'Uppgiftsdetaljer'})).toContainText('Done');
  await view.getByRole('button',{name:'Activity History',exact:true}).click();await expect(view).toContainText('task.done');
  await view.getByLabel('Händelsetyp').selectOption('test');await view.getByLabel('Underlagets titel').fill('Browser local regression');await view.getByLabel('Underlag',{exact:true}).fill('Only synthetic browser fixture');await view.getByLabel('Orsak / underlag').fill('Synthetic evidence');await view.getByRole('button',{name:'Registrera utvecklingsunderlag',exact:true}).click();
  await view.getByRole('button',{name:'Releases',exact:true}).click();await expect(view).toContainText('Browser local regression');await expect(view).toContainText('EJ SYSTEMVERIFIERAD');
  await page.getByRole('button',{name:'All Tasks',exact:true}).click();const all=page.getByRole('region',{name:'All Tasks'});await all.getByRole('combobox',{name:'Status',exact:true}).selectOption('blocked');await expect(all).toContainText('Inga synliga uppgifter');await all.getByRole('combobox',{name:'Status',exact:true}).selectOption('done');await expect(all).toContainText('Browser synthetic bug');
  await page.getByRole('button',{name:'Projektregistret'}).click();await page.getByRole('button',{name:/PCC browser SaaS/}).click();await view.getByRole('button',{name:'Platform Factory',exact:true}).click();await view.getByRole('button',{name:'Öppna projektets Platform Factory'}).click();await expect(page.getByLabel('Organisation / projekt')).toHaveValue(project);await expect(page.getByLabel('Produkt/system')).toHaveValue('qabgo');await expect(page.getByLabel('Objektlagring (byte)')).toHaveValue('1000000000');
  await page.screenshot({path:'test-results/project-control-20261025/factory-link.png',fullPage:true});
  // A customer and forged frontend flags cannot acquire task/project authority.
  await context.addCookies([{name:'fixture_actor',value:ids.customerB,url:origin}]);await page.goto(origin+'/tests/project-control/index.html');await page.getByRole('button',{name:'All Tasks',exact:true}).click();await expect(page.getByRole('button',{name:'+ Ny uppgift'})).toHaveCount(0);await expect(page.getByRole('region',{name:'All Tasks'})).not.toContainText('Browser synthetic bug');
  await page.evaluate(()=>{localStorage.setItem('role','ADMIN');sessionStorage.setItem('isSuperAdmin','true');});
  const denied=await page.evaluate(async projectId=>(await fetch('/api/control/project-control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'overview',project:projectId})})).status,project);expect(denied).toBe(403);
  expect(errors).toEqual([]);
 }finally{await server.close();await f.close();}
});
