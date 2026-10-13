import { NotConnected } from "@/components/control/NotConnected";
import { MODULE_REQUIREMENTS } from "@berryit/shared/api";
import { requireStaff } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Monitoring" };

/*
 * Modulen saknar backend. Kraven kommer från det delade API-kontraktet, så att
 * webben och desktopappen beskriver exakt samma sak som saknas.
 */
export default async function Page() {
  await requireStaff();
  const modul = MODULE_REQUIREMENTS["monitoring"];
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Monitoring</h1>
      </header>
      <NotConnected {...modul} />
    </div>
  );
}
