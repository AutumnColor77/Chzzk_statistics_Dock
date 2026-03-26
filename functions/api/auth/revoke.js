export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return new Response('Missing Authorization header', { status: 401 });
  }

  const clientId = env.CHZZK_CLIENT_ID;
  const clientSecret = env.CHZZK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new Response('Server configuration missing', { status: 500 });
  }

  // Bearer 토큰 추출
  const token = authHeader.replace(/^Bearer\s+/i, '');

  try {
    const revokeResponse = await fetch('https://openapi.chzzk.naver.com/auth/v1/token/revoke', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientId: clientId,
        clientSecret: clientSecret,
        token: token,
      }),
    });

    const allowedOrigin = env.ALLOWED_ORIGIN || new URL(request.url).origin;

    if (revokeResponse.ok) {
      return new Response(JSON.stringify({ success: true }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': allowedOrigin,
        },
      });
    } else {
      return new Response(JSON.stringify({ success: false, message: 'Token revocation failed' }), {
        status: revokeResponse.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': allowedOrigin,
        },
      });
    }
  } catch (_error) {
    return new Response(JSON.stringify({ success: false, message: 'Server error' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || new URL(request.url).origin,
      },
    });
  }
}

export async function onRequestOptions(context) {
  const { request, env } = context;
  const allowedOrigin = env.ALLOWED_ORIGIN || new URL(request.url).origin;
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}
