import { readFile } from 'node:fs/promises';
import { resolve,sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hash, FactoryError } from '../contract.mjs';

/** Read-only verification of the pinned product source, never its .env/seeds.
 * The source root is an operator-side dependency, not an API request field. */
export async function loadQabgoSource(sourceRoot,template) {
 const root=resolve(sourceRoot);
 for(const file of template.files) {
  const target=resolve(root,file.path);
  if(!target.startsWith(root+sep)||file.path.includes('..')||!file.path.startsWith('services/drive-core/'))throw new FactoryError('INVALID_TEMPLATE','Otillåten mallsökväg.');
  if(hash(await readFile(target))!==file.sha256)throw new FactoryError('TEMPLATE_DRIFT','Produktkoden matchar inte den pinnade distributionsmallen.');
 }
 for(const file of template.frontendFiles??[]){
  const target=resolve(root,file.path);
  if(!target.startsWith(root+sep)||file.path.includes('..')||!/^(apps\/(customer|driver|dispatch|admin)|packages\/(mobile-shell|maps))\//.test(file.path)||file.path.includes('/.env'))throw new FactoryError('INVALID_TEMPLATE','Otillåten frontendsökväg.');
  if(hash(await readFile(target))!==file.sha256)throw new FactoryError('TEMPLATE_DRIFT','Frontendkoden matchar inte lokal granskningsmall.');
 }
 const load=file=>import(pathToFileURL(resolve(root,template.core,'src',file)).href);
 const [config,services,app,migrations,passwords]=await Promise.all([load('config.ts'),load('services.ts'),load('app.ts'),load('db/migrate.ts'),load('security/passwords.ts')]);
 return {root,load,config,services,app,migrations,passwords,template};
}
