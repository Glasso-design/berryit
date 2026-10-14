import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { assertIsolatedPgliteEnvironment } from './isolated-environment.mjs';

assertIsolatedPgliteEnvironment(process.argv.slice(2), process.env);
const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [a, b, staff, colleague, contact, scoped, inactive, expired] = Array.from({ length: 8 }, (_, n) => id(n + 1));
const [orgA, orgB, convA, convB, internal, otherA, msg, note, foreignMsg, otherMsg, ticketA, ticketB] =
  Array.from({ length: 12 }, (_, n) => id(n + 101));
const publicPath = `conversations/${convA}/public.txt`;
const internalPath = `conversations/${convA}/internal.txt`;
const notePath = `conversations/${convA}/note.txt`;
const foreignPath = `conversations/${convB}/foreign.txt`;
const ticketPath = `tickets/${ticketA}/internal.txt`;

test('forward repair: real PostgreSQL RLS, grants and Storage catalogue in isolated memory', async (t) => {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  t.after(() => db.close());
  const migrations = readdirSync(new URL('../migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort();
  const repair = '20261014190857_security_ci_repair.sql';
  await db.exec(read('./local_bootstrap.sql'));
  for (const file of migrations) {
    if (file === repair) break;
    await db.exec(read(`../migrations/${file}`));
    if (file === migrations[0]) await db.exec(read('./local_storage_bootstrap.sql'));
  }
  // Deliberately contaminated historical rows prove that merely blocking NEW
  // participants is insufficient. These rows are retained by the migration.
  await db.exec(`
    insert into auth.users(id,email) values ${[a,b,staff,colleague,contact,scoped,inactive,expired].map((u, n) => `('${u}','fixture-${n}@example.test')`).join(',')};
    insert into public.organizations(id,name) values ('${orgA}','Synthetic A'),('${orgB}','Synthetic B');
    update public.profiles set organization_id='${orgA}' where id in ('${a}','${colleague}','${contact}','${inactive}','${scoped}');
    update public.profiles set organization_id='${orgB}' where id='${b}';
    update public.profiles set role='technician' where id='${staff}';
    update public.profiles set is_org_admin=true where id='${contact}';
    update public.profiles set is_active=false where id='${inactive}';
    insert into public.support_role_grants(grantee_id,role_key,scope,organization_id,reason,granted_at,expires_at)
      values ('${scoped}','BERRYIT_SUPPORT_TECHNICIAN','organization','${orgA}','Isolated test',now()-interval '1 day',now()+interval '1 day'),
             ('${expired}','BERRYIT_SUPPORT_TECHNICIAN','organization','${orgA}','Expired test',now()-interval '2 days',now()-interval '1 day');
    insert into auth.sessions(id,user_id,aal) select id,id,'aal2' from auth.users;
    insert into public.comm_conversations(id,organization_id,channel_key,is_internal) values
      ('${convA}','${orgA}','chat_customer',false),('${convB}','${orgB}','chat_customer',false),
      ('${internal}','${orgA}','chat_internal',true),('${otherA}','${orgA}','chat_customer',false);
    insert into public.comm_participants(organization_id,conversation_id,profile_id) values
      ('${orgA}','${convA}','${a}'),('${orgA}','${convA}','${b}'),
      ('${orgA}','${convA}','${inactive}'),('${orgA}','${internal}','${a}');
    insert into public.comm_participants(organization_id,conversation_id,profile_id,participant_role)
      values ('${orgA}','${convA}','${scoped}','staff');
    insert into public.comm_messages(id,organization_id,conversation_id,author_id,direction,body_text) values
      ('${msg}','${orgA}','${convA}','${staff}','outbound','Public reply'),
      ('${note}','${orgA}','${convA}','${staff}','internal','Internal note'),
      ('${foreignMsg}','${orgB}','${convB}','${staff}','outbound','Foreign message'),
      ('${otherMsg}','${orgA}','${otherA}','${staff}','outbound','Other conversation');
    insert into public.comm_attachments(organization_id,conversation_id,message_id,storage_path,file_name,mime_type,size_bytes,visibility) values
      ('${orgA}','${convA}','${msg}','${publicPath}','public.txt','text/plain',1,'customer'),
      ('${orgA}','${convA}','${note}','${internalPath}','internal.txt','text/plain',1,'internal'),
      ('${orgA}','${convA}','${note}','${notePath}','note.txt','text/plain',1,'customer'),
      ('${orgA}','${internal}',null,'conversations/${internal}/private.txt','private.txt','text/plain',1,'customer'),
      ('${orgB}','${convB}','${foreignMsg}','${foreignPath}','foreign.txt','text/plain',1,'customer'),
      ('${orgA}','${convA}','${otherMsg}','conversations/${convA}/wrong-message.txt','wrong.txt','text/plain',1,'customer'),
      ('${orgA}','${convA}',null,'conversations/${convB}/wrong-path.txt','wrong.txt','text/plain',1,'customer');
    insert into public.tickets(id,organization_id,requester_id,subject,description,category_key) values
      ('${ticketA}','${orgA}','${a}','Synthetic A','Isolated fixture','ovrigt'),
      ('${ticketB}','${orgB}','${b}','Synthetic B','Isolated fixture','ovrigt');
    insert into public.ticket_attachments(ticket_id,storage_path,file_name,mime_type,size_bytes,visibility)
      values ('${ticketA}','${ticketPath}','internal.txt','text/plain',1,'internal');
    insert into storage.objects(bucket_id,name) values
      ('ticket-attachments','${publicPath}'),('ticket-attachments','${internalPath}'),
      ('ticket-attachments','${notePath}'),('ticket-attachments','${foreignPath}'),
      ('ticket-attachments','conversations/${internal}/private.txt'),
      ('ticket-attachments','conversations/${convA}/orphan.txt'),('ticket-attachments','${ticketPath}');
    -- Simulate permissive platform policies. The new restrictive constraints
    -- must contain these without altering another bucket's intended access.
    grant select on storage.objects to anon;
    grant update on storage.objects to authenticated;
    create policy synthetic_permissive_authenticated on storage.objects for all to authenticated using (true) with check (true);
    create policy synthetic_permissive_anon on storage.objects for select to anon using (true);
    insert into storage.buckets(id,name,public) values ('unrelated','unrelated',true);
    insert into storage.objects(bucket_id,name) values ('unrelated','public.txt');
  `);
  const before = await db.query('select count(*)::int n from public.comm_participants');
  await db.exec(read(`../migrations/${repair}`));
  assert.deepEqual(await db.query('select count(*)::int n from public.comm_participants'), before);

  async function as(user, sql, params = [], { role = 'authenticated', aal = 'aal2' } = {}) {
    await db.exec('begin');
    try {
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role, aal, session_id: user })]);
      await db.exec(`set local role ${role}`);
      const result = await db.query(sql, params);
      await db.exec('commit');
      return result.rows;
    } catch (error) {
      await db.exec('rollback');
      throw error;
    }
  }
  const count = async (user, table, clause = '', params = [], options) =>
    (await as(user, `select count(*)::int n from ${table} ${clause}`, params, options))[0].n;
  const denied = (promise) => assert.rejects(promise, (error) => error.code === '42501');
  const check = async (name, fn) => t.test(name, fn);
  const insertParticipant = (user, target, conv = convA, org = orgA) => as(user,
    'insert into public.comm_participants(organization_id,conversation_id,profile_id) values ($1,$2,$3)', [org,conv,target]);
  const send = (user, conv, org, direction = 'outbound') => as(user,
    "insert into public.comm_messages(organization_id,conversation_id,author_id,direction,body_text,delivery_status) values ($1,$2,$3,$4,'Synthetic','queued') returning id", [org,conv,user,direction]);
  const attach = (user, path, message = null, visibility = 'customer') => as(user,
    "insert into public.comm_attachments(organization_id,conversation_id,message_id,uploaded_by,storage_path,file_name,mime_type,size_bytes,visibility) values ($1,$2,$3,$4,$5,'x','text/plain',1,$6)", [orgA,convA,message,user,path,visibility]);

  await check('customer reads public reply but never internal direction in own conversation', async () => {
    assert.equal(await count(a,'public.comm_messages'),1);
    assert.equal(await count(a,'public.comm_messages','where id=$1',[note]),0);
  });
  await check('organisation contact cannot read internal direction or internal chat', async () => {
    assert.equal(await count(contact,'public.comm_messages',"where direction='internal'"),0);
    assert.equal(await count(contact,'public.comm_conversations','where id=$1',[internal]),0);
  });
  await check('pre-existing foreign membership cannot authorize read or write', async () => {
    assert.equal(await count(b,'public.comm_conversations','where id=$1',[convA]),0);
    assert.equal(await count(b,'public.comm_messages','where conversation_id=$1',[convA]),0);
    await denied(send(b,convA,orgA));
  });
  await check('pre-existing inactive and internal-chat memberships do not authorize', async () => {
    assert.equal(await count(inactive,'public.comm_conversations'),0);
    assert.equal(await count(a,'public.comm_conversations','where id=$1',[internal]),0);
    await denied(send(a,internal,orgA));
  });
  await check('customer cannot insert foreign, same-org or spoofed staff participants', async () => {
    await denied(insertParticipant(a,b));
    await denied(insertParticipant(a,colleague));
    await denied(as(a,"insert into public.comm_participants(organization_id,conversation_id,profile_id,participant_role) values ($1,$2,$3,'staff')",[orgA,convA,expired]));
  });
  await check('staff can add valid same-organisation customer, not foreign customer', async () => {
    await insertParticipant(staff,colleague);
    await denied(insertParticipant(staff,b,otherA));
  });
  await check('staff cannot label foreign customer as staff or expired grantee as staff', async () => {
    for (const target of [b,expired]) await denied(as(staff,"insert into public.comm_participants(organization_id,conversation_id,profile_id,participant_role) values ($1,$2,$3,'staff')",[orgA,otherA,target]));
  });
  await check('own read marker works, identity/conversation/role edits fail', async () => {
    assert.equal((await as(a,'update public.comm_participants set last_read_at=now() where profile_id=$1 returning id',[a])).length,1);
    for (const field of ["conversation_id='"+otherA+"'", "profile_id='"+b+"'", "participant_role='staff'"]) {
      await denied(as(a,`update public.comm_participants set ${field} where profile_id=$1`,[a]));
    }
    assert.equal((await as(b,'update public.comm_participants set last_read_at=now() where conversation_id=$1 returning id',[convA])).length,0);
  });
  await check('customer may reply publicly, cannot create internal note or spoof org', async () => {
    assert.equal((await send(a,convA,orgA)).length,1);
    await denied(send(a,convA,orgA,'internal'));
    await denied(send(a,convB,orgB));
    await assert.rejects(send(a,convA,orgB), (error) => ['42501','23503'].includes(error.code));
  });
  await check('staff/scoped access stays scoped; documented ticket-work MFA exemption is preserved', async () => {
    assert.equal(await count(staff,'public.comm_messages','where id=$1',[note]),1);
    assert.equal(await count(scoped,'public.comm_messages','where id=$1',[note]),1);
    assert.equal(await count(scoped,'public.comm_messages','where id=$1',[foreignMsg]),0);
    assert.equal(await count(scoped,'public.comm_messages','where id=$1',[note],{aal:'aal1'}),1);
  });
  await check('anonymous cannot execute helper or rank wrapper, even with manipulated UUID', async () => {
    for (const fn of ['active_support_grants','max_support_rank']) await denied(as(null,`select * from public.${fn}($1)`,[scoped],{role:'anon'}));
  });
  await check('authenticated helper is self-only; other-user and NULL UUID yield no grants', async () => {
    assert.equal((await as(scoped,'select * from public.active_support_grants($1)',[scoped])).length,1);
    assert.equal((await as(a,'select * from public.active_support_grants($1)',[scoped])).length,0);
    assert.equal((await as(a,'select * from public.active_support_grants(null)')).length,0);
    assert.equal((await as(a,'select public.max_support_rank($1) n',[scoped]))[0].n,0);
    assert.equal((await as(scoped,'select * from public.active_support_grants($1)',[expired])).length,0);
    assert.equal((await as(expired,'select * from public.active_support_grants($1)',[expired])).length,0);
  });
  await check('helper cannot use no-claims SET ROLE as direct maintenance SQL', async () => {
    await db.exec('begin; set local role authenticated');
    const rows = await db.query('select * from public.active_support_grants($1)',[scoped]);
    await db.exec('rollback');
    assert.equal(rows.rows.length,0);
  });
  await check('trusted service role retains explicit maintenance access', async () => {
    assert.equal((await as(null,'select * from public.active_support_grants($1)',[scoped],{role:'service_role'})).length,1);
  });
  await check('SECURITY DEFINER/search_path and EXECUTE ACL are locked', async () => {
    const row = (await db.query("select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') signed from pg_proc where oid='public.active_support_grants(uuid)'::regprocedure")).rows[0];
    assert.equal(row.prosecdef,true);
    assert.ok(row.proconfig.some((v) => v === 'search_path=""'));
    assert.equal(row.anon,false);
    assert.equal(row.signed,true);
  });
  await check('attachment metadata hides internal, internal-message aliases and mismatched IDs', async () => {
    assert.equal(await count(a,'public.comm_attachments'),1);
    assert.equal(await count(b,'public.comm_attachments','where conversation_id=$1',[convA]),0);
    await denied(attach(a,`conversations/${convA}/attack.txt`,note));
    await denied(attach(a,`conversations/${convA}/other.txt`,otherMsg));
    await denied(attach(a,`conversations/${convB}/attack.txt`));
    await denied(attach(a,`conversations/${convA}/internal-upload.txt`,null,'internal'));
    await denied(attach(a,`conversations/${convA}/orphan.txt`));
    assert.equal((await as(a,'select public.comm_attachment_matches($1,$2,$3) ok',[notePath,convA,note]))[0].ok,false);
    assert.equal((await as(a,'select public.comm_attachment_matches($1,$2,$3) ok',[foreignPath,convB,foreignMsg]))[0].ok,false);
  });
  await check('private Storage reads cannot bypass metadata RLS with a known object path', async () => {
    assert.equal(await count(a,'storage.objects',"where bucket_id='ticket-attachments'"),1);
    for (const path of [internalPath,notePath,foreignPath,ticketPath,`conversations/${internal}/private.txt`,`conversations/${convA}/orphan.txt`]) {
      assert.equal(await count(a,'storage.objects','where name=$1',[path]),0);
    }
    assert.equal(await count(b,'storage.objects','where name=$1',[publicPath]),0);
    assert.equal(await count(scoped,'storage.objects','where name=$1',[internalPath]),1);
    assert.equal(await count(scoped,'storage.objects','where name=$1',[ticketPath]),1);
    assert.equal(await count(scoped,'storage.objects','where name=$1',[foreignPath]),0);
  });
  await check('Storage conversation upload requires owned visible metadata; ticket flow retained', async () => {
    const insertObject = (user,path) => as(user,"insert into storage.objects(bucket_id,name) values ('ticket-attachments',$1)",[path]);
    await denied(insertObject(a,`conversations/${convB}/new.txt`));
    await denied(insertObject(a,`conversations/${convA}/unregistered.txt`));
    const path = `conversations/${convA}/new.txt`;
    await attach(a,path,msg);
    await insertObject(a,path);
    await denied(insertObject(b,path+'.foreign'));
    await insertObject(a,`tickets/${ticketA}/new.txt`);
    await denied(insertObject(a,`tickets/${ticketB}/new.txt`));
    await denied(insertObject(a,'tickets/not-a-uuid/new.txt'));
  });
  await check('customer cannot delete private objects', async () => {
    assert.equal((await as(a,'delete from storage.objects where name=$1 returning id',[publicPath])).length,0);
  });
  await check('restrictive Storage rules prevent overwrites and anonymous reads despite permissive policies', async () => {
    assert.equal((await as(a,'update storage.objects set name=$1 where name=$2 returning id',[`conversations/${convA}/overwritten.txt`,publicPath])).length,0);
    assert.equal(await count(null,'storage.objects',"where bucket_id='ticket-attachments'",[],{role:'anon'}),0);
    assert.equal(await count(null,'storage.objects',"where bucket_id='unrelated'",[],{role:'anon'}),1);
    assert.equal(await count(a,'storage.objects',"where bucket_id='unrelated'"),1);
  });
  await check('revoked external grant cannot fall back through staff membership, even in own organisation', async () => {
    await db.exec(`update public.support_role_grants set revoked_at=now(),revoke_reason='Synthetic revoke' where grantee_id='${scoped}'`);
    assert.equal(await count(scoped,'public.comm_conversations'),0);
    assert.equal(await count(scoped,'storage.objects',"where bucket_id='ticket-attachments'"),0);
    await denied(send(scoped,convA,orgA,'internal'));
    await denied(send(scoped,convA,orgA,'outbound'));
    assert.equal((await as(scoped,'select * from public.active_support_grants($1)',[scoped])).length,0);
    assert.ok((await db.query("select count(*)::int n from public.support_admin_audit where action like '%revoke%'")).rows[0].n > 0);
  });
});
