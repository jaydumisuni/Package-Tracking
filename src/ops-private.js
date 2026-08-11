import {requireOpsAccess} from './ops-auth.js';

const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const J=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:H});
const N=v=>String(v||'').trim().toUpperCase();

async function resolveJob(db,reference){
  return db.prepare(`SELECT * FROM tracking_jobs WHERE id=(SELECT DISTINCT j.id FROM tracking_jobs j LEFT JOIN tracking_aliases a ON a.job_id=j.id WHERE a.alias=?1 OR j.master_transaction_id=?1 OR j.public_reference=?1 LIMIT 1)`).bind(N(reference)).first();
}

export async function handleOpsPrivate(request,env){
  const url=new URL(request.url);
  if(url.pathname!=='/api/ops/job/private')return null;
  if(request.method!=='GET')return J({ok:false,error:'METHOD_NOT_ALLOWED'},405);
  const auth=await requireOpsAccess(request,env);
  if(!auth.ok)return J({ok:false,error:auth.error},auth.status);
  if(auth.user?.role!=='owner_admin')return J({ok:false,error:'OWNER_ADMIN_REQUIRED'},403);
  if(!env.TRACKING_DB)return J({ok:false,error:'TRACKING_DB_NOT_BOUND'},503);
  const reference=N(url.searchParams.get('id')||'');
  if(!reference)return J({ok:false,error:'TRACKING_REFERENCE_REQUIRED'},400);
  const row=await resolveJob(env.TRACKING_DB,reference);
  if(!row)return J({ok:false,error:'TRACKING_JOB_NOT_FOUND'},404);
  const phones=(await env.TRACKING_DB.prepare(`SELECT phone_normalized,created_at FROM client_job_links WHERE job_id=?1 ORDER BY created_at ASC`).bind(row.id).all()).results||[];
  const aliases=(await env.TRACKING_DB.prepare(`SELECT alias FROM tracking_aliases WHERE job_id=?1 ORDER BY alias`).bind(row.id).all()).results||[];
  return J({
    ok:true,
    job:{
      ...row,
      aliases:aliases.map(x=>x.alias),
      phones:phones.map(x=>({normalized:String(x.phone_normalized||''),createdAt:x.created_at})),
    },
    privateFieldsIncluded:['client_phone_normalized'],
    ownerOnly:true,
    secretsExposed:false,
  });
}
