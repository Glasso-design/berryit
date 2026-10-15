import { createSupportClient } from "@berryit/shared/support-workflow";
import { executeSupportAction } from "@berryit/shared/support-actions";
import { limitedSupportBody,supportActor,supportFailure } from "@/lib/support/http";
export const runtime="nodejs";
export async function POST(request:Request){
  try{
    const {actor,userId}=await supportActor(request);
    const multipart=request.headers.get("content-type")?.startsWith("multipart/form-data");
    const bytes=await limitedSupportBody(request,multipart?26300000:128000);
    let input:unknown;let file:File|undefined;
    if(multipart){const form=await new Response(bytes,{headers:{"Content-Type":request.headers.get("content-type")!}}).formData();input={action:form.get("action"),args:JSON.parse(String(form.get("args")))};const candidate=form.get("file");if(candidate instanceof File)file=candidate;}
    else input=JSON.parse(new TextDecoder().decode(bytes));
    const data=await executeSupportAction(createSupportClient(actor,userId),input,file);
    return Response.json({data:data??null},{headers:{"Cache-Control":"no-store"}});
  }catch(error){return supportFailure(error);}
}
