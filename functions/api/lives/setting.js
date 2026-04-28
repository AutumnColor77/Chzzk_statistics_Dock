import {
  checkRateLimit,
  getSession,
  logSecurityEvent,
  requireAllowedMethods,
  validateCsrf,
  withNoStore
} from '../../_lib/security.js';

export async function onRequest(context) {
  const { request, env } = context;
  const allowedOrigin = env.ALLOWED_ORIGIN || new URL(request.url).origin;
  const methodErr = requireAllowedMethods(request, ['GET', 'PATCH']);
  if (methodErr) return methodErr;

  const action = request.method === 'PATCH' ? 'lives_setting_patch' : 'lives_setting_get';
  const limit = await checkRateLimit(env, request, action, request.method === 'PATCH' ? 30 : 120, 60);
  if (!limit.allowed) return new Response('Too Many Requests', { status: 429 });

  const session = await getSession(env, request);
  const accessToken = session?.data?.accessToken;
  if (!accessToken) {
    logSecurityEvent('session_missing_lives_setting', { method: request.method, url: request.url });
    return new Response('Unauthorized', { status: 401 });
  }

  if (request.method === 'PATCH' && !validateCsrf(request, session.data)) {
    logSecurityEvent('csrf_validation_failed', { url: request.url });
    return new Response('Invalid CSRF token', { status: 403 });
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
    // 화이트리스트: 허용된 필드만 추출하여 전달 (오픈 프록시 방지)
    try {
      const rawBody = await request.json();
      const sanitizedBody = {};
      const allowedFields = ['defaultLiveTitle', 'categoryType', 'categoryId', 'tags'];
      for (const field of allowedFields) {
        if (rawBody[field] !== undefined) {
          sanitizedBody[field] = rawBody[field];
        }
      }
      fetchOptions.body = JSON.stringify(sanitizedBody);
    } catch (_e) {
      return new Response('Invalid JSON body', { status: 400 });
    }
  }

  const response = await fetch(apiUrl, fetchOptions);
  
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('Access-Control-Allow-Origin', allowedOrigin);
  newResponse.headers.set('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
  withNoStore(newResponse.headers);
  return newResponse;
}

export async function onRequestOptions(context) {
  const { request, env } = context;
  const allowedOrigin = env.ALLOWED_ORIGIN || new URL(request.url).origin;
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token'
    }
  });
}
