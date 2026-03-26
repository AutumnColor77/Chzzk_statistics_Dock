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

// --- Core Data Fetching ---

async function fetchChzzkData() {
    if (!state.channelId) {
        updateUi(state);
        return;
    }

    const previousStatus = state.liveStatus;

    try {
        const data = await fetchLiveStatus(state.channelId);
        if (data.code === 200) {
            const content = data.content || {};
            state.liveStatus = content.status || 'CLOSE';
            if (state.liveStatus === 'OPEN') {
                state.concurrentViewers = content.concurrentUserCount || 0;
                state.peakViewers = content.accumulateCount || 0;
                state.followers = content.followerCount || 0;
                state.viewerHistory.push(state.concurrentViewers);
                if (state.viewerHistory.length > MAX_HISTORY_LENGTH) {
                    state.viewerHistory.shift();
                }
            } else {
                state.concurrentViewers = 0;
                state.peakViewers = 0;
                state.followers = content.followerCount || state.followers;
            }
        } else {
            state.liveStatus = 'CLOSE';
        }
    } catch (_error) {
        state.liveStatus = 'CLOSE';
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
                dom.liveTitleInput.value = data.content.defaultLiveTitle || '';
                if (data.content.category) {
                    dom.categoryTypeSelect.value = data.content.category.categoryType || 'GAME';
                    dom.liveCategoryIdInput.value = data.content.category.categoryId || '';
                    dom.categorySearchInput.value = data.content.category.categoryValue || '';
                    if (data.content.category.categoryValue) {
                        dom.selectedCategoryName.textContent = data.content.category.categoryValue;
                        dom.selectedCategoryDisplay.style.display = 'block';
                    } else {
                        dom.selectedCategoryDisplay.style.display = 'none';
                    }
                } else {
                    dom.categoryTypeSelect.value = data.content.categoryType || 'GAME';
                    dom.liveCategoryIdInput.value = '';
                    dom.categorySearchInput.value = '';
                    dom.selectedCategoryDisplay.style.display = 'none';
                }
                dom.liveTagsInput.value = (data.content.tags || []).join(', ');
            }
        }
    } catch (_error) {
        // silently ignore
    }
}

function handleLogout() {
    logout();
    stopFetching();
    updateAuthUi(false, state);
}

function handleAuthSuccess() {
    updateAuthUi(true, state);
    loadAndShowSettings();
    handleLogin();
}

// --- Event Listeners ---

dom.loginBtn.addEventListener('click', login);
dom.logoutBtn.addEventListener('click', handleLogout);
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
        loadAndShowSettings();
        handleLogin();
    }
}

initialize();
