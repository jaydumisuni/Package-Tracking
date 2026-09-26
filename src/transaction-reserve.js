import {businessCoreConfigured,businessCoreConfigurationPresent,reserveFromBusinessCore} from "./business-core.js";
const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const J=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:H});

function isAdmin(request,env){
  return Boolean(env.ADMIN_TOKEN)&&(request.headers.get('authorization')||'')===`Bearer ${env.ADMIN_TOKEN}`;
}

export async function handleTransactionReserve(request,env){
  const url=new URL(request.url);
  if(url.pathname!=='/api/admin/transactions/reserve'||request.method!=='POST')return null;
  if(!isAdmin(request,env))return J({ok:false,error:'unauthorized'},401);

  if(!businessCoreConfigured(env)){
    const error=businessCoreConfigurationPresent(env)
      ? 'business core configuration incomplete'
      : 'business core configuration required';
    return J({ok:false,error,authority:'business-core'},503);
  }

  try{
    const reservation=await reserveFromBusinessCore(request,env);
    return J({ok:true,...reservation});
  }catch(error){
    console.error('business core transaction reservation failed',String(error));
    const status=[400,404,409].includes(Number(error?.status))?Number(error.status):503;
    return J({ok:false,error:'business core transaction reservation failed',authority:'business-core'},status);
  }
}
