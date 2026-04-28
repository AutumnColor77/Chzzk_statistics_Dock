import {
  checkRateLimit,
  getSession,
  logSecurityEvent,
  requireAllowedMethods,
  withNoStore
} from '../../_lib/security.js';

export async function onRequest(context) {
  const { request, env } = context;
  const allowedOrigin = env.ALLOWED_ORIGIN || new URL(request.url).origin;
  const methodErr = requireAllowedMethods(request, ['GET']);
  if (methodErr) return methodErr;

  const limit = await checkRateLimit(env, request, 'users_me', 120, 60);
  if (!limit.allowed) return new Response('Too Many Requests', { status: 429 });

  const session = await getSession(env, request);
  const accessToken = session?.data?.accessToken;
  if (!accessToken) {
    logSecurityEvent('session_missing_users_me', { url: request.url });
    return new Response('Unauthorized', { status: 401 });
  }

  const apiUrl = 'https://openapi.chzzk.naver.com/open/v1/users/me';
  
  const response = await fetch(apiUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });
  
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('Access-Control-Allow-Origin', allowedOrigin);
  newResponse.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
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
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token'
    }
  });
}
