import { FactoryError, OPERATIONS, DEFAULT_STORAGE_QUOTA } from '../contract.mjs';

export const QABGO_VERSION='01d27b5ccd9e669d8dfb8e3fe9f785332a35d397';
const technical=[
 ['account','Cloudflare-konto eller uttryckligen vald resursisolering',[]],
 ['database','Egen databas och egna begränsade databasidentiteter',[]],
 ['migrations','Pinnade, checksumskyddade QABGO-migrationer',['database']],
 ['storage','Dedikerad objektlagring',['account']],
 ['quota','Atomisk serverkvot för objektlagring',['storage']],
 ['identity','Betrodd ONARLY-ägarkoppling och säker produktaktivering',['migrations']],
 ['runtime','Customer, Driver, Call Center och Core',['migrations']],
 ['domain','Verifierat domänägarskap och DNS',['account','runtime']],
 ['tls','Verifierad HTTPS',['domain']],
 ['email','Vald e-postmodell och verifierad mottagare',['domain']],
 ['backup','Backup samt verifierad återställning',['migrations','storage']],
 ['health','Health genom instansens riktiga anslutningsväg',['runtime','identity']],
 ['isolation','Isolering mellan instanser och bakgrundsjobb',['quota','identity','runtime']],
];
const external=[['company','Företags- och åkeriuppgifter',true],['drivers','Förare',false],['vehicles','Fordon',false],['pricing','Prisområden och godkänd prismodell',true],['payments','Betalningsavtal',false],['swish','Swish',false],['klarna','Klarna',false],['card','Apple Pay/kortleverantör',false],['halda','Halda M2',false],['bankid','BankID om beställt',false],['carriers','Externa åkerier',false]];

export function createQabgoAdapter(template) {
  if(template.productId!=='qabgo'||template.version!==QABGO_VERSION||template.seedPolicy!=='schema-and-neutral-only')throw new FactoryError('INVALID_TEMPLATE','QABGO-mallen är inte godkänd för lokal granskning.');
  const adapter={
    productId:'qabgo',versions:[QABGO_VERSION],releaseApproval:'LOCAL_REVIEW_ONLY',
    profiles:{runtime:'node24-four-apps',database:'postgresql16-dedicated',storage:'dedicated-r2',domain:'verified-custom-domain',auth:'existing-onarly-identity-plus-product-activation',email:'explicit-routing-or-provider'},
    defaultQuotaBytes:DEFAULT_STORAGE_QUOTA,
    checklist() {
      return [
        ...technical.map(([id,title,dependsOn])=>({id,title,description:id==='quota'?`Standard för nya plattformar: ${DEFAULT_STORAGE_QUOTA/1_000_000_000} GB (${DEFAULT_STORAGE_QUOTA} byte). Större kvot kan anges; faktisk instanskvot visas separat.`:title,productId:'qabgo',type:'AUTO',required:true,dependsOn,status:'NOT_STARTED',verificationMethod:'provider-evidence',responsible:'factory-worker',verifiedAt:null,error:null,actionLink:'/control/factory'})),
        ...external.map(([id,title,required])=>({id,title,description:'Kundens uppgifter/avtal. Ingen koppling aktiveras automatiskt.',productId:'qabgo',type:id==='company'||id==='pricing'?'MANUAL':'EXTERNAL',required,dependsOn:[],status:required?'WAITING_FOR_USER':'NOT_APPLICABLE',verificationMethod:required?'manual-attestation':'separate-provider-activation',responsible:'platform-owner',verifiedAt:null,error:null,actionLink:'/control/factory'})),
      ];
    },
    template,
  };
  for(const operation of OPERATIONS)adapter[operation]=async context=>{
    if(operation==='provision'||operation==='retry'||operation==='reconcile')return context.provider.ensure(context);
    if(operation==='verify')return context.provider.verify(context);
    if(operation==='safeCleanup')return context.provider.cleanupPreview(context);
    if(['upgrade','suspend','backup','restore'].includes(operation))return context.provider.operation({...context,operation});
    throw new FactoryError('UNSUPPORTED_OPERATION','Operationen saknar godkänt kontrakt.');
  };
  return adapter;
}
