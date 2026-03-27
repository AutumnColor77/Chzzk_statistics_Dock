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
    accessToken: localStorage.getItem('chzzkAccessToken')
};

export function setAccessToken(token) {
    globals.accessToken = token;
    if (token) {
        localStorage.setItem('chzzkAccessToken', token);
    } else {
        localStorage.removeItem('chzzkAccessToken');
        localStorage.removeItem('chzzkChannelId');
    }
}
