import { PRODUCT_CATALOG,catalogProvenance } from './registry.mjs';
/** Review operator installs adapter metadata in the isolated Factory database.
 * It never authorizes products for live provisioning or changes identities. */
export async function registerLocalCatalog(db,adapter){
 const marker=(await db.query("select current_setting('factory.install_environment',true) marker")).rows[0].marker;
 if(marker!=='isolated-test')throw Error('Explicit isolated catalog gate required');
 for(const item of PRODUCT_CATALOG){const selected=item.id===adapter.productId;
  await db.query(`insert into factory.adapters(product_id,label,version,status,template,provenance) values($1,$2,$3,$4,$5,$6)
   on conflict(product_id) do nothing`,[item.id,item.name,selected?adapter.versions[0]:null,item.status,JSON.stringify(selected?adapter.checklist():[]),JSON.stringify({...catalogProvenance,reason:item.reason})]);
 }
}
