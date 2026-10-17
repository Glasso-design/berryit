import { useState } from 'react';
import type { AiDiagnosticPreview } from '@berryit/shared/ai';
import type { AiClient } from './client';

/** Presentation only. Database scope and adapter approval are authoritative. */
export function DiagnosticPanel({client,conversationId,gatewayConfigured,onComplete}:{client:AiClient;conversationId:string;gatewayConfigured:boolean;onComplete:()=>Promise<void>}){
 const [preview,setPreview]=useState<AiDiagnosticPreview|null>(null);
 const [approved,setApproved]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 async function run(analyze:boolean){
  setBusy(true);setError(null);
  try{
   if(analyze&&preview){
    await client.analyzeDiagnostics(conversationId,preview.previewId,approved);
    setPreview(null);await onComplete();
   }else setPreview(await client.previewDiagnostics(conversationId));
  }catch(e){setError(e instanceof Error?e.message:'Analysen misslyckades.');setPreview(null);}
  finally{setBusy(false);setApproved(false);}
 }
 return <section aria-label="Sök felet" className="rounded-2xl border border-berry/30 bg-ink-2 p-4 space-y-3">
  <h3 className="font-display text-lg">Sök felet</h3>
  <p className="text-sm text-muted">Analysera endast registrerat underlag för valt projekt eller vald incident. Ingen server undersöks direkt och inga åtgärder utförs.</p>
  <button type="button" disabled={busy} onClick={()=>void run(false)} className="rounded-full border border-line px-4 py-2 text-sm disabled:opacity-50">Förhandsgranska underlag</button>
  {error&&<p role="alert" className="text-sm text-berry-2">{error}</p>}
  {preview&&<>
   <p className="text-xs text-muted">Godkännandet gäller detta underlag en gång, till {new Date(preview.expiresAt).toLocaleTimeString('sv-SE')}.</p>
   <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border border-line p-3 text-xs" aria-label="Exakt underlag till AI">{JSON.stringify(preview.context,null,2)}</pre>
   <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)}/><span>Jag har granskat underlaget och godkänner att det skickas via ONARLY AI Gateway.</span></label>
   <button type="button" disabled={busy||!approved||!gatewayConfigured} onClick={()=>void run(true)} className="rounded-full bg-berry px-4 py-2 text-sm text-white disabled:opacity-50">{busy?'Analyserar…':'Sök felet – skicka godkänt underlag'}</button>
  </>}
  {!gatewayConfigured&&<p className="text-xs text-muted">Gateway saknar serverkonfiguration. Underlaget kan granskas lokalt men inget AI-svar kan hämtas.</p>}
 </section>;
}
