import assert from 'node:assert/strict';
import {handleTransactionReserve} from '../src/transaction-reserve.js';

const originalFetch=globalThis.fetch;
try{
  let d1Touched=false;
  const forbiddenD1={prepare(){d1Touched=true;throw new Error('D1 allocator must not be touched')}};
  const endpoint='https://tracking.example/api/admin/transactions/reserve';

  const denied=await handleTransactionReserve(new Request(endpoint,{method:'POST'}),{
    ADMIN_TOKEN:'secret',
    TRACKING_DB:forbiddenD1
  });
  assert.equal(denied.status,401);

  const missing=await handleTransactionReserve(new Request(endpoint,{
    method:'POST',headers:{authorization:'Bearer secret'}
  }),{
    ADMIN_TOKEN:'secret',
    TRACKING_DB:forbiddenD1
  });
  assert.equal(missing.status,503);
  assert.equal((await missing.json()).authority,'business-core');
  assert.equal(d1Touched,false,'missing Business Core config must not fall back to D1');

  const incomplete=await handleTransactionReserve(new Request(endpoint,{
    method:'POST',headers:{authorization:'Bearer secret'}
  }),{
    ADMIN_TOKEN:'secret',
    BUSINESS_CORE_URL:'https://business-core.example',
    TRACKING_DB:forbiddenD1
  });
  assert.equal(incomplete.status,503);
  assert.equal((await incomplete.json()).error,'BUSINESS_CORE_CONFIGURATION_INCOMPLETE');
  assert.equal(d1Touched,false);

  let coreCalls=0;
  globalThis.fetch=async(url,options)=>{
    coreCalls++;
    assert.equal(url,'https://business-core.example/v1/transactions/reserve');
    assert.equal(options.headers.get('authorization'),'Bearer core-secret');
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

  const coreRequest=new Request(endpoint,{
    method:'POST',
    headers:{authorization:'Bearer secret','x-idempotency-key':'retry-001'}
  });
  const delegated=await handleTransactionReserve(coreRequest,{
    ADMIN_TOKEN:'secret',
    BUSINESS_CORE_URL:'https://business-core.example',
    BUSINESS_CORE_TOKEN:'core-secret',
    TRACKING_DB:forbiddenD1
  });
  const delegatedPayload=await delegated.json();
  assert.equal(delegated.status,200);
  assert.equal(delegatedPayload.masterTransactionId,'TTG-TXN-000900');
  assert.equal(delegatedPayload.authority,'business-core');
  assert.equal(coreCalls,1);
  assert.equal(d1Touched,false);

  globalThis.fetch=async()=>new Response(JSON.stringify({ok:false,error:'postgres unavailable'}),{
    status:503,headers:{'content-type':'application/json'}
  });
  const coreDown=await handleTransactionReserve(coreRequest,{
    ADMIN_TOKEN:'secret',
    BUSINESS_CORE_URL:'https://business-core.example',
    BUSINESS_CORE_TOKEN:'core-secret',
    TRACKING_DB:forbiddenD1
  });
  assert.equal(coreDown.status,503);
  assert.equal((await coreDown.json()).authority,'business-core');
  assert.equal(d1Touched,false,'Business Core outage must never trigger legacy D1 allocation');

  console.log(JSON.stringify({
    ok:true,
    checks:[
      'reserve.auth',
      'reserve.core-required',
      'reserve.partial-config-fails-closed',
      'reserve.delegates-once',
      'reserve.no-d1-fallback'
    ]
  },null,2));
} finally {
  globalThis.fetch=originalFetch;
}
