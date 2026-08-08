import core from "./worker.js";
import {enforceD1Truth} from "./d1-truth.js";
import {handleHandoverRequest} from "./handover.js";
import {handleClientLookup} from "./client-lookup.js";
import {handleShippingPolicy,normalizeShippingPolicy,wrapContext} from "./shipping-policy.js";

export default {
  async fetch(request,env,ctx){
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
