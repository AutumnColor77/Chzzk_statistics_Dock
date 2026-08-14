import {
  applyDefaultSecurityHeaders,
  AUTH_ENV_KEYS,
  checkRateLimit,
  clearSessionCookies,
  corsHeaders,
  deleteSession,
  getSession,
  isAllowedMutationOrigin,
  jsonResponse,
  logSecurityEvent,
  requireAllowedMethods,
  requireEnv,
  safePath,
  validateCsrf,
  withNoStore
} from '../../_lib/security.js';

const ALLOW_HEADERS = 'Content-Type, X-CSRF-Token';
const ALLOW_METHODS = 'POST, OPTIONS';

export async function onRequest(context) {
  const { request, env } = context;

  const methodErr = requireAllowedMethods(request, ['POST']);
  if (methodErr) return methodErr;

  const limit = await checkRateLimit(env, request, 'auth_revoke', 10, 60, { subwindowSeconds: 10 });
  if (!limit.allowed) {
    logSecurityEvent('rate_limit_auth_revoke', { path: safePath(request) });
    return jsonResponse({ success: false, message: 'Too many requests' }, {
      status: 429, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS,
      retryAfter: limit.retryAfter || 60
    });
  }

  // 세션 유무와 무관하게 Origin 검증을 강제 (Logout-CSRF 차단).
  if (!isAllowedMutationOrigin(request, env)) {
    logSecurityEvent('origin_validation_failed_revoke', { path: safePath(request) });
    return jsonResponse({ success: false, message: 'Forbidden origin' }, {
      status: 403, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  const envCheck = requireEnv(env, AUTH_ENV_KEYS, request, {
    json: true, status: 503, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
  });
  if (!envCheck.ok) return envCheck.error;
  const { CLIENT_ID: clientId, CLIENT_SECRET: clientSecret } = envCheck.values;

  const session = await getSession(env, request);

  // 세션이 존재하면 CSRF 토큰을 반드시 검증.
  if (session?.data && !(await validateCsrf(request, session.data))) {
    logSecurityEvent('csrf_validation_failed_revoke', { path: safePath(request) });
    return jsonResponse({ success: false, message: 'Invalid CSRF token' }, {
      status: 403, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  const token = session?.data?.accessToken;
  let revokeOk = true;
  let upstreamStatus = null;

  if (token) {
    try {
      const upstream = await fetch('https://openapi.chzzk.naver.com/auth/v1/token/revoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ clientId, clientSecret, token })
      });
      upstreamStatus = upstream.status;
      revokeOk = upstream.ok;
      if (!upstream.ok) {
        logSecurityEvent('token_revoke_failed', { status: upstream.status, path: safePath(request) });
      }
    } catch (_e) {
      revokeOk = false;
      logSecurityEvent('token_revoke_error', { path: safePath(request) });
    }
  }

  // 외부 폐기 성공/실패와 무관하게 로컬 세션과 쿠키는 항상 정리.
  await deleteSession(env, request);

  const headers = corsHeaders(request, env, { methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS });
  headers.set('Content-Type', 'application/json; charset=UTF-8');
  withNoStore(headers);
  applyDefaultSecurityHeaders(headers);
  clearSessionCookies(headers);

  if (token && !revokeOk) {
    // 외부 폐기 실패는 명시적으로 알려서 사용자가 재시도하거나 토큰 강제 만료를 인지하도록 합니다.
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Local session cleared, but upstream token revoke failed. Please retry.',
        upstreamStatus
      }),
      { status: 502, headers }
    );
  }

  return new Response(JSON.stringify({ success: true }), { headers });
}

export async function onRequestOptions(context) {
  const { request, env } = context;
  const headers = corsHeaders(request, env, { methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS });
  applyDefaultSecurityHeaders(headers);
  return new Response(null, { headers });
}
