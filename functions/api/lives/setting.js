export async function onRequest(context) {
  const { request, env } = context;
  const allowedOrigin = env.ALLOWED_ORIGIN || new URL(request.url).origin;
  
  if (request.method !== 'GET' && request.method !== 'PATCH') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return new Response('Missing Authorization header', { status: 401 });
  }

  const apiUrl = 'https://openapi.chzzk.naver.com/open/v1/lives/setting';
  
  const fetchOptions = {
    method: request.method,
    headers: {
      'Authorization': authHeader,
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
  newResponse.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  newResponse.headers.set('Cache-Control', 'no-store');
  return newResponse;
}

export async function onRequestOptions(context) {
  const { request, env } = context;
  const allowedOrigin = env.ALLOWED_ORIGIN || new URL(request.url).origin;
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type'
    }
  });
}
