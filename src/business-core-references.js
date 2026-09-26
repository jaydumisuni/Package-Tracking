const OUTBOX_TABLE_SQL=`CREATE TABLE IF NOT EXISTS business_core_reference_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  master_transaction_id TEXT NOT NULL,
  reference_type TEXT NOT NULL DEFAULT 'public_reference',
  reference_value TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT,
  terminal_error INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(reference_type, reference_value)
)`;

const OUTBOX_INDEX_SQL=`CREATE INDEX IF NOT EXISTS idx_business_core_reference_outbox_pending
ON business_core_reference_outbox(synced_at,terminal_error,next_attempt_at,id)`;

function configured(env){
  return Boolean(env.BUSINESS_CORE_URL||env.BUSINESS_CORE_TOKEN);
}

function requireConfig(env){
  if(!env.BUSINESS_CORE_URL||!env.BUSINESS_CORE_TOKEN){
    const error=new Error('BUSINESS_CORE_CONFIGURATION_INCOMPLETE');
    error.statusCode=503;
    throw error;
  }
}

function headers(env){
  return {
    'authorization':`Bearer ${env.BUSINESS_CORE_TOKEN}`,
    'content-type':'application/json'
  };
}

function backoffIso(attempts){
  const seconds=Math.min(3600,15*Math.pow(2,Math.min(Number(attempts)||0,8)));
  return new Date(Date.now()+seconds*1000).toISOString();
}

export async function ensureBusinessCoreReferenceOutbox(db){
  await db.prepare(OUTBOX_TABLE_SQL).run();
  await db.prepare(OUTBOX_INDEX_SQL).run();
}

export async function verifyBusinessCoreMaster(masterTransactionId,env,{fetchImpl=fetch}={}){
  if(!configured(env))return {configured:false,verified:false};
  requireConfig(env);
  const endpoint=new URL(
    '/v1/transactions/'+encodeURIComponent(String(masterTransactionId||'').trim()),
    env.BUSINESS_CORE_URL
  ).toString();

  let response;
  try{
    response=await fetchImpl(endpoint,{method:'GET',headers:headers(env)});
  }catch(error){
    const wrapped=new Error('BUSINESS_CORE_UNAVAILABLE');
    wrapped.statusCode=503;
    wrapped.cause=error;
    throw wrapped;
  }

  let payload=null;
  try{payload=await response.json()}catch{}
  if(response.status===404){
    const error=new Error('BUSINESS_CORE_MASTER_NOT_FOUND');
    error.statusCode=409;
    error.payload=payload;
    throw error;
  }
  if(!response.ok||!payload?.ok||!payload?.transaction?.master_transaction_id){
    const error=new Error('BUSINESS_CORE_MASTER_VERIFY_FAILED');
    error.statusCode=503;
    error.providerStatus=response.status;
    error.payload=payload;
    throw error;
  }
  if(String(payload.transaction.master_transaction_id)!==String(masterTransactionId)){
    const error=new Error('BUSINESS_CORE_MASTER_MISMATCH');
    error.statusCode=409;
    throw error;
  }
  return {configured:true,verified:true,transaction:payload.transaction};
}

export async function enqueueTrackingReferences(
  db,
  masterTransactionId,
  references,
  metadata={}
){
  await ensureBusinessCoreReferenceOutbox(db);
  const values=[...new Set((references||[]).map(value=>String(value||'').trim().toUpperCase()).filter(Boolean))];
  const queued=[];

  for(const referenceValue of values){
    const existing=await db.prepare(`
      SELECT id,master_transaction_id,synced_at,terminal_error
      FROM business_core_reference_outbox
      WHERE reference_type='public_reference' AND reference_value=?1
      LIMIT 1
    `).bind(referenceValue).first();

    if(existing&&String(existing.master_transaction_id)!==String(masterTransactionId)){
      const error=new Error('TRACKING_REFERENCE_ALREADY_QUEUED_FOR_DIFFERENT_MASTER');
      error.statusCode=409;
      error.referenceValue=referenceValue;
      throw error;
    }

    if(!existing){
      await db.prepare(`
        INSERT INTO business_core_reference_outbox(
          master_transaction_id,reference_type,reference_value,metadata_json,
          attempts,next_attempt_at,last_error,terminal_error,synced_at,created_at,updated_at
        ) VALUES(?1,'public_reference',?2,?3,0,?4,NULL,0,NULL,?4,?4)
      `).bind(
        masterTransactionId,
        referenceValue,
        JSON.stringify(metadata||{}),
        new Date().toISOString()
      ).run();
    }
    queued.push(referenceValue);
  }
  return queued;
}

async function bindReference(env,row,{fetchImpl=fetch}={}){
  requireConfig(env);
  const endpoint=new URL(
    '/v1/transactions/'+encodeURIComponent(row.master_transaction_id)+'/references',
    env.BUSINESS_CORE_URL
  ).toString();
  const body={
    domain:'tracking',
    reference_type:row.reference_type,
    reference_value:row.reference_value,
    source_system:'package-tracking',
    metadata:JSON.parse(row.metadata_json||'{}')
  };

  let response;
  try{
    response=await fetchImpl(endpoint,{
      method:'POST',
      headers:headers(env),
      body:JSON.stringify(body)
    });
  }catch(error){
    return {ok:false,retryable:true,status:0,error:String(error)};
  }

  let payload=null;
  try{payload=await response.json()}catch{}
  if(response.ok&&payload?.ok){
    return {ok:true,status:response.status,payload};
  }

  const retryable=response.status===408||response.status===429||response.status>=500||response.status===401||response.status===403;
  return {
    ok:false,
    retryable,
    status:response.status,
    error:payload?.error||payload?.message||'business core reference bind failed',
    payload
  };
}

export async function syncBusinessCoreReferenceOutbox(
  env,
  {limit=50,masterTransactionId=null,fetchImpl=fetch}={}
){
  if(!env.TRACKING_DB)return {configured:configured(env),processed:0,synced:0,pending:0,terminal:0};
  if(!configured(env))return {configured:false,processed:0,synced:0,pending:0,terminal:0};
  requireConfig(env);
  await ensureBusinessCoreReferenceOutbox(env.TRACKING_DB);

  const where=masterTransactionId
    ?"synced_at IS NULL AND terminal_error=0 AND master_transaction_id=?1 AND next_attempt_at<=?2"
    :"synced_at IS NULL AND terminal_error=0 AND next_attempt_at<=?1";
  const now=new Date().toISOString();
  const statement=env.TRACKING_DB.prepare(`
    SELECT id,master_transaction_id,reference_type,reference_value,metadata_json,attempts
    FROM business_core_reference_outbox
    WHERE ${where}
    ORDER BY id
    LIMIT ${Math.max(1,Math.min(Number(limit)||50,200))}
  `);
  const rows=masterTransactionId
    ?(await statement.bind(masterTransactionId,now).all()).results||[]
    :(await statement.bind(now).all()).results||[];

  let synced=0,terminal=0;
  for(const row of rows){
    const result=await bindReference(env,row,{fetchImpl});
    const attemptedAt=new Date().toISOString();
    if(result.ok){
      await env.TRACKING_DB.prepare(`
        UPDATE business_core_reference_outbox
        SET attempts=attempts+1,last_error=NULL,terminal_error=0,
            synced_at=?1,updated_at=?1
        WHERE id=?2 AND synced_at IS NULL
      `).bind(attemptedAt,row.id).run();
      synced+=1;
      continue;
    }

    const message=String(result.error||'business core reference bind failed').slice(0,1000);
    if(!result.retryable){
      await env.TRACKING_DB.prepare(`
        UPDATE business_core_reference_outbox
        SET attempts=attempts+1,last_error=?1,terminal_error=1,updated_at=?2
        WHERE id=?3 AND synced_at IS NULL
      `).bind(message,attemptedAt,row.id).run();
      terminal+=1;
      continue;
    }

    await env.TRACKING_DB.prepare(`
      UPDATE business_core_reference_outbox
      SET attempts=attempts+1,last_error=?1,next_attempt_at=?2,updated_at=?3
      WHERE id=?4 AND synced_at IS NULL
    `).bind(message,backoffIso(Number(row.attempts)+1),attemptedAt,row.id).run();
  }

  const pendingRow=masterTransactionId
    ?await env.TRACKING_DB.prepare(`
       SELECT COUNT(*) AS count FROM business_core_reference_outbox
       WHERE master_transaction_id=?1 AND synced_at IS NULL AND terminal_error=0
     `).bind(masterTransactionId).first()
    :await env.TRACKING_DB.prepare(`
       SELECT COUNT(*) AS count FROM business_core_reference_outbox
       WHERE synced_at IS NULL AND terminal_error=0
     `).first();
  const terminalRow=masterTransactionId
    ?await env.TRACKING_DB.prepare(`
       SELECT COUNT(*) AS count FROM business_core_reference_outbox
       WHERE master_transaction_id=?1 AND synced_at IS NULL AND terminal_error=1
     `).bind(masterTransactionId).first()
    :await env.TRACKING_DB.prepare(`
       SELECT COUNT(*) AS count FROM business_core_reference_outbox
       WHERE synced_at IS NULL AND terminal_error=1
     `).first();

  return {
    configured:true,
    processed:rows.length,
    synced,
    pending:Number(pendingRow?.count||0),
    terminal:Number(terminalRow?.count||0)
  };
}

export function businessCoreReferenceConfigured(env){
  return configured(env);
}

export const BUSINESS_CORE_REFERENCE_OUTBOX_SQL=OUTBOX_TABLE_SQL;
export const BUSINESS_CORE_REFERENCE_OUTBOX_INDEX_SQL=OUTBOX_INDEX_SQL;
