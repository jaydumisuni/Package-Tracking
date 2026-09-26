import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {RESERVE_SQL,SEQUENCE_TABLE_SQL,formatMasterTransactionId,handleTransactionReserve} from '../src/transaction-reserve.js';

class D1Statement {
  constructor(statement){this.statement=statement;this.args=[]}
  bind(...args){this.args=args;return this}
  async run(){return this.statement.run(...this.args)}
  async first(){return this.statement.get(...this.args)||null}
}
class D1Database {
  constructor(db){this.db=db}
  prepare(sql){return new D1Statement(this.db.prepare(sql))}
}

const db=new DatabaseSync(':memory:');
const originalFetch=globalThis.fetch;
try{
  db.exec(`CREATE TABLE tracking_jobs (master_transaction_id TEXT NOT NULL UNIQUE);`);
  db.exec(SEQUENCE_TABLE_SQL);
  const reserve=()=>db.prepare(RESERVE_SQL).get(new Date().toISOString()).reserved;

  assert.equal(reserve(),1,'empty database starts at 1');
  assert.equal(formatMasterTransactionId(1),'TTG-TXN-000001');
  assert.equal(reserve(),2,'second reservation increments even before a job is created');

  db.prepare('INSERT INTO tracking_jobs(master_transaction_id) VALUES (?)').run('TTG-TXN-000060');
  assert.equal(reserve(),61,'sequence catches up to a higher existing transaction');
  assert.equal(reserve(),62,'sequence remains monotonic after catch-up');

  db.prepare('INSERT INTO tracking_jobs(master_transaction_id) VALUES (?)').run('TTG-TXN-ABC123');
  assert.equal(reserve(),63,'non-numeric transaction aliases do not corrupt sequence');

  const request=new Request('https://tracking.example/api/admin/transactions/reserve',{method:'POST'});
  const denied=await handleTransactionReserve(request,{ADMIN_TOKEN:'secret',TRACKING_DB:new D1Database(db)});
  assert.equal(denied.status,401,'reserve endpoint rejects missing bearer token');

  const unavailable=await handleTransactionReserve(new Request(request.url,{method:'POST',headers:{authorization:'Bearer secret'}}),{ADMIN_TOKEN:'secret'});
  assert.equal(unavailable.status,503,'legacy reserve endpoint rejects missing D1 binding when Business Core is not configured');

  const allowed=await handleTransactionReserve(new Request(request.url,{method:'POST',headers:{authorization:'Bearer secret'}}),{ADMIN_TOKEN:'secret',TRACKING_DB:new D1Database(db)});
  const payload=await allowed.json();
  assert.equal(allowed.status,200);
  assert.equal(payload.masterTransactionId,'TTG-TXN-000064','legacy compatibility path returns next D1-owned master ID');
  assert.equal(payload.authority,'legacy-d1');

  const beforeRequiredOnly=db.prepare('SELECT current_value FROM tracking_sequences WHERE name=?').get('transaction').current_value;
  const requiredOnly=await handleTransactionReserve(new Request(request.url,{method:'POST',headers:{authorization:'Bearer secret'}}),{
    ADMIN_TOKEN:'secret',
    BUSINESS_CORE_REQUIRED:'true',
    TRACKING_DB:new D1Database(db)
  });
  assert.equal(requiredOnly.status,503,'required Business Core configuration fails closed when URL/token are incomplete');
  const requiredOnlyPayload=await requiredOnly.json();
  assert.equal(requiredOnlyPayload.authority,'business-core');
  assert.equal(requiredOnlyPayload.d1Committed,false);
  const afterRequiredOnly=db.prepare('SELECT current_value FROM tracking_sequences WHERE name=?').get('transaction').current_value;
  assert.equal(afterRequiredOnly,beforeRequiredOnly,'incomplete Business Core configuration must not advance the D1 allocator');

  let coreCalls=0;
  globalThis.fetch=async(url,options)=>{
    coreCalls++;
    assert.equal(url,'https://business-core.example/v1/transactions/reserve');
    assert.equal(options.headers.authorization,'Bearer core-secret');
    const body=JSON.parse(options.body);
    assert.equal(body.source_system,'package-tracking');
    assert.equal(body.idempotency_key,'package-tracking:retry-001');
    return new Response(JSON.stringify({ok:true,sequence:900,masterTransactionId:'TTG-TXN-000900',reserved:true}),{
      status:201,headers:{'content-type':'application/json'}
    });
  };

  const coreRequest=new Request(request.url,{
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

  globalThis.fetch=async()=>new Response(JSON.stringify({ok:false,error:'postgres unavailable'}),{
    status:503,headers:{'content-type':'application/json'}
  });
  const coreDown=await handleTransactionReserve(coreRequest,{
    ADMIN_TOKEN:'secret',
    BUSINESS_CORE_URL:'https://business-core.example',
    BUSINESS_CORE_TOKEN:'core-secret',
    TRACKING_DB:new D1Database(db)
  });
  assert.equal(coreDown.status,503,'Business Core failure does not fall back to D1 and create split authority');
  const coreDownPayload=await coreDown.json();
  assert.equal(coreDownPayload.authority,'business-core');

  console.log(JSON.stringify({ok:true,checks:19,lastLegacyReserved:64},null,2));
} finally {
  globalThis.fetch=originalFetch;
  db.close();
}
