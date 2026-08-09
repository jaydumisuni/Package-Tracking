const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const J=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{...H,...headers}});
const COOKIE='ttg_tracking_session';
const DEFAULT_GOOGLE_CLIENT_ID='1070381167858-10im1vskjk3ppftpal9pq9j0bb6g5i44.apps.googleusercontent.com';

function parseCookie(request,name){
  const raw=String(request.headers.get('cookie')||'');
  for(const part of raw.split(';')){
    const i=part.indexOf('='); if(i<0) continue;
    if(part.slice(0,i).trim()!==name) continue;
    try{return decodeURIComponent(part.slice(i+1).trim())}catch{return part.slice(i+1).trim()}
  }
  return '';
}
function authToken(request){return parseCookie(request,COOKIE)}
function googleClientId(env){return String(env.GOOGLE_CLIENT_ID||DEFAULT_GOOGLE_CLIENT_ID).trim()}
function safeUser(user={}){
  return {
    id:String(user.id||''),email:String(user.email||'').toLowerCase(),
    displayName:String(user.displayName||user.name||'TTG Staff'),role:String(user.role||''),
    status:String(user.status||''),permissions:Array.isArray(user.permissions)?user.permissions.map(String):[]
  };
}
function canUseTracking(user){
  const u=safeUser(user);
  return u.status==='approved'&&(u.role==='owner_admin'||u.permissions.includes('pos.jobs.write')||u.permissions.includes('pos.admin'));
}
function sessionCookie(token,maxAge=2592000){
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}
function clearCookie(){return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`}
async function authFetch(env,path,init={}){
  if(!env.TTG_AUTH||typeof env.TTG_AUTH.fetch!=='function')return J({ok:false,error:'TTG_AUTH_SERVICE_NOT_BOUND'},503);
  const headers=new Headers(init.headers||{}); headers.set('accept','application/json');
  if(env.TTG_AUTH_API_KEY)headers.set('x-ttg-api-key',String(env.TTG_AUTH_API_KEY));
  return env.TTG_AUTH.fetch(new Request(`https://ttg-auth.internal${path}`,{...init,headers}));
}
async function validateToken(env,token){
  if(!token)return {ok:false,status:401,error:'SIGN_IN_REQUIRED'};
  try{
    const r=await authFetch(env,'/auth/me',{method:'GET',headers:{authorization:`Bearer ${token}`}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.user)return {ok:false,status:401,error:'SESSION_INVALID'};
    const user=safeUser(d.user);
    if(!canUseTracking(user))return {ok:false,status:403,error:'TRACKING_ACCESS_NOT_ALLOWED',user};
    return {ok:true,status:200,user,token};
  }catch(error){console.error('tracking auth validation failed',String(error));return {ok:false,status:503,error:'TTG_AUTH_UNAVAILABLE'};}
}
export async function opsIdentity(request,env){return validateToken(env,authToken(request))}
export async function requireOpsAccess(request,env,{ownerOnly=false}={}){
  const auth=await opsIdentity(request,env);
  if(!auth.ok)return auth;
  if(ownerOnly&&auth.user.role!=='owner_admin')return {ok:false,status:403,error:'OWNER_ADMIN_REQUIRED',user:auth.user};
  return auth;
}

async function verifyGoogleCredential(env,credential){
  const clientId=googleClientId(env);
  const r=await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  const g=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error('GOOGLE_TOKEN_VERIFY_FAILED');
  if(String(g.aud||'')!==clientId)throw new Error('GOOGLE_AUDIENCE_MISMATCH');
  if(String(g.email_verified||'').toLowerCase()!=='true')throw new Error('GOOGLE_EMAIL_NOT_VERIFIED');
  if(!g.email||!g.sub)throw new Error('GOOGLE_IDENTITY_INCOMPLETE');
  return g;
}

export async function handleOpsAuth(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(path==='/api/ops/auth/google/status'&&request.method==='GET'){
    return J({ok:true,configured:Boolean(googleClientId(env)),clientId:googleClientId(env)});
  }
  if(path==='/api/ops/auth/session'&&request.method==='GET'){
    const auth=await opsIdentity(request,env);
    if(!auth.ok)return J({ok:false,authenticated:false,error:auth.error},auth.status);
    return J({ok:true,authenticated:true,user:auth.user});
  }
  if(path==='/api/ops/auth/login'&&request.method==='POST'){
    const body=await request.json().catch(()=>({}));
    const r=await authFetch(env,'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:String(body.email||'').trim(),password:String(body.password||'')})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.ok||!d.token||!d.user)return J({ok:false,error:d.error||d.message||'SIGN_IN_FAILED'},r.status||401);
    const user=safeUser(d.user);
    if(!canUseTracking(user)){
      await authFetch(env,'/auth/logout',{method:'POST',headers:{authorization:`Bearer ${d.token}`}}).catch(()=>null);
      return J({ok:false,error:'This approved TTG account does not have Tracking Operations access.'},403);
    }
    return J({ok:true,user},200,{'set-cookie':sessionCookie(d.token)});
  }
  if(path==='/api/ops/auth/google/exchange'&&request.method==='POST'){
    const body=await request.json().catch(()=>({}));
    const credential=String(body.credential||'').trim();
    if(!credential)return J({ok:false,error:'GOOGLE_CREDENTIAL_REQUIRED'},400);
    let google;
    try{google=await verifyGoogleCredential(env,credential)}catch(error){return J({ok:false,error:String(error.message||error)},401)}
    const r=await authFetch(env,'/internal/hunter/google/exchange',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
      email:String(google.email||'').toLowerCase(),displayName:String(google.name||google.given_name||'TTG Staff'),
      providerSubject:String(google.sub||''),emailVerified:true,requestedRole:'staff'
    })});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.ok)return J({ok:false,error:d.error||d.message||'GOOGLE_SIGN_IN_FAILED'},r.status||401);
    if(!d.approved||!d.token){return J({ok:false,pendingApproval:true,error:d.message||'This Google account is waiting for TTG approval.'},403)}
    const user=safeUser(d.user);
    if(!canUseTracking(user)){
      await authFetch(env,'/auth/logout',{method:'POST',headers:{authorization:`Bearer ${d.token}`}}).catch(()=>null);
      return J({ok:false,error:'This TTG account is approved but does not have Tracking Operations access.'},403);
    }
    return J({ok:true,user},200,{'set-cookie':sessionCookie(d.token)});
  }
  if(path==='/api/ops/auth/logout'&&request.method==='POST'){
    const token=authToken(request);
    if(token)await authFetch(env,'/auth/logout',{method:'POST',headers:{authorization:`Bearer ${token}`}}).catch(()=>null);
    return J({ok:true},200,{'set-cookie':clearCookie()});
  }
  return null;
}
