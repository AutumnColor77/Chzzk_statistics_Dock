import { checkRateLimit, logSecurityEvent, requireAllowedMethods, withNoStore } from '../../_lib/security.js';

export async function onRequest(context) {
  const { env, request } = context;
  const methodErr = requireAllowedMethods(request, ['GET']);
  if (methodErr) return methodErr;

  const limit = await checkRateLimit(env, request, 'auth_login', 20, 60);
  if (!limit.allowed) {
    logSecurityEvent('rate_limit_auth_login', { url: request.url });
    return new Response('Too Many Requests', { status: 429 });
  }

  const clientId = env.CHZZK_CLIENT_ID;
  
  if (!clientId) {
    return new Response('CHZZK_CLIENT_ID is not configured in environment variables.', { status: 500 });
  }

  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/callback`;
  const state = crypto.randomUUID();

  const authUrl = new URL('https://chzzk.naver.com/account-interlock');
  authUrl.searchParams.set('clientId', clientId);
  authUrl.searchParams.set('redirectUri', redirectUri);
  authUrl.searchParams.set('state', state);

  // state를 HttpOnly 쿠키에 저장하여 callback에서 CSRF 검증
  const response = Response.redirect(authUrl.toString(), 302);
  const redirectResponse = new Response(null, {
    status: 302,
    headers: response.headers,
  });
  redirectResponse.headers.set('Location', authUrl.toString());
  redirectResponse.headers.set(
    'Set-Cookie',
    `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=300`
  );
  withNoStore(redirectResponse.headers);

  logSecurityEvent('oauth_login_start', { url: request.url });
  return redirectResponse;
}
