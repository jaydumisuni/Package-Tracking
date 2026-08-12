const ORIGIN=String(process.env.TTG_TRACKING_ORIGIN||'https://tracking.thetechguyds.com').replace(/\/+$/,'');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function request(path,options={}){
  let last='';
  for(let attempt=1;attempt<=20;attempt++){
    try{
      const response=await fetch(ORIGIN+path,{cache:'no-store',...options});
      if(response.status<500)return response;
      last=`HTTP ${response.status}`;
    }catch(error){last=String(error?.message||error)}
    await sleep(3000);
  }
  throw new Error(`LIVE_TRACKING_FETCH_FAILED ${path}: ${last}`);
}

const healthResponse=await request('/api/health',{headers:{accept:'application/json'}});
if(!healthResponse.ok)throw new Error(`LIVE_HEALTH_HTTP_${healthResponse.status}`);
const health=await healthResponse.json();
if(health.ok!==true||health.d1Bound!==true)throw new Error(`LIVE_TRACKING_NOT_READY ${JSON.stringify(health)}`);

const root=await (await request('/',{headers:{accept:'text/html'}})).text();
for(const marker of ['TTG ID or phone number','Forgot your TTG ID?','Use the phone number linked to your TTG documents','/maya-override.js?v=20260812a','/app.js?v=20260812a','/ttg-brand-primary.webp?v=canonical-20260812']){
  if(!root.includes(marker))throw new Error(`LIVE_CLIENT_UI_MARKER_MISSING ${marker}`);
}
if(root.includes('thetechguyds.com/favicon'))throw new Error('LIVE_TRACKING_BORROWS_MAIN_SITE_FAVICON');
if(root.includes('/ttg-ghost-main.svg'))throw new Error('LIVE_TRACKING_USES_RETIRED_GHOST_PLACEHOLDER');
if(/\bD1\b/i.test(root))throw new Error('PUBLIC_HTML_EXPOSES_INTERNAL_STORAGE_TERM');

const brandResponse=await request('/ttg-brand-primary.webp',{headers:{accept:'image/webp,image/*'}});
if(!brandResponse.ok)throw new Error(`LIVE_TTG_BRAND_HTTP_${brandResponse.status}`);
const brandBytes=new Uint8Array(await brandResponse.arrayBuffer());
if(brandBytes.length<1000)throw new Error(`LIVE_TTG_BRAND_TOO_SMALL ${brandBytes.length}`);

const portal=await (await request('/client-portal',{headers:{accept:'text/html'}})).text();
if(!portal.includes('/ttg-brand-primary.webp?v=canonical-20260812'))throw new Error('LIVE_CLIENT_PORTAL_CANONICAL_BRAND_MISSING');
if(portal.includes('thetechguyds.com/favicon'))throw new Error('LIVE_CLIENT_PORTAL_BORROWS_MAIN_SITE_FAVICON');

const app=await (await request('/app.js?v=20260812a',{headers:{accept:'application/javascript'}})).text();
for(const marker of ['RESULT_TEXT_IDS','resetResult({clearUrl:true})','No matching TTG tracking record was found','conversation_id']){
  if(!app.includes(marker))throw new Error(`LIVE_APP_MARKER_MISSING ${marker}`);
}
if(/\bD1\b/i.test(app))throw new Error('PUBLIC_APP_EXPOSES_INTERNAL_STORAGE_TERM');
new Function(app);

const deeplink=await (await request('/maya-override.js?v=20260812a',{headers:{accept:'application/javascript'}})).text();
for(const marker of ["params.get('id')","Copy tracking link","searchForm.requestSubmit()","url.searchParams.set('id'"]){
  if(!deeplink.includes(marker))throw new Error(`LIVE_CLIENT_DEEPLINK_MARKER_MISSING ${marker}`);
}
if(/searchParams\.set\(['"]phone['"]/.test(deeplink))throw new Error('LIVE_CLIENT_LINK_MUST_NOT_EXPOSE_PHONE');
if(/\bD1\b/i.test(deeplink))throw new Error('PUBLIC_OVERRIDE_EXPOSES_INTERNAL_STORAGE_TERM');
new Function(deeplink);

const css=await (await request('/patch.css?v=20260812a',{headers:{accept:'text/css'}})).text();
if(!/#resultArea\[hidden\][^{]*\{display:none!important\}/.test(css))throw new Error('LIVE_HIDDEN_RESULT_GUARD_MISSING');

const missingIdResponse=await request('/api/track?id=TTG-PROOF-NOT-A-REAL-JOB',{headers:{accept:'application/json'}});
const missingId=await missingIdResponse.json().catch(()=>({}));
if(missingIdResponse.status!==404||missingId.found!==false)throw new Error(`UNKNOWN_ID_FALSE_FOUND_REGRESSION ${missingIdResponse.status} ${JSON.stringify(missingId)}`);

const missingPhoneResponse=await request('/api/client-jobs?phone=999999999999999',{headers:{accept:'application/json'}});
const missingPhone=await missingPhoneResponse.json().catch(()=>({}));
if(missingPhoneResponse.status!==404||missingPhone.found!==false||Number(missingPhone.count||0)!==0)throw new Error(`UNKNOWN_PHONE_FALSE_FOUND_REGRESSION ${missingPhoneResponse.status} ${JSON.stringify(missingPhone)}`);

const mayaResponse=await request('/api/maya',{
  method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({message:'Hello'})
});
const maya=await mayaResponse.json().catch(()=>({}));
if(!mayaResponse.ok||!String(maya.reply||'').trim())throw new Error(`LIVE_MAYA_UNAVAILABLE ${mayaResponse.status} ${JSON.stringify(maya)}`);
if(/\bD1\b/i.test(String(maya.reply||'')))throw new Error(`LIVE_MAYA_EXPOSES_INTERNAL_STORAGE_TERM ${maya.reply}`);
if(!String(maya.conversation_id||'').trim())throw new Error(`LIVE_MAYA_CONVERSATION_ID_MISSING ${JSON.stringify(maya)}`);

console.log('TTG_LIVE_CLIENT_TRACKING_OK',JSON.stringify({origin:ORIGIN,d1Bound:true,directLinks:true,staleResultGuard:true,publicWording:true,mayaSharedGateway:true,canonicalTtgBrand:true,brandBytes:brandBytes.length,unknownIdFalseFound:true,unknownPhoneFalseFound:true}));
