import {
  applyDefaultSecurityHeaders,
  checkRateLimit,
  logSecurityEvent,
  randomToken,
  requireAllowedMethods,
  safePath,
  withNoStore
} from '../../_lib/security.js';

export async function onRequest(context) {
  const { env, request } = context;

  const methodErr = requireAllowedMethods(request, ['GET']);
  if (methodErr) return methodErr;

  const limit = await checkRateLimit(env, request, 'auth_login', 20, 60);
  if (!limit.allowed) {
    logSecurityEvent('rate_limit_auth_login', { path: safePath(request) });
    return new Response('Too Many Requests', { status: 429 });
  }

  const clientId = env.CHZZK_CLIENT_ID;
  if (!clientId) {
    logSecurityEvent('auth_login_misconfigured', { path: safePath(request) });
    // 환경변수 이름은 노출하지 않습니다.
    return new Response('Server configuration error', { status: 503 });
  }

  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/callback`;
  // 256bit 무작위 state — UUID보다 강한 엔트로피.
  const state = randomToken(32);

  const authUrl = new URL('https://chzzk.naver.com/account-interlock');
  authUrl.searchParams.set('clientId', clientId);
  authUrl.searchParams.set('redirectUri', redirectUri);
  authUrl.searchParams.set('state', state);

  const headers = new Headers({ 'Location': authUrl.toString() });
  headers.set(
    'Set-Cookie',
    `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=600`
  );
  withNoStore(headers);
  applyDefaultSecurityHeaders(headers);

  logSecurityEvent('oauth_login_start', { path: safePath(request) });
  return new Response(null, { status: 302, headers });
}
