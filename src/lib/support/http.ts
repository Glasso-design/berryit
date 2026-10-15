import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/config";
import { SupportHttpError,assertSupportOrigin,supportOriginAllowed } from "@berryit/shared/support-http-policy";
export {limitedSupportBody} from "@berryit/shared/support-http-policy";
function allowedOrigin(request:Request){
  return supportOriginAllowed(request,process.env.CONTROL_ALLOWED_ORIGINS);
}
export function supportCors(request:Request):Record<string,string>{
  const origin=request.headers.get("origin");
  return origin&&allowedOrigin(request)?{"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Authorization, Content-Type","Vary":"Origin"}:{};
}
export function supportPreflight(request:Request){return new Response(null,{status:allowedOrigin(request)?204:403,headers:supportCors(request)});}
export async function supportActor(request:Request){
  const bearer=request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1];
  assertSupportOrigin(request,bearer,process.env.CONTROL_ALLOWED_ORIGINS);
  const actor=bearer?createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{global:{headers:{Authorization:`Bearer ${bearer}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}):await createSupabaseServerClient();
  const result=await actor.auth.getUser(bearer);
  if(result.error||!result.data.user)throw new SupportHttpError(401,"Logga in igen.");
  return {actor,userId:result.data.user.id};
}
export function supportFailure(error:unknown,request?:Request){
  const status=error instanceof SupportHttpError?error.status:400;
  return Response.json({error:error instanceof Error?error.message:"Åtgärden kunde inte slutföras."},{status,headers:{"Cache-Control":"no-store",...(request?supportCors(request):{})}});
}
