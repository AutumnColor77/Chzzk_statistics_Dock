export async function onRequest(context) {
  const { request } = context;
  
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
    const textBody = await request.text();
    fetchOptions.body = textBody;
  }

  const response = await fetch(apiUrl, fetchOptions);
  
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('Access-Control-Allow-Origin', '*');
  newResponse.headers.set('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  newResponse.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  return newResponse;
}

export async function onRequestOptions(context) {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type'
    }
  });
}
