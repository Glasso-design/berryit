import { test, expect } from '@playwright/test';
import { createServer } from '../../desktop/node_modules/vite/dist/node/index.js';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { createServer as reserveServer } from 'node:net';
import { isolatedDatabase, ids } from './database';
import { executeSupportAction } from '../../shared/support-actions';

test('SQL + shared client: isolation, registration, MFA, grants, audit and attachment attacks',async()=>{
  const f=await isolatedDatabase();
  try{
    const admin=f.client(ids.admin),ext=f.client(ids.external),customer=f.client(ids.private);
    const functions=['can_register_support_customer()','support_registration_context(uuid)','create_support_organization(text,text)','support_ticket_technicians(uuid)','support_ticket_people(uuid)','reopen_support_ticket(uuid,text)','complete_support_attachment(uuid)','audit_support_attachment_access(uuid)'];
    for(const name of functions){const acl=(await f.db.query("select has_function_privilege('anon',$1,'EXECUTE') anonymous,has_function_privilege('authenticated',$1,'EXECUTE') authenticated",['public.'+name])).rows[0];expect(acl).toEqual({anonymous:false,authenticated:true});}
    expect((await f.db.query("select has_function_privilege('authenticated','berryit_private.registration_admin(uuid,uuid)','EXECUTE') allowed")).rows[0].allowed).toBe(false);
    expect((await f.db.query("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','berryit_private') and p.prosecdef and not coalesce(p.proconfig @> ARRAY['search_path=\"\"']::text[],false)")).rows[0].n).toBe(0);
    const ticket=await admin.create({customerId:ids.private,subject:'Private support',description:'Synthetic troubleshooting task',category_key:'ovrigt'});
    const orgTicket=await admin.create({customerId:ids.customerA,subject:'Company support',description:'Synthetic company support task',category_key:'ovrigt'});
    await expect(f.client(ids.other).detail(ticket)).rejects.toThrow();
    await expect(ext.detail(ticket)).rejects.toThrow();
    await expect(f.client(ids.customerB).detail(orgTicket)).rejects.toThrow();
    // Existing policy permits ordinary ticket work at aal1; registry admin
    // actions below must still require live aal2.
    await expect(f.client(ids.tech,'aal1').note(orgTicket,'Ordinary ticket work')).resolves.toBeUndefined();
    await expect(customer.update(ticket,{assignee_id:ids.tech})).rejects.toThrow();
    await expect(admin.update(ticket,{assignee_id:ids.external})).rejects.toThrow();
    await expect(admin.update(orgTicket,{assignee_id:ids.expired})).rejects.toThrow();
    await expect(f.as(ids.external,"insert into public.tickets(requester_id,organization_id,subject,description,category_key,source) values($1,$2,'Staff spoof','Synthetic forged staff requester','ovrigt','api')",[ids.tech,ids.orgA])).rejects.toThrow();
    await admin.update(orgTicket,{assignee_id:ids.external});
    expect((await ext.detail(orgTicket)).canWork).toBe(true);
    await ext.note(orgTicket,'Scoped troubleshooting');
    await f.db.query("update public.support_role_grants set revoked_at=now(),revoked_by=$2,revoke_reason='Synthetic revocation' where grantee_id=$1",[ids.external,ids.admin]);
    await expect(ext.note(orgTicket,'Revoked write')).rejects.toThrow();
    await expect(ext.update(orgTicket,{status_key:'lost'})).rejects.toThrow();
    await expect(ext.detail(orgTicket)).rejects.toThrow();
    await expect(admin.update(orgTicket,{assignee_id:ids.external})).resolves.toBeUndefined(); // Unchanged historical assignee is retained.
    await admin.update(orgTicket,{assignee_id:null});
    await expect(admin.update(orgTicket,{assignee_id:ids.external})).rejects.toThrow();
    await expect(f.as(ids.admin,'insert into public.tickets(requester_id,organization_id,subject,description,category_key) values($1,$2,$3,$4,$5)',[ids.private,ids.orgA,'Forged organisation','Synthetic forged identifier','ovrigt'])).rejects.toThrow();
    await expect(f.as(ids.admin,'update public.tickets set requester_id=$1 where id=$2',[ids.other,ticket])).rejects.toThrow();
    await expect(f.as(ids.external,"insert into public.tickets(requester_id,organization_id,subject,description,category_key,source) values($1,$2,'API spoof','Synthetic forged API requester','ovrigt','api')",[ids.private,ids.orgA])).rejects.toThrow();
    await admin.update(ticket,{assignee_id:ids.tech});
    await admin.message(ticket,'Customer-visible answer',true);await admin.note(ticket,'INTERNAL-SECRET');
    await admin.upload(ticket,new File(['public'],'public.txt',{type:'text/plain'}),'customer');
    await admin.upload(ticket,new File(['secret'],'internal.txt',{type:'text/plain'}),'internal');
    const staffDetail=await admin.detail(ticket);const publicDetail=await customer.detail(ticket);
    expect(staffDetail.notes).toHaveLength(1);expect(publicDetail.notes).toHaveLength(0);
    expect(publicDetail.attachments.map(a=>a.file_name)).toEqual(['public.txt']);
    expect(JSON.stringify(publicDetail)).not.toContain('INTERNAL-SECRET');
    expect(JSON.stringify(publicDetail.events)).not.toContain('internal.txt');
    const secret=staffDetail.attachments.find(a=>a.visibility==='internal')!;
    await expect(customer.download(secret.id)).rejects.toThrow();
    const visible=publicDetail.attachments[0];expect(await customer.download(visible.id)).toContain('__synthetic_download');
    expect((await f.db.query("select 1 from public.support_admin_audit where action='attachment_download_requested' and actor_id=$1",[ids.private])).rows).toHaveLength(1);
    const attach=(path:string,message:string|null=null)=>f.as(ids.private,"insert into public.ticket_attachments(ticket_id,uploaded_by,storage_path,file_name,mime_type,size_bytes,visibility,message_id,upload_completed_at) values($1,$2,$3,'attack.txt','text/plain',1,'customer',$4,now()) returning id,upload_completed_at",[ticket,ids.private,path,message]);
    await expect(attach(`tickets/${orgTicket}/${randomUUID()}`)).rejects.toThrow();
    const foreignMessage=(await f.db.query('select id from public.ticket_messages where ticket_id=$1 limit 1',[ticket])).rows[0].id;
    await expect(f.as(ids.admin,"insert into public.ticket_attachments(ticket_id,uploaded_by,storage_path,file_name,mime_type,size_bytes,message_id) values($1,$2,$3,'attack','text/plain',1,$4)",[orgTicket,ids.admin,`tickets/${orgTicket}/${randomUUID()}`,foreignMessage])).rejects.toThrow();
    const pending=(await attach(`tickets/${ticket}/${randomUUID()}`))[0];expect(pending.upload_completed_at).toBeNull();
    await expect(customer.download(pending.id as string)).rejects.toThrow();
    await expect(f.as(ids.private,'select public.complete_support_attachment($1)',[pending.id])).rejects.toThrow();
    await expect(f.as(ids.private,"insert into storage.objects(bucket_id,name) values('ticket-attachments',$1)",[`tickets/${ticket}/${randomUUID()}`])).rejects.toThrow();
    await expect(f.as(ids.private,'update public.ticket_internal_notes set body=$1 where ticket_id=$2',['attack',ticket])).rejects.toThrow();
    // Historical malformed rows must be contained by SELECT and definer RPCs.
    // Disable ONLY the new trigger in this fresh synthetic memory fixture.
    await f.db.exec('alter table public.ticket_attachments disable trigger ticket_attachments_workflow');
    const alias=(await f.db.query("insert into public.ticket_attachments(ticket_id,uploaded_by,storage_path,file_name,mime_type,size_bytes,visibility,upload_completed_at) values($1,$2,$3,'legacy-alias','text/plain',1,'customer',now()) returning id",[ticket,ids.private,`tickets/${orgTicket}/${randomUUID()}`])).rows[0].id;
    await f.db.exec('alter table public.ticket_attachments enable trigger ticket_attachments_workflow');
    expect(await f.as(ids.private,'select id from public.ticket_attachments where id=$1',[alias])).toHaveLength(0);
    await expect(f.as(ids.private,'select public.audit_support_attachment_access($1)',[alias])).rejects.toThrow();
    await expect(f.as(ids.private,'select public.complete_support_attachment($1)',[alias])).rejects.toThrow();
    await admin.update(ticket,{status_key:'lost'});await admin.update(ticket,{status_key:'stangt'});
    await expect(admin.update(ticket,{status_key:'pagar'})).rejects.toThrow();
    await expect(customer.reopen(ticket,'Customer attack')).rejects.toThrow();
    await admin.reopen(ticket,'Problem returned');
    const history=(await admin.detail(ticket)).events.filter(e=>e.payload.reopened);
    expect(history).toHaveLength(1);expect(history[0].payload.reason).toBe('Problem returned');expect(history[0].actor_id).toBe(ids.admin);
    expect((await admin.detail(ticket)).ticket.closed_at).toBeNull();
    await f.db.query("insert into public.ticket_events(ticket_id,actor_id,event_type,created_at) select $1,$2,'created','2026-10-01T10:00:00Z' from generate_series(1,405)",[ticket,ids.admin]);
    const paged=(await customer.detail(ticket)).events;expect(new Set(paged.map(e=>e.id)).size).toBe(paged.length);expect(paged.length).toBeGreaterThan(405);
    // Completion is idempotent: retrying cannot append duplicate upload events.
    const before=(await admin.detail(ticket)).events.length;
    await f.as(ids.admin,'select public.complete_support_attachment($1)',[visible.id]);
    expect((await admin.detail(ticket)).events.length).toBe(before);
    const input={full_name:'Synthetic registered',email:'registered@example.test',phone:'',organization_id:null};
    await expect(customer.register(input)).rejects.toThrow();expect(f.created).toHaveLength(0);
    await expect(f.client(ids.admin,'aal1').register(input)).rejects.toThrow();expect(f.created).toHaveLength(0);
    await admin.register(input);expect(f.created).toHaveLength(1);
    expect(f.created[0]).toMatchObject({email_confirm:false,ban_duration:'876000h'});
    expect(f.created[0].password!.length).toBeGreaterThan(64);
    await expect(f.client(ids.admin).organization('Synthetic new company','TEST-ONLY')).resolves.toBeUndefined();
    const registered=(await f.db.query('select * from public.profiles where email=$1',[input.email])).rows[0];
    expect(registered.organization_id).toBeNull();expect(registered.login_activation_pending).toBe(true);expect(registered.registered_by).toBe(ids.admin);
    const orgCount=(await f.db.query('select count(*)::int n from public.organizations')).rows[0].n;expect(orgCount).toBe(3);
    await admin.create({customerId:registered.id as string,subject:'Pending login support',description:'Manual customer before login activation',category_key:'ovrigt'});
    const context=await f.sdk(ids.admin).rpc('support_registration_context',{p_organization_id:ids.orgA});
    await f.db.query('delete from auth.sessions where id=$1',[ids.admin]); // Only this isolated in-memory fixture.
    const failed=await f.createUser({email:'stale@example.test',app_metadata:{berryit_manual_customer:context.data}});
    expect(failed.error).toBeTruthy();expect((await f.db.query("select id from auth.users where email='stale@example.test'")).rows).toHaveLength(0);
    const normal=randomUUID();await f.db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[normal,'spoof@example.test',JSON.stringify({role:'admin',organization_id:ids.orgA,berryit_manual_customer:context.data})]);
    const spoof=(await f.db.query('select role,organization_id from public.profiles where id=$1',[normal])).rows[0];expect(spoof).toEqual({role:'customer',organization_id:null});
    await expect(f.as(ids.other,'select public.support_registration_context(null)',[],'aal2','anon')).rejects.toThrow();
  }finally{await f.close();}
});

test('forward migration retains existing customers, tickets and objects; contains historical aliases',async()=>{
  const person=randomUUID(),ticket=randomUUID(),attachment=randomUUID(),bad=randomUUID();
  const f=await isolatedDatabase(async db=>{
    await db.query('insert into auth.users(id,email) values($1,$2)',[person,'existing@example.test']);
    await db.query("insert into public.tickets(id,requester_id,subject,description,category_key,status_key) values($1,$2,'Existing private ticket','Existing synthetic data','ovrigt','stangt')",[ticket,person]);
    await db.query("insert into public.ticket_attachments(id,ticket_id,uploaded_by,storage_path,file_name,mime_type,size_bytes,visibility) values($1,$2,$3,$4,'existing.txt','text/plain',1,'customer'),($5,$2,$3,'tickets/incorrect/alias','alias','text/plain',1,'customer')",[attachment,ticket,person,`tickets/${ticket}/existing`,bad]);
    await db.query("insert into storage.objects(bucket_id,name) values('ticket-attachments',$1)",[`tickets/${ticket}/existing`]);
  });
  try{
    const p=(await f.db.query('select organization_id,login_activation_pending from public.profiles where id=$1',[person])).rows[0];expect(p).toEqual({organization_id:null,login_activation_pending:false});
    expect((await f.db.query('select status_key,reopen_reason from public.tickets where id=$1',[ticket])).rows[0]).toEqual({status_key:'stangt',reopen_reason:null});
    expect((await f.db.query('select id from public.ticket_attachments where ticket_id=$1',[ticket])).rows).toHaveLength(2);
    expect((await f.db.query('select name from storage.objects')).rows).toHaveLength(1);
    expect((await f.db.query('select upload_completed_at from public.ticket_attachments where id=$1',[attachment])).rows[0].upload_completed_at).toBeTruthy();
    expect((await f.as(ids.admin,'select id from public.ticket_attachments where ticket_id=$1',[ticket])).map(r=>r.id)).toEqual([attachment]);
    await f.client(ids.admin).reopen(ticket,'Follow-up after migration');expect((await f.client(ids.admin).detail(ticket)).ticket.status_key).toBe('pagar');
  }finally{await f.close();}
});

test('browser journey: shared Desktop/portal UI through API dispatcher and real isolated RLS',async({page,context})=>{
  const f=await isolatedDatabase();
  const reservation=reserveServer();await new Promise<void>(resolve=>reservation.listen(0,'127.0.0.1',resolve));const reserved=reservation.address();if(!reserved||typeof reserved==='string')throw new Error('No test port');const port=reserved.port;await new Promise<void>((resolve,reject)=>reservation.close(error=>error?reject(error):resolve()));
  const server=await createServer({configFile:false,root:process.cwd(),envFile:false,server:{host:'127.0.0.1',port,strictPort:true,watch:{ignored:['**/.next/**','**/test-results/**','**/desktop/dist/**','**/desktop/src-tauri/target/**']}},optimizeDeps:{entries:['tests/support/index.html']},resolve:{dedupe:['react','react-dom']},plugins:[{
    name:'isolated-workflow-transport',configureServer(server){server.middlewares.use(async(req,res,next)=>{
      if(!req.url?.startsWith('/__test/support')&&!req.url?.startsWith('/api/control/customers'))return next();
      try{
        const actor=req.headers.cookie?.match(/fixture_actor=([^;]+)/)?.[1];if(!actor||!(await f.db.query('select id from auth.sessions where user_id=$1',[actor])).rows.length)throw new Error('Missing isolated fixture identity');
        const chunks=[];for await(const chunk of Readable.from(req))chunks.push(Buffer.from(chunk));
        const request=new Request('http://127.0.0.1'+req.url,{method:'POST',headers:req.headers as HeadersInit,body:Buffer.concat(chunks)});
        let data;
        if(req.url.startsWith('/api/control/customers')){await f.client(actor).register(await request.json());data=null;}
        else if(request.headers.get('content-type')?.startsWith('multipart/')){const form=await request.formData();data=await executeSupportAction(f.client(actor),{action:form.get('action'),args:JSON.parse(String(form.get('args')))},form.get('file') as File);}
        else data=await executeSupportAction(f.client(actor),await request.json());
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:data??null}));
      }catch(error){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:(error as Error).message}));}
    });},
  }]});
  try{
    await server.listen();const address=server.httpServer!.address();if(!address||typeof address==='string')throw new Error('No isolated port');const origin=`http://127.0.0.1:${address.port}`;
    await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    const visit=async(actor:string,view='support')=>{await context.addCookies([{name:'fixture_actor',value:actor,url:origin}]);await page.goto(origin+`/tests/support/index.html?user=${actor}&view=${view}`);};
    await visit(ids.admin,'customers');
    await page.getByLabel('Kundens namn',{exact:true}).fill('Journey private customer');await page.getByLabel('Kundens e-post').fill('journey@example.test');
    await page.getByRole('button',{name:'Registrera kund utan aktiverad inloggning'}).click();
    await expect(page.getByRole('status')).toContainText('Inloggning är spärrad');
    const registered=(await f.db.query("select id from public.profiles where email='journey@example.test'")).rows[0].id as string;
    await visit(ids.admin);
    await page.getByLabel('Välj kund',{exact:true}).selectOption(registered);await page.getByLabel('Ämne',{exact:true}).fill('Journey support');await page.getByLabel('Beskrivning',{exact:true}).fill('Synthetic complete troubleshooting journey');
    await page.getByRole('button',{name:'Skapa ärende',exact:true}).click();await expect(page.getByRole('article',{name:'Ärendedetaljer'})).toBeVisible();
    await page.getByLabel('Tilldela tekniker',{exact:true}).selectOption(ids.tech);await expect(page.getByRole('status')).toContainText('Tilldelningen');
    await page.getByLabel('Nytt kundmeddelande').fill('Journey public reply');await page.getByRole('button',{name:'Skicka kundmeddelande'}).click();await expect(page.getByRole('status')).toContainText('Kundmeddelandet');
    await page.getByLabel('Felsökning och utförd åtgärd').fill('Journey INTERNAL secret');await page.getByRole('button',{name:'Spara intern anteckning'}).click();await expect(page.getByRole('status')).toContainText('Intern arbetsanteckning');
    for(const visibility of ['customer','internal']){await page.getByLabel('Välj bilaga (högst 25 MB)').setInputFiles({name:visibility+'.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic '+visibility)});await page.getByLabel('Bilagans synlighet').selectOption(visibility);await page.getByRole('button',{name:'Ladda upp bilaga',exact:true}).click();await expect(page.getByRole('status')).toContainText('Bilagan är uppladdad');}
    await page.getByRole('button',{name:'Markera som löst'}).click();await expect(page.getByRole('button',{name:'Avsluta ärende'})).toBeVisible();await page.getByRole('button',{name:'Avsluta ärende'}).click();await expect(page.getByRole('status')).toContainText('avslutat');
    await page.getByLabel('Orsak till återöppning').fill('Journey issue recurred');await page.getByRole('button',{name:'Återöppna ärende',exact:true}).click();await expect(page.getByLabel('Ärendehistorik')).toContainText('Journey issue recurred');
    const ticket=(await f.db.query('select id,reference from public.tickets where requester_id=$1',[registered])).rows[0];
    await page.getByRole('button',{name:ticket.reference as string,exact:true}).click();await expect(page.getByRole('article',{name:'Ärendedetaljer'})).toBeVisible(); // Selecting current row must reload.
    // Simulate separately authorised activation in this synthetic fixture only.
    // Real GoTrue ban enforcement is outside this transport's test contract.
    await f.db.query('insert into auth.sessions(id,user_id,aal) values($1,$1,$2)',[registered,'aal1']);
    await f.db.query('update public.profiles set login_activation_pending=false where id=$1',[registered]);
    await visit(registered);await page.getByRole('button',{name:ticket.reference as string,exact:true}).click();
    await expect(page.getByText('Journey public reply',{exact:true})).toBeVisible();await expect(page.getByText('Journey INTERNAL secret',{exact:true})).toHaveCount(0);await expect(page.getByLabel('Interna arbetsanteckningar')).toHaveCount(0);
    await expect(page.getByLabel('Ärendebilagor')).toContainText('customer.txt');await expect(page.getByLabel('Ärendebilagor')).not.toContainText('internal.txt');
    await page.getByLabel('Nytt kundmeddelande').fill('Journey customer response');await page.getByRole('button',{name:'Skicka kundmeddelande'}).click();await expect(page.getByText('Journey customer response',{exact:true})).toBeVisible();
    await visit(ids.other);await expect(page.getByText('Inga ärenden att visa.')).toBeVisible();
    const denied=await page.evaluate(async id=>{const res=await fetch('/__test/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'detail',args:{id}})});return res.status;},ticket.id as string);expect(denied).toBe(400);
  }finally{await page.close();await server.close();await f.close();}
});
