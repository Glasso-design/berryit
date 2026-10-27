"use client";
import { cloneElement,useCallback,useEffect,useId,useState,type ReactElement } from 'react';
import type { AccessAction,AccessCatalog,AccessClient,ProjectRecord,RoleRecord,RepositoryRequest,RepositoryResult } from '../project-access';
import {statusLabel,lastCheckedLabel,isStale} from '../connectors';
import {ProjectControlWorkspace} from './ProjectControlWorkspace';
import type {ProjectControlClient} from '../project-control';
import {requestedProjectNames} from '../project-candidates';

type Person={id:string;name:string|null;email:string|null;is_active:boolean};
type Impact={fingerprint:string;assignments:{grant_id:string;user_id:string;organization_id:string|null;project_id:string|null}[]};
type Details={assignments:{id:string;name:string|null;role:string;expires_at:string|null}[];activity:{action:string;actor_id:string;created_at:string;reason:string}[];reviews:{id:string;author_id:string;body:string;created_at:string}[]};
const inputClass='w-full rounded-xl border border-line bg-ink px-3 py-2 text-sm';
const buttonClass='rounded-xl border border-line px-4 py-2 text-sm hover:bg-fog/10 disabled:opacity-40';
const value=(data:FormData,key:string)=>String(data.get(key)??'').trim();
const optional=(data:FormData,key:string)=>value(data,key)||null;
const message=(error:unknown)=>error instanceof Error?error.message:typeof error==='object'&&error&&'message'in error?String(error.message):'Begäran kunde inte slutföras.';

/** Presentation only: database RPC/RLS authorizes every request independently. */
export function ProjectAccessWorkspace({client,initialTab='projects',control,onOpenTicket,onOpenFactory,onOpenAi}:{client:AccessClient;initialTab?:'projects'|'roles';control?:ProjectControlClient;onOpenTicket?:(reference:string)=>void;onOpenFactory?:(project:string,product:string)=>void;onOpenAi?:(project:string,organization:string)=>void}){
 const [catalog,setCatalog]=useState<AccessCatalog|null>(null);
 const [tab,setTab]=useState(initialTab);
 const [selected,setSelected]=useState<ProjectRecord|null>(null);
 const [editing,setEditing]=useState(false);
 const [role,setRole]=useState<RoleRecord|null>(null);
 const [copy,setCopy]=useState(false);
 const [impact,setImpact]=useState<Impact|null>(null);
 const [people,setPeople]=useState<Person[]>([]);
 const [org,setOrg]=useState('');
 const [details,setDetails]=useState<Details|null>(null);
 const [error,setError]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [repository,setRepository]=useState<RepositoryResult|null>(null);
 const reload=useCallback(async()=>{setCatalog(await client.request<AccessCatalog>({action:'catalog'}));},[client]);
 useEffect(()=>{let active=true;client.request<AccessCatalog>({action:'catalog'}).then(c=>{if(active)setCatalog(c);}).catch(e=>{if(active)setError(message(e));});return()=>{active=false;};},[client]);
 const run=async(action:AccessAction)=>{
  setError(null);setNotice('');setBusy(true);
  try{await client.request(action);await reload();setNotice('Ändringen är registrerad och revisionsloggad.');setImpact(null);return true;}
  catch(e){setError(message(e));return false;}finally{setBusy(false);}
 };
 const directory=async(organization:string)=>{
  setOrg(organization);setPeople([]);setError(null);
  try{setPeople((await client.request<{users:Person[]}>({action:'directory',org:organization||null})).users);}catch(e){setError(message(e));}
 };
 const openProject=async(p:ProjectRecord)=>{
  setSelected(p);setEditing(false);setDetails(null);setRepository(null);setError(null);
  try{setDetails(await client.request<Details>({action:'details',project:p.id}));}catch(e){setError(message(e));}
 };
 const orgName=(id:string|null)=>catalog?.organizations.find(o=>o.id===id)?.name??(id??'Global');
 const projectName=(id:string|null)=>catalog?.projects.find(p=>p.id===id)?.name??id??'Alla projekt inom scope';
 const personName=(id:string)=>people.find(p=>p.id===id)?.name??people.find(p=>p.id===id)?.email??id;
 return <div className="space-y-6">
  <header><h1 className="font-display text-3xl font-semibold">Projekt och åtkomst</h1><p className="mt-2 text-sm text-muted">Gemensamt projektregister. Ändringar prövas av backend och loggas.</p></header>
  <div className="flex flex-wrap gap-3"><button className={buttonClass} onClick={()=>setTab('projects')}>Projekt</button><button className={buttonClass} onClick={()=>setTab('roles')}>Användare och roller</button><button className={buttonClass} disabled={busy} onClick={()=>{setError(null);reload().catch(e=>setError(message(e)));}}>Läs om / försök igen</button></div>
  {error&&<p role="alert" className="rounded-xl border border-berry p-4">{error}</p>}
  {notice&&<p role="status" className="text-sm text-signal">{notice}</p>}
  {!catalog?<p>Hämtar serverns register…</p>:tab==='projects'?<>
   {catalog.authority.permissions.includes('projects.manage')&&<button className={buttonClass} onClick={()=>{setSelected(null);setEditing(true);setDetails(null);}}>+ Lägg till projekt</button>}
   {control&&catalog.authority.permissions.includes('projects.manage')&&<details><summary>Registrera önskade projekt i samma register</summary><p className="text-sm text-muted">Välj faktisk ansvarig organisation. Namnen är användarens önskemål; teknik, adresser, avtal och affärsägande är inte verifierade. Befintliga namn återanvänds, inga externa resurser skapas.</p>
    <form className="space-y-3" onSubmit={e=>{e.preventDefault();const form=e.currentTarget,f=new FormData(form);void run({action:'registerProjects',org:value(f,'registrationOrg'),names:f.getAll('candidate').map(String),reason:value(f,'reason')});}}>
     <Field label="Ansvarig organisation för registreringen"><select name="registrationOrg" required className={inputClass}><option value="">Välj befintlig organisation</option>{catalog.organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
     <fieldset><legend>Projektnamn utan tekniska antaganden</legend>{requestedProjectNames.map(name=><label className="block" key={name}><input type="checkbox" name="candidate" value={name} defaultChecked/> {name}</label>)}</fieldset><Reason/><button className={buttonClass} disabled={busy}>Registrera valda projekt / återanvänd befintliga</button>
    </form></details>}
   <div className="grid gap-4 md:grid-cols-2">{[true,false].map(internal=><section key={String(internal)} className="space-y-3"><h2 className="font-display text-lg">{internal?'Interna projekt':'Kundprojekt'}</h2>
    {catalog.projects.filter(p=>catalog.organizations.find(o=>o.id===p.organization_id)?.is_internal===internal).map(p=><button key={p.id} className="block w-full rounded-xl border border-line bg-ink-2 p-4 text-left" onClick={()=>void openProject(p)}><strong>{p.name}</strong><span className="block text-xs text-muted">{orgName(p.organization_id)} · {p.environment} · {p.archived_at?'Arkiverat':p.status} · källa: {p.source}</span><span className="text-sm text-muted">{p.description}</span></button>)}
   </section>)}</div>
   {selected&&!editing&&<section className="space-y-4 rounded-2xl border border-line p-5">{!control&&<h2 className="font-display text-xl">{selected.name}</h2>}
    {control&&<ProjectControlWorkspace key={selected.id} client={control} project={selected.id} onOpenTicket={onOpenTicket} onOpenFactory={onOpenFactory} onOpenAi={onOpenAi}/>}
    <details open={!control}><summary>Projektadministration, tilldelningar och resurskopplingar</summary><div className="mt-4 space-y-4">
    <p>{selected.description}</p><p className="text-sm text-muted">{selected.repository_url??'Inget repository'} · {selected.website_url??'Ingen webbadress'}</p>
    <p className="text-xs text-muted">Registrerad projektstatus är ingen verifierad driftstatus. Mätningar visas i Infrastruktur/Monitoring.</p>
    {catalog.authority.permissions.includes('repositories.read')&&<section className="space-y-3"><h3 className="font-semibold">Kodgranskning via serverns läsanslutning</h3>
     <form className="space-y-3" onSubmit={async e=>{e.preventDefault();setError(null);setRepository(null);const f=new FormData(e.currentTarget);try{
      if(!client.repository)throw new Error('Serverbaserad repositoryläsare är inte konfigurerad.');
      setRepository(await client.repository({project:selected.id,kind:value(f,'kind') as RepositoryRequest['kind'],ref:value(f,'ref'),path:value(f,'path'),page:Number(value(f,'page')||'1')}));
     }catch(e){setError(message(e));}}}>
      <Field label="Visa"><select name="kind" className={inputClass}><option value="branches">Branches</option><option value="commits">Commits</option><option value="pulls">Pull requests</option><option value="files">Filer / katalog</option></select></Field>
      <Field label="Branch / ref (valfri)"><input name="ref" maxLength={200} className={inputClass}/></Field><Field label="Filsökväg (valfri)"><input name="path" maxLength={1000} className={inputClass}/></Field><Field label="Sida"><input type="number" name="page" min={1} max={10000} defaultValue={1} className={inputClass}/></Field><button className={buttonClass}>Läs repository</button>
     </form>
     {repository&&<><p className="text-sm">{repository.repository} · endast läsning · sida {repository.page}{repository.mayHaveMore?' · fler sidor kan finnas':''}</p>{repository.kind==="files"&&repository.entries.some(f=>typeof f.content==="string")?repository.entries.map((f,n)=><section key={n}><h4 className="text-sm">{String(f.path??"")}</h4><pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs">{String(f.content??"")}</pre></section>):<pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(repository.entries,null,2)}</pre>}</>}
     <p className="text-xs text-muted">Inga tokens eller skrivkommandon lämnas till klienten. Föreslagna kodändringar hanteras genom separat godkänt arbetsflöde.</p>
     {catalog.authority.permissions.includes('repositories.review')&&<form className="space-y-3" onSubmit={async e=>{e.preventDefault();const form=e.currentTarget;const f=new FormData(form);if(await run({action:'review',project:selected.id,body:value(f,'body'),reason:value(f,'reason')})){form.reset();await openProject(selected);}}}>
      <Field label="Kodförslag / granskningsanteckning"><textarea name="body" required maxLength={20000} className={inputClass}/></Field><Reason/><button className={buttonClass} disabled={busy}>Registrera kodförslag i BerryIT</button>
     </form>}
     <ul className="space-y-3">{details?.reviews?.map(n=><li key={n.id} className="rounded-xl border border-line p-3"><p className="text-xs text-muted">{n.created_at} · {n.author_id}</p><p className="whitespace-pre-wrap text-sm">{n.body}</p></li>)}</ul>
    </section>}
    {catalog.authority.permissions.includes('projects.manage')&&<button className={buttonClass} onClick={()=>{setEditing(true);void directory(selected.organization_id);}}>Redigera / arkivera</button>}
    <h3 className="font-semibold">Tilldelade användare</h3><ul>{details?.assignments.map(g=><li key={g.id} className="text-sm">{g.name??'Användare'} — {g.role}{g.expires_at?' · till '+g.expires_at:''}</li>)}</ul>
    <h3 className="font-semibold">Behöriga supportärenden</h3><ul>{catalog.tickets.filter(t=>t.project_id===selected.id).map(t=><li key={t.id}>{t.reference} · {t.subject}</li>)}</ul>
    <h3 className="font-semibold">Tjänster och servrar</h3><ul>{catalog.services.filter(s=>s.project_id===selected.id).map(s=><li key={s.id}>{s.name} · {catalog.nodes.find(n=>n.id===s.node_id)?.name??'Ingen synlig server'}<ServiceHealth status={catalog.statusChecks.find(c=>c.service_id===s.id)}/></li>)}</ul>
    <h3 className="font-semibold">Integrationer och ursprung</h3><ul>{catalog.integrations.filter(i=>i.project_id===selected.id).map(i=><li key={i.id}>{i.display_name} · {i.status}</li>)}{catalog.identities.filter(i=>i.project_id===selected.id).map(i=><li key={i.id}>{i.provider}: {i.external_id}
    {catalog.authority.permissions.includes('connectors.manage')&&<button className={buttonClass} onClick={()=>{const reason=window.prompt('Orsak till att ta bort registerkopplingen (extern resurs bevaras)');if(reason)void run({action:'unlink',id:i.id,reason});}}>Ta bort felaktig koppling</button>}</li>)}</ul>
    {catalog.authority.permissions.includes('connectors.manage')&&<>
     <form className="space-y-3" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await run({action:'link',project:selected.id,kind:value(f,'kind') as 'service'|'integration'|'ticket',resource:value(f,'resource'),reason:value(f,'reason')});}}>
      <h3 className="font-semibold">Koppla befintlig tjänst eller integration</h3>
      <Field label="Resurstyp"><select name="kind" className={inputClass}><option value="service">Tjänst</option><option value="integration">Integration</option><option value="ticket">Supportärende</option></select></Field>
      <Field label="Resurs"><select name="resource" required className={inputClass}><option value="">Välj registrerad resurs</option>{catalog.tickets.filter(t=>t.organization_id===selected.organization_id).map(t=><option value={t.id} key={t.id}>Ärende: {t.reference} · {t.subject}</option>)}{catalog.services.filter(s=>s.organization_id===selected.organization_id).map(s=><option value={s.id} key={s.id}>Tjänst: {s.name}</option>)}{catalog.integrations.filter(i=>i.organization_id===selected.organization_id&&['project','organization'].includes(i.scope_kind)).map(i=><option value={i.id} key={i.id}>Integration: {i.display_name}</option>)}</select></Field><Reason/><button disabled={busy} className={buttonClass}>Koppla</button>
     </form>
     <form className="space-y-3" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await run({action:'service',project:selected.id,name:value(f,'name'),node:optional(f,'node'),kind:'web',environment:selected.environment as 'development'|'staging'|'production',url:optional(f,'url'),reason:value(f,'reason')});}}>
      <h3 className="font-semibold">Registrera tjänst på server</h3><Field label="Tjänstens namn"><input name="name" required minLength={2} maxLength={120} className={inputClass}/></Field><Field label="Server"><select name="node" className={inputClass}><option value="">Ingen server</option>{catalog.nodes.filter(n=>n.organization_id===selected.organization_id).map(n=><option value={n.id} key={n.id}>{n.name}</option>)}</select></Field><Field label="Tjänstens URL (valfri)"><input type="url" name="url" className={inputClass}/></Field><Reason/><button disabled={busy} className={buttonClass}>Registrera koppling</button>
     </form><p className="text-xs text-muted">Registreringen startar eller driftsätter ingenting.</p>
    </>}
    <h3 className="font-semibold">Projektaktiviteter</h3><ul>{details?.activity.map((a,n)=><li key={n} className="text-sm">{a.created_at} · {a.actor_id??"System"} · {a.action} · {a.reason}</li>)}</ul>
    </div></details>
   </section>}
   {editing&&<form key={selected?.id??'new'} className="space-y-4 rounded-2xl border border-line p-5" onSubmit={async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);const values:Record<string,unknown>={name:value(f,'name'),description:value(f,'description'),status:value(f,'status'),environment:value(f,'environment'),website_url:optional(f,'website'),repository_url:optional(f,'repo'),contact_id:optional(f,'contact')};
    if(selected)values.archived=f.get('archived')==='on';
    if(await run({action:'project',id:selected?.id??null,org:selected?.organization_id??value(f,'org'),values,reason:value(f,'reason'),revision:selected?.revision??null})){setEditing(false);setSelected(null);}
   }}><h2 className="font-display text-xl">{selected?'Redigera projekt':'Nytt projekt'}</h2>
    <Field label="Projektnamn"><input name="name" required minLength={2} maxLength={120} defaultValue={selected?.name} className={inputClass}/></Field>
    <Field label="Ansvarig organisation"><select name="org" required disabled={!!selected} defaultValue={selected?.organization_id??''} className={inputClass} onChange={e=>void directory(e.target.value)}><option value="">Välj organisation</option>{catalog.organizations.map(o=><option value={o.id} key={o.id}>{o.name} ({o.is_internal?'internt':'kund'})</option>)}</select></Field>
    <Field label="Beskrivning"><textarea name="description" maxLength={4000} defaultValue={selected?.description} className={inputClass}/></Field>
    <Field label="Status"><select name="status" defaultValue={selected?.status??'active'} className={inputClass}>{['planned','active','paused','completed'].map(s=><option key={s}>{s}</option>)}</select></Field>
    <Field label="Miljö"><select name="environment" defaultValue={selected?.environment??'development'} className={inputClass}>{['development','staging','production'].map(s=><option key={s}>{s}</option>)}</select></Field>
    <Field label="Kontakt / projektansvarig (valfri)"><select name="contact" defaultValue={selected?.contact_id??''} className={inputClass}><option value="">Ingen vald</option>{people.map(p=><option value={p.id} key={p.id}>{p.name??p.email}</option>)}</select></Field>
    <Field label="GitHub / repository (HTTPS, valfritt)"><input name="repo" type="url" defaultValue={selected?.repository_url??''} maxLength={500} className={inputClass}/></Field>
    <Field label="Webbadress (HTTPS, valfri)"><input name="website" type="url" defaultValue={selected?.website_url??''} maxLength={500} className={inputClass}/></Field>
    {selected&&<label className="block text-sm"><input type="checkbox" name="archived" defaultChecked={!!selected.archived_at}/> Arkiverat (externa resurser och data bevaras)</label>}<Reason/>
    <button className={buttonClass} disabled={busy}>Spara projekt</button><button type="button" className={buttonClass} onClick={()=>setEditing(false)}>Avbryt</button>
   </form>}
  </>:<>
   <p className="text-sm text-muted">Rollnamn är fria. Rättigheter väljs ur serverns register. Standardroller och systemägare är skyddade.</p>
   <div className="grid gap-3 md:grid-cols-2">{catalog.roles.map(r=><button key={r.key} className="rounded-xl border border-line p-4 text-left" onClick={()=>{setRole(r);setCopy(r.is_system);setImpact(null);}}><strong>{r.label}</strong><p className="text-xs text-muted">{r.is_system?'Skyddad standardroll':orgName(r.organization_id)} · {r.is_active?'Aktiv':'Inaktiverad'}</p><p className="text-sm">{r.description}</p></button>)}</div>
   {catalog.authority.permissions.includes('roles.manage')&&<>
    <button className={buttonClass} onClick={()=>{setRole(null);setCopy(false);setImpact(null);}}>+ Skapa roll</button>
    {role&&<label className="block text-sm"><input type="checkbox" checked={copy} disabled={role.is_system} onChange={e=>{setCopy(e.target.checked);setImpact(null);}}/> Skapa kopia av vald roll</label>}
    <form key={(role?.key??'new')+String(copy)} className="space-y-4 rounded-2xl border border-line p-5" onSubmit={async e=>{
     e.preventDefault();const f=new FormData(e.currentTarget);if(await run({action:'role',key:copy?null:role?.key??null,label:value(f,'label'),description:value(f,'description'),permissions:f.getAll('permission').map(String),org:role&&!copy?role.organization_id:optional(f,'org'),active:f.get('active')==='on',reason:value(f,'reason'),revision:copy?null:role?.revision??null,impact:impact?.fingerprint??null})){setRole(null);setCopy(false);}
    }}><h2 className="font-display text-xl">{role&&!copy?'Redigera roll':'Ny roll / kopia'}</h2>
     <Field label="Rollnamn"><input name="label" required minLength={2} maxLength={120} defaultValue={copy&&role?role.label+' kopia':role?.label} className={inputClass}/></Field>
     <Field label="Beskrivning"><textarea name="description" maxLength={2000} defaultValue={role?.description} className={inputClass}/></Field>
     <Field label="Rollmallens organisation"><select name="org" defaultValue={role?.organization_id??''} disabled={!!role&&!copy} className={inputClass}><option value="">Global mall (kräver global rättighet)</option>{catalog.organizations.map(o=><option value={o.id} key={o.id}>{o.name}</option>)}</select></Field>
     <fieldset className="space-y-2"><legend>Behörigheter</legend>{catalog.permissions.map(p=><label key={p.key} className="block text-sm"><input type="checkbox" name="permission" value={p.key} defaultChecked={catalog.rolePermissions.some(rp=>rp.role_key===role?.key&&rp.permission_key===p.key)}/> {p.description} <span className="text-xs text-muted">({p.key}{p.requires_mfa?', MFA':''})</span></label>)}</fieldset>
     <label className="block"><input type="checkbox" name="active" defaultChecked={role?.is_active??true}/> Aktiv roll</label>
     {role&&!copy&&<><button type="button" className={buttonClass} onClick={async()=>{try{setImpact(await client.request<Impact>({action:'impact',role:role.key}));}catch(e){setError(message(e));}}}>Förhandsgranska berörda användare</button>
      {impact&&<section className="text-sm"><p>{impact.assignments.length} aktiva tilldelningar påverkas:</p><ul>{impact.assignments.map(g=><li key={g.grant_id}>{personName(g.user_id)} · {orgName(g.organization_id)} · {projectName(g.project_id)}</li>)}</ul></section>}</>}
     <Reason/><button disabled={busy||!!role&&!copy&&!impact} className={buttonClass}>Spara roll</button>
    </form>
   </>}
   {catalog.authority.permissions.includes('roles.grant')&&<section className="space-y-4 rounded-2xl border border-line p-5"><h2 className="font-display text-xl">Användare och tilldelningar</h2>
    <Field label="Organisation att administrera"><select value={org} className={inputClass} onChange={e=>void directory(e.target.value)}><option value="">Global administration</option>{catalog.organizations.map(o=><option value={o.id} key={o.id}>{o.name}</option>)}</select></Field><button className={buttonClass} onClick={()=>void directory(org)}>Hämta användare</button>
    <ul className="space-y-3">{people.map(p=><li key={p.id}><strong>{p.name??p.email??p.id}</strong><span className="ml-3 text-sm text-muted">{p.is_active?'Aktiv':'Inaktiv'}</span>
     {catalog.authority.permissions.includes('users.manage')&&<button className={buttonClass} onClick={()=>{const reason=window.prompt('Orsak till kontoändringen');if(reason)void run({action:'userActive',user:p.id,active:!p.is_active,reason}).then(ok=>{if(ok)void directory(org);});}}>{p.is_active?'Inaktivera':'Återaktivera'}</button>}
     <ul>{catalog.grants.filter(g=>g.grantee_id===p.id).map(g=><li key={g.id} className="text-sm">{catalog.roles.find(r=>r.key===g.role_key)?.label??g.role_key} · {orgName(g.organization_id)} · {projectName(g.project_id)} · {g.revoked_at?'Återkallad':g.expires_at?'Gäller till '+g.expires_at:'Utan sluttid'}
      {!g.revoked_at&&<button className={buttonClass} onClick={()=>{const reason=window.prompt('Orsak till återkallelse');if(reason)void run({action:'revoke',id:g.id,reason});}}>Återkalla</button>}</li>)}</ul>
    </li>)}</ul>
    <form className="space-y-3" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await run({action:'grant',user:value(f,'user'),role:value(f,'role'),org:org||null,project:optional(f,'project'),expires:value(f,'expires')?new Date(value(f,'expires')).toISOString():null,reason:value(f,'reason'),external:f.get('external')==='on',company:optional(f,'company'),commissioner:optional(f,'commissioner')});}}>
     <h3 className="font-semibold">Tilldela roll</h3><Field label="Användare"><select name="user" required className={inputClass}><option value="">Välj befintligt konto</option>{people.map(p=><option key={p.id} value={p.id}>{p.name??p.email}</option>)}</select></Field>
     <Field label="Roll"><select name="role" required className={inputClass}><option value="">Välj roll</option>{catalog.roles.filter(r=>r.is_active).map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select></Field>
     <Field label="Projektbegränsning"><select name="project" className={inputClass}><option value="">Alla projekt inom valt scope</option>{catalog.projects.filter(p=>p.organization_id===org).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
     <Field label="Giltig till (valfritt för intern personal)"><input type="datetime-local" name="expires" className={inputClass}/></Field><label className="block"><input type="checkbox" name="external"/> Extern konsult (kräver organisation, företag och sluttid)</label>
     <Field label="Konsultföretag"><input name="company" maxLength={200} className={inputClass}/></Field><Field label="Uppdragsgivare"><select name="commissioner" className={inputClass}><option value="">Välj vid externt uppdrag</option>{catalog.organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></Field><Reason/><button disabled={busy} className={buttonClass}>Begär tilldelning</button>
    </form>
   </section>}
   <section><h2 className="font-display text-lg">Revisionshistorik</h2><ul>{catalog.audit.map(a=><li key={a.id} className="text-sm">{a.created_at} · {a.action} · {a.reason}</li>)}</ul></section>
  </>}
 </div>;
}
function Field({label,children}:{label:string;children:ReactElement<{id?:string}>}){
 const id=useId();return <div className="space-y-1 text-sm"><label htmlFor={id} className="block">{label}</label>{cloneElement(children,{id})}</div>;
}
function Reason(){return <Field label="Orsak till ändring"><input name="reason" minLength={3} maxLength={1000} required className={inputClass}/></Field>;}

function ServiceHealth({status}:{status:AccessCatalog["statusChecks"][number]|undefined}){
 if(!status)return <span className="ml-3 text-xs text-muted">Ingen mätning</span>;
 return <span className="ml-3 text-xs text-muted">{statusLabel(status.status_key)} · {lastCheckedLabel(status.checked_at)}{isStale(status.checked_at)?" · inte färsk":""} · {status.source}</span>;
}
