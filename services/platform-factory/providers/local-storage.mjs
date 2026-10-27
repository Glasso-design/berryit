import { randomUUID } from 'node:crypto';
import { FactoryError, hash } from '../contract.mjs';

/** Synthetic storage provider: real bytes in an isolated SQL database, not R2.
 * Private server-only transport; the caller must be a verified existing actor.
 * No deletion operation. Reservations remain charged on ambiguous failures. */
export class LocalObjectStorage {
 constructor({store,actor}){this.store=store;this.actor=actor;}
 async put(instanceId,key,content){
  const bytes=Buffer.from(content);if(!bytes.length)throw new FactoryError('EMPTY_OBJECT','Tomt testobjekt.');
  const reservation=await this.actor('factory_reserve',[instanceId,key,bytes.length]);
  await this.store.db.query(`insert into factory.local_objects(reservation_id,instance_id,body,checksum)
   select r.id,r.instance_id,$2,$3 from factory.upload_reservations r where r.id=$1 and r.status='RESERVED'
   on conflict(reservation_id) do nothing`,[reservation,bytes,hash(bytes)]);
  const row=(await this.store.db.query('select body,checksum from factory.local_objects where reservation_id=$1 and instance_id=$2',[reservation,instanceId])).rows[0];
  if(!row||row.checksum!==hash(bytes))throw new FactoryError('OBJECT_CONFLICT','Objektets innehåll matchar inte reservationen.');
  await this.store.scalar('factory_worker_complete_upload',[reservation,row.body.length]);return reservation;
 }
 async get(instanceId,reservation){return this.actor('factory_local_object',[instanceId,reservation]);}
 async reconcile(instanceId){
  // Fence uploads while taking a complete provider inventory. SQL locks also
  // fence reservations and finalization; zero means verified empty, not timeout.
  const db=this.store.db;await db.exec('begin');try{
   const exists=await db.query('select id from factory.instances where id=$1 for update',[instanceId]);if(!exists.rows.length)throw Error('Unknown instance');
   const rows=(await db.query('select reservation_id,octet_length(body)::bigint bytes,checksum from factory.local_objects where instance_id=$1 order by reservation_id',[instanceId])).rows;
   const observed=rows.reduce((sum,r)=>sum+Number(r.bytes),0);
   await this.store.scalar('factory_worker_reconcile_storage',[instanceId,randomUUID(),hash(rows),observed,true]);await db.exec('commit');return {mode:'LOCAL',observed,objects:rows.length};
  }catch(e){await db.exec('rollback');throw e;}
 }
}
