import {FactoryError} from '../contract.mjs';
/** Provider selection is an operator-side allowlist, never a request URL or
 * arbitrary module path supplied by a browser. Live entries remain disabled. */
export class ProviderRegistry {
 #entries=new Map();
 register(id,provider){
  if(!/^[a-z][a-z0-9-]{1,40}$/.test(id)||this.#entries.has(id)||!provider||!['MOCK','HTTP_CONTRACT','HTTP_PROVIDER'].includes(provider.mode))throw new FactoryError('INVALID_PROVIDER','Okänd eller dubblerad provider.');
  this.#entries.set(id,provider);return this;
 }
 list(){return [...this.#entries].map(([id,p])=>({id,mode:p.mode,liveEnabled:false}));}
 forInspection(id){const p=this.#entries.get(id);if(p?.mode!=='HTTP_PROVIDER'||typeof p.discover!=='function'||typeof p.inspect!=='function')throw new FactoryError('INVALID_PROVIDER','Godkänd provideradapter för inspektion saknas.');return p;}
 forJob(id){const p=this.#entries.get(id);if(p?.mode!=='MOCK'||typeof p.ensure!=='function'||typeof p.verify!=='function')throw new FactoryError('BLOCKED_LIVE_PROVIDER','Providern är inte godkänd för detta lokala jobb.');return p;}
}
