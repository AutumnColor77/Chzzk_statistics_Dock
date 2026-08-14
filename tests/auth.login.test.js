import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { onRequest as login } from '../functions/api/auth/login.js';
import { createCsrfState, isAllowedMutationOrigin, validateCsrfState, validateEnvSchema } from '../functions/_lib/security.js';
import { apiRequest, createContext, createTestEnv } from './helpers.js';

describe('GET /api/auth/login', () => {
  let mf;
  let env;

  beforeAll(async () => {
    ({ mf, env } = await createTestEnv());
  });

  afterAll(async () => {
    if (mf) await mf.dispose();
  });

  it('rejects non-GET methods', async () => {
    const response = await login(createContext(apiRequest('/api/auth/login', { method: 'POST' }), env));
    expect(response.status).toBe(405);
  });

  it('returns a safe 503 when OAuth secrets are missing', async () => {
    const { mf: bareMf, env: bareEnv } = await createTestEnv({
      CHZZK_CLIENT_ID: '',
      CHZZK_CLIENT_SECRET: ''
    });
    const response = await login(createContext(apiRequest('/api/auth/login'), bareEnv));
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).not.toMatch(/CHZZK_CLIENT/i);
    expect(body).toContain('Server configuration error');
    await bareMf.dispose();
  });

  it('redirects to Chzzk OAuth with HttpOnly state cookie', async () => {
    const response = await login(createContext(
      apiRequest('/api/auth/login?next=/admin'),
      env
    ));
    expect(response.status).toBe(302);
    const location = response.headers.get('Location') || '';
    expect(location).toContain('https://chzzk.naver.com/account-interlock');
    expect(location).toContain('clientId=ci-placeholder-client-id');
    expect(location).toContain('state=');

    const cookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('Set-Cookie')];
    const stateCookie = cookies.find((row) => row && row.startsWith('oauth_state='));
    expect(stateCookie).toBeTruthy();
    expect(stateCookie).toMatch(/HttpOnly/i);
    expect(stateCookie).toMatch(/Secure/i);
    expect(stateCookie).toMatch(/SameSite=Lax/i);
    expect(stateCookie).not.toMatch(/accessToken/i);
  });
});

describe('OAuth CSRF state TTL', () => {
  it('accepts a freshly issued state', async () => {
    const state = createCsrfState();
    expect(await validateCsrfState(state, state)).toBe(true);
  });

  it('rejects an expired state even when the strings match', async () => {
    const nonce = 'a'.repeat(64);
    const expired = `${Date.now() - (6 * 60 * 1000)}.${nonce}`;
    expect(await validateCsrfState(expired, expired)).toBe(false);
  });
});

describe('env schema', () => {
  it('does not leak missing key names in the validation object used by handlers', () => {
    const result = validateEnvSchema({}, ['CLIENT_ID', 'CLIENT_SECRET']);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['CLIENT_ID', 'CLIENT_SECRET']);
  });
});

describe('mutation origin', () => {
  it('allows same-origin PATCH even if ALLOWED_ORIGIN is a different host', () => {
    const request = apiRequest('/api/lives/setting', { method: 'PATCH' });
    expect(isAllowedMutationOrigin(request, {
      ALLOWED_ORIGIN: 'https://other.example'
    })).toBe(true);
  });

  it('allows OBS-style requests with Sec-Fetch-Site same-origin and no Origin', () => {
    const request = new Request('https://cheese-stick-dock.pages.dev/api/lives/setting', {
      method: 'PATCH',
      headers: { 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': '203.0.113.9' }
    });
    expect(isAllowedMutationOrigin(request, { ALLOWED_ORIGIN: 'https://other.example' })).toBe(true);
  });

  it('rejects cross-site Origin', () => {
    const request = apiRequest('/api/lives/setting', {
      method: 'PATCH',
      origin: 'https://evil.example'
    });
    expect(isAllowedMutationOrigin(request, { ALLOWED_ORIGIN: 'https://cheese-stick-dock.pages.dev' })).toBe(false);
  });
});
