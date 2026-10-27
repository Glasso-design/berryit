import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync,readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createQabgoAdapter } from '../adapters/qabgo.mjs';
import { ProductRegistry,PRODUCT_CATALOG } from '../registry.mjs';
import { FactoryStore } from '../store.mjs';
import { registerLocalCatalog } from '../catalog.mjs';
import { DEFAULT_STORAGE_QUOTA } from '../contract.mjs';
const root=new URL('../../../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
export async function fixture(database){
 const db=database??await PGlite.create({extensions:{pgcrypto}});
 await db.exec(read('supabase/tests/local_bootstrap.sql'));
 for(const [i,file]of readdirSync(new URL('supabase/migrations/',root)).filter(f=>f.endsWith('.sql')).sort().entries()){
  await db.exec(read('supabase/migrations/'+file));if(i===0)await db.exec(read('supabase/tests/local_storage_bootstrap.sql'));
 }
 await db.exec("set factory.install_environment='isolated-test'");await db.exec(read('services/platform-factory/db/001_factory.sql'));await db.exec(read('services/platform-factory/db/002_provider_broker.sql'));
 const ids=Object.fromEntries(['owner','adminA','adminB','support','developer','customerA','customerB','orgA','orgB'].map(k=>[k,randomUUID()]));
 for(const k of ['owner','adminA','adminB','support','developer','customerA','customerB'])await db.query('insert into auth.users(id,email) values($1,$2)',[ids[k],k+'@factory.example.test']);
 await db.exec("insert into auth.sessions(id,user_id,aal) select id,id,'aal2' from auth.users");
 await db.query("insert into public.organizations(id,name,is_internal) values($1,'Synthetic Factory A',false),($2,'Synthetic Factory B',false)",[ids.orgA,ids.orgB]);
 await db.query('update public.profiles set organization_id=$1 where id=$2',[ids.orgA,ids.customerA]);
 await db.query('update public.profiles set organization_id=$1 where id=$2',[ids.orgB,ids.customerB]);
 await db.query("insert into public.support_role_grants(grantee_id,role_key,scope,organization_id,reason) values($1,'BERRYIT_SUPPORT_SUPER_ADMIN','global',null,'Synthetic owner'),($2,'BERRYIT_SUPPORT_ADMIN','organization',$3,'Synthetic scoped admin'),($4,'BERRYIT_SUPPORT_ADMIN','organization',$5,'Synthetic scoped admin')",[ids.owner,ids.adminA,ids.orgA,ids.adminB,ids.orgB]);
 const as=async(user,sql,args=[],aal='aal2',role='authenticated')=>{
  await db.exec('begin');try{
   await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:user,role,aal,session_id:user})]);
   if(!['authenticated','anon','service_role'].includes(role))throw Error('Invalid test role');await db.exec('set local role '+role);
   const result=await db.query(sql,args);await db.exec('commit');return result.rows;
  }catch(error){await db.exec('rollback');throw error;}
 };
 const rpc=async(user,name,args=[],aal='aal2',role='authenticated')=>(await as(user,`select public.${name}(${args.map((_,n)=>'$'+(n+1)).join(',')}) result`,args,aal,role))[0].result;
 ids.projectA=await rpc(ids.adminA,'save_support_project',[null,ids.orgA,JSON.stringify({name:'Factory A',source:'berryit'}),'Synthetic fixture']);
 ids.projectB=await rpc(ids.adminB,'save_support_project',[null,ids.orgB,JSON.stringify({name:'Factory B',source:'berryit'}),'Synthetic fixture']);
 await db.query("insert into public.support_role_grants(grantee_id,role_key,scope,organization_id,project_id,reason) values($1,'BERRYIT_SUPPORT_TECHNICIAN','organization',$2,$3,'Synthetic support'),($4,'BERRYIT_DEVELOPER','organization',$2,$3,'Synthetic developer')",[ids.support,ids.orgA,ids.projectA,ids.developer]);
 const template=JSON.parse(read('services/platform-factory/adapters/qabgo.template.json'));
 const adapter=createQabgoAdapter(template),registry=new ProductRegistry(PRODUCT_CATALOG).register(adapter);
 await registerLocalCatalog(db,adapter);
 const request=(overrides={})=>({productId:'qabgo',version:template.version,organizationId:ids.orgA,projectId:ids.projectA,ownerId:ids.customerA,name:'Synthetic Platform A',customerName:'Synthetic Factory A',domain:'factory-'+randomUUID()+'.example.invalid',region:'eu',accountMode:'DEDICATED_MANAGED',emailMode:'routing',storageQuotaBytes:DEFAULT_STORAGE_QUOTA,monthlyBudgetCents:0,addons:[],idempotencyKey:randomUUID(),...overrides});
 const create=async(input=request(),user=ids.adminA)=>rpc(user,'factory_create',[JSON.stringify(input)]);
 return {db,ids,as,rpc,adapter,registry,request,create,store:new FactoryStore(db)};
}
