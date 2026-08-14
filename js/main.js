import { state, globals, MAX_HISTORY_LENGTH, patchState, getPollingIntervalMs } from './state.js';
import { fetchLiveStatus, fetchUserChannel, fetchLiveSettings, updateLiveSettings, searchCategories, getLiveStatusRetryDelayMs } from './api.js';
import { login, logout, handleOAuthReturn } from './auth.js';
import { dom, updateUi, updateAuthUi, renderCategoryResults, setupHideValuesFeature } from './ui.js';
import { setText } from './dom-safe.js';

const POLL_JITTER_RATIO = 0.08;
const SETTINGS_POLL_INTERVAL_MS = 45000;
const FETCH_TIMEOUT_MS = 12000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

let lastKnownSettings = null;
let reconnectAttempt = 0;
let pollingPaused = false;

function randomInt(maxExclusive) {
    if (maxExclusive <= 0) return 0;
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % maxExclusive;
}

function currentVisibilityState() {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden'
        ? 'hidden'
        : 'visible';
}

function getAdaptiveIntervalMs() {
    const base = getPollingIntervalMs(state.liveStatus, currentVisibilityState());
    const span = Math.max(250, Math.round(base * POLL_JITTER_RATIO));
    return base + randomInt(span * 2 + 1) - span;
}

function nextBackoffMs() {
    const exp = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * (2 ** reconnectAttempt));
    reconnectAttempt = Math.min(reconnectAttempt + 1, 8);
    return exp + randomInt(300);
}

function resetBackoff() {
    reconnectAttempt = 0;
}

function withTimeout(promise, ms) {
    let timer = 0;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function fetchChzzkData(force = false) {
    if (!state.channelId) {
        updateUi(state);
        return;
    }

    const previousStatus = state.liveStatus;
    const next = {};

    try {
        const result = await withTimeout(fetchLiveStatus(state.channelId, force), FETCH_TIMEOUT_MS);
        const data = result.data;
        next.dataSource = result.source;
        next.uiError = null;

        if (data.code === 200) {
            const content = data.content || {};
            next.liveStatus = content.status || 'CLOSE';

            if (next.liveStatus === 'OPEN') {
                next.concurrentViewers = content.concurrentUserCount || 0;
                const storedPeak = parseInt(localStorage.getItem('chzzk_peak_viewers') || '0', 10);
                next.peakViewers = Math.max(state.peakViewers, storedPeak, next.concurrentViewers);
                localStorage.setItem('chzzk_peak_viewers', next.peakViewers.toString());
                next.followers = content.followerCount || 0;
                state.viewerHistory.push(next.concurrentViewers);
                if (state.viewerHistory.length > MAX_HISTORY_LENGTH) {
                    state.viewerHistory.shift();
                }
            } else {
                next.concurrentViewers = 0;
                next.peakViewers = 0;
                localStorage.removeItem('chzzk_peak_viewers');
                next.followers = content.followerCount || state.followers;
            }
        } else {
            next.liveStatus = 'CLOSE';
        }
    } catch (_error) {
        next.liveStatus = 'CLOSE';
        next.dataSource = 'error';
    }

    if (previousStatus === 'OPEN' && next.liveStatus === 'CLOSE') {
        state.viewerHistory = [];
        next.averageViewers = 0;
    } else {
        next.averageViewers = calculateAverageViewers();
    }

    patchState(next);
}

function calculateAverageViewers() {
    if (state.viewerHistory.length === 0) return 0;
    const sum = state.viewerHistory.reduce((acc, count) => acc + count, 0);
    return Math.round(sum / state.viewerHistory.length);
}

function scheduleNextFetch(delayMs) {
    stopFetching();
    if (pollingPaused || !state.channelId) return;

    const interval = typeof delayMs === 'number' ? delayMs : getAdaptiveIntervalMs();
    globals.fetchTimeout = setTimeout(async () => {
        globals.fetchTimeout = null;
        if (pollingPaused || !state.channelId || navigator.onLine === false) return;
        await fetchChzzkData();
        if (pollingPaused || !state.channelId) return;
        if (state.dataSource === 'error') {
            const retryMs = Math.max(getLiveStatusRetryDelayMs(), nextBackoffMs());
            scheduleNextFetch(retryMs);
            return;
        }
        resetBackoff();
        scheduleNextFetch();
    }, interval);
}

function startFetching() {
    stopFetching();
    if (!state.channelId || pollingPaused) return;
    fetchChzzkData();
    scheduleNextFetch();
}

function stopFetching() {
    if (globals.fetchTimeout) {
        clearTimeout(globals.fetchTimeout);
        globals.fetchTimeout = null;
    }
}

function pausePolling() {
    pollingPaused = true;
    stopFetching();
    stopSettingsPolling();
}

function resumePolling(immediate) {
    if (navigator.onLine === false) return;
    pollingPaused = false;
    if (!state.channelId) {
        handleLogin();
        return;
    }
    if (immediate) {
        resetBackoff();
        startFetching();
        startSettingsPolling();
        return;
    }
    scheduleNextFetch(nextBackoffMs());
}

function setupConnectionWatchers() {
    window.addEventListener('offline', () => {
        patchState({ online: false, dataSource: 'error' });
        pausePolling();
    });

    window.addEventListener('online', () => {
        patchState({ online: true });
        resumePolling(true);
    });

    document.addEventListener('visibilitychange', () => {
        if (navigator.onLine === false) return;
        pollingPaused = false;

        if (document.visibilityState === 'hidden') {
            if (state.channelId) scheduleNextFetch();
            return;
        }

        if (!state.channelId) {
            handleLogin();
            return;
        }

        resetBackoff();
        startFetching();
        if (!globals.settingsPollingTimeout) startSettingsPolling();
    });

    window.addEventListener('pageshow', () => {
        if (navigator.onLine === false) return;
        pollingPaused = false;
        if (state.channelId && !globals.fetchTimeout) startFetching();
    });

    document.addEventListener('freeze', pausePolling);
    document.addEventListener('resume', () => resumePolling(true));
}

async function handleLogin() {
    try {
        const response = await withTimeout(fetchUserChannel(), FETCH_TIMEOUT_MS);
        if (response.ok) {
            const data = await response.json();
            const verifiedChannelId = data?.content?.channelId;
            if (typeof verifiedChannelId === 'string' && /^[a-f0-9]{10,64}$/i.test(verifiedChannelId)) {
                patchState({
                    authenticated: true,
                    channelId: verifiedChannelId,
                    uiError: null
                });
                updateAuthUi(true, state);
                try { localStorage.setItem('chzzkChannelId', verifiedChannelId); } catch (_e) {}
                resetBackoff();
                startFetching();
                loadAndShowSettings().then(() => startSettingsPolling());
            } else {
                patchState({ uiError: '채널 정보 없음' });
            }
        } else if (response.status === 401) {
            updateAuthUi(false, state);
        } else if (response.status === 403) {
            patchState({ uiError: '권한 부족 (유저정보)' });
            setText(dom.statusMsg, '앱 설정에서 유저 정보 조회 권한을 추가해주세요.');
            dom.statusMsg.className = 'error-msg';
        } else {
            patchState({ uiError: '연동 에러' });
        }
    } catch (_error) {
        patchState({ uiError: '네트워크 에러', dataSource: 'error' });
        if (state.channelId) scheduleNextFetch(nextBackoffMs());
    }
}

async function loadAndShowSettings() {
    try {
        const response = await withTimeout(fetchLiveSettings(), FETCH_TIMEOUT_MS);
        if (response.status === 401) { handleLogout(); return; }
        if (response.ok) {
            const data = await response.json();
            if (data.content) {
                applySettingsToUi(data.content);
                lastKnownSettings = extractSettingsSnapshot(data.content);
            }
        }
    } catch (_error) {
        // silently ignore
    }
}

function applySettingsToUi(content) {
    dom.liveTitleInput.value = content.defaultLiveTitle || '';
    if (content.category) {
        dom.categoryTypeSelect.value = content.category.categoryType || 'GAME';
        dom.liveCategoryIdInput.value = content.category.categoryId || '';
        dom.categorySearchInput.value = content.category.categoryValue || '';
        if (content.category.categoryValue) {
            setText(dom.selectedCategoryName, content.category.categoryValue);
            dom.selectedCategoryDisplay.classList.remove('is-hidden');
        } else {
            setText(dom.selectedCategoryName, '');
            dom.selectedCategoryDisplay.classList.add('is-hidden');
        }
    } else {
        dom.categoryTypeSelect.value = content.categoryType || 'GAME';
        dom.liveCategoryIdInput.value = '';
        dom.categorySearchInput.value = '';
        setText(dom.selectedCategoryName, '');
        dom.selectedCategoryDisplay.classList.add('is-hidden');
    }
    dom.liveTagsInput.value = (content.tags || []).join(', ');
}

function extractSettingsSnapshot(content) {
    return {
        title: content.defaultLiveTitle || '',
        categoryType: content.category?.categoryType || content.categoryType || 'GAME',
        categoryId: content.category?.categoryId || '',
        categoryValue: content.category?.categoryValue || '',
        tags: (content.tags || []).join(', ')
    };
}

function isSettingsInputFocused() {
    const active = document.activeElement;
    return (
        active === dom.liveTitleInput ||
        active === dom.categorySearchInput ||
        active === dom.liveTagsInput ||
        active === dom.categoryTypeSelect
    );
}

async function pollSettingsIfChanged() {
    if (isSettingsInputFocused() || pollingPaused) return;

    try {
        const response = await withTimeout(fetchLiveSettings(), FETCH_TIMEOUT_MS);
        if (response.status === 401) { handleLogout(); return; }
        if (!response.ok) return;

        const data = await response.json();
        if (!data.content) return;

        const remote = extractSettingsSnapshot(data.content);
        const isFirstSync = !lastKnownSettings;
        if (isFirstSync || !settingsEqual(lastKnownSettings, remote)) {
            applySettingsToUi(data.content);
            lastKnownSettings = remote;
            if (!isFirstSync) {
                setText(dom.statusMsg, '외부에서 설정이 변경되어 반영했습니다.');
                dom.statusMsg.className = 'info-msg';
                setTimeout(() => { setText(dom.statusMsg, ''); }, 3000);
            }
        }
    } catch (_error) {
        // 폴링 실패는 무시 — 다음 사이클에서 재시도
    }
}

function settingsEqual(a, b) {
    return (
        a.title === b.title &&
        a.categoryType === b.categoryType &&
        a.categoryId === b.categoryId &&
        a.categoryValue === b.categoryValue &&
        a.tags === b.tags
    );
}

async function handleLogout() {
    await logout();
    pausePolling();
    pollingPaused = false;
    resetBackoff();
    lastKnownSettings = null;
    updateAuthUi(false, state);
}

function handleAuthSuccess() {
    handleLogin();
}

dom.loginBtn.addEventListener('click', login);
dom.logoutBtn.addEventListener('click', handleLogout);

dom.refreshStatsBtn.addEventListener('click', async () => {
    if (dom.refreshStatsBtn.disabled || !state.channelId) return;
    dom.refreshStatsBtn.disabled = true;
    dom.refreshStatsBtn.classList.add('refreshing');
    await fetchChzzkData(true);
    setTimeout(() => {
        dom.refreshStatsBtn.disabled = false;
        dom.refreshStatsBtn.classList.remove('refreshing');
    }, 5000);
});

dom.saveSettingsBtn.addEventListener('click', async () => {
    const title = dom.liveTitleInput.value.trim();
    const categoryType = dom.categoryTypeSelect.value;
    const categoryId = dom.liveCategoryIdInput.value.trim();
    const tagsInput = dom.liveTagsInput.value;
    const tags = tagsInput ? tagsInput.split(',').map((tag) => tag.trim()).filter((tag) => tag) : [];

    const body = { defaultLiveTitle: title, categoryType, tags };
    if (categoryId) body.categoryId = categoryId;

    dom.saveSettingsBtn.disabled = true;
    setText(dom.statusMsg, '업데이트 중...');
    dom.statusMsg.className = '';

    try {
        const response = await updateLiveSettings(body);
        if (response.ok) {
            lastKnownSettings = {
                title,
                categoryType,
                categoryId,
                categoryValue: dom.categorySearchInput.value.trim(),
                tags: tagsInput
            };
            setText(dom.statusMsg, '방송 설정이 업데이트 되었습니다.');
            dom.statusMsg.className = 'success-msg';
        } else {
            let errorDetails = '';
            try {
                const errPayload = await response.json();
                if (errPayload.message) errorDetails = ` (${errPayload.message})`;
            } catch (_e) {}
            setText(dom.statusMsg, `업데이트 실패${errorDetails} (권한/입력값 확인)`);
            dom.statusMsg.className = 'error-msg';
        }
    } catch (_error) {
        setText(dom.statusMsg, '오류가 발생했습니다.');
        dom.statusMsg.className = 'error-msg';
    } finally {
        dom.saveSettingsBtn.disabled = false;
        setTimeout(() => { setText(dom.statusMsg, ''); }, 3000);
    }
});

let searchTimeout = null;

dom.categorySearchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    if (!query) {
        dom.liveCategoryIdInput.value = '';
        dom.selectedCategoryDisplay.classList.add('is-hidden');
        setText(dom.selectedCategoryName, '');
        dom.categorySearchResults.classList.add('is-hidden');
        return;
    }
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        try {
            const data = await searchCategories(query);
            const results = data?.content?.data || data?.data || [];
            renderCategoryResults(results);
        } catch (_error) {
            // silently ignore
        }
    }, 300);
});

document.addEventListener('click', (e) => {
    if (!dom.categorySearchInput.contains(e.target) && !dom.categorySearchResults.contains(e.target)) {
        dom.categorySearchResults.classList.add('is-hidden');
    }
});

const LEGACY_HOSTNAMES = ['chzzk-statistics-dock.pages.dev'];
const NEW_DOCK_URL = 'https://cheese-stick-dock.pages.dev';

function setupMigrationNotice() {
    if (!LEGACY_HOSTNAMES.includes(window.location.hostname)) return;

    const modal = document.getElementById('migration-modal');
    const oldHostEl = document.getElementById('migration-old-host');
    const copyBtn = document.getElementById('migration-copy-btn');
    const dismissBtn = document.getElementById('migration-dismiss-btn');
    if (!modal) return;

    setText(oldHostEl, window.location.hostname);
    modal.classList.remove('is-hidden');

    copyBtn?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(NEW_DOCK_URL);
            setText(copyBtn, '복사됨!');
            setTimeout(() => { setText(copyBtn, '복사'); }, 2000);
        } catch (_e) {
            setText(copyBtn, '실패');
            setTimeout(() => { setText(copyBtn, '복사'); }, 2000);
        }
    });

    dismissBtn?.addEventListener('click', () => {
        modal.classList.add('is-hidden');
    });
}

function initialize() {
    setupMigrationNotice();
    setupHideValuesFeature(state);
    setupConnectionWatchers();

    try {
        const savedId = localStorage.getItem('chzzkChannelId');
        if (savedId && /^[a-f0-9]{10,64}$/i.test(savedId)) {
            patchState({ channelId: savedId });
        } else if (savedId) {
            localStorage.removeItem('chzzkChannelId');
        }
    } catch (_e) {}

    if (handleOAuthReturn(handleAuthSuccess)) return;

    updateAuthUi(false, state);
    handleLogin();
}

function startSettingsPolling() {
    stopSettingsPolling();
    if (pollingPaused) return;

    globals.settingsPollingTimeout = setInterval(() => {
        pollSettingsIfChanged();
    }, SETTINGS_POLL_INTERVAL_MS);
}

function stopSettingsPolling() {
    if (globals.settingsPollingTimeout) {
        clearInterval(globals.settingsPollingTimeout);
        globals.settingsPollingTimeout = null;
    }
}

initialize();
