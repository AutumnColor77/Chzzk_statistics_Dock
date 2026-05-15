// =============================================================================
// Cheese Stick Dock — 공용 보안 라이브러리
// 세션, CSRF, Rate Limit, Origin 검증, 보안 헤더, 안전 로깅 헬퍼를 담당합니다.
// =============================================================================

const SESSION_COOKIE_NAME = 'chzzk_session';
const CSRF_COOKIE_NAME = 'chzzk_csrf';
const SESSION_KEY_PREFIX = 'session:';
const RATE_LIMIT_KEY_PREFIX = 'rl:';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// ---------------------------------------------------------------------------
// 공통 유틸
// ---------------------------------------------------------------------------

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function randomToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return toHex(arr.buffer);
}

/**
 * 두 문자열을 길이/내용이 모두 일치할 때만 true. 길이가 다르면 즉시 false.
 * 같은 길이일 경우에만 모든 바이트를 순회해 timing-safe 비교.
 */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// ---------------------------------------------------------------------------
// 쿠키 처리
// ---------------------------------------------------------------------------

export function parseCookies(request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const entries = cookieHeader.split(';').map((part) => part.trim()).filter(Boolean);
  const cookies = {};
  for (const entry of entries) {
    const idx = entry.indexOf('=');
    if (idx === -1) continue;
    const key = entry.slice(0, idx).trim();
    const rawValue = entry.slice(idx + 1).trim();
    // 동일 이름 쿠키가 여러 번 등장하면 첫 번째만 사용 (cookie tossing 완화).
    if (key in cookies) continue;
    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch (_e) {
      cookies[key] = rawValue;
    }
  }
  return cookies;
}

export function getCookie(name, request) {
  return parseCookies(request)[name] || null;
}

export function buildCookie(name, value, options = {}) {
  const {
    maxAge,
    path = '/',
    httpOnly = false,
    secure = true,
    sameSite = 'Lax'
  } = options;

  let cookie = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (typeof maxAge === 'number') cookie += `; Max-Age=${maxAge}`;
  if (httpOnly) cookie += '; HttpOnly';
  if (secure) cookie += '; Secure';
  return cookie;
}

export function appendSetCookie(headers, cookie) {
  headers.append('Set-Cookie', cookie);
}

// ---------------------------------------------------------------------------
// KV / 세션 처리
// ---------------------------------------------------------------------------

/**
 * 세션 전용 KV 네임스페이스를 반환합니다.
 * SESSION_STORE 바인딩이 없으면 LIVE_STATUS_CACHE로 폴백하지만,
 * 운영 환경에서는 반드시 SESSION_STORE를 별도로 분리하기를 강력 권장합니다.
 */
function getSessionKv(env) {
  return env.SESSION_STORE || env.LIVE_STATUS_CACHE || null;
}

function sessionKey(sessionId) {
  return `${SESSION_KEY_PREFIX}${sessionId}`;
}

export async function createSession(env, payload) {
  const kv = getSessionKv(env);
  if (!kv) return null;

  const sessionId = randomToken(32);
  const csrfToken = randomToken(24);
  const now = Date.now();
  const data = {
    ...payload,
    csrfToken,
    createdAt: now,
    updatedAt: now
  };

  await kv.put(sessionKey(sessionId), JSON.stringify(data), { expirationTtl: SESSION_TTL_SECONDS });
  return { sessionId, csrfToken, data };
}

export async function getSession(env, request) {
  const kv = getSessionKv(env);
  if (!kv) return null;

  const sessionId = getCookie(SESSION_COOKIE_NAME, request);
  if (!sessionId) return null;

  // 세션 ID 형식 검증 (hex 64자) — 잘못된 값은 KV 조회 자체를 건너뜀.
  if (!/^[a-f0-9]{64}$/i.test(sessionId)) return null;

  const raw = await kv.get(sessionKey(sessionId));
  if (!raw) return null;

  try {
    const data = JSON.parse(raw);
    return { sessionId, data };
  } catch (_e) {
    return null;
  }
}

export async function deleteSession(env, request) {
  const kv = getSessionKv(env);
  if (!kv) return;

  const sessionId = getCookie(SESSION_COOKIE_NAME, request);
  if (!sessionId) return;
  if (!/^[a-f0-9]{64}$/i.test(sessionId)) return;
  await kv.delete(sessionKey(sessionId));
}

export function attachSessionCookies(headers, session) {
  appendSetCookie(
    headers,
    buildCookie(SESSION_COOKIE_NAME, session.sessionId, {
      maxAge: SESSION_TTL_SECONDS,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax'
    })
  );
  appendSetCookie(
    headers,
    buildCookie(CSRF_COOKIE_NAME, session.csrfToken, {
      maxAge: SESSION_TTL_SECONDS,
      path: '/',
      httpOnly: false,
      secure: true,
      sameSite: 'Lax'
    })
  );
}

export function clearSessionCookies(headers) {
  appendSetCookie(
    headers,
    buildCookie(SESSION_COOKIE_NAME, '', {
      maxAge: 0,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax'
    })
  );
  appendSetCookie(
    headers,
    buildCookie(CSRF_COOKIE_NAME, '', {
      maxAge: 0,
      path: '/',
      httpOnly: false,
      secure: true,
      sameSite: 'Lax'
    })
  );
}

// ---------------------------------------------------------------------------
// CSRF 검증
// ---------------------------------------------------------------------------

/**
 * Double-Submit + Header Token 방식. 세 값(쿠키/헤더/세션 저장값)이 모두 일치해야 통과.
 * timing-safe 비교를 사용해 토큰 값 추론을 어렵게 합니다.
 */
export function validateCsrf(request, sessionData) {
  const cookies = parseCookies(request);
  const csrfCookie = cookies[CSRF_COOKIE_NAME];
  const csrfHeader = request.headers.get('X-CSRF-Token');
  if (!csrfCookie || !csrfHeader || !sessionData?.csrfToken) return false;
  return timingSafeEqual(csrfCookie, csrfHeader)
    && timingSafeEqual(csrfHeader, sessionData.csrfToken);
}

// ---------------------------------------------------------------------------
// Origin / Same-Site 검증
// ---------------------------------------------------------------------------

/**
 * 환경변수 ALLOWED_ORIGIN(공백 구분으로 다중 허용) 또는 요청 origin을 폴백 사용.
 * 단일 도메인 운영 시에는 ALLOWED_ORIGIN을 반드시 설정하세요.
 */
export function getAllowedOrigins(request, env) {
  const raw = (env.ALLOWED_ORIGIN || '').trim();
  if (raw) {
    return raw.split(/\s+/).filter(Boolean);
  }
  return [new URL(request.url).origin];
}

export function resolveAllowedOrigin(request, env) {
  const allowed = getAllowedOrigins(request, env);
  const origin = request.headers.get('Origin');
  if (origin && allowed.includes(origin)) return origin;
  return allowed[0];
}

/**
 * 상태를 변경하는 요청(POST/PATCH/PUT/DELETE)에 대한 엄격한 Origin 검증.
 * Origin 헤더가 없거나 허용 목록에 없으면 false.
 */
export function isAllowedMutationOrigin(request, env) {
  const allowed = getAllowedOrigins(request, env);
  const origin = request.headers.get('Origin');
  if (origin) return allowed.includes(origin);

  // Origin 헤더가 없는 경우 Referer로 폴백 (구형 브라우저 호환)
  const referer = request.headers.get('Referer');
  if (referer) {
    try {
      return allowed.includes(new URL(referer).origin);
    } catch (_e) {
      return false;
    }
  }
  return false;
}

/**
 * 인증 필요한 GET 요청에 대한 페치 메타데이터 검증 (CSRF-by-GET 완화).
 * 모던 브라우저가 보내는 Sec-Fetch-Site를 우선 사용하고, 없으면 Origin/Referer로 폴백.
 * 직접 URL 입력이나 즐겨찾기 등 사용자 의도적 진입은 허용해야 하므로 same-origin과 none을 통과시킵니다.
 */
export function isSafeFetchSite(request, env) {
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite) {
    return fetchSite === 'same-origin' || fetchSite === 'none';
  }

  const allowed = getAllowedOrigins(request, env);
  const origin = request.headers.get('Origin');
  if (origin) return allowed.includes(origin);

  const referer = request.headers.get('Referer');
  if (referer) {
    try {
      return allowed.includes(new URL(referer).origin);
    } catch (_e) {
      return false;
    }
  }

  // 헤더가 모두 없는 경우(예: 직접 URL 입력) — 허용. 인증/CSRF 토큰이 별도 검증을 담당.
  return true;
}

// ---------------------------------------------------------------------------
// Rate Limit
// ---------------------------------------------------------------------------

function getRateLimitKv(env) {
  return env.SESSION_STORE || env.LIVE_STATUS_CACHE || null;
}

function getClientIp(request) {
  const ip = request.headers.get('CF-Connecting-IP');
  if (typeof ip !== 'string') return null;
  const trimmed = ip.trim();
  return trimmed.length ? trimmed : null;
}

/**
 * 단순 KV 기반 RPM 카운터.
 * - CF-Connecting-IP 헤더가 없으면 보수적으로 차단합니다 (Cloudflare 프록시 외부 우회 방지).
 * - 동시성 race condition은 KV 본질적 한계이므로, 결정적인 보호는 Cloudflare WAF Rate Limiting Rules로 보강하세요.
 */
export async function checkRateLimit(env, request, action, limit, windowSeconds) {
  const kv = getRateLimitKv(env);
  if (!kv) return { allowed: true, remaining: limit };

  const ip = getClientIp(request);
  if (!ip) {
    // CF 프록시를 거치지 않은 요청은 신뢰할 수 없는 것으로 간주.
    return { allowed: false, remaining: 0, reason: 'no_client_ip' };
  }

  const nowBucket = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `${RATE_LIMIT_KEY_PREFIX}${action}:${ip}:${nowBucket}`;
  const current = Number((await kv.get(key)) || '0');
  if (current >= limit) {
    return { allowed: false, remaining: 0 };
  }

  await kv.put(key, String(current + 1), { expirationTtl: windowSeconds + 10 });
  return { allowed: true, remaining: limit - current - 1 };
}

// ---------------------------------------------------------------------------
// 안전 로깅
// ---------------------------------------------------------------------------

/**
 * 쿼리스트링/프래그먼트를 제거한 안전한 경로만 반환.
 * OAuth code/state 같은 민감한 파라미터가 로그에 남지 않도록 합니다.
 */
export function safePath(request) {
  try {
    const u = new URL(request.url);
    return `${u.pathname}`;
  } catch (_e) {
    return 'unknown';
  }
}

export function logSecurityEvent(event, details = {}) {
  const payload = {
    at: new Date().toISOString(),
    event,
    ...details
  };
  console.log('[security]', JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// 응답 헤더 헬퍼
// ---------------------------------------------------------------------------

export function withNoStore(headers) {
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');
}

/**
 * 모든 함수 응답에 공통 보안 헤더를 일관되게 적용합니다.
 * Cloudflare Pages의 _headers 파일은 정적 자산에만 적용되므로,
 * 함수 응답 측에서 동일한 보호 헤더를 직접 설정해야 합니다.
 */
export function applyDefaultSecurityHeaders(headers, { allowFrame = false } = {}) {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (!allowFrame) {
    headers.set('X-Frame-Options', 'DENY');
  }
}

export function corsHeaders(request, env, { methods = 'GET, OPTIONS', allowHeaders = 'Content-Type', allowCredentials = true } = {}) {
  const origin = resolveAllowedOrigin(request, env);
  const headers = new Headers({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': allowHeaders,
    'Vary': 'Origin'
  });
  if (allowCredentials) {
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return headers;
}

/**
 * 표준 JSON 응답 빌더. 캐시 비활성화 + 공통 보안 헤더 + CORS를 한 번에 적용.
 */
export function jsonResponse(data, { status = 200, request, env, methods, allowHeaders, cacheable = false } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=UTF-8' });
  if (request && env) {
    const cors = corsHeaders(request, env, { methods, allowHeaders });
    cors.forEach((value, key) => headers.set(key, value));
  }
  if (!cacheable) withNoStore(headers);
  applyDefaultSecurityHeaders(headers);
  return new Response(JSON.stringify(data), { status, headers });
}

export function requireAllowedMethods(request, methods) {
  if (!methods.includes(request.method)) {
    const headers = new Headers({ 'Allow': methods.join(', ') });
    applyDefaultSecurityHeaders(headers);
    return new Response('Method Not Allowed', { status: 405, headers });
  }
  return null;
}
