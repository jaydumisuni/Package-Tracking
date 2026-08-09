const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: JSON_HEADERS
});

async function callHunter(env, message) {
  if (!env.HUNTER_API_URL || String(env.HUNTER_ENABLED || 'true').toLowerCase() === 'false') return null;

  const headers = { 'content-type': 'application/json' };
  if (env.HUNTER_API_KEY) headers.authorization = `Bearer ${env.HUNTER_API_KEY}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  const system = `You are Maya, THETECHGUY's tracking and shipping assistant. Be warm, natural and concise. The user may chat with you normally without selecting a tracking job. Only require a D1 tracking record when they ask for facts about a specific client's parcel, order, device or transaction. Never invent job-specific facts. You can explain TTG tracking IDs, phone-number tracking, shipping stages, seller/carrier handoffs, customs and delivery guidance. Shipping cost is normally confirmed at the Zambia local pickup center, after arrival in Zambia. Route guides: USA about 21 working days after international handoff; UK about 14 working days or less; Japan genuine parts about 14 working days; China small parcels about 7-14 working days; China large/heavy items about 60-70 days.`;

  try {
    const response = await fetch(env.HUNTER_API_URL, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: env.HUNTER_MODEL || 'hunter-cloudflare',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: String(message || '') }
        ],
        temperature: 0.45
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

function fallback(message) {
  const q = String(message || '').trim().toLowerCase();

  if (!q) return 'Ask me anything about TTG tracking or shipping.';

  if (/^(hi|hey|hello|yo|hiya)\b/.test(q)) {
    return 'Hey 👋🏽 I’m Maya. I handle tracking and shipping here. You can ask me normally about TTG IDs, phone-number tracking, delivery timing, shipping stages, customs or what happens next. For details about one specific job, track it first and I’ll read that D1 record.';
  }

  if (/what('?s| is) that|what do you mean|mm+\s*what/.test(q)) {
    return 'I mean you can talk to me normally here 🙂. I only need a selected D1 job when you want facts about a specific parcel or transaction, because I won’t guess client tracking details.';
  }

  if (/phone|number/.test(q) && /track|tracking|lookup|find/.test(q)) {
    return 'You can track with either a TTG ID or the phone number linked to the transaction. If that phone has several active jobs, the site shows them separately so you can choose the one you want without mixing their records.';
  }

  if (/shipping cost|shipping payment|pay shipping|delivery charge/.test(q)) {
    return 'For this tracking flow, the international shipping charge is normally confirmed after the parcel reaches the Zambia local pickup center. That is when the shipping-cost stage becomes due.';
  }

  if (/usa|america/.test(q) && /long|days|eta|delivery|arrive|time/.test(q)) {
    return 'USA shipments are normally guided at about 21 working days after the international shipping handoff.';
  }

  if (/\buk\b|britain|england/.test(q)) {
    return 'UK shipments are normally about 14 working days or less after the shipping handoff.';
  }

  if (/japan/.test(q)) {
    return 'For genuine parts from Japan, the normal guide is about 14 working days after the shipping handoff.';
  }

  if (/china/.test(q)) {
    if (/large|heavy|big|bulky|freight/.test(q)) return 'Large or heavy items from China are normally about 60–70 days.';
    return 'Small China parcels are normally about 7–14 working days. Large or heavy items are normally about 60–70 days.';
  }

  if (/custom|clearance|duty/.test(q)) {
    return 'Customs or local clearance can add time after the international leg. When a specific D1 job is open, I can explain its saved handoff and location updates without exposing private carrier references.';
  }

  return 'Sure — tell me what you want to know about tracking or shipping. If it is about a specific client job, track the TTG ID or linked phone number first so I can answer from the real D1 record.';
}

export async function handlePublicMaya(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/maya' || request.method !== 'POST') return null;

  const body = await request.clone().json().catch(() => ({}));
  if (body.trackingId) return null;

  const hunter = await callHunter(env, body.message);
  return json({
    ok: true,
    reply: hunter || fallback(body.message),
    source: hunter ? 'hunter' : 'tracking-fallback'
  });
}
