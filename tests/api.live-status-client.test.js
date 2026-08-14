import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLiveStatus, getLiveStatusRetryDelayMs, resetLiveStatusClient } from '../js/api.js';

const CHANNEL_ID = 'abcdef0123456789';

function installLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => 'MISS' },
    json: async () => body
  };
}

describe('fetchLiveStatus client cache', () => {
  beforeEach(() => {
    installLocalStorage();
    resetLiveStatusClient();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetLiveStatusClient();
  });

  it('reuses an in-flight request for the same channel', async () => {
    let releases;
    const gate = new Promise((resolve) => {
      releases = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await gate;
      return jsonResponse({ code: 200, content: { status: 'OPEN' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = fetchLiveStatus(CHANNEL_ID);
    const second = fetchLiveStatus(CHANNEL_ID);
    expect(first).toBe(second);

    releases();
    const result = await first;
    await second;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.source).toBe('server');
    expect(fetchMock.mock.calls[0][1].credentials).toBe('omit');
  });

  it('blocks repeat fetches with exponential backoff after a network error', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchLiveStatus(CHANNEL_ID)).rejects.toThrow(/network down/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getLiveStatusRetryDelayMs()).toBeGreaterThan(0);

    await expect(fetchLiveStatus(CHANNEL_ID)).rejects.toThrow(/backoff/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
