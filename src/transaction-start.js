import {isTrackingAutomationAuthorized} from "./automation-auth.js";
const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const J=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:H});
const STAGES=new Set([
  "intake_received","disclaimer_confirmed","deposit_received","parts_sourcing","parts_ordered",
  "awaiting_seller_shipment","seller_shipped","shipping_company_received","in_transit_to_zambia",
  "received_in_zambia","awaiting_shipping_cost","shipping_cost_paid","parts_received_by_ttg",
  "repair_in_progress","testing","ready_for_collection","completed"
]);
const N=v=>String(v||"").trim().toUpperCase();
const now=()=>new Date().toISOString();

export function normalizePhone(value){
  let d=String(value||"").replace(/\D/g,"");
  if(d.startsWith("00"))d=d.slice(2);
  if(d.length===10&&d.startsWith("0"))d=`260${d.slice(1)}`;
  else if(d.length===9)d=`260${d}`;
  return d.length>=9&&d.length<=15?d:"";
}

function collectPhones(body){
  const client=body.client&&typeof body.client==="object"?body.client:{};
  const job=body.job&&typeof body.job==="object"?body.job:{};
  const raw=[
    ...(Array.isArray(body.clientPhones)?body.clientPhones:[]),
    ...(Array.isArray(body.phones)?body.phones:[]),
    client.phone,client.contactPhone,job.clientPhone
  ];
  return [...new Set(raw.map(normalizePhone).filter(Boolean))];
}

async function ensureAliases(db,jobId,master,publicReference,aliases){
  const wanted=[...new Set([master,publicReference,...(Array.isArray(aliases)?aliases:[])].map(N).filter(Boolean))];
  for(const alias of wanted){
    const existing=await db.prepare("SELECT job_id FROM tracking_aliases WHERE alias=?1").bind(alias).first();
    if(existing&&Number(existing.job_id)!==Number(jobId)){
      const error=new Error("TRACKING_ALIAS_ALREADY_BOUND");
      error.status=409;
      error.alias=alias;
      throw error;
    }
  }
  for(const alias of wanted){
    await db.prepare("INSERT INTO tracking_aliases(alias,job_id) VALUES(?1,?2) ON CONFLICT(alias) DO NOTHING").bind(alias,jobId).run();
  }
  return wanted;
}

export async function startTransaction(db,body){
  const job=body.job&&typeof body.job==="object"?body.job:{};
  const master=N(job.masterTransactionId||body.masterTransactionId);
  if(!/^TTG-TXN-\d+$/.test(master)){
    const error=new Error("VALID_MASTER_TRANSACTION_ID_REQUIRED");
    error.status=400;
    throw error;
  }

  const publicReference=N(job.publicReference||body.publicReference||master);
  const stage=String(job.currentStage||body.currentStage||"intake_received").trim();
  if(!STAGES.has(stage)){
    const error=new Error("INVALID_STAGE");
    error.status=400;
    throw error;
  }

  const stamp=now();
  await db.prepare(`
    INSERT INTO tracking_jobs(
      master_transaction_id,public_reference,client_name,item_name,item_condition,service_type,route,
      origin_country,destination_country,amount_received,currency,payment_method,order_payment_status,
      shipping_cost_status,shipping_cost_amount,shipping_cost_currency,current_stage,status_note,
      current_location,updated_at
    ) VALUES(
      ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20
    )
    ON CONFLICT(master_transaction_id) DO UPDATE SET
      public_reference=excluded.public_reference,
      client_name=CASE WHEN excluded.client_name<>'' THEN excluded.client_name ELSE tracking_jobs.client_name END,
      item_name=CASE WHEN excluded.item_name<>'' THEN excluded.item_name ELSE tracking_jobs.item_name END,
      item_condition=CASE WHEN excluded.item_condition<>'' THEN excluded.item_condition ELSE tracking_jobs.item_condition END,
      service_type=CASE WHEN excluded.service_type<>'' THEN excluded.service_type ELSE tracking_jobs.service_type END,
      route=CASE WHEN excluded.route<>'' THEN excluded.route ELSE tracking_jobs.route END,
      origin_country=CASE WHEN excluded.origin_country<>'' THEN excluded.origin_country ELSE tracking_jobs.origin_country END,
      destination_country=CASE WHEN excluded.destination_country<>'' THEN excluded.destination_country ELSE tracking_jobs.destination_country END,
      amount_received=MAX(tracking_jobs.amount_received,excluded.amount_received),
      currency=CASE WHEN excluded.currency<>'' THEN excluded.currency ELSE tracking_jobs.currency END,
      payment_method=CASE WHEN excluded.payment_method<>'' THEN excluded.payment_method ELSE tracking_jobs.payment_method END,
      order_payment_status=CASE WHEN excluded.order_payment_status<>'' THEN excluded.order_payment_status ELSE tracking_jobs.order_payment_status END,
      shipping_cost_status=CASE WHEN excluded.shipping_cost_status<>'' THEN excluded.shipping_cost_status ELSE tracking_jobs.shipping_cost_status END,
      shipping_cost_amount=COALESCE(excluded.shipping_cost_amount,tracking_jobs.shipping_cost_amount),
      shipping_cost_currency=CASE WHEN excluded.shipping_cost_currency<>'' THEN excluded.shipping_cost_currency ELSE tracking_jobs.shipping_cost_currency END,
      current_stage=tracking_jobs.current_stage,
      status_note=CASE WHEN tracking_jobs.status_note IS NULL OR tracking_jobs.status_note='' THEN excluded.status_note ELSE tracking_jobs.status_note END,
      current_location=CASE WHEN tracking_jobs.current_location IS NULL OR tracking_jobs.current_location='' THEN excluded.current_location ELSE tracking_jobs.current_location END,
      updated_at=excluded.updated_at
  `).bind(
    master,publicReference,
    String(job.clientName||body.client?.name||""),
    String(job.itemName||""),
    String(job.condition||""),
    String(job.serviceType||""),
    String(job.route||""),
    String(job.originCountry||""),
    String(job.destinationCountry||"Zambia"),
    Number(job.amountReceived||0),
    String(job.currency||"ZMW"),
    String(job.paymentMethod||""),
    String(job.orderPaymentStatus||""),
    String(job.shippingCostStatus||""),
    job.shippingCostAmount==null?null:Number(job.shippingCostAmount),
    String(job.shippingCostCurrency||job.currency||"ZMW"),
    stage,
    String(job.statusNote||""),
    String(job.currentLocation||""),
    stamp
  ).run();

  const saved=await db.prepare("SELECT id,current_stage FROM tracking_jobs WHERE master_transaction_id=?1").bind(master).first();
  if(!saved?.id)throw new Error("TRACKING_JOB_UPSERT_FAILED");

  const aliases=await ensureAliases(db,saved.id,master,publicReference,body.aliases);
  const phones=collectPhones(body);
  for(const phone of phones){
    await db.prepare("INSERT INTO client_job_links(phone_normalized,job_id) VALUES(?1,?2) ON CONFLICT(phone_normalized,job_id) DO NOTHING").bind(phone,saved.id).run();
  }

  return {
    ok:true,
    id:saved.id,
    masterTransactionId:master,
    publicReference,
    aliases,
    phoneCount:phones.length,
    phoneLinked:true,
    stage:String(saved.current_stage||stage),
    createdAt:stamp
  };
}

export async function handleTransactionStart(request,env){
  const url=new URL(request.url);
  if(url.pathname!=="/api/admin/transactions/start"||request.method!=="POST")return null;
  if(!isTrackingAutomationAuthorized(request,env))return J({ok:false,error:"unauthorized"},401);
  if(!env.TRACKING_DB)return J({ok:false,error:"TRACKING_DB_NOT_BOUND"},503);
  const body=await request.json().catch(()=>null);
  if(!body)return J({ok:false,error:"INVALID_JSON"},400);
  try{
    return J(await startTransaction(env.TRACKING_DB,body));
  }catch(error){
    return J({ok:false,error:String(error?.message||error),alias:error?.alias||undefined},Number(error?.status)||500);
  }
}
