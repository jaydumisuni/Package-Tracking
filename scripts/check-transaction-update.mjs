import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {handleTransactionUpdate,updateTransaction} from "../src/transaction-update.js";

class D1Statement{
  constructor(statement){this.statement=statement;this.args=[]}
  bind(...args){this.args=args;return this}
  async run(){return this.statement.run(...this.args)}
  async first(){return this.statement.get(...this.args)||null}
}
class D1Database{
  constructor(db){this.db=db}
  prepare(sql){return new D1Statement(this.db.prepare(sql))}
}

const db=new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE tracking_jobs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  master_transaction_id TEXT NOT NULL UNIQUE,
  public_reference TEXT,
  amount_received REAL DEFAULT 0,
  currency TEXT DEFAULT 'ZMW',
  payment_method TEXT,
  order_payment_status TEXT DEFAULT '',
  shipping_cost_status TEXT DEFAULT '',
  shipping_cost_amount REAL,
  shipping_cost_currency TEXT DEFAULT 'ZMW',
  current_stage TEXT NOT NULL DEFAULT 'intake_received',
  status_note TEXT,
  current_location TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE tracking_aliases(alias TEXT PRIMARY KEY,job_id INTEGER NOT NULL);
CREATE TABLE tracking_updates(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  stage TEXT,
  note TEXT,
  location TEXT,
  source TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO tracking_jobs(master_transaction_id,public_reference,current_stage) VALUES('TTG-TXN-000125','TTG-DOC-000125-01','disclaimer_confirmed');
INSERT INTO tracking_aliases(alias,job_id) VALUES('TTG-DOC-000125-01',1);
`);
const d1=new D1Database(db);

try{
  const first=await updateTransaction(d1,{
    reference:"TTG-TXN-000125",
    eventKey:"pay:TTG-BN-000125-01:paid",
    stage:"deposit_received",
    note:"Payment confirmed.",
    orderPaymentStatus:"paid",
    amountReceived:250,
    paymentMethod:"Binance"
  });
  assert.equal(first.ok,true);
  assert.equal(first.replayed,false);
  assert.equal(first.current_stage,"deposit_received");
  assert.equal(first.order_payment_status,"paid");
  assert.equal(first.amount_received,250);

  const replay=await updateTransaction(d1,{
    reference:"TTG-DOC-000125-01",
    eventKey:"pay:TTG-BN-000125-01:paid",
    stage:"parts_sourcing",
    note:"Should not duplicate."
  });
  assert.equal(replay.replayed,true);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM tracking_updates").get().c,1);
  assert.equal(db.prepare("SELECT current_stage FROM tracking_jobs WHERE id=1").get().current_stage,"deposit_received");

  const denied=await handleTransactionUpdate(
    new Request("https://tracking.example/api/admin/transactions/update",{method:"POST",body:JSON.stringify({reference:"TTG-TXN-000125",eventKey:"x"}),headers:{"content-type":"application/json"}}),
    {ADMIN_TOKEN:"test-token",TRACKING_DB:d1}
  );
  assert.equal(denied.status,401);

  const allowed=await handleTransactionUpdate(
    new Request("https://tracking.example/api/admin/transactions/update",{method:"POST",body:JSON.stringify({reference:"TTG-TXN-000125",eventKey:"pay:shipping:000125",stage:"shipping_cost_paid",shippingCostStatus:"paid",shippingCostAmount:75,shippingCostCurrency:"ZMW"}),headers:{"content-type":"application/json",authorization:"Bearer test-token"}}),
    {ADMIN_TOKEN:"test-token",TRACKING_DB:d1}
  );
  assert.equal(allowed.status,200);

  const shipping=db.prepare("SELECT current_stage,shipping_cost_status,shipping_cost_amount FROM tracking_jobs WHERE id=1").get();
  assert.equal(shipping.current_stage,"shipping_cost_paid");
  assert.equal(shipping.shipping_cost_status,"paid");
  assert.equal(shipping.shipping_cost_amount,75);

  const dedicated=await handleTransactionUpdate(
    new Request("https://tracking.example/api/admin/transactions/update",{method:"POST",body:JSON.stringify({reference:"TTG-TXN-000125",eventKey:"pay:dedicated:000125",stage:"parts_sourcing"}),headers:{"content-type":"application/json","x-ttg-tracking-secret":"pay-secret"}}),
    {TTG_TRACKING_AUTOMATION_TOKEN:"pay-secret",TRACKING_DB:d1}
  );
  assert.equal(dedicated.status,200);
  const afterDedicated=db.prepare("SELECT current_stage FROM tracking_jobs WHERE id=1").get();
  assert.equal(afterDedicated.current_stage,"parts_sourcing");

  console.log(JSON.stringify({ok:true,checks:13,contract:"tracking_transaction_update_v1"},null,2));
}finally{db.close();}
