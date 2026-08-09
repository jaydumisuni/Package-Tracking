import {requireOwnerAdmin} from './admin-auth.js';
import {normalizePhone} from './client-lookup.js';

const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const J=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:H});
const N=value=>String(value||'').trim().toUpperCase();
const mask=phone=>phone.startsWith('260')&&phone.length>=12?`+260 ${phone.slice(3,5)}***${phone.slice(-4)}`:`***${phone.slice(-4)}`;

async function resolveJobId(db,reference){
  const row=await db.prepare(`SELECT DISTINCT j.id AS job_id FROM tracking_jobs j LEFT JOIN tracking_aliases a ON a.job_id=j.id WHERE a.alias=?1 OR j.master_transaction_id=?1 OR j.public_reference=?1 LIMIT 1`).bind(N(reference)).first();
  return row?.job_id||null;
}

export async function handleOwnerPhoneRepair(request,env){
  const url=new URL(request.url);
  if(url.pathname!=='/api/admin/client-phone/link'||request.method!=='POST')return null;
  const denied=await requireOwnerAdmin(request,env);
  if(denied)return denied;
  if(!env.TRACKING_DB)return J({ok:false,error:'TRACKING_DB is not bound'},503);

  const body=await request.json().catch(()=>({}));
  const reference=N(body.reference);
  const raw=Array.isArray(body.clientPhones)?body.clientPhones:[];
  const phones=[...new Set(raw.map(normalizePhone).filter(Boolean))];
  if(!reference||!phones.length)return J({ok:false,error:'reference and at least one valid phone are required'},400);
  const jobId=await resolveJobId(env.TRACKING_DB,reference);
  if(!jobId)return J({ok:false,error:'tracking job not found'},404);

  try{
    for(const phone of phones){
      await env.TRACKING_DB.prepare(`INSERT INTO client_job_links(phone_normalized,job_id) VALUES(?1,?2) ON CONFLICT(phone_normalized,job_id) DO NOTHING`).bind(phone,jobId).run();
    }
  }catch(error){
    console.error('owner phone repair failed',String(error));
    return J({ok:false,error:'phone lookup schema is not ready'},503);
  }
  return J({ok:true,reference,count:phones.length,phones:phones.map(mask)});
}
