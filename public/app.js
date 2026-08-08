(()=>{
  const $=id=>document.getElementById(id);
  const STAGES=['intake_received','disclaimer_confirmed','deposit_received','parts_sourcing','parts_ordered','awaiting_seller_shipment','seller_shipped','shipping_company_received','in_transit_to_zambia','received_in_zambia','parts_received_by_ttg','repair_in_progress','testing','ready_for_collection','completed'];
  const stageLabels={intake_received:'Intake received',disclaimer_confirmed:'Disclaimer confirmed',deposit_received:'Deposit received',parts_sourcing:'Parts sourcing',parts_ordered:'Parts ordered',awaiting_seller_shipment:'Awaiting seller shipment',seller_shipped:'Seller shipped',shipping_company_received:'Shipping company received',in_transit_to_zambia:'In transit to Zambia',received_in_zambia:'Received in Zambia / local shipping received',parts_received_by_ttg:'Parts received by TTG',repair_in_progress:'Repair in progress',testing:'Testing',ready_for_collection:'Ready for collection',completed:'Completed'};
  const demo={found:true,reference:'TTG-RCP-000060',masterId:'TTG-TXN-000060',clientName:'Example Client',condition:'Device / order under tracking',deviceItem:'Tracked item',serviceType:'Parts / Order Tracking',route:'USA → Zambia',origin:'USA',location:'USA',amountReceived:'',paymentMethod:'',stage:'shipping_company_received',updatedLabel:'Latest saved update',statusNote:'The seller shipment has reached the assigned shipping company. The next TTG stage is the international handoff toward Zambia.',latestUpdate:'This is a temporary fallback record until the D1 database is bound to the Worker.'};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const normalizeId=v=>String(v||'').trim().toUpperCase();
  const setText=(id,value)=>{const el=$(id);if(el&&value!==undefined&&value!==null&&value!=='')el.textContent=value};
  const moneyText=v=>typeof v==='number'?`ZMW ${v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`:v;

  function updateStages(stage){
    const index=Math.max(0,STAGES.indexOf(stage));
    document.querySelectorAll('.step[data-stage]').forEach((el,i)=>{
      el.classList.toggle('done',i<index);el.classList.toggle('current',i===index);
      const small=el.querySelector('small');if(small)small.textContent=i<index?'Completed':i===index?'In progress':'Pending';
    });
    requestAnimationFrame(centerCurrentStage);
  }
  function centerCurrentStage(){if(innerWidth>900)return;const s=$('steps'),c=s?.querySelector('.current');if(s&&c)s.scrollLeft=Math.max(0,c.offsetLeft-(s.clientWidth-c.clientWidth)/2)}
  function applyRecord(record,inputId){
    const r={...demo,...record};const reference=r.reference||inputId;
    const result=$('resultArea');if(result)result.hidden=false;
    setText('resultRef',reference);setText('publicReference',reference);setText('summaryReference',reference);setText('clientName',r.clientName);setText('condition',r.condition);setText('deviceItem',r.deviceItem);setText('serviceType',r.serviceType);setText('masterId',r.masterId);setText('summaryMaster',r.masterId);setText('route',r.route);setText('summaryRoute',r.route);setText('amountReceived',moneyText(r.amountReceived));setText('paymentMethod',r.paymentMethod);
    const label=stageLabels[r.stage]||r.status||'Tracking update';setText('currentStatus',label);setText('summaryStatus',label);setText('statusNote',r.statusNote);setText('summaryLocation',r.location||r.origin||'');setText('summaryUpdated',r.updatedLabel);setText('lastUpdated',`Last updated: ${r.updatedLabel} ↻`);
    const latest=$('latestUpdate');if(latest)latest.innerHTML=`<b>${r.updatedLabel}${r.location||r.origin?` · ${r.location||r.origin}`:''}</b><br>${r.latestUpdate||r.statusNote||''}`;
    updateStages(r.stage||'intake_received');
  }
  async function fetchTracking(id){try{const res=await fetch(`/api/track?id=${encodeURIComponent(id)}`,{headers:{accept:'application/json'}});if(!res.ok)return {found:false};return await res.json()}catch{return /^TTG-(RCP|INV|DOC|QTE|TXN)-0*60$/i.test(id)?demo:{found:false}}}

  const searchForm=$('searchForm'),trackingInput=$('trackingInput'),badge=$('foundBadge'),overlay=$('trackingOverlay');
  const overlayTitle=overlay?.querySelector('h2'),overlayText=overlay?.querySelector('p');
  searchForm?.addEventListener('submit',async e=>{
    e.preventDefault();const id=normalizeId(trackingInput?.value);if(!id)return;
    if(overlayTitle)overlayTitle.textContent='Tracking your TTG job…';if(overlayText)overlayText.textContent='Checking the latest saved progress and shipping handoff.';
    overlay?.classList.add('show');overlay?.setAttribute('aria-hidden','false');
    const started=Date.now(),record=await fetchTracking(id);await wait(Math.max(0,3000-(Date.now()-started)));
    if(record?.found!==false){
      overlay?.classList.remove('show');overlay?.setAttribute('aria-hidden','true');badge.textContent='Found';badge.classList.remove('bad');applyRecord(record,id);await wait(80);$('jobProgress')?.scrollIntoView({behavior:'smooth',block:'start'});
    }else{
      if(overlayTitle)overlayTitle.textContent='Tracking ID not found';if(overlayText)overlayText.textContent='Check the TTG document number and try again.';await wait(1200);overlay?.classList.remove('show');overlay?.setAttribute('aria-hidden','true');
    }
  });
  requestAnimationFrame(centerCurrentStage);addEventListener('resize',centerCurrentStage,{passive:true});

  const panel=$('tgai-panel'),fab=$('tgai-fab'),close=$('tgai-close'),cardOpen=$('mayaCardOpen'),mayaForm=$('tgaiForm'),mayaInput=$('tgaiInput'),messages=$('tgaiMessages');let frozenScrollY=0;
  function syncViewport(){const vv=window.visualViewport;const h=vv?.height||innerHeight,top=vv?.offsetTop||0;document.documentElement.style.setProperty('--vv-height',`${Math.round(h)}px`);document.documentElement.style.setProperty('--vv-top',`${Math.round(top)}px`)}
  function lockPage(){if(document.body.classList.contains('tgai-open'))return;frozenScrollY=scrollY;document.body.style.top=`-${frozenScrollY}px`;document.body.classList.add('tgai-open');syncViewport()}
  function unlockPage(){if(!document.body.classList.contains('tgai-open'))return;document.body.classList.remove('tgai-open');document.body.style.top='';scrollTo(0,frozenScrollY)}
  function openMaya(){lockPage();panel?.classList.add('open');panel?.setAttribute('aria-hidden','false');syncViewport()}
  function closeMaya(){mayaInput?.blur();panel?.classList.remove('open');panel?.setAttribute('aria-hidden','true');unlockPage()}
  fab?.addEventListener('click',openMaya);cardOpen?.addEventListener('click',openMaya);close?.addEventListener('click',closeMaya);
  window.visualViewport?.addEventListener('resize',syncViewport,{passive:true});window.visualViewport?.addEventListener('scroll',syncViewport,{passive:true});addEventListener('orientationchange',()=>setTimeout(syncViewport,120),{passive:true});

  function addMessage(text,kind='assistant'){const el=document.createElement('div');el.className=`tgai-msg${kind==='user'?' user':''}`;el.textContent=text;messages?.appendChild(el);if(messages)messages.scrollTop=messages.scrollHeight}
  function addTyping(){const el=document.createElement('div');el.className='tgai-typing';el.id='tgaiTyping';el.textContent='Maya is typing…';messages?.appendChild(el);if(messages)messages.scrollTop=messages.scrollHeight}
  function removeTyping(){$('tgaiTyping')?.remove()}
  function warmFallback(raw){const q=raw.toLowerCase();if(/hello|hey|^hi\b/.test(q))return'Hi 👋🏽 I’m here. If you’re checking an order, tell me the TTG tracking ID or ask what the current stage means and I’ll walk you through it.';if(/when|eta|how long|days|arrive|delivery/.test(q))return'The timing depends on where the parcel is coming from and whether the seller has already handed it to the shipping company. I can explain the estimate once I know the TTG tracking ID or origin country.';if(/next|what happens/.test(q))return'From the current stage, I’ll tell you the next handoff and what TTG is waiting for. For this example, the shipping company has received the parcel, so the next step is transit toward Zambia.';if(/custom|clearance|duty/.test(q))return'Customs can add time after the international leg. If a customs or local handoff update is saved on the tracking record, I’ll show it here and explain what it means.';if(/receipt|invoice|disclaimer|quote|document/.test(q))return'Any linked TTG receipt, invoice, disclaimer, quote or master transaction reference can resolve the same tracking job. You don’t need the supplier’s private courier number.';if(/fedex|courier|shipping company|seller/.test(q))return'TTG can keep the carrier number internally and use its scans to update your public TTG stage. Clients only need the TTG reference shown on their document.';return'I can help with the parcel stage, what happens next, delivery timing, seller or courier handoffs, customs, and the documents attached to this TTG job. What would you like to know?'}
  async function askMaya(text){try{const trackingId=normalizeId(trackingInput?.value);const res=await fetch('/api/maya',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:text,trackingId})});if(res.ok){const data=await res.json();if(data?.reply)return data.reply}}catch{}return warmFallback(text)}
  mayaForm?.addEventListener('submit',async e=>{e.preventDefault();const text=mayaInput?.value.trim();if(!text)return;addMessage(text,'user');mayaInput.value='';addTyping();const reply=await askMaya(text);await wait(280);removeTyping();addMessage(reply,'assistant')});
})();
