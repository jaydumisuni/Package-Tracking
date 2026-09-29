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

async function resolveJob(db,reference){
  return db.prepare(`SELECT * FROM tracking_jobs WHERE id=(
    SELECT DISTINCT j.id
    FROM tracking_jobs j
    LEFT JOIN tracking_aliases a ON a.job_id=j.id
    WHERE a.alias=?1 OR j.master_transaction_id=?1 OR j.public_reference=?1
    LIMIT 1
  )`).bind(N(reference)).first();
}

export async function updateTransaction(db,body){
  const reference=N(body.reference||body.masterTransactionId);
  if(!reference){
    const error=new Error("TRACKING_REFERENCE_REQUIRED"); error.status=400; throw error;
  }
  const row=await resolveJob(db,reference);
  if(!row){
    const error=new Error("TRACKING_JOB_NOT_FOUND"); error.status=404; throw error;
  }

  const stage=String(body.stage||"").trim();
  if(stage&&!STAGES.has(stage)){
    const error=new Error("INVALID_STAGE"); error.status=400; throw error;
  }

  const eventKey=String(body.eventKey||"").trim();
  if(!eventKey){
    const error=new Error("EVENT_KEY_REQUIRED"); error.status=400; throw error;
  }
  const source=`Automation · ${eventKey.slice(0,220)}`;
  const existing=await db.prepare("SELECT id,created_at FROM tracking_updates WHERE job_id=?1 AND source=?2 ORDER BY id DESC LIMIT 1").bind(row.id,source).first();
  if(existing){
    return {ok:true,replayed:true,reference:row.master_transaction_id,stage:row.current_stage,eventKey,createdAt:existing.created_at};
  }

  const createdAt=String(body.createdAt||now());
  const note=String(body.note||"").slice(0,1200);
  const location=String(body.location||"").slice(0,300);

  await db.prepare("INSERT INTO tracking_updates(job_id,stage,note,location,source,created_at) VALUES(?1,?2,?3,?4,?5,?6)")
    .bind(row.id,stage||null,note,location,source,createdAt).run();

  await db.prepare(`UPDATE tracking_jobs SET
    current_stage=COALESCE(?1,current_stage),
    status_note=CASE WHEN ?2<>'' THEN ?2 ELSE status_note END,
    current_location=CASE WHEN ?3<>'' THEN ?3 ELSE current_location END,
    order_payment_status=COALESCE(?4,order_payment_status),
    shipping_cost_status=COALESCE(?5,shipping_cost_status),
    shipping_cost_amount=COALESCE(?6,shipping_cost_amount),
    shipping_cost_currency=COALESCE(?7,shipping_cost_currency),
    amount_received=CASE WHEN ?8 IS NULL THEN amount_received ELSE MAX(amount_received,?8) END,
    payment_method=CASE WHEN ?9<>'' THEN ?9 ELSE payment_method END,
    updated_at=?10
    WHERE id=?11`)
    .bind(
      stage||null,note,location,
      body.orderPaymentStatus??null,
      body.shippingCostStatus??null,
      body.shippingCostAmount==null?null:Number(body.shippingCostAmount),
      body.shippingCostCurrency??null,
      body.amountReceived==null?null:Number(body.amountReceived),
      String(body.paymentMethod||""),
      createdAt,row.id
    ).run();

  const fresh=await db.prepare("SELECT master_transaction_id,current_stage,order_payment_status,shipping_cost_status,amount_received,payment_method,updated_at FROM tracking_jobs WHERE id=?1").bind(row.id).first();
  return {ok:true,replayed:false,eventKey,...fresh};
}

export async function handleTransactionUpdate(request,env){
  const url=new URL(request.url);
  if(url.pathname!=="/api/admin/transactions/update"||request.method!=="POST")return null;
  if(!isTrackingAutomationAuthorized(request,env))return J({ok:false,error:"unauthorized"},401);
  if(!env.TRACKING_DB)return J({ok:false,error:"TRACKING_DB_NOT_BOUND"},503);
  const body=await request.json().catch(()=>null);
  if(!body)return J({ok:false,error:"INVALID_JSON"},400);
  try{
    return J(await updateTransaction(env.TRACKING_DB,body));
  }catch(error){
    return J({ok:false,error:String(error?.message||error)},Number(error?.status)||500);
  }
}
