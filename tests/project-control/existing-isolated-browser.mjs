// Called only by the explicitly gated real isolated HTTP operator test.
import {createServer} from '../../desktop/node_modules/vite/dist/node/index.js';
import {chromium,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {executeAccessAction} from '../../shared/project-access.ts';
import {executeProjectControlAction} from '../../shared/project-control.ts';
import {verifySql} from './isolated-sql-readback.mjs';
export async function verify(c){
 const {owner,A,projectA,orgA,task,check,must,rpc}=c;
 await check('http.keyset_pages_larger_than_one_server_page',async()=>{
  for(let n=0;n<102;n++){const id=await rpc(A.client,'save_project_task',{p_id:null,p_project:projectA,p_values:{title:'Synthetic page task '+String(n).padStart(3,'0'),description:'Synthetic pagination',status:'todo',priority:'low',visibility:'project',assignee_id:null,due_at:null,checklist:[]},p_revision:null,p_reason:'Approved isolated pagination'});c.created.tasks.push(id);}
  const seen=new Set();let after=null,afterId=null,pages=0;
  for(;;){const page=await rpc(A.client,'list_project_tasks',{p_project:projectA,p_after:after,p_after_id:afterId});for(const t of page.items){must(!seen.has(t.id),'DUPLICATE_HTTP_PAGE');seen.add(t.id);}pages++;if(!page.hasMore)break;must(page.items.length&&pages<10,'PAGING_STALLED');after=page.items.at(-1).updated_at;afterId=page.items.at(-1).id;}
  must(pages>=2&&seen.size===c.created.tasks.length,'HTTP_PAGE_LOSS');return{pages,items:seen.size};
 });
 await check('http.project_archive_reactivate_preserves_tasks',async()=>{
  let p=(await owner.from('support_projects').select('revision').eq('id',projectA).single()).data;
  await rpc(owner,'save_support_project',{p_id:projectA,p_organization_id:orgA,p_values:{archived:true},p_reason:'Approved synthetic archive verification',p_revision:p.revision});
  const archived=await A.client.from('project_tasks').select('id').eq('id',task);must(!archived.error&&archived.data.length===1,'ARCHIVE_DELETED_TASK');
  p=(await owner.from('support_projects').select('revision').eq('id',projectA).single()).data;
  await rpc(owner,'save_support_project',{p_id:projectA,p_organization_id:orgA,p_values:{archived:false},p_reason:'Approved synthetic reactivation',p_revision:p.revision});
 });
 await verifySql(c);return verifyBrowser(c);
}
export async function verifyBrowser(c){
 const {owner,B,projectA,check,must}=c;
 await check('browser.pcc_eight_tabs_tasks_history_and_support_real_http',async()=>{
  let stage='START',page;const backendErrors=[],taskTitle='HTTP browser synthetic bug '+randomUUID().slice(0,8);
  let actor=owner;const errors=[],server=await createServer({configFile:false,envFile:false,root:process.cwd(),logLevel:'silent',cacheDir:'node_modules/.cache/berryit-project-http',optimizeDeps:{entries:['tests/project-control/http-index.html']},esbuild:{jsx:'automatic'},resolve:{dedupe:['react','react-dom']},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/test-results/**','**/.next/**','**/desktop/dist/**','**/desktop/src-tauri/target/**']}},plugins:[{name:'real-isolated-pcc',configureServer(vite){vite.middlewares.use((req,res,next)=>{
   if(!['/api/control/access','/api/control/project-control'].includes(req.url??''))return next();
   if(req.method!=='POST'){res.statusCode=405;res.end();return;}
   void(async()=>{try{const chunks=[];let size=0;for await(const b of req){size+=b.length;if(size>65536)throw Error('INPUT_LIMIT');chunks.push(Buffer.from(b));}const input=JSON.parse(Buffer.concat(chunks).toString());const data=req.url==='/api/control/access'?await executeAccessAction(actor,input):await executeProjectControlAction(actor,input);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data}));}catch(e){backendErrors.push({route:req.url,code:e.code??e.name??'UNKNOWN'});res.statusCode=403;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Isolated backend request denied'}));}})();
  });}}]});let browser;
  try{
   await server.listen();const a=server.httpServer.address();must(a&&typeof a!=='string','LOCAL_PORT_MISSING');const origin='http://127.0.0.1:'+a.port;
   browser=await chromium.launch({headless:true});const context=await browser.newContext();await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());page=await context.newPage();page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(60000);page.on('pageerror',e=>errors.push(e.name));stage='LOAD';await page.goto(origin+'/tests/project-control/http-index.html',{waitUntil:'domcontentloaded'});
   stage='OPEN_PROJECT';
   const name=(await owner.from('support_projects').select('name').eq('id',projectA).single()).data.name;await page.getByRole('button',{name:new RegExp(name)}).click();const view=page.getByRole('region',{name:'Project Control Center'});await expect(view).toBeVisible();
   for(const tab of ['Overview','Infrastructure','Git & Code','Tasks','Activity History','Releases','Support','Platform Factory']){stage='TAB_'+tab.toUpperCase().replaceAll(/[^A-Z]+/g,'_');await view.getByRole('button',{name:tab,exact:true}).click();await expect(view.getByRole('alert')).toHaveCount(0);}
   stage='INFRASTRUCTURE';
   await view.getByRole('button',{name:'Infrastructure',exact:true}).click();await expect(view).toContainText('Synthetic intentionally paused');
   await view.getByRole('button',{name:'Git & Code',exact:true}).click();await expect(view).toContainText('Synthetic-PCC/example');
   stage='CREATE_TASK';await view.getByRole('button',{name:'Tasks',exact:true}).click();const tasks=page.getByRole('region',{name:'Projektuppgifter'});await tasks.getByRole('button',{name:'+ Ny uppgift'}).click();await tasks.getByLabel('Titel',{exact:true}).fill(taskTitle);await tasks.getByLabel('Beskrivning',{exact:true}).fill('Actual HTTP regression with synthetic data');await tasks.getByLabel('Orsak till taskändring').fill('Approved synthetic browser verification');await tasks.getByRole('button',{name:'Spara uppgift',exact:true}).click();await expect(tasks.getByRole('article',{name:'Uppgiftsdetaljer'})).toContainText(taskTitle);
   stage='TASK_HISTORY';
   await tasks.getByLabel('Ny taskkommentar').fill('Synthetic actual HTTP comment');await tasks.getByRole('button',{name:'Lägg till kommentar'}).click();await expect(tasks).toContainText('Synthetic actual HTTP comment');
   await tasks.getByRole('button',{name:'Visa / uppdatera taskhistorik'}).click();await expect(tasks.getByRole('region',{name:'Uppgiftens ändringshistorik'})).toContainText('task.created');
   stage='ACTIVITY';await view.getByRole('button',{name:'Activity History',exact:true}).click();await expect(view).toContainText('task.created');
   await view.getByRole('button',{name:'Support',exact:true}).click();await view.getByRole('button',{name:'Öppna i Support Desk'}).click();await expect(page.getByRole('status').first()).toContainText('Support Desk:');
   await page.screenshot({path:'test-results/project-control-native-20261025/real-http-pcc.png',fullPage:true});
   actor=B.client;await page.evaluate(()=>{localStorage.setItem('role','ADMIN');sessionStorage.setItem('isSuperAdmin','true');});
   const denied=await page.evaluate(async id=>(await fetch('/api/control/project-control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'overview',project:id})})).status,projectA);must(denied===403,'UI_FLAGS_ESCALATED_AUTHORITY');must(!errors.length,'BROWSER_JAVASCRIPT_ERROR');
   const existing=await owner.from('project_tasks').select('id').eq('project_id',projectA).eq('title',taskTitle);must(!existing.error&&existing.data.length===1,'UI_TASK_MISSING');c.created.tasks.push(existing.data[0].id);
  }catch(e){await page?.screenshot({path:'test-results/project-control-native-20261025/browser-failure.png',fullPage:true}).catch(()=>{});const fs=await import('node:fs');fs.writeFileSync('test-results/project-control-native-20261025/browser-diagnostic.json',JSON.stringify({stage,name:e.name,message:e.message?.slice(0,2000),backendErrors,errors},null,2));throw Error('BROWSER_'+stage+'_'+e.name.toUpperCase().replaceAll(/[^A-Z_]/g,''));}finally{await browser?.close();await server.close();}
  return{renderer:'CHROMIUM_HEADLESS',transport:'REAL_GOTRUE_POSTGREST_WITH_LOCAL_TEST_PROXY',nativeWindowsVerified:false};
 });
}
