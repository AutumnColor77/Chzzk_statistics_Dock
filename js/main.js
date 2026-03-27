import { state, globals, MAX_HISTORY_LENGTH, setAccessToken } from './state.js';
import { fetchLiveStatus, fetchUserChannel, fetchLiveSettings, updateLiveSettings, searchCategories } from './api.js';
import { login, logout, setupAuthListener } from './auth.js';
import { dom, updateUi, updateAuthUi, renderCategoryResults, setupHideValuesFeature } from './ui.js';

// --- Polling Configuration (Jitter) ---
const BASE_INTERVAL_MS = 30000; // 기본 폴링 주기: 30초
const JITTER_RANGE_MS = 5000;   // Jitter 범위: ±5초 → 실제 25~35초

function getJitteredInterval() {
    return BASE_INTERVAL_MS + (Math.random() * JITTER_RANGE_MS * 2 - JITTER_RANGE_MS);
}

// --- Settings Polling Configuration ---
const SETTINGS_POLL_INTERVAL_MS = 45000; // 설정 폴링 주기: 45초
let lastKnownSettings = null; // 마지막으로 알려진 설정값 (비교용)

// --- Core Data Fetching ---

async function fetchChzzkData(force = false) {
    if (!state.channelId) {
        updateUi(state);
        return;
    }

    const previousStatus = state.liveStatus;

    try {
        const result = await fetchLiveStatus(state.channelId, force);
        const data = result.data;
        state.dataSource = result.source; // 'server' | 'local-cache'

        if (data.code === 200) {
            const content = data.content || {};
            state.liveStatus = content.status || 'CLOSE';

            if (state.liveStatus === 'OPEN') {
                state.concurrentViewers = content.concurrentUserCount || 0;

                // 최고 동시 시청자: localStorage에서 복원 + 현재값 비교
                const storedPeak = parseInt(localStorage.getItem('chzzk_peak_viewers') || '0', 10);
                state.peakViewers = Math.max(state.peakViewers, storedPeak, state.concurrentViewers);
                localStorage.setItem('chzzk_peak_viewers', state.peakViewers.toString());

                state.followers = content.followerCount || 0;
                state.viewerHistory.push(state.concurrentViewers);
                if (state.viewerHistory.length > MAX_HISTORY_LENGTH) {
                    state.viewerHistory.shift();
                }
            } else {
                state.concurrentViewers = 0;
                state.peakViewers = 0;
                localStorage.removeItem('chzzk_peak_viewers');
                state.followers = content.followerCount || state.followers;
            }
        } else {
            state.liveStatus = 'CLOSE';
        }
    } catch (_error) {
        state.liveStatus = 'CLOSE';
        state.dataSource = 'error';
    }

    if (previousStatus === 'OPEN' && state.liveStatus === 'CLOSE') {
        state.viewerHistory = [];
        state.averageViewers = 0;
    }

    calculateAverageViewers();
    updateUi(state);
}

function calculateAverageViewers() {
    if (state.viewerHistory.length === 0) {
        state.averageViewers = 0;
        return;
    }
    const sum = state.viewerHistory.reduce((acc, count) => acc + count, 0);
    state.averageViewers = Math.round(sum / state.viewerHistory.length);
}

function scheduleNextFetch() {
    const interval = getJitteredInterval();
    globals.fetchTimeout = setTimeout(async () => {
        await fetchChzzkData();
        if (state.channelId) {
            scheduleNextFetch();
        }
    }, interval);
}

function startFetching() {
    stopFetching();
    if (state.channelId) {
        fetchChzzkData();
        scheduleNextFetch();
    }
}

function stopFetching() {
    if (globals.fetchTimeout) {
        clearTimeout(globals.fetchTimeout);
        globals.fetchTimeout = null;
    }
}

// --- Auth Flows ---

async function handleLogin() {
    if (!globals.accessToken) return;
    try {
        const response = await fetchUserChannel();
        if (response.ok) {
            const data = await response.json();
            if (data.content && data.content.channelId) {
                state.channelId = data.content.channelId;
                localStorage.setItem('chzzkChannelId', state.channelId);
                startFetching();
            } else {
                updateUi(state, '채널 정보 없음');
            }
        } else if (response.status === 401) {
            handleLogout();
        } else if (response.status === 403) {
            updateUi(state, '권한 부족 (유저정보)');
            dom.statusMsg.textContent = '앱 설정에서 유저 정보 조회 권한을 추가해주세요.';
            dom.statusMsg.className = 'error-msg';
        } else {
            updateUi(state, '연동 에러');
        }
    } catch (_error) {
        updateUi(state, '네트워크 에러');
    }
}

async function loadAndShowSettings() {
    if (!globals.accessToken) return;
    try {
        const response = await fetchLiveSettings();
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

/**
 * API 응답의 content를 UI 입력 필드에 적용합니다.
 */
function applySettingsToUi(content) {
    dom.liveTitleInput.value = content.defaultLiveTitle || '';
    if (content.category) {
        dom.categoryTypeSelect.value = content.category.categoryType || 'GAME';
        dom.liveCategoryIdInput.value = content.category.categoryId || '';
        dom.categorySearchInput.value = content.category.categoryValue || '';
        if (content.category.categoryValue) {
            dom.selectedCategoryName.textContent = content.category.categoryValue;
            dom.selectedCategoryDisplay.style.display = 'block';
        } else {
            dom.selectedCategoryDisplay.style.display = 'none';
        }
    } else {
        dom.categoryTypeSelect.value = content.categoryType || 'GAME';
        dom.liveCategoryIdInput.value = '';
        dom.categorySearchInput.value = '';
        dom.selectedCategoryDisplay.style.display = 'none';
    }
    dom.liveTagsInput.value = (content.tags || []).join(', ');
}

/**
 * API 응답에서 비교용 스냅샷을 추출합니다.
 */
function extractSettingsSnapshot(content) {
    return {
        title: content.defaultLiveTitle || '',
        categoryType: content.category?.categoryType || content.categoryType || 'GAME',
        categoryId: content.category?.categoryId || '',
        categoryValue: content.category?.categoryValue || '',
        tags: (content.tags || []).join(', ')
    };
}

/**
 * 설정 입력 필드 중 하나라도 포커스(편집 중)인지 확인합니다.
 */
function isSettingsInputFocused() {
    const active = document.activeElement;
    return (
        active === dom.liveTitleInput ||
        active === dom.categorySearchInput ||
        active === dom.liveTagsInput ||
        active === dom.categoryTypeSelect
    );
}

/**
 * 원격 설정이 변경되었는지 확인하고, 변경 시 UI를 갱신합니다.
 * 사용자가 입력 필드를 편집 중이면 갱신을 건너뜁니다.
 */
async function pollSettingsIfChanged() {
    if (!globals.accessToken) return;

    // 편집 중이면 이번 사이클은 건너뜀
    if (isSettingsInputFocused()) return;

    try {
        const response = await fetchLiveSettings();
        if (response.status === 401) { handleLogout(); return; }
        if (!response.ok) return;

        const data = await response.json();
        if (!data.content) return;

        const remote = extractSettingsSnapshot(data.content);

        // 최초 실행이거나 변경이 감지된 경우에만 UI 갱신
        const isFirstSync = !lastKnownSettings;
        if (isFirstSync || !settingsEqual(lastKnownSettings, remote)) {
            applySettingsToUi(data.content);
            lastKnownSettings = remote;

            // 외부 변경 알림 (최초 로드가 아닌 경우에만)
            if (!isFirstSync) {
                dom.statusMsg.textContent = '외부에서 설정이 변경되어 반영했습니다.';
                dom.statusMsg.className = 'info-msg';
                setTimeout(() => { dom.statusMsg.textContent = ''; }, 3000);
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
    stopFetching();
    stopSettingsPolling();
    lastKnownSettings = null;
    updateAuthUi(false, state);
}

function handleAuthSuccess() {
    updateAuthUi(true, state);
    loadAndShowSettings().then(() => startSettingsPolling());
    handleLogin();
}

// --- Event Listeners ---

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
setupAuthListener(handleAuthSuccess);

dom.saveSettingsBtn.addEventListener('click', async () => {
    if (!globals.accessToken) return;

    const title = dom.liveTitleInput.value.trim();
    const categoryType = dom.categoryTypeSelect.value;
    const categoryId = dom.liveCategoryIdInput.value.trim();
    const tagsInput = dom.liveTagsInput.value;
    const tags = tagsInput ? tagsInput.split(',').map(tag => tag.trim()).filter(tag => tag) : [];

    const body = { defaultLiveTitle: title, categoryType, tags };
    if (categoryId) body.categoryId = categoryId;

    dom.saveSettingsBtn.disabled = true;
    dom.statusMsg.textContent = '업데이트 중...';
    dom.statusMsg.className = '';

    try {
        const response = await updateLiveSettings(body);
        if (response.ok) {
            // 저장 성공 시 lastKnownSettings를 현재 값으로 갱신 (폴링이 즉시 덮어쓰지 않도록)
            lastKnownSettings = {
                title, categoryType, categoryId,
                categoryValue: dom.categorySearchInput.value.trim(),
                tags: tagsInput
            };
            dom.statusMsg.textContent = '방송 설정이 업데이트 되었습니다.';
            dom.statusMsg.className = 'success-msg';
        } else {
            let errorDetails = '';
            try {
                const errPayload = await response.json();
                if (errPayload.message) errorDetails = ` (${errPayload.message})`;
            } catch (_e) {}
            dom.statusMsg.textContent = `업데이트 실패${errorDetails} (권한/입력값 확인)`;
            dom.statusMsg.className = 'error-msg';
        }
    } catch (_error) {
        dom.statusMsg.textContent = '오류가 발생했습니다.';
        dom.statusMsg.className = 'error-msg';
    } finally {
        dom.saveSettingsBtn.disabled = false;
        setTimeout(() => { dom.statusMsg.textContent = ''; }, 3000);
    }
});

// --- Category Autocomplete ---
let searchTimeout = null;

dom.categorySearchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    if (!query) {
        dom.liveCategoryIdInput.value = '';
        dom.selectedCategoryDisplay.style.display = 'none';
        dom.categorySearchResults.style.display = 'none';
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
        dom.categorySearchResults.style.display = 'none';
    }
});

// --- Initialization ---
function initialize() {
    setupHideValuesFeature(state);

    const savedId = localStorage.getItem('chzzkChannelId');
    if (savedId) {
        state.channelId = savedId;
    }

    updateAuthUi(!!globals.accessToken, state);

    if (globals.accessToken) {
        loadAndShowSettings().then(() => startSettingsPolling());
        handleLogin();
    }
}

// --- Settings Polling ---

function startSettingsPolling() {
    stopSettingsPolling();
    if (!globals.accessToken) return;

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
