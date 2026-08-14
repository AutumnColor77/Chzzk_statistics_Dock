import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { onRequest as liveStatus } from '../functions/api/live-status.js';
import { apiRequest, createContext, createTestEnv, jsonOf, mockOriginLiveStatus } from './helpers.js';

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
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=5, s-maxage=5, stale-while-revalidate=5'
    );
    expect(response.headers.get('X-Cache')).toBeTruthy();
  });

  it('does not cache 5xx live-status failures', async () => {
    const original = globalThis.fetch;
    restoreFetch = () => {
      globalThis.fetch = original;
    };
    globalThis.fetch = async () => new Response('origin down', { status: 500 });

    const ctx = createContext(
      apiRequest('/api/live-status?channelId=bbbbbbbbbbbbbbbb'),
      env
    );
    const response = await liveStatus(ctx);
    await ctx.flush();
    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toMatch(/no-store/);
  });

  it('rejects unauthenticated force refresh', async () => {
    const response = await liveStatus(createContext(
      apiRequest('/api/live-status?channelId=abcdef0123456789&force=true'),
      env
    ));
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toMatch(/no-store/);
  });
});
