"use client";
import { useMemo } from "react";
import { createPortalSupportClient } from "@berryit/shared/support-workflow";
import { SupportWorkspace } from "@berryit/shared/ui/SupportWorkspace";
import { CustomerWorkspace } from "@berryit/shared/ui/CustomerWorkspace";
export function PortalSupport({userId,focus}:{userId:string;focus:string|null}){
  const client=useMemo(()=>createPortalSupportClient(),[]);
  return <SupportWorkspace key={userId} client={client} userId={userId} focus={focus}/>;
}
export function PortalCustomers({userId}:{userId:string}){
  const client=useMemo(()=>createPortalSupportClient(),[]);
  return <CustomerWorkspace key={userId} client={client}/>;
}
