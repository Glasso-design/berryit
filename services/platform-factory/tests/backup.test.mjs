import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { sealBackup,openBackup } from '../providers/backup.mjs';
test('encrypted complete backup; wrong keys, foreign instance and truncation fail before restore',()=>{
 const key=randomBytes(32),identity={instanceId:randomUUID(),version:'a'.repeat(40)},parts={database:Buffer.from('synthetic database'),objects:Buffer.from('synthetic object'),configuration:Buffer.from('synthetic config')};
 const archive=sealBackup({...identity,parts},key);assert(!archive.includes(parts.database));assert.deepEqual(openBackup(archive,key,identity),parts);
 assert.throws(()=>openBackup(archive,randomBytes(32),identity));assert.throws(()=>openBackup(archive,key,{...identity,instanceId:randomUUID()}));
 assert.throws(()=>openBackup(archive.subarray(0,-1),key,identity));assert.throws(()=>sealBackup({...identity,parts:{database:parts.database}},key));
 const corrupt=Buffer.from(archive);corrupt[corrupt.length-1]^=1;assert.throws(()=>openBackup(corrupt,key,identity));
});
