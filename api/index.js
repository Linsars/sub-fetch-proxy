const DEFAULT_USER_AGENT = 'Karing';

// 需要透传的响应头（机场流量/到期信息）
const PASS_THROUGH_RESPONSE_HEADERS = [
  'subscription-userinfo',
  'profile-update-interval',
  'profile-title',
  'profile-web-page-url',
  'content-disposition',
  'content-type',
  'cache-control',
];

// 简单 token 防护（设为 null 则关闭）
const PROXY_TOKEN = process.env.PROXY_TOKEN || null;

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

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    applyHeaders(res, createCorsHeaders());
    res.statusCode = 204;
    res.end();
    return;
  }

  if (!['GET', 'HEAD'].includes(req.method)) {
    sendText(res, 405, 'Method Not Allowed');
    return;
  }

  // token 校验
  const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  if (PROXY_TOKEN) {
    const token = requestUrl.searchParams.get('token') || req.headers['x-proxy-token'];
    if (token !== PROXY_TOKEN) {
      sendText(res, 401, 'Unauthorized');
      return;
    }
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

  const upstreamResponse = await fetch(parsedTarget.toString(), {
    method: req.method === 'HEAD' ? 'HEAD' : 'GET',
    redirect: 'follow',
    headers: {
      'user-agent': getUpstreamUserAgent(req, requestUrl),
      'accept': '*/*',
    },
  });

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
