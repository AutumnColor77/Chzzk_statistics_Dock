document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const settingsPanel = document.getElementById('settings-panel');
    const statsContainer = document.getElementById('stats-container');
    
    // UI elements for settings updates
    const statItems = document.querySelectorAll('.stat-item');

    // --- State Management ---
    const MAX_HISTORY_LENGTH = 120;
    const state = {
        channelId: null,
        liveStatus: 'CLOSE',
        concurrentViewers: 0,
        peakViewers: 0,
        followers: 0,
        averageViewers: 0,
        viewerHistory: [],
    };
    
    let fetchInterval = null;

    // --- Core Functions ---
    async function fetchChzzkData() {
        if (!state.channelId) {
            updateUi(); // Call updateUi to show "ID 없음"
            return;
        }

        const url = `/api/live-status?channelId=${state.channelId}`;
        const previousStatus = state.liveStatus;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
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
        } catch (error) {
            state.liveStatus = 'CLOSE';
        }
        
        if (previousStatus === 'OPEN' && state.liveStatus === 'CLOSE') {
            state.viewerHistory = [];
            state.averageViewers = 0;
        }

        calculateAverageViewers();
        updateUi();
    }

    function calculateAverageViewers() {
        if (state.viewerHistory.length === 0) {
            state.averageViewers = 0;
            return;
        }
        const sum = state.viewerHistory.reduce((acc, count) => acc + count, 0);
        state.averageViewers = Math.round(sum / state.viewerHistory.length);
    }

    function updateUi(customErrorMsg) {
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

        statItems.forEach(item => {
            const valueEl = item.querySelector('.value');
            const itemId = item.id;
            const key = itemId.replace('-item', '');

            if (item.classList.contains('value-hidden')) {
                valueEl.textContent = '가려짐';
            } else {
                valueEl.textContent = items[key];
            }
        });
    }

    function startFetching() {
        if (fetchInterval) clearInterval(fetchInterval);
        if (state.channelId) {
            fetchChzzkData();
            fetchInterval = setInterval(fetchChzzkData, 30000);
        }
    }

    // --- UI and Event Listeners ---
    // Setting panel logic depends entirely on auth state now.

    // --- Auth & Settings Management ---
    const loginBtn = document.getElementById('chzzk-login-btn');
    const authSection = document.getElementById('auth-section');
    const dashboardSection = document.getElementById('dashboard-section');
    const saveSettingsBtn = document.getElementById('save-live-settings');
    const logoutBtn = document.getElementById('chzzk-logout-btn');
    const statusMsg = document.getElementById('settings-status-msg');

    let accessToken = localStorage.getItem('chzzkAccessToken');

    async function fetchUserChannel() {
        if (!accessToken) return;
        try {
            const response = await fetch('/api/users/me', {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (response.ok) {
                const data = await response.json();
                if (data.content && data.content.channelId) {
                    state.channelId = data.content.channelId;
                    localStorage.setItem('chzzkChannelId', state.channelId);
                    startFetching(); // this will call updateUi
                } else {
                    updateUi('채널 정보 없음');
                }
            } else if (response.status === 401) {
                logoutBtn.click();
            } else if (response.status === 403) {
                updateUi('권한 부족 (유저정보)');
                statusMsg.textContent = '앱 설정에서 유저 정보 조회 권한을 추가해주세요.';
                statusMsg.className = 'error-msg';
            } else {
                updateUi('연동 에러');
            }
        } catch (error) {
            console.error('Failed to fetch user channel', error);
            updateUi('네트워크 에러');
        }
    }

    function updateAuthUi() {
        const dashboardSection = document.getElementById('dashboard-section');
        if (accessToken) {
            authSection.style.display = 'none';
            dashboardSection.style.display = 'flex';
            updateUi(); // Load initial layout values (e.g. "로딩 중...")
            fetchLiveSettings();
            fetchUserChannel();
        } else {
            authSection.style.display = 'block';
            dashboardSection.style.display = 'none';
            if (fetchInterval) clearInterval(fetchInterval);
            state.channelId = null;
            updateUi('ID 없음');
        }
    }

    loginBtn.addEventListener('click', () => {
        const width = 500;
        const height = 600;
        const left = (window.innerWidth / 2) - (width / 2);
        const top = (window.innerHeight / 2) - (height / 2);
        window.open('/api/auth/login', 'ChzzkAuth', `width=${width},height=${height},top=${top},left=${left}`);
    });

    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'CHZZK_AUTH_SUCCESS') {
            const tokenData = event.data.payload;
            accessToken = tokenData.accessToken;
            localStorage.setItem('chzzkAccessToken', accessToken);
            updateAuthUi();
        }
    });

    logoutBtn.addEventListener('click', () => {
        accessToken = null;
        localStorage.removeItem('chzzkAccessToken');
        updateAuthUi();
    });

    async function fetchLiveSettings() {
        if (!accessToken) return;
        try {
            const response = await fetch('/api/lives/setting', {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (response.status === 401) {
                logoutBtn.click();
                return;
            }
            if (response.ok) {
                const data = await response.json();
                if (data.content) {
                    document.getElementById('live-title-input').value = data.content.defaultLiveTitle || '';
                    document.getElementById('live-category-type').value = data.content.categoryType || 'GAME';
                    document.getElementById('live-category-id').value = data.content.categoryId || '';
                    document.getElementById('live-tags-input').value = (data.content.tags || []).join(', ');
                }
            }
        } catch (error) {
            console.error('Failed to fetch settings', error);
        }
    }

    saveSettingsBtn.addEventListener('click', async () => {
        if (!accessToken) return;
        
        const title = document.getElementById('live-title-input').value.trim();
        const categoryType = document.getElementById('live-category-type').value;
        const categoryId = document.getElementById('live-category-id').value.trim();
        const tagsInput = document.getElementById('live-tags-input').value;
        
        const tags = tagsInput ? tagsInput.split(',').map(tag => tag.trim()).filter(tag => tag) : [];

        const body = {
            defaultLiveTitle: title,
            categoryType: categoryType,
            tags: tags
        };
        
        if (categoryId) body.categoryId = categoryId;
        else body.categoryId = "";

        saveSettingsBtn.disabled = true;
        statusMsg.textContent = '업데이트 중...';
        statusMsg.className = '';

        try {
            const response = await fetch('/api/lives/setting', {
                method: 'PATCH',
                headers: { 
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (response.ok) {
                statusMsg.textContent = '방송 설정이 업데이트 되었습니다.';
                statusMsg.className = 'success-msg';
            } else {
                statusMsg.textContent = '업데이트 실패 (권한이나 입력값을 확인하세요).';
                statusMsg.className = 'error-msg';
            }
        } catch (error) {
            statusMsg.textContent = '오류가 발생했습니다.';
            statusMsg.className = 'error-msg';
        } finally {
            saveSettingsBtn.disabled = false;
            setTimeout(() => { statusMsg.textContent = ''; }, 3000);
        }
    });

    // --- Initialization ---
    function initialize() {
        const savedId = localStorage.getItem('chzzkChannelId');
        if (savedId) {
            state.channelId = savedId;
            statsContainer.style.display = 'grid';
            startFetching();
        } else {
            updateUi(); // Show "ID 없음" message initially
        }
        
        // Add back the click-to-hide functionality
        statItems.forEach(item => {
            const storageKey = `value-hidden-${item.id}`;
            const isHidden = localStorage.getItem(storageKey) === 'true';
            
            item.classList.toggle('value-hidden', isHidden);

            item.addEventListener('click', () => {
                const shouldHide = !item.classList.contains('value-hidden');
                item.classList.toggle('value-hidden', shouldHide);
                localStorage.setItem(storageKey, shouldHide);
                updateUi(); // Re-render to show "가려짐" or the value
            });
        });

        updateUi(); // Call once after setting initial hidden states
        updateAuthUi(); // Initialize Auth UI
    }

    initialize();
});
