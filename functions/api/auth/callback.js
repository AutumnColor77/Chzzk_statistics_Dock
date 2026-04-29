import {
  appendSetCookie,
  attachSessionCookies,
  checkRateLimit,
  clearSessionCookies,
  createSession,
  getCookie,
  logSecurityEvent,
  requireAllowedMethods,
  withNoStore
} from '../../_lib/security.js';

export async function onRequest(context) {
  const { env, request } = context;
  const methodErr = requireAllowedMethods(request, ['GET']);
  if (methodErr) return methodErr;

  const limit = await checkRateLimit(env, request, 'auth_callback', 30, 60);
  if (!limit.allowed) {
    logSecurityEvent('rate_limit_auth_callback', { url: request.url });
    return new Response('Too Many Requests', { status: 429 });
  }

  const clientId = env.CHZZK_CLIENT_ID;
  const clientSecret = env.CHZZK_CLIENT_SECRET;
  
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code) {
    return new Response('Missing code parameter', { status: 400 });
  }

  // CSRF 방지: 쿠키에 저장된 state와 콜백 state 비교 검증
  const savedState = getCookie('oauth_state', request);

  if (!state || !savedState || state !== savedState) {
    logSecurityEvent('oauth_state_mismatch', { url: request.url });
    return new Response('Invalid state parameter. Please try logging in again.', { status: 400 });
  }

  const tokenResponse = await fetch('https://openapi.chzzk.naver.com/auth/v1/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      grantType: 'authorization_code',
      clientId: clientId,
      clientSecret: clientSecret,
      code: code,
      state: state || 'none'
    })
  });

  const tokenData = await tokenResponse.json();

  if (tokenResponse.ok && tokenData.content && tokenData.content.accessToken) {
    const session = await createSession(env, {
      accessToken: tokenData.content.accessToken
    });
    if (!session) {
      logSecurityEvent('session_store_missing', { url: request.url });
      return new Response('Session store is not configured.', { status: 500 });
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>Authentication Successful</title></head>
      <body>
        <p>Authentication successful. Closing window...</p>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'CHZZK_AUTH_SUCCESS' }, window.location.origin);
            window.close();
          } else {
            document.body.innerHTML += '<p>Please close this window and return to the application.</p>';
            document.body.innerHTML += '<p><a href="/">Go back to Cheese Stick Dock</a></p>';
            setTimeout(function () {
              window.location.replace('/');
            }, 1200);
          }
        </script>
      </body>
      </html>
    `;
    const headers = new Headers({ 'Content-Type': 'text/html;charset=UTF-8' });
    appendSetCookie(headers, 'oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=0');
    clearSessionCookies(headers);
    attachSessionCookies(headers, session);
    withNoStore(headers);

    logSecurityEvent('oauth_login_success', { url: request.url });
    return new Response(html, { headers });
  } else {
    logSecurityEvent('oauth_login_failed', { status: tokenResponse.status, url: request.url });
    return new Response('Authentication failed. Please try again.', { status: 500 });
  }
}
