document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const settingsPanel = document.getElementById('settings-panel');
    const statsContainer = document.getElementById('stats-container');
    const settingsToggleButton = document.getElementById('settings-toggle-button');
    
    const channelIdInput = document.getElementById('channel-id-input');
    const saveButton = document.getElementById('save-channel-id');
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

    function updateUi() {
        const items = {
            'concurrent-viewers': state.liveStatus === 'OPEN' ? state.concurrentViewers.toLocaleString() : '오프라인',
            'peak-viewers': state.liveStatus === 'OPEN' ? state.peakViewers.toLocaleString() : '오프라인',
            'average-viewers': state.liveStatus === 'OPEN' ? state.averageViewers.toLocaleString() : '오프라인',
            'followers': state.followers > 0 ? state.followers.toLocaleString() : (state.liveStatus === 'CLOSE' ? '오프라인' : '0'),
        };

        if (!state.channelId) {
             Object.keys(items).forEach(key => items[key] = 'ID 없음');
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
    function updateSettingsButtonText() {
        const isVisible = settingsPanel.classList.contains('visible');
        settingsToggleButton.textContent = isVisible ? '설정 접기' : '설정 열기';
    }

    function setupInitialUI(hasChannelId) {
        statsContainer.style.display = 'grid';
        settingsToggleButton.style.display = 'block';

        if (hasChannelId) {
            settingsPanel.classList.remove('visible');
        } else {
            settingsPanel.classList.add('visible');
        }
        updateSettingsButtonText();
    }
    
    settingsToggleButton.addEventListener('click', () => {
        settingsPanel.classList.toggle('visible');
        updateSettingsButtonText();
    });

    function saveChannelId() {
        let newId = channelIdInput.value.trim();

        if (newId.includes('chzzk.naver.com/live/')) {
            try {
                const url = new URL(newId);
                const pathParts = url.pathname.split('/');
                newId = pathParts[pathParts.length - 1] || '';
            } catch (e) {
                console.error("Invalid URL format:", e);
            }
        }
        
        if (newId) {
            state.channelId = newId;
            localStorage.setItem('chzzkChannelId', newId); // Save the channel ID
            state.viewerHistory = [];
            setupInitialUI(true);
            startFetching();
        }
    }

    saveButton.addEventListener('click', saveChannelId);
    channelIdInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') saveChannelId();
    });

    // --- Auth & Settings Management ---
    const loginBtn = document.getElementById('chzzk-login-btn');
    const authSection = document.getElementById('auth-section');
    const liveSettingsSection = document.getElementById('live-settings-section');
    const saveSettingsBtn = document.getElementById('save-live-settings');
    const logoutBtn = document.getElementById('chzzk-logout-btn');
    const statusMsg = document.getElementById('settings-status-msg');

    let accessToken = localStorage.getItem('chzzkAccessToken');

    function updateAuthUi() {
        if (accessToken) {
            authSection.style.display = 'none';
            liveSettingsSection.style.display = 'block';
            fetchLiveSettings();
        } else {
            authSection.style.display = 'block';
            liveSettingsSection.style.display = 'none';
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
            channelIdInput.value = savedId; // Pre-fill the input field
            setupInitialUI(true);
            startFetching();
        } else {
            setupInitialUI(false);
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
