import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { onRequest as adminMetrics } from '../functions/api/admin/metrics.js';
import { createSession } from '../functions/_lib/security.js';
import { recordDailyActiveUser, readDailyMetrics } from '../functions/_lib/metrics.js';
import { TEST_CHANNEL_ID, apiRequest, createContext, createTestEnv, jsonOf } from './helpers.js';

describe('GET /api/admin/metrics', () => {
  let mf;
  let env;

  beforeAll(async () => {
    ({ mf, env } = await createTestEnv());
  });

  afterAll(async () => {
    if (mf) await mf.dispose();
  });

  it('returns 401 without a session', async () => {
    const response = await adminMetrics(createContext(apiRequest('/api/admin/metrics'), env));
    expect(response.status).toBe(401);
    const body = await jsonOf(response);
    expect(body.message).toBe('Unauthorized');
  });

  it('returns 403 for a logged-in non-admin channel', async () => {
    const session = await createSession(env, {
      accessToken: 'ci-placeholder-access',
      channelId: 'aaaaaaaaaaaaaaaa'
    });
    const response = await adminMetrics(createContext(
      apiRequest('/api/admin/metrics', {
        headers: { Cookie: `chzzk_session=${session.sessionId}` }
      }),
      env
    ));
    expect(response.status).toBe(403);
    const body = await jsonOf(response);
    expect(body.message).toBe('Forbidden');
    expect(JSON.stringify(body)).not.toMatch(/ADMIN_SECRET|misconfigured/i);
  });

  it('returns aggregated metrics for an authorized admin session', async () => {
    const session = await createSession(env, {
      accessToken: 'ci-placeholder-access',
      channelId: TEST_CHANNEL_ID
    });
    await recordDailyActiveUser(env, TEST_CHANNEL_ID);

    const response = await adminMetrics(createContext(
      apiRequest('/api/admin/metrics', {
        headers: {
          Cookie: `chzzk_session=${session.sessionId}`,
          'X-Admin-Secret': 'ci-placeholder-admin-secret'
        }
      }),
      env
    ));
    expect(response.status).toBe(200);
    const body = await jsonOf(response);
    expect(body.timezone).toBe('Asia/Seoul');
    expect(body.today).toBeTruthy();
    expect(Array.isArray(body.days)).toBe(true);
    expect(body.days.length).toBe(30);
    expect(JSON.stringify(body)).not.toMatch(TEST_CHANNEL_ID);
  });

  it('allows a browser session with HMAC proof and no admin header', async () => {
    const session = await createSession(env, {
      accessToken: 'ci-placeholder-access',
      channelId: TEST_CHANNEL_ID
    });
    const response = await adminMetrics(createContext(
      apiRequest('/api/admin/metrics', {
        headers: { Cookie: `chzzk_session=${session.sessionId}` }
      }),
      env
    ));
    expect(response.status).toBe(200);
  });

  it('heals a pre-secret session missing adminProof', async () => {
    const session = await createSession(env, {
      accessToken: 'ci-placeholder-access',
      channelId: TEST_CHANNEL_ID
    });
    const key = `session:${session.sessionId}`;
    const stored = JSON.parse(await env.SESSION_STORE.get(key));
    delete stored.adminProof;
    await env.SESSION_STORE.put(key, JSON.stringify(stored));

    const response = await adminMetrics(createContext(
      apiRequest('/api/admin/metrics', {
        headers: { Cookie: `chzzk_session=${session.sessionId}` }
      }),
      env
    ));
    expect(response.status).toBe(200);
  });
});

describe('GET /api/admin/metrics channel matching', () => {
  it('accepts a Chzzk URL in ADMIN_CHANNEL_ID', async () => {
    const { mf, env } = await createTestEnv({
      ADMIN_CHANNEL_ID: `https://chzzk.naver.com/${TEST_CHANNEL_ID}`
    });
    const session = await createSession(env, {
      accessToken: 'ci-placeholder-access',
      channelId: TEST_CHANNEL_ID
    });
    const response = await adminMetrics(createContext(
      apiRequest('/api/admin/metrics', {
        headers: { Cookie: `chzzk_session=${session.sessionId}` }
      }),
      env
    ));
    expect(response.status).toBe(200);
    await mf.dispose();
  });

  it('still allows the matching channel when ADMIN_SECRET is unset', async () => {
    const { mf, env } = await createTestEnv({ ADMIN_SECRET: '' });
    const session = await createSession(env, {
      accessToken: 'ci-placeholder-access',
      channelId: TEST_CHANNEL_ID
    });
    const response = await adminMetrics(createContext(
      apiRequest('/api/admin/metrics', {
        headers: { Cookie: `chzzk_session=${session.sessionId}` }
      }),
      env
    ));
    expect(response.status).toBe(200);
    await mf.dispose();
  });
});

describe('metrics shard writes', () => {
  it('records visits without exposing the raw channel id', async () => {
    const { mf, env } = await createTestEnv();
    await recordDailyActiveUser(env, TEST_CHANNEL_ID);
    const snapshot = await readDailyMetrics(env, 1);
    expect(snapshot.today.visits).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(snapshot)).not.toMatch(TEST_CHANNEL_ID);
    await mf.dispose();
  });
});
