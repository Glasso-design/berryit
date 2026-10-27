import {executeProjectControlAction} from '@berryit/shared/project-control';
import {limitedSupportBody,supportActor,supportFailure,supportCors,supportPreflight} from '@/lib/support/http';
export const runtime='nodejs';
export const OPTIONS=supportPreflight;
export async function POST(request:Request){
 try{const {actor}=await supportActor(request);const input=JSON.parse(new TextDecoder().decode(await limitedSupportBody(request,64000)));
  return Response.json({data:await executeProjectControlAction(actor,input)},{headers:{'Cache-Control':'no-store',...supportCors(request)}});
 }catch(error){return supportFailure(error,request);}
}
