import core from "./worker.js";
import {handleHandoverRequest} from "./handover.js";

export default {
  async fetch(request,env,ctx){
    const handover=await handleHandoverRequest(request,env,ctx);
    if(handover)return handover;
    return core.fetch(request,env,ctx);
  },
  async scheduled(event,env,ctx){
    if(typeof core.scheduled==="function")return core.scheduled(event,env,ctx);
  }
};
