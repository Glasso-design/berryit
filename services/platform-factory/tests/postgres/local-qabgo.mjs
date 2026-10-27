import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { FactoryError } from '../../contract.mjs';

/** Actual QABGO PostgreSQL + HTTP runtime, inside the brand-new local cluster.
 * Cloud resources remain MOCK. No .env or pilot seeds are read. */
export function localQabgoSteps(cluster,source,{storageRoutes=null}={}) {
 const running=new Map();
 const steps={
  database:async({job})=>{const s=await cluster.createSpace(job.instance_id,job.id);return {mode:'LOCAL',database:s.database,dedicated:true,credentialsExposed:false};},
  migrations:async({job})=>{
   const s=cluster.spaces.get(job.instance_id);if(!s)throw Error('New isolated database not recorded');
   const ran=await source.migrations.migrate(cluster.url(s.owner));
   const c=await cluster.client(s.owner);try {
    const origin=(await c.query('select * from public.factory_origin')).rows[0];if(origin.instance_id!==job.instance_id||origin.job_id!==job.id)throw Error('Wrong database owner');
    const rows=(await c.query('select count(*)::int n from drive.tenants union all select count(*)::int from drive.users union all select count(*)::int from drive.bookings union all select count(*)::int from drive.vehicles')).rows;
    if(rows.some(r=>r.n!==0))throw new FactoryError('TEMPLATE_NOT_EMPTY','Ny databas innehåller oväntad kund-/verksamhetsdata.');
    return {mode:'LOCAL',applied:ran.length,migrations:source.template.migrations.length,emptyCustomerData:true,immutableChecksums:true};
   } finally {await c.end();}
  },
  identity:async({job})=>{
   const s=cluster.spaces.get(job.instance_id),c=await cluster.client(s.owner);
   const email='owner-'+job.instance_id+'@factory.example.test';
   try {await c.query('begin');await c.query("select set_config('drive.platform','on',true)");
    await c.query("insert into drive.tenants(id,name,package,market,booking_config) values($1,$2,'white-label',$3,'{}')",[s.tenant,job.input.customerName,JSON.stringify({currency:'SEK',locale:'sv-SE',timezone:'Europe/Stockholm'})]);
    await c.query("insert into drive.apps(id,kind,tenant_id,name) values($1,'white_label',$2,$3)",['factory-isolated-customer',s.tenant,job.input.name]);
    // A product identity, not another ONARLY account. Disabled, no password,
    // no mail sent. Its activation is an explicit synthetic TEST operation.
    const user=(await c.query("insert into drive.users(email,email_normalized,display_name,status,password_hash) values($1,$1,'Synthetic product owner','disabled',null) returning id",[email])).rows[0];
    await c.query("insert into drive.memberships(tenant_id,user_id,role) values($1,$2,'owner')",[s.tenant,user.id]);
    await c.query('create table public.factory_identity_link(onarly_profile_id uuid not null,product_user_id uuid not null unique)');
    await c.query('insert into public.factory_identity_link values($1,$2)',[job.input.ownerId,user.id]);await c.query('commit');
    s.productUserId=user.id;s.email=email;await cluster.persist();
    return {mode:'LOCAL',trustedOwnerReference:job.input.ownerId,productUserId:user.id,activationPending:true,createdOnarlyAccount:false,mailSent:false};
   } catch(e){await c.query('rollback');throw e;}finally{await c.end();}
  },
  runtime:async({job})=>{
   const s=cluster.spaces.get(job.instance_id);if(running.has(job.instance_id))return running.get(job.instance_id).evidence;
   const config=source.config.loadConfig({DRIVE_ENVIRONMENT:'test',DRIVE_DATABASE_URL:cluster.url(s.app),DRIVE_MIGRATION_DATABASE_URL:cluster.url(s.owner),DRIVE_HOST:'127.0.0.1',DRIVE_PORT:'0',DRIVE_HASH_KEY:s.hashKey,DRIVE_DATA_KEY:s.dataKey,DRIVE_DB_POOL_MAX:'3',DRIVE_PASSWORD_HASH_COST:'10',DRIVE_EMAIL_PROVIDER:'off',DRIVE_SMS_PROVIDER:'off',DRIVE_PUSH_PROVIDER:'off',DRIVE_REGISTRATION:'allowlist',DRIVE_REGISTRATION_ALLOWLIST:'@factory.example.test',DRIVE_GUEST_BOOKINGS:'false',DRIVE_LOG_LEVEL:'silent'});
   const log={info(){},warn(){},error(){},debug(){}};
   const services=source.services.createServices(config,{log});
   const server=storageRoutes?(await source.load('http/server.ts')).createServer(services,source.app.buildRouter(services).addAll(await storageRoutes({services,space:s,job}))):source.app.buildServer(services);
   server.listen(0,'127.0.0.1');await once(server,'listening');
   const origin='http://127.0.0.1:'+server.address().port;
   const evidence={mode:'LOCAL',origin,components:source.template.components,backgroundProviders:'off',newRuntime:true};
   running.set(job.instance_id,{server,services,origin,evidence});s.origin=origin;await cluster.persist();return evidence;
  },
  health:async({job})=>{
   const live=running.get(job.instance_id);if(!live)throw Error('Runtime not started');
   const response=await fetch(live.origin+'/health/ready');if(response.status!==200)throw Error('Actual QABGO readiness failed');
   return {mode:'LOCAL',httpStatus:response.status,databaseVerified:true,migrationLedgerVerified:true};
  },
 };
 async function activateSyntheticOwner(instanceId) {
  const s=cluster.spaces.get(instanceId);if(!s?.email?.endsWith('@factory.example.test'))throw Error('Only synthetic isolated identities may be activated by this test fixture');
  const password=randomBytes(24).toString('base64url');const stored=await source.passwords.hashPassword(password,10);
  const c=await cluster.client(s.owner);try {await c.query('begin');await c.query("select set_config('drive.platform','on',true)");await c.query("update drive.users set status='active',password_hash=$1 where id=$2",[stored,s.productUserId]);await c.query('commit');}finally{await c.end();}
  const response=await fetch(s.origin+'/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audience:'dispatch',tenant_id:s.tenant,email:s.email,password})});
  if(response.status!==200)throw Error('Actual synthetic product owner login failed');const body=await response.json();
  if(!body.access_token||!body.session?.roles?.includes('owner'))throw Error('No verified owner session');
  return {accessToken:body.access_token,refreshToken:body.refresh_token,origin:s.origin,tenantId:s.tenant,userId:s.productUserId,email:s.email,password};
 }
 async function close(){for(const {server,services}of running.values()){await new Promise(resolve=>server.close(resolve));await services.db.close();}}
 async function createSyntheticDriver(instanceId){
  const s=cluster.spaces.get(instanceId);if(!s?.email?.endsWith('@factory.example.test'))throw Error('Synthetic fixture only');
  const email='driver-'+instanceId+'@factory.example.test',password=randomBytes(24).toString('base64url'),stored=await source.passwords.hashPassword(password,10);
  const c=await cluster.client(s.owner);try{await c.query('begin');await c.query("select set_config('drive.platform','on',true)");
   const user=(await c.query("insert into drive.users(email,email_normalized,display_name,status,password_hash) values($1,$1,'Synthetic test driver','active',$2) returning id",[email,stored])).rows[0];
   await c.query("insert into drive.memberships(tenant_id,user_id,role) values($1,$2,'driver')",[s.tenant,user.id]);
   await c.query("insert into drive.drivers(tenant_id,user_id,first_name,email) values($1,$2,'Synthetic',$3)",[s.tenant,user.id,email]);await c.query('commit');
   return {email,password};
  }catch(e){await c.query('rollback');throw e;}finally{await c.end();}
 }
 return {steps,running,activateSyntheticOwner,createSyntheticDriver,close};
}
