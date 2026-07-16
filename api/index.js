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

function applyHeaders(res, headers) {
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
}

function sanitizeHeaderValue(value) {
  return String(value || '').replace(/[\r\n]/g, '').trim();
}

function getUpstreamUserAgent(req, requestUrl) {
  return sanitizeHeaderValue(
    requestUrl.searchParams.get('ua') ||
    req.headers['x-user-agent'] ||
    DEFAULT_USER_AGENT
  );
}

function sendText(res, statusCode, message) {
  applyHeaders(res, createCorsHeaders());
  res.statusCode = statusCode;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(message);
}

// 诊断端点：测试函数能否出站
function sendDiag(res, info) {
  applyHeaders(res, createCorsHeaders());
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(info, null, 2));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    applyHeaders(res, createCorsHeaders());
    res.statusCode = 204;
    res.end();
    return;
  }

  const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);

  // 诊断模式
  if (requestUrl.searchParams.get('diag') === '1') {
    const diag = { fetchType: typeof fetch, node: process.version };
    try {
      const r = await fetch('https://vercel.com', { method: 'GET' });
      diag.vercelSelfFetch = { status: r.status, len: (await r.text()).length };
    } catch (e) {
      diag.vercelSelfFetch = { error: e.message };
    }
    try {
      const r2 = await fetch('https://example.com', { method: 'GET' });
      diag.exampleFetch = { status: r2.status, len: (await r2.text()).length };
    } catch (e) {
      diag.exampleFetch = { error: e.message };
    }
    sendDiag(res, diag);
    return;
  }

  if (!['GET', 'HEAD'].includes(req.method)) {
    sendText(res, 405, 'Method Not Allowed');
    return;
  }

  const targetUrl = requestUrl.searchParams.get('url');
  if (!targetUrl) {
    sendText(res, 400, 'Miss URL');
    return;
  }

  let parsedTarget;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    sendText(res, 400, 'Invalid URL');
    return;
  }

  if (!['http:', 'https:'].includes(parsedTarget.protocol)) {
    sendText(res, 400, 'Only http/https URLs are allowed');
    return;
  }

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(parsedTarget.toString(), {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      redirect: 'follow',
      headers: {
        'user-agent': getUpstreamUserAgent(req, requestUrl),
        'accept': '*/*',
      },
    });
  } catch (e) {
    sendText(res, 502, 'Upstream fetch failed: ' + e.message);
    return;
  }

  const responseHeaders = createCorsHeaders();
  for (const headerName of PASS_THROUGH_RESPONSE_HEADERS) {
    const value = upstreamResponse.headers.get(headerName);
    if (value) responseHeaders[headerName] = value;
  }
  if (!responseHeaders['content-type']) {
    responseHeaders['content-type'] = 'text/plain; charset=utf-8';
  }

  applyHeaders(res, responseHeaders);
  res.statusCode = upstreamResponse.status;

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const body = Buffer.from(await upstreamResponse.arrayBuffer());
  res.end(body);
};
