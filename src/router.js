import core from "./worker.js";
import {enforceD1Truth} from "./d1-truth.js";
import {handleHandoverRequest} from "./handover.js";
import {handleClientLookup} from "./client-lookup.js";
import {handleShippingPolicy,normalizeShippingPolicy,wrapContext} from "./shipping-policy.js";
import {handlePublicMaya} from "./maya-public.js";
import {handleD1Bootstrap} from "./d1-bootstrap.js";
import {handleOpsAuth} from "./ops-auth.js";
import {handleOpsApi} from "./ops-api.js";

const JSON_HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};

async function serveAsset(request,env,path,contentType){
  if(!env.ASSETS)return null;
  const target=new URL(path,request.url);
  const response=await env.ASSETS.fetch(new Request(target,{method:'GET',headers:request.headers}));
  if(!response.ok)return response;
  const headers=new Headers(response.headers);
  headers.set('cache-control','no-store, max-age=0, must-revalidate');
  if(contentType)headers.set('content-type',contentType);
  return new Response(response.body,{status:response.status,headers});
}
async function serveExactBrandIcon(request,env){return serveAsset(request,env,'/ttg-ghost-main.svg','image/svg+xml')}
async function serveOps(request,env){return serveAsset(request,env,'/ops.html','text/html; charset=utf-8')}
async function serveAppWithMayaOverride(request,env){
  if(!env.ASSETS)return null;
  const baseUrl=new URL('/app.js',request.url),overrideUrl=new URL('/maya-override.js',request.url);
  const [base,override]=await Promise.all([env.ASSETS.fetch(new Request(baseUrl,{method:'GET',headers:request.headers})),env.ASSETS.fetch(new Request(overrideUrl,{method:'GET',headers:request.headers}))]);
  if(!base.ok)return base;if(!override.ok)return base;
  const body=`${await base.text()}\n;${await override.text()}`;
  return new Response(body,{status:200,headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store, max-age=0, must-revalidate'}});
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==='/site-icon.svg'){const icon=await serveExactBrandIcon(request,env);if(icon)return icon}
    if(url.pathname==='/app.js'){const app=await serveAppWithMayaOverride(request,env);if(app)return app}
    if((url.pathname==='/ops'||url.pathname==='/ops/')&&request.method==='GET'){const page=await serveOps(request,env);if(page)return page}
    if(url.pathname==='/d1-repair'||url.pathname==='/d1-repair.html')return Response.redirect(new URL('/ops?view=system',request.url).toString(),302);
    if(url.pathname==='/api/health')return new Response(JSON.stringify({ok:true,worker:'package-tracking',d1Bound:Boolean(env.TRACKING_DB),assetsBound:Boolean(env.ASSETS),ttgAuthBound:Boolean(env.TTG_AUTH),hunterConfigured:Boolean(env.HUNTER_API_URL),opsConsole:true}),{status:200,headers:JSON_HEADERS});

    const opsAuth=await handleOpsAuth(request,env);if(opsAuth)return opsAuth;
    const d1=await handleD1Bootstrap(request,env);if(d1)return d1;
    const opsApi=await handleOpsApi(request,env);if(opsApi)return opsApi;
    const maya=await handlePublicMaya(request,env);if(maya)return maya;
    const truth=enforceD1Truth(request,env);if(truth)return truth;
    const handover=await handleHandoverRequest(request,env,ctx);if(handover)return handover;
    const clientLookup=await handleClientLookup(request,env,ctx,core);if(clientLookup)return clientLookup;
    const shipping=await handleShippingPolicy(request,env,ctx,core);if(shipping)return shipping;
    return core.fetch(request,env,wrapContext(ctx,env));
  },
  async scheduled(event,env,ctx){
    if(!env.TRACKING_DB)return;
    const wrapped=wrapContext(ctx,env);
    if(typeof core.scheduled==='function')core.scheduled(event,env,wrapped);else ctx.waitUntil(normalizeShippingPolicy(env));
  }
};
