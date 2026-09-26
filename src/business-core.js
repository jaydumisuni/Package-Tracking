const MASTER_RE=/^TTG-TXN-[0-9]{6,}$/;

function configState(env){
  const hasUrl=Boolean(String(env.BUSINESS_CORE_URL||'').trim());
  const hasToken=Boolean(String(env.BUSINESS_CORE_TOKEN||'').trim());
  if(hasUrl&&hasToken)return 'ready';
  if(hasUrl||hasToken)return 'incomplete';
  return 'missing';
}

export function businessCoreConfigured(env){
  return configState(env)==='ready';
}

export function businessCoreConfigurationState(env){
  return configState(env);
}

function requireConfig(env){
  const state=configState(env);
  if(state!=='ready'){
    const error=new Error(state==='incomplete'?'BUSINESS_CORE_CONFIGURATION_INCOMPLETE':'BUSINESS_CORE_NOT_CONFIGURED');
    error.statusCode=503;
    error.code=error.message;
    throw error;
  }
}

async function coreJson(env,path,options={}){
  requireConfig(env);
  const endpoint=new URL(path,String(env.BUSINESS_CORE_URL)).toString();
  const headers=new Headers(options.headers||{});
  headers.set('authorization',`Bearer ${env.BUSINESS_CORE_TOKEN}`);
  if(options.body&&!headers.has('content-type'))headers.set('content-type','application/json');
  let response;
  try{
    response=await fetch(endpoint,{...options,headers});
  }catch(error){
    const wrapped=new Error('BUSINESS_CORE_UNREACHABLE');
    wrapped.statusCode=503;
    wrapped.cause=error;
    throw wrapped;
  }
  let payload=null;
  try{payload=await response.json()}catch{}
  if(!response.ok||payload?.ok===false){
    const code=response.status===404?'BUSINESS_CORE_MASTER_NOT_FOUND':'BUSINESS_CORE_REQUEST_FAILED';
    const error=new Error(code);
    error.statusCode=response.status===404?404:503;
    error.providerStatus=response.status;
    error.payload=payload;
    throw error;
  }
  return payload;
}

export async function reserveFromBusinessCore(request,env){
  requireConfig(env);
  const idempotencyKey=(request.headers.get('x-idempotency-key')||crypto.randomUUID()).trim();
  const payload=await coreJson(env,'/v1/transactions/reserve',{
    method:'POST',
    body:JSON.stringify({
      source_system:'package-tracking',
      source_reference:`tracking-reserve:${idempotencyKey}`,
      idempotency_key:`package-tracking:${idempotencyKey}`
    })
  });
  if(!payload?.masterTransactionId||!MASTER_RE.test(String(payload.masterTransactionId))){
    const error=new Error('BUSINESS_CORE_INVALID_RESERVATION');
    error.statusCode=503;
    throw error;
  }
  return {
    sequence:Number(payload.sequence),
    masterTransactionId:String(payload.masterTransactionId),
    reserved:Boolean(payload.reserved),
    authority:'business-core'
  };
}

export async function verifyBusinessCoreTransaction(env,masterTransactionId){
  const master=String(masterTransactionId||'').trim().toUpperCase();
  if(!MASTER_RE.test(master)){
    const error=new Error('INVALID_MASTER_TRANSACTION_ID');
    error.statusCode=400;
    throw error;
  }
  const payload=await coreJson(env,`/v1/transactions/${encodeURIComponent(master)}`,{method:'GET'});
  if(!payload?.transaction?.master_transaction_id){
    const error=new Error('BUSINESS_CORE_INVALID_TRANSACTION_RESPONSE');
    error.statusCode=503;
    throw error;
  }
  return payload.transaction;
}

export async function getTrackingAuthorityState(db,masterTransactionId){
  return db.prepare(`SELECT id,master_transaction_id,public_reference,
    business_core_linked_at,business_core_link_error,business_core_link_attempt_at
    FROM tracking_jobs WHERE master_transaction_id=?1 LIMIT 1`)
    .bind(String(masterTransactionId||'').trim().toUpperCase()).first();
}

export async function bindTrackingReference(env,{masterTransactionId,jobId,publicReference}){
  const master=String(masterTransactionId||'').trim().toUpperCase();
  if(!MASTER_RE.test(master)){
    const error=new Error('INVALID_MASTER_TRANSACTION_ID');
    error.statusCode=400;
    throw error;
  }
  const payload=await coreJson(
    env,
    `/v1/transactions/${encodeURIComponent(master)}/references`,
    {
      method:'POST',
      body:JSON.stringify({
        domain:'tracking',
        reference_type:'job',
        reference_value:master,
        source_system:'package-tracking',
        metadata:{
          d1_job_id:Number(jobId),
          public_reference:String(publicReference||master).trim().toUpperCase()
        }
      })
    }
  );
  if(!payload?.reference){
    const error=new Error('BUSINESS_CORE_INVALID_REFERENCE_RESPONSE');
    error.statusCode=503;
    throw error;
  }
  return payload.reference;
}

function shortError(error){
  return String(error?.message||error||'BUSINESS_CORE_SYNC_FAILED').slice(0,500);
}

export async function syncTrackingReference(db,env,{masterTransactionId,jobId,publicReference}){
  const master=String(masterTransactionId||'').trim().toUpperCase();
  const attemptedAt=new Date().toISOString();
  try{
    const reference=await bindTrackingReference(env,{masterTransactionId:master,jobId,publicReference});
    const linkedAt=new Date().toISOString();
    await db.prepare(`UPDATE tracking_jobs
      SET business_core_linked_at=?1,business_core_link_error=NULL,business_core_link_attempt_at=?2
      WHERE id=?3`).bind(linkedAt,attemptedAt,jobId).run();
    return {ok:true,linked:true,linkedAt,reference};
  }catch(error){
    try{
      await db.prepare(`UPDATE tracking_jobs
        SET business_core_link_error=?1,business_core_link_attempt_at=?2
        WHERE id=?3`).bind(shortError(error),attemptedAt,jobId).run();
    }catch(updateError){
      console.error('business core sync marker update failed',String(updateError));
    }
    return {
      ok:false,
      linked:false,
      error:shortError(error),
      status:Number(error?.statusCode)||503
    };
  }
}

export async function syncPendingBusinessCoreReferences(env,limit=25){
  if(!env.TRACKING_DB)return {ok:false,error:'TRACKING_DB_NOT_BOUND',attempted:0,linked:0};
  if(!businessCoreConfigured(env)){
    return {ok:false,error:configState(env)==='incomplete'?'BUSINESS_CORE_CONFIGURATION_INCOMPLETE':'BUSINESS_CORE_NOT_CONFIGURED',attempted:0,linked:0};
  }
  let rows;
  try{
    rows=(await env.TRACKING_DB.prepare(`SELECT id,master_transaction_id,public_reference
      FROM tracking_jobs
      WHERE business_core_linked_at IS NULL
      ORDER BY COALESCE(business_core_link_attempt_at,''),id
      LIMIT ?1`).bind(Math.max(1,Math.min(100,Number(limit)||25))).all()).results||[];
  }catch(error){
    console.error('business core pending-sync scan failed',String(error));
    return {ok:false,error:'BUSINESS_CORE_SYNC_SCHEMA_NOT_READY',attempted:0,linked:0};
  }
  let linked=0;
  for(const row of rows){
    const result=await syncTrackingReference(env.TRACKING_DB,env,{
      masterTransactionId:row.master_transaction_id,
      jobId:row.id,
      publicReference:row.public_reference
    });
    if(result.ok)linked++;
  }
  return {ok:linked===rows.length,attempted:rows.length,linked,pending:rows.length-linked};
}
