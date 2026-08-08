(()=>{
  const $=id=>document.getElementById(id);
  const STAGES=['intake_received','disclaimer_confirmed','deposit_received','parts_sourcing','parts_ordered','awaiting_seller_shipment','seller_shipped','shipping_company_received','awaiting_shipping_cost','shipping_cost_paid','in_transit_to_zambia','received_in_zambia','parts_received_by_ttg','repair_in_progress','testing','ready_for_collection','completed'];
  const stageLabels={intake_received:'Intake received',disclaimer_confirmed:'Disclaimer confirmed',deposit_received:'Order payment received',parts_sourcing:'Parts sourcing',parts_ordered:'Parts ordered',awaiting_seller_shipment:'Awaiting seller shipment',seller_shipped:'Seller shipped',shipping_company_received:'Shipping company received',awaiting_shipping_cost:'Awaiting shipping cost',shipping_cost_paid:'Shipping cost paid',in_transit_to_zambia:'In transit to Zambia',received_in_zambia:'Received in Zambia / local shipping received',parts_received_by_ttg:'Parts received by TTG',repair_in_progress:'Repair in progress',testing:'Testing',ready_for_collection:'Ready for collection',completed:'Completed'};
  const demo={found:true,reference:'TTG-RCP-000060',masterId:'TTG-TXN-000060',clientName:'Example Client',condition:'Device / order under tracking',deviceItem:'Tracked item',serviceType:'Parts / Order Tracking',route:'USA → Zambia',origin:'USA',location:'USA shipping company',amountReceived:'',paymentMethod:'',orderPaymentStatus:'Paid in full',shippingCostStatus:'Awaiting shipping company quote',stage:'awaiting_shipping_cost',updatedLabel:'Latest saved update',statusNote:'The seller shipment has reached the assigned shipping company. The item/order is paid in full; TTG is waiting for the shipping company to confirm the international shipping charge before dispatch toward Zambia.',latestUpdate:'Shipping company received the parcel. International shipping cost is pending confirmation.'};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const normalizeId=v=>String(v||'').trim().toUpperCase();
  const setText=(id,value)=>{const el=$(id);if(el&&value!==undefined&&value!==null)el.textContent=value||'—'};
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
  function jumpToProgress(){const el=$('jobProgress');if(!el)return;const go=()=>{const top=el.getBoundingClientRect().top+window.scrollY-18;window.scrollTo({top:Math.max(0,top),behavior:'smooth'})};requestAnimationFrame(()=>requestAnimationFrame(go));setTimeout(go,260)}
  function applyRecord(record,inputId){
    const r={...demo,...record};const reference=r.reference||inputId;
    const result=$('resultArea');if(result)result.hidden=false;
    setText('resultRef',reference);setText('publicReference',reference);setText('summaryReference',reference);setText('clientName',r.clientName);setText('condition',r.condition);setText('deviceItem',r.deviceItem);setText('serviceType',r.serviceType);setText('masterId',r.masterId);setText('summaryMaster',r.masterId);setText('route',r.route);setText('summaryRoute',r.route);setText('amountReceived',moneyText(r.amountReceived));setText('paymentMethod',r.paymentMethod);setText('orderPaymentStatus',r.orderPaymentStatus||'Paid / confirmed');setText('shippingCostStatus',r.shippingCostStatus||'Not yet confirmed');setText('summaryPayment',r.orderPaymentStatus||'Paid / confirmed');setText('summaryShippingCost',r.shippingCostStatus||'Not yet confirmed');
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
    if(record?.found!==false){overlay?.classList.remove('show');overlay?.setAttribute('aria-hidden','true');badge.textContent='Found';badge.classList.remove('bad');applyRecord(record,id);await wait(140);jumpToProgress()}
    else{if(overlayTitle)overlayTitle.textContent='Tracking ID not found';if(overlayText)overlayText.textContent='Check the TTG document number and try again.';await wait(1200);overlay?.classList.remove('show');overlay?.setAttribute('aria-hidden','true')}
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
  function warmFallback(raw){
    const q=raw.toLowerCase();
    if(/hello|hey|^hi\b/.test(q))return'Hi 👋🏽 I’m here. Ask me about the tracked job, what the current stage means, what is still pending, or when the next shipping handoff should happen.';
    if(/\bdetail(s)?\b|\babout this\b|\btell me about\b|\bwhat is this\b/.test(q))return'This TTG job is an order/parts shipment from the USA to Zambia. The item itself is paid in full. The seller shipment has reached the assigned shipping company, and TTG is now waiting for that company to confirm the international shipping charge. Once the charge is confirmed and paid, the next stage is dispatch toward Zambia. For USA shipments, the normal transit guide is about 21 working days after the international shipping handoff.';
    if(/\bnext\b|what happens/.test(q))return'The item is already paid in full. Right now the shipping company has the parcel and the next thing TTG is waiting for is their confirmed international shipping price. After that shipping cost is paid, the parcel can move into the Zambia transit stage.';
    if(/\busa\b|america/.test(q)&&/\bhow long\b|\bdays\b|\beta\b|\btime\b|\bdelivery\b|\barrive\b/.test(q))return'For USA parcels, use about 21 working days after the shipping company starts the international leg. Seller processing before that is separate.';
    if(/\buk\b|britain|england/.test(q)&&/\bhow long\b|\bdays\b|\beta\b|\btime\b|\bdelivery\b|\barrive\b/.test(q))return'UK parcels are usually about 14 working days or less after the shipping company receives and dispatches them.';
    if(/japan|japanese/.test(q))return'For genuine parts sourced from Japan, use about 14 working days as the normal guide after the shipping handoff.';
    if(/china/.test(q)&&/large|heavy|big|bulky|freight|sea/.test(q))return'Large or heavy items from China are the longer route: normally about 60–70 days. Small China parcels are usually around 7–14 working days.';
    if(/china/.test(q)&&/\bhow long\b|\bdays\b|\beta\b|\btime\b|\bdelivery\b|\barrive\b/.test(q))return'For a small parcel from China, use about 7–14 working days. Large or heavy China items are normally about 60–70 days.';
    if(/custom|clearance|duty/.test(q))return'Customs can add time after the international leg. If a customs or local handoff update is saved on the tracking record, I’ll show it here and explain what it means.';
    if(/receipt|invoice|disclaimer|quote|document/.test(q))return'Any linked TTG receipt, invoice, disclaimer, quote or master transaction reference can resolve the same tracking job. You don’t need the supplier’s private courier number.';
    return'I can explain the current tracking stage, payment/shipping status, what TTG is waiting for, delivery timing, seller or courier handoffs, customs, and the documents attached to this job. Ask me naturally.';
  }
  async function askMaya(text){try{const trackingId=normalizeId(trackingInput?.value);const res=await fetch('/api/maya',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:text,trackingId})});if(res.ok){const data=await res.json();if(data?.reply)return data.reply}}catch{}return warmFallback(text)}
  mayaForm?.addEventListener('submit',async e=>{e.preventDefault();const text=mayaInput?.value.trim();if(!text)return;addMessage(text,'user');mayaInput.value='';addTyping();const reply=await askMaya(text);await wait(260);removeTyping();addMessage(reply,'assistant')});
})();
