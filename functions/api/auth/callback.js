import {
  appendSetCookie,
  applyDefaultSecurityHeaders,
  attachSessionCookies,
  checkRateLimit,
  clearSessionCookies,
  createSession,
  getCookie,
  logSecurityEvent,
  requireAllowedMethods,
  safePath,
  timingSafeEqual,
  withNoStore
} from '../../_lib/security.js';

/**
 * OAuth 콜백 응답 HTML.
 * 인라인 스크립트를 사용하지 않고 별도 모듈(/js/auth-callback.js)을 로드합니다.
 * 이를 통해 콜백 응답에 'unsafe-inline' 없는 엄격한 CSP를 적용할 수 있습니다.
 */
const CALLBACK_HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authentication Successful</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body class="callback-body">
  <main class="callback-card" role="status" aria-live="polite">
    <p class="callback-title">로그인 처리 중...</p>
    <p class="callback-desc">이 창이 자동으로 닫히지 않으면 직접 닫아주세요.</p>
    <p class="callback-fallback"><a href="/">Cheese Stick Dock으로 돌아가기</a></p>
  </main>
  <script src="/js/auth-callback.js"></script>
</body>
</html>`;

const CALLBACK_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

export async function onRequest(context) {
  const { env, request } = context;

  const methodErr = requireAllowedMethods(request, ['GET']);
  if (methodErr) return methodErr;

  const limit = await checkRateLimit(env, request, 'auth_callback', 30, 60);
  if (!limit.allowed) {
    logSecurityEvent('rate_limit_auth_callback', { path: safePath(request) });
    return new Response('Too Many Requests', { status: 429 });
  }

  const clientId = env.CHZZK_CLIENT_ID;
  const clientSecret = env.CHZZK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    logSecurityEvent('auth_callback_misconfigured', { path: safePath(request) });
    return new Response('Server configuration error', { status: 500 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || typeof code !== 'string' || code.length > 512) {
    return new Response('Invalid request', { status: 400 });
  }

  // CSRF 방지: 쿠키에 저장된 state와 콜백 state를 timing-safe 비교.
  const savedState = getCookie('oauth_state', request);
  if (!state || !savedState || !timingSafeEqual(state, savedState)) {
    logSecurityEvent('oauth_state_mismatch', { path: safePath(request) });
    // 잘못된 state 쿠키를 즉시 제거.
    const headers = new Headers({ 'Content-Type': 'text/plain; charset=UTF-8' });
    appendSetCookie(headers, 'oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=0');
    withNoStore(headers);
    applyDefaultSecurityHeaders(headers);
    return new Response('Invalid state parameter. Please retry login.', { status: 400, headers });
  }

  let tokenResponse;
  let tokenData;
  try {
    tokenResponse = await fetch('https://openapi.chzzk.naver.com/auth/v1/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        grantType: 'authorization_code',
        clientId,
        clientSecret,
        code,
        state
      })
    });
    tokenData = await tokenResponse.json();
  } catch (_e) {
    logSecurityEvent('oauth_token_fetch_error', { path: safePath(request) });
    return new Response('Authentication failed. Please try again.', { status: 502 });
  }

  if (!tokenResponse.ok || !tokenData?.content?.accessToken) {
    logSecurityEvent('oauth_login_failed', {
      path: safePath(request),
      status: tokenResponse.status
    });
    return new Response('Authentication failed. Please try again.', { status: 401 });
  }

  const session = await createSession(env, {
    accessToken: tokenData.content.accessToken
  });
  if (!session) {
    logSecurityEvent('session_store_missing', { path: safePath(request) });
    return new Response('Session store is not configured.', { status: 503 });
  }

  const headers = new Headers({ 'Content-Type': 'text/html; charset=UTF-8' });
  // 콜백 응답에는 'unsafe-inline' 없는 엄격한 CSP를 직접 부여.
  headers.set('Content-Security-Policy', CALLBACK_CSP);
  appendSetCookie(headers, 'oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=0');
  clearSessionCookies(headers);
  attachSessionCookies(headers, session);
  withNoStore(headers);
  applyDefaultSecurityHeaders(headers);

  logSecurityEvent('oauth_login_success', { path: safePath(request) });
  return new Response(CALLBACK_HTML, { headers });
}
