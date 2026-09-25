const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const J=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:H});

export const SEQUENCE_TABLE_SQL=`CREATE TABLE IF NOT EXISTS tracking_sequences (
  name TEXT PRIMARY KEY,
  current_value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const NUMERIC_SUFFIX_SQL=`CASE
  WHEN substr(master_transaction_id,1,8)='TTG-TXN-'
   AND length(substr(master_transaction_id,9))>0
   AND substr(master_transaction_id,9) NOT GLOB '*[^0-9]*'
  THEN CAST(substr(master_transaction_id,9) AS INTEGER)
  ELSE NULL
END`;

export const RESERVE_SQL=`INSERT INTO tracking_sequences(name,current_value,updated_at)
SELECT 'transaction', COALESCE(MAX(${NUMERIC_SUFFIX_SQL}),0)+1, ?
FROM tracking_jobs
WHERE true
ON CONFLICT(name) DO UPDATE SET
  current_value=MAX(
    tracking_sequences.current_value+1,
    (SELECT COALESCE(MAX(${NUMERIC_SUFFIX_SQL}),0)+1 FROM tracking_jobs)
  ),
  updated_at=excluded.updated_at
RETURNING current_value AS reserved`;

function isAdmin(request,env){
  return Boolean(env.ADMIN_TOKEN)&&(request.headers.get('authorization')||'')===`Bearer ${env.ADMIN_TOKEN}`;
}

export function formatMasterTransactionId(value){
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<1)throw new Error('INVALID_TRANSACTION_SEQUENCE');
  return `TTG-TXN-${String(n).padStart(6,'0')}`;
}

export async function reserveMasterTransaction(db,now=new Date().toISOString()){
  await db.prepare(SEQUENCE_TABLE_SQL).run();
  const row=await db.prepare(RESERVE_SQL).bind(now).first();
  if(!row?.reserved)throw new Error('TRANSACTION_RESERVATION_FAILED');
  return {sequence:Number(row.reserved),masterTransactionId:formatMasterTransactionId(row.reserved)};
}

function businessCoreConfigured(env){
  return Boolean(env.BUSINESS_CORE_URL||env.BUSINESS_CORE_TOKEN);
}

async function reserveFromBusinessCore(request,env){
  if(!env.BUSINESS_CORE_URL||!env.BUSINESS_CORE_TOKEN){
    throw new Error('BUSINESS_CORE_CONFIGURATION_INCOMPLETE');
  }

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
  if(!response.ok||!payload?.ok||!payload?.masterTransactionId){
    const error=new Error('BUSINESS_CORE_RESERVATION_FAILED');
    error.status=response.status;
    error.payload=payload;
    throw error;
  }

  return {
    sequence:Number(payload.sequence),
    masterTransactionId:String(payload.masterTransactionId),
    reserved:Boolean(payload.reserved),
    authority:'business-core'
  };
}

export async function handleTransactionReserve(request,env){
  const url=new URL(request.url);
  if(url.pathname!=='/api/admin/transactions/reserve'||request.method!=='POST')return null;
  if(!isAdmin(request,env))return J({ok:false,error:'unauthorized'},401);

  if(businessCoreConfigured(env)){
    try{
      const reservation=await reserveFromBusinessCore(request,env);
      return J({ok:true,...reservation});
    }catch(error){
      console.error('business core transaction reservation failed',String(error));
      return J({ok:false,error:'business core transaction reservation failed',authority:'business-core'},503);
    }
  }

  if(!env.TRACKING_DB)return J({ok:false,error:'TRACKING_DB is not bound'},503);
  try{
    const reservation=await reserveMasterTransaction(env.TRACKING_DB);
    return J({ok:true,...reservation,reserved:true,authority:'legacy-d1'});
  }catch(error){
    console.error('transaction reservation failed',String(error));
    return J({ok:false,error:'transaction reservation failed'},503);
  }
}
