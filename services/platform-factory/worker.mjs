import {FactoryEngine,runWorker} from './engine.mjs';
import {ProviderRegistry} from './providers/registry.mjs';

/** Server/worker composition root. No browser, request-origin provider URL,
 * shell command, production database URL or implicit provider fallback. */
export async function startLocalWorker({store,registry,provider,signal,intervalMs=1000}){
 const marker=(await store.db.query("select current_setting('factory.install_environment',true) marker")).rows[0].marker;
 if(marker!=='isolated-test')throw Error('Unknown or production Factory environment refused');
 const providers=new ProviderRegistry().register('isolated-local',provider);
 const engine=new FactoryEngine({store,registry,provider:providers.forJob('isolated-local')});
 return runWorker({engine,signal,intervalMs,queue:async()=>{
  return (await store.db.query(`select j.id from factory.jobs j join factory.instances i on i.id=j.instance_id
   where i.execution_mode='MOCK' and j.state in ('APPROVED','PROVISIONING','VERIFYING') and (j.lease_until is null or j.lease_until<now()) order by j.created_at,j.id limit 20`)).rows.map(r=>r.id);
 }});
}
