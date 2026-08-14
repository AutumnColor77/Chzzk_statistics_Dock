if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.timingSafeEqual !== 'function') {
  crypto.subtle.timingSafeEqual = (a, b) => {
    const left = new Uint8Array(a);
    const right = new Uint8Array(b);
    if (left.byteLength !== right.byteLength) {
      throw new RangeError('timingSafeEqual length mismatch');
    }
    let mismatch = 0;
    for (let i = 0; i < left.byteLength; i++) {
      mismatch |= left[i] ^ right[i];
    }
    return mismatch === 0;
  };
}

const edgeCache = new Map();

if (typeof globalThis.caches === 'undefined') {
  globalThis.caches = {
    default: {
      async match(request) {
        const key = typeof request === 'string' ? request : request.url;
        const body = edgeCache.get(key);
        if (!body) return undefined;
        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=UTF-8' }
        });
      },
      async put(request, response) {
        const key = typeof request === 'string' ? request : request.url;
        edgeCache.set(key, await response.clone().text());
      },
      async delete(request) {
        const key = typeof request === 'string' ? request : request.url;
        return edgeCache.delete(key);
      }
    }
  };
}

globalThis.__resetEdgeCache = () => edgeCache.clear();
