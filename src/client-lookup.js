import {
  businessCoreAuthorityActive,
  businessCoreErrorResponse,
  preflightTrackingAuthority,
  registerTrackingReferences
} from './business-core.js';
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

function phoneValuesFromContact(contact){
  if(!contact||typeof contact!=="object")return[];
  return[
    contact.phone,contact.phoneNumber,contact.phone_number,
    contact.mainPhone,contact.main_phone,
    contact.mobile,contact.mobilePhone,contact.mobile_phone,
    contact.whatsapp,contact.whatsApp,contact.whatsappNumber,contact.whatsapp_number,
    contact.senderPhone,contact.sender_phone,
    contact.phones,contact.phoneNumbers,contact.phone_numbers
  ];
}

function collectPhones(body={}){
  const job=body.job||{};
  const clientSections=[
    job.client,job.customer,job.business,job.clientBusiness,job.client_business,
    body.client,body.customer,body.business,body.clientBusiness,body.client_business
  ];
  const paymentSections=[
    job.payment,job.paymentConfirmation,job.payment_confirmation,
    body.payment,body.paymentConfirmation,body.payment_confirmation
  ];
  const values=[
    job.clientPhones,job.client_phones,job.phones,job.contactPhones,job.contact_phones,
    body.clientPhones,body.client_phones,body.phones,body.contactPhones,body.contact_phones,
    job.clientPhone,job.client_phone,job.phone,job.mainPhone,job.main_phone,job.senderPhone,job.sender_phone,
    body.clientPhone,body.client_phone,body.phone,body.mainPhone,body.main_phone,body.senderPhone,body.sender_phone,
    ...clientSections.flatMap(phoneValuesFromContact),
    ...paymentSections.flatMap(phoneValuesFromContact)
  ];
  const flat=values.flatMap(v=>Array.isArray(v)?v:[v]);
  return[...new Set(flat.map(normalizePhone).filter(Boolean))];
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
function trackingReferenceContext(body,master){
  const job=body.job||{};
  const publicReference=N(job.publicReference||body.publicReference||master);
  const aliases=[...(body.aliases||[])].map(N).filter(Boolean);
  return {publicReference,aliases};
}

async function preflightLegacyD1ReferenceOwnership(db,master,{publicReference,aliases=[]}={}){
  const refs=[publicReference,...aliases].map(N).filter(value=>value&&value!==master);
  for(const reference of [...new Set(refs)]){
    const row=await db.prepare(`
      SELECT DISTINCT j.master_transaction_id
      FROM tracking_jobs j
      LEFT JOIN tracking_aliases a ON a.job_id=j.id
      WHERE a.alias=?1 OR j.public_reference=?1
      LIMIT 1
    `).bind(reference).first();
    if(row?.master_transaction_id&&N(row.master_transaction_id)!==master){
      const error=new Error('LEGACY_D1_REFERENCE_COLLISION');
      error.status=409;
      error.code='LEGACY_D1_REFERENCE_COLLISION';
      error.reference=reference;
      error.existingMaster=N(row.master_transaction_id);
      throw error;
    }
  }
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

async function upsertAndLink(request,env,ctx,core,{transactionStart=false}={}){
  if(!await isAdmin(request,env))return J({ok:false,error:'unauthorized'},401);
  const clone=request.clone(),body=await clone.json().catch(()=>({}));
  const phones=collectPhones(body);
  const job=body.job||{};
  const master=N(job.masterTransactionId||body.masterTransactionId);
  const authorityActive=businessCoreAuthorityActive(env);
  if(transactionStart&&!master)return J({ok:false,error:'masterTransactionId required at transaction start'},400);
  if(authorityActive&&!master)return J({ok:false,error:'masterTransactionId required under Business Core authority',authority:'business-core'},400);

  const referenceContext=trackingReferenceContext(body,master);
  if(authorityActive){
    try{
      await preflightTrackingAuthority(env,master,referenceContext);
      await preflightLegacyD1ReferenceOwnership(env.TRACKING_DB,master,referenceContext);
    }catch(error){
      console.error('business core tracking preflight failed',String(error));
      const failure=businessCoreErrorResponse(error,{d1Committed:false});
      return J(failure.body,failure.status);
    }
  }

  const response=await core.fetch(request,env,ctx);
  if(!response.ok||!env.TRACKING_DB)return response;

  const payload=await response.clone().json().catch(()=>null);
  const jobId=payload?.id||await resolveJobId(env.TRACKING_DB,master||job.publicReference||body.publicReference||'');
  if(!jobId)return response;

  const data=payload||{ok:true};
  if(!phones.length){
    data.phoneLinked=false;
    data.phoneCount=0;
    data.phoneLinkWarning='No client/contact phone was supplied with this transaction. ID tracking still works, but phone lookup will not.';
  }else{
    try{
      await linkPhones(env.TRACKING_DB,jobId,phones);
      data.phoneLinked=true;
      data.phones=phones.map(maskPhone);
      data.phoneCount=phones.length;
    }catch(error){
      console.error('job saved but phone links failed',String(error));
      data.phoneLinked=false;
      data.phoneLinkWarning='phone lookup migration is not applied';
    }
  }

  if(authorityActive){
    try{
      const registered=await registerTrackingReferences(env,master,{
        jobId,
        publicReference:referenceContext.publicReference,
        aliases:referenceContext.aliases
      });
      data.businessCoreAuthority=true;
      data.businessCoreReferencesBound=registered.bound.length;
    }catch(error){
      console.error('tracking job committed but business core reference registration failed',String(error));
      const failure=businessCoreErrorResponse(error,{d1Committed:true});
      return J({
        ...failure.body,
        masterTransactionId:master,
        jobId
      },failure.status);
    }
  }

  return J(data,response.status);
}
async function transactionStart(request,env,ctx,core){
  if(!await isAdmin(request,env))return J({ok:false,error:"unauthorized"},401);
  if(!env.TRACKING_DB)return J({ok:false,error:"TRACKING_DB is not bound"},503);

  const body=await request.clone().json().catch(()=>({}));
  const job=body.job||{};
  if(!job.masterTransactionId&&body.masterTransactionId)job.masterTransactionId=body.masterTransactionId;
  if(!job.publicReference&&body.publicReference)job.publicReference=body.publicReference;
  const normalizedBody={...body,job};

  const coreRequest=new Request(new URL("/api/admin/jobs/upsert",request.url),{
    method:"POST",
    headers:request.headers,
    body:JSON.stringify(normalizedBody)
  });
  return upsertAndLink(coreRequest,env,ctx,core,{transactionStart:true});
}

export async function handleClientLookup(request,env,ctx,core){
  const url=new URL(request.url);
  if(url.pathname==="/api/client-jobs"&&request.method==="GET")return phoneJobs(request,env);
  if(url.pathname==="/api/admin/client-phone/link"&&request.method==="POST")return manualLink(request,env);
  if(url.pathname==="/api/admin/transactions/start"&&request.method==="POST")return transactionStart(request,env,ctx,core);
  if(url.pathname==="/api/admin/jobs/upsert"&&request.method==="POST")return upsertAndLink(request,env,ctx,core);
  return null;
}
