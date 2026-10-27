import { createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
import { hash,FactoryError } from '../contract.mjs';

/** Encrypted, bounded, provider-neutral archive. Credentials and decryption
 * keys are supplied by the protected server recovery store, never the UI. */
export function sealBackup({instanceId,version,parts},key){
 if(!Buffer.isBuffer(key)||key.length!==32)throw Error('A separate 256-bit recovery key is required');
 if(!/^[a-f0-9-]{36}$/.test(instanceId)||!/^[a-f0-9]{40}$/.test(version))throw Error('Unknown backup identity/version');
 const required=['database','objects','configuration'];
 if(Object.keys(parts).sort().join()!==required.sort().join())throw Error('Incomplete backup');
 const entries=Object.entries(parts).map(([name,body])=>({name,body:Buffer.from(body).toString('base64'),checksum:hash(Buffer.from(body))}));
 const payload=Buffer.from(JSON.stringify({format:1,instanceId,version,entries}));if(payload.length>64*1024*1024)throw Error('Local verification archive limit exceeded');
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('ONARLY_FACTORY_BACKUP_V1'));
 const encrypted=Buffer.concat([cipher.update(payload),cipher.final()]);
 return Buffer.concat([Buffer.from('OFB1'),iv,cipher.getAuthTag(),encrypted]);
}
export function openBackup(archive,key,{instanceId,version}){
 try{
  if(!Buffer.isBuffer(archive)||archive.length<33||archive.length>65*1024*1024||archive.subarray(0,4).toString()!=='OFB1')throw Error('Invalid archive');
  const cipher=createDecipheriv('aes-256-gcm',key,archive.subarray(4,16));cipher.setAAD(Buffer.from('ONARLY_FACTORY_BACKUP_V1'));cipher.setAuthTag(archive.subarray(16,32));
  const data=JSON.parse(Buffer.concat([cipher.update(archive.subarray(32)),cipher.final()]).toString());
  if(data.format!==1||data.instanceId!==instanceId||data.version!==version||data.entries.length!==3||new Set(data.entries.map(e=>e.name)).size!==3)throw Error('Identity/completeness mismatch');
  const parts={};for(const entry of data.entries){if(!['database','objects','configuration'].includes(entry.name))throw Error('Unknown archive part');const body=Buffer.from(entry.body,'base64');if(hash(body)!==entry.checksum)throw Error('Checksum mismatch');parts[entry.name]=body;}
  return parts;
 }catch{throw new FactoryError('RESTORE_VALIDATION_FAILED','Arkivets identitet, kryptering, fullständighet eller checksummor kunde inte verifieras. Ingen återställning utförd.');}
}
