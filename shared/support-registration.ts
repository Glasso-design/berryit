import type { SupabaseClient, AdminUserAttributes } from "@supabase/supabase-js";
import { customerRegistrationSchema } from "./support-workflow";
export async function registerSupportCustomer(input:unknown,dependencies:{actor:SupabaseClient;createUser:(attributes:AdminUserAttributes)=>Promise<{data:{user:{id:string}|null};error:unknown}>;password:()=>string;}){
  const customer=customerRegistrationSchema.parse(input);
  const context=await dependencies.actor.rpc("support_registration_context",{p_organization_id:customer.organization_id});
  if(context.error||!context.data?.actor_id||!context.data?.session_id)throw new Error("Kundregistrering kräver aktiv administratör med MFA.");
  const result=await dependencies.createUser({email:customer.email,password:dependencies.password(),email_confirm:false,ban_duration:"876000h",
    user_metadata:{full_name:customer.full_name,phone:customer.phone},app_metadata:{berryit_manual_customer:context.data}});
  if(result.error||!result.data.user)throw new Error("Kunden kunde inte registreras. Kontrollera om kontot redan finns; skapa inte ett parallellt kundkonto.");
  return {id:result.data.user.id,login_activation_pending:true};
}
