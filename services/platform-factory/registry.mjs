import { FactoryError, validateAdapter } from './contract.mjs';

// Adapter metadata references the canonical ONARLY product IDs. It is not a
// second commercial product/plan or customer registry.
export class ProductRegistry {
  #adapters=new Map();
  constructor(catalog) { this.catalog=structuredClone(catalog); }
  register(adapter) {
    validateAdapter(adapter);
    if(!this.catalog.some(p=>p.id===adapter.productId)||this.#adapters.has(adapter.productId))throw new FactoryError('INVALID_ADAPTER','Okänd eller dubblerad produktadapter.');
    this.#adapters.set(adapter.productId,adapter); return this;
  }
  get(id,version) {
    const adapter=this.#adapters.get(id);
    if(!adapter || !adapter.versions.includes(version))throw new FactoryError('ADAPTER_NOT_APPROVED','Produkten/versionen saknar verifierad adapter.');
    return adapter;
  }
  list() {return this.catalog.map(p=>({...p,adapterAvailable:this.#adapters.has(p.id),liveProvisioning:false}));}
}

export const catalogProvenance=Object.freeze({repository:'Glasso-design/onarly-main',commit:'37654cfa5b14a316bd2d513cb09ef6c1e621261e',source:'src/core/products/registry.ts',scope:'Adapter capability overlay; no subscriptions or user identities copied'});
export const PRODUCT_CATALOG=Object.freeze([
  ...[['hub','ONARLY Hub'],['radio','ONARLY Radio'],['video','ONARLY Video Studio'],['director','ONARLY DIRECTOR'],['sport','ONARLY ARENA'],['performance','ONARLY PERFORMANCE'],['forge','ONARLY COMPOSER'],['flexx','ONARLY FLEXX'],['asset-manager','ONARLY Asset Manager'],['control','ONARLY CONTROL'],['admin','ONARLY ADMIN'],['face','ONARLY FACE'],['drive','ONARLY DRIVE'],['create','ONARLY CREATE']].map(([id,name])=>({id,name,status:'MANUAL_SETUP_REQUIRED',reason:'Befintlig produktidentitet; ren distributionsadapter och full isolering ej verifierade.'})),
  {id:'qabgo',name:'QABGO · Customer / Driver / Call Center / Core',status:'ADAPTER_IN_DEVELOPMENT',reason:'Lokal ren installationsmall. Molnprovisionering och releasegodkännande kräver separata grindar.'},
  ...[['visi','VISI'],['printhaus','Printhaus'],['fliqs','FLIQS'],['baravara','Bara Vara Jag'],['berryit','BerryIT Support Desk']].map(([id,name])=>({id,name,status:'MANUAL_SETUP_REQUIRED',reason:'Separat repository inventerat; adapter och godkänd ren distributionsmodell återstår.'})),
  {id:'printbuddy',name:'PrintBuddy',status:'NOT_PROVISIONABLE',reason:'Skrivar-/desktopbunden produkt utan godkänd SaaS-distribution.'},
  ...[['onarly-desk','ONARLY DESK'],['qabgo-driver','QABGO Driver (fristående)'],['qabgo-call-center','QABGO Call Center (fristående)'],['qabgo-core','QABGO Core (fristående)'],['night-fare','Night Fare'],['caseline','CASELINE']].map(([id,name])=>({id,name,status:'NOT_PROVISIONABLE',reason:'Klient/spel eller delprodukt utan godkänd självständig SaaS-distribution. QABGO-delar ingår i huvudprodukten.'})),
  {id:'onarly-hq',name:'ONARLY HQ',status:'NOT_PROVISIONABLE',reason:'Ingen entydig godkänd produkt-/repositoryidentitet styrkt.'},
  {id:'onarly-arenahub',name:'ONARLY ARENAHUB',status:'NOT_PROVISIONABLE',reason:'Får inte likställas med ARENA/SPORT utan godkänt identitetsbeslut.'},
]);
