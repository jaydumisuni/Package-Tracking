const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const J=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:H});
const DEFAULT_SHEET_ID="1KD4lu32bMWNlyKWohbNDQPivDEvVN-7_VcWq0Lj1OO4";
const DEFAULT_SHEET_RANGE="Handover Register!A:L";
const CONFIRMATION_VERSION="handover-v1";
const READY_STAGES=new Set(["ready_for_collection","completed"]);
const N=value=>String(value||"").trim().toUpperCase();
const now=()=>new Date().toISOString();

function b64url(bytes){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
function b64urlText(value){return b64url(new TextEncoder().encode(value))}
async function sha256Hex(value){const d=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(value||""))));return[...d].map(x=>x.toString(16).padStart(2,"0")).join("")}
function randomToken(){const b=new Uint8Array(32);crypto.getRandomValues(b);return b64url(b)}
function methodLabel(value){return value==="in_store"?"In store":"Customer link"}

async function isAdmin(request,env){return Boolean(env.ADMIN_TOKEN)&&(request.headers.get("authorization")||"")===`Bearer ${env.ADMIN_TOKEN}`}
async function resolveJobId(db,reference){const row=await db.prepare(`SELECT DISTINCT j.id AS job_id FROM tracking_jobs j LEFT JOIN tracking_aliases a ON a.job_id=j.id WHERE a.alias=?1 OR j.master_transaction_id=?1 OR j.public_reference=?1 LIMIT 1`).bind(N(reference)).first();return row?.job_id||null}

async function createLink(request,env){
  if(!await isAdmin(request,env))return J({ok:false,error:"unauthorized"},401);
  if(!env.TRACKING_DB)return J({ok:false,error:"TRACKING_DB is not bound"},503);
  const body=await request.json().catch(()=>({}));
  const reference=N(body.reference);
  if(!reference)return J({ok:false,error:"reference required"},400);
  const jobId=await resolveJobId(env.TRACKING_DB,reference);
  if(!jobId)return J({ok:false,error:"tracking job not found"},404);
  const job=await env.TRACKING_DB.prepare(`SELECT id,current_stage FROM tracking_jobs WHERE id=?1 LIMIT 1`).bind(jobId).first();
  if(!job)return J({ok:false,error:"tracking job not found"},404);
  if(!READY_STAGES.has(job.current_stage))return J({ok:false,error:"handover is only available when the job is ready for collection or completed",currentStage:job.current_stage},409);
  const method=body.method==="in_store"?"in_store":"customer_link";
  const hours=Math.min(168,Math.max(1,Number(body.expiresHours||72)));
  const expiresAt=new Date(Date.now()+hours*3600000).toISOString();
  const raw=randomToken();
  const hash=await sha256Hex(raw);
  await env.TRACKING_DB.prepare(`INSERT INTO handover_tokens(job_id,token_hash,handover_method,expires_at,created_at) VALUES(?1,?2,?3,?4,?5)`).bind(jobId,hash,method,expiresAt,now()).run();
  const origin=new URL(request.url).origin;
  return J({ok:true,reference,method,expiresAt,url:`${origin}/handover.html?t=${encodeURIComponent(raw)}`,token:raw});
}

async function recordForToken(db,raw){
  if(!raw||raw.length<20)return null;
  const hash=await sha256Hex(raw);
  const row=await db.prepare(`SELECT h.id AS token_id,h.handover_method,h.expires_at,h.used_at,j.id AS job_id,j.master_transaction_id,j.public_reference,j.client_name,j.item_name,j.item_condition,j.service_type,j.amount_received,j.currency,j.current_stage,j.status_note,j.current_location FROM handover_tokens h JOIN tracking_jobs j ON j.id=h.job_id WHERE h.token_hash=?1 LIMIT 1`).bind(hash).first();
  if(!row)return null;
  if(row.used_at)return{...row,invalidReason:"used"};
  if(Date.parse(row.expires_at)<=Date.now())return{...row,invalidReason:"expired"};
  return row;
}

function publicView(row){return{ok:true,masterId:row.master_transaction_id,publicReference:row.public_reference||row.master_transaction_id,clientName:row.client_name||"",itemName:row.item_name||"",condition:row.item_condition||"",serviceType:row.service_type||"",amountPaid:row.amount_received?`${row.currency||"ZMW"} ${Number(row.amount_received).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`:"",stage:row.current_stage,statusNote:row.status_note||"",location:row.current_location||"",handoverMethod:row.handover_method,expiresAt:row.expires_at}}

function pemBytes(pem){const clean=String(pem||"").replace(/-----BEGIN PRIVATE KEY-----/g,"").replace(/-----END PRIVATE KEY-----/g,"").replace(/\\n/g,"\n").replace(/\s+/g,"");const binary=atob(clean);const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes}
async function googleToken(env){
  if(!env.GOOGLE_SERVICE_ACCOUNT_EMAIL||!env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)throw new Error("Google Sheets archive credentials are not configured");
  const t=Math.floor(Date.now()/1000),head=b64urlText(JSON.stringify({alg:"RS256",typ:"JWT"})),payload=b64urlText(JSON.stringify({iss:env.GOOGLE_SERVICE_ACCOUNT_EMAIL,scope:"https://www.googleapis.com/auth/spreadsheets",aud:"https://oauth2.googleapis.com/token",iat:t,exp:t+3600})),input=`${head}.${payload}`;
  const key=await crypto.subtle.importKey("pkcs8",pemBytes(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
  const sig=new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(input)));
  const assertion=`${input}.${b64url(sig)}`;
  const res=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion})});
  if(!res.ok)throw new Error(`Google OAuth failed (${res.status})`);
  const data=await res.json();if(!data.access_token)throw new Error("Google OAuth returned no access token");return data.access_token;
}

async function sheetHasMaster(env,accessToken,masterId){const id=env.HANDOVER_SHEET_ID||DEFAULT_SHEET_ID,range="Handover Register!A:A",url=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}`;const res=await fetch(url,{headers:{authorization:`Bearer ${accessToken}`}});if(!res.ok)throw new Error(`Google Sheets lookup failed (${res.status})`);const data=await res.json();return(data.values||[]).some(row=>String(row?.[0]||"").trim()===masterId)}
async function archiveRow(env,row){const access=await googleToken(env);if(await sheetHasMaster(env,access,row[0]))return{ok:true,alreadyArchived:true};const id=env.HANDOVER_SHEET_ID||DEFAULT_SHEET_ID,range=env.HANDOVER_SHEET_RANGE||DEFAULT_SHEET_RANGE,url=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;const res=await fetch(url,{method:"POST",headers:{authorization:`Bearer ${access}`,"content-type":"application/json"},body:JSON.stringify({values:[row]})});if(!res.ok)throw new Error(`Google Sheets append failed (${res.status})`);return{ok:true,alreadyArchived:false}}

async function confirm(request,env){
  if(!env.TRACKING_DB)return J({ok:false,error:"tracking database unavailable"},503);
  const body=await request.json().catch(()=>({})),raw=String(body.token||"").trim(),signedName=String(body.signedName||"").trim(),signature=String(body.signature||"");
  if(!raw)return J({ok:false,error:"handover token required"},400);
  if(signedName.length<2)return J({ok:false,error:"signed name required"},400);
  if(signature.length<40||signature.length>200000)return J({ok:false,error:"signature required"},400);
  if(body.accepted!==true)return J({ok:false,error:"handover confirmation must be accepted"},400);
  const record=await recordForToken(env.TRACKING_DB,raw);
  if(!record)return J({ok:false,error:"handover link not found"},404);
  if(record.invalidReason==="expired")return J({ok:false,error:"handover link expired"},410);
  if(record.invalidReason==="used")return J({ok:false,error:"handover link already used"},410);
  if(!READY_STAGES.has(record.current_stage))return J({ok:false,error:"job is not ready for handover"},409);
  const handoverAt=now(),signatureHash=await sha256Hex(signature),amountPaid=record.amount_received?`${record.currency||"ZMW"} ${Number(record.amount_received).toFixed(2)}`:"";
  const row=[record.master_transaction_id,record.public_reference||record.master_transaction_id,record.client_name||"",record.item_name||"",record.service_type||"",amountPaid,handoverAt,methodLabel(record.handover_method),signedName,signatureHash,CONFIRMATION_VERSION,record.handover_method==="in_store"?"TTG Tracking / in store":"TTG Tracking / customer link"];
  try{await archiveRow(env,row)}catch(error){console.error("handover archive failed",String(error));return J({ok:false,error:"handover was not closed because the permanent archive could not be saved",retryable:true},503)}
  await env.TRACKING_DB.prepare(`DELETE FROM tracking_jobs WHERE id=?1`).bind(record.job_id).run();
  return J({ok:true,closed:true,masterId:record.master_transaction_id,handoverAt,clientName:record.client_name||"",itemName:record.item_name||""});
}

export async function handleHandoverRequest(request,env){
  const url=new URL(request.url);
  if(url.pathname==="/api/handover"&&request.method==="GET"){
    if(!env.TRACKING_DB)return J({ok:false,error:"tracking database unavailable"},503);
    const record=await recordForToken(env.TRACKING_DB,String(url.searchParams.get("token")||"").trim());
    if(!record)return J({ok:false,error:"handover link not found"},404);
    if(record.invalidReason==="expired")return J({ok:false,error:"handover link expired"},410);
    if(record.invalidReason==="used")return J({ok:false,error:"handover link already used"},410);
    return J(publicView(record));
  }
  if(url.pathname==="/api/handover/confirm"&&request.method==="POST")return confirm(request,env);
  if(url.pathname==="/api/admin/handover/create"&&request.method==="POST")return createLink(request,env);
  return null;
}
