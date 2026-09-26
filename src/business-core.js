const N=value=>String(value||"").trim().toUpperCase();

export function businessCoreState(env={}){
  const required=/^(1|true|yes|on)$/i.test(String(env.BUSINESS_CORE_REQUIRED||"").trim());
  const hasUrl=Boolean(String(env.BUSINESS_CORE_URL||"").trim());
  const hasToken=Boolean(String(env.BUSINESS_CORE_TOKEN||"").trim());
  const configured=hasUrl&&hasToken;
  const mentioned=required||hasUrl||hasToken;
  const active=required||configured;
  return {
    required,
    hasUrl,
    hasToken,
    mentioned,
    configured,
    active,
    staged:mentioned&&!active,
    incomplete:required&&!configured
  };
}

export function businessCoreAuthorityActive(env={}){
  return businessCoreState(env).active;
}

function requireBusinessCore(env){
  const state=businessCoreState(env);
  if(!state.configured){
    const error=new Error("BUSINESS_CORE_CONFIGURATION_INCOMPLETE");
    error.status=503;
    error.code="BUSINESS_CORE_CONFIGURATION_INCOMPLETE";
    throw error;
  }
  return state;
}

async function callBusinessCore(env,path,{method="GET",body}={}){
  requireBusinessCore(env);
  const endpoint=new URL(path,env.BUSINESS_CORE_URL).toString();
  const headers={
    authorization:`Bearer ${env.BUSINESS_CORE_TOKEN}`,
    accept:"application/json"
  };
  const init={method,headers};
  if(body!==undefined){
    headers["content-type"]="application/json";
    init.body=JSON.stringify(body);
  }

  let response;
  try{
    response=await fetch(endpoint,init);
  }catch(cause){
    const error=new Error("BUSINESS_CORE_UNAVAILABLE");
    error.status=503;
    error.code="BUSINESS_CORE_UNAVAILABLE";
    error.cause=cause;
    throw error;
  }

  const payload=await response.json().catch(()=>null);
  if(!response.ok||!payload?.ok){
    const error=new Error(payload?.error||"BUSINESS_CORE_REQUEST_FAILED");
    error.status=response.status||503;
    error.code=payload?.error||"BUSINESS_CORE_REQUEST_FAILED";
    error.payload=payload;
    throw error;
  }
  return payload;
}

export async function reserveFromBusinessCore(request,env){
  const idempotencyKey=(request.headers.get("x-idempotency-key")||crypto.randomUUID()).trim();
  const payload=await callBusinessCore(env,"/v1/transactions/reserve",{
    method:"POST",
    body:{
      source_system:"package-tracking",
      source_reference:`tracking-reserve:${idempotencyKey}`,
      idempotency_key:`package-tracking:${idempotencyKey}`
    }
  });

  if(!payload?.masterTransactionId){
    const error=new Error("BUSINESS_CORE_RESERVATION_INVALID_RESPONSE");
    error.status=502;
    error.code="BUSINESS_CORE_RESERVATION_INVALID_RESPONSE";
    throw error;
  }

  return {
    sequence:Number(payload.sequence),
    masterTransactionId:N(payload.masterTransactionId),
    reserved:Boolean(payload.reserved),
    authority:"business-core"
  };
}

export async function verifyMasterTransaction(env,masterTransactionId){
  const master=N(masterTransactionId);
  if(!/^TTG-TXN-[0-9]{6,}$/.test(master)){
    const error=new Error("INVALID_MASTER_TRANSACTION_ID");
    error.status=400;
    error.code="INVALID_MASTER_TRANSACTION_ID";
    throw error;
  }
  const payload=await callBusinessCore(
    env,
    "/v1/transactions/"+encodeURIComponent(master)
  );
  const returned=N(payload?.transaction?.master_transaction_id);
  if(returned!==master){
    const error=new Error("BUSINESS_CORE_MASTER_MISMATCH");
    error.status=409;
    error.code="BUSINESS_CORE_MASTER_MISMATCH";
    throw error;
  }
  return payload.transaction;
}

export function trackingReferences(masterTransactionId,{publicReference,aliases=[]}={}){
  const master=N(masterTransactionId);
  const publicRef=N(publicReference);
  const result=[];
  const seen=new Set();

  const add=(reference_type,reference_value)=>{
    const value=N(reference_value);
    if(!value||value===master)return;
    const key=reference_type+":"+value;
    if(seen.has(key))return;
    seen.add(key);
    result.push({reference_type,reference_value:value});
  };

  if(publicRef&&publicRef!==master)add("public_reference",publicRef);
  for(const alias of aliases||[]){
    const value=N(alias);
    if(value===publicRef)continue;
    add("alias",value);
  }
  return result;
}

export async function resolveTrackingReference(env,reference){
  const params=new URLSearchParams({
    domain:"tracking",
    reference_type:reference.reference_type,
    reference_value:reference.reference_value
  });
  try{
    const payload=await callBusinessCore(env,"/v1/references/resolve?"+params.toString());
    return payload.reference||null;
  }catch(error){
    if(error.status===404)return null;
    throw error;
  }
}

export async function preflightTrackingAuthority(
  env,
  masterTransactionId,
  {publicReference,aliases=[]}={}
){
  if(!businessCoreAuthorityActive(env))return {active:false,masterTransactionId:N(masterTransactionId),references:[]};
  requireBusinessCore(env);

  const master=N(masterTransactionId);
  await verifyMasterTransaction(env,master);
  const references=trackingReferences(master,{publicReference,aliases});

  for(const reference of references){
    const existing=await resolveTrackingReference(env,reference);
    if(existing&&N(existing.master_transaction_id)!==master){
      const error=new Error("BUSINESS_CORE_REFERENCE_COLLISION");
      error.status=409;
      error.code="BUSINESS_CORE_REFERENCE_COLLISION";
      error.reference=reference;
      error.existing=existing;
      throw error;
    }
  }

  return {active:true,masterTransactionId:master,references};
}

async function bindTrackingReference(env,master,reference,metadata={}){
  return callBusinessCore(
    env,
    "/v1/transactions/"+encodeURIComponent(master)+"/references",
    {
      method:"POST",
      body:{
        domain:"tracking",
        reference_type:reference.reference_type,
        reference_value:reference.reference_value,
        source_system:"package-tracking",
        metadata
      }
    }
  );
}

export async function registerTrackingReferences(
  env,
  masterTransactionId,
  {jobId,publicReference,aliases=[]}={}
){
  if(!businessCoreAuthorityActive(env))return {active:false,bound:[]};
  requireBusinessCore(env);

  const master=N(masterTransactionId);
  const refs=trackingReferences(master,{publicReference,aliases});
  if(jobId!==undefined&&jobId!==null&&String(jobId).trim()){
    refs.unshift({
      reference_type:"d1_job_id",
      reference_value:String(jobId).trim()
    });
  }

  const bound=[];
  for(const reference of refs){
    const payload=await bindTrackingReference(env,master,reference,{
      store:"package-tracking-d1"
    });
    bound.push(payload.reference);
  }
  return {active:true,bound};
}

export function businessCoreErrorResponse(error,{d1Committed=false}={}){
  const status=Number(error?.status)||503;
  return {
    status,
    body:{
      ok:false,
      error:error?.code||error?.message||"BUSINESS_CORE_REQUEST_FAILED",
      authority:"business-core",
      d1Committed:Boolean(d1Committed),
      retryable:status>=500
    }
  };
}
