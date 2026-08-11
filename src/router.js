import core from "./worker.js";
import {enforceD1Truth} from "./d1-truth.js";
import {handleHandoverRequest} from "./handover.js";
import {handleClientLookup} from "./client-lookup.js";
import {handleShippingPolicy,normalizeShippingPolicy,wrapContext} from "./shipping-policy.js";
import {handlePublicMaya} from "./maya-public.js";
import {handleD1Bootstrap} from "./d1-bootstrap.js";
import {handleOpsAuth} from "./ops-auth.js";
import {handleOpsApi} from "./ops-api.js";
import {handleOpsPrivate} from "./ops-private.js";
import {handleTransactionReserve} from "./transaction-reserve.js";
import {handleDocOpsReserve} from "./docops-reserve.js";
import {ADMIN_ORIGIN,adminOperationsReady} from "./admin-ops-handoff.js";

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
async function serveAuthHtml(request,env,path){
  const response=await serveAsset(request,env,path,'text/html; charset=utf-8');
  if(!response)return null;
  const headers=new Headers(response.headers);
  headers.set('referrer-policy','strict-origin-when-cross-origin');
  headers.set('cross-origin-opener-policy','same-origin-allow-popups');
  return new Response(response.body,{status:response.status,headers});
}
async function serveExactBrandIcon(request,env){return serveAsset(request,env,'/ttg-ghost-main.svg','image/svg+xml')}
async function serveOps(request,env){return serveAuthHtml(request,env,'/ops.html')}
async function serveDocOpsConnect(request,env){return serveAuthHtml(request,env,'/docops-connect.html')}
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

    // Keep the old operator page only as a rollout/emergency fallback. As soon
    // as the live Admin v2 health contract proves the integrated owner surface
    // is ready, old /ops bookmarks automatically redirect into Admin.
    if((url.pathname==='/ops'||url.pathname==='/ops/')&&['GET','HEAD'].includes(request.method)){
      if(await adminOperationsReady())return Response.redirect(`${ADMIN_ORIGIN}/#tracking`,302);
      const page=await serveOps(request,env);if(page)return page;
    }

    // Scoped auth handoff only for the deterministic local fallback.
    if((url.pathname==='/ops/connect'||url.pathname==='/ops/connect/')&&request.method==='GET'){const page=await serveDocOpsConnect(request,env);if(page)return page}
    if(url.pathname==='/d1-repair'||url.pathname==='/d1-repair.html'){
      if(await adminOperationsReady())return Response.redirect(`${ADMIN_ORIGIN}/#tracking`,302);
      return Response.redirect(new URL('/ops?view=system',request.url).toString(),302);
    }

    if(url.pathname==='/api/health')return new Response(JSON.stringify({ok:true,worker:'package-tracking',d1Bound:Boolean(env.TRACKING_DB),assetsBound:Boolean(env.ASSETS),ttgAuthBound:Boolean(env.TTG_AUTH),hunterConfigured:Boolean(env.HUNTER_API_URL),opsApi:true,opsPrivateOwnerRecovery:true,standaloneOpsFallbackUntilAdminV2:true,adminOperationsTarget:ADMIN_ORIGIN,docOpsConnect:true}),{status:200,headers:JSON_HEADERS});

    const reserve=await handleTransactionReserve(request,env);if(reserve)return reserve;
    const opsAuth=await handleOpsAuth(request,env);if(opsAuth)return opsAuth;
    const docOpsReserve=await handleDocOpsReserve(request,env);if(docOpsReserve)return docOpsReserve;
    const d1=await handleD1Bootstrap(request,env);if(d1)return d1;
    const opsPrivate=await handleOpsPrivate(request,env);if(opsPrivate)return opsPrivate;
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
