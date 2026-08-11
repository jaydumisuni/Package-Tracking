(()=>{
const $=id=>document.getElementById(id);
const STAGES=['intake_received','disclaimer_confirmed','deposit_received','parts_sourcing','parts_ordered','awaiting_seller_shipment','seller_shipped','shipping_company_received','in_transit_to_zambia','received_in_zambia','awaiting_shipping_cost','shipping_cost_paid','parts_received_by_ttg','repair_in_progress','testing','ready_for_collection','completed'];
const LABEL={intake_received:'Intake received',disclaimer_confirmed:'Disclaimer confirmed',deposit_received:'Order payment received',parts_sourcing:'Parts sourcing',parts_ordered:'Parts ordered',awaiting_seller_shipment:'Awaiting seller shipment',seller_shipped:'Seller shipped',shipping_company_received:'Shipping company received',in_transit_to_zambia:'In transit to Zambia',received_in_zambia:'Zambia local pickup center',awaiting_shipping_cost:'Awaiting shipping cost',shipping_cost_paid:'Shipping cost paid',parts_received_by_ttg:'Parts received by TTG',repair_in_progress:'Repair in progress',testing:'Testing',ready_for_collection:'Ready for collection',completed:'Completed'};
const REQUIRED=['reference','masterId','clientName','deviceItem','serviceType','route','stage'];
const RESULT_TEXT_IDS=['resultRef','publicReference','summaryReference','clientName','condition','deviceItem','serviceType','masterId','summaryMaster','route','summaryRoute','amountReceived','paymentMethod','orderPaymentStatus','shippingCostStatus','summaryPayment','summaryShippingCost','currentStatus','summaryStatus','statusNote','summaryLocation','summaryUpdated','lastUpdated','latestUpdate'];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const normId=v=>String(v||'').trim().toUpperCase();
const text=(id,v)=>{const el=$(id);if(el)el.textContent=(v===undefined||v===null||v==='')?'—':v};
const money=v=>typeof v==='number'?`ZMW ${v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`:v;
let clientJobs=[],activeReference='';
let mayaConversationId=sessionStorage.getItem('ttg_maya_conversation_id')||'';

function normalizePhone(value){let d=String(value||'').replace(/\D/g,'');if(d.startsWith('00'))d=d.slice(2);if(d.length===10&&d.startsWith('0'))d=`260${d.slice(1)}`;else if(d.length===9)d=`260${d}`;return d.length>=9&&d.length<=15?d:''}
function looksLikePhone(value){const raw=String(value||'').trim();return !/^TTG-/i.test(raw)&&Boolean(normalizePhone(raw))}
function missingRequired(r){return REQUIRED.filter(k=>!String(r?.[k]??'').trim())}
function validateJob(r){
  if(!r||r.found!==true){const e=new Error('tracking job not found');e.status=404;throw e}
  const missing=missingRequired(r);
  if(missing.length){const e=new Error(`tracking record incomplete: ${missing.join(', ')}`);e.status=409;e.missing=missing;throw e}
  return r;
}
function clearTrackingUrl(){
  const url=new URL(location.href);url.searchParams.delete('id');url.searchParams.delete('track');
  history.replaceState(null,'',`${url.pathname}${url.search}${url.hash}`);
}
function lookupNotice(){
  let el=$('lookupNotice');
  if(el)return el;
  const anchor=document.querySelector('.search-note')||$('searchForm');
  if(!anchor)return null;
  el=document.createElement('div');el.id='lookupNotice';el.className='lookup-notice';el.hidden=true;el.setAttribute('role','status');el.setAttribute('aria-live','polite');
  anchor.insertAdjacentElement('afterend',el);return el;
}
function showNotice(title,body,type='error'){
  const el=lookupNotice();if(!el)return;el.hidden=false;el.className=`lookup-notice ${type}`;el.innerHTML='';
  const strong=document.createElement('strong');strong.textContent=title;const span=document.createElement('span');span.textContent=body;el.append(strong,span);
}
function hideNotice(){const el=lookupNotice();if(el){el.hidden=true;el.textContent=''}}
function resetResult({clearUrl=false,clearNotice=true}={}){
  activeReference='';clientJobs=[];
  const area=$('resultArea'),badge=$('foundBadge');
  if(area)area.hidden=true;
  if(badge){badge.hidden=true;badge.textContent='Found';badge.classList.remove('bad')}
  document.querySelector('.client-job-picker')?.remove();
  document.getElementById('copyTrackingLink')?.remove();
  RESULT_TEXT_IDS.forEach(id=>text(id,'—'));
  updateStages('');
  if(clearNotice)hideNotice();
  if(clearUrl)clearTrackingUrl();
}
function updateStages(stage){const ix=STAGES.indexOf(stage);document.querySelectorAll('.step[data-stage]').forEach((el,i)=>{el.classList.toggle('done',ix>=0&&i<ix);el.classList.toggle('current',ix>=0&&i===ix);const s=el.querySelector('small');if(s)s.textContent=ix<0?'Pending':i<ix?'Completed':i===ix?'In progress':'Pending'});requestAnimationFrame(centerStage)}
function centerStage(){if(innerWidth>900)return;const s=$('steps'),c=s?.querySelector('.current');if(s&&c)s.scrollLeft=Math.max(0,c.offsetLeft-(s.clientWidth-c.clientWidth)/2)}
function jumpToProgress(){const el=$('jobProgress');if(!el)return;const go=()=>{const h=document.querySelector('.topbar')?.getBoundingClientRect().height||0;const top=el.getBoundingClientRect().top+scrollY-h-12;scrollTo({top:Math.max(0,top),behavior:'smooth'})};requestAnimationFrame(()=>requestAnimationFrame(go));setTimeout(go,300)}
function apply(r,id){
  validateJob(r);hideNotice();
  const ref=r.reference||id;
  text('resultRef',ref);text('publicReference',ref);text('summaryReference',ref);text('clientName',r.clientName);text('condition',r.condition);text('deviceItem',r.deviceItem);text('serviceType',r.serviceType);text('masterId',r.masterId);text('summaryMaster',r.masterId);text('route',r.route);text('summaryRoute',r.route);text('amountReceived',money(r.amountReceived));text('paymentMethod',r.paymentMethod);text('orderPaymentStatus',r.orderPaymentStatus||'Paid / confirmed');text('shippingCostStatus',r.shippingCostStatus||'Not yet due');text('summaryPayment',r.orderPaymentStatus||'Paid / confirmed');text('summaryShippingCost',r.shippingCostStatus||'Not yet due');
  const label=LABEL[r.stage]||r.status||'Tracking update';
  text('currentStatus',label);text('summaryStatus',label);text('statusNote',r.statusNote);text('summaryLocation',r.location||r.origin);text('summaryUpdated',r.updatedLabel);text('lastUpdated',`Last updated: ${r.updatedLabel||'—'} ↻`);
  const latest=$('latestUpdate');if(latest){latest.innerHTML='';const b=document.createElement('b');b.textContent=`${r.updatedLabel||'—'}${r.location||r.origin?` · ${r.location||r.origin}`:''}`;latest.append(b,document.createElement('br'),document.createTextNode(r.latestUpdate||r.statusNote||''))}
  updateStages(r.stage);activeReference=ref;const input=$('trackingInput');if(input)input.value=ref;syncSelector(ref);
  const area=$('resultArea'),badge=$('foundBadge');if(badge){badge.hidden=false;badge.textContent='Found';badge.classList.remove('bad')}if(area)area.hidden=false;
}
async function lookupJob(id){const res=await fetch(`/api/track?id=${encodeURIComponent(id)}`,{headers:{accept:'application/json'},cache:'no-store'});const data=await res.json().catch(()=>({}));if(!res.ok){const err=new Error(data.error||'tracking job not found');err.status=res.status;throw err}return validateJob(data)}
async function lookupPhone(raw){const phone=normalizePhone(raw);if(!phone){const e=new Error('valid phone number required');e.status=400;throw e}const res=await fetch(`/api/client-jobs?phone=${encodeURIComponent(phone)}`,{headers:{accept:'application/json'},cache:'no-store'});const data=await res.json().catch(()=>({}));if(!res.ok||data.found!==true||!Array.isArray(data.jobs)||!data.jobs.length){const err=new Error(data.error||'no active jobs found');err.status=res.status||404;throw err}return data}
function optionLabel(job){const item=(job.itemName||job.serviceType||'TTG job').trim();const stage=LABEL[job.stage]||String(job.stage||'Tracking').replaceAll('_',' ');return `${item} · ${stage} · ${job.reference}`}
function ensureSelector(jobs){const card=$('jobProgress'),h2=card?.querySelector(':scope > h2');if(!card||!h2)return;let head=card.querySelector('.client-job-head');if(!head){head=document.createElement('div');head.className='client-job-head';card.insertBefore(head,h2);head.appendChild(h2)}let picker=head.querySelector('.client-job-picker');if(jobs.length<=1){picker?.remove();return}if(!picker){picker=document.createElement('label');picker.className='client-job-picker';picker.innerHTML='<span>Active job</span><select aria-label="Select active tracking job"></select>';head.appendChild(picker);picker.querySelector('select').addEventListener('change',async e=>{const ref=e.target.value;if(!ref||ref===activeReference)return;const saved=[...clientJobs];resetResult({clearUrl:true});clientJobs=saved;showOverlay('Opening selected job…','Loading the selected tracking record.');try{const job=await lookupJob(ref);apply(job,ref);ensureSelector(clientJobs);hideOverlay();jumpToProgress()}catch(err){await showError(err,'job')}})}const select=picker.querySelector('select');select.innerHTML=jobs.map(j=>`<option value="${String(j.reference).replace(/"/g,'&quot;')}">${optionLabel(j)}</option>`).join('');syncSelector(activeReference||jobs[0]?.reference)}
function syncSelector(reference){const s=document.querySelector('.client-job-picker select');if(s&&[...s.options].some(o=>o.value===reference))s.value=reference}
const overlay=$('trackingOverlay'),ovH=overlay?.querySelector('h2'),ovP=overlay?.querySelector('p');
function showOverlay(title,body){if(ovH)ovH.textContent=title;if(ovP)ovP.textContent=body;overlay?.classList.add('show');overlay?.setAttribute('aria-hidden','false')}
function hideOverlay(){overlay?.classList.remove('show');overlay?.setAttribute('aria-hidden','true')}
async function showError(err,mode){
  let title='Tracking lookup failed',body='Please check the details and try again.';
  if(err?.status===404){title=mode==='phone'?'No tracking jobs found':'Tracking ID not found';body=mode==='phone'?'No active TTG jobs are linked to that phone number. Check the number used on your TTG documents and try again.':'No matching TTG tracking record was found. Check the ID and try again.'}
  else if(err?.status===409){title='Tracking record unavailable';body='This tracking record is not ready to display yet. Please contact THETECHGUY if you need an update.'}
  else if(err?.status===503){title='Tracking temporarily unavailable';body='The tracking service is temporarily unavailable. Please try again shortly.'}
  else if(err?.status===400){title='Check the phone number';body='Enter the phone number linked to your TTG receipt, invoice or order.'}
  showNotice(title,body);showOverlay(title,body);await wait(1100);hideOverlay();
}
async function submitSearch(raw){
  const value=String(raw||'').trim();resetResult({clearUrl:true});
  if(!value){showNotice('Enter your tracking details','Use a TTG ID or the phone number linked to your TTG documents.','info');return}
  const started=Date.now();
  if(looksLikePhone(value)){
    showOverlay('Finding your TTG jobs…','Checking jobs linked to this phone number.');
    try{const data=await lookupPhone(value);clientJobs=data.jobs;const first=await lookupJob(clientJobs[0].reference);apply(first,clientJobs[0].reference);ensureSelector(clientJobs);await wait(Math.max(0,700-(Date.now()-started)));hideOverlay();await wait(60);jumpToProgress()}catch(err){await showError(err,'phone')}return;
  }
  const id=normId(value);showOverlay('Tracking your TTG job…','Checking the latest saved tracking record.');
  try{const r=await lookupJob(id);apply(r,id);await wait(Math.max(0,700-(Date.now()-started)));hideOverlay();await wait(60);jumpToProgress()}catch(err){await showError(err,'job')}
}
$('searchForm')?.addEventListener('submit',e=>{e.preventDefault();submitSearch($('trackingInput')?.value||'')});
resetResult();requestAnimationFrame(centerStage);addEventListener('resize',centerStage,{passive:true});

const panel=$('tgai-panel'),fab=$('tgai-fab'),close=$('tgai-close'),card=$('mayaCardOpen'),mform=$('tgaiForm'),minput=$('tgaiInput'),msgs=$('tgaiMessages');let frozen=0;
function viewport(){const v=visualViewport,h=v?.height||innerHeight,t=v?.offsetTop||0;document.documentElement.style.setProperty('--vv-height',`${Math.round(h)}px`);document.documentElement.style.setProperty('--vv-top',`${Math.round(t)}px`)}
function lock(){if(document.body.classList.contains('tgai-open'))return;frozen=scrollY;document.body.style.top=`-${frozen}px`;document.body.classList.add('tgai-open');viewport()}
function unlock(){if(!document.body.classList.contains('tgai-open'))return;document.body.classList.remove('tgai-open');document.body.style.top='';scrollTo(0,frozen)}
function openMaya(){lock();panel?.classList.add('open');panel?.setAttribute('aria-hidden','false');viewport()}
function closeMaya(){minput?.blur();panel?.classList.remove('open');panel?.setAttribute('aria-hidden','true');unlock()}
fab?.addEventListener('click',openMaya);card?.addEventListener('click',openMaya);close?.addEventListener('click',closeMaya);visualViewport?.addEventListener('resize',viewport,{passive:true});visualViewport?.addEventListener('scroll',viewport,{passive:true});addEventListener('orientationchange',()=>setTimeout(viewport,120),{passive:true});
function addMsg(s,user=false){const d=document.createElement('div');d.className=`tgai-msg${user?' user':''}`;d.textContent=s;msgs?.appendChild(d);if(msgs)msgs.scrollTop=msgs.scrollHeight}
function typing(){const d=document.createElement('div');d.className='tgai-typing';d.id='tgaiTyping';d.textContent='Maya is typing…';msgs?.appendChild(d);if(msgs)msgs.scrollTop=msgs.scrollHeight}
async function askMaya(message){
  const payload={message,conversation_id:mayaConversationId||null};if(activeReference)payload.trackingId=activeReference;
  const res=await fetch('/api/maya',{method:'POST',headers:{'content-type':'application/json','x-ttg-source':'thetechguyds-tracking'},body:JSON.stringify(payload)});
  const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||'Maya is unavailable');
  if(data.conversation_id){mayaConversationId=data.conversation_id;sessionStorage.setItem('ttg_maya_conversation_id',mayaConversationId)}
  return data.reply||'I’m here. What can we sort out for you?';
}
mform?.addEventListener('submit',async e=>{e.preventDefault();const s=minput?.value.trim();if(!s)return;addMsg(s,true);minput.value='';typing();try{const reply=await askMaya(s);await wait(240);$('tgaiTyping')?.remove();addMsg(reply)}catch{$('tgaiTyping')?.remove();addMsg('I’m having trouble reaching the help desk right now. Please try me again in a moment.')}});
})();
