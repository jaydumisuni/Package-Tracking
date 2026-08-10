const PREFIX='ttgdoc_';
const TTL_MS=8*60*60*1000;
const TABLE_SQL=`CREATE TABLE IF NOT EXISTS tracking_ops_device_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  permissions_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL
)`;

function bearer(request){
  const raw=String(request.headers.get('authorization')||'').trim();
  if(!raw.toLowerCase().startsWith('bearer '))return '';
  const token=raw.slice(7).trim();
  return token.startsWith(PREFIX)?token:'';
}
function randomToken(){
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  let raw=''; for(const b of bytes)raw+=String.fromCharCode(b);
  return PREFIX+btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function hashToken(token){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function ensureTable(db){await db.prepare(TABLE_SQL).run()}
function safeStoredUser(row){
  let permissions=[]; try{permissions=JSON.parse(String(row.permissions_json||'[]'))}catch{}
  return {id:String(row.user_id||''),email:String(row.email||'').toLowerCase(),displayName:String(row.display_name||'TTG Staff'),role:String(row.role||''),status:'approved',permissions:Array.isArray(permissions)?permissions.map(String):[]};
}
function canUse(user){return user.role==='owner_admin'||user.permissions.includes('pos.jobs.write')||user.permissions.includes('pos.admin')}

export async function issueDeviceSession(env,user){
  if(!env.TRACKING_DB)throw new Error('TRACKING_DB_NOT_BOUND');
  await ensureTable(env.TRACKING_DB);
  const token=randomToken(),tokenHash=await hashToken(token),createdAt=new Date().toISOString(),expiresAt=new Date(Date.now()+TTL_MS).toISOString();
  const permissions=Array.isArray(user.permissions)?user.permissions.map(String):[];
  await env.TRACKING_DB.prepare(`DELETE FROM tracking_ops_device_sessions WHERE expires_at<=?1`).bind(createdAt).run();
  await env.TRACKING_DB.prepare(`INSERT INTO tracking_ops_device_sessions(token_hash,user_id,email,display_name,role,permissions_json,expires_at,created_at,last_used_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8)`).bind(tokenHash,String(user.id||''),String(user.email||'').toLowerCase(),String(user.displayName||user.name||'TTG Staff'),String(user.role||''),JSON.stringify(permissions),expiresAt,createdAt).run();
  return {ok:true,token,expiresAt,user:{...user,permissions}};
}

export async function deviceIdentity(request,env){
  const token=bearer(request); if(!token)return null;
  if(!env.TRACKING_DB)return {ok:false,status:503,error:'TRACKING_DB_NOT_BOUND'};
  try{
    await ensureTable(env.TRACKING_DB);
    const tokenHash=await hashToken(token),now=new Date().toISOString();
    const row=await env.TRACKING_DB.prepare(`SELECT user_id,email,display_name,role,permissions_json,expires_at FROM tracking_ops_device_sessions WHERE token_hash=?1 AND expires_at>?2 LIMIT 1`).bind(tokenHash,now).first();
    if(!row)return {ok:false,status:401,error:'DEVICE_SESSION_INVALID'};
    const user=safeStoredUser(row);
    if(!canUse(user))return {ok:false,status:403,error:'TRACKING_ACCESS_NOT_ALLOWED',user};
    env.TRACKING_DB.prepare(`UPDATE tracking_ops_device_sessions SET last_used_at=?1 WHERE token_hash=?2`).bind(now,tokenHash).run().catch(()=>null);
    return {ok:true,status:200,user,token,device:true,expiresAt:String(row.expires_at||'')};
  }catch(error){console.error('device session validation failed',String(error));return {ok:false,status:503,error:'DEVICE_SESSION_UNAVAILABLE'};}
}

export async function revokeDeviceSession(request,env){
  const token=bearer(request); if(!token)return {ok:false,status:401,error:'DEVICE_SESSION_REQUIRED'};
  if(!env.TRACKING_DB)return {ok:false,status:503,error:'TRACKING_DB_NOT_BOUND'};
  await ensureTable(env.TRACKING_DB);
  const tokenHash=await hashToken(token);
  await env.TRACKING_DB.prepare(`DELETE FROM tracking_ops_device_sessions WHERE token_hash=?1`).bind(tokenHash).run();
  return {ok:true,status:200};
}
