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
  assert.equal(unavailable.status,503,'reserve endpoint rejects missing D1 binding');

  const allowed=await handleTransactionReserve(new Request(request.url,{method:'POST',headers:{authorization:'Bearer secret'}}),{ADMIN_TOKEN:'secret',TRACKING_DB:new D1Database(db)});
  const payload=await allowed.json();
  assert.equal(allowed.status,200);
  assert.equal(payload.masterTransactionId,'TTG-TXN-000064','authorized endpoint returns next D1-owned master ID');

  console.log(JSON.stringify({ok:true,checks:9,lastReserved:64},null,2));
} finally {
  db.close();
}
