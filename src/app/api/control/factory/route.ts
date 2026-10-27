import { executeFactoryAction } from '@berryit/shared/factory';
import { limitedSupportBody,supportActor,supportFailure,supportCors,supportPreflight } from '@/lib/support/http';
export const runtime='nodejs';
export const OPTIONS=supportPreflight;
export async function POST(request:Request){
 try{
  const {actor}=await supportActor(request);
  const input=JSON.parse(new TextDecoder().decode(await limitedSupportBody(request,16000)));
  const data=await executeFactoryAction(actor,input);
  return Response.json({data},{headers:{'Cache-Control':'no-store',...supportCors(request)}});
 }catch(error){return supportFailure(error,request);}
}
