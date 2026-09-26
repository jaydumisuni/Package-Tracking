const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const J=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:H});

function isAdmin(request,env){
  return Boolean(env.ADMIN_TOKEN)&&(request.headers.get('authorization')||'')===`Bearer ${env.ADMIN_TOKEN}`;
}

export function businessCoreConfigurationState(env){
  const hasUrl=Boolean(String(env.BUSINESS_CORE_URL||'').trim());
  const hasToken=Boolean(String(env.BUSINESS_CORE_TOKEN||'').trim());
  if(hasUrl&&hasToken)return 'ready';
  if(!hasUrl&&!hasToken)return 'missing';
  return 'partial';
}

function configurationError(state){
  const error=new Error(
    state==='partial'
      ? 'BUSINESS_CORE_CONFIGURATION_INCOMPLETE'
      : 'BUSINESS_CORE_REQUIRED'
  );
  error.code=error.message;
  error.status=503;
  return error;
}

export async function reserveFromBusinessCore(request,env){
  const state=businessCoreConfigurationState(env);
  if(state!=='ready')throw configurationError(state);

  const idempotencyKey=(request.headers.get('x-idempotency-key')||crypto.randomUUID()).trim();
  const endpoint=new URL('/v1/transactions/reserve',env.BUSINESS_CORE_URL).toString();
  const response=await fetch(endpoint,{
    method:'POST',
    headers:{
      'authorization':`Bearer ${env.BUSINESS_CORE_TOKEN}`,
      'content-type':'application/json',
      'x-idempotency-key':idempotencyKey
    },
    body:JSON.stringify({
      source_system:'package-tracking',
      source_reference:`tracking-reserve:${idempotencyKey}`,
      idempotency_key:`package-tracking:${idempotencyKey}`
    })
  });

  let payload=null;
  try{payload=await response.json()}catch{}
  const masterTransactionId=String(payload?.masterTransactionId||'');
  const sequence=Number(payload?.sequence);
  const reserved=payload?.reserved;
  const validMaster=/^TTG-TXN-\d{6,}$/.test(masterTransactionId);
  if(
    !response.ok||
    !payload?.ok||
    typeof reserved!=='boolean'||
    !Number.isSafeInteger(sequence)||
    sequence<1||
    !validMaster
  ){
    const error=new Error('BUSINESS_CORE_RESERVATION_FAILED');
    error.code='BUSINESS_CORE_RESERVATION_FAILED';
    error.status=response.status;
    error.payload=payload;
    throw error;
  }

  return {
    sequence,
    masterTransactionId,
    reserved,
    authority:'business-core'
  };
}

export async function handleTransactionReserve(request,env){
  const url=new URL(request.url);
  if(url.pathname!=='/api/admin/transactions/reserve'||request.method!=='POST')return null;
  if(!isAdmin(request,env))return J({ok:false,error:'unauthorized'},401);

  const state=businessCoreConfigurationState(env);
  if(state!=='ready'){
    const error=configurationError(state);
    return J({ok:false,error:error.code,authority:'business-core'},503);
  }

  try{
    const reservation=await reserveFromBusinessCore(request,env);
    return J({ok:true,...reservation});
  }catch(error){
    console.error('business core transaction reservation failed',String(error));
    return J({
      ok:false,
      error:error?.code||'BUSINESS_CORE_RESERVATION_FAILED',
      authority:'business-core'
    },503);
  }
}
