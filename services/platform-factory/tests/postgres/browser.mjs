import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';

export async function verifyQabgoWeb(sessionA,sessionB,driver){
 const browser=await chromium.launch({headless:true});const summaries=[];
 try{
  for(const app of ['customer','driver','dispatch','admin']){
   const root=path.resolve('test-results/platform-factory-20261024/qabgo-web',app);
   const server=createServer(async(req,res)=>{try{
    const route=new URL(req.url,'http://fixture.test').pathname;
    if(route.startsWith('/drive/')){
     const parts=[];for await(const part of req)parts.push(part);
     const headers={};for(const name of ['authorization','content-type'])if(req.headers[name])headers[name]=req.headers[name];
     const response=await fetch(sessionA.origin+route.slice(6),{method:req.method,headers,body:parts.length?Buffer.concat(parts):undefined,redirect:'error'});
     res.writeHead(response.status,{'content-type':response.headers.get('content-type')??'application/json'});res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    const file=path.resolve(root,'.'+(route==='/'||!path.extname(route)?'/index.html':route));if(!file.startsWith(root+path.sep))throw Error('Unsafe file path');
    const body=await readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'}[path.extname(file)])??'application/octet-stream');res.end(body);
   }catch{res.writeHead(404).end();}});
   await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
   const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
   await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
   try{
    await page.goto(origin);await expect(page.locator('#root')).not.toBeEmpty();
    if(app==='customer'){
     const config=await page.evaluate(async()=>{const r=await fetch('/drive/v1/apps/factory-isolated-customer/config');return r.status;});assert.equal(config,200);
     await page.goto(origin+'/auth');
     await page.getByLabel('E-post',{exact:true}).fill(sessionA.email);await page.getByLabel('Lösenord',{exact:true}).fill(sessionA.password);
     await page.getByRole('button',{name:'Logga in',exact:true}).click();await expect(page).toHaveURL(/\/profile$/);
    }
    if(app==='driver'){
     await page.getByLabel(/E-post/).fill(driver.email);await page.getByLabel('Lösenord',{exact:true}).fill(driver.password);
     const response=page.waitForResponse(r=>r.url().endsWith('/v1/auth/login')&&r.status()===200);
     await page.getByRole('button',{name:'Logga in',exact:true}).click();await response;
     await expect(page.getByRole('region',{name:'Körningsstatus',exact:true})).toBeVisible({timeout:15000});
    }
    if(['admin','dispatch'].includes(app)){
     await page.getByLabel('E-post',{exact:true}).fill(sessionA.email);await page.getByLabel('Lösenord',{exact:true}).fill(sessionA.password);
     if(app==='admin')await page.getByLabel('Åkeri-id (vid flera åkerier)').fill(sessionA.tenantId);
     await page.getByRole('button',{name:'Logga in',exact:true}).click();await expect(page.getByRole('button',{name:'Logga ut',exact:true})).toBeVisible({timeout:15000});
     if(app==='admin'){
      await page.getByRole('button',{name:'Kunder & företag',exact:true}).click();await expect(page.getByRole('heading',{name:'Kunder & företag',exact:true}).first()).toBeVisible();
      const cross=await page.evaluate(async({token})=>{const response=await fetch('/drive/v1/dispatch/session',{headers:{Authorization:'Bearer '+token}});return response.status;},{token:sessionB.accessToken});assert.equal(cross,401);
     }
    }
    await page.screenshot({path:'test-results/platform-factory-20261024/qabgo-'+app+'.png',fullPage:true});
    assert.deepEqual(errors,[],app+' JS errors');summaries.push({app,render:'PASS',login:'REAL_LOCAL_HTTP_PASS',externalTraffic:'blocked'});
   }finally{await context.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  }
 }finally{await browser.close();}
 return summaries;
}
