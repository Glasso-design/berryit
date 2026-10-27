import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomUUID,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {R2S3Provider,parseS3Xml,xmlValue} from '../providers/r2-s3.mjs';
const credentials={accessKeyId:'synthetic-r2-test-access',secretAccessKey:'synthetic-r2-test-secret-not-a-real-credential'};
const mac=(k,s)=>createHmac('sha256',k).update(s).digest();
const enc=s=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const md5=b=>createHash('md5').update(b).digest('hex');
const xml=s=>new Response(s,{headers:{'Content-Type':'application/xml'}});
const escape=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');

/** Actual loopback HTTP service; independently verifies SigV4, signed length,
 * digest, operation scope and expiry. No connection to a real R2 endpoint. */
export async function syntheticR2(){
 const uploads=new Map(),objects=new Map();let initiateCalls=0,completeCalls=0;let loseCompleteResponse=false;
 const host='a'.repeat(32)+'.eu.r2.cloudflarestorage.com';
 function signature(req,url){
  const p=url.searchParams,signature=p.get('X-Amz-Signature');if(!signature||p.get('X-Amz-Algorithm')!=='AWS4-HMAC-SHA256')return false;
  const [access,date,region,service,terminator]=(p.get('X-Amz-Credential')??'').split('/');if(access!==credentials.accessKeyId||service!=='s3'||terminator!=='aws4_request')return false;
  const stamp=p.get('X-Amz-Date'),start=Date.parse(stamp.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,'$1-$2-$3T$4:$5:$6Z'));
  if(!Number.isFinite(start)||Date.now()<start-5000||Date.now()>start+Number(p.get('X-Amz-Expires'))*1000)return false;
  const names=(p.get('X-Amz-SignedHeaders')??'').split(';');
  const headers=names.map(n=>n+':'+(n==='host'?host:String(req.headers[n]??'').trim().replace(/\s+/g,' '))+'\n').join('');
  const query=[...p].filter(([k])=>k!=='X-Amz-Signature').map(([k,v])=>[enc(k),enc(v)].join('=')).sort().join('&');
  const canonical=[req.method,url.pathname,query,headers,names.join(';'),'UNSIGNED-PAYLOAD'].join('\n');
  const scope=[date,region,service,terminator].join('/'),string=['AWS4-HMAC-SHA256',stamp,scope,createHash('sha256').update(canonical).digest('hex')].join('\n');
  const key=mac(mac(mac(mac('AWS4'+credentials.secretAccessKey,date),region),service),terminator),expected=mac(key,string).toString('hex');
  return signature.length===expected.length&&timingSafeEqual(Buffer.from(signature),Buffer.from(expected));
 }
 const server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://127.0.0.1');if(!signature(req,url)){res.writeHead(403);res.end();return;}
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
   const key=decodeURIComponent(url.pathname.split('/').slice(2).join('/')),p=url.searchParams;
   const send=async r=>{res.writeHead(r.status,Object.fromEntries(r.headers));res.end(await r.text());};
   if(req.method==='POST'&&p.has('uploads')){const uploadId=randomUUID();uploads.set(uploadId,{key,parts:new Map(),reservationId:req.headers['x-amz-meta-factory-reservation'],instanceId:req.headers['x-amz-meta-factory-instance']});initiateCalls++;await send(xml(`<InitiateMultipartUploadResult><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`));return;}
   if(p.has('uploadId')){
    const uploadId=p.get('uploadId'),u=uploads.get(uploadId);if(!u||u.key!==key){res.writeHead(404);res.end();return;}
    if(req.method==='PUT'){
     if(Number(req.headers['content-length'])!==body.length||req.headers['content-md5']!==createHash('md5').update(body).digest('base64')){res.writeHead(400);res.end();return;}
     const n=Number(p.get('partNumber'));u.parts.set(n,body);res.setHeader('ETag','"'+md5(body)+'"');res.end();return;
    }
    if(req.method==='GET'){
     // One item per page deliberately exercises multipart pagination.
     const marker=Number(p.get('part-number-marker')??0),all=[...u.parts].sort((a,b)=>a[0]-b[0]).filter(([n])=>n>marker),page=all.slice(0,1);
     await send(xml(`<ListPartsResult><UploadId>${uploadId}</UploadId><IsTruncated>${all.length>1}</IsTruncated>${all.length>1?'<NextPartNumberMarker>'+page[0][0]+'</NextPartNumberMarker>':''}${page.map(([n,b])=>`<Part><PartNumber>${n}</PartNumber><Size>${b.length}</Size><ETag>&quot;${md5(b)}&quot;</ETag></Part>`).join('')}</ListPartsResult>`));return;
    }
    if(req.method==='POST'){
     const parsed=parseS3Xml(body.toString()),parts=parsed.children.filter(n=>n.name==='Part'),selected=[];
     for(const part of parts){const n=Number(xmlValue(part,'PartNumber')),b=u.parts.get(n);if(!b||xmlValue(part,'ETag').replaceAll('"','')!==md5(b)){res.writeHead(400);res.end();return;}selected.push(b);}
     objects.set(key,{body:Buffer.concat(selected),reservationId:u.reservationId,instanceId:u.instanceId});uploads.delete(uploadId);completeCalls++;
     if(loseCompleteResponse){loseCompleteResponse=false;req.socket.destroy();return;}
     await send(xml(`<CompleteMultipartUploadResult><Key>${escape(key)}</Key></CompleteMultipartUploadResult>`));return;
    }
   }
   if(req.method==='HEAD'){
    const o=objects.get(key);if(!o){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Length':o.body.length,'x-amz-meta-factory-reservation':o.reservationId,'x-amz-meta-factory-instance':o.instanceId});res.end();return;
   }
   if(req.method==='GET'&&p.get('list-type')==='2'){
    const all=[...objects].filter(([k])=>k.startsWith(p.get('prefix'))).sort((a,b)=>a[0].localeCompare(b[0]));const index=Number(p.get('continuation-token')??0),page=all.slice(index,index+1),truncated=index+1<all.length;
    await send(xml(`<ListBucketResult><IsTruncated>${truncated}</IsTruncated>${truncated?'<NextContinuationToken>'+(index+1)+'</NextContinuationToken>':''}${page.map(([k,o])=>'<Contents><Key>'+escape(k)+'</Key><Size>'+o.body.length+'</Size></Contents>').join('')}</ListBucketResult>`));return;
   }
   res.writeHead(403);res.end();
  }catch{res.writeHead(400);res.end();}
 });server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
 const transport=(url,options)=>{const parsed=new URL(url);if(parsed.origin!=='https://'+host)throw Error('Real provider refused by fixture');return fetch(origin+parsed.pathname+parsed.search,options);};
 const r2=new R2S3Provider({accountId:'a'.repeat(32),bucket:'synthetic-bucket',jurisdiction:'eu',secretStore:{get:async()=>credentials},secretRef:'synthetic',transport,authorize:async()=>true,synthetic:true});
 return {r2,uploads,objects,upload:async(signed,body)=>transport(signed.url,{method:'PUT',headers:signed.headers,body}),loseNextComplete:()=>{loseCompleteResponse=true;},counts:()=>({initiateCalls,completeCalls}),close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
