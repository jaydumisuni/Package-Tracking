const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const J=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:H});

export function enforceD1Truth(request,env){
  const url=new URL(request.url);
  if(env.TRACKING_DB)return null;

  if(url.pathname==="/api/track"){
    return J({found:false,error:"tracking database unavailable"},503);
  }

  if(url.pathname==="/api/maya"){
    return J({ok:false,error:"tracking database unavailable"},503);
  }

  if(url.pathname.startsWith("/api/admin/")&&url.pathname!=="/api/admin/health"){
    return J({ok:false,error:"TRACKING_DB is not bound"},503);
  }

  return null;
}
