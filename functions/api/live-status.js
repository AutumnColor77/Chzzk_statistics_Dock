// --- Configuration ---
const FRESH_DURATION_MS = 25 * 1000;  // 25초: 캐시가 "신선"한 기간 (즉시 반환, 갱신 없음)
const STALE_DURATION_MS = 60 * 1000;  // 60초: 이 기간 이후 캐시 완전 만료
const KV_TTL_SECONDS = 120;           // KV 자동 만료 안전장치 (2분)

/**
 * Origin API에서 라이브 상태를 가져옵니다.
 */
async function fetchFromOrigin(channelId) {
  const apiUrl = `https://api.chzzk.naver.com/polling/v2/channels/${channelId}/live-status`;
  const response = await fetch(apiUrl, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'chzzk-viewer-dock/1.0',
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

export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  const { searchParams } = requestUrl;
  const channelId = searchParams.get('channelId');
  const allowedOrigin = context.env.ALLOWED_ORIGIN || requestUrl.origin;

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

    // MISS 또는 EXPIRED → 동기적 origin fetch
    const freshData = await fetchFromOrigin(channelId);
    const cacheEntry = { data: freshData, timestamp: Date.now() };
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
