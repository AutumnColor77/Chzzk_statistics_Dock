import {
  applyDefaultSecurityHeaders,
  checkRateLimit,
  corsHeaders,
  getSession,
  isSafeFetchSite,
  jsonResponse,
  logSecurityEvent,
  requireAllowedMethods,
  safePath,
  updateSession,
  withNoStore
} from '../../_lib/security.js';
import { extractChannelId, recordDailyActiveUser } from '../../_lib/metrics.js';

const ALLOW_METHODS = 'GET, OPTIONS';
const ALLOW_HEADERS = 'Content-Type, X-CSRF-Token';

export async function onRequest(context) {
  const { request, env } = context;

  const methodErr = requireAllowedMethods(request, ['GET']);
  if (methodErr) return methodErr;

  const limit = await checkRateLimit(env, request, 'users_me', 120, 60);
  if (!limit.allowed) {
    return jsonResponse({ message: 'Too many requests' }, {
      status: 429, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  if (!isSafeFetchSite(request, env)) {
    logSecurityEvent('fetch_site_blocked_users_me', { path: safePath(request) });
    return jsonResponse({ message: 'Forbidden origin' }, {
      status: 403, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  const session = await getSession(env, request);
  const accessToken = session?.data?.accessToken;
  if (!accessToken) {
    logSecurityEvent('session_missing_users_me', { path: safePath(request) });
    return jsonResponse({ message: 'Unauthorized' }, {
      status: 401, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  let upstream;
  let payload;
  try {
    upstream = await fetch('https://openapi.chzzk.naver.com/open/v1/users/me', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });
    payload = await upstream.json();
  } catch (_e) {
    logSecurityEvent('users_me_upstream_error', { path: safePath(request) });
    return jsonResponse({ message: 'Upstream error' }, {
      status: 502, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  const channelId = extractChannelId(payload);
  if (upstream.ok && channelId) {
    context.waitUntil((async () => {
      try {
        await updateSession(env, session.sessionId, { channelId });
        await recordDailyActiveUser(env, channelId);
      } catch (_e) {
        // 지표 기록 실패는 본 응답을 막지 않음
      }
    })());
  }

  const headers = corsHeaders(request, env, { methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS });
  headers.set('Content-Type', 'application/json; charset=UTF-8');
  withNoStore(headers);
  applyDefaultSecurityHeaders(headers);
  return new Response(JSON.stringify(payload), { status: upstream.status, headers });
}

export async function onRequestOptions(context) {
  const { request, env } = context;
  const headers = corsHeaders(request, env, { methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS });
  applyDefaultSecurityHeaders(headers);
  return new Response(null, { headers });
}
