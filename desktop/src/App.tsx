import { useEffect, useState } from "react";
import { applyTheme, resolveTheme } from "@berryit/shared/theme";
import { navForAccess, type NavKey } from "@berryit/shared/nav";
import { Factory } from '@/views/Factory';
import { useSession } from "@/auth/session";
import { Shell } from "@/components/Shell";
import { Dashboard } from "@/views/Dashboard";
import { Infrastruktur } from "@/views/Infrastruktur";
import { Installningar } from "@/views/Installningar";
import { Integrationer } from "@/views/Integrationer";
import { Kommunikation } from "@/views/Kommunikation";
import { Kunder } from "@/views/Kunder";
import { Login } from "@/views/Login";
import { Mfa } from "@/views/Mfa";
import { Modul } from "@/views/Modul";
import { Monitoring } from "@/views/Monitoring";
import { Projekt } from "@/views/Projekt";
import { OnarlyAi } from "@/views/OnarlyAi";
import { Setup } from "@/views/Setup";
import { Support } from "@/views/Support";
import {Tasks} from '@/views/Tasks';

/**
 * Appens rot. Vilken vy som visas styrs av sessionsstatus först och av
 * navigationen sedan. Backend och RLS avgör alltid faktisk resursåtkomst.
 */
export function App() {
  const { status, access } = useSession();
  const [vy, setVy] = useState<NavKey>("dashboard");
  const [arende, setArende] = useState<string | null>(null);
  const [editingConnection, setEditingConnection] = useState(false);
  const [factoryProject,setFactoryProject]=useState<{project:string;product:string}|null>(null);
  const [aiProject,setAiProject]=useState<string|null>(null);

  useEffect(() => {
    applyTheme(resolveTheme());
  }, []);

  // Byter rollen (t.ex. efter MFA) ska en vy som inte längre får visas lämnas.
  useEffect(() => {
    if (!access) return;
    if (!navForAccess(access).some(item=>item.key===vy)) setVy("dashboard");
  }, [access, vy]);

  // En ny inloggning börjar på översikten. App-komponenten lever kvar genom en
  // utloggning, så utan det här hamnar nästa användare i den förra användarens
  // vy – vilket är fel även när behörigheten råkar räcka.
  const inloggadSom = access?.userId ?? null;
  useEffect(() => {
    setVy("dashboard");
    setArende(null);
    setFactoryProject(null);setAiProject(null);
  }, [inloggadSom]);

  if (status === "laddar") {
    return <div className="grid h-full place-items-center bg-ink text-muted">Startar…</div>;
  }
  if (status === "osatt") return <Setup />;
  if (status === "utloggad") return editingConnection
    ? <Setup onClose={() => setEditingConnection(false)} />
    : <Login onConfigure={() => setEditingConnection(true)} />;
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
        if(key==='factory')setFactoryProject(null);
        if(key==='ai')setAiProject(null);
        setVy(key);
      }}
      onOpenTicket={oppnaArende}
    >
      {vy === "dashboard" && <Dashboard onNavigate={setVy} />}
      {vy === "kunder" && <Kunder />}
      {vy === "support" && <Support focus={arende} />}
      {vy === "ai" && <OnarlyAi onOpenTicket={oppnaArende} initialProject={aiProject??undefined}/>}
      {vy === "projekt" && <Projekt onOpenTicket={oppnaArende} onOpenFactory={(project,product)=>{setFactoryProject({project,product});setVy('factory');}} onOpenAi={project=>{setAiProject(project);setVy('ai');}}/>}
      {vy === "factory" && <Factory project={factoryProject?.project} product={factoryProject?.product}/>}
      {vy === "tasks" && <Tasks onOpenTicket={oppnaArende}/>}
      {vy === "infrastruktur" && <Infrastruktur />}
      {vy === "integrationer" && <Integrationer />}
      {vy === "monitoring" && <Monitoring />}
      {vy === "kommunikation" && <Kommunikation />}
      {vy === "installningar" && <Installningar />}
      {!["dashboard", "kunder", "support", "ai", "projekt", "factory", "tasks", "infrastruktur", "integrationer", "monitoring", "kommunikation", "installningar"].includes(
        vy,
      ) && <Modul nyckel={vy} />}
    </Shell>
  );
}
