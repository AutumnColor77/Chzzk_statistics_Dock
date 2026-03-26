export async function onRequest(context) {
  const { env, request } = context;
  const clientId = env.CHZZK_CLIENT_ID;
  const clientSecret = env.CHZZK_CLIENT_SECRET;
  
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code) {
    return new Response('Missing code parameter', { status: 400 });
  }

  // CSRF 방지: 쿠키에 저장된 state와 콜백 state 비교 검증
  const cookieHeader = request.headers.get('Cookie') || '';
  const stateMatch = cookieHeader.match(/(?:^|;\s*)oauth_state=([^;]+)/);
  const savedState = stateMatch ? stateMatch[1] : null;

  if (!state || !savedState || state !== savedState) {
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
    // JSON 데이터를 HTML 속성에 안전하게 삽입하기 위해 HTML 엔티티로 이스케이프
    const safeJson = JSON.stringify(tokenData.content)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>Authentication Successful</title></head>
      <body>
        <p>Authentication successful. Closing window...</p>
        <div id="token-data" data-token="${safeJson}" style="display:none;"></div>
        <script>
          var el = document.getElementById('token-data');
          var tokenData = JSON.parse(el.getAttribute('data-token'));
          if (window.opener) {
            window.opener.postMessage({ type: 'CHZZK_AUTH_SUCCESS', payload: tokenData }, window.location.origin);
            window.close();
          } else {
            document.body.innerHTML += '<p>Please close this window and return to the application.</p>';
          }
        </script>
      </body>
      </html>
    `;
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Set-Cookie': 'oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=0'
      }
    });
  } else {
    return new Response('Authentication failed. Please try again.', { status: 500 });
  }
}
