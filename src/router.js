import core from "./worker.js";
import {enforceD1Truth} from "./d1-truth.js";
import {handleHandoverRequest} from "./handover.js";
import {handleClientLookup} from "./client-lookup.js";
import {handleShippingPolicy,normalizeShippingPolicy,wrapContext} from "./shipping-policy.js";
import {handlePublicMaya} from "./maya-public.js";
import {handleD1Bootstrap} from "./d1-bootstrap.js";
import {handleAdminSession} from "./admin-auth.js";
import {handleOwnerPhoneRepair} from "./admin-repair.js";

const JSON_HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};

async function serveExactBrandIcon(request,env){
  if(!env.ASSETS)return null;
  const target=new URL('/ttg-ghost-main.svg',request.url);
  const response=await env.ASSETS.fetch(new Request(target,{method:'GET',headers:request.headers}));
  if(!response.ok)return response;
  const headers=new Headers(response.headers);
  headers.set('cache-control','no-store, max-age=0, must-revalidate');
  return new Response(response.body,{status:response.status,headers});
}

async function serveAppWithMayaOverride(request,env){
  if(!env.ASSETS)return null;
  const baseUrl=new URL('/app.js',request.url);
  const overrideUrl=new URL('/maya-override.js',request.url);
  const [base,override]=await Promise.all([
    env.ASSETS.fetch(new Request(baseUrl,{method:'GET',headers:request.headers})),
    env.ASSETS.fetch(new Request(overrideUrl,{method:'GET',headers:request.headers}))
  ]);
  if(!base.ok)return base;
  if(!override.ok)return base;
  const body=`${await base.text()}\n;${await override.text()}`;
  return new Response(body,{status:200,headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store, max-age=0, must-revalidate'}});
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);

    if(url.pathname==='/site-icon.svg'){
      const icon=await serveExactBrandIcon(request,env);
      if(icon)return icon;
    }

    if(url.pathname==='/app.js'){
      const app=await serveAppWithMayaOverride(request,env);
      if(app)return app;
    }

    if(url.pathname==='/api/health'){
      return new Response(JSON.stringify({
        ok:true,
        worker:'package-tracking',
        d1Bound:Boolean(env.TRACKING_DB),
        assetsBound:Boolean(env.ASSETS),
        ttgAuthBound:Boolean(env.TTG_AUTH),
        hunterConfigured:Boolean(env.HUNTER_API_URL)
      }),{status:200,headers:JSON_HEADERS});
    }

    const adminSession=await handleAdminSession(request,env);
    if(adminSession)return adminSession;

    const d1=await handleD1Bootstrap(request,env);
    if(d1)return d1;

    const ownerRepair=await handleOwnerPhoneRepair(request,env);
    if(ownerRepair)return ownerRepair;

    const maya=await handlePublicMaya(request,env);
    if(maya)return maya;

    const truth=enforceD1Truth(request,env);
    if(truth)return truth;
    const handover=await handleHandoverRequest(request,env,ctx);
    if(handover)return handover;
    const clientLookup=await handleClientLookup(request,env,ctx,core);
    if(clientLookup)return clientLookup;
    const shipping=await handleShippingPolicy(request,env,ctx,core);
    if(shipping)return shipping;
    return core.fetch(request,env,wrapContext(ctx,env));
  },
  async scheduled(event,env,ctx){
    if(!env.TRACKING_DB)return;
    const wrapped=wrapContext(ctx,env);
    if(typeof core.scheduled==="function")core.scheduled(event,env,wrapped);
    else ctx.waitUntil(normalizeShippingPolicy(env));
  }
};
