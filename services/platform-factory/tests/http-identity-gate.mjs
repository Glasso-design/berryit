import {providerError} from '../providers/cloudflare-api.mjs';

export const requiredIdentityCases=Object.freeze(['auth.login','auth.invalid_password','mfa.aal1_denied','mfa.totp_aal2','mfa.revoked_session','rls.other_organization_denied','rls.forged_project_denied','postgrest.factory_create','postgrest.provider_evidence_write_denied','storage.internal_attachment_denied','sso.onarly_to_factory','sso.onarly_to_qabgo','sso.cross_tenant_denied','sso.replay_denied','sso.revocation']);
/** Harness for a separately approved isolated stack. It does not create one,
 * authenticate a user, read local sessions or accept a production endpoint.
 * The operator supplies the owned run marker and real test runner after approval.
 * Returning PASS from a mock runner is explicitly classified SYNTHETIC only.
 */
export async function identityGate({manifest,readMarker,runCase,synthetic=false}){
 if(manifest?.classification!=='isolated-synthetic-factory'||manifest.productionData!==false||! /^[a-f0-9-]{36}$/.test(manifest.runId)||!Array.isArray(manifest.origins))throw providerError('UNKNOWN_IDENTITY_ENVIRONMENT');
 for(const origin of manifest.origins){const u=new URL(origin);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.protocol!=='http:'||u.username||u.password||u.pathname!=='/')throw providerError('IDENTITY_GATE_NON_LOOPBACK_TARGET');}
 if(!manifest.origins.length||new Set(manifest.origins).size!==manifest.origins.length)throw providerError('UNKNOWN_IDENTITY_ENVIRONMENT');
 if(!readMarker||!runCase)return {status:'BLOCKED',reason:'Approved owned stack and real Auth/MFA/SSO runner required',cases:requiredIdentityCases};
 for(const origin of manifest.origins){const marker=await readMarker(origin);if(marker?.runId!==manifest.runId||marker.classification!==manifest.classification||marker.productionData!==false)throw providerError('IDENTITY_RUN_MARKER_MISMATCH');}
 const results=[];
 for(const name of requiredIdentityCases){const result=await runCase(name);if(result?.status!=='PASS'||result.runId!==manifest.runId||result.transport!=='REAL_HTTP')return {status:'BLOCKED',case:name,reason:'Missing real HTTP evidence'};results.push({name,status:'PASS'});}
 return {status:synthetic?'SYNTHETIC_HARNESS_PASS':'ISOLATED_HTTP_PASS',runId:manifest.runId,productionVerified:false,results};
}
