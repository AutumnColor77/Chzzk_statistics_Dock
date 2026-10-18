import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { onRequest as liveStatus } from '../functions/api/live-status.js';
import { checkRateLimit, createSession } from '../functions/_lib/security.js';
import { apiRequest, createContext, createTestEnv, jsonOf, mockOriginLiveStatus } from './helpers.js';

const EDGE_CACHE_CONTROL = 'public, max-age=15, s-maxage=15, stale-while-revalidate=15';

describe('GET /api/live-status', () => {
  let mf;
  let env;
  let restoreFetch;

  beforeAll(async () => {
    ({ mf, env } = await createTestEnv());
  });

  afterEach(() => {
    if (restoreFetch) restoreFetch();
    restoreFetch = null;
    if (typeof globalThis.__resetEdgeCache === 'function') globalThis.__resetEdgeCache();
  });

  afterAll(async () => {
    if (mf) await mf.dispose();
  });

  it('requires channelId', async () => {
    const response = await liveStatus(createContext(apiRequest('/api/live-status'), env));
    expect(response.status).toBe(400);
  });

  it('rejects non-hex channelId to block SSRF', async () => {
    const response = await liveStatus(createContext(
      apiRequest('/api/live-status?channelId=https://evil.example'),
      env
    ));
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/Invalid channelId/i);
  });

  it('returns origin payload for a valid channel and does not leak tokens', async () => {
    restoreFetch = mockOriginLiveStatus();
    const ctx = createContext(
      apiRequest('/api/live-status?channelId=abcdef0123456789'),
      env
    );
    const response = await liveStatus(ctx);
    await ctx.flush();
    expect(response.status).toBe(200);
    const body = await jsonOf(response);
    expect(body.code).toBe(200);
    expect(body.content.concurrentUserCount).toBe(7);
    expect(JSON.stringify(body)).not.toMatch(/accessToken|refreshToken|ADMIN_SECRET/i);
    expect(response.headers.get('Cache-Control')).toBe(EDGE_CACHE_CONTROL);
    expect(response.headers.get('CDN-Cache-Control')).toBe(
      'public, max-age=15, stale-while-revalidate=15'
    );
    expect(response.headers.get('X-Cache')).toBeTruthy();
  });

  it('does not cache 5xx live-status failures', async () => {
    let originCalls = 0;
    const original = globalThis.fetch;
    restoreFetch = () => {
      globalThis.fetch = original;
    };
    globalThis.fetch = async () => {
      originCalls += 1;
      return new Response('origin down', { status: 500 });
    };

    const path = '/api/live-status?channelId=bbbbbbbbbbbbbbbb';
    const first = createContext(apiRequest(path, { ip: '203.0.113.40' }), env);
    const response = await liveStatus(first);
    await first.flush();
    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toMatch(/no-store/);

    const second = createContext(apiRequest(path, { ip: '203.0.113.40' }), env);
    const again = await liveStatus(second);
    await second.flush();
    expect(again.status).toBe(502);
    expect(again.headers.get('Cache-Control')).toMatch(/no-store/);
    expect(originCalls).toBe(2);
  });

  it('rejects unauthenticated force refresh', async () => {
    const response = await liveStatus(createContext(
      apiRequest('/api/live-status?channelId=abcdef0123456789&force=true'),
      env
    ));
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toMatch(/no-store/);
  });

  it('does not write a rate-limit KV key on normal live-status polls', async () => {
    restoreFetch = mockOriginLiveStatus();
    const ip = '203.0.113.41';
    const puts = [];
    const originalPut = env.SESSION_STORE.put.bind(env.SESSION_STORE);
    env.SESSION_STORE.put = async (key, value, options) => {
      puts.push(String(key));
      return originalPut(key, value, options);
    };

    try {
      for (let i = 0; i < 4; i++) {
        if (typeof globalThis.__resetEdgeCache === 'function') globalThis.__resetEdgeCache();
        const ctx = createContext(
          apiRequest('/api/live-status?channelId=abcdef0123456789', { ip }),
          env
        );
        const response = await liveStatus(ctx);
        await ctx.flush();
        expect(response.status).toBe(200);
      }
    } finally {
      env.SESSION_STORE.put = originalPut;
    }

    const rateLimitPuts = puts.filter((key) => key.startsWith('rl:live_status:'));
    const perSlot = new Map();
    for (const key of rateLimitPuts) perSlot.set(key, (perSlot.get(key) || 0) + 1);
    for (const count of perSlot.values()) expect(count).toBeLessThanOrEqual(1);
    expect(rateLimitPuts).toHaveLength(0);
  });

  it('skips a live-status KV put when the fresh value is unchanged', async () => {
    restoreFetch = mockOriginLiveStatus();
    const ip = '203.0.113.42';
    const session = await createSession(env, { accessToken: 'ci-placeholder-access' });
    const prime = createContext(
      apiRequest('/api/live-status?channelId=abcdef0123456789', { ip }),
      env
    );
    expect((await liveStatus(prime)).status).toBe(200);
    await prime.flush();

    const puts = [];
    const originalPut = env.LIVE_STATUS_CACHE.put.bind(env.LIVE_STATUS_CACHE);
    env.LIVE_STATUS_CACHE.put = async (key, value, options) => {
      puts.push(String(key));
      return originalPut(key, value, options);
    };

    try {
      const ctx = createContext(
        apiRequest('/api/live-status?channelId=abcdef0123456789&force=true', {
          ip,
          headers: { Cookie: `chzzk_session=${session.sessionId}` }
        }),
        env
      );
      const response = await liveStatus(ctx);
      await ctx.flush();
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toMatch(/no-store/);
      expect(response.headers.get('X-Cache')).toBe('FORCE');
    } finally {
      env.LIVE_STATUS_CACHE.put = originalPut;
    }

    expect(puts.filter((key) => key.startsWith('live-status:'))).toHaveLength(0);
  });
});

describe('checkRateLimit sparse KV', () => {
  function countingKv() {
    const ops = [];
    return {
      ops,
      async get(key) {
        ops.push(['get', String(key)]);
        return null;
      },
      async put(key, value) {
        ops.push(['put', String(key), String(value)]);
      }
    };
  }

  function request(ip) {
    return new Request('https://cheese-stick-dock.pages.dev/api/live-status', {
      headers: { 'CF-Connecting-IP': ip }
    });
  }

  it('rejects with 429 from memory and does not touch KV past the limit', async () => {
    const kv = countingKv();
    const env = { SESSION_STORE: kv };
    const ip = '198.51.100.80';
    for (let i = 0; i < 120; i++) {
      const result = await checkRateLimit(env, request(ip), 'sparse_memory', 120, 60, { sparseKv: true });
      expect(result.allowed).toBe(true);
    }
    const before = kv.ops.length;
    const denied = await checkRateLimit(env, request(ip), 'sparse_memory', 120, 60, { sparseKv: true });
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('memory');
    expect(kv.ops.length).toBe(before);
  });

  it('still writes KV on every allowed request when sparse mode is off', async () => {
    const kv = countingKv();
    const env = { SESSION_STORE: kv };
    const ip = '198.51.100.81';
    const first = await checkRateLimit(env, request(ip), 'strict_default', 10, 60);
    const second = await checkRateLimit(env, request(ip), 'strict_default', 10, 60);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    const puts = kv.ops.filter(([op]) => op === 'put');
    expect(puts).toHaveLength(2);
  });
});
