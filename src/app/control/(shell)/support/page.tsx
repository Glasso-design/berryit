import { requireSession } from "@/lib/auth";
import { PortalSupport } from "@/components/control/SupportClient";
export const dynamic="force-dynamic";
export const metadata={title:"Support Desk"};
export default async function SupportPage({searchParams}:PageProps<"/control/support">){
  const user=await requireSession();const params=await searchParams;
  return <PortalSupport userId={user.userId} focus={typeof params.arende==="string"?params.arende:null}/>;
}
