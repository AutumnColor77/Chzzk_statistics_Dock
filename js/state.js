export const MAX_HISTORY_LENGTH = 120;

export const state = {
    channelId: null,
    channelName: '',
    liveStatus: 'CLOSE',
    concurrentViewers: 0,
    peakViewers: 0,
    followers: 0,
    averageViewers: 0,
    viewerHistory: [],
    dataSource: 'server', // 'server' | 'local-cache' | 'error'
    authenticated: false,
    online: typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
    uiError: null
};

export const globals = {
    fetchTimeout: null,
    settingsPollingTimeout: null,
    reconnectTimeout: null
};

const listeners = new Set();

export function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function emit(changedKeys) {
    if (!changedKeys.length) return;
    for (const listener of listeners) {
        try {
            listener(changedKeys, state);
        } catch (_e) {
            // UI 구독자 오류가 상태 갱신을 막지 않음
        }
    }
}

/**
 * 값이 바뀐 필드만 반영하고, 변경된 키 목록으로 UI를 선택 갱신합니다.
 */
export function patchState(partial) {
    const changed = [];
    const keys = Object.keys(partial);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const next = partial[key];
        if (Object.is(state[key], next)) continue;
        state[key] = next;
        changed.push(key);
    }
    emit(changed);
    return changed;
}

export function notifyState(changedKeys) {
    const keys = Array.isArray(changedKeys) ? changedKeys.slice() : [];
    emit(keys);
}

export function clearLocalSessionState() {
    localStorage.removeItem('chzzkChannelId');
    localStorage.removeItem('chzzk_live_status_cache');
    localStorage.removeItem('chzzk_peak_viewers');
}
