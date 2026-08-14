import {
  applyDefaultSecurityHeaders,
  attachSessionCookies,
  AUTH_ENV_KEYS,
  checkRateLimit,
  clearOAuthCookies,
  clearSessionCookies,
  createSession,
  getCookie,
  logSecurityEvent,
  rateLimitedTextResponse,
  requireAllowedMethods,
  requireEnv,
  safePath,
  validateCsrfState,
  withNoStore
} from '../../_lib/security.js';

export async function onRequest(context) {
  const { env, request } = context;

  const methodErr = requireAllowedMethods(request, ['GET']);
  if (methodErr) return methodErr;

  const limit = await checkRateLimit(env, request, 'auth_callback', 12, 60, { subwindowSeconds: 10 });
  if (!limit.allowed) {
    logSecurityEvent('rate_limit_auth_callback', { path: safePath(request) });
    return rateLimitedTextResponse(limit.retryAfter || 60);
  }

  const envCheck = requireEnv(env, AUTH_ENV_KEYS, request, { json: false, status: 503 });
  if (!envCheck.ok) return envCheck.error;

  const { CLIENT_ID: clientId, CLIENT_SECRET: clientSecret } = envCheck.values;

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || typeof code !== 'string' || code.length > 512) {
    return new Response('Invalid request', { status: 400 });
  }

  // CSRF 방지: 쿠키 state와 콜백 state를 timing-safe 비교하고 5분 TTL을 강제.
  const savedState = getCookie('oauth_state', request);
  if (!state || !savedState || !(await validateCsrfState(state, savedState))) {
    logSecurityEvent('oauth_state_mismatch', { path: safePath(request) });
    const headers = new Headers({ 'Content-Type': 'text/plain; charset=UTF-8' });
    clearOAuthCookies(headers);
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

  const accessToken = tokenData?.content?.accessToken;
  const refreshToken = tokenData?.content?.refreshToken;
  if (!tokenResponse.ok || typeof accessToken !== 'string' || !accessToken) {
    logSecurityEvent('oauth_login_failed', {
      path: safePath(request),
      status: tokenResponse.status
    });
    return new Response('Authentication failed. Please try again.', { status: 401 });
  }

  const session = await createSession(env, {
    accessToken,
    refreshToken: typeof refreshToken === 'string' ? refreshToken : undefined,
    expiresIn: Number(tokenData.content.expiresIn) || undefined
  });
  if (!session) {
    logSecurityEvent('session_store_missing', { path: safePath(request) });
    const headers = new Headers({ 'Content-Type': 'text/html; charset=UTF-8' });
    withNoStore(headers);
    applyDefaultSecurityHeaders(headers);
    return new Response(
      `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>설정 필요</title></head><body>
<p><strong>세션 저장소(KV)가 연결되지 않았습니다.</strong></p>
<p>Cloudflare Pages → 프로젝트 → Settings → Functions → <strong>KV namespace bindings</strong>에서
<code>LIVE_STATUS_CACHE</code>와 <code>SESSION_STORE</code>를 추가한 뒤 재배포하세요.
(최소 <code>LIVE_STATUS_CACHE</code> 하나만 있어도 로그인은 동작합니다.)</p>
<p><a href="/">메인으로</a></p>
</body></html>`,
      { status: 503, headers }
    );
  }

  const nextCookie = getCookie('oauth_next', request);
  const redirectPath = (nextCookie === '/admin' || nextCookie === '/admin/')
    ? '/admin?oauth_complete=1'
    : '/?oauth_complete=1';

  const headers = new Headers({ Location: redirectPath });
  clearOAuthCookies(headers);
  clearSessionCookies(headers);
  attachSessionCookies(headers, session);
  withNoStore(headers);
  applyDefaultSecurityHeaders(headers);

  logSecurityEvent('oauth_login_success', { path: safePath(request) });
  return new Response(null, { status: 302, headers });
}
