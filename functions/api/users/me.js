export async function onRequest(context) {
  const { request, env } = context;
  const allowedOrigin = env.ALLOWED_ORIGIN || new URL(request.url).origin;
  
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return new Response('Missing Authorization header', { status: 401 });
  }

  const apiUrl = 'https://openapi.chzzk.naver.com/open/v1/users/me';
  
  const response = await fetch(apiUrl, {
    method: 'GET',
    headers: {
      'Authorization': authHeader,
      'Accept': 'application/json'
    }
  });
  
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('Access-Control-Allow-Origin', allowedOrigin);
  newResponse.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  newResponse.headers.set('Access-Control-Allow-Headers', 'Authorization');
  return newResponse;
}

export async function onRequestOptions(context) {
  const { request, env } = context;
  const allowedOrigin = env.ALLOWED_ORIGIN || new URL(request.url).origin;
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization'
    }
  });
}
