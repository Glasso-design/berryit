import { readProjectRepository } from '../../../../../services/connector-engine/repository-access.mjs';
import { limitedSupportBody,supportActor,supportFailure,supportCors,supportPreflight } from '@/lib/support/http';
import { ConnectorError } from '../../../../../services/connector-engine/contract.mjs';
import { SupportHttpError } from '@berryit/shared/support-http-policy';
export const runtime='nodejs';
export const OPTIONS=supportPreflight;
export async function POST(request:Request){
 try{
  const {actor}=await supportActor(request);
  const input=JSON.parse(new TextDecoder().decode(await limitedSupportBody(request,12000)));
  // Explicit server allowlist + per-repository read token. Never a NEXT_PUBLIC/VITE variable.
  let connections;
  try{connections=JSON.parse(process.env.BERRYIT_GITHUB_READ_CONNECTIONS??'{}');}
  catch{throw new Error('Repositoryläsarens serverkonfiguration är ogiltig.');}
  const data=await readProjectRepository({actor,input,connections});
  return Response.json({data},{headers:{'Cache-Control':'no-store',...supportCors(request)}});
 }catch(error){
  if(error instanceof SupportHttpError)return supportFailure(error,request);
  return Response.json({error:'Repositoryläsningen är nekad eller saknar fungerande serveranslutning.',code:error instanceof ConnectorError?error.code:'INTERNAL'},
   {status:error instanceof ConnectorError&&error.code==='FORBIDDEN'?403:503,headers:{'Cache-Control':'no-store',...supportCors(request)}});
 }
}
