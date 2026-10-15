"use client";

import { useEffect, useState } from "react";
import type { SupportClient, SupportOverview } from "../support-workflow";

const field = "w-full rounded-lg border border-field bg-ink px-3 py-2 text-sm text-paper";
const button = "rounded-lg border border-line px-4 py-2 text-sm disabled:opacity-50";

export function CustomerWorkspace({ client }: { client: SupportClient }) {
  const [data, setData] = useState<SupportOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    client.overview().then(value => { if (!cancelled) setData(value); }).catch(cause => { if (!cancelled) setError(String(cause.message ?? cause)); });
    return () => { cancelled = true; };
  }, [client]);
  async function perform(action: () => Promise<void>, message: string, form: HTMLFormElement) {
    setBusy(true); setError(null); setNotice(null);
    try { await action(); setData(await client.overview()); form.reset(); setNotice(message); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <section className="space-y-6" aria-label="Kundregister">
    <header><h1 className="font-display text-3xl font-semibold">Kunder</h1><p className="mt-2 text-muted">Privatpersoner och företagskunder i samma kundregister.</p></header>
    {error && <p role="alert" className="text-berry-2">{error}</p>}
    {notice && <p role="status" className="rounded-lg border border-line p-3">{notice}</p>}
    {!data ? <p>Hämtar kundregistret…</p> : <>
      <button type="button" className={button} disabled={busy} onClick={() => { setError(null); void client.overview().then(setData).catch(cause => setError(String(cause.message ?? cause))); }}>Uppdatera kundregistret</button>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Registrerade kundpersoner</caption><thead><tr><th className="p-2" scope="col">Kund</th><th className="p-2" scope="col">Kundtyp</th><th className="p-2" scope="col">Kontakt</th><th className="p-2" scope="col">Inloggning</th></tr></thead>
        <tbody>{data.customers.map(customer => <tr key={customer.id} className="border-t border-line"><td className="p-2">{customer.full_name || customer.email || "Kund"}</td><td className="p-2">{customer.organization_id ? data.organizations.find(org => org.id === customer.organization_id)?.name ?? "Företagskund" : "Privatperson"}</td><td className="p-2">{customer.email}<br/>{customer.phone}</td><td className="p-2">{customer.login_activation_pending ? "Aktivering återstår" : "Befintligt konto"}</td></tr>)}</tbody></table>
        {data.customers.length === 0 && <p className="mt-3 text-muted">Inga kundpersoner att visa inom din behörighet.</p>}
      </div>
      <section aria-label="Företagsorganisationer"><h2 className="text-xl font-semibold">Företag</h2><ul className="mt-2 space-y-2">{data.organizations.map(org => <li key={org.id}>{org.name} · {org.org_no ?? "Org.nr saknas"}</li>)}</ul></section>
      {data.canRegister ? <>
        <form aria-label="Registrera kund" className="space-y-3 rounded-xl border border-line p-5" onSubmit={event => {
          event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
          void perform(() => client.register({full_name:String(values.get("full_name")),email:String(values.get("email")),phone:String(values.get("phone") ?? ""),organization_id:String(values.get("organization_id") || "") || null}), "Kund registrerad. Inloggning är spärrad tills en behörig administratör aktiverar kontot separat. Ingen e-post har skickats.", form);
        }}><h2 className="text-xl font-semibold">Registrera kund</h2>
          <p className="text-sm text-muted">Kunden kan väljas för manuell support direkt. Kontoinloggning aktiveras separat av administratör.</p>
          <label className="block text-sm">Kundens namn<input name="full_name" className={field} required minLength={2} maxLength={200}/></label>
          <label className="block text-sm">Kundens e-post<input name="email" type="email" className={field} required maxLength={254}/></label>
          <label className="block text-sm">Telefon<input name="phone" type="tel" className={field} maxLength={60}/></label>
          <label className="block text-sm">Kundens organisation<select name="organization_id" className={field} defaultValue=""><option value="">Privatperson — ingen organisation</option>{data.organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>
          <button disabled={busy} className={button}>Registrera kund utan aktiverad inloggning</button>
        </form>
        <form aria-label="Registrera företag" className="space-y-3 rounded-xl border border-line p-5" onSubmit={event => {
          event.preventDefault(); const form=event.currentTarget; const values=new FormData(form);
          void perform(()=>client.organization(String(values.get("name")),String(values.get("org_no")??"")),"Företaget är registrerat. Lägg till dess kundpersoner separat.",form);
        }}><h2 className="text-xl font-semibold">Registrera företag</h2><label className="block text-sm">Företagsnamn<input name="name" className={field} required minLength={2} maxLength={200}/></label><label className="block text-sm">Organisationsnummer<input name="org_no" className={field} maxLength={30}/></label><button disabled={busy} className={button}>Registrera företag</button></form>
      </> : <p className="text-sm text-muted">Nya kunder och företag registreras av behörig administratör med verifierad tvåfaktor.</p>}
    </>}
  </section>;
}
