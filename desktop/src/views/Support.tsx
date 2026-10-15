import { useMemo } from "react";
import { createSupportClient } from "@berryit/shared/support-workflow";
import { SupportWorkspace } from "@berryit/shared/ui/SupportWorkspace";
import { useSession } from "@/auth/session";
import { DeskPanel } from "./DeskPanel";
export function Support({focus}:{focus:string|null}){
  const {supabase,access}=useSession();
  const client=useMemo(()=>supabase&&access?createSupportClient(supabase,access.userId):null,[supabase,access]);
  if(!client||!access)return null;
  return <SupportWorkspace key={access.userId} client={client} userId={access.userId} focus={focus} renderAdditional={ticket=><DeskPanel ticket={ticket}/>}/>;
}
