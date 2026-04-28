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
    settingsPollingTimeout: null
};

export function clearLocalSessionState() {
    localStorage.removeItem('chzzkChannelId');
    localStorage.removeItem('chzzk_live_status_cache');
    localStorage.removeItem('chzzk_peak_viewers');
}
