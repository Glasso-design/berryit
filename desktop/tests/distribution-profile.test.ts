import {describe,expect,it} from 'vitest';
import {distributionProfile,packageKind,publicNames} from '../scripts/distribution-profile.mjs';
const profile={BERRYIT_PUBLIC_BACKEND_URL:'http://127.0.0.1:18750',BERRYIT_PUBLIC_ANON_KEY:'sb_publishable_synthetic_test_only',BERRYIT_PUBLIC_CONTROL_URL:''};
const jwt=(payload:object,alg='HS256')=>[Buffer.from(JSON.stringify({alg,typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify(payload)).toString('base64url'),'synthetic_signature'].join('.');
describe('owner installer release gate',()=>{
 it('defaults to owner; generic requires an explicit switch',()=>{
  expect(packageKind([])).toBe('owner');expect(packageKind(['--owner'])).toBe('owner');expect(packageKind(['--generic'])).toBe('generic');
  for(const args of [['--generic','--owner'],['--unknown']])expect(()=>packageKind(args)).toThrow();
 });
 it('refuses missing and partial owner profiles',()=>{
  for(const p of [{},{...profile,BERRYIT_PUBLIC_ANON_KEY:''},{...profile,BERRYIT_PUBLIC_BACKEND_URL:''}])expect(()=>distributionProfile(p)).toThrow('fullständig');
 });
 it('generic never inherits local owner settings or secrets',()=>{
  expect(distributionProfile({...profile,BERRYIT_PUBLIC_ANON_KEY:'sb_secret_must_not_ship'},'generic')).toEqual(Object.fromEntries(publicNames.map(name=>[name,''])));
 });
 it('keeps unconfigured development possible',()=>{expect(distributionProfile({},'development').BERRYIT_PUBLIC_BACKEND_URL).toBe('');});
 it('rejects unknown profile kinds',()=>{expect(()=>distributionProfile(profile,'unknown')).toThrow('Okänd');});
 it('rejects credentials, paths, insecure public HTTP and URI schemes',()=>{
  for(const url of ['https://user:pass@example.test','https://example.test/path','https://example.test?q=x','https://example.test/#x','http://example.test','file:///test'])expect(()=>distributionProfile({...profile,BERRYIT_PUBLIC_BACKEND_URL:url})).toThrow('origin');
 });
 it('validates an optional Control origin without inventing it',()=>{
  expect(distributionProfile(profile).BERRYIT_PUBLIC_CONTROL_URL).toBe('');
  expect(()=>distributionProfile({...profile,BERRYIT_PUBLIC_CONTROL_URL:'https://example.test/api'})).toThrow();
 });
 it('accepts only anon legacy JWTs or publishable client keys',()=>{
  expect(distributionProfile({...profile,BERRYIT_PUBLIC_ANON_KEY:jwt({role:'anon'})}).BERRYIT_PUBLIC_ANON_KEY).toBeTruthy();
  for(const key of ['random-key',jwt({role:'authenticated'}),jwt({role:'anon'},'none'),jwt({role:'anon',exp:1})])expect(()=>distributionProfile({...profile,BERRYIT_PUBLIC_ANON_KEY:key})).toThrow('publik');
 });
 it('never prints an administrative key in validation errors',()=>{
  for(const key of ['sb_secret_synthetic_must_not_ship',jwt({role:'service_role'})]){
   try{distributionProfile({...profile,BERRYIT_PUBLIC_ANON_KEY:key});throw new Error('expected rejection');}catch(e){expect((e as Error).message).toContain('Administrativa');expect((e as Error).message).not.toContain(key);}
  }
 });
});
