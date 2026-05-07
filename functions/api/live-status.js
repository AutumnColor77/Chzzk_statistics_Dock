import { checkRateLimit, logSecurityEvent } from '../_lib/security.js';

// --- Configuration ---
const FRESH_DURATION_MS = 25 * 1000;  // 25초: 캐시가 "신선"한 기간 (즉시 반환, 갱신 없음)
const STALE_DURATION_MS = 60 * 1000;  // 60초: 이 기간 이후 캐시 완전 만료
const KV_TTL_SECONDS = 120;           // KV 자동 만료 안전장치 (2분)

/** 공개 URL 노출 시 IP당 라이브 상태 조회 상한 (분당, KV·오리진 보호) */
const RATE_LIMIT_PER_IP_PER_MIN = 120;
/** force=true는 캐시 우회·오리진 직접 호출이므로 더 엄격히 */
const RATE_LIMIT_FORCE_PER_IP_PER_MIN = 30;

/**
 * Origin API에서 라이브 상태를 가져옵니다.
 */
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

/**
 * CORS 헤더와 캐시 상태를 포함한 JSON 응답을 생성합니다.
 */
function createJsonResponse(data, cacheStatus, allowedOrigin) {
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': allowedOrigin,
      'Cache-Control': 'no-store',
      'X-Cache': cacheStatus,
    },
  });
}

function jsonRateLimited(allowedOrigin) {
  return new Response(
    JSON.stringify({ code: 429, message: 'Too many requests. Try again later.' }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': allowedOrigin,
        'Cache-Control': 'no-store',
        'Retry-After': '60',
      },
    }
  );
}

export async function onRequest(context) {
  if (context.request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const requestUrl = new URL(context.request.url);
  const { searchParams } = requestUrl;
  const channelId = searchParams.get('channelId');
  const force = searchParams.get('force') === 'true';
  const allowedOrigin = context.env.ALLOWED_ORIGIN || requestUrl.origin;

  const limit = await checkRateLimit(
    context.env,
    context.request,
    'live_status',
    RATE_LIMIT_PER_IP_PER_MIN,
    60
  );
  if (!limit.allowed) {
    logSecurityEvent('rate_limit_live_status', { url: context.request.url });
    return jsonRateLimited(allowedOrigin);
  }

  if (force) {
    const forceLimit = await checkRateLimit(
      context.env,
      context.request,
      'live_status_force',
      RATE_LIMIT_FORCE_PER_IP_PER_MIN,
      60
    );
    if (!forceLimit.allowed) {
      logSecurityEvent('rate_limit_live_status_force', { url: context.request.url });
      return jsonRateLimited(allowedOrigin);
    }
  }

  if (!channelId) {
    return new Response('channelId query parameter is required', { status: 400 });
  }

  // channelId 형식 검증 (hex 문자열만 허용 — 경로 조작 방지)
  if (!/^[a-f0-9]{10,64}$/i.test(channelId)) {
    return new Response('Invalid channelId format', { status: 400 });
  }

  // KV 바인딩 확인 — 없으면 기존 로직(직접 fetch)으로 폴백
  const kv = context.env.LIVE_STATUS_CACHE;
  if (!kv) {
    const data = await fetchFromOrigin(channelId);
    return createJsonResponse(data, 'BYPASS', allowedOrigin);
  }

  // --- Stale-While-Revalidate 패턴 ---
  const cacheKey = `live-status:${channelId}`;
  const now = Date.now();

  try {
    // force 파라미터가 있으면 캐시 조회를 건너뜀
    if (!force) {
      const cached = await kv.get(cacheKey, { type: 'json' });

      if (cached && cached.timestamp) {
        const age = now - cached.timestamp;

        // FRESH: 25초 이내 → 즉시 반환
        if (age < FRESH_DURATION_MS) {
          return createJsonResponse(cached.data, 'HIT', allowedOrigin);
        }

        // STALE: 25~60초 → 즉시 반환 + 백그라운드 갱신
        if (age < STALE_DURATION_MS) {
          context.waitUntil(refreshCache(kv, cacheKey, channelId));
          return createJsonResponse(cached.data, 'STALE', allowedOrigin);
        }
      }
    }

    // MISS, EXPIRED 또는 FORCE REFRESH → 동기적 origin fetch
    const freshData = await fetchFromOrigin(channelId);
    const cacheEntry = { data: freshData, timestamp: Date.now() };
    const cacheStatus = force ? 'FORCE' : 'MISS';
    context.waitUntil(
      kv.put(cacheKey, JSON.stringify(cacheEntry), { expirationTtl: KV_TTL_SECONDS })
    );

    return createJsonResponse(freshData, 'MISS', allowedOrigin);

  } catch (error) {
    // KV 오류 시에도 origin fallback
    try {
      const fallbackData = await fetchFromOrigin(channelId);
      return createJsonResponse(fallbackData, 'ERROR', allowedOrigin);
    } catch (originError) {
      return new Response(
        JSON.stringify({ code: 500, message: 'Both cache and origin failed' }),
        {
          status: 502,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': allowedOrigin,
          },
        }
      );
    }
  }
}

/**
 * 백그라운드에서 캐시를 갱신합니다 (SWR의 "revalidate" 부분).
 */
async function refreshCache(kv, cacheKey, channelId) {
  try {
    const freshData = await fetchFromOrigin(channelId);
    const cacheEntry = { data: freshData, timestamp: Date.now() };
    await kv.put(cacheKey, JSON.stringify(cacheEntry), { expirationTtl: KV_TTL_SECONDS });
  } catch (_error) {
    // 백그라운드 갱신 실패는 무시 — 다음 요청에서 재시도
  }
}
