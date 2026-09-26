import {
  businessCoreConfigurationState,
  reserveFromBusinessCore
} from './business-core.js';

const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const J=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:H});

function isAdmin(request,env){
  return Boolean(env.ADMIN_TOKEN)&&(request.headers.get('authorization')||'')===`Bearer ${env.ADMIN_TOKEN}`;
}

export {businessCoreConfigured,reserveFromBusinessCore} from './business-core.js';

export async function handleTransactionReserve(request,env){
  const url=new URL(request.url);
  if(url.pathname!=='/api/admin/transactions/reserve'||request.method!=='POST')return null;
  if(!isAdmin(request,env))return J({ok:false,error:'unauthorized'},401);

  const state=businessCoreConfigurationState(env);
  if(state!=='ready'){
    return J({
      ok:false,
      error:state==='incomplete'
        ?'BUSINESS_CORE_CONFIGURATION_INCOMPLETE'
        :'BUSINESS_CORE_REQUIRED_FOR_MASTER_ALLOCATION',
      authority:'business-core'
    },503);
  }

  try{
    const reservation=await reserveFromBusinessCore(request,env);
    return J({ok:true,...reservation});
  }catch(error){
    console.error('business core transaction reservation failed',String(error));
    return J({
      ok:false,
      error:String(error?.message||'BUSINESS_CORE_RESERVATION_FAILED'),
      authority:'business-core'
    },Number(error?.statusCode)||503);
  }
}
