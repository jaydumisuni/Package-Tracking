import core from "./worker.js";
import {handleHandoverRequest} from "./handover.js";
import {handleShippingPolicy,normalizeShippingPolicy,wrapContext} from "./shipping-policy.js";

export default {
  async fetch(request,env,ctx){
    const handover=await handleHandoverRequest(request,env,ctx);
    if(handover)return handover;
    const shipping=await handleShippingPolicy(request,env,ctx,core);
    if(shipping)return shipping;
    return core.fetch(request,env,wrapContext(ctx,env));
  },
  async scheduled(event,env,ctx){
    const wrapped=wrapContext(ctx,env);
    if(typeof core.scheduled==="function")core.scheduled(event,env,wrapped);
    else ctx.waitUntil(normalizeShippingPolicy(env));
  }
};
