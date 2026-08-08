const JSON_HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const STAGES=['intake_received','disclaimer_confirmed','deposit_received','parts_sourcing','parts_ordered','awaiting_seller_shipment','seller_shipped','shipping_company_received','in_transit_to_zambia','received_in_zambia','parts_received_by_ttg','repair_in_progress','testing','ready_for_collection','completed'];

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:JSON_HEADERS});
const normalizeRef=value=>String(value||'').trim().toUpperCase();
const now=()=>new Date().toISOString();

function publicDemo(id){
  if(!/^TTG-(RCP|INV|DOC|QTE|TXN)-0*60$/i.test(id))return null;
  return {found:true,reference:id,masterId:'TTG-TXN-000060',clientName:'Example Client',condition:'Device / order under tracking',deviceItem:'Tracked item',serviceType:'Parts / Order Tracking',route:'USA → Zambia',origin:'USA',location:'USA',amountReceived:'',paymentMethod:'',stage:'shipping_company_received',updatedLabel:'Latest saved update',statusNote:'The seller shipment has reached the assigned shipping company. The next TTG stage is the international handoff toward Zambia.',latestUpdate:'This is a temporary fallback record until the D1 database is bound to the Worker.'};
}

async function lookupJob(db,reference){
  const ref=normalizeRef(reference);
  const row=await db.prepare(`
    SELECT j.* FROM tracking_aliases a
    JOIN tracking_jobs j ON j.id=a.job_id
    WHERE a.alias=?1
    UNION
    SELECT * FROM tracking_jobs WHERE master_transaction_id=?1 OR public_reference=?1
    LIMIT 1
  `).bind(ref).first();
  if(!row)return null;
  const latest=await db.prepare(`SELECT stage,note,location,source,created_at FROM tracking_updates WHERE job_id=?1 ORDER BY created_at DESC,id DESC LIMIT 1`).bind(row.id).first();
  return {
    found:true,
    reference:ref,
    masterId:row.master_transaction_id,
    clientName:row.client_name,
    condition:row.item_condition,
    deviceItem:row.item_name,
    serviceType:row.service_type,
    route:row.route,
    origin:row.origin_country,
    location:latest?.location||row.current_location||row.origin_country,
    amountReceived:row.amount_received?`${row.currency||'ZMW'} ${Number(row.amount_received).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`:'',
    paymentMethod:row.payment_method||'',
    stage:latest?.stage||row.current_stage,
    updatedLabel:latest?.created_at||row.updated_at,
    statusNote:latest?.note||row.status_note||'',
    latestUpdate:latest?.note||row.status_note||''
  };
}

async function requireAdmin(request,env){
  if(!env.ADMIN_TOKEN)return false;
  const auth=request.headers.get('authorization')||'';
  return auth===`Bearer ${env.ADMIN_TOKEN}`;
}

async function resolveJobId(db,reference){
  const ref=normalizeRef(reference);
  const row=await db.prepare(`SELECT job_id FROM tracking_aliases WHERE alias=?1 UNION SELECT id AS job_id FROM tracking_jobs WHERE master_transaction_id=?1 OR public_reference=?1 LIMIT 1`).bind(ref).first();
  return row?.job_id||null;
}

async function upsertJob(db,body){
  const job=body.job||{};
  const master=normalizeRef(job.masterTransactionId);
  const publicRef=normalizeRef(job.publicReference||master);
  if(!master)return json({ok:false,error:'masterTransactionId required'},400);
  await db.prepare(`
    INSERT INTO tracking_jobs(master_transaction_id,public_reference,client_name,item_name,item_condition,service_type,route,origin_country,destination_country,amount_received,currency,payment_method,current_stage,status_note,current_location,updated_at)
    VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
    ON CONFLICT(master_transaction_id) DO UPDATE SET public_reference=excluded.public_reference,client_name=excluded.client_name,item_name=excluded.item_name,item_condition=excluded.item_condition,service_type=excluded.service_type,route=excluded.route,origin_country=excluded.origin_country,destination_country=excluded.destination_country,amount_received=excluded.amount_received,currency=excluded.currency,payment_method=excluded.payment_method,current_stage=excluded.current_stage,status_note=excluded.status_note,current_location=excluded.current_location,updated_at=excluded.updated_at
  `).bind(master,publicRef,job.clientName||'',job.itemName||'',job.condition||'',job.serviceType||'',job.route||'',job.originCountry||'',job.destinationCountry||'Zambia',Number(job.amountReceived||0),job.currency||'ZMW',job.paymentMethod||'',job.currentStage||'intake_received',job.statusNote||'',job.currentLocation||'',now()).run();
  const saved=await db.prepare(`SELECT id FROM tracking_jobs WHERE master_transaction_id=?1`).bind(master).first();
  const aliases=new Set([master,publicRef,...(body.aliases||[]).map(normalizeRef)].filter(Boolean));
  for(const alias of aliases)await db.prepare(`INSERT INTO tracking_aliases(alias,job_id) VALUES(?1,?2) ON CONFLICT(alias) DO UPDATE SET job_id=excluded.job_id`).bind(alias,saved.id).run();
  return json({ok:true,id:saved.id,masterTransactionId:master,aliases:[...aliases]});
}

async function addUpdate(db,body){
  const jobId=await resolveJobId(db,body.reference);
  if(!jobId)return json({ok:false,error:'tracking job not found'},404);
  const stage=body.stage||'';
  if(stage&&!STAGES.includes(stage))return json({ok:false,error:'invalid stage'},400);
  const created=body.createdAt||now();
  await db.prepare(`INSERT INTO tracking_updates(job_id,stage,note,location,source,created_at) VALUES(?1,?2,?3,?4,?5,?6)`).bind(jobId,stage||null,body.note||'',body.location||'',body.source||'TTG update',created).run();
  if(stage)await db.prepare(`UPDATE tracking_jobs SET current_stage=?1,status_note=?2,current_location=?3,updated_at=?4 WHERE id=?5`).bind(stage,body.note||'',body.location||'',created,jobId).run();
  return json({ok:true,jobId,stage,createdAt:created});
}

async function linkCarrier(db,body){
  const jobId=await resolveJobId(db,body.reference);
  if(!jobId)return json({ok:false,error:'tracking job not found'},404);
  if(!body.carrier||!body.trackingNumber)return json({ok:false,error:'carrier and trackingNumber required'},400);
  await db.prepare(`INSERT INTO carrier_shipments(job_id,leg_type,carrier,tracking_number,provider,active,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,1,?6,?6)`).bind(jobId,body.legType||'seller_to_forwarder',String(body.carrier).toLowerCase(),String(body.trackingNumber).trim(),body.provider||String(body.carrier).toLowerCase(),now()).run();
  return json({ok:true,jobId,carrier:body.carrier,legType:body.legType||'seller_to_forwarder'});
}

function mayaFallback(message,record){
  const q=String(message||'').toLowerCase();
  const stage=record?.stage||'';
  const stageText=stage.replaceAll('_',' ');
  if(/hello|hey|^hi\b/.test(q))return record?`Hi 👋🏽 I’ve got the tracking context here. The current saved stage is ${stageText || 'available on the job record'}. What would you like me to explain?`:'Hi 👋🏽 I’m Maya. Give me the TTG tracking ID and I can help with the parcel stage, timing, documents or what happens next.';
  if(/where|status|track/.test(q)&&record)return`The latest TTG stage is ${stageText}. ${record.statusNote||'I can also explain what the next handoff should be.'}`;
  if(/next|what happens/.test(q)&&record){const i=STAGES.indexOf(stage);const next=i>=0&&i<STAGES.length-1?STAGES[i+1].replaceAll('_',' '):'completion';return`You’re currently at ${stageText}. The next TTG stage is ${next}. I’ll keep the explanation in customer terms rather than exposing the private carrier reference.`}
  if(/eta|how long|days|arrive|delivery/.test(q))return'The route estimate starts after the shipping company receives the parcel; seller processing time before that is separate. USA is usually about 21 working days, UK about 14 working days or less, China small parcels about 7–14 working days, and China bulk about 60 days.';
  if(/custom|clearance|duty/.test(q))return'Customs or local clearance can add time after the international leg. When TTG saves a customs or local handoff update, it becomes part of the same public tracking timeline.';
  if(/receipt|invoice|disclaimer|quote|document/.test(q))return'You can use a linked TTG receipt, invoice, disclaimer, quote or master transaction ID. They all resolve to the same underlying tracking job when they share the transaction.';
  if(/fedex|courier|carrier|seller/.test(q))return'The seller/carrier number stays internal. TTG can use those scans to update the public stage automatically, while the client continues using the TTG reference.';
  return record?`I can help with this job’s current stage (${stageText}), what happens next, delivery timing, customs or the documents tied to it. Ask me whichever part you want to understand.`:'I can help with shipping and tracking. Send the TTG tracking ID or ask about delivery timing, seller handoff, customs or tracking documents.';
}

async function fedexToken(env){
  if(!env.FEDEX_TOKEN_URL||!env.FEDEX_API_KEY||!env.FEDEX_SECRET_KEY)return null;
  const body=new URLSearchParams({grant_type:'client_credentials',client_id:env.FEDEX_API_KEY,client_secret:env.FEDEX_SECRET_KEY});
  const res=await fetch(env.FEDEX_TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});
  if(!res.ok)return null;
  const data=await res.json();return data.access_token||null;
}

function mapCarrierStage(legType,statusText,eventText,countryCode){
  const text=`${statusText||''} ${eventText||''}`.toLowerCase();
  if(legType==='seller_to_forwarder'){
    if(/delivered/.test(text))return 'shipping_company_received';
    if(/picked up|possession|arrived|departed|transit|shipment/.test(text))return 'seller_shipped';
  }
  if(legType==='international_to_zambia'){
    if(String(countryCode||'').toUpperCase()==='ZM'||/zambia|delivered/.test(text))return 'received_in_zambia';
    if(/transit|departed|picked up|possession/.test(text))return 'in_transit_to_zambia';
  }
  return null;
}

async function syncFedexShipment(db,shipment,env){
  if(!env.FEDEX_TRACK_URL)return;
  const token=await fedexToken(env);if(!token)return;
  const res=await fetch(env.FEDEX_TRACK_URL,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-locale':'en_US'},body:JSON.stringify({includeDetailedScans:true,trackingInfo:[{trackingNumberInfo:{trackingNumber:shipment.tracking_number}}]})});
  if(!res.ok)return;
  const data=await res.json();
  const tr=data?.output?.completeTrackResults?.[0]?.trackResults?.[0];if(!tr)return;
  const statusText=tr?.latestStatusDetail?.description||tr?.latestStatusDetail?.statusByLocale||'';
  const scan=tr?.scanEvents?.[0]||{};
  const eventText=scan?.eventDescription||statusText;
  const country=scan?.scanLocation?.countryCode||tr?.latestStatusDetail?.scanLocation?.countryCode||'';
  const location=[scan?.scanLocation?.city,scan?.scanLocation?.stateOrProvinceCode,country].filter(Boolean).join(', ');
  const eventAt=scan?.date||now();
  const stage=mapCarrierStage(shipment.leg_type,statusText,eventText,country);
  await db.prepare(`UPDATE carrier_shipments SET last_status=?1,last_event_code=?2,last_event_at=?3,last_checked_at=?4,updated_at=?4 WHERE id=?5`).bind(eventText,scan?.eventType||'',eventAt,now(),shipment.id).run();
  const previous=await db.prepare(`SELECT stage,note,created_at FROM tracking_updates WHERE job_id=?1 AND source LIKE 'carrier:%' ORDER BY created_at DESC,id DESC LIMIT 1`).bind(shipment.job_id).first();
  const note=`${shipment.carrier.toUpperCase()}: ${eventText}${location?` · ${location}`:''}`;
  if(!previous||previous.note!==note){
    await db.prepare(`INSERT INTO tracking_updates(job_id,stage,note,location,source,created_at) VALUES(?1,?2,?3,?4,?5,?6)`).bind(shipment.job_id,stage||null,note,location,`carrier:${shipment.carrier}`,eventAt).run();
    if(stage)await db.prepare(`UPDATE tracking_jobs SET current_stage=?1,status_note=?2,current_location=?3,updated_at=?4 WHERE id=?5`).bind(stage,note,location,eventAt,shipment.job_id).run();
  }
}

async function syncCarriers(env){
  const db=env.TRACKING_DB;if(!db)return;
  const rows=await db.prepare(`SELECT * FROM carrier_shipments WHERE active=1 ORDER BY COALESCE(last_checked_at,'') ASC LIMIT 25`).all();
  for(const shipment of rows.results||[]){
    if(shipment.provider==='fedex'||shipment.carrier==='fedex')await syncFedexShipment(db,shipment,env);
  }
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==='/api/health')return json({ok:true,worker:'package-tracking',d1Bound:Boolean(env.TRACKING_DB),assetsBound:Boolean(env.ASSETS)});
    if(url.pathname==='/api/track'&&request.method==='GET'){
      const id=normalizeRef(url.searchParams.get('id'));
      if(!id)return json({found:false,error:'tracking id required'},400);
      if(env.TRACKING_DB){const record=await lookupJob(env.TRACKING_DB,id);return record?json(record):json({found:false},404)}
      const demo=publicDemo(id);return demo?json(demo):json({found:false},404);
    }
    if(url.pathname==='/api/maya'&&request.method==='POST'){
      const body=await request.json().catch(()=>({}));
      let record=null;if(body.trackingId&&env.TRACKING_DB)record=await lookupJob(env.TRACKING_DB,body.trackingId);else if(body.trackingId)record=publicDemo(body.trackingId);
      return json({ok:true,reply:mayaFallback(body.message,record)});
    }
    if(url.pathname==='/api/admin/jobs/upsert'&&request.method==='POST'){
      if(!await requireAdmin(request,env))return json({ok:false,error:'unauthorized'},401);
      if(!env.TRACKING_DB)return json({ok:false,error:'TRACKING_DB is not bound'},503);
      return upsertJob(env.TRACKING_DB,await request.json());
    }
    if(url.pathname==='/api/admin/jobs/update'&&request.method==='POST'){
      if(!await requireAdmin(request,env))return json({ok:false,error:'unauthorized'},401);
      if(!env.TRACKING_DB)return json({ok:false,error:'TRACKING_DB is not bound'},503);
      return addUpdate(env.TRACKING_DB,await request.json());
    }
    if(url.pathname==='/api/admin/carriers/link'&&request.method==='POST'){
      if(!await requireAdmin(request,env))return json({ok:false,error:'unauthorized'},401);
      if(!env.TRACKING_DB)return json({ok:false,error:'TRACKING_DB is not bound'},503);
      return linkCarrier(env.TRACKING_DB,await request.json());
    }
    if(url.pathname==='/api/admin/carriers/sync'&&request.method==='POST'){
      if(!await requireAdmin(request,env))return json({ok:false,error:'unauthorized'},401);
      ctx.waitUntil(syncCarriers(env));return json({ok:true,queued:true});
    }
    if(env.ASSETS)return env.ASSETS.fetch(request);
    return new Response('Not found',{status:404});
  },
  async scheduled(event,env,ctx){ctx.waitUntil(syncCarriers(env));}
};
