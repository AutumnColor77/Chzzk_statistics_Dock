import {
  applyDefaultSecurityHeaders,
  attachOAuthNextCookie,
  attachOAuthStateCookie,
  checkRateLimit,
  createCsrfState,
  logSecurityEvent,
  rateLimitedTextResponse,
  requireAllowedMethods,
  requireEnv,
  AUTH_ENV_KEYS,
  safePath,
  withNoStore
} from '../../_lib/security.js';

function resolveOAuthNextPath(request) {
  try {
    const next = new URL(request.url).searchParams.get('next');
    if (next === '/admin' || next === '/admin/') return '/admin';
  } catch (_e) {
    // ignore
  }
  return '';
}

export async function onRequest(context) {
  const { env, request } = context;

  const methodErr = requireAllowedMethods(request, ['GET']);
  if (methodErr) return methodErr;

  const limit = await checkRateLimit(env, request, 'auth_login', 10, 60, { subwindowSeconds: 10 });
  if (!limit.allowed) {
    logSecurityEvent('rate_limit_auth_login', { path: safePath(request) });
    return rateLimitedTextResponse(limit.retryAfter || 60);
  }

  const envCheck = requireEnv(env, AUTH_ENV_KEYS, request, { json: false, status: 503 });
  if (!envCheck.ok) return envCheck.error;

  const clientId = envCheck.values.CLIENT_ID;
  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/callback`;
  // 생성 시각이 포함된 CSRF state — 콜백에서 5분 TTL 검증.
  const state = createCsrfState();

  const authUrl = new URL('https://chzzk.naver.com/account-interlock');
  authUrl.searchParams.set('clientId', clientId);
  authUrl.searchParams.set('redirectUri', redirectUri);
  authUrl.searchParams.set('state', state);

  const headers = new Headers({ 'Location': authUrl.toString() });
  attachOAuthStateCookie(headers, state);
  attachOAuthNextCookie(headers, resolveOAuthNextPath(request));
  withNoStore(headers);
  applyDefaultSecurityHeaders(headers);

  logSecurityEvent('oauth_login_start', { path: safePath(request) });
  return new Response(null, { status: 302, headers });
}
