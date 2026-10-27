import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { loadQabgoSource } from '../adapters/qabgo-source.mjs';
if(process.argv.slice(2).join()!=='--environment=isolated-factory-build')throw Error('Explicit local build gate required');
const sourceRoot='C:/projects/ONARLY-DRIVE-worktrees/qabgo-driver-ui-v2-feature';
const template=JSON.parse(await readFile(new URL('../adapters/qabgo.template.json',import.meta.url),'utf8'));
await loadQabgoSource(sourceRoot,template);
const results=[];
// Do not inherit any developer's public build variables into a clean product.
for(const key of Object.keys(process.env))if(key.startsWith('VITE_'))delete process.env[key];
for(const name of ['customer','driver','dispatch','admin']){
 const root=path.join(sourceRoot,'apps',name),require=createRequire(path.join(root,'package.json'));
 const {build}=await import(pathToFileURL(require.resolve('vite')).href);
 const {default:react}=await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href);
 const outDir=path.resolve('test-results/platform-factory-20261024/qabgo-web',name);
 // No .env, historical pilot origin, production token, maps key or seed enters
 // these artifacts. Existing product aliases are kept. Same-origin /drive is
 // served only by the isolated test proxy, never by a production backend.
 await build({root,configFile:false,envDir:false,mode:'factory-isolated',plugins:[react()],base:'/',
  define:{'import.meta.env.VITE_DRIVE_BACKEND':JSON.stringify('standalone'),'import.meta.env.VITE_ONARLY_API_BASE':JSON.stringify('/drive'),'import.meta.env.VITE_ONARLY_APP_ID':JSON.stringify('factory-isolated-customer'),'import.meta.env.VITE_FACTORY_CONTROL_URL':JSON.stringify('http://127.0.0.1:19999')},
  resolve:{dedupe:['react','react-dom'],alias:{'@drive/mobile-shell':path.join(sourceRoot,'packages/mobile-shell/src/index.ts'),'@drive/maps':path.join(sourceRoot,'packages/maps/src/google.ts')}},
  build:{outDir,emptyOutDir:false,sourcemap:false},logLevel:'warn'});
 results.push({app:name,status:'LOCAL_BUILD_PASS',environment:'isolated',backend:'/drive',output:outDir,sourceVersion:template.version});
 console.log(name+': LOCAL BUILD PASS (no env/seeds loaded)');
}
await mkdir('test-results/platform-factory-20261024',{recursive:true});await writeFile('test-results/platform-factory-20261024/qabgo-builds.json',JSON.stringify(results,null,2));
