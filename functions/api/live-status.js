import {
  applyDefaultSecurityHeaders,
  checkRateLimit,
  corsHeaders,
  getSession,
  logSecurityEvent,
  safePath
} from '../_lib/security.js';

const FRESH_DURATION_MS = 25 * 1000;
const STALE_DURATION_MS = 60 * 1000;
const KV_TTL_SECONDS = 120;
const EDGE_CACHE_TTL_SECONDS = 15;
const ORIGIN_MAX_RETRIES = 3;
const ORIGIN_BACKOFF_CAP_MS = 4000;

const RATE_LIMIT_PER_IP_PER_MIN = 120;
const RATE_LIMIT_FORCE_PER_IP_PER_MIN = 30;

const ALLOW_METHODS = 'GET, OPTIONS';
const CHANNEL_ID_PATTERN = /^[a-f0-9]{10,64}$/i;
const ORIGIN_LIVE_STATUS = 'https://api.chzzk.naver.com/polling/v2/channels';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(header) {
  if (!header) return 0;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, ORIGIN_BACKOFF_CAP_MS);
  }
  const when = Date.parse(header);
  if (Number.isFinite(when)) {
    return Math.min(Math.max(0, when - Date.now()), ORIGIN_BACKOFF_CAP_MS);
  }
  return 0;
}

function backoffDelayMs(attempt, retryAfterMs) {
  if (retryAfterMs > 0) return retryAfterMs;
  const base = Math.min(250 * (2 ** attempt), ORIGIN_BACKOFF_CAP_MS);
  const jitter = crypto.getRandomValues(new Uint32Array(1))[0] % 120;
  return base + jitter;
}

function cancelBody(response) {
  if (response.body && typeof response.body.cancel === 'function') {
    try { response.body.cancel(); } catch (_e) { /* ignore */ }
  }
}

async function fetchFromOrigin(channelId) {
  const apiUrl = `${ORIGIN_LIVE_STATUS}/${channelId}/live-status`;
  let lastStatus = 0;

  for (let attempt = 0; attempt <= ORIGIN_MAX_RETRIES; attempt++) {
    const response = await fetch(apiUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'cheese-stick-dock/1.0'
      }
    });
    lastStatus = response.status;

    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'));
      cancelBody(response);
      if (attempt === ORIGIN_MAX_RETRIES) {
        const error = new Error('Origin API rate limited');
        error.status = 429;
        throw error;
      }
      await sleep(backoffDelayMs(attempt, retryAfterMs));
      continue;
    }

    if (!response.ok) {
      cancelBody(response);
      throw new Error(`Origin API error: ${response.status}`);
    }

    return response.json();
  }

  const error = new Error(`Origin API error: ${lastStatus || 502}`);
  error.status = lastStatus || 502;
  throw error;
}

function edgeCacheRequest(channelId) {
  return new Request(`https://live-status.cache/api/live-status?channelId=${encodeURIComponent(channelId)}`, {
    method: 'GET'
  });
}

async function matchEdgeCache(channelId) {
  try {
    return await caches.default.match(edgeCacheRequest(channelId));
  } catch (_e) {
    return undefined;
  }
}

async function putEdgeCache(channelId, data) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=UTF-8',
    'Cache-Control': `public, max-age=${EDGE_CACHE_TTL_SECONDS}`
  });
  const response = new Response(JSON.stringify(data), { status: 200, headers });
  try {
    await caches.default.put(edgeCacheRequest(channelId), response);
  } catch (_e) {
    // Cache API 미지원 미리보기 등 — KV SWR이 폴백
  }
}

function buildResponseHeaders(request, env, cacheStatus) {
  const headers = corsHeaders(request, env, { methods: ALLOW_METHODS });
  headers.set('Content-Type', 'application/json; charset=UTF-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Cache', cacheStatus);
  applyDefaultSecurityHeaders(headers);
  return headers;
}

function jsonRateLimited(request, env, retryAfter = 60) {
  const headers = buildResponseHeaders(request, env, 'RATE_LIMITED');
  headers.set('Retry-After', String(retryAfter));
  return new Response(
    JSON.stringify({ code: 429, message: 'Too many requests. Try again later.' }),
    { status: 429, headers }
  );
}

function jsonBody(data, request, env, cacheStatus) {
  return new Response(JSON.stringify(data), {
    headers: buildResponseHeaders(request, env, cacheStatus)
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: ALLOW_METHODS } });
  }

  const requestUrl = new URL(request.url);
  const channelId = requestUrl.searchParams.get('channelId');
  const force = requestUrl.searchParams.get('force') === 'true';

  const limit = await checkRateLimit(env, request, 'live_status', RATE_LIMIT_PER_IP_PER_MIN, 60);
  if (!limit.allowed) {
    logSecurityEvent('rate_limit_live_status', { path: safePath(request) });
    return jsonRateLimited(request, env, limit.retryAfter || 60);
  }

  if (force) {
    const session = await getSession(env, request);
    if (!session?.data?.accessToken) {
      logSecurityEvent('force_refresh_unauthenticated', { path: safePath(request) });
      const headers = buildResponseHeaders(request, env, 'BYPASS_DENIED');
      return new Response(
        JSON.stringify({ code: 401, message: 'Authentication required for force refresh.' }),
        { status: 401, headers }
      );
    }

    const forceLimit = await checkRateLimit(env, request, 'live_status_force', RATE_LIMIT_FORCE_PER_IP_PER_MIN, 60);
    if (!forceLimit.allowed) {
      logSecurityEvent('rate_limit_live_status_force', { path: safePath(request) });
      return jsonRateLimited(request, env, forceLimit.retryAfter || 60);
    }
  }

  if (!channelId) {
    return new Response('channelId query parameter is required', { status: 400 });
  }

  if (!CHANNEL_ID_PATTERN.test(channelId)) {
    return new Response('Invalid channelId format', { status: 400 });
  }

  if (!force) {
    const edgeHit = await matchEdgeCache(channelId);
    if (edgeHit) {
      return new Response(edgeHit.body, {
        status: 200,
        headers: buildResponseHeaders(request, env, 'EDGE')
      });
    }
  }

  const kv = env.LIVE_STATUS_CACHE;
  const cacheKey = `live-status:${channelId}`;
  const now = Date.now();

  const persist = (data, kvStatus) => {
    context.waitUntil(putEdgeCache(channelId, data));
    if (kv) {
      context.waitUntil(
        kv.put(cacheKey, JSON.stringify({ data, timestamp: Date.now() }), {
          expirationTtl: KV_TTL_SECONDS
        })
      );
    }
    return jsonBody(data, request, env, kvStatus);
  };

  try {
    if (!force && kv) {
      const cached = await kv.get(cacheKey, { type: 'json' });
      if (cached && cached.timestamp && cached.data) {
        const age = now - cached.timestamp;
        if (age < FRESH_DURATION_MS) {
          context.waitUntil(putEdgeCache(channelId, cached.data));
          return jsonBody(cached.data, request, env, 'HIT');
        }
        if (age < STALE_DURATION_MS) {
          context.waitUntil(refreshCache(kv, cacheKey, channelId));
          return jsonBody(cached.data, request, env, 'STALE');
        }
      }
    }

    const freshData = await fetchFromOrigin(channelId);
    return persist(freshData, force ? 'FORCE' : (kv ? 'MISS' : 'BYPASS'));
  } catch (error) {
    if (kv) {
      try {
        const fallback = await kv.get(cacheKey, { type: 'json' });
        if (fallback?.data) {
          return jsonBody(fallback.data, request, env, error?.status === 429 ? 'STALE_429' : 'ERROR');
        }
      } catch (_e) {
        // ignore
      }
    }

    if (error?.status === 429) {
      const headers = buildResponseHeaders(request, env, 'ORIGIN_429');
      headers.set('Retry-After', '15');
      return new Response(
        JSON.stringify({ code: 429, message: 'Upstream rate limited. Try again shortly.' }),
        { status: 429, headers }
      );
    }

    return new Response(
      JSON.stringify({ code: 502, message: 'Both cache and origin failed' }),
      { status: 502, headers: buildResponseHeaders(request, env, 'ERROR') }
    );
  }
}

export async function onRequestOptions(context) {
  const { request, env } = context;
  const headers = corsHeaders(request, env, { methods: ALLOW_METHODS });
  applyDefaultSecurityHeaders(headers);
  return new Response(null, { headers });
}

async function refreshCache(kv, cacheKey, channelId) {
  try {
    const freshData = await fetchFromOrigin(channelId);
    const cacheEntry = { data: freshData, timestamp: Date.now() };
    await Promise.all([
      kv.put(cacheKey, JSON.stringify(cacheEntry), { expirationTtl: KV_TTL_SECONDS }),
      putEdgeCache(channelId, freshData)
    ]);
  } catch (_error) {
    // 백그라운드 갱신 실패는 무시 — 다음 요청에서 재시도
  }
}
