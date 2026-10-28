import {
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
  withNoStore
} from '../../_lib/security.js';
import {
  EXPORT_DAYS,
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

  // 채널 ID 미설정·비운영자는 동일한 403. HMAC 실패는 재로그인(401)로 구분.
  if (!isAdminConfigured(env)) {
    logSecurityEvent('admin_metrics_misconfigured', { path: safePath(request) });
    return forbidden(request, env);
  }

  const secretOk = await authorizeAdminSecret(request, env, session);
  if (!secretOk) {
    logSecurityEvent('admin_metrics_secret_denied', { path: safePath(request) });
    return jsonResponse({ message: 'Unauthorized' }, {
      status: 401, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  const channelId = await resolveSessionChannelId(env, session);
  if (!channelId || !(await isAdminChannelId(channelId, env))) {
    logSecurityEvent('admin_metrics_forbidden', { path: safePath(request) });
    return forbidden(request, env);
  }

  const format = new URL(request.url).searchParams.get('format');
  if (format && format !== 'csv') {
    return jsonResponse({ message: 'Unsupported format' }, {
      status: 400, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  const metrics = format === 'csv'
    ? await readDailyMetrics(env, EXPORT_DAYS)
    : await readDailyMetrics(env);
  if (format === 'csv') {
    return csvResponse(metrics, request, env);
  }
  return jsonResponse(metrics, {
    status: 200, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
  });
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function metricsToCsv(metrics) {
  const days = Array.isArray(metrics.days) ? metrics.days.slice().reverse() : [];
  const lines = ['날짜,DAU,방문,신규,재방문'];
  for (const day of days) {
    lines.push([
      csvCell(day.date),
      Number(day.dau) || 0,
      Number(day.visits) || 0,
      Number(day.newUsers) || 0,
      Number(day.returningUsers) || 0
    ].join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function csvResponse(metrics, request, env) {
  const headers = corsHeaders(request, env, { methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS });
  headers.set('Content-Type', 'text/csv; charset=UTF-8');
  headers.set('Content-Disposition', 'attachment; filename="cheese-stick-metrics.csv"');
  withNoStore(headers);
  applyDefaultSecurityHeaders(headers);
  return new Response(metricsToCsv(metrics), { status: 200, headers });
}

export async function onRequestOptions(context) {
  const { request, env } = context;
  const headers = corsHeaders(request, env, { methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS });
  applyDefaultSecurityHeaders(headers);
  return new Response(null, { headers });
}
