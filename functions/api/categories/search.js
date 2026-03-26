export async function onRequest(context) {
  const { request, env } = context;
  const allowedOrigin = env.ALLOWED_ORIGIN || new URL(request.url).origin;
  
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get('query');

  if (!query) {
    return new Response(JSON.stringify({ code: 400, message: 'Query is required' }), { status: 400 });
  }

  const clientId = env.CHZZK_CLIENT_ID;
  const clientSecret = env.CHZZK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new Response(JSON.stringify({ code: 500, message: 'Server configuration missing (Client ID/Secret)' }), { status: 500 });
  }

  const apiUrl = `https://openapi.chzzk.naver.com/open/v1/categories/search?query=${encodeURIComponent(query)}&size=20`;
  
  const response = await fetch(apiUrl, {
    method: 'GET',
    headers: {
      'Client-Id': clientId,
      'Client-Secret': clientSecret,
      'Accept': 'application/json'
    }
  });
  
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('Access-Control-Allow-Origin', allowedOrigin);
  newResponse.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  newResponse.headers.set('Access-Control-Allow-Headers', 'Client-Id, Client-Secret, Accept');
  return newResponse;
}

export async function onRequestOptions(context) {
  const { request, env } = context;
  const allowedOrigin = env.ALLOWED_ORIGIN || new URL(request.url).origin;
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Client-Id, Client-Secret, Accept'
    }
  });
}
