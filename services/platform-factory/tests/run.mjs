import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertIsolatedPgliteEnvironment } from '../../../supabase/tests/isolated-environment.mjs';
assertIsolatedPgliteEnvironment(process.argv.slice(2),process.env);
let failed=false;
for(const name of ['security','engine','quota','default-quota','storage','catalog','sdk','worker','api','providers','backup','provider-http','provider-security','provider-resources','r2-broker','activation','identity-gate']){
 const sql=!['providers','backup','api','provider-http','activation','identity-gate'].includes(name),file=fileURLToPath(new URL(name+'.test.mjs',import.meta.url));
 const result=spawnSync(process.execPath,[...(sql?[]:['--test']),file,...(sql?['--environment=isolated-pglite']:[])],{stdio:'inherit',windowsHide:true});
 if(result.status!==0||result.error)failed=true;
}
process.exitCode=failed?1:0;
