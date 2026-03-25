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
    // Generate an HTML page that posts the token to the parent window and closes itself.
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>Authentication Successful</title></head>
      <body>
        <p>Authentication successful. Closing window...</p>
        <script>
          const tokenData = ${JSON.stringify(tokenData.content)};
          if (window.opener) {
            window.opener.postMessage({ type: 'CHZZK_AUTH_SUCCESS', payload: tokenData }, '*');
            window.close();
          } else {
            document.body.innerHTML += '<p>Please close this window and return to the application.</p>';
          }
        </script>
      </body>
      </html>
    `;
    return new Response(html, {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  } else {
    return new Response('Failed to retrieve token: ' + JSON.stringify(tokenData), { status: 500 });
  }
}
