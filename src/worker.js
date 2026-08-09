const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

const STAGES = [
  'intake_received',
  'disclaimer_confirmed',
  'deposit_received',
  'parts_sourcing',
  'parts_ordered',
  'awaiting_seller_shipment',
  'seller_shipped',
  'shipping_company_received',
  'in_transit_to_zambia',
  'received_in_zambia',
  'awaiting_shipping_cost',
  'shipping_cost_paid',
  'parts_received_by_ttg',
  'repair_in_progress',
  'testing',
  'ready_for_collection',
  'completed'
];

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
const normalizeRef = value => String(value || '').trim().toUpperCase();
const now = () => new Date().toISOString();
const pretty = value => String(value || '').replaceAll('_', ' ');

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: 'Africa/Lusaka'
  }).format(d).replace(',', '');
}

async function lookupJob(db, reference) {
  const ref = normalizeRef(reference);
  const row = await db.prepare(`
    SELECT DISTINCT j.*
    FROM tracking_jobs j
    LEFT JOIN tracking_aliases a ON a.job_id = j.id
    WHERE a.alias = ?1 OR j.master_transaction_id = ?1 OR j.public_reference = ?1
    LIMIT 1
  `).bind(ref).first();

  if (!row) return null;

  const updates = await db.prepare(`
    SELECT stage, note, location, source, created_at
    FROM tracking_updates
    WHERE job_id = ?1
    ORDER BY created_at ASC, id ASC
    LIMIT 100
  `).bind(row.id).all();

  const events = (updates.results || []).map(update => ({
    stage: update.stage || '',
    label: update.note || '',
    location: update.location || '',
    source: update.source || 'TTG update',
    createdAt: update.created_at || ''
  }));

  const latest = events.length ? events[events.length - 1] : null;
  const shippingCostAmount = row.shipping_cost_amount
    ? `${row.shipping_cost_currency || row.currency || 'ZMW'} ${Number(row.shipping_cost_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '';

  return {
    found: true,
    reference: ref,
    masterId: row.master_transaction_id,
    clientName: row.client_name,
    condition: row.item_condition,
    deviceItem: row.item_name,
    serviceType: row.service_type,
    route: row.route,
    origin: row.origin_country,
    location: latest?.location || row.current_location || row.origin_country,
    amountReceived: row.amount_received
      ? `${row.currency || 'ZMW'} ${Number(row.amount_received).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : '',
    paymentMethod: row.payment_method || '',
    orderPaymentStatus: row.order_payment_status || '',
    shippingCostStatus: row.shipping_cost_status || '',
    shippingCostAmount,
    stage: latest?.stage || row.current_stage,
    updatedLabel: latest?.createdAt || row.updated_at,
    statusNote: latest?.label || row.status_note || '',
    latestUpdate: latest?.label || row.status_note || '',
    events
  };
}

async function requireAdmin(request, env) {
  return Boolean(env.ADMIN_TOKEN) && (request.headers.get('authorization') || '') === `Bearer ${env.ADMIN_TOKEN}`;
}

async function resolveJobId(db, reference) {
  const row = await db.prepare(`
    SELECT DISTINCT j.id AS job_id
    FROM tracking_jobs j
    LEFT JOIN tracking_aliases a ON a.job_id = j.id
    WHERE a.alias = ?1 OR j.master_transaction_id = ?1 OR j.public_reference = ?1
    LIMIT 1
  `).bind(normalizeRef(reference)).first();
  return row?.job_id || null;
}

async function upsertJob(db, body) {
  const job = body.job || {};
  const master = normalizeRef(job.masterTransactionId);
  const publicReference = normalizeRef(job.publicReference || master);
  if (!master) return json({ ok: false, error: 'masterTransactionId required' }, 400);

  await db.prepare(`
    INSERT INTO tracking_jobs(
      master_transaction_id, public_reference, client_name, item_name, item_condition,
      service_type, route, origin_country, destination_country, amount_received,
      currency, payment_method, order_payment_status, shipping_cost_status,
      shipping_cost_amount, shipping_cost_currency, current_stage, status_note,
      current_location, updated_at
    ) VALUES(
      ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20
    )
    ON CONFLICT(master_transaction_id) DO UPDATE SET
      public_reference=excluded.public_reference,
      client_name=excluded.client_name,
      item_name=excluded.item_name,
      item_condition=excluded.item_condition,
      service_type=excluded.service_type,
      route=excluded.route,
      origin_country=excluded.origin_country,
      destination_country=excluded.destination_country,
      amount_received=excluded.amount_received,
      currency=excluded.currency,
      payment_method=excluded.payment_method,
      order_payment_status=excluded.order_payment_status,
      shipping_cost_status=excluded.shipping_cost_status,
      shipping_cost_amount=excluded.shipping_cost_amount,
      shipping_cost_currency=excluded.shipping_cost_currency,
      current_stage=excluded.current_stage,
      status_note=excluded.status_note,
      current_location=excluded.current_location,
      updated_at=excluded.updated_at
  `).bind(
    master,
    publicReference,
    job.clientName || '',
    job.itemName || '',
    job.condition || '',
    job.serviceType || '',
    job.route || '',
    job.originCountry || '',
    job.destinationCountry || 'Zambia',
    Number(job.amountReceived || 0),
    job.currency || 'ZMW',
    job.paymentMethod || '',
    job.orderPaymentStatus || '',
    job.shippingCostStatus || '',
    job.shippingCostAmount == null ? null : Number(job.shippingCostAmount),
    job.shippingCostCurrency || job.currency || 'ZMW',
    job.currentStage || 'intake_received',
    job.statusNote || '',
    job.currentLocation || '',
    now()
  ).run();

  const saved = await db.prepare('SELECT id FROM tracking_jobs WHERE master_transaction_id=?1').bind(master).first();
  const aliases = new Set([master, publicReference, ...(body.aliases || []).map(normalizeRef)].filter(Boolean));
  for (const alias of aliases) {
    await db.prepare(`
      INSERT INTO tracking_aliases(alias, job_id) VALUES(?1,?2)
      ON CONFLICT(alias) DO UPDATE SET job_id=excluded.job_id
    `).bind(alias, saved.id).run();
  }

  return json({ ok: true, id: saved.id, masterTransactionId: master, aliases: [...aliases] });
}

async function addUpdate(db, body) {
  const jobId = await resolveJobId(db, body.reference);
  if (!jobId) return json({ ok: false, error: 'tracking job not found' }, 404);

  const stage = body.stage || '';
  if (stage && !STAGES.includes(stage)) return json({ ok: false, error: 'invalid stage' }, 400);
  const createdAt = body.createdAt || now();

  await db.prepare(`
    INSERT INTO tracking_updates(job_id,stage,note,location,source,created_at)
    VALUES(?1,?2,?3,?4,?5,?6)
  `).bind(jobId, stage || null, body.note || '', body.location || '', body.source || 'TTG update', createdAt).run();

  if (stage) {
    await db.prepare(`
      UPDATE tracking_jobs SET current_stage=?1,status_note=?2,current_location=?3,updated_at=?4 WHERE id=?5
    `).bind(stage, body.note || '', body.location || '', createdAt, jobId).run();
  }

  if (body.orderPaymentStatus !== undefined) {
    await db.prepare('UPDATE tracking_jobs SET order_payment_status=?1,updated_at=?2 WHERE id=?3')
      .bind(body.orderPaymentStatus || '', createdAt, jobId).run();
  }

  if (body.shippingCostStatus !== undefined || body.shippingCostAmount !== undefined) {
    await db.prepare(`
      UPDATE tracking_jobs SET
        shipping_cost_status=COALESCE(?1,shipping_cost_status),
        shipping_cost_amount=COALESCE(?2,shipping_cost_amount),
        shipping_cost_currency=COALESCE(?3,shipping_cost_currency),
        updated_at=?4
      WHERE id=?5
    `).bind(
      body.shippingCostStatus ?? null,
      body.shippingCostAmount == null ? null : Number(body.shippingCostAmount),
      body.shippingCostCurrency ?? null,
      createdAt,
      jobId
    ).run();
  }

  return json({ ok: true, jobId, stage, createdAt });
}

async function linkCarrier(db, body) {
  const jobId = await resolveJobId(db, body.reference);
  if (!jobId) return json({ ok: false, error: 'tracking job not found' }, 404);
  if (!body.carrier || !body.trackingNumber) return json({ ok: false, error: 'carrier and trackingNumber required' }, 400);

  await db.prepare(`
    INSERT INTO carrier_shipments(job_id,leg_type,carrier,tracking_number,provider,active,created_at,updated_at)
    VALUES(?1,?2,?3,?4,?5,1,?6,?6)
  `).bind(
    jobId,
    body.legType || 'seller_to_forwarder',
    String(body.carrier).toLowerCase(),
    String(body.trackingNumber).trim(),
    body.provider || String(body.carrier).toLowerCase(),
    now()
  ).run();

  return json({ ok: true, jobId, carrier: body.carrier, legType: body.legType || 'seller_to_forwarder' });
}

function routeEstimate(origin = '', question = '') {
  const text = `${origin} ${question}`.toLowerCase();
  if (/japan|japanese/.test(text)) return 'For genuine parts from Japan, the normal guide is about 14 working days after the shipping handoff.';
  if (/\buk\b|britain|england/.test(text)) return 'For UK shipments, the normal guide is about 14 working days or less after the shipping handoff.';
  if (/china/.test(text)) {
    if (/large|heavy|big|bulky|freight|sea/.test(text)) return 'For large or heavy items from China, the normal guide is about 60–70 days.';
    return 'For small China parcels, the normal guide is about 7–14 working days; large or heavy China items are about 60–70 days.';
  }
  if (/usa|united states|america/.test(text)) return 'For USA shipments, the normal guide is about 21 working days after the international shipping handoff.';
  return '';
}

function eventTimeline(record, max = 8) {
  const events = Array.isArray(record?.events) ? record.events.slice(-max) : [];
  return events.map(event => `${formatDate(event.createdAt) || 'Date saved'} — ${event.label || pretty(event.stage)}${event.location ? ` · ${event.location}` : ''}`).join('\n');
}

function detailSummary(record, question = '') {
  if (!record) return 'I can give you the job details once I have a valid D1 tracking record.';
  const lines = [`Here are the details for ${record.reference}:`];
  if (record.serviceType || record.deviceItem) lines.push(`${record.serviceType || 'Tracked TTG job'}${record.deviceItem ? ` — ${record.deviceItem}` : ''}.`);
  if (record.route) lines.push(`Route: ${record.route}.`);
  if (record.orderPaymentStatus) lines.push(`Order payment: ${record.orderPaymentStatus}.`);
  if (record.shippingCostStatus) lines.push(`International shipping cost: ${record.shippingCostStatus}${record.shippingCostAmount ? ` (${record.shippingCostAmount})` : ''}.`);
  lines.push(`Current stage: ${pretty(record.stage)}.`);
  if (record.statusNote) lines.push(record.statusNote);
  const timeline = eventTimeline(record);
  if (timeline) lines.push(`Dated history:\n${timeline}`);
  const eta = routeEstimate(record.origin || record.route, question);
  if (eta) lines.push(eta);
  return lines.join('\n');
}

function mayaFallback(message, record) {
  const q = String(message || '').toLowerCase();
  const stage = pretty(record?.stage);
  if (/hello|hey|^hi\b/.test(q)) return record ? `Hi 👋🏽 I’ve got this tracking job open. The current stage is ${stage}. Ask me anything about it.` : 'Hi 👋🏽 I’m Maya. Track a valid D1 job first and I can explain it.';
  if (/\bdetail(s)?\b|\babout this\b|\btell me about\b|\bwhat is this\b|\binformation\b|\bsummary\b/.test(q)) return detailSummary(record, q);
  if (/\bdate(s)?\b|\bwhen\b|\btimeline\b|\bhistory\b/.test(q) && record) {
    const timeline = eventTimeline(record, 12);
    return timeline ? `Here’s the dated tracking history for ${record.reference}:\n${timeline}` : 'There are no dated tracking events saved yet.';
  }
  if (/where|status|track/.test(q) && record) return [`The latest TTG stage is ${stage}.`, record.statusNote || '', record.shippingCostStatus ? `Shipping cost status: ${record.shippingCostStatus}.` : '', eventTimeline(record, 3) ? `Latest dated events:\n${eventTimeline(record, 3)}` : ''].filter(Boolean).join('\n');
  if (/\bnext\b|what happens/.test(q) && record) {
    const index = STAGES.indexOf(record.stage);
    const next = index >= 0 && index < STAGES.length - 1 ? pretty(STAGES[index + 1]) : 'completion';
    return `You’re currently at ${stage}. The next TTG stage is ${next}. ${record.orderPaymentStatus ? `The order payment is ${record.orderPaymentStatus}. ` : ''}${record.shippingCostStatus ? `Shipping cost is ${record.shippingCostStatus}.` : ''}`;
  }
  if (/\beta\b|\bhow long\b|\bdays\b|\barrive\b|\bdelivery\b|\btime\b/.test(q)) return routeEstimate(record?.origin || record?.route || '', q) || 'Transit timing depends on the origin and shipping handoff.';
  if (/custom|clearance|duty/.test(q)) return 'Customs or local clearance can add time after the international leg. Saved customs and local handoff updates stay in the dated tracking history.';
  if (/receipt|invoice|disclaimer|quote|document/.test(q)) return 'A linked TTG receipt, invoice, disclaimer, quote or master transaction ID resolves to the same D1 job.';
  return record ? `I can help with this job’s current stage (${stage}), dated history, payment and shipping-cost status, what happens next, ETA, customs or documents.` : 'Track a valid D1 job first and I can help with shipping and tracking.';
}

async function hunterReply(env, message, record) {
  if (!env.HUNTER_API_URL || String(env.HUNTER_ENABLED || 'true').toLowerCase() === 'false') return null;
  const system = `You are Maya, THETECHGUY's tracking assistant. Be warm, concise and conversational. Answer the actual question first. Exact saved dates/times in tracking events are important client-facing facts: include relevant dates whenever the user asks for details, status, history or what happened. After answering, add ETA only when useful. Stay within shipping, procurement/order progress, payment/shipping-cost status, customs and TTG documents. Never reveal private carrier tracking numbers. Route guides: USA ~21 working days after international handoff; UK ~14 working days or less; Japan genuine parts ~14 working days; China small parcels ~7–14 working days; China large/heavy items ~60–70 days. Seller processing before shipping-company handoff is separate. Tracking record: ${JSON.stringify(record || null)}`;
  const headers = { 'content-type': 'application/json' };
  if (env.HUNTER_API_KEY) headers.authorization = `Bearer ${env.HUNTER_API_KEY}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(env.HUNTER_API_URL, {
      method: 'POST', headers, signal: controller.signal,
      body: JSON.stringify({
        model: env.HUNTER_MODEL || 'hunter-cloudflare',
        messages: [{ role: 'system', content: system }, { role: 'user', content: String(message || '') }],
        temperature: 0.35
      })
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.choices?.[0]?.message?.content?.trim() || data?.reply?.trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fedexToken(env) {
  if (!env.FEDEX_TOKEN_URL || !env.FEDEX_API_KEY || !env.FEDEX_SECRET_KEY) return null;
  const response = await fetch(env.FEDEX_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.FEDEX_API_KEY, client_secret: env.FEDEX_SECRET_KEY })
  });
  if (!response.ok) return null;
  return (await response.json()).access_token || null;
}

function mapCarrierStage(legType, statusText, eventText, countryCode) {
  const text = `${statusText || ''} ${eventText || ''}`.toLowerCase();
  if (legType === 'seller_to_forwarder') {
    if (/delivered/.test(text)) return 'shipping_company_received';
    if (/picked up|possession|arrived|departed|transit|shipment/.test(text)) return 'seller_shipped';
  }
  if (legType === 'international_to_zambia') {
    if (String(countryCode || '').toUpperCase() === 'ZM' || /zambia|delivered/.test(text)) return 'received_in_zambia';
    if (/transit|departed|picked up|possession/.test(text)) return 'in_transit_to_zambia';
  }
  return null;
}

async function syncFedexShipment(db, shipment, env) {
  if (!env.FEDEX_TRACK_URL) return;
  const token = await fedexToken(env);
  if (!token) return;

  const response = await fetch(env.FEDEX_TRACK_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-locale': 'en_US' },
    body: JSON.stringify({ includeDetailedScans: true, trackingInfo: [{ trackingNumberInfo: { trackingNumber: shipment.tracking_number } }] })
  });
  if (!response.ok) return;

  const track = (await response.json())?.output?.completeTrackResults?.[0]?.trackResults?.[0];
  if (!track) return;
  const statusText = track?.latestStatusDetail?.description || '';
  const scans = Array.isArray(track?.scanEvents) ? [...track.scanEvents].reverse() : [];
  let latest = null;

  for (const scan of scans) {
    const eventText = scan?.eventDescription || statusText;
    const country = scan?.scanLocation?.countryCode || '';
    const location = [scan?.scanLocation?.city, scan?.scanLocation?.stateOrProvinceCode, country].filter(Boolean).join(', ');
    const eventAt = scan?.date || now();
    const stage = mapCarrierStage(shipment.leg_type, statusText, eventText, country);
    const note = `${shipment.carrier.toUpperCase()}: ${eventText}${location ? ` · ${location}` : ''}`;
    const existing = await db.prepare(`
      SELECT id FROM tracking_updates WHERE job_id=?1 AND source=?2 AND note=?3 AND created_at=?4 LIMIT 1
    `).bind(shipment.job_id, `carrier:${shipment.carrier}`, note, eventAt).first();
    if (!existing) {
      await db.prepare(`
        INSERT INTO tracking_updates(job_id,stage,note,location,source,created_at) VALUES(?1,?2,?3,?4,?5,?6)
      `).bind(shipment.job_id, stage || null, note, location, `carrier:${shipment.carrier}`, eventAt).run();
    }
    latest = { stage, note, location, eventAt };
  }

  await db.prepare(`
    UPDATE carrier_shipments SET last_status=?1,last_event_at=?2,last_checked_at=?3,updated_at=?3 WHERE id=?4
  `).bind(latest?.note || statusText, latest?.eventAt || now(), now(), shipment.id).run();

  if (latest?.stage) {
    await db.prepare(`
      UPDATE tracking_jobs SET current_stage=?1,status_note=?2,current_location=?3,updated_at=?4 WHERE id=?5
    `).bind(latest.stage, latest.note, latest.location, latest.eventAt, shipment.job_id).run();
  }
}

async function syncCarriers(env) {
  const db = env.TRACKING_DB;
  if (!db) return;
  const rows = await db.prepare(`
    SELECT * FROM carrier_shipments WHERE active=1 ORDER BY COALESCE(last_checked_at,'') ASC LIMIT 25
  `).all();
  for (const shipment of rows.results || []) {
    if (shipment.provider === 'fedex' || shipment.carrier === 'fedex') await syncFedexShipment(db, shipment, env);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({ ok: true, worker: 'package-tracking', d1Bound: Boolean(env.TRACKING_DB), assetsBound: Boolean(env.ASSETS) });
    }

    if (url.pathname === '/api/track' && request.method === 'GET') {
      if (!env.TRACKING_DB) return json({ found: false, error: 'tracking database unavailable' }, 503);
      const id = normalizeRef(url.searchParams.get('id'));
      if (!id) return json({ found: false, error: 'tracking id required' }, 400);
      const record = await lookupJob(env.TRACKING_DB, id);
      return record ? json(record) : json({ found: false }, 404);
    }

    if (url.pathname === '/api/maya' && request.method === 'POST') {
      if (!env.TRACKING_DB) return json({ ok: false, error: 'tracking database unavailable' }, 503);
      const body = await request.json().catch(() => ({}));
      const record = body.trackingId ? await lookupJob(env.TRACKING_DB, body.trackingId) : null;
      const hunter = await hunterReply(env, body.message, record);
      return json({ ok: true, reply: hunter || mayaFallback(body.message, record), source: hunter ? 'hunter' : 'fallback' });
    }

    if (url.pathname.startsWith('/api/admin/')) {
      if (!await requireAdmin(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);
      if (!env.TRACKING_DB) return json({ ok: false, error: 'TRACKING_DB is not bound' }, 503);
      const body = await request.json().catch(() => ({}));
      if (url.pathname === '/api/admin/jobs/upsert' && request.method === 'POST') return upsertJob(env.TRACKING_DB, body);
      if (url.pathname === '/api/admin/jobs/update' && request.method === 'POST') return addUpdate(env.TRACKING_DB, body);
      if (url.pathname === '/api/admin/carriers/link' && request.method === 'POST') return linkCarrier(env.TRACKING_DB, body);
      if (url.pathname === '/api/admin/carriers/sync' && request.method === 'POST') {
        ctx.waitUntil(syncCarriers(env));
        return json({ ok: true, queued: true });
      }
    }

    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  },

  async scheduled(_event, env, ctx) {
    if (env.TRACKING_DB) ctx.waitUntil(syncCarriers(env));
  }
};