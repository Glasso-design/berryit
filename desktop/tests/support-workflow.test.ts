import { describe,it,expect,vi } from 'vitest';
import type { SupabaseClient,AdminUserAttributes } from '@supabase/supabase-js';
import { assertSupportOrigin,limitedSupportBody,supportOriginAllowed } from '@berryit/shared/support-http-policy';
import { registerSupportCustomer } from '@berryit/shared/support-registration';
import { validateConfig } from '../src/config';
import { executeSupportAction } from '@berryit/shared/support-actions';
import { createSupportClient,validateSupportFile } from '@berryit/shared/support-workflow';
const input={full_name:'Synthetic',email:'synthetic@example.test',phone:'',organization_id:null};
describe('support request and registration boundaries',()=>{
  const request=(origin?:string)=>new Request('https://control.example.test/api/control/support',{method:'POST',headers:origin?{Origin:origin}:undefined,body:'{}'});
  it('cookie writes require exact same origin, even if Desktop origin is allowlisted',()=>{
    expect(()=>assertSupportOrigin(request('https://control.example.test'),undefined)).not.toThrow();
    for(const origin of [undefined,'null','https://evil.example.test','http://127.0.0.1:3601'])expect(()=>assertSupportOrigin(request(origin),undefined,'http://127.0.0.1:3601')).toThrow();
  });
  it('native bearer is accepted; browser bearer requires exact configured origin',()=>{
    expect(()=>assertSupportOrigin(request(),'synthetic-token')).not.toThrow();
    expect(()=>assertSupportOrigin(request('http://127.0.0.1:3601'),'synthetic-token','http://127.0.0.1:3601')).not.toThrow();
    expect(()=>assertSupportOrigin(request('https://evil.example.test'),'synthetic-token')).toThrow();
    expect(supportOriginAllowed(request('https://control.example.test.evil.test'))).toBe(false);
  });
  it('body cap is applied to actual bytes, not Content-Length',async()=>{
    await expect(limitedSupportBody(new Request('https://example.test',{method:'POST',body:'12345',headers:{'Content-Length':'1'}}),4)).rejects.toMatchObject({status:413});
    expect(new TextDecoder().decode(await limitedSupportBody(new Request('https://example.test',{method:'POST',body:'1234'}),4))).toBe('1234');
  });
  it('never calls Auth admin if context is denied or missing',async()=>{
    for(const reply of [{data:null,error:{message:'Denied'}},{data:{actor_id:'x'},error:null}]){
      const createUser=vi.fn();await expect(registerSupportCustomer(input,{actor:{rpc:async()=>reply} as unknown as SupabaseClient,createUser,password:()=>''})).rejects.toThrow();expect(createUser).not.toHaveBeenCalled();
    }
  });
  it('no credentials, confirmation or login activation are returned',async()=>{
    const context={actor_id:crypto.randomUUID(),session_id:crypto.randomUUID(),organization_id:null};
    const createUser=vi.fn(async(_attributes:AdminUserAttributes)=>({data:{user:{id:'new-id'}},error:null}));
    const result=await registerSupportCustomer(input,{actor:{rpc:async()=>({data:context,error:null})} as unknown as SupabaseClient,createUser,password:()=> 'test-only-random-secret'});
    expect(createUser.mock.calls[0]?.[0]).toMatchObject({email_confirm:false,ban_duration:'876000h',app_metadata:{berryit_manual_customer:context}});
    expect(result).toEqual({id:'new-id',login_activation_pending:true});expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('registration rejects role, activation and organisation spoofing input',async()=>{
    const createUser=vi.fn();await expect(registerSupportCustomer({...input,role:'admin',login_activation_pending:false},{actor:{} as SupabaseClient,createUser,password:()=>''})).rejects.toThrow();expect(createUser).not.toHaveBeenCalled();
  });
  it('only a secure Control Center origin may receive the Desktop bearer',()=>{
    const base={backendUrl:'https://backend.example.test',anonKey:'public-anon'};
    for(const controlUrl of ['http://external.example.test','https://user:pass@control.example.test','https://control.example.test/path','https://control.example.test?token=x','javascript:alert(1)'])expect(()=>validateConfig({...base,controlUrl})).toThrow();
    expect(validateConfig({...base,controlUrl:'https://control.example.test/'}).controlUrl).toBe('https://control.example.test');
  });
  it('action dispatcher rejects manipulated IDs and extra privileged fields',async()=>{
    const client=createSupportClient({} as SupabaseClient,crypto.randomUUID());
    await expect(executeSupportAction(client,{action:'detail',args:{id:"' or true --"}})).rejects.toThrow();
    await expect(executeSupportAction(client,{action:'update',args:{id:crypto.randomUUID(),changes:{requester_id:crypto.randomUUID()}}})).rejects.toThrow();
  });
  it('disallowed content and empty files fail before storage writes',()=>{
    expect(()=>validateSupportFile(new File(['<script>'],'x.html',{type:'text/html'}))).toThrow();
    expect(()=>validateSupportFile(new File([],'empty.txt',{type:'text/plain'}))).toThrow();
  });
});
