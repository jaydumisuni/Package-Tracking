(()=>{
  const trackingInput=document.getElementById('trackingInput');
  const searchForm=document.getElementById('searchForm');
  const publicReference=document.getElementById('publicReference');
  const resultArea=document.getElementById('resultArea');

  function directReference(){
    const params=new URLSearchParams(location.search);
    return String(params.get('id')||params.get('track')||'').trim().toUpperCase();
  }

  function publicLink(reference){
    const url=new URL(location.origin+'/');
    url.searchParams.set('id',String(reference||'').trim().toUpperCase());
    return url.toString();
  }

  function syncPublicLink(){
    if(resultArea?.hidden)return;
    const ref=String(publicReference?.textContent||'').trim().toUpperCase();
    if(!/^TTG-/.test(ref))return;
    const target=publicLink(ref);
    if(location.href!==target)history.replaceState(null,'',target);

    const head=document.querySelector('.result-head');
    if(!head)return;
    let share=document.getElementById('copyTrackingLink');
    if(!share){
      share=document.createElement('button');
      share.id='copyTrackingLink';share.type='button';share.className='copy-tracking-link';share.textContent='Copy tracking link';
      head.appendChild(share);
      share.addEventListener('click',async()=>{
        const current=String(publicReference?.textContent||'').trim().toUpperCase();
        if(!/^TTG-/.test(current))return;
        const link=publicLink(current);
        try{await navigator.clipboard.writeText(link);share.textContent='Copied ✓'}
        catch{share.textContent=link}
        setTimeout(()=>{share.textContent='Copy tracking link'},1800);
      });
    }
  }

  if(publicReference)new MutationObserver(syncPublicLink).observe(publicReference,{childList:true,characterData:true,subtree:true});
  if(resultArea)new MutationObserver(syncPublicLink).observe(resultArea,{attributes:true,attributeFilter:['hidden']});

  const direct=directReference();
  if(direct&&trackingInput&&searchForm){
    trackingInput.value=direct;
    queueMicrotask(()=>searchForm.requestSubmit());
  }
})();
