import { NotConnected } from "@/components/control/NotConnected";
import { MODULE_REQUIREMENTS } from "@berryit/shared/api";
import { requireStaff } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projekt" };

/*
 * Modulen saknar backend. Kraven kommer från det delade API-kontraktet, så att
 * webben och desktopappen beskriver exakt samma sak som saknas.
 */
export default async function Page() {
  await requireStaff();
  const modul = MODULE_REQUIREMENTS["projekt"];
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Projekt</h1>
      </header>
      <NotConnected {...modul} />
    </div>
  );
}
