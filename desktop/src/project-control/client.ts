import type {SupabaseClient} from '@supabase/supabase-js';
import {createProjectControlClient} from '@berryit/shared/project-control';
import type {RepositoryRequest,RepositoryResult} from '@berryit/shared/project-access';
import {backendFetch} from '@/auth/client';
export function desktopProjectControl(supabase:SupabaseClient,controlUrl:string|null|undefined){
 const post=async<T>(path:string,input:unknown):Promise<T>=>{
  if(!controlUrl)throw Error('Godkänd Control Center-URL krävs för serveranslutningen.');
  const {data}=await supabase.auth.getSession();if(!data.session)throw Error('Logga in igen.');
  const response=await backendFetch(controlUrl+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},body:JSON.stringify(input)});
  const result=await response.json();if(!response.ok)throw Error(result.error??'Projektbegäran nekades.');return result.data;
 };
 return createProjectControlClient(supabase,{repository:(input:RepositoryRequest)=>post<RepositoryResult>('/api/control/repository',input),syncIssues:(project,integration)=>post('/api/control/project-sync',{project,integration})});
}
