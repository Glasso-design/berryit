import {verify} from 'node:crypto';
import {canonical,hash} from '../contract.mjs';

/** Server/operator gate, never a UI switch. The review authority's public key is
 * trusted server configuration; a browser cannot supply its own trust anchor.
 * Evidence hashes bind the separately approved verification reports. This pass
 * creates no signed live approval and invokes no real provider.
 */
export class ProviderActivation {
 #manifest=null;
 constructor({envelope=null,trustedPublicKey=null,now=()=>Date.now()}={}){
  this.now=now;
  try{
   const m=envelope?.manifest;
   if(!m||!trustedPublicKey||!verify(null,Buffer.from(canonical(m)),trustedPublicKey,Buffer.from(envelope.signature,'base64')))return;
   if(m.schema!==1||!['isolated-provider-verification','production'].includes(m.environment)||! /^[a-f0-9]{40}$/.test(m.codeSha)||!Array.isArray(m.accounts)||!Array.isArray(m.zones)||!Array.isArray(m.approvals))return;
   if(m.accounts.some(x=>! /^[a-f0-9]{32}$/.test(x))||m.zones.some(x=>! /^[a-f0-9]{32}$/.test(x)))return;
   if(!Number.isFinite(Date.parse(m.expiresAt))||!Number.isFinite(Date.parse(m.notBefore))||Date.parse(m.expiresAt)-Date.parse(m.notBefore)>3600000)return;
   for(const name of ['isolatedHttpMfaSso','externalEncryptedBackup','restore'])if(m.evidence?.[name]?.status!=='PASS'||! /^[a-f0-9]{64}$/.test(m.evidence[name].sha256))return;
   this.#manifest=structuredClone(m);
  }catch{ /* Invalid/unknown approvals remain denied. */ }
 }
 async authorize(operation){
  const m=this.#manifest;if(!m||this.now()<Date.parse(m.notBefore)||this.now()>=Date.parse(m.expiresAt)||operation.synthetic)return false;
  if(operation.provider!=='cloudflare')return false; // Product R2 requires its separate bound broker authorizer.
  const path=operation.path.split('?')[0],account=/^\/accounts\/([a-f0-9]{32})(?:\/|$)/.exec(path),zone=/^\/zones\/([a-f0-9]{32})(?:\/|$)/.exec(path);
  if(account&&!m.accounts.includes(account[1])||zone&&!m.zones.includes(zone[1]))return false;
  if(operation.method==='GET')return m.readPaths?.includes(path)===true;
  return operation.method==='POST'&&m.approvals.some(a=>a.method===operation.method&&a.path===path&&a.intent===operation.intent&&a.inputHash===operation.inputHash);
 }
}
export function operationHash({body,headers}){return hash(canonical({body:body??null,headers:headers??{}}));}
