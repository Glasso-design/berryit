import { afterEach, expect, it, vi } from 'vitest';
import { build } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

afterEach(()=>vi.unstubAllEnvs());

it('production Desktop and shared hooks use one compatible React/ReactDOM runtime',async()=>{
 vi.stubEnv('NODE_ENV','production');
 const modules=new Set<string>();
 await build({root:process.cwd(),configFile:resolve('vite.config.ts'),logLevel:'silent',
  build:{write:false,emptyOutDir:false},plugins:[{
   name:'verify-production-react-identity',generateBundle(_options,bundle){
    for(const item of Object.values(bundle))if(item.type==='chunk')for(const id of Object.keys(item.modules))modules.add(id.replaceAll('\\','/'));
   },
  }],
 });
 const react=[...modules].filter(id=>id.endsWith('/react/cjs/react.production.js'));
 const renderer=[...modules].filter(id=>id.endsWith('/react-dom/cjs/react-dom-client.production.js'));
 const versions=[...react,...renderer].map(id=>JSON.parse(readFileSync(id.slice(0,id.indexOf('/cjs/'))+'/package.json','utf8')).version as string);
 const evidence={react,renderer,versions,sharedHookComponents:[...modules].filter(id=>/shared\/ui\/(CustomerWorkspace|ProjectAccessWorkspace|SupportWorkspace)\.tsx$/.test(id))};
 writeFileSync(resolve('../test-results/react-runtime-bundle.json'),JSON.stringify(evidence,null,2));
 expect(evidence.sharedHookComponents).toHaveLength(3);
 expect(react,'duplicate React runtimes in the real production module graph').toHaveLength(1);
 expect(renderer).toHaveLength(1);
 expect(new Set(versions).size).toBe(1);
 expect(react[0]).toContain('/desktop/node_modules/react/');
 expect(renderer[0]).toContain('/desktop/node_modules/react-dom/');
},30000);
