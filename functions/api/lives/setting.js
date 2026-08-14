import {
  applyDefaultSecurityHeaders,
  checkRateLimit,
  corsHeaders,
  getSession,
  isAllowedMutationOrigin,
  isSafeFetchSite,
  jsonResponse,
  logSecurityEvent,
  requireAllowedMethods,
  safePath,
  validateCsrf,
  withNoStore
} from '../../_lib/security.js';

const ALLOW_METHODS = 'GET, PATCH, OPTIONS';
const ALLOW_HEADERS = 'Content-Type, X-CSRF-Token';
const MAX_BODY_BYTES = 8 * 1024; // 8KB
const ALLOWED_CATEGORY_TYPES = new Set(['GAME', 'SPORTS', 'ETC']);
const CATEGORY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const TAG_MAX_LENGTH = 30;
const MAX_TAGS = 10;
const TITLE_MAX_LENGTH = 100;

function validateSettingsBody(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'Body must be a JSON object' };
  }

  const out = {};

  if (Object.prototype.hasOwnProperty.call(raw, 'defaultLiveTitle')) {
    const v = raw.defaultLiveTitle;
    if (typeof v !== 'string') return { error: 'defaultLiveTitle must be a string' };
    if (v.length > TITLE_MAX_LENGTH) return { error: `defaultLiveTitle too long (max ${TITLE_MAX_LENGTH})` };
    out.defaultLiveTitle = v;
  }

  if (Object.prototype.hasOwnProperty.call(raw, 'categoryType')) {
    const v = raw.categoryType;
    if (typeof v !== 'string' || !ALLOWED_CATEGORY_TYPES.has(v)) {
      return { error: 'Invalid categoryType' };
    }
    out.categoryType = v;
  }

  if (Object.prototype.hasOwnProperty.call(raw, 'categoryId')) {
    const v = raw.categoryId;
    if (typeof v !== 'string') return { error: 'categoryId must be a string' };
    if (v.length > 0 && !CATEGORY_ID_PATTERN.test(v)) {
      return { error: 'Invalid categoryId format' };
    }
    if (v.length > 0) out.categoryId = v;
  }

  if (Object.prototype.hasOwnProperty.call(raw, 'tags')) {
    const v = raw.tags;
    if (!Array.isArray(v)) return { error: 'tags must be an array' };
    if (v.length > MAX_TAGS) return { error: `Too many tags (max ${MAX_TAGS})` };
    const cleaned = [];
    for (const tag of v) {
      if (typeof tag !== 'string') return { error: 'tag must be a string' };
      const trimmed = tag.trim();
      if (!trimmed) continue;
      if (trimmed.length > TAG_MAX_LENGTH) return { error: `tag too long (max ${TAG_MAX_LENGTH})` };
      cleaned.push(trimmed);
    }
    out.tags = cleaned;
  }

  return { body: out };
}

export async function onRequest(context) {
  const { request, env } = context;

  const methodErr = requireAllowedMethods(request, ['GET', 'PATCH']);
  if (methodErr) return methodErr;

  const action = request.method === 'PATCH' ? 'lives_setting_patch' : 'lives_setting_get';
  const limit = await checkRateLimit(env, request, action, request.method === 'PATCH' ? 30 : 120, 60);
  if (!limit.allowed) {
    return jsonResponse({ message: 'Too many requests' }, {
      status: 429, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  if (request.method === 'PATCH') {
    if (!isAllowedMutationOrigin(request, env)) {
      logSecurityEvent('origin_validation_failed_lives_setting', { path: safePath(request) });
      return jsonResponse({ message: 'Forbidden origin' }, {
        status: 403, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
      });
    }
  } else if (!isSafeFetchSite(request, env)) {
    logSecurityEvent('fetch_site_blocked_lives_setting', { path: safePath(request) });
    return jsonResponse({ message: 'Forbidden origin' }, {
      status: 403, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  const session = await getSession(env, request);
  const accessToken = session?.data?.accessToken;
  if (!accessToken) {
    logSecurityEvent('session_missing_lives_setting', { method: request.method, path: safePath(request) });
    return jsonResponse({ message: 'Unauthorized' }, {
      status: 401, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  if (request.method === 'PATCH' && !(await validateCsrf(request, session.data))) {
    logSecurityEvent('csrf_validation_failed', { path: safePath(request) });
    return jsonResponse({ message: 'Invalid CSRF token' }, {
      status: 403, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  const apiUrl = 'https://openapi.chzzk.naver.com/open/v1/lives/setting';

  const fetchOptions = {
    method: request.method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  };

  if (request.method === 'PATCH') {
    let rawText;
    try {
      rawText = await request.text();
    } catch (_e) {
      return jsonResponse({ message: 'Invalid request body' }, {
        status: 400, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
      });
    }

    if (!rawText || rawText.length > MAX_BODY_BYTES) {
      return jsonResponse({ message: 'Body is empty or too large' }, {
        status: 413, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (_e) {
      return jsonResponse({ message: 'Invalid JSON body' }, {
        status: 400, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
      });
    }

    const { body, error } = validateSettingsBody(parsed);
    if (error) {
      return jsonResponse({ message: error }, {
        status: 400, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
      });
    }

    if (Object.keys(body).length === 0) {
      return jsonResponse({ message: 'No valid fields to update' }, {
        status: 400, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
      });
    }

    fetchOptions.body = JSON.stringify(body);
  }

  let upstream;
  let payload;
  try {
    upstream = await fetch(apiUrl, fetchOptions);
    payload = await upstream.json();
  } catch (_e) {
    logSecurityEvent('lives_setting_upstream_error', { path: safePath(request) });
    return jsonResponse({ message: 'Upstream error' }, {
      status: 502, request, env, methods: ALLOW_METHODS, allowHeaders: ALLOW_HEADERS
    });
  }

  // 외부 응답 헤더는 신뢰하지 않고, 우리가 직접 만든 안전 헤더만 사용.
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
