export const ADMIN_ORIGIN='https://admin.thetechguyds.com';

export async function adminOperationsReady(fetchImpl=fetch){
  try{
    const response=await fetchImpl(`${ADMIN_ORIGIN}/health`,{
      method:'GET',
      headers:{accept:'application/json'},
      cache:'no-store',
      signal:AbortSignal.timeout(3500),
    });
    if(!response.ok)return false;
    const data=await response.json().catch(()=>({}));
    return data?.ok===true&&
      data?.uiRevision==='owner-control-plane-v2'&&
      data?.trackingIntegrated===true&&
      data?.documentsIntegrated===true;
  }catch{return false}
}
