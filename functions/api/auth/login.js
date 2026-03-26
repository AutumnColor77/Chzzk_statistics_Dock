export async function onRequest(context) {
  const { env, request } = context;
  const clientId = env.CHZZK_CLIENT_ID;
  
  if (!clientId) {
    return new Response('CHZZK_CLIENT_ID is not configured in environment variables.', { status: 500 });
  }

  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/callback`;
  const state = crypto.randomUUID();

  const authUrl = new URL('https://chzzk.naver.com/account-interlock');
  authUrl.searchParams.set('clientId', clientId);
  authUrl.searchParams.set('redirectUri', redirectUri);
  authUrl.searchParams.set('state', state);

  // state를 HttpOnly 쿠키에 저장하여 callback에서 CSRF 검증
  const response = Response.redirect(authUrl.toString(), 302);
  const redirectResponse = new Response(null, {
    status: 302,
    headers: response.headers,
  });
  redirectResponse.headers.set('Location', authUrl.toString());
  redirectResponse.headers.set(
    'Set-Cookie',
    `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=300`
  );

  return redirectResponse;
}
