(()=>{
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
    }else{
      badge.textContent='Not found';badge.classList.add('bad');
    }
  });
  const centerCurrent=()=>{
    if(innerWidth<=900){
      const s=document.getElementById('steps'),c=s?.querySelector('.current');
      if(s&&c)s.scrollLeft=Math.max(0,c.offsetLeft-(s.clientWidth-c.clientWidth)/2);
    }
  };
  requestAnimationFrame(centerCurrent);
  window.addEventListener('resize',centerCurrent,{passive:true});
})();
function togglePanel(id,force){
  const el=document.getElementById(id);if(!el)return;
  const open=typeof force==='boolean'?force:!el.classList.contains('open');
  el.classList.toggle('open',open);
}
