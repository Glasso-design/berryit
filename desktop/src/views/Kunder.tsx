import { useMemo } from "react";
import { createSupportClient,customerRegistrationSchema } from "@berryit/shared/support-workflow";
import { CustomerWorkspace } from "@berryit/shared/ui/CustomerWorkspace";
import { useSession } from "@/auth/session";
import { backendFetch } from "@/auth/client";
export function Kunder(){
  const {supabase,access,config}=useSession();
  const client=useMemo(()=>supabase&&access?createSupportClient(supabase,access.userId,async input=>{
    if(!config?.controlUrl)throw new Error("Ange Control Center-URL i Inställningar för kundregistrering.");
    const {data}=await supabase.auth.getSession();if(!data.session)throw new Error("Logga in igen.");
    const response=await backendFetch(config.controlUrl+"/api/control/customers",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${data.session.access_token}`},body:JSON.stringify(customerRegistrationSchema.parse(input))});
    const result=await response.json();if(!response.ok)throw new Error(result.error??"Kundregistreringen misslyckades.");
  }):null,[supabase,access,config]);
  if(!client||!access?.isStaff)return <p role="alert">Du saknar behörighet till kundregistret.</p>;
  return <CustomerWorkspace key={access.userId} client={client}/>;
}
