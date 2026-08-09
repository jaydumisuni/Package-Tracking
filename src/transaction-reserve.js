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

export async function handleTransactionReserve(request,env){
  const url=new URL(request.url);
  if(url.pathname!=='/api/admin/transactions/reserve'||request.method!=='POST')return null;
  if(!isAdmin(request,env))return J({ok:false,error:'unauthorized'},401);
  if(!env.TRACKING_DB)return J({ok:false,error:'TRACKING_DB is not bound'},503);
  try{
    const reservation=await reserveMasterTransaction(env.TRACKING_DB);
    return J({ok:true,...reservation,reserved:true});
  }catch(error){
    console.error('transaction reservation failed',String(error));
    return J({ok:false,error:'transaction reservation failed'},503);
  }
}
