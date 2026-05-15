import {
  applyDefaultSecurityHeaders,
  checkRateLimit,
  corsHeaders,
  getSession,
  logSecurityEvent,
  resolveAllowedOrigin,
  safePath
} from '../_lib/security.js';

// --- Configuration ---
const FRESH_DURATION_MS = 25 * 1000;  // 25초: 캐시가 "신선"한 기간 (즉시 반환, 갱신 없음)
const STALE_DURATION_MS = 60 * 1000;  // 60초: 이 기간 이후 캐시 완전 만료
const KV_TTL_SECONDS = 120;           // KV 자동 만료 안전장치 (2분)

/** 공개 URL 노출 시 IP당 라이브 상태 조회 상한 (분당, KV·오리진 보호) */
const RATE_LIMIT_PER_IP_PER_MIN = 120;
/** force=true는 캐시 우회·오리진 직접 호출이므로 더 엄격히 */
const RATE_LIMIT_FORCE_PER_IP_PER_MIN = 30;

const ALLOW_METHODS = 'GET, OPTIONS';
const CHANNEL_ID_PATTERN = /^[a-f0-9]{10,64}$/i;

async function fetchFromOrigin(channelId) {
  const apiUrl = `https://api.chzzk.naver.com/polling/v2/channels/${channelId}/live-status`;
  const response = await fetch(apiUrl, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'cheese-stick-dock/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Origin API error: ${response.status}`);
  }

  return response.json();
}

function buildResponseHeaders(request, env, cacheStatus) {
  const headers = corsHeaders(request, env, { methods: ALLOW_METHODS });
  headers.set('Content-Type', 'application/json; charset=UTF-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Cache', cacheStatus);
  applyDefaultSecurityHeaders(headers);
  return headers;
}

function jsonRateLimited(request, env) {
  const headers = buildResponseHeaders(request, env, 'RATE_LIMITED');
  headers.set('Retry-After', '60');
  return new Response(
    JSON.stringify({ code: 429, message: 'Too many requests. Try again later.' }),
    { status: 429, headers }
  );
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405, headers: { 'Allow': ALLOW_METHODS } });
  }

  const requestUrl = new URL(request.url);
  const { searchParams } = requestUrl;
  const channelId = searchParams.get('channelId');
  const force = searchParams.get('force') === 'true';

  const limit = await checkRateLimit(env, request, 'live_status', RATE_LIMIT_PER_IP_PER_MIN, 60);
  if (!limit.allowed) {
    logSecurityEvent('rate_limit_live_status', { path: safePath(request) });
    return jsonRateLimited(request, env);
  }

  if (force) {
    // force=true는 KV/오리진을 직접 두드리는 비싼 경로 → 인증된 사용자만 허용.
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
      return jsonRateLimited(request, env);
    }
  }

  if (!channelId) {
    return new Response('channelId query parameter is required', { status: 400 });
  }

  // SSRF 방지: hex 문자열만 허용.
  if (!CHANNEL_ID_PATTERN.test(channelId)) {
    return new Response('Invalid channelId format', { status: 400 });
  }

  const kv = env.LIVE_STATUS_CACHE;
  if (!kv) {
    const data = await fetchFromOrigin(channelId);
    return new Response(JSON.stringify(data), {
      headers: buildResponseHeaders(request, env, 'BYPASS')
    });
  }

  // --- Stale-While-Revalidate ---
  const cacheKey = `live-status:${channelId}`;
  const now = Date.now();

  try {
    if (!force) {
      const cached = await kv.get(cacheKey, { type: 'json' });

      if (cached && cached.timestamp) {
        const age = now - cached.timestamp;

        if (age < FRESH_DURATION_MS) {
          return new Response(JSON.stringify(cached.data), {
            headers: buildResponseHeaders(request, env, 'HIT')
          });
        }

        if (age < STALE_DURATION_MS) {
          context.waitUntil(refreshCache(kv, cacheKey, channelId));
          return new Response(JSON.stringify(cached.data), {
            headers: buildResponseHeaders(request, env, 'STALE')
          });
        }
      }
    }

    const freshData = await fetchFromOrigin(channelId);
    const cacheEntry = { data: freshData, timestamp: Date.now() };
    context.waitUntil(
      kv.put(cacheKey, JSON.stringify(cacheEntry), { expirationTtl: KV_TTL_SECONDS })
    );

    return new Response(JSON.stringify(freshData), {
      headers: buildResponseHeaders(request, env, force ? 'FORCE' : 'MISS')
    });
  } catch (_error) {
    try {
      const fallbackData = await fetchFromOrigin(channelId);
      return new Response(JSON.stringify(fallbackData), {
        headers: buildResponseHeaders(request, env, 'ERROR')
      });
    } catch (_originError) {
      return new Response(
        JSON.stringify({ code: 502, message: 'Both cache and origin failed' }),
        { status: 502, headers: buildResponseHeaders(request, env, 'ERROR') }
      );
    }
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
    await kv.put(cacheKey, JSON.stringify(cacheEntry), { expirationTtl: KV_TTL_SECONDS });
  } catch (_error) {
    // 백그라운드 갱신 실패는 무시 — 다음 요청에서 재시도
  }
}
