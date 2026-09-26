import {requireOpsAccess} from './ops-auth.js';
import {businessCoreConfigured,businessCoreConfigurationPresent,reserveFromBusinessCore} from './business-core.js';

const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const J=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:H});

async function audit(db,user,reference){
  try{
    await db.prepare(`INSERT INTO tracking_staff_audit(actor_user_id,actor_email,actor_role,action,reference,summary,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)`)
      .bind(user.id||'',user.email||'',user.role||'','transaction.reserve',String(reference||'').toUpperCase(),'Reserved by Document Operations',new Date().toISOString()).run();
  }catch(error){console.error('transaction reserve audit failed',String(error))}
}

export async function handleDocOpsReserve(request,env){
  const url=new URL(request.url);
  if(url.pathname!=='/api/ops/transactions/reserve'||request.method!=='POST')return null;
  const auth=await requireOpsAccess(request,env);
  if(!auth.ok)return J({ok:false,error:auth.error},auth.status);
  if(!env.TRACKING_DB)return J({ok:false,error:'TRACKING_DB_NOT_BOUND'},503);
  if(!businessCoreConfigured(env)){
    const error=businessCoreConfigurationPresent(env)
      ? 'BUSINESS_CORE_CONFIGURATION_INCOMPLETE'
      : 'BUSINESS_CORE_CONFIGURATION_REQUIRED';
    return J({ok:false,error,authority:'business-core'},503);
  }
  try{
    const reservation=await reserveFromBusinessCore(request,env);
    await audit(env.TRACKING_DB,auth.user,reservation.masterTransactionId);
    return J({ok:true,...reservation,user:auth.user});
  }catch(error){
    console.error('staff transaction reservation failed',String(error));
    const status=[400,404,409].includes(Number(error?.status))?Number(error.status):503;
    return J({ok:false,error:'TRANSACTION_RESERVATION_FAILED',authority:'business-core'},status);
  }
}
