const MASTER_RE=/^TTG-TXN-\d{6,}$/;

function configError(){
  const error=new Error('BUSINESS_CORE_CONFIGURATION_REQUIRED');
  error.status=503;
  return error;
}

export function businessCoreConfigured(env){
  return Boolean(env.BUSINESS_CORE_URL&&env.BUSINESS_CORE_TOKEN);
}

export function businessCoreConfigurationPresent(env){
  return Boolean(env.BUSINESS_CORE_URL||env.BUSINESS_CORE_TOKEN);
}

function requireConfig(env){
  if(!businessCoreConfigured(env))throw configError();
}

async function requestBusinessCore(env,path,{method='GET',body}={}){
  requireConfig(env);
  const endpoint=new URL(path,env.BUSINESS_CORE_URL).toString();
  const response=await fetch(endpoint,{
    method,
    headers:{
      authorization:`Bearer ${env.BUSINESS_CORE_TOKEN}`,
      ...(body===undefined?{}:{'content-type':'application/json'})
    },
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });

  let payload=null;
  try{payload=await response.json()}catch{}
  return {response,payload,endpoint};
}

function upstreamError(code,result){
  const error=new Error(code);
  error.status=result.response?.status||503;
  error.payload=result.payload||null;
  return error;
}

export async function reserveFromBusinessCore(request,env){
  requireConfig(env);
  const idempotencyKey=(request.headers.get('x-idempotency-key')||crypto.randomUUID()).trim();
  const result=await requestBusinessCore(env,'/v1/transactions/reserve',{
    method:'POST',
    body:{
      source_system:'package-tracking',
      source_reference:`tracking-reserve:${idempotencyKey}`,
      idempotency_key:`package-tracking:${idempotencyKey}`
    }
  });
  const payload=result.payload;
  if(!result.response.ok||!payload?.ok||!payload?.masterTransactionId){
    throw upstreamError('BUSINESS_CORE_RESERVATION_FAILED',result);
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
    error.status=400;
    throw error;
  }
  const result=await requestBusinessCore(env,`/v1/transactions/${encodeURIComponent(master)}`);
  if(result.response.status===404){
    const error=new Error('MASTER_TRANSACTION_NOT_FOUND');
    error.status=404;
    throw error;
  }
  if(!result.response.ok||!result.payload?.ok||!result.payload?.transaction){
    throw upstreamError('BUSINESS_CORE_TRANSACTION_VERIFY_FAILED',result);
  }
  return result.payload.transaction;
}

export async function bindBusinessCoreReference(env,masterTransactionId,{
  referenceType,
  referenceValue,
  metadata={}
}){
  const master=String(masterTransactionId||'').trim().toUpperCase();
  if(!MASTER_RE.test(master)){
    const error=new Error('INVALID_MASTER_TRANSACTION_ID');
    error.status=400;
    throw error;
  }
  const value=String(referenceValue??'').trim();
  if(!value){
    const error=new Error('BUSINESS_CORE_REFERENCE_VALUE_REQUIRED');
    error.status=400;
    throw error;
  }
  const result=await requestBusinessCore(
    env,
    `/v1/transactions/${encodeURIComponent(master)}/references`,
    {
      method:'POST',
      body:{
        domain:'tracking',
        reference_type:String(referenceType||'').trim().toLowerCase(),
        reference_value:value,
        source_system:'package-tracking',
        metadata
      }
    }
  );
  if(!result.response.ok||!result.payload?.ok||!result.payload?.reference){
    throw upstreamError('BUSINESS_CORE_REFERENCE_BIND_FAILED',result);
  }
  return result.payload.reference;
}

export async function bindTrackingReferences(env,{
  masterTransactionId,
  jobId,
  publicReference
}){
  const bound=[];
  bound.push(await bindBusinessCoreReference(env,masterTransactionId,{
    referenceType:'job_id',
    referenceValue:String(jobId),
    metadata:{authority:'package-tracking-d1'}
  }));

  const publicRef=String(publicReference||'').trim().toUpperCase();
  if(publicRef&&publicRef!==String(masterTransactionId||'').trim().toUpperCase()){
    bound.push(await bindBusinessCoreReference(env,masterTransactionId,{
      referenceType:'public_reference',
      referenceValue:publicRef,
      metadata:{authority:'package-tracking-d1'}
    }));
  }
  return bound;
}
