// Access/Refresh/세션 쿠키에 HttpOnly, Secure, SameSite=Lax 를 강제합니다.
// 핸들러가 속성을 빠뜨려도 브라우저 JS·localStorage 로 토큰이 노출되지 않습니다.

const FORCED_HTTPONLY_COOKIES = new Set([
  'chzzk_session',
  'chzzk_access',
  'chzzk_refresh',
  'oauth_state',
  'oauth_next'
]);

const FORCED_SECURE_COOKIES = new Set([
  ...FORCED_HTTPONLY_COOKIES,
  'chzzk_csrf'
]);

function readSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  const single = headers.get('Set-Cookie');
  return single ? [single] : [];
}

function enforceAuthCookieFlags(cookie) {
  const eq = cookie.indexOf('=');
  if (eq <= 0) return cookie;
  const name = cookie.slice(0, eq).trim();
  if (!FORCED_SECURE_COOKIES.has(name)) return cookie;

  const segments = cookie.split(';').map((part) => part.trim()).filter(Boolean);
  const pair = segments[0];
  const attrs = new Map();
  for (let i = 1; i < segments.length; i++) {
    const attr = segments[i];
    const idx = attr.indexOf('=');
    const key = (idx === -1 ? attr : attr.slice(0, idx)).trim().toLowerCase();
    const value = idx === -1 ? true : attr.slice(idx + 1).trim();
    if (key === 'samesite' || key === 'httponly' || key === 'secure') continue;
    attrs.set(key, value);
  }

  const next = [pair];
  if (attrs.has('path')) next.push(`Path=${attrs.get('path')}`);
  if (attrs.has('max-age')) next.push(`Max-Age=${attrs.get('max-age')}`);
  if (attrs.has('expires')) next.push(`Expires=${attrs.get('expires')}`);
  if (attrs.has('domain')) next.push(`Domain=${attrs.get('domain')}`);
  next.push('SameSite=Lax');
  if (FORCED_HTTPONLY_COOKIES.has(name)) next.push('HttpOnly');
  next.push('Secure');
  return next.join('; ');
}

export async function onRequest(context) {
  const response = await context.next();
  const cookies = readSetCookies(response.headers);
  if (!cookies.length) return response;

  const headers = new Headers(response.headers);
  headers.delete('Set-Cookie');
  for (const cookie of cookies) {
    headers.append('Set-Cookie', enforceAuthCookieFlags(cookie));
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
