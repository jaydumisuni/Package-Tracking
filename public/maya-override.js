(()=>{
  const form=document.getElementById('tgaiForm');
  const input=document.getElementById('tgaiInput');
  const messages=document.getElementById('tgaiMessages');

  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

  // Client tracking links are ID-based only. Phone numbers remain a lookup
  // convenience and are never copied into the URL.
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
      share.id='copyTrackingLink';
      share.type='button';
      share.className='copy-tracking-link';
      share.textContent='Copy tracking link';
      share.style.cssText='margin-left:auto;border:1px solid rgba(124,58,237,.5);border-radius:10px;background:rgba(124,58,237,.12);color:#d9ccff;padding:7px 10px;font:inherit;font-size:12px;font-weight:800;cursor:pointer';
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

  if(publicReference){
    new MutationObserver(syncPublicLink).observe(publicReference,{childList:true,characterData:true,subtree:true});
  }
  if(resultArea){
    new MutationObserver(syncPublicLink).observe(resultArea,{attributes:true,attributeFilter:['hidden']});
  }

  const direct=directReference();
  if(direct&&trackingInput&&searchForm){
    trackingInput.value=direct;
    queueMicrotask(()=>searchForm.requestSubmit());
  }

  if(!form||!input||!messages)return;

  function currentTrackingId(){
    const area=document.getElementById('resultArea');
    const ref=document.getElementById('publicReference')?.textContent?.trim()||'';
    if(area?.hidden)return '';
    return /^TTG-/i.test(ref)?ref:'';
  }

  function addMessage(text,user=false){
    const node=document.createElement('div');
    node.className=`tgai-msg${user?' user':''}`;
    node.textContent=text;
    messages.appendChild(node);
    messages.scrollTop=messages.scrollHeight;
    return node;
  }

  form.addEventListener('submit',async event=>{
    event.preventDefault();
    event.stopImmediatePropagation();

    const message=input.value.trim();
    if(!message)return;

    addMessage(message,true);
    input.value='';
    const typing=addMessage('Maya is typing…');

    try{
      const trackingId=currentTrackingId();
      const payload={message};
      if(trackingId)payload.trackingId=trackingId;

      const response=await fetch('/api/maya',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify(payload)
      });
      const data=await response.json().catch(()=>({}));
      await wait(180);
      typing.remove();

      if(!response.ok)throw new Error(data.error||'Maya is unavailable');
      addMessage(data.reply||'I’m here. What would you like to know about tracking or shipping?');
    }catch(error){
      typing.remove();
      addMessage('I can still help with general tracking and shipping questions. For a specific job, I need the real D1 record to be available first.');
    }
  },true);
})();
