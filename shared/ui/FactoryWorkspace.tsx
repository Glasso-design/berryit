import { useCallback, useEffect, useState } from 'react';
import type { FactoryCatalog, FactoryClient, FactoryItem, FactoryRequest, FactorySnapshot,FactoryProviderStatus } from '../factory';
import { DEFAULT_STORAGE_QUOTA } from '../factory/schema.mjs';

const field='rounded border border-line bg-panel p-2 text-ink';
type Page={items:FactoryItem[];hasMore:boolean};
export function FactoryWorkspace({client,initialProject,initialProduct}:{client:FactoryClient;initialProject?:string;initialProduct?:string}){
 const [catalog,setCatalog]=useState<FactoryCatalog|null>(null),[items,setItems]=useState<FactoryItem[]>([]);
 const [snapshot,setSnapshot]=useState<FactorySnapshot|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[more,setMore]=useState(false),[notice,setNotice]=useState('');
 const [provider,setProvider]=useState<FactoryProviderStatus|null>(null),[approvedMode,setApprovedMode]=useState<'DEDICATED_MANAGED'|'LIMITED_STANDALONE'|'MANAGED_RESOURCE_ISOLATION'>('MANAGED_RESOURCE_ISOLATION'),[modeConsent,setModeConsent]=useState(false);
 const [projectId,setProject]=useState(()=>initialProject??(typeof window==='undefined'?'':new URLSearchParams(window.location.search).get('project')??'')),[productId,setProduct]=useState(()=>initialProduct??(typeof window==='undefined'?'qabgo':new URLSearchParams(window.location.search).get('product')??'qabgo')),[ownerId,setOwner]=useState('');
 const [key,setKey]=useState(()=>crypto.randomUUID()),[note,setNote]=useState(''),[operation,setOperation]=useState<'upgrade'|'suspend'|'backup'|'restore'|'cleanup-review'>('backup');
 const load=useCallback(async()=>{
  const [c,p]=await Promise.all([client.request<FactoryCatalog>({action:'catalog'}),client.request<Page>({action:'list'})]);
  setCatalog(c);setItems(p.items);setMore(p.hasMore);
 },[client]);
 useEffect(()=>{let active=true;Promise.all([client.request<FactoryCatalog>({action:'catalog'}),client.request<Page>({action:'list'})]).then(([c,p])=>{if(active){setCatalog(c);setItems(p.items);setMore(p.hasMore);}}).catch(e=>{if(active)setError(String(e.message));});return()=>{active=false;};},[client]);
 async function run(action:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await action();}catch(e){setError(e instanceof Error?e.message:'Factory-anropet misslyckades.');}finally{setBusy(false);}}
 async function details(jobId:string){const next=await client.request<FactorySnapshot>({action:'details',jobId});setSnapshot(next);setProvider(null);setModeConsent(false);setProvider(await client.request<FactoryProviderStatus>({action:'providerStatus',instanceId:next.instance.id}));}
 async function create(form:FormData){
  const project=catalog?.projects.find(p=>p.id===projectId),product=catalog?.products.find(p=>p.id===productId);
  if(!project||!product?.version)throw Error('Välj ett projekt och en versionsgranskad adapter.');
  const input:FactoryRequest={productId,version:product.version,projectId,organizationId:project.organizationId,ownerId,name:String(form.get('name')),customerName:String(form.get('customerName')),domain:String(form.get('domain')),region:form.get('region') as FactoryRequest['region'],accountMode:form.get('accountMode') as FactoryRequest['accountMode'],emailMode:form.get('emailMode') as FactoryRequest['emailMode'],storageQuotaBytes:Number(form.get('quota')),monthlyBudgetCents:Number(form.get('budget')),idempotencyKey:key,addons:form.getAll('addons').map(String)};
  const id=await client.request<string>({action:'create',input});await details(id);await load();setKey(crypto.randomUUID());
 }
 return <section className="space-y-5" aria-label="Platform Factory">
  <header><h1 className="text-2xl font-semibold">Platform Factory / Instances</h1><p>MOCK / lokal granskning. Ingen molnprovisionering eller produktionsdrift är aktiverad.</p></header>
  <p>Behörighet och MFA kontrolleras av backend vid varje åtgärd. DNS, e-post, kostnader och backup är inte verifierade i verklig drift.</p>
  {error&&<div role="alert">{error} <button onClick={()=>void run(load)}>Försök igen</button></div>}{notice&&<p role="status">{notice}</p>}
  {!catalog&&!error&&<p role="status">Hämtar Factory…</p>}
  {catalog&&<>
   <details><summary>Produktregister och adapterstatus</summary><ul>{catalog.products.map(p=><li key={p.id}>{p.name}: {p.status} · live: {p.liveApproved?'godkänd':'ej godkänd'}</li>)}</ul></details>
   <form className="grid gap-3 md:grid-cols-2" onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);void run(()=>create(form));}}>
    <h2 className="md:col-span-2 text-xl">Skapa ny plattform</h2>
    <label>Produkt/system<select className={field} value={productId} onChange={e=>setProduct(e.target.value)}>{catalog.products.map(p=><option key={p.id} value={p.id}>{p.name} · {p.status}</option>)}</select></label>
    <label>Organisation / projekt<select required className={field} value={projectId} onChange={e=>setProject(e.target.value)}><option value="">Välj projekt</option>{catalog.projects.map(p=><option key={p.id} value={p.id}>{p.name} · {p.organizationId}</option>)}</select></label>
    <label>Ägare (befintlig identitet)<select required className={field} value={ownerId} onChange={e=>setOwner(e.target.value)}><option value="">Välj ägare</option>{catalog.owners.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
    <label>Plattformens namn<input className={field} name="name" required minLength={2} maxLength={120}/></label>
    <label>Kundnamn<input className={field} name="customerName" required minLength={2} maxLength={120}/></label>
    <label>Önskad domän<input className={field} name="domain" required placeholder="kund.example.invalid"/></label>
    <label>Objektlagring (byte)<input className={field} name="quota" type="number" required min={1} max={1000000000000} defaultValue={DEFAULT_STORAGE_QUOTA}/></label>
    <p>Standard för nya plattformar: 1 GB (1 000 000 000 byte). Större kvot kan anges.</p>
    <label>Region<select name="region" className={field}><option value="eu">EU</option><option value="eea">EES</option><option value="us">USA</option></select></label>
    <label>Cloudflare-kontomodell<select name="accountMode" className={field}><option value="DEDICATED_MANAGED">Dedikerat Tenant-konto</option><option value="LIMITED_STANDALONE">Begränsat standalone-konto</option><option value="MANAGED_RESOURCE_ISOLATION">Isolerade resurser i godkänt konto (inget eget konto)</option></select></label>
    <label>E-post<select name="emailMode" className={field}><option value="none">Ingen e-post</option><option value="routing">Routing / alias (ingen inkorg)</option><option value="transactional">Transaktionsmejl · separat provider krävs</option><option value="mailbox">Fullständig mailbox · separat provider krävs</option></select></label>
    <label>Godkänt månatligt budgettak (cent)<input name="budget" className={field} type="number" required min={0} max={1000000} defaultValue={0}/></label>
    <fieldset><legend>Produktspecifika tillägg · kräver separat verifiering</legend>{catalog.products.find(p=>p.id===productId)?.addons.map(a=><label key={a.id} className="block"><input type="checkbox" name="addons" value={a.id}/>{a.title}</label>)}<p>Valda tillägg blockerar aktivering tills leverantör/avtal har verifierats. Inget abonnemang beställs.</p></fieldset>
    <p>Kostnadsestimat: saknas för live. Ingen kostnad eller resursbeställning godkänns genom denna simulering. Databas, runtime, backup och loggar ingår inte i objektkvoten.</p>
    {!catalog.products.find(p=>p.id===productId)?.version&&<p role="status">BLOCKED: vald produkt saknar versionsgranskad adapter. Ingen annan produkt väljs automatiskt.</p>}
    <button className={field} disabled={busy||!catalog.products.find(p=>p.id===productId)?.version}>SKAPA PLATTFORM · MOCK</button>
   </form>
  </>}
  <div><h2 className="text-xl">Instanser</h2><button disabled={busy} onClick={()=>void run(load)}>Uppdatera</button>
   <ul>{items.map(i=><li key={i.id}><button onClick={()=>void run(()=>details(i.id))}>{i.name} · {i.product_id} · {i.state} · {i.execution_mode}</button><p>Ägare: {i.owner_id} · Organisation: {i.organization_id} · {i.created_at} · version {i.version}</p><p>Lagring: {i.used_bytes} + {i.reserved_bytes} reserverade / {i.quota_bytes} byte</p></li>)}</ul>
   {more&&<button disabled={busy} onClick={()=>void run(async()=>{const last=items.at(-1);if(!last)return;const p=await client.request<Page>({action:'list',after:last.created_at,afterId:last.id});setItems(old=>[...old,...p.items]);setMore(p.hasMore);})}>Hämta fler</button>}
  </div>
  {snapshot&&<article className="space-y-3" aria-label="Installationsdetaljer">
   <h2 className="text-xl">{snapshot.instance.name} · {snapshot.job.state}</h2><p>{snapshot.instance.execution_mode} · {snapshot.instance.status} · {snapshot.instance.region} · {snapshot.instance.domain}</p>
   <p>Verklig hälsa, kostnad och backup: okända tills godkända providers verifierats.</p>{snapshot.job.last_error&&<p role="alert">{snapshot.job.last_error}</p>}
   <section className="rounded border border-line p-3 space-y-2" aria-label="Providerstatus">
    <h3>Cloudflare och produktionsgrind</h3>
    <p>Kontomodell: {provider?.accountMode??'Ingen provider verifierad'} · Godkänt modellbyte: {provider?.approvedAccountMode??'Inget'}</p>
    <p>Underlag: {provider?.verification??'UNVERIFIED'} · Observerat: {provider?.observedAt??'Aldrig'}. Äldre observationer kräver ny serverkontroll före drift.</p>
    <p>DNS: {provider?.dns??'UNVERIFIED'} · TLS: {provider?.tls??'UNVERIFIED'} · E-post: {provider?.email??'UNVERIFIED'}. Routing ger ingen fullständig mailbox.</p>
    {provider?.quota&&<p>Lagring: {provider.quota.used_bytes} använda + {provider.quota.reserved_bytes} reserverade / {provider.quota.quota_bytes} byte · varning {provider.quota.warning}% · {provider.quota.blocked?'BLOCKERAD':'Reservationskontroll aktiv'}. Logisk kvot; fysisk lagring och API-anrop faktureras separat.</p>}
    <h4>Provider capabilities</h4><ul>{Object.entries(provider?.capabilities??{}).map(([k,v])=><li key={k}>{k}: {v}</li>)}</ul>
    <p>Saknade rättigheter: {provider?.missingPermissions?.join(', ')||'Inte fullständigt verifierat'}</p>
    <h4>Produktionsblockerare</h4><ul>{(provider?.blockers?.length?provider.blockers:['LIVE_PROVIDER_NOT_VERIFIED','EXTERNAL_BACKUP_AND_RESTORE_REQUIRED','ISOLATED_HTTP_MFA_SSO_GATE_REQUIRED']).map(b=><li key={b}>{b}</li>)}</ul>
    <ul>{provider?.resources.map(r=><li key={r.step}>{r.step}: {r.state} · {r.verification??'UNVERIFIED'} · {r.reference??'Ingen verifierad resursreferens'}</li>)}</ul>
    <p>Kostnadsestimat: {provider?.cost?`${provider.cost.monthlyEstimate.toFixed(4)} ${provider.cost.currency}/månad för angivet objekt-/API-underlag`:'Inget live-underlag'}. Ingen verifierad faktura. Databas, runtime, backup, loggar och skatt tillkommer.</p>
    <details><summary>Separat godkännande av ändrad kontomodell</summary>
     <label>Ny kontomodell<select className={field} value={approvedMode} onChange={e=>{setApprovedMode(e.target.value as typeof approvedMode);setModeConsent(false);}}><option value="MANAGED_RESOURCE_ISOLATION">Delat konto med resursisolering · inget dedikerat konto</option><option value="DEDICATED_MANAGED">Dedikerat Tenant-konto</option><option value="LIMITED_STANDALONE">Begränsat standalone</option></select></label>
     <label><input type="checkbox" checked={modeConsent} onChange={e=>setModeConsent(e.target.checked)}/>Jag godkänner uttryckligen den valda kontomodellen och dess isoleringsnivå.</label>
     <p>Orsak hämtas från underlagsfältet nedan. Backend kräver aktuell MFA och rätt scope. Detta aktiverar ingen provider.</p>
     <button disabled={busy||!modeConsent} onClick={()=>void run(async()=>{await client.request({action:'approveAccountMode',jobId:snapshot.job.id,mode:approvedMode,reason:note});await details(snapshot.job.id);setNotice('Separat kontomodellsgodkännande registrerat. Ingen resurs skapad.');})}>Registrera separat kontomodellsgodkännande</button>
    </details>
   </section>
   <button disabled>Öppna instansadministration · inväntar verifierad driftadress</button>
   <button disabled={busy} onClick={()=>void run(()=>details(snapshot.job.id))}>Hämta framsteg</button>{' '}
   <button disabled={busy} onClick={()=>void run(async()=>{await client.request({action:'retry',jobId:snapshot.job.id});await details(snapshot.job.id);setNotice('Samma jobb återköat. En separat serverworker krävs; webbläsaren utför inga installationssteg.');})}>Återuppta samma jobb</button>
   <label>Underlag / orsak (inga hemligheter)<textarea className={field} value={note} onChange={e=>setNote(e.target.value)} maxLength={1000}/></label>
   <ol>{snapshot.job.checklist.map(c=><li key={c.id}><strong>{c.title}: {c.status}</strong><p>{c.type} · {c.required?'Obligatorisk':'Valfri'} · {c.verificationMethod} · {c.verifiedAt??'Ej verifierad'}</p><p>{c.description} · Beroenden: {c.dependsOn.join(', ')||'Inga'} · {c.error}</p>{c.type==='MANUAL'&&<button disabled={busy} onClick={()=>void run(async()=>{await client.request({action:'manual',jobId:snapshot.job.id,step:c.id,note});await details(snapshot.job.id);})}>Registrera manuellt underlag</button>}<pre className="overflow-auto text-xs">{JSON.stringify(c.evidence??{},null,2)}</pre></li>)}</ol>
   <details><summary>Resurser och tekniskt underlag</summary><pre className="overflow-auto text-xs">{JSON.stringify(snapshot.resources,null,2)}</pre></details>
   <label>Begär separat driftåtgärd<select className={field} value={operation} onChange={e=>setOperation(e.target.value as typeof operation)}><option value="upgrade">Uppgradering</option><option value="suspend">Pausning</option><option value="backup">Backup</option><option value="restore">Återställning</option><option value="cleanup-review">Granskning av cleanup</option></select></label>
   <button disabled={busy} onClick={()=>void run(async()=>{await client.request({action:'operation',instanceId:snapshot.instance.id,operation,reason:note});await details(snapshot.job.id);setNotice('Begäran sparad: WAITING_FOR_APPROVAL. Ingen driftåtgärd utförd.');})}>Registrera begäran</button>
   <details><summary>Revisionshistorik</summary><ul>{snapshot.audit.map(a=><li key={a.id}>{a.created_at} · {a.action}</li>)}</ul></details>
  </article>}
 </section>;
}
