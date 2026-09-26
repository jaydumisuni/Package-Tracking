import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleClientLookup} from '../src/client-lookup.js';
import {
  businessCoreAuthorityActive,
  businessCoreErrorResponse,
  businessCoreState,
  preflightTrackingAuthority,
  registerTrackingReferences,
  reserveFromBusinessCore,
  trackingReferences
} from '../src/business-core.js';

const originalFetch=globalThis.fetch;
try{
  assert.deepEqual(businessCoreState({}),{required:false,hasUrl:false,hasToken:false,mentioned:false,configured:false,active:false,staged:false,incomplete:false});
  assert.equal(businessCoreAuthorityActive({}),false);
  const staged=businessCoreState({BUSINESS_CORE_URL:'https://business-core.example'});
  assert.equal(staged.mentioned,true);
  assert.equal(staged.active,false);
  assert.equal(staged.staged,true);
  assert.equal(staged.incomplete,false);
  assert.equal(businessCoreAuthorityActive({BUSINESS_CORE_URL:'https://business-core.example'}),false);
  assert.equal(businessCoreAuthorityActive({BUSINESS_CORE_URL:'https://business-core.example',BUSINESS_CORE_TOKEN:'core-secret'}),true);
  const incomplete=businessCoreState({BUSINESS_CORE_REQUIRED:'true'});
  assert.equal(incomplete.required,true);
  assert.equal(incomplete.mentioned,true);
  assert.equal(incomplete.configured,false);
  assert.equal(incomplete.incomplete,true);

  const refs=trackingReferences('TTG-TXN-000123',{
    publicReference:'TTG-QTE-000123',
    aliases:['ttg-inv-000123','TTG-QTE-000123','TTG-TXN-000123']
  });
  assert.deepEqual(refs,[
    {reference_type:'public_reference',reference_value:'TTG-QTE-000123'},
    {reference_type:'alias',reference_value:'TTG-INV-000123'}
  ]);

  const calls=[];
  globalThis.fetch=async(url,options={})=>{
    calls.push({url:String(url),method:options.method||'GET',body:options.body?JSON.parse(options.body):null,headers:options.headers||{}});
    if(String(url).endsWith('/v1/transactions/reserve')){
      return new Response(JSON.stringify({ok:true,sequence:123,masterTransactionId:'TTG-TXN-000123',reserved:true}),{status:201,headers:{'content-type':'application/json'}});
    }
    if(String(url).endsWith('/v1/transactions/TTG-TXN-000123')){
      return new Response(JSON.stringify({ok:true,transaction:{master_transaction_id:'TTG-TXN-000123'}}),{status:200,headers:{'content-type':'application/json'}});
    }
    if(String(url).includes('/v1/references/resolve?')){
      return new Response(JSON.stringify({ok:false,error:'domain_reference_not_found'}),{status:404,headers:{'content-type':'application/json'}});
    }
    if(String(url).endsWith('/references')){
      const body=JSON.parse(options.body);
      return new Response(JSON.stringify({ok:true,reference:{master_transaction_id:'TTG-TXN-000123',...body}}),{status:201,headers:{'content-type':'application/json'}});
    }
    throw new Error('unexpected fetch '+url);
  };

  const env={BUSINESS_CORE_URL:'https://business-core.example',BUSINESS_CORE_TOKEN:'core-secret'};
  const reserveRequest=new Request('https://tracking.example/api/admin/transactions/reserve',{method:'POST',headers:{'x-idempotency-key':'reserve-123'}});
  const reservation=await reserveFromBusinessCore(reserveRequest,env);
  assert.equal(reservation.masterTransactionId,'TTG-TXN-000123');
  assert.equal(reservation.authority,'business-core');

  const preflight=await preflightTrackingAuthority(env,'TTG-TXN-000123',{
    publicReference:'TTG-QTE-000123',aliases:['TTG-INV-000123']
  });
  assert.equal(preflight.active,true);
  assert.equal(preflight.references.length,2);

  const registered=await registerTrackingReferences(env,'TTG-TXN-000123',{
    jobId:77,publicReference:'TTG-QTE-000123',aliases:['TTG-INV-000123']
  });
  assert.equal(registered.active,true);
  assert.equal(registered.bound.length,3);
  const bindCalls=calls.filter(call=>call.url.endsWith('/references'));
  assert.equal(bindCalls.length,3);
  for(const call of bindCalls){
    assert.equal(call.method,'POST');
    assert.equal(call.body.domain,'tracking');
    assert.equal(call.body.source_system,'package-tracking');
  }

  globalThis.fetch=async(url,options={})=>{
    if(String(url).endsWith('/v1/transactions/TTG-TXN-000123')){
      return new Response(JSON.stringify({ok:true,transaction:{master_transaction_id:'TTG-TXN-000123'}}),{status:200,headers:{'content-type':'application/json'}});
    }
    if(String(url).includes('/v1/references/resolve?')){
      return new Response(JSON.stringify({ok:true,reference:{master_transaction_id:'TTG-TXN-000999'}}),{status:200,headers:{'content-type':'application/json'}});
    }
    throw new Error('unexpected collision fetch '+url);
  };
  let collision=false;
  try{await preflightTrackingAuthority(env,'TTG-TXN-000123',{publicReference:'TTG-QTE-000123'});}catch(error){collision=error.code==='BUSINESS_CORE_REFERENCE_COLLISION'&&error.status===409;}
  assert.equal(collision,true);

  const failure=businessCoreErrorResponse(Object.assign(new Error('down'),{status:503,code:'BUSINESS_CORE_UNAVAILABLE'}),{d1Committed:true});
  assert.equal(failure.status,503);
  assert.equal(failure.body.authority,'business-core');
  assert.equal(failure.body.d1Committed,true);
  assert.equal(failure.body.retryable,true);

  const clientLookup=fs.readFileSync(new URL('../src/client-lookup.js',import.meta.url),'utf8');
  const upsertStart=clientLookup.indexOf('async function upsertAndLink');
  const preflightIndex=clientLookup.indexOf('await preflightTrackingAuthority',upsertStart);
  const d1CommitIndex=clientLookup.indexOf('const response=await core.fetch',upsertStart);
  const bindIndex=clientLookup.indexOf('await registerTrackingReferences',upsertStart);
  assert.ok(upsertStart>=0&&preflightIndex>upsertStart&&d1CommitIndex>preflightIndex&&bindIndex>d1CommitIndex,'authority order must be Core preflight -> D1 write -> Core reference bind');
  assert.ok(clientLookup.includes('LEGACY_D1_REFERENCE_COLLISION'),'legacy D1 alias collision guard must remain active');
  assert.ok(clientLookup.includes('d1Committed:true'),'post-D1 Core failure must be explicit');


  class D1Statement{
    constructor(statement){this.statement=statement;this.args=[];}
    bind(...args){this.args=args;return this;}
    async run(){return this.statement.run(...this.args);}
    async first(){return this.statement.get(...this.args)||null;}
    async all(){return {results:this.statement.all(...this.args)};}
  }
  class D1Database{constructor(db){this.db=db;}prepare(sql){return new D1Statement(this.db.prepare(sql));}}
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE tracking_jobs(id INTEGER PRIMARY KEY AUTOINCREMENT,master_transaction_id TEXT NOT NULL UNIQUE,public_reference TEXT);
    CREATE TABLE tracking_aliases(alias TEXT PRIMARY KEY,job_id INTEGER NOT NULL);
    CREATE TABLE client_job_links(phone_normalized TEXT NOT NULL,job_id INTEGER NOT NULL,PRIMARY KEY(phone_normalized,job_id));
  `);
  const d1=new D1Database(sqlite);
  const order=[];
  let coreNetworkCalls=0;
  globalThis.fetch=async(url,options={})=>{
    coreNetworkCalls++;
    const value=String(url);
    if(value.endsWith('/v1/transactions/TTG-TXN-000123')){order.push('core:verify');return new Response(JSON.stringify({ok:true,transaction:{master_transaction_id:'TTG-TXN-000123'}}),{status:200,headers:{'content-type':'application/json'}});}
    if(value.endsWith('/v1/transactions/TTG-TXN-000124')){order.push('core:verify');return new Response(JSON.stringify({ok:true,transaction:{master_transaction_id:'TTG-TXN-000124'}}),{status:200,headers:{'content-type':'application/json'}});}
    if(value.endsWith('/v1/transactions/TTG-TXN-000125')){order.push('core:verify');return new Response(JSON.stringify({ok:true,transaction:{master_transaction_id:'TTG-TXN-000125'}}),{status:200,headers:{'content-type':'application/json'}});}
    if(value.includes('/v1/references/resolve?')){order.push('core:resolve');return new Response(JSON.stringify({ok:false,error:'domain_reference_not_found'}),{status:404,headers:{'content-type':'application/json'}});}
    if(value.endsWith('/references')){
      order.push('core:bind');
      const body=JSON.parse(options.body);
      if(body.reference_value==='TTG-QTE-000124')return new Response(JSON.stringify({ok:false,error:'postgres unavailable'}),{status:503,headers:{'content-type':'application/json'}});
      return new Response(JSON.stringify({ok:true,reference:{master_transaction_id:value.includes('000124')?'TTG-TXN-000124':'TTG-TXN-000123',...body}}),{status:201,headers:{'content-type':'application/json'}});
    }
    throw new Error('unexpected handler fetch '+value);
  };
  const trackingCore={
    fetch:async(request)=>{
      order.push('d1:commit');
      const body=await request.json();
      const job=body.job||{};
      const master=String(job.masterTransactionId||body.masterTransactionId||'').toUpperCase();
      const publicRef=String(job.publicReference||body.publicReference||master).toUpperCase();
      sqlite.prepare('INSERT INTO tracking_jobs(master_transaction_id,public_reference) VALUES(?,?) ON CONFLICT(master_transaction_id) DO UPDATE SET public_reference=excluded.public_reference').run(master,publicRef);
      const row=sqlite.prepare('SELECT id FROM tracking_jobs WHERE master_transaction_id=?').get(master);
      for(const alias of new Set([master,publicRef,...(body.aliases||[]).map(v=>String(v).toUpperCase())])){
        sqlite.prepare('INSERT INTO tracking_aliases(alias,job_id) VALUES(?,?) ON CONFLICT(alias) DO NOTHING').run(alias,row.id);
      }
      return new Response(JSON.stringify({ok:true,id:row.id,masterTransactionId:master,aliases:[master,publicRef,...(body.aliases||[])]}),{status:200,headers:{'content-type':'application/json'}});
    }
  };
  const trackingEnv={ADMIN_TOKEN:'admin-secret',TRACKING_DB:d1,BUSINESS_CORE_URL:'https://business-core.example',BUSINESS_CORE_TOKEN:'core-secret'};

  const callsBeforeUnauthorized=coreNetworkCalls;
  const unauthorized=await handleClientLookup(new Request('https://tracking.example/api/admin/jobs/upsert',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({job:{masterTransactionId:'TTG-TXN-000123'}})}),trackingEnv,{},trackingCore);
  assert.equal(unauthorized.status,401);
  assert.equal(coreNetworkCalls,callsBeforeUnauthorized,'unauthorized admin upsert must not probe Business Core');

  order.length=0;
  const started=await handleClientLookup(new Request('https://tracking.example/api/admin/transactions/start',{method:'POST',headers:{authorization:'Bearer admin-secret','content-type':'application/json'},body:JSON.stringify({job:{masterTransactionId:'TTG-TXN-000123',publicReference:'TTG-QTE-000123',clientPhone:'0966123456'},aliases:['TTG-INV-000123']})}),trackingEnv,{},trackingCore);
  assert.equal(started.status,200);
  const startedBody=await started.json();
  assert.equal(startedBody.businessCoreAuthority,true);
  assert.equal(startedBody.businessCoreReferencesBound,3);
  assert.equal(startedBody.phoneLinked,true);
  assert.ok(order.indexOf('core:verify')>=0);
  assert.ok(order.indexOf('d1:commit')>order.indexOf('core:verify'));
  assert.ok(order.indexOf('core:bind')>order.indexOf('d1:commit'));
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM tracking_jobs WHERE master_transaction_id=?').get('TTG-TXN-000123').n,1);

  sqlite.prepare('INSERT INTO tracking_jobs(master_transaction_id,public_reference) VALUES(?,?)').run('TTG-TXN-000999','TTG-QTE-000999');
  const legacyOwner=sqlite.prepare('SELECT id FROM tracking_jobs WHERE master_transaction_id=?').get('TTG-TXN-000999');
  sqlite.prepare('INSERT INTO tracking_aliases(alias,job_id) VALUES(?,?)').run('TTG-QTE-COLLIDE',legacyOwner.id);
  order.length=0;
  const collisionStart=await handleClientLookup(new Request('https://tracking.example/api/admin/transactions/start',{method:'POST',headers:{authorization:'Bearer admin-secret','content-type':'application/json'},body:JSON.stringify({job:{masterTransactionId:'TTG-TXN-000125',publicReference:'TTG-QTE-COLLIDE'}})}),trackingEnv,{},trackingCore);
  assert.equal(collisionStart.status,409);
  const collisionBody=await collisionStart.json();
  assert.equal(collisionBody.error,'LEGACY_D1_REFERENCE_COLLISION');
  assert.equal(collisionBody.d1Committed,false);
  assert.equal(order.includes('d1:commit'),false,'legacy alias collision must stop before D1 mutation');
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM tracking_jobs WHERE master_transaction_id=?').get('TTG-TXN-000125').n,0);

  order.length=0;
  const partial=await handleClientLookup(new Request('https://tracking.example/api/admin/transactions/start',{method:'POST',headers:{authorization:'Bearer admin-secret','content-type':'application/json'},body:JSON.stringify({job:{masterTransactionId:'TTG-TXN-000124',publicReference:'TTG-QTE-000124'}})}),trackingEnv,{},trackingCore);
  assert.equal(partial.status,503);
  const partialBody=await partial.json();
  assert.equal(partialBody.d1Committed,true);
  assert.equal(partialBody.authority,'business-core');
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM tracking_jobs WHERE master_transaction_id=?').get('TTG-TXN-000124').n,1,'post-D1 Business Core failure must report a real committed D1 job');
  sqlite.close();

  console.log(JSON.stringify({ok:true,checks:51,authorityOrder:'core-preflight->d1->core-bind',handlerSimulation:true},null,2));
}finally{globalThis.fetch=originalFetch;}