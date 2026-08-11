import assert from 'node:assert/strict';
import {ADMIN_ORIGIN,adminOperationsReady} from '../src/admin-ops-handoff.js';

assert.equal(ADMIN_ORIGIN,'https://admin.thetechguyds.com');

const response=body=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
assert.equal(await adminOperationsReady(async()=>response({ok:true,uiRevision:'owner-control-plane-v2',trackingIntegrated:true,documentsIntegrated:true})),true);
assert.equal(await adminOperationsReady(async()=>response({ok:true,uiRevision:'old',trackingIntegrated:true,documentsIntegrated:true})),false);
assert.equal(await adminOperationsReady(async()=>response({ok:true,uiRevision:'owner-control-plane-v2',trackingIntegrated:false,documentsIntegrated:true})),false);
assert.equal(await adminOperationsReady(async()=>new Response('fail',{status:503})),false);
assert.equal(await adminOperationsReady(async()=>{throw new Error('offline')}),false);

console.log('ADMIN_OPS_HANDOFF_OK');
