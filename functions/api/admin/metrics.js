import {
  applyDefaultSecurityHeaders,
  checkRateLimit,
  corsHeaders,
  getSession,
  isSafeFetchSite,
  jsonResponse,
  logSecurityEvent,
  requireAllowedMethods,
  safePath
} from '../../_lib/security.js';
import {
  isAdminChannelId,
  isAdminConfigured,
  readDailyMetrics,
  resolveSessionChannelId
} from '../../_lib/metrics.js';

const ALLOW_METHODS = 'GET, OPTIONS';
const ALLOW_HEADERS = 'Content-Type, X-CSRF-Token';
const FORBIDDEN_BODY = { message: 'Forbidden' };

export async function onRequest(context) {
  const { request, env } = context;

  const methodErr = requireAllowedMethods(request, ['GET']);
  if (methodErr) return methodErr;

  const limit = await checkRateLimit(env, request, 'admin_metrics', 30, 60);
  if (!limit.allowed) {
    logSecurityEvent('rate_limit_admin_metrics', { path: safePath(request) });
    return jsonResponse({ message: 'Too many requests' }, {
      status: 429, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  if (!isSafeFetchSite(request, env)) {
    logSecurityEvent('fetch_site_blocked_admin_metrics', { path: safePath(request) });
    return jsonResponse(FORBIDDEN_BODY, {
      status: 403, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  const session = await getSession(env, request);
  if (!session?.data?.accessToken) {
    logSecurityEvent('admin_metrics_unauthenticated', { path: safePath(request) });
    return jsonResponse({ message: 'Unauthorized' }, {
      status: 401, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  // 미설정·비운영자 모두 동일한 403 — 설정 여부/운영자 존재를 응답으로 구분하지 않음.
  if (!isAdminConfigured(env)) {
    logSecurityEvent('admin_metrics_misconfigured', { path: safePath(request) });
    return jsonResponse(FORBIDDEN_BODY, {
      status: 403, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  const channelId = await resolveSessionChannelId(env, session);
  if (!channelId || !isAdminChannelId(channelId, env)) {
    logSecurityEvent('admin_metrics_forbidden', { path: safePath(request) });
    return jsonResponse(FORBIDDEN_BODY, {
      status: 403, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
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
