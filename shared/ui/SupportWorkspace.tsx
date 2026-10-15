"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { SupportClient, SupportOverview, Ticket, TicketDetail } from "../support-workflow";

const button="rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50";
const field="w-full rounded-lg border border-field bg-ink px-3 py-2 text-sm text-paper";
const when=(value:string|null)=>value ? new Date(value).toLocaleString("sv-SE") : "Ej registrerat";
const chronological=<T extends {created_at:string;id:string}>(rows:T[])=>[...rows].sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id));
const eventLabel:Record<string,string>={created:"Skapat",status_changed:"Status ändrad",priority_changed:"Prioritet ändrad",category_changed:"Kategori ändrad",assigned:"Tekniker tilldelad",customer_message:"Meddelande",internal_note:"Intern anteckning",attachment_added:"Bilaga registrerad"};

export function SupportWorkspace({client,userId,focus=null,renderAdditional}:{client:SupportClient;userId:string;focus?:string|null;renderAdditional?:(ticket:Ticket)=>ReactNode}) {
  const [data,setData]=useState<SupportOverview|null>(null);
  const [selected,setSelected]=useState<string|null>(null);
  const [detail,setDetail]=useState<TicketDetail|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<string|null>(null);
  useEffect(()=>{
    let cancelled=false;
    client.overview().then(value=>{if(!cancelled){setData(value);if(focus)setSelected(value.tickets.find(ticket=>ticket.reference===focus||ticket.id===focus)?.id??null);}}).catch(cause=>{if(!cancelled)setError(String(cause.message??cause));});
    return()=>{cancelled=true;};
  },[client,focus]);
  useEffect(()=>{
    let cancelled=false;
    if(selected) client.detail(selected).then(value=>{if(!cancelled)setDetail(value);}).catch(cause=>{if(!cancelled){setDetail(null);setError(String(cause.message??cause));}});
    return()=>{cancelled=true;};
  },[client,selected]);
  async function refresh(id=selected) {
    setDetail(null);
    const overview=await client.overview();setData(overview);
    if(id){const value=await client.detail(id);setDetail(value);setSelected(id);}
  }
  async function perform(action:()=>Promise<void>,message:string,form?:HTMLFormElement){
    setBusy(true);setError(null);setNotice(null);
    try{await action();form?.reset();await refresh();setNotice(message);}
    catch(cause){setError(cause instanceof Error?cause.message:String(cause));setDetail(null);}
    finally{setBusy(false);}
  }
  const ticket=detail?.ticket;
  const closed=Boolean(ticket&&["lost","stangt"].includes(ticket.status_key));
  const status=(key:string)=>data?.statuses.find(item=>item.key===key)?.label??key;
  return <section aria-label="Support Desk" className="space-y-6">
    <header><h1 className="font-display text-3xl font-semibold">Support Desk</h1><p className="mt-2 text-muted">Manuell support från kundkontakt till avslut och återöppning.</p></header>
    {error&&<p role="alert" className="rounded-lg border border-berry p-3">{error}</p>}
    {notice&&<p role="status" className="rounded-lg border border-line p-3">{notice}</p>}
    <button type="button" className={button} disabled={busy} onClick={()=>void perform(()=>Promise.resolve(),"Ärenden uppdaterade.")}>Uppdatera ärenden</button>
    {!data?<p>Hämtar ärenden…</p>:<>
      <form aria-label="Skapa supportärende" className="space-y-3 rounded-xl border border-line p-5" onSubmit={event=>{
        event.preventDefault();const form=event.currentTarget;const values=new FormData(form);
        setBusy(true);setError(null);setNotice(null);
        void client.create({customerId:String(values.get("customerId")),subject:String(values.get("subject")),description:String(values.get("description")),category_key:String(values.get("category_key"))}).then(async id=>{form.reset();await refresh(id);setNotice("Ärendet är skapat.");}).catch(cause=>setError(String(cause.message??cause))).finally(()=>setBusy(false));
      }}><h2 className="text-xl font-semibold">Nytt supportärende</h2>
        <label className="block text-sm">Välj kund<select aria-label="Välj kund" name="customerId" className={field} required defaultValue={data.customers.some(customer=>customer.id===userId)?userId:""}><option value="">Välj befintlig kund</option>{data.customers.map(customer=><option key={customer.id} value={customer.id}>{customer.full_name||customer.email||"Kund"} · {customer.organization_id ? data.organizations.find(org=>org.id===customer.organization_id)?.name??"Företagskund":"Privatperson"}</option>)}</select></label>
        <p className="text-xs text-muted">Ny kund registreras i Kunder av behörig administratör. Privatperson kräver ingen organisation.</p>
        <label className="block text-sm">Ämne<input name="subject" className={field} required minLength={3} maxLength={200}/></label>
        <label className="block text-sm">Beskrivning<textarea name="description" className={field} required minLength={10} maxLength={10000} rows={3}/></label>
        <label className="block text-sm">Kategori<select aria-label="Kategori" name="category_key" className={field} required>{data.categories.map(category=><option key={category.key} value={category.key}>{category.label}</option>)}</select></label>
        <button disabled={busy||data.customers.length===0} className={button}>Skapa ärende</button>
      </form>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Behöriga supportärenden</caption><thead><tr><th className="p-2" scope="col">Ärende</th><th className="p-2" scope="col">Ämne</th><th className="p-2" scope="col">Status</th></tr></thead><tbody>{data.tickets.map(row=><tr key={row.id} className="border-t border-line"><td className="p-2"><button type="button" disabled={busy} className="text-berry-2 underline" onClick={()=>{if(selected===row.id){void perform(()=>Promise.resolve(),"Ärendet uppdaterat.");return;}setDetail(null);setError(null);setNotice(null);setSelected(row.id);}}>{row.reference}</button></td><td className="p-2">{row.subject}</td><td className="p-2">{status(row.status_key)}</td></tr>)}</tbody></table>{data.tickets.length===0&&<p>Inga ärenden att visa.</p>}</div>
    </>}
    {ticket&&detail&&<article aria-label="Ärendedetaljer" className="space-y-5 rounded-xl border border-line p-5">
      <header><h2 className="text-2xl font-semibold">{ticket.reference} · {ticket.subject}</h2><p className="mt-2 whitespace-pre-wrap">{ticket.description}</p></header>
      <dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-muted">Kund</dt><dd>{detail.people.find(person=>person.id===ticket.requester_id)?.label??ticket.contact_name??"Kund"}</dd></div><div><dt className="text-muted">Kundtyp</dt><dd>{ticket.organization_id?data?.organizations.find(org=>org.id===ticket.organization_id)?.name??"Företagskund":"Privatperson"}</dd></div><div><dt className="text-muted">Kontakt</dt><dd>{ticket.contact_email} {ticket.contact_phone}</dd></div><div><dt className="text-muted">Ansvarig tekniker</dt><dd>{detail.people.find(person=>person.id===ticket.assignee_id)?.label??(ticket.assignee_id?"Tilldelad tekniker":"Inte tilldelad")}</dd></div><div><dt className="text-muted">Status</dt><dd>{status(ticket.status_key)}</dd></div><div><dt className="text-muted">Löst / avslutat</dt><dd>{when(ticket.resolved_at)} / {when(ticket.closed_at)}</dd></div></dl>
      {detail.canWork&&<section aria-label="Teknikerns åtgärder" className="space-y-3">
        <label className="block text-sm">Tilldela tekniker<select className={field} aria-label="Tilldela tekniker" value={ticket.assignee_id??""} disabled={busy} onChange={event=>{const value=event.target.value||null;void perform(()=>client.update(ticket.id,{assignee_id:value}),"Tilldelningen är uppdaterad.");}}><option value="">Inte tilldelad</option>{ticket.assignee_id&&!detail.technicians.some(person=>person.id===ticket.assignee_id)&&<option value={ticket.assignee_id}>Tidigare tilldelning — rättigheten har upphört</option>}{detail.technicians.map(person=><option key={person.id} value={person.id}>{person.label}{person.is_external?` · Extern · giltig till ${when(person.expires_at)}`:""}</option>)}</select></label>
        <div className="flex flex-wrap gap-2">{!closed&&<><button className={button} disabled={busy} onClick={()=>void perform(()=>client.update(ticket.id,{status_key:"pagar"}),"Ärendet pågår.")}>Markera som pågående</button><button className={button} disabled={busy} onClick={()=>void perform(()=>client.update(ticket.id,{status_key:"vantar_pa_kund"}),"Ärendet väntar på kunden.")}>Väntar på kund</button><button className={button} disabled={busy} onClick={()=>void perform(()=>client.update(ticket.id,{status_key:"lost"}),"Ärendet är löst.")}>Markera som löst</button></>}{ticket.status_key==="lost"&&<button className={button} disabled={busy} onClick={()=>void perform(()=>client.update(ticket.id,{status_key:"stangt"}),"Ärendet är avslutat.")}>Avsluta ärende</button>}</div>
        {closed&&<form aria-label="Återöppna ärende" className="space-y-2" onSubmit={event=>{event.preventDefault();const form=event.currentTarget;void perform(()=>client.reopen(ticket.id,String(new FormData(form).get("reason"))),"Ärendet är återöppnat och orsaken finns i historiken.",form);}}><p className="text-sm text-muted">Orsaken visas även för kunden i ärendehistoriken. Lägg interna uppgifter i arbetsanteckningar.</p><label className="block text-sm">Orsak till återöppning<input name="reason" className={field} required minLength={3} maxLength={1000}/></label><button className={button} disabled={busy}>Återöppna ärende</button></form>}
      </section>}
      <section aria-label="Kundmeddelanden" className="space-y-3"><h3 className="text-xl font-semibold">Kundmeddelanden</h3><ol className="space-y-2">{chronological(detail.messages).map(message=><li key={message.id} className="rounded-lg border border-line p-3"><p className="text-xs text-muted">{message.is_from_staff?"Support":"Kund"} · {when(message.created_at)}</p><p className="mt-1 whitespace-pre-wrap">{message.body}</p></li>)}</ol>
        {(!closed||detail.canWork)&&<form aria-label="Skriv kundmeddelande" onSubmit={event=>{event.preventDefault();const form=event.currentTarget;void perform(()=>client.message(ticket.id,String(new FormData(form).get("body")),detail.canWork),"Kundmeddelandet är registrerat.",form);}}><label className="block text-sm">Nytt kundmeddelande<textarea name="body" className={field} required maxLength={20000}/></label><button className={button} disabled={busy}>Skicka kundmeddelande</button></form>}
      </section>
      {detail.canWork&&<section aria-label="Interna arbetsanteckningar" className="space-y-3"><h3 className="text-xl font-semibold">Interna arbetsanteckningar</h3><p className="text-sm text-muted">Felsökning och åtgärder för behörig personal. Visas inte för kunden. Rättelser läggs till som nya anteckningar.</p><ol className="space-y-2">{chronological(detail.notes).map(note=><li key={note.id} className="rounded-lg border border-line p-3"><p className="text-xs text-muted">{when(note.created_at)}</p><p className="whitespace-pre-wrap">{note.body}</p></li>)}</ol><form aria-label="Dokumentera felsökning" onSubmit={event=>{event.preventDefault();const form=event.currentTarget;void perform(()=>client.note(ticket.id,String(new FormData(form).get("body"))),"Intern arbetsanteckning sparad.",form);}}><label className="block text-sm">Felsökning och utförd åtgärd<textarea className={field} name="body" required maxLength={20000}/></label><button className={button} disabled={busy}>Spara intern anteckning</button></form></section>}
      <section aria-label="Ärendebilagor" className="space-y-3"><h3 className="text-xl font-semibold">Bilagor</h3><ul className="space-y-2">{detail.attachments.map(attachment=><li key={attachment.id} className="rounded-lg border border-line p-3"><span>{attachment.file_name} · {attachment.visibility==="internal"?"Intern":"Kundsynlig"} · {attachment.upload_completed_at?"Uppladdad":"Uppladdning ej slutförd"}</span>{attachment.upload_completed_at?<button className={`${button} ml-2`} disabled={busy} onClick={()=>{
        // Open a blank tab synchronously; no remote session or unsafe scheme.
        const tab=window.open("about:blank","_blank");if(tab)tab.opener=null;
        void client.download(attachment.id).then(url=>{const target=new URL(url);if(!["http:","https:"].includes(target.protocol))throw new Error("Ogiltig nedladdningsadress.");if(tab)tab.location.href=url;else setError("Tillåt ett nytt fönster för att läsa bilagan.");}).catch(cause=>{tab?.close();setError(String(cause.message??cause));});
      }}>Läs bilaga</button>:attachment.uploaded_by===userId&&<form aria-label={`Återuppta ${attachment.file_name}`} onSubmit={event=>{event.preventDefault();const form=event.currentTarget;const file=new FormData(form).get("file");if(file instanceof File)void perform(()=>client.upload(ticket.id,file,attachment.visibility,attachment.id),"Uppladdningen är slutförd.",form);}}><label className="block text-sm">Välj samma fil för att återuppta<input type="file" name="file" className={field} required/></label><button disabled={busy} className={button}>Återuppta uppladdning</button></form>}</li>)}</ul>
        {(!closed||detail.canWork)&&<form aria-label="Ladda upp bilaga" className="space-y-2" onSubmit={event=>{event.preventDefault();const form=event.currentTarget;const values=new FormData(form);const file=values.get("file");if(file instanceof File)void perform(()=>client.upload(ticket.id,file,values.get("visibility")==="internal"?"internal":"customer"),"Bilagan är uppladdad.",form);}}><label className="block text-sm">Välj bilaga (högst 25 MB)<input type="file" name="file" className={field} required/></label>{detail.canWork&&<label className="block text-sm">Bilagans synlighet<select aria-label="Bilagans synlighet" name="visibility" className={field}><option value="customer">Kundsynlig</option><option value="internal">Intern — endast behörig personal</option></select></label>}<button className={button} disabled={busy}>Ladda upp bilaga</button></form>}
      </section>
      <section aria-label="Ärendehistorik"><h3 className="text-xl font-semibold">Historik</h3><ol className="mt-3 space-y-2 text-sm">{chronological(detail.events).map(event=><li key={event.id}><time>{when(event.created_at)}</time> · {event.actor_id ? detail.people.find(person=>person.id===event.actor_id)?.label??(detail.canWork?event.actor_id:"Support"):"System"} · {eventLabel[event.event_type]??event.event_type}{event.from_value&&` · ${event.from_value} → ${event.to_value??""}`}{event.payload.reopened===true&&` · Återöppnat: ${String(event.payload.reason??"")}`}{event.payload.phase==="uploaded"&&" · Uppladdning slutförd"}</li>)}</ol></section>
      {renderAdditional?.(ticket)}
    </article>}
  </section>;
}
