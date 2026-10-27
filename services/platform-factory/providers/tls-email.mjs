import { lookup } from 'node:dns/promises';
import { connect,checkServerIdentity } from 'node:tls';
import { isIP } from 'node:net';
import { cloudflareId,providerError } from './cloudflare-api.mjs';

export function publicAddress(address){
 if(isIP(address)===4){const [a,b]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19));}
 // Accept global-unicast IPv6 only. This also rejects mapped IPv4, loopback,
 // link-local, ULA and NAT64 forms that could bypass the IPv4 checks.
 return isIP(address)===6&&/^[23]/.test(address)&&!/^2001:(?:db8|0:)/i.test(address);
}
function tlsProbe({address,host}){
 return new Promise((resolve,reject)=>{
  const socket=connect({host:address,port:443,servername:host,rejectUnauthorized:true,checkServerIdentity},()=>{
   const cert=socket.getPeerCertificate();const expires=Date.parse(cert.valid_to);
   if(!socket.authorized||!Number.isFinite(expires)||expires<=Date.now()){socket.destroy();reject(providerError('TLS_NOT_VERIFIED'));return;}
   socket.end();resolve({verified:true,expiresAt:new Date(expires).toISOString(),protocol:socket.getProtocol()});
  });socket.setTimeout(8000,()=>socket.destroy(providerError('TLS_TIMEOUT')));socket.once('error',()=>reject(providerError('TLS_NOT_VERIFIED')));
 });
}
export class TlsVerifier {
 constructor({approvedDomains=[],resolve=host=>lookup(host,{all:true}),probe=tlsProbe}={}){this.domains=new Set(approvedDomains);this.resolve=resolve;this.probe=probe;}
 async verify(host){
  if(!this.domains.has(host)||! /^([a-z0-9-]+\.)+[a-z]{2,63}$/.test(host))throw providerError('TLS_DOMAIN_NOT_APPROVED');
  const addresses=await this.resolve(host);if(!addresses.length||addresses.some(r=>!publicAddress(r.address)))throw providerError('TLS_UNSAFE_DESTINATION');
  // Connect to the checked address, not a second DNS lookup (DNS rebinding).
  const result=await this.probe({address:addresses[0].address,host});if(result.verified!==true)throw providerError('TLS_NOT_VERIFIED');return {...result,host};
 }
}

/** Email Sending is a separate capability (currently Cloudflare beta), not a
 * consequence of routing. A provider attestation comes from server/operator
 * review, never a browser flag. Every send needs its own explicit consent. */
export class CloudflareTransactionalEmail {
 constructor({api,secretRef,accountId,domain,verifyDomain,consent}){cloudflareId(accountId);Object.assign(this,{api,secretRef,accountId,domain,verifyDomain,consent});}
 async send({from,to,subject,text,approvalId}){
  if(![from,to].every(v=>typeof v==='string'&&/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v))||from.split('@')[1]!==this.domain||typeof subject!=='string'||subject.length>200||/[\r\n]/.test(subject)||typeof text!=='string'||Buffer.byteLength(text)>100000)throw providerError('INVALID_EMAIL_REQUEST');
  const domain=await this.verifyDomain(this.domain);
  if(domain?.spf!==true||domain.dkim!==true||domain.dmarc!==true||domain.sendingEntitled!==true)throw providerError('EMAIL_SENDING_NOT_VERIFIED');
  if(await this.consent({from,to,subject,text,approvalId})!==true)throw providerError('EMAIL_SEND_APPROVAL_REQUIRED');
  // No automatic retry: the sending REST contract does not guarantee an
  // idempotency key. A timeout must be reconciled before an operator resends.
  const {result}=await this.api.request({method:'POST',path:'/accounts/'+this.accountId+'/email/sending/send',secretRef:this.secretRef,body:{from,to,subject,text},intent:approvalId});
  if(!Array.isArray(result.delivered)||!Array.isArray(result.queued)||!Array.isArray(result.permanent_bounces))throw providerError('MANUAL_RECOVERY');
  return {delivered:result.delivered.includes(to),queued:result.queued.includes(to),bounced:result.permanent_bounces.includes(to),mailbox:false};
 }
}
export class ExternalMailboxProvider {
 constructor({approvedProvider=null}={}){this.provider=approvedProvider;}
 capabilities(){return {mailbox:Boolean(this.provider),status:this.provider?'WAITING_SEPARATE_PROVIDER_VERIFICATION':'NOT_AVAILABLE',routingIsMailbox:false};}
 async provision(input){if(!this.provider)throw providerError('MAILBOX_PROVIDER_NOT_CONFIGURED');return this.provider.provision(input);}
}
