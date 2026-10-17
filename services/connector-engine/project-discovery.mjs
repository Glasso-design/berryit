import {ConnectorError,fetchWithTimeout,requireSecret} from './contract.mjs';
// Only approved, enabled integrations can discover metadata. No grant writes.
export async function discoverRegisteredProject({integration,secrets,store,fetchImpl=fetch,timeoutMs=8000}){
 if(!integration.is_enabled||integration.access_mode!=='read_only'||integration.config?.discovery_enabled!==true)
  throw new ConnectorError('NOT_CONFIGURED','Projektupptäckt är inte uttryckligen aktiverad');
 const config=integration.config??{};const kind=integration.connector_key;
 if(!['github','vercel'].includes(kind)||!config.provider_project_id||!store.reconcileProject)
  throw new ConnectorError('NOT_CONFIGURED','Pinnad provideridentitet eller registerkontrakt saknas');
 const token=requireSecret(secrets,integration.secret_ref,kind);
 let url;
 if(kind==='github'){
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository??''))throw new ConnectorError('BAD_CONFIG','Ogiltig repositoryidentitet');
  url='https://api.github.com/repos/'+config.repository;
 }else{
  if(!/^[A-Za-z0-9_-]{1,200}$/.test(config.project_id??''))throw new ConnectorError('BAD_CONFIG','Ogiltig Vercel-identitet');
  url='https://api.vercel.com/v9/projects/'+encodeURIComponent(config.project_id)+(config.team_id?'?teamId='+encodeURIComponent(config.team_id):'');
 }
 const response=await fetchWithTimeout(fetchImpl,url,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json','User-Agent':'berryit-connector-engine'}},timeoutMs);
 if(!response.ok)throw new ConnectorError('BAD_RESPONSE','Provider kunde inte verifiera projektet');
 const metadata=await response.json();
 if(String(metadata.id)!==String(config.provider_project_id)||(kind==='github'&&String(metadata.full_name).toLowerCase()!==config.repository.toLowerCase()))
  throw new ConnectorError('FORBIDDEN','Provideridentiteten matchar inte den godkända integrationen');
 return store.reconcileProject({p_integration:integration.id,p_external_id:String(metadata.id),p_name:String(metadata.name??'').slice(0,120),p_description:String(metadata.description??'').slice(0,4000)});
}
