const DEFAULT_USER_AGENT = 'Karing';

const PASS_THROUGH_RESPONSE_HEADERS = [
  'subscription-userinfo',
  'profile-update-interval',
  'profile-title',
  'profile-web-page-url',
  'content-disposition',
  'content-type',
  'cache-control',
];

function createCorsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,HEAD,OPTIONS',
    'access-control-allow-headers': 'content-type,user-agent,x-user-agent',
    'access-control-expose-headers': PASS_THROUGH_RESPONSE_HEADERS.join(', '),
  };
}

function sanitize(v) {
  return String(v || '').replace(/[\r\n]/g, '').trim();
}

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: createCorsHeaders() });
  }
  if (!['GET', 'HEAD'].includes(req.method)) {
    return new Response('Method Not Allowed', { status: 405, headers: createCorsHeaders() });
  }
  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) {
    return new Response('Miss URL', { status: 400, headers: createCorsHeaders() });
  }
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return new Response('Invalid URL', { status: 400, headers: createCorsHeaders() });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return new Response('Only http/https allowed', { status: 400, headers: createCorsHeaders() });
  }

  const ua = sanitize(url.searchParams.get('ua') || req.headers.get('x-user-agent') || DEFAULT_USER_AGENT);

  const upstream = await fetch(parsed.toString(), {
    method: req.method === 'HEAD' ? 'HEAD' : 'GET',
    redirect: 'follow',
    headers: { 'user-agent': ua, 'accept': '*/*' },
  });

  const headers = createCorsHeaders();
  for (const h of PASS_THROUGH_RESPONSE_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) headers[h] = v;
  }
  if (!headers['content-type']) headers['content-type'] = 'text/plain; charset=utf-8';

  if (req.method === 'HEAD') {
    return new Response(null, { status: upstream.status, headers });
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}
