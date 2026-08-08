const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const J=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:H});
const N=value=>String(value||"").trim().toUpperCase();

export function normalizePhone(value){
  let digits=String(value||"").replace(/\D/g,"");
  if(digits.startsWith("00"))digits=digits.slice(2);
  if(digits.length===10&&digits.startsWith("0"))digits=`260${digits.slice(1)}`;
  else if(digits.length===9)digits=`260${digits}`;
  if(digits.length<9||digits.length>15)return"";
  return digits;
}

function maskPhone(phone){
  if(!phone)return"";
  if(phone.startsWith("260")&&phone.length>=12)return`+260 ${phone.slice(3,5)}***${phone.slice(-4)}`;
  return`+${phone.slice(0,Math.max(1,phone.length-7))}***${phone.slice(-4)}`;
}

function collectPhones(body={}){
  const job=body.job||{};
  const values=[
    job.clientPhones,job.client_phones,job.phones,job.contactPhones,job.contact_phones,
    body.clientPhones,body.client_phones,body.phones,body.contactPhones,body.contact_phones,
    job.clientPhone,job.client_phone,job.phone,job.mainPhone,job.main_phone,job.senderPhone,job.sender_phone,
    body.clientPhone,body.client_phone,body.phone,body.mainPhone,body.main_phone,body.senderPhone,body.sender_phone
  ];
  const flat=values.flatMap(v=>Array.isArray(v)?v:[v]);
  return [...new Set(flat.map(normalizePhone).filter(Boolean))];
}

async function isAdmin(request,env){return Boolean(env.ADMIN_TOKEN)&&(request.headers.get("authorization")||"")===`Bearer ${env.ADMIN_TOKEN}`}
async function resolveJobId(db,reference){
  const row=await db.prepare(`SELECT DISTINCT j.id AS job_id FROM tracking_jobs j LEFT JOIN tracking_aliases a ON a.job_id=j.id WHERE a.alias=?1 OR j.master_transaction_id=?1 OR j.public_reference=?1 LIMIT 1`).bind(N(reference)).first();
  return row?.job_id||null;
}
async function linkPhone(db,jobId,phone){
  await db.prepare(`INSERT INTO client_job_links(phone_normalized,job_id) VALUES(?1,?2) ON CONFLICT(phone_normalized,job_id) DO NOTHING`).bind(phone,jobId).run();
}
async function linkPhones(db,jobId,phones){
  for(const phone of phones)await linkPhone(db,jobId,phone);
}

async function phoneJobs(request,env){
  if(!env.TRACKING_DB)return J({found:false,error:"tracking database unavailable"},503);
  const url=new URL(request.url),phone=normalizePhone(url.searchParams.get("phone"));
  if(!phone)return J({found:false,error:"valid phone number required"},400);
  let rows;
  try{
    rows=(await env.TRACKING_DB.prepare(`
      SELECT j.public_reference,j.master_transaction_id,j.item_name,j.service_type,j.current_stage,j.updated_at
      FROM client_job_links l
      JOIN tracking_jobs j ON j.id=l.job_id
      WHERE l.phone_normalized=?1
      ORDER BY j.updated_at DESC,j.id DESC
      LIMIT 20
    `).bind(phone).all()).results||[];
  }catch(error){
    console.error("client phone lookup failed",String(error));
    return J({found:false,error:"phone lookup migration is not applied"},503);
  }
  if(!rows.length)return J({found:false,phone:maskPhone(phone),count:0,jobs:[]},404);
  const jobs=rows.map(row=>({
    reference:row.public_reference||row.master_transaction_id||null,
    masterId:row.master_transaction_id||null,
    itemName:row.item_name||null,
    serviceType:row.service_type||null,
    stage:row.current_stage||null,
    updatedAt:row.updated_at||null
  })).filter(job=>job.reference&&job.masterId);
  if(!jobs.length)return J({found:false,error:"linked D1 jobs are incomplete",phone:maskPhone(phone),count:0,jobs:[]},409);
  return J({found:true,phone:maskPhone(phone),count:jobs.length,jobs});
}

async function manualLink(request,env){
  if(!await isAdmin(request,env))return J({ok:false,error:"unauthorized"},401);
  if(!env.TRACKING_DB)return J({ok:false,error:"TRACKING_DB is not bound"},503);
  const body=await request.json().catch(()=>({}));
  const reference=N(body.reference);
  const phones=collectPhones(body);
  if(!reference||!phones.length)return J({ok:false,error:"reference and at least one valid phone are required"},400);
  const jobId=await resolveJobId(env.TRACKING_DB,reference);
  if(!jobId)return J({ok:false,error:"tracking job not found"},404);
  try{await linkPhones(env.TRACKING_DB,jobId,phones)}
  catch(error){return J({ok:false,error:"phone lookup migration is not applied"},503)}
  return J({ok:true,reference,phones:phones.map(maskPhone),count:phones.length});
}

async function upsertAndLink(request,env,ctx,core){
  const clone=request.clone(),body=await clone.json().catch(()=>({}));
  const phones=collectPhones(body);
  const job=body.job||{};
  const response=await core.fetch(request,env,ctx);
  if(!response.ok||!phones.length||!env.TRACKING_DB)return response;
  const payload=await response.clone().json().catch(()=>null);
  const jobId=payload?.id||await resolveJobId(env.TRACKING_DB,job.masterTransactionId||job.publicReference||"");
  if(!jobId)return response;
  try{await linkPhones(env.TRACKING_DB,jobId,phones)}
  catch(error){
    console.error("job saved but phone links failed",String(error));
    const data=payload||{ok:true};
    data.phoneLinked=false;
    data.phoneLinkWarning="phone lookup migration is not applied";
    return J(data,response.status);
  }
  const data=payload||{ok:true};
  data.phoneLinked=true;
  data.phones=phones.map(maskPhone);
  data.phoneCount=phones.length;
  return J(data,response.status);
}

export async function handleClientLookup(request,env,ctx,core){
  const url=new URL(request.url);
  if(url.pathname==="/api/client-jobs"&&request.method==="GET")return phoneJobs(request,env);
  if(url.pathname==="/api/admin/client-phone/link"&&request.method==="POST")return manualLink(request,env);
  if(url.pathname==="/api/admin/jobs/upsert"&&request.method==="POST")return upsertAndLink(request,env,ctx,core);
  return null;
}
