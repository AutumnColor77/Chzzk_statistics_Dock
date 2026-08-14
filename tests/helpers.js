import { Miniflare } from 'miniflare';

export const TEST_ORIGIN = 'https://cheese-stick-dock.pages.dev';
export const TEST_CHANNEL_ID = 'abcdef0123456789';

export const TEST_BINDINGS = {
  CHZZK_CLIENT_ID: 'ci-placeholder-client-id',
  CHZZK_CLIENT_SECRET: 'ci-placeholder-client-secret',
  ADMIN_SECRET: 'ci-placeholder-admin-secret',
  ADMIN_CHANNEL_ID: TEST_CHANNEL_ID,
  ALLOWED_ORIGIN: TEST_ORIGIN
};

let ipSeq = 10;

export function nextTestIp() {
  ipSeq = (ipSeq % 200) + 11;
  return `203.0.113.${ipSeq}`;
}

export function createContext(request, env, extra = {}) {
  const pending = [];
  return {
    request,
    env,
    waitUntil(promise) {
      pending.push(Promise.resolve(promise));
    },
    async flush() {
      await Promise.allSettled(pending);
    },
    ...extra
  };
}

export function apiRequest(path, {
  method = 'GET',
  headers = {},
  ip = nextTestIp(),
  origin = TEST_ORIGIN,
  fetchSite = 'same-origin'
} = {}) {
  const url = path.startsWith('http') ? path : `${TEST_ORIGIN}${path}`;
  return new Request(url, {
    method,
    headers: {
      'CF-Connecting-IP': ip,
      Origin: origin,
      'Sec-Fetch-Site': fetchSite,
      ...headers
    }
  });
}

export async function createTestEnv(overrides = {}) {
  const mf = new Miniflare({
    modules: true,
    compatibilityDate: '2025-09-01',
    compatibilityFlags: ['nodejs_compat'],
    script: 'export default { fetch() { return new Response("ok"); } }',
    kvNamespaces: ['LIVE_STATUS_CACHE', 'SESSION_STORE'],
    bindings: { ...TEST_BINDINGS, ...overrides }
  });
  const env = await mf.getBindings();
  return { mf, env };
}

export async function jsonOf(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (_e) {
    return text;
  }
}

export function mockOriginLiveStatus(payload = {
  code: 200,
  content: { status: 'OPEN', concurrentUserCount: 7, followerCount: 42 }
}) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const href = String(input);
    if (href.includes('api.chzzk.naver.com/polling/v2/channels/')) {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (typeof original === 'function') return original(input, init);
    return new Response('not mocked', { status: 599 });
  };
  return () => {
    globalThis.fetch = original;
  };
}
