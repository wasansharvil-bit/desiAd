const ALLOWED_METHODS = 'GET, POST, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, api-subscription-key';
const DEFAULT_MAX_AGE = '86400';
const MAX_FIELD_LENGTH = 200;
const RATE_LIMIT_REQUESTS = 10;       // max requests per IP per window
const RATE_LIMIT_WINDOW_SECONDS = 60; // rolling window in seconds

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'interest-cohort=()',
};

const SYSTEM_PROMPT = `You are a marketing expert specializing in Indian regional businesses. Generate culturally relevant, engaging advertisements in the requested Indian language. Keep tone appropriate and include local flavor if relevant.`;

function buildCorsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Max-Age': DEFAULT_MAX_AGE,
  };
}

function jsonResponse(body, init = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...SECURITY_HEADERS,
    ...init.headers,
  };
  return new Response(JSON.stringify(body), { ...init, headers });
}

function getAllowedOrigin(request, env) {
  const requestOrigin = request.headers.get('Origin');
  if (env.ALLOWED_ORIGIN === '*') return '*';
  if (!requestOrigin) return 'null';
  // Do not reflect arbitrary requester origin — deny if not on whitelist
  if (!env.ALLOWED_ORIGIN) return 'null';
  const allowed = env.ALLOWED_ORIGIN.split(',').map((o) => o.trim());
  return allowed.includes(requestOrigin) ? requestOrigin : 'null';
}

async function handleOptions(request, env) {
  const corsOrigin = getAllowedOrigin(request, env);
  return new Response(null, { status: 204, headers: buildCorsHeaders(corsOrigin) });
}

// KV-based IP rate limiting. Requires a KV namespace bound as RATE_LIMITER in wrangler.toml.
async function checkRateLimit(request, env) {
  if (!env.RATE_LIMITER) return false; // skip gracefully if KV not configured
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const key = `rl:${ip}`;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - RATE_LIMIT_WINDOW_SECONDS;

  const raw = await env.RATE_LIMITER.get(key);
  const timestamps = raw ? JSON.parse(raw) : [];
  const recent = timestamps.filter((t) => t > windowStart);

  if (recent.length >= RATE_LIMIT_REQUESTS) return true;

  recent.push(now);
  await env.RATE_LIMITER.put(key, JSON.stringify(recent), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS });
  return false;
}

// Strip characters commonly used in prompt injection attacks
function sanitizeField(value) {
  return value.replace(/[`\\]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

async function proxyToSarvam({ payload, env, corsOrigin }) {
  const sarvamResp = await fetch('https://api.sarvam.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-subscription-key': env.SARVAM_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  const text = await sarvamResp.text();
  if (!sarvamResp.ok) {
    // Do not forward raw upstream body — it may contain sensitive API details
    return jsonResponse(
      { error: 'Upstream API error', upstreamStatus: sarvamResp.status },
      { status: 502, headers: buildCorsHeaders(corsOrigin) }
    );
  }

  let parsed;
  try {
    const data = JSON.parse(text);
    const content = data?.choices?.[0]?.message?.content;
    parsed = JSON.parse(content);
  } catch (err) {
    return jsonResponse({ error: 'Failed to parse Sarvam response' }, {
      status: 502,
      headers: buildCorsHeaders(corsOrigin),
    });
  }

  return jsonResponse(parsed, { headers: buildCorsHeaders(corsOrigin) });
}

function buildUserMessage({ businessName, businessType, city, offer, language, tone }) {
  const s = sanitizeField;
  return `Generate a promotional advertisement with the following details:\n\nBusiness Name: ${s(businessName)}\nBusiness Type: ${s(businessType)}\nCity: ${s(city)}\nOffer: ${s(offer)}\nLanguage: ${s(language)}\nTone: ${s(tone)}\n\nReturn output in this JSON format only:\n{\n  "whatsapp": "...",\n  "instagram": "...",\n  "poster_headline": "...",\n  "hashtags": "..."\n}`;
}

function validateInput(body) {
  const required = ['businessName', 'businessType', 'city', 'offer', 'language', 'tone'];
  for (const field of required) {
    if (!body[field] || typeof body[field] !== 'string' || !body[field].trim()) {
      return `${field} is required`;
    }
    if (body[field].length > MAX_FIELD_LENGTH) {
      return `${field} must be ${MAX_FIELD_LENGTH} characters or fewer`;
    }
  }
  return null;
}

async function handleGenerate(request, env) {
  const corsOrigin = getAllowedOrigin(request, env);

  const isRateLimited = await checkRateLimit(request, env);
  if (isRateLimited) {
    return jsonResponse(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: { ...buildCorsHeaders(corsOrigin), 'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS) },
      }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400, headers: buildCorsHeaders(corsOrigin) });
  }

  const validationError = validateInput(body);
  if (validationError) {
    return jsonResponse({ error: validationError }, { status: 400, headers: buildCorsHeaders(corsOrigin) });
  }

  const userContent = buildUserMessage(body);
  const payload = {
    model: 'sarvam-m',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `${userContent}\n\nReturn only valid JSON. No explanations. No markdown.` },
    ],
    temperature: 0.4,
    top_p: 0.9,
    max_tokens: 300,
  };

  try {
    return await proxyToSarvam({ payload, env, corsOrigin });
  } catch (err) {
    return jsonResponse({ error: 'Failed to contact Sarvam API' }, { status: 502, headers: buildCorsHeaders(corsOrigin) });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return handleOptions(request, env);

    if (request.method === 'POST' && url.pathname === '/generate-ad') {
      if (!env.SARVAM_API_KEY) {
        return jsonResponse({ error: 'Server misconfigured' }, { status: 500, headers: buildCorsHeaders(getAllowedOrigin(request, env)) });
      }
      return handleGenerate(request, env);
    }

    return new Response('Not found', { status: 404 });
  },
};
