import { useEffect, useState } from "react";
import { applyTheme, resolveTheme } from "@berryit/shared/theme";
import { navItem, type NavKey } from "@berryit/shared/nav";
import { useSession } from "@/auth/session";
import { Shell } from "@/components/Shell";
import { Dashboard } from "@/views/Dashboard";
import { Infrastruktur } from "@/views/Infrastruktur";
import { Installningar } from "@/views/Installningar";
import { Integrationer } from "@/views/Integrationer";
import { Kunder } from "@/views/Kunder";
import { Login } from "@/views/Login";
import { Mfa } from "@/views/Mfa";
import { Modul } from "@/views/Modul";
import { Projekt } from "@/views/Projekt";
import { OnarlyAi } from "@/views/OnarlyAi";
import { Setup } from "@/views/Setup";
import { Support } from "@/views/Support";

/**
 * Appens rot. Vilken vy som visas styrs av sessionsstatus först och av
 * navigationen sedan – en vy kan aldrig renderas före rätt behörighetsnivå.
 */
export function App() {
  const { status, access } = useSession();
  const [vy, setVy] = useState<NavKey>("dashboard");
  const [arende, setArende] = useState<string | null>(null);

  useEffect(() => {
    applyTheme(resolveTheme());
  }, []);

  // Byter rollen (t.ex. efter MFA) ska en vy som inte längre får visas lämnas.
  useEffect(() => {
    if (!access) return;
    if (navItem(vy).staffOnly && !access.isStaff) setVy("dashboard");
  }, [access, vy]);

  if (status === "laddar") {
    return <div className="grid h-full place-items-center bg-ink text-muted">Startar…</div>;
  }
  if (status === "osatt") return <Setup />;
  if (status === "utloggad") return <Login />;
  if (status === "mfa") return <Mfa />;

  const oppnaArende = (reference: string) => {
    setArende(reference);
    setVy("support");
  };

  return (
    <Shell
      current={vy}
      onNavigate={(key) => {
        if (key !== "support") setArende(null);
        setVy(key);
      }}
      onOpenTicket={oppnaArende}
    >
      {vy === "dashboard" && <Dashboard onNavigate={setVy} />}
      {vy === "kunder" && <Kunder />}
      {vy === "support" && <Support focus={arende} />}
      {vy === "ai" && <OnarlyAi onOpenTicket={oppnaArende} />}
      {vy === "projekt" && <Projekt />}
      {vy === "infrastruktur" && <Infrastruktur />}
      {vy === "integrationer" && <Integrationer />}
      {vy === "installningar" && <Installningar />}
      {!["dashboard", "kunder", "support", "ai", "projekt", "infrastruktur", "integrationer", "installningar"].includes(
        vy,
      ) && <Modul nyckel={vy} />}
    </Shell>
  );
}
