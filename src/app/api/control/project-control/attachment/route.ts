import {z} from 'zod';
import {uploadProjectTaskFile,type TaskAttachment} from '@berryit/shared/project-control';
import {limitedSupportBody,supportActor,supportFailure,supportCors,supportPreflight} from '@/lib/support/http';
export const runtime='nodejs';
export const OPTIONS=supportPreflight;
export async function POST(request:Request){
 try{
  const {actor}=await supportActor(request);
  const bytes=await limitedSupportBody(request,27*1024*1024);
  const form=await new Response(bytes,{headers:{'Content-Type':request.headers.get('Content-Type')??''}}).formData();
  const task=z.string().uuid().parse(form.get('task')),file=form.get('file');if(!(file instanceof File))throw Error('Välj en fil.');
  const pending=form.get('pending')?JSON.parse(String(form.get('pending'))) as TaskAttachment:undefined;
  await uploadProjectTaskFile(actor,task,file,pending);
  return Response.json({ok:true},{headers:{'Cache-Control':'no-store',...supportCors(request)}});
 }catch(error){return supportFailure(error,request);}
}
