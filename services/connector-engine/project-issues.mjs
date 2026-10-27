import {readProjectRepository} from './repository-access.mjs';
import {ConnectorError} from './contract.mjs';
/** External requests are GET only. A complete bounded scan precedes ONE atomic
 * internal RPC; repeat reads reuse the same issue identity without duplicates. */
export async function syncProjectIssues({actor,server,input,connections,fetchImpl=fetch}){
 if(!input||! /^[a-f0-9-]{36}$/i.test(input.project??'')||! /^[a-f0-9-]{36}$/i.test(input.integration??''))throw new ConnectorError('BAD_CONFIG','Registrerat projekt och anslutning krävs.');
 const context=await actor.rpc('project_issue_sync_context',{p_project:input.project,p_integration:input.integration});
 if(context.error||!context.data)throw new ConnectorError('FORBIDDEN','Aktuell MFA och projektscope krävs.');
 if(!server)throw new ConnectorError('NOT_CONFIGURED','Skyddad serverbaserad import är inte konfigurerad.');
 const entries=[],seen=new Set();let page=1,bytes=0;
 for(;;){
  const result=await readProjectRepository({actor,input:{project:input.project,integration:input.integration,kind:'issues',page},connections,fetchImpl});
  for(const issue of result.entries){
   if(!Number.isSafeInteger(issue.number)||issue.number<1||! /^[0-9]{1,30}$/.test(issue.id)||seen.has(issue.id))throw new ConnectorError('BAD_RESPONSE','Ofullständig eller ändrad GitHub-sidföljd; inget importerades.');
   if(!['open','closed'].includes(issue.state)||!Number.isFinite(Date.parse(issue.updated_at)))throw new ConnectorError('BAD_RESPONSE','Issue-underlaget kunde inte verifieras.');
   seen.add(issue.id);bytes+=Buffer.byteLength(JSON.stringify(issue));entries.push(issue);
  }
  if(entries.length>2000||bytes>8388608||page>=100&&result.mayHaveMore)throw new ConnectorError('BAD_RESPONSE','Importen överskrider granskningsgränsen; inget importerades.');
  if(!result.mayHaveMore)break;page++;
 }
 const result=await server.rpc('import_project_github_issues',{p_project:input.project,p_integration:input.integration,p_actor:context.data.actor_id,p_session:context.data.session_id,p_issues:entries});
 if(result.error)throw new ConnectorError('FORBIDDEN','Synk nekades eller ändrades under hämtningen. Databastransaktionen återställdes.');
 return result.data;
}
