import assert from 'node:assert/strict';
import {handleTransactionReserve} from '../src/transaction-reserve.js';

const originalFetch=globalThis.fetch;
try{
  const url='https://tracking.example/api/admin/transactions/reserve';

  const denied=await handleTransactionReserve(new Request(url,{method:'POST'}),{ADMIN_TOKEN:'secret'});
  assert.equal(denied.status,401,'reserve endpoint rejects missing bearer token');

  let unexpectedFetches=0;
  globalThis.fetch=async()=>{unexpectedFetches++;throw new Error('fetch must not run')};

  const noCore=await handleTransactionReserve(
    new Request(url,{method:'POST',headers:{authorization:'Bearer secret'}}),
    {ADMIN_TOKEN:'secret',TRACKING_DB:{prepare(){throw new Error('D1 allocator must not run')}}}
  );
  assert.equal(noCore.status,503,'reservation requires Business Core configuration');
  assert.equal((await noCore.json()).authority,'business-core');
  assert.equal(unexpectedFetches,0,'missing Business Core config never falls back to D1');

  const partialCore=await handleTransactionReserve(
    new Request(url,{method:'POST',headers:{authorization:'Bearer secret'}}),
    {ADMIN_TOKEN:'secret',BUSINESS_CORE_URL:'https://business-core.example'}
  );
  assert.equal(partialCore.status,503,'partial Business Core configuration is rejected');
  assert.equal(unexpectedFetches,0);

  let coreCalls=0;
  globalThis.fetch=async(fetchUrl,options)=>{
    coreCalls++;
    assert.equal(fetchUrl,'https://business-core.example/v1/transactions/reserve');
    assert.equal(options.headers.authorization,'Bearer core-secret');
    const body=JSON.parse(options.body);
    assert.equal(body.source_system,'package-tracking');
    assert.equal(body.source_reference,'tracking-reserve:retry-001');
    assert.equal(body.idempotency_key,'package-tracking:retry-001');
    return new Response(JSON.stringify({
      ok:true,
      sequence:900,
      masterTransactionId:'TTG-TXN-000900',
      reserved:true
    }),{status:201,headers:{'content-type':'application/json'}});
  };

  const coreRequest=new Request(url,{
    method:'POST',
    headers:{authorization:'Bearer secret','x-idempotency-key':'retry-001'}
  });
  const delegated=await handleTransactionReserve(coreRequest,{
    ADMIN_TOKEN:'secret',
    BUSINESS_CORE_URL:'https://business-core.example',
    BUSINESS_CORE_TOKEN:'core-secret'
  });
  const delegatedPayload=await delegated.json();
  assert.equal(delegated.status,200);
  assert.equal(delegatedPayload.masterTransactionId,'TTG-TXN-000900');
  assert.equal(delegatedPayload.authority,'business-core');
  assert.equal(coreCalls,1,'configured Tracking delegates allocation exactly once');

  globalThis.fetch=async()=>{
    coreCalls++;
    return new Response(JSON.stringify({ok:false,error:'postgres unavailable'}),{
      status:503,
      headers:{'content-type':'application/json'}
    });
  };
  const coreDown=await handleTransactionReserve(coreRequest,{
    ADMIN_TOKEN:'secret',
    BUSINESS_CORE_URL:'https://business-core.example',
    BUSINESS_CORE_TOKEN:'core-secret',
    TRACKING_DB:{prepare(){throw new Error('D1 fallback forbidden')}}
  });
  assert.equal(coreDown.status,503,'Business Core failure does not fall back to D1');
  assert.equal((await coreDown.json()).authority,'business-core');

  console.log(JSON.stringify({
    ok:true,
    checks:[
      'admin-auth',
      'business-core-required',
      'partial-config-rejected',
      'delegated-reservation',
      'no-d1-fallback'
    ]
  },null,2));
} finally {
  globalThis.fetch=originalFetch;
}
