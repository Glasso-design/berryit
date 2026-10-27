import { estimateR2 } from './cloudflare.mjs';
import { providerError } from './cloudflare-api.mjs';

const states=new Set(['UNVERIFIED','VERIFIED_READ','VERIFIED','BLOCKED','NOT_AVAILABLE','SYNTHETIC']);
const code=/^[A-Za-z0-9_.:-]{1,100}$/;
/** No arbitrary raw API payloads are accepted as public evidence. A worker
 * persists a bounded allowlist; URLs, credentials, policies and email addresses
 * never enter Factory status or audit. Only service-role has table writes. */
export async function publishProviderStatus(db,instanceId,{capabilities,accountMode,dns='UNVERIFIED',email='UNVERIFIED',tls='UNVERIFIED',cost={objectBytes:0}}){
 if(!capabilities||!['SYNTHETIC_HTTP','LIVE_READ_ONLY'].includes(capabilities.verification)||!['DEDICATED_MANAGED','LIMITED_STANDALONE','MANAGED_RESOURCE_ISOLATION'].includes(accountMode)||![dns,email,tls].every(x=>states.has(x)))throw providerError('INVALID_PROVIDER_STATUS');
 const caps=Object.fromEntries(Object.entries(capabilities.capabilities).map(([k,v])=>{if(!code.test(k)||!['VERIFIED_READ','UNVERIFIED','BLOCKED'].includes(v))throw providerError('INVALID_PROVIDER_STATUS');return [k,v];}));
 const list=values=>{if(!Array.isArray(values)||values.length>50||values.some(x=>!code.test(x)))throw providerError('INVALID_PROVIDER_STATUS');return JSON.stringify([...new Set(values)]);};
 if(capabilities.verification==='SYNTHETIC_HTTP'&&[dns,email,tls].includes('VERIFIED'))throw providerError('SYNTHETIC_IS_NOT_LIVE');
 const estimate=estimateR2(cost);estimate.basis=capabilities.verification;estimate.actualBillVerified=false;
 await db.query(`insert into factory.provider_status(instance_id,verification,account_mode,capabilities,missing_permissions,blockers,dns_status,email_status,tls_status,cost_estimate)
  values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict(instance_id) do update set observed_at=now(),verification=excluded.verification,account_mode=excluded.account_mode,capabilities=excluded.capabilities,missing_permissions=excluded.missing_permissions,blockers=excluded.blockers,dns_status=excluded.dns_status,email_status=excluded.email_status,tls_status=excluded.tls_status,cost_estimate=excluded.cost_estimate`,
 [instanceId,capabilities.verification,accountMode,JSON.stringify(caps),list(capabilities.missingPermissions),list(capabilities.blockers),dns,email,tls,JSON.stringify(estimate)]);
}
