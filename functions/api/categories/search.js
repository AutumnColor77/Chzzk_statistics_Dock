import {
  applyDefaultSecurityHeaders,
  AUTH_ENV_KEYS,
  checkRateLimit,
  corsHeaders,
  getSession,
  isSafeFetchSite,
  jsonResponse,
  logSecurityEvent,
  requireAllowedMethods,
  requireEnv,
  safePath
} from '../../_lib/security.js';

const ALLOW_METHODS = 'GET, OPTIONS';
const ALLOW_HEADERS = 'Content-Type';

/** 인증 사용자 한정으로 IP당 분당 상한 */
const RATE_LIMIT_PER_IP_PER_MIN = 60;
/** 동일 query에 대한 KV 응답 캐시 TTL (초) */
const QUERY_CACHE_TTL_SECONDS = 60;
const MAX_QUERY_LENGTH = 60;

function isValidQuery(q) {
  if (typeof q !== 'string') return false;
  const trimmed = q.trim();
  return trimmed.length >= 1 && trimmed.length <= MAX_QUERY_LENGTH;
}

function buildJsonHeaders(request, env, { cacheable = false } = {}) {
  const headers = corsHeaders(request, env, { methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS });
  headers.set('Content-Type', 'application/json; charset=UTF-8');
  if (cacheable) {
    headers.set('Cache-Control', `private, max-age=${QUERY_CACHE_TTL_SECONDS}`);
  } else {
    headers.set('Cache-Control', 'no-store');
  }
  applyDefaultSecurityHeaders(headers);
  return headers;
}

export async function onRequest(context) {
  const { request, env } = context;

  const methodErr = requireAllowedMethods(request, ['GET']);
  if (methodErr) return methodErr;

  // 인증 사용자만 호출 허용 (Open API 자격증명 남용 방지).
  const session = await getSession(env, request);
  if (!session?.data?.accessToken) {
    logSecurityEvent('categories_search_unauthenticated', { path: safePath(request) });
    return jsonResponse({ code: 401, message: 'Authentication required' }, {
      status: 401, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  // 브라우저 fetch metadata 검증으로 cross-site 트리거 차단.
  if (!isSafeFetchSite(request, env)) {
    logSecurityEvent('categories_search_blocked_origin', { path: safePath(request) });
    return jsonResponse({ code: 403, message: 'Forbidden origin' }, {
      status: 403, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  const limit = await checkRateLimit(env, request, 'categories_search', RATE_LIMIT_PER_IP_PER_MIN, 60);
  if (!limit.allowed) {
    logSecurityEvent('rate_limit_categories_search', { path: safePath(request) });
    const headers = buildJsonHeaders(request, env);
    headers.set('Retry-After', '60');
    return new Response(JSON.stringify({ code: 429, message: 'Too many requests' }), {
      status: 429, headers
    });
  }

  const url = new URL(request.url);
  const rawQuery = url.searchParams.get('query');
  if (!isValidQuery(rawQuery)) {
    return jsonResponse({ code: 400, message: 'Query is required (1~60 chars)' }, {
      status: 400, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  const query = rawQuery.trim();
  const envCheck = requireEnv(env, AUTH_ENV_KEYS, request, {
    json: true, status: 503, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
  });
  if (!envCheck.ok) return envCheck.error;
  const { CLIENT_ID: clientId, CLIENT_SECRET: clientSecret } = envCheck.values;

  const kv = env.LIVE_STATUS_CACHE || env.SESSION_STORE || null;
  const cacheKey = `cat-search:${query.toLowerCase()}`;

  if (kv) {
    try {
      const cached = await kv.get(cacheKey, { type: 'json' });
      if (cached) {
        const headers = buildJsonHeaders(request, env, { cacheable: true });
        headers.set('X-Cache', 'HIT');
        return new Response(JSON.stringify(cached), { status: 200, headers });
      }
    } catch (_e) {
      // 캐시 조회 실패는 무시하고 origin 호출로 폴백
    }
  }

  const apiUrl = `https://openapi.chzzk.naver.com/open/v1/categories/search?query=${encodeURIComponent(query)}&size=20`;

  let upstream;
  let payload;
  try {
    upstream = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Client-Id': clientId,
        'Client-Secret': clientSecret,
        'Accept': 'application/json'
      }
    });
    payload = await upstream.json();
  } catch (_e) {
    logSecurityEvent('categories_search_upstream_error', { path: safePath(request) });
    return jsonResponse({ code: 502, message: 'Upstream error' }, {
      status: 502, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  if (!upstream.ok) {
    return jsonResponse(payload || { code: upstream.status, message: 'Upstream error' }, {
      status: upstream.status, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  if (kv) {
    context.waitUntil(
      kv.put(cacheKey, JSON.stringify(payload), { expirationTtl: QUERY_CACHE_TTL_SECONDS })
    );
  }

  const headers = buildJsonHeaders(request, env, { cacheable: true });
  headers.set('X-Cache', kv ? 'MISS' : 'BYPASS');
  return new Response(JSON.stringify(payload), { status: 200, headers });
}

export async function onRequestOptions(context) {
  const { request, env } = context;
  const headers = corsHeaders(request, env, { methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS });
  applyDefaultSecurityHeaders(headers);
  return new Response(null, { headers });
}
