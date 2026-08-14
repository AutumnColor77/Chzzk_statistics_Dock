import {
  ADMIN_ENV_KEYS,
  applyDefaultSecurityHeaders,
  authorizeAdminSecret,
  checkRateLimit,
  corsHeaders,
  getSession,
  isSafeFetchSite,
  jsonResponse,
  logSecurityEvent,
  requireAllowedMethods,
  safePath,
  validateEnvSchema
} from '../../_lib/security.js';
import {
  isAdminChannelId,
  isAdminConfigured,
  readDailyMetrics,
  resolveSessionChannelId
} from '../../_lib/metrics.js';

const ALLOW_METHODS = 'GET, OPTIONS';
const ALLOW_HEADERS = 'Content-Type, X-CSRF-Token, X-Admin-Secret';
const FORBIDDEN_BODY = { message: 'Forbidden' };

function forbidden(request, env) {
  return jsonResponse(FORBIDDEN_BODY, {
    status: 403, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  const methodErr = requireAllowedMethods(request, ['GET']);
  if (methodErr) return methodErr;

  const limit = await checkRateLimit(env, request, 'admin_metrics', 20, 60, { subwindowSeconds: 10 });
  if (!limit.allowed) {
    logSecurityEvent('rate_limit_admin_metrics', { path: safePath(request) });
    return jsonResponse({ message: 'Too many requests' }, {
      status: 429, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS,
      retryAfter: limit.retryAfter || 60
    });
  }

  if (!isSafeFetchSite(request, env)) {
    logSecurityEvent('fetch_site_blocked_admin_metrics', { path: safePath(request) });
    return forbidden(request, env);
  }

  const session = await getSession(env, request);
  if (!session?.data?.accessToken) {
    logSecurityEvent('admin_metrics_unauthenticated', { path: safePath(request) });
    return jsonResponse({ message: 'Unauthorized' }, {
      status: 401, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  // 미설정·비운영자 모두 동일한 403 — 설정 여부/운영자 존재를 응답으로 구분하지 않음.
  const envCheck = validateEnvSchema(env, ADMIN_ENV_KEYS);
  if (!envCheck.ok || !isAdminConfigured(env)) {
    logSecurityEvent('admin_metrics_misconfigured', { path: safePath(request) });
    return forbidden(request, env);
  }

  const secretOk = await authorizeAdminSecret(request, env, session);
  if (!secretOk) {
    logSecurityEvent('admin_metrics_secret_denied', { path: safePath(request) });
    return forbidden(request, env);
  }

  const channelId = await resolveSessionChannelId(env, session);
  if (!channelId || !(await isAdminChannelId(channelId, env))) {
    logSecurityEvent('admin_metrics_forbidden', { path: safePath(request) });
    return forbidden(request, env);
  }

  const metrics = await readDailyMetrics(env, 30);
  return jsonResponse(metrics, {
    status: 200, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
  });
}

export async function onRequestOptions(context) {
  const { request, env } = context;
  const headers = corsHeaders(request, env, { methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS });
  applyDefaultSecurityHeaders(headers);
  return new Response(null, { headers });
}
