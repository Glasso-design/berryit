import { executeAccessAction } from '@berryit/shared/project-access';
import { limitedSupportBody,supportActor,supportFailure } from '@/lib/support/http';
export const runtime='nodejs';
export async function POST(request:Request){
 try{
  const {actor}=await supportActor(request);
  const bytes=await limitedSupportBody(request,128000);
  const data=await executeAccessAction(actor,JSON.parse(new TextDecoder().decode(bytes)));
  return Response.json({data},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return supportFailure(error);}
}
