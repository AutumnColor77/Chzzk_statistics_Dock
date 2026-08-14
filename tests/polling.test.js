import { describe, expect, it } from 'vitest';
import {
  POLL_INTERVAL_HIDDEN_MS,
  POLL_INTERVAL_LIVE_MS,
  POLL_INTERVAL_OFFLINE_MS,
  getPollingIntervalMs,
  isBroadcastLive
} from '../js/state.js';

describe('adaptive live-status polling', () => {
  it('uses 15s while the broadcast is live and the tab is visible', () => {
    expect(isBroadcastLive('OPEN')).toBe(true);
    expect(isBroadcastLive('LIVE')).toBe(true);
    expect(isBroadcastLive('ON_AIR')).toBe(true);
    expect(getPollingIntervalMs('OPEN', 'visible')).toBe(POLL_INTERVAL_LIVE_MS);
    expect(POLL_INTERVAL_LIVE_MS).toBe(15_000);
  });

  it('uses 60s while the broadcast is offline and the tab is visible', () => {
    expect(isBroadcastLive('CLOSE')).toBe(false);
    expect(getPollingIntervalMs('CLOSE', 'visible')).toBe(POLL_INTERVAL_OFFLINE_MS);
    expect(getPollingIntervalMs('OFFLINE', 'visible')).toBe(POLL_INTERVAL_OFFLINE_MS);
    expect(POLL_INTERVAL_OFFLINE_MS).toBe(60_000);
  });

  it('uses 120s whenever the tab is hidden', () => {
    expect(getPollingIntervalMs('OPEN', 'hidden')).toBe(POLL_INTERVAL_HIDDEN_MS);
    expect(getPollingIntervalMs('CLOSE', 'hidden')).toBe(POLL_INTERVAL_HIDDEN_MS);
    expect(POLL_INTERVAL_HIDDEN_MS).toBe(120_000);
  });
});
