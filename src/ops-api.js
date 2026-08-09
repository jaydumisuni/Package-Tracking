import {requireOpsAccess} from './ops-auth.js';

const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const J=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:H});
const STAGES=['intake_received','disclaimer_confirmed','deposit_received','parts_sourcing','parts_ordered','awaiting_seller_shipment','seller_shipped','shipping_company_received','in_transit_to_zambia','received_in_zambia','awaiting_shipping_cost','shipping_cost_paid','parts_received_by_ttg','repair_in_progress','testing','ready_for_collection','completed'];
const N=v=>String(v||'').trim().toUpperCase();
const now=()=>new Date().toISOString();
export function normalizePhone(value){let d=String(value||'').replace(/\D/g,'');if(d.startsWith('00'))d=d.slice(2);if(d.length===10&&d.startsWith('0'))d=`260${d.slice(1)}`;else if(d.length===9)d=`260${d}`;return d.length>=9&&d.length<=15?d:''}
const maskPhone=p=>p.startsWith('260')&&p.length>=12?`+260 ${p.slice(3,5)}***${p.slice(-4)}`:`***${p.slice(-4)}`;
async function audit(db,user,action,reference,summary=''){
  try{await db.prepare(`INSERT INTO tracking_staff_audit(actor_user_id,actor_email,actor_role,action,reference,summary,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)`).bind(user.id||'',user.email||'',user.role||'',action,N(reference),String(summary||'').slice(0,800),now()).run()}catch(error){console.error('tracking audit failed',String(error))}
}
async function resolveJob(db,reference){return db.prepare(`SELECT * FROM tracking_jobs WHERE id=(SELECT DISTINCT j.id FROM tracking_jobs j LEFT JOIN tracking_aliases a ON a.job_id=j.id WHERE a.alias=?1 OR j.master_transaction_id=?1 OR j.public_reference=?1 LIMIT 1)`).bind(N(reference)).first()}
async function detail(db,reference){
  const row=await resolveJob(db,reference); if(!row)return null;
  const updates=(await db.prepare(`SELECT stage,note,location,source,created_at FROM tracking_updates WHERE job_id=?1 ORDER BY created_at DESC,id DESC LIMIT 100`).bind(row.id).all()).results||[];
  const carriers=(await db.prepare(`SELECT id,leg_type,carrier,tracking_number,provider,last_status,last_event_at,last_checked_at,active,created_at,updated_at FROM carrier_shipments WHERE job_id=?1 ORDER BY id DESC`).bind(row.id).all()).results||[];
  const phones=(await db.prepare(`SELECT phone_normalized,created_at FROM client_job_links WHERE job_id=?1 ORDER BY created_at ASC`).bind(row.id).all()).results||[];
  const aliases=(await db.prepare(`SELECT alias FROM tracking_aliases WHERE job_id=?1 ORDER BY alias`).bind(row.id).all()).results||[];
  return {...row,aliases:aliases.map(x=>x.alias),phones:phones.map(x=>({masked:maskPhone(x.phone_normalized),createdAt:x.created_at})),updates,carriers};
}
async function searchJobs(db,q,limit){
  const raw=String(q||'').trim(),phone=normalizePhone(raw),like=`%${raw.replace(/[%_]/g,'')}%`;
  if(phone){
    return (await db.prepare(`SELECT DISTINCT j.id,j.master_transaction_id,j.public_reference,j.client_name,j.item_name,j.service_type,j.route,j.current_stage,j.current_location,j.updated_at FROM client_job_links l JOIN tracking_jobs j ON j.id=l.job_id WHERE l.phone_normalized=?1 ORDER BY j.updated_at DESC LIMIT ?2`).bind(phone,limit).all()).results||[];
  }
  if(!raw)return (await db.prepare(`SELECT id,master_transaction_id,public_reference,client_name,item_name,service_type,route,current_stage,current_location,updated_at FROM tracking_jobs ORDER BY updated_at DESC LIMIT ?1`).bind(limit).all()).results||[];
  return (await db.prepare(`SELECT DISTINCT j.id,j.master_transaction_id,j.public_reference,j.client_name,j.item_name,j.service_type,j.route,j.current_stage,j.current_location,j.updated_at FROM tracking_jobs j LEFT JOIN tracking_aliases a ON a.job_id=j.id WHERE j.master_transaction_id LIKE ?1 OR j.public_reference LIKE ?1 OR j.client_name LIKE ?1 OR j.item_name LIKE ?1 OR j.service_type LIKE ?1 OR j.route LIKE ?1 OR a.alias LIKE ?1 ORDER BY j.updated_at DESC LIMIT ?2`).bind(like,limit).all()).results||[];
}
async function upsert(db,body){
  const job=body.job||{},master=N(job.masterTransactionId),publicRef=N(job.publicReference||master); if(!master)throw new Error('masterTransactionId required');
  await db.prepare(`INSERT INTO tracking_jobs(master_transaction_id,public_reference,client_name,item_name,item_condition,service_type,route,origin_country,destination_country,amount_received,currency,payment_method,order_payment_status,shipping_cost_status,shipping_cost_amount,shipping_cost_currency,current_stage,status_note,current_location,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20) ON CONFLICT(master_transaction_id) DO UPDATE SET public_reference=excluded.public_reference,client_name=excluded.client_name,item_name=excluded.item_name,item_condition=excluded.item_condition,service_type=excluded.service_type,route=excluded.route,origin_country=excluded.origin_country,destination_country=excluded.destination_country,amount_received=excluded.amount_received,currency=excluded.currency,payment_method=excluded.payment_method,order_payment_status=excluded.order_payment_status,shipping_cost_status=excluded.shipping_cost_status,shipping_cost_amount=excluded.shipping_cost_amount,shipping_cost_currency=excluded.shipping_cost_currency,current_stage=excluded.current_stage,status_note=excluded.status_note,current_location=excluded.current_location,updated_at=excluded.updated_at`).bind(master,publicRef,job.clientName||'',job.itemName||'',job.condition||'',job.serviceType||'',job.route||'',job.originCountry||'',job.destinationCountry||'Zambia',Number(job.amountReceived||0),job.currency||'ZMW',job.paymentMethod||'',job.orderPaymentStatus||'',job.shippingCostStatus||'',job.shippingCostAmount==null?null:Number(job.shippingCostAmount),job.shippingCostCurrency||job.currency||'ZMW',STAGES.includes(job.currentStage)?job.currentStage:'intake_received',job.statusNote||'',job.currentLocation||'',now()).run();
  const saved=await db.prepare(`SELECT id FROM tracking_jobs WHERE master_transaction_id=?1`).bind(master).first();
  const aliases=[...new Set([master,publicRef,...(body.aliases||[]).map(N)].filter(Boolean))];
  for(const alias of aliases)await db.prepare(`INSERT INTO tracking_aliases(alias,job_id) VALUES(?1,?2) ON CONFLICT(alias) DO UPDATE SET job_id=excluded.job_id`).bind(alias,saved.id).run();
  const phones=[...new Set((body.phones||[]).map(normalizePhone).filter(Boolean))];
  for(const phone of phones)await db.prepare(`INSERT INTO client_job_links(phone_normalized,job_id) VALUES(?1,?2) ON CONFLICT(phone_normalized,job_id) DO NOTHING`).bind(phone,saved.id).run();
  return {id:saved.id,master,publicRef,aliases,phoneCount:phones.length};
}

export async function handleOpsApi(request,env){
  const url=new URL(request.url); if(!url.pathname.startsWith('/api/ops/'))return null;
  if(url.pathname.startsWith('/api/ops/auth/'))return null;
  const auth=await requireOpsAccess(request,env); if(!auth.ok)return J({ok:false,error:auth.error},auth.status);
  if(!env.TRACKING_DB)return J({ok:false,error:'TRACKING_DB_NOT_BOUND'},503);
  const db=env.TRACKING_DB,user=auth.user;

  if(url.pathname==='/api/ops/status'&&request.method==='GET'){
    let tables=[]; try{tables=((await db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all()).results||[]).map(x=>x.name)}catch{}
    const required=['tracking_jobs','tracking_aliases','tracking_updates','carrier_shipments','handover_tokens','client_job_links','tracking_staff_audit'];
    return J({ok:true,user,d1Bound:true,schemaReady:required.every(x=>tables.includes(x)),missing:required.filter(x=>!tables.includes(x)),hunterConfigured:Boolean(env.HUNTER_API_URL),stages:STAGES});
  }
  if(url.pathname==='/api/ops/jobs'&&request.method==='GET'){
    const limit=Math.min(50,Math.max(1,Number(url.searchParams.get('limit')||25))); const rows=await searchJobs(db,url.searchParams.get('q')||'',limit); return J({ok:true,count:rows.length,jobs:rows});
  }
  if(url.pathname==='/api/ops/job'&&request.method==='GET'){
    const record=await detail(db,url.searchParams.get('id')||''); return record?J({ok:true,job:record}):J({ok:false,error:'TRACKING_JOB_NOT_FOUND'},404);
  }
  if(url.pathname==='/api/ops/jobs/upsert'&&request.method==='POST'){
    const body=await request.json().catch(()=>({})); try{const saved=await upsert(db,body);await audit(db,user,'job.upsert',saved.master,`${saved.publicRef} · ${body.job?.clientName||''} · ${body.job?.itemName||''}`);return J({ok:true,...saved})}catch(error){return J({ok:false,error:String(error.message||error)},400)}
  }
  if(url.pathname==='/api/ops/jobs/update'&&request.method==='POST'){
    const body=await request.json().catch(()=>({})),reference=N(body.reference); const row=await resolveJob(db,reference); if(!row)return J({ok:false,error:'TRACKING_JOB_NOT_FOUND'},404);
    const stage=String(body.stage||''); if(stage&&!STAGES.includes(stage))return J({ok:false,error:'INVALID_STAGE'},400); const createdAt=body.createdAt||now(); const source=`Manual · ${user.displayName||user.email}`;
    await db.prepare(`INSERT INTO tracking_updates(job_id,stage,note,location,source,created_at) VALUES(?1,?2,?3,?4,?5,?6)`).bind(row.id,stage||null,String(body.note||''),String(body.location||''),source,createdAt).run();
    await db.prepare(`UPDATE tracking_jobs SET current_stage=COALESCE(?1,current_stage),status_note=?2,current_location=?3,order_payment_status=COALESCE(?4,order_payment_status),shipping_cost_status=COALESCE(?5,shipping_cost_status),shipping_cost_amount=COALESCE(?6,shipping_cost_amount),shipping_cost_currency=COALESCE(?7,shipping_cost_currency),updated_at=?8 WHERE id=?9`).bind(stage||null,String(body.note||''),String(body.location||''),body.orderPaymentStatus??null,body.shippingCostStatus??null,body.shippingCostAmount==null?null:Number(body.shippingCostAmount),body.shippingCostCurrency??null,createdAt,row.id).run();
    await audit(db,user,'job.update',reference,`${stage||row.current_stage} · ${String(body.note||'').slice(0,300)}`); return J({ok:true,reference,stage:stage||row.current_stage,createdAt});
  }
  if(url.pathname==='/api/ops/phones/link'&&request.method==='POST'){
    const body=await request.json().catch(()=>({})),reference=N(body.reference),row=await resolveJob(db,reference); if(!row)return J({ok:false,error:'TRACKING_JOB_NOT_FOUND'},404); const phones=[...new Set((Array.isArray(body.phones)?body.phones:[body.phone]).map(normalizePhone).filter(Boolean))]; if(!phones.length)return J({ok:false,error:'VALID_PHONE_REQUIRED'},400); for(const p of phones)await db.prepare(`INSERT INTO client_job_links(phone_normalized,job_id) VALUES(?1,?2) ON CONFLICT(phone_normalized,job_id) DO NOTHING`).bind(p,row.id).run(); await audit(db,user,'phone.link',reference,`${phones.length} phone link(s)`); return J({ok:true,count:phones.length,phones:phones.map(maskPhone)});
  }
  if(url.pathname==='/api/ops/carriers/link'&&request.method==='POST'){
    const body=await request.json().catch(()=>({})),reference=N(body.reference),row=await resolveJob(db,reference); if(!row)return J({ok:false,error:'TRACKING_JOB_NOT_FOUND'},404); const carrier=String(body.carrier||'').trim().toLowerCase(),trackingNumber=String(body.trackingNumber||'').trim(),legType=String(body.legType||'seller_to_forwarder'); if(!carrier||!trackingNumber)return J({ok:false,error:'CARRIER_AND_TRACKING_REQUIRED'},400);
    await db.prepare(`INSERT INTO carrier_shipments(job_id,leg_type,carrier,tracking_number,provider,active,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,1,?6,?6) ON CONFLICT(carrier,tracking_number,leg_type) DO UPDATE SET job_id=excluded.job_id,provider=excluded.provider,active=1,updated_at=excluded.updated_at`).bind(row.id,legType,carrier,trackingNumber,String(body.provider||carrier),now()).run(); await audit(db,user,'carrier.link',reference,`${carrier} · ${legType}`); return J({ok:true,reference,carrier,legType});
  }
  if(url.pathname==='/api/ops/audit'&&request.method==='GET'){
    if(user.role!=='owner_admin')return J({ok:false,error:'OWNER_ADMIN_REQUIRED'},403); const rows=(await db.prepare(`SELECT actor_email,actor_role,action,reference,summary,created_at FROM tracking_staff_audit ORDER BY id DESC LIMIT 100`).all()).results||[]; return J({ok:true,audit:rows});
  }
  return J({ok:false,error:'OPS_ROUTE_NOT_FOUND'},404);
}
