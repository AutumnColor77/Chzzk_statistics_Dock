import {
  checkRateLimit,
  clearSessionCookies,
  deleteSession,
  getSession,
  logSecurityEvent,
  requireAllowedMethods,
  validateCsrf,
  withNoStore
} from '../../_lib/security.js';

export async function onRequest(context) {
  const { request, env } = context;
  const allowedOrigin = env.ALLOWED_ORIGIN || new URL(request.url).origin;

  const methodErr = requireAllowedMethods(request, ['POST']);
  if (methodErr) return methodErr;

  const limit = await checkRateLimit(env, request, 'auth_revoke', 20, 60);
  if (!limit.allowed) return new Response('Too Many Requests', { status: 429 });

  const clientId = env.CHZZK_CLIENT_ID;
  const clientSecret = env.CHZZK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new Response('Server configuration missing', { status: 500 });
  }

  const session = await getSession(env, request);
  const token = session?.data?.accessToken;
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin
  });
  withNoStore(headers);

  if (session?.data && !validateCsrf(request, session.data)) {
    logSecurityEvent('csrf_validation_failed_revoke', { url: request.url });
    return new Response(JSON.stringify({ success: false, message: 'Invalid CSRF token' }), {
      status: 403,
      headers
    });
  }

  try {
    if (token) {
      const revokeResponse = await fetch('https://openapi.chzzk.naver.com/auth/v1/token/revoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: clientId,
          clientSecret: clientSecret,
          token: token,
        }),
      });
      if (!revokeResponse.ok) {
        logSecurityEvent('token_revoke_failed', { status: revokeResponse.status });
      }
    }

    await deleteSession(env, request);
    clearSessionCookies(headers);
    return new Response(JSON.stringify({ success: true }), { headers });
  } catch (_error) {
    logSecurityEvent('token_revoke_error', { url: request.url });
    clearSessionCookies(headers);
    return new Response(JSON.stringify({ success: false, message: 'Server error' }), {
      status: 500,
      headers,
    });
  }
}

export async function onRequestOptions(context) {
  const { request, env } = context;
  const allowedOrigin = env.ALLOWED_ORIGIN || new URL(request.url).origin;
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
    },
  });
}
