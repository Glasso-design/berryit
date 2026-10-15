/** Pure request guards. Authentication and service credentials remain server-only. */
export class SupportHttpError extends Error { constructor(readonly status:number,message:string){super(message);} }
export function supportOriginAllowed(request:Request,extraOrigins=''){
  const origin=request.headers.get('origin');
  return Boolean(origin&&(origin===new URL(request.url).origin||extraOrigins.split(',').map(value=>value.trim()).includes(origin)));
}
export function assertSupportOrigin(request:Request,bearer:string|undefined,extraOrigins=''){
  if(!bearer&&request.headers.get('origin')!==new URL(request.url).origin)throw new SupportHttpError(403,'Ogiltigt ursprung.');
  if(bearer&&request.headers.get('origin')&&!supportOriginAllowed(request,extraOrigins))throw new SupportHttpError(403,'Ogiltigt ursprung.');
}
export async function limitedSupportBody(request:Request,limit:number):Promise<ArrayBuffer>{
  const reader=request.body?.getReader();if(!reader)throw new SupportHttpError(400,'Tom begäran.');
  const chunks:Uint8Array[]=[];let length=0;
  for(;;){const result=await reader.read();if(result.done)break;length+=result.value.length;if(length>limit){await reader.cancel();throw new SupportHttpError(413,'Begäran är för stor.');}chunks.push(result.value);}
  const body=new Uint8Array(length);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}return body.buffer;
}
