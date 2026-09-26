import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import core from "../src/worker.js";
import { handleClientLookup } from "../src/client-lookup.js";
import {
  syncBusinessCoreReferenceOutbox
} from "../src/business-core-references.js";

class D1Statement {
  constructor(db,sql){this.db=db;this.sql=sql;this.values=[];}
  bind(...values){this.values=values;return this;}
  async run(){
    const result=this.db.prepare(this.sql).run(...this.values);
    return {success:true,meta:{changes:Number(result.changes||0),last_row_id:Number(result.lastInsertRowid||0)}};
  }
  async first(){
    return this.db.prepare(this.sql).get(...this.values)||null;
  }
  async all(){
    return {results:this.db.prepare(this.sql).all(...this.values)};
  }
}
class D1Database {
  constructor(){
    this.db=new DatabaseSync(":memory:");
  }
  prepare(sql){return new D1Statement(this.db,sql);}
  exec(sql){this.db.exec(sql);}
  close(){this.db.close();}
}

const db=new D1Database();
db.exec(fs.readFileSync(new URL("../schema.sql",import.meta.url),"utf8"));

const env={
  ADMIN_TOKEN:"tracking-secret",
  TRACKING_DB:db,
  BUSINESS_CORE_URL:"https://business-core.example",
  BUSINESS_CORE_TOKEN:"core-secret"
};
const ctx={waitUntil(){},passThroughOnException(){}};

const calls=[];
let postMode="success";
globalThis.fetch=async (url,options={})=>{
  const method=options.method||"GET";
  const parsed=new URL(url);
  calls.push({url:String(url),method,headers:options.headers||{},body:options.body||null});
  const txMatch=parsed.pathname.match(/^\/v1\/transactions\/(TTG-TXN-\d+)$/);
  if(method==="GET"&&txMatch){
    const master=txMatch[1];
    if(master==="TTG-TXN-000063"){
      return Response.json({ok:false,error:"transaction_not_found"},{status:404});
    }
    return Response.json({ok:true,transaction:{master_transaction_id:master}});
  }
  const refMatch=parsed.pathname.match(/^\/v1\/transactions\/(TTG-TXN-\d+)\/references$/);
  if(method==="POST"&&refMatch){
    if(postMode==="retryable")return Response.json({ok:false,error:"temporary"},{status:503});
    if(postMode==="terminal")return Response.json({ok:false,error:"DOMAIN_REFERENCE_ALREADY_BOUND"},{status:409});
    return Response.json({ok:true,reference:{master_transaction_id:refMatch[1]}},{status:201});
  }
  throw new Error("unexpected fetch "+method+" "+url);
};

async function start(master,publicReference,aliases=[]){
  const request=new Request("https://tracking.example/api/admin/transactions/start",{
    method:"POST",
    headers:{
      authorization:"Bearer tracking-secret",
      "content-type":"application/json"
    },
    body:JSON.stringify({
      job:{
        masterTransactionId:master,
        publicReference
      },
      aliases
    })
  });
  return handleClientLookup(request,env,ctx,core);
}

let response=await start("TTG-TXN-000061","TTG-RCP-000061",["TTG-QTE-000061"]);
assert.equal(response.status,200);
let payload=await response.json();
assert.equal(payload.ok,true);
assert.equal(payload.businessCoreReferenceSync,"synced");
assert.deepEqual(
  [...payload.aliases].sort(),
  ["TTG-QTE-000061","TTG-RCP-000061","TTG-TXN-000061"]
);
let queue=await db.prepare(
  "SELECT reference_value,synced_at,terminal_error FROM business_core_reference_outbox WHERE master_transaction_id=?1 ORDER BY reference_value"
).bind("TTG-TXN-000061").all();
assert.equal(queue.results.length,3);
assert.ok(queue.results.every(row=>row.synced_at&&Number(row.terminal_error)===0));
const referencePosts=calls.filter(call=>call.method==="POST");
assert.equal(referencePosts.length,3);
for(const call of referencePosts){
  const body=JSON.parse(call.body);
  assert.equal(body.domain,"tracking");
  assert.equal(body.reference_type,"public_reference");
  assert.equal(body.source_system,"package-tracking");
  assert.equal(call.headers.authorization,"Bearer core-secret");
}
console.log("TRACKING_REFERENCE_SYNC_PASS");

async function directUpsert(master,publicReference,aliases=[]){
  return core.fetch(new Request("https://tracking.example/api/admin/jobs/upsert",{
    method:"POST",
    headers:{authorization:"Bearer tracking-secret","content-type":"application/json"},
    body:JSON.stringify({job:{masterTransactionId:master,publicReference},aliases})
  }),env,ctx);
}

response=await directUpsert("TTG-TXN-000066","TTG-RCP-000066");
assert.equal(response.status,200);
payload=await response.json();
assert.equal(payload.businessCoreReferenceSync,"synced");

response=await directUpsert("TTG-TXN-000063","TTG-RCP-000063");
assert.equal(response.status,409);
const direct63=await db.prepare(
  "SELECT id FROM tracking_jobs WHERE master_transaction_id=?1"
).bind("TTG-TXN-000063").first();
assert.equal(direct63,null);
console.log("LOWER_LEVEL_UPSERT_AUTHORITY_PASS");

response=await start("TTG-TXN-000062","TTG-RCP-000061");
assert.equal(response.status,409);
payload=await response.json();
assert.match(payload.error,/alias already belongs/i);
const tx62=await db.prepare(
  "SELECT id FROM tracking_jobs WHERE master_transaction_id=?1"
).bind("TTG-TXN-000062").first();
assert.equal(tx62,null);
console.log("TRACKING_ALIAS_IMMUTABILITY_PASS");

response=await start("TTG-TXN-000063","TTG-RCP-000063");
assert.equal(response.status,409);
payload=await response.json();
assert.equal(payload.error,"BUSINESS_CORE_MASTER_NOT_FOUND");
const tx63=await db.prepare(
  "SELECT id FROM tracking_jobs WHERE master_transaction_id=?1"
).bind("TTG-TXN-000063").first();
assert.equal(tx63,null);
console.log("MASTER_VERIFY_BEFORE_D1_WRITE_PASS");

postMode="retryable";
response=await start("TTG-TXN-000064","TTG-RCP-000064");
assert.equal(response.status,202);
payload=await response.json();
assert.equal(payload.businessCoreReferenceSync,"pending");
let pending=await db.prepare(
  "SELECT COUNT(*) AS count FROM business_core_reference_outbox WHERE master_transaction_id=?1 AND synced_at IS NULL AND terminal_error=0"
).bind("TTG-TXN-000064").first();
assert.equal(Number(pending.count),2);

await db.prepare(
  "UPDATE business_core_reference_outbox SET next_attempt_at='2000-01-01T00:00:00.000Z' WHERE master_transaction_id=?1"
).bind("TTG-TXN-000064").run();
postMode="success";
const retry=await syncBusinessCoreReferenceOutbox(env,{masterTransactionId:"TTG-TXN-000064"});
assert.equal(retry.pending,0);
assert.equal(retry.terminal,0);
assert.equal(retry.synced,2);
console.log("DURABLE_REFERENCE_RETRY_PASS");

postMode="terminal";
response=await start("TTG-TXN-000065","TTG-RCP-000065");
assert.equal(response.status,409);
payload=await response.json();
assert.equal(payload.businessCoreReferenceSync,"blocked");
const terminal=await db.prepare(
  "SELECT COUNT(*) AS count FROM business_core_reference_outbox WHERE master_transaction_id=?1 AND synced_at IS NULL AND terminal_error=1"
).bind("TTG-TXN-000065").first();
assert.equal(Number(terminal.count),2);
console.log("TERMINAL_REFERENCE_CONFLICT_PASS");

const router=fs.readFileSync(new URL("../src/router.js",import.meta.url),"utf8");
const bootstrap=fs.readFileSync(new URL("../src/d1-bootstrap.js",import.meta.url),"utf8");
const worker=fs.readFileSync(new URL("../src/worker.js",import.meta.url),"utf8");
for(const token of [
  "syncBusinessCoreReferenceOutbox(env)",
  "business core reference sync failed"
]){
  assert.ok(router.includes(token),token);
}
assert.ok(bootstrap.includes("business_core_reference_outbox"));
assert.ok(worker.includes("tracking alias already belongs to another master transaction"));
assert.ok(worker.includes("ON CONFLICT(alias) DO NOTHING"));
console.log("REFERENCE_RUNTIME_WIRING_PASS");

db.close();
console.log("BUSINESS_CORE_TRACKING_REFERENCE_CONTRACT_OK");
