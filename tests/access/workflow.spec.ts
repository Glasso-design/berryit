import {test,expect} from '@playwright/test';
import {createServer} from '../../desktop/node_modules/vite/dist/node/index.js';
import {isolatedDatabase,ids} from '../support/database';
import {executeAccessAction,type AccessCatalog} from '../../shared/project-access';

test('client transport enforces RPC/RLS and paginates the complete catalog',async()=>{
 const f=await isolatedDatabase();try{
  await f.db.exec("insert into public.support_projects(organization_id,name,created_by) select '"+ids.orgA+"','Synthetic pagination '||n,'"+ids.admin+"' from generate_series(1,1201) n");
  const catalog=await executeAccessAction(f.sdk(ids.admin),{action:'catalog'}) as AccessCatalog;
  expect(catalog.projects).toHaveLength(1201);
  await expect(executeAccessAction(f.sdk(ids.customerB),{action:'project',id:null,org:ids.orgA,values:{name:'Direct attack'},reason:'Manipulated client role',revision:null,role:'ADMIN'})).rejects.toBeTruthy();
  const forbidden=await executeAccessAction(f.sdk(ids.customerB),{action:'catalog'}) as AccessCatalog;expect(forbidden.projects).toHaveLength(0);
  await expect(executeAccessAction(f.sdk(ids.admin),{action:'exec',command:'anything'})).rejects.toBeTruthy();
 }finally{await f.close();}
});

test('shared Desktop/portal workspace creates projects, custom roles, grants and previews impact',async({page,context})=>{
 const f=await isolatedDatabase();
 const server=await createServer({configFile:false,envFile:false,root:process.cwd(),optimizeDeps:{entries:['tests/access/index.html']},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/.next/**','**/test-results/**','**/desktop/dist/**','**/desktop/src-tauri/target/**']}},plugins:[{
  name:'isolated-access-rpc-fixture',configureServer(vite){vite.middlewares.use('/api/control/access',async(req,res)=>{
   try{
    const user=req.headers.cookie?.match(/(?:^|; )fixture_actor=([^;]+)/)?.[1]??ids.other;
    const chunks:Buffer[]=[];for await(const part of req)chunks.push(Buffer.from(part));
    const data=await executeAccessAction(f.sdk(user),JSON.parse(Buffer.concat(chunks).toString()));
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data}));
   }catch(e){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:e instanceof Error?e.message:(e as {message:string}).message}));}
  });},
 }]});
 try{
  await server.listen();const address=server.httpServer!.address();if(!address||typeof address==='string')throw Error('No isolated listener');const origin=`http://127.0.0.1:${address.port}`;
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const visit=async(user:string)=>{await context.addCookies([{name:'fixture_actor',value:user,url:origin}]);await page.goto(origin+'/tests/access/index.html');};
  await visit(ids.admin);await page.getByRole('button',{name:'+ Lägg till projekt'}).click();
  await page.getByLabel('Projektnamn',{exact:true}).fill('Journey standalone project');
  await page.getByLabel('Ansvarig organisation',{exact:true}).selectOption(ids.orgA);
  await page.getByLabel('Orsak till ändring',{exact:true}).fill('Synthetic standalone project');
  await page.screenshot({path:'test-results/access-project-form.png'});
  await page.getByRole('button',{name:'Spara projekt',exact:true}).click();await expect(page.getByRole('status')).toContainText('revisionsloggad');
  const project=(await f.db.query("select id from public.support_projects where name='Journey standalone project'")).rows[0].id as string;
  await page.getByRole('button',{name:/Journey standalone project/}).click();
  await expect(page.getByRole('heading',{name:'Tilldelade användare'})).toBeVisible();
  await page.getByRole('button',{name:'Redigera / arkivera'}).click();
  await page.getByLabel('Beskrivning',{exact:true}).fill('Manually maintained project information');
  await page.getByLabel('Orsak till ändring',{exact:true}).fill('Synthetic edit');
  await page.getByRole('button',{name:'Spara projekt',exact:true}).click();await expect(page.getByRole('status')).toContainText('revisionsloggad');
  await page.getByRole('button',{name:'Användare och roller',exact:true}).click();
  await page.getByLabel('Rollnamn',{exact:true}).fill('Journey reviewer');
  await page.getByLabel('Rollmallens organisation',{exact:true}).selectOption(ids.orgA);
  await page.getByRole('checkbox',{name:/projects.read/}).check();
  await page.getByRole('checkbox',{name:/repositories.read/}).check();
  await page.getByRole('checkbox',{name:/repositories.review/}).check();
  await page.getByLabel('Orsak till ändring',{exact:true}).first().fill('Synthetic custom role');
  await page.getByRole('button',{name:'Spara roll',exact:true}).click();await expect(page.getByRole('status')).toContainText('revisionsloggad');
  const role=(await f.db.query("select key from public.support_roles where label='Journey reviewer'")).rows[0].key as string;
  await page.getByLabel('Organisation att administrera').selectOption(ids.orgA);
  // Existing account is explicitly registered in the org by fixture setup, not by the UI.
  await f.db.query('update public.profiles set organization_id=$1 where id=$2',[ids.orgA,ids.other]);
  await page.getByRole('button',{name:'Hämta användare',exact:true}).click();
  await page.getByLabel('Användare',{exact:true}).selectOption(ids.other);
  await page.getByLabel('Roll',{exact:true}).selectOption(role);
  await page.getByLabel('Projektbegränsning',{exact:true}).selectOption(project);
  await page.getByLabel('Orsak till ändring',{exact:true}).last().fill('Synthetic developer assignment');
  await page.getByRole('button',{name:'Begär tilldelning',exact:true}).click();await expect(page.getByRole('status')).toContainText('revisionsloggad');
  await page.getByRole('button',{name:/Journey reviewer/}).first().click();
  await page.getByRole('button',{name:'Förhandsgranska berörda användare'}).click();await expect(page.getByText('1 aktiva tilldelningar påverkas:')).toBeVisible();
  await page.screenshot({path:'test-results/access-role-impact.png'});
  await visit(ids.other);await expect(page.getByRole('button',{name:/Journey standalone project/})).toBeVisible();
  await expect(page.getByRole('button',{name:'+ Lägg till projekt'})).toHaveCount(0);
  await page.getByRole('button',{name:/Journey standalone project/}).click();
  await page.getByLabel('Kodförslag / granskningsanteckning',{exact:true}).fill('Synthetic private code suggestion');
  await page.getByLabel('Orsak till ändring',{exact:true}).fill('Synthetic review journey');
  await page.getByRole('button',{name:'Registrera kodförslag i BerryIT'}).click();
  await expect(page.getByText('Synthetic private code suggestion',{exact:true})).toBeVisible();
  await page.evaluate(()=>{localStorage.setItem('role','ADMIN');sessionStorage.setItem('isSuperAdmin','true');});
  const denied=await page.evaluate(async org=>{const r=await fetch('/api/control/access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'project',id:null,org,values:{name:'Forged admin project'},reason:'Direct API attack',revision:null})});return r.status;},ids.orgA);expect(denied).toBe(400);
 }finally{await server.close();await f.close();}
});
