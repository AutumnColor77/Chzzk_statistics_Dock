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

  return Response.redirect(authUrl.toString(), 302);
}
