export const MAX_HISTORY_LENGTH = 120;

export const state = {
    channelId: null,
    liveStatus: 'CLOSE',
    concurrentViewers: 0,
    peakViewers: 0,
    followers: 0,
    averageViewers: 0,
    viewerHistory: [],
    dataSource: 'server', // 'server' | 'local-cache' | 'error'
};

export const globals = {
    fetchTimeout: null,
    settingsPollingTimeout: null,
    // 보안 강화를 위해 액세스 토큰은 영구 저장하지 않고 메모리에서만 유지
    accessToken: null
};

export function setAccessToken(token) {
    globals.accessToken = token;
    if (!token) {
        localStorage.removeItem('chzzkChannelId');
        localStorage.removeItem('chzzk_live_status_cache');
        localStorage.removeItem('chzzk_peak_viewers');
    }
}
