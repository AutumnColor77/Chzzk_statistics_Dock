export async function onRequest(context) {
  // Get channelId from the query parameters
  const { searchParams } = new URL(context.request.url);
  const channelId = searchParams.get('channelId');

  if (!channelId) {
    return new Response('channelId query parameter is required', { status: 400 });
  }

  const apiUrl = `https://api.chzzk.naver.com/polling/v2/channels/${channelId}/live-status`;

  // Fetch from the actual Chzzk API
  const response = await fetch(apiUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'chzzk-viewer-dock/1.0',
      },
  });

  // Recreate the response to add our own CORS headers.
  // This is a simplified approach; a more robust solution would handle all headers.
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('Access-Control-Allow-Origin', '*');
  newResponse.headers.set('Cache-Control', 's-maxage=30'); // Cache on the server for 30s

  return newResponse;
}
