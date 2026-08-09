const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const J=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:H});

function bearer(request){
  const header=String(request.headers.get('authorization')||'').trim();
  if(/^bearer\s+/i.test(header))return header.replace(/^bearer\s+/i,'').trim();
  return '';
}

function cookie(request,name){
  const raw=String(request.headers.get('cookie')||'');
  for(const part of raw.split(';')){
    const i=part.indexOf('=');
    if(i<0)continue;
    const key=part.slice(0,i).trim();
    if(key!==name)continue;
    try{return decodeURIComponent(part.slice(i+1).trim())}catch{return part.slice(i+1).trim()}
  }
  return '';
}

function sessionToken(request){
  return bearer(request)||cookie(request,'hunter_token');
}

export async function ownerAdminSession(request,env){
  if(!env.TTG_AUTH)return {ok:false,status:503,error:'TTG Auth service is not bound'};
  const token=sessionToken(request);
  if(!token)return {ok:false,status:401,error:'TTG Google sign-in required'};

  const headers=new Headers({'authorization':`Bearer ${token}`,'accept':'application/json'});
  if(env.TTG_AUTH_API_KEY)headers.set('x-ttg-api-key',String(env.TTG_AUTH_API_KEY));
  let response;
  try{
    response=await env.TTG_AUTH.fetch(new Request('https://ttg-auth.internal/auth/me',{method:'GET',headers}));
  }catch(error){
    console.error('TTG auth service call failed',String(error));
    return {ok:false,status:503,error:'TTG Auth is unavailable'};
  }
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data?.user)return {ok:false,status:401,error:'TTG session is invalid or expired'};
  const user=data.user;
  if(user.role!=='owner_admin'||user.status!=='approved')return {ok:false,status:403,error:'Owner admin access required'};
  return {ok:true,status:200,user};
}

export async function requireOwnerAdmin(request,env){
  const auth=await ownerAdminSession(request,env);
  if(auth.ok)return null;
  return J({ok:false,error:auth.error},auth.status);
}

export async function handleAdminSession(request,env){
  const url=new URL(request.url);
  if(url.pathname!=='/api/admin/session'||request.method!=='GET')return null;
  const auth=await ownerAdminSession(request,env);
  if(!auth.ok)return J({ok:false,authenticated:false,error:auth.error},auth.status);
  return J({ok:true,authenticated:true,user:{displayName:auth.user.displayName||'',role:auth.user.role}});
}
