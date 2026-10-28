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
  CSV_CHUNK_DAYS,
  csvPartCount,
  isAdminChannelId,
  isAdminConfigured,
  readDailyMetrics,
  resolveSessionChannelId
} from '../../_lib/metrics.js';

const ALLOW_METHODS = 'GET, OPTIONS';
const ALLOW_HEADERS = 'Content-Type, X-CSRF-Token, X-Admin-Secret';
const FORBIDDEN_BODY = { message: 'Forbidden' };
const CSV_EXPORT_PREFIX = 'metrics:csv:';
const CSV_EXPORT_TTL_SECONDS = 600;
const CSV_HEADER = '날짜,DAU,방문,신규,재방문';

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
  if (format === 'csv') {
    return csvExport(request, env, session.sessionId);
  }
  if (format) {
    return jsonResponse({ message: 'Unsupported format' }, {
      status: 400, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  const metrics = await readDailyMetrics(env);
  return jsonResponse(metrics, {
    status: 200, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
  });
}

function metricsKv(env) {
  return env.LIVE_STATUS_CACHE || env.SESSION_STORE || null;
}

function exportKey(sessionId) {
  return `${CSV_EXPORT_PREFIX}${sessionId}`;
}

function csvLines(metrics) {
  const days = Array.isArray(metrics.days) ? metrics.days.slice().reverse() : [];
  return days.map((day) => [
    csvCell(day.date),
    Number(day.dau) || 0,
    Number(day.visits) || 0,
    Number(day.newUsers) || 0,
    Number(day.returningUsers) || 0
  ].join(','));
}

async function csvExport(request, env, sessionId) {
  const kv = metricsKv(env);
  if (!kv) {
    return jsonResponse({ message: 'Metrics store is not configured' }, {
      status: 503, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  const partRaw = new URL(request.url).searchParams.get('part');
  const key = exportKey(sessionId);
  if (partRaw === 'file') {
    const state = await kv.get(key, { type: 'json' });
    if (!state || state.next !== csvPartCount() || typeof state.csv !== 'string') {
      return jsonResponse({ message: 'Export is not ready' }, {
        status: 409, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
      });
    }
    return csvFileResponse(state.csv, request, env);
  }

  const parts = csvPartCount();
  const part = Number(partRaw);
  if (!Number.isInteger(part) || String(part) !== partRaw || part < 0 || part >= parts) {
    return jsonResponse({ message: 'Missing part' }, {
      status: 400, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  const previous = part === 0 ? null : await kv.get(key, { type: 'json' });
  if (part > 0 && (!previous || previous.next !== part || typeof previous.csv !== 'string')) {
    return jsonResponse({ message: 'Export is not ready' }, {
      status: 409, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  const offset = (parts - 1 - part) * CSV_CHUNK_DAYS;
  let metrics;
  try {
    metrics = await readDailyMetrics(env, CSV_CHUNK_DAYS, offset, { includeUnique: false });
  } catch (_e) {
    return jsonResponse({ message: 'Metrics read failed' }, {
      status: 503, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  const lines = csvLines(metrics).join('\r\n');
  const csv = part === 0
    ? `${CSV_HEADER}\r\n${lines}\r\n`
    : `${previous.csv}${lines}\r\n`;
  await kv.put(key, JSON.stringify({ next: part + 1, csv }), { expirationTtl: CSV_EXPORT_TTL_SECONDS });
  return jsonResponse({ part, parts }, {
    status: 200, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
  });
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvFileResponse(csv, request, env) {
  const headers = corsHeaders(request, env, { methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS });
  headers.set('Content-Type', 'text/csv; charset=UTF-8');
  headers.set('Content-Disposition', 'attachment; filename="cheese-stick-metrics.csv"');
  withNoStore(headers);
  applyDefaultSecurityHeaders(headers);
  return new Response(`\uFEFF${csv}`, { status: 200, headers });
}

export async function onRequestOptions(context) {
  const { request, env } = context;
  const headers = corsHeaders(request, env, { methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS });
  applyDefaultSecurityHeaders(headers);
  return new Response(null, { headers });
}
