import { useCallback, useEffect, useState } from "react";
import { TABLE } from "@berryit/shared/api";
import { hasActiveDeskEntitlement, safeRustDeskId } from "@berryit/shared/desk";
import type { DeskEntitlement } from "@berryit/shared/desk";
import type { TicketRow } from "@berryit/shared/domain";
import { useSession } from "@/auth/session";

type Device = { id: string; label: string; rustdesk_id: string; is_active: boolean };
type RemoteSession = {
  id: string; device_id: string; technician_id: string; requested_at: string;
  consent_method: string | null; consent_note: string | null; consent_recorded_at: string | null;
  started_at: string | null; ended_at: string | null;
};
type Event = { id: number; session_id: string; action: string; created_at: string; actor_id: string | null };
type DeskData = { devices: Device[]; sessions: RemoteSession[]; events: Event[]; rights: DeskEntitlement[]; names: Record<string, string> };
const when = (value: string | null) => value ? new Date(value).toLocaleString("sv-SE") : "Ej registrerad";
const inputClass = "rounded-lg border border-line bg-ink-2 px-3 py-2 text-sm";

export function DeskPanel({ ticket }: { ticket: TicketRow }) {
  const { supabase, access } = useSession();
  const [data, setData] = useState<DeskData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [rustdeskId, setRustdeskId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [method, setMethod] = useState("phone");
  const [note, setNote] = useState("");

  const refresh = useCallback(async () => {
    if (!supabase || !ticket.organization_id) return;
    setError(null);
    try {
      const [devices, sessions, events, rights] = await Promise.all([
        supabase.from(TABLE.deskDevices).select("id, label, rustdesk_id, is_active").eq("organization_id", ticket.organization_id).order("label"),
        supabase.from(TABLE.deskSessions).select("id, device_id, technician_id, requested_at, consent_method, consent_note, consent_recorded_at, started_at, ended_at").eq("ticket_id", ticket.id).order("requested_at", { ascending: false }),
        supabase.from(TABLE.deskSessionEvents).select("id, session_id, action, created_at, actor_id").eq("ticket_id", ticket.id).order("created_at"),
        supabase.from(TABLE.deskEntitlements).select("id, organization_id, product_key, entitlement, expires_at, revoked_at").eq("organization_id", ticket.organization_id),
      ]);
      const failure = [devices, sessions, events, rights].find((result) => result.error);
      if (failure?.error) throw failure.error;
      const sessionRows = (sessions.data ?? []) as RemoteSession[];
      const ids = [...new Set([ticket.assignee_id, ...sessionRows.map((row) => row.technician_id),
        ...((events.data ?? []) as Event[]).map((row) => row.actor_id)].filter((id): id is string => Boolean(id)))];
      const profiles = ids.length ? await supabase.from(TABLE.profiles).select("id, full_name, email").in("id", ids) : null;
      const names: Record<string, string> = {};
      for (const profile of profiles?.data ?? []) names[profile.id] = profile.full_name || profile.email || profile.id;
      setData({ devices: (devices.data ?? []) as Device[], sessions: sessionRows, events: (events.data ?? []) as Event[], rights: (rights.data ?? []) as DeskEntitlement[], names });
    } catch (cause) { setData(null); setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [supabase, ticket.id, ticket.organization_id, ticket.assignee_id]);

  useEffect(() => { setData(null); void refresh(); }, [refresh]);
  async function mutate(operation: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true); setError(null);
    try {
      const result = await operation();
      if (result.error) throw new Error(result.error.message);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  const active = Boolean(ticket.organization_id && data && hasActiveDeskEntitlement(data.rights, ticket.organization_id));
  const canRecord = Boolean(access?.isStaff && active);

  return <section aria-label="ONARLY DESK" className="space-y-4 rounded-2xl border border-line bg-ink-2 p-5">
    <div><h2 className="font-display text-xl font-semibold">ONARLY DESK · {ticket.reference}</h2>
      <p className="mt-1 text-sm text-muted">Faktisk anslutningsstatus: okänd. BerryIT registrerar bara manuella uppgifter. Kunden måste fortfarande godkänna anslutningen i RustDesk.</p></div>
    {error && <p role="alert" className="text-sm text-berry-2">{error}</p>}
    {!ticket.organization_id ? <p className="text-sm text-muted">Privatärende saknar organisationskopplad DESK-rättighet. Separat databasändring krävs.</p> : !data ?
      <p className="text-sm text-muted">Hämtar DESK-data…</p> : <>
        <p className="text-sm">Kundrättighet: <strong>{active ? "Aktiv" : "Saknas, utgången eller återkallad"}</strong></p>
        <p className="text-sm">Ärendets ansvariga tekniker: {ticket.assignee_id ? data.names[ticket.assignee_id] ?? ticket.assignee_id : "Inte tilldelad"}</p>
        <div><h3 className="font-semibold">Kundens RustDesk-enheter</h3>
          {data.devices.length === 0 ? <p className="text-sm text-muted">Inga enheter registrerade.</p> : <ul className="mt-2 space-y-2 text-sm">{data.devices.map((device) =>
            <li key={device.id}>{device.label} · <code>{device.rustdesk_id}</code> · {device.is_active ? "Aktiv" : "Inaktiv"}
              {device.is_active && <button type="button" className="ml-3 text-berry-2 underline" onClick={async () => {
                const safe = safeRustDeskId(device.rustdesk_id);
                if (!safe) { setError("Ogiltigt RustDesk-ID."); return; }
                try { await navigator.clipboard.writeText(safe); setError(null); }
                catch { setError("Kopiering misslyckades. Markera ID:t och kopiera manuellt."); }
              }}>Kopiera ID</button>}</li>)}</ul>}
          <p className="mt-2 text-xs text-muted">Öppna installerad ONARLY DESK-klient själv och ange ID:t. Ingen session startas härifrån.</p>
          {canRecord && <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => {
            event.preventDefault();
            if (!supabase || !access || !ticket.organization_id || !safeRustDeskId(rustdeskId)) { setError("Ange ett giltigt numeriskt RustDesk-ID."); return; }
            void mutate(() => supabase.from(TABLE.deskDevices).insert({ organization_id: ticket.organization_id, label: label.trim(), rustdesk_id: rustdeskId, registered_by: access.userId }));
            setLabel(""); setRustdeskId("");
          }}>
            <input aria-label="Enhetsnamn" className={inputClass} placeholder="Enhetsnamn" value={label} onChange={(event) => setLabel(event.target.value)} required maxLength={120}/>
            <input aria-label="RustDesk-ID" className={inputClass} placeholder="Numeriskt RustDesk-ID" inputMode="numeric" value={rustdeskId} onChange={(event) => setRustdeskId(event.target.value)} required/>
            <button disabled={busy} className="rounded-lg border border-line px-3 py-2 text-sm">Registrera enhet</button>
          </form>}</div>
        <div><h3 className="font-semibold">Fjärrsupporthistorik</h3>
          {canRecord && <div className="mt-2 flex flex-wrap gap-2"><select aria-label="Välj enhet" className={inputClass} value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
            <option value="">Välj enhet</option>{data.devices.filter((device) => device.is_active).map((device) => <option key={device.id} value={device.id}>{device.label}</option>)}
          </select><button disabled={busy || !deviceId} className="rounded-lg border border-line px-3 py-2 text-sm" onClick={() => {
            if (!supabase || !access || !ticket.organization_id || !deviceId) return;
            void mutate(() => supabase.from(TABLE.deskSessions).insert({ organization_id: ticket.organization_id, ticket_id: ticket.id, device_id: deviceId, technician_id: access.userId }));
          }}>Begärd session</button></div>}
          {data.sessions.length === 0 ? <p className="mt-2 text-sm text-muted">Ingen fjärrsupport registrerad.</p> : <ol className="mt-3 space-y-4">{data.sessions.map((session) =>
            <li key={session.id} className="rounded-lg border border-line p-3 text-sm">
              <p><strong>{data.devices.find((device) => device.id === session.device_id)?.label ?? "Okänd enhet"}</strong> · Ansvarig tekniker: {data.names[session.technician_id] ?? session.technician_id}</p>
              <p>Begärd session: {when(session.requested_at)}</p>
              <p>Registrerat kundgodkännande: {session.consent_recorded_at ? `${when(session.consent_recorded_at)} · ${session.consent_method} · ${session.consent_note}` : "Ej registrerat"}</p>
              <p>Manuellt registrerad start: {when(session.started_at)}</p>
              <p>Manuellt registrerat avslut: {when(session.ended_at)}</p>
              <p className="text-muted">Källa: manuellt registrerad · faktisk anslutningsstatus: okänd</p>
              {canRecord && !session.consent_recorded_at && <div className="mt-2 flex flex-wrap gap-2">
                <select aria-label="Godkännandemetod" className={inputClass} value={method} onChange={(event) => setMethod(event.target.value)}>
                  <option value="phone">Telefon</option><option value="chat">Chatt</option><option value="email">E-post</option><option value="in_person">På plats</option><option value="other">Annat</option>
                </select>
                <input aria-label="Anteckning om kundgodkännande" className={inputClass} placeholder="Vem godkände och hur?" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000}/>
                <button disabled={busy || !note.trim()} className="rounded-lg border border-line px-3 py-2" onClick={() => {
                  if (!supabase) return;
                  void mutate(() => supabase.from(TABLE.deskSessions).update({ consent_method: method, consent_note: note.trim(), consent_recorded_at: new Date().toISOString() }).eq("id", session.id));
                  setNote("");
                }}>Registrera godkännande</button>
              </div>}
              {canRecord && session.consent_recorded_at && !session.started_at && <button disabled={busy} className="mt-2 text-berry-2 underline" onClick={() => {
                if (supabase) void mutate(() => supabase.from(TABLE.deskSessions).update({ started_at: new Date().toISOString() }).eq("id", session.id));
              }}>Registrera manuell start</button>}
              {access?.isStaff && session.started_at && !session.ended_at && <button disabled={busy} className="mt-2 text-berry-2 underline" onClick={() => {
                if (supabase) void mutate(() => supabase.from(TABLE.deskSessions).update({ ended_at: new Date().toISOString() }).eq("id", session.id));
              }}>Registrera manuellt avslut</button>}
              <ul className="mt-2 text-xs text-muted">{data.events.filter((event) => event.session_id === session.id).map((event) =>
                <li key={event.id}>{when(event.created_at)} · {event.action} · {event.actor_id ? data.names[event.actor_id] ?? event.actor_id : "System"}</li>)}</ul>
            </li>)}</ol>}
        </div>
      </>}
  </section>;
}
