const JSON_HEADERS={
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store'
};

const MAIN_MAYA_URL='https://thetechguyds.com/api/maya/chat';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:JSON_HEADERS});
const normalizeRef=value=>String(value||'').trim().toUpperCase();

async function trackingContext(env,reference){
  const ref=normalizeRef(reference);
  if(!ref||!env.TRACKING_DB)return null;

  const row=await env.TRACKING_DB.prepare(`
    SELECT DISTINCT
      j.id,j.master_transaction_id,j.public_reference,j.client_name,j.item_name,j.item_condition,
      j.service_type,j.route,j.origin_country,j.destination_country,j.amount_received,j.currency,
      j.payment_method,j.order_payment_status,j.shipping_cost_status,j.shipping_cost_amount,
      j.shipping_cost_currency,j.current_stage,j.status_note,j.current_location,j.updated_at
    FROM tracking_jobs j
    LEFT JOIN tracking_aliases a ON a.job_id=j.id
    WHERE a.alias=?1 OR j.master_transaction_id=?1 OR j.public_reference=?1
    LIMIT 1
  `).bind(ref).first();

  if(!row)return null;
  const updates=await env.TRACKING_DB.prepare(`
    SELECT stage,note,location,created_at
    FROM tracking_updates
    WHERE job_id=?1
    ORDER BY created_at ASC,id ASC
    LIMIT 50
  `).bind(row.id).all();

  return {
    reference:ref,
    masterId:row.master_transaction_id||'',
    clientName:row.client_name||'',
    item:row.item_name||'',
    condition:row.item_condition||'',
    serviceType:row.service_type||'',
    route:row.route||'',
    origin:row.origin_country||'',
    destination:row.destination_country||'Zambia',
    amountReceived:row.amount_received?`${row.currency||'ZMW'} ${Number(row.amount_received).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`:'',
    paymentMethod:row.payment_method||'',
    orderPaymentStatus:row.order_payment_status||'',
    shippingCostStatus:row.shipping_cost_status||'',
    shippingCostAmount:row.shipping_cost_amount==null?'':`${row.shipping_cost_currency||row.currency||'ZMW'} ${Number(row.shipping_cost_amount).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`,
    currentStage:row.current_stage||'',
    statusNote:row.status_note||'',
    location:row.current_location||row.origin_country||'',
    updatedAt:row.updated_at||'',
    events:(updates.results||[]).map(event=>({
      stage:event.stage||'',
      note:event.note||'',
      location:event.location||'',
      createdAt:event.created_at||''
    }))
  };
}

function fallback(payload){
  const text=String(payload?.message||'').trim();
  const greeting=/^(hi|hey|hello|yo|hiya)\b/i.test(text);
  return {
    ok:true,
    reply:greeting
      ? 'Hi, you’re through to THETECHGUY. What can we sort out for you?'
      : 'I’m having trouble reaching the help desk right now. You can still use the tracking box above, or try me again in a moment.',
    conversation_id:payload?.conversation_id||`maya-tracking-${Date.now()}`,
    case_id:payload?.case_id||null,
    status:'maya_temporarily_unavailable',
    actions:[],
    ui:{show_typing_ms:900}
  };
}

async function callMainMaya(env,payload,request){
  const endpoint=String(env.MAYA_MAIN_URL||MAIN_MAYA_URL).trim();
  const headers={
    'content-type':'application/json',
    'x-ttg-source':'thetechguyds-tracking',
    'x-ttg-personality':'maya',
    'x-ttg-public-chat':'true'
  };
  const session=payload.conversation_id||request.headers.get('x-hunter-session')||'';
  if(session)headers['x-hunter-session']=session;

  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),9000);
  try{
    const response=await fetch(endpoint,{
      method:'POST',headers,signal:controller.signal,body:JSON.stringify(payload)
    });
    const text=await response.text();
    let data={};
    try{data=text?JSON.parse(text):{}}catch{data={}}
    if(!response.ok||!String(data.reply||'').trim())throw new Error(`Maya ${response.status}`);
    return data;
  }finally{
    clearTimeout(timeout);
  }
}

export async function handlePublicMaya(request,env){
  const url=new URL(request.url);
  if(url.pathname!=='/api/maya'||request.method!=='POST')return null;

  const body=await request.clone().json().catch(()=>({}));
  const message=String(body.message||'').trim();
  const record=body.trackingId?await trackingContext(env,body.trackingId):null;
  const payload={
    message,
    conversation_id:body.conversation_id||null,
    case_id:body.case_id||null,
    source:{
      channel:'website',
      site:'thetechguyds-tracking',
      personality:'maya',
      widget:'tracking-site-frontdesk'
    },
    client_hint:{
      tracking_reference:record?.reference||normalizeRef(body.trackingId)||''
    },
    page_context:{
      page:'tracking',
      selected_tracking:record||null,
      instruction:record
        ? 'A customer-facing tracking record is open. Use these facts when relevant, never invent missing details, and never expose implementation or storage terminology.'
        : 'No tracking record is currently selected. Chat normally as the THETECHGUY front desk; ask the customer to track a TTG ID or linked phone only when job-specific facts are needed.'
    },
    attachments:Array.isArray(body.attachments)?body.attachments:[]
  };

  if(!message)return json(fallback(payload));
  try{
    const data=await callMainMaya(env,payload,request);
    return json({...data,ok:true});
  }catch{
    return json(fallback(payload));
  }
}
