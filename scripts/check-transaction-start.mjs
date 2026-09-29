import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {handleTransactionStart,startTransaction} from "../src/transaction-start.js";

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
  client_name TEXT,
  item_name TEXT,
  item_condition TEXT,
  service_type TEXT,
  route TEXT,
  origin_country TEXT,
  destination_country TEXT DEFAULT 'Zambia',
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE tracking_aliases(alias TEXT PRIMARY KEY,job_id INTEGER NOT NULL);
CREATE TABLE client_job_links(phone_normalized TEXT NOT NULL,job_id INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(phone_normalized,job_id));
`);
const d1=new D1Database(db);

try{
  const body={
    masterTransactionId:"TTG-TXN-000125",
    publicReference:"TTG-DOC-000125-01",
    aliases:["TTG-DOC-000125-01","TTG-RCP-000125"],
    clientPhones:["0974000000","+260 97 4000000"],
    client:{name:"Test Client"},
    job:{
      masterTransactionId:"TTG-TXN-000125",
      publicReference:"TTG-DOC-000125-01",
      clientName:"Test Client",
      itemName:"Tracked service",
      serviceType:"repair",
      currentStage:"disclaimer_confirmed",
      statusNote:"Disclaimer accepted."
    }
  };

  const first=await startTransaction(d1,body);
  assert.equal(first.ok,true);
  assert.equal(first.masterTransactionId,"TTG-TXN-000125");
  assert.equal(first.phoneCount,1);
  assert.equal(first.stage,"disclaimer_confirmed");

  const second=await startTransaction(d1,{
    ...body,
    publicReference:"TTG-RCP-000125",
    aliases:["TTG-RCP-000125"],
    job:{...body.job,publicReference:"TTG-RCP-000125",amountReceived:250,orderPaymentStatus:"paid",currentStage:"deposit_received"}
  });
  assert.equal(second.id,first.id,"same master transaction reuses one tracking job");
  const row=db.prepare("SELECT * FROM tracking_jobs WHERE master_transaction_id=?").get("TTG-TXN-000125");
  assert.equal(row.current_stage,"deposit_received");
  assert.equal(row.amount_received,250);
  assert.equal(row.order_payment_status,"paid");
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM tracking_aliases WHERE job_id=?").get(first.id).c,3);

  await startTransaction(d1,{
    masterTransactionId:"TTG-TXN-000126",
    publicReference:"TTG-RCP-000126",
    aliases:["TTG-RCP-000126"],
    job:{masterTransactionId:"TTG-TXN-000126",publicReference:"TTG-RCP-000126",currentStage:"intake_received"}
  });
  await assert.rejects(
    ()=>startTransaction(d1,{
      masterTransactionId:"TTG-TXN-000126",
      aliases:["TTG-RCP-000125"],
      job:{masterTransactionId:"TTG-TXN-000126",currentStage:"intake_received"}
    }),
    error=>error.message==="TRACKING_ALIAS_ALREADY_BOUND"&&error.status===409
  );

  const denied=await handleTransactionStart(
    new Request("https://tracking.example/api/admin/transactions/start",{method:"POST",body:JSON.stringify(body),headers:{"content-type":"application/json"}}),
    {ADMIN_TOKEN:"secret",TRACKING_DB:d1}
  );
  assert.equal(denied.status,401);

  const allowed=await handleTransactionStart(
    new Request("https://tracking.example/api/admin/transactions/start",{method:"POST",body:JSON.stringify(body),headers:{"content-type":"application/json",authorization:"Bearer secret"}}),
    {ADMIN_TOKEN:"secret",TRACKING_DB:d1}
  );
  assert.equal(allowed.status,200);

  console.log(JSON.stringify({ok:true,checks:12,masterTransactionId:first.masterTransactionId},null,2));
}finally{
  db.close();
}
