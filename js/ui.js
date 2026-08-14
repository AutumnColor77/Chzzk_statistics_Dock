import { state, subscribe, patchState } from './state.js';
import { setText, clearChildren, setAttrIfChanged, toggleClass } from './dom-safe.js';

export const dom = {
    settingsPanel: document.getElementById('settings-panel'),
    statsContainer: document.getElementById('stats-container'),
    statItems: document.querySelectorAll('.stat-item'),
    loginBtn: document.getElementById('chzzk-login-btn'),
    authSection: document.getElementById('auth-section'),
    dashboardSection: document.getElementById('dashboard-section'),
    saveSettingsBtn: document.getElementById('save-live-settings'),
    logoutBtn: document.getElementById('chzzk-logout-btn'),
    statusMsg: document.getElementById('settings-status-msg'),
    statusDot: document.querySelector('.status-dot'),
    headerLogo: document.querySelector('.header-logo'),
    headerChannelName: document.getElementById('header-channel-name'),
    categorySearchInput: document.getElementById('category-search-input'),
    categorySearchResults: document.getElementById('category-search-results'),
    categoryTypeSelect: document.getElementById('live-category-type'),
    liveCategoryIdInput: document.getElementById('live-category-id'),
    selectedCategoryDisplay: document.getElementById('selected-category-display'),
    selectedCategoryName: document.getElementById('selected-category-name'),
    liveTitleInput: document.getElementById('live-title-input'),
    liveTagsInput: document.getElementById('live-tags-input'),
    refreshStatsBtn: document.getElementById('refresh-stats-btn')
};

const HEADER_LOGO_BY_SOURCE = {
    server: 'icon_green.png',
    'local-cache': 'icon_orange.png',
    error: 'icon_red.png'
};

const DEFAULT_CHANNEL_TITLE = 'Cheese Stick Dock';
const CATEGORY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const STAT_DEPENDENCIES = {
    'concurrent-viewers': ['liveStatus', 'concurrentViewers', 'channelId', 'uiError', 'authenticated'],
    'peak-viewers': ['liveStatus', 'peakViewers', 'channelId', 'uiError', 'authenticated'],
    'average-viewers': ['liveStatus', 'averageViewers', 'channelId', 'uiError', 'authenticated'],
    followers: ['liveStatus', 'followers', 'channelId', 'uiError', 'authenticated']
};

function show(el) { if (el) el.classList.remove('is-hidden'); }
function hide(el) { if (el) el.classList.add('is-hidden'); }

function shouldPaint(changedKeys, deps) {
    if (!changedKeys || !changedKeys.length) return true;
    for (let i = 0; i < deps.length; i++) {
        if (changedKeys.indexOf(deps[i]) !== -1) return true;
    }
    return false;
}

function formatStatValue(nextState, key) {
    if (nextState.uiError) return nextState.uiError;
    if (!nextState.channelId) return '로딩 중...';
    if (key === 'concurrent-viewers') {
        return nextState.liveStatus === 'OPEN' ? nextState.concurrentViewers.toLocaleString() : '오프라인';
    }
    if (key === 'peak-viewers') {
        return nextState.liveStatus === 'OPEN' ? nextState.peakViewers.toLocaleString() : '오프라인';
    }
    if (key === 'average-viewers') {
        return nextState.liveStatus === 'OPEN' ? nextState.averageViewers.toLocaleString() : '오프라인';
    }
    if (nextState.followers > 0) return nextState.followers.toLocaleString();
    return nextState.liveStatus === 'CLOSE' ? '오프라인' : '0';
}

export function updateUi(nextState = state, _customErrorMsg, changedKeys) {
    const forceAll = !changedKeys || !changedKeys.length;

    if (forceAll || shouldPaint(changedKeys, ['channelName', 'authenticated'])) {
        const title = nextState.authenticated && nextState.channelName
            ? nextState.channelName
            : DEFAULT_CHANNEL_TITLE;
        setText(dom.headerChannelName, title);
    }

    dom.statItems.forEach((item) => {
        const valueEl = item.querySelector('.value');
        if (!valueEl) return;
        const key = item.id.replace('-item', '');
        const deps = STAT_DEPENDENCIES[key];
        if (!forceAll && deps && !shouldPaint(changedKeys, deps)) return;

        if (item.classList.contains('value-hidden')) {
            setText(valueEl, '가려짐');
        } else {
            setText(valueEl, formatStatValue(nextState, key));
        }
    });

    if (forceAll || shouldPaint(changedKeys, ['dataSource', 'online'])) {
        updateDataSourceIndicator(nextState.dataSource, nextState.online);
    }
}

function updateDataSourceIndicator(source, online) {
    const resolved = online === false ? 'error' : source;
    const logo = HEADER_LOGO_BY_SOURCE[resolved] || HEADER_LOGO_BY_SOURCE.server;
    if (dom.headerLogo) {
        setAttrIfChanged(dom.headerLogo, 'src', logo);
    }

    if (!dom.statusDot) return;

    toggleClass(dom.statusDot, 'status-dot--cached', resolved === 'local-cache');
    toggleClass(dom.statusDot, 'status-dot--error', resolved === 'error');

    let title = '';
    if (online === false) title = '네트워크 연결 끊김 — 재연결 대기 중';
    else if (resolved === 'local-cache') title = '서버 연결 불안정 — 로컬 캐시 데이터 표시 중';
    else if (resolved === 'error') title = '서버 연결 실패';
    setAttrIfChanged(dom.statusDot, 'title', title);
}

export function updateAuthUi(hasToken, nextState = state) {
    if (hasToken) {
        hide(dom.authSection);
        show(dom.dashboardSection);
        if (!nextState.authenticated) {
            patchState({ authenticated: true });
        } else {
            updateUi(nextState, null, ['authenticated', 'channelName']);
        }
    } else {
        show(dom.authSection);
        hide(dom.dashboardSection);
        patchState({
            authenticated: false,
            channelId: null,
            channelName: '',
            uiError: 'ID 없음'
        });
    }
}

export function renderCategoryResults(results) {
    clearChildren(dom.categorySearchResults);
    if (!results || results.length === 0) {
        hide(dom.categorySearchResults);
        return;
    }

    const ul = document.createElement('ul');
    results.forEach((item) => {
        const li = document.createElement('li');
        setText(li, item.categoryValue);
        li.addEventListener('click', () => {
            const categoryId = typeof item.categoryId === 'string' ? item.categoryId : '';
            dom.liveCategoryIdInput.value = CATEGORY_ID_PATTERN.test(categoryId) ? categoryId : '';
            dom.categorySearchInput.value = toInputText(item.categoryValue);
            if (item.categoryType === 'GAME' || item.categoryType === 'SPORTS' || item.categoryType === 'ETC') {
                dom.categoryTypeSelect.value = item.categoryType;
            }
            setText(dom.selectedCategoryName, item.categoryValue);
            show(dom.selectedCategoryDisplay);
            hide(dom.categorySearchResults);
        });
        ul.appendChild(li);
    });

    dom.categorySearchResults.appendChild(ul);
    show(dom.categorySearchResults);
}

function toInputText(value) {
    return String(value == null ? '' : value);
}

export function setupHideValuesFeature(nextState) {
    dom.statItems.forEach((item) => {
        const storageKey = `value-hidden-${item.id}`;
        let isHidden = false;
        try { isHidden = localStorage.getItem(storageKey) === 'true'; } catch (_e) {}

        toggleClass(item, 'value-hidden', isHidden);

        item.addEventListener('click', () => {
            const shouldHide = !item.classList.contains('value-hidden');
            toggleClass(item, 'value-hidden', shouldHide);
            try { localStorage.setItem(storageKey, shouldHide); } catch (_e) {}
            updateUi(nextState);
        });
    });
}

subscribe((changedKeys, nextState) => {
    updateUi(nextState, null, changedKeys);
});
