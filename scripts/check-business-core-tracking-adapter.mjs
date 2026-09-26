import assert from 'node:assert/strict';
import fs from 'node:fs';

const reserveSource=fs.readFileSync(new URL('../src/transaction-reserve.js',import.meta.url),'utf8');
const docOpsSource=fs.readFileSync(new URL('../src/docops-reserve.js',import.meta.url),'utf8');
const bootstrapSource=fs.readFileSync(new URL('../src/d1-bootstrap.js',import.meta.url),'utf8');
const schemaSource=fs.readFileSync(new URL('../schema.sql',import.meta.url),'utf8');

for(const [label,source] of [
  ['transaction reserve runtime',reserveSource],
  ['Document Operations reserve runtime',docOpsSource]
]){
  assert.doesNotMatch(source,/reserveMasterTransaction|legacy-d1|RESERVE_SQL|SEQUENCE_TABLE_SQL/,label+' must not contain a D1 allocator/fallback');
}
assert.doesNotMatch(bootstrapSource,/tracking_sequences/,'fresh D1 bootstrap must not create tracking_sequences');
assert.doesNotMatch(schemaSource,/tracking_sequences/,'fresh D1 schema must not create tracking_sequences');

import {handleClientLookup} from '../src/client-lookup.js';

const originalFetch=globalThis.fetch;

function jsonResponse(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{'content-type':'application/json'}
  });
}

function trackingRequest(path,body,authorized=true){
  return new Request('https://tracking.example'+path,{
    method:'POST',
    headers:{
      'content-type':'application/json',
      ...(authorized?{authorization:'Bearer admin-secret'}:{})
    },
    body:JSON.stringify(body)
  });
}

function env(overrides={}){
  return {
    ADMIN_TOKEN:'admin-secret',
    TRACKING_DB:{},
    BUSINESS_CORE_URL:'https://business-core.example',
    BUSINESS_CORE_TOKEN:'core-secret',
    ...overrides
  };
}

try{
  let fetchCalls=0;
  let coreCalls=0;
  const fakeCore={
    async fetch(request){
      coreCalls++;
      const u=new URL(request.url);
      assert.equal(u.pathname,'/api/admin/jobs/upsert');
      const body=await request.json();
      assert.equal(body.job.masterTransactionId,'TTG-TXN-000900');
      return jsonResponse({
        ok:true,
        id:77,
        masterTransactionId:'TTG-TXN-000900',
        aliases:['TTG-TXN-000900','TTG-RCP-000900']
      });
    }
  };

  globalThis.fetch=async(url,options={})=>{
    fetchCalls++;
    const u=new URL(url);
    assert.equal(options.headers.authorization,'Bearer core-secret');

    if(options.method==='GET'){
      assert.equal(u.pathname,'/v1/transactions/TTG-TXN-000900');
      return jsonResponse({
        ok:true,
        transaction:{master_transaction_id:'TTG-TXN-000900'}
      });
    }

    assert.equal(options.method,'POST');
    assert.equal(u.pathname,'/v1/transactions/TTG-TXN-000900/references');
    const body=JSON.parse(options.body);
    assert.equal(body.domain,'tracking');
    assert.equal(body.source_system,'package-tracking');

    if(body.reference_type==='job_id'){
      assert.equal(body.reference_value,'77');
    }else if(body.reference_type==='public_reference'){
      assert.equal(body.reference_value,'TTG-RCP-000900');
    }else{
      assert.fail('unexpected Tracking reference type: '+body.reference_type);
    }

    return jsonResponse({
      ok:true,
      created:true,
      reference:{
        master_transaction_id:'TTG-TXN-000900',
        domain:'tracking',
        reference_type:body.reference_type,
        reference_value:body.reference_value
      }
    },201);
  };

  const started=await handleClientLookup(
    trackingRequest('/api/admin/transactions/start',{
      job:{
        masterTransactionId:'TTG-TXN-000900',
        publicReference:'TTG-RCP-000900',
        clientName:'Synthetic Client'
      }
    }),
    env(),
    {},
    fakeCore
  );
  const startedPayload=await started.json();
  assert.equal(started.status,200);
  assert.equal(coreCalls,1,'D1 job upsert executes exactly once');
  assert.equal(fetchCalls,3,'Business Core verify + two immutable reference binds');
  assert.equal(startedPayload.businessCoreLinked,true);
  assert.equal(startedPayload.businessCoreReferenceCount,2);
  assert.equal(startedPayload.authority,'business-core');
  assert.equal(startedPayload.phoneLinked,false);

  fetchCalls=0;
  coreCalls=0;
  const unauthorized=await handleClientLookup(
    trackingRequest('/api/admin/jobs/upsert',{
      job:{masterTransactionId:'TTG-TXN-000900'}
    },false),
    env(),
    {},
    fakeCore
  );
  assert.equal(unauthorized.status,401);
  assert.equal(fetchCalls,0,'unauthorized upsert cannot query Business Core');
  assert.equal(coreCalls,0,'unauthorized upsert cannot write D1');

  const noConfig=await handleClientLookup(
    trackingRequest('/api/admin/jobs/upsert',{
      job:{masterTransactionId:'TTG-TXN-000900'}
    }),
    env({BUSINESS_CORE_URL:undefined,BUSINESS_CORE_TOKEN:undefined}),
    {},
    fakeCore
  );
  assert.equal(noConfig.status,503);
  assert.equal((await noConfig.json()).authority,'business-core');
  assert.equal(coreCalls,0,'missing Business Core configuration blocks D1 job creation');

  globalThis.fetch=async(url,options={})=>{
    fetchCalls++;
    assert.equal(options.method,'GET');
    return jsonResponse({ok:false,error:'not_found'},404);
  };
  const missingMaster=await handleClientLookup(
    trackingRequest('/api/admin/jobs/upsert',{
      job:{masterTransactionId:'TTG-TXN-000901'}
    }),
    env(),
    {},
    fakeCore
  );
  assert.equal(missingMaster.status,404);
  assert.equal((await missingMaster.json()).error,'MASTER_TRANSACTION_NOT_FOUND');
  assert.equal(coreCalls,0,'unknown Business Core master is rejected before D1 write');

  coreCalls=0;
  let bindAttempts=0;
  globalThis.fetch=async(url,options={})=>{
    const u=new URL(url);
    if(options.method==='GET'){
      return jsonResponse({
        ok:true,
        transaction:{master_transaction_id:'TTG-TXN-000900'}
      });
    }
    bindAttempts++;
    return jsonResponse({ok:false,error:'postgres unavailable'},503);
  };
  const partial=await handleClientLookup(
    trackingRequest('/api/admin/transactions/start',{
      job:{
        masterTransactionId:'TTG-TXN-000900',
        publicReference:'TTG-RCP-000900'
      }
    }),
    env(),
    {},
    fakeCore
  );
  const partialPayload=await partial.json();
  assert.equal(partial.status,503);
  assert.equal(coreCalls,1,'D1 save may precede relationship registration');
  assert.equal(bindAttempts,1);
  assert.equal(partialPayload.trackingSaved,true);
  assert.equal(partialPayload.authority,'business-core');
  assert.equal(partialPayload.masterTransactionId,'TTG-TXN-000900');

  console.log(JSON.stringify({
    ok:true,
    checks:[
      'verify-master-before-d1',
      'bind-tracking-job-id',
      'bind-tracking-public-reference',
      'unauthorized-no-side-effects',
      'missing-core-blocks-d1',
      'unknown-master-blocks-d1',
      'partial-reference-sync-recoverable'
    ]
  },null,2));
} finally {
  globalThis.fetch=originalFetch;
}
