import {createClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {syncProjectIssues} from '../../../../../services/connector-engine/project-issues.mjs';
import {SUPABASE_URL} from '@/lib/supabase/config';
import {limitedSupportBody,supportActor,supportFailure,supportCors,supportPreflight} from '@/lib/support/http';
export const runtime='nodejs';
export const OPTIONS=supportPreflight;
export async function POST(request:Request){
 try{
  const {actor}=await supportActor(request);
  const input=z.object({project:z.string().uuid(),integration:z.string().uuid()}).strict().parse(JSON.parse(new TextDecoder().decode(await limitedSupportBody(request,4000))));
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const server=key?createClient(SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false}}):null;
  const connections=JSON.parse(process.env.BERRYIT_GITHUB_READ_CONNECTIONS??'{}');
  const data=await syncProjectIssues({actor,server,input,connections});
  return Response.json({data},{headers:{'Cache-Control':'no-store',...supportCors(request)}});
 }catch(error){return supportFailure(error,request);}
}
