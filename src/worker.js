const JSON_HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const STAGES=['intake_received','disclaimer_confirmed','deposit_received','parts_sourcing','parts_ordered','awaiting_seller_shipment','seller_shipped','shipping_company_received','awaiting_shipping_cost','shipping_cost_paid','in_transit_to_zambia','received_in_zambia','parts_received_by_ttg','repair_in_progress','testing','ready_for_collection','completed'];
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:JSON_HEADERS});
const normalizeRef=value=>String(value||'').trim().toUpperCase();
const now=()=>new Date().toISOString();

function publicDemo(id){
  if(!/^TTG-(RCP|INV|DOC|QTE|TXN)-0*60$/i.test(id))return null;
  return {found:true,reference:id,masterId:'TTG-TXN-000060',clientName:'Example Client',condition:'Device / order under tracking',deviceItem:'Tracked item',serviceType:'Parts / Order Tracking',route:'USA → Zambia',origin:'USA',location:'USA shipping company',amountReceived:'',paymentMethod:'',orderPaymentStatus:'Paid in full',shippingCostStatus:'Awaiting shipping company quote',shippingCostAmount:'',stage:'awaiting_shipping_cost',updatedLabel:'Latest saved update',statusNote:'The seller shipment has reached the assigned shipping company. The item/order is paid in full; TTG is waiting for the shipping company to confirm the international shipping charge before dispatch toward Zambia.',latestUpdate:'Shipping company received the parcel. International shipping cost is pending confirmation.'};
}

async function lookupJob(db,reference){
  const ref=normalizeRef(reference);
  const row=await db.prepare(`SELECT DISTINCT j.* FROM tracking_jobs j LEFT JOIN tracking_aliases a ON a.job_id=j.id WHERE a.alias=?1 OR j.master_transaction_id=?1 OR j.public_reference=?1 LIMIT 1`).bind(ref).first();
  if(!row)return null;
  const latest=await db.prepare(`SELECT stage,note,location,source,created_at FROM tracking_updates WHERE job_id=?1 ORDER BY created_at DESC,id DESC LIMIT 1`).bind(row.id).first();
  const shippingAmount=row.shipping_cost_amount?`${row.shipping_cost_currency||row.currency||'ZMW'} ${Number(row.shipping_cost_amount).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`:'';
  return {found:true,reference:ref,masterId:row.master_transaction_id,clientName:row.client_name,condition:row.item_condition,deviceItem:row.item_name,serviceType:row.service_type,route:row.route,origin:row.origin_country,location:latest?.location||row.current_location||row.origin_country,amountReceived:row.amount_received?`${row.currency||'ZMW'} ${Number(row.amount_received).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`:'',paymentMethod:row.payment_method||'',orderPaymentStatus:row.order_payment_status||'',shippingCostStatus:row.shipping_cost_status||'',shippingCostAmount:shippingAmount,stage:latest?.stage||row.current_stage,updatedLabel:latest?.created_at||row.updated_at,statusNote:latest?.note||row.status_note||'',latestUpdate:latest?.note||row.status_note||''};
}

async function requireAdmin(request,env){if(!env.ADMIN_TOKEN)return false;return(request.headers.get('authorization')||'')===`Bearer ${env.ADMIN_TOKEN}`}
async function resolveJobId(db,reference){const ref=normalizeRef(reference);const row=await db.prepare(`SELECT DISTINCT j.id AS job_id FROM tracking_jobs j LEFT JOIN tracking_aliases a ON a.job_id=j.id WHERE a.alias=?1 OR j.master_transaction_id=?1 OR j.public_reference=?1 LIMIT 1`).bind(ref).first();return row?.job_id||null}

async function upsertJob(db,body){
  const job=body.job||{},master=normalizeRef(job.masterTransactionId),publicRef=normalizeRef(job.publicReference||master);
  if(!master)return json({ok:false,error:'masterTransactionId required'},400);
  await db.prepare(`INSERT INTO tracking_jobs(master_transaction_id,public_reference,client_name,item_name,item_condition,service_type,route,origin_country,destination_country,amount_received,currency,payment_method,order_payment_status,shipping_cost_status,shipping_cost_amount,shipping_cost_currency,current_stage,status_note,current_location,updated_at)
  VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)
  ON CONFLICT(master_transaction_id) DO UPDATE SET public_reference=excluded.public_reference,client_name=excluded.client_name,item_name=excluded.item_name,item_condition=excluded.item_condition,service_type=excluded.service_type,route=excluded.route,origin_country=excluded.origin_country,destination_country=excluded.destination_country,amount_received=excluded.amount_received,currency=excluded.currency,payment_method=excluded.payment_method,order_payment_status=excluded.order_payment_status,shipping_cost_status=excluded.shipping_cost_status,shipping_cost_amount=excluded.shipping_cost_amount,shipping_cost_currency=excluded.shipping_cost_currency,current_stage=excluded.current_stage,status_note=excluded.status_note,current_location=excluded.current_location,updated_at=excluded.updated_at`)
  .bind(master,publicRef,job.clientName||'',job.itemName||'',job.condition||'',job.serviceType||'',job.route||'',job.originCountry||'',job.destinationCountry||'Zambia',Number(job.amountReceived||0),job.currency||'ZMW',job.paymentMethod||'',job.orderPaymentStatus||'',job.shippingCostStatus||'',job.shippingCostAmount==null?null:Number(job.shippingCostAmount),job.shippingCostCurrency||job.currency||'ZMW',job.currentStage||'intake_received',job.statusNote||'',job.currentLocation||'',now()).run();
  const saved=await db.prepare(`SELECT id FROM tracking_jobs WHERE master_transaction_id=?1`).bind(master).first();
  const aliases=new Set([master,publicRef,...(body.aliases||[]).map(normalizeRef)].filter(Boolean));
  for(const alias of aliases)await db.prepare(`INSERT INTO tracking_aliases(alias,job_id) VALUES(?1,?2) ON CONFLICT(alias) DO UPDATE SET job_id=excluded.job_id`).bind(alias,saved.id).run();
  return json({ok:true,id:saved.id,masterTransactionId:master,aliases:[...aliases]});
}

async function addUpdate(db,body){
  const jobId=await resolveJobId(db,body.reference);if(!jobId)return json({ok:false,error:'tracking job not found'},404);
  const stage=body.stage||'';if(stage&&!STAGES.includes(stage))return json({ok:false,error:'invalid stage'},400);
  const created=body.createdAt||now();
  await db.prepare(`INSERT INTO tracking_updates(job_id,stage,note,location,source,created_at) VALUES(?1,?2,?3,?4,?5,?6)`).bind(jobId,stage||null,body.note||'',body.location||'',body.source||'TTG update',created).run();
  if(stage)await db.prepare(`UPDATE tracking_jobs SET current_stage=?1,status_note=?2,current_location=?3,updated_at=?4 WHERE id=?5`).bind(stage,body.note||'',body.location||'',created,jobId).run();
  if(body.orderPaymentStatus!==undefined)await db.prepare(`UPDATE tracking_jobs SET order_payment_status=?1,updated_at=?2 WHERE id=?3`).bind(body.orderPaymentStatus||'',created,jobId).run();
  if(body.shippingCostStatus!==undefined||body.shippingCostAmount!==undefined)await db.prepare(`UPDATE tracking_jobs SET shipping_cost_status=COALESCE(?1,shipping_cost_status),shipping_cost_amount=COALESCE(?2,shipping_cost_amount),shipping_cost_currency=COALESCE(?3,shipping_cost_currency),updated_at=?4 WHERE id=?5`).bind(body.shippingCostStatus??null,body.shippingCostAmount==null?null:Number(body.shippingCostAmount),body.shippingCostCurrency??null,created,jobId).run();
  return json({ok:true,jobId,stage,createdAt:created});
}

async function linkCarrier(db,body){
  const jobId=await resolveJobId(db,body.reference);if(!jobId)return json({ok:false,error:'tracking job not found'},404);
  if(!body.carrier||!body.trackingNumber)return json({ok:false,error:'carrier and trackingNumber required'},400);
  await db.prepare(`INSERT INTO carrier_shipments(job_id,leg_type,carrier,tracking_number,provider,active,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,1,?6,?6)`).bind(jobId,body.legType||'seller_to_forwarder',String(body.carrier).toLowerCase(),String(body.trackingNumber).trim(),body.provider||String(body.carrier).toLowerCase(),now()).run();
  return json({ok:true,jobId,carrier:body.carrier,legType:body.legType||'seller_to_forwarder'});
}

function stageText(stage){return String(stage||'').replaceAll('_',' ')}
function routeEstimate(origin='',question=''){
  const o=String(origin).toLowerCase(),q=String(question).toLowerCase();
  if(/japan|japanese/.test(o)||/japan|japanese/.test(q))return'For genuine parts from Japan, the normal guide is about 14 working days after the shipping handoff.';
  if(/uk|britain|england/.test(o)||/\buk\b|britain|england/.test(q))return'For UK shipments, the normal guide is about 14 working days or less after the shipping handoff.';
  if(/china/.test(o)||/china/.test(q)){if(/large|heavy|big|bulky|freight|sea/.test(q))return'For large or heavy items from China, the normal guide is about 60–70 days.';return'For small China parcels, the normal guide is about 7–14 working days; large or heavy China items are about 60–70 days.'}
  if(/usa|united states|america/.test(o)||/usa|united states|america/.test(q))return'For USA shipments, the normal guide is about 21 working days after the international shipping handoff.';
  return'';
}
function detailSummary(record,question=''){
  if(!record)return'I can give you the job details once I have a valid TTG receipt, invoice, disclaimer, quote or master tracking ID.';
  const bits=[];
  if(record.serviceType||record.deviceItem)bits.push(`This is ${record.serviceType||'a tracked TTG job'}${record.deviceItem?` for ${record.deviceItem}`:''}.`);
  if(record.route)bits.push(`The route is ${record.route}.`);
  if(record.orderPaymentStatus)bits.push(`The item/order payment status is ${record.orderPaymentStatus}.`);
  if(record.shippingCostStatus)bits.push(`The international shipping cost is ${record.shippingCostStatus}${record.shippingCostAmount?` (${record.shippingCostAmount})`:''}.`);
  bits.push(`The current TTG stage is ${stageText(record.stage)||'available on the tracking record'}.`);
  if(record.statusNote)bits.push(record.statusNote);
  const eta=routeEstimate(record.origin||record.route||'',question);if(eta)bits.push(eta);
  return bits.join(' ');
}
function mayaFallback(message,record){
  const q=String(message||'').toLowerCase(),stage=record?.stage||'',prettyStage=stageText(stage);
  if(/hello|hey|^hi\b/.test(q))return record?`Hi 👋🏽 I’ve got this tracking job open. The current stage is ${prettyStage}. Ask me anything about the job and I’ll explain it.`:'Hi 👋🏽 I’m Maya. Give me the TTG tracking ID and I can explain the job, shipping stage, timing, documents or what happens next.';
  if(/\bdetail(s)?\b|\babout this\b|\btell me about\b|\bwhat is this\b|\binformation\b/.test(q))return detailSummary(record,q);
  if(/where|status|track/.test(q)&&record)return`The latest TTG stage is ${prettyStage}. ${record.statusNote||''} ${record.shippingCostStatus?`Shipping cost status: ${record.shippingCostStatus}.`:''}`.trim();
  if(/\bnext\b|what happens/.test(q)&&record){const i=STAGES.indexOf(stage),next=i>=0&&i<STAGES.length-1?stageText(STAGES[i+1]):'completion';return`You’re currently at ${prettyStage}. The next TTG stage is ${next}. ${record.orderPaymentStatus?`The order payment is ${record.orderPaymentStatus}. `:''}${record.shippingCostStatus?`Shipping cost is ${record.shippingCostStatus}.`:''}`.trim()}
  if(/\beta\b|\bhow long\b|\bdays\b|\barrive\b|\bdelivery\b|\btime\b/.test(q))return routeEstimate(record?.origin||record?.route||'',q)||'Transit timing depends on the origin and the shipping handoff. Tell me the origin or open the TTG tracking record and I’ll use the correct route guide.';
  if(/custom|clearance|duty/.test(q))return'Customs or local clearance can add time after the international leg. When TTG saves a customs or local handoff update, it becomes part of the same public tracking timeline.';
  if(/receipt|invoice|disclaimer|quote|document/.test(q))return'You can use a linked TTG receipt, invoice, disclaimer, quote or master transaction ID. They all resolve to the same underlying tracking job when they share the transaction.';
  if(/fedex|courier|carrier|seller|shipping company/.test(q))return record?`TTG keeps the private carrier reference internal. For this job, the public stage is ${prettyStage}. ${record.statusNote||''}`:'TTG keeps supplier and carrier references internal and uses their scans to update the public TTG tracking stage.';
  return record?`I can help with this job’s current stage (${prettyStage}), payment and shipping-cost status, what happens next, delivery timing, customs or documents. Ask me naturally and I’ll answer the question first.`:'I can help with shipping and tracking. Send the TTG tracking ID or ask about the job, delivery timing, seller handoff, customs or documents.';
}

async function hunterReply(env,message,record){
  if(!env.HUNTER_API_URL||String(env.HUNTER_ENABLED||'true').toLowerCase()==='false')return null;
  const system=`You are Maya, the THETECHGUY tracking-site assistant. You are warm, concise and conversational. Answer the user's actual question first. Only after answering, add ETA guidance when relevant. Stay strictly within shipping, tracking, procurement/order progress, payment/shipping-cost status, customs and linked TTG documents. Never reveal private supplier or carrier tracking numbers. If a tracking record is supplied, treat it as the source of truth. Route guides: USA about 21 working days after international handoff; UK about 14 working days or less; Japan genuine parts about 14 working days; China small parcels about 7-14 working days; China large/heavy items about 60-70 days. Seller processing before shipping-company handoff is separate. Current tracking context: ${JSON.stringify(record||null)}`;
  const headers={'content-type':'application/json'};if(env.HUNTER_API_KEY)headers.authorization=`Bearer ${env.HUNTER_API_KEY}`;
  try{const res=await fetch(env.HUNTER_API_URL,{method:'POST',headers,body:JSON.stringify({model:env.HUNTER_MODEL||'hunter-cloudflare',messages:[{role:'system',content:system},{role:'user',content:String(message||'')}],temperature:.35})});if(!res.ok)return null;const data=await res.json();return data?.choices?.[0]?.message?.content?.trim()||data?.reply?.trim()||null}catch{return null}
}

async function fedexToken(env){if(!env.FEDEX_TOKEN_URL||!env.FEDEX_API_KEY||!env.FEDEX_SECRET_KEY)return null;const body=new URLSearchParams({grant_type:'client_credentials',client_id:env.FEDEX_API_KEY,client_secret:env.FEDEX_SECRET_KEY});const res=await fetch(env.FEDEX_TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});if(!res.ok)return null;const data=await res.json();return data.access_token||null}
function mapCarrierStage(legType,statusText,eventText,countryCode){const text=`${statusText||''} ${eventText||''}`.toLowerCase();if(legType==='seller_to_forwarder'){if(/delivered/.test(text))return'awaiting_shipping_cost';if(/picked up|possession|arrived|departed|transit|shipment/.test(text))return'seller_shipped'}if(legType==='international_to_zambia'){if(String(countryCode||'').toUpperCase()==='ZM'||/zambia|delivered/.test(text))return'received_in_zambia';if(/transit|departed|picked up|possession/.test(text))return'in_transit_to_zambia'}return null}
async function syncFedexShipment(db,shipment,env){if(!env.FEDEX_TRACK_URL)return;const token=await fedexToken(env);if(!token)return;const res=await fetch(env.FEDEX_TRACK_URL,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-locale':'en_US'},body:JSON.stringify({includeDetailedScans:true,trackingInfo:[{trackingNumberInfo:{trackingNumber:shipment.tracking_number}}]})});if(!res.ok)return;const data=await res.json(),tr=data?.output?.completeTrackResults?.[0]?.trackResults?.[0];if(!tr)return;const statusText=tr?.latestStatusDetail?.description||tr?.latestStatusDetail?.statusByLocale||'',scan=tr?.scanEvents?.[0]||{},eventText=scan?.eventDescription||statusText,country=scan?.scanLocation?.countryCode||tr?.latestStatusDetail?.scanLocation?.countryCode||'',location=[scan?.scanLocation?.city,scan?.scanLocation?.stateOrProvinceCode,country].filter(Boolean).join(', '),eventAt=scan?.date||now(),stage=mapCarrierStage(shipment.leg_type,statusText,eventText,country);await db.prepare(`UPDATE carrier_shipments SET last_status=?1,last_event_code=?2,last_event_at=?3,last_checked_at=?4,updated_at=?4 WHERE id=?5`).bind(eventText,scan?.eventType||'',eventAt,now(),shipment.id).run();const previous=await db.prepare(`SELECT stage,note,created_at FROM tracking_updates WHERE job_id=?1 AND source LIKE 'carrier:%' ORDER BY created_at DESC,id DESC LIMIT 1`).bind(shipment.job_id).first();let note=`${shipment.carrier.toUpperCase()}: ${eventText}${location?` · ${location}`:''}`;if(stage==='awaiting_shipping_cost')note='The seller shipment has reached the assigned shipping company. TTG is waiting for the international shipping charge to be confirmed before dispatch toward Zambia.';if(!previous||previous.note!==note){await db.prepare(`INSERT INTO tracking_updates(job_id,stage,note,location,source,created_at) VALUES(?1,?2,?3,?4,?5,?6)`).bind(shipment.job_id,stage||null,note,location,`carrier:${shipment.carrier}`,eventAt).run();if(stage)await db.prepare(`UPDATE tracking_jobs SET current_stage=?1,status_note=?2,current_location=?3,shipping_cost_status=CASE WHEN ?1='awaiting_shipping_cost' THEN 'Awaiting shipping company quote' ELSE shipping_cost_status END,updated_at=?4 WHERE id=?5`).bind(stage,note,location,eventAt,shipment.job_id).run()}}
async function syncCarriers(env){const db=env.TRACKING_DB;if(!db)return;const rows=await db.prepare(`SELECT * FROM carrier_shipments WHERE active=1 ORDER BY COALESCE(last_checked_at,'') ASC LIMIT 25`).all();for(const shipment of rows.results||[])if(shipment.provider==='fedex'||shipment.carrier==='fedex')await syncFedexShipment(db,shipment,env)}

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==='/api/health')return json({ok:true,worker:'package-tracking',d1Bound:Boolean(env.TRACKING_DB),assetsBound:Boolean(env.ASSETS),hunterConfigured:Boolean(env.HUNTER_API_URL)});
    if(url.pathname==='/api/track'&&request.method==='GET'){const id=normalizeRef(url.searchParams.get('id'));if(!id)return json({found:false,error:'tracking id required'},400);if(env.TRACKING_DB){const record=await lookupJob(env.TRACKING_DB,id);return record?json(record):json({found:false},404)}const demo=publicDemo(id);return demo?json(demo):json({found:false},404)}
    if(url.pathname==='/api/maya'&&request.method==='POST'){const body=await request.json().catch(()=>({}));let record=null;if(body.trackingId&&env.TRACKING_DB)record=await lookupJob(env.TRACKING_DB,body.trackingId);else if(body.trackingId)record=publicDemo(body.trackingId);const intelligent=await hunterReply(env,body.message,record);return json({ok:true,reply:intelligent||mayaFallback(body.message,record),brain:intelligent?'hunter':'tracking-fallback'})}
    if(url.pathname==='/api/admin/jobs/upsert'&&request.method==='POST'){if(!await requireAdmin(request,env))return json({ok:false,error:'unauthorized'},401);if(!env.TRACKING_DB)return json({ok:false,error:'TRACKING_DB is not bound'},503);return upsertJob(env.TRACKING_DB,await request.json())}
    if(url.pathname==='/api/admin/jobs/update'&&request.method==='POST'){if(!await requireAdmin(request,env))return json({ok:false,error:'unauthorized'},401);if(!env.TRACKING_DB)return json({ok:false,error:'TRACKING_DB is not bound'},503);return addUpdate(env.TRACKING_DB,await request.json())}
    if(url.pathname==='/api/admin/carriers/link'&&request.method==='POST'){if(!await requireAdmin(request,env))return json({ok:false,error:'unauthorized'},401);if(!env.TRACKING_DB)return json({ok:false,error:'TRACKING_DB is not bound'},503);return linkCarrier(env.TRACKING_DB,await request.json())}
    if(url.pathname==='/api/admin/carriers/sync'&&request.method==='POST'){if(!await requireAdmin(request,env))return json({ok:false,error:'unauthorized'},401);ctx.waitUntil(syncCarriers(env));return json({ok:true,queued:true})}
    if(env.ASSETS)return env.ASSETS.fetch(request);return new Response('Not found',{status:404});
  },
  async scheduled(controller,env,ctx){ctx.waitUntil(syncCarriers(env))}
};
