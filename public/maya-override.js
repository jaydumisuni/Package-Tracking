(()=>{
  const form=document.getElementById('tgaiForm');
  const input=document.getElementById('tgaiInput');
  const messages=document.getElementById('tgaiMessages');
  if(!form||!input||!messages)return;

  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

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
