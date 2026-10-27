import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {ProviderActivation,operationHash} from '../providers/activation-gate.mjs';
import {canonical} from '../contract.mjs';

test('live activation requires trusted signed scope, external backup/restore and HTTP MFA SSO evidence',async()=>{
 const {publicKey,privateKey}=generateKeyPairSync('ed25519'),now=Date.now(),account='a'.repeat(32);
 const operation={provider:'cloudflare',method:'POST',path:'/accounts',intent:'synthetic-stable-intent',inputHash:operationHash({body:{name:'synthetic'},headers:{'Idempotency-Key':'synthetic-stable-intent'}}),synthetic:false};
 const evidence=Object.fromEntries(['isolatedHttpMfaSso','externalEncryptedBackup','restore'].map(k=>[k,{status:'PASS',sha256:'b'.repeat(64)}]));
 const manifest={schema:1,environment:'isolated-provider-verification',codeSha:'c'.repeat(40),notBefore:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString(),accounts:[account],zones:[],evidence,readPaths:['/accounts/'+account],approvals:[operation]};
 const envelope=m=>({manifest:m,signature:sign(null,Buffer.from(canonical(m)),privateKey).toString('base64')});
 const gate=new ProviderActivation({envelope:envelope(manifest),trustedPublicKey:publicKey,now:()=>now});assert.equal(await gate.authorize(operation),true);
 for(const changed of [{inputHash:'d'.repeat(64)},{intent:'other'},{synthetic:true},{path:'/accounts/'+('f'.repeat(32))},{method:'DELETE'}])assert.equal(await gate.authorize({...operation,...changed}),false);
 assert.equal(await new ProviderActivation().authorize(operation),false);
 for(const key of Object.keys(evidence)){
  const bad=structuredClone(manifest);bad.evidence[key].status='BLOCKED';assert.equal(await new ProviderActivation({envelope:envelope(bad),trustedPublicKey:publicKey}).authorize(operation),false);
 }
 assert.equal(await new ProviderActivation({envelope:envelope(manifest),trustedPublicKey:publicKey,now:()=>now+120000}).authorize(operation),false);
 const tampered=envelope(manifest);tampered.manifest={...manifest,readPaths:['/user']};assert.equal(await new ProviderActivation({envelope:tampered,trustedPublicKey:publicKey}).authorize(operation),false);
});
