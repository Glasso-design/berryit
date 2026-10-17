import { PortalProjectAccess } from "@/components/control/ProjectAccessClient";
import { requireStaff } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projekt" };

/*
 * Modulen saknar backend. Kraven kommer från det delade API-kontraktet, så att
 * webben och desktopappen beskriver exakt samma sak som saknas.
 */
export default async function Page() {
  await requireStaff();
  return <PortalProjectAccess/>;
}
