import { MODULE_REQUIREMENTS } from "@berryit/shared/api";
import { navItem, type NavKey } from "@berryit/shared/nav";
import { NotConnected } from "@/components/NotConnected";

/**
 * Vy för moduler utan backend. Kraven kommer från det delade API-kontraktet,
 * så webben och desktopappen beskriver exakt samma sak som saknas.
 */
export function Modul({ nyckel }: { nyckel: NavKey }) {
  const item = navItem(nyckel);
  const modul = MODULE_REQUIREMENTS[nyckel];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{item.label}</h1>
      </header>
      {modul ? (
        <NotConnected {...modul} />
      ) : (
        <p className="text-sm text-muted">Modulen saknar beskrivning i API-kontraktet.</p>
      )}
    </div>
  );
}
