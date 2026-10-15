import "server-only";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { registerSupportCustomer } from "@berryit/shared/support-registration";
import { SUPABASE_URL } from "@/lib/supabase/config";
import { limitedSupportBody,supportActor,supportFailure,supportCors,supportPreflight } from "@/lib/support/http";
export const runtime="nodejs";
export async function POST(request:Request){
  try{
    const {actor}=await supportActor(request);
    const input=JSON.parse(new TextDecoder().decode(await limitedSupportBody(request,16000)));
    const result=await registerSupportCustomer(input,{actor,password:()=>randomBytes(48).toString("base64url"),createUser:async(attributes)=>{
      const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!key)throw new Error("Serverbaserad kundregistrering är inte konfigurerad.");
      const admin=createClient(SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
      return admin.auth.admin.createUser(attributes);
    }});
    return Response.json(result,{status:201,headers:{"Cache-Control":"no-store",...supportCors(request)}});
  }catch(error){return supportFailure(error,request);}
}
export const OPTIONS=supportPreflight;
