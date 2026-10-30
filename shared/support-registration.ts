import type { SupabaseClient, AdminUserAttributes } from "@supabase/supabase-js";
import { customerRegistrationSchema, SupportConnectionError } from "./support-workflow";

/** Exact, honest outcome texts. Nothing here claims an account exists unless it does. */
export const REGISTRATION_MESSAGES = {
  needsMfa: "Kundregistrering kräver aktiv administratör med MFA.",
  exists: "Det finns redan ett konto med den e-postadressen. Inget nytt konto skapades; välj kunden i kundregistret.",
  refused: "Databasen nekade registreringen: behörigheten med tvåfaktor (eller organisationen) kunde inte bekräftas. Inget konto skapades. Logga in med tvåfaktor igen och försök på nytt.",
  failed: "Kunden kunde inte registreras. Kontrollera om kontot redan finns; skapa inte ett parallellt kundkonto.",
} as const;

type CreateUserError = { status?: number; code?: string; name?: string; message?: string } | null | undefined;

export async function registerSupportCustomer(input:unknown,dependencies:{actor:SupabaseClient;createUser:(attributes:AdminUserAttributes)=>Promise<{data:{user:{id:string}|null};error:unknown}>;password:()=>string;}){
  const customer=customerRegistrationSchema.parse(input);
  const context=await dependencies.actor.rpc("support_registration_context",{p_organization_id:customer.organization_id});
  if(context.error||!context.data?.actor_id||!context.data?.session_id)throw new Error(REGISTRATION_MESSAGES.needsMfa);
  const result=await dependencies.createUser({email:customer.email,password:dependencies.password(),email_confirm:false,ban_duration:"876000h",
    user_metadata:{full_name:customer.full_name,phone:customer.phone},app_metadata:{berryit_manual_customer:context.data}});
  if(result.error||!result.data.user){
    const error=result.error as CreateUserError;
    // GoTrue: 422 email_exists for a duplicate (also a retry whose first answer was lost);
    // 500 "Database error creating new user" when the registration trigger refuses (fail closed, nothing created);
    // status 0 / AuthRetryableFetchError when Auth could not be reached.
    if(error?.code==="email_exists"||error?.status===422)throw new Error(REGISTRATION_MESSAGES.exists);
    if(error?.status===500)throw new Error(REGISTRATION_MESSAGES.refused);
    if(error?.name==="AuthRetryableFetchError"||error?.status===0)throw new SupportConnectionError();
    throw new Error(REGISTRATION_MESSAGES.failed);
  }
  return {id:result.data.user.id,login_activation_pending:true};
}
