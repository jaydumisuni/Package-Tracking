import {requireOpsAccess} from './ops-auth.js';

const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const J=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:H});

const REQUIRED=['tracking_jobs','tracking_aliases','tracking_updates','carrier_shipments','handover_tokens','client_job_links','tracking_staff_audit'];

const SCHEMA=[
`CREATE TABLE IF NOT EXISTS tracking_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  master_transaction_id TEXT NOT NULL UNIQUE,
  public_reference TEXT,
  client_name TEXT,
  item_name TEXT,
  item_condition TEXT,
  service_type TEXT,
  route TEXT,
  origin_country TEXT,
  destination_country TEXT DEFAULT 'Zambia',
  amount_received REAL DEFAULT 0,
  currency TEXT DEFAULT 'ZMW',
  payment_method TEXT,
  order_payment_status TEXT DEFAULT '',
  shipping_cost_status TEXT DEFAULT '',
  shipping_cost_amount REAL,
  shipping_cost_currency TEXT DEFAULT 'ZMW',
  current_stage TEXT NOT NULL DEFAULT 'intake_received',
  status_note TEXT,
  current_location TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
`CREATE TABLE IF NOT EXISTS tracking_aliases (alias TEXT PRIMARY KEY,job_id INTEGER NOT NULL,FOREIGN KEY(job_id) REFERENCES tracking_jobs(id) ON DELETE CASCADE)`,
`CREATE INDEX IF NOT EXISTS idx_tracking_alias_job ON tracking_aliases(job_id)`,
`CREATE INDEX IF NOT EXISTS idx_tracking_jobs_stage ON tracking_jobs(current_stage)`,
`CREATE TABLE IF NOT EXISTS tracking_updates (id INTEGER PRIMARY KEY AUTOINCREMENT,job_id INTEGER NOT NULL,stage TEXT,note TEXT NOT NULL,location TEXT,source TEXT DEFAULT 'TTG update',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(job_id) REFERENCES tracking_jobs(id) ON DELETE CASCADE)`,
`CREATE INDEX IF NOT EXISTS idx_tracking_updates_job_created ON tracking_updates(job_id, created_at DESC)`,
`CREATE TABLE IF NOT EXISTS carrier_shipments (id INTEGER PRIMARY KEY AUTOINCREMENT,job_id INTEGER NOT NULL,leg_type TEXT NOT NULL DEFAULT 'seller_to_forwarder',carrier TEXT NOT NULL,tracking_number TEXT NOT NULL,provider TEXT NOT NULL,last_status TEXT,last_event_code TEXT,last_event_at TEXT,last_checked_at TEXT,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(job_id) REFERENCES tracking_jobs(id) ON DELETE CASCADE,UNIQUE(carrier, tracking_number, leg_type))`,
`CREATE INDEX IF NOT EXISTS idx_carrier_shipments_active ON carrier_shipments(active, last_checked_at)`,
`CREATE TABLE IF NOT EXISTS handover_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT,job_id INTEGER NOT NULL,token_hash TEXT NOT NULL UNIQUE,handover_method TEXT NOT NULL DEFAULT 'customer_link',expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(job_id) REFERENCES tracking_jobs(id) ON DELETE CASCADE)`,
`CREATE INDEX IF NOT EXISTS idx_handover_tokens_job ON handover_tokens(job_id)`,
`CREATE INDEX IF NOT EXISTS idx_handover_tokens_expiry ON handover_tokens(expires_at, used_at)`,
`CREATE TABLE IF NOT EXISTS client_job_links (phone_normalized TEXT NOT NULL,job_id INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY (phone_normalized, job_id),FOREIGN KEY(job_id) REFERENCES tracking_jobs(id) ON DELETE CASCADE)`,
`CREATE INDEX IF NOT EXISTS idx_client_job_links_phone ON client_job_links(phone_normalized)`,
`CREATE INDEX IF NOT EXISTS idx_client_job_links_job ON client_job_links(job_id)`,
`CREATE TABLE IF NOT EXISTS tracking_staff_audit (id INTEGER PRIMARY KEY AUTOINCREMENT,actor_user_id TEXT NOT NULL,actor_email TEXT NOT NULL,actor_role TEXT NOT NULL,action TEXT NOT NULL,reference TEXT,summary TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
`CREATE INDEX IF NOT EXISTS idx_tracking_staff_audit_created ON tracking_staff_audit(created_at DESC)`,
`CREATE INDEX IF NOT EXISTS idx_tracking_staff_audit_reference ON tracking_staff_audit(reference, created_at DESC)`,
`CREATE TABLE IF NOT EXISTS tracking_sequences (name TEXT PRIMARY KEY,current_value INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`
];

export async function verifyTrackingSchema(db){
  const rows=(await db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all()).results||[];
  const names=new Set(rows.map(r=>r.name));
  const tables=Object.fromEntries(REQUIRED.map(name=>[name,names.has(name)]));
  const missing=REQUIRED.filter(name=>!names.has(name));
  return {ready:missing.length===0,tables,missing};
}

export async function handleD1Bootstrap(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/api/d1/status'&&request.method==='GET'){
    if(!env.TRACKING_DB)return J({ok:true,bound:false,ready:false,missing:REQUIRED});
    try{return J({ok:true,bound:true,...await verifyTrackingSchema(env.TRACKING_DB)})}
    catch(error){console.error('D1 status failed',String(error));return J({ok:false,bound:true,ready:false,error:'D1 status check failed'},503)}
  }
  if(url.pathname==='/api/admin/d1/bootstrap'&&request.method==='POST'){
    const auth=await requireOpsAccess(request,env,{ownerOnly:true});
    if(!auth.ok)return J({ok:false,error:auth.error},auth.status);
    if(!env.TRACKING_DB)return J({ok:false,error:'TRACKING_DB is not bound'},503);
    try{
      for(const sql of SCHEMA)await env.TRACKING_DB.prepare(sql).run();
      const result=await verifyTrackingSchema(env.TRACKING_DB);
      if(result.ready){await env.TRACKING_DB.prepare(`INSERT INTO tracking_staff_audit(actor_user_id,actor_email,actor_role,action,reference,summary,created_at) VALUES(?1,?2,?3,'system.schema.bootstrap','','Tracking schema initialized / verified',?4)`).bind(auth.user.id||'',auth.user.email||'',auth.user.role||'',new Date().toISOString()).run()}
      return J({ok:true,bound:true,...result});
    }catch(error){console.error('D1 bootstrap failed',String(error));return J({ok:false,error:'D1 bootstrap failed'},503)}
  }
  return null;
}
