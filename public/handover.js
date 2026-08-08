(() => {
  const qs = new URLSearchParams(location.search);
  const token = String(qs.get('t') || '').trim();
  const loading = document.getElementById('loadingState');
  const empty = document.getElementById('emptyState');
  const form = document.getElementById('handoverForm');
  const success = document.getElementById('successState');
  const errorBox = document.getElementById('handoverError');
  const confirmButton = document.getElementById('confirmButton');
  const canvas = document.getElementById('signatureCanvas');
  const hint = document.getElementById('signatureHint');
  const ctx = canvas.getContext('2d');
  let drawing = false;
  let hasInk = false;
  let last = null;

  function setError(message) {
    errorBox.textContent = message || '';
    errorBox.classList.toggle('show', Boolean(message));
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const snapshot = hasInk ? canvas.toDataURL('image/png') : null;
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    ctx.setTransform(ratio,0,0,ratio,0,0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2.2;
    if (snapshot) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img,0,0,rect.width,rect.height);
      img.src = snapshot;
    }
  }

  function point(event) {
    const r = canvas.getBoundingClientRect();
    return {x:event.clientX-r.left,y:event.clientY-r.top};
  }

  canvas.addEventListener('pointerdown', event => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    drawing = true;
    last = point(event);
  });
  canvas.addEventListener('pointermove', event => {
    if (!drawing) return;
    event.preventDefault();
    const p = point(event);
    ctx.beginPath();
    ctx.moveTo(last.x,last.y);
    ctx.lineTo(p.x,p.y);
    ctx.stroke();
    last = p;
    hasInk = true;
    hint.hidden = true;
  });
  const finish = event => {
    if (!drawing) return;
    event?.preventDefault?.();
    drawing = false;
    last = null;
  };
  canvas.addEventListener('pointerup',finish);
  canvas.addEventListener('pointercancel',finish);
  window.addEventListener('resize',() => requestAnimationFrame(resizeCanvas));

  document.getElementById('clearSignature').addEventListener('click',() => {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    hasInk = false;
    hint.hidden = false;
  });

  async function openRecord() {
    if (!token) {
      loading.hidden = true;
      empty.hidden = false;
      return;
    }
    try {
      const response = await fetch(`/api/handover?token=${encodeURIComponent(token)}`,{cache:'no-store'});
      const data = await response.json().catch(()=>({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Unable to open this handover link.');
      document.getElementById('clientName').textContent = data.clientName || '—';
      document.getElementById('publicReference').textContent = data.publicReference || '—';
      document.getElementById('itemName').textContent = data.itemName || '—';
      document.getElementById('serviceType').textContent = data.serviceType || '—';
      document.getElementById('amountPaid').textContent = data.amountPaid || '—';
      document.getElementById('masterId').textContent = data.masterId || '—';
      document.getElementById('handoverMethod').textContent = data.handoverMethod === 'in_store' ? 'In-store handover' : 'Customer confirmation link';
      document.getElementById('signedName').value = data.clientName || '';
      loading.hidden = true;
      form.hidden = false;
      requestAnimationFrame(resizeCanvas);
    } catch (error) {
      loading.hidden = true;
      empty.hidden = false;
      empty.querySelector('h2').textContent = 'Handover link unavailable';
      empty.querySelector('p').textContent = error.message || 'This handover link is invalid or has expired.';
    }
  }

  form.addEventListener('submit',async event => {
    event.preventDefault();
    setError('');
    const signedName = document.getElementById('signedName').value.trim();
    const accepted = document.getElementById('accepted').checked;
    if (!signedName) return setError('Enter the full name of the person receiving the item.');
    if (!hasInk) return setError('Please sign in the signature box.');
    if (!accepted) return setError('Please confirm the hand over statement.');
    confirmButton.disabled = true;
    confirmButton.textContent = 'Saving confirmation…';
    try {
      const signature = canvas.toDataURL('image/png');
      const response = await fetch('/api/handover/confirm',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({token,signedName,signature,accepted:true})
      });
      const data = await response.json().catch(()=>({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Unable to complete the hand over.');
      form.hidden = true;
      success.classList.add('show');
    } catch (error) {
      setError(error.message || 'Unable to complete the hand over. Please try again.');
      confirmButton.disabled = false;
      confirmButton.textContent = 'Confirm Hand Over';
    }
  });

  openRecord();
})();