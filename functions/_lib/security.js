// =============================================================================
// Cheese Stick Dock — 공용 보안 라이브러리
// 세션, CSRF, Rate Limit, Origin 검증, 보안 헤더, 안전 로깅 헬퍼를 담당합니다.
// =============================================================================

const SESSION_COOKIE_NAME = 'chzzk_session';
const CSRF_COOKIE_NAME = 'chzzk_csrf';
const ACCESS_COOKIE_NAME = 'chzzk_access';
const REFRESH_COOKIE_NAME = 'chzzk_refresh';
const OAUTH_STATE_COOKIE_NAME = 'oauth_state';
const OAUTH_NEXT_COOKIE_NAME = 'oauth_next';
const SESSION_KEY_PREFIX = 'session:';
const RATE_LIMIT_KEY_PREFIX = 'rl:';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour fallback
const CSRF_STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CSRF_STATE_TTL_SECONDS = 5 * 60;
const CSRF_STATE_CLOCK_SKEW_MS = 30 * 1000;
const AUTH_COOKIE_PATH = '/api';
const OAUTH_COOKIE_PATH = '/api/auth';

/**
 * 정규 키 → 환경 변수 별칭.
 * 치지직 앱 자격증명은 CHZZK_* 를 우선하고, 과제/범용 이름도 허용합니다.
 */
const ENV_ALIASES = {
  CLIENT_ID: ['CHZZK_CLIENT_ID', 'CLIENT_ID'],
  CLIENT_SECRET: ['CHZZK_CLIENT_SECRET', 'CLIENT_SECRET'],
  ADMIN_SECRET: ['ADMIN_SECRET']
};

export const AUTH_ENV_KEYS = ['CLIENT_ID', 'CLIENT_SECRET'];
export const ADMIN_ENV_KEYS = ['ADMIN_SECRET'];

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

function asComparableString(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * SHA-256으로 고정 길이 다이제스트를 만든 뒤 crypto.subtle.timingSafeEqual 로 비교합니다.
 * 길이 불일치로 조기 return 하지 않아 비밀 길이가 타이밍으로 새지 않습니다.
 */
export async function timingSafeEqual(a, b) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(asComparableString(a))),
    crypto.subtle.digest('SHA-256', encoder.encode(asComparableString(b)))
  ]);
  try {
    const equal = crypto.subtle.timingSafeEqual(leftHash, rightHash);
    return equal && typeof a === 'string' && typeof b === 'string';
  } catch (_e) {
    return false;
  }
}

async function hmacSha256Hex(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return toHex(mac);
}

// ---------------------------------------------------------------------------
// 환경 변수 스키마 검증
// ---------------------------------------------------------------------------

export function getEnvValue(env, canonicalKey) {
  const aliases = ENV_ALIASES[canonicalKey] || [canonicalKey];
  if (!env) return '';
  for (const name of aliases) {
    const value = env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/**
 * 필수 환경 변수 존재 여부를 검증합니다.
 * 클라이언트 응답에는 어떤 키가 빠졌는지 노출하지 않습니다.
 */
export function validateEnvSchema(env, requiredKeys = []) {
  const values = {};
  const missing = [];
  for (const key of requiredKeys) {
    const value = getEnvValue(env, key);
    if (!value) missing.push(key);
    else values[key] = value;
  }
  return {
    ok: missing.length === 0,
    missing,
    values
  };
}

export function envConfigErrorResponse(request, env, {
  json = true,
  status = 503,
  methods,
  allowHeaders
} = {}) {
  if (json) {
    return jsonResponse(
      { message: 'Server configuration error' },
      { status, request, env, methods, allowHeaders }
    );
  }
  const headers = new Headers({ 'Content-Type': 'text/plain; charset=UTF-8' });
  withNoStore(headers);
  applyDefaultSecurityHeaders(headers);
  return new Response('Server configuration error', { status, headers });
}

/**
 * 스키마 검증 실패 시 안전한 에러 응답을 돌려줍니다.
 * 성공 시 { ok: true, values } — 실패 시 { ok: false, error: Response }.
 */
export function requireEnv(env, requiredKeys, request, responseOpts = {}) {
  const result = validateEnvSchema(env, requiredKeys);
  if (result.ok) {
    return { ok: true, values: result.values, error: null };
  }
  logSecurityEvent('env_schema_invalid', {
    path: request ? safePath(request) : 'unknown',
    missingCount: result.missing.length
  });
  return {
    ok: false,
    values: null,
    error: envConfigErrorResponse(request, env, responseOpts)
  };
}

/**
 * ADMIN_SECRET 을 timing-safe 하게 비교합니다.
 * 제공 값이 없거나 시크릿이 비어 있어도 비교는 항상 수행합니다.
 */
export async function verifyAdminSecret(provided, env) {
  const expected = getEnvValue(env, 'ADMIN_SECRET');
  const candidate = asComparableString(provided);
  const matches = await timingSafeEqual(candidate, expected);
  return Boolean(expected) && matches;
}

export async function signAdminProof(sessionId, env) {
  const secret = getEnvValue(env, 'ADMIN_SECRET');
  if (!secret || typeof sessionId !== 'string' || !sessionId) return '';
  return hmacSha256Hex(secret, `admin:${sessionId}`);
}

export async function verifyAdminProof(sessionId, proof, env) {
  const expected = await signAdminProof(sessionId, env);
  const matches = await timingSafeEqual(asComparableString(proof), expected || 'invalid');
  return Boolean(expected) && matches;
}

/**
 * 관리자 인가: ADMIN_SECRET 스키마 + (헤더 시크릿 또는 세션 HMAC proof).
 * 채널 ID 일치 여부는 호출 측에서 추가로 검사합니다.
 */
export async function authorizeAdminSecret(request, env, session) {
  const schema = validateEnvSchema(env, ADMIN_ENV_KEYS);
  const headerSecret = (request.headers.get('X-Admin-Secret') || '').trim();

  if (!schema.ok) {
    await verifyAdminSecret(headerSecret || 'missing', env);
    return false;
  }

  if (headerSecret) {
    return verifyAdminSecret(headerSecret, env);
  }

  return verifyAdminProof(session?.sessionId, session?.data?.adminProof, env);
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

/**
 * Access/Refresh/세션 등 인증 자격증명 쿠키.
 * HttpOnly, Secure, SameSite=Lax 는 호출자가 해제할 수 없습니다.
 */
export function buildAuthCookie(name, value, { maxAge, path = '/' } = {}) {
  return buildCookie(name, value, {
    maxAge,
    path,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax'
  });
}

export function appendSetCookie(headers, cookie) {
  headers.append('Set-Cookie', cookie);
}

function normalizeTokenTtl(seconds, fallback) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), SESSION_TTL_SECONDS);
}

export function readTokenCookies(request) {
  const cookies = parseCookies(request);
  const accessToken = cookies[ACCESS_COOKIE_NAME] || '';
  const refreshToken = cookies[REFRESH_COOKIE_NAME] || '';
  return {
    accessToken: accessToken || null,
    refreshToken: refreshToken || null
  };
}

export function attachTokenCookies(headers, {
  accessToken,
  refreshToken,
  accessMaxAge = ACCESS_TOKEN_TTL_SECONDS,
  refreshMaxAge = SESSION_TTL_SECONDS
} = {}) {
  if (typeof accessToken === 'string' && accessToken) {
    appendSetCookie(
      headers,
      buildAuthCookie(ACCESS_COOKIE_NAME, accessToken, {
        maxAge: normalizeTokenTtl(accessMaxAge, ACCESS_TOKEN_TTL_SECONDS),
        path: AUTH_COOKIE_PATH
      })
    );
  }
  if (typeof refreshToken === 'string' && refreshToken) {
    appendSetCookie(
      headers,
      buildAuthCookie(REFRESH_COOKIE_NAME, refreshToken, {
        maxAge: normalizeTokenTtl(refreshMaxAge, SESSION_TTL_SECONDS),
        path: AUTH_COOKIE_PATH
      })
    );
  }
}

export function clearTokenCookies(headers) {
  appendSetCookie(
    headers,
    buildAuthCookie(ACCESS_COOKIE_NAME, '', { maxAge: 0, path: AUTH_COOKIE_PATH })
  );
  appendSetCookie(
    headers,
    buildAuthCookie(REFRESH_COOKIE_NAME, '', { maxAge: 0, path: AUTH_COOKIE_PATH })
  );
}

export function attachOAuthStateCookie(headers, state) {
  appendSetCookie(
    headers,
    buildAuthCookie(OAUTH_STATE_COOKIE_NAME, state, {
      maxAge: CSRF_STATE_TTL_SECONDS,
      path: OAUTH_COOKIE_PATH
    })
  );
}

export function attachOAuthNextCookie(headers, nextPath) {
  if (nextPath) {
    appendSetCookie(
      headers,
      buildAuthCookie(OAUTH_NEXT_COOKIE_NAME, nextPath, {
        maxAge: CSRF_STATE_TTL_SECONDS,
        path: OAUTH_COOKIE_PATH
      })
    );
    return;
  }
  appendSetCookie(
    headers,
    buildAuthCookie(OAUTH_NEXT_COOKIE_NAME, '', {
      maxAge: 0,
      path: OAUTH_COOKIE_PATH
    })
  );
}

export function clearOAuthCookies(headers) {
  appendSetCookie(
    headers,
    buildAuthCookie(OAUTH_STATE_COOKIE_NAME, '', { maxAge: 0, path: OAUTH_COOKIE_PATH })
  );
  appendSetCookie(
    headers,
    buildAuthCookie(OAUTH_NEXT_COOKIE_NAME, '', { maxAge: 0, path: OAUTH_COOKIE_PATH })
  );
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
  const adminProof = await signAdminProof(sessionId, env);
  const data = {
    ...payload,
    csrfToken,
    adminProof: adminProof || undefined,
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
    const tokens = readTokenCookies(request);
    // KV에 토큰이 없으면 HttpOnly 쿠키에서만 복원. JS/localStorage 경로는 없음.
    if (!data.accessToken && tokens.accessToken) data.accessToken = tokens.accessToken;
    if (!data.refreshToken && tokens.refreshToken) data.refreshToken = tokens.refreshToken;
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

/**
 * 세션 KV에 필드를 병합합니다. TTL은 다시 SESSION_TTL_SECONDS로 연장됩니다.
 * csrfToken 등 보안 필드는 호출 측에서 덮어쓰지 마세요.
 */
export async function updateSession(env, sessionId, patch) {
  const kv = getSessionKv(env);
  if (!kv || !sessionId || !/^[a-f0-9]{64}$/i.test(sessionId)) return false;
  if (!patch || typeof patch !== 'object') return false;

  const raw = await kv.get(sessionKey(sessionId));
  if (!raw) return false;

  try {
    const data = JSON.parse(raw);
    const next = { ...data, ...patch, updatedAt: Date.now() };
    await kv.put(sessionKey(sessionId), JSON.stringify(next), { expirationTtl: SESSION_TTL_SECONDS });
    return true;
  } catch (_e) {
    return false;
  }
}

export function attachSessionCookies(headers, session) {
  appendSetCookie(
    headers,
    buildAuthCookie(SESSION_COOKIE_NAME, session.sessionId, {
      maxAge: SESSION_TTL_SECONDS,
      path: '/'
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
  attachTokenCookies(headers, {
    accessToken: session.data?.accessToken,
    refreshToken: session.data?.refreshToken,
    accessMaxAge: session.data?.expiresIn || ACCESS_TOKEN_TTL_SECONDS,
    refreshMaxAge: SESSION_TTL_SECONDS
  });
}

export function clearSessionCookies(headers) {
  appendSetCookie(
    headers,
    buildAuthCookie(SESSION_COOKIE_NAME, '', {
      maxAge: 0,
      path: '/'
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
  clearTokenCookies(headers);
}

// ---------------------------------------------------------------------------
// CSRF 검증
// ---------------------------------------------------------------------------

/**
 * OAuth CSRF state. `createdAtMs.nonce` 형식, 생성 시각 기준 5분 TTL.
 */
export function createCsrfState() {
  return `${Date.now()}.${randomToken(32)}`;
}

function parseCsrfStateTimestamp(state) {
  if (typeof state !== 'string') return null;
  const dot = state.indexOf('.');
  if (dot <= 0) return null;
  const tsPart = state.slice(0, dot);
  if (!/^[0-9]{12,13}$/.test(tsPart)) return null;
  const ts = Number(tsPart);
  if (!Number.isFinite(ts)) return null;
  return ts;
}

/**
 * 쿠키에 저장한 state와 콜백 state를 timing-safe 비교하고,
 * 쿠키 쪽 생성 시각 기준 5분(TTL)을 강제합니다.
 */
export async function validateCsrfState(provided, expected) {
  const equal = await timingSafeEqual(
    asComparableString(provided),
    asComparableString(expected)
  );
  if (!equal) return false;

  const createdAt = parseCsrfStateTimestamp(expected);
  if (createdAt === null) return false;

  const age = Date.now() - createdAt;
  if (age < -CSRF_STATE_CLOCK_SKEW_MS || age > CSRF_STATE_TTL_MS) return false;

  const nonce = expected.slice(expected.indexOf('.') + 1);
  if (!/^[a-f0-9]{64}$/i.test(nonce)) return false;
  return true;
}

/**
 * Double-Submit + Header Token 방식. 세 값(쿠키/헤더/세션 저장값)이 모두 일치해야 통과.
 * timing-safe 비교를 사용해 토큰 값 추론을 어렵게 합니다.
 */
export async function validateCsrf(request, sessionData) {
  const cookies = parseCookies(request);
  const csrfCookie = cookies[CSRF_COOKIE_NAME];
  const csrfHeader = request.headers.get('X-CSRF-Token');
  if (!csrfCookie || !csrfHeader || !sessionData?.csrfToken) {
    await timingSafeEqual('0', '1');
    return false;
  }
  const cookieMatchesHeader = await timingSafeEqual(csrfCookie, csrfHeader);
  const headerMatchesSession = await timingSafeEqual(csrfHeader, sessionData.csrfToken);
  return cookieMatchesHeader && headerMatchesSession;
}

// ---------------------------------------------------------------------------
// Origin / Same-Site 검증
// ---------------------------------------------------------------------------

function normalizeOrigin(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'null') return '';
  try {
    return new URL(trimmed).origin;
  } catch (_e) {
    return trimmed.replace(/\/+$/, '');
  }
}

function requestOrigin(request) {
  try {
    return new URL(request.url).origin;
  } catch (_e) {
    return '';
  }
}

/**
 * 환경변수 ALLOWED_ORIGIN(공백 구분으로 다중 허용) + 이 API 호스트(동일 출처).
 * 끝 슬래시·경로가 있어도 origin만 비교합니다.
 */
export function getAllowedOrigins(request, env) {
  const host = requestOrigin(request);
  const fromEnv = (env.ALLOWED_ORIGIN || '')
    .trim()
    .split(/\s+/)
    .map(normalizeOrigin)
    .filter(Boolean);
  const allowed = [];
  if (host) allowed.push(host);
  for (const origin of fromEnv) {
    if (!allowed.includes(origin)) allowed.push(origin);
  }
  return allowed;
}

export function resolveAllowedOrigin(request, env) {
  const allowed = getAllowedOrigins(request, env);
  const origin = normalizeOrigin(request.headers.get('Origin') || '');
  if (origin && allowed.includes(origin)) return origin;
  return allowed[0];
}

/**
 * 상태를 변경하는 요청(POST/PATCH/PUT/DELETE)에 대한 Origin 검증.
 * 이 호스트로의 same-origin 요청은 항상 허용합니다 (ALLOWED_ORIGIN 오설정·OBS CEF 대비).
 */
export function isAllowedMutationOrigin(request, env) {
  const allowed = getAllowedOrigins(request, env);
  const origin = normalizeOrigin(request.headers.get('Origin') || '');
  if (origin) return allowed.includes(origin);

  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite === 'same-origin') return true;

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

const RATE_MEMORY = new Map();
const RATE_MEMORY_MAX = 4000;
const RATE_SUBWINDOW_SECONDS_DEFAULT = 30;

function pruneRateMemory(now) {
  if (RATE_MEMORY.size < RATE_MEMORY_MAX) return;
  for (const [key, entry] of RATE_MEMORY) {
    if (now >= entry.resetAt) RATE_MEMORY.delete(key);
  }
  if (RATE_MEMORY.size < RATE_MEMORY_MAX) return;
  const overflow = RATE_MEMORY.size - Math.floor(RATE_MEMORY_MAX / 2);
  let removed = 0;
  for (const key of RATE_MEMORY.keys()) {
    RATE_MEMORY.delete(key);
    if (++removed >= overflow) break;
  }
}

function consumeMemoryRateLimit(key, windowMs, now) {
  let entry = RATE_MEMORY.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
  }
  entry.count += 1;
  RATE_MEMORY.set(key, entry);
  pruneRateMemory(now);
  return entry;
}

/**
 * isolate 인메모리 + KV 서브윈도우 카운터.
 * - 메모리는 동일 isolate 폭주를 즉시 차단합니다.
 * - KV는 10초 슬롯으로 나눠 전역 근사치를 모으며, 단일 키 RMW 레이스를 줄입니다.
 * - CF-Connecting-IP 가 없으면 보수적으로 차단합니다.
 */
export async function checkRateLimit(env, request, action, limit, windowSeconds, options = {}) {
  const ip = getClientIp(request);
  if (!ip) {
    return { allowed: false, remaining: 0, retryAfter: windowSeconds, reason: 'no_client_ip' };
  }

  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const mem = consumeMemoryRateLimit(`${action}:${ip}`, windowMs, now);
  const retryAfter = Math.max(1, Math.ceil((mem.resetAt - now) / 1000));

  if (mem.count > limit) {
    return { allowed: false, remaining: 0, retryAfter, reason: 'memory' };
  }

  const kv = getRateLimitKv(env);
  if (!kv) {
    return { allowed: true, remaining: Math.max(0, limit - mem.count), retryAfter };
  }

  const subwindow = Math.max(1, Number(options.subwindowSeconds) || RATE_SUBWINDOW_SECONDS_DEFAULT);
  const slot = Math.floor(now / 1000 / subwindow);
  const slots = Math.max(1, Math.ceil(windowSeconds / subwindow));
  const keys = [];
  for (let i = 0; i < slots; i++) {
    keys.push(`${RATE_LIMIT_KEY_PREFIX}${action}:${ip}:${slot - i}`);
  }

  const values = await Promise.all(keys.map((key) => kv.get(key)));
  const total = values.reduce((sum, value) => sum + (Number(value) || 0), 0);
  if (total >= limit) {
    return { allowed: false, remaining: 0, retryAfter, reason: 'kv' };
  }

  const next = (Number(values[0]) || 0) + 1;
  await kv.put(keys[0], String(next), { expirationTtl: windowSeconds + 10 });
  return { allowed: true, remaining: Math.max(0, limit - total - 1), retryAfter };
}

export function rateLimitedTextResponse(retryAfter = 60) {
  const headers = new Headers({
    'Content-Type': 'text/plain; charset=UTF-8',
    'Retry-After': String(retryAfter)
  });
  withNoStore(headers);
  applyDefaultSecurityHeaders(headers);
  return new Response('Too Many Requests', { status: 429, headers });
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
  // OAuth 팝업이 치지직 등 외부 origin을 거친 뒤에도 opener와 통신·닫기가 되도록 allow-popups 사용
  headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
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
export function jsonResponse(data, { status = 200, request, env, methods, allowHeaders, cacheable = false, retryAfter } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=UTF-8' });
  if (request && env) {
    const cors = corsHeaders(request, env, { methods, allowHeaders });
    cors.forEach((value, key) => headers.set(key, value));
  }
  if (!cacheable) withNoStore(headers);
  if (typeof retryAfter === 'number' && Number.isFinite(retryAfter)) {
    headers.set('Retry-After', String(Math.max(1, Math.floor(retryAfter))));
  }
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
