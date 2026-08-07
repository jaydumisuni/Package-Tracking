(()=>{
  const harden=document.createElement('style');
  harden.textContent=`
html,body{width:100%;max-width:100%;overflow-x:hidden}
.page,.hero,.dashboard,.maincol,.sidebar,.result-card,.progress-card,.lower-grid,.detail-grid,.mobile-estimates{min-width:0;max-width:100%}
.dashboard>*{min-width:0}
.chips{min-width:0;max-width:100%}
@media(max-width:900px){
  .dashboard,.maincol,.result-card,.progress-card,.lower-grid,.sidebar{width:100%;min-width:0;max-width:100%}
  .steps{width:100%;max-width:100%;min-width:0;grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:82px;overflow-x:auto;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;contain:inline-size}
}
@media(max-width:600px){
  .steps{grid-auto-columns:74px}
  .result-head,.detail-grid,.status,.lower-grid,.summary-card,.maya-card,.mobile-estimates{min-width:0;max-width:100%}
  .detail,.detail>div{min-width:0}
  .detail b,.detail small{overflow-wrap:anywhere}
  .hero-copy h1,.hero-copy p,.search,.search-input,.search-input input{min-width:0;max-width:100%}
}`;
  document.head.appendChild(harden);

  const form=document.getElementById('searchForm');
  const input=document.getElementById('trackingInput');
  const ref=document.getElementById('resultRef');
  const badge=document.getElementById('foundBadge');
  const ok=/^TTG-(RCP|INV|DOC|QTE|TXN)-0*60$/i;
  form.addEventListener('submit',e=>{
    e.preventDefault();
    const id=input.value.trim().toUpperCase();
    ref.textContent=id||'—';
    if(ok.test(id)){
      badge.textContent='Found';badge.classList.remove('bad');
      document.getElementById('resultArea').scrollIntoView({behavior:'smooth',block:'start'});
    }else{badge.textContent='Not found';badge.classList.add('bad')}
  });
  const centerCurrent=()=>{if(innerWidth<=900){const s=document.getElementById('steps'),c=s?.querySelector('.current');if(s&&c)s.scrollLeft=Math.max(0,c.offsetLeft-(s.clientWidth-c.clientWidth)/2)}};
  requestAnimationFrame(centerCurrent);window.addEventListener('resize',centerCurrent,{passive:true});
})();
function togglePanel(id,force){const el=document.getElementById(id);if(!el)return;const open=typeof force==='boolean'?force:!el.classList.contains('open');el.classList.toggle('open',open)}
