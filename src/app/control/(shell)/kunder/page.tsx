import { requireStaff } from "@/lib/auth";
import { PortalCustomers } from "@/components/control/SupportClient";
export const dynamic="force-dynamic";
export const metadata={title:"Kunder"};
export default async function KunderPage(){const user=await requireStaff();return <PortalCustomers userId={user.userId}/>;}
