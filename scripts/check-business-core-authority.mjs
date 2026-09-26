import fs from 'node:fs';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {
  businessCoreConfigured,
  getTrackingAuthorityState,
  syncPendingBusinessCoreReferences,
  syncTrackingReference,
  verifyBusinessCoreTransaction
} from '../src/business-core.js';
import {verifyTrackingSchema} from '../src/d1-bootstrap.js';

class D1Statement{
  constructor(statement){this.statement=statement;this.args=[]}
  bind(...args){this.args=args;return this}
  async run(){return this.statement.run(...this.args)}
  async first(){return this.statement.get(...this.args)||null}
  async all(){return {results:this.statement.all(...this.args)}}
}
class D1Database{
  constructor(db){this.db=db}
  prepare(sql){return new D1Statement(this.db.prepare(sql))}
}

const dbRaw=new DatabaseSync(':memory:');
const db=new D1Database(dbRaw);
const extraDbs=[];
const originalFetch=globalThis.fetch;
try{
  const requiredTables=['tracking_aliases','tracking_updates','carrier_shipments','handover_tokens','client_job_links','tracking_staff_audit'];
  const legacyRaw=new DatabaseSync(':memory:');
  extraDbs.push(legacyRaw);
  legacyRaw.exec('CREATE TABLE tracking_jobs(id INTEGER PRIMARY KEY AUTOINCREMENT,master_transaction_id TEXT UNIQUE,public_reference TEXT);');
  for(const name of requiredTables)legacyRaw.exec(`CREATE TABLE ${name}(id INTEGER);`);
  const legacyDb=new D1Database(legacyRaw);
  const legacyBefore=await verifyTrackingSchema(legacyDb);
  assert.equal(legacyBefore.ready,false);
  assert.ok(legacyBefore.missingColumns.includes('business_core_linked_at'));

  const migrationSql=fs.readFileSync(new URL('../migrations/004_business_core_reference_sync.sql',import.meta.url),'utf8');
  legacyRaw.exec(migrationSql);
  const legacyAfter=await verifyTrackingSchema(legacyDb);
  assert.equal(legacyAfter.ready,true);

  const freshRaw=new DatabaseSync(':memory:');
  extraDbs.push(freshRaw);
  freshRaw.exec(fs.readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  const freshState=await verifyTrackingSchema(new D1Database(freshRaw));
  assert.equal(freshState.ready,true);

  dbRaw.exec(`
    CREATE TABLE tracking_jobs(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      master_transaction_id TEXT NOT NULL UNIQUE,
      public_reference TEXT,
      business_core_linked_at TEXT,
      business_core_link_error TEXT,
      business_core_link_attempt_at TEXT
    );
  `);
  dbRaw.prepare('INSERT INTO tracking_jobs(master_transaction_id,public_reference) VALUES (?,?)')
    .run('TTG-TXN-000061','TTG-TXN-000061');
  dbRaw.prepare('INSERT INTO tracking_jobs(master_transaction_id,public_reference) VALUES (?,?)')
    .run('TTG-TXN-000062','TTG-TXN-000062');

  const env={
    TRACKING_DB:db,
    BUSINESS_CORE_URL:'https://business-core.example',
    BUSINESS_CORE_TOKEN:'core-secret'
  };
  assert.equal(businessCoreConfigured(env),true);

  let referenceCalls=0;
  globalThis.fetch=async(url,options={})=>{
    const parsed=new URL(url);
    assert.equal(options.headers.get('authorization'),'Bearer core-secret');

    if(options.method==='GET'&&parsed.pathname==='/v1/transactions/TTG-TXN-000061'){
      return new Response(JSON.stringify({
        ok:true,
        transaction:{master_transaction_id:'TTG-TXN-000061'}
      }),{status:200,headers:{'content-type':'application/json'}});
    }

    if(options.method==='GET'&&parsed.pathname==='/v1/transactions/TTG-TXN-999999'){
      return new Response(JSON.stringify({ok:false,error:'not_found'}),{
        status:404,headers:{'content-type':'application/json'}
      });
    }

    if(options.method==='POST'&&parsed.pathname.startsWith('/v1/transactions/')&&parsed.pathname.endsWith('/references')){
      referenceCalls++;
      const body=JSON.parse(options.body);
      assert.equal(body.domain,'tracking');
      assert.equal(body.reference_type,'job');
      assert.match(body.reference_value,/^TTG-TXN-[0-9]{6,}$/);
      assert.equal(body.source_system,'package-tracking');

      if(body.reference_value==='TTG-TXN-000062'&&referenceCalls===2){
        return new Response(JSON.stringify({ok:false,error:'temporary'}),{
          status:503,headers:{'content-type':'application/json'}
        });
      }

      return new Response(JSON.stringify({
        ok:true,
        reference:{
          domain:'tracking',
          reference_type:'job',
          reference_value:body.reference_value,
          master_transaction_id:body.reference_value
        }
      }),{status:body.reference_value==='TTG-TXN-000061'?201:200,headers:{'content-type':'application/json'}});
    }

    throw new Error('unexpected Business Core request '+options.method+' '+parsed.pathname);
  };

  const verified=await verifyBusinessCoreTransaction(env,'TTG-TXN-000061');
  assert.equal(verified.master_transaction_id,'TTG-TXN-000061');

  let missingRejected=false;
  try{await verifyBusinessCoreTransaction(env,'TTG-TXN-999999')}
  catch(error){missingRejected=error.message==='BUSINESS_CORE_MASTER_NOT_FOUND'&&error.statusCode===404}
  assert.equal(missingRejected,true);

  const row61=await getTrackingAuthorityState(db,'TTG-TXN-000061');
  const linked61=await syncTrackingReference(db,env,{
    masterTransactionId:row61.master_transaction_id,
    jobId:row61.id,
    publicReference:row61.public_reference
  });
  assert.equal(linked61.ok,true);
  const state61=await getTrackingAuthorityState(db,'TTG-TXN-000061');
  assert.ok(state61.business_core_linked_at);
  assert.equal(state61.business_core_link_error,null);

  const row62=await getTrackingAuthorityState(db,'TTG-TXN-000062');
  const failed62=await syncTrackingReference(db,env,{
    masterTransactionId:row62.master_transaction_id,
    jobId:row62.id,
    publicReference:row62.public_reference
  });
  assert.equal(failed62.ok,false);
  const state62Failed=await getTrackingAuthorityState(db,'TTG-TXN-000062');
  assert.equal(state62Failed.business_core_linked_at,null);
  assert.ok(state62Failed.business_core_link_error);

  const retry=await syncPendingBusinessCoreReferences(env,25);
  assert.equal(retry.attempted,1,'already-linked rows must be excluded from pending scan');
  assert.equal(retry.linked,1);
  assert.equal(retry.pending,0);
  const state62Linked=await getTrackingAuthorityState(db,'TTG-TXN-000062');
  assert.ok(state62Linked.business_core_linked_at);
  assert.equal(state62Linked.business_core_link_error,null);

  const missingConfig=await syncPendingBusinessCoreReferences({TRACKING_DB:db},25);
  assert.equal(missingConfig.ok,false);
  assert.equal(missingConfig.error,'BUSINESS_CORE_NOT_CONFIGURED');

  const clientLookup=fs.readFileSync(new URL('../src/client-lookup.js',import.meta.url),'utf8');
  assert.ok(
    clientLookup.indexOf('await verifyBusinessCoreTransaction(env,master)') < clientLookup.indexOf('const response=await core.fetch'),
    'new tracking job must verify master before D1 upsert'
  );
  assert.match(clientLookup,/BUSINESS_CORE_REFERENCE_SYNC_PENDING/);
  assert.match(clientLookup,/businessCoreLinked/);

  console.log(JSON.stringify({
    ok:true,
    checks:[
      'd1.old-schema-blocked',
      'd1.migration-004-ready',
      'd1.fresh-schema-ready',
      'core.verify-master-before-create',
      'core.reject-missing-master',
      'tracking-reference.bind',
      'tracking-reference.pending-marker',
      'tracking-reference.cron-retry',
      'tracking-reference.linked-row-skip',
      'tracking-reference.no-false-success'
    ]
  },null,2));
} finally {
  globalThis.fetch=originalFetch;
  dbRaw.close();
  for(const db of extraDbs)db.close();
}
