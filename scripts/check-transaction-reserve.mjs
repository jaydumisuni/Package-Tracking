import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  businessCoreConfigurationState,
  handleTransactionReserve
} from '../src/transaction-reserve.js';
import {handleDocOpsReserve} from '../src/docops-reserve.js';

const root=new URL('..',import.meta.url);
for(const [path,tokens] of [
  ['../src/transaction-reserve.js',['legacy-d1','reserveMasterTransaction','tracking_sequences','RESERVE_SQL']],
  ['../src/docops-reserve.js',['legacy-d1','reserveMasterTransaction']],
  ['../schema.sql',['tracking_sequences']],
  ['../src/d1-bootstrap.js',['tracking_sequences']]
]){
  const source=fs.readFileSync(new URL(path,import.meta.url),'utf8');
  for(const token of tokens){
    assert.equal(source.includes(token),false,`${path} must not contain legacy allocator token ${token}`);
  }
}

assert.equal(businessCoreConfigurationState({}),'missing');
assert.equal(businessCoreConfigurationState({BUSINESS_CORE_URL:'https://core.example'}),'partial');
assert.equal(businessCoreConfigurationState({BUSINESS_CORE_TOKEN:'token'}),'partial');
assert.equal(
  businessCoreConfigurationState({
    BUSINESS_CORE_URL:'https://core.example',
    BUSINESS_CORE_TOKEN:'token'
  }),
  'ready'
);

const originalFetch=globalThis.fetch;
try{
  const adminUrl='https://tracking.example/api/admin/transactions/reserve';
  const unauthorized=await handleTransactionReserve(new Request(adminUrl,{method:'POST'}),{
    ADMIN_TOKEN:'secret'
  });
  assert.equal(unauthorized.status,401);

  const adminRequest=new Request(adminUrl,{
    method:'POST',
    headers:{
      authorization:'Bearer secret',
      'x-idempotency-key':'reserve-001'
    }
  });

  const missing=await handleTransactionReserve(adminRequest,{ADMIN_TOKEN:'secret'});
  const missingPayload=await missing.json();
  assert.equal(missing.status,503);
  assert.equal(missingPayload.error,'BUSINESS_CORE_REQUIRED');
  assert.equal(missingPayload.authority,'business-core');

  const partial=await handleTransactionReserve(adminRequest,{
    ADMIN_TOKEN:'secret',
    BUSINESS_CORE_URL:'https://business-core.example'
  });
  const partialPayload=await partial.json();
  assert.equal(partial.status,503);
  assert.equal(partialPayload.error,'BUSINESS_CORE_CONFIGURATION_INCOMPLETE');
  assert.equal(partialPayload.authority,'business-core');

  let coreCalls=0;
  globalThis.fetch=async(url,options)=>{
    coreCalls++;
    assert.equal(url,'https://business-core.example/v1/transactions/reserve');
    assert.equal(options.headers.authorization,'Bearer core-secret');
    assert.equal(options.headers['x-idempotency-key'],'reserve-001');
    const body=JSON.parse(options.body);
    assert.equal(body.source_system,'package-tracking');
    assert.equal(body.source_reference,'tracking-reserve:reserve-001');
    assert.equal(body.idempotency_key,'package-tracking:reserve-001');
    return new Response(JSON.stringify({
      ok:true,
      sequence:900,
      masterTransactionId:'TTG-TXN-000900',
      reserved:true
    }),{status:201,headers:{'content-type':'application/json'}});
  };

  const delegated=await handleTransactionReserve(adminRequest,{
    ADMIN_TOKEN:'secret',
    BUSINESS_CORE_URL:'https://business-core.example',
    BUSINESS_CORE_TOKEN:'core-secret',
    TRACKING_DB:{prepare(){throw new Error('D1 allocator must not be touched')}}
  });
  const delegatedPayload=await delegated.json();
  assert.equal(delegated.status,200);
  assert.equal(delegatedPayload.masterTransactionId,'TTG-TXN-000900');
  assert.equal(delegatedPayload.authority,'business-core');
  assert.equal(coreCalls,1);

  globalThis.fetch=async(url,options)=>{
    coreCalls++;
    const body=JSON.parse(options.body);
    assert.equal(body.idempotency_key,'package-tracking:reserve-001');
    return new Response(JSON.stringify({
      ok:true,
      sequence:900,
      masterTransactionId:'TTG-TXN-000900',
      reserved:false
    }),{status:200,headers:{'content-type':'application/json'}});
  };

  const idempotentRetry=await handleTransactionReserve(adminRequest,{
    ADMIN_TOKEN:'secret',
    BUSINESS_CORE_URL:'https://business-core.example',
    BUSINESS_CORE_TOKEN:'core-secret'
  });
  const retryPayload=await idempotentRetry.json();
  assert.equal(idempotentRetry.status,200);
  assert.equal(retryPayload.masterTransactionId,'TTG-TXN-000900');
  assert.equal(retryPayload.reserved,false);
  assert.equal(retryPayload.authority,'business-core');
  assert.equal(coreCalls,2);

  globalThis.fetch=async()=>new Response(JSON.stringify({
    ok:false,
    error:'postgres unavailable'
  }),{status:503,headers:{'content-type':'application/json'}});

  const coreDown=await handleTransactionReserve(adminRequest,{
    ADMIN_TOKEN:'secret',
    BUSINESS_CORE_URL:'https://business-core.example',
    BUSINESS_CORE_TOKEN:'core-secret',
    TRACKING_DB:{prepare(){throw new Error('D1 fallback attempted')}}
  });
  const coreDownPayload=await coreDown.json();
  assert.equal(coreDown.status,503);
  assert.equal(coreDownPayload.error,'BUSINESS_CORE_RESERVATION_FAILED');
  assert.equal(coreDownPayload.authority,'business-core');

  globalThis.fetch=async()=>new Response(JSON.stringify({
    ok:true,
    sequence:901,
    masterTransactionId:'BROKEN-901',
    reserved:true
  }),{status:201,headers:{'content-type':'application/json'}});

  const malformed=await handleTransactionReserve(adminRequest,{
    ADMIN_TOKEN:'secret',
    BUSINESS_CORE_URL:'https://business-core.example',
    BUSINESS_CORE_TOKEN:'core-secret'
  });
  const malformedPayload=await malformed.json();
  assert.equal(malformed.status,503);
  assert.equal(malformedPayload.error,'BUSINESS_CORE_RESERVATION_FAILED');

  let auditWrites=0;
  const trackingDb={
    prepare(sql){
      assert.match(sql,/tracking_staff_audit/);
      return {
        bind(){return this},
        async run(){auditWrites++;return {success:true}}
      };
    }
  };
  const authService={
    async fetch(){
      return new Response(JSON.stringify({
        user:{
          id:'staff-1',
          email:'staff@example.invalid',
          displayName:'TTG Staff',
          role:'owner_admin',
          status:'approved',
          permissions:['pos.admin']
        }
      }),{status:200,headers:{'content-type':'application/json'}});
    }
  };
  const docRequest=new Request('https://tracking.example/api/ops/transactions/reserve',{
    method:'POST',
    headers:{
      cookie:'ttg_tracking_session=session-token',
      'x-idempotency-key':'docops-001'
    }
  });

  globalThis.fetch=async()=>{throw new Error('Business Core fetch must not occur without config')};
  const docMissing=await handleDocOpsReserve(docRequest,{
    TTG_AUTH:authService,
    TRACKING_DB:trackingDb
  });
  const docMissingPayload=await docMissing.json();
  assert.equal(docMissing.status,503);
  assert.equal(docMissingPayload.error,'BUSINESS_CORE_REQUIRED');
  assert.equal(docMissingPayload.authority,'business-core');
  assert.equal(auditWrites,0);

  globalThis.fetch=async(url,options)=>{
    assert.equal(url,'https://business-core.example/v1/transactions/reserve');
    const body=JSON.parse(options.body);
    assert.equal(body.idempotency_key,'package-tracking:docops-001');
    return new Response(JSON.stringify({
      ok:true,
      sequence:902,
      masterTransactionId:'TTG-TXN-000902',
      reserved:true
    }),{status:201,headers:{'content-type':'application/json'}});
  };

  const docDelegated=await handleDocOpsReserve(docRequest,{
    TTG_AUTH:authService,
    TRACKING_DB:trackingDb,
    BUSINESS_CORE_URL:'https://business-core.example',
    BUSINESS_CORE_TOKEN:'core-secret'
  });
  const docDelegatedPayload=await docDelegated.json();
  assert.equal(docDelegated.status,200);
  assert.equal(docDelegatedPayload.masterTransactionId,'TTG-TXN-000902');
  assert.equal(docDelegatedPayload.authority,'business-core');
  assert.equal(auditWrites,1);

  globalThis.fetch=async()=>new Response(JSON.stringify({
    ok:false,
    error:'postgres unavailable'
  }),{status:503,headers:{'content-type':'application/json'}});

  const docCoreDown=await handleDocOpsReserve(docRequest,{
    TTG_AUTH:authService,
    TRACKING_DB:trackingDb,
    BUSINESS_CORE_URL:'https://business-core.example',
    BUSINESS_CORE_TOKEN:'core-secret'
  });
  const docCoreDownPayload=await docCoreDown.json();
  assert.equal(docCoreDown.status,503);
  assert.equal(docCoreDownPayload.authority,'business-core');
  assert.equal(auditWrites,1,'failed Business Core reservation must not write success audit');

  console.log(JSON.stringify({
    ok:true,
    checks:35,
    allocatorAuthority:'business-core-only',
    adminFailClosed:true,
    docOpsFailClosed:true
  },null,2));
}finally{
  globalThis.fetch=originalFetch;
}
