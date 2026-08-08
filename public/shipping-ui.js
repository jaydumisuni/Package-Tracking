(()=>{
const ORDER=['intake_received','disclaimer_confirmed','deposit_received','parts_sourcing','parts_ordered','awaiting_seller_shipment','seller_shipped','shipping_company_received','in_transit_to_zambia','received_in_zambia','awaiting_shipping_cost','shipping_cost_paid','parts_received_by_ttg','repair_in_progress','testing','ready_for_collection','completed'];
const LABEL={
  intake_received:'Intake<br>received',
  disclaimer_confirmed:'Disclaimer<br>confirmed',
  deposit_received:'Order payment<br>received',
  parts_sourcing:'Parts<br>sourcing',
  parts_ordered:'Parts<br>ordered',
  awaiting_seller_shipment:'Awaiting seller<br>shipment',
  seller_shipped:'Seller<br>shipped',
  shipping_company_received:'Shipping company<br>received',
  in_transit_to_zambia:'In transit to<br>Zambia',
  received_in_zambia:'Zambia local<br>pickup center',
  awaiting_shipping_cost:'Awaiting shipping<br>cost',
  shipping_cost_paid:'Shipping cost<br>paid',
  parts_received_by_ttg:'Parts received<br>by TTG',
  repair_in_progress:'Repair in<br>progress',
  testing:'Testing',
  ready_for_collection:'Ready for<br>collection',
  completed:'Completed'
};
const $=id=>document.getElementById(id);
const NOT_DUE='Not yet due — confirmed at Zambia local pickup center';
const LOCAL='Pending confirmation at Zambia local pickup center';
let fixing=false;
function inZambia(){return /(zambia|lusaka|kitwe|ndola|livingstone|\bzm\b)/i.test(($('summaryLocation')?.textContent||'')+' '+($('route')?.textContent||''));}
function steps(){return [...document.querySelectorAll('#steps .step[data-stage]')]}
function visualStage(){let current=document.querySelector('#steps .step.current')?.dataset.stage||'';if(current==='awaiting_shipping_cost'&&!inZambia())current='shipping_company_received';return current}
function relabel(){steps().forEach(el=>{const st=el.dataset.stage,ix=ORDER.indexOf(st);if(ix<0)return;el.style.order=String(ix);const i=el.querySelector('i');if(i&&st!=='completed')i.textContent=String(ix+1);const span=el.querySelector('span');if(span&&LABEL[st])span.innerHTML=LABEL[st]})}
function repair(){if(fixing)return;fixing=true;relabel();const current=visualStage(),ix=ORDER.indexOf(current);if(ix>=0){steps().forEach(el=>{const p=ORDER.indexOf(el.dataset.stage),small=el.querySelector('small');el.classList.toggle('done',p<ix);el.classList.toggle('current',p===ix);if(small)small.textContent=p<ix?'Completed':p===ix?'In progress':'Pending'});const cost=$('shippingCostStatus'),sumCost=$('summaryShippingCost');if(current==='shipping_company_received'||current==='in_transit_to_zambia'){if(cost)cost.textContent=NOT_DUE;if(sumCost)sumCost.textContent=NOT_DUE}else if(current==='received_in_zambia'){if(cost&&(cost.textContent==='—'||/not yet due|awaiting shipping company quote/i.test(cost.textContent)))cost.textContent=LOCAL;if(sumCost&&(sumCost.textContent==='—'||/not yet due|awaiting shipping company quote/i.test(sumCost.textContent)))sumCost.textContent=LOCAL}
if(current==='shipping_company_received'){if($('currentStatus'))$('currentStatus').textContent='Shipping company received';if($('summaryStatus'))$('summaryStatus').textContent='Shipping company received';const note=$('statusNote');if(note&&/shipping (cost|charge|price)|waiting.*shipping/i.test(note.textContent))note.textContent='The parcel has reached the assigned origin shipping company. The next logistics stage is international transit toward Zambia. Shipping cost is normally confirmed later, after the parcel reaches the Zambia local pickup center.'}
const wrap=$('steps'),cur=wrap?.querySelector('.current');if(wrap&&cur&&innerWidth<=900)requestAnimationFrame(()=>{wrap.scrollLeft=Math.max(0,cur.offsetLeft-(wrap.clientWidth-cur.clientWidth)/2)})}
fixing=false}
const target=$('steps');if(target){new MutationObserver(()=>requestAnimationFrame(repair)).observe(target,{subtree:true,attributes:true,attributeFilter:['class'],childList:true});repair()}
new MutationObserver(()=>requestAnimationFrame(repair)).observe(document.getElementById('resultArea')||document.body,{subtree:true,childList:true,characterData:true});
addEventListener('resize',()=>requestAnimationFrame(repair),{passive:true});
})();
