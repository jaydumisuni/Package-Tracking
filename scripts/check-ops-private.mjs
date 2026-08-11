import fs from 'node:fs';
const source=fs.readFileSync('src/ops-private.js','utf8');
for(const needle of [
  "url.pathname!=='/api/ops/job/private'",
  "auth.user?.role!=='owner_admin'",
  'phone_normalized',
  'normalized:String(x.phone_normalized||\'\')',
  "privateFieldsIncluded:['client_phone_normalized']",
  'secretsExposed:false',
]){
  if(!source.includes(needle))throw new Error('OPS_PRIVATE_VERIFY_FAILED:'+needle);
}
if(source.includes('maskPhone('))throw new Error('OPS_PRIVATE_VERIFY_FAILED:private_document_recovery_must_return_normalized_phone_to_owner_server_bridge');
console.log('OPS_PRIVATE_OWNER_RECOVERY_OK');
