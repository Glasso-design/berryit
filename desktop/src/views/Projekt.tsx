import { useMemo } from "react";
import { createAccessClient } from "@berryit/shared/project-access";
import { ProjectAccessWorkspace } from "@berryit/shared/ui/ProjectAccessWorkspace";
import { Icon } from "@berryit/shared/ui/Icon";
import {
  lastCheckedLabel,
  isStale,
  statusLabel,
} from "@berryit/shared/connectors";
import type { Service, StatusCheck } from "@berryit/shared/connectors";
import { useSession } from "@/auth/session";
import { backendFetch } from "@/auth/client";
import { type RegistryData } from "@/registry/data";

/**
 * Projekt: våra egna och kundernas, med tjänsterna som hör till.
 *
 * Skillnaden mellan internt och kund ligger på organisationen, inte på
 * projektet, så den kan inte glida isär. Driftstatus visas bara när det finns
 * en mätning – och sägs vara gammal när den är gammal.
 */
export function Projekt() {
  const { supabase,config } = useSession();
  const client = useMemo(() => supabase ? createAccessClient(supabase,async input=>{
    if(!config?.controlUrl)throw new Error("Repositoryläsning kräver godkänd Control Center-URL i Inställningar.");
    const {data}=await supabase.auth.getSession();if(!data.session)throw new Error("Logga in igen.");
    const response=await backendFetch(config.controlUrl+"/api/control/repository",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${data.session.access_token}`},body:JSON.stringify(input)});
    const result=await response.json();if(!response.ok)throw new Error(result.error??"Repositoryåtkomst nekades.");return result.data;
  }) : null, [supabase,config]);
  return client ? <ProjectAccessWorkspace client={client}/> : null;
}

export function TjansteRad({
  tjanst,
  status,
  data,
}: {
  tjanst: Service;
  status: StatusCheck | null;
  data: RegistryData;
}) {
  const nod = tjanst.node_id ? data.nodes.find((n) => n.id === tjanst.node_id) : null;
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-line/60 px-3 py-2 text-sm">
      <Icon name={tjanst.service_kind === "database" ? "system" : "web"} className="h-4 w-4 shrink-0 text-muted" />
      <span className="font-medium">{tjanst.name}</span>
      <span className="text-xs text-muted">{tjanst.environment}</span>
      <span className="text-xs text-muted">{nod ? nod.name : "serverlöst"}</span>
      <span className="ml-auto">
        <Driftstatus status={status} />
      </span>
    </li>
  );
}

/**
 * Visar en mätning som en mätning: status, avsändare och ålder. Finns ingen
 * mätning står det så – vi visar aldrig "fungerar" på en gissning.
 */
export function Driftstatus({ status }: { status: StatusCheck | null }) {
  if (!status) {
    return <span className="text-xs text-muted">ingen mätning</span>;
  }
  const gammal = isStale(status.checked_at);
  const farg =
    status.status_key === "ok"
      ? gammal
        ? "text-muted"
        : "text-signal"
      : status.status_key === "degraded"
        ? "text-berry-2"
        : status.status_key === "down"
          ? "text-berry"
          : "text-muted";

  return (
    <span className="flex items-center gap-2 text-xs">
      <span className={farg}>{statusLabel(status.status_key)}</span>
      <span className="text-muted">
        {lastCheckedLabel(status.checked_at)}
        {gammal ? " – inte färsk" : ""}
      </span>
    </span>
  );
}
