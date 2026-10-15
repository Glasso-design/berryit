// Test-only transport. Real PostgreSQL RLS; no network database, GoTrue or S3.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient, AdminUserAttributes } from '@supabase/supabase-js';
import { assertIsolatedPgliteEnvironment } from '../../supabase/tests/isolated-environment.mjs';
import { createSupportClient } from '../../shared/support-workflow';
import { registerSupportCustomer } from '../../shared/support-registration';

export const ids = Object.fromEntries(['admin','tech','external','expired','other','private','customerA','customerB','orgA','orgB'].map((name,n)=>[name,`00000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`]));
const read=(file:string)=>readFileSync(new URL('../../supabase/'+file,import.meta.url),'utf8');
const identifier=(name:string)=>{if(!/^[a-z_][a-z_0-9]*$/.test(name))throw new Error('Invalid test SQL identifier');return '"'+name+'"';};
export async function isolatedDatabase(beforeWorkflow?:(db:PGlite)=>Promise<void>){
  assertIsolatedPgliteEnvironment(process.argv.includes('--environment=isolated-pglite')?['--environment=isolated-pglite']:process.env.BERRYIT_WORKFLOW_TEST==='isolated-pglite'?['--environment=isolated-pglite']:[],process.env);
  const db=await PGlite.create({extensions:{pgcrypto}});
  await db.exec(read('tests/local_bootstrap.sql'));
  const migrations=readdirSync(new URL('../../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort();
  for(const file of migrations){if(file==='20261014235633_complete_support_workflow.sql')await beforeWorkflow?.(db);await db.exec(read('migrations/'+file));if(file===migrations[0])await db.exec(read('tests/local_storage_bootstrap.sql'));}
  const users=['admin','tech','external','expired','other','private','customerA','customerB'];
  for(const name of users)await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[ids[name],name+'@example.test',JSON.stringify({full_name:'Synthetic '+name})]);
  await db.query('insert into public.organizations(id,name) values($1,$2),($3,$4)',[ids.orgA,'Synthetic A',ids.orgB,'Synthetic B']);
  await db.query("update public.profiles set role='admin' where id=$1",[ids.admin]);
  await db.query("update public.profiles set role='technician' where id=$1",[ids.tech]);
  await db.query('update public.profiles set organization_id=$1 where id=$2',[ids.orgA,ids.customerA]);
  await db.query('update public.profiles set organization_id=$1 where id=$2',[ids.orgB,ids.customerB]);
  await db.exec("insert into auth.sessions(id,user_id,aal) select id,id,'aal2' from auth.users");
  for(const name of ['external','expired'])await db.query(`insert into public.support_role_grants(grantee_id,role_key,scope,organization_id,reason,granted_at,expires_at,is_external_consultant,consultant_company,commissioning_organization_id) values($1,'BERRYIT_SUPPORT_TECHNICIAN','organization',$2,'Isolated workflow test',now()-interval '2 days',now()+($3::int * interval '1 day'),true,'Synthetic consultant',$2)`,[ids[name],ids.orgA,name==='expired'?-1:1]);
  let queue:Promise<unknown>=Promise.resolve();
  function serialized<T>(fn:()=>Promise<T>):Promise<T>{const result=queue.then(fn,fn);queue=result.catch(()=>{});return result;}
  async function as(user:string,sql:string,params:unknown[]=[],aal='aal2',role='authenticated'){
    return serialized(async()=>{await db.exec('begin');try{
      await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:user,role,aal,session_id:user})]);
      await db.exec('set local role '+identifier(role));const result=await db.query<Record<string,unknown>>(sql,params);await db.exec('commit');return result.rows;
    }catch(error){await db.exec('rollback');throw error;}});
  }
  function sdk(user:string,aal='aal2'){
    class Query {
      table:string;columns='*';values:Record<string,unknown>|null=null;verb='select';filters:[string,string,unknown][]=[];ordering:string[]=[];max:number|undefined;one=false;required=false;returning=false;
      constructor(table:string){this.table=table;}
      select(columns='*'){this.columns=columns;this.returning=true;return this;}
      insert(values:Record<string,unknown>){this.verb='insert';this.values=values;return this;}
      update(values:Record<string,unknown>){this.verb='update';this.values=values;return this;}
      eq(key:string,value:unknown){this.filters.push([key,'=',value]);return this;}
      gt(key:string,value:unknown){this.filters.push([key,'>',value]);return this;}
      order(key:string){this.ordering.push(identifier(key));return this;}
      limit(n:number){this.max=n;return this;}
      maybeSingle(){this.one=true;return this;}
      single(){this.one=true;this.required=true;return this;}
      async then(resolve:(value:unknown)=>unknown){
        try{
          const params:unknown[]=[];const bind=(v:unknown)=>{params.push(v);return '$'+params.length;};
          const cols=this.columns==='*'?'*':this.columns.split(',').map(identifier).join(',');
          const table='public.'+identifier(this.table);
          const keys=Object.keys(this.values??{});let sql='';
          if(this.verb==='insert')sql=`insert into ${table}(${keys.map(identifier)}) values(${keys.map(k=>bind(this.values![k]))})`;
          if(this.verb==='update')sql=`update ${table} set ${keys.map(k=>identifier(k)+'='+bind(this.values![k])).join(',')}`;
          if(this.verb==='select')sql=`select ${cols} from ${table}`;
          if(this.filters.length)sql+=' where '+this.filters.map(([key,op,value])=>identifier(key)+op+bind(value)).join(' and ');
          if(this.ordering.length)sql+=' order by '+this.ordering.join(',');
          if(this.max!==undefined)sql+=' limit '+Number(this.max);
          if(this.verb!=='select'&&this.returning)sql+=' returning '+cols;
          // JSON conversion preserves PostgreSQL timestamp precision.
          const rows=await as(user,this.verb==='select'||this.returning?`with result as (${sql}) select to_jsonb(result) data from result`:sql,params,aal);
          const data=rows.map(row=>row.data);
          if(this.required&&data.length!==1)throw Object.assign(new Error('Expected one row'),{code:'PGRST116'});
          return resolve({data:this.one?(data[0]??null):data,error:null});
        }catch(error){return resolve({data:null,error:{message:(error as Error).message,code:(error as {code:string}).code}});}
      }
    }
    return {
      from:(table:string)=>new Query(table),
      rpc:async(name:string,args:Record<string,unknown>={})=>{try{
        const sql=`select public.${identifier(name)}(${Object.keys(args).map((k,n)=>identifier(k)+' => $'+(n+1)).join(',')})`;
        const isSet=['support_ticket_technicians','support_ticket_people'].includes(name);
        const rows=await as(user,isSet?`select to_jsonb(result) data from public.${identifier(name)}(${Object.keys(args).map((k,n)=>identifier(k)+' => $'+(n+1)).join(',')}) result`:sql,Object.values(args),aal);
        return {data:isSet?rows.map(r=>r.data):rows[0]?.[name],error:null};
      }catch(error){return {data:null,error:{message:(error as Error).message,code:(error as {code:string}).code}};}},
      storage:{from:(bucket:string)=>({
        upload:async(path:string,file:File)=>{try{await as(user,'insert into storage.objects(bucket_id,name) values($1,$2)',[bucket,path],aal);blobs.set(path,Buffer.from(await file.arrayBuffer()));return {data:{path},error:null};}catch(error){return {data:null,error:{message:(error as Error).message}};}},
        createSignedUrl:async(path:string)=>{const rows=await as(user,'select name from storage.objects where bucket_id=$1 and name=$2',[bucket,path],aal);return rows.length?{data:{signedUrl:'http://127.0.0.1/__synthetic_download/'+encodeURIComponent(path)},error:null}:{data:null,error:{message:'Denied'}};},
      })},
    } as unknown as SupabaseClient;
  }
  const blobs=new Map<string,Buffer>();const created:AdminUserAttributes[]=[];
  async function createUser(attributes:AdminUserAttributes){
    created.push(attributes);const id=randomUUID();try{
      await serialized(()=>db.query('insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values($1,$2,$3,$4)',[id,attributes.email,JSON.stringify(attributes.user_metadata),JSON.stringify(attributes.app_metadata)]));
      return {data:{user:{id}},error:null};
    }catch(error){return {data:{user:null},error};}
  }
  function client(user:string,aal='aal2'){const actor=sdk(user,aal);return createSupportClient(actor,user,async input=>{await registerSupportCustomer(input,{actor,createUser,password:()=>randomUUID()+randomUUID()});});}
  const fixtureDb={query:(sql:string,params:unknown[]=[])=>db.query<Record<string,unknown>>(sql,params),exec:(sql:string)=>db.exec(sql)};
  return {db:fixtureDb,as,sdk,client,blobs,created,createUser,close:()=>db.close()};
}
