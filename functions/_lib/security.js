const SESSION_COOKIE_NAME = 'chzzk_session';
const CSRF_COOKIE_NAME = 'chzzk_csrf';
const SESSION_KEY_PREFIX = 'session:';
const RATE_LIMIT_KEY_PREFIX = 'rl:';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

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

export function parseCookies(request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const entries = cookieHeader.split(';').map((part) => part.trim()).filter(Boolean);
  const cookies = {};
  for (const entry of entries) {
    const idx = entry.indexOf('=');
    if (idx === -1) continue;
    const key = entry.slice(0, idx).trim();
    const value = entry.slice(idx + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

export function getCookie(name, request) {
  return parseCookies(request)[name] || null;
}

function getKv(env) {
  return env.SESSION_STORE || env.LIVE_STATUS_CACHE || null;
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

function sessionKey(sessionId) {
  return `${SESSION_KEY_PREFIX}${sessionId}`;
}

export async function createSession(env, payload) {
  const kv = getKv(env);
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
  const kv = getKv(env);
  if (!kv) return null;

  const sessionId = getCookie(SESSION_COOKIE_NAME, request);
  if (!sessionId) return null;

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
  const kv = getKv(env);
  if (!kv) return;

  const sessionId = getCookie(SESSION_COOKIE_NAME, request);
  if (!sessionId) return;
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

export function validateCsrf(request, sessionData) {
  const cookies = parseCookies(request);
  const csrfCookie = cookies[CSRF_COOKIE_NAME];
  const csrfHeader = request.headers.get('X-CSRF-Token');
  if (!csrfCookie || !csrfHeader || !sessionData?.csrfToken) return false;
  return csrfCookie === csrfHeader && csrfHeader === sessionData.csrfToken;
}

function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

export async function checkRateLimit(env, request, action, limit, windowSeconds) {
  const kv = getKv(env);
  if (!kv) return { allowed: true, remaining: limit };

  const ip = getClientIp(request);
  const nowBucket = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `${RATE_LIMIT_KEY_PREFIX}${action}:${ip}:${nowBucket}`;
  const current = Number((await kv.get(key)) || '0');
  if (current >= limit) {
    return { allowed: false, remaining: 0 };
  }

  await kv.put(key, String(current + 1), { expirationTtl: windowSeconds + 10 });
  return { allowed: true, remaining: limit - current - 1 };
}

export function logSecurityEvent(event, details = {}) {
  const payload = {
    at: new Date().toISOString(),
    event,
    ...details
  };
  console.log('[security]', JSON.stringify(payload));
}

export function withNoStore(headers) {
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');
}

export function requireAllowedMethods(request, methods) {
  if (!methods.includes(request.method)) {
    return new Response('Method Not Allowed', { status: 405 });
  }
  return null;
}
