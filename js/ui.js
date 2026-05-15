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

function show(el) { if (el) el.classList.remove('is-hidden'); }
function hide(el) { if (el) el.classList.add('is-hidden'); }

export function updateUi(state, customErrorMsg) {
    const items = {
        'concurrent-viewers': state.liveStatus === 'OPEN' ? state.concurrentViewers.toLocaleString() : '오프라인',
        'peak-viewers': state.liveStatus === 'OPEN' ? state.peakViewers.toLocaleString() : '오프라인',
        'average-viewers': state.liveStatus === 'OPEN' ? state.averageViewers.toLocaleString() : '오프라인',
        'followers': state.followers > 0 ? state.followers.toLocaleString() : (state.liveStatus === 'CLOSE' ? '오프라인' : '0'),
    };

    if (customErrorMsg) {
        Object.keys(items).forEach(key => items[key] = customErrorMsg);
    } else if (!state.channelId) {
        Object.keys(items).forEach(key => items[key] = '로딩 중...');
    }

    dom.statItems.forEach(item => {
        const valueEl = item.querySelector('.value');
        const itemId = item.id;
        const key = itemId.replace('-item', '');

        if (item.classList.contains('value-hidden')) {
            valueEl.textContent = '가려짐';
        } else {
            valueEl.textContent = items[key];
        }
    });

    updateDataSourceIndicator(state.dataSource);
}

function updateDataSourceIndicator(source) {
    if (dom.headerLogo) {
        dom.headerLogo.src = HEADER_LOGO_BY_SOURCE[source] || HEADER_LOGO_BY_SOURCE.server;
    }

    if (!dom.statusDot) return;

    dom.statusDot.classList.remove('status-dot--cached', 'status-dot--error');
    dom.statusDot.title = '';

    if (source === 'local-cache') {
        dom.statusDot.classList.add('status-dot--cached');
        dom.statusDot.title = '서버 연결 불안정 — 로컬 캐시 데이터 표시 중';
    } else if (source === 'error') {
        dom.statusDot.classList.add('status-dot--error');
        dom.statusDot.title = '서버 연결 실패';
    }
}

export function updateAuthUi(hasToken, state) {
    if (hasToken) {
        hide(dom.authSection);
        show(dom.dashboardSection);
        updateUi(state);
    } else {
        show(dom.authSection);
        hide(dom.dashboardSection);
        state.channelId = null;
        updateUi(state, 'ID 없음');
    }
}

export function renderCategoryResults(results, onSelect) {
    dom.categorySearchResults.innerHTML = '';
    if (!results || results.length === 0) {
        hide(dom.categorySearchResults);
        return;
    }

    const ul = document.createElement('ul');
    results.forEach(item => {
        const li = document.createElement('li');
        // textContent 사용으로 XSS 방지.
        li.textContent = item.categoryValue;
        li.addEventListener('click', () => {
            dom.liveCategoryIdInput.value = item.categoryId;
            dom.categorySearchInput.value = item.categoryValue;
            if (item.categoryType) {
                dom.categoryTypeSelect.value = item.categoryType;
            }
            dom.selectedCategoryName.textContent = item.categoryValue;
            show(dom.selectedCategoryDisplay);
            hide(dom.categorySearchResults);
        });
        ul.appendChild(li);
    });

    dom.categorySearchResults.appendChild(ul);
    show(dom.categorySearchResults);
}

export function setupHideValuesFeature(state) {
    dom.statItems.forEach(item => {
        const storageKey = `value-hidden-${item.id}`;
        let isHidden = false;
        try { isHidden = localStorage.getItem(storageKey) === 'true'; } catch (_e) {}

        item.classList.toggle('value-hidden', isHidden);

        item.addEventListener('click', () => {
            const shouldHide = !item.classList.contains('value-hidden');
            item.classList.toggle('value-hidden', shouldHide);
            try { localStorage.setItem(storageKey, shouldHide); } catch (_e) {}
            updateUi(state);
        });
    });
}
